const test=require('node:test'),assert=require('node:assert/strict');
test('replaceable state stream drops congestion and reordered snapshots, while unrelated channels stay available',async()=>{
 const {RealtimeTransport}=await import('../ui/realtime-transport.mjs');const delivered=[];
 class Peer extends EventTarget{createDataChannel(label,config){const channel=new EventTarget();Object.assign(channel,{label,readyState:'open',bufferedAmount:0,ordered:config.ordered,maxRetransmits:config.maxRetransmits,send:message=>delivered.push(message),close(){this.readyState='closed';this.dispatchEvent(new Event('close'));}});return channel;}}
 const received=[];const t=new RealtimeTransport({NativePeer:Peer,receive:(...args)=>received.push(args)}),pc=new t.Peer();t.initiate('peer',pc);
 const channel=t.peers.get('peer').channel;assert.equal(channel.ordered,false);assert.equal(channel.maxRetransmits,0);
 channel.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({v:1,kind:'probe',seq:1})}));assert.equal(t.report()[0].confirmed,true);delivered.length=0;
 assert.equal(t.send('peer','players',[]),true);channel.bufferedAmount=40000;for(let i=0;i<1000;i++)t.send('peer','players',[i]);assert.equal(delivered.length,1);assert.equal(t.report()[0].dropped,1000);
 const message=seq=>channel.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({v:1,kind:'movement',seq,data:[seq]})}));message(2);message(1);message(2);assert.equal(received.length,1);assert.equal(t.seen('peer','movement'),true);
 channel.close();assert.equal(t.seen('peer','movement'),false);assert.equal(t.send('peer','movement',[]),false);t.close();
 const p=new t.Peer();let unrelated=0;p.addEventListener('datachannel',()=>unrelated++);const event=new Event('datachannel');event.channel={label:'trystero'};p.dispatchEvent(event);assert.equal(unrelated,1);
});
test('rejoining with a replaced peer connection discards the stale snapshot channel and starts fresh',async()=>{
 const {RealtimeTransport}=await import('../networking/realtime-transport.mjs');
 class Peer extends EventTarget{createDataChannel(label,config){const channel=new EventTarget();Object.assign(channel,{label,readyState:'open',bufferedAmount:0,...config,send(){},close(){channel.readyState='closed';channel.dispatchEvent(new Event('close'));}});return channel;}}
 const transport=new RealtimeTransport({NativePeer:Peer}),first=new transport.Peer();transport.initiate('peer',first);const stale=transport.peers.get('peer').channel;
 const rejoined=new transport.Peer();const entry=transport.attach('peer',rejoined);assert.equal(stale.readyState,'closed');assert.equal(entry.pc,rejoined);assert.equal(entry.channel,undefined);
 transport.initiate('peer',rejoined);assert.notEqual(entry.channel,stale);assert.equal(entry.channel.label,'vt-snapshots-v1');assert.equal(entry.confirmed,false);transport.close();
});
test('a reused Trystero peer routes rejoin data channels to the new session transport',async()=>{
 const {RealtimeTransport}=await import('../networking/realtime-transport.mjs');
 class Peer extends EventTarget{createDataChannel(label,config){const channel=new EventTarget();Object.assign(channel,{label,readyState:'open',bufferedAmount:0,...config,send(){},close(){channel.readyState='closed';channel.dispatchEvent(new Event('close'));}});return channel;}}
 const oldTransport=new RealtimeTransport({NativePeer:Peer}),reused=new oldTransport.Peer();reused.createDataChannel('data');oldTransport.attach('peer',reused);oldTransport.close();
 const nextTransport=new RealtimeTransport({NativePeer:Peer}),entry=nextTransport.attach('peer',reused);assert.equal(entry.channel,undefined,'A closed pre-created channel must not block the rejoin channel');
 const incoming=new EventTarget();Object.assign(incoming,{label:'vt-snapshots-v1',readyState:'open',bufferedAmount:0,send(){},close(){this.readyState='closed';}});
 const event=new Event('datachannel');event.channel=incoming;reused.dispatchEvent(event);
 assert.equal(entry.incomingEvents,1);assert.equal(entry.channel,incoming);assert.equal(entry.duplicateIncomingEvents,undefined);
 incoming.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({v:1,kind:'probe',seq:1})}));assert.equal(entry.confirmed,true);nextTransport.close();
});
test('Trystero snapshot channel is created with its initial reliable channel before the first offer',async()=>{
 const {RealtimeTransport}=await import('../networking/realtime-transport.mjs');const created=[];
 class Peer extends EventTarget{createDataChannel(label,config){const channel=new EventTarget();Object.assign(channel,{label,readyState:'connecting',bufferedAmount:0,...config,send(){},close(){channel.readyState='closed';channel.dispatchEvent(new Event('close'));}});created.push(channel);return channel;}}
 const transport=new RealtimeTransport({NativePeer:Peer}),pc=new transport.Peer();const reliable=pc.createDataChannel('data');
 assert.equal(reliable.label,'data');assert.deepEqual(created.map(channel=>channel.label),['data','vt-snapshots-v1']);
 const entry=transport.attach('peer',pc);assert.equal(entry.channel,pc.__vtSnapshotChannel);assert.equal(entry.initiateCalls,undefined);assert.equal(entry.channel.ordered,false);assert.equal(entry.channel.maxRetransmits,0);transport.close();
});
test('unconfirmed offerer retries a stuck snapshot channel at most twice after lost probes',async()=>{
 const {RealtimeTransport}=await import('../networking/realtime-transport.mjs');let now=0;const channels=[];
 class Peer extends EventTarget{createDataChannel(label,config){const channel=new EventTarget();Object.assign(channel,{label,readyState:'open',bufferedAmount:0,...config,send(){},close(){channel.readyState='closed';channel.dispatchEvent(new Event('close'));}});channels.push(channel);return channel;}}
 const transport=new RealtimeTransport({NativePeer:Peer,now:()=>now}),pc=new transport.Peer();transport.initiate('peer',pc);
 assert.equal(transport.probe('peer'),true);now=3000;assert.equal(transport.probe('peer'),true);now=6000;assert.equal(transport.probe('peer'),false);
 assert.equal(channels.length,2);assert.equal(channels[0].readyState,'closed');assert.equal(transport.report()[0].recoveryAttempts,1);
 now=9000;transport.probe('peer');now=12000;transport.probe('peer');now=15000;assert.equal(transport.probe('peer'),false);
 assert.equal(channels.length,3);assert.equal(transport.report()[0].recoveryAttempts,2);
 now=18000;transport.probe('peer');now=21000;transport.probe('peer');now=24000;transport.probe('peer');
 assert.equal(channels.length,3);assert.equal(transport.report()[0].recoveryAttempts,2);transport.close();
});
test('144 Hz vehicle snapshots remain deliverable alongside normal movement and world traffic',async()=>{
 const {RealtimeTransport}=await import('../networking/realtime-transport.mjs');let now=100;const received=[];
 class Peer extends EventTarget{createDataChannel(label,config){const channel=new EventTarget();Object.assign(channel,{label,readyState:'open',bufferedAmount:0,...config,send(){},close(){channel.readyState='closed';channel.dispatchEvent(new Event('close'));}});return channel;}}
 const transport=new RealtimeTransport({NativePeer:Peer,now:()=>now,receive:(kind,data)=>received.push(kind)});transport.initiate('peer',new transport.Peer());const channel=transport.peers.get('peer').channel;let seq=0;
 const send=(kind)=>channel.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({v:1,kind,seq:++seq,data:[seq]})}));
 for(let i=0;i<144;i++)send('driver');for(let i=0;i<90;i++)send('players');for(let i=0;i<24;i++)send('ambient');
 assert.equal(received.filter(kind=>kind==='driver').length,144);assert.equal(received.filter(kind=>kind==='players').length,90);assert.equal(received.filter(kind=>kind==='ambient').length,24);assert.equal(transport.report()[0].rateLimited,0);
 now=1100;for(let i=0;i<150;i++)send('driver');assert.equal(received.filter(kind=>kind==='driver').length,288);assert.equal(transport.report()[0].rateLimited,6);transport.close();
});
