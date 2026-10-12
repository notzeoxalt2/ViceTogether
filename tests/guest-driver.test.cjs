const test=require('node:test'),assert=require('node:assert/strict');const {SeatAuthority}=require('../engine/seats.cjs');
test('only an exclusive nearby driver can update a car; health changes and teleports are rejected or ignored',()=>{
 const seats=new SeatAuthority(),car=Array(34).fill(0);car[0]=130;car[17]=1000;car[22]=3;car[5]=car[9]=car[13]=1;
 seats.world({entities:[{id:12,type:22,state:car}]});const player={time:100,state:[0,0,0,0,0,0,0,1,100,0]};
 assert.deepEqual(seats.requestDriver('guest',12,player,100),{id:12,seat:-1});assert.equal(seats.requestDriver('other',12,player,100),null);
 const state=[...car];state[2]=1;state[17]=99999;assert.equal(seats.acceptVehicle('other',{id:12,state},100),null);const approved=seats.acceptVehicle('guest',{id:12,state},100);assert.equal(approved.state[17],1000);assert.equal(approved.state[2],1);
 const broken=[...state];broken[5]=0;assert.equal(seats.acceptVehicle('guest',{id:12,state:broken},200),null);
 state[2]=500;assert.equal(seats.acceptVehicle('guest',{id:12,state},200),null);seats.release('guest');assert.equal(seats.acceptVehicle('guest',{id:12,state},300),null);
});
test('wrecked cars reject passenger and driver grants and revoke old ownership',()=>{
 const seats=new SeatAuthority(),car=Array(34).fill(0);car[0]=130;car[17]=1000;car[22]=3;const player={time:100,state:[0,0,0,0,0,0,0,1,100,0]};
 seats.world({entities:[{id:12,type:22,state:car}]});assert.ok(seats.requestDriver('guest',12,player,100));
 seats.world({entities:[{id:12,type:22,state:car,visual:Object.assign(Array(34).fill(0),{31:5})}]});assert.equal(seats.claims.has('guest'),false);assert.equal(seats.requestDriver('guest',12,player,100),null);assert.equal(seats.request('host',12,player,100),null);
});
