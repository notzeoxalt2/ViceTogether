// Both ends can exchange version/profile concurrently after Trystero's password
// check. Version 1 remains compatible with older send-then-receive peers.
export async function lobbyHandshake({send,receive,initiator,name,ready,legacy=false}) {
  let data;
  if(legacy&&!initiator){({data}=await receive());if(data?.version!==1)throw new Error('Version mismatch');await send({version:1});}
  else {await send(legacy?{version:1}:{version:1,name,ready:ready===true,fast:1});({data}=await receive());if(data?.version!==1)throw new Error('Version mismatch');}
  if(typeof data.name==='string'&&data.name.length>0&&data.name.length<=24&&typeof data.ready==='boolean')return {name:data.name,ready:data.ready,fast:data.fast===1};
  return null;
}
