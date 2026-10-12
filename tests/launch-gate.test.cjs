const test=require('node:test');const assert=require('node:assert/strict');
const {LaunchGate}=require('../src/launch-gate.cjs');
test('concurrent game starts cannot spawn twice and failure releases the launch gate',async()=>{
  const gate=new LaunchGate();let finish,calls=0;
  const first=gate.run(()=>{calls++;return new Promise(resolve=>finish=resolve);});
  await assert.rejects(gate.run(()=>calls++),/already starting/);assert.equal(calls,1);finish('started');assert.equal(await first,'started');
  await assert.rejects(gate.run(async()=>{throw new Error('missing engine');}),/missing engine/);
  assert.equal(await gate.run(async()=>42),42);
});
