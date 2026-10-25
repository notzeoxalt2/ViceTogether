#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <winsock2.h>
#include <windows.h>
#include "common.h"
#include "ViceTogether.h"
#include "ViceTogetherWorld.h"
#include "Pad.h"
#include "PlayerPed.h"
#include "Vehicle.h"
#include "World.h"
#include "Camera.h"
#include "PathFind.h"
#include <cstdlib>
#include <cmath>
#include <cstring>
#include <algorithm>
#include <cstdio>
#include <vector>
#pragma comment(lib, "ws2_32.lib")
extern "C" {
void VT_Enable(int value);
int VT_ReadLocal(float* out);
void VT_SetRemote(int slot,float x,float y,float z,float heading,int move);
void VT_RemoveRemote(int slot);
void VT_SetRemoteName(int slot,const char* name,int color);
void VT_SetLocalColor(int color);
void VT_SetRemoteAnimation(int slot,const float* a,const float* b,float t,float ahead);
void VT_SetRemoteHealth(int slot,float health);
void VT_SetRemoteWanted(int slot,int level);
void VT_ApplyLocalHealth(float health);
int VT_ReadRemote(int slot,float* out);
int VT_ReadRemoteSkeleton(int slot,float* out);
int VT_ReadLocalSkeleton(float* out);
void VT_ReadWindow(float* out);
int VT_ReadWeapon();
int VT_ReadWeaponVisible();
int VT_ReadWanted();
void VT_SetRemoteWeapon(int slot,int weapon);
void VT_SetRemoteWeaponVisible(int slot,int visible);
void VT_SetRemoteVehicle(int slot,int vehicle,int seat);
void VT_TestGunAim();
void VT_SetRemoteAim(int slot,const float* a,const float* b,float t);
int VT_PlayRemoteShot(int slot,const float* data);
}
namespace {
const unsigned MAGIC=0x31545656;
struct Wire { unsigned magic,type,slot; float state[34]; };
static_assert(sizeof(Wire)==148,"Wire layout changed");
struct Snapshot { bool live; int count; DWORD times[8]; float states[8][34]; float jitter,delay; DWORD playback; };
Snapshot history[7]={};
SOCKET bridge=INVALID_SOCKET;
sockaddr_in launcher={};
bool attempted=false;
DWORD lastSent=0,testStart=0;
struct DelayedShot{Wire wire;DWORD due;};std::vector<DelayedShot> delayedShots;
DWORD clockMs() {
    static LARGE_INTEGER frequency={}; if(!frequency.QuadPart) QueryPerformanceFrequency(&frequency);
    LARGE_INTEGER now; QueryPerformanceCounter(&now);
    return DWORD(now.QuadPart*1000/frequency.QuadPart);
}
void sendWorld(unsigned type,unsigned id,const float* state) {
    Wire wire={};wire.magic=MAGIC;wire.type=type;wire.slot=id;
    std::memcpy(wire.state,state,sizeof(wire.state));
    sendto(bridge,(const char*)&wire,sizeof(wire),0,(sockaddr*)&launcher,sizeof(launcher));
}
void reportPerformance(DWORD now) {
    static LARGE_INTEGER frequency={},previous={};
    static DWORD since=0; static unsigned frames=0,count=0; static float intervals[512];
    if(!frequency.QuadPart) QueryPerformanceFrequency(&frequency);
    LARGE_INTEGER q;QueryPerformanceCounter(&q);
    if(previous.QuadPart && count<512) intervals[count++]=float((q.QuadPart-previous.QuadPart)*1000.0/double(frequency.QuadPart));
    previous=q;frames++;
    if(!since)since=now;
    if(now-since<1000)return;
    Wire perf={};perf.magic=MAGIC;perf.type=6;
    perf.state[0]=frames*1000.0f/float(now-since);
    std::sort(intervals,intervals+count);perf.state[1]=count?intervals[(count-1)*95/100]:0;
    VT_ReadWindow(perf.state+2);
    sendto(bridge,(const char*)&perf,sizeof(perf),0,(sockaddr*)&launcher,sizeof(launcher));
    frames=count=0;since=now;
}
void init() {
    attempted=true;
    if(getenv("VT_TEST_COMBAT")){FILE* f=fopen("native-network.log","a");if(f){fprintf(f,"init port=%s\n",getenv("VT_PORT"));fclose(f);}}
    const char* setting=getenv("VT_PORT");if(!setting)return;
    const int port=atoi(setting);if(port<1024||port>65535)return;
    WSADATA data;if(WSAStartup(MAKEWORD(2,2),&data)!=0)return;
    bridge=socket(AF_INET,SOCK_DGRAM,IPPROTO_UDP);if(bridge==INVALID_SOCKET)return;
    sockaddr_in local={};local.sin_family=AF_INET;local.sin_addr.s_addr=htonl(INADDR_LOOPBACK);
    if(bind(bridge,(sockaddr*)&local,sizeof(local))!=0){closesocket(bridge);bridge=INVALID_SOCKET;return;}
    u_long nonblocking=1;ioctlsocket(bridge,FIONBIO,&nonblocking);
    const int receiveBytes=262144;setsockopt(bridge,SOL_SOCKET,SO_RCVBUF,(const char*)&receiveBytes,sizeof(receiveBytes));
    launcher.sin_family=AF_INET;launcher.sin_addr.s_addr=htonl(INADDR_LOOPBACK);launcher.sin_port=htons((u_short)port);
    VT_Enable(1);
    lastSent=clockMs();
}
}
extern "C" void VT_SendHit(int slot,int weapon) {
    if(bridge==INVALID_SOCKET || slot<0 || slot>=7)return;
    Wire hit={};hit.magic=MAGIC;hit.type=9;hit.slot=slot;hit.state[0]=float(weapon);
    float local[34]={},remote[20]={};
    if(!VT_ReadLocal(local) || !VT_ReadRemote(slot,remote))return;
    for(int i=0;i<3;i++){hit.state[1+i]=local[i];hit.state[4+i]=remote[i];}
    sendto(bridge,(const char*)&hit,sizeof(hit),0,(sockaddr*)&launcher,sizeof(launcher));
}
extern "C" void VT_SendShot(int weapon,const CVector& source,const CVector& end,bool hit,const CVector& normal,int hitKind) {
    if(bridge==INVALID_SOCKET)return;
    Wire shot={};shot.magic=MAGIC;shot.type=14;shot.state[0]=float(weapon);
    shot.state[1]=source.x;shot.state[2]=source.y;shot.state[3]=source.z;
    shot.state[4]=end.x;shot.state[5]=end.y;shot.state[6]=end.z;shot.state[7]=hit?1.0f:0;
    shot.state[8]=normal.x;shot.state[9]=normal.y;shot.state[10]=normal.z;shot.state[11]=float(hitKind);
    sendto(bridge,(const char*)&shot,sizeof(shot),0,(sockaddr*)&launcher,sizeof(launcher));
}
extern "C" void VT_SendSeatRequest(unsigned id){float state[34]={};sendWorld(30,id,state);}
extern "C" void VT_SendDriverRequest(unsigned id){float state[34]={};state[0]=-1;sendWorld(30,id,state);}
extern "C" void VT_SendVehicleSpawnRequest(int model){if(bridge==INVALID_SOCKET||model<0||model>=6500)return;float state[34]={};state[0]=float(model);sendWorld(55,0,state);}
extern "C" void VT_SendSharedCheatRequest(int cheatId){if(bridge==INVALID_SOCKET||(cheatId!=1&&cheatId!=2))return;float state[34]={};state[0]=float(cheatId);sendWorld(57,0,state);}
extern "C" void VT_SendWorldDamage(int slot,float amount){if(bridge==INVALID_SOCKET || slot<0 || slot>7 || !std::isfinite(amount) || amount<=0)return;float state[34]={};state[0]=std::min(100.0f,amount);sendWorld(36,unsigned(slot),state);}
extern "C" void VT_SendWorldMelee(unsigned target,int weapon,float amount){if(bridge==INVALID_SOCKET || target>=16777216 || weapon<WEAPONTYPE_UNARMED || weapon>WEAPONTYPE_CHAINSAW || !std::isfinite(amount) || amount<=0 || amount>250)return;float state[34]={};state[0]=float(weapon);state[1]=amount;sendWorld(47,target,state);}
extern "C" void VT_ReportWorldMeleeValidation(unsigned slot,float stage,unsigned target,float distance,float health){if(bridge==INVALID_SOCKET || !getenv("VT_TEST_GUEST_NPC_MELEE"))return;float state[34]={};state[0]=stage;state[1]=float(target);state[2]=distance;state[3]=health;sendWorld(51,slot,state);}
extern "C" void VT_ApplyWorldMelee(unsigned slot,const float* state);
extern "C" void VT_SendGlassRequest(const float* state){if(bridge!=INVALID_SOCKET)sendWorld(40,0,state);}
extern "C" void VT_ReportWorldHit(int kind,float health){float state[34]={};state[0]=health;if(bridge!=INVALID_SOCKET)sendWorld(45,unsigned(kind),state);}
void ViceTogetherFlushShots(){const DWORD now=clockMs();for(auto it=delayedShots.begin();it!=delayedShots.end();){if(int(now-it->due)<0){++it;continue;}if(VT_PlayRemoteShot(it->wire.slot,it->wire.state)){Wire played=it->wire;played.type=16;sendto(bridge,(const char*)&played,sizeof(played),0,(sockaddr*)&launcher,sizeof(launcher));}it=delayedShots.erase(it);}}
void ViceTogetherBeforeWorld() {
    if(getenv("VT_TEST_GUEST_FAR_WORLD") && !getenv("VT_TEST_FAR_WORLD_DONE") && getenv("VT_WORLD_HOST") && atoi(getenv("VT_WORLD_HOST"))==0){
        static bool movedFar=false;float host[20]={};CPlayerPed* player=FindPlayerPed();
        if(!movedFar && player && VT_ReadRemote(0,host)){
            const CVector base(host[0],host[1],host[2]);const CVector offsets[]={CVector(600,0,0),CVector(-600,0,0),CVector(0,600,0),CVector(0,-600,0)};
            for(const CVector& offset:offsets){const CVector target=base+offset;const int node=ThePaths.FindNodeClosestToCoors(target,PATH_CAR,150.0f);if(node<0)continue;const CVector road=ThePaths.m_pathNodes[node].GetPosition();if((road-base).Magnitude()<400.0f)continue;player->Teleport(road+CVector(0,0,1));movedFar=true;break;}
        }
    }
    if(getenv("VT_INPUT_DISABLED")){CPad::GetPad(0)->NewState.Clear();return;}
    if(getenv("VT_TEST_GUEST_NPC_MELEE")){CPad::GetPad(0)->NewState.Clear();return;}
    if(getenv("VT_FOLLOW_PLAYER")) {
        CPad* pad=CPad::GetPad(0);pad->NewState.Clear();
        CPlayerPed* player=FindPlayerPed();float leader[20]={};
        if(!player || player->DyingOrDead() || player->bInVehicle || !VT_ReadRemote(0,leader) || leader[8]<=0)return;
        // Follow a point two metres behind the received leader, using stock pad
        // locomotion and physics. No teleporting or transform copying.
        const CVector pos=player->GetPosition();
        const float dx=leader[0]+sinf(leader[3])*2.0f-pos.x;
        const float dy=leader[1]-cosf(leader[3])*2.0f-pos.y;
        const float distance=sqrtf(dx*dx+dy*dy);
        if(distance<0.65f)return;
        const float angle=atan2f(-dx,dy)+TheCamera.Orientation;
        const float strength=std::min(128.0f,45.0f+(distance-0.65f)*35.0f);
        pad->NewState.LeftStickX=int16(sinf(angle)*strength);
        pad->NewState.LeftStickY=int16(-cosf(angle)*strength);
        pad->NewState.Cross=distance>7.0f?255:0;
        return;
    }
    if(!getenv("VT_TEST_WALK"))return;
    if(getenv("VT_TEST_MENU")){CPad::GetPad(0)->NewState.Clear();float status[34]={};if(ViceTogetherMenuTest(status))sendWorld(52,0,status);return;}
    if(getenv("VT_TEST_WORLD_EFFECTS")){CPad::GetPad(0)->NewState.Clear();ViceTogetherWorldTestEffects();return;}
    if(getenv("VT_TEST_GUEST_DRIVE")){ViceTogetherWorldTestDrive();return;}
    if(getenv("VT_TEST_CAR")){ViceTogetherWorldTestDrive();return;}
    if(getenv("VT_TEST_GUN_WALK")) {
        CPad* pad=CPad::GetPad(0);pad->NewState.Clear();
        if(!testStart)testStart=clockMs();
        const DWORD elapsed=clockMs()-testStart;
        pad->NewState.LeftStickX=((elapsed/1600)%2)?48:-48;
        if((elapsed/5000)%2) {VT_TestGunAim();pad->NewState.RightShoulder1=255;}
        return;
    }
    static bool logged=false;
    if(!logged && getenv("VT_TEST_COMBAT")){logged=true;FILE* f=fopen("native-network.log","a");if(f){fprintf(f,"before-world offset=%s\n",getenv("VT_SPAWN_OFFSET"));fclose(f);}}
    if(getenv("VT_TEST_COMBAT")) {
        CPlayerPed* player=FindPlayerPed();if(!player)return;
        if(!testStart)testStart=clockMs();
        const bool attacker=atof(getenv("VT_SPAWN_OFFSET"))<0.5;
        if(getenv("VT_TEST_GUN")) {
            CPad::GetPad(0)->NewState.LeftStickY=attacker?0:(((clockMs()-testStart)/1600)%2?128:-128);
            if(attacker && clockMs()-testStart>3000) {
                VT_TestGunAim();
                CPad::GetPad(0)->NewState.RightShoulder1=255;
                CPad::GetPad(0)->NewState.Circle=(clockMs()%900)<500?255:0;
            }
            return;
        }
        CPad::GetPad(0)->NewState.LeftStickY=0;
        if(!attacker && getenv("VT_TEST_MOVING_COMBAT")) {
            // Real pad input: the defender sidesteps back and forth while being attacked.
            CPad::GetPad(0)->NewState.LeftStickY=((clockMs()-testStart)/800)%2?128:-128;
        }
        if(attacker && clockMs()-testStart>3000) {
            const bool pressed=(clockMs()%800)<150;
            static bool previousPress=false;
            if(pressed && !previousPress) {
                // Keep this stationary combat fixture in reach after animation root motion.
                float target[20]={};
                if(getenv("VT_TEST_MOVING_COMBAT") && VT_ReadRemote(0,target))
                    player->Teleport(CVector(target[0]-1.1f,target[1],player->GetPosition().z));
                else player->Teleport(CVector(-592.0f,670.0f,player->GetPosition().z));
            }
            previousPress=pressed;
            player->m_fRotationCur=player->m_fRotationDest=-1.5707963f;
            player->SetHeading(-1.5707963f);
            CPad::GetPad(0)->NewState.Circle=pressed?255:0;
        }
        return;
    }
    if(!testStart)testStart=GetTickCount();
    const DWORD phase=((GetTickCount()-testStart)/2000)%4;
    CPad::GetPad(0)->NewState.LeftStickY=phase==0?-128:phase==2?128:0;
    if(getenv("VT_TEST_SHOTS"))CPad::GetPad(0)->NewState.Circle=(clockMs()%900)<150?255:0;
    if(getenv("VT_TEST_JUMP"))CPad::GetPad(0)->NewState.Square=((GetTickCount()-testStart)%4500)<150?255:0;
}
void ViceTogetherNetworkTick() {
    if(!attempted)init();if(bridge==INVALID_SOCKET)return;
    const DWORD now=clockMs();
    reportPerformance(now);
    static DWORD lastWorld=0,lastDriver=0;
    if(now-lastWorld>=100){ViceTogetherWorldCapture(sendWorld);float status[34]={};ViceTogetherWorldStatus(status);sendWorld(23,0,status);lastWorld=now;}
    // Driver ownership is a small, replaceable state packet. Send it twice as
    // often as the full ambient-world snapshot so passengers see a steady car
    // instead of the old 10 Hz transform cadence.
    if(now-lastDriver>=50){ViceTogetherCaptureDriver(sendWorld);lastDriver=now;}
    for(int count=0;count<512;count++) {
        Wire wire;sockaddr_in source={};int sourceSize=sizeof(source);
        const int size=recvfrom(bridge,(char*)&wire,sizeof(wire),0,(sockaddr*)&source,&sourceSize);
        if(size<0)break;
        if(size!=sizeof(wire)||wire.magic!=MAGIC||source.sin_addr.s_addr!=launcher.sin_addr.s_addr||source.sin_port!=launcher.sin_port)continue;
        if((wire.type>=19 && wire.type<=22) || wire.type==35 || wire.type==37 || wire.type==42){ViceTogetherWorldPacket(wire.type,wire.slot,wire.state);continue;}
        if(wire.type==48){VT_ReportWorldMeleeValidation(wire.slot,0,unsigned(std::max(0.0f,wire.state[0])),0,wire.state[2]);VT_ApplyWorldMelee(wire.slot,wire.state);continue;}
        if(wire.type==44){ViceTogetherApplyDriver(wire.slot,wire.state);continue;}
        if(wire.type==61){ViceTogetherApplyDriverVisual(wire.slot,wire.state);continue;}
        if(wire.type==56){if(std::isfinite(wire.state[0])&&std::isfinite(wire.state[1])&&std::isfinite(wire.state[2])&&std::isfinite(wire.state[3])&&std::isfinite(wire.state[4])&&wire.state[0]>=0&&wire.state[0]<6500&&wire.state[0]==floorf(wire.state[0]))ViceTogetherWorldSpawnVehicle(int(wire.state[0]),wire.state[1],wire.state[2],wire.state[3],wire.state[4]);continue;}
        if(wire.type==58){if(wire.state[0]==1)ViceTogetherWorldToggleFlyCheat();else if(wire.state[0]==2&&std::isfinite(wire.state[1])&&std::isfinite(wire.state[2])&&std::isfinite(wire.state[3]))ViceTogetherWorldNearbyBigBang(wire.state[1],wire.state[2],wire.state[3]);continue;}
        if(wire.type==49){ViceTogetherNetworkStatus(wire.state);continue;}
        if(wire.type==54){for(int slot=0;slot<7;slot++){history[slot]={};VT_RemoveRemote(slot);}delayedShots.clear();ViceTogetherWorldReset();continue;}
        if(wire.type==41){ViceTogetherWorldGlassRequest(wire.state);continue;}
        if(wire.slot>=7)continue;
        if(wire.type==29){if(std::isfinite(wire.state[0]) && wire.state[0]>=-1 && wire.state[0]<16777216 && wire.state[1]>=-1 && wire.state[1]<8)VT_SetRemoteVehicle(wire.slot,int(wire.state[0]),int(wire.state[1]));continue;}
        if(wire.type==32){if(std::isfinite(wire.state[0]) && wire.state[0]>=0 && wire.state[0]<16777216 && wire.state[1]>=-1 && wire.state[1]<8)ViceTogetherGrantPassenger(unsigned(wire.state[0]),int(wire.state[1]));continue;}
        Snapshot& s=history[wire.slot];
        if(wire.type==3){s.live=false;s.count=0;VT_RemoveRemote(wire.slot);continue;}
        if(wire.type==5){char name[25]={};std::memcpy(name,wire.state,24);VT_SetRemoteName(wire.slot,name,((unsigned char*)wire.state)[24]%8);continue;}
        if(wire.type==7){if(std::isfinite(wire.state[0]) && wire.state[0]>=0 && wire.state[0]<8)VT_SetLocalColor(int(wire.state[0]));continue;}
        if(wire.type==10){VT_ApplyLocalHealth(wire.state[0]);continue;}
        if(wire.type==13){if(std::isfinite(wire.state[0]) && wire.state[0]>=0 && wire.state[0]<WEAPONTYPE_TOTALWEAPONS && wire.state[0]==floorf(wire.state[0])){VT_SetRemoteWeapon(wire.slot,int(wire.state[0]));VT_SetRemoteWeaponVisible(wire.slot,wire.state[1]!=0);if(std::isfinite(wire.state[2]) && wire.state[2]>=0 && wire.state[2]<=6 && wire.state[2]==floorf(wire.state[2]))VT_SetRemoteWanted(wire.slot,int(wire.state[2]));}continue;}
        if(wire.type==15){if(delayedShots.size()<64)delayedShots.push_back({wire,now+100});continue;}
        if(wire.type!=2)continue;
        bool valid=true;for(int i=0;i<34;i++)if(!std::isfinite(wire.state[i]))valid=false;
        for(int i=10;i<30;i+=5)if(wire.state[i]<0 || wire.state[i]>1000 || wire.state[i+1]<0 || wire.state[i+1]>1000 || wire.state[i+2]<0 || wire.state[i+2]>1000 || wire.state[i+3]<0 || wire.state[i+3]>10 || wire.state[i+4]<0 || wire.state[i+4]>1.01f)valid=false;
        if((wire.state[30]!=0 && wire.state[30]!=1) || fabsf(wire.state[31])>=100 || fabsf(wire.state[32])>=4 || (wire.state[33]!=0 && wire.state[33]!=1))valid=false;
        if(!valid||std::fabs(wire.state[0])>=10000||std::fabs(wire.state[1])>=10000||std::fabs(wire.state[2])>=3000||(wire.state[9]!=0 && wire.state[9]!=1))continue;
        // Keep just one 50 ms snapshot in the interpolation buffer. The old
        // 100 ms floor made every remote player visibly trail even on a clean
        // route. Increase the buffer only when packet arrival jitter calls for it.
        if(!s.live){s.count=0;s.jitter=0;s.delay=40;s.playback=0;}
        if(s.count){const float interval=float(now-s.times[s.count-1]);if(interval<1000){s.jitter=s.jitter*0.9f+fabsf(interval-50.0f)*0.1f;const float targetDelay=std::min(160.0f,40.0f+s.jitter);s.delay=s.delay*0.9f+targetDelay*0.1f;}}
        if(s.count==8) {
            std::memmove(s.times,s.times+1,7*sizeof(DWORD));
            std::memmove(s.states,s.states+1,7*sizeof(s.states[0]));s.count=7;
        }
        std::memcpy(s.states[s.count],wire.state,sizeof(wire.state));s.times[s.count++]=now;s.live=true;
    }
    for(int slot=0;slot<7;slot++) {
        Snapshot& s=history[slot];if(!s.live)continue;
        if(now-s.times[s.count-1]>2000){s.live=false;s.count=0;VT_RemoveRemote(slot);continue;}
        int lower=0;
        const DWORD playback=now-DWORD(s.delay);s.playback=std::max(s.playback,playback);
        for(int i=0;i<s.count;i++)if(int(s.playback-s.times[i])>=0)lower=i;
        const int upper=lower+1<s.count?lower+1:lower;
        const float* a=s.states[lower];const float* b=s.states[upper];
        const int elapsed=int(s.playback-s.times[lower]);
        float t=s.times[upper]==s.times[lower]?1.0f:float(elapsed)/float(s.times[upper]-s.times[lower]);
        if(t<0)t=0;if(t>1)t=1;
        const float dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2];
        if(dx*dx+dy*dy+dz*dz>625)t=1;
        const float heading=a[3]+atan2f(sinf(b[3]-a[3]),cosf(b[3]-a[3]))*t;
        float x=a[0]+dx*t,y=a[1]+dy*t,z=a[2]+dz*t;
        // Bridge an occasional missing snapshot for at most 100 ms; never run away on disconnect.
        if(lower==upper && lower>0 && elapsed>0 && b[7]>1) {
            const float dt=float(s.times[lower]-s.times[lower-1]);
            const float ahead=float(elapsed>100?100:elapsed);
            if(dt>0 && dt<200) {
                const float* prev=s.states[lower-1];
                const float vx=(b[0]-prev[0])/dt,vy=(b[1]-prev[1])/dt,vz=(b[2]-prev[2])/dt;
                // Do not project old vertical motion into floating after a jump.
                if(vx*vx+vy*vy+vz*vz<0.0004f){x+=vx*ahead;y+=vy*ahead;}
            }
        }
        VT_SetRemote(slot,x,y,z,heading,int(t<0.5f?a[7]:b[7]));
        VT_SetRemoteHealth(slot,b[8]);
        if(a[9]!=b[9]){VT_SetRemoteAim(slot,b+30,b+30,1);VT_SetRemoteAnimation(slot,b+10,b+10,1,0);}
        else {VT_SetRemoteAim(slot,a+30,b+30,t);VT_SetRemoteAnimation(slot,a+10,b+10,t,lower==upper?float(std::max(0,std::min(100,elapsed)))/1000.0f:0.0f);}
    }
    if(now-lastSent>=50) {
        Wire local={};local.magic=MAGIC;local.type=1;
        if(VT_ReadLocal(local.state)){
            Wire seat={};seat.magic=MAGIC;seat.type=28;seat.state[0]=-1;seat.state[1]=-1;
            CPlayerPed* player=FindPlayerPed();if(player && player->bInVehicle && player->m_pMyVehicle){seat.state[0]=float(ViceTogetherWorldVehicleId(player->m_pMyVehicle));if(player->m_pMyVehicle->pDriver!=player)for(int i=0;i<8;i++)if(player->m_pMyVehicle->pPassengers[i]==player)seat.state[1]=float(i);}
            sendto(bridge,(const char*)&seat,sizeof(seat),0,(sockaddr*)&launcher,sizeof(launcher));
            sendto(bridge,(const char*)&local,sizeof(local),0,(sockaddr*)&launcher,sizeof(launcher));lastSent=now-(now-lastSent)%50;
            Wire equipment={};equipment.magic=MAGIC;equipment.type=12;equipment.state[0]=float(VT_ReadWeapon());
            equipment.state[1]=float(VT_ReadWeaponVisible());
            equipment.state[2]=float(VT_ReadWanted());
            sendto(bridge,(const char*)&equipment,sizeof(equipment),0,(sockaddr*)&launcher,sizeof(launcher));
            if(getenv("VT_TEST_WALK")) {
                Wire bones={};bones.magic=MAGIC;bones.type=18;if(VT_ReadLocalSkeleton(bones.state))sendto(bridge,(const char*)&bones,sizeof(bones),0,(sockaddr*)&launcher,sizeof(launcher));
            }
            if(getenv("VT_TEST_WALK") || getenv("VT_OBSERVE")) for(int slot=0;slot<7;slot++) {
                Wire debug={};debug.magic=MAGIC;debug.type=4;debug.slot=slot;
                if(VT_ReadRemote(slot,debug.state)){debug.state[19]=history[slot].delay;sendto(bridge,(const char*)&debug,sizeof(debug),0,(sockaddr*)&launcher,sizeof(launcher));}
                Wire skeleton={};skeleton.magic=MAGIC;skeleton.type=11;skeleton.slot=slot;
                if(VT_ReadRemoteSkeleton(slot,skeleton.state))sendto(bridge,(const char*)&skeleton,sizeof(skeleton),0,(sockaddr*)&launcher,sizeof(launcher));
            }
        }
    }
}
