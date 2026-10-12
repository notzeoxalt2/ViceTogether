// Small, bounded pairwise social layer. Invite secrets are private bearer credentials.
const TOKEN = /^[a-f0-9]{32}$/;
const nameOf = value => String(value || 'Friend').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24) || 'Friend';
const random = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
export function parseFriendInvite(text) {
  const match = /^VTFR1:([a-f0-9]{32}):([a-f0-9]{32}):([a-f0-9]{32})$/.exec(String(text).trim());
  if (!match) throw new Error('Paste the complete private friend invite.');
  return { room: match[1], key: match[2], owner: match[3] };
}
export class Social extends EventTarget {
  constructor({ joinRoom, storage, now = Date.now, timers = globalThis, diagnosticsFactory }) {
    super(); this.joinRoom = joinRoom; this.storage = storage; this.now = now; this.timers = timers; this.diagnosticsFactory = diagnosticsFactory;
    this.sessions = new Map(); this.name = 'Player'; this.activity = 'In launcher'; this.invite = null;
    let saved; try { const raw = storage.getItem('vt-social-v1'); if (raw?.length < 250000) saved = JSON.parse(raw); } catch {}
    this.id = TOKEN.test(saved?.id) ? saved.id : random(); this.friends = [];
    for (const item of (Array.isArray(saved?.friends) ? saved.friends : []).slice(0, 12)) {
      if (!TOKEN.test(item.room) || !TOKEN.test(item.key) || !TOKEN.test(item.owner) || (item.remote && !TOKEN.test(item.remote)) || this.friends.some(f => f.room === item.room)) continue;
      const messages = (Array.isArray(item.messages) ? item.messages : []).filter(m => TOKEN.test(m.id) && typeof m.text === 'string' && m.text.length <= 1000 && ['sent', 'received', 'delivered', 'failed'].includes(m.direction)).slice(-50);
      this.friends.push({ room: item.room, key: item.key, owner: item.owner, remote: item.remote || null, name: nameOf(item.name), messages, unread: 0 });
    }
  }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  persist() { this.storage.setItem('vt-social-v1', JSON.stringify({ id: this.id, friends: this.friends })); }
  changed() { this.persist(); this.emit('change', this.snapshot()); }
  snapshot() { return this.friends.map(f => { const s = this.sessions.get(f.room); return { ...f, status: s?.status || 'Disconnected', activity: s?.peer ? s.activity : '', invite: s?.invite || null }; }); }
  diagnostics(room) { const s=this.sessions.get(room); return { status:s?.status || 'Disconnected', relayConfigured:!!this.options?.iceServers?.some(server=>(Array.isArray(server.urls)?server.urls:[server.urls]).some(url=>/^turns?:/i.test(url))), connection:s?.diagnostics?.snapshot() || null }; }
  start(name, options = {}) { this.name = nameOf(name); this.options = options; for (const f of this.friends) this.connect(f); }
  createFriend() {
    if (this.friends.length >= 12) throw new Error('This lightweight preview supports twelve friends. Remove a friend before adding another.');
    const f = { room: random(), key: random(), owner: this.id, remote: null, name: 'Waiting for friend', messages: [], unread: 0 };
    this.friends.push(f); this.connect(f); this.changed(); return `VTFR1:${f.room}:${f.key}:${f.owner}`;
  }
  add(text) {
    const data = parseFriendInvite(text);
    if (data.owner === this.id) throw new Error('That is your own friend invite. Send it to your friend.');
    if (this.friends.some(f => f.room === data.room)) throw new Error('This friend invite is already saved.');
    if (this.friends.length >= 12) throw new Error('This preview supports twelve friends.');
    const f = { ...data, remote: data.owner, name: 'Connecting to friend', messages: [], unread: 0 };
    this.friends.push(f); this.connect(f); this.changed(); return f.room;
  }
  connect(f) {
    if (this.sessions.has(f.room)) return;
    const s = { status: 'Connecting', peer: null, lastSeen: 0, activity: '', invite: null, count: 0, interval: 0 };
    this.sessions.set(f.room, s);
    const config = { appId: 'org.vicetogether.friends.v1', password: f.key, maxReceiveBytes: 4096 };
    if (this.options?.iceServers?.length) config.turnConfig = this.options.iceServers;
    if (this.options?.relayUrls?.length) config.relayConfig = { urls: this.options.relayUrls };
    try {
      if (this.diagnosticsFactory) { s.diagnostics=this.diagnosticsFactory(); config.rtcPolyfill=s.diagnostics.Peer; }
      s.room = this.joinRoom(config, f.room, { onJoinError: () => { s.status = 'Connection unavailable'; this.emit('change', this.snapshot()); } });
      s.wire = s.room.makeAction('social');
      s.wire.onReceive = ({ byteLength }) => byteLength <= 4096;
      s.wire.onMessage = (packet, { peerId }) => this.receive(f, s, packet, peerId);
      s.room.onPeerJoin = peerId => this.presence(s, peerId);
      s.room.onPeerLeave = peerId => { if (s.peer === peerId) { s.peer = null; s.invite = null; s.status = 'Connection lost'; this.emit('change', this.snapshot()); } };
      s.interval = this.timers.setInterval(() => {
        if (s.peer && this.now() - s.lastSeen > 45000) { s.peer = null; s.invite = null; s.status = 'Connection lost'; this.emit('change', this.snapshot()); }
        for (const peerId of Object.keys(s.room.getPeers())) this.presence(s, peerId);
      }, 15000);
    } catch { s.status = 'Connection unavailable'; }
    s.timeout = this.timers.setTimeout(() => { if (!s.peer) { if(s.status==='Connecting')s.status = 'Not connected'; this.emit('change', this.snapshot()); } }, 25000);
  }
  presence(s, peerId) {
    s.wire?.send({ v: 1, type: 'presence', id: this.id, name: this.name, activity: this.activity, invite: this.invite }, { target: peerId }).catch(() => {});
  }
  receive(f, s, p, peerId) {
    if (!p || p.v !== 1 || !TOKEN.test(p.id) || p.id === this.id || (f.remote && p.id !== f.remote) || (s.peer && s.peer !== peerId)) return;
    const bucket = Math.floor(this.now() / 1000); if (s.bucket !== bucket) { s.bucket = bucket; s.count = 0; }
    if (++s.count > 12) return;
    if (p.type === 'presence') {
      if (typeof p.name !== 'string' || p.name.length > 24 || !['In launcher', 'In private lobby', 'Playing Vice City'].includes(p.activity)) return;
      const first = !s.peer; f.remote = p.id; f.name = nameOf(p.name); s.peer = peerId; s.lastSeen = this.now(); s.status = 'Online'; s.activity = p.activity;
      s.invite = typeof p.invite === 'string' && /^vicetogether:\/\/join\/[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(p.invite) ? p.invite : null;
      if (first) this.presence(s, peerId);
      this.changed(); return;
    }
    if (s.peer !== peerId) return;
    if (p.type === 'ack' && TOKEN.test(p.message)) {
      const m = f.messages.find(m => m.id === p.message && m.direction === 'sent'); if (m) { m.direction = 'delivered'; this.changed(); } return;
    }
    if (p.type !== 'chat' || !TOKEN.test(p.message) || typeof p.text !== 'string' || !p.text.trim() || p.text.length > 1000) return;
    s.lastSeen = this.now();
    if (!f.messages.some(m => m.id === p.message)) { f.messages.push({ id: p.message, text: p.text, direction: 'received', time: this.now() }); f.messages = f.messages.slice(-50); f.unread++; this.changed(); this.emit('message',{room:f.room,name:f.name}); }
    s.wire.send({ v: 1, type: 'ack', id: this.id, message: p.message }, { target: peerId }).catch(() => {});
  }
  async send(room, text) {
    const f = this.friends.find(f => f.room === room), s = this.sessions.get(room); text = String(text).trim();
    if (!f || !s?.peer || s.status !== 'Online') throw new Error('Your friend is not connected. Both launchers must be open to chat.');
    if (!text || text.length > 1000) throw new Error('Write a message of up to 1,000 characters.');
    if (s.lastSent && this.now() - s.lastSent < 300) throw new Error('Give that message a moment to send.'); s.lastSent = this.now();
    const m = { id: random(), text, time: this.now(), direction: 'sent' }; f.messages.push(m); f.messages = f.messages.slice(-50); this.changed();
    try { await s.wire.send({ v: 1, type: 'chat', id: this.id, message: m.id, text }, { target: s.peer }); }
    catch { m.direction = 'failed'; this.changed(); throw new Error('Message could not be sent. Check the connection and try again.'); }
  }
  markRead(room) { const f = this.friends.find(f => f.room === room); if (f?.unread) { f.unread = 0; this.changed(); } }
  update(name, activity, invite = null) { this.name = nameOf(name); this.activity = activity; this.invite = invite; for (const s of this.sessions.values()) if (s.peer) this.presence(s, s.peer); }
  retry(room) { const f = this.friends.find(f => f.room === room); if (!f) return; this.disconnect(room); this.connect(f); this.emit('change', this.snapshot()); }
  disconnect(room) { const s = this.sessions.get(room); if (!s) return; this.timers.clearInterval(s.interval); this.timers.clearTimeout(s.timeout); s.room?.leave(); this.sessions.delete(room); }
  remove(room) { this.disconnect(room); this.friends = this.friends.filter(f => f.room !== room); this.changed(); }
  stop() { for (const room of [...this.sessions.keys()]) this.disconnect(room); }
}
