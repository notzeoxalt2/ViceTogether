const test=require('node:test'),assert=require('node:assert/strict');const {SeatAuthority}=require('../engine/seats.cjs');
test('only an exclusive nearby driver can update a car; health changes and teleports are rejected or ignored',()=>{
 const seats=new SeatAuthority(),car=Array(34).fill(0);car[0]=130;car[17]=1000;car[22]=3;car[5]=car[9]=car[13]=1;
 seats.world({entities:[{id:12,type:22,state:car}]});const player={time:100,state:[0,0,0,0,0,0,0,1,100,0]};
 assert.deepEqual(seats.requestDriver('guest',12,player,100),{id:12,seat:-1});assert.equal(seats.requestDriver('other',12,player,100),null);
 const state=[...car];state[2]=1;state[17]=99999;state[20]=1;assert.equal(seats.acceptVehicle('other',{id:12,state},100),null);assert.equal(seats.acceptVehicle('guest',{id:12,state},100),null);state[17]=1000;state[23]=0.18;state[24]=-0.07;state[25]=0.31;const visual=Array(34).fill(0);visual[31]=1;const approved=seats.acceptVehicle('guest',{id:12,state,visual},100);assert.equal(approved.state[17],1000);assert.equal(approved.state[19],state[19]);assert.deepEqual(approved.state.slice(23,26),[0.18,-0.07,0.31]);assert.deepEqual(approved.visual,visual);assert.equal(approved.state[2],1);
 const broken=[...state];broken[5]=0;assert.equal(seats.acceptVehicle('guest',{id:12,state:broken},200),null);
 const excessiveSpin=[...state];excessiveSpin[23]=5.1;assert.equal(seats.acceptVehicle('guest',{id:12,state:excessiveSpin},200),null);
 const malformedVisual=[...visual];malformedVisual[26]=5000;assert.equal(seats.acceptVehicle('guest',{id:12,state,visual:malformedVisual},200),null);
 state[2]=500;assert.equal(seats.acceptVehicle('guest',{id:12,state},200),null);seats.release('guest');assert.equal(seats.acceptVehicle('guest',{id:12,state},300),null);
});
test('driver snapshots allow the 30 Hz vehicle stream while rejecting faster duplicates',()=>{
 const seats=new SeatAuthority(),car=Array(34).fill(0);car[0]=130;car[17]=1000;car[22]=3;car[5]=car[9]=car[13]=1;
 seats.world({entities:[{id:12,type:22,state:car}]});const player={time:100,state:[0,0,0,0,0,0,0,1,100,0]};assert.ok(seats.requestDriver('guest',12,player,100));
 const state=[...car];state[20]=1;assert.ok(seats.acceptVehicle('guest',{id:12,state},100));
 assert.equal(seats.acceptVehicle('guest',{id:12,state},119),null);
 state[2]=1;assert.ok(seats.acceptVehicle('guest',{id:12,state},120));
});
test('guest vehicle damage is monotonic and a guest wreck revokes the driver claim',()=>{
 const seats=new SeatAuthority(),car=Array(34).fill(0);car[0]=130;car[17]=1000;car[22]=3;car[5]=car[9]=car[13]=1;
 seats.world({entities:[{id:12,type:22,state:car}]});const player={time:100,state:[0,0,0,0,0,0,0,1,100,0]};assert.ok(seats.requestDriver('guest',12,player,100));
 const damaged=[...car];damaged[17]=420;damaged[19]=1;damaged[20]=1;const update=seats.acceptVehicle('guest',{id:12,state:damaged},200);assert.equal(update.state[17],420);assert.equal(update.state[19],1);assert.equal(update.wrecked,false);
 const wreck=[...damaged];wreck[17]=0;wreck[19]=5;const destroyed=seats.acceptVehicle('guest',{id:12,state:wreck},300);assert.equal(destroyed.wrecked,true);assert.equal(seats.claims.has('guest'),false);assert.equal(seats.requestDriver('guest',12,player,300),null);
});
test('wrecked cars reject passenger and driver grants and revoke old ownership',()=>{
 const seats=new SeatAuthority(),car=Array(34).fill(0);car[0]=130;car[17]=1000;car[22]=3;const player={time:100,state:[0,0,0,0,0,0,0,1,100,0]};
 seats.world({entities:[{id:12,type:22,state:car}]});assert.ok(seats.requestDriver('guest',12,player,100));
 seats.world({entities:[{id:12,type:22,state:car,visual:Object.assign(Array(34).fill(0),{31:5})}]});assert.equal(seats.claims.has('guest'),false);assert.equal(seats.requestDriver('guest',12,player,100),null);assert.equal(seats.request('host',12,player,100),null);
});
