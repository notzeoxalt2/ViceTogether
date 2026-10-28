const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {POLICE_PED_TYPE,validWorldFrame,validDriverSnapshot,retainSupportedWorldPeds}=require('../engine/world.cjs');
const {NativeEngine}=require('../src/native-engine.cjs');
function vehicle(id=42){const state=Array(34).fill(0);state[0]=130;state[5]=state[9]=state[13]=1;state[17]=1000;return {id,type:22,state};}
test('police injury state reaches the replica while civilian replicas and invalid bone indices are rejected',()=>{
  const state=Array(34).fill(0);state[0]=7;state[1]=POLICE_PED_TYPE;state[8]=state[9]=-1;state[30]=180;state[31]=3|32|128;
  const frame={seq:3,entities:[{type:21,id:123,state}]};assert.ok(validWorldFrame(frame));
  const engine=new NativeEngine('unused'),packets=[];engine.socket={send:p=>packets.push(p)};engine.endpoint=1234;assert.ok(engine.remoteWorld(frame));
  const npc=packets.find(p=>p.readUInt32LE(4)===21);assert.equal(npc.readFloatLE(12+30*4),180);assert.equal(npc.readFloatLE(12+31*4),163);
  state[31]=31|32|128;assert.equal(validWorldFrame(frame),false);
  state[31]=3|32|128;state[1]=4;assert.equal(validWorldFrame(frame),false,'civilian NPCs are not part of the shared police stream');
});
test('native world capture and packet intake are restricted to police pedestrians',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../engine/native-source/ViceTogetherWorld.cpp'),'utf8');
  assert.match(source,/p->m_nPedType!=PEDTYPE_COP/);
  assert.match(source,/type==21 && state\[1\]!=float\(PEDTYPE_COP\)/);
});
test('native world capture prioritizes every vehicle occupied by a session player',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../engine/native-source/ViceTogetherWorld.cpp'),'utf8');
  const priority=source.indexOf('Never let the nearby-vehicle budget drop a car another player is using.');
  const boundedSelection=source.indexOf('for(size_t zone=0;zone<carsByCenter.size() && selectedCars.size()<32;zone++)');
  assert.ok(priority>=0&&boundedSelection>priority,'Player-occupied vehicles must be selected before the capped ambient-car quota');
  const capture=source.slice(priority,boundedSelection);
  assert.match(capture,/isSessionPlayer\(car->pDriver\)/,'A player-driven car is always included');
  assert.match(capture,/isSessionPlayer\(car->pPassengers\[seat\]\)/,'A car occupied only by a player passenger is always included');
});
test('host wrecks still apply to a guest driven car without overriding its live transform',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../engine/native-source/ViceTogetherWorld.cpp'),'utf8');
  const start=source.indexOf('const bool fastDrivenVehicle=');
  const end=source.indexOf('if(!r.entity)',start);
  const localDriver=source.slice(start,end);
  assert.match(localDriver,/const bool authoritativeWreck=/,'Host world state must be checked even while direct driver packets are fresh');
  assert.match(localDriver,/localCar->BlowUpCar\(nil\)/,'A host wreck is replayed through the native explosion path on the guest');
  assert.match(localDriver,/driverMotions\.erase\(entry\.first\)/,'A wrecked vehicle must stop stale client-side driver interpolation');
});
test('unsupported civilian replicas are dropped without discarding supported world entities',()=>{
  const civilian=Array(34).fill(0);civilian[0]=7;civilian[1]=4;civilian[8]=civilian[9]=-1;
  const police=Array(34).fill(0);police[0]=7;police[1]=POLICE_PED_TYPE;police[8]=police[9]=-1;
  const source={seq:4,entities:[{type:21,id:1,state:civilian},{type:21,id:2,state:police},vehicle(3)]};
  const {frame,droppedPeds}=retainSupportedWorldPeds(source);
  assert.equal(droppedPeds,1);assert.deepEqual(frame.entities.map(e=>e.id),[2,3]);
  assert.ok(validWorldFrame(frame),'a legacy civilian must not discard police and vehicle updates from its frame');
  assert.equal(source.entities.length,3,'normalization leaves the pending source frame untouched');
});
test('world frames reject duplicate identities, malformed vehicle bases and excess population',()=>{
  const entity=vehicle();assert.ok(validWorldFrame({seq:1,entities:[entity]}));
  assert.equal(validWorldFrame({seq:1,entities:[entity,entity]}),false);
  const invalid=vehicle();invalid.state[5]=0;assert.equal(validWorldFrame({seq:1,entities:[invalid]}),false);
  const excessiveSpin=vehicle();excessiveSpin.state[23]=5.1;assert.equal(validWorldFrame({seq:1,entities:[excessiveSpin]}),false);
  assert.equal(validWorldFrame({seq:1,entities:Array.from({length:33},(_,i)=>vehicle(i))}),false);
  assert.equal(validWorldFrame({seq:Infinity,entities:[]}),false);
});
test('host vehicle snapshots are validated before the low-latency stream reaches guests',()=>{
  const state=Array(34).fill(0);state[0]=130;state[1]=0;state[5]=1;state[9]=1;state[13]=1;state[17]=1000;state[19]=2;state[20]=1;
  const visual=Array(34).fill(0),snapshot={id:42,state,visual};
  assert.equal(validDriverSnapshot(snapshot),true);
  const timestamped=[...state];timestamped[27]=65530;timestamped[28]=1;
  assert.equal(validDriverSnapshot({...snapshot,state:timestamped}),true,'a wrapped sender clock remains a valid snapshot');
  const invalidTimestamp=[...timestamped];invalidTimestamp[27]=65536;
  assert.equal(validDriverSnapshot({...snapshot,state:invalidTimestamp}),false,'out-of-range sender timestamps are rejected');
  const invalidTimestampFlag=[...timestamped];invalidTimestampFlag[28]=2;
  assert.equal(validDriverSnapshot({...snapshot,state:invalidTimestampFlag}),false,'unknown sender timestamp formats are rejected');
  assert.equal(validDriverSnapshot({...snapshot,id:-1}),false);
  assert.equal(validDriverSnapshot({...snapshot,state:[...state.slice(0,20),0,...state.slice(21)]}),false,'A non-driver cannot publish a driver snapshot');
  assert.equal(validDriverSnapshot({...snapshot,state:[...state.slice(0,5),0.5,...state.slice(6)]}),false,'Malformed orientation is rejected');
  assert.equal(validDriverSnapshot({...snapshot,visual:[...visual.slice(0,31),6,...visual.slice(32)]}),false,'Malformed visuals are rejected before transport');
});
test('native world bridge preserves large pool handles, transaction bounds and host authority',()=>{
  const engine=new NativeEngine('unused'),packets=[];engine.socket={send:p=>packets.push(p)};engine.endpoint=1234;
  const frame={seq:1,entities:[vehicle(12567)]};assert.ok(engine.remoteWorld(frame));
  assert.deepEqual(packets.map(p=>p.readUInt32LE(4)),[19,22,20]);
  assert.equal(packets[1].readUInt32LE(8),12567);
  assert.equal(engine.remoteWorld(frame),false);
  engine.authoritativeWorld=true;assert.equal(engine.remoteWorld({...frame,seq:2}),false);
});
test('weather intensity and wheel/door visuals survive the native world transaction',()=>{
  const entity=vehicle();entity.visual=Array(34).fill(0);entity.visual[3]=1.25;entity.visual[19]=0.5;
  const environment=[12,30,20,2,2,0.2,0.5,1,1,1,1,0,0,0,0,1,-1,0,0];
  const frame={seq:2,environment,entities:[entity]};assert.ok(validWorldFrame(frame));
  const engine=new NativeEngine('unused'),packets=[];engine.socket={send:p=>packets.push(p)};engine.endpoint=1234;engine.remoteWorld(frame);
  assert.deepEqual(packets.map(p=>p.readUInt32LE(4)),[19,22,35,20]);
  assert.equal(packets[0].readFloatLE(12+8*4),0.5);
  assert.equal(packets[2].readFloatLE(12+3*4),1.25);assert.equal(packets[2].readFloatLE(12+19*4),0.5);
  entity.visual[25]=Infinity;assert.equal(validWorldFrame(frame),false);
});
