// A separate unreliable SCTP stream for replaceable snapshots. Trystero retains
// its reliable stream for authentication, lobby state, damage and other events.
const LABEL='vt-snapshots-v1',DEFAULT_KINDS=['movement','players','ambient','driver'];
const MAX_MESSAGES_PER_SECOND=240;
const SNAPSHOT_LIMITS={movement:90,players:90,ambient:24,driver:100};
export class RealtimeTransport {
  constructor({NativePeer=globalThis.RTCPeerConnection,receive,now=()=>performance.now(),kinds=DEFAULT_KINDS}={}) {
    if(!Array.isArray(kinds)||!kinds.length||kinds.length>8||kinds.some(k=>typeof k!=='string'||!/^[-a-z0-9]{1,24}$/.test(k)||['probe','echo'].includes(k)))throw new Error('Invalid snapshot kinds');this.kinds=new Set(kinds);
    this.receive=receive;this.now=now;this.peers=new Map();this.waiting=new WeakMap();const owner=this;
    this.Peer=class extends NativePeer {
      constructor(...args){super(...args);this.addEventListener('datachannel',event=>{
        if(event.channel.label!==LABEL)return;
        event.stopImmediatePropagation();const entry=[...owner.peers.values()].find(e=>e.pc===this);
        if(entry){entry.incomingEvents++;entry.lastIncomingLabel=event.channel.label;owner.bind(entry,event.channel);}else {owner.waiting.set(this,event.channel);owner.unattachedIncomingEvents.set(this,(owner.unattachedIncomingEvents.get(this)||0)+1);}
      });}
      createDataChannel(label,options){const channel=super.createDataChannel(label,options);
        // Trystero makes its reliable "data" channel before creating the SDP
        // offer, but does not renegotiate after a peer rejoins. Add our
        // replaceable stream at that same point so it is present in that offer.
        if(label==='data'&&!this.__vtSnapshotChannel)this.__vtSnapshotChannel=super.createDataChannel(LABEL,{ordered:false,maxRetransmits:0});
        return channel;
      }
    };
    this.unattachedIncomingEvents=new WeakMap();
  }
  newEntry(id,pc){return {id,pc,sequence:0,seen:new Map(),sent:0,received:0,receivedByKind:new Map(),dropped:0,rateLimited:0,probeSequence:0,samples:[],probeLost:0,lostSinceRecovery:0,recoveryAttempts:0,confirmed:false,incomingEvents:0,unattachedIncomingEvents:this.unattachedIncomingEvents.get(pc)||0,negotiationNeededEvents:0,signalingChanges:0};}
  attach(id,pc){if(!pc)return;let entry=this.peers.get(id);if(entry&&(entry.pc!==pc||['closed','failed'].includes(pc.connectionState))){entry.channel?.close();this.peers.delete(id);entry=null;}if(!entry){entry=this.newEntry(id,pc);this.peers.set(id,entry);pc.addEventListener?.('negotiationneeded',()=>entry.negotiationNeededEvents++);pc.addEventListener?.('signalingstatechange',()=>entry.signalingChanges++);}if(pc.__vtSnapshotChannel)this.bind(entry,pc.__vtSnapshotChannel);const pending=this.waiting.get(pc);if(pending){this.waiting.delete(pc);entry.unattachedIncomingEvents=this.unattachedIncomingEvents.get(pc)||0;this.bind(entry,pending);}return entry;}
  initiate(id,pc){const entry=this.attach(id,pc);if(!entry||entry.channel&&entry.channel.readyState!=='closed')return false;if(entry.channel)entry.channel=null;entry.initiateCalls=(entry.initiateCalls||0)+1;entry.initiatedAt=this.now();this.bind(entry,pc.createDataChannel(LABEL,{ordered:false,maxRetransmits:0}));return true;}
  bind(entry,channel){if(entry.channel&&entry.channel!==channel){entry.duplicateIncomingEvents=(entry.duplicateIncomingEvents||0)+1;channel.close();return;}entry.channel=channel;entry.channelLabel=channel.label;entry.channelBoundAt=this.now();
    channel.addEventListener('open',()=>{entry.channelOpenedAt=this.now();});
    channel.addEventListener('close',()=>{entry.channelClosedAt=this.now();if(entry.channel===channel){entry.channel=null;entry.seen.clear();entry.probe=null;entry.samples=[];}});
    channel.addEventListener('message',event=>{
      const bucket=Math.floor(this.now()/1000);if(entry.bucket!==bucket){entry.bucket=bucket;entry.count=0;entry.kindCounts=new Map();}if(++entry.count>MAX_MESSAGES_PER_SECOND){entry.rateLimited++;return;}
      if(typeof event.data!=='string'||event.data.length>32768)return;let packet;try{packet=JSON.parse(event.data);}catch{return;}
      if(packet?.v!==1||!Number.isSafeInteger(packet.seq)||packet.seq<1)return;
      if(packet.kind==='probe'){
        entry.confirmed=true;
        const now=this.now();if(now-(entry.lastEcho??-Infinity)<500||channel.readyState!=='open'||channel.bufferedAmount>4096)return;
        entry.lastEcho=now;try{channel.send(JSON.stringify({v:1,kind:'echo',seq:packet.seq}));}catch{}return;
      }
      if(packet.kind==='echo'){
        const pending=entry.probe;if(!pending||packet.seq!==pending.seq)return;
        entry.probe=null;const rtt=this.now()-pending.at;if(rtt<0||rtt>2000){entry.probeLost++;return;}
        entry.confirmed=true;entry.samples.push(rtt);if(entry.samples.length>20)entry.samples.shift();entry.measuredAt=this.now();return;
      }
      if(!this.kinds.has(packet.kind)||packet.seq<=(entry.seen.get(packet.kind)||0))return;
      entry.confirmed=true;
      const kindCount=(entry.kindCounts.get(packet.kind)||0)+1;entry.kindCounts.set(packet.kind,kindCount);
      if(kindCount>(SNAPSHOT_LIMITS[packet.kind]||1)){entry.rateLimited++;return;}
      entry.seen.set(packet.kind,packet.seq);entry.received++;entry.receivedByKind.set(packet.kind,(entry.receivedByKind.get(packet.kind)||0)+1);this.receive?.(packet.kind,packet.data,entry.id);
    });
  }
  recoverUnconfirmed(id){const entry=this.peers.get(id);if(!entry||entry.confirmed||!entry.initiateCalls||entry.recoveryAttempts>=2)return false;
    const channel=entry.channel;entry.channel=null;entry.probe=null;entry.confirmed=false;entry.lostSinceRecovery=0;entry.samples=[];entry.recoveryAttempts++;
    try{channel?.close();}catch{}
    return this.initiate(id,entry.pc);
  }
  probe(id){const entry=this.peers.get(id),channel=entry?.channel,now=this.now();
    if(!channel||channel.readyState!=='open'||channel.bufferedAmount>4096||now-(entry.lastProbe??-Infinity)<1000)return false;
    if(entry.probe){if(now-entry.probe.at<=2000)return false;entry.probeLost++;entry.lostSinceRecovery++;entry.probe=null;if(entry.lostSinceRecovery>=2&&this.recoverUnconfirmed(id))return false;}
    entry.lastProbe=now;entry.probe={seq:++entry.probeSequence,at:now};
    try{channel.send(JSON.stringify({v:1,kind:'probe',seq:entry.probe.seq}));return true;}catch{entry.probe=null;return false;}
  }
  latency(id){const e=this.peers.get(id);if(!e?.samples.length||this.now()-e.measuredAt>10000)return {rttMs:null,latestRttMs:null,p50Ms:null,p95Ms:null,jitterMs:null};
    const recent=e.samples.slice(-5),values=[...e.samples].sort((a,b)=>a-b),round=n=>Math.round(n*10)/10;
    const stable=[...recent].sort((a,b)=>a-b),middle=Math.floor(stable.length/2);
    const diffs=e.samples.slice(1).map((v,i)=>Math.abs(v-e.samples[i]));
    return {rttMs:round(stable.length%2?stable[middle]:(stable[middle-1]+stable[middle])/2),latestRttMs:round(e.samples.at(-1)),p50Ms:round(values[Math.floor((values.length-1)*0.5)]),p95Ms:round(values[Math.ceil((values.length-1)*0.95)]),jitterMs:round(diffs.length?diffs.reduce((a,b)=>a+b,0)/diffs.length:0)};
  }
  seen(id,kind){return !!this.peers.get(id)?.seen.has(kind);}
  send(id,kind,data){const entry=this.peers.get(id),channel=entry?.channel;if(!entry?.confirmed||!channel||channel.readyState!=='open'||!this.kinds.has(kind))return false;
    const packet=JSON.stringify({v:1,kind,seq:++entry.sequence,data});
    if(packet.length>30000)return false;
    if(channel.bufferedAmount>32768){entry.dropped++;return true;}
    try{channel.send(packet);entry.sent++;return true;}catch{return false;}
  }
  report(){return [...this.peers.values()].map(e=>({peerId:e.id,state:e.channel?.readyState||'waiting',confirmed:e.confirmed,ordered:e.channel?.ordered,retransmits:e.channel?.maxRetransmits,pcState:e.pc?.connectionState,iceState:e.pc?.iceConnectionState,signalingState:e.pc?.signalingState,localDescriptionType:e.pc?.localDescription?.type||null,remoteDescriptionType:e.pc?.remoteDescription?.type||null,usesCustomPeer:e.pc instanceof this.Peer,precreatedChannelState:e.pc?.__vtSnapshotChannel?.readyState||null,initiateCalls:e.initiateCalls||0,recoveryAttempts:e.recoveryAttempts||0,incomingEvents:e.incomingEvents||0,unattachedIncomingEvents:e.unattachedIncomingEvents||0,duplicateIncomingEvents:e.duplicateIncomingEvents||0,negotiationNeededEvents:e.negotiationNeededEvents||0,signalingChanges:e.signalingChanges||0,channelLabel:e.channelLabel||null,channelBoundAt:e.channelBoundAt||null,channelOpenedAt:e.channelOpenedAt||null,channelClosedAt:e.channelClosedAt||null,sent:e.sent,received:e.received,receivedByKind:Object.fromEntries(e.receivedByKind||[]),dropped:e.dropped,rateLimited:e.rateLimited,buffered:e.channel?.bufferedAmount||0,...this.latency(e.id),probeSamples:e.samples.length,probeLost:e.probeLost}));}
  remove(id){const entry=this.peers.get(id);entry?.channel?.close();this.peers.delete(id);}
  close(){for(const id of [...this.peers.keys()])this.remove(id);}
}
