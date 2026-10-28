// Copyright (c) 2026 ViceTogether contributors. MIT.
// This bridge is experimental until tested with the user's own game assets.
#include "common.h"
#include "ViceTogether.h"
#include "ViceTogetherWorld.h"
#include "PlayerPed.h"
#include "Vehicle.h"
#include "Automobile.h"
#include "Ped.h"
#include "World.h"
#include "PathFind.h"
#include "WaterLevel.h"
#include "ModelIndices.h"
#include "Weapon.h"
#include "Timer.h"
#include "Sprite.h"
#include "Font.h"
#include "Camera.h"
#include "AnimBlendAssociation.h"
#include "AnimBlendAssocGroup.h"
#include "AnimManager.h"
#include "RpAnimBlend.h"
#include "GameLogic.h"
#include "PlayerInfo.h"
#include "Pad.h"
#include "Frontend.h"
#include "VisibilityPlugins.h"
#include "WeaponInfo.h"
#include "Wanted.h"
#include "Streaming.h"
#include "PedModelInfo.h"
#include "DMAudio.h"
#include "Particle.h"
#include "PointLights.h"
#include "SpecialFX.h"
#include "Radar.h"
#include "Pools.h"
#include "ColPoint.h"
#include <cstdlib>
#include <cstring>
#include <vector>
#include <algorithm>
#include <cmath>
void WeaponCheat1();void WeaponCheat2();void WeaponCheat3();
extern "C" void VT_ReportWorldHit(int kind,float health);
static bool modMenuOpen=false;static int modMenuRow=0,modMenuPage=0,modMenuAction=-1;
struct MenuItem{const char* label;int action;};
static const MenuItem menuRoot[]={{"Weapons",-1},{"Vehicles",-2},{"Close",-99}};
static const MenuItem menuWeapons[]={{"Street weapons",0},{"Professional weapons",1},{"Heavy weapons",2},{"Back",-100}};
static const MenuItem menuVehicles[]={{"Cars",-3},{"Motorcycles",-4},{"Helicopters",-5},{"Boats",-6},{"Aircraft",-7},{"Back",-100}};
static const MenuItem menuCars[]={{"Infernus",1141},{"Cheetah",1145},{"Sentinel",1135},{"Landstalker",1130},{"Banshee",1159},{"Back",-100}};
static const MenuItem menuBikes[]={{"PCJ-600",1191},{"Freeway",1193},{"Angel",1166},{"Faggio",1192},{"Back",-100}};
static const MenuItem menuHelis[]={{"Maverick",1217},{"Hunter",1155},{"Back",-100}};
static const MenuItem menuBoats[]={{"Dinghy",1203},{"Speeder",1182},{"Squalo",1176},{"Back",-100}};
static const MenuItem menuAircraft[]={{"Skimmer (water takeoff)",1190},{"Back",-100}};
static const MenuItem menuAdmin[]={{"Morning",2000},{"Night",2001},{"Sunny weather",2002},{"Rainy weather",2003},{"Clear own wanted level",2004},{"Remove unused spawned vehicles",2005},{"Nearby Big Bang (35 m)",2006},{"Close",-99}};
static const MenuItem menuGuestCheats[]={{"Weapon cheats",-1},{"Nearby Big Bang (35 m)",2006},{"Close",-99}};
static bool menuHost(){const char* role=getenv("VT_WORLD_HOST");return !getenv("VT_PORT") || (role&&atoi(role)==1);}
static const MenuItem* menuItems(int& count){
    switch(modMenuPage){case 1:count=4;return menuWeapons;case 2:count=6;return menuVehicles;case 3:count=6;return menuCars;case 4:count=5;return menuBikes;case 5:count=3;return menuHelis;case 6:count=4;return menuBoats;case 7:count=2;return menuAircraft;case 8:if(menuHost()){count=8;return menuAdmin;}count=3;return menuGuestCheats;default:count=3;return menuRoot;}
}
static float hudPing=-1,hudTransportPing=-1;static int hudPeers=0;static uint32 hudNetworkTime=0;
void ViceTogetherNetworkStatus(const float* status){if(!std::isfinite(status[0])||!std::isfinite(status[1])||!std::isfinite(status[2])||status[0]<-1||status[0]>10000||status[1]<-1||status[1]>10000||status[2]<0||status[2]>7)return;hudPing=status[0];hudTransportPing=status[1];hudPeers=int(status[2]);hudNetworkTime=CTimer::GetTimeInMilliseconds();}
static void drawNetworkStatus(){
    const CFontDetails saved=CFont::Details;char label[64];const bool fresh=CTimer::GetTimeInMilliseconds()-hudNetworkTime<10000;
    if(!fresh)snprintf(label,sizeof(label),"Ping: waiting...");else if(!hudPeers)snprintf(label,sizeof(label),"Solo lobby");else if(hudPing<0)snprintf(label,sizeof(label),"Ping: measuring...");else snprintf(label,sizeof(label),"Ping: %d ms",int(hudPing));
    const float x=SCREEN_SCALE_X(14),y=SCREEN_SCALE_Y(14);CSprite2d::DrawRect(CRect(x,y,x+SCREEN_SCALE_X(135),y+SCREEN_SCALE_Y(24)),CRGBA(14,18,26,210));
    CFont::SetFontStyle(FONT_STANDARD);CFont::SetScale(SCREEN_SCALE_X(0.34f),SCREEN_SCALE_Y(0.66f));CFont::SetCentreOff();CFont::SetRightJustifyOff();CFont::SetJustifyOff();CFont::SetBackgroundOff();CFont::SetPropOn();CFont::SetColor(hudPing>=160?CRGBA(244,166,92,255):CRGBA(175,230,213,255));wchar text[64];AsciiToUnicode(label,text);CFont::PrintString(x+SCREEN_SCALE_X(9),y+SCREEN_SCALE_Y(5),text);CFont::Details=saved;
}
bool ViceTogetherMenuOpen(){return modMenuOpen;}
bool ViceTogetherMenuKey(int key,bool control){
    if(key=='O'&&control){modMenuOpen=!modMenuOpen;modMenuPage=modMenuRow=0;return true;}
    if(key=='I'&&control){modMenuOpen=!modMenuOpen || modMenuPage!=8;modMenuPage=8;modMenuRow=0;return true;}
    if(!modMenuOpen)return false;
    int count;const MenuItem* rows=menuItems(count);
    if(key==38||key=='W')modMenuRow=(modMenuRow+count-1)%count;
    else if(key==40||key=='S')modMenuRow=(modMenuRow+1)%count;
    else if(key==13||key==39||key=='D'){const int action=rows[modMenuRow].action;if(action==-99)modMenuOpen=false;else if(action==-100){modMenuPage=modMenuPage>=3&&modMenuPage<=7?2:0;modMenuRow=0;}else if(action<0){modMenuPage=-action;modMenuRow=0;}else if(action<1000||menuHost()||action<2000||action==2006)modMenuAction=action;}
    else if(key==8||key==37||key=='A'){if(!modMenuPage||modMenuPage==8)modMenuOpen=false;else{modMenuPage=modMenuPage>=3&&modMenuPage<=7?2:0;modMenuRow=0;}}
    else if(key==27)modMenuOpen=false;
    return true;
}
static void drawModMenu(){
    if(!modMenuOpen)return;
    int count;const MenuItem* rows=menuItems(count);const CFontDetails saved=CFont::Details;const float x=SCREEN_SCALE_X(28),y=SCREEN_SCALE_Y(60),w=SCREEN_SCALE_X(270),row=SCREEN_SCALE_Y(26);
    CSprite2d::DrawRect(CRect(x,y,x+w,y+row*(count+3.8f)),CRGBA(19,18,35,235));CSprite2d::DrawRect(CRect(x,y,x+w,y+row*1.5f),CRGBA(192,78,151,255));
    CFont::SetFontStyle(FONT_STANDARD);CFont::SetScale(SCREEN_SCALE_X(0.42f),SCREEN_SCALE_Y(0.78f));CFont::SetCentreOff();CFont::SetRightJustifyOff();CFont::SetJustifyOff();CFont::SetBackgroundOff();CFont::SetPropOn();CFont::SetColor(CRGBA(255,255,255,255));
    wchar text[96];CFont::SetFontStyle(FONT_HEADING);AsciiToUnicode(modMenuPage==8?(menuHost()?"ViceTogether - ADMIN":"ViceTogether - CHEATS"):"ViceTogether",text);CFont::PrintString(x+SCREEN_SCALE_X(12),y+SCREEN_SCALE_Y(10),text);CFont::SetFontStyle(FONT_STANDARD);
    for(int i=0;i<count;i++){const float top=y+row*(1.6f+i);if(i==modMenuRow)CSprite2d::DrawRect(CRect(x,top,x+w,top+row),CRGBA(91,174,174,240));CFont::SetColor(CRGBA(255,255,255,255));AsciiToUnicode(rows[i].label,text);CFont::PrintString(x+SCREEN_SCALE_X(12),top+SCREEN_SCALE_Y(5),text);}
    CFont::SetScale(SCREEN_SCALE_X(0.27f),SCREEN_SCALE_Y(0.55f));AsciiToUnicode(modMenuPage==8&&!menuHost()?"Weapon pack cheats are available to all players":"Arrows / WASD   Enter: use   Backspace: back",text);CFont::PrintString(x+SCREEN_SCALE_X(9),y+row*(count+2.2f),text);AsciiToUnicode(ViceTogetherWorldMenuStatus(),text);CFont::PrintString(x+SCREEN_SCALE_X(9),y+row*(count+3.0f),text);CFont::Details=saved;
}
bool ViceTogetherMenuTest(float* state){
    if(!getenv("VT_TEST_WALK")||CTimer::GetFrameCounter()<500||!FindPlayerPed()||!FindPlayerPed()->m_rwObject)return false;
    static int stage=0,flags=0;static uint32 started=0;if(stage==2)return false;
    if(getenv("VT_TEST_GUEST_SPAWN")&&menuHost())return false;
    if(getenv("VT_TEST_GUEST_SPAWN")&&!menuHost()){
        ViceTogetherMenuKey('O',true);ViceTogetherMenuKey('S',false);ViceTogetherMenuKey(13,false);
        ViceTogetherMenuKey('S',false);ViceTogetherMenuKey('S',false);ViceTogetherMenuKey(13,false);ViceTogetherMenuKey(13,false);
        if(modMenuAction==1217)flags|=64;ViceTogetherMenuKey(27,false);state[0]=float(flags);state[1]=0;stage=2;return true;
    }
    if(stage==0){started=CTimer::GetTimeInMilliseconds();ViceTogetherMenuKey('O',true);ViceTogetherMenuKey('W',false);if(modMenuRow==2)flags|=1;ViceTogetherMenuKey('S',false);ViceTogetherMenuKey(40,false);ViceTogetherMenuKey(13,false);if(modMenuPage==2)flags|=2;ViceTogetherMenuKey('D',false);if(modMenuPage==3)flags|=4;ViceTogetherMenuKey(13,false);if((menuHost()&&modMenuAction==1141)||(!menuHost()&&modMenuAction==-1))flags|=8;ViceTogetherMenuKey(27,false);stage=1;return false;}
    if(CTimer::GetTimeInMilliseconds()-started<4000)return false;if(menuHost()){FILE* log=fopen("native-menu.log","a");if(log){const CVector position=FindPlayerPed()->GetPosition();fprintf(log,"status=%s position=%f,%f,%f\n",ViceTogetherWorldMenuStatus(),position.x,position.y,position.z);fclose(log);}}ViceTogetherMenuKey('I',true);
    if(modMenuPage==8&&modMenuOpen)flags|=16;
    if(menuHost()){ViceTogetherMenuKey('S',false);ViceTogetherMenuKey(13,false);if(modMenuAction==2001)flags|=32;}
    else {ViceTogetherMenuKey(13,false);if(modMenuPage==1)flags|=32;}
    ViceTogetherMenuKey(27,false);
    state[0]=float(flags);state[1]=menuHost()?1:0;stage=2;return true;
}
#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif

