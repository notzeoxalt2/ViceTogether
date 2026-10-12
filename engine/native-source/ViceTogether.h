#pragma once
// Experimental on-foot replication hook. Call after CWorld::Process().
void ViceTogetherTick();
void ViceTogetherBeforeWorld();
void ViceTogetherNetworkTick();
class CPed;
bool ViceTogetherIsRemote(const CPed* ped);
void ViceTogetherDrawNames();
bool ViceTogetherRenderBody(CPed* ped);
void ViceTogetherWeaponRendered(CPed* ped);
void ViceTogetherFlushShots();
class CEntity;
bool ViceTogetherReportDamage(CPed* victim,CEntity* attacker,int weapon,float amount);
void ViceTogetherReportHealthLoss(CPed* victim,float before);
class CVector;
void ViceTogetherReportShot(CEntity* shooter,int weapon,const CVector& source,const CVector& end,bool hit,const CVector& normal,int hitKind);
