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
  const world=fs.readFileSync(path.join(__dirname,'..','engine','native-source','ViceTogetherWorld.cpp'),'utf8');
  assert.match(patch,/CHeli::IsRoomForPedToLeaveCar\(uint32 component, CVector \*forcedDoorPos\)/);
  assert.match(patch,/return component == CAR_DOOR_LF \|\| component == CAR_DOOR_RF;/);
  assert.match(patch,/CHeli::IsDoorReady\(eDoors door\)/);
  assert.match(patch,/CHeli::IsDoorFullyOpen\(eDoors door\)/);
  const grant=world.slice(world.indexOf('void ViceTogetherGrantPassenger('),world.indexOf('void ViceTogetherCaptureDriver('));
  const helicopter=grant.slice(grant.indexOf('if(multiplayerHelicopter(car))'),grant.indexOf('// Do not WarpPedIntoCar'));
  assert.match(helicopter,/player->SetObjective\(OBJECTIVE_ENTER_CAR_AS_PASSENGER,car\);\s*\/\/ The Maverick's passenger node[\s\S]*?player->SetEnterCar_AllClear\(car,player->m_vehDoor,0\);/);
  assert.doesNotMatch(helicopter,/player->SetEnterCar\(car,player->m_vehDoor\)/,'Maverick entry cannot wait on a missing standard-door readiness flag');
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
  assert.match(world,/difference\.MagnitudeSqr\(\)<1600\.0f&&fabsf\(roadPosition\.z-player->GetPosition\(\)\.z\)<=4\.0f/,'The driving fixture should prefer a nearby open road node over an unverified sidewalk spawn');
  assert.match(world,/passengerExitSpeed>0\.32f&&testCar->pDriver&&testCar->pDriver!=player/,'The passenger-exit test must wait for the stock jump-out speed window with the guest still driving');
  assert.match(world,/driveTime>30000/,'The automated driver must remain in control long enough for a moving passenger-exit check');
  assert.match(world,/if\(!car&&p->m_carInObjective&&\(p->EnteringCar\(\)\|\|enteringObjective\)\)car=p->m_carInObjective/,'Door capture should include the stock car-entry objective before seat attachment');
  assert.match(world,/FindGroundZFor3DCoord\(candidate\.x,candidate\.y,player->GetPosition\(\)\.z\+5\.0f,&groundFound\)/);
  assert.match(world,/if\(candidate->IsBoat\(\)\)\{for\(int radius=3;radius<=10/);
  assert.match(world,/testCar->m_fHealth=1000\.0f/);
  assert.match(harness,/did not exit the shared vehicle normally/);
  assert.match(harness,/silently re-seated after exiting/);
  assert.match(world,/!guestDriverRequestSent&&now-last>500/);
  assert.match(world,/!hostPassengerRequested&&!player->bInVehicle&&testCar->m_nNumMaxPassengers>0/,'The host should finish its stock passenger entry before a helicopter departs');
  assert.match(world,/VT_ReadRemoteSkeleton\(0,hostSeatState\)/,'The helicopter driver test must inspect the remote ped seat, not unrelated movement fields');
  assert.match(world,/!helicopter\|\|\(haveHostSeat&&int\(hostSeatState\[29\]\)==int\(candidateId\)&&hostSeatState\[33\]>=0\)/,'Each helicopter driver test should wait until the host is actually seated');
  assert.match(harness,/seat\.id>=0&&seat\.seat>=0[^;]*sendSeat[^;]*\{id:seat\.id\}/,'Host passenger occupancy must be reserved in the lobby snapshot');
  const native=fs.readFileSync(path.join(__dirname,'..','src','native-engine.cjs'),'utf8');
  assert.match(native,/Object\.assign\(env,nativeTestFlags\(\)\)/,'Hidden vehicle fixtures must pass every supported vehicle model into the game');
  assert.match(world,/void ViceTogetherWorldSeatDiagnostic\(float\* out\)/,'Helicopter entry failures must capture native ped-task and door state');
  assert.match(network,/sendWorld\(24,0,seatTask\)/,'Model 217 seat diagnostics must use the existing loopback bridge');
  assert.match(native,/type===24&&state\.every\(Number\.isFinite\).*seat-task-diagnostic/,'The native harness must retain the seat-task samples');
  assert.match(harness,/nativeSeatTaskSamples:seatTaskDiagnostics\[0\]\.slice\(-80\)/,'Helicopter failures must save native samples for diagnosis');
});

test('multiplayer car passengers use the stock jump-out animation and speed gate',()=>{
  const patch=fs.readFileSync(path.join(__dirname,'..','engine','native-source','native-engine.patch'),'utf8');
  assert.match(patch,/else if \(getenv\("VT_PORT"\) && veh->m_vehType == VEHICLE_TYPE_CAR\)[\s\S]*canJumpOff = veh->CanPedJumpOutCar\(\);/);
  assert.match(patch,/if \(canJumpOff \|\| veh->m_vecMoveSpeed\.Magnitude\(\) < 0\.1f\)/,
    'A passenger may leave slowly by the normal path or jump within the stock vehicle safety band');
});

test('native world creates supported helicopter/plane replicas and guest menu requests pass through host authority',()=>{
  const root=path.join(__dirname,'..');
  const world=fs.readFileSync(path.join(root,'engine','native-source','ViceTogetherWorld.cpp'),'utf8');
  const menu=fs.readFileSync(path.join(root,'engine','native-source','ViceTogether.cpp'),'utf8');
  const network=fs.readFileSync(path.join(root,'engine','native-source','ViceTogetherNetwork.cpp'),'utf8');
  const lobby=fs.readFileSync(path.join(root,'ui','network.js'),'utf8');
  assert.match(world,/#include "Heli.h"/);assert.match(world,/#include "Plane.h"/);
  assert.match(world,/case VEHICLE_TYPE_HELI:return createMultiplayerHeli/);assert.match(world,/case VEHICLE_TYPE_PLANE:return new CPlane/);
  assert.match(world,/return new CAutomobile\(model,MISSION_VEHICLE\)/,'Multiplayer helicopters must use reVC’s player-controllable helicopter handling');
  assert.match(world,/hard-locks Z to 31\.55m/);assert.match(world,/if\(heli->pDriver!=nil\|\|remotePilot\)/,
    'A passenger without a pilot must not keep the helicopter engine or rotor running');
  assert.match(world,/void trackNetworkHeli\(CVehicle\* car\)/);
  assert.match(world,/multiplayerHelicopter\(const_cast<CVehicle\*>\(car\)\) && car->pDriver!=FindPlayerPed\(\).*networkHelis/);
  assert.match(world,/!multiplayerHelicopter\(car\) && !car->IsPlane\(\)/);
  assert.match(world,/multiplayerHelicopter\(car\)\?3:car->IsPlane\(\)\?4:0/);
  assert.match(menu,/else if\(action<2000\)ViceTogetherWorldRequestVehicle\(action-1000\)/);
  assert.match(network,/sendWorld\(55,0,state\)/);assert.match(network,/wire\.type==56[^\n]*ViceTogetherWorldSpawnVehicle/);
  assert.match(lobby,/acceptVehicleSpawn\(peerId,request\?\.model/);
});

test('Maverick menu and native helicopter checks consistently use reVC model 217',()=>{
  const root=path.join(__dirname,'..');
  const world=fs.readFileSync(path.join(root,'engine','native-source','ViceTogetherWorld.cpp'),'utf8');
  const menu=fs.readFileSync(path.join(root,'engine','native-source','ViceTogether.cpp'),'utf8');
  const harness=fs.readFileSync(path.join(root,'src','native-game-test.cjs'),'utf8');
  assert.match(menu,/\{"Maverick",1217\}/);
  assert.match(world,/allowedVehicleModels\[\]=\{[^}]*,217\}/);
  assert.match(world,/GetModelIndex\(\)==targetHeli/);
  assert.match(harness,/VEHICLE_CLASSES\[model\]/);
  assert.match(harness,/VT_TEST_VEHICLE\)===217/);
});

test('network death respawn picks a nearby safe road instead of a roof surface',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','engine','native-source','ViceTogether.cpp'),'utf8');
  const start=source.indexOf('static bool findSafeMultiplayerRespawn(');
  const end=source.indexOf('void VT_ApplyLocalHealth(',start);
  const helper=source.slice(start,end);
  assert.match(helper,/const float rings\[\]=\{10\.0f,16\.0f,22\.0f,28\.0f,34\.0f,40\.0f\}/);
  assert.match(helper,/FindNodeClosestToCoors\(probe,PATH_CAR,24\.0f\)/);
  assert.match(helper,/FindGroundZFor3DCoord\(node\.x,node\.y,node\.z\+5\.0f,&groundFound\)/);
  assert.match(helper,/fabsf\(ground-node\.z\)>3\.5f/);
  assert.match(source,/findSafeMultiplayerRespawn\(center,spawn\)&&!findSafeMultiplayerRespawn\(CVector\(-592\.0f,670\.0f,10\.0f\),spawn\)/);
  assert.doesNotMatch(source,/FindGroundZFor3DCoord\(spawn\.x,spawn\.y,2000/,
    'A high collision probe can pick a roof instead of a nearby street');
});

test('guest-requested helicopters find ground when requested during a fall',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','engine','native-source','ViceTogetherWorld.cpp'),'utf8');
  const start=source.indexOf('void ViceTogetherWorldMenuTick()');
  const end=source.indexOf('void ViceTogetherWorldExplosion(',start);
  const tick=source.slice(start,end);
  assert.match(tick,/const float referenceZ=position\.z/);
  assert.match(tick,/if\(model==217\)[\s\S]*FindGroundZFor3DCoord\(candidate\.x,candidate\.y,referenceZ\+5\.0f,&found\)[\s\S]*referenceZ\+100\.0f/);
  assert.match(tick,/if\(!safeGround\)\{menuSpawnModel=-1;menuStatus="No safe ground found nearby\. Move closer to a road and try again";if\(test\)testGuestSpawnStage=11;return;\}/);
  assert.match(tick,/fabsf\(ground-referenceZ\)<=4\.0f/);
  assert.match(tick,/FindNodeClosestToCoors\(candidate,PATH_CAR,6\.0f\)/);
  assert.match(tick,/fabsf\(node\.z-referenceZ\)<=4\.0f/);
  assert.match(tick,/if\(!safeGround\)[\s\S]*groundedPosition=position;[\s\S]*groundedPosition\.z=referenceZ\+1\.0f;/);
  assert.doesNotMatch(tick,/Could not find safe ground at your level nearby/);
  assert.doesNotMatch(tick,/searchRadius=menuSpawnHasPosition\?60\.0f:40\.0f/);
});

