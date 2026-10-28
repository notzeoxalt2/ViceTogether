// Host grants exclusive seats. Vehicle transforms from a guest require ownership.
const MAX_PASSENGER_SEATS=8;
const {validDriverVehicleVisual}=require('./world.cjs');
const passengerCapacity=state=>Number.isInteger(state?.[22])?Math.max(0,Math.min(MAX_PASSENGER_SEATS,state[22])):0;
class SeatAuthority {
  constructor(){this.cars=new Map();this.claims=new Map();this.npcs=new Set();this.wrecks=new Set();this.vehicleStats={received:0,accepted:0,rejected:{}};this.vehicleTimestamps=new Map();}
  rejectVehicle(reason){this.vehicleStats.rejected[reason]=(this.vehicleStats.rejected[reason]||0)+1;return null;}
  world(frame){const cars=frame.entities.filter(e=>e.type===22);this.cars=new Map(cars.map(e=>[e.id,e.state]));this.wrecks=new Set(cars.filter(e=>e.state[17]<=0||e.visual?.[31]===5).map(e=>e.id));this.npcs=new Set(frame.entities.filter(e=>e.type===21 && e.state[8]>=0).map(e=>e.state[8]+':'+e.state[9]));for(const [id,seat] of this.claims){const state=this.cars.get(seat.id);if(!state||this.wrecks.has(seat.id)||seat.seat< -1||seat.seat>=0&&(seat.seat>=passengerCapacity(state)||this.npcs.has(seat.id+':'+seat.seat))||seat.seat===-1&&this.npcs.has(seat.id+':-1'))this.release(id);}}
  driver(id,car,player,trustedLocal=false){if(!car || car.id<0){this.release(id);return true;}const state=this.cars.get(car.id);if(car.seat!==-1 || !state || this.wrecks.has(car.id) || this.npcs.has(car.id+':-1') || (!trustedLocal && (!player || Math.hypot(...player.state.slice(0,3).map((v,k)=>v-state[k+2]))>8)) || [...this.claims.entries()].some(([owner,seat])=>owner!==id && seat.id===car.id && seat.seat===-1))return false;this.claims.set(id,{id:car.id,seat:-1});return true;}
  request(id,carId,player,now){const state=this.cars.get(carId);if(!state || this.wrecks.has(carId) || !player || now-player.time>500 || player.state[8]<=0 || Math.hypot(...player.state.slice(0,3).map((v,k)=>v-state[k+2]))>8)return null;
    const existing=this.claims.get(id);if(existing?.id===carId)return existing.seat>=0&&existing.seat<passengerCapacity(state)&&!this.npcs.has(carId+':'+existing.seat)?existing:null;
    if(existing)this.release(id);
    for(let seat=0;seat<passengerCapacity(state);seat++){if(this.npcs.has(carId+':'+seat) || [...this.claims.values()].some(s=>s.id===carId && s.seat===seat))continue;const claim={id:carId,seat};this.claims.set(id,claim);return claim;}return null;
  }
  release(id){this.claims.delete(id);this.motion?.delete(id);this.vehicleTimestamps.delete(id);}
  requestDriver(id,carId,player,now){const car=this.cars.get(carId);if(!car||this.wrecks.has(carId)||!player||now-player.time>750||player.state[8]<=0||Math.hypot(...player.state.slice(0,3).map((v,k)=>v-car[k+2]))>8)return null;const existing=this.claims.get(id);if(existing?.id===carId&&existing.seat===-1)return existing;if(existing?.id!==carId&&existing)this.release(id);if(this.npcs.has(carId+':-1')||[...this.claims.entries()].some(([owner,s])=>owner!==id&&s.id===carId&&s.seat===-1))return null;const claim={id:carId,seat:-1};this.claims.set(id,claim);return claim;}
  acceptVehicle(id,update,now){
    this.vehicleStats.received++;
    const claim=this.claims.get(id),car=claim&&this.cars.get(claim.id);
    if(!claim||!car||this.wrecks.has(claim.id)||claim.seat!==-1||update?.id!==claim.id)return this.rejectVehicle('seat-or-car');
    if(!Array.isArray(update.state)||update.state.length!==34||!update.state.every(Number.isFinite)||update.visual!==undefined&&!validDriverVehicleVisual(update.visual))return this.rejectVehicle('invalid-payload');
    const d=update.state;
    if(d[0]!==car[0]||d[1]!==car[1]||d.slice(2,5).some((v,k)=>Math.abs(v)>[10000,10000,3000][k])||d.slice(5,14).some(v=>Math.abs(v)>1.1)||d.slice(14,17).some(v=>Math.abs(v)>3)||d.slice(23,26).some(v=>Math.abs(v)>5)||d[17]<0||d[17]>1000||!Number.isInteger(d[19])||d[19]<0||d[19]>5)return this.rejectVehicle('invalid-fields');
    if(d[20]!==1)return this.rejectVehicle('not-player-driven');
    if(d[2]<-2350||d[2]>1550||Math.abs(d[3])>1950)return this.rejectVehicle('outside-world');
    const axes=[d.slice(5,8),d.slice(8,11),d.slice(11,14)];
    if(axes.some(v=>Math.abs(Math.hypot(...v)-1)>0.05))return this.rejectVehicle('invalid-orientation');
    for(let a=0;a<3;a++)for(let b=a+1;b<3;b++)if(Math.abs(axes[a].reduce((sum,v,i)=>sum+v*axes[b][i],0))>0.05)return this.rejectVehicle('invalid-orientation');
    const last=this.motion?.get(id),recent=(this.vehicleTimestamps.get(id)||[]).filter(time=>now-time<1000);
    // Driver snapshots target 120 Hz, so a fixed inter-packet gap can reject
    // valid updates when WebRTC delivers a brief burst. Bound the rolling
    // rate instead, so jitter does not throttle movement below the target.
    if(recent.length>=120)return this.rejectVehicle('rate-limit');
    const elapsed=last?Math.min(1500,now-last.time):100,position=last?.position||car.slice(2,5);
    if(Math.hypot(...d.slice(2,5).map((v,k)=>v-position[k]))>4+elapsed*0.09)return this.rejectVehicle('movement-bound');
    const health=Math.min(car[17],d[17]),result=[...car],accepted=[...d];
    for(let i=2;i<=16;i++)result[i]=d[i];result[17]=health;accepted[17]=health;
    this.motion??=new Map();this.motion.set(id,{time:now,position:d.slice(2,5)});recent.push(now);this.vehicleTimestamps.set(id,recent);this.cars.set(claim.id,result);this.vehicleStats.accepted++;
    if(d[19]===5||health<=0){this.wrecks.add(claim.id);this.release(id);}
    return {id:claim.id,state:accepted,visual:update.visual?.slice(),wrecked:d[19]===5||health<=0};
  }
  acceptVehicleDoors(id,update){const claim=this.claims.get(id);if(!claim||claim.id!==update?.id||!this.cars.has(claim.id)||this.wrecks.has(claim.id)||!Array.isArray(update.doors)||update.doors.length!==6||!update.doors.every(v=>Number.isFinite(v)&&Math.abs(v)<=2.4))return null;return {id:claim.id,doors:update.doors.slice()};}
  validOccupant(id,state){if(state[9]===0)return true;const claim=this.claims.get(id),car=claim&&this.cars.get(claim.id);return !!car && Math.hypot(...state.slice(0,3).map((v,k)=>v-car[k+2]))<10;}
}
module.exports={SeatAuthority,passengerCapacity};
