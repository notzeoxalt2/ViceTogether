const test=require('node:test'),assert=require('node:assert/strict');
test('movement-channel RTT uses matched echoes, bounds probes, expires stale values and never trusts remote timing',async()=>{
 const {RealtimeTransport}=await import('../ui/realtime-transport.mjs');let now=0;const sent=[];
 class Peer extends EventTarget{createDataChannel(label,config){const c=new EventTarget();Object.assign(c,{readyState:'open',bufferedAmount:0,...config,send:msg=>sent.push(JSON.parse(msg)),close(){c.readyState='closed';c.dispatchEvent(new Event('close'));}});return c;}}
 const transport=new RealtimeTransport({NativePeer:Peer,now:()=>now});transport.initiate('peer',new transport.Peer());const channel=transport.peers.get('peer').channel;
 const receive=packet=>channel.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({v:1,...packet})}));
 assert.equal(transport.probe('peer'),true);assert.equal(transport.probe('peer'),false);
 receive({kind:'echo',seq:999});assert.equal(transport.latency('peer').rttMs,null);
 now=18;receive({kind:'echo',seq:1,timestamp:-9999});assert.equal(transport.latency('peer').rttMs,18);
 now=1001;transport.probe('peer');now=1031;receive({kind:'echo',seq:2});assert.deepEqual(transport.latency('peer'),{rttMs:24,latestRttMs:30,p50Ms:18,p95Ms:30,jitterMs:12});
 // Reflections cannot amplify a flood; probes contain only a tiny sequence.
 const count=sent.length;for(let i=0;i<50;i++)receive({kind:'probe',seq:i+1});assert.equal(sent.length,count+1);
 now=2100;transport.probe('peer');now=4201;transport.probe('peer');assert.equal(transport.report()[0].probeLost,1);
 now=4500;receive({kind:'echo',seq:3});assert.equal(transport.report()[0].probeSamples,2);
 channel.bufferedAmount=5000;now=6000;assert.equal(transport.probe('peer'),false);
 now=12000;assert.equal(transport.latency('peer').rttMs,null);channel.close();assert.equal(transport.report()[0].probeSamples,0);
});
test('shared transport accepts per-game snapshot kinds and reserves its control messages',async()=>{
 const {RealtimeTransport,FrameDispatch,SnapshotSender}=await import('../networking/index.mjs');
 class Peer extends EventTarget{createDataChannel(){const c=new EventTarget();Object.assign(c,{readyState:'open',bufferedAmount:0,send(){},close(){}});return c;}}
 const delivered=[],transport=new RealtimeTransport({NativePeer:Peer,kinds:['state','input'],receive:(...args)=>delivered.push(args)});
 assert.equal(typeof FrameDispatch,'function');assert.equal(typeof SnapshotSender,'function');
 transport.initiate('peer',new transport.Peer());assert.equal(transport.send('peer','state',[]),true);assert.equal(transport.send('peer','players',[]),false);
 const channel=transport.peers.get('peer').channel;
 for(const kind of ['players','state'])channel.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({v:1,kind,seq:1,data:[1]})}));
 assert.equal(delivered.length,1);assert.equal(delivered[0][0],'state');
 assert.throws(()=>new RealtimeTransport({NativePeer:Peer,kinds:['echo']}),/Invalid/);transport.close();
});
