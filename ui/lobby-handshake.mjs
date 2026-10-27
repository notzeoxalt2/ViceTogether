// Both ends can exchange version/profile concurrently after Trystero's password
// check. Version 1 remains compatible with older send-then-receive peers.
export function shouldInitiateFastChannel({isHost,profile}) {
  if(!profile?.fast)return false;
  // Only the offerer creates the unordered snapshot channel. Having the lobby
  // host always create it can make the secondary channel negotiation stall
  // when Trystero assigned the host the answering role (notably after rejoin).
  return typeof profile.initiator==='boolean' ? profile.initiator===false : isHost===true;
}

export async function lobbyHandshake({send,receive,initiator,name,ready,legacy=false}) {
  let data;
  if(legacy&&!initiator){({data}=await receive());if(data?.version!==1)throw new Error('Version mismatch');await send({version:1});}
  else {await send(legacy?{version:1}:{version:1,name,ready:ready===true,fast:1,initiator:initiator===true});({data}=await receive());if(data?.version!==1)throw new Error('Version mismatch');}
  if(typeof data.name==='string'&&data.name.length>0&&data.name.length<=24&&typeof data.ready==='boolean')return {name:data.name,ready:data.ready,fast:data.fast===1,...(typeof data.initiator==='boolean'?{initiator:data.initiator}:{})};
  return null;
}
