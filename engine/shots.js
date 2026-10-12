import {instantWeapon,shotgun,shotRange} from './weapons.cjs';
const point=p=>Array.isArray(p)&&p.length===3&&p.every(v=>Number.isFinite(v)&&Math.abs(v)<10000);
export function validShot(s) {
  return s && instantWeapon(s.weapon) && point(s.source) && point(s.end) && point(s.normal)
    && typeof s.hit==='boolean' && [0,1,2].includes(s.hitKind)
    && Math.hypot(...s.end.map((v,i)=>v-s.source[i]))<=shotRange(s.weapon)
    && Math.hypot(...s.normal)<=1.1;
}
// Visual/audio events only. Damage still comes from separately validated contacts.
export class ShotAuthority {
  constructor(){this.last=new Map();}
  accept(id,event,player,weapon,now) {
    if(!validShot(event) || !Number.isSafeInteger(event.seq) || event.seq<1 || weapon!==event.weapon
      || !player || now-player.time>500 || player.state[8]<=0)return null;
    const last=this.last.get(id);
    if(last && event.seq<=last.seq)return null;
    const recent=(last?.recent||[]).filter(t=>now-t<100);
    if(shotgun(weapon)){if(recent.length>=16)return null;}
    else if(last && now-last.time<(weapon===17?150:15))return null;
    if(Math.hypot(...event.source.map((v,i)=>v-player.state[i]))>2.5)return null;
    this.last.set(id,{seq:event.seq,time:now,recent:[...recent,now]});
    return {...event,id};
  }
}
