const { test } = require('node:test');
const assert = require('node:assert/strict');
const { NativeEngine, cleanLabel,validState,packet } = require('../src/native-engine.cjs');
test('network HUD preserves unknown ping and rejects malformed status',()=>{
 const engine=new NativeEngine('unused'),packets=[];engine.socket={send:b=>packets.push(b)};engine.endpoint=1234;
 engine.networkStatus({ping:-1,transportPing:-1,peers:0});
 engine.networkStatus({ping:151,transportPing:32,peers:1});
 for(const status of [{ping:NaN,transportPing:0,peers:1},{ping:1,transportPing:Infinity,peers:1},{ping:1,transportPing:1,peers:8},{ping:1,transportPing:1,peers:1.5},null])engine.networkStatus(status);
 assert.equal(packets.length,2);assert.equal(packets[0].readUInt32LE(4),49);assert.equal(packets[0].readFloatLE(12),-1);
 assert.deepEqual([12,16,20].map(offset=>packets[1].readFloatLE(offset)),[151,32,1]);
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
