// Forward the first accepted update immediately; coalesce bursts into the newest
// world view. Bound bandwidth without imposing a fixed timer phase on every input.
export class FrameDispatch {
  constructor(send,{now=()=>performance.now(),timers=globalThis,interval=1000/30}={}) {
    this.send=send;this.now=now;this.timers=timers;this.interval=interval;
    this.last=-Infinity;this.timer=null;this.closed=false;this.requestedAt=0;
    this.sent=0;this.lastWaitMs=0;this.maxWaitMs=0;
  }
  request(){
    if(this.closed||this.timer!==null)return;
    this.requestedAt=this.now();const wait=this.interval-(this.now()-this.last);
    if(wait<=0)this.flush();else this.timer=this.timers.setTimeout(()=>{this.timer=null;this.flush();},wait);
  }
  flush(){
    if(this.closed)return;
    this.last=this.now();this.lastWaitMs=Math.max(0,this.last-this.requestedAt);
    this.maxWaitMs=Math.max(this.maxWaitMs,this.lastWaitMs);this.sent++;this.send();
  }
  report(){return {sent:this.sent,lastWaitMs:this.lastWaitMs,maxWaitMs:this.maxWaitMs,limitHz:1000/this.interval};}
  close(){this.closed=true;if(this.timer!==null)this.timers.clearTimeout(this.timer);this.timer=null;}
}
