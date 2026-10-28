const { test } = require('node:test');
const assert = require('node:assert/strict');
const { NativeEngine, cleanLabel,validState,packet } = require('../src/native-engine.cjs');
const {validVehicleVisual,validDriverVehicleVisual}=require('../engine/world.cjs');
test('rejoining clears previous native world and player sequence gates',()=>{
 const engine=new NativeEngine('unused'),packets=[];engine.socket={send:b=>packets.push(b)};engine.endpoint=1234;engine.worldReceived=900;engine.worldPending={seq:901};engine.selfSequence=800;engine.slots.set('old',0);engine.received.set('old',{seq:800});engine.shotSequences=new Map([['old',10]]);engine.resetSession();assert.equal(engine.worldReceived,0);assert.equal(engine.worldPending,null);assert.equal(engine.slots.size,0);assert.equal(engine.received.size,0);assert.equal(engine.shotSequences.size,0);assert.equal(packets[0].readUInt32LE(4),54);
});
test('network HUD preserves unknown ping and rejects malformed status',()=>{
 const engine=new NativeEngine('unused'),packets=[];engine.socket={send:b=>packets.push(b)};engine.endpoint=1234;
 engine.networkStatus({ping:-1,transportPing:-1,peers:0});
 engine.networkStatus({ping:151,transportPing:32,peers:1});
 for(const status of [{ping:NaN,transportPing:0,peers:1},{ping:1,transportPing:Infinity,peers:1},{ping:1,transportPing:1,peers:8},{ping:1,transportPing:1,peers:1.5},null])engine.networkStatus(status);
 assert.equal(packets.length,2);assert.equal(packets[0].readUInt32LE(4),49);assert.equal(packets[0].readFloatLE(12),-1);
 assert.deepEqual([12,16,20].map(offset=>packets[1].readFloatLE(offset)),[151,32,1]);
});
test('host-only vehicle spawn bridge creates an authoritative native spawn packet',()=>{
 const engine=new NativeEngine('unused'),packets=[];engine.socket={send:b=>packets.push(b)};engine.endpoint=1234;
 const request={model:217,position:[12,34,5],heading:1.25};
 engine.authoritativeWorld=false;assert.equal(engine.spawnVehicle(request),false);
 engine.authoritativeWorld=true;assert.equal(engine.spawnVehicle({...request,model:999}),false);
 assert.equal(engine.spawnVehicle(request),true);assert.equal(packets.length,1);assert.equal(packets[0].readUInt32LE(4),56);
 assert.deepEqual([0,1,2,3,4].map(i=>packets[0].readFloatLE(12+i*4)),[217,12,34,5,1.25]);
 assert.equal(engine.spawnVehicle({...request,position:[Infinity,0,0]}),false);
});
test('both engines apply only lobby-authorized, validated high-rate vehicle snapshots',()=>{
 const engine=new NativeEngine('unused'),packets=[];engine.socket={send:b=>packets.push(b)};engine.endpoint=1234;
 const state=Array(34).fill(0);state[0]=130;state[17]=540;state[19]=2;
 const visual=Array(34).fill(0);visual[0]=0.2;visual[19]=0.5;visual[31]=2;
 assert.equal(validVehicleVisual(visual),true);assert.equal(validDriverVehicleVisual(visual),true);assert.equal(validVehicleVisual([...visual.slice(0,31),4096,...visual.slice(32)]),false);
 const trainVisual=[...visual];trainVisual[31]=6;assert.equal(validVehicleVisual(trainVisual),true);assert.equal(validDriverVehicleVisual(trainVisual),false);
 const malformedSiren=[...visual];malformedSiren[33]=2;assert.equal(validVehicleVisual(malformedSiren),false);
 engine.authoritativeWorld=true;engine.driverState({id:12,state,visual,leadMs:80});assert.deepEqual(packets.map(p=>p.readUInt32LE(4)),[44,61]);
 assert.ok(Math.abs(packets[0].readFloatLE(12+26*4)-0.08)<1e-6);assert.equal(state[26],0,'the bridge must not mutate its caller snapshot');
 assert.equal(packets[0].readFloatLE(12+17*4),540);assert.equal(packets[0].readFloatLE(12+19*4),2);assert.equal(packets[1].readFloatLE(12+19*4),0.5);
 engine.authoritativeWorld=false;engine.driverState({id:12,state,visual});assert.deepEqual(packets.slice(2).map(p=>p.readUInt32LE(4)),[44,61]);
 assert.equal(packets[2].readFloatLE(12+17*4),540);assert.equal(packets[3].readFloatLE(12+19*4),0.5);
 engine.driverState({id:12,state,visual:[...visual.slice(0,25),999, ...visual.slice(26)]});assert.equal(packets.length,5,'Malformed vehicle visuals must not reach the native engine');
});
test('only the host can return a shared Come Fly With Me toggle to the native game',()=>{
 const engine=new NativeEngine('unused'),packets=[];engine.socket={send:b=>packets.push(b)};engine.endpoint=1234;
 engine.authoritativeWorld=false;assert.equal(engine.toggleSharedCheat(1),false);
 engine.authoritativeWorld=true;assert.equal(engine.toggleSharedCheat(99),false);assert.equal(engine.toggleSharedCheat(1),true);
 assert.equal(packets.length,1);assert.equal(packets[0].readUInt32LE(4),58);assert.equal(packets[0].readFloatLE(12),1);
});
test('shared Come Fly With Me state survives the native world bridge transaction',()=>{
 const engine=new NativeEngine('unused'),packets=[];engine.socket={send:b=>packets.push(b)};engine.endpoint=1234;engine.authoritativeWorld=false;
 const environment=[12,0,0,0,0,0,...Array(13).fill(0),1];
 assert.equal(engine.remoteWorld({seq:1,environment,entities:[],glass:[],explosions:[]}),true);
 assert.equal(packets[0].readUInt32LE(4),19);assert.equal(packets[0].readFloatLE(12+23*4),1);
});
test('late reliable snapshots cannot undo newer authoritative death/health updates',()=>{
 const engine=new NativeEngine('unused'),packets=[];engine.socket={send:b=>packets.push(b)};engine.endpoint=1234;
 const state=[0,0,10,0,0,0,0,1,0,0];engine.frame([{id:'me',self:true,seq:20,state}]);engine.frame([{id:'me',self:true,seq:19,state:[...state.slice(0,8),100,0]}]);
 const health=packets.filter(b=>b.readUInt32LE(4)===10);assert.equal(health.length,1);assert.equal(health[0].readFloatLE(12),0);
});
test('cheat inventory selections survive the bridge and actual hand visibility can change independently',()=>{
  const engine=new NativeEngine('unused'),packets=[];engine.socket={send:b=>packets.push(b)};engine.endpoint=1234;
  const state=[0,0,10,0,0,0,0,1,100,0];
  for(const weapon of [10,21,24,26,28,30,33]){
    engine.frame([{id:'friend',seq:weapon+1,state,weapon,weaponVisible:true}]);
    const equipped=packets.findLast(p=>p.readUInt32LE(4)===13);
    assert.equal(equipped.readFloatLE(12),weapon);assert.equal(equipped.readFloatLE(16),1);
  }
  engine.frame([{id:'friend',seq:40,state,weapon:33,weaponVisible:false}]);
  assert.equal(packets.at(-1).readFloatLE(12),33);assert.equal(packets.at(-1).readFloatLE(16),0);
});
test('expanded gun pose preserves base blends and aim direction across the bridge',()=>{
  const state=[0,0,10,0,0,0,0,2,100,0,...Array(20).fill(0),1,0.4,-0.2,1];
  state.splice(10,5,1,0,0.5,1,0.6);state.splice(15,5,1,1,0.4,1,0.4);
  state.splice(20,5,14,205,0.2,1,1);
  assert.ok(validState(state));
  const wire=packet(2,0,state);assert.equal(wire.length,148);
  assert.ok(Math.abs(wire.readFloatLE(12+31*4)-0.4)<1e-6);
  const engine=new NativeEngine('unused'),packets=[];engine.socket={send:b=>packets.push(b)};engine.endpoint=1234;
  engine.frame([{id:'friend',seq:1,state,weapon:17}]);
  assert.equal(packets.find(b=>b.readUInt32LE(4)===2).readFloatLE(12+20*4),14);
  assert.equal(validState([...state.slice(0,30),1,Infinity,0,1]),false);
  assert.equal(validState([...state.slice(0,30),3,0,0,1]),false);
});
test('bridge preserves fresh idle snapshots but ignores duplicate and old network sequences', () => {
  const engine = new NativeEngine('unused'), packets=[];
  engine.socket={send:b=>packets.push(b)};engine.endpoint=1234;
  const state=[0,0,10,0,0,0,0,1,100,0];
  const frame=seq=>[{id:'friend',name:'Friend~r~',seq,state}];
  engine.frame(frame(1));engine.frame(frame(1));engine.frame(frame(0));engine.frame(frame(2));
  assert.deepEqual(packets.map(p=>p.readUInt32LE(4)),[5,2,13,2]);
  assert.equal(packets[2].readFloatLE(12),0,'new peer starts with unarmed equipment');
  assert.equal(packets[0].subarray(12,24).toString('ascii').replace(/\0/g,''),'Friendr');
  engine.frame([]);engine.frame(frame(1));
  assert.equal(packets.at(-2).readUInt32LE(4),2);
  assert.equal(packets.at(-1).readUInt32LE(4),13);
  engine.frame([{...frame(2)[0],weapon:17}]);
  assert.equal(packets.at(-1).readFloatLE(12),17,'pistol equipment reaches the native peer');
  assert.equal(cleanLabel('~~~'),'Player');
});
test('native bridge accepts refreshed projected frames for one source snapshot and rejects reordered display frames',()=>{
 const engine=new NativeEngine('unused'),packets=[];engine.socket={send:b=>packets.push(b)};engine.endpoint=1234;
 const state=[0,0,10,0,0,0,0,1,100,0];
 const frame=(displaySeq,x)=>[{id:'friend',seq:42,displaySeq,state:[x,...state.slice(1)]}];
 engine.frame(frame(100,0));engine.frame(frame(101,0.75));engine.frame(frame(99,-5));
 const positions=packets.filter(b=>b.readUInt32LE(4)===2).map(b=>b.readFloatLE(12));
 assert.deepEqual(positions,[0,0.75],'a newer display projection must pass even when the source snapshot sequence is unchanged');
});
