const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {POLICE_PED_TYPE,validWorldFrame,retainSupportedWorldPeds}=require('../engine/world.cjs');
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
  assert.equal(validWorldFrame({seq:1,entities:Array.from({length:33},(_,i)=>vehicle(i))}),false);
  assert.equal(validWorldFrame({seq:Infinity,entities:[]}),false);
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
