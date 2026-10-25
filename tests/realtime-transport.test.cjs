const test=require('node:test'),assert=require('node:assert/strict');
test('replaceable state stream drops congestion and reordered snapshots, while unrelated channels stay available',async()=>{
 const {RealtimeTransport}=await import('../ui/realtime-transport.mjs');const delivered=[];
 class Peer extends EventTarget{createDataChannel(label,config){const channel=new EventTarget();Object.assign(channel,{label,readyState:'open',bufferedAmount:0,ordered:config.ordered,maxRetransmits:config.maxRetransmits,send:message=>delivered.push(message),close(){this.readyState='closed';this.dispatchEvent(new Event('close'));}});return channel;}}
 const received=[];const t=new RealtimeTransport({NativePeer:Peer,receive:(...args)=>received.push(args)}),pc=new t.Peer();t.initiate('peer',pc);
 const channel=t.peers.get('peer').channel;assert.equal(channel.ordered,false);assert.equal(channel.maxRetransmits,0);
 assert.equal(t.send('peer','players',[]),true);channel.bufferedAmount=40000;for(let i=0;i<1000;i++)t.send('peer','players',[i]);assert.equal(delivered.length,1);assert.equal(t.report()[0].dropped,1000);
 const message=seq=>channel.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({v:1,kind:'movement',seq,data:[seq]})}));message(2);message(1);message(2);assert.equal(received.length,1);assert.equal(t.seen('peer','movement'),true);
 channel.close();assert.equal(t.seen('peer','movement'),false);assert.equal(t.send('peer','movement',[]),false);t.close();
 const p=new t.Peer();let unrelated=0;p.addEventListener('datachannel',()=>unrelated++);const event=new Event('datachannel');event.channel={label:'trystero'};p.dispatchEvent(event);assert.equal(unrelated,1);
});
test('60 Hz vehicle snapshots remain deliverable alongside normal movement and world traffic',async()=>{
 const {RealtimeTransport}=await import('../networking/realtime-transport.mjs');let now=100;const received=[];
 class Peer extends EventTarget{createDataChannel(label,config){const channel=new EventTarget();Object.assign(channel,{label,readyState:'open',bufferedAmount:0,...config,send(){},close(){channel.readyState='closed';channel.dispatchEvent(new Event('close'));}});return channel;}}
 const transport=new RealtimeTransport({NativePeer:Peer,now:()=>now,receive:(kind,data)=>received.push(kind)});transport.initiate('peer',new transport.Peer());const channel=transport.peers.get('peer').channel;let seq=0;
 const send=(kind)=>channel.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({v:1,kind,seq:++seq,data:[seq]})}));
 for(let i=0;i<60;i++)send('driver');for(let i=0;i<80;i++)send('movement');for(let i=0;i<16;i++)send('ambient');
 assert.equal(received.filter(kind=>kind==='driver').length,60);assert.equal(received.filter(kind=>kind==='movement').length,80);assert.equal(received.filter(kind=>kind==='ambient').length,16);assert.equal(transport.report()[0].rateLimited,0);
 now=1100;for(let i=0;i<100;i++)send('driver');assert.equal(received.filter(kind=>kind==='driver').length,150);assert.equal(transport.report()[0].rateLimited,10);transport.close();
});
