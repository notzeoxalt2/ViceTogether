const test=require('node:test'),assert=require('node:assert/strict');
test('a stalled relay cleanup cannot block automatic reconnect indefinitely',async()=>{
 const {settleWithin}=await import('../ui/bounded-operation.mjs');
 const started=Date.now();
 const completed=await settleWithin(()=>new Promise(()=>{}),40);
 assert.equal(completed,false);
 assert.ok(Date.now()-started<500,'The bounded cleanup should finish promptly');
});
test('completed cleanup reports success and rejected cleanup is settled',async()=>{
 const {settleWithin}=await import('../ui/bounded-operation.mjs');
 assert.equal(await settleWithin(()=>Promise.resolve(),100),true);
 assert.equal(await settleWithin(()=>Promise.reject(new Error('cleanup failed')),100),true);
});
