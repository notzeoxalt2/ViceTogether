const test=require('node:test'),assert=require('node:assert/strict');
test('stalled guest retries are bounded and never restart an authenticated or actively negotiating lobby',async t=>{
 const original=global.RTCPeerConnection;global.RTCPeerConnection=class extends EventTarget{};
 const {PrivateLobby}=await import('../ui/network.js');
 t.mock.timers.enable({apis:['setTimeout','setInterval']});
 const fakeRoom=()=>({makeAction:()=>({send:async()=>{}}),getPeers:()=>({}),leave:async()=>{}});
 try{
  for(const scenario of [{attempt:0,retries:1},{attempt:2,retries:0},{attempt:0,connected:true,retries:0},{attempt:0,negotiating:true,retries:0},{attempt:0,negotiating:true,elapsed:46000,retries:1}]){
   const lobby=new PrivateLobby(),calls=[];lobby.join=async(...args)=>calls.push(args);
   lobby.start({room:'test',key:'test'},'Player',false,{joinRoom:fakeRoom,connectAttempt:scenario.attempt});
   lobby.connectionStartedAt=performance.now()-(scenario.elapsed||30000);
   if(scenario.connected)lobby.hostId='authenticated-host';
   if(scenario.negotiating)lobby.networkDiagnostics.snapshot=()=>({signalingOpen:1,peers:[{connection:'connecting',receivedDescription:true}]});
   t.mock.timers.tick(25001);await Promise.resolve();
   assert.equal(calls.length,scenario.retries);if(calls.length)assert.equal(calls[0][2].connectAttempt,1);
   await lobby.leave();
  }
 }finally{global.RTCPeerConnection=original;t.mock.timers.reset();}
});
