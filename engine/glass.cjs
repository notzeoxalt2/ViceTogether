function validGlass(s){return Array.isArray(s)&&s.length===34&&s.every(Number.isFinite)&&Number.isInteger(s[0])&&s[0]>=0&&s[0]<6500&&[1,2].includes(s[1])&&Math.abs(s[2])<10000&&Math.abs(s[3])<10000&&Math.abs(s[4])<3000&&s.slice(5,8).every(v=>Math.abs(v)<=10)&&s[11]>=0&&s[11]<=10000&&[0,1].includes(s[12])&&Math.hypot(...s.slice(8,11).map((v,i)=>v-s[i+2]))<=100;}
class GlassAuthority {
  constructor(){this.peers=new Map();}
  accept(id,event,player,now){if(!validGlass(event?.state)||!Number.isSafeInteger(event.seq)||event.seq<1||!player||now-player.time>500||player.state[8]<=0||Math.hypot(...event.state.slice(2,5).map((v,i)=>v-player.state[i]))>40)return null;const prior=this.peers.get(id);if(prior&&event.seq<=prior.seq)return null;const recent=(prior?.recent||[]).filter(t=>now-t<1000);if(recent.length>=128)return null;this.peers.set(id,{seq:event.seq,recent:[...recent,now]});return event.state;}
}
function validExplosion(s){return Array.isArray(s)&&s.length===34&&s.every(Number.isFinite)&&Number.isSafeInteger(s[0])&&s[0]>0&&s[0]<=16777215&&Number.isInteger(s[1])&&s[1]>=0&&s[1]<12&&Math.abs(s[2])<10000&&Math.abs(s[3])<10000&&Math.abs(s[4])<3000&&Number.isInteger(s[5])&&s[5]>=0&&s[5]<=10000&&[0,1].includes(s[6]);}
module.exports={validGlass,GlassAuthority,validExplosion};
