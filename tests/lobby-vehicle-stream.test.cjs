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
  assert.deepEqual(hostCalls[0][3],['guest-peer']);

  const guest=new PrivateLobby(),guestCalls=[];guest.room={};guest.isHost=false;guest.hostId='host-peer';guest.vehicleInput={};guest.sendSnapshot=(...args)=>guestCalls.push(args);
  assert.equal(guest.sendVehicle(update),true);
  assert.equal(guestCalls.length,1);
  assert.deepEqual(guestCalls[0][3],['host-peer']);
  assert.equal(guest.sendVehicle({...update,state:[...state.slice(0,20),0,...state.slice(21)]}),false);
});
