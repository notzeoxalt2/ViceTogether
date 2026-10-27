const test = require('node:test');
const assert = require('node:assert/strict');
const { VEHICLE_MODELS, VEHICLE_CLASSES, vehicleSpawnClearance, acceptVehicleSpawn } = require('../engine/vehicle-spawn.cjs');
const { validWorldFrame } = require('../engine/world.cjs');

function fixture() {
  const peer = 'guest-peer';
  return { peer, players: new Map([[peer, {}]]), states: new Map([[peer, { time: 1000, state: [10, 20, 3, Math.PI / 2, 0, 0, 0, 1, 100, 0] }]]), cooldowns: new Map() };
}

test('a fresh guest can request any supported vehicle model near their authoritative position', () => {
  const state = fixture();
  for (const model of VEHICLE_MODELS) {
    state.cooldowns.clear();
    const result = acceptVehicleSpawn(state.peer, model, { ...state, now: 1100 });
    const clearance=vehicleSpawnClearance(model);
    assert.deepEqual(result, { model, position: [10-clearance, 20, 3], heading: Math.PI / 2, requester: state.peer });
  }
});

test('every supported vehicle has a native class and testable spawn path',()=>{
  const {nativeTestFlags}=require('../src/native-engine.cjs');
  for(const model of VEHICLE_MODELS){
    assert.ok(['car','bike','boat','helicopter','plane'].includes(VEHICLE_CLASSES[model]),`Missing native class for model ${model}`);
    assert.equal(nativeTestFlags({VT_TEST_VEHICLE:String(model)}).VT_TEST_VEHICLE,String(model),`Native test launcher dropped model ${model}`);
  }
  assert.equal(nativeTestFlags({VT_TEST_VEHICLE:'999'}).VT_TEST_VEHICLE,undefined);
  assert.equal(VEHICLE_CLASSES[155],'helicopter');
  assert.equal(VEHICLE_CLASSES[190],'plane');
});

test('helicopter requests keep the rotor disc clear of the requester',()=>{
  const state=fixture();
  for(const model of [155,217]){
    state.cooldowns.clear();
    const result=acceptVehicleSpawn(state.peer,model,{...state,now:1100});
    const minimum=model===217?24:18;
    assert.equal(vehicleSpawnClearance(model),minimum);
    assert.ok(Math.hypot(result.position[0]-state.states.get(state.peer).state[0],result.position[1]-state.states.get(state.peer).state[1])>=minimum);
  }
});

test('the invite authority supports the actual Maverick model 217',()=>{
  const state=fixture();
  assert.ok(VEHICLE_MODELS.includes(217));
  assert.equal(vehicleSpawnClearance(217),24);
  const request=acceptVehicleSpawn(state.peer,217,{...state,now:1100});
  assert.equal(request.model,217);
  assert.ok(Math.hypot(request.position[0]-10,request.position[1]-20)>=24);
});

test('vehicle spawn rejects strangers, invalid models, stale/dead/in-vehicle players and rate spam', () => {
  const state = fixture();
  assert.equal(acceptVehicleSpawn('stranger', 217, { ...state, now: 1100 }), null);
  assert.equal(acceptVehicleSpawn(state.peer, 999, { ...state, now: 1100 }), null);
  assert.equal(acceptVehicleSpawn(state.peer, 217, { ...state, now: 2600 }), null);
  state.states.get(state.peer).state[8] = 0;
  assert.equal(acceptVehicleSpawn(state.peer, 217, { ...state, now: 1100 }), null);
  state.states.get(state.peer).state[8] = 100;
  state.states.get(state.peer).state[9] = 1;
  assert.equal(acceptVehicleSpawn(state.peer, 217, { ...state, now: 1100 }), null);
  state.states.get(state.peer).state[9] = 0;
  assert.ok(acceptVehicleSpawn(state.peer, 217, { ...state, now: 1100 }));
  assert.equal(acceptVehicleSpawn(state.peer, 217, { ...state, now: 1200 }), null);
});

test('helicopter and plane frames pass world validation while unknown vehicle classes do not', () => {
  const vehicle = kind => { const state = Array(34).fill(0);state[0]=217;state[1]=kind;state[5]=state[9]=state[13]=1;state[17]=1000;return {type:22,id:1,state}; };
  for (const kind of [3,4]) assert.equal(validWorldFrame({seq:1,entities:[vehicle(kind)]}),true);
  assert.equal(validWorldFrame({seq:1,entities:[vehicle(5)]}),false);
});

test('world frames accept a validated shared cheat flag while rejecting malformed values',()=>{
 const environment=[12,0,0,0,0,0,...Array(13).fill(0),1];
 const frame={seq:1,environment,entities:[]};
 assert.equal(validWorldFrame(frame),true);
 frame.environment[21]=2;assert.equal(validWorldFrame(frame),false);
});
