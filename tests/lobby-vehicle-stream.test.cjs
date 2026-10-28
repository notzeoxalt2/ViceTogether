const {test}=require('node:test');
const assert=require('node:assert/strict');

test('validated car snapshots stream from the host to guests and from guests to the host',async()=>{
  const [{PrivateLobby},{selfId}]=await Promise.all([import('../ui/network.js'),import('trystero')]);
  const state=Array(34).fill(0);state[0]=130;state[5]=1;state[9]=1;state[13]=1;state[17]=1000;state[19]=2;state[20]=1;
  const update={id:42,state,visual:Array(34).fill(0)};
  const host=new PrivateLobby(),hostCalls=[];host.room={};host.isHost=true;host.players=new Map([[selfId,{}],['guest-peer',{}]]);host.vehicleInput={};host.sendSnapshot=(...args)=>hostCalls.push(args);
  assert.equal(host.sendVehicle(update),true);
  assert.equal(hostCalls.length,1);
  assert.equal(hostCalls[0][0],'driver');
  assert.equal(hostCalls[0][2].seq,1);
  assert.deepEqual(hostCalls[0][3],['guest-peer']);

  const guest=new PrivateLobby(),guestCalls=[];guest.room={};guest.isHost=false;guest.hostId='host-peer';guest.vehicleInput={};guest.sendSnapshot=(...args)=>guestCalls.push(args);
  assert.equal(guest.sendVehicle(update),true);
  assert.equal(guestCalls.length,1);
  assert.equal(guestCalls[0][2].seq,1);
  assert.deepEqual(guestCalls[0][3],['host-peer']);
  assert.equal(guest.sendVehicle(update),true);
  assert.equal(guestCalls[1][2].seq,2);
  assert.equal(guest.sendVehicle({...update,state:[...state.slice(0,20),0,...state.slice(21)]}),false);
});

test('vehicle snapshots deduplicate the same source update across unreliable and reliable paths',async()=>{
  const [{PrivateLobby}]=await Promise.all([import('../ui/network.js')]);
  const state=Array(34).fill(0);state[0]=130;state[5]=state[9]=state[13]=1;state[17]=1000;state[19]=2;state[20]=1;
  const update={id:42,seq:7,state};
  const host=new PrivateLobby(),accepted=[];host.isHost=true;host.players=new Map([['guest-peer',{}]]);host.fast={seen:()=>true,latency:()=>({rttMs:100})};host.seats={acceptVehicle:(peerId,value)=>{accepted.push({peerId,value});return value;}};host.emit=(type,detail)=>accepted.push({type,detail});
  assert.equal(host.acceptDriverSnapshot(update,{peerId:'guest-peer',realtime:true}),true);
  assert.equal(host.acceptDriverSnapshot(update,{peerId:'guest-peer',realtime:false}),false);
  assert.equal(accepted.filter(item=>item.type==='driver-state').length,1);
  assert.equal(accepted.filter(item=>item.peerId==='guest-peer').length,1);
  assert.equal(accepted.find(item=>item.type==='driver-state').detail.leadMs,58);

  const guest=new PrivateLobby(),received=[];guest.isHost=false;guest.hostId='host-peer';guest.players=new Map([['host-peer',{}]]);guest.fast={latency:()=>({rttMs:300})};guest.emit=(type,detail)=>received.push({type,detail});
  assert.equal(guest.acceptDriverSnapshot(update,{peerId:'host-peer',realtime:false}),true);
  assert.equal(guest.acceptDriverSnapshot(update,{peerId:'host-peer',realtime:true}),false);
  assert.equal(received.length,1);
  assert.equal(received[0].detail.leadMs,158);
});
