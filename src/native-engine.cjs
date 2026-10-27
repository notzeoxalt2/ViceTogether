const { EventEmitter } = require('node:events');
const dgram = require('node:dgram');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const MAGIC = 0x31545656;
const {validWorldFrame,validVehicleVisual,validDriverVehicleVisual,retainSupportedWorldPeds}=require('../engine/world.cjs');
const {validWeapon,instantWeapon,shotRange}=require('../engine/weapons.cjs');
const {validGlass}=require('../engine/glass.cjs');
const {VEHICLE_MODELS}=require('../engine/vehicle-spawn.cjs');
const {SHARED_CHEATS}=require('../engine/shared-cheats.cjs');
const NATIVE_TEST_SWITCHES=Object.freeze(['VT_TEST_JUMP','VT_TEST_GUN_WALK','VT_TEST_SHOTS','VT_TEST_CAR','VT_TEST_GUEST_DRIVE','VT_TEST_CAR_BLAST','VT_TEST_VEHICLE_COLLISION','VT_TEST_WORLD_EFFECTS','VT_TEST_GUEST_FAR_WORLD','VT_TEST_GUEST_NPC_MELEE','VT_TEST_GUEST_SPAWN','VT_TEST_MENU']);
function nativeTestFlags(source=process.env){
  const flags={};
  for(const flag of NATIVE_TEST_SWITCHES)if(source[flag]==='1')flags[flag]='1';
  const model=String(source.VT_TEST_VEHICLE??'');
  if(/^\d+$/.test(model)&&VEHICLE_MODELS.includes(Number(model)))flags.VT_TEST_VEHICLE=String(Number(model));
  return flags;
}
function validState(s) {
  return Array.isArray(s) && [10,20,34].includes(s.length) && s.every(Number.isFinite)
    && (s.length === 10 || (s.length===34?[10,15,20,25]:[10,15]).every(i => s[i] >= 0 && s[i] <= 1000 && s[i+1] >= 0 && s[i+1] <= 1000 && s[i+2] >= 0 && s[i+2] <= 1000 && s[i+3] >= 0 && s[i+3] <= 10 && s[i+4] >= 0 && s[i+4] <= 1.01))
    && (s.length!==34 || ([0,1].includes(s[30]) && Math.abs(s[31])<100 && Math.abs(s[32])<4 && [0,1].includes(s[33])))
    && Math.abs(s[0]) < 10000 && Math.abs(s[1]) < 10000 && Math.abs(s[2]) < 3000
    && s[7] >= 0 && s[7] <= 5 && s[8] >= 0 && s[8] <= 1000 && (s[9] === 0 || s[9] === 1);
}
function validVehicleDoors(update){return Number.isSafeInteger(update?.id)&&update.id>=0&&Array.isArray(update.doors)&&update.doors.length===6&&update.doors.every(v=>Number.isFinite(v)&&Math.abs(v)<=2.4);}
function packet(type, slot, state = Array(10).fill(0)) {
  const b = Buffer.alloc(148); b.writeUInt32LE(MAGIC); b.writeUInt32LE(type, 4); b.writeUInt32LE(slot, 8);
  state.forEach((v, i) => b.writeFloatLE(v, 12 + i * 4)); return b;
}
class NativeEngine extends EventEmitter {
  constructor(executable) { super(); this.executable = executable; this.slots = new Map(); this.received = new Map(); this.driverVisuals=new Map();this.driverSequence=0;this.localPlayerId=null; this.worldFrameStats={started:0,accepted:0,rejected:0,droppedUnsupportedPeds:0,lastReject:null}; }
  async start(gameRoot, { multiplayer = false, authoritativeWorld = false, inputDisabled = false, testWalk = false, testCombat = false, followPlayer = false, muted = false, name = 'Player', fps = 144, fullscreen = true, mouseSensitivity = 1.5, windowBounds, spawnOffset = Math.random() * 6, userDir = path.join(gameRoot, 'userfiles') } = {}) {
    if (this.child && this.child.exitCode === null) {
      if(this.multiplayer !== multiplayer) throw new Error('Close the current game before switching between singleplayer and multiplayer.');
      if(multiplayer&&this.authoritativeWorld!==authoritativeWorld)throw new Error('Close the current game before switching between hosting and joining.');
      this.resetSession();
      return;
    }
    await fs.access(this.executable);
    this.worldPending=null;this.worldReceived=0;this.shotSequences=new Map();this.driverVisuals.clear();this.driverSequence=0;this.authoritativeWorld=authoritativeWorld;
    this.selfSequence=-1;
    this.packetCounts={};this.lastPerformance=null;this.lastWorldStatus=null;this.worldHitCounts={npc:0,vehicle:0};
    await fs.access(path.join(gameRoot, 'Mss32.dll')).catch(() => { throw new Error('Vice City’s Mss32.dll is missing. Import your original game folder again.'); });
    await fs.mkdir(userDir, { recursive: true });
    const localExe = path.join(gameRoot, 'ViceTogether-engine.exe');
    await fs.copyFile(this.executable, localExe);
    const env = { ...process.env, VT_USER_DIR: userDir, VT_PLAYER_NAME: cleanLabel(name), VT_FPS: String([0,30,60,120,144,240].includes(fps) ? fps : 144) };
    env.VT_FULLSCREEN = fullscreen ? '1' : '0';
    env.VT_MOUSE_SENSITIVITY=String(Math.max(0.25,Math.min(4,Number(mouseSensitivity)||1.5)));
    for(const key of ['X','Y','WIDTH','HEIGHT'])delete env['VT_WINDOW_'+key];
    if(windowBounds)for(const key of ['x','y','width','height'])if(Number.isInteger(windowBounds[key]))env['VT_WINDOW_'+key.toUpperCase()]=String(windowBounds[key]);
    delete env.VT_PORT; delete env.VT_AUTOSTART; delete env.VT_TEST_WALK;delete env.VT_TEST_COMBAT;delete env.VT_TEST_GUEST_DRIVE;delete env.VT_TEST_GUEST_NPC_MELEE;delete env.VT_TEST_GUEST_SPAWN;
    delete env.VT_WORLD_HOST;delete env.VT_TEST_GUN_WALK;delete env.VT_TEST_SHOTS;delete env.VT_TEST_JUMP;delete env.VT_TEST_CAR;delete env.VT_TEST_CAR_BLAST;delete env.VT_TEST_WORLD_EFFECTS;
    delete env.VT_INPUT_DISABLED;
    delete env.VT_MUTE;delete env.VT_FOLLOW_PLAYER;delete env.VT_TEST_GUN;delete env.VT_TEST_MOVING_COMBAT;
    if (multiplayer) {
      this.socket = dgram.createSocket('udp4'); this.endpoint = null; this.slots.clear(); this.received.clear();
      this.socket.on('error', e => this.emit('problem', `The local game connection failed: ${e.message}`));
      this.socket.on('message', (b, source) => {
        if(testCombat && !this.packetDiagnostic){this.packetDiagnostic=true;this.emit('packet-diagnostic',{size:b.length,type:b.length>=8?b.readUInt32LE(4):null});}
        if (source.address !== '127.0.0.1' || b.length !== 148 || b.readUInt32LE(0) !== MAGIC) return;
        if (this.endpoint && source.port !== this.endpoint) return;
        const type = b.readUInt32LE(4), slot = b.readUInt32LE(8);
        if(type<=64)this.packetCounts[type]=(this.packetCounts[type]||0)+1;
        const state = Array.from({ length: 34 }, (_, i) => b.readFloatLE(12 + 4 * i));
        if((type>=19 && type<=22) || type===35 || type===37 || type===42) {
          if(!this.authoritativeWorld || !this.endpoint)return;
          if(type===19){this.worldFrameStats.started++;this.worldPending={seq:state[0],expected:state[1],expectedGlass:state[21],expectedExplosions:state[22],environment:[...state.slice(2,21),state[23]],entities:[],glass:[],explosions:[]};}
          else if(type===20){const raw=this.worldPending;this.worldPending=null;let frame=raw;const countsMatch=raw && raw.seq===state[0] && raw.entities.length===raw.expected && raw.glass.length===raw.expectedGlass && raw.explosions.length===raw.expectedExplosions;if(countsMatch){const normalized=retainSupportedWorldPeds(raw);frame=normalized.frame;this.worldFrameStats.droppedUnsupportedPeds+=normalized.droppedPeds;}if(countsMatch && validWorldFrame(frame)){this.worldFrameStats.accepted++;this.emit('world',frame);}else if(raw){this.worldFrameStats.rejected++;this.worldFrameStats.lastReject={seq:raw.seq,endSeq:state[0],expectedEntities:raw.expected,actualEntities:raw.entities.length,expectedGlass:raw.expectedGlass,actualGlass:raw.glass.length,expectedExplosions:raw.expectedExplosions,actualExplosions:raw.explosions.length,environment:raw.environment,firstEntity:frame.entities[0]??null,validFrame:validWorldFrame(frame)};this.emit('world-rejected',this.worldFrameStats.lastReject);}}
          else if(type===42){if(this.worldPending && this.worldPending.explosions.length<32)this.worldPending.explosions.push(state);}
          else if(type===37){if(this.worldPending && this.worldPending.glass.length<128)this.worldPending.glass.push(state);}
          else if(type===35){const vehicle=this.worldPending?.entities.find(e=>e.type===22 && e.id===slot);if(vehicle)vehicle.visual=state;}
          else if(this.worldPending && this.worldPending.entities.length<80)this.worldPending.entities.push({type,id:slot,state:state.map(v=>Math.round(v*1000)/1000)});
          return;
        }
        if (type === 1 && validState(state)) { this.endpoint = source.port; this.emit('state', state); }
        else if(type===23 && state.slice(0,23).every(Number.isFinite)){
          const observed={seq:state[0],peds:state[1],vehicles:state[2],loadedPeds:state[3],loadedVehicles:state[4],rain:state[5],wetRoads:state[6],oldWeather:state[7],newWeather:state[8],hour:state[9],minute:state[10],glassRecords:state[11],brokenGlass:state[12],crackedGlass:state[13],explosionSequence:state[14],wreckedVehicles:state[15],localAmbientPeds:state[16],localAmbientVehicles:state[17],localPopulationEnabled:state[18]===1,meleeTestStage:state[19],meleeTestTarget:state[20],meleeTestLocalDistance:state[21],meleeTestRemoteDistance:state[22],seatGrantStatus:state[19],seatGrantCalls:state[23],seatGrantModel:state[24],seatGrantSeat:state[25],seatObjectiveModel:state[26],hostExitSpeed:state[27],hostExitWithDriver:state[28]===1,hostExitRequested:state[29]===1,driverMotionFrames:state[30]||0,driverMotionPackets:state[31]||0,heliRotorRotation:Number.isFinite(state[32])?state[32]:null,heliRotorModel:Number.isFinite(state[33])?state[33]:null};
          if(process.env.VT_TEST_GUEST_SPAWN==='1'){observed.testHelicopters={count:state[19],nearest:{position:state.slice(20,23),id:state[23],rotorRotation:state[24],model:state[25],health:state[26],rotorSpeed:state[16],status:state[17],engineOn:state[18]===1,groundZ:state[29]}};observed.testSpawn={calls:state[27],stage:state[28],stageName:['idle','received','rejected','busy','streaming','expired','waiting-model','waiting-player','pool-full','unsupported','created','no-safe-ground'][state[28]]||'unknown',groundZ:state[29],createdModel:state[30],createdZ:state[31],createdHasRenderObject:state[32]===1,createdVehicleId:state[33]};}
          this.emit('world-observed',observed);
        }
        else if(type===28 && Number.isSafeInteger(state[0]) && Number.isInteger(state[1]))this.emit('seat-state',{id:state[0],seat:state[1]});
        else if(type===30)this.emit('seat-request',{id:slot,driver:state[0]===-1});
        else if(type===55&&!this.authoritativeWorld&&Number.isInteger(state[0])&&VEHICLE_MODELS.includes(state[0]))this.emit('vehicle-spawn-request',state[0]);
        else if(type===57&&!this.authoritativeWorld&&Number.isInteger(state[0])&&SHARED_CHEATS.includes(state[0]))this.emit('shared-cheat-request',state[0]);
        else if(type===60&&Number.isSafeInteger(slot)&&slot>=0&&slot<=16777215&&validDriverVehicleVisual(state))this.driverVisuals.set(slot,state);
        else if(type===62&&!this.authoritativeWorld&&Number.isSafeInteger(slot)&&slot>=0&&slot<=16777215&&state.slice(0,6).every(v=>Number.isFinite(v)&&Math.abs(v)<=2.4))this.emit('vehicle-doors',{id:slot,doors:state.slice(0,6)});
        else if(type===43&&Number.isSafeInteger(slot)&&slot>=0&&slot<=16777215&&state.every(Number.isFinite)){this.driverSequence=this.driverSequence>=0x7fffffff?1:this.driverSequence+1;this.emit('driver-state',{id:slot,seq:this.driverSequence,state,visual:this.driverVisuals.get(slot)?.slice()});}
        else if(type===40 && !this.authoritativeWorld && validGlass(state))this.emit('glass-request',state);
        else if(type===36 && this.authoritativeWorld && slot<=7 && Number.isFinite(state[0]) && state[0]>0 && state[0]<=100){const target=slot===7?null:[...this.slots].find(([,s])=>s===slot)?.[0];if(slot===7 || target)this.emit('world-damage',{target,amount:state[0]});}
        else if (testWalk && type === 4 && slot < 7 && state.every(Number.isFinite)) this.emit('remote-observed', { slot, state });
        else if (type === 11 && slot < 7 && state.every(Number.isFinite)) this.emit('skeleton-observed', { slot, state });
        else if(testWalk && type===18 && state.every(Number.isFinite))this.emit('local-skeleton-observed',{state});
        else if(testWalk && type===52 && state.every(Number.isFinite))this.emit('menu-observed',{state});
        else if (type === 6 && state.every(Number.isFinite)) {this.lastPerformance={fps:state[0],frameMsP95:state[1]};this.emit('performance', { fps: state[0], frameMsP95: state[1],window:{x:state[2],y:state[3],width:state[4],height:state[5]} });}
        else if(type===45&&this.authoritativeWorld&&[0,1].includes(slot))this.worldHitCounts[slot===0?'npc':'vehicle']++;
        else if(type===51&&this.authoritativeWorld&&Number.isInteger(state[0]))this.emit('melee-validation',{slot,stage:state[0],targetId:state[1],distance:state[2],health:state[3]});
        else if(type===47&&!this.authoritativeWorld&&Number.isSafeInteger(slot)&&slot>=0&&slot<16777216&&Number.isInteger(state[0])&&state[0]>=0&&state[0]<=11&&Number.isFinite(state[1])&&state[1]>0&&state[1]<=250){this.lastMeleeTargetId=slot;this.lastMeleeRequestAt=Date.now();this.emit('melee-request',{targetId:slot,weapon:state[0],damage:state[1]});}
        else if(type===12 && validWeapon(state[0]))this.emit('equipment',{weapon:state[0],visible:state[1]===1,wanted:Number.isInteger(state[2])&&state[2]>=0&&state[2]<=6?state[2]:0});
        else if(type===14 && instantWeapon(state[0]) && state.slice(1,12).every(Number.isFinite))this.emit('shot',{weapon:state[0],source:state.slice(1,4),end:state.slice(4,7),hit:state[7]===1,normal:state.slice(8,11),hitKind:state[11]});
        else if(type===16 && slot<7)this.emit('shot-played',{slot,weapon:state[0],source:state.slice(1,4),end:state.slice(4,7),hit:state[7]===1,hitKind:state[11]});
        else if(type===9 && slot<7 && Number.isInteger(state[0]) && state[0]>=0 && (state[0]<=11 || instantWeapon(state[0]))) {
          const target=[...this.slots].find(([,s])=>s===slot)?.[0];
          if(target && state.slice(1,8).every(Number.isFinite))this.emit('hit',{target,weapon:state[0],origin:state.slice(1,4),impact:state.slice(4,7),damage:state[7]});
        }
      });
      await new Promise((resolve, reject) => { this.socket.once('error', reject); this.socket.bind(0, '127.0.0.1', resolve); });
      env.VT_PORT = String(this.socket.address().port); env.VT_AUTOSTART = '1';
      env.VT_WORLD_HOST=authoritativeWorld?'1':'0';
      env.VT_SPAWN_OFFSET = String(Math.min(6, Math.max(0, Number(spawnOffset) || 0)));
      if (testWalk) env.VT_TEST_WALK = '1';
      if(testWalk)Object.assign(env,nativeTestFlags());
      if(testCombat)env.VT_TEST_COMBAT='1';
      if(testCombat && process.env.VT_TEST_COMBAT_BIDIRECTIONAL==='1')env.VT_TEST_COMBAT_BIDIRECTIONAL='1';
      if(testCombat && process.env.VT_TEST_GUN==='1')env.VT_TEST_GUN='1';
      if(testCombat && process.env.VT_TEST_MOVING_COMBAT==='1')env.VT_TEST_MOVING_COMBAT='1';
      if(followPlayer)env.VT_FOLLOW_PLAYER='1';
      if(muted)env.VT_MUTE='1';
      if(inputDisabled)env.VT_INPUT_DISABLED='1';
    }
    this.multiplayer = multiplayer;
    this.child = spawn(localExe, [], { cwd: gameRoot, env, windowsHide: testWalk && process.env.VT_TEST_SHOW !== '1', stdio: 'ignore' });
    this.child.once('error', e => { this.emit('problem', `The game could not start: ${e.message}`); this.closeSocket(); });
    this.child.once('exit', (code, signal) => { this.closeSocket(); this.emit('ended', { code, signal }); });
  }
  send(type, slot, state) {
    if (this.socket && this.endpoint) this.socket.send(packet(type, slot, state), this.endpoint, '127.0.0.1', () => {});
  }
  remoteWorld(frame) {
    if(this.authoritativeWorld || !validWorldFrame(frame) || frame.seq<=this.worldReceived)return false;
    this.worldReceived=frame.seq;
    const header=Array(34).fill(0);header[0]=frame.seq;header[1]=frame.entities.length;(frame.environment||[0,0,0,0,0,0]).slice(0,19).forEach((v,i)=>header[i+2]=v);if(frame.environment?.length===20)header[23]=frame.environment[19];header[21]=frame.glass?.length||0;header[22]=frame.explosions?.length||0;this.send(19,0,header);
    for(const entity of frame.entities){this.send(entity.type,entity.id,entity.state);if(entity.visual)this.send(35,entity.id,entity.visual);}
    for(const [i,pane] of (frame.glass||[]).entries())this.send(37,i,pane);
    for(const [i,event] of (frame.explosions||[]).entries())this.send(42,i,event);
    this.send(20,0,[frame.seq,frame.entities.length]);return true;
  }
  frame(frame) {
    if (!this.socket || !this.endpoint) return;
    if (!Array.isArray(frame) || frame.length > 8) return;
    const self=frame.find(p=>p?.self);
    if(typeof self?.id==='string')this.localPlayerId=self.id;
    if(self && (!Number.isSafeInteger(self.seq) || self.seq>(this.selfSequence??-1))) {
      if(Number.isSafeInteger(self.seq))this.selfSequence=self.seq;
      this.send(7,0,[Number.isInteger(self.color)?self.color%8:0,...Array(9).fill(0)]);
      if(validState(self.state))this.send(10,0,[self.state[8],...Array(9).fill(0)]);
    }
    const remotes = frame.filter(p => p && !p.self && typeof p.id === 'string' && p.id.length < 128 && validState(p.state) && (p.state[9]===0 || Number.isSafeInteger(p.vehicle?.id) && p.vehicle.id>=0 && Number.isInteger(p.vehicle.seat) && p.vehicle.seat>=-1 && p.vehicle.seat<8));
    const ids = new Set(remotes.map(p => p.id));
    for (const [id, slot] of this.slots) if (!ids.has(id)) { this.send(3, slot); this.slots.delete(id); this.received.delete(id); }
    for (const p of remotes) {
      if (!this.slots.has(p.id)) {
        const used = new Set(this.slots.values());
        const slot = Array.from({ length: 7 }, (_, i) => i).find(i => !used.has(i));
        if (slot === undefined) continue; this.slots.set(p.id, slot);
      }
      const previous = this.received.get(p.id);
      if (Number.isSafeInteger(p.seq) && previous && p.seq <= previous.seq) continue;
      if (!Number.isSafeInteger(p.seq) && previous && p.state.every((v, i) => v === previous.state[i])) continue;
      const slot = this.slots.get(p.id), label = cleanLabel(p.name), color=Number.isInteger(p.color)?Math.abs(p.color)%8:1;
      if (previous?.label !== label || previous?.color !== color) {
        const b = packet(5, slot); b.fill(0, 12); b.write(label, 12, 24, 'ascii');
        b[36]=color;
        this.socket.send(b, this.endpoint, '127.0.0.1', () => {});
      }
      this.send(2, slot, p.state);
      if(p.state[9]===1)this.send(29,slot,[p.vehicle.id,p.vehicle.seat]);else if(previous?.state[9]===1)this.send(29,slot,[-1,-1]);
      const weapon=validWeapon(p.weapon)?p.weapon:0;
      const weaponVisible=typeof p.weaponVisible==='boolean'?p.weaponVisible:weapon!==0 && p.state[9]===0;
      const wanted=Number.isInteger(p.wanted)&&p.wanted>=0&&p.wanted<=6?p.wanted:0;
      if(previous?.weapon!==weapon || previous?.weaponVisible!==weaponVisible || previous?.wanted!==wanted)this.send(13,slot,[weapon,weaponVisible?1:0,wanted]);
      this.received.set(p.id, { seq: p.seq, state: p.state.slice(), label, color,weapon,weaponVisible,wanted });
    }
  }
  playerHit(event) {
    if(!this.socket||!this.endpoint||typeof event?.attacker!=='string'||typeof event?.target!=='string'||!Number.isInteger(event.weapon)||event.weapon<0||!(event.weapon<=11||instantWeapon(event.weapon))||!Number.isFinite(event.damage)||event.damage<=0||event.damage>60||!Number.isSafeInteger(event.seq)||event.seq<1)return false;
    const attackerSlot=this.slots.get(event.attacker);if(attackerSlot===undefined)return false;
    const localTarget=event.target===this.localPlayerId,targetSlot=localTarget?attackerSlot:this.slots.get(event.target);if(targetSlot===undefined)return false;
    const state=Array(34).fill(0);state[0]=event.weapon;state[1]=event.damage;state[2]=event.seq;state[3]=localTarget?1:0;state[4]=attackerSlot;
    this.send(17,targetSlot,state);return true;
  }
  glassRequest(state){if(this.authoritativeWorld && validGlass(state))this.send(41,0,state);}
  meleeGrant(request){if(!this.authoritativeWorld||!this.socket||!this.endpoint||!Number.isSafeInteger(request?.targetId)||request.targetId<0||request.targetId>=16777216||!Number.isInteger(request.weapon)||request.weapon<0||request.weapon>11||!Number.isFinite(request.damage)||request.damage<=0||request.damage>250||typeof request.playerId!=='string')return false;const slot=this.slots.get(request.playerId);if(slot===undefined)return false;this.send(48,slot,[request.targetId,request.weapon,request.damage]);return true;}
  closeSocket() { if (this.socket) { try { this.socket.close(); } catch {} this.socket = null; } this.endpoint = null; this.slots.clear();this.driverVisuals.clear(); }
  seatGrant(claim){if(Number.isSafeInteger(claim?.id) && claim.id>=0 && Number.isInteger(claim.seat) && claim.seat>=-1 && claim.seat<8)this.send(32,0,[claim.id,claim.seat]);}
  spawnVehicle(request){if(!this.authoritativeWorld||!this.socket||!this.endpoint||!VEHICLE_MODELS.includes(request?.model)||!Array.isArray(request?.position)||request.position.length!==3||!request.position.every(Number.isFinite)||!Number.isFinite(request.heading)||request.position.some((v,i)=>Math.abs(v)>[10000,10000,3000][i])||Math.abs(request.heading)>Math.PI*100)return false;this.send(56,0,[request.model,...request.position,request.heading]);return true;}
  toggleSharedCheat(cheatId,position){if(!this.authoritativeWorld||!this.socket||!this.endpoint||!SHARED_CHEATS.includes(cheatId))return false;if(cheatId===2&&(!Array.isArray(position)||position.length!==3||!position.every(Number.isFinite)||position.some((v,i)=>Math.abs(v)>[10000,10000,3000][i])))return false;this.send(58,0,[cheatId,...(cheatId===2?position:[0,0,0])]);return true;}
  // The lobby layer authorizes guest snapshots at the host and only accepts
  // host snapshots at guests. Both sides then apply the same native high-rate
  // replica update instead of leaving guests on the slower ambient world feed.
  driverState(update){if(!Number.isSafeInteger(update?.id)||update.id<0||!Array.isArray(update.state)||update.state.length!==34||!update.state.every(Number.isFinite))return;this.send(44,update.id,update.state);if(validDriverVehicleVisual(update.visual))this.send(61,update.id,update.visual);}
  driverDoors(update){if(!this.authoritativeWorld||!validVehicleDoors(update))return false;const state=Array(34).fill(0);update.doors.forEach((v,i)=>state[i]=v);this.send(63,update.id,state);return true;}
  remoteShot(shot) {
    if(shot?.self || typeof shot?.id!=='string' || !instantWeapon(shot.weapon) || !Number.isSafeInteger(shot.seq))return;
    const slot=this.slots.get(shot.id);if(slot===undefined)return;
    const points=[shot.source,shot.end,shot.normal];
    if(!points.every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite)) || Math.hypot(...shot.end.map((v,i)=>v-shot.source[i]))>shotRange(shot.weapon))return;
    this.shotSequences??=new Map();if(shot.seq<=(this.shotSequences.get(shot.id)||0))return;
    this.shotSequences.set(shot.id,shot.seq);
    this.send(15,slot,[shot.weapon,...shot.source,...shot.end,shot.hit?1:0,...shot.normal,[0,1,2].includes(shot.hitKind)?shot.hitKind:0]);
  }
  stop() { this.child?.kill(); this.closeSocket(); }
  resetSession(){this.selfSequence=-1;this.worldReceived=0;this.worldPending=null;this.received.clear();this.slots.clear();this.driverVisuals.clear();this.shotSequences?.clear();this.send(54,0,[]);}
  diagnostics(){return {running:!!this.child&&this.child.exitCode===null,host:this.authoritativeWorld===true,remotePlayers:this.slots.size,worldSequence:this.worldReceived||0,worldFrames:{...this.worldFrameStats},packets:this.packetCounts||{},performance:this.lastPerformance,lastMeleeTargetId:this.lastMeleeTargetId??null,lastMeleeRequestAt:this.lastMeleeRequestAt??null,appliedGuestHits:this.worldHitCounts||{npc:0,vehicle:0}};}
  networkStatus(status){if(!status||![status.ping,status.transportPing,status.peers].every(Number.isFinite)||status.ping< -1||status.ping>10000||status.transportPing< -1||status.transportPing>10000||!Number.isInteger(status.peers)||status.peers<0||status.peers>7)return;this.send(49,0,[status.ping,status.transportPing,status.peers]);}
}
function cleanLabel(name) { return String(name || 'Player').replace(/[^a-zA-Z0-9 _.-]/g, '').trim().slice(0, 24) || 'Player'; }
module.exports = { NativeEngine, validState, packet, cleanLabel, nativeTestFlags };
