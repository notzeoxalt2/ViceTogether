const test=require('node:test'),assert=require('node:assert/strict');
test('connection report is bounded, omits private transport data, and retains a failed route after close',async()=>{
 const {connectionDiagnostics,connectionHint}=await import('../ui/connection-diagnostics.mjs');
 class Peer extends EventTarget {constructor(){super();this.connectionState='new';this.iceConnectionState='new';this.iceGatheringState='new';this.localDescription={sdp:'private IP and credentials'};}}
 const tracker=connectionDiagnostics({NativePeer:Peer,relaySockets:()=>({'wss://private?token=secret':{readyState:1}})});
 for(let i=0;i<100;i++)new tracker.Peer();const p=new tracker.Peer();p.remoteDescription={sdp:'secret'};p.connectionState='failed';p.dispatchEvent(new Event('connectionstatechange'));p.connectionState='closed';p.remoteDescription=null;
 const report=tracker.snapshot();assert.equal(report.peers.length,6);assert.equal(report.signalingOpen,1);assert.equal(report.peers.at(-1).failed,true);
 assert.doesNotMatch(JSON.stringify(report),/secret|private|sdp|token/);assert.ok(JSON.stringify({version:'0.3.0-alpha.8',connection:report}).length<2048);
 assert.match(connectionHint('Not connected',report,false),/direct WebRTC failed/);
 assert.match(connectionHint('Not connected',{signalingOpen:0,peers:[]},false),/No signaling connection/);
 assert.match(connectionHint('Not connected',report,false),/signaling socket is open/);
 assert.equal(connectionHint('Online',report,false),'');
});
