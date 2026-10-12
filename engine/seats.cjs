// Initial host-driver / guest-passenger ownership. Guest driving is not granted.
class SeatAuthority {
  constructor(){this.cars=new Map();this.claims=new Map();this.npcs=new Set();}
  world(frame){this.cars=new Map(frame.entities.filter(e=>e.type===22).map(e=>[e.id,e.state]));this.npcs=new Set(frame.entities.filter(e=>e.type===21 && e.state[8]>=0).map(e=>e.state[8]+':'+e.state[9]));for(const [id,seat] of this.claims)if(!this.cars.has(seat.id))this.claims.delete(id);}
  driver(id,car,player,trustedLocal=false){this.claims.delete(id);if(!car || car.id<0)return true;const state=this.cars.get(car.id);if(car.seat!==-1 || !state || (!trustedLocal && (!player || Math.hypot(...player.state.slice(0,3).map((v,k)=>v-state[k+2]))>8)))return false;this.claims.set(id,{id:car.id,seat:-1});return true;}
  request(id,carId,player,now){const state=this.cars.get(carId);if(!state || !player || now-player.time>500 || player.state[8]<=0 || Math.hypot(...player.state.slice(0,3).map((v,k)=>v-state[k+2]))>8)return null;
    if(this.claims.get(id)?.id===carId)return this.claims.get(id);
    for(let seat=0;seat<Math.min(8,state[22]);seat++){if(this.npcs.has(carId+':'+seat) || [...this.claims.values()].some(s=>s.id===carId && s.seat===seat))continue;const claim={id:carId,seat};this.claims.set(id,claim);return claim;}return null;
  }
  release(id){this.claims.delete(id);}
  validOccupant(id,state){if(state[9]===0)return true;const claim=this.claims.get(id),car=claim&&this.cars.get(claim.id);return !!car && Math.hypot(...state.slice(0,3).map((v,k)=>v-car[k+2]))<10;}
}
module.exports={SeatAuthority};
