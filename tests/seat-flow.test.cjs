const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('host and guest release seat reservations when they exit a vehicle',async()=>{
  const {localSeatAction}=await import('../ui/seat-actions.mjs');
  assert.deepEqual(localSeatAction(true,{id:42,seat:-1},-1),{driver:true,car:{id:42,seat:-1}});
  assert.deepEqual(localSeatAction(true,{id:42,seat:0},-1),{id:42});
  assert.deepEqual(localSeatAction(true,{id:-1,seat:-1},42),{release:true});
  assert.deepEqual(localSeatAction(false,{id:-1,seat:-1},42),{release:true});
  assert.equal(localSeatAction(false,{id:42,seat:0},-1),null);
  assert.equal(localSeatAction(true,{id:-1,seat:-1},-1),null);
});

test('repeated F/seat requests do not queue duplicate grants that can re-seat a player after exit',async()=>{
  const {PrivateLobby}=await import('../ui/network.js');
  const {SeatAuthority}=require('../engine/seats.cjs');
  const car=Array(34).fill(0);car[17]=1000;car[22]=2;
  const player={state:[0,0,0,0,0,0,0,1,100,0],time:performance.now()};
  const lobby={seats:new SeatAuthority(),states:new Map([['guest',player]]),seatOutput:{send:async claim=>sent.push(claim)}};
  const sent=[];lobby.seats.world({entities:[{id:12,type:22,state:car}]});
  PrivateLobby.prototype.acceptSeat.call(lobby,'guest',{id:12,driver:true});
  PrivateLobby.prototype.acceptSeat.call(lobby,'guest',{id:12,driver:true});
  assert.deepEqual(sent,[{id:12,seat:-1}]);
  PrivateLobby.prototype.acceptSeat.call(lobby,'guest',{release:true});
  PrivateLobby.prototype.acceptSeat.call(lobby,'guest',{id:12,driver:true});
  assert.deepEqual(sent,[{id:12,seat:-1},{id:12,seat:-1}]);
});

test('native multiplayer seat grants use Vice City enter tasks instead of teleporting into seats',()=>{
  const file=path.join(__dirname,'..','engine','native-source','ViceTogetherWorld.cpp');
  const source=fs.readFileSync(file,'utf8');
  const start=source.indexOf('void ViceTogetherGrantPassenger(');
  const end=source.indexOf('void ViceTogetherCaptureDriver(',start);
  assert.notEqual(start,-1,'seat grant function exists');
  assert.notEqual(end,-1,'seat grant function has a following boundary');
  const grant=source.slice(start,end);
  assert.match(grant,/SetObjective\(OBJECTIVE_ENTER_CAR_AS_DRIVER,car\)/);
  assert.match(grant,/SetObjective\(OBJECTIVE_ENTER_CAR_AS_PASSENGER,car\)/);
  const code=grant.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,'');
  assert.doesNotMatch(code,/WarpPedIntoCar|pPassengers\s*\[[^\]]+\]\s*=|SetDriver\s*\(|AddPassenger\s*\(/);
});

test('hidden two-game guest-driving test actually runs and checks native exit transitions',()=>{
  const network=fs.readFileSync(path.join(__dirname,'..','engine','native-source','ViceTogetherNetwork.cpp'),'utf8');
  const world=fs.readFileSync(path.join(__dirname,'..','engine','native-source','ViceTogetherWorld.cpp'),'utf8');
  const harness=fs.readFileSync(path.join(__dirname,'..','src','native-game-test.cjs'),'utf8');
  assert.match(network,/if\(getenv\("VT_TEST_GUEST_DRIVE"\)\)\{ViceTogetherWorldTestDrive\(\);return;\}/);
  assert.match(world,/pad->NewState\.Triangle=255/);
  assert.match(world,/roadPosition-player->GetPosition\(\)\)\.MagnitudeSqr\(\)<900\.0f/);
  assert.match(world,/testCar->m_fHealth=1000\.0f/);
  assert.match(harness,/did not exit the shared vehicle normally/);
  assert.match(harness,/silently re-seated after exiting/);
  assert.match(world,/!guestDriverRequestSent&&now-last>500/);
});

test('native world creates supported helicopter/plane replicas and guest menu requests pass through host authority',()=>{
  const root=path.join(__dirname,'..');
  const world=fs.readFileSync(path.join(root,'engine','native-source','ViceTogetherWorld.cpp'),'utf8');
  const menu=fs.readFileSync(path.join(root,'engine','native-source','ViceTogether.cpp'),'utf8');
  const network=fs.readFileSync(path.join(root,'engine','native-source','ViceTogetherNetwork.cpp'),'utf8');
  const lobby=fs.readFileSync(path.join(root,'ui','network.js'),'utf8');
  assert.match(world,/#include "Heli.h"/);assert.match(world,/#include "Plane.h"/);
  assert.match(world,/case VEHICLE_TYPE_HELI:return createMultiplayerHeli/);assert.match(world,/case VEHICLE_TYPE_PLANE:return new CPlane/);
  assert.match(world,/heli->m_heliType=HELI_TYPE_SCRIPT/);assert.match(world,/heli->m_numSwat=0/);
  assert.match(world,/RANDOM assigns an autonomous target altitude/);
  assert.match(world,/!car->IsHeli\(\) && !car->IsPlane\(\)/);
  assert.match(world,/IsHeli\(\)\?3:car->IsPlane\(\)\?4:0/);
  assert.match(menu,/else if\(action<2000\)ViceTogetherWorldRequestVehicle\(action-1000\)/);
  assert.match(network,/sendWorld\(55,0,state\)/);assert.match(network,/wire\.type==56[^\n]*ViceTogetherWorldSpawnVehicle/);
  assert.match(lobby,/acceptVehicleSpawn\(peerId,request\?\.model/);
});
