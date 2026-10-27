// Copyright (c) 2026 ViceTogether contributors. MIT.
// Experimental host-owned ambient replicas; guest driving ownership is separate.
#include "common.h"
#include "ViceTogetherWorld.h"
#include "ViceTogether.h"
#include "Pools.h"
#include "World.h"
#include "Streaming.h"
#include "ModelInfo.h"
#include "PedModelInfo.h"
#include "VehicleModelInfo.h"
#include "HandlingMgr.h"
#include "Vehicle.h"
#include "Automobile.h"
#include "Hud.h"
#include "Text.h"
#include "Bike.h"
#include "Boat.h"
#include "Heli.h"
#include "Plane.h"
#include "Population.h"
#include "CarCtrl.h"
#include "PathFind.h"
#include "Timer.h"
#include "Clock.h"
#include "WaterLevel.h"
#include "Weather.h"
#include "WeaponInfo.h"
#include "Pad.h"
#include "AnimManager.h"
#include "AnimBlendAssocGroup.h"
#include "AnimBlendAssociation.h"
#include "RpAnimBlend.h"
#include "Object.h"
#include "Glass.h"
#include "ModelIndices.h"
#include "Explosion.h"
#include <map>
#include <vector>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <algorithm>
#include <deque>
namespace {
struct EntityState { unsigned id,type; float data[34],visual[34]; bool hasVisual; };
struct Replica { CEntity* entity; float previous[34],target[34],previousVisual[34],visual[34]; uint32 received; unsigned generation; bool hasVisual; };
struct DriverMotion { float from[12],target[12]; uint32 received,duration; bool initialized,settled; };
struct PedShotSample {uint32 time;int model;CVector position;};
std::map<unsigned,Replica> pedestrians,vehicles;
std::map<unsigned,DriverMotion> driverMotions;
uint32 testDriverMotionFrames=0,testDriverMotionPackets=0;
CVehicle* networkHelis[16]={};
CVector networkHeliAnchors[16];
float networkHeliHeadings[16]={};
std::map<unsigned,uint32> delegatedVehicles;
std::map<unsigned,std::deque<PedShotSample>> pedShotHistory;
std::map<unsigned,uint32> priorityPeds;
std::vector<EntityState> pending;
unsigned generation=0,expected=0,pendingSequence=0;bool receiving=false,active=false;
float pendingEnvironment[32]={},environment[32]={};
struct GlassState {float data[34];};std::vector<GlassState> glass,pendingGlass;unsigned expectedGlass=0;bool replayingGlass=false;
struct ExplosionState{float data[34];uint32 time;};std::vector<ExplosionState> explosions,pendingExplosions;unsigned explosionSequence=0,expectedExplosions=0,lastExplosion=0;
bool guestOwnsNearbyPopulation();
bool sameGlass(const float* a,const float* b){return int(a[0])==int(b[0]) && fabsf(a[2]-b[2])<0.05f && fabsf(a[3]-b[3])<0.05f && fabsf(a[4]-b[4])<0.05f;}
void retainGlass(const GlassState& state){for(auto& item:glass)if(sameGlass(item.data,state.data)){if(state.data[1]>=item.data[1])item=state;return;}if(glass.size()<512)glass.push_back(state);}
void applyGlass(CObject* object,const float* d){if(d[1]==2 && !object->bGlassBroken){replayingGlass=true;CGlass::WindowRespondsToCollision(object,d[11],CVector(d[5],d[6],d[7]),CVector(d[8],d[9],d[10]),d[12]!=0);replayingGlass=false;}else if(d[1]>=1)object->bGlassCracked=true;}
bool host() { const char* role=getenv("VT_WORLD_HOST");return role && atoi(role)==1; }
bool guest() { const char* role=getenv("VT_WORLD_HOST");return role && atoi(role)==0; }
int menuSpawnModel=-1;uint32 menuSpawnTime=0,menuLastSpawn=0;CVehicle* menuSpawned[8]={};const char* menuStatus="";bool menuSpawnHasPosition=false;CVector menuSpawnPosition;float menuSpawnHeading=0;
const int allowedVehicleModels[]={130,135,141,145,155,159,166,176,182,190,191,192,193,203,217};
bool allowedVehicle(int model){return std::find(allowedVehicleModels,allowedVehicleModels+15,model)!=allowedVehicleModels+15;}
CHeli* createMultiplayerHeli(int model){
    CHeli* heli=new CHeli(model,MISSION_VEHICLE);
    // The constructor initializes the physics fields, but a script-type heli
    // still runs player-following AI and climbs while nobody is piloting it.
    // Catalina path state 7 is the engine's stationary route state: the rotor
    // and normal vehicle physics remain active, without the ambient chase AI.
    heli->m_heliType=HELI_TYPE_CATALINA;
    heli->m_pathState=7;
    heli->m_nExplosionTimer=0;
    heli->m_fTargetZ=0.0f;
    heli->m_fSearchLightIntensity=0.0f;
    heli->m_nShootTimer=CTimer::GetTimeInMilliseconds();
    heli->m_fTargetOffset=0.0f;
    heli->m_numSwat=0;
    for(int i=0;i<4;i++)heli->m_aSwatState[i]=0;
    return heli;
}
CVehicle* createMultiplayerVehicle(int model){auto* info=(CVehicleModelInfo*)CModelInfo::GetModelInfo(model);if(!info)return nil;const auto* handling=mod_HandlingManager.GetHandlingData((tVehicleType)info->m_handlingId);const uint32 flags=handling?handling->Flags:0;if(flags&HANDLING_IS_HELI)return createMultiplayerHeli(model);if(flags&HANDLING_IS_PLANE)return new CPlane(model,MISSION_VEHICLE);if(flags&HANDLING_IS_BOAT)return new CBoat(model,MISSION_VEHICLE);if(flags&HANDLING_IS_BIKE)return new CBike(model,MISSION_VEHICLE);switch(info->m_vehicleType){case VEHICLE_TYPE_BIKE:return new CBike(model,MISSION_VEHICLE);case VEHICLE_TYPE_BOAT:return new CBoat(model,MISSION_VEHICLE);case VEHICLE_TYPE_HELI:return createMultiplayerHeli(model);case VEHICLE_TYPE_PLANE:return new CPlane(model,MISSION_VEHICLE);case VEHICLE_TYPE_CAR:return new CAutomobile(model,MISSION_VEHICLE);default:return nil;}}
void trackNetworkHeli(CVehicle* car){if(!car||!car->IsHeli())return;for(int i=0;i<16;i++)if(networkHelis[i]==car){networkHeliAnchors[i]=car->GetPosition();networkHeliHeadings[i]=car->GetHeading();return;}for(int i=0;i<16;i++)if(!networkHelis[i]){networkHelis[i]=car;networkHeliAnchors[i]=car->GetPosition();networkHeliHeadings[i]=car->GetHeading();car->RegisterReference((CEntity**)&networkHelis[i]);return;}}
void stabilizeUnpilotedNetworkHelis(){
    if(!host()&&!guest())return;
    const uint32 now=CTimer::GetTimeInMilliseconds();
    for(int i=0;i<16;i++){
        CVehicle* heli=networkHelis[i];if(!heli||!heli->IsHeli())continue;
        const unsigned id=unsigned(CPools::GetVehicleRef(heli));
        const auto delegated=delegatedVehicles.find(id);
        const bool remotePilot=delegated!=delegatedVehicles.end()&&now-delegated->second<1500;
        bool occupied=heli->pDriver!=nil;
        for(int seat=0;seat<8&&!occupied;seat++)occupied=heli->pPassengers[seat]!=nil;
        if(occupied||remotePilot){networkHeliAnchors[i]=heli->GetPosition();networkHeliHeadings[i]=heli->GetHeading();continue;}
        const CVector offset=heli->GetPosition()-networkHeliAnchors[i];
        const float headingDelta=atan2f(sinf(heli->GetHeading()-networkHeliHeadings[i]),cosf(heli->GetHeading()-networkHeliHeadings[i]));
        if(offset.MagnitudeSqr()<0.0625f&&heli->GetMoveSpeed().MagnitudeSqr()<0.0064f&&fabsf(headingDelta)<0.04f)continue;
        // Keep an empty network helicopter at its last safe point if engine
        // idle physics drifts it. Do not touch transforms while a native seat
        // is occupied or during a delegated pilot update.
        CWorld::Remove(heli);
        heli->SetPosition(networkHeliAnchors[i]);
        heli->SetHeading(networkHeliHeadings[i]);
        heli->SetMoveSpeed(0.0f,0.0f,0.0f);
        heli->m_vecTurnSpeed=CVector(0.0f,0.0f,0.0f);
        CWorld::Add(heli);
        heli->GetMatrix().UpdateRW();
        heli->UpdateRwFrame();
    }
}
int testMeleeStage=0,testMeleeTarget=-1;float testMeleeLocalDistance=-1,testMeleeRemoteDistance=-1;
int testSeatGrantStatus=0;
int testSeatGrantCalls=0;
int testSeatGrantModel=-1;
int testSeatGrantSeat=-2;
float testHostExitSpeed=-1.0f;
bool testHostExitWithDriver=false;
void applyDoorAngles(CAutomobile* car,const float* angles){const int nodes[]={CAR_BONNET,CAR_BOOT,CAR_DOOR_LF,CAR_DOOR_RF,CAR_DOOR_LR,CAR_DOOR_RR};for(int i=0;i<6;i++){if(!car->m_aCarNodes[nodes[i]])continue;const float closed=car->Doors[i].RetAngleWhenClosed(),open=car->Doors[i].RetAngleWhenOpen(),span=open-closed;if(fabsf(span)<0.001f)continue;const float ratio=std::max(0.0f,std::min(1.0f,(angles[i]-closed)/span));car->OpenDoor(nodes[i],(eDoors)i,ratio);}}
void doorMatrices(CAutomobile* car){float angles[6];for(int i=0;i<6;i++)angles[i]=car->Doors[i].m_fAngle;applyDoorAngles(car,angles);}
void captureVehicleVisual(CVehicle* car,float* v){v[0]=car->m_fSteerAngle;v[1]=car->m_fGasPedal;v[2]=car->m_fBrakePedal;v[31]=float(car->GetStatus());v[32]=car->bLightsOn;v[33]=car->m_bSirenOrAlarm;if(car->IsCar()){CAutomobile* a=(CAutomobile*)car;for(int j=0;j<4;j++){v[3+j]=a->m_aWheelRotation[j];v[7+j]=a->m_aWheelPosition[j];v[11+j]=a->m_aWheelSpeed[j];v[15+j]=a->m_aSuspensionSpringRatio[j];v[25]+=float(a->Damage.m_wheelStatus[j]<<(j*2));}for(int j=0;j<6;j++){v[19+j]=a->Doors[j].m_fAngle;v[26]+=float(a->Damage.m_doorStatus[j]<<(j*2));}v[27]=float(a->Damage.m_panelStatus&65535);v[28]=float(a->Damage.m_panelStatus>>16);v[29]=float(a->Damage.m_lightStatus);v[30]=float(a->Damage.m_engineStatus);}else if(car->IsBike()){CBike* a=(CBike*)car;for(int j=0;j<2;j++){v[3+j]=a->m_aWheelRotation[j];v[7+j]=a->m_aWheelPosition[j];v[11+j]=a->m_aWheelSpeed[j];v[25]+=float(a->m_wheelStatus[j]<<(j*2));}for(int j=0;j<4;j++)v[15+j]=a->m_aSuspensionSpringRatio[j];v[19]=a->m_fLeanLRAngle;v[20]=a->m_fLeanLRAngle2;}}
void pose(CPed* ped,const float* data) {
    CAnimBlendAssociation* selected[4]={};float full=0,partial=0;
    for(int i=0;i<4;i++) {
        const int j=10+i*5,group=int(data[j]),id=int(data[j+1]);
        if(group<0 || group>=NUM_ANIM_ASSOC_GROUPS || data[j+4]<=0)continue;
        const CAnimBlendAssocGroup& list=CAnimManager::GetAnimAssocGroups()[group];
        if(!list.assocList || id<list.firstAnimId || id-list.firstAnimId>=list.numAssociations)continue;
        CAnimBlendAssociation* a=nil;
        for(CAnimBlendAssociation* p=RpAnimBlendClumpGetFirstAssociation(ped->GetClump());p;p=RpAnimBlendGetNextAssociation(p))if(p->groupId==group && p->animId==id){a=p;break;}
        if(!a)a=CAnimManager::AddAnimation(ped->GetClump(),(AssocGroupId)group,(AnimationId)id);
        if(!a || !a->hierarchy)continue;
        if(std::find(selected,selected+i,a)!=selected+i)continue;
        selected[i]=a;a->blendAmount=data[j+4];a->speed=data[j+3];
        const float length=a->hierarchy->totalLength,time=std::max(0.0f,data[j+2]);
        a->SetCurrentTime(a->IsRepeating() && length>0?fmodf(time,length):std::min(time,std::max(0.0f,length-0.001f)));
        if(a->IsPartial())partial+=a->blendAmount;else full+=a->blendAmount;
    }
    if(full<0.001f){selected[0]=CAnimManager::BlendAnimation(ped->GetClump(),ASSOCGRP_STD,ANIM_STD_IDLE,8);selected[0]->blendAmount=1;full=1;}
    for(CAnimBlendAssociation* p=RpAnimBlendClumpGetFirstAssociation(ped->GetClump());p;p=RpAnimBlendGetNextAssociation(p)) {
        if(std::find(selected,selected+4,p)==selected+4){p->blendAmount=0;p->blendDelta=-8;p->flags|=ASSOC_DELETEFADEDOUT;}
        else {p->blendAmount/=p->IsPartial()?std::max(1.0f,partial):full;p->blendDelta=0;p->flags&=~(ASSOC_FADEOUTWHENDONE|ASSOC_DELETEFADEDOUT);}
    }
}
void remove(Replica& replica) { if(replica.entity){CWorld::Remove(replica.entity);delete replica.entity;replica.entity=nil;} }
void commit() {
    generation=pendingSequence;active=true;
    std::memcpy(environment,pendingEnvironment,sizeof(environment));
    for(const auto& pane:pendingGlass)retainGlass(pane);
    for(const auto& event:pendingExplosions){const float* d=event.data;if(unsigned(d[0])<=lastExplosion)continue;lastExplosion=unsigned(d[0]);CExplosion::AddExplosion(nil,nil,(eExplosionType)int(d[1]),CVector(d[2],d[3],d[4]),unsigned(d[5]),d[6]!=0);}
    for(const EntityState& state:pending) {
        std::map<unsigned,Replica>& map=state.type==21?pedestrians:vehicles;
        Replica& replica=map[state.id];
        if(replica.entity && replica.entity->GetModelIndex()!=int(state.data[0]))remove(replica);
        if(replica.generation)std::memcpy(replica.previous,replica.target,sizeof(replica.target));
        else std::memcpy(replica.previous,state.data,sizeof(replica.previous));
        std::memcpy(replica.target,state.data,sizeof(replica.target));replica.received=CTimer::GetTimeInMilliseconds();replica.generation=generation;
        if(state.hasVisual){std::memcpy(replica.previousVisual,replica.hasVisual?replica.visual:state.visual,sizeof(replica.visual));std::memcpy(replica.visual,state.visual,sizeof(replica.visual));replica.hasVisual=true;}
    }
    const uint32 now=CTimer::GetTimeInMilliseconds();
    for(auto* map:{&pedestrians,&vehicles})for(auto it=map->begin();it!=map->end();) {
        if(it->second.generation!=generation){
            // Complete snapshots can omit entities when an unreliable frame is
            // delayed or an actor briefly falls outside the host's interest set.
            // Keep vehicles and police replicas briefly to avoid visible pop-out.
            const bool keepVisible=(map==&vehicles || (map==&pedestrians && int(it->second.target[1])==PEDTYPE_COP)) && now-it->second.received<2000;
            if(keepVisible){++it;continue;}
            remove(it->second);it=map->erase(it);
        }else ++it;
    }
}
void applyDriverMotion(){
    if(!host()&&!guest())return;
    const uint32 now=CTimer::GetTimeInMilliseconds();
    for(auto it=driverMotions.begin();it!=driverMotions.end();){
        DriverMotion& motion=it->second;
        if(now-motion.received>1200){it=driverMotions.erase(it);continue;}
        CVehicle* car=ViceTogetherWorldFindVehicle(it->first);
        if(!car){it=driverMotions.erase(it);continue;}
        if(car->pDriver==FindPlayerPed()){it=driverMotions.erase(it);continue;}
        if(motion.settled){++it;continue;}
        const float t=std::min(1.0f,float(now-motion.received)/std::max(1u,motion.duration));
        const auto blend=[&](int i){return motion.from[i]+(motion.target[i]-motion.from[i])*t;};
        car->SetPosition(blend(0),blend(1),blend(2));
        CMatrix& matrix=car->GetMatrix();
        CVector right(blend(3),blend(4),blend(5)),forward(blend(6),blend(7),blend(8));
        right.Normalise();forward.Normalise();CVector up=CrossProduct(right,forward);up.Normalise();forward=CrossProduct(up,right);forward.Normalise();
        matrix.GetRight()=right;matrix.GetForward()=forward;matrix.GetUp()=up;
        matrix.UpdateRW();car->UpdateRwFrame();
        if(getenv("VT_TEST_GUEST_DRIVE")||getenv("VT_TEST_CAR"))testDriverMotionFrames++;
        if(t>=1.0f)motion.settled=true;
        ++it;
    }
}
}
extern "C" void VT_SendGlassRequest(const float* state);
void ViceTogetherWorldReset(){
    const bool wasGuest=guest();
    if(wasGuest){
        CPopulation::PedDensityMultiplier=1.0f;CCarCtrl::CarDensityMultiplier=1.0f;
        CVehicle::bAllDodosCheat=false;
        CPlayerPed* player=FindPlayerPed();
        if(player&&player->bInVehicle&&player->m_pMyVehicle){CVehicle* car=player->m_pMyVehicle;const CVector exit=car->GetPosition()+car->GetRight()*2.0f;if(car->pDriver==player)car->RemoveDriver();else car->RemovePassenger(player);player->m_pMyVehicle=nil;player->bInVehicle=false;player->bUsesCollision=true;player->ClearObjective();player->SetIdle();player->Teleport(exit);}
    }
    for(auto* map:{&pedestrians,&vehicles}){for(auto& entry:*map)remove(entry.second);map->clear();}
    pedShotHistory.clear();priorityPeds.clear();delegatedVehicles.clear();driverMotions.clear();testDriverMotionFrames=testDriverMotionPackets=0;pending.clear();glass.clear();pendingGlass.clear();explosions.clear();pendingExplosions.clear();receiving=active=false;pendingSequence=expected=expectedGlass=expectedExplosions=0;
    if(wasGuest)generation=lastExplosion=0;
}
const char* ViceTogetherWorldMenuStatus(){return menuStatus;}
void ViceTogetherWorldMenuAction(int action){
    if(guest()){menuStatus="Only the host changes the shared world";return;}
    CPlayerPed* player=FindPlayerPed();if(!player||!player->m_rwObject||player->DyingOrDead())return;
    if(action==2006){const CVector p=player->GetPosition();ViceTogetherWorldNearbyBigBang(p.x,p.y,p.z);return;}
    if(action>=2000){if(action==2000)CClock::SetGameClock(9,0);else if(action==2001)CClock::SetGameClock(22,0);else if(action==2002)CWeather::ForceWeatherNow(WEATHER_SUNNY);else if(action==2003)CWeather::ForceWeatherNow(WEATHER_RAINY);else if(action==2004)player->SetWantedLevel(0);else if(action==2005){for(auto& car:menuSpawned){if(!car||car->pDriver)continue;bool occupied=false;for(int seat=0;seat<8;seat++)if(car->pPassengers[seat])occupied=true;if(!occupied){CWorld::Remove(car);delete car;car=nil;}}}menuStatus="Applied";return;}
    const int model=action-1000;if(!allowedVehicle(model))return;
    if(menuSpawnModel>=0 || menuLastSpawn && CTimer::GetTimeInMilliseconds()-menuLastSpawn<3000){menuStatus="Wait a moment before spawning another vehicle";return;}
    menuSpawnHasPosition=false;menuSpawnModel=model;menuSpawnTime=CTimer::GetTimeInMilliseconds();CStreaming::RequestModel(model,STREAMFLAGS_DONT_REMOVE);menuStatus="Loading vehicle...";
}
extern "C" void VT_SendVehicleSpawnRequest(int model);
void ViceTogetherWorldRequestVehicle(int model){if(!guest()||!allowedVehicle(model)){menuStatus="This vehicle cannot be requested";return;}VT_SendVehicleSpawnRequest(model);menuStatus="Vehicle request sent to host...";}
void ViceTogetherWorldSpawnVehicle(int model,float x,float y,float z,float heading){
    if(!host()||!allowedVehicle(model)||!std::isfinite(x)||!std::isfinite(y)||!std::isfinite(z)||!std::isfinite(heading)||fabsf(x)>=10000||fabsf(y)>=10000||fabsf(z)>=3000)return;
    if(menuSpawnModel>=0||menuLastSpawn&&CTimer::GetTimeInMilliseconds()-menuLastSpawn<3000){menuStatus="Wait a moment before spawning another vehicle";return;}
    menuSpawnModel=model;menuSpawnHasPosition=true;menuSpawnPosition=CVector(x,y,z);menuSpawnHeading=heading;menuSpawnTime=CTimer::GetTimeInMilliseconds();CStreaming::RequestModel(model,STREAMFLAGS_DONT_REMOVE);menuStatus="Preparing guest vehicle...";
}
bool ViceTogetherWorldToggleFlyCheat(){
    if(!host())return false;
    CVehicle::bAllDodosCheat=!CVehicle::bAllDodosCheat;
    CHud::SetHelpMessage(TheText.Get(CVehicle::bAllDodosCheat?"CHEAT1":"CHEATOF"),true);
    return true;
}
bool ViceTogetherWorldNearbyBigBang(float x,float y,float z){
    if(!host()||!std::isfinite(x)||!std::isfinite(y)||!std::isfinite(z)||fabsf(x)>=10000||fabsf(y)>=10000||fabsf(z)>=3000)return false;
    constexpr float radius=35.0f;const CVector center(x,y,z);std::vector<CVehicle*> targets;auto* pool=CPools::GetVehiclePool();
    for(int i=0;i<pool->GetSize();i++){CVehicle* car=pool->GetSlot(i);if(!car||!car->m_rwObject||car->m_fHealth<=0||car->GetStatus()==STATUS_WRECKED||car->bRenderScorched)continue;if((car->GetPosition()-center).MagnitudeSqr()<=radius*radius)targets.push_back(car);}
    CPlayerPed* cause=FindPlayerPed();for(CVehicle* car:targets)car->BlowUpCar(cause);
    menuStatus=targets.empty()?"No vehicles within 35 m":"Nearby vehicles exploded";return !targets.empty();
}
void ViceTogetherWorldMenuTick(){
    if(menuSpawnModel<0)return;const uint32 now=CTimer::GetTimeInMilliseconds();if(guest()||now-menuSpawnTime>15000){menuSpawnModel=-1;menuStatus="Vehicle loading failed";return;}
    if(!CStreaming::HasModelLoaded(menuSpawnModel))return;CPlayerPed* player=FindPlayerPed();if(!player||!player->m_rwObject)return;
    int slot=-1;for(int i=0;i<8;i++)if(!menuSpawned[i]){slot=i;break;}if(slot<0){menuSpawnModel=-1;menuStatus="Eight spawned vehicles already exist";return;}
    const int model=menuSpawnModel;const float spawnAhead=(model==155||model==217)?15.0f:6.0f;CVector position=menuSpawnHasPosition?menuSpawnPosition:player->GetPosition()+player->GetForward()*spawnAhead;const float heading=menuSpawnHasPosition?menuSpawnHeading:player->m_fRotationCur;const bool boat=CModelInfo::IsBoatModel(model);float water=0;
    if(boat){if(!CWaterLevel::GetWaterLevel(position.x,position.y,position.z,&water,true)){menuSpawnModel=-1;menuStatus="Move beside open water to spawn a boat / Skimmer";return;}position.z=water+0.5f;}
    else {bool found=false;const float ground=CWorld::FindGroundZFor3DCoord(position.x,position.y,position.z+10,&found);if(found)position.z=ground+1.0f;else {const float searchRadius=menuSpawnHasPosition?60.0f:40.0f;const int road=ThePaths.FindNodeClosestToCoors(position,PATH_CAR,searchRadius);if(road<0){menuSpawnModel=-1;menuStatus="Could not find safe ground nearby. Move to an open area and try again.";return;}position=ThePaths.m_pathNodes[road].GetPosition()+CVector(0,0,1);}}
    CVehicle* car=createMultiplayerVehicle(model);if(!car){menuSpawnModel=-1;menuStatus="This vehicle type is not supported yet";return;}
    car->m_fHealth=1000.0f;car->SetPosition(position);car->SetHeading(heading);car->SetStatus(STATUS_ABANDONED);car->SetMoveSpeed(0,0,0);car->bEngineOn=false;CWorld::Add(car);trackNetworkHeli(car);menuSpawned[slot]=car;car->RegisterReference((CEntity**)&menuSpawned[slot]);menuLastSpawn=now;menuSpawnModel=-1;menuSpawnHasPosition=false;menuStatus="Spawned nearby - F: drive / G: passenger";
}
void ViceTogetherWorldExplosion(CEntity* victim,int type,const CVector& pos,unsigned lifetime,bool sound){if(!host() || (victim && victim->IsVehicle()))return;ExplosionState event={};event.time=CTimer::GetTimeInMilliseconds();event.data[0]=float(++explosionSequence);event.data[1]=float(type);event.data[2]=pos.x;event.data[3]=pos.y;event.data[4]=pos.z;event.data[5]=float(lifetime);event.data[6]=sound?1:0;if(explosions.size()>=32)explosions.erase(explosions.begin());explosions.push_back(event);}
void ViceTogetherWorldGlass(CEntity* entity,float amount,const CVector& speed,const CVector& point,bool explosion,bool broken){if(replayingGlass || !entity || !entity->IsObject() || !IsGlass(entity->GetModelIndex()))return;GlassState pane={};float* d=pane.data;d[0]=entity->GetModelIndex();d[1]=broken?2:1;const CVector pos=entity->GetPosition();d[2]=pos.x;d[3]=pos.y;d[4]=pos.z;d[5]=speed.x;d[6]=speed.y;d[7]=speed.z;d[8]=point.x;d[9]=point.y;d[10]=point.z;d[11]=std::max(0.0f,std::min(10000.0f,amount));d[12]=explosion?1:0;if(host())retainGlass(pane);else if(guest())VT_SendGlassRequest(d);}
void ViceTogetherWorldGlassRequest(const float* d){if(!host())return;for(int i=0;i<13;i++)if(!std::isfinite(d[i]))return;if(d[0]<0 || d[0]>=6500 || !IsGlass(int(d[0])) || (d[1]!=1 && d[1]!=2) || fabsf(d[2])>=10000 || fabsf(d[3])>=10000 || fabsf(d[4])>=3000)return;auto* objects=CPools::GetObjectPool();for(int i=0;i<objects->GetSize();i++){CObject* object=objects->GetSlot(i);if(!object)continue;float key[34]={};key[0]=object->GetModelIndex();const CVector pos=object->GetPosition();key[2]=pos.x;key[3]=pos.y;key[4]=pos.z;if(!sameGlass(key,d))continue;applyGlass(object,d);GlassState pane={};std::memcpy(pane.data,d,sizeof(pane.data));retainGlass(pane);return;}}
bool ViceTogetherWorldPed(const CPed* ped) { for(const auto& entry:pedestrians)if(entry.second.entity==ped)return true;return false; }
int ViceTogetherWorldPedId(const CPed* ped) { for(const auto& entry:pedestrians)if(entry.second.entity==ped)return int(entry.first);return -1; }
bool ViceTogetherWorldHostPed(unsigned id,CPed** out) {
    if(!host() || !out || id>=16777216)return false;
    const auto history=pedShotHistory.find(id);
    if(history==pedShotHistory.end() || history->second.empty())return false;
    const uint32 now=CTimer::GetTimeInMilliseconds();
    if(now-history->second.back().time>450)return false;
    CPed* ped=CPools::GetPed(int(id));
    if(!ped || CPools::GetPedRef(ped)!=int(id) || ped->IsPlayer() || ViceTogetherIsRemote(ped) || ped->DyingOrDead() || !ped->m_rwObject)return false;
    *out=ped;return true;
}
void ViceTogetherWorldPrioritizePed(unsigned id){if(host() && id<16777216)priorityPeds[id]=CTimer::GetTimeInMilliseconds()+2500;}
bool ViceTogetherWorldResolveShotPed(const CVector& source,const CVector& end,CEntity* shooter,CPed** target,CVector* hitPoint) {
    if(!host() || !target || !hitPoint)return false;
    const float dx=end.x-source.x,dy=end.y-source.y,dz=end.z-source.z;
    const float horizontalSqr=dx*dx+dy*dy;
    if(horizontalSqr<0.01f)return false;
    const uint32 now=CTimer::GetTimeInMilliseconds();
    float bestT=2.0f;CPed* bestPed=nil;CVector bestPoint;
    for(auto it=pedShotHistory.begin();it!=pedShotHistory.end();) {
        CPed* ped=CPools::GetPed(int(it->first));
        if(!ped || CPools::GetPedRef(ped)!=int(it->first) || ped->IsPlayer() || ViceTogetherIsRemote(ped) || ped->DyingOrDead() || !ped->m_rwObject) {it=pedShotHistory.erase(it);continue;}
        auto& samples=it->second;
        while(!samples.empty() && now-samples.front().time>550)samples.pop_front();
        if(samples.empty() || ped->GetModelIndex()!=samples.front().model) {it=pedShotHistory.erase(it);continue;}
        for(const PedShotSample& sample:samples) {
            if(now-sample.time>450 || sample.model!=ped->GetModelIndex())continue;
            const float t=((sample.position.x-source.x)*dx+(sample.position.y-source.y)*dy)/horizontalSqr;
            if(t<0.0f || t>1.0f || t>=bestT)continue;
            const float x=source.x+dx*t,y=source.y+dy*t,z=source.z+dz*t;
            const float lateralSqr=(sample.position.x-x)*(sample.position.x-x)+(sample.position.y-y)*(sample.position.y-y);
            if(lateralSqr>0.48f*0.48f || z<sample.position.z+0.12f || z>sample.position.z+1.78f)continue;
            CColPoint obstructionPoint={};CEntity* obstruction=nil;CEntity* oldIgnore=CWorld::pIgnoreEntity;CWorld::pIgnoreEntity=shooter;
            const bool blocked=CWorld::ProcessLineOfSight(source,CVector(x,y,z),obstructionPoint,obstruction,true,true,false,true,true,false);
            CWorld::pIgnoreEntity=oldIgnore;
            if(blocked && obstruction && (obstructionPoint.point-source).MagnitudeSqr()+0.25f<(CVector(x,y,z)-source).MagnitudeSqr())continue;
            bestT=t;bestPed=ped;bestPoint=CVector(x,y,z);
        }
        ++it;
    }
    if(!bestPed)return false;
    *target=bestPed;*hitPoint=bestPoint;return true;
}
void ViceTogetherWorldStatus(float* out) {
    out[15]=0;auto* wreckPool=CPools::GetVehiclePool();for(int i=0;i<wreckPool->GetSize();i++){CVehicle* car=wreckPool->GetSlot(i);if(car&&car->GetStatus()==STATUS_WRECKED)out[15]++;}
    out[0]=float(generation);out[1]=float(pedestrians.size());out[2]=float(vehicles.size());out[3]=out[4]=0;
    for(const auto& entry:pedestrians)if(entry.second.entity)out[3]++;
    for(const auto& entry:vehicles)if(entry.second.entity)out[4]++;
    out[5]=CWeather::Rain;out[6]=CWeather::WetRoads;out[7]=CWeather::OldWeatherType;out[8]=CWeather::NewWeatherType;out[9]=CClock::GetHours();out[10]=CClock::GetMinutes();
    out[11]=float(glass.size());out[12]=out[13]=0;auto* objects=CPools::GetObjectPool();for(int i=0;i<objects->GetSize();i++){CObject* object=objects->GetSlot(i);if(object && IsGlass(object->GetModelIndex())){if(object->bGlassBroken && !object->bIsVisible && !object->bUsesCollision)out[12]++;else if(object->bGlassCracked)out[13]++;}}out[14]=float(host()?explosionSequence:lastExplosion);
    out[16]=out[17]=0;auto* pedPool=CPools::GetPedPool();for(int i=0;i<pedPool->GetSize();i++){CPed* ped=pedPool->GetSlot(i);if(ped && !ped->IsPlayer() && !ViceTogetherIsRemote(ped) && !ViceTogetherWorldPed(ped) && ped->CharCreatedBy==RANDOM_CHAR)out[16]++;}auto* carPool=CPools::GetVehiclePool();for(int i=0;i<carPool->GetSize();i++){CVehicle* car=carPool->GetSlot(i);if(car && car->VehicleCreatedBy==RANDOM_VEHICLE)out[17]++;}out[18]=guestOwnsNearbyPopulation()?1.0f:0.0f;
    if(getenv("VT_TEST_GUEST_NPC_MELEE")){out[19]=float(testMeleeStage);out[20]=float(testMeleeTarget);out[21]=testMeleeLocalDistance;out[22]=testMeleeRemoteDistance;}
    if(getenv("VT_TEST_GUEST_DRIVE")||getenv("VT_TEST_CAR")){CPlayerPed* player=FindPlayerPed();out[19]=float(testSeatGrantStatus);out[20]=player?float(player->GetPedState()):-1;out[21]=player?float(player->m_objective):-1;out[22]=player&&player->bInVehicle&&player->m_pMyVehicle?float(ViceTogetherWorldVehicleId(player->m_pMyVehicle)):-1;out[23]=float(testSeatGrantCalls);out[24]=float(testSeatGrantModel);out[25]=float(testSeatGrantSeat);out[26]=player&&player->m_carInObjective?float(player->m_carInObjective->GetModelIndex()):-1;out[27]=testHostExitSpeed;out[28]=testHostExitWithDriver?1.0f:0.0f;out[29]=host()&&testHostExitSpeed>=0?1.0f:0.0f;out[30]=float(testDriverMotionFrames);out[31]=float(testDriverMotionPackets);out[32]=0.0f;out[33]=0.0f;auto* pool=CPools::GetVehiclePool();for(int i=0;i<pool->GetSize();i++){CVehicle* car=pool->GetSlot(i);if(car&&car->IsHeli()&&car->GetModelIndex()==217){out[32]=((CHeli*)car)->m_fRotorRotation;out[33]=217.0f;break;}}}
}
bool ViceTogetherWorldVehicle(const CVehicle* car) {
    if(host()){if(const_cast<CVehicle*>(car)->IsHeli() && car->pDriver!=FindPlayerPed() && std::find(networkHelis,networkHelis+16,car)!=networkHelis+16)return true;auto it=delegatedVehicles.find(unsigned(CPools::GetVehicleRef((CVehicle*)car)));return it!=delegatedVehicles.end() && CTimer::GetTimeInMilliseconds()-it->second<750;}
    for(const auto& entry:vehicles)if(entry.second.entity==car)return !(car->pDriver==FindPlayerPed() && FindPlayerPed()->bInVehicle);return false;
}
CVehicle* ViceTogetherWorldFindVehicle(unsigned id){if(host())return CPools::GetVehicle(int(id));auto found=vehicles.find(id);return found==vehicles.end()?nil:(CVehicle*)found->second.entity;}
int ViceTogetherWorldVehicleId(CVehicle* vehicle){if(host())return CPools::GetVehicleRef(vehicle);for(const auto& entry:vehicles)if(entry.second.entity==vehicle)return int(entry.first);return -1;}
extern "C" void VT_SendSeatRequest(unsigned id);
extern "C" void VT_SendDriverRequest(unsigned id);
bool ViceTogetherGuestOnFoot(){return guest() && FindPlayerPed() && !FindPlayerPed()->bInVehicle;}
void ViceTogetherRequestPassenger(){if((!guest()&&!host()) || !FindPlayerPed() || FindPlayerPed()->bInVehicle)return;float best=64;unsigned id=0;bool found=false;auto* cars=CPools::GetVehiclePool();for(int i=0;i<cars->GetSize();i++){CVehicle* car=cars->GetSlot(i);if(!car)continue;const int carId=ViceTogetherWorldVehicleId(car);if(carId<0)continue;const float distance=(car->GetPosition()-FindPlayerPed()->GetPosition()).MagnitudeSqr();if(distance<best){best=distance;id=unsigned(carId);found=true;}}if(found)VT_SendSeatRequest(id);}
void ViceTogetherRequestDriver(){if(!guest() || !FindPlayerPed() || FindPlayerPed()->bInVehicle)return;float best=64;unsigned id=0;bool found=false;for(const auto& entry:vehicles)if(entry.second.entity && !((CVehicle*)entry.second.entity)->pDriver){const float distance=(entry.second.entity->GetPosition()-FindPlayerPed()->GetPosition()).MagnitudeSqr();if(distance<best){best=distance;id=entry.first;found=true;}}if(found)VT_SendDriverRequest(id);}
void ViceTogetherGrantPassenger(unsigned id,int seat){
    if(getenv("VT_TEST_GUEST_DRIVE")){testSeatGrantStatus=1;testSeatGrantCalls++;testSeatGrantModel=-1;testSeatGrantSeat=seat;}
    if((!guest()&&!host()) || seat< -1 || seat>=8){if(getenv("VT_TEST_GUEST_DRIVE"))testSeatGrantStatus=2;return;}
    CPlayerPed* player=FindPlayerPed();
    CVehicle* car=ViceTogetherWorldFindVehicle(id);
    if(getenv("VT_TEST_GUEST_DRIVE")&&car)testSeatGrantModel=car->GetModelIndex();
    if(!player || !car || player->bInVehicle || car->m_fHealth<=0 || car->GetStatus()==STATUS_WRECKED || car->bRenderScorched){if(getenv("VT_TEST_GUEST_DRIVE"))testSeatGrantStatus=!player?3:!car?4:player->bInVehicle?5:6;return;}
    // A grant can be repeated while a player is still walking to the door.
    // Keep the existing stock entry task instead of restarting it every packet.
    if((player->EnteringCar() || player->m_objective==OBJECTIVE_ENTER_CAR_AS_DRIVER || player->m_objective==OBJECTIVE_ENTER_CAR_AS_PASSENGER) && player->m_carInObjective==car){if(getenv("VT_TEST_GUEST_DRIVE"))testSeatGrantStatus=7;return;}
    if(seat==-1){
        if(car->pDriver && car->pDriver!=player){if(getenv("VT_TEST_GUEST_DRIVE"))testSeatGrantStatus=8;return;}
        if(car->IsBoat()){
            // Vice City boards boats through SetEnterCar; the generic enter-car
            // objective does not run the boat's stock access animation/task.
            player->m_vehDoor=0;
            player->SetEnterCar(car,player->m_vehDoor);
            if(getenv("VT_TEST_GUEST_DRIVE"))testSeatGrantStatus=12;
            return;
        }
        // Vice City's native objective handles walking to the driver's door,
        // door interaction, entry animation, and seat attachment.
        player->SetObjective(OBJECTIVE_ENTER_CAR_AS_DRIVER,car);
        if(getenv("VT_TEST_GUEST_DRIVE"))testSeatGrantStatus=9;
        return;
    }
    if(seat>=car->m_nNumMaxPassengers || (car->pPassengers[seat] && car->pPassengers[seat]!=player)){if(getenv("VT_TEST_GUEST_DRIVE"))testSeatGrantStatus=10;return;}
    if(car->IsHeli()){
        // Helicopter cockpits have no ordinary door geometry for SeekCar's
        // pathfinder to approach. Once the player is already beside the
        // cockpit, start the stock align/enter animation directly instead of
        // leaving the native passenger objective circling forever. This is
        // still the game's animated entry sequence; it does not warp the ped
        // into a seat. At longer distances retain the normal walk-to-vehicle
        // objective.
        CVector cockpitAccess;
        if(player->GetNearestPassengerDoor(car,cockpitAccess) &&
           (cockpitAccess-player->GetPosition()).MagnitudeSqr() <= 16.0f){
            player->SetObjective(OBJECTIVE_ENTER_CAR_AS_PASSENGER,car);
            player->SetEnterCar(car,player->m_vehDoor);
            if(getenv("VT_TEST_GUEST_DRIVE"))testSeatGrantStatus=13;
            return;
        }
    }
    // Do not WarpPedIntoCar or edit pPassengers here. The stock objective
    // selects an available passenger seat and runs the game's entry sequence.
    player->SetObjective(OBJECTIVE_ENTER_CAR_AS_PASSENGER,car);
    if(getenv("VT_TEST_GUEST_DRIVE"))testSeatGrantStatus=11;
}
void ViceTogetherCaptureDriver(VTWorldSender send){if(!host()&&!guest())return;CPlayerPed* p=FindPlayerPed();if(!p||!p->m_pMyVehicle)return;CVehicle* car=p->m_pMyVehicle;const bool driver=car->pDriver==p;bool occupant=driver;for(int i=0;i<8&&!occupant;i++)occupant=car->pPassengers[i]==p;if(!occupant)return;const int id=ViceTogetherWorldVehicleId(car);if(id<0)return;
    // Entry and exit door animations happen while bInVehicle is still false.
    // Send only cosmetic angles; the host authorizes this update against the
    // sender's live seat claim before applying the stock door animation.
    if(car->IsCar()){CAutomobile* a=(CAutomobile*)car;float doors[34]={};bool changed=false;static unsigned lastDoorId=~0u;static float lastDoorAngles[6]={};static uint32 lastDoorSent=0;const uint32 now=CTimer::GetTimeInMilliseconds();for(int j=0;j<6;j++){doors[j]=a->Doors[j].m_fAngle;if(lastDoorId!=unsigned(id)||fabsf(doors[j]-lastDoorAngles[j])>0.025f)changed=true;}if(changed||now-lastDoorSent>=250){send(62,unsigned(id),doors);lastDoorId=unsigned(id);for(int j=0;j<6;j++)lastDoorAngles[j]=doors[j];lastDoorSent=now;}}
    if(!driver||!p->bInVehicle)return;float d[34]={},visual[34]={};d[0]=car->GetModelIndex();d[1]=car->IsBike()?1:car->IsBoat()?2:car->IsHeli()?3:car->IsPlane()?4:0;const CVector pos=car->GetPosition();d[2]=pos.x;d[3]=pos.y;d[4]=pos.z;const CMatrix& m=car->GetMatrix();const CVector basis[]={m.GetRight(),m.GetForward(),m.GetUp(),car->GetMoveSpeed()};for(int j=0;j<4;j++){d[5+j*3]=basis[j].x;d[6+j*3]=basis[j].y;d[7+j*3]=basis[j].z;}const CVector turn=car->m_vecTurnSpeed;d[23]=turn.x;d[24]=turn.y;d[25]=turn.z;d[17]=car->m_fHealth;d[18]=car->m_fGasPedal;d[19]=float(car->GetStatus());d[20]=car->pDriver->IsPlayer()?1:0;d[21]=float(CPad::GetPad(0)->GetAccelerate());d[22]=float(CPad::GetPad(0)->DisablePlayerControls);captureVehicleVisual(car,visual);send(60,unsigned(id),visual);send(43,unsigned(id),d);}
