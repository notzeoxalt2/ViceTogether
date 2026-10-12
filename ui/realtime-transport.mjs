// A separate unreliable SCTP stream for replaceable snapshots. Trystero retains
// its reliable stream for authentication, lobby state, damage and other events.
const LABEL='vt-snapshots-v1',KINDS=new Set(['movement','players','ambient','driver']);
export class RealtimeTransport {
  constructor({NativePeer=globalThis.RTCPeerConnection,receive}={}) {
    this.receive=receive;this.peers=new Map();this.waiting=new WeakMap();const owner=this;
    this.Peer=class extends NativePeer {
      constructor(...args){super(...args);this.addEventListener('datachannel',event=>{
        if(event.channel.label!==LABEL)return;
        event.stopImmediatePropagation();const entry=[...owner.peers.values()].find(e=>e.pc===this);
        if(entry)owner.bind(entry,event.channel);else owner.waiting.set(this,event.channel);
      });}
    };
  }
  attach(id,pc){if(!pc)return;let entry=this.peers.get(id);if(!entry){entry={id,pc,sequence:0,seen:new Map(),sent:0,received:0,dropped:0};this.peers.set(id,entry);}const pending=this.waiting.get(pc);if(pending){this.waiting.delete(pc);this.bind(entry,pending);}return entry;}
  initiate(id,pc){const entry=this.attach(id,pc);if(!entry||entry.channel)return;this.bind(entry,pc.createDataChannel(LABEL,{ordered:false,maxRetransmits:0}));}
  bind(entry,channel){if(entry.channel&&entry.channel!==channel){channel.close();return;}entry.channel=channel;
    channel.addEventListener('close',()=>{if(entry.channel===channel){entry.channel=null;entry.seen.clear();}});
    channel.addEventListener('message',event=>{
      const bucket=Math.floor(Date.now()/1000);if(entry.bucket!==bucket){entry.bucket=bucket;entry.count=0;}if(++entry.count>120)return;
      if(typeof event.data!=='string'||event.data.length>32768)return;let packet;try{packet=JSON.parse(event.data);}catch{return;}
      if(packet?.v!==1||!KINDS.has(packet.kind)||!Number.isSafeInteger(packet.seq)||packet.seq<1||packet.seq<=(entry.seen.get(packet.kind)||0))return;
      entry.seen.set(packet.kind,packet.seq);entry.received++;this.receive?.(packet.kind,packet.data,entry.id);
    });
  }
  seen(id,kind){return !!this.peers.get(id)?.seen.has(kind);}
  send(id,kind,data){const entry=this.peers.get(id),channel=entry?.channel;if(!channel||channel.readyState!=='open'||!KINDS.has(kind))return false;
    const packet=JSON.stringify({v:1,kind,seq:++entry.sequence,data});
    if(packet.length>30000)return false;
    if(channel.bufferedAmount>32768){entry.dropped++;return true;}
    try{channel.send(packet);entry.sent++;return true;}catch{return false;}
  }
  report(){return [...this.peers.values()].map(e=>({state:e.channel?.readyState||'waiting',ordered:e.channel?.ordered,retransmits:e.channel?.maxRetransmits,sent:e.sent,received:e.received,dropped:e.dropped,buffered:e.channel?.bufferedAmount||0}));}
  remove(id){const entry=this.peers.get(id);entry?.channel?.close();this.peers.delete(id);}
  close(){for(const id of [...this.peers.keys()])this.remove(id);}
}
