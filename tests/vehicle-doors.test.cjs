const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {SeatAuthority}=require('../engine/seats.cjs');

test('door angle updates are allowed only for the sender current shared vehicle seat',()=>{
  const seats=new SeatAuthority(),car=Array(34).fill(0);
  car[0]=130;car[17]=1000;car[22]=3;car[5]=car[9]=car[13]=1;
  seats.world({entities:[{id:12,type:22,state:car}]});
  const player={time:100,state:[0,0,0,0,0,0,0,1,100,0]};
  assert.deepEqual(seats.requestDriver('guest',12,player,100),{id:12,seat:-1});
  const open=[0,0,0,1.1,0,0];
  assert.deepEqual(seats.acceptVehicleDoors('guest',{id:12,doors:open}),{id:12,doors:open});
  assert.equal(seats.acceptVehicleDoors('other',{id:12,doors:open}),null);
  assert.equal(seats.acceptVehicleDoors('guest',{id:99,doors:open}),null);
  assert.equal(seats.acceptVehicleDoors('guest',{id:12,doors:[0,0,0,4,0,0]}),null);
  assert.equal(seats.acceptVehicleDoors('guest',{id:12,doors:[0,0,NaN,0,0,0]}),null);
  seats.release('guest');
  assert.equal(seats.acceptVehicleDoors('guest',{id:12,doors:[0,0,0,0,0,0]}),null);
});

test('native car door sync uses stock OpenDoor and vehicle construction follows handling flags',()=>{
  const world=fs.readFileSync(path.join(__dirname,'..','engine','native-source','ViceTogetherWorld.cpp'),'utf8');
  const network=fs.readFileSync(path.join(__dirname,'..','engine','native-source','ViceTogetherNetwork.cpp'),'utf8');
  const native=fs.readFileSync(path.join(__dirname,'..','src','native-engine.cjs'),'utf8');
  const ui=fs.readFileSync(path.join(__dirname,'..','ui','network.js'),'utf8');
  assert.match(world,/HANDLING_IS_HELI/);
  assert.match(world,/HANDLING_IS_PLANE/);
  assert.match(world,/HANDLING_IS_BOAT/);
  assert.match(world,/HANDLING_IS_BIKE/);
  assert.match(world,/send\(62,unsigned\(id\),doors\)/);
  assert.match(world,/VT_TEST_VEHICLE_COLLISION/);
  assert.match(world,/SetPosition\(testCar->GetPosition\(\)\+forward\*45\.0f\)/);
  assert.match(world,/car->OpenDoor\(nodes\[i\],\(eDoors\)i,ratio\)/);
  assert.match(network,/wire\.type==63/);
  assert.match(native,/type===62&&!this\.authoritativeWorld/);
  assert.match(native,/this\.send\(63,update\.id,state\)/);
  assert.match(native,/VT_TEST_VEHICLE_COLLISION/);
  assert.match(native,/VT_TEST_VEHICLE.*\^\(130\|176\|182\|190\|191\|203\|217\)\$/);
  assert.match(ui,/acceptVehicleDoors\(peerId,update\)/);
});
