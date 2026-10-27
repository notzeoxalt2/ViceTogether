const test=require('node:test'),assert=require('node:assert/strict');
test('lobby stages distinguish missing discovery, active negotiation and failed routes without claiming a friend is offline',async()=>{
 const {lobbyConnection:phase}=await import('../ui/lobby-connection.mjs');
 assert.equal(phase({elapsedMs:8001}).label,'DISCOVERY UNAVAILABLE');
 assert.equal(phase({elapsedMs:10001,diagnostics:{signalingOpen:1,peers:[]}}).label,'WAITING FOR FRIEND');
 assert.equal(phase({elapsedMs:10001,diagnostics:{signalingOpen:1,peers:[{connection:'connecting',receivedDescription:true}]}}).retryable,false);
 assert.equal(phase({elapsedMs:15001,diagnostics:{signalingOpen:1,peers:[{connection:'connecting',receivedDescription:true}]}}).label,'DIRECT LINK TIMED OUT');
 assert.equal(phase({diagnostics:{signalingOpen:1,peers:[{connection:'closed',receivedDescription:true,failed:true}]}}).label,'DIRECT LINK FAILED');
 assert.equal(phase({diagnostics:{peers:[{connection:'connected'}]}}).label,'VERIFYING LOBBY');
 assert.equal(phase({elapsedMs:8001,diagnostics:{peers:[{connection:'connected'}]}}).label,'LOBBY HANDSHAKE TIMED OUT');
 assert.equal(phase({connected:true}).label,'CONNECTED');
});
