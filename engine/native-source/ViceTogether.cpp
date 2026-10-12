// Copyright (c) 2026 ViceTogether contributors. MIT.
// This bridge is experimental until tested with the user's own game assets.
#include "common.h"
#include "ViceTogether.h"
#include "ViceTogetherWorld.h"
#include "PlayerPed.h"
#include "Vehicle.h"
#include "Ped.h"
#include "World.h"
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
static bool modMenuOpen=false;static int modMenuRow=0,modMenuAction=-1;
bool ViceTogetherMenuOpen(){return modMenuOpen;}
bool ViceTogetherMenuKey(int key,bool control){
    if(key=='O'&&control){modMenuOpen=!modMenuOpen;return true;}
    if(!modMenuOpen)return false;
    if(key==38)modMenuRow=(modMenuRow+3)%4;
    else if(key==40)modMenuRow=(modMenuRow+1)%4;
    else if(key==13){if(modMenuRow==3)modMenuOpen=false;else modMenuAction=modMenuRow;}
    else if(key==8||key==27)modMenuOpen=false;
    return true;
}
static void drawModMenu(){
    if(!modMenuOpen)return;
    const CFontDetails saved=CFont::Details;const float x=SCREEN_SCALE_X(28),y=SCREEN_SCALE_Y(60),w=SCREEN_SCALE_X(260),row=SCREEN_SCALE_Y(26);
    CSprite2d::DrawRect(CRect(x,y,x+w,y+row*7),CRGBA(14,17,25,235));CSprite2d::DrawRect(CRect(x,y,x+w,y+row*1.5f),CRGBA(73,54,113,255));
    CFont::SetFontStyle(FONT_STANDARD);CFont::SetScale(SCREEN_SCALE_X(0.42f),SCREEN_SCALE_Y(0.78f));CFont::SetCentreOff();CFont::SetRightJustifyOff();CFont::SetJustifyOff();CFont::SetBackgroundOff();CFont::SetPropOn();CFont::SetColor(CRGBA(255,255,255,255));
    wchar text[96];AsciiToUnicode("ViceTogether",text);CFont::PrintString(x+SCREEN_SCALE_X(12),y+SCREEN_SCALE_Y(10),text);
    const char* rows[]={"Weapons - basic pack","Weapons - advanced pack","Weapons - heavy pack","Close menu"};
    for(int i=0;i<4;i++){const float top=y+row*(1.6f+i);if(i==modMenuRow)CSprite2d::DrawRect(CRect(x,top,x+w,top+row),CRGBA(104,86,151,240));AsciiToUnicode(rows[i],text);CFont::PrintString(x+SCREEN_SCALE_X(12),top+SCREEN_SCALE_Y(5),text);}
    CFont::SetScale(SCREEN_SCALE_X(0.27f),SCREEN_SCALE_Y(0.55f));AsciiToUnicode("Arrows: select   Enter: use   Backspace: close",text);CFont::PrintString(x+SCREEN_SCALE_X(9),y+row*6.2f,text);CFont::Details=saved;
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
    int weapon;
    uint32 createdFrame;
    int vehicle,seat,appliedSeat;
    unsigned weaponDraws;
    bool weaponVisible;
};
Remote peers[7] = {};
bool enabled = false;
bool loadoutGiven=false;
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
}

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
    for(CAnimBlendAssociation* a=RpAnimBlendClumpGetFirstAssociation(player->GetClump());a;a=RpAnimBlendGetNextAssociation(a)) {
        // Capture the engine's actual pose, including jump launch/glide/landing,
        // falls, ducking and weapon-specific directional locomotion.
        if(!registeredAnimation(a->groupId,a->animId) || a->blendAmount<=0)continue;
        // Partial upper-body poses cannot replace the full-body base skeleton.
        const int base=a->IsPartial()?2:0;
        if(!best[base] || a->blendAmount>best[base]->blendAmount){best[base+1]=best[base];best[base]=a;}
        else if(!best[base+1] || a->blendAmount>best[base+1]->blendAmount)best[base+1]=a;
    }
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
        CColPoint impact;CEntity* victim=nil;CEntity* oldIgnore=CWorld::pIgnoreEntity;CWorld::pIgnoreEntity=ped;
        const bool hit=CWorld::ProcessLineOfSight(source,end+direction*0.25f,impact,victim,true,true,true,true,true,false);
        CWorld::pIgnoreEntity=oldIgnore;
        if(hit && victim && victim->IsPed()) {
            CPed* npc=(CPed*)victim;
            if(!npc->IsPlayer() && !ViceTogetherIsRemote(npc) && !npc->DyingOrDead()) {
                const int piece=int(impact.pieceB);
                if(npc->InflictDamage(ped,eWeaponType(weapon),float(CWeaponInfo::GetWeaponInfo(eWeaponType(weapon))->m_nDamage),piece>=PEDPIECE_TORSO && piece<=PEDPIECE_HEAD?(ePedPieceTypes)piece:PEDPIECE_TORSO,0))VT_ReportWorldHit(0,npc->m_fHealth);
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
void VT_SendHit(int slot,int weapon);
void VT_SetRemoteHealth(int slot,float health) {if(slot>=0 && slot<7)peers[slot].health=health;}
void VT_ApplyLocalHealth(float health) {
    CPlayerPed* player=FindPlayerPed();if(!player || !std::isfinite(health) || health<0 || health>100)return;
    static CVector deathPosition(-592.0f,670.0f,10.0f);static bool deathRecorded=false;
    if(health<=0 && !deathRecorded){deathPosition=player->GetPosition();deathRecorded=true;}
    if(health>0 && player->DyingOrDead()) {
        CVector spawn=deathPosition+CVector(2,0,1);
        if(spawn.x< -2350 || spawn.x>1550 || fabsf(spawn.y)>1950 || spawn.z< -30 || spawn.z>1000)spawn=CVector(-592.0f,670.0f,10.0f);
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
    int record=0;
    for(CAnimBlendAssociation* a=RpAnimBlendClumpGetFirstAssociation(peers[slot].ped->GetClump());a && record<2;a=RpAnimBlendGetNextAssociation(a)) {
        if(a->IsPartial() || a->blendAmount<0.05f || (a->animId!=ANIM_STD_IDLE && a->animId!=ANIM_STD_WALK && a->animId!=ANIM_STD_RUN && a->animId!=ANIM_STD_RUNFAST))continue;
        int j=10+(record++)*5;out[j]=a->groupId;out[j+1]=a->animId;out[j+2]=a->currentTime;out[j+3]=a->speed;out[j+4]=a->blendAmount;
    }
    return 1;
}
int VT_ReadLocalSkeleton(float* out) {
    CPed* p=FindPlayerPed();if(!p || !p->m_rwObject)return 0;
    const CVector head=p->GetNodePosition(PED_HEAD),left=p->GetNodePosition(PED_FOOTL),right=p->GetNodePosition(PED_FOOTR);
    out[0]=(head-left).Magnitude();out[1]=(head-right).Magnitude();out[2]=(left-right).Magnitude();out[3]=p->m_fHealth;
    out[4]=float(p->m_nPedState);out[5]=float(p->m_objective);out[6]=p->bInVehicle?1:0;
    if(p->m_pMyVehicle){CVehicle* car=p->m_pMyVehicle;out[7]=float(car->GetStatus());out[8]=car->pDriver==p?1:0;out[9]=car->m_fGasPedal;out[10]=car->GetMoveSpeed().Magnitude();}
    return 1;
}
int VT_ReadRemoteSkeleton(int slot,float* out) {
    if(slot<0 || slot>=7 || !out || !peers[slot].ped)return 0;
    CPed* p=peers[slot].ped;
    if(CTimer::GetFrameCounter()-peers[slot].createdFrame<3)return 0;
    const CVector head=p->GetNodePosition(PED_HEAD),left=p->GetNodePosition(PED_FOOTL),right=p->GetNodePosition(PED_FOOTR);
    out[0]=(head-left).Magnitude();out[1]=(head-right).Magnitude();out[2]=(left-right).Magnitude();
    out[3]=p->m_fHealth;out[4]=0;out[5]=0;
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
void ViceTogetherWeaponRendered(CPed* ped){for(auto& peer:peers)if(peer.ped==ped)peer.weaponDraws++;}
extern "C" void VT_SendWorldDamage(int slot,float amount);
void ViceTogetherReportHealthLoss(CPed* victim,float before){const char* role=getenv("VT_WORLD_HOST");if(enabled && role && atoi(role)==1 && victim==FindPlayerPed() && before>victim->m_fHealth)VT_SendWorldDamage(7,before-victim->m_fHealth);}
bool ViceTogetherReportDamage(CPed* victim,CEntity* attacker,int weapon,float amount) {
    if(!enabled)return false;
    for(int i=0;i<7;i++)if(peers[i].ped==victim) {
        if(attacker==FindPlayerPed() && (weapon==WEAPONTYPE_UNARMED || weapon==WEAPONTYPE_COLT45) && peers[i].health>0)VT_SendHit(i,weapon);
        else {const char* role=getenv("VT_WORLD_HOST");if(role && atoi(role)==1 && (!attacker || !attacker->IsPed() || !ViceTogetherIsRemote((CPed*)attacker)) && (attacker!=FindPlayerPed() || weapon==WEAPONTYPE_EXPLOSION) && peers[i].health>0 && std::isfinite(amount) && amount>0)VT_SendWorldDamage(i,amount*0.33f);}
        return true;
    }
    return false;
}
extern "C" void VT_SendShot(int weapon,const CVector& source,const CVector& end,bool hit,const CVector& normal,int hitKind);
void ViceTogetherReportShot(CEntity* shooter,int weapon,const CVector& source,const CVector& end,bool hit,const CVector& normal,int hitKind) {
    if(enabled && shooter==FindPlayerPed() && weapon>=0 && weapon<WEAPONTYPE_TOTALWEAPONS && CWeaponInfo::GetWeaponInfo(eWeaponType(weapon))->m_eWeaponFire==WEAPON_FIRE_INSTANT_HIT)VT_SendShot(weapon,source,end,hit,normal,hitKind);
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
    const CFontDetails saved=CFont::Details;
    CFont::SetFontStyle(FONT_STANDARD); CFont::SetScale(SCREEN_SCALE_X(0.38f), SCREEN_SCALE_Y(0.7f));
    CFont::SetCentreOn(); CFont::SetCentreSize(SCREEN_WIDTH); CFont::SetJustifyOff();
    CFont::SetRightJustifyOff(); CFont::SetBackgroundOff(); CFont::SetPropOn();
    CFont::SetAlphaFade(255.0f); CFont::SetDropShadowPosition(1); CFont::SetDropColor(CRGBA(0,0,0,230));
    for(int i=0;i<7;i++) {
        CPed* ped=peers[i].ped;
        if(!ped || !peers[i].active) continue;
        CVector p=ped->GetPosition();
        if((p-TheCamera.GetPosition()).MagnitudeSqr()>60.0f*60.0f) continue;
        p.z+=1.25f;
        RwV3d world={p.x,p.y,p.z}, screen; float w,h;
        if(!CSprite::CalcScreenCoors(world,&screen,&w,&h,true) || screen.x<0 || screen.x>SCREEN_WIDTH || screen.y<0 || screen.y>SCREEN_HEIGHT) continue;
        const char* label=peers[i].name;
        if(!label || !label[0]) label="Player";
        wchar text[32]; AsciiToUnicode(label,text);
        const float labelHalf=std::max(SCREEN_SCALE_X(30.0f),CFont::GetStringWidth(text,true)*0.5f+SCREEN_SCALE_X(8));
        CSprite2d::DrawRect(CRect(screen.x-labelHalf,screen.y-SCREEN_SCALE_Y(2),screen.x+labelHalf,screen.y+SCREEN_SCALE_Y(13)),CRGBA(13,17,23,190));
        CFont::SetColor(CRGBA(230,244,240,255));
        CFont::PrintString(screen.x,screen.y,text);
        if(i>=0) {
            const float half=labelHalf, y=screen.y+SCREEN_SCALE_Y(15.0f), height=SCREEN_SCALE_Y(3.0f);
            CSprite2d::DrawRect(CRect(screen.x-half,y,screen.x+half,y+height),CRGBA(0,0,0,180));
            CSprite2d::DrawRect(CRect(screen.x-half,y,screen.x-half+2*half*std::max(0.0f,std::min(1.0f,peers[i].health/100.0f)),y+height),peers[i].health<30?CRGBA(240,91,104,240):CRGBA(100,215,174,240));
        }
    }
    CFont::Details=saved;
    drawModMenu();
}

void ViceTogetherTick() {
    if(modMenuAction>=0){const int action=modMenuAction;modMenuAction=-1;if(action==0)WeaponCheat1();else if(action==1)WeaponCheat2();else WeaponCheat3();}
    ViceTogetherNetworkTick();
    ViceTogetherWorldTick();
    if(getenv("VT_FOLLOW_PLAYER") || getenv("VT_MUTE")){DMAudio.SetEffectsMasterVolume(0);DMAudio.SetMusicMasterVolume(0);}
    CPlayerPed* player = FindPlayerPed();
    if (!player || !player->m_rwObject) return;
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
        if(r.ped->m_pMyVehicle!=car || (car && r.appliedSeat!=r.seat)){
            if(r.ped->m_pMyVehicle){if(r.ped->m_pMyVehicle->pDriver==r.ped)r.ped->m_pMyVehicle->RemoveDriver();else r.ped->m_pMyVehicle->RemovePassenger(r.ped);}
            r.ped->m_pMyVehicle=nil;
            if(car){bool seated=false;if(r.seat<0 && (!car->pDriver || car->pDriver==r.ped)){car->SetDriver(r.ped);seated=true;}else if(r.seat>=0)seated=car->AddPassenger(r.ped,uint8(r.seat));if(seated){r.ped->m_pMyVehicle=car;car->RegisterReference((CEntity**)&r.ped->m_pMyVehicle);r.appliedSeat=r.seat;}else car=nil;}
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