namespace {
struct Remote {
    CPed* ped;
    int radarBlip = -1;
    bool active;
    float x, y, z, heading;
    int move;
    char name[25];
    int color;
    float animation[20];
    float aim[4];
    float health;
    int wanted;
    int weapon;
    uint32 createdFrame;
    int vehicle,seat,appliedSeat;
    unsigned weaponDraws;
    bool weaponVisible;
};
Remote peers[7] = {};
bool enabled = false;
extern "C" void VT_SendSharedCheatRequest(int cheatId);
bool loadoutGiven=false;
static int localWantedLevel=-1,lastAppliedWantedLevel=-1;
int localColor=0;
unsigned int outfitDraws[8]={},outfitTexels[8]={};
bool finitePosition(float x, float y, float z) {
    return std::isfinite(x) && std::isfinite(y) && std::isfinite(z)
        && std::fabs(x) < 10000 && std::fabs(y) < 10000 && std::fabs(z) < 3000;
}
bool registeredAnimation(int group, int id) {
    if(group<0 || group>=NUM_ANIM_ASSOC_GROUPS || id<0)return false;
    const CAnimBlendAssocGroup& animations=CAnimManager::GetAnimAssocGroups()[group];
    return animations.assocList && id>=animations.firstAnimId
        && id-animations.firstAnimId<animations.numAssociations;
}
bool syncedHitAnimation(int id){
    return (id>=ANIM_STD_HIGHIMPACT_FRONT&&id<=ANIM_STD_HITBYGUN_RIGHT)
        || (id>=ANIM_STD_HIT_FRONT&&id<=ANIM_STD_HIT_BEHIND);
}
constexpr float remoteTagScaleX=0.34f;
constexpr float remoteTagScaleY=0.64f;
float remoteTagLineHeight(){return SCREEN_SCALE_Y(20.0f*remoteTagScaleY);}
float remoteTagNameGap(){return SCREEN_SCALE_Y(17.0f);}
float remoteTagHealthGap(){return SCREEN_SCALE_Y(13.0f);}
float remoteTagHeadClearance(){return SCREEN_SCALE_Y(16.0f);}
bool remoteTagProjection(CPed* ped,RwV3d* screen){
    if(!ped||!ped->m_rwObject||!ped->GetClump()||!screen)return false;
    CVector head=ped->GetNodePosition(PED_HEAD);head.z+=0.10f;
    RwV3d world={head.x,head.y,head.z};float width,height;
    return CSprite::CalcScreenCoors(world,screen,&width,&height,true);
}
struct RemoteTagLayout {float centerX,nameY,healthY,headY;};
RemoteTagLayout remoteTagLayout(const RwV3d& head){
    const float clearance=remoteTagHeadClearance();
    return {head.x,head.y-remoteTagLineHeight()-SCREEN_SCALE_Y(2.0f)-remoteTagNameGap()-clearance,head.y-SCREEN_SCALE_Y(1.0f)-remoteTagHealthGap()-clearance,head.y};
}
struct RemoteTagObservation {
    uint32 frame;
    bool drawn;
    float nameLeft,nameWidth,nameY,healthLeft,healthY,headX,headY;
};
RemoteTagObservation remoteTagObservations[7]={};
}

// This hook is called by the patched game cheat function from another
// translation unit, so it must have external linkage (outside the anonymous
// namespace above).
bool ViceTogetherInterceptFlyCheat(){if(!enabled)return false;if(menuHost()){if(!getenv("VT_PORT"))return false;ViceTogetherWorldToggleFlyCheat();return true;}VT_SendSharedCheatRequest(1);return true;}

