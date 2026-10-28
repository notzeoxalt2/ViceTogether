const test=require('node:test'),assert=require('node:assert/strict');
test('slow transport retains newest snapshot instead of replaying obsolete movement',async()=>{
 const {SnapshotSender}=await import('../ui/snapshot-sender.mjs');const sent=[];let release;
 const sender=new SnapshotSender({peer:()=>({connectionState:'connected'}),send:value=>{sent.push(value);return new Promise(r=>release=r)}});
 sender.offer(1);await Promise.resolve();for(let n=2;n<=100;n++)sender.offer(n);
 assert.deepEqual(sent,[1]);release();await new Promise(r=>setTimeout(r,15));assert.deepEqual(sent,[1,100]);
 sender.offer(101);sender.close();release();await new Promise(r=>setTimeout(r,15));assert.deepEqual(sent,[1,100]);
});
test('rapid vehicle frames coalesce to a steady 144 Hz stream below the host rolling limit',async()=>{
 const {SnapshotSender}=await import('../ui/snapshot-sender.mjs');const sent=[],times=[];
 const sender=new SnapshotSender({peer:()=>({connectionState:'connected'}),send:value=>{sent.push(value);times.push(performance.now())},minIntervalMs:1000/144});
 for(let value=0;value<24;value++)sender.offer(value);
 await new Promise(resolve=>setTimeout(resolve,30));
 assert.equal(sent.at(-1),23,'latest vehicle state is retained after coalescing');
 assert.equal(sent.length,2,'a burst sends its first and newest state instead of a backlog');
 assert.ok(times.slice(1).every((time,index)=>time-times[index]>=6.8),`snapshots must not exceed the host rolling 144 Hz limit: ${times}`);
 sender.close();
});
