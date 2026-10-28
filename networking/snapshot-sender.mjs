// Replace obsolete snapshots while transport is busy. Never use for damage/events.
export class SnapshotSender {
  constructor({ send, peer, timers = globalThis, now = () => performance.now(), minIntervalMs = 0 }) {
    this.send=send;this.peer=peer;this.timers=timers;this.now=now;this.minIntervalMs=Math.max(0,Number(minIntervalMs)||0);this.lastSentAt=-Infinity;this.pending=null;this.busy=false;this.closed=false;this.timer=null;
  }
  offer(value) { if(this.closed)return;this.pending=value;this.flush(); }
  flush() {
    if(this.closed||this.busy||this.pending===null)return;
    const wait=this.minIntervalMs-(this.now()-this.lastSentAt);
    if(wait>0){if(this.timer===null)this.timer=this.timers.setTimeout(()=>{this.timer=null;this.flush()},wait);return;}
    const pc=this.peer();if(!pc||pc.connectionState==='closed'||pc.connectionState==='failed'){this.pending=null;return;}
    // Trystero exposes the peer connection, not the data channel; send promise
    // supplies backpressure. Keep just one send plus one newest pending value.
    const value=this.pending;this.pending=null;this.busy=true;this.lastSentAt=this.now();
    Promise.resolve().then(()=>this.send(value)).catch(()=>{}).finally(()=>{
      this.busy=false;if(!this.closed&&this.pending!==null){this.timer=this.timers.setTimeout(()=>{this.timer=null;this.flush()},0);}
    });
  }
  close(){this.closed=true;this.pending=null;if(this.timer!==null)this.timers.clearTimeout(this.timer);}
}