extern "C" {
EMSCRIPTEN_KEEPALIVE int VT_Version() { return 1; }
// Bit 0: on-foot transforms and locomotion only. Vehicles/combat are not implemented.
EMSCRIPTEN_KEEPALIVE int VT_Capabilities() { return 1; }
EMSCRIPTEN_KEEPALIVE void VT_Enable(int value) { if(value && !enabled)for(auto& peer:peers)peer.vehicle=peer.seat=-1;enabled = value != 0; }
EMSCRIPTEN_KEEPALIVE int VT_ReadLocal(float* out) {
    CPlayerPed* player = FindPlayerPed();
    if (!out || !player || !player->m_rwObject) return 0;
    const CVector& p = player->GetPosition();
    out[0] = p.x; out[1] = p.y; out[2] = p.z;
    out[3] = player->m_fRotationCur;
    out[4] = player->GetMoveSpeed().x;
    out[5] = player->GetMoveSpeed().y;
    out[6] = player->GetMoveSpeed().z;
    out[7] = (float)player->m_nMoveState;
    out[8] = player->m_fHealth;
    out[9] = player->bInVehicle ? 1.0f : 0.0f;
    for(int i=10;i<34;i++)out[i]=0;
    CAnimBlendAssociation* best[4]={};
    CAnimBlendAssociation* strongestHit=nil;
    for(CAnimBlendAssociation* a=RpAnimBlendClumpGetFirstAssociation(player->GetClump());a;a=RpAnimBlendGetNextAssociation(a)) {
        // Capture the engine's actual pose, including jump launch/glide/landing,
        // falls, ducking and weapon-specific directional locomotion.
        if(!registeredAnimation(a->groupId,a->animId) || a->blendAmount<=0)continue;
        // Partial upper-body poses cannot replace the full-body base skeleton.
        const int base=a->IsPartial()?2:0;
        if(a->groupId==ASSOCGRP_STD&&syncedHitAnimation(a->animId)&&a->blendAmount>0.05f&&(!strongestHit||a->blendAmount>strongestHit->blendAmount))strongestHit=a;
        if(!best[base] || a->blendAmount>best[base]->blendAmount){best[base+1]=best[base];best[base]=a;}
        else if(!best[base+1] || a->blendAmount>best[base+1]->blendAmount)best[base+1]=a;
    }
    // Reserve one upper-body pose slot for hit feedback even while the player
    // is aiming, so the victim's response reaches the other native client.
    if(strongestHit&&best[2]!=strongestHit)best[3]=strongestHit;
    for(int i=0;i<4;i++)if(best[i]) {
        const int j=10+i*5;
        out[j]=best[i]->groupId;out[j+1]=best[i]->animId;out[j+2]=best[i]->currentTime;
        out[j+3]=best[i]->speed;out[j+4]=best[i]->blendAmount;
    }
    out[30]=player->bIsAimingGun?1.0f:0.0f;
    out[31]=out[30]>0 && fabsf(player->m_fLookDirection)<100?player->m_fLookDirection:player->m_fRotationCur;
    out[32]=out[30]>0?std::max(-1.55f,std::min(1.55f,player->m_fFPSMoveHeading)):0;
    out[33]=(player->m_pedIK.m_flags&CPedIK::AIMS_WITH_ARM)?1.0f:0.0f;
    if(player->m_pSeekTarget && out[30]>0) {
        CVector target=player->m_pSeekTarget->GetPosition();target.z+=0.6f;
        const CVector d=target-player->GetPosition();
        out[31]=atan2f(-d.x,d.y);out[32]=atan2f(d.z,sqrtf(d.x*d.x+d.y*d.y));
    }
    return finitePosition(out[0], out[1], out[2]) ? 1 : 0;
}
EMSCRIPTEN_KEEPALIVE void VT_SetRemote(int slot, float x, float y, float z, float heading, int move) {
    if (slot < 0 || slot >= 7 || !finitePosition(x, y, z) || !std::isfinite(heading)) return;
    Remote& r = peers[slot];
    r.active = true; r.x = x; r.y = y; r.z = z; r.heading = heading;
    r.move = move >= PEDMOVE_STILL && move <= PEDMOVE_SPRINT ? move : PEDMOVE_STILL;
}
EMSCRIPTEN_KEEPALIVE void VT_RemoveRemote(int slot) {
    if (slot < 0 || slot >= 7) return;
    peers[slot].active = false;
    peers[slot].vehicle=peers[slot].seat=-1;
}
void VT_SetRemoteName(int slot, const char* name, int color) {
    if(slot < 0 || slot >= 7) return;
    int n=0;
    for(;n<24 && name[n];n++) {
        const char c=name[n];
        peers[slot].name[n] = ((c>='a'&&c<='z')||(c>='A'&&c<='Z')||(c>='0'&&c<='9')||c==' '||c=='_'||c=='.'||c=='-') ? c : '_';
    }
    peers[slot].name[n]=0;
    peers[slot].color=color%8;
}
void VT_SetLocalColor(int color) { localColor=color>=0?color%8:0; }
int VT_ReadWeapon(){CPlayerPed* p=FindPlayerPed();return p?int(p->GetWeapon()->m_eWeaponType):0;}
int VT_ReadWeaponVisible(){CPlayerPed* p=FindPlayerPed();return p && p->m_pWeaponModel?1:0;}
int VT_ReadWanted(){CPlayerPed* p=FindPlayerPed();if(!p || !p->m_pWanted)return 0;const int current=std::max(0,std::min(6,p->m_pWanted->GetWantedLevel()));if(localWantedLevel<0 || lastAppliedWantedLevel<0 || current!=lastAppliedWantedLevel)localWantedLevel=current;return localWantedLevel;}
void VT_SetRemoteWanted(int slot,int level){if(slot>=0 && slot<7)peers[slot].wanted=std::max(0,std::min(6,level));}
void VT_SetRemoteWeapon(int slot,int weapon){if(slot>=0 && slot<7 && weapon>=0 && weapon<WEAPONTYPE_TOTALWEAPONS)peers[slot].weapon=weapon;}
void VT_SetRemoteWeaponVisible(int slot,int visible){if(slot>=0 && slot<7)peers[slot].weaponVisible=visible!=0;}
void VT_SetRemoteVehicle(int slot,int vehicle,int seat){if(slot>=0 && slot<7){peers[slot].vehicle=vehicle;peers[slot].seat=seat;}}
int VT_ReadRemoteVehicle(int slot){return slot>=0 && slot<7?peers[slot].vehicle:-1;}
void VT_TestGunAim() {
    CPlayerPed* p=FindPlayerPed();if(!p || !peers[0].ped)return;
    // Exercise the stock pad lock-on path; mouse aim deliberately clears lock-on.
    CCamera::m_bUseMouse3rdPerson=false;
    p->SetWeaponLockOnTarget(peers[0].ped);
    if(p->GetWeapon()->m_eWeaponType==WEAPONTYPE_COLT45)p->SetPointGunAt(peers[0].ped);
    const CVector d=peers[0].ped->GetPosition()-p->GetPosition();
    p->m_fRotationCur=p->m_fRotationDest=atan2f(-d.x,d.y);p->SetHeading(p->m_fRotationCur);
}
int VT_PlayRemoteShot(int slot,const float* data) {
    const int weapon=int(data[0]);if(slot<0 || slot>=7 || !peers[slot].ped || weapon<0 || weapon>=WEAPONTYPE_TOTALWEAPONS || CWeaponInfo::GetWeaponInfo(eWeaponType(weapon))->m_eWeaponFire!=WEAPON_FIRE_INSTANT_HIT)return 0;
    CPed* ped=peers[slot].ped;
    CVector source(data[1],data[2],data[3]),end(data[4],data[5],data[6]);
    if(!finitePosition(source.x,source.y,source.z) || !finitePosition(end.x,end.y,end.z) || (end-source).Magnitude()>1000)return 0;
    CVector direction=end-source;if(direction.MagnitudeSqr()>0.001f)direction.Normalise();
    CPointLights::AddLight(CPointLights::LIGHT_POINT,source,CVector(0,0,0),5,1,0.8f,0,CPointLights::FOG_NONE,false);
    for(int i=0;i<3;i++)CParticle::AddParticle(PARTICLE_GUNFLASH_NOANIM,source+direction*(i*0.05f),CVector(0,0,0),nil,0.06f-i*0.02f);
    for(int i=0;i<3;i++)CParticle::AddParticle(PARTICLE_GUNSMOKE2,source,direction*(0.1f+0.05f*i),nil,0.005f+0.01f*i);
    CVector shellDirection=CrossProduct(CVector(direction.x,direction.y,0),CVector(0,0,5));shellDirection.Normalise2D();
    ped->GetWeapon()->AddGunshell(ped,source-CVector(direction.x,direction.y,0)*0.2f,CVector2D(shellDirection.x,shellDirection.y),0.015f);
    CBulletTraces::AddTrace(&source,&end,eWeaponType(weapon),ped);
    // The launcher already validates equipment, shot rate and source proximity.
    // Recast on the host: never trust a guest's claimed NPC or hit location.
    const char* worldRole=getenv("VT_WORLD_HOST");
    if(worldRole && atoi(worldRole)==1 && direction.MagnitudeSqr()>0.001f) {
        CColPoint impact={};CEntity* victim=nil;CEntity* oldIgnore=CWorld::pIgnoreEntity;CWorld::pIgnoreEntity=ped;
        const bool hit=CWorld::ProcessLineOfSight(source,end+direction*0.25f,impact,victim,true,true,true,true,true,false);
        CWorld::pIgnoreEntity=oldIgnore;
        // Interpolation means an NPC may have moved past its last replicated
        // collision pose. Rewind against the host's short ped history; the host
        // still chooses the victim and checks the static/vehicle obstruction.
        CPed* resolvedPed=nil;
        if(!victim || !victim->IsPed()) {
            CVector resolvedPoint;
            if(ViceTogetherWorldResolveShotPed(source,end,ped,&resolvedPed,&resolvedPoint)) {
                impact.point=resolvedPoint;
                impact.pieceB=PEDPIECE_TORSO;
            }
        }
        if(resolvedPed) {
            victim=resolvedPed;
        }
        if((hit || resolvedPed) && victim && victim->IsPed()) {
            CPed* npc=(CPed*)victim;
            if(!npc->IsPlayer() && !ViceTogetherIsRemote(npc) && !npc->DyingOrDead()) {
                const int piece=int(impact.pieceB);
                const float before=npc->m_fHealth;
                npc->ReactToAttack(ped);
                npc->InflictDamage(ped,eWeaponType(weapon),float(CWeaponInfo::GetWeaponInfo(eWeaponType(weapon))->m_nDamage),piece>=PEDPIECE_TORSO && piece<=PEDPIECE_HEAD?(ePedPieceTypes)piece:PEDPIECE_TORSO,0);
                if(npc->m_fHealth<before){const int id=CPools::GetPedRef(npc);if(id>=0)ViceTogetherWorldPrioritizePed(unsigned(id));VT_ReportWorldHit(0,npc->m_fHealth);}
            }
        } else if(hit && victim && victim->IsVehicle()) {((CVehicle*)victim)->InflictDamage(ped,eWeaponType(weapon),float(CWeaponInfo::GetWeaponInfo(eWeaponType(weapon))->m_nDamage));VT_ReportWorldHit(1,((CVehicle*)victim)->m_fHealth);}
    }
    DMAudio.PlayOneShot(ped->m_audioEntityId,SOUND_WEAPON_SHOT_FIRED,0.0f);
    if(data[7]>0) {
        const CVector normal(data[8],data[9],data[10]);
        if(data[11]==1)for(int i=0;i<8;i++)CParticle::AddParticle(PARTICLE_BLOOD_SMALL,end,CVector(direction.x*0.01f,direction.y*0.01f,0.01f));
        else for(int i=0;i<4;i++)CParticle::AddParticle(PARTICLE_SPARK,end,normal*0.05f);
    }
    return 1;
}
extern "C" void VT_SendHit(int slot,int weapon,float amount);
void VT_SetRemoteHealth(int slot,float health) {if(slot>=0 && slot<7)peers[slot].health=health;}
void VT_ApplyPlayerHit(int slot,const float* state){
    if(!enabled||slot<0||slot>=7||!state||!std::isfinite(state[0])||!std::isfinite(state[1])||!std::isfinite(state[3])||!std::isfinite(state[4]))return;
    const int weapon=int(state[0]);const float amount=state[1];const bool localTarget=state[3]==1.0f;
    const int attackerSlot=int(state[4]);if(state[4]!=float(attackerSlot)||attackerSlot<0||attackerSlot>=7||attackerSlot!=slot)return;
    const bool melee=weapon>=WEAPONTYPE_UNARMED&&weapon<=WEAPONTYPE_CHAINSAW;
    const bool instant=weapon>=0&&weapon<WEAPONTYPE_TOTALWEAPONS&&CWeaponInfo::GetWeaponInfo(eWeaponType(weapon))->m_eWeaponFire==WEAPON_FIRE_INSTANT_HIT;
    if((!melee&&!instant)||amount<=0||amount>60||state[0]!=float(weapon)||state[3]!=(localTarget?1.0f:0.0f))return;
    CPed* attacker=peers[slot].ped;CPed* victim=nil;
    if(!localTarget){
        if(peers[slot].health<=0)return;
        attacker=peers[attackerSlot].ped;victim=peers[slot].ped;
    }else victim=FindPlayerPed();
    if(!attacker||!victim||attacker==victim||!victim->m_rwObject||victim->DyingOrDead()||victim->bInVehicle)return;
    const CVector2D fromAttacker(attacker->GetPosition()-victim->GetPosition());
    const int direction=victim->GetLocalDirection(fromAttacker);
    AnimationId animation;
    if(instant){
        switch(direction){case 1:animation=ANIM_STD_HITBYGUN_LEFT;break;case 2:animation=ANIM_STD_HITBYGUN_BACK;break;case 3:animation=ANIM_STD_HITBYGUN_RIGHT;break;default:animation=ANIM_STD_HITBYGUN_FRONT;break;}
    }else{
        switch(direction){case 1:animation=ANIM_STD_HIT_LEFT;break;case 2:animation=ANIM_STD_HIT_BACK;break;case 3:animation=ANIM_STD_HIT_RIGHT;break;default:animation=ANIM_STD_HIT_FRONT;break;}
    }
    CAnimBlendAssociation* reaction=CAnimManager::BlendAnimation(victim->GetClump(),ASSOCGRP_STD,animation,8.0f);
    if(reaction){reaction->SetCurrentTime(0.0f);reaction->SetRun();reaction->flags&=~ASSOC_DELETEFADEDOUT;reaction->flags|=ASSOC_FADEOUTWHENDONE;}
    victim->Say(SOUND_PED_DEFEND);
}
static bool findSafeMultiplayerRespawn(const CVector& center,CVector& spawn){
    const float rings[]={10.0f,16.0f,22.0f,28.0f,34.0f,40.0f};
    float bestScore=1.0e30f;bool foundSafe=false;
    for(float radius:rings)for(int direction=0;direction<16;direction++){
        const float angle=direction*6.2831853f/16.0f;
        const CVector probe=center+CVector(cosf(angle)*radius,sinf(angle)*radius,0.0f);
        const int road=ThePaths.FindNodeClosestToCoors(probe,PATH_CAR,24.0f);
        if(road<0)continue;
        const CVector node=ThePaths.m_pathNodes[road].GetPosition();
        const float dx=node.x-center.x,dy=node.y-center.y;
        const float distanceSqr=dx*dx+dy*dy;
        if(distanceSqr<64.0f||distanceSqr>2500.0f)continue;
        bool groundFound=false;
        const float ground=CWorld::FindGroundZFor3DCoord(node.x,node.y,node.z+5.0f,&groundFound);
        if(!groundFound||!std::isfinite(ground)||fabsf(ground-node.z)>3.5f)continue;
        float water=0.0f;
        if(CWaterLevel::GetWaterLevel(node.x,node.y,ground+1.0f,&water,true)&&ground<water+0.2f)continue;
        const float score=distanceSqr+fabsf(ground-center.z)*0.25f;
        if(score<bestScore){bestScore=score;spawn=CVector(node.x,node.y,ground+1.0f);foundSafe=true;}
    }
    return foundSafe;
}
void VT_ApplyLocalHealth(float health) {
    CPlayerPed* player=FindPlayerPed();if(!player || !std::isfinite(health) || health<0 || health>100)return;
    static CVector deathPosition(-592.0f,670.0f,10.0f);static bool deathRecorded=false;
    if(health<=0 && !deathRecorded){deathPosition=player->GetPosition();deathRecorded=true;}
    if(health>0 && player->DyingOrDead()) {
        CVector center=deathPosition;
        if(center.x< -2350 || center.x>1550 || fabsf(center.y)>1950 || center.z< -30 || center.z>1000)center=CVector(-592.0f,670.0f,10.0f);
        CVector spawn;
        if(!findSafeMultiplayerRespawn(center,spawn)&&!findSafeMultiplayerRespawn(CVector(-592.0f,670.0f,10.0f),spawn))spawn=CVector(-592.0f,670.0f,10.0f);
        CGameLogic::RestorePlayerStuffDuringResurrection(player,spawn,0);
        player->GetPlayerInfoForThisPlayerPed()->m_WBState=WBSTATE_PLAYING;
        CPad::GetPad(0)->DisablePlayerControls=PLAYERCONTROL_ENABLED;
        TheCamera.Fade(0.0f,FADE_IN);
        loadoutGiven=false;
        deathRecorded=false;
    }
    player->m_fHealth=health;
    if(health<=0 && !player->DyingOrDead())player->SetDie();
}
void VT_SetRemoteAnimation(int slot,const float* a,const float* b,float t,float ahead) {
    if(slot<0 || slot>=7)return;
    Remote& r=peers[slot];
    for(int i=0;i<4;i++) {
        const int j=i*5;
        const float* from=a+j;const float* to=b+j;
        if(from[0]!=to[0] || from[1]!=to[1]) {
            const float* pose=t<0.5f?from:to;
            for(int k=0;k<5;k++)r.animation[j+k]=pose[k];
            r.animation[j+2]+=ahead*pose[3];
            continue;
        }
        for(int k=0;k<5;k++)r.animation[j+k]=from[k]+(to[k]-from[k])*t;
        // Walk cycles wrap at their end. Advance through the wrap rather than rewinding.
        float length=0;bool repeating=false;
        if(r.ped) {
            CAnimBlendAssociation* assoc=nil;
            for(CAnimBlendAssociation* candidate=RpAnimBlendClumpGetFirstAssociation(r.ped->GetClump());candidate;candidate=RpAnimBlendGetNextAssociation(candidate))
                if(candidate->animId==int(to[1]) && candidate->groupId==int(to[0])){assoc=candidate;break;}
            if(assoc && assoc->hierarchy){length=assoc->hierarchy->totalLength;repeating=assoc->IsRepeating();}
        }
        float delta=to[2]-from[2];if(repeating && length>0 && delta< -length*0.5f)delta+=length;
        r.animation[j+2]=from[2]+delta*t+ahead*to[3];
        // Repeating cycles wrap below; a one-shot attack must hold its last frame.
    }
}
void VT_SetRemoteAim(int slot,const float* a,const float* b,float t) {
    if(slot<0 || slot>=7)return;
    Remote& r=peers[slot];r.aim[0]=b[0];r.aim[3]=b[3];
    r.aim[1]=a[1]+atan2f(sinf(b[1]-a[1]),cosf(b[1]-a[1]))*t;
    r.aim[2]=a[2]+(b[2]-a[2])*t;
}
int VT_ReadRemote(int slot, float* out) {
    if(slot < 0 || slot >= 7 || !out || !peers[slot].ped) return 0;
    const CVector& p = peers[slot].ped->GetPosition();
    out[0]=p.x; out[1]=p.y; out[2]=p.z;
    out[3]=peers[slot].ped->m_fRotationCur;
    const RwV3d* rendered=RwMatrixGetPos(RwFrameGetLTM(RpClumpGetFrame(peers[slot].ped->GetClump())));
    out[4]=rendered->x;out[5]=rendered->y;out[6]=rendered->z;
    out[7]=float(CVisibilityPlugins::GetClumpAlpha(peers[slot].ped->GetClump()));
    out[9]=FrontEndMenuManager.m_bMenuActive?1.0f:0.0f;
    out[8]=peers[slot].ped->m_fHealth;
    for(int i=10;i<20;i++)out[i]=0;
    CAnimBlendAssociation* locomotion=nil;CAnimBlendAssociation* hit=nil;CAnimBlendAssociation* fallback[2]={};int fallbackCount=0;
    for(CAnimBlendAssociation* a=RpAnimBlendClumpGetFirstAssociation(peers[slot].ped->GetClump());a;a=RpAnimBlendGetNextAssociation(a)) {
        if(a->blendAmount<0.05f)continue;
        const bool isLocomotion=!a->IsPartial()&&(a->animId==ANIM_STD_IDLE||a->animId==ANIM_STD_WALK||a->animId==ANIM_STD_RUN||a->animId==ANIM_STD_RUNFAST);
        if(isLocomotion){if(!locomotion||a->blendAmount>locomotion->blendAmount)locomotion=a;continue;}
        if(a->groupId==ASSOCGRP_STD&&syncedHitAnimation(a->animId)){if(!hit||a->blendAmount>hit->blendAmount)hit=a;continue;}
        if(fallbackCount<2)fallback[fallbackCount++]=a;
    }
    CAnimBlendAssociation* selected[2]={locomotion?locomotion:fallback[0],hit?hit:fallback[locomotion?0:1]};
    for(int record=0;record<2;record++)if(selected[record]){int j=10+record*5;out[j]=selected[record]->groupId;out[j+1]=selected[record]->animId;out[j+2]=selected[record]->currentTime;out[j+3]=selected[record]->speed;out[j+4]=selected[record]->blendAmount;}
    return 1;
}
int VT_ReadLocalSkeleton(float* out) {
    CPed* p=FindPlayerPed();if(!p || !p->m_rwObject)return 0;
    const CVector head=p->GetNodePosition(PED_HEAD),left=p->GetNodePosition(PED_FOOTL),right=p->GetNodePosition(PED_FOOTR);
    out[0]=(head-left).Magnitude();out[1]=(head-right).Magnitude();out[2]=(left-right).Magnitude();out[3]=p->m_fHealth;
    out[4]=float(p->m_nPedState);out[5]=float(p->m_objective);out[6]=p->bInVehicle?1:0;
    out[17]=head.x;out[18]=head.y;out[19]=head.z;
    out[11]=float(p->m_vehDoor);out[12]=p->m_pVehicleAnim?float(p->m_pVehicleAnim->animId):-1.0f;out[13]=p->m_pVehicleAnim?p->m_pVehicleAnim->currentTime:-1.0f;out[14]=p->m_pVehicleAnim?p->m_pVehicleAnim->blendAmount:0.0f;
    out[15]=-1.0f;out[16]=0.0f;float strongestHit=0.05f;
    for(CAnimBlendAssociation* a=RpAnimBlendClumpGetFirstAssociation(p->GetClump());a;a=RpAnimBlendGetNextAssociation(a))if(a->groupId==ASSOCGRP_STD&&syncedHitAnimation(a->animId)&&a->blendAmount>strongestHit){out[15]=float(a->animId);out[16]=a->currentTime;strongestHit=a->blendAmount;}
    if(p->m_pMyVehicle){CVehicle* car=p->m_pMyVehicle;out[7]=float(car->GetStatus());out[8]=car->pDriver==p?1:0;out[9]=car->m_fGasPedal;out[10]=car->GetMoveSpeed().Magnitude();if(car->IsCar())for(int i=0;i<6;i++)out[20+i]=((CAutomobile*)car)->Doors[i].m_fAngle;}
    return 1;
}
int VT_ReadRemoteSkeleton(int slot,float* out) {
    if(slot<0 || slot>=7 || !out || !peers[slot].ped)return 0;
    CPed* p=peers[slot].ped;
    if(CTimer::GetFrameCounter()-peers[slot].createdFrame<3||!p->m_rwObject||!p->GetClump())return 0;
    const CVector head=p->GetNodePosition(PED_HEAD),left=p->GetNodePosition(PED_FOOTL),right=p->GetNodePosition(PED_FOOTR);
    CVehicle* occupied=p->m_pMyVehicle;
    int actualSeat=-2;
    if(occupied){if(occupied->pDriver==p)actualSeat=-1;else for(int i=0;i<8;i++)if(occupied->pPassengers[i]==p){actualSeat=i;break;}}
    out[27]=p->bInVehicle?1.0f:0.0f;out[28]=p->bRenderPedInCar?1.0f:0.0f;
    out[29]=occupied?float(ViceTogetherWorldVehicleId(occupied)):-1.0f;out[30]=float(peers[slot].vehicle);out[31]=float(peers[slot].seat);out[32]=float(peers[slot].appliedSeat);out[33]=float(actualSeat);
    out[0]=(head-left).Magnitude();out[1]=(head-right).Magnitude();out[2]=(left-right).Magnitude();
    out[3]=p->m_fHealth;out[4]=0;out[5]=0;
    out[17]=head.x;out[18]=head.y;out[19]=head.z;
    const RemoteTagObservation& tag=remoteTagObservations[slot];
    if(tag.drawn&&uint32(CTimer::GetFrameCounter()-tag.frame)<=10){
        // These are coordinates captured from the actual render hook, not a
        // second projection/layout calculation. The test can therefore detect
        // a name/bar mismatch that the renderer itself introduced.
        out[20]=tag.nameLeft;out[21]=tag.nameY;out[22]=tag.healthY;out[23]=1.0f;
        out[24]=tag.nameLeft;out[25]=tag.healthLeft;out[26]=tag.nameWidth;
        if(!p->bInVehicle){out[28]=tag.headY;out[29]=tag.headX;}
    }
    out[9]=peers[slot].aim[0];out[10]=peers[slot].aim[1];out[11]=peers[slot].aim[2];
    const int color=peers[slot].color;out[6]=float(color);out[7]=float(outfitDraws[color]);out[8]=float(outfitTexels[color]);
    out[12]=0;
    out[13]=float(p->GetWeapon()->m_eWeaponType);out[14]=float(p->m_wepModelID);out[15]=p->m_pWeaponModel?1:0;out[16]=float(peers[slot].weaponDraws);
    for(CAnimBlendAssociation* a=RpAnimBlendClumpGetFirstAssociation(p->GetClump());a;a=RpAnimBlendGetNextAssociation(a)) {
        out[a->IsPartial()?5:4]+=a->blendAmount;
        if(a->groupId==ASSOCGRP_STD && a->animId>=ANIM_STD_JUMP_LAUNCH && a->animId<=ANIM_STD_JUMP_LAND && a->blendAmount>0.1f)out[12]=1;
    }
    return 1;
}
}

