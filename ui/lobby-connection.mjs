export function lobbyConnection({connected=false,host=false,elapsedMs=0,diagnostics={}}={}){
 if(connected)return {label:host?'HOSTING':'CONNECTED',retryable:false,detail:host?'Your lobby is open.':'Authenticated lobby connected.'};
 const peers=diagnostics.peers||[],live=peers.filter(p=>p.connection!=='closed');
 if(live.some(p=>p.connection==='connected'))return elapsedMs>=8000?{label:'LOBBY HANDSHAKE TIMED OUT',retryable:true,detail:'The game link opened, but the lobby did not finish verifying. Refreshing the invite connection.'}:{label:'VERIFYING LOBBY',retryable:false,detail:'Finishing the private lobby connection.'};
 if(peers.some(p=>p.receivedDescription&&p.failed))return {label:'DIRECT LINK FAILED',retryable:true,detail:'Discovery worked, but the direct network connection failed. No TURN fallback is configured.'};
 if(live.some(p=>p.receivedDescription&&!p.failed&&p.connection!=='failed'&&p.ice!=='failed'))return elapsedMs>=15000?{label:'DIRECT LINK TIMED OUT',retryable:true,detail:'Your friend was found, but the direct connection did not finish. Refreshing the invite connection.'}:{label:'CONNECTING TO FRIEND',retryable:false,detail:'Your friend was found. Finishing the direct connection.'};
 if(!diagnostics.signalingOpen)return {label:elapsedMs>=8000?'DISCOVERY UNAVAILABLE':'CONTACTING DISCOVERY',retryable:elapsedMs>=8000,detail:'The invite service is taking too long to answer. Refreshing the connection.'};
 return {label:elapsedMs>=10000?'WAITING FOR FRIEND':'FINDING FRIEND',retryable:elapsedMs>=10000,detail:elapsedMs>=10000?'Still looking for the host. Refreshing the invite connection.':'Looking for your friend. Keep their lobby open.'};
}
