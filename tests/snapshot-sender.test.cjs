const test=require('node:test'),assert=require('node:assert/strict');
test('slow transport retains newest snapshot instead of replaying obsolete movement',async()=>{
 const {SnapshotSender}=await import('../ui/snapshot-sender.mjs');const sent=[];let release;
 const sender=new SnapshotSender({peer:()=>({connectionState:'connected'}),send:value=>{sent.push(value);return new Promise(r=>release=r)}});
 sender.offer(1);await Promise.resolve();for(let n=2;n<=100;n++)sender.offer(n);
 assert.deepEqual(sent,[1]);release();await new Promise(r=>setTimeout(r,15));assert.deepEqual(sent,[1,100]);
 sender.offer(101);sender.close();release();await new Promise(r=>setTimeout(r,15));assert.deepEqual(sent,[1,100]);
});
