import { joinRoom, selfId, getRelaySockets } from 'trystero';
import { Social } from './social.mjs';
import { connectionDiagnostics } from './connection-diagnostics.mjs';
import { SnapshotSender } from './snapshot-sender.mjs';
import { RealtimeTransport } from './realtime-transport.mjs';
import {lobbyConnection} from './lobby-connection.mjs';
import {FrameDispatch} from './frame-dispatch.mjs';
import {lobbyHandshake,shouldInitiateFastChannel} from './lobby-handshake.mjs';
import {settleWithin} from './bounded-operation.mjs';
export class Friends extends Social { constructor(options) { super({ ...options, joinRoom: options.joinRoom || joinRoom, diagnosticsFactory: options.diagnosticsFactory || (() => connectionDiagnostics({relaySockets:getRelaySockets})) }); } }
import { validState } from '../engine/sync.js';
import { SessionCombat,NpcMeleeAuthority } from '../engine/combat.js';
import { ShotAuthority,validShot } from '../engine/shots.js';
import { validWorldFrame,validDriverSnapshot } from '../engine/world.cjs';
import { SeatAuthority } from '../engine/seats.cjs';
import { validWeapon } from '../engine/weapons.cjs';
import { GlassAuthority,validGlass } from '../engine/glass.cjs';
import { VEHICLE_MODELS, acceptVehicleSpawn } from '../engine/vehicle-spawn.cjs';
import { SHARED_CHEATS, acceptSharedCheatToggle } from '../engine/shared-cheats.cjs';
import { projectPlayerState } from './player-prediction.mjs';
const encoder = new TextEncoder();
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const unb64 = text => Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
const fingerprint = async key => b64(await crypto.subtle.digest('SHA-256', await crypto.subtle.exportKey('raw', key))).slice(0, 22);
const cleanName = name => String(name || 'Player').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 24) || 'Player';

