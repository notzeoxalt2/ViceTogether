// Opt-in developer test: ephemeral, random signaling only; no player/invite data.
import {getRelays} from '@trystero-p2p/core';
import {defaultRelayUrls,createEvent,subscribe} from '@trystero-p2p/nostr';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
const topic='vt-audit-'+randomUUID();
const event=await createEvent(topic,JSON.stringify({probe:randomUUID()}));
const eventId=JSON.parse(event)[1].id;
const config=JSON.parse(await readFile(new URL('../release-config.json',import.meta.url),'utf8'));
const urls=process.argv.includes('--configured')?config.signalingRelayUrls:getRelays({appId:'org.vicetogether.alpha.v5'},defaultRelayUrls,5,true);
const results=await Promise.all(urls.map(url=>new Promise(resolve=>{
  const started=performance.now(),ws=new WebSocket(url);let done=false;
  const result={url,openedMs:null,subscriptionReady:false,publishAccepted:null,reason:null};
  const finish=reason=>{if(done)return;done=true;clearTimeout(timer);result.reason??=reason;try{ws.close();}catch{}resolve(result);};
  const timer=setTimeout(()=>finish('timeout'),12000);
  ws.addEventListener('open',()=>{result.openedMs=Math.round(performance.now()-started);ws.send(subscribe('vt-audit',topic));ws.send(event);});
  ws.addEventListener('message',message=>{let packet;try{packet=JSON.parse(message.data);}catch{return;}
    if(packet[0]==='EOSE'&&packet[1]==='vt-audit')result.subscriptionReady=true;
    if(packet[0]==='EVENT'&&packet[1]==='vt-audit')result.subscriptionReady=true;
    if(packet[0]==='OK'&&packet[1]===eventId){result.publishAccepted=packet[2]===true;if(!packet[2])result.reason=String(packet[3]||'publish rejected').slice(0,160);}
    if(packet[0]==='AUTH')finish('authentication required');
    else if(packet[0]==='CLOSED')finish(String(packet[2]||'subscription rejected').slice(0,160));
    else if(result.subscriptionReady&&result.publishAccepted!==null)finish(null);
  });
  ws.addEventListener('error',()=>finish('connection error'));
  ws.addEventListener('close',()=>finish('closed before completion'));
})));
console.log(JSON.stringify({testedAt:new Date().toISOString(),scope:'signaling only, not game RTT or NAT connectivity',results},null,2));
