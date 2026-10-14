export function lobbyConnection({connected=false,host=false,elapsedMs=0,diagnostics={}}={}){
 if(connected)return {label:host?'HOSTING':'CONNECTED',retryable:false,detail:host?'Your lobby is open.':'Authenticated lobby connected.'};
 const peers=diagnostics.peers||[],live=peers.filter(p=>p.connection!=='closed');
 if(live.some(p=>p.connection==='connected'))return {label:'VERIFYING LOBBY',retryable:elapsedMs>=25000,detail:'A peer connection is open; waiting for the authenticated lobby roster.'};
 if(live.some(p=>p.receivedDescription&&!p.failed&&p.connection!=='failed'&&p.ice!=='failed'))return elapsedMs>=45000?{label:'DIRECT LINK TIMED OUT',retryable:true,detail:'Your friend was discovered, but no direct route completed within 45 seconds. No TURN fallback is configured.'}:{label:'NEGOTIATING DIRECT LINK',retryable:false,detail:'Your friend was discovered. Checking a direct network route.'};
 if(peers.some(p=>p.receivedDescription&&p.failed))return {label:'DIRECT LINK FAILED',retryable:true,detail:'Discovery worked, but the direct network connection failed. No TURN fallback is configured.'};
 if(!diagnostics.signalingOpen)return {label:elapsedMs>=10000?'DISCOVERY UNAVAILABLE':'CONTACTING DISCOVERY',retryable:elapsedMs>=10000,detail:'Waiting for a discovery service. Check your internet connection if this persists.'};
 return {label:elapsedMs>=25000?'WAITING FOR FRIEND':'FINDING FRIEND',retryable:elapsedMs>=25000,detail:'Discovery is reachable. Keep the host lobby open and use the same invitation.'};
}
