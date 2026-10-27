const test=require('node:test');
const assert=require('node:assert/strict');

test('host returns an authenticated hit result to whichever player is struck',async()=>{
  const {PrivateLobby,selfId}=await import('../ui/network.js');
  const lobby=new PrivateLobby(),now=performance.now();
  lobby.isHost=true;lobby.room={};lobby.hostId=selfId;
  lobby.players=new Map([[selfId,{id:selfId,host:true}],['guest',{id:'guest'}]]);
  const state=x=>[x,0,10,0,0,0,0,1,100,0];
  lobby.states.set(selfId,{state:state(0),time:now,seq:1});
  lobby.states.set('guest',{state:state(1),time:now,seq:1});
  lobby.combat.update(selfId,state(0),now);lobby.combat.update('guest',state(1),now);
  lobby.combat.equip(selfId,0);lobby.combat.equip('guest',0);
  const returned=[];lobby.hitResults={send:async(event,options)=>returned.push({event,options})};
  lobby.frameDispatch={request(){}};
  const reactions=[];lobby.addEventListener('player-hit',event=>reactions.push(event.detail));

  lobby.acceptHit('guest',{target:selfId,weapon:0,damage:12,seq:1});
  assert.equal(reactions.at(-1)?.selfTarget,true,'the host should tell its own native game to react when hit');
  assert.equal(reactions.at(-1)?.damage,12);
  assert.equal(returned.length,0,'a host-targeted hit does not need to be sent back over P2P');

  lobby.acceptHit(selfId,{target:'guest',weapon:0,damage:9,seq:1});
  assert.equal(reactions.at(-1)?.selfTarget,false);
  assert.equal(returned.length,1,'a guest-targeted hit returns to that guest over P2P');
  assert.deepEqual(returned[0].options,{target:'guest'});
  assert.equal(returned[0].event.attacker,selfId);
  assert.equal(returned[0].event.target,'guest');
  assert.equal(returned[0].event.health,91);

  lobby.acceptHit('stranger',{target:selfId,weapon:0,seq:2});
  assert.equal(reactions.length,2,'unadmitted senders cannot trigger local reactions');
});

test('native hit response is addressed to the struck local player and an admitted remote attacker',()=>{
  const {NativeEngine}=require('../src/native-engine.cjs');
  const engine=new NativeEngine('unused');engine.socket={};engine.endpoint=1;engine.localPlayerId='target';engine.slots.set('attacker',2);
  let sent=null;engine.send=(type,slot,state)=>{sent={type,slot,state};};
  const applied=engine.playerHit({attacker:'attacker',target:'target',weapon:0,damage:12,seq:5,selfTarget:true});
  assert.equal(applied,true);assert.equal(sent.type,17);assert.equal(sent.slot,2);
  assert.deepEqual(sent.state.slice(0,5),[0,12,5,1,2]);
  assert.equal(engine.playerHit({attacker:'attacker',target:'target',weapon:0,damage:0,seq:6,selfTarget:true}),false);
  engine.closeSocket();
});
