// Host-owned health with bounded historical melee validation. Gunfire is a separate milestone.
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const point=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
const meleeWeapon=id=>Number.isInteger(id)&&id>=0&&id<=11;
const instantWeapon=id=>Number.isInteger(id)&&((id>=17&&id<=29)||[32,33,35].includes(id));
const shotgun=id=>[19,20,21].includes(id);
const shotRange=id=>id===17?30:shotgun(id)?100:1000;
function nearHistory(player,position,now) {
  const history=player.history.filter(s=>now-s.time<=350);
  for(let i=0;i<history.length;i++) {
    const a=history[i].position,b=history[i+1]?.position;
    if(distance(a,position)<=0.65)return true;
    if(!b)continue;
    const delta=b.map((v,k)=>v-a[k]),length=delta.reduce((s,v)=>s+v*v,0);
    // Never interpolate a teleport into an imaginary hittable trail.
    if(length>9 || !length)continue;
    const t=Math.max(0,Math.min(1,delta.reduce((s,v,k)=>s+(position[k]-a[k])*v,0)/length));
    if(distance(a.map((v,k)=>v+delta[k]*t),position)<=0.65)return true;
  }
  return false;
}
export class SessionCombat {
  constructor() { this.players=new Map(); this.attacks=new Map();this.equipment=new Map(); }
  equip(id,weapon){if(!Number.isInteger(weapon)||weapon<0||weapon>=37)return false;this.equipment.set(id,weapon);const p=this.players.get(id);if(p)p.weapon=weapon;return true;}
  update(id,state,now) {
    let p=this.players.get(id);
    if(!p){p={health:100,deadAt:null,spawn:0,history:[]};this.players.set(id,p);}
    p.history=p.history.filter(s=>now-s.time<=350);
    p.history.push({position:state.slice(0,3),time:now});
    p.state=state;p.time=now;
    p.weapon=this.equipment.get(id)||0;
    if(p.deadAt!==null && now-p.deadAt>=3000){p.health=100;p.deadAt=null;p.spawn++;p.history=p.history.slice(-1);}
    return {...p,state:[...state.slice(0,8),p.health,...state.slice(9)]};
  }
  hit(attacker,event,now) {
    if(!event || !Number.isSafeInteger(event.seq) || event.seq<1 || typeof event.target!=='string' || !(meleeWeapon(event.weapon)||instantWeapon(event.weapon)) || event.target===attacker)return null;
    const a=this.players.get(attacker),b=this.players.get(event.target),last=this.attacks.get(attacker);
    if(!a?.state || !b?.state || !a.health || !b.health || now-a.time>500 || now-b.time>500)return null;
    if(a.weapon!==event.weapon)return null;
    const melee=meleeWeapon(event.weapon),spec=melee
      ?{range:3.3,damage:15,interval:250}
      :{range:shotRange(event.weapon),damage:event.weapon===17?25:20,interval:event.weapon===17?150:shotgun(event.weapon)?75:45};
    if(melee&&(a.state[9]===1||b.state[9]===1))return null;
    if(last && (event.seq<=last.seq || now-last.time<spec.interval))return null;
    if(event.damage!==undefined&&(!Number.isFinite(event.damage)||event.damage<=0||event.damage>100))return null;
    if(event.origin!==undefined || event.impact!==undefined) {
      if(!point(event.origin)||!point(event.impact)||distance(event.origin,event.impact)>spec.range)return null;
      if(!nearHistory(a,event.origin,now)||!nearHistory(b,event.impact,now))return null;
    } else if(distance(a.state.slice(0,3),b.state.slice(0,3))>spec.range)return null;
    this.attacks.set(attacker,{seq:event.seq,time:now});
    const damage=event.damage===undefined?spec.damage:Math.min(60,Math.max(1,Math.round(event.damage)));
    b.health=Math.max(0,b.health-damage);if(!b.health)b.deadAt=now;
    return {attacker,target:event.target,weapon:event.weapon,damage,seq:event.seq,origin:event.origin,impact:event.impact,health:b.health,dead:!b.health};
  }
  worldDamage(target,amount,now) {
    const p=this.players.get(target);
    if(!p?.state || !p.health || now-p.time>500 || !Number.isFinite(amount) || amount<=0 || amount>100)return null;
    p.health=Math.max(0,p.health-amount);if(!p.health)p.deadAt=now;
    return {target,health:p.health,dead:!p.health,source:'world'};
  }
  remove(id){this.players.delete(id);this.attacks.delete(id);this.equipment.delete(id);}
}

const meleeWeapons=new Set([0,1,2,3,4,5,6,7,8,9,10,11]);
export class NpcMeleeAuthority {
  constructor(){this.peers=new Map();}
  accept(id,event,now){
    if(typeof id!=='string'||!id||!Number.isSafeInteger(event?.targetId)||event.targetId<0||event.targetId>=16777216||!Number.isSafeInteger(event?.seq)||event.seq<1||!meleeWeapons.has(event?.weapon)||!Number.isFinite(event?.damage)||event.damage<1||event.damage>250)return null;
    const prior=this.peers.get(id);if(prior&&(event.seq<=prior.seq||now-prior.time<180))return null;
    const recent=(prior?.recent||[]).filter(t=>now-t<1000);if(recent.length>=6)return null;
    const approved={targetId:event.targetId,weapon:event.weapon,damage:event.damage,seq:event.seq};
    this.peers.set(id,{seq:event.seq,time:now,recent:[...recent,now]});return approved;
  }
  remove(id){this.peers.delete(id);}
}
