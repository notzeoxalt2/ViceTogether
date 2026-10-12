const test = require('node:test');
const assert = require('node:assert/strict');
test('paired friends authenticate presence, deliver chat, reject strangers and reconnect without false online status', async () => {
  const { Social, parseFriendInvite } = await import('../ui/social.mjs');
  const channels = new Map(); let clock = 100000;
  const timers = { setInterval: () => 1, setTimeout: () => 2, clearInterval() {}, clearTimeout() {} };
  const create = () => {
    const storage = new Map();
    return new Social({ now: () => clock, timers, storage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) }, joinRoom(config, room) {
      const peers = channels.get(room) || []; const id = `peer-${peers.length}`;
      const instance = { id, config, getPeers: () => Object.fromEntries(peers.filter(p => p !== instance).map(p => [p.id, {}])), leave() { const i = peers.indexOf(instance); if (i >= 0) peers.splice(i, 1); for (const p of peers) p.onPeerLeave?.(id); }, makeAction() { const action = { send: async (packet, { target }) => { const remote = peers.find(p => p.id === target); if (!remote || remote.config.password !== config.password) throw new Error('Disconnected'); remote.action.onMessage(packet, { peerId: id }); } }; instance.action = action; return action; } };
      peers.push(instance); channels.set(room, peers); return instance;
    } });
  };
  const a = create(), b = create(); a.start('Alice'); b.start('Bob');
  const invite = a.createFriend(), info = parseFriendInvite(invite); b.add(invite);
  const sa = a.sessions.get(info.room), sb = b.sessions.get(info.room);
  sa.room.onPeerJoin(sb.room.id);
  assert.equal(a.snapshot()[0].status, 'Online'); assert.equal(b.snapshot()[0].name, 'Alice');
  await a.send(info.room, '<img src=x onerror=alert(1)>');
  assert.equal(b.friends[0].messages[0].text, '<img src=x onerror=alert(1)>');
  assert.equal(a.friends[0].messages[0].direction, 'delivered');
  const before = b.friends[0].messages.length;
  b.receive(b.friends[0], sb, { v: 1, id: 'a'.repeat(32), type: 'chat', message: 'b'.repeat(32), text: 'spoof' }, 'stranger');
  assert.equal(b.friends[0].messages.length, before);
  a.update('Alice', 'In private lobby', 'vicetogether://join/K7M4P-9Q2RX');
  assert.equal(b.snapshot()[0].invite, 'vicetogether://join/K7M4P-9Q2RX');
  a.stop(); assert.equal(b.snapshot()[0].status, 'Connection lost'); assert.equal(b.snapshot()[0].invite, null);
  await assert.rejects(b.send(info.room, 'hello'), /not connected/);
  assert.throws(() => parseFriendInvite('https://example.com/run.exe'), /complete private/);
  b.stop(); clock++;
});