void ViceTogetherApplyDriver(unsigned id,const float* d){
    if(!host()&&!guest())return;
    CVehicle* car=ViceTogetherWorldFindVehicle(id);
    if(!car||car->GetModelIndex()!=int(d[0]))return;
    // The JS host has already checked the exclusive driver claim and movement
    // bounds. During stock enter/exit tasks the remote ped can briefly be
    // detached from pDriver, so a null driver is valid here. Never overwrite
    // a locally driven car or one driven by an unrelated occupant.
    if(host()&&car->pDriver&&(car->pDriver==FindPlayerPed()||!ViceTogetherIsRemote(car->pDriver)))return;
    if(guest()&&car->pDriver==FindPlayerPed())return;
    for(int i=0;i<26;i++)if(!std::isfinite(d[i]))return;
    if(d[20]!=1||d[17]<0||d[17]>1000||d[19]<0||d[19]>5||floorf(d[19])!=d[19])return;
    if(fabsf(d[23])>5||fabsf(d[24])>5||fabsf(d[25])>5)return;
    if(car->GetStatus()==STATUS_WRECKED)return;
    DriverMotion& motion=driverMotions[id];const uint32 now=CTimer::GetTimeInMilliseconds();
    const CVector position=car->GetPosition();const CMatrix& current=car->GetMatrix();const CVector basis[]={current.GetRight(),current.GetForward(),current.GetUp()};
    CWorld::Remove(car);
    motion.from[0]=position.x;motion.from[1]=position.y;motion.from[2]=position.z;
    for(int j=0;j<3;j++){motion.from[3+j*3]=basis[j].x;motion.from[4+j*3]=basis[j].y;motion.from[5+j*3]=basis[j].z;}
    for(int j=0;j<12;j++)motion.target[j]=d[2+j];
    const uint32 interval=motion.initialized?now-motion.received:16;motion.duration=std::max(8u,std::min(50u,interval));motion.received=now;motion.initialized=true;motion.settled=false;
    car->SetMoveSpeed(d[14],d[15],d[16]);car->m_vecTurnSpeed=CVector(d[23],d[24],d[25]);car->m_fHealth=std::min(car->m_fHealth,d[17]);car->m_fGasPedal=d[18];const bool remoteWreck=d[19]==STATUS_WRECKED||car->m_fHealth<=0;car->SetStatus(STATUS_PHYSICS);car->bEngineOn=true;if(remoteWreck){if(!car->bRenderScorched){car->m_fHealth=std::max(1.0f,car->m_fHealth);car->BlowUpCar(nil);car->bRenderScorched=true;}car->SetStatus(STATUS_WRECKED);car->bEngineOn=false;car->m_fHealth=std::min(car->m_fHealth,d[17]);}if(car->IsBike())((CBike*)car)->bLeanMatrixClean=false;CWorld::Add(car);delegatedVehicles[id]=now;if(getenv("VT_TEST_GUEST_DRIVE")||getenv("VT_TEST_CAR"))testDriverMotionPackets++;
}
void ViceTogetherApplyDriverVisual(unsigned id,const float* v){
    if(!host()&&!guest())return;
    CVehicle* car=ViceTogetherWorldFindVehicle(id);
    if(!car||(host()&&car->pDriver&&(car->pDriver==FindPlayerPed()||!ViceTogetherIsRemote(car->pDriver)))||(guest()&&car->pDriver==FindPlayerPed()))return;
    for(int i=0;i<34;i++)if(!std::isfinite(v[i]))return;
    if(v[25]<0||v[25]>255||floorf(v[25])!=v[25]||v[26]<0||v[26]>4095||floorf(v[26])!=v[26]||v[27]<0||v[27]>65535||floorf(v[27])!=v[27]||v[28]<0||v[28]>65535||floorf(v[28])!=v[28]||v[29]<0||v[29]>65535||floorf(v[29])!=v[29]||v[30]<0||v[30]>255||floorf(v[30])!=v[30]||v[31]<0||v[31]>STATUS_WRECKED||floorf(v[31])!=v[31]||(v[32]!=0&&v[32]!=1)||(v[33]!=0&&v[33]!=1))return;
    // Once either motion or visual state reports a wreck, the cosmetic packet
    // must not restore STATUS_PHYSICS after the stock explosion was applied.
    const bool wrecked=car->GetStatus()==STATUS_WRECKED||car->m_fHealth<=0||v[31]==STATUS_WRECKED;
    car->m_fSteerAngle=v[0];car->m_fGasPedal=v[1];car->m_fBrakePedal=v[2];car->bLightsOn=v[32]!=0;car->m_bSirenOrAlarm=v[33]!=0;
    if(car->IsCar()){
        CAutomobile* a=(CAutomobile*)car;
        for(int j=0;j<4;j++){a->m_aWheelRotation[j]=v[3+j];a->m_aWheelPosition[j]=v[7+j];a->m_aWheelSpeed[j]=v[11+j];a->m_aSuspensionSpringRatio[j]=v[15+j];a->Damage.m_wheelStatus[j]=(unsigned(v[25])>>(j*2))&3;}
        for(int j=0;j<6;j++){const uint8 damage=(unsigned(v[26])>>(j*2))&3;if(a->Damage.m_doorStatus[j]!=damage){a->Damage.m_doorStatus[j]=damage;const int nodes[]={CAR_BONNET,CAR_BOOT,CAR_DOOR_LF,CAR_DOOR_RF,CAR_DOOR_LR,CAR_DOOR_RR};a->SetDoorDamage(nodes[j],(eDoors)j,true);}}applyDoorAngles(a,v+19);
        a->Damage.m_lightStatus=unsigned(v[29]);a->Damage.m_engineStatus=uint8(v[30]);const unsigned panels=unsigned(v[27])|(unsigned(v[28])<<16);
        if(a->Damage.m_panelStatus!=panels){a->Damage.m_panelStatus=panels;const int nodes[]={CAR_WING_LF,CAR_WING_RF,CAR_WING_LR,CAR_WING_RR,CAR_WINDSCREEN,CAR_BUMP_FRONT,CAR_BUMP_REAR};for(int j=0;j<7;j++)a->SetPanelDamage(nodes[j],(ePanels)j,true);}
        doorMatrices(a);
    }else if(car->IsBike()){
        CBike* a=(CBike*)car;
        for(int j=0;j<2;j++){a->m_aWheelRotation[j]=v[3+j];a->m_aWheelPosition[j]=v[7+j];a->m_aWheelSpeed[j]=v[11+j];a->m_wheelStatus[j]=(unsigned(v[25])>>(j*2))&3;}
        for(int j=0;j<4;j++)a->m_aSuspensionSpringRatio[j]=v[15+j];
        a->m_fLeanLRAngle=v[19];a->m_fLeanLRAngle2=v[20];a->bLeanMatrixClean=false;
    }
    if(wrecked){if(!car->bRenderScorched){car->m_fHealth=std::max(1.0f,car->m_fHealth);car->BlowUpCar(nil);car->bRenderScorched=true;}car->SetStatus(STATUS_WRECKED);car->bEngineOn=false;}
    else car->SetStatus(unsigned(v[31]));
    car->GetMatrix().UpdateRW();car->UpdateRwFrame();
}
extern "C" int VT_ReadRemoteVehicle(int slot);
extern "C" int VT_ReadRemote(int slot,float* out);
extern "C" int VT_ReadRemoteSkeleton(int slot,float* out);
void ViceTogetherWorldTestDrive(){CPlayerPed* player=FindPlayerPed();if(!player)return;CPad* pad=CPad::GetPad(0);pad->NewState.Clear();
    if(getenv("VT_TEST_GUEST_DRIVE")) {
        static int warmup=0;if(++warmup<500 || !player->m_rwObject)return;
        const int model=getenv("VT_TEST_VEHICLE")?atoi(getenv("VT_TEST_VEHICLE")):130;
        if(model!=130 && model!=176 && model!=182 && model!=190 && model!=191 && model!=203 && model!=217)return;
        static CVehicle* testCar=nil;static CVehicle* testBarrier=nil;static uint32 last=0,started=0,guestBoardedAt=0,hostBoardedAt=0,guestExitAt=0,hostExitAt=0;static bool guestPositioned=false,guestDriverRequestSent=false,guestExitSent=false,guestExited=false,hostExitSent=false,hostExited=false,hostPassengerRequested=false;static CVector boatApproach;static bool boatApproachFound=false;const uint32 now=CTimer::GetTimeInMilliseconds();if(!started)started=now;
        if(host()){
            if(!testCar){
                CStreaming::RequestModel(model,STREAMFLAGS_DONT_REMOVE);if(!CStreaming::HasModelLoaded(model))return;
                const int road=ThePaths.FindNodeClosestToCoors(player->GetPosition(),PATH_CAR,100.0f);CVector location=player->GetPosition()+CVector(8,0,0);float heading=player->m_fRotationCur;
                if(CModelInfo::IsBoatModel(model)){
                    bool found=false;for(int radius=20;radius<=800&&!found;radius+=20)for(int angle=0;angle<16;angle++){const float a=angle*6.2831853f/16;CVector candidate=player->GetPosition()+CVector(cosf(a)*radius,sinf(a)*radius,0);float water;bool groundFound=false;const float ground=CWorld::FindGroundZFor3DCoord(candidate.x,candidate.y,100,&groundFound);if(CWaterLevel::GetWaterLevel(candidate.x,candidate.y,candidate.z,&water,true)&&(!groundFound || ground<water+0.1f)){location=CVector(candidate.x,candidate.y,water+0.5f);heading=a;found=true;break;}}if(!found)return;
                    // A Vice City player cannot walk on open water. Keep the
                    // automated boat test on the nearest dry shoreline so both
                    // native clients can use the stock boarding approach.
                    for(int radius=3;radius<=10&&!boatApproachFound;radius++)for(int angle=0;angle<32;angle++){const float a=angle*6.2831853f/32;const float x=location.x+cosf(a)*radius,y=location.y+sinf(a)*radius;bool dryGroundFound=false;const float dryGround=CWorld::FindGroundZFor3DCoord(x,y,100,&dryGroundFound);float nearbyWater=0;const bool wet=CWaterLevel::GetWaterLevel(x,y,location.z,&nearbyWater,true);if(dryGroundFound&&(!wet||dryGround>nearbyWater+0.65f)){boatApproach=CVector(x,y,dryGround+0.5f);boatApproachFound=true;break;}}if(!boatApproachFound)return;
                    testCar=new CBoat(model,MISSION_VEHICLE);
                }else{if(road>=0){const CVector roadPosition=ThePaths.m_pathNodes[road].GetPosition();if((roadPosition-player->GetPosition()).MagnitudeSqr()<900.0f){location=roadPosition+CVector(0,0,1);if(ThePaths.m_pathNodes[road].numLinks){const CVector direction=ThePaths.m_pathNodes[ThePaths.ConnectedNode(ThePaths.m_pathNodes[road].firstLink)].GetPosition()-location;heading=atan2f(-direction.x,direction.y);}}else{const CVector candidate=player->GetPosition()+CVector(8,0,0);bool groundFound=false;const float ground=CWorld::FindGroundZFor3DCoord(candidate.x,candidate.y,candidate.z+10,&groundFound);if(!groundFound)return;location=CVector(candidate.x,candidate.y,ground+0.5f);}}else{const CVector candidate=player->GetPosition()+CVector(8,0,0);bool groundFound=false;const float ground=CWorld::FindGroundZFor3DCoord(candidate.x,candidate.y,candidate.z+10,&groundFound);if(!groundFound)return;location=CVector(candidate.x,candidate.y,ground+0.5f);}testCar=createMultiplayerVehicle(model);if(!testCar)return;}
                testCar->RegisterReference((CEntity**)&testCar);testCar->m_fHealth=1000.0f;testCar->SetPosition(location);testCar->SetHeading(heading);player->Teleport(testCar->IsBoat()?boatApproach:location+testCar->GetRight()*3.0f);testCar->SetStatus(STATUS_ABANDONED);testCar->SetMoveSpeed(0,0,0);CWorld::Add(testCar);trackNetworkHeli(testCar);
            }
            if(getenv("VT_TEST_VEHICLE_COLLISION") && model==130 && !testBarrier){CStreaming::RequestModel(135,STREAMFLAGS_DONT_REMOVE);if(!CStreaming::HasModelLoaded(135))return;testBarrier=createMultiplayerVehicle(135);if(testBarrier){const CVector forward=testCar->GetForward();testBarrier->RegisterReference((CEntity**)&testBarrier);testBarrier->m_fHealth=1000.0f;testBarrier->SetPosition(testCar->GetPosition()+forward*45.0f);testBarrier->SetHeading(atan2f(-forward.x,forward.y));testBarrier->SetStatus(STATUS_ABANDONED);testBarrier->SetMoveSpeed(0,0,0);testBarrier->bEngineOn=false;CWorld::Add(testBarrier);}}
            if(player->bInVehicle){if(!hostBoardedAt)hostBoardedAt=now;if(!hostExitSent&&now-hostBoardedAt>14000){hostExitAt=now;hostExitSent=true;testHostExitSpeed=testCar->GetMoveSpeed().Magnitude();testHostExitWithDriver=testCar->pDriver&&testCar->pDriver!=player;}if(hostExitSent&&now-hostExitAt<250)pad->NewState.Triangle=255;}
            else if(hostExitSent&&hostBoardedAt&&now-hostBoardedAt>22000)hostExited=true;
            const unsigned testCarId=unsigned(CPools::GetVehicleRef(testCar));const auto delegated=delegatedVehicles.find(testCarId);const bool guestDriving=delegated!=delegatedVehicles.end()&&now-delegated->second<1500;
            if(!hostExited&&!hostExitSent&&!hostPassengerRequested&&!player->bInVehicle&&testCar->m_nNumMaxPassengers>0){hostPassengerRequested=true;ViceTogetherGrantPassenger(testCarId,0);}
            if(getenv("VT_TEST_CAR_BLAST") && now-started>12000 && testCar->GetStatus()!=STATUS_WRECKED)testCar->BlowUpCar(player);
            return;
        }
        if(player->bInVehicle){if(!guestBoardedAt)guestBoardedAt=now;const bool guestDriving=player->m_pMyVehicle&&player->m_pMyVehicle->pDriver==player;const uint32 driveTime=now-guestBoardedAt;if(guestDriving&&driveTime>5000){pad->NewState.Cross=255;pad->NewState.RightStickY=model==217?-128:0;if(model==217){const uint32 flightTime=driveTime-5000;CPad::NewKeyState.UP=flightTime<1500;CPad::NewKeyState.DOWN=flightTime>=3500&&flightTime<4500;}else if(model==191){pad->NewState.LeftStickX=((now/4000)%2)?24:-24;}else if(model==130&&!getenv("VT_TEST_VEHICLE_COLLISION")){pad->NewState.LeftStickX=((now/5000)%2)?20:-20;}}if(!guestExitSent&&driveTime>18000){guestExitSent=true;guestExitAt=now;}if(guestExitSent&&now-guestExitAt<250){pad->NewState.Cross=0;pad->NewState.RightStickY=0;pad->NewState.Triangle=255;}}
        else if(guestExitSent){if(now-guestExitAt>2500)guestExited=true;}
        else if(!guestExited&&!guestDriverRequestSent&&now-last>500){
            float hostState[20]={};const bool haveHost=VT_ReadRemote(0,hostState);
            const CVector target=haveHost?CVector(hostState[0],hostState[1],hostState[2]):player->GetPosition();
            CVehicle* candidate=nil;unsigned candidateId=0;float closest=1000000.0f;
            for(const auto& entry:vehicles)if(entry.second.entity){CVehicle* car=(CVehicle*)entry.second.entity;if(car->GetModelIndex()!=model||car->m_fHealth<=0||car->pDriver)continue;const float distance=(car->GetPosition()-target).MagnitudeSqr();if(distance<closest){closest=distance;candidate=car;candidateId=entry.first;}}
            float hostSeatState[34]={};const bool haveHostSeat=VT_ReadRemoteSkeleton(0,hostSeatState);
            const bool hostSeatedForHeli=model!=217||(haveHostSeat&&int(hostSeatState[29])==int(candidateId)&&hostSeatState[33]>=0);
            if(candidate&&hostSeatedForHeli){if(!guestPositioned){if(candidate->IsBoat()){for(int radius=3;radius<=10&&!guestPositioned;radius++)for(int angle=0;angle<32;angle++){const float a=angle*6.2831853f/32;const float x=candidate->GetPosition().x+cosf(a)*radius,y=candidate->GetPosition().y+sinf(a)*radius;bool dryGroundFound=false;const float dryGround=CWorld::FindGroundZFor3DCoord(x,y,candidate->GetPosition().z+100,&dryGroundFound);float nearbyWater=0;const bool wet=CWaterLevel::GetWaterLevel(x,y,candidate->GetPosition().z,&nearbyWater,true);if(dryGroundFound&&(!wet||dryGround>nearbyWater+0.65f)){player->Teleport(CVector(x,y,dryGround+0.5f));guestPositioned=true;break;}}if(!guestPositioned&&haveHost){player->Teleport(CVector(hostState[0],hostState[1],hostState[2]));guestPositioned=true;}}else{player->Teleport(candidate->GetPosition()+candidate->GetRight()*3.0f);guestPositioned=true;}}if(guestPositioned){VT_SendDriverRequest(candidateId);guestDriverRequestSent=true;}}
            last=now;
        }return;
    }
    static CVehicle* fixture=nil;static uint32 start=0,lastRequest=0;if(!start)start=CTimer::GetTimeInMilliseconds();const uint32 now=CTimer::GetTimeInMilliseconds();
    if(host()){if(!fixture){CStreaming::RequestModel(130,STREAMFLAGS_DONT_REMOVE);if(!CStreaming::HasModelLoaded(130))return;fixture=new CAutomobile(130,MISSION_VEHICLE);fixture->RegisterReference((CEntity**)&fixture);const int node=ThePaths.FindNodeClosestToCoors(player->GetPosition(),PATH_CAR,100.0f);CVector origin=player->GetPosition()+CVector(3,0,0.3f);float heading=0;if(node>=0){origin=ThePaths.m_pathNodes[node].GetPosition()+CVector(0,0,1);const CPathNode& road=ThePaths.m_pathNodes[node];if(road.numLinks){const CVector direction=ThePaths.m_pathNodes[ThePaths.ConnectedNode(road.firstLink)].GetPosition()-origin;heading=atan2f(-direction.x,direction.y);}}fixture->SetPosition(origin);fixture->SetHeading(heading);CWorld::Add(fixture);player->SetObjective(OBJECTIVE_ENTER_CAR_AS_DRIVER,fixture);player->WarpPedIntoCar(fixture);}
        if(getenv("VT_TEST_CAR_BLAST")){static bool blasted=false;if(!blasted && now-start>12000){fixture->BlowUpCar(player);blasted=true;}}
        else if(now-start>5000){pad->NewState.Cross=180;pad->NewState.LeftStickX=0;}
    }else if(!player->bInVehicle && now-lastRequest>500){const int vehicle=VT_ReadRemoteVehicle(0);if(vehicle>=0){CVehicle* car=ViceTogetherWorldFindVehicle(unsigned(vehicle));if(car && (car->GetPosition()-player->GetPosition()).MagnitudeSqr()>49)player->Teleport(car->GetPosition()+car->GetRight()*2.0f);VT_SendSeatRequest(unsigned(vehicle));}lastRequest=now;}
}
extern "C" int VT_ReadRemote(int slot,float* out);
namespace {
constexpr float worldCaptureRadius=350.0f;
constexpr float worldCaptureRadiusSqr=worldCaptureRadius*worldCaptureRadius;
constexpr float worldPopulationOverlapRadius=110.0f;
constexpr float worldPopulationOverlapRadiusSqr=worldPopulationOverlapRadius*worldPopulationOverlapRadius;
constexpr float guestPopulationEnableDistance=135.0f;
constexpr float guestPopulationDisableDistance=105.0f;
bool guestOwnsNearbyPopulation(){
    if(!guest())return false;
    static bool enabled=true;
    float hostState[20]={};
    CPlayerPed* player=FindPlayerPed();
    if(!player || !VT_ReadRemote(0,hostState)){enabled=true;return enabled;}
    const float distance=(player->GetPosition()-CVector(hostState[0],hostState[1],hostState[2])).Magnitude();
    if(distance>guestPopulationEnableDistance)enabled=true;
    else if(distance<guestPopulationDisableDistance)enabled=false;
    return enabled;
}
}
void ViceTogetherWorldTestEffects(){if(!host() || !FindPlayerPed())return;static uint32 started=0;static bool broken=false,blasted=false;const uint32 now=CTimer::GetTimeInMilliseconds();if(!started)started=now;if(now-started<5000)return;if(!broken){auto* objects=CPools::GetObjectPool();CObject* pane=nil;float nearest=400;for(int i=0;i<objects->GetSize();i++){CObject* object=objects->GetSlot(i);if(!object || !IsGlass(object->GetModelIndex()))continue;const float distance=(object->GetPosition()-FindPlayerPed()->GetPosition()).MagnitudeSqr();if(distance<nearest){nearest=distance;pane=object;}}if(pane){CGlass::WindowRespondsToCollision(pane,400,CVector(0.1f,0,0),pane->GetPosition(),false);broken=true;}}
    if(now-started>=9000 && !blasted){float other[20]={};if(VT_ReadRemote(0,other)){CExplosion::AddExplosion(nil,FindPlayerPed(),EXPLOSION_GRENADE,CVector(other[0]+2.0f,other[1],other[2]),0);blasted=true;}}
}
void ViceTogetherWorldCapture(VTWorldSender send) {
    if(!host() || !FindPlayerPed())return;
    static unsigned seq=0;std::vector<EntityState> frame;
    const CVector origin=FindPlayerPed()->GetPosition();
    std::vector<CVector> centers{origin};
    for(int slot=0;slot<7;slot++){
        float state[20]={};if(!VT_ReadRemote(slot,state) || state[8]<=0)continue;
        const CVector center(state[0],state[1],state[2]);bool duplicate=false;
        for(const CVector& existing:centers)if((existing-center).MagnitudeSqr()<25.0f){duplicate=true;break;}
        if(!duplicate)centers.push_back(center);
    }
    const uint32 now=CTimer::GetTimeInMilliseconds();explosions.erase(std::remove_if(explosions.begin(),explosions.end(),[now](const ExplosionState& e){return now-e.time>2000;}),explosions.end());
    for(auto it=priorityPeds.begin();it!=priorityPeds.end();)if(int32(now-it->second)>=0)it=priorityPeds.erase(it);else ++it;
    auto* objects=CPools::GetObjectPool();for(int i=0;i<objects->GetSize();i++){CObject* object=objects->GetSlot(i);if(object && IsGlass(object->GetModelIndex()) && (object->bGlassCracked || object->bGlassBroken)){float key[34]={};key[0]=object->GetModelIndex();const CVector pos=object->GetPosition();key[2]=pos.x;key[3]=pos.y;key[4]=pos.z;bool known=false;for(const auto& pane:glass)if(sameGlass(key,pane.data) && pane.data[1]==(object->bGlassBroken?2:1)){known=true;break;}if(!known)ViceTogetherWorldGlass(object,0,CVector(0,0,0),pos,false,object->bGlassBroken);}}
    std::vector<GlassState> nearbyGlass;for(const auto& pane:glass){const CVector pos(pane.data[2],pane.data[3],pane.data[4]);bool inRange=false;for(const CVector& center:centers)if((pos-center).MagnitudeSqr()<worldCaptureRadiusSqr){inRange=true;break;}if(inRange && nearbyGlass.size()<128)nearbyGlass.push_back(pane);}
    auto* peds=CPools::GetPedPool();auto* cars=CPools::GetVehiclePool();
    std::vector<std::pair<float,CPed*>> nearbyPeds;
    std::vector<std::vector<std::pair<float,CPed*>>> pedsByCenter(centers.size());
    for(int i=0;i<peds->GetSize();i++){
        // Police are the only ambient pedestrians replicated in the current
        // prototype. Civilians retain each game's local stock behavior.
        CPed* p=peds->GetSlot(i);if(!p || p->IsPlayer() || ViceTogetherIsRemote(p) || p->m_nPedType!=PEDTYPE_COP || !p->m_rwObject)continue;
        float nearest=worldCaptureRadiusSqr+1.0f;const CVector position=p->GetPosition();
        for(size_t zone=0;zone<centers.size();zone++){const float distance=(position-centers[zone]).MagnitudeSqr();if(distance<=worldCaptureRadiusSqr){pedsByCenter[zone].emplace_back(distance,p);nearest=std::min(nearest,distance);}}
        if(nearest<=worldCaptureRadiusSqr)nearbyPeds.emplace_back(nearest,p);
    }
    const auto pedOrder=[now](const auto& a,const auto& b){const auto ai=priorityPeds.find(unsigned(CPools::GetPedRef(a.second))),bi=priorityPeds.find(unsigned(CPools::GetPedRef(b.second)));const bool ap=ai!=priorityPeds.end()&&int32(now-ai->second)<0,bp=bi!=priorityPeds.end()&&int32(now-bi->second)<0;if(ap!=bp)return ap;return a.first<b.first;};
    for(auto& zone:pedsByCenter)std::sort(zone.begin(),zone.end(),pedOrder);
    std::sort(nearbyPeds.begin(),nearbyPeds.end(),pedOrder);
    for(const auto& entry:nearbyPeds){CPed* p=entry.second;auto& samples=pedShotHistory[unsigned(CPools::GetPedRef(p))];samples.push_back({now,p->GetModelIndex(),p->GetPosition()});while(!samples.empty()&&now-samples.front().time>550)samples.pop_front();while(samples.size()>8)samples.pop_front();}
    for(auto it=pedShotHistory.begin();it!=pedShotHistory.end();)if(it->second.empty())it=pedShotHistory.erase(it);else ++it;
    std::vector<CPed*> selectedPeds;
    for(size_t zone=0;zone<pedsByCenter.size() && selectedPeds.size()<48;zone++){
        const size_t quota=48/pedsByCenter.size()+(zone<48%pedsByCenter.size()?1:0);size_t added=0;
        for(const auto& entry:pedsByCenter[zone]){if(std::find(selectedPeds.begin(),selectedPeds.end(),entry.second)!=selectedPeds.end())continue;selectedPeds.push_back(entry.second);if(++added>=quota || selectedPeds.size()>=48)break;}
    }
    for(const auto& entry:nearbyPeds){if(selectedPeds.size()>=48)break;if(std::find(selectedPeds.begin(),selectedPeds.end(),entry.second)==selectedPeds.end())selectedPeds.push_back(entry.second);}
    for(CPed* p:selectedPeds) {
        EntityState e={};e.type=21;e.id=CPools::GetPedRef(p);e.data[0]=p->GetModelIndex();e.data[1]=p->m_nPedType;
        const CVector pos=p->GetPosition();e.data[2]=pos.x;e.data[3]=pos.y;e.data[4]=pos.z;e.data[5]=p->m_fRotationCur;e.data[6]=p->m_fHealth;e.data[7]=p->m_nMoveState;
        e.data[8]=-1;e.data[9]=-1;
        if(p->bInVehicle && p->m_pMyVehicle){e.data[8]=float(CPools::GetVehicleRef(p->m_pMyVehicle));if(p->m_pMyVehicle->pDriver!=p)for(int seat=0;seat<8;seat++)if(p->m_pMyVehicle->pPassengers[seat]==p)e.data[9]=float(seat);}
        CAnimBlendAssociation* best[4]={};
        for(auto* a=RpAnimBlendClumpGetFirstAssociation(p->GetClump());a;a=RpAnimBlendGetNextAssociation(a)){int j=a->IsPartial()?2:0;if(!best[j] || a->blendAmount>best[j]->blendAmount){best[j+1]=best[j];best[j]=a;}else if(!best[j+1] || a->blendAmount>best[j+1]->blendAmount)best[j+1]=a;}
        for(int j=0;j<4;j++)if(best[j]){int k=10+j*5;e.data[k]=best[j]->groupId;e.data[k+1]=best[j]->animId;e.data[k+2]=best[j]->currentTime;e.data[k+3]=best[j]->speed;e.data[k+4]=best[j]->blendAmount;}
        e.data[33]=float(p->GetWeapon()->m_eWeaponType);
        e.data[30]=p->m_bleedCounter;
        e.data[31]=float((p->m_bodyPartBleeding+1) | (p->bBodyPartJustCameOff?32:0) | (p->bPedIsBleeding?64:0) | (p->bIsPedDieAnimPlaying?128:0));
        e.data[32]=p->m_pWeaponModel?1:0;
        frame.push_back(e);
    }
    std::vector<std::pair<float,CVehicle*>> nearbyCars;
    std::vector<std::vector<std::pair<float,CVehicle*>>> carsByCenter(centers.size());
    for(int i=0;i<cars->GetSize();i++){
        CVehicle* car=cars->GetSlot(i);if(!car || !car->m_rwObject || (!car->IsCar() && !car->IsBike() && !car->IsBoat() && !car->IsHeli() && !car->IsPlane()))continue;
        float nearest=worldCaptureRadiusSqr+1.0f;const CVector position=car->GetPosition();
        for(size_t zone=0;zone<centers.size();zone++){const float distance=(position-centers[zone]).MagnitudeSqr();if(distance<=worldCaptureRadiusSqr){carsByCenter[zone].emplace_back(distance,car);nearest=std::min(nearest,distance);}}
        if(nearest<=worldCaptureRadiusSqr)nearbyCars.emplace_back(nearest,car);
    }
    for(auto& zone:carsByCenter)std::sort(zone.begin(),zone.end(),[](const auto& a,const auto& b){return a.first<b.first;});
    std::sort(nearbyCars.begin(),nearbyCars.end(),[](const auto& a,const auto& b){return a.first<b.first;});
    std::vector<CVehicle*> selectedCars;
    for(size_t zone=0;zone<carsByCenter.size() && selectedCars.size()<32;zone++){
        const size_t quota=32/carsByCenter.size()+(zone<32%carsByCenter.size()?1:0);size_t added=0;
        for(const auto& entry:carsByCenter[zone]){if(std::find(selectedCars.begin(),selectedCars.end(),entry.second)!=selectedCars.end())continue;selectedCars.push_back(entry.second);if(++added>=quota || selectedCars.size()>=32)break;}
    }
    for(const auto& entry:nearbyCars){if(selectedCars.size()>=32)break;if(std::find(selectedCars.begin(),selectedCars.end(),entry.second)==selectedCars.end())selectedCars.push_back(entry.second);}
    for(CVehicle* car:selectedCars) {
        EntityState e={};e.type=22;e.id=CPools::GetVehicleRef(car);e.data[0]=car->GetModelIndex();e.data[1]=car->IsBike()?1:car->IsBoat()?2:car->IsHeli()?3:car->IsPlane()?4:0;
        const CVector p=car->GetPosition();e.data[2]=p.x;e.data[3]=p.y;e.data[4]=p.z;
        const CMatrix& m=car->GetMatrix();const CVector basis[]={m.GetRight(),m.GetForward(),m.GetUp(),car->GetMoveSpeed()};
        for(int j=0;j<4;j++){e.data[5+j*3]=basis[j].x;e.data[6+j*3]=basis[j].y;e.data[7+j*3]=basis[j].z;}
        e.data[17]=car->m_fHealth;e.data[18]=car->m_currentColour1;e.data[19]=car->m_currentColour2;e.data[20]=car->bEngineOn;e.data[21]=car->m_bSirenOrAlarm;
        e.data[22]=car->m_nNumMaxPassengers;const CVector turn=car->m_vecTurnSpeed;e.data[23]=turn.x;e.data[24]=turn.y;e.data[25]=turn.z;
        e.hasVisual=true;captureVehicleVisual(car,e.visual);
        frame.push_back(e);
    }
    float header[34]={};header[0]=float(++seq);header[1]=float(frame.size());
    header[2]=CClock::GetHours();header[3]=CClock::GetMinutes();header[4]=CClock::GetSeconds();header[5]=CWeather::OldWeatherType;header[6]=CWeather::NewWeatherType;header[7]=CWeather::InterpolationValue;
    header[8]=CWeather::Rain;header[9]=CWeather::WetRoads;header[10]=CWeather::CloudCoverage;header[11]=CWeather::Wind;header[12]=CWeather::WindClipped;header[13]=CWeather::Foggyness;header[14]=CWeather::ExtraSunnyness;header[15]=CWeather::Rainbow;header[16]=CWeather::SunGlare;header[17]=CWeather::TrafficLightBrightness;header[18]=CWeather::ForcedWeatherType;header[19]=CWeather::bScriptsForceRain;header[20]=CWeather::LightningFlash;
    header[21]=float(nearbyGlass.size());
    header[22]=float(explosions.size());
    header[23]=CVehicle::bAllDodosCheat?1.0f:0.0f;
    send(19,0,header);
    for(const auto& entity:frame){send(entity.type,entity.id,entity.data);if(entity.hasVisual)send(35,entity.id,entity.visual);}
    for(unsigned i=0;i<nearbyGlass.size();i++)send(37,i,nearbyGlass[i].data);
    for(unsigned i=0;i<explosions.size();i++)send(42,i,explosions[i].data);
    send(20,0,header);
}
void ViceTogetherWorldPacket(unsigned type,unsigned id,const float* state) {
    if(type==63){if(!host())return;CVehicle* car=ViceTogetherWorldFindVehicle(id);if(!car||!car->IsCar())return;for(int i=0;i<6;i++)if(!std::isfinite(state[i])||fabsf(state[i])>2.4f)return;applyDoorAngles((CAutomobile*)car,state);car->GetMatrix().UpdateRW();car->UpdateRwFrame();return;}
    if(!guest())return;
    for(int i=0;i<34;i++)if(!std::isfinite(state[i]))return;
    if(type==19){receiving=state[0]>generation && state[0]>0 && state[1]>=0 && state[1]<=80 && state[21]>=0 && state[21]<=128 && state[22]>=0 && state[22]<=32 && (state[23]==0 || state[23]==1);pendingSequence=unsigned(state[0]);expected=unsigned(state[1]);expectedGlass=unsigned(state[21]);expectedExplosions=unsigned(state[22]);std::memcpy(pendingEnvironment,state+2,19*sizeof(float));pendingEnvironment[21]=state[23];pending.clear();pendingGlass.clear();pendingExplosions.clear();return;}
    if(!receiving)return;
    if(type==35){for(auto& e:pending)if(e.type==22 && e.id==id){std::memcpy(e.visual,state,sizeof(e.visual));e.hasVisual=true;return;}return;}
    if(type==37){if(pendingGlass.size()<expectedGlass){GlassState pane={};std::memcpy(pane.data,state,sizeof(pane.data));pendingGlass.push_back(pane);}return;}
    if(type==42){if(pendingExplosions.size()<expectedExplosions && state[0]>0 && state[1]>=0 && state[1]<12 && state[5]>=0 && state[5]<=10000){ExplosionState event={};std::memcpy(event.data,state,sizeof(event.data));pendingExplosions.push_back(event);}return;}
    if(type==20){if(unsigned(state[0])==pendingSequence && pending.size()==expected && pendingGlass.size()==expectedGlass && pendingExplosions.size()==expectedExplosions)commit();receiving=false;return;}
    if((type!=21 && type!=22) || (type==21 && state[1]!=float(PEDTYPE_COP)) || pending.size()>=expected || state[0]<0 || state[0]>=6500 || fabsf(state[2])>=10000 || fabsf(state[3])>=10000 || fabsf(state[4])>=3000)return;
    const auto* model=CModelInfo::GetModelInfo(int(state[0]));if(!model || model->GetModelType()!=(type==21?MITYPE_PED:MITYPE_VEHICLE))return;
    for(const auto& existing:pending)if(existing.id==id && existing.type==type)return;
    EntityState e={};e.id=id;e.type=type;std::memcpy(e.data,state,sizeof(e.data));pending.push_back(e);
}
bool ViceTogetherWorldApplyEnvironment() {
    if(!guest() || !active)return false;
    if(environment[0]>=0 && environment[0]<24 && environment[1]>=0 && environment[1]<60 && environment[2]>=0 && environment[2]<60){CClock::ms_nGameClockHours=uint8(environment[0]);CClock::ms_nGameClockMinutes=uint8(environment[1]);CClock::ms_nGameClockSeconds=uint16(environment[2]);}
    if(environment[3]>=0 && environment[3]<WEATHER_TOTAL && environment[4]>=0 && environment[4]<WEATHER_TOTAL && environment[5]>=0 && environment[5]<=1){CWeather::OldWeatherType=int16(environment[3]);CWeather::NewWeatherType=int16(environment[4]);CWeather::InterpolationValue=environment[5];}
    const bool flyCheat=environment[21]==1.0f;if(CVehicle::bAllDodosCheat!=flyCheat){CVehicle::bAllDodosCheat=flyCheat;CHud::SetHelpMessage(TheText.Get(flyCheat?"CHEAT1":"CHEATOF"),true);}
    CWeather::Rain=environment[6];CWeather::WetRoads=environment[7];CWeather::CloudCoverage=environment[8];CWeather::Wind=environment[9];CWeather::WindClipped=environment[10];CWeather::Foggyness=environment[11];CWeather::ExtraSunnyness=environment[12];CWeather::Rainbow=environment[13];CWeather::SunGlare=environment[14];CWeather::TrafficLightBrightness=environment[15];CWeather::ForcedWeatherType=int16(environment[16]);CWeather::bScriptsForceRain=environment[17]!=0;CWeather::LightningFlash=environment[18]!=0;
    return true;
}
void ViceTogetherWorldTick() {
    if(host()){applyDriverMotion();stabilizeUnpilotedNetworkHelis();return;}
    if(!ViceTogetherWorldApplyEnvironment())return;
    const bool guestPopulation=guestOwnsNearbyPopulation();float hostState[20]={};const bool haveHost=guest() && VT_ReadRemote(0,hostState);const CVector hostPosition(haveHost?hostState[0]:0,haveHost?hostState[1]:0,haveHost?hostState[2]:0);
    // Preserve stock population on the authority. Guests suppress only their
    // local duplicates in the short shared bubble; beyond it they keep native
    // pedestrians and traffic even though the host is still in the same city.
    if(guest()){CPopulation::PedDensityMultiplier=guestPopulation?1.0f:0.0f;CCarCtrl::CarDensityMultiplier=guestPopulation?1.0f:0.0f;}
    // Do not delete the guest's ambient actors across the host's full capture
    // radius. The host only simulates a small nearby bubble; deleting farther
    // guest actors creates empty streets between the two population zones.
    auto* peds=CPools::GetPedPool();auto* cars=CPools::GetVehiclePool();
    auto* objects=CPools::GetObjectPool();for(int i=0;i<objects->GetSize();i++){CObject* object=objects->GetSlot(i);if(!object || !IsGlass(object->GetModelIndex()))continue;float key[34]={};key[0]=object->GetModelIndex();const CVector pos=object->GetPosition();key[2]=pos.x;key[3]=pos.y;key[4]=pos.z;for(const auto& pane:glass)if(sameGlass(key,pane.data)){applyGlass(object,pane.data);break;}}
    for(int i=0;i<peds->GetSize();i++){CPed* p=peds->GetSlot(i);if(guest() && haveHost && p && !p->IsPlayer() && !ViceTogetherIsRemote(p) && !ViceTogetherWorldPed(p) && p->CharCreatedBy==RANDOM_CHAR && (p->GetPosition()-hostPosition).MagnitudeSqr()<=worldPopulationOverlapRadiusSqr){CWorld::Remove(p);delete p;}}
    for(int i=0;i<cars->GetSize();i++){CVehicle* c=cars->GetSlot(i);if(guest() && haveHost && c && !ViceTogetherWorldVehicle(c) && c->VehicleCreatedBy==RANDOM_VEHICLE && (c->GetPosition()-hostPosition).MagnitudeSqr()<=worldPopulationOverlapRadiusSqr && (!c->pDriver || !c->pDriver->IsPlayer())){CWorld::Remove(c);delete c;}}
    for(auto* map:{&vehicles,&pedestrians})for(auto& entry:*map) {
        Replica& r=entry.second;float* d=r.target;const int model=int(d[0]);
        const auto directMotion=driverMotions.find(entry.first);
        const bool fastDrivenVehicle=map==&vehicles&&guest()&&directMotion!=driverMotions.end()&&CTimer::GetTimeInMilliseconds()-directMotion->second.received<250;
        if(map==&vehicles && r.entity && ((CVehicle*)r.entity)->pDriver==FindPlayerPed() && FindPlayerPed()->bInVehicle){((CVehicle*)r.entity)->m_fHealth=d[17];if(d[17]>0 && (!r.hasVisual || unsigned(r.visual[31])!=STATUS_WRECKED))continue;}
        if(!r.entity){CStreaming::RequestModel(model,STREAMFLAGS_DONT_REMOVE);if(!CStreaming::HasModelLoaded(model))continue;
            if(map==&pedestrians){CPed* p=new CPed((ePedType)std::max(0,std::min(21,int(d[1]))));p->SetModelIndex(model);p->CharCreatedBy=MISSION_CHAR;p->bRespondsToThreats=false;r.entity=p;}
            else {r.entity=createMultiplayerVehicle(model);if(!r.entity)continue;}
            r.entity->RegisterReference(&r.entity);r.entity->SetPosition(d[2],d[3],d[4]);CWorld::Add(r.entity);trackNetworkHeli((CVehicle*)r.entity);
        }
        const float t=std::min(1.0f,float(CTimer::GetTimeInMilliseconds()-r.received)/100.0f);
        if(!fastDrivenVehicle){CWorld::Remove(r.entity);r.entity->SetPosition(r.previous[2]+(d[2]-r.previous[2])*t,r.previous[3]+(d[3]-r.previous[3])*t,r.previous[4]+(d[4]-r.previous[4])*t);CWorld::Add(r.entity);}
        if(map==&pedestrians){CPed* p=(CPed*)r.entity;p->m_fHealth=d[6];p->SetMoveState((eMoveState)std::max(0,std::min(5,int(d[7]))));const float heading=r.previous[5]+atan2f(sinf(d[5]-r.previous[5]),cosf(d[5]-r.previous[5]))*t;p->m_fRotationCur=p->m_fRotationDest=heading;p->SetOrientation(0,0,heading);
            float animated[34];std::memcpy(animated,d,sizeof(animated));
            for(int j=10;j<30;j+=5) {
                if(r.previous[j]!=d[j] || r.previous[j+1]!=d[j+1])continue;
                float delta=d[j+2]-r.previous[j+2];
                for(auto* a=RpAnimBlendClumpGetFirstAssociation(p->GetClump());a;a=RpAnimBlendGetNextAssociation(a))if(a->groupId==int(d[j]) && a->animId==int(d[j+1]) && a->hierarchy && a->IsRepeating() && delta< -a->hierarchy->totalLength*0.5f){delta+=a->hierarchy->totalLength;break;}
                animated[j+2]=r.previous[j+2]+delta*t;
            }
            if(d[6]<=0 && !p->DyingOrDead())p->SetDie();
            if(d[6]>0 || (unsigned(d[31])&128))pose(p,animated);
            const unsigned injury=unsigned(d[31]);p->m_bleedCounter=uint8(d[30]);p->m_bodyPartBleeding=int8((injury&31)-1);p->bBodyPartJustCameOff=(injury&32)!=0;p->bPedIsBleeding=(injury&64)!=0;p->bIsPedDieAnimPlaying=(injury&128)!=0;
            const int weapon=int(d[33]);if(weapon>=0 && weapon<WEAPONTYPE_TOTALWEAPONS && int(p->GetWeapon()->m_eWeaponType)!=weapon){const int weaponModel=CWeaponInfo::GetWeaponInfo((eWeaponType)weapon)->m_nModelId;if(weaponModel>=0)CStreaming::RequestModel(weaponModel,STREAMFLAGS_DONT_REMOVE);if(weaponModel<0 || CStreaming::HasModelLoaded(weaponModel)){p->GiveWeapon((eWeaponType)weapon,120);p->SetCurrentWeapon((eWeaponType)weapon);}}
            const int heldModel=CWeaponInfo::GetWeaponInfo(p->GetWeapon()->m_eWeaponType)->m_nModelId;
            if(d[32]==1 && heldModel>=0 && (!p->m_pWeaponModel || p->m_wepModelID!=heldModel)){CStreaming::RequestModel(heldModel,STREAMFLAGS_DONT_REMOVE);if(CStreaming::HasModelLoaded(heldModel))p->AddWeaponModel(heldModel);}else if(d[32]==0 && p->m_pWeaponModel)p->RemoveWeaponModel(-1);
            CVehicle* vehicle=nil;auto car=vehicles.find(unsigned(std::max(-1.0f,d[8])));if(d[8]>=0 && car!=vehicles.end())vehicle=(CVehicle*)car->second.entity;
            if(p->m_pMyVehicle!=vehicle){if(p->m_pMyVehicle){if(p->m_pMyVehicle->pDriver==p)p->m_pMyVehicle->RemoveDriver();else p->m_pMyVehicle->RemovePassenger(p);}p->m_pMyVehicle=vehicle;if(vehicle){vehicle->RegisterReference((CEntity**)&p->m_pMyVehicle);if(d[9]<0 && !vehicle->pDriver)vehicle->SetDriver(p);else if(d[9]>=0)vehicle->AddPassenger(p,uint8(d[9]));}}
            p->bInVehicle=vehicle!=nil;if(vehicle)p->SetPedState(PED_DRIVING);
            if(vehicle){p->bRenderPedInCar=true;p->bChangedSeat=false;p->bUsesCollision=false;p->SetPedPositionInCar();}
        }
        else {CVehicle* car=(CVehicle*)r.entity;if(!fastDrivenVehicle){CMatrix& m=car->GetMatrix();CVector* basis[]={&m.GetRight(),&m.GetForward(),&m.GetUp()};for(int j=0;j<3;j++){CVector v(r.previous[5+j*3]+(d[5+j*3]-r.previous[5+j*3])*t,r.previous[6+j*3]+(d[6+j*3]-r.previous[6+j*3])*t,r.previous[7+j*3]+(d[7+j*3]-r.previous[7+j*3])*t);v.Normalise();*basis[j]=v;}m.GetUp()=CrossProduct(m.GetRight(),m.GetForward());m.GetUp().Normalise();m.GetForward()=CrossProduct(m.GetUp(),m.GetRight());car->SetMoveSpeed(d[14],d[15],d[16]);car->m_vecTurnSpeed=CVector(r.previous[23]+(d[23]-r.previous[23])*t,r.previous[24]+(d[24]-r.previous[24])*t,r.previous[25]+(d[25]-r.previous[25])*t);}car->m_fHealth=d[17];car->m_currentColour1=uint8(d[18]);car->m_currentColour2=uint8(d[19]);car->bEngineOn=d[20]!=0;car->m_bSirenOrAlarm=d[21]!=0;}
        if(map==&vehicles && r.hasVisual && !fastDrivenVehicle){CVehicle* car=(CVehicle*)r.entity;const float* v=r.visual;const float* old=r.previousVisual;
            // Replaying the stock transition creates explosion, fire and wreck visuals.
            // Do it once per live vehicle, rather than on each repeated wreck snapshot.
            if(unsigned(v[31])==STATUS_WRECKED && !car->bRenderScorched){car->m_fHealth=std::max(1.0f,r.previous[17]);car->BlowUpCar(nil);car->bRenderScorched=true;car->m_fHealth=d[17];}
            car->m_fSteerAngle=old[0]+(v[0]-old[0])*t;car->m_fGasPedal=v[1];car->m_fBrakePedal=v[2];car->bLightsOn=v[32]!=0;car->SetStatus(unsigned(v[31]));car->SetMoveSpeed(d[14],d[15],d[16]);
            if(car->IsCar()){CAutomobile* a=(CAutomobile*)car;for(int j=0;j<4;j++){a->m_aWheelRotation[j]=old[3+j]+atan2f(sinf(v[3+j]-old[3+j]),cosf(v[3+j]-old[3+j]))*t;a->m_aWheelPosition[j]=old[7+j]+(v[7+j]-old[7+j])*t;a->m_aWheelSpeed[j]=v[11+j];a->m_aSuspensionSpringRatio[j]=v[15+j];a->Damage.m_wheelStatus[j]=(unsigned(v[25])>>(j*2))&3;}for(int j=0;j<6;j++){a->Doors[j].m_fAngle=old[19+j]+(v[19+j]-old[19+j])*t;const uint8 damage=(unsigned(v[26])>>(j*2))&3;if(a->Damage.m_doorStatus[j]!=damage){a->Damage.m_doorStatus[j]=damage;const int nodes[]={CAR_BONNET,CAR_BOOT,CAR_DOOR_LF,CAR_DOOR_RF,CAR_DOOR_LR,CAR_DOOR_RR};a->SetDoorDamage(nodes[j],(eDoors)j,true);}}a->Damage.m_lightStatus=unsigned(v[29]);a->Damage.m_engineStatus=uint8(v[30]);const unsigned panels=unsigned(v[27])|(unsigned(v[28])<<16);if(a->Damage.m_panelStatus!=panels){a->Damage.m_panelStatus=panels;const int nodes[]={CAR_WING_LF,CAR_WING_RF,CAR_WING_LR,CAR_WING_RR,CAR_WINDSCREEN,CAR_BUMP_FRONT,CAR_BUMP_REAR};for(int j=0;j<7;j++)a->SetPanelDamage(nodes[j],(ePanels)j,true);}}
            if(car->IsBike()){CBike* a=(CBike*)car;for(int j=0;j<2;j++){a->m_aWheelRotation[j]=old[3+j]+atan2f(sinf(v[3+j]-old[3+j]),cosf(v[3+j]-old[3+j]))*t;a->m_aWheelPosition[j]=old[7+j]+(v[7+j]-old[7+j])*t;a->m_aWheelSpeed[j]=v[11+j];a->m_wheelStatus[j]=(unsigned(v[25])>>(j*2))&3;}for(int j=0;j<4;j++)a->m_aSuspensionSpringRatio[j]=v[15+j];a->m_fLeanLRAngle=old[19]+(v[19]-old[19])*t;a->m_fLeanLRAngle2=old[20]+(v[20]-old[20])*t;a->bLeanMatrixClean=false;}
        }
        if(map==&vehicles && ((CVehicle*)r.entity)->IsCar() && r.hasVisual)doorMatrices((CAutomobile*)r.entity);
        r.entity->GetMatrix().UpdateRW();r.entity->UpdateRwFrame();
    }
    applyDriverMotion();
    stabilizeUnpilotedNetworkHelis();
    if(guest() && getenv("VT_TEST_GUEST_NPC_MELEE")) {
        if(testMeleeStage<1)testMeleeStage=1;
        static int targetId=-1;static bool positioned=false,requested=false;static uint32 nearSince=0;
        CPlayerPed* player=FindPlayerPed();
        if(player && !player->bInVehicle && !player->DyingOrDead() && !requested) {
            if(testMeleeStage<2)testMeleeStage=2;
            if(targetId<0) {
                float nearest=18.0f*18.0f;
                for(const auto& entry:pedestrians) {
                    CPed* ped=(CPed*)entry.second.entity;
                    if(!ped || ped->DyingOrDead() || ped->m_fHealth<=0 || !ped->m_rwObject)continue;
                    const float distance=(ped->GetPosition()-player->GetPosition()).MagnitudeSqr();
                    if(distance<nearest){nearest=distance;targetId=int(entry.first);}
                }
                positioned=targetId>=0;
                testMeleeTarget=targetId;if(positioned)testMeleeStage=3;
            }
            if(targetId>=0 && positioned) {
                CPed* target=(CPed*)pedestrians[unsigned(targetId)].entity;
                if(!target || target->DyingOrDead() || target->m_fHealth<=0 || !target->m_rwObject){targetId=-1;positioned=false;nearSince=0;return;}
                CVector away=target->GetPosition()-player->GetPosition();away.Normalise2D();if(away.MagnitudeSqr()<0.01f)away=CVector(0,1,0);
                const CVector desired=target->GetPosition()-away*1.05f;const CVector current=player->GetPosition(),delta=desired-current;const float distance=delta.Magnitude();
                testMeleeLocalDistance=distance;
                if(distance>0.28f){if(testMeleeStage<4)testMeleeStage=4;const float step=std::min(0.05f,distance);player->Teleport(current+delta*(step/distance));player->m_fRotationCur=player->m_fRotationDest=atan2f(-away.x,away.y);player->SetHeading(player->m_fRotationCur);}
                testMeleeRemoteDistance=(player->GetPosition()-target->GetPosition()).Magnitude();
                if(distance<=0.35f && testMeleeRemoteDistance<2.0f){if(!nearSince)nearSince=CTimer::GetTimeInMilliseconds();}
                else nearSince=0;
                if(nearSince && CTimer::GetTimeInMilliseconds()-nearSince>=500) {
                    testMeleeStage=5;target->InflictDamage(player,WEAPONTYPE_UNARMED,12.0f,PEDPIECE_TORSO,0);requested=true;testMeleeStage=6;
                }
            }
        }
    }
}
