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
});
