const test=require('node:test'),assert=require('node:assert/strict');
test('new peers exchange profiles in parallel and legacy peers retain version-only handshakes',async()=>{
 const {lobbyHandshake}=await import('../ui/lobby-handshake.mjs');
 const pair=()=>{const state=()=>({queue:[],waiter:null});const endpoint=(local,remote)=>({send:async data=>{if(remote.waiter){const resolve=remote.waiter;remote.waiter=null;resolve({data});}else remote.queue.push(data);},receive:()=>local.queue.length?Promise.resolve({data:local.queue.shift()}):new Promise(resolve=>local.waiter=resolve)});const a=state(),b=state();return [endpoint(a,b),endpoint(b,a)];};
 const [a,b]=pair();const profiles=await Promise.all([lobbyHandshake({...a,initiator:true,name:'Host',ready:true}),lobbyHandshake({...b,initiator:false,name:'Friend',ready:false})]);
 assert.deepEqual(profiles,[{name:'Friend',ready:false,fast:true},{name:'Host',ready:true,fast:true}]);
 const [oldStyleA,oldStyleB]=pair();const legacy=await Promise.all([lobbyHandshake({...oldStyleA,initiator:true,name:'Old',ready:true,legacy:true}),lobbyHandshake({...oldStyleB,initiator:false,name:'New',ready:false,legacy:true})]);
 assert.deepEqual(legacy,[null,null]);
 await assert.rejects(lobbyHandshake({send:async()=>{},receive:async()=>({data:{version:2}}),initiator:true,name:'Player',ready:false}),/Version mismatch/);
});
