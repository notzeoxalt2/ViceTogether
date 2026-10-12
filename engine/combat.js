// Host-owned health with bounded historical melee validation. Gunfire is a separate milestone.
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const point=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
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
    if(!event || !Number.isSafeInteger(event.seq) || event.seq<1 || typeof event.target!=='string' || ![0,17].includes(event.weapon) || event.target===attacker)return null;
    const a=this.players.get(attacker),b=this.players.get(event.target),last=this.attacks.get(attacker);
    if(!a?.state || !b?.state || !a.health || !b.health || now-a.time>500 || now-b.time>500)return null;
    if(a.weapon!==event.weapon)return null;
    const spec=event.weapon===17?{range:30,damage:25,interval:450}:{range:2.4,damage:15,interval:250};
    if(last && (event.seq<=last.seq || now-last.time<spec.interval))return null;
    if(event.origin!==undefined || event.impact!==undefined) {
      if(!point(event.origin)||!point(event.impact)||distance(event.origin,event.impact)>spec.range)return null;
      if(!nearHistory(a,event.origin,now)||!nearHistory(b,event.impact,now))return null;
    } else if(distance(a.state.slice(0,3),b.state.slice(0,3))>spec.range)return null;
    this.attacks.set(attacker,{seq:event.seq,time:now});
    b.health=Math.max(0,b.health-spec.damage);if(!b.health)b.deadAt=now;
    return {attacker,target:event.target,health:b.health,dead:!b.health};
  }
  worldDamage(target,amount,now) {
    const p=this.players.get(target);
    if(!p?.state || !p.health || now-p.time>500 || !Number.isFinite(amount) || amount<=0 || amount>100)return null;
    p.health=Math.max(0,p.health-amount);if(!p.health)p.deadAt=now;
    return {target,health:p.health,dead:!p.health,source:'world'};
  }
  remove(id){this.players.delete(id);this.attacks.delete(id);this.equipment.delete(id);}
}