bool ViceTogetherIsRemote(const CPed* ped) {
    for(int i=0;i<7;i++) if(peers[i].ped==ped) return true;
    return false;
}
CPed* ViceTogetherRemotePed(int slot) {
    return slot>=0 && slot<7 && peers[slot].active ? peers[slot].ped : nil;
}
void ViceTogetherWeaponRendered(CPed* ped){for(auto& peer:peers)if(peer.ped==ped)peer.weaponDraws++;}
extern "C" void VT_SendWorldDamage(int slot,float amount);
extern "C" void VT_SendWorldMelee(unsigned target,int weapon,float amount);
extern "C" void VT_ApplyWorldMelee(unsigned slot,const float* state);
extern "C" void VT_ReportWorldMeleeValidation(unsigned slot,float stage,unsigned target,float distance,float health);
void ViceTogetherReportHealthLoss(CPed* victim,float before){const char* role=getenv("VT_WORLD_HOST");if(enabled && role && atoi(role)==1 && victim==FindPlayerPed() && before>victim->m_fHealth)VT_SendWorldDamage(7,before-victim->m_fHealth);}
bool ViceTogetherReportDamage(CPed* victim,CEntity* attacker,int weapon,float amount) {
    if(!enabled)return false;
    if(attacker==FindPlayerPed() && ViceTogetherWorldPed(victim)) {
        const char* role=getenv("VT_WORLD_HOST");
        const int target=ViceTogetherWorldPedId(victim);
        if(target>=0 && role && atoi(role)==0) {
            if(weapon>=WEAPONTYPE_UNARMED && weapon<=WEAPONTYPE_CHAINSAW && std::isfinite(amount) && amount>0) {
                VT_SendWorldMelee(unsigned(target),weapon,amount);
                CPlayerPed* player=FindPlayerPed();if(player && player->m_pWanted && player->m_pWanted->GetWantedLevel()<1)player->SetWantedLevelNoDrop(1);
            }
            // The host owns this NPC's health, reaction and death animation.
            // Instant-hit weapons arrive through the separately checked shot path.
            return true;
        }
    }
    for(int i=0;i<7;i++)if(peers[i].ped==victim) {
        const bool melee=weapon>=WEAPONTYPE_UNARMED&&weapon<=WEAPONTYPE_CHAINSAW;
        const bool instant=weapon>=0&&weapon<WEAPONTYPE_TOTALWEAPONS&&CWeaponInfo::GetWeaponInfo(eWeaponType(weapon))->m_eWeaponFire==WEAPON_FIRE_INSTANT_HIT;
        if(attacker==FindPlayerPed() && (melee||instant) && peers[i].health>0 && std::isfinite(amount) && amount>0)VT_SendHit(i,weapon,amount);
        else {const char* role=getenv("VT_WORLD_HOST");if(role && atoi(role)==1 && (!attacker || !attacker->IsPed() || !ViceTogetherIsRemote((CPed*)attacker)) && (attacker!=FindPlayerPed() || weapon==WEAPONTYPE_EXPLOSION) && peers[i].health>0 && std::isfinite(amount) && amount>0)VT_SendWorldDamage(i,amount*0.33f);}
        return true;
    }
    return false;
}
extern "C" void VT_ApplyWorldMelee(unsigned slot,const float* state) {
    const char* role=getenv("VT_WORLD_HOST");
    if(!enabled || !role || atoi(role)!=1 || slot>=7 || !state)return;
    for(int i=0;i<3;i++)if(!std::isfinite(state[i]))return;
    if(state[0]<0 || state[0]>=16777216 || state[0]!=floorf(state[0]) || state[1]<WEAPONTYPE_UNARMED || state[1]>WEAPONTYPE_CHAINSAW || state[1]!=floorf(state[1]) || state[2]<=0 || state[2]>250)return;
    const unsigned targetId=unsigned(state[0]);const int weapon=int(state[1]);
    VT_ReportWorldMeleeValidation(slot,1,targetId,0,state[2]);
    static uint32 lastMelee[7]={};const uint32 now=CTimer::GetTimeInMilliseconds();
    if(lastMelee[slot] && now-lastMelee[slot]<180)return;
    CPed* attacker=peers[slot].ped;CPed* target=nil;
    if(!attacker || peers[slot].health<=0 || attacker->DyingOrDead() || attacker->bInVehicle || !ViceTogetherWorldHostPed(targetId,&target)){VT_ReportWorldMeleeValidation(slot,2,targetId,-1,attacker?peers[slot].health:0);return;}
    const CVector origin=attacker->GetPosition(),position=target->GetPosition();
    // Remote replicas are interpolated from 50 ms player frames and 100 ms world frames.
    // The bounded 3.3 m contact envelope absorbs that display delay while LOS remains authoritative.
    const float distance=(origin-position).Magnitude();if(distance>3.3f){VT_ReportWorldMeleeValidation(slot,2,targetId,distance,peers[slot].health);return;}
    CColPoint obstructionPoint={};CEntity* obstruction=nil;CEntity* oldIgnore=CWorld::pIgnoreEntity;CWorld::pIgnoreEntity=attacker;
    const bool blocked=CWorld::ProcessLineOfSight(origin+CVector(0,0,0.8f),position+CVector(0,0,0.8f),obstructionPoint,obstruction,true,true,false,true,true,false);
    CWorld::pIgnoreEntity=oldIgnore;
    if(blocked && obstruction && obstruction!=target && (obstructionPoint.point-origin).MagnitudeSqr()+0.12f<(position-origin).MagnitudeSqr()){VT_ReportWorldMeleeValidation(slot,3,targetId,distance,float(obstruction->GetModelIndex()));return;}
    lastMelee[slot]=now;
    target->ReactToAttack(attacker);
    const float damage=std::max(1.0f,std::min(80.0f,float(CWeaponInfo::GetWeaponInfo(eWeaponType(weapon))->m_nDamage)));
    CVector2D direction(attacker->GetPosition()-target->GetPosition());const int localDirection=target->GetLocalDirection(direction);
    const float before=target->m_fHealth;
    VT_ReportWorldMeleeValidation(slot,3,targetId,distance,before);
    target->InflictDamage(attacker,eWeaponType(weapon),damage,PEDPIECE_TORSO,uint8(std::max(0,std::min(3,localDirection))));
    if(target->m_fHealth<before)ViceTogetherWorldPrioritizePed(targetId);
    VT_ReportWorldMeleeValidation(slot,target->m_fHealth<before?4:5,targetId,distance,target->m_fHealth);
    if(target->m_fHealth<before)VT_ReportWorldHit(0,target->m_fHealth);
}
extern "C" void VT_SendShot(int weapon,const CVector& source,const CVector& end,bool hit,const CVector& normal,int hitKind);
void ViceTogetherReportShot(CEntity* shooter,int weapon,const CVector& source,const CVector& end,bool hit,const CVector& normal,int hitKind) {
    if(!enabled || shooter!=FindPlayerPed() || weapon<0 || weapon>=WEAPONTYPE_TOTALWEAPONS || CWeaponInfo::GetWeaponInfo(eWeaponType(weapon))->m_eWeaponFire!=WEAPON_FIRE_INSTANT_HIT)return;
    CPlayerPed* player=FindPlayerPed();if(hit && hitKind==1 && player && player->m_pWanted && player->m_pWanted->GetWantedLevel()<1)player->SetWantedLevelNoDrop(1);
    VT_SendShot(weapon,source,end,hit,normal,hitKind);
}
namespace {
struct Outfit { RwTexture* original; RwTexture* texture; int color; };
std::vector<Outfit> outfits;
RwTexture* outfitTexture(RwTexture* original,int color) {
    if(!original || color==0 || !RwTextureGetRaster(original)) return original;
    for(const Outfit& item:outfits)if(item.original==original && item.color==color)return item.texture;
    RwImage* image=RwTextureGetRaster(original)->toImage();if(!image)return original;
    image->convertTo32();
    static const unsigned char colors[8][3]={{90,220,210},{245,75,80},{75,220,95},{100,135,250},{235,90,220},{240,190,65},{180,110,250},{225,225,225}};
    // Replace cyan/blue shirt texels, preserving skin tones, alpha and texture detail.
    unsigned int changed=0;
    for(int y=0;y<image->height;y++)for(int x=0;x<image->width;x++) {
        unsigned char* p=image->pixels+y*image->stride+x*4;
        if(p[1]>p[0]*1.12f && p[2]>p[0]*1.08f && p[1]>40) {
            changed++;
            const int light=std::max(p[1],p[2]);
            for(int c=0;c<3;c++)p[c]=(unsigned char)(colors[color][c]*light/255);
        }
    }
    int w,h,d,flags;RwImageFindRasterFormat(image,rwRASTERTYPETEXTURE,&w,&h,&d,&flags);
    RwRaster* raster=RwRasterCreate(w,h,d,flags);
    if(!raster){RwImageDestroy(image);return original;}
    RwRasterSetFromImage(raster,image);RwImageDestroy(image);
    RwTexture* texture=RwTextureCreate(raster);
    texture->filterAddressing=original->filterAddressing;
    outfitTexels[color]+=changed;
    outfits.push_back({original,texture,color});return texture;
}
struct ClothingDraw { int color; std::vector<std::pair<RpMaterial*,RwTexture*> > materials; };
RpMaterial* tintMaterial(RpMaterial* material,void* data) {
    ClothingDraw* draw=(ClothingDraw*)data;
    for(const auto& saved:draw->materials)if(saved.first==material)return material;
    RwTexture* original=RpMaterialGetTexture(material);
    if(original){draw->materials.push_back({material,original});RpMaterialSetTexture(material,outfitTexture(original,draw->color));}
    return material;
}
RpAtomic* tintAtomic(RpAtomic* atomic,void* data) {
    RpGeometryForAllMaterials(RpAtomicGetGeometry(atomic),tintMaterial,data);return atomic;
}
}
bool ViceTogetherRenderBody(CPed* ped) {
    if(!enabled)return false;
    int color=-1;
    if(ped==FindPlayerPed())color=localColor;
    else for(int i=0;i<7;i++)if(peers[i].ped==ped)color=peers[i].color;
    if(color<=0 || !ped->GetClump())return false;
    ClothingDraw draw={color,{}};
    RpClumpForAllAtomics(ped->GetClump(),tintAtomic,&draw);
    // The player render callback overrides every material with the active skin.
    // Scope that override too, or it silently undoes the per-player recoloring.
    RwTexture* skin=CWorld::Players[0].m_pSkinTexture;
    if(skin)CWorld::Players[0].m_pSkinTexture=outfitTexture(skin,color);
    ped->CEntity::Render();
    CWorld::Players[0].m_pSkinTexture=skin;
    outfitDraws[color]++;
    for(const auto& saved:draw.materials)RpMaterialSetTexture(saved.first,saved.second);
    return true;
}
void ViceTogetherDrawNames() {
    if(!enabled) return;
    const uint32 frame=CTimer::GetFrameCounter();
    for(auto& observation:remoteTagObservations){observation.frame=frame;observation.drawn=false;}
    const CFontDetails saved=CFont::Details;
    CFont::SetFontStyle(FONT_STANDARD); CFont::SetScale(SCREEN_SCALE_X(remoteTagScaleX), SCREEN_SCALE_Y(remoteTagScaleY));
    CFont::SetCentreOff(); CFont::SetWrapx(SCREEN_WIDTH); CFont::SetJustifyOff();
    CFont::SetRightJustifyOff(); CFont::SetBackgroundOff(); CFont::SetPropOn();
    CFont::SetAlphaFade(255.0f); CFont::SetDropShadowPosition(0);
    for(int i=0;i<7;i++) {
        CPed* ped=peers[i].ped;
        if(!ped || !peers[i].active) continue;
        const CVector position=ped->GetPosition();
        if((position-TheCamera.GetPosition()).MagnitudeSqr()>60.0f*60.0f) continue;
        RwV3d screen;
        if(!remoteTagProjection(ped,&screen) || screen.x<0 || screen.x>SCREEN_WIDTH || screen.y<0 || screen.y>SCREEN_HEIGHT) continue;
        const char* label=peers[i].name;
        if(!label || !label[0]) label="Player";
        wchar text[32]; AsciiToUnicode(label,text);
        const float labelWidth=std::max(SCREEN_SCALE_X(12.0f),CFont::GetStringWidth(text,true));
        const RemoteTagLayout tag=remoteTagLayout(screen);
        const float labelLeft=tag.centerX-labelWidth*0.5f;
        if(labelLeft<0 || labelLeft+labelWidth>SCREEN_WIDTH || tag.nameY<0)continue;
        CFont::SetColor(CRGBA(230,244,240,255));
        CFont::PrintString(labelLeft,tag.nameY,text);
        const float healthWidth=labelWidth*std::max(0.0f,std::min(1.0f,peers[i].health/100.0f));
        const float healthLeft=labelLeft, y=tag.healthY, height=SCREEN_SCALE_Y(2.0f);
        if(healthWidth>0.0f)CSprite2d::DrawRect(CRect(healthLeft,y,healthLeft+healthWidth,y+height),peers[i].health<30?CRGBA(240,91,104,240):CRGBA(100,215,174,240));
        remoteTagObservations[i]={frame,true,labelLeft,labelWidth,tag.nameY,healthLeft,tag.healthY,tag.centerX,tag.headY};
    }
    CFont::Details=saved;
    drawModMenu();
    drawNetworkStatus();
}