export class PrivateLobby extends EventTarget {
  constructor() { super(); this.reset(); }
  reset() { if(this.pendingSeatRequest?.timer)clearTimeout(this.pendingSeatRequest.timer);this.pendingSeatRequest=null;this.seatRequestSequence=0;this.players = new Map(); this.hostId = null; this.sequence = 0; this.displaySequence=0; this.vehicleSequence=0;this.vehicleReceiveSequences=new Map();this.lastSequence = -1; this.pings = {}; this.pending = new Set(); this.states = new Map();this.wantedLevels=new Map(); this.combat=new SessionCombat();this.npcMeleeAuthority=new NpcMeleeAuthority();this.npcMeleeSequence=0;this.hitSequence=0;this.hitResultSequences=new Map(); this.generation = (this.generation || 0) + 1; }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  setReady(ready) {
    this.ready = ready === true;
    if(!this.room) return;
    if(this.isHost) { const player=this.players.get(selfId);if(player)player.ready=this.ready;this.broadcastRoster().catch(()=>{}); }
    else if(this.hostId) this.readiness.send({ready:this.ready},{target:this.hostId}).catch(()=>{});
  }
  async host(invite, name, options = {}) {
    await this.leave();
    this.keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    this.publicKey = b64(await crypto.subtle.exportKey('raw', this.keys.publicKey));
    invite = { ...invite, host: await fingerprint(this.keys.publicKey) };
    this.start(invite, name, true, options);
    return invite;
  }
  async join(invite, name, options = {}) { await this.leave(); this.start(invite, name, false, options); }
  start(invite, name, isHost, options) {
    this.snapshotSenders=new Map();this.pingBusy=false;this.handshakeProfiles=new Map();this.setupTiming={};
    this.connectionStartedAt=performance.now();this.connectAttempt=options.connectAttempt||0;this.networkDiagnostics=connectionDiagnostics({relaySockets:getRelaySockets});
    this.fast=new RealtimeTransport({NativePeer:this.networkDiagnostics.Peer,receive:(kind,data,peerId)=>({movement:this.movement,players:this.world,ambient:this.ambient,driver:this.vehicleInput})[kind]?.onMessage?.(data,{peerId,realtime:true})});
    this.invite = invite; this.name = cleanName(name); this.isHost = isHost; this.sessionStarted = false;
    this.trustedHost=invite.host||null;
    const generation = this.generation;
    const config = { appId: 'org.vicetogether.alpha.v5', password: invite.key, maxReceiveBytes: 65536 };
    config.rtcPolyfill=this.fast.Peer;
    if (options.iceServers?.length) config.turnConfig = options.iceServers;
    if (options.relayUrls?.length) config.relayConfig = { urls: options.relayUrls };
    this.room = (options.joinRoom || joinRoom)(config, invite.room, {
      handshakeTimeoutMs: 10000,
      onJoinError: () => this.emit('notice', 'The private connection did not finish. The launcher will retry automatically.'),
      onPeerHandshake: async (id, send, receive, initiator) => {
        if (this.isHost && this.players.size + this.pending.size >= 8) throw new Error('Lobby full');
        this.pending.add(id);
        this.setupTiming.peerChannelMs??=performance.now()-this.connectionStartedAt;
        try {
          const profile=await lobbyHandshake({send,receive,initiator,name:this.name,ready:this.ready,legacy:options.legacyHandshake===true});
          if(generation!==this.generation)throw new Error('Lobby closed');
          if(profile){this.handshakeProfiles.set(id,profile);this.setupTiming.profileExchanges=(this.setupTiming.profileExchanges||0)+1;}
        } catch (error) { this.pending.delete(id); throw error; }
      }
    });
    this.hello = this.room.makeAction('hello');
    this.roster = this.room.makeAction('roster');
    this.bye = this.room.makeAction('bye');
    this.movement = this.room.makeAction('movement');
    this.world = this.room.makeAction('world');
    this.ambient=this.room.makeAction('ambient');this.ambientSequence=0;
    this.seats=new SeatAuthority();this.seatInput=this.room.makeAction('seat-input');this.seatOutput=this.room.makeAction('seat-output');
    this.vehicleInput=this.room.makeAction('driver-state');this.vehicleInput.onReceive=({byteLength})=>byteLength<2048;
    this.vehicleInput.onMessage=(update,meta)=>this.acceptDriverSnapshot(update,meta);
    this.vehicleDoors=this.room.makeAction('vehicle-doors');this.vehicleDoors.onReceive=({byteLength})=>byteLength<128;
    this.vehicleDoors.onMessage=(update,{peerId})=>{if(!this.isHost||!this.players.has(peerId))return;const approved=this.seats.acceptVehicleDoors(peerId,update);if(approved)this.emit('vehicle-doors',approved);};
    this.vehicleSpawnCooldowns=new Map();this.vehicleSpawnAction=this.room.makeAction('vehicle-spawn');
    this.vehicleSpawnAction.onReceive=({byteLength})=>byteLength<128;
    this.vehicleSpawnAction.onMessage=(request,{peerId})=>{if(!this.isHost)return;const approved=acceptVehicleSpawn(peerId,request?.model,{players:this.players,states:this.states,cooldowns:this.vehicleSpawnCooldowns,now:performance.now()});if(approved)this.emit('vehicle-spawn-approved',approved);};
    this.sharedCheatCooldowns=new Map();this.sharedCheatAction=this.room.makeAction('shared-cheat-toggle');
    this.sharedCheatAction.onReceive=({byteLength})=>byteLength<64;
    this.sharedCheatAction.onMessage=(request,{peerId})=>{if(!this.isHost)return;const accepted=acceptSharedCheatToggle(peerId,request?.cheatId,{players:this.players,states:this.states,cooldowns:this.sharedCheatCooldowns,now:performance.now()});if(accepted)this.emit('shared-cheat-toggle-request',accepted);};
    this.seatInput.onReceive=({byteLength})=>byteLength<256;
    this.seatOutput.onReceive=({byteLength})=>byteLength<256;
    this.seatInput.onMessage=(request,{peerId})=>{if(this.isHost && this.players.has(peerId))this.acceptSeat(peerId,request);};
    this.seatOutput.onMessage=(claim,{peerId})=>{if(!this.isHost && peerId===this.hostId && Number.isSafeInteger(claim?.id) && claim.id>=0 && Number.isInteger(claim.seat) && claim.seat>=-1 && claim.seat<8){const pending=this.pendingSeatRequest;if(Number.isSafeInteger(claim.requestId)&&(!pending||claim.requestId!==pending.requestId))return;if(pending&&pending.id===claim.id)this.clearSeatRequest(pending.requestId);this.emit('seat-grant',{id:claim.id,seat:claim.seat});}};
    this.ambient.onReceive=({byteLength})=>byteLength<=131072;
    this.ambient.onMessage=(frame,{peerId})=>{
      if(this.isHost || peerId!==this.hostId || !validWorldFrame(frame) || frame.seq<=this.ambientSequence)return;
      this.ambientSequence=frame.seq;this.emit('ambient',frame);
    };
    this.launch = this.room.makeAction('launch');
    this.readiness = this.room.makeAction('ready');
    this.hits=this.room.makeAction('hit');
    this.hitResults=this.room.makeAction('hit-result');
    this.npcMeleeInput=this.room.makeAction('npc-melee-input');
    this.npcMeleeInput.onReceive=({byteLength})=>byteLength<256;
    this.npcMeleeInput.onMessage=(request,{peerId})=>{
      if(!this.isHost || !this.players.has(peerId))return;
      const approved=this.npcMeleeAuthority.accept(peerId,request,performance.now());
      if(approved)this.emit('npc-melee',{...approved,playerId:peerId});
    };
    this.equipmentAction=this.room.makeAction('equipment');
    this.glassInput=this.room.makeAction('glass-input');this.glassAuthority=new GlassAuthority();this.glassSequence=0;
    this.glassInput.onReceive=({byteLength})=>byteLength<2048;
    this.glassInput.onMessage=(event,{peerId})=>{if(!this.isHost || !this.players.has(peerId))return;const approved=this.glassAuthority.accept(peerId,event,this.states.get(peerId),performance.now());if(approved)this.emit('glass-request',approved);};
    this.weaponVisibility=new Map();
    this.shotAuthority=new ShotAuthority();this.shotSequence=0;this.receivedShots=new Map();
    this.shotInput=this.room.makeAction('shot-input');this.shotOutput=this.room.makeAction('shot-output');
    this.shotInput.onReceive=({byteLength})=>byteLength<512;
    this.shotOutput.onReceive=({byteLength})=>byteLength<512;
    this.shotInput.onMessage=(event,{peerId})=>{if(this.isHost && this.players.has(peerId))this.acceptShot(peerId,event);};
    this.shotOutput.onMessage=(event,{peerId})=>{
      if(this.isHost || peerId!==this.hostId || !this.players.has(event?.id) || !validShot(event) || !Number.isSafeInteger(event.seq))return;
      if(event.seq<=(this.receivedShots.get(event.id)||0))return;
      this.receivedShots.set(event.id,event.seq);
      this.emit('shot',{...event,self:event.id===selfId});
    };
    this.equipmentAction.onReceive=({byteLength})=>byteLength<64;
    this.equipmentAction.onMessage=(equipment,{peerId})=>{if(this.isHost && this.players.has(peerId))this.acceptEquipment(peerId,equipment);};
    this.hits.onReceive=({byteLength})=>byteLength<512;
    this.hits.onMessage=(event,{peerId})=>{if(this.isHost && this.players.has(peerId))this.acceptHit(peerId,event);};
    this.hitResults.onReceive=({byteLength})=>byteLength<512;
    this.hitResults.onMessage=(event,{peerId})=>{
      if(this.isHost||peerId!==this.hostId||event?.target!==selfId||!this.players.has(event?.attacker)||!Number.isSafeInteger(event?.seq)||event.seq<1||!Number.isInteger(event?.weapon)||!Number.isFinite(event?.damage)||event.damage<=0||event.damage>60||!Number.isFinite(event?.health)||event.health<0||event.health>100)return;
      const last=this.hitResultSequences.get(event.attacker)||0;if(event.seq<=last)return;
      this.hitResultSequences.set(event.attacker,event.seq);
      this.emit('player-hit',{...event,selfTarget:true});
    };
    this.readiness.onReceive = ({byteLength}) => byteLength < 128;
    this.readiness.onMessage = (data,{peerId}) => {
      if(!this.isHost || !this.players.has(peerId) || typeof data?.ready !== 'boolean')return;
      this.players.get(peerId).ready=data.ready;this.broadcastRoster().catch(()=>{});
    };
    this.movement.onReceive = ({ byteLength }) => byteLength < 1024;
    this.world.onReceive = ({ byteLength }) => byteLength < 16384;
    this.movement.onMessage = (data, { peerId,realtime }) => {
      if(!realtime&&this.fast.seen(peerId,'movement'))return;
      const snapshot=Array.isArray(data)?{state:data}:data;
      if (!this.isHost || !this.players.has(peerId) || !validState(snapshot?.state)) return;
      this.acceptState(peerId, snapshot.state, snapshot);
    };
    this.world.onMessage = (frame, { peerId,realtime }) => {
      if(!realtime&&this.fast.seen(peerId,'players'))return;
      if (peerId !== this.hostId || this.isHost || !Array.isArray(frame) || frame.length > 8) return;
      if (!frame.every(p => p && this.players.has(p.id) && validState(p.state) && (p.weapon===undefined || validWeapon(p.weapon)))) return;
      this.emit('frame', frame.map(p => ({ ...p, name: this.players.get(p.id).name, color: ([...this.players.keys()].indexOf(p.id)+1)%8, self: p.id === selfId })));
    };
    this.launch.onMessage = (packet, { peerId }) => {
      if (peerId !== this.hostId || this.isHost || packet?.v !== 1 || !this.ready || this.sessionStarted) return;
      this.sessionStarted = true; this.emit('launch', {});
    };
    this.frameDispatch = new FrameDispatch(() => {
      if (!this.isHost || !this.room) return;
      const now = performance.now();
      const frame = [...this.states.entries()].filter(([id, s]) => this.players.has(id) && now - s.time < 2000).map(([id, s]) => ({ id, sample: s, state: s.state, seq: s.seq,vehicle:s.state[9]===1?this.seats.claims.get(id):null,weapon:this.combat.equipment.get(id)||0,weaponVisible:this.weaponVisibility.get(id)===true,wanted:this.wantedLevels.get(id)||0, name: this.players.get(id).name, color: ([...this.players.keys()].indexOf(id)+1)%8 }));
      const displaySequence=++this.displaySequence;
      const routeOneWayMs = id => {
        if (id === selfId) return 0;
        const measured = this.fast?.latency(id)?.rttMs;
        const fallback = this.pings?.[id];
        const rtt = Number.isFinite(measured) ? measured : Number.isFinite(fallback) ? fallback : 0;
        return Math.max(0, Math.min(300, rtt)) / 2;
      };
      const forViewer = viewerId => frame.map(player => {
        const { sample, ...entry } = player;
        if (player.id === viewerId) return entry;
        const routeMs = routeOneWayMs(player.id) + routeOneWayMs(viewerId) + 25;
        return { ...entry, displaySeq:displaySequence, state: projectPlayerState(sample, now, routeMs) };
      });
      // Each recipient gets a position projected for its route. This only
      // changes the display snapshot: authoritative lobby state remains raw.
      this.emit('frame', forViewer(selfId).map(p => ({ ...p, self: p.id === selfId })));
      for (const viewerId of this.players.keys()) {
        if (viewerId === selfId) continue;
        this.sendSnapshot('players', this.world, forViewer(viewerId), [viewerId]);
      }
    });
    // Heartbeat also expires disconnected/stale actors when no fresh input arrives.
    this.gameTimer=setInterval(()=>this.frameDispatch.request(),250);
    this.hello.onReceive = ({ byteLength }) => byteLength < 256;
    this.roster.onReceive = ({ byteLength }) => byteLength < 8192;
    this.hello.onMessage = async (data, { peerId }) => {
      if (!this.isHost || generation !== this.generation || data?.v !== 1 || typeof data.name !== 'string') return;
      if (this.players.size >= 8 && !this.players.has(peerId)) { this.pending.delete(peerId); return; }
      if(this.players.get(peerId)?.name===cleanName(data.name)&&this.players.get(peerId)?.ready===(data.ready===true))return;
      this.players.set(peerId, { id: peerId, name: cleanName(data.name), host: false, ready: data.ready === true });
      if(data.fast===1)this.fast.initiate(peerId,this.room.getPeers()[peerId]);
      this.pending.delete(peerId);
      await this.broadcastRoster();
    };
    this.roster.onMessage = async (packet, { peerId }) => {
      if (this.isHost || generation !== this.generation) return;
      try {
        if (!packet || typeof packet.key !== 'string' || typeof packet.signature !== 'string' || typeof packet.body !== 'string' || packet.body.length > 4096) return;
        const key = await crypto.subtle.importKey('raw', unb64(packet.key), { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
        const hostFingerprint=await fingerprint(key);
        if ((this.trustedHost || invite.host) && hostFingerprint !== (this.trustedHost || invite.host)) return;
        if (!await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, unb64(packet.signature), encoder.encode(packet.body))) return;
        const body = JSON.parse(packet.body);
        if (body.room !== invite.room || body.seq <= this.lastSequence || !Array.isArray(body.players) || body.players.length > 8 || body.host !== peerId || !body.players.some(p => p.id === selfId)) return;
        if (!body.players.every(p => typeof p.id === 'string' && p.id.length < 128 && typeof p.name === 'string' && p.name.length <= 24)) return;
        if (generation !== this.generation) return;
        this.lastSequence = body.seq;
        this.trustedHost=hostFingerprint;
        this.hostId = peerId;
        this.setupTiming.lobbyAuthenticatedMs??=performance.now()-this.connectionStartedAt;
        this.players = new Map(body.players.map(p => [p.id, p]));
        clearTimeout(this.timeout);
        this.changed();
        if(body.started===true && this.ready && !this.sessionStarted){this.sessionStarted=true;this.emit('launch',{});}
      } catch { /* Ignore malformed or unauthenticated remote packets. */ }
    };
    this.bye.onMessage = (_, { peerId }) => {
      if (peerId === this.hostId) this.emit('notice', 'The host closed the lobby. Ask them for a new invitation.');
    };
    this.room.onPeerJoin = id => {
      if (generation !== this.generation) return;
      this.setupTiming.peerAuthenticatedMs??=performance.now()-this.connectionStartedAt;
      this.fast.attach(id,this.room.getPeers()[id]);
      const hasProfile=this.handshakeProfiles.has(id),profile=this.handshakeProfiles.get(id);this.handshakeProfiles.delete(id);
      if(hasProfile&&shouldInitiateFastChannel({isHost:this.isHost,profile})){
        this.setupTiming.fastChannelOfferer=profile.initiator===false?'local':'legacy-host';
        this.fast.initiate(id,this.room.getPeers()[id]);
      }
      if(this.isHost&&profile&&(this.players.size<8||this.players.has(id))){
        this.players.set(id,{id,name:cleanName(profile.name),host:false,ready:profile.ready});
      }
      this.pending.delete(id);
      // New peers already exchanged a profile during the channel handshake.
      // Keep the hello action only for older peers using the version-only exchange.
      if(!hasProfile){this.setupTiming.legacyHelloFallbacks=(this.setupTiming.legacyHelloFallbacks||0)+1;this.hello.send({ v: 1, name: this.name, ready: this.ready === true,fast:1 }, { target: id }).catch(() => {});}
      if (this.isHost) this.broadcastRoster().catch(() => {});
    };
    this.room.onPeerLeave = id => {
      if (generation !== this.generation) return;
      this.fast.remove(id);
      this.handshakeProfiles.delete(id);
      for(const kind of ['movement','players','ambient','driver']){const key=kind+':'+id;this.snapshotSenders.get(key)?.close();this.snapshotSenders.delete(key);}
      this.pending.delete(id); this.players.delete(id);this.wantedLevels.delete(id);this.vehicleSpawnCooldowns?.delete(id);this.sharedCheatCooldowns?.delete(id); this.combat.remove(id);this.npcMeleeAuthority.remove(id);this.seats.release(id); delete this.pings[id];
      if (this.isHost) this.broadcastRoster().catch(() => {});
      else if (id === this.hostId) {
        this.hostId = null;
        this.connectionStartedAt=performance.now();
        this.emit('notice', 'Connection to the host was lost. Reconnecting automatically; use Retry if it does not return.');
        this.changed();
      }
    };
    if (isHost) {
      this.hostId = selfId;
      this.players.set(selfId, { id: selfId, name: this.name, host: true, ready: this.ready === true });
    } else {
      const checkJoin=async()=>{
        if(generation!==this.generation||!this.room||this.hostId)return;const phase=this.connectionPhase();
        if(phase.retryable&&this.connectAttempt<2){this.emit('notice',`${phase.detail} Retrying (${this.connectAttempt+1}/2).`);try{await this.join(invite,this.name,{...options,connectAttempt:this.connectAttempt+1});}catch{this.emit('notice','The connection could not restart. Use Retry to try again.');}}
        else if(phase.retryable){this.emit('notice',`${phase.detail} Use Retry to start again.`);this.changed();}
        else {this.timeout=setTimeout(checkJoin,2500);this.changed();}
      };
      this.timeout=setTimeout(checkJoin,2500);
    }
    this.timer = setInterval(async () => {
      const room = this.room;
      if (!room || generation !== this.generation || this.pingBusy) return;
      this.pingBusy=true;
      await Promise.all([...this.players.keys()].filter(id=>id!==selfId).map(async id=>{
        this.fast.probe(id);let timeout;
        try {
          const ping = await Promise.race([room.ping(id), new Promise((_, reject) => {timeout=setTimeout(() => reject(new Error('Ping timeout')), 2500);})]);
          if (generation === this.generation) this.pings[id] = Math.round(ping);
        } catch { if (generation === this.generation) delete this.pings[id]; }
        finally{clearTimeout(timeout);}
      }));
      if(generation===this.generation)this.pingBusy=false;
      if (generation === this.generation) this.changed();
    }, 3000);
    this.changed();
  }
  async broadcastRoster() {
    if (!this.isHost || !this.room) return;
    const generation = this.generation;
    const body = JSON.stringify({ room: this.invite.room, host: selfId, seq: ++this.sequence, started:this.sessionStarted===true, players: [...this.players.values()] });
    const signature = b64(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, this.keys.privateKey, encoder.encode(body)));
    if (generation !== this.generation || !this.room) return;
    await this.roster.send({ key: this.publicKey, signature, body });
    this.changed();
  }
  changed() {
    this.emit('change', { selfId, hostId: this.hostId, isHost: this.isHost, connected: !!this.hostId,connection:this.connectionPhase(), players: [...this.players.values()].map(p => ({ ...p, self: p.id === selfId, ping: p.id === selfId ? 0 : this.fast?.latency(p.id).rttMs ?? this.pings[p.id] ?? null })) });
  }
  connectionPhase(){return lobbyConnection({connected:!!this.hostId,host:this.isHost,elapsedMs:performance.now()-(this.connectionStartedAt||performance.now()),diagnostics:this.networkDiagnostics?.snapshot()});}
  acceptState(id, state, senderSample={}) {
    const now = performance.now(), previous = this.states.get(id);
    if(!this.seats.validOccupant(id,state))return;
    // Keep the sender clock only to estimate display velocity when delivery is
    // bursty. The host's receive clock above remains authoritative for game
    // validation; this peer timestamp never controls accepted game state.
    const sourceTime=Number.isFinite(senderSample.sourceTime)&&senderSample.sourceTime>=0&&senderSample.sourceTime<Number.MAX_SAFE_INTEGER?senderSample.sourceTime:null;
    if (previous && now - previous.time < 2000) {
      const elapsed = Math.max(0.05, (now - previous.time) / 1000);
      if (Math.hypot(state[0] - previous.state[0], state[1] - previous.state[1]) > (state[9]===1?85:18) * elapsed + 3) return;
    }
    const approved=this.combat.update(id,state,now);
    this.states.set(id, { state:approved.state, time: now, previousState: previous?.state, previousTime: previous?.time, sourceTime, previousSourceTime:previous?.sourceTime, seq: (previous?.seq || 0) + 1 });
    this.frameDispatch?.request();
  }
  acceptHit(id,event) {
    if(!this.isHost||!this.players.has(id)||!this.players.has(event?.target))return;
    const hit=this.combat.hit(id,event,performance.now());if(!hit)return;
    const target=this.states.get(hit.target);
    if(target){target.state=[...target.state];target.state[8]=hit.health;target.seq++;}
    const result={...hit,attacker:id};
    if(hit.target!==selfId)this.hitResults?.send(result,{target:hit.target}).catch(()=>{});
    this.frameDispatch?.request();this.emit('combat',result);this.emit('player-hit',{...result,selfTarget:hit.target===selfId});
  }
  sendHit(hit) {
    if(!this.room || typeof hit?.target!=='string')return;
    const event={target:hit.target,weapon:hit.weapon,damage:hit.damage,origin:hit.origin,impact:hit.impact,seq:++this.hitSequence};
    if(this.isHost)this.acceptHit(selfId,event);
    else if(this.hostId)this.hits.send(event,{target:this.hostId}).catch(()=>{});
  }
  sendWorldDamage(event) {
    // Only this host's native engine supplies world damage; no peer receive action exists.
    if(!this.isHost || !this.room)return;
    const hit=this.combat.worldDamage(event?.target||selfId,event?.amount,performance.now());if(!hit)return;
    const target=this.states.get(hit.target);if(target){target.state=[...target.state];target.state[8]=hit.health;target.seq++;}
    this.frameDispatch?.request();this.emit('combat',hit);
  }
  acceptEquipment(id,equipment){const weapon=typeof equipment==='number'?equipment:equipment?.weapon;if(!validWeapon(weapon))return;const wanted=Number.isInteger(equipment?.wanted)&&equipment.wanted>=0&&equipment.wanted<=6?equipment.wanted:this.wantedLevels.get(id)||0,visible=typeof equipment?.visible==='boolean'?equipment.visible:weapon!==0;if(this.wantedLevels.get(id)===wanted&&this.combat.equipment.get(id)===weapon&&this.weaponVisibility.get(id)===visible)return;this.wantedLevels.set(id,wanted);this.combat.equip(id,weapon);this.weaponVisibility.set(id,visible);this.frameDispatch?.request();}
  sendEquipment(equipment) {
    const weapon=typeof equipment==='number'?equipment:equipment?.weapon;
    if(!this.room || !validWeapon(weapon))return;
    if(this.isHost)this.acceptEquipment(selfId,equipment);
    else if(this.hostId)this.equipmentAction.send(equipment,{target:this.hostId}).catch(()=>{});
  }
  acceptShot(id,event) {
    const shot=this.shotAuthority.accept(id,event,this.states.get(id),this.combat.equipment.get(id),performance.now());
    if(!shot)return;
    this.shotOutput.send(shot).catch(()=>{});this.emit('shot',{...shot,self:id===selfId});
  }
  sendShot(shot) {
    if(!this.room || !validShot(shot))return;
    const event={...shot,seq:++this.shotSequence};
    if(this.isHost)this.acceptShot(selfId,event);
    else if(this.hostId)this.shotInput.send(event,{target:this.hostId}).catch(()=>{});
  }
  sendNpcMeleeRequest(request) {
    if(!this.room || this.isHost || !this.hostId || !Number.isSafeInteger(request?.targetId) || request.targetId<0 || request.targetId>=16777216 || !Number.isInteger(request?.weapon) || request.weapon<0 || request.weapon>11 || !Number.isFinite(request?.damage) || request.damage<=0 || request.damage>250)return false;
    this.npcMeleeInput.send({targetId:request.targetId,weapon:request.weapon,damage:request.damage,seq:++this.npcMeleeSequence},{target:this.hostId}).catch(()=>{});return true;
  }
  sendState(state) {
    if (!this.room || !validState(state)) return;
    const sourceSample={state,sourceTime:performance.now()};
    if (this.isHost) this.acceptState(selfId, state, sourceSample);
    else if (this.hostId) this.sendSnapshot('movement',this.movement,sourceSample,[this.hostId]);
  }
  sendSnapshot(kind, action, value, targets=[...this.players.keys()].filter(id=>id!==selfId)) {
    const room=this.room;if(!room)return;
    for(const id of targets){const key=kind+':'+id;let sender=this.snapshotSenders.get(key);
      if(!sender){sender=new SnapshotSender({peer:()=>room.getPeers()[id],send:packet=>this.fast.send(id,kind,packet)?Promise.resolve():action.send(packet,{target:id}),minIntervalMs:kind==='driver'?1000/120:0});this.snapshotSenders.set(key,sender);}
      sender.offer(value);
    }
  }
  async connectionReport() {
    const reports=[];
    for(const pc of Object.values(this.room?.getPeers()||{})){
      const stats=await pc.getStats();const transport=[...stats.values()].find(s=>s.type==='transport'&&s.selectedCandidatePairId);
      const pair=stats.get(transport?.selectedCandidatePairId);const local=stats.get(pair?.localCandidateId),remote=stats.get(pair?.remoteCandidateId);
      reports.push({state:pc.connectionState,ice:pc.iceConnectionState,route:pair?{localType:local?.candidateType,remoteType:remote?.candidateType,protocol:local?.protocol,rttMs:Number.isFinite(pair.currentRoundTripTime)?Math.round(pair.currentRoundTripTime*1000):null,availableOutgoingKbps:pair.availableOutgoingBitrate===undefined?null:Math.round(pair.availableOutgoingBitrate/1000)}:null});
    }
    return {setupTiming:{...this.setupTiming},frameDispatch:this.frameDispatch?.report(),reliablePingMs:Object.values(this.pings),phase:this.connectionPhase(),attempt:this.connectAttempt||0,discovery:this.networkDiagnostics?.snapshot(),peers:reports.slice(0,7),snapshotChannels:this.fast?.report()||[],pendingSnapshots:[...this.snapshotSenders?.values()||[]].filter(s=>s.pending!==null).length};
  }
  sendWorld(frame) {
    if(!this.room || !this.isHost || !validWorldFrame(frame))return;
    this.seats.world(frame);
    this.sendSnapshot('ambient',this.ambient,frame);
  }
  sendGlass(state){if(this.room && !this.isHost && this.hostId && validGlass(state))this.glassInput.send({state,seq:++this.glassSequence},{target:this.hostId}).catch(()=>{});}
  clearSeatRequest(requestId){const pending=this.pendingSeatRequest;if(!pending||requestId!==undefined&&pending.requestId!==requestId)return false;if(pending.timer)clearTimeout(pending.timer);this.pendingSeatRequest=null;return true;}
  acceptSeat(id,request) {
    if(request?.release===true){this.seats.release(id);return;}
    if(id===selfId && request?.driver===true){this.seats.driver(id,request.car,this.states.get(id),true);return;}
    if(!Number.isSafeInteger(request?.id) || request.id<0)return;
    const existing=this.seats.claims.get(id);
    if(existing?.id===request.id && (request.driver===true?existing.seat===-1:existing.seat>=0)){
      if(id!==selfId&&Number.isSafeInteger(request.requestId))this.seatOutput.send({...existing,requestId:request.requestId},{target:id}).catch(()=>{});
      return;
    }
    const claim=request?.driver===true?this.seats.requestDriver(id,request.id,this.states.get(id),performance.now()):this.seats.request(id,request.id,this.states.get(id),performance.now());
    if(!claim)return;
    if(id===selfId)this.emit('seat-grant',claim);else this.seatOutput.send(Number.isSafeInteger(request.requestId)?{...claim,requestId:request.requestId}:claim,{target:id}).catch(()=>{});
  }
  sendSeat(request){
    if(!this.room)return;
    if(this.isHost){this.acceptSeat(selfId,request);return;}
    if(!this.hostId)return;
    if(request?.release===true){this.clearSeatRequest();this.seatInput.send(request,{target:this.hostId}).catch(()=>{});return;}
    if(!Number.isSafeInteger(request?.id)||request.id<0)return;
    const driver=request.driver===true,previous=this.pendingSeatRequest;
    if(previous&&previous.id===request.id&&previous.driver===driver)return;
    this.clearSeatRequest();
    const pending={id:request.id,driver,requestId:(this.seatRequestSequence=(this.seatRequestSequence||0)+1),hostId:this.hostId,generation:this.generation,attempts:0,timer:null};
    const send=()=>{
      if(this.pendingSeatRequest!==pending||this.generation!==pending.generation||this.hostId!==pending.hostId||!this.room){this.clearSeatRequest(pending.requestId);return;}
      this.seatInput.send({...request,requestId:pending.requestId},{target:pending.hostId}).catch(()=>{});
      if(++pending.attempts>=5){this.clearSeatRequest(pending.requestId);return;}
      pending.timer=setTimeout(send,350);
    };
    this.pendingSeatRequest=pending;send();
  }
  sendVehicle(update){
    if(!this.room||!validDriverSnapshot(update))return false;
    const seq=update.seq===undefined?(this.vehicleSequence>=0x7fffffff?1:this.vehicleSequence+1):update.seq;
    this.vehicleSequence=Math.max(this.vehicleSequence,seq);
    const sequenced=update.seq===seq?update:{...update,seq};
    if(this.isHost){const targets=[...this.players.keys()].filter(id=>id!==selfId);if(!targets.length)return false;this.sendSnapshot('driver',this.vehicleInput,sequenced,targets);return true;}
    if(!this.hostId)return false;this.sendSnapshot('driver',this.vehicleInput,sequenced,[this.hostId]);return true;
  }
  acceptDriverSnapshot(update,{peerId,realtime}={}){
    const admitted=this.isHost?this.players.has(peerId):peerId===this.hostId;
    if(!admitted||!validDriverSnapshot(update))return false;
    if(update.seq!==undefined){
      const previous=this.vehicleReceiveSequences.get(peerId)||0;
      if(update.seq<=previous)return false;
      this.vehicleReceiveSequences.set(peerId,update.seq);
    }else if(this.isHost&&!realtime&&this.fast?.seen(peerId,'driver'))return false;
    const measuredRtt=this.fast?.latency(peerId)?.rttMs;
    const ping=this.pings?.[peerId];
    const rttMs=Number.isFinite(measuredRtt)?measuredRtt:Number.isFinite(ping)?ping:0;
    // The local game bridge adds about 8 ms on the measured 144 FPS path.
    // Add the measured route's one-way component without making the local
    // same-PC replica visibly lead the driver's actual position.
    const leadMs=Math.min(180,8+Math.max(0,Math.min(300,rttMs))/2);
    if(this.isHost){const approved=this.seats.acceptVehicle(peerId,update,performance.now());if(approved)this.emit('driver-state',{...approved,leadMs});}
    else this.emit('driver-state',{...update,leadMs});
    return true;
  }
  sendVehicleDoors(update){if(this.room&&!this.isHost&&this.hostId&&Number.isSafeInteger(update?.id)&&Array.isArray(update.doors)&&update.doors.length===6&&update.doors.every(v=>Number.isFinite(v)&&Math.abs(v)<=2.4))this.vehicleDoors.send({id:update.id,doors:update.doors},{target:this.hostId}).catch(()=>{});}
  sendVehicleSpawnRequest(model){if(!this.room||this.isHost||!this.hostId||!VEHICLE_MODELS.includes(model))return false;this.vehicleSpawnAction.send({model},{target:this.hostId}).catch(()=>{});return true;}
  sendSharedCheatToggle(cheatId){if(!this.room||this.isHost||!this.hostId||!SHARED_CHEATS.includes(cheatId))return false;this.sharedCheatAction.send({cheatId},{target:this.hostId}).catch(()=>{});return true;}
  async startGame() {
    if (!this.isHost || !this.room) throw new Error('Only the host can start the session.');
    if(this.sessionStarted)return;
    if(!this.players.size)throw new Error('Create a lobby before starting multiplayer.');
    if([...this.players.values()].some(p=>!p.ready)) throw new Error('Everyone needs to import their game files before starting.');
    this.sessionStarted=true;
    try { await this.broadcastRoster(); await this.launch.send({ v: 1 }); this.emit('launch', {}); }
    catch(error){this.sessionStarted=false;throw error;}
  }
  async leave() {
    this.frameDispatch?.close();
    this.fast?.close();
    for(const sender of this.snapshotSenders?.values()||[])sender.close();this.snapshotSenders?.clear();
    clearInterval(this.timer); clearInterval(this.gameTimer); clearTimeout(this.timeout);
    const room = this.room;
    this.room = null;
    const wasHost=this.isHost;
    // Do not let a stalled signaling send or relay teardown trap an automatic
    // reconnect in "Retrying" forever. The old generation is invalidated before
    // teardown; late packets from it are ignored by the handlers above.
    this.generation++;
    if (room) {
      if (wasHost) await settleWithin(() => this.bye.send({}), 300);
      await settleWithin(() => room.leave(), 900);
    }
    this.reset(); this.keys = null;
  }
}
export { selfId };