test('heli spawn verification requires the approved two-client grounded, engine-off spawn',()=>{
  const root=path.join(__dirname,'..');
  const world=fs.readFileSync(path.join(root,'engine','native-source','ViceTogetherWorld.cpp'),'utf8');
  const native=fs.readFileSync(path.join(root,'src','native-engine.cjs'),'utf8');
  const harness=fs.readFileSync(path.join(__dirname,'..','src','native-game-test.cjs'),'utf8');
  assert.match(world,/if\(getenv\("VT_TEST_GUEST_SPAWN"\)\)\{[\s\S]*multiplayerHelicopter\(car\)[\s\S]*out\[19\]\+\+/,
    'The test telemetry must count live player-class helicopters as well as native AI helicopters');
  assert.match(world,/bool multiplayerHelicopter\(CVehicle\* car\)[\s\S]*m_vehicleType==VEHICLE_TYPE_HELI[\s\S]*HANDLING_IS_HELI/,
    'Helicopter classification must use model metadata because CAutomobile helicopter replicas report IsHeli false');
  assert.match(world,/const bool heli=multiplayerHelicopter\(car\);[\s\S]*SetStatus\(heli\?STATUS_PHYSICS:STATUS_ABANDONED\)[\s\S]*bEngineOn=false/,
    'Player-class helicopter spawns must start parked with their engine off');
  assert.match(native,/observed\.testHelicopters=\{count:state\[19\],nearest:\{position:state\.slice\(20,23\)/,
    'Native reports must include count, nearest position, rotor rotation and health');
  assert.match(native,/observed\.testSpawn=\{calls:state\[27\],stage:state\[28\],stageName:/,
    'Native reports must expose which phase of a guest vehicle spawn actually ran');
  assert.match(world,/testGuestSpawnStage=10/,
    'The test must distinguish a native vehicle creation from a lobby approval');
  assert.match(world,/testGuestSpawnVehicle=car/,
    'The test must inspect the exact created vehicle instead of inferring it from a nearby city helicopter');
  assert.match(native,/groundZ:state\[29\],createdModel:state\[30\],createdZ:state\[31\],createdHasRenderObject:state\[32\]===1,createdVehicleId:state\[33\]/,
    'Native test telemetry must verify the created object’s ground clearance and rendered game instance');
  assert.match(world,/float networkHeliRotorAngle\(CVehicle\* car\)/,
    'Rotor telemetry must read CAutomobile rotor angles for multiplayer helicopters without casting them as AI CHeli objects');
  assert.match(world,/automobile->m_aWheelSpeed\[1\]=0\.0f;[\s\S]*heli->bEngineOn=false/,
    'New player-class helicopters must start with stopped rotors and no engine audio');
  assert.match(world,/automobile->m_aWheelSpeed\[1\]=0\.0f;[\s\S]*heli->bEngineOn=false/,
    'Unpiloted multiplayer helicopters must stay shut down during idle stabilization');
  assert.match(world,/model==217\?24\.0f/,
    'The player-class Maverick must spawn with 24 m of horizontal clearance');
  assert.match(native,/rotorSpeed:state\[16\],status:state\[17\],engineOn:state\[18\]===1/,
    'Hidden helicopter reports must include real native rotor speed and engine status');
  assert.match(harness,/groundClearance:heli\.position\[2\]-heli\.groundZ/,
    'Both clients must report the spawned helicopter’s clearance from the local ground surface');
  assert.match(harness,/hostCreatedSpawn=worldStatusTimeline\[0\]\.findLast\([\s\S]*testSpawn\?\.createdModel===217[\s\S]*createdHasRenderObject[\s\S]*createdZ-sample\.testSpawn\.groundZ/,
    'The host test must verify the rendered model-217 spawn sits on its ground surface');
  assert.match(harness,/Object\.values\(rotorSpeedSamples\)\.every\(samples=>samples\.length>10&&samples\.every\(speed=>Math\.abs\(speed\)<=0\.01\)\)/,
    'An unpiloted helicopter must remain silent with its rotors stopped');
});
