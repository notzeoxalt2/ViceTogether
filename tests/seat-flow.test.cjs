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

test('native heli cockpit exposes front access to the stock seat-entry task',()=>{
  const patch=fs.readFileSync(path.join(__dirname,'..','engine','native-source','native-engine.patch'),'utf8');
  assert.match(patch,/CHeli::IsRoomForPedToLeaveCar\(uint32 component, CVector \*forcedDoorPos\)/);
  assert.match(patch,/return component == CAR_DOOR_LF \|\| component == CAR_DOOR_RF;/);
  assert.match(patch,/CHeli::IsDoorReady\(eDoors door\)/);
  assert.match(patch,/CHeli::IsDoorFullyOpen\(eDoors door\)/);
  assert.match(patch,/m_fRotorRotation \+= \(3\.14f\/6\.5f\) \* CTimer::GetTimeStep\(\) \* 0\.6f;/);
});

test('hidden two-game guest-driving test actually runs and checks native exit transitions',()=>{
  const network=fs.readFileSync(path.join(__dirname,'..','engine','native-source','ViceTogetherNetwork.cpp'),'utf8');
  const world=fs.readFileSync(path.join(__dirname,'..','engine','native-source','ViceTogetherWorld.cpp'),'utf8');
  const harness=fs.readFileSync(path.join(__dirname,'..','src','native-game-test.cjs'),'utf8');
  assert.match(harness,/async function waitFor\(check,message,timeout=20000\)/,'Native scenario polling must be defined inside its harness');
  assert.match(harness,/testLobby\.sendVehicleSpawnRequest\(\$\{JSON\.stringify\(model\)\}\)/,'The hidden guest spawn check must forward its real native request through the lobby');
  assert.match(harness,/spawnApprovals:\$\{i===0\?'window\.testVehicleSpawnApprovals\.splice\(0,16\)'/,'The hidden host engine must consume lobby-approved vehicle spawns');
  assert.match(network,/if\(getenv\("VT_TEST_GUEST_DRIVE"\)\)\{ViceTogetherWorldTestDrive\(\);return;\}/);
  assert.match(network,/if\(getenv\("VT_TEST_MENU"\)\|\|getenv\("VT_TEST_GUEST_SPAWN"\)\)/,'The hidden helicopter spawn scenario must drive the actual native menu path');
  assert.match(world,/pad->NewState\.Triangle=255/);
  assert.match(world,/difference\.MagnitudeSqr\(\)>=900\.0f\|\|fabsf\(roadPosition\.z-player->GetPosition\(\)\.z\)>4\.0f/);
  assert.match(world,/FindGroundZFor3DCoord\(candidate\.x,candidate\.y,player->GetPosition\(\)\.z\+5\.0f,&groundFound\)/);
  assert.match(world,/if\(candidate->IsBoat\(\)\)\{for\(int radius=3;radius<=10/);
  assert.match(world,/testCar->m_fHealth=1000\.0f/);
  assert.match(harness,/did not exit the shared vehicle normally/);
  assert.match(harness,/silently re-seated after exiting/);
  assert.match(world,/!guestDriverRequestSent&&now-last>500/);
  assert.match(world,/!hostPassengerRequested&&!player->bInVehicle&&testCar->m_nNumMaxPassengers>0/,'The host should finish its stock passenger entry before a helicopter departs');
  assert.match(world,/VT_ReadRemoteSkeleton\(0,hostSeatState\)/,'The helicopter driver test must inspect the remote ped seat, not unrelated movement fields');
  assert.match(world,/model!=217\|\|\(haveHostSeat&&int\(hostSeatState\[29\]\)==int\(candidateId\)&&hostSeatState\[33\]>=0\)/,'The helicopter driver should wait until the host is actually seated');
  assert.match(harness,/seat\.id>=0&&seat\.seat>=0[^;]*sendSeat[^;]*\{id:seat\.id\}/,'Host passenger occupancy must be reserved in the lobby snapshot');
  const native=fs.readFileSync(path.join(__dirname,'..','src','native-engine.cjs'),'utf8');
  assert.match(native,/VT_TEST_VEHICLE'&&\/\^\(130\|176\|182\|190\|191\|203\|217\)\$/,'Hidden vehicle fixtures must pass supported boat models into the game');
});

test('native world creates supported helicopter/plane replicas and guest menu requests pass through host authority',()=>{
  const root=path.join(__dirname,'..');
  const world=fs.readFileSync(path.join(root,'engine','native-source','ViceTogetherWorld.cpp'),'utf8');
  const menu=fs.readFileSync(path.join(root,'engine','native-source','ViceTogether.cpp'),'utf8');
  const network=fs.readFileSync(path.join(root,'engine','native-source','ViceTogetherNetwork.cpp'),'utf8');
  const lobby=fs.readFileSync(path.join(root,'ui','network.js'),'utf8');
  assert.match(world,/#include "Heli.h"/);assert.match(world,/#include "Plane.h"/);
  assert.match(world,/case VEHICLE_TYPE_HELI:return createMultiplayerHeli/);assert.match(world,/case VEHICLE_TYPE_PLANE:return new CPlane/);
  assert.match(world,/heli->m_heliType=HELI_TYPE_CATALINA/);assert.match(world,/heli->m_pathState=7/);assert.match(world,/heli->m_numSwat=0/);
  assert.match(world,/stationary route state/);assert.match(world,/if\(occupied\|\|remotePilot\)/);
  assert.match(world,/void trackNetworkHeli\(CVehicle\* car\)/);
  assert.match(world,/const_cast<CVehicle\*>\(car\)->IsHeli\(\) && car->pDriver!=FindPlayerPed\(\).*networkHelis/);
  assert.match(world,/!car->IsHeli\(\) && !car->IsPlane\(\)/);
  assert.match(world,/IsHeli\(\)\?3:car->IsPlane\(\)\?4:0/);
  assert.match(menu,/else if\(action<2000\)ViceTogetherWorldRequestVehicle\(action-1000\)/);
  assert.match(network,/sendWorld\(55,0,state\)/);assert.match(network,/wire\.type==56[^\n]*ViceTogetherWorldSpawnVehicle/);
  assert.match(lobby,/acceptVehicleSpawn\(peerId,request\?\.model/);
});

test('guest-requested helicopters stay at player elevation and other vehicles have a safe fallback',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','engine','native-source','ViceTogetherWorld.cpp'),'utf8');
  const start=source.indexOf('void ViceTogetherWorldMenuTick()');
  const end=source.indexOf('void ViceTogetherWorldExplosion(',start);
  const tick=source.slice(start,end);
  assert.match(tick,/const float referenceZ=position\.z/);
  assert.match(tick,/FindGroundZFor3DCoord\(candidate\.x,candidate\.y,referenceZ\+5\.0f,&found\)/);
  assert.match(tick,/fabsf\(ground-referenceZ\)<=4\.0f/);
  assert.match(tick,/FindNodeClosestToCoors\(candidate,PATH_CAR,6\.0f\)/);
  assert.match(tick,/fabsf\(node\.z-referenceZ\)<=4\.0f/);
  assert.match(tick,/if\(model==217\)\{[\s\S]*groundedPosition\.z=referenceZ\+1\.0f;/);
  assert.match(tick,/if\(!safeGround\)[\s\S]*groundedPosition=position;[\s\S]*groundedPosition\.z=referenceZ\+1\.0f;/);
  assert.doesNotMatch(tick,/Could not find safe ground at your level nearby/);
  assert.doesNotMatch(tick,/searchRadius=menuSpawnHasPosition\?60\.0f:40\.0f/);
});

test('heli spawn verification distinguishes a new two-client spawn from an ambient rooftop helicopter',()=>{
  const root=path.join(__dirname,'..');
  const world=fs.readFileSync(path.join(root,'engine','native-source','ViceTogetherWorld.cpp'),'utf8');
  const native=fs.readFileSync(path.join(root,'src','native-engine.cjs'),'utf8');
  const harness=fs.readFileSync(path.join(__dirname,'..','src','native-game-test.cjs'),'utf8');
  assert.match(world,/if\(getenv\("VT_TEST_GUEST_SPAWN"\)\)\{[\s\S]*car->IsHeli\(\)[\s\S]*out\[19\]\+\+/,
    'The test telemetry must count live native Maverick instances in each game');
  assert.match(native,/observed\.testHelicopters=\{count:state\[19\],nearest:\{position:state\.slice\(20,23\)/,
    'Native reports must include count, nearest position, rotor rotation and health');
  assert.match(harness,/heliBaselineCounts=worldStatusHistory\.map\(history=>history\.at\(-1\)\?\.testHelicopters\?\.count\)/,
    'The scenario must compare post-request helicopter counts to both clients’ baseline');
  assert.match(harness,/The approved request did not add a helicopter at the expected location to both native game worlds/,
    'An ambient helicopter near the test must not make a failed spawn appear successful');
});