void ViceTogetherTick() {
    if(modMenuAction>=0){const int action=modMenuAction;modMenuAction=-1;if(action==0)WeaponCheat1();else if(action==1)WeaponCheat2();else if(action==2)WeaponCheat3();else if(action==2006&&!menuHost())VT_SendSharedCheatRequest(2);else if(menuHost())ViceTogetherWorldMenuAction(action);else if(action<2000)ViceTogetherWorldRequestVehicle(action-1000);}
    ViceTogetherWorldMenuTick();
    ViceTogetherNetworkTick();
    ViceTogetherWorldTick();
    if(getenv("VT_FOLLOW_PLAYER") || getenv("VT_MUTE")){DMAudio.SetEffectsMasterVolume(0);DMAudio.SetMusicMasterVolume(0);}
    CPlayerPed* player = FindPlayerPed();
    if (!player || !player->m_rwObject) return;
    if(player->m_pWanted){const int current=std::max(0,std::min(6,player->m_pWanted->GetWantedLevel()));if(localWantedLevel<0 || lastAppliedWantedLevel<0 || current!=lastAppliedWantedLevel)localWantedLevel=current;int shared=localWantedLevel;if(enabled)for(const Remote& peer:peers)if(peer.active)shared=std::max(shared,peer.wanted);if(shared!=current)player->SetWantedLevel(shared);lastAppliedWantedLevel=shared;}
    if(enabled && !loadoutGiven && (!getenv("VT_TEST_COMBAT") || getenv("VT_TEST_GUN"))) {
        const int model=CWeaponInfo::GetWeaponInfo(WEAPONTYPE_COLT45)->m_nModelId;
        CStreaming::RequestModel(model,STREAMFLAGS_DONT_REMOVE);
        if(CStreaming::HasModelLoaded(model)) {
            player->GiveWeapon(WEAPONTYPE_COLT45,120);player->SetCurrentWeapon(WEAPONTYPE_COLT45);loadoutGiven=true;
        }
    }
    for (int i = 0; i < 7; ++i) {
        Remote& r = peers[i];
        if (!enabled || !r.active) {
            if(r.radarBlip!=-1){CRadar::ClearBlip(r.radarBlip);r.radarBlip=-1;}
            if (r.ped) {
                CWorld::Remove(r.ped);
                delete r.ped;
                r.ped = nil;
            }
            continue;
        }
        if (!r.ped) {
            if(r.radarBlip!=-1){CRadar::ClearBlip(r.radarBlip);r.radarBlip=-1;}
            // The player's model is already resident. Do not request another skin synchronously.
            r.ped = new CPed(PEDTYPE_CIVMALE);
            r.createdFrame=CTimer::GetFrameCounter();
            r.ped->SetModelIndex(player->GetModelIndex());
            r.ped->CharCreatedBy = MISSION_CHAR;
            r.ped->bRespondsToThreats = false;
            r.ped->bUsesCollision = true;
            r.ped->m_animGroup = ASSOCGRP_PLAYER;
            r.ped->RegisterReference((CEntity**)&r.ped);
            r.ped->SetPosition(r.x, r.y, r.z);
            CWorld::Add(r.ped);
        }
        // Local AI/world simulation is not authoritative for a remote player.
        if(r.health>0 && r.ped->DyingOrDead()) {
            if(r.radarBlip!=-1){CRadar::ClearBlip(r.radarBlip);r.radarBlip=-1;}
            CWorld::Remove(r.ped);delete r.ped;r.ped=nil;continue;
        }
        // Stock entity blips follow the same remote ped on both radar and pause map,
        // including its seated position. BLIP_ONLY avoids an extra world marker.
        if(r.radarBlip==-1){
            r.radarBlip=CRadar::SetEntityBlip(BLIP_CHAR,CPools::GetPedPool()->GetIndex(r.ped),RADAR_TRACE_GREEN,BLIP_DISPLAY_BLIP_ONLY);
            if(r.radarBlip!=-1){CRadar::ChangeBlipColour(r.radarBlip,RADAR_TRACE_GREEN);CRadar::ChangeBlipScale(r.radarBlip,2);}
        }
        r.ped->m_fHealth=r.health;
        if(int(r.ped->GetWeapon()->m_eWeaponType)!=r.weapon) {
            const int model=CWeaponInfo::GetWeaponInfo(eWeaponType(r.weapon))->m_nModelId;
            if(model>=0)CStreaming::RequestModel(model,STREAMFLAGS_DONT_REMOVE);
            if(model<0 || CStreaming::HasModelLoaded(model)) {r.ped->GiveWeapon(eWeaponType(r.weapon),120);r.ped->SetCurrentWeapon(eWeaponType(r.weapon));}
        }
        // A logical weapon selection is insufficient after a model was removed
        // during entry/exit or streaming. Repair the actual hand-held atomic.
        const int expectedWeaponModel=CWeaponInfo::GetWeaponInfo(eWeaponType(r.weapon))->m_nModelId;
        if(r.weaponVisible && expectedWeaponModel>=0 && (!r.ped->m_pWeaponModel || r.ped->m_wepModelID!=expectedWeaponModel)){CStreaming::RequestModel(expectedWeaponModel,STREAMFLAGS_DONT_REMOVE);if(CStreaming::HasModelLoaded(expectedWeaponModel)){if(r.ped->m_pWeaponModel)r.ped->RemoveWeaponModel(-1);r.ped->AddWeaponModel(expectedWeaponModel);}}
        if(!r.weaponVisible && r.ped->m_pWeaponModel)r.ped->RemoveWeaponModel(-1);
        if(r.health<=0) {
            if(!r.ped->DyingOrDead())r.ped->SetDie();
            // Death does not revoke the sender's authority over its body transform.
            CWorld::Remove(r.ped);
            r.ped->SetPosition(r.x,r.y,r.z);
            CWorld::Add(r.ped);
            r.ped->GetMatrix().UpdateRW();r.ped->UpdateRwFrame();
            continue;
        }
        CVehicle* car=r.vehicle>=0?ViceTogetherWorldFindVehicle(unsigned(r.vehicle)):nil;
        bool correctSeat=false;
        if(car && r.ped->m_pMyVehicle==car){
            if(r.seat<0)correctSeat=car->pDriver==r.ped;
            else correctSeat=r.seat<car->m_nNumMaxPassengers && r.seat<8 && car->pPassengers[r.seat]==r.ped;
        }
        if(r.ped->m_pMyVehicle!=car || (car && (r.appliedSeat!=r.seat || !correctSeat))){
            if(r.ped->m_pMyVehicle){if(r.ped->m_pMyVehicle->pDriver==r.ped)r.ped->m_pMyVehicle->RemoveDriver();else r.ped->m_pMyVehicle->RemovePassenger(r.ped);}
            r.ped->m_pMyVehicle=nil;
            if(car){bool seated=false;if(r.seat<0 && (!car->pDriver || car->pDriver==r.ped)){car->SetDriver(r.ped);seated=car->pDriver==r.ped;}else if(r.seat>=0 && r.seat<car->m_nNumMaxPassengers && r.seat<8 && (!car->pPassengers[r.seat] || car->pPassengers[r.seat]==r.ped))seated=car->AddPassenger(r.ped,uint8(r.seat)) && car->pPassengers[r.seat]==r.ped;if(seated){r.ped->m_pMyVehicle=car;car->RegisterReference((CEntity**)&r.ped->m_pMyVehicle);r.appliedSeat=r.seat;}else{r.appliedSeat=-2;car=nil;}}
        }
        r.ped->bInVehicle=car!=nil;r.ped->bUsesCollision=car==nil;
        r.ped->SetPedState(car?PED_DRIVING:PED_IDLE);
        r.ped->SetMoveState((eMoveState)r.move);
        if(!car)r.ped->SetMoveAnim();
        // Build selected associations first: BlendAnimation can fade an earlier selection.
        CAnimBlendAssociation* selected[4]={};float weights[4]={};
        for(int j=0;j<20;j+=5) {
            const int group=int(r.animation[j]),id=int(r.animation[j+1]);
            // Bounds-check against resident associations before AddAnimation;
            // its stock lookup does not check IDs. Narrow hand-written lists
            // previously rejected jumping and armed strafing entirely.
            if(!registeredAnimation(group,id) || r.animation[j+4]<=0)continue;
            CAnimBlendAssociation* assoc=nil;
            for(CAnimBlendAssociation* candidate=RpAnimBlendClumpGetFirstAssociation(r.ped->GetClump());candidate;candidate=RpAnimBlendGetNextAssociation(candidate))
                if(candidate->animId==id && candidate->groupId==group){assoc=candidate;break;}
            // Stock BlendAnimation searches only by ID, so different directional
            // groups can alias one pointer and accidentally halve the base weight.
            if(!assoc)assoc=CAnimManager::AddAnimation(r.ped->GetClump(),(AssocGroupId)group,(AnimationId)id);
            if(assoc && assoc->hierarchy && assoc->hierarchy->totalLength>0) {
                selected[j/5]=assoc;weights[j/5]=std::max(0.0f,std::min(1.0f,r.animation[j+4]));
                assoc->speed=std::max(0.0f,std::min(3.0f,r.animation[j+3]));
                const float phase=std::max(0.0f,r.animation[j+2]),length=assoc->hierarchy->totalLength;
                assoc->SetCurrentTime(assoc->IsRepeating()?fmodf(phase,length):std::min(phase,std::max(0.0f,length-0.001f)));
            }
        }
        for(int j=0;j<4;j++)for(int k=j+1;k<4;k++)if(selected[j] && selected[j]==selected[k]){weights[j]+=weights[k];selected[k]=nil;weights[k]=0;}
        float base=0,partial=0;
        for(int j=0;j<4;j++)if(selected[j]){if(selected[j]->IsPartial())partial+=weights[j];else base+=weights[j];}
        if(base<0.001f) {
            selected[0]=CAnimManager::BlendAnimation(r.ped->GetClump(),ASSOCGRP_STD,ANIM_STD_IDLE,8.0f);
            weights[0]=1; base=1;
        }
        // Fading abandoned partials can exceed weight 1 and collapse the base pose.
        // These proxies are entirely network-driven; retire unselected poses immediately.
        for(CAnimBlendAssociation* a=RpAnimBlendClumpGetFirstAssociation(r.ped->GetClump());a;a=RpAnimBlendGetNextAssociation(a)) {
            if(a!=selected[0] && a!=selected[1] && a!=selected[2] && a!=selected[3]) {a->blendAmount=0;a->blendDelta=-8;a->flags|=ASSOC_DELETEFADEDOUT;}
        }
        for(int j=0;j<4;j++)if(selected[j]) {
            selected[j]->blendAmount=weights[j]/(selected[j]->IsPartial()?std::max(1.0f,partial):base);
            selected[j]->blendDelta=0;
            selected[j]->flags&=~(ASSOC_FADEOUTWHENDONE|ASSOC_DELETEFADEDOUT);
        }
        r.ped->SetMoveSpeed(0.0f, 0.0f, 0.0f);
        r.ped->bIsStanding = car==nil;
        CWorld::Remove(r.ped);
        r.ped->SetPosition(r.x, r.y, r.z);
        CWorld::Add(r.ped);
        r.ped->m_fRotationCur = r.ped->m_fRotationDest = r.heading;
        r.ped->SetOrientation(0.0f, 0.0f, r.heading);
        if(car){r.ped->bRenderPedInCar=true;r.ped->bChangedSeat=false;r.ped->SetPedPositionInCar();}
        // Network transforms must reach the actual RenderWare frame, not only shadows/collision.
        r.ped->GetMatrix().UpdateRW();
        r.ped->UpdateRwFrame();
        if(CWeaponInfo::GetWeaponInfo(eWeaponType(r.weapon))->IsFlagSet(WEAPONFLAG_CANAIM) && r.aim[0]>0) {
            if(r.aim[3]>0)r.ped->m_pedIK.m_flags|=CPedIK::AIMS_WITH_ARM;
            else r.ped->m_pedIK.m_flags&=~CPedIK::AIMS_WITH_ARM;
            r.ped->m_pedIK.PointGunInDirection(r.aim[1],r.aim[2]);
        }
    }
    ViceTogetherFlushShots();
}
