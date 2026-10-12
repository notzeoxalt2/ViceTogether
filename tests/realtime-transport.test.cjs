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
