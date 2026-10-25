const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { NativeEngine } = require('./native-engine.cjs');
const delay = ms => new Promise(r => setTimeout(r, ms));
async function runNativeGameTest({ a, b, executable, out,registerLauncher }) {
  let gameRoot = process.env.VT_TEST_GAME_ROOT;
  if (!gameRoot) throw new Error('Set VT_TEST_GAME_ROOT to your own Vice City asset folder for the native gameplay test.');
  let importTest = null;
  if(process.env.VT_TEST_IMPORT_CACHE) {
    const { AssetStore } = require('./assets.cjs');
    const store = new AssetStore(process.env.VT_TEST_IMPORT_CACHE);
    importTest = await store.import(gameRoot);
    assert.ok(importTest.gameReady, 'Real game import did not produce a ready asset cache');
    gameRoot = path.join(store.root, 'game');
    await fs.access(path.join(gameRoot, 'mss/Mp3dec.asi'));
  }
  const work = path.resolve(out, '../../work');
  const testId=`${process.pid}-${Date.now().toString(36)}`;
  const engines = [new NativeEngine(executable), new NativeEngine(executable)];
  const windows = [a, b];
  for(const window of windows)await window.webContents.executeJavaScript("window.testNpcMeleeEvents=[];testLobby.addEventListener('npc-melee',event=>window.testNpcMeleeEvents.push(event.detail))");
  const durationSeconds = Math.max(10, Math.min(180, Number(process.env.VT_TEST_DURATION) || (process.env.VT_TEST_GUEST_DRIVE==='1'?55:30)));
  const interactive=process.env.VT_MANUAL_FOLLOW==='1';
  const autoFollow=interactive && process.env.VT_MANUAL_BOTH!=='1';
  const combatTest=process.env.VT_TEST_COMBAT==='1',hits=[0,0];
  const diagnostics=[],meleeValidation=[],skeleton=[[],[]],shots=[[],[]],playedShots=[[],[]];
  const sourceSkeleton=[[],[]];
  const worldFrames=[0,0],worldObserved=[null,null],nativeWorld=[null,null],clientWorld=[null,null];
  let guestNpcShot=null;const guestNpcShotAttempts=[];let meleeRequestAt=null;const npcHealthSamples=new Map(),guestNpcHealthSamples=new Map();
  const worldStatusHistory=[[],[]];
  const menuObserved=[null,null],vehicleModels=[new Set(),new Set()];
  const driverSamples=[];const localSeats=[[],[]];let lastGuestSeat=-1;
  const deliveredGlass=new Map(),forwardedMelee=new Set();
  const placements=[0,1].map(i=>require('./display.cjs').gameWindow(i));
  const local = [[], []], remote = [[], []], performance = [[], []], errors = [];
  let timer, forwarding = false, stopping = false;
  let resetInjected=false,resetDue=null,resetPid=null,resetRecovered=false;
  try {
    for (let i = 0; i < 2; i++) {
      const root = path.join(work, `native-live-${testId}-${i}`);
      await fs.mkdir(root, { recursive: true });
      for (const entry of await fs.readdir(gameRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        const target = path.join(root, entry.name);
        try { await fs.lstat(target); } catch { await fs.symlink(path.join(gameRoot, entry.name), target, 'junction'); }
      }
      await fs.copyFile(path.join(gameRoot, 'Mss32.dll'), path.join(root, 'Mss32.dll'));
      engines[i].on('problem', text => errors.push(text));
      engines[i].on('packet-diagnostic',packet=>diagnostics.push({player:i,...packet}));
      engines[i].on('melee-validation',event=>meleeValidation.push(event));
      engines[i].on('ended', ({code}) => { if(!stopping) errors.push(`Engine ${i} exited before test completion (code ${code})`); });
      engines[i].on('state', state => {
        local[i].push({ time: Date.now(), state });
        windows[i].webContents.executeJavaScript(`testLobby.sendState(${JSON.stringify(state)})`).catch(e => errors.push(e.message));
      });
      engines[i].on('world-damage',event=>windows[i].webContents.executeJavaScript(`testLobby.sendWorldDamage(${JSON.stringify(event)})`).catch(e=>errors.push(e.message)));
      engines[i].on('glass-request',state=>windows[i].webContents.executeJavaScript(`testLobby.sendGlass(${JSON.stringify(state)})`).catch(e=>errors.push(e.message)));
      engines[i].on('melee-request',request=>{meleeRequestAt??=Date.now();windows[i].webContents.executeJavaScript(`testLobby.sendNpcMeleeRequest(${JSON.stringify(request)})`).catch(e=>errors.push(e.message));});
      engines[i].on('remote-observed', state => remote[i].push({ time: Date.now(), ...state }));
      engines[i].on('skeleton-observed', state => skeleton[i].push({ time: Date.now(), ...state }));
      engines[i].on('local-skeleton-observed',state=>sourceSkeleton[i].push({time:Date.now(),...state}));
      engines[i].on('performance', stats => performance[i].push(stats));
      engines[i].on('hit', hit=>{hits[i]++;windows[i].webContents.executeJavaScript(`testLobby.sendHit(${JSON.stringify(hit)})`).catch(e=>errors.push(e.message));});
      engines[i].on('equipment',weapon=>windows[i].webContents.executeJavaScript(`testLobby.sendEquipment(${JSON.stringify(weapon)})`).catch(e=>errors.push(e.message)));
      engines[i].on('shot',shot=>{shots[i].push(shot);windows[i].webContents.executeJavaScript(`testLobby.sendShot(${JSON.stringify(shot)})`).catch(e=>errors.push(e.message));});
      engines[i].on('shot-played',shot=>playedShots[i].push(shot));
      engines[i].on('menu-observed',event=>menuObserved[i]=event.state);
      engines[i].on('world',frame=>{nativeWorld[i]=frame;worldFrames[i]++;for(const entity of frame.entities){if(entity.type===22)vehicleModels[i].add(entity.state[0]);if(i===0&&entity.type===21){if(!npcHealthSamples.has(entity.id))npcHealthSamples.set(entity.id,[]);const samples=npcHealthSamples.get(entity.id);samples.push({time:Date.now(),health:entity.state[6],animation:entity.state.slice(10,30)});if(samples.length>100)samples.shift();}}windows[i].webContents.executeJavaScript(`testLobby.sendWorld(${JSON.stringify(frame)})`).catch(e=>errors.push(e.message));});
      engines[i].on('world-observed',status=>{worldObserved[i]=status;worldStatusHistory[i].push(status);});
      engines[i].on('seat-state',seat=>{localSeats[i].push(seat);if(i===0)windows[i].webContents.executeJavaScript(`testLobby.sendSeat(${JSON.stringify(seat.seat===-1?{driver:true,car:seat}:{id:seat.id})})`).catch(e=>errors.push(e.message));else if(seat.id<0 && lastGuestSeat>=0)windows[i].webContents.executeJavaScript('testLobby.sendSeat({release:true})').catch(e=>errors.push(e.message));if(i===1)lastGuestSeat=seat.id;});
      engines[i].on('seat-request',request=>windows[i].webContents.executeJavaScript(`testLobby.sendSeat(${JSON.stringify(request)})`).catch(e=>errors.push(e.message)));
      engines[i].on('driver-state',update=>{driverSamples.push(update.state);return windows[i].webContents.executeJavaScript(`testLobby.sendVehicle(${JSON.stringify(update)})`).catch(e=>errors.push(e.message));});
      const launch=()=>engines[i].start(root, { multiplayer: true, authoritativeWorld:i===0, inputDisabled:interactive&&i===1&&process.env.VT_MANUAL_HOST_ONLY==='1', testWalk: !interactive, testCombat:!interactive&&combatTest, followPlayer:autoFollow&&i===1, muted:!interactive||i===1, name: i ? 'Friend' : 'Host', fullscreen: process.env.VT_TEST_FULLSCREEN === '1',windowBounds:placements[i], fps: Number(process.env.VT_TEST_FPS ?? 144), spawnOffset: i * (interactive?4:process.env.VT_TEST_GUN==='1'?6:1.1) });
      if(registerLauncher)registerLauncher(windows[i],launch);else await launch();
    }
    timer = setInterval(async () => {
      if (forwarding) return; forwarding = true;
      try {
        for (let i = 0; i < 2; i++) {
          const meleeExpression=i===0?"window.testNpcMeleeEvents.slice(-16)":"[]";
          const data = await windows[i].webContents.executeJavaScript(`({frame:testEvents.findLast(e=>e.name==='frame')?.detail || [],shots:testEvents.filter(e=>e.name==='shot').slice(-16).map(e=>e.detail),ambient:testEvents.findLast(e=>e.name==='ambient')?.detail,seat:testEvents.findLast(e=>e.name==='seat-grant')?.detail,driver:testEvents.findLast(e=>e.name==='driver-state')?.detail,glass:testEvents.filter(e=>e.name==='glass-request').slice(-128).map(e=>e.detail),melee:${meleeExpression}})`);
          engines[i].frame(data.frame);for(const shot of data.shots)engines[i].remoteShot(shot);
          if(i===0)for(const request of data.melee||[]){const key=`${request.playerId}:${request.seq}`;if(!forwardedMelee.has(key)){forwardedMelee.add(key);engines[i].meleeGrant(request);}}
          const connected=data.frame.filter(player=>!player.self);engines[i].networkStatus({ping:connected.map(player=>player.ping).filter(Number.isFinite).reduce((max,ping)=>Math.max(max,ping),-1),transportPing:-1,peers:Math.min(7,connected.length)});
          if(data.ambient){
            if(i===1&&process.env.VT_TEST_RESET==='1'){
              if(!resetInjected&&worldObserved[1]?.seq>10){engines[i].remoteWorld({...data.ambient,seq:1000000});resetInjected=true;resetDue=Date.now()+500;resetPid=engines[i].child.pid;}
              else if(resetDue&&Date.now()>=resetDue){await engines[i].start('unused',{multiplayer:true,authoritativeWorld:false});assert.equal(engines[i].child.pid,resetPid,'Rejoin spawned another game');resetDue=null;}
              else if(resetInjected&&!resetDue&&worldObserved[1]?.seq>0&&worldObserved[1].seq<1000000&&worldObserved[1].loadedPeds+worldObserved[1].loadedVehicles>0)resetRecovered=true;
            }
            clientWorld[i]=data.ambient;engines[i].remoteWorld(data.ambient);for(const entity of data.ambient.entities){if(entity.type===22)vehicleModels[i].add(entity.state[0]);if(i===1&&entity.type===21){if(!guestNpcHealthSamples.has(entity.id))guestNpcHealthSamples.set(entity.id,[]);const samples=guestNpcHealthSamples.get(entity.id);samples.push({time:Date.now(),health:entity.state[6],animation:entity.state.slice(10,30)});if(samples.length>100)samples.shift();}}}
          if(data.seat)engines[i].seatGrant(data.seat); if(data.driver)engines[i].driverState(data.driver);
          if(i===0)for(const pane of data.glass||[]){const key=JSON.stringify(pane.slice(0,5));const previous=deliveredGlass.get(key)||0;if(pane[1]>previous){engines[i].glassRequest(pane);deliveredGlass.set(key,pane[1]);}}
        }
      } catch(e) { errors.push(e.message); } finally { forwarding = false; }
    }, 10);
    if(registerLauncher) {
      const enabled=await a.webContents.executeJavaScript("!document.getElementById('multiplayer').disabled");
      assert.ok(enabled,'Actual launcher did not enable Start after both imports were ready');
      await a.webContents.executeJavaScript("document.getElementById('multiplayer').click()");
    }
    if(process.env.VT_TEST_GUEST_FAR_WORLD==='1') {
      const deadline=Date.now()+25000;
      let host,guest,distance=0,guestWorld=null,hostWorld=null;
      while(Date.now()<deadline){
        host=local[0].at(-1)?.state;guest=local[1].at(-1)?.state;
        if(host&&guest)distance=Math.hypot(...host.slice(0,3).map((v,k)=>v-guest[k]));
        if(distance>350){guestWorld=worldStatusHistory[1].findLast(world=>world.localPopulationEnabled&&world.localAmbientPeds>0);hostWorld=worldStatusHistory[0].findLast(world=>world.localAmbientPeds>0);if(guestWorld&&hostWorld)break;}
        await delay(100);
      }
      assert.ok(distance>350,`Guest test location is not outside the host stream (${distance.toFixed(1)} m)`);
      assert.ok(guestWorld,'Distant guest did not restore local ambient NPC population');
      assert.ok(hostWorld,'Host lost its normal local NPC population while sharing the world');
      const result={success:true,scenario:'Host keeps stock population while distant guest restores local Vice City NPC and traffic population',distanceFromHostMetres:distance,hostWorld,guestWorld,localPlayerStates:[host,guest],samePC:true,internetTested:false};
      await fs.writeFile(path.join(out,'far-world.json'),JSON.stringify(result,null,2));return result;
    }
    if(process.env.VT_TEST_GUEST_NPC_SHOT==='1') {
      const deadline=Date.now()+12000;
      while((!nativeWorld[0]?.entities?.some(e=>e.type===21&&e.state[6]>0)||local[1].length<20)&&Date.now()<deadline)await delay(100);
      assert.ok(nativeWorld[0]?.entities?.some(e=>e.type===21&&e.state[6]>0),'Host has no loaded live NPC to test');
      await windows[1].webContents.executeJavaScript('testLobby.sendEquipment(17)');
      await delay(300);
      let previousHits=engines[0].diagnostics().appliedGuestHits.npc;
      for(let attempt=0;attempt<8 && engines[0].diagnostics().appliedGuestHits.npc===previousHits;attempt++) {
        const guest=local[1].at(-1)?.state,frame=nativeWorld[0];if(!guest||!frame)break;
        const targets=frame.entities.filter(e=>e.type===21&&e.state[6]>0&&e.state[8]<0).map(e=>({entity:e,distance:Math.hypot(e.state[2]-guest[0],e.state[3]-guest[1],e.state[4]-guest[2])})).filter(e=>e.distance>2&&e.distance<35).sort((a,b)=>a.distance-b.distance);
        const target=targets[attempt%Math.min(targets.length,4)]?.entity;if(!target)break;
        const before=target.state[6],origin=[guest[0],guest[1],guest[2]+1],end=[target.state[2],target.state[3],target.state[4]+0.8];
        const shot={weapon:17,source:origin,end,hit:true,normal:[0,0,1],hitKind:1};
        await windows[1].webContents.executeJavaScript(`testLobby.sendShot(${JSON.stringify(shot)})`);
        await delay(350);
        const authoritative=nativeWorld[0]?.entities.find(e=>e.type===21&&e.id===target.id),replica=clientWorld[1]?.entities.find(e=>e.type===21&&e.id===target.id);
        guestNpcShot={attempt:attempt+1,targetId:target.id,distanceMetres:targets.find(e=>e.entity.id===target.id)?.distance,healthBefore:before,hostHealth:authoritative?.state[6]??null,guestReplicaHealth:replica?.state[6]??null,hostNpcHitCount:engines[0].diagnostics().appliedGuestHits.npc};
        guestNpcShotAttempts.push({targetId:target.id,distanceMetres:guestNpcShot.distanceMetres,source:origin,end,healthBefore:before,hostHealth:guestNpcShot.hostHealth,guestReplicaHealth:guestNpcShot.guestReplicaHealth,hostNpcHitCount:guestNpcShot.hostNpcHitCount,hostNpcCount:nativeWorld[0]?.entities.filter(e=>e.type===21).length||0,worldFrameCount:worldFrames[0]});
      }
      await fs.writeFile(path.join(out,'guest-npc-shot.json'),JSON.stringify({guestNpcShot,guestNpcShotAttempts,hostPlayedShots:playedShots[0].length,guestPlayedShots:playedShots[1].length,hostDiagnostics:engines[0].diagnostics(),guestDiagnostics:engines[1].diagnostics(),guestPosition:local[1].at(-1)?.state,hostPosition:local[0].at(-1)?.state},null,2));
      assert.ok(engines[0].diagnostics().appliedGuestHits.npc>previousHits,'Host did not apply a guest shot to any native NPC after eight validated attempts');
      assert.ok(guestNpcShot?.guestReplicaHealth<guestNpcShot.healthBefore,'Guest did not receive the NPC health change from the host world snapshot');
    }
    if(process.env.VT_TEST_GUEST_NPC_MELEE==='1') {
      const deadline=Date.now()+18000;
      while((!nativeWorld[0]?.entities?.some(e=>e.type===21&&e.state[6]>0)||worldFrames[1]<12)&&Date.now()<deadline)await delay(100);
      assert.ok(nativeWorld[0]?.entities?.some(e=>e.type===21&&e.state[6]>0),'Host has no live NPC for the melee check');
      const beforeHits=engines[0].diagnostics().appliedGuestHits.npc;
      await windows[1].webContents.executeJavaScript('testLobby.sendEquipment({weapon:0,visible:false,wanted:0})');
      const hitDeadline=Date.now()+16000;
      while(engines[0].diagnostics().appliedGuestHits.npc===beforeHits&&Date.now()<hitDeadline)await delay(100);
      const requestPackets=engines[1].diagnostics().packets[47]||0;
      const hostHitCount=engines[0].diagnostics().appliedGuestHits.npc;
      await delay(500);
      const targetId=engines[1].diagnostics().lastMeleeTargetId;
      const samples=npcHealthSamples.get(targetId)||[];const beforeSample=[...samples].reverse().find(s=>s.time<(meleeRequestAt||Date.now()));const afterSample=samples.find(s=>s.time>(meleeRequestAt||0)+120);
      const syncDeadline=Date.now()+2500;let syncedTarget=null;
      while(Date.now()<syncDeadline){const hostTarget=nativeWorld[0]?.entities?.find(e=>e.type===21&&e.id===targetId);syncedTarget=clientWorld[1]?.entities?.find(e=>e.type===21&&e.id===targetId);if(hostTarget&&syncedTarget&&Math.abs(hostTarget.state[6]-syncedTarget.state[6])<0.01)break;await delay(100);}
      const hostTarget=nativeWorld[0]?.entities?.find(e=>e.type===21&&e.id===targetId);const guestTarget=clientWorld[1]?.entities?.find(e=>e.type===21&&e.id===targetId);
      const hostLobby=await windows[0].webContents.executeJavaScript("({meleeEvents:window.testNpcMeleeEvents.slice(-3),authority:[...testLobby.npcMeleeAuthority.peers.entries()],slots:[...testLobby.players.keys()]})");
      const hostBefore=meleeValidation.findLast(event=>event.stage===3&&event.targetId===targetId)?.health;const hostAfter=meleeValidation.findLast(event=>event.stage===4&&event.targetId===targetId)?.health;const guestHealthHistory=guestNpcHealthSamples.get(targetId)||[];
      const result={success:requestPackets>0&&hostHitCount>0&&Number.isFinite(hostBefore)&&Number.isFinite(hostAfter)&&hostAfter<hostBefore,scenario:'Guest melee request reaches host authority and syncs NPC damage back to the guest',requestPackets,targetId,meleeRequestAt,healthBefore:hostBefore??beforeSample?.health??null,healthAfter:hostAfter??afterSample?.health??null,guestReplicatedDamage:guestHealthHistory.some(sample=>Number.isFinite(hostAfter)&&sample.health<=hostAfter+0.01),guestHealthHistory:guestHealthHistory.slice(-8),hostNpcHitCount:hostHitCount,meleeValidation,syncedTarget:syncedTarget?{id:syncedTarget.id,health:syncedTarget.state[6],animation:syncedTarget.state.slice(10,30)}:null,hostEntityIds:nativeWorld[0]?.entities?.filter(e=>e.type===21).map(e=>e.id)||[],guestEntityIds:clientWorld[1]?.entities?.filter(e=>e.type===21).map(e=>e.id)||[],hostTargetPosition:hostTarget?.state.slice(2,5),guestTargetPosition:guestTarget?.state.slice(2,5),localPlayerPositions:local.map(samples=>samples.at(-1)?.state.slice(0,4)),hostObservedPlayers:[...engines[0].received.entries()].map(([id,p])=>({id,state:p.state.slice(0,4)})),hostLobby,worldStatus:worldStatusHistory.map(history=>history.slice(-5)),guestAmbientNpcCount:clientWorld[1]?.entities?.filter(e=>e.type===21).length||0,hostDiagnostics:engines[0].diagnostics(),guestDiagnostics:engines[1].diagnostics(),samePC:true,internetTested:false};
      await fs.writeFile(path.join(out,'guest-npc-melee.json'),JSON.stringify(result,null,2));
      assert.ok(result.success,`Guest melee did not damage a host NPC (guest type-47 packets: ${requestPackets}, host hits: ${hostHitCount})`);
      assert.ok(Number.isFinite(hostBefore)&&Number.isFinite(hostAfter)&&hostAfter<hostBefore,`Host NPC ${targetId} health did not decrease`);
      assert.ok(result.guestReplicatedDamage,'Host NPC damage did not reach a guest world snapshot');
      return result;
    }
    // Actual engine frames, input, physics, WebRTC, and remote CPed observations.
    if(interactive) {
      const deadline=Date.now()+30000;
      while(local.some(s=>s.length<30) && Date.now()<deadline && !errors.length)await delay(100);
      assert.ok(local.every(s=>s.length>=30),'Both manual-session engines did not initialize');
      await fs.writeFile(path.join(out,'manual-session.json'),JSON.stringify({ready:true,manualPlayer:'Host (red), left window',secondPlayer:'Friend (green), right window',autoFollow,pids:engines.map(e=>e.child.pid),placements,startedAt:new Date().toISOString(),limitation:'Host-owned entities use a bounded interest area. Basic guest melee and gun damage replication are verified; full NPC AI ownership, police pursuit behavior and guest driving still need work.'},null,2));
      // User controls the leader for as long as desired; closing either game ends the pair.
      while(engines.every(e=>e.child && e.child.exitCode===null) && !errors.length) {
        await delay(500);
        for(const sets of [local,remote,skeleton,performance])for(const samples of sets)if(samples.length>3000)samples.splice(0,samples.length-3000);
        await fs.writeFile(path.join(out,'manual-live.json'),JSON.stringify({worldFrames,worldObserved,remoteWeapons:skeleton.map(s=>s.at(-1)?.state.slice(13,17)),nativeShots:shots.map(s=>s.length),remoteEffectsPlayed:playedShots.map(s=>s.length),remoteBloodEvents:playedShots.map(s=>s.filter(p=>p.hit && p.hitKind===1).length),players:local.map(s=>s.at(-1)?.state),performance:performance.map(s=>s.at(-1))}));
      }
      return {success:true,interactiveManualFollow:true,automatedPadInput:false};
    }
    await delay(durationSeconds * 1000);
    if(process.env.VT_TEST_RESET==='1'){assert.ok(resetInjected&&resetRecovered,'Reused native engine failed to accept a lower world sequence and render the new population after reset');await fs.writeFile(path.join(out,'native-reset.json'),JSON.stringify({resetRecovered,pidUnchanged:engines[1].child.pid===resetPid,previousWorldSequence:1000000,freshWorldSequence:worldObserved[1]?.seq,loadedPeds:worldObserved[1]?.loadedPeds,loadedVehicles:worldObserved[1]?.loadedVehicles},null,2));}
    if(process.env.VT_TEST_MENU==='1'){
      await fs.writeFile(path.join(out,'menu-observations.json'),JSON.stringify({menuObserved,vehicleModels:vehicleModels.map(models=>[...models]),worldObserved,errors},null,2));
      assert.equal(errors.length,0,errors.join('; '));assert.ok(menuObserved.every(state=>state?.[0]===63),'Native keyboard navigation, guest cheat access or host world controls failed');assert.ok(vehicleModels.every(models=>models.has(141)),'Host-spawned Infernus did not reach both world streams');assert.ok(worldObserved.every(world=>world?.hour===22),'Host admin time did not synchronize');
      const result={success:true,scenario:'Both players open the menu and use permitted cheats; host controls shared world state',menuObserved,vehicleModels:vehicleModels.map(models=>[...models]),samePC:true,internetTested:false};await fs.writeFile(path.join(out,'native-gameplay.json'),JSON.stringify(result,null,2));return result;
    }
    if(process.env.VT_TEST_GUEST_DRIVE==='1'){
      const authority=await windows[0].webContents.executeJavaScript("({claims:[...testLobby.seats.claims.values()],motion:[...testLobby.seats.motion?.values()||[]],cars:[...testLobby.seats.cars.values()],approved:testEvents.filter(e=>e.name==='driver-state').length})");
      await fs.writeFile(path.join(out,'guest-driver-observations.json'),JSON.stringify({errors,authority,firstDriverSamples:driverSamples.slice(0,20),driverSamples:driverSamples.slice(-20),local:local.map(s=>s.slice(-20)),seats:localSeats.map(s=>s.slice(-20)),worldObserved},null,2));
      assert.equal(errors.length,0,errors.join('; '));
      const guestDriver=localSeats[1].filter(s=>s.id>=0&&s.seat===-1),hostPassenger=localSeats[0].filter(s=>s.id>=0&&s.seat>=0);
      assert.ok(guestDriver.length>100,'Guest did not become the native driver');assert.ok(hostPassenger.length>100,'Host did not become the native passenger');assert.equal(guestDriver.at(-1).id,hostPassenger.at(-1).id,'Players occupied different cars');
      const distance=local.map(samples=>{const occupied=samples.filter(s=>s.state[9]===1);assert.ok(occupied.length>30,'Player did not remain in the vehicle long enough to test motion');return Math.hypot(...occupied.at(-1).state.slice(0,3).map((v,k)=>v-occupied[0].state[k]));});
      if(process.env.VT_TEST_CAR_BLAST==='1'){
        assert.ok(worldStatusHistory.every(history=>history.some(world=>world.wreckedVehicles>=1)),'Shared wreck did not become wrecked in both engines');const respawns=local.map(samples=>{const dead=samples.find(sample=>sample.state[8]<=0),alive=dead&&samples.find(sample=>sample.time>dead.time+1000&&sample.state[8]>0);assert.ok(dead&&alive,'Both occupants must die and respawn after the shared car explosion');const distance=Math.hypot(...alive.state.slice(0,3).map((v,k)=>v-dead.state[k]));assert.ok(distance<110,'Respawn was not near the death location');return {distance,delayMs:alive.time-dead.time};});return {success:true,scenario:'Guest-driven car explosion, shared wreck and near-death respawn',worldObserved,maximumWrecks:worldStatusHistory.map(history=>Math.max(...history.map(world=>world.wreckedVehicles))),respawns,samePC:true,internetTested:false};
      }
      assert.ok(distance.every(d=>d>20),'Guest-driven car did not move both players at least twenty metres');
      const model=Number(process.env.VT_TEST_VEHICLE||130);assert.ok(driverSamples.filter(s=>Math.hypot(...s.slice(14,model===217?17:16))>0.1).length>10,'Guest vehicle did not maintain real driving / flight speed');
      const exits=localSeats.map((seats,i)=>{const entered=seats.findIndex(s=>s.id>=0);const exit=seats.findIndex((s,n)=>n>entered&&s.id<0);assert.ok(entered>=0&&exit>entered,`${i?'Guest':'Host'} did not exit the shared vehicle normally`);assert.ok(seats.slice(exit).every(s=>s.id<0),`${i?'Guest':'Host'} was silently re-seated after exiting`);return {enteredSamples:entered,exitSamples:exit};});
      return {success:true,scenario:'Guest driver and host passenger walk into a shared car, drive, and exit through stock controls',vehicleModel:model,distance,guestDriverSamples:guestDriver.length,hostPassengerSamples:hostPassenger.length,sharedVehicleId:guestDriver.at(-1).id,exits,samePC:true,internetTested:false};
    }
    if(process.env.VT_TEST_GUEST_SPAWN==='1'){
      await waitFor(()=>vehicleModels.every(models=>models.has(217)), 'Guest menu helicopter request did not produce a shared helicopter on both native clients',35000);
      assert.ok(menuObserved.some(state=>state?.[1]===0 && (state[0]&64)!==0),'Guest could not select the helicopter from their vehicle menu');
      const result={success:true,scenario:'Guest selects helicopter in native menu; host validates/spawns it near guest; both native worlds render model 217',helicopterVisible:vehicleModels.map(models=>models.has(217)),guestMenuSelection:menuObserved.find(state=>state?.[1]===0 && (state[0]&64)!==0),samePC:true,internetTested:false};
      await fs.writeFile(path.join(out,'guest-heli-spawn.json'),JSON.stringify(result,null,2));return result;
    }
    if(process.env.VT_TEST_CAR_BLAST==='1'){
      assert.equal(errors.length,0,errors.join('; '));
      const driver=localSeats[0].find(s=>s.id>=0 && s.seat===-1);
      assert.ok(driver && localSeats[1].filter(s=>s.id===driver.id && s.seat>=0).length>100,'Both players must occupy the same real car before its explosion');
      assert.ok(local[1].some(s=>s.state[8]===0),'Exploding the occupied host car did not kill the shared guest');
      assert.ok(worldObserved[1]?.seq>10,'Guest did not receive the wreck world updates');
      return {success:true,scenario:'Host blows up a native car occupied by driver and guest passenger',durationSeconds,sharedVehicleId:driver.id,guestMinimumHealth:Math.min(...local[1].map(s=>s.state[8])),freshWindowsVMTested:false};
    }
    if(process.env.VT_TEST_WORLD_EFFECTS==='1') {
      assert.ok(worldObserved.every(s=>s && s.brokenGlass>0),'The native glass pane was not invisible and non-colliding in both engines');
      assert.ok(worldObserved[0].explosionSequence>0 && worldObserved[1].explosionSequence===worldObserved[0].explosionSequence,'Guest did not replay the host explosion');
      assert.ok(local[1].some(s=>s.state[8]<100),'Host-attributed explosion did not change shared guest health');
      const result={success:true,scenario:'Native glass break and host-attributed nearby grenade',durationSeconds,automatedPadInput:false,worldObserved,guestMinimumHealth:Math.min(...local[1].map(s=>s.state[8])),freshWindowsVMTested:false};
      await fs.writeFile(path.join(out,'native-gameplay.json'),JSON.stringify(result,null,2));return result;
    }
    assert.equal(errors.length, 0, errors.join('; '));
    const players = local.map((samples, i) => {
      assert.ok(samples.length > 150, `Engine ${i} did not produce enough live player states`);
      const settled = samples.filter(s => s.time > samples[0].time + 4000);
      const xs = settled.map(s => s.state[0]), ys = settled.map(s => s.state[1]);
      const displacement = Math.hypot(Math.max(...xs)-Math.min(...xs), Math.max(...ys)-Math.min(...ys));
      if(!combatTest)assert.ok(displacement > 1, `Engine ${i} did not move under real pad input`);
      assert.ok(remote[i].length > 100, `Engine ${i} did not create and update the remote game ped`);
      const renderErrors=remote[i].map(s=>Math.hypot(...s.state.slice(0,3).map((v,k)=>v-s.state[4+k])));
      assert.ok(Math.max(...renderErrors)<0.05,`Engine ${i} visible model does not follow its network position`);
      assert.ok(remote[i].slice(20).every(s=>s.state[9]===0),`Engine ${i} opened the pause menu during the background test`);
      const upright=skeleton[i].filter(s=>s.time>samples[0].time+5000 && s.state[3]>0);
      assert.ok(upright.length>50,`Engine ${i} did not report the actual remote skeleton`);
      assert.ok(upright.every(s=>Math.abs(s.state[4]-1)<0.02 && s.state[5]<=1.01),`Engine ${i} remote animation weights can collapse the base pose`);
      const heights=upright.map(s=>Math.max(s.state[0],s.state[1]));
      // Jumping/ducking legitimately bends the source skeleton. Compare actual
      // source bone distances within the interpolation window, not standing height.
      const shapeErrors=upright.map(s=>{const recent=sourceSkeleton[1-i].filter(p=>p.time<=s.time && s.time-p.time<350 && p.state[3]>0);return recent.length?Math.min(...recent.map(p=>Math.hypot(...p.state.slice(0,3).map((v,k)=>v-s.state[k])))):null;}).filter(e=>e!==null).sort((a,b)=>a-b);
      assert.ok(shapeErrors.length>50 && shapeErrors[Math.floor(shapeErrors.length*.95)]<0.25,`Engine ${i} remote skeleton does not match actual source bones: p95 ${shapeErrors[Math.floor(shapeErrors.length*.95)]}`);
      const colored=upright.filter(s=>s.state[6]>0 && s.state[7]>0);
      assert.ok(colored.length>10 && colored.some(s=>s.state[8]>100), `Engine ${i} remote shirt recoloring was not applied during native rendering`);
      const gunAimSamples=upright.filter(s=>s.state[9]===1);
      const jumpSamples=upright.filter(s=>s.state[12]===1);
      if(process.env.VT_TEST_JUMP==='1')assert.ok(jumpSamples.length>20,`Engine ${i} did not apply jump launch/glide/landing to the remote native skeleton`);
      if(process.env.VT_TEST_GUN_WALK==='1')assert.ok(gunAimSamples.length>30,`Engine ${i} did not receive the actual source gun-aim pose`);
      // In a shared car the host owns the vehicle transform. Its passenger proxy
      // uses the current authoritative seat, while the guest's local passenger
      // rides its buffered car replica. Compare the host-side passenger to the
      // authoritative driver trajectory (including the fixed seat separation),
      // rather than treating the guest's delayed replica as authority.
      const authoritativeCarPassenger=process.env.VT_TEST_CAR==='1' && i===0;
      const source = local[authoritativeCarPassenger?0:1-i];
      const positionErrors = remote[i].filter(s => s.time > samples[0].time + 5000).map(s => {
        const recent = source.filter(p => p.time <= s.time && s.time-p.time < 350);
        return recent.length ? Math.min(...recent.map(p => Math.hypot(...p.state.slice(0,3).map((v,k) => v-s.state[k])))) : null;
      }).filter(v => v !== null).sort((a,b)=>a-b);
      assert.ok(positionErrors.length > 50, 'Missing comparable remote ped positions');
      const p95 = positionErrors[Math.floor(positionErrors.length * 0.95)];
      assert.ok(p95 < 1, `Engine ${i} ${authoritativeCarPassenger?'passenger seat distance from authoritative driver':'replication error'} exceeded one metre: ${p95}`);
      const gaps = settled.slice(1).map((s,j) => s.time-settled[j].time).sort((a,b)=>a-b);
      const gaitSamples=remote[i].filter(s=>s.state[14]>0.05 && s.state[12]>0);
      if(process.env.VT_TEST_CAR!=='1')assert.ok(gaitSamples.length>30,`Engine ${i} did not animate the actual remote ped`);
      const gaitPhaseChanges=gaitSamples.slice(1).filter((s,j)=>Math.abs(s.state[12]-gaitSamples[j].state[12])>0.005).length;
      if(process.env.VT_TEST_CAR!=='1')assert.ok(gaitPhaseChanges>20,`Engine ${i} remote locomotion is frozen`);
      const fpsSamples=performance[i].slice(4).map(p=>p.fps).sort((a,b)=>a-b);
      const actualWindow=performance[i].at(-1)?.window;
      if(actualWindow && process.env.VT_TEST_FULLSCREEN!=='1') {
        assert.ok(Math.abs(actualWindow.x-placements[i].x)<3 && Math.abs(actualWindow.y-placements[i].y)<3,'Game did not open in its assigned secondary-monitor corner');
      }
      return { livePackets: samples.length, remotePedObservations: remote[i].length, displacementMetres: displacement,
        requestedFps: Number(process.env.VT_TEST_FPS ?? 144),displayPlacement:placements[i],actualWindow, measuredMedianFps: fpsSamples[Math.floor(fpsSamples.length/2)] ?? null,
        measuredFrameMsP95: Math.max(0,...performance[i].slice(4).map(p=>p.frameMsP95)),
        remoteGaitSamples: gaitSamples.length, remoteGaitPhaseChanges: gaitPhaseChanges,
        maximumRenderPositionErrorMetres:Math.max(...renderErrors),pauseMenuObserved:remote[i].some(s=>s.state[9]===1),
        skeletonSamples:upright.length,minimumHeadToFootMetres:Math.min(...heights),maximumHeadToFootMetres:Math.max(...heights),
        coloredRemoteDraws:Math.max(0,...upright.map(s=>s.state[7])),recoloredTexturePixels:Math.max(0,...upright.map(s=>s.state[8])),
        replicatedGunAimSamples:gunAimSamples.length,
        replicatedJumpSamples:jumpSamples.length,
        closestRecentSourceSkeletonErrorP95Metres:shapeErrors[Math.floor(shapeErrors.length*.95)],
        ...(authoritativeCarPassenger?{passengerToAuthoritativeDriverDistanceP95Metres:p95}:{closestRecentPositionErrorP95Metres:p95}), statePacketGapP95Ms: gaps[Math.floor(gaps.length * .95)] };
    });
    if(combatTest) {
      assert.ok(hits[0]>1,'Actual pad-input punches did not hit the remote native ped');
      assert.ok(local[1].some(s=>s.state[8]<100),'The guest native player never received shared health damage');
      if(process.env.VT_TEST_MOVING_COMBAT==='1')assert.ok(players[1].displacementMetres>0.2,'Defender did not actually move');
    }
    if(process.env.VT_TEST_SHOTS==='1')for(let i=0;i<2;i++) {
      assert.ok(shots[i].length>5,`Engine ${i} did not fire real native shots`);
      assert.ok(playedShots[1-i].length>5,`Engine ${1-i} did not execute remote shot effects`);
      assert.ok(playedShots[1-i].every(p=>shots[i].some(s=>Math.hypot(...s.end.map((v,k)=>v-p.end[k]))<0.001)), 'Remote trace endpoint differs from the actual source shot');
    }
    const healthTransitions=local[1].slice(1).map((s,i)=>[local[1][i].state[8],s.state[8]]);
    assert.ok(worldFrames[0]>10 && worldObserved[1]?.seq>10 && worldObserved[1]?.loadedPeds>0,'Guest did not load host-owned native ambient entities');
    if(process.env.VT_TEST_CAR==='1'){
      assert.ok(players.every(p=>p.displacementMetres>25),'Driver/passenger did not travel at least 25 metres in the shared car');
      assert.ok(localSeats[0].filter(s=>s.id>=0 && s.seat===-1).length>100,'Host did not drive a real native vehicle');
      assert.ok(localSeats[1].filter(s=>s.id>=0 && s.seat>=0).length>100,'Guest did not occupy a real native passenger seat');
      assert.equal(localSeats[0].at(-1).id,localSeats[1].at(-1).id,'Players rode different shared vehicle identities');
      const driverId=localSeats[0].at(-1).id;
      assert.ok(localSeats.every(seats=>seats.slice(-200).every(s=>s.id===driverId)),'A player lost the shared car during the drive');
    }
    return { success: true, durationSeconds, players,launchedFromActualUIButton:!!registerLauncher,combatTest,guestNpcShot, movingDefenderFixture:combatTest&&process.env.VT_TEST_MOVING_COMBAT==='1',nativeHits:hits,nativeShots:shots.map(s=>s.length),remoteShotEffects:playedShots.map(s=>s.length), guestMinimumHealth:Math.min(...local[1].map(s=>s.state[8])),guestDeaths:healthTransitions.filter(([a,b])=>a>0&&b===0).length,guestRespawns:healthTransitions.filter(([a,b])=>a===0&&b===100).length, importedAssetCacheTested: !!importTest, importedFileCount: importTest?.gameFiles || null, automatedPadInput: true,
      transport: 'Two native reVC engines → loopback bridge → two sandboxed Chromium contexts → real Trystero WebRTC → remote CPeds',
      limitation: 'Same-PC prototype. Closest recent position metric allows up to 350 ms lag and does not prove visual smoothness. Basic guest melee and gun damage now reach the host NPC and return its health/animation snapshot; full NPC AI ownership, police pursuit behavior, cross-internet combat and a fresh Windows installation remain unverified.' };
  } finally {
    clearInterval(timer); stopping = true; engines.forEach(e=>e.stop());
    await fs.writeFile(path.join(out, 'native-game-samples.json'), JSON.stringify({ local, remote, skeleton,sourceSkeleton,localSeats,worldFrames,worldObserved, performance, errors, diagnostics,hits,shots,playedShots }));
  }
}
module.exports = { runNativeGameTest };
