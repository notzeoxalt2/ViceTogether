const test=require('node:test'),assert=require('node:assert/strict');
test('fresh input forwards immediately while bursts coalesce, remain bounded and stop on leave',async()=>{
 const {FrameDispatch}=await import('../ui/frame-dispatch.mjs');let now=0,nextId=0,value=0;const jobs=new Map(),sent=[];
 const timers={setTimeout(fn,ms){const id=++nextId;jobs.set(id,{fn,at:now+ms});return id;},clearTimeout(id){jobs.delete(id);}};
 const advance=target=>{while(true){const next=[...jobs].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>target)break;now=next[1].at;jobs.delete(next[0]);next[1].fn();}now=target;};
 const dispatch=new FrameDispatch(()=>sent.push({at:now,value}),{now:()=>now,timers});
 dispatch.request();assert.deepEqual(sent,[{at:0,value:0}]);
 for(let i=1;i<=200;i++){advance(i);value=i;dispatch.request();}
 assert.ok(sent.length<=13);assert.ok(sent.length>=11);assert.equal(jobs.size,1);
 advance(234);assert.equal(sent.at(-1).value,200);
 assert.ok(dispatch.report().maxWaitMs<=1000/60+0.01);
 // A solitary update after idle must not wait for a heartbeat/timer phase.
 advance(500);value=500;dispatch.request();assert.deepEqual(sent.at(-1),{at:500,value:500});
 value=501;dispatch.request();const count=sent.length;dispatch.close();advance(1000);dispatch.request();assert.equal(sent.length,count);
});
