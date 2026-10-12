const {test}=require('node:test'),assert=require('node:assert/strict');
const {validGlass,GlassAuthority}=require('../engine/glass.cjs');
const {NativeEngine}=require('../src/native-engine.cjs');
function pane(){const s=Array(34).fill(0);s[0]=100;s[1]=2;s[2]=s[8]=1;s[4]=s[10]=10;s[11]=400;return s;}
test('glass authority rejects stale, remote, duplicate and malformed guest breaks',()=>{
  const a=new GlassAuthority(),player={time:0,state:[0,0,10,0,0,0,0,1,100,0]},event={seq:1,state:pane()};
  assert.ok(a.accept('friend',event,player,0));assert.equal(a.accept('friend',event,player,1),null);
  assert.equal(a.accept('far',event,{...player,state:[100,0,10,0,0,0,0,1,100,0]},0),null);
  assert.equal(a.accept('stale',event,player,501),null);
  const invalid=pane();invalid[5]=Infinity;assert.equal(validGlass(invalid),false);
});
test('persistent glass and sequenced explosion survive complete world transactions',()=>{
  const engine=new NativeEngine('unused'),packets=[];engine.socket={send:p=>packets.push(p)};engine.endpoint=1234;
  const explosion=Array(34).fill(0);explosion[0]=1;explosion[2]=3;explosion[4]=10;explosion[6]=1;
  const frame={seq:1,entities:[],glass:[pane()],explosions:[explosion]};assert.ok(engine.remoteWorld(frame));
  assert.deepEqual(packets.map(p=>p.readUInt32LE(4)),[19,37,42,20]);
  assert.equal(packets[0].readFloatLE(12+21*4),1);assert.equal(packets[0].readFloatLE(12+22*4),1);
  assert.equal(packets[1].readFloatLE(12+11*4),400);
  packets.length=0;assert.ok(engine.remoteWorld({...frame,seq:2}));assert.equal(packets[1].readFloatLE(12+4),2,'break remains in subsequent snapshots for late join/streaming');
});
