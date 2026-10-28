const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { NativeEngine } = require('./native-engine.cjs');
const { VEHICLE_MODELS, VEHICLE_CLASSES } = require('../engine/vehicle-spawn.cjs');
const delay = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(check,message,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await delay(100);}throw new Error(message);}
async function runNativeGameTest({ a, b, executable, out,registerLauncher }) {
  const testProgress=[];
  const progress=async stage=>{testProgress.push({stage,time:new Date().toISOString()});await fs.writeFile(path.join(out,'native-game-test-progress.json'),JSON.stringify(testProgress,null,2));};
  await progress('start');
  let gameRoot = process.env.VT_TEST_GAME_ROOT;
  if (!gameRoot) throw new Error('Set VT_TEST_GAME_ROOT to your own Vice City asset folder for the native gameplay test.');
  await progress('game-root-available');
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
  const networkDelayPerDirectionMs=Math.max(0,Math.min(250,Number(process.env.VT_TEST_NETWORK_DELAY_MS)||0));
  const networkJitterAmplitudeMs=Math.max(0,Math.min(100,Number(process.env.VT_TEST_NETWORK_JITTER_MS)||0));
  for(let i=0;i<windows.length;i++){try{await windows[i].webContents.executeJavaScript("window.testVehicleSpawnApprovals=[];window.testAmbientReceived=0;testLobby.addEventListener('vehicle-spawn-approved',event=>{const request=event.detail,sample=testLobby.states.get(request.requester);window.testVehicleSpawnApprovals.push({...request,requesterState:sample?.state?.slice(0,10)??null,requesterStateTime:sample?.time??null})});testLobby.addEventListener('ambient',()=>window.testAmbientReceived++)");await progress(`lobby-instrumented-window-${i}`);}catch(error){await fs.writeFile(path.join(out,'native-game-test-setup-error.json'),JSON.stringify({window:i,error:error.stack},null,2));throw error;}}
  await windows[0].webContents.executeJavaScript("window.testSeatAcceptance=[];const originalAcceptSeat=testLobby.acceptSeat.bind(testLobby);testLobby.acceptSeat=function(id,request){const carId=Number.isSafeInteger(request?.id)?request.id:Number.isSafeInteger(request?.car?.id)?request.car.id:-1,player=this.states.get(id),car=this.seats.cars.get(carId),claimBefore=this.seats.claims.get(id)||null;const result=originalAcceptSeat(id,request);if(window.testSeatAcceptance.length<500)window.testSeatAcceptance.push({time:performance.now(),driver:request?.driver===true,release:request?.release===true,carId,playerTime:player?.time??null,playerState:player?.state?.slice(0,10)??null,vehicle:car?{model:car[0],position:car.slice(2,5),health:car[17],capacity:car[22],wrecked:this.seats.wrecks.has(carId)}:null,claimBefore,claimAfter:this.seats.claims.get(id)||null});return result};void 0");
  try{await windows[0].webContents.executeJavaScript("window.testAmbientSent=0;const originalSendWorld=testLobby.sendWorld.bind(testLobby);testLobby.sendWorld=frame=>{window.testAmbientSent++;return originalSendWorld(frame)};void 0");await progress('lobby-instrumented');}catch(error){await fs.writeFile(path.join(out,'native-game-test-setup-error.json'),JSON.stringify({window:0,stage:'world-send-instrumentation',error:error.stack},null,2));throw error;}
  for(const window of windows)await window.webContents.executeJavaScript("window.testNpcMeleeEvents=[];window.testAcceptedDriverStates=[];window.testReceivedDriverStates=[];window.testAcceptedVehicleDoors=[];window.testNativeDriverStates=[];window.testNativeVehicleDoors=[];window.testDriverFlow={fastSendCalls:0,fastSendFailures:0,reliableSendCalls:0,fastInbound:0,reliableInbound:0,duplicateSequences:0};const originalFastSend=testLobby.fast.send.bind(testLobby.fast);testLobby.fast.send=(peer,kind,value)=>{if(kind==='driver')window.testDriverFlow.fastSendCalls++;const sent=originalFastSend(peer,kind,value);if(kind==='driver'&&!sent)window.testDriverFlow.fastSendFailures++;return sent};const originalReliableSend=testLobby.vehicleInput.send.bind(testLobby.vehicleInput);testLobby.vehicleInput.send=(...args)=>{window.testDriverFlow.reliableSendCalls++;return originalReliableSend(...args)};const originalVehicleMessage=testLobby.vehicleInput.onMessage;const receivedSequences=new Map();testLobby.vehicleInput.onMessage=(update,meta)=>{if(meta?.realtime)window.testDriverFlow.fastInbound++;else window.testDriverFlow.reliableInbound++;if(Number.isSafeInteger(update?.seq)){const previous=receivedSequences.get(meta?.peerId)||0;if(update.seq<=previous)window.testDriverFlow.duplicateSequences++;else receivedSequences.set(meta?.peerId,update.seq)}return originalVehicleMessage(update,meta)};testLobby.addEventListener('npc-melee',event=>window.testNpcMeleeEvents.push(event.detail));testLobby.addEventListener('vehicle-doors',event=>{window.testAcceptedVehicleDoors.push({time:Date.now(),...event.detail});window.testNativeVehicleDoors.push(event.detail);if(window.testAcceptedVehicleDoors.length>2000)window.testAcceptedVehicleDoors.shift()});testLobby.addEventListener('driver-state',event=>{const sample={time:Date.now(),arrival:performance.now(),...event.detail};window.testAcceptedDriverStates.push(sample);window.testReceivedDriverStates.push(sample);window.testNativeDriverStates.push(event.detail);if(window.testAcceptedDriverStates.length>2000)window.testAcceptedDriverStates.shift();if(window.testReceivedDriverStates.length>2000)window.testReceivedDriverStates.shift()})");
  if(networkDelayPerDirectionMs>0||networkJitterAmplitudeMs>0)for(const window of windows)await window.webContents.executeJavaScript(`(()=>{const fast=testLobby.fast,original=fast.send.bind(fast),latency=fast.latency.bind(fast);let sequence=0;fast.send=(peer,kind,data)=>{if(!['movement','players','driver'].includes(kind))return original(peer,kind,data);const entry=fast.peers.get(peer),channel=entry?.channel;if(!entry?.confirmed||!channel||channel.readyState!=='open'||!fast.kinds.has(kind))return original(peer,kind,data);const packet=JSON.stringify({v:1,kind,seq:++entry.sequence,data});if(packet.length>30000)return false;if(channel.bufferedAmount>32768){entry.dropped++;return true;}const phase=((sequence++*73)%101)/100,jitter=(phase*2-1)*${networkJitterAmplitudeMs},delay=Math.max(0,${networkDelayPerDirectionMs}+jitter);entry.sent++;setTimeout(()=>{if(channel.readyState==='open'){try{channel.send(packet);}catch{}}},delay);return true;};fast.latency=peer=>({...latency(peer),rttMs:${networkDelayPerDirectionMs*2},latestRttMs:${networkDelayPerDirectionMs*2},p50Ms:${networkDelayPerDirectionMs*2},p95Ms:${networkDelayPerDirectionMs*2},jitterMs:${networkJitterAmplitudeMs*2}});return true})()`);
  if(process.env.VT_TEST_CAPTURE_PROJECTION==='1')for(const window of windows)await window.webContents.executeJavaScript("window.testProjectionTelemetry=[];const dispatch=testLobby.frameDispatch,send=dispatch.send.bind(dispatch);dispatch.send=()=>{send();if(!testLobby.isHost||window.testProjectionTelemetry.length>=5000)return;const viewer=testLobby.hostId,remoteId=[...testLobby.players.keys()].find(id=>id!==viewer),sample=remoteId&&testLobby.states.get(remoteId);if(!sample)return;const rtt=testLobby.fast?.latency(remoteId)?.rttMs,route=Number.isFinite(rtt)?Math.max(0,Math.min(300,rtt))/2+35:35,frame=window.testEvents.findLast(event=>event.name==='frame')?.detail||[],projected=frame.find(player=>player.id===remoteId)?.state;window.testProjectionTelemetry.push({now:performance.now(),wallNow:Date.now(),sampleTime:sample.time,sourceTime:sample.sourceTime??null,sourceInterval:sample.sourceTime-sample.previousSourceTime,age:performance.now()-sample.time,rtt,route,raw:sample.state.slice(0,3),previous:sample.previousState?.slice(0,3)||null,interval:sample.time-sample.previousTime,projected:projected?.slice(0,3)||null,move:sample.state[7]})};void 0");
  for(const window of windows)await window.webContents.executeJavaScript("window.testLocalDriverCalls=0;window.testLocalDriverAccepted=0;window.testLocalDriverRejected=0;window.testLocalDriverEvents=0;window.testLocalDriverFallbacks=0;window.testOriginalSendVehicle=testLobby.sendVehicle.bind(testLobby);testLobby.sendVehicle=function(update){window.testLocalDriverCalls++;const sampledUpdate={...update,testSentAt:Date.now()};const queued=window.testOriginalSendVehicle(sampledUpdate);if(queued)window.testLocalDriverAccepted++;else window.testLocalDriverRejected++;return queued};if(window.desktop?.on)window.desktop.on('local-driver-state',()=>{window.testLocalDriverEvents++});void 0");
  for(const window of windows)await window.webContents.executeJavaScript("window.testPlayerHitEvents=[];testLobby.addEventListener('player-hit',event=>{window.testPlayerHitEvents.push(event.detail);if(window.testPlayerHitEvents.length>128)window.testPlayerHitEvents.shift()});void 0");
  const durationSeconds = Math.max(10, Math.min(180, Number(process.env.VT_TEST_DURATION) || (process.env.VT_TEST_GUEST_DRIVE==='1'?55:30)));
  const interactive=process.env.VT_MANUAL_FOLLOW==='1';
  const autoFollow=interactive && process.env.VT_MANUAL_BOTH!=='1';
  const combatTest=process.env.VT_TEST_COMBAT==='1',hits=[0,0],playerHitEvents=[[],[]],playerHitApplications=[[],[]];
  const hitAnimation=id=>Number.isInteger(id)&&id>=25&&id<=45;
  const diagnostics=[],meleeValidation=[],skeleton=[[],[]],shots=[[],[]],playedShots=[[],[]];
  const sourceSkeleton=[[],[]];
  const worldFrames=[0,0],worldObserved=[null,null],nativeWorld=[null,null],clientWorld=[null,null];
  let guestNpcShot=null;const guestNpcShotAttempts=[];let meleeRequestAt=null;const npcHealthSamples=new Map(),guestNpcHealthSamples=new Map();
  const worldStatusHistory=[[],[]],worldStatusTimeline=[[],[]],hostVehicleSamples=[];
  const menuObserved=[null,null],menuObservedAt=[null,null],vehicleModels=[new Set(),new Set()];
  const guestSpawnRequests=[],hostSpawnApprovals=[],hostSpawnResults=[];let heliRequestSentAt=null,heliLobbyRequest=null,heliRequestPath='';
  const launchRequests=[0,0];
  const seatDiagnostics=[null,null],driverFlow=[null,null],seatGrantCalls=[0,0],lastSeatGrantEventCount=[0,0],seatRequests=[[],[]];
  const seatTaskDiagnostics=[[],[]];
  let heliHostPassengerSetup=null;
  const driverSamples=[];const localSeats=[[],[]];let lastGuestSeat=-1,lastHostSeat=-1,lastHostSeatIndex=-2;
  const forwardedDriverCounts=[0,0];
  const nativeDoorEvents=[[],[]],forwardedDoorUpdates=[];
  const deliveredGlass=new Map(),forwardedMelee=new Set();
  const placements=[0,1].map(i=>require('./display.cjs').gameWindow(i));
  const local = [[], []], remote = [[], []], performance = [[], []], errors = [];
  let timer, forwarding = false, stopping = false;
  let resetInjected=false,resetDue=null,resetPid=null,resetRecovered=false;
  const forwardEngineEvent=(index,name,payload,fallback)=>{
    if(registerLauncher)windows[index].webContents.send(name,payload);
    else windows[index].webContents.executeJavaScript(fallback).catch(error=>errors.push(error.message));
  };
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
      await progress(`game-copy-ready-${i}`);
      engines[i].on('problem', text => errors.push(text));
      engines[i].on('seat-task-diagnostic',event=>{seatTaskDiagnostics[i].push({time:Date.now(),...event});if(seatTaskDiagnostics[i].length>1200)seatTaskDiagnostics[i].shift();});
      engines[i].on('packet-diagnostic',packet=>diagnostics.push({player:i,...packet}));
      engines[i].on('melee-validation',event=>meleeValidation.push(event));
      engines[i].on('ended', ({code}) => { if(!stopping) errors.push(`Engine ${i} exited before test completion (code ${code})`); });
      engines[i].on('state', state => {
        local[i].push({ time: Date.now(), state });
        forwardEngineEvent(i,'local-state',state,`testLobby.sendState(${JSON.stringify(state)})`);
      });
      engines[i].on('world-damage',event=>forwardEngineEvent(i,'local-world-damage',event,`testLobby.sendWorldDamage(${JSON.stringify(event)})`));
      engines[i].on('glass-request',state=>forwardEngineEvent(i,'local-glass-request',state,`testLobby.sendGlass(${JSON.stringify(state)})`));
      engines[i].on('melee-request',request=>{meleeRequestAt??=Date.now();forwardEngineEvent(i,'local-melee-request',request,`testLobby.sendNpcMeleeRequest(${JSON.stringify(request)})`);});
      engines[i].on('remote-observed', state => remote[i].push({ time: Date.now(), ...state }));
      engines[i].on('skeleton-observed', state => skeleton[i].push({ time: Date.now(), ...state }));
      engines[i].on('local-skeleton-observed',state=>sourceSkeleton[i].push({time:Date.now(),...state}));
      engines[i].on('performance', stats => performance[i].push({...stats,time:Date.now()}));
      engines[i].on('hit', hit=>{hits[i]++;forwardEngineEvent(i,'local-hit',hit,`testLobby.sendHit(${JSON.stringify(hit)})`);});
      engines[i].on('equipment',weapon=>forwardEngineEvent(i,'local-equipment',weapon,`testLobby.sendEquipment(${JSON.stringify(weapon)})`));
      engines[i].on('shot',shot=>{shots[i].push(shot);forwardEngineEvent(i,'local-shot',shot,`testLobby.sendShot(${JSON.stringify(shot)})`);});
      engines[i].on('shot-played',shot=>playedShots[i].push(shot));
      engines[i].on('menu-observed',event=>{menuObserved[i]=event.state;if(i===1&&event.state?.[1]===0&&(event.state[0]&64)!==0)menuObservedAt[i]=Date.now();});
      engines[i].on('world',frame=>{const time=Date.now();nativeWorld[i]=frame;worldFrames[i]++;for(const entity of frame.entities){if(entity.type===22){vehicleModels[i].add(entity.state[0]);if(i===0){hostVehicleSamples.push({time,id:entity.id,state:entity.state,visual:entity.visual||null});if(hostVehicleSamples.length>5000)hostVehicleSamples.shift();}}if(i===0&&entity.type===21){if(!npcHealthSamples.has(entity.id))npcHealthSamples.set(entity.id,[]);const samples=npcHealthSamples.get(entity.id);samples.push({time,health:entity.state[6],animation:entity.state.slice(10,30)});if(samples.length>100)samples.shift();}}forwardEngineEvent(i,'local-world',frame,`testLobby.sendWorld(${JSON.stringify(frame)})`);});
      engines[i].on('world-observed',status=>{worldObserved[i]=status;worldStatusHistory[i].push(status);worldStatusTimeline[i].push({time:Date.now(),...status});if(worldStatusTimeline[i].length>2000)worldStatusTimeline[i].shift();});
      engines[i].on('seat-state',seat=>{localSeats[i].push({...seat,time:Date.now()});if(registerLauncher){windows[i].webContents.send('local-seat-state',seat);return;}if(i===0&&(seat.id!==lastHostSeat||seat.seat!==lastHostSeatIndex)){if(seat.id<0&&lastHostSeat>=0)windows[i].webContents.executeJavaScript('testLobby.sendSeat({release:true})').catch(e=>errors.push(e.message));else if(seat.id>=0&&seat.seat===-1)windows[i].webContents.executeJavaScript(`testLobby.sendSeat(${JSON.stringify({driver:true,car:seat})})`).catch(e=>errors.push(e.message));else if(seat.id>=0&&seat.seat>=0)windows[i].webContents.executeJavaScript(`testLobby.sendSeat(${JSON.stringify({id:seat.id})})`).catch(e=>errors.push(e.message));lastHostSeat=seat.id;lastHostSeatIndex=seat.seat;}else if(i===1&&seat.id<0&&lastGuestSeat>=0)windows[i].webContents.executeJavaScript('testLobby.sendSeat({release:true})').catch(e=>errors.push(e.message));if(i===1)lastGuestSeat=seat.id;});
      engines[i].on('seat-request',request=>{seatRequests[i].push({time:Date.now(),...request});if(seatRequests[i].length>200)seatRequests[i].shift();if(registerLauncher)windows[i].webContents.send('local-seat-request',request);else windows[i].webContents.executeJavaScript(`testLobby.sendSeat(${JSON.stringify(request)})`).catch(e=>errors.push(e.message));});
      engines[i].on('vehicle-spawn-request',model=>{
        if(registerLauncher){windows[i].webContents.send('local-vehicle-spawn-request',model);return;}
        windows[i].webContents.executeJavaScript(`testLobby.sendVehicleSpawnRequest(${JSON.stringify(model)})`).then(sent=>guestSpawnRequests.push({model,sent,time:Date.now()})).catch(e=>errors.push(e.message));
      });
      engines[i].on('driver-state',update=>{driverSamples.push({...update,player:i,time:Date.now()});if(driverSamples.length>5000)driverSamples.shift();windows[i].webContents.send('local-driver-state',update);if(!registerLauncher)windows[i].webContents.executeJavaScript(`testLobby.sendVehicle(${JSON.stringify(update)})`).catch(e=>errors.push(e.message));});
      engines[i].on('vehicle-doors',update=>{nativeDoorEvents[i].push({time:Date.now(),...update});if(nativeDoorEvents[i].length>2000)nativeDoorEvents[i].shift();windows[i].webContents.send('local-vehicle-doors',update);if(!registerLauncher&&i===1)windows[i].webContents.executeJavaScript(`testLobby.sendVehicleDoors(${JSON.stringify(update)})`).catch(e=>errors.push(e.message));});
      const launch=()=>{launchRequests[i]++;const userGuest=process.env.VT_MANUAL_USER_GUEST==='1';return engines[i].start(root, { multiplayer: true, authoritativeWorld:i===0, inputDisabled:interactive&&i===1&&process.env.VT_MANUAL_HOST_ONLY==='1', testWalk: !interactive, testCombat:!interactive&&combatTest, followPlayer:autoFollow&&i===1, muted:!interactive||(userGuest?i===0:i===1), name: i ? 'Friend' : 'Host', fullscreen: process.env.VT_TEST_FULLSCREEN === '1',windowBounds:placements[i], fps: Number(process.env.VT_TEST_FPS ?? 144), spawnOffset: i * (interactive?4:process.env.VT_TEST_GUN==='1'?6:1.1), userDir:path.join(root,'userfiles') });};
      if(registerLauncher)registerLauncher(windows[i],launch,i===0?update=>{forwardedDriverCounts[0]++;engines[0].driverState(update);}:update=>{forwardedDriverCounts[1]++;engines[1].driverState(update);},i===0?update=>{forwardedDoorUpdates.push({time:Date.now(),...update});engines[0].driverDoors(update);}:null,i===0?request=>engines[0].spawnVehicle(request):null);else await launch();
      await progress(`engine-start-requested-${i}`);
    }
    timer = setInterval(async () => {
      if (forwarding) return; forwarding = true;
      try {
        for (let i = 0; i < 2; i++) {
          const meleeExpression=i===0?"window.testNpcMeleeEvents.slice(-16)":"[]";
        const data = await windows[i].webContents.executeJavaScript(`({frame:testEvents.findLast(e=>e.name==='frame')?.detail || [],shots:testEvents.filter(e=>e.name==='shot').slice(-16).map(e=>e.detail),ambient:testEvents.findLast(e=>e.name==='ambient')?.detail,seat:testEvents.findLast(e=>e.name==='seat-grant')?.detail,spawnApprovals:${i===0?'window.testVehicleSpawnApprovals.splice(0,16)':'[]'},seatDiagnostics:(()=>{const l=window.testLobby;const self=[...l.players].find(([,p])=>p.id===l.selfId)?.[0];const local=l.states.get(self);const grants=window.testEvents.filter(e=>e.name==='seat-grant');return {self,lobbySelfId:l.selfId,isHost:l.isHost,hostId:l.hostId,players:[...l.players.entries()],lastSeatGrant:grants.at(-1)?.detail||null,seatGrantCount:grants.length,local:local?{state:local.state,time:local.time}:null,states:[...l.states.entries()].map(([id,s])=>({id,state:s.state,time:s.time})),cars:[...l.seats.cars.entries()].map(([id,s])=>({id,model:s[0],class:s[1],position:s.slice(2,5),health:s[17],capacity:s[22]})),claims:[...l.seats.claims.entries()],npcs:[...l.seats.npcs],wrecks:[...l.seats.wrecks]}})(),glass:testEvents.filter(e=>e.name==='glass-request').slice(-128).map(e=>e.detail),driverStates:window.testNativeDriverStates.splice(0,128),vehicleDoors:${i===0?'window.testNativeVehicleDoors.splice(0,128)':'[]'},melee:${meleeExpression}})`);
           data.driverFlow=await windows[i].webContents.executeJavaScript("({...window.testDriverFlow,localEvents:window.testLocalDriverEvents,localCalls:window.testLocalDriverCalls,localAccepted:window.testLocalDriverAccepted,localRejected:window.testLocalDriverRejected,localFallbacks:window.testLocalDriverFallbacks})");
           seatDiagnostics[i]=data.seatDiagnostics;driverFlow[i]=data.driverFlow;
          const playerHits=await windows[i].webContents.executeJavaScript('window.testPlayerHitEvents.splice(0,32)');
          engines[i].frame(data.frame);for(const shot of data.shots)engines[i].remoteShot(shot);
          for(const hit of playerHits||[]){const applied=hit.selfTarget===true?engines[i].playerHit(hit):false;playerHitEvents[i].push({time:Date.now(),...hit});if(hit.selfTarget===true)playerHitApplications[i].push({time:Date.now(),attacker:hit.attacker,target:hit.target,weapon:hit.weapon,damage:hit.damage,applied});}
          if(i===0)for(const request of data.spawnApprovals||[]){hostSpawnApprovals.push({...request,time:Date.now()});const accepted=engines[0].spawnVehicle(request);const result={model:request?.model,accepted,time:Date.now()};hostSpawnResults.push(result);if(!accepted){errors.push(`Host native engine rejected approved vehicle spawn request for model ${request?.model}`);await fs.writeFile(path.join(out,'vehicle-spawn-rejected.json'),JSON.stringify({request,result,bridge:{authoritativeWorld:engines[0].authoritativeWorld,socketBound:!!engines[0].socket?.address(),endpoint:engines[0].endpoint,modelAllowed:VEHICLE_MODELS.includes(request?.model),positionValid:Array.isArray(request?.position)&&request.position.length===3&&request.position.every(Number.isFinite),position:request?.position,heading:request?.heading},engineDiagnostics:engines.map(engine=>engine.diagnostics()),lobby:await Promise.all(windows.map(window=>window.webContents.executeJavaScript("({host:testLobby.isHost,players:[...testLobby.players.keys()],states:[...testLobby.states.entries()].map(([id,s])=>({id,time:s.time,state:s.state.slice(0,10)}))})")))},null,2));}}
          if(!registerLauncher)for(const update of data.driverStates||[]){forwardedDriverCounts[i]++;engines[i].driverState(update);}
          if(i===0)for(const update of data.vehicleDoors||[]){forwardedDoorUpdates.push({time:Date.now(),...update});engines[0].driverDoors(update);}
          if(i===0)for(const request of data.melee||[]){const key=`${request.playerId}:${request.seq}`;if(!forwardedMelee.has(key)){forwardedMelee.add(key);engines[i].meleeGrant(request);}}
          const connected=data.frame.filter(player=>!player.self);engines[i].networkStatus({ping:connected.map(player=>player.ping).filter(Number.isFinite).reduce((max,ping)=>Math.max(max,ping),-1),transportPing:-1,peers:Math.min(7,connected.length)});
          if(data.ambient){
            if(i===1&&process.env.VT_TEST_RESET==='1'){
              if(!resetInjected&&worldObserved[1]?.seq>10){engines[i].remoteWorld({...data.ambient,seq:1000000});resetInjected=true;resetDue=Date.now()+500;resetPid=engines[i].child.pid;}
              else if(resetDue&&Date.now()>=resetDue){await engines[i].start('unused',{multiplayer:true,authoritativeWorld:false});assert.equal(engines[i].child.pid,resetPid,'Rejoin spawned another game');resetDue=null;}
              else if(resetInjected&&!resetDue&&worldObserved[1]?.seq>0&&worldObserved[1].seq<1000000&&worldObserved[1].loadedPeds+worldObserved[1].loadedVehicles>0)resetRecovered=true;
            }
            clientWorld[i]=data.ambient;engines[i].remoteWorld(data.ambient);for(const entity of data.ambient.entities){if(entity.type===22)vehicleModels[i].add(entity.state[0]);if(i===1&&entity.type===21){if(!guestNpcHealthSamples.has(entity.id))guestNpcHealthSamples.set(entity.id,[]);const samples=guestNpcHealthSamples.get(entity.id);samples.push({time:Date.now(),health:entity.state[6],animation:entity.state.slice(10,30)});if(samples.length>100)samples.shift();}}}
          const grantCount=data.seatDiagnostics?.seatGrantCount??0;
          if(data.seat&&grantCount>lastSeatGrantEventCount[i]){lastSeatGrantEventCount[i]=grantCount;seatGrantCalls[i]++;engines[i].seatGrant(data.seat);}
          if(i===0)for(const pane of data.glass||[]){const key=JSON.stringify(pane.slice(0,5));const previous=deliveredGlass.get(key)||0;if(pane[1]>previous){engines[i].glassRequest(pane);deliveredGlass.set(key,pane[1]);}}
        }
      } catch(e) { errors.push(e.message); } finally { forwarding = false; }
    }, 10);
    if(registerLauncher) {
      const enabled=await a.webContents.executeJavaScript("!document.getElementById('multiplayer').disabled");
      assert.ok(enabled,'Actual launcher did not enable Start after both imports were ready');
      await a.webContents.executeJavaScript("document.getElementById('multiplayer').click()");
      try{await waitFor(()=>launchRequests.every(count=>count>0),'The launcher did not invoke both native game launch handlers',12000);}
      catch(error){
        const ui=await Promise.all(windows.map(window=>window.webContents.executeJavaScript("({sessionStarted:testLobby.sessionStarted,host:testLobby.isHost,ready:testLobby.ready,players:[...testLobby.players.values()].map(p=>({name:p.name,ready:p.ready,host:p.host})),notice:document.getElementById('notice')?.textContent||''})")));
        await fs.writeFile(path.join(out,'native-launch-diagnostics.json'),JSON.stringify({error:error.message,launchRequests,ui,engineDiagnostics:engines.map(engine=>engine.diagnostics())},null,2));
        throw error;
      }
      await progress('native-launch-handlers-completed');
    }
    if(process.env.VT_TEST_GUEST_DRIVE==='1'&&Number(process.env.VT_TEST_VEHICLE)===217){
      await waitFor(()=>windows[0].webContents.executeJavaScript("[...testLobby.seats.cars.values()].some(car=>car[0]===217)"),'Helicopter never entered the host seat authority for the pilot/passenger check',30000);
      const candidate=await windows[0].webContents.executeJavaScript("(()=>{const host=[...testLobby.players].find(([,p])=>p.host)?.[0],player=host&&testLobby.states.get(host);if(!player)return null;const current=testLobby.seats.claims.get(host);if(current?.seat>=0)return {id:current.id,seat:current.seat,preexisting:true};const cars=[...testLobby.seats.cars.entries()].filter(([,car])=>car[0]===217&&car[22]>0).map(([id,car])=>({id,distance:Math.hypot(...player.state.slice(0,3).map((v,k)=>v-car[k+2]))})).sort((a,b)=>a.distance-b.distance);return cars[0]||null})()");
      assert.ok(candidate&&candidate.distance<=9||candidate?.preexisting,`Host was not close enough to reserve a helicopter passenger seat: ${JSON.stringify(candidate)}`);
      const heliSeatRequestAt=Date.now();
      if(!candidate.preexisting)await windows[0].webContents.executeJavaScript(`testLobby.sendSeat({id:${candidate.id}})`);
      await waitFor(()=>windows[0].webContents.executeJavaScript(`(()=>{const host=[...testLobby.players].find(([,p])=>p.host)?.[0],claim=host&&testLobby.seats.claims.get(host);return claim?.id===${candidate.id}&&claim.seat>=0})()`),'Host could not claim an available helicopter passenger seat for the two-player flight test',5000);
      try {
        // A native passenger grant starts Vice City's stock approach/door task;
        // 5 seconds was too short for that task on helicopters and reported a
        // false failure while the host was still walking to the seat.
        await waitFor(()=>localSeats[0].some(sample=>sample.id===candidate.id&&sample.seat>=0),'Native host did not finish the helicopter passenger entry task',30000);
      } catch (error) {
        const hostState=await windows[0].webContents.executeJavaScript("(()=>{const host=[...testLobby.players].find(([,p])=>p.host)?.[0];const claim=host&&testLobby.seats.claims.get(host);return {claim,player:host&&testLobby.states.get(host)?.state,cars:[...testLobby.seats.cars.entries()].filter(([,car])=>car[0]===217).map(([id,car])=>({id,position:car.slice(2,5),capacity:car[22],health:car[17]}))}})()");
        await fs.writeFile(path.join(out,'heli-seat-entry-failure.json'),JSON.stringify({error:error.message,hostState,heliSeatRequestAt,nativeSeatSamples:localSeats[0].slice(-60),hostPedSamples:sourceSkeleton[0].slice(-60).map(sample=>({time:sample.time,state:sample.state.slice(4,7),position:sample.state.slice(17,20),vehicleAnimation:sample.state.slice(11,15),doors:sample.state.slice(20,26)})),nativeSeatTaskSchema:['pedState','objective','previousObjective','door','enteringCar','vehicleAnimationId','animationTime','animationBlend','animationBlendDelta','objectiveVehicleModel','objectiveVehicleId','currentVehicleModel','inVehicle','currentVehicleId','pedStateTimerRemainingMs','gettingInFlags','numGettingIn','passenger0PedId','passenger1PedId','driverPedId','doorMissing','doorReady','doorFullyOpen','doorAngle','playerX','playerY','playerZ','vehicleX','vehicleY','vehicleZ','playerVehicleDistance','usesCollision','maxPassengers','pedStateTimer'],nativeSeatTaskSamplesAfterRequest:seatTaskDiagnostics[0].filter(sample=>sample.time>=heliSeatRequestAt).slice(0,100),nativeSeatTaskSamples:seatTaskDiagnostics[0].slice(-80),hostWorldStatus:worldStatusTimeline[0].slice(-60),hostPerformance:performance[0].slice(-20),samePC:true,internetTested:false},null,2));
        throw error;
      }
      const passengerSeat=await windows[0].webContents.executeJavaScript(`testLobby.seats.claims.get([...testLobby.players].find(([,p])=>p.host)?.[0])?.seat`);
      const heliBoardingSamples=sourceSkeleton[0].filter(sample=>!candidate.preexisting&&sample.time>=heliSeatRequestAt&&sample.state[4]===58&&sample.state[6]===0&&sample.state[12]>=0&&sample.state[14]>.05);
      assert.ok(candidate.preexisting||heliBoardingSamples.length>0,'Helicopter passenger entered without an observed native align/enter animation');
      heliHostPassengerSetup={vehicleId:candidate.id,distanceMetres:candidate.distance??null,seat:passengerSeat,stockBoardingAnimationObserved:heliBoardingSamples.length>0,boardingAnimationSamples:heliBoardingSamples.length,trigger:'hidden test harness uses the same host lobby seat request as G near a vehicle'};
      if(process.env.VT_TEST_HELI_PASSENGER_ONLY==='1'){
        assert.ok(local[0].length>30&&local[1].length>30,'Both native game clients must be live before the helicopter passenger check');
        await delay(1200);
        const passengerSeatSamples=localSeats[0].filter(sample=>sample.id===candidate.id&&sample.seat===passengerSeat);
        // VT_ReadLocalSkeleton has no vehicle-ID field; index 29 is unused in
        // local samples. Match its native in-vehicle flag to the seat packet
        // for this exact vehicle instead of comparing against an unpopulated slot.
        const hostInVehicleSamples=sourceSkeleton[0].filter(sample=>sample.time>=heliSeatRequestAt&&sample.state[6]===1&&passengerSeatSamples.some(seat=>Math.abs(seat.time-sample.time)<=100)).length;
        const result={success:true,scenario:'Two hidden native clients, host passenger completes the stock helicopter entry animation and remains attached to the reserved seat',vehicleId:candidate.id,seat:passengerSeat,distanceMetres:candidate.distance??null,stockBoardingAnimationObserved:heliBoardingSamples.length>0,boardingAnimationSamples:heliBoardingSamples.length,passengerSeatSamples:passengerSeatSamples.length,passengerSeatSpanMs:passengerSeatSamples.length>1?passengerSeatSamples.at(-1).time-passengerSeatSamples[0].time:0,hostInVehicleSamples,localClientFrames:local.map(samples=>samples.length),samePC:true,internetTested:false};
        assert.ok(result.passengerSeatSamples>=10&&result.passengerSeatSpanMs>=700&&result.hostInVehicleSamples>=10,'The host did not remain attached to the helicopter passenger seat for at least 700 ms after the stock boarding animation');
        await fs.writeFile(path.join(out,'heli-passenger-entry.json'),JSON.stringify(result,null,2));
        return result;
      }
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
    // Spawn/rejoin verification needs its observations after the request. The old
    // generic 30-second soak ran first, leaving only a few seconds to judge the
    // helicopter that the test requested at the end.
    if(process.env.VT_TEST_GUEST_SPAWN!=='1')await delay(durationSeconds * 1000);
    if(process.env.VT_TEST_RESET==='1'&&process.env.VT_TEST_GUEST_SPAWN!=='1'){assert.ok(resetInjected&&resetRecovered,'Reused native engine failed to accept a lower world sequence and render the new population after reset');await fs.writeFile(path.join(out,'native-reset.json'),JSON.stringify({resetRecovered,pidUnchanged:engines[1].child.pid===resetPid,previousWorldSequence:1000000,freshWorldSequence:worldObserved[1]?.seq,loadedPeds:worldObserved[1]?.loadedPeds,loadedVehicles:worldObserved[1]?.loadedVehicles},null,2));}
    if(process.env.VT_TEST_MENU==='1'){
      await fs.writeFile(path.join(out,'menu-observations.json'),JSON.stringify({menuObserved,vehicleModels:vehicleModels.map(models=>[...models]),worldObserved,errors},null,2));
      assert.equal(errors.length,0,errors.join('; '));assert.ok(menuObserved.every(state=>state?.[0]===63),'Native keyboard navigation, guest cheat access or host world controls failed');assert.ok(vehicleModels.every(models=>models.has(141)),'Host-spawned Infernus did not reach both world streams');assert.ok(worldObserved.every(world=>world?.hour===22),'Host admin time did not synchronize');
      const result={success:true,scenario:'Both players open the menu and use permitted cheats; host controls shared world state',menuObserved,vehicleModels:vehicleModels.map(models=>[...models]),samePC:true,internetTested:false};await fs.writeFile(path.join(out,'native-gameplay.json'),JSON.stringify(result,null,2));return result;
    }
    if(process.env.VT_TEST_GUEST_DRIVE==='1'){
      const authority=await windows[0].webContents.executeJavaScript("({claims:[...testLobby.seats.claims.values()],motion:[...testLobby.seats.motion?.values()||[]],vehicleStats:testLobby.seats.vehicleStats,cars:[...testLobby.seats.cars.values()],accepted:window.testAcceptedDriverStates.length,lastAccepted:window.testAcceptedDriverStates.slice(-3),fast:testLobby.fast.report()})");
      const seatTrace=localSeats.map(seats=>seats.filter((sample,index)=>index===0||sample.id!==seats[index-1].id||sample.seat!==seats[index-1].seat));
      const driverVehicleCounts=Object.entries(driverSamples.reduce((counts,sample)=>(counts[sample.id]=(counts[sample.id]||0)+1,counts),{}));
      const acceptedDoors=await windows[0].webContents.executeJavaScript('window.testAcceptedVehicleDoors');
      const playerAnimAndDoor=sourceSkeleton.map(samples=>samples.slice(-100).map(sample=>({time:sample.time,vehicleState:sample.state.slice(4,15),doors:sample.state.slice(20,26)})));
      const seatAcceptance=await windows[0].webContents.executeJavaScript('window.testSeatAcceptance.slice(-150)');
      const heliSamples=hostVehicleSamples.filter(sample=>VEHICLE_CLASSES[sample.state[0]]==='helicopter').map(sample=>({time:sample.time,id:sample.id,model:sample.state[0],position:sample.state.slice(2,5),health:sample.state[17],status:sample.state[19],playerDriver:sample.state[20],velocity:sample.state.slice(14,17),visualStatus:sample.visual?.[31]??null}));
      const diagnosticBase={errors,authority,forwardedDriverCounts,driverFlow,seatGrantCalls,lastSeatGrantEventCount,seatRequests:seatRequests.map(requests=>requests.slice(-50)),seatAcceptance,nativeDoorEvents:nativeDoorEvents.map(events=>events.slice(-100)),forwardedDoorUpdates:forwardedDoorUpdates.slice(-100),firstDriverSamples:driverSamples.slice(0,20),driverSamples:driverSamples.slice(-5000),driverVehicleCounts,hostVehicleSamples:hostVehicleSamples.slice(-5000),heliTimeline:{first:heliSamples.slice(0,50),last:heliSamples.slice(-50)},nativeWorldVehicleModels:vehicleModels.map(models=>[...models].sort((a,b)=>a-b)),nativeWorldFrameCounts:worldFrames,seatDiagnostics,heliHostPassengerSetup,local:local.map(s=>s.slice(-20)),seats:localSeats.map(s=>s.slice(-20)),seatTrace,worldObserved,worldStatusHistory:worldStatusHistory.map(history=>history.slice(-1000)),worldStatusTimeline:worldStatusTimeline.map(history=>history.slice(-1000)),performance:performance.map(samples=>samples.slice(-300)),acceptedVehicleDoorSamples:acceptedDoors,playerAnimAndDoor};
      await fs.writeFile(path.join(out,'guest-driver-observations.json'),JSON.stringify(diagnosticBase,null,2));
      assert.equal(errors.length,0,errors.join('; '));
      const guestDriver=localSeats[1].filter(s=>s.id>=0&&s.seat===-1),hostPassenger=localSeats[0].filter(s=>s.id>=0&&s.seat>=0);
      assert.ok(guestDriver.length>100,'Guest did not become the native driver');
      const acceptedDriverSamples=await windows[0].webContents.executeJavaScript('window.testAcceptedDriverStates');
      assert.ok(acceptedDriverSamples.length>100,'Host did not accept the guest’s authorized car state');
      assert.ok(forwardedDriverCounts[0]>100,'Accepted guest-driver updates did not reach the host native game process');
      assert.ok(acceptedDriverSamples.some(sample=>sample.visual?.length===34),'Guest driver wheel, door and damage visuals did not reach the host');
      const vehicleId=guestDriver.at(-1).id;
      const capacitySample=hostVehicleSamples.find(sample=>sample.id===vehicleId&&Number.isFinite(sample.state[22]));
      assert.ok(capacitySample,'Host did not publish the test vehicle seat capacity');
      const passengerCapacity=capacitySample.state[22],hasPassengerSeat=passengerCapacity>0;
      if(hasPassengerSeat){assert.ok(hostPassenger.length>100,'Host did not become the native passenger');assert.equal(guestDriver.at(-1).id,hostPassenger.at(-1).id,'Players occupied different cars');}
      else assert.equal(hostPassenger.length,0,'A player entered a vehicle that reports no passenger seats');
      const hostExitAttempt=worldStatusHistory[0].findLast(world=>world.hostExitRequested);
      const collisionTested=process.env.VT_TEST_VEHICLE_COLLISION==='1';
      const collisionDamageSeen=acceptedDriverSamples.some(sample=>sample.state[17]<999.9||sample.visual?.slice(25,31).some(value=>value>0));
      Object.assign(diagnosticBase,{hostExitAttempt,collisionTested,collisionDamageSeen});
      const driverIntervals=acceptedDriverSamples.slice(1).map((sample,index)=>(sample.arrival??sample.time)-(acceptedDriverSamples[index].arrival??acceptedDriverSamples[index].time)).sort((a,b)=>a-b);
      const driverIntervalP50Ms=driverIntervals[Math.floor(driverIntervals.length*0.5)],driverIntervalP95Ms=driverIntervals[Math.floor(driverIntervals.length*0.95)];
      // Packets emitted before the native seat claim reaches the host, and
      // packets after a wreck/exit, are expected to fail the seat-or-car
      // authorization check. Measure transport loss only after removing those
      // ineligible packets; keep all other rejections in the denominator.
      const ineligiblePackets=authority.vehicleStats?.rejected?.['seat-or-car']||0;
      const eligiblePackets=Math.max(0,(authority.vehicleStats?.received||0)-ineligiblePackets);
      const driverAcceptanceRatio=eligiblePackets?authority.vehicleStats.accepted/eligiblePackets:0;
      const unexpectedVehicleWreck=acceptedDriverSamples.some(sample=>sample.state?.[17]<=0||sample.state?.[19]===5);
      const injectedDriverJitterMs=Math.max(0,Math.min(100,Number(process.env.VT_TEST_NETWORK_JITTER_MS)||0)),driverIntervalP50LimitMs=10+injectedDriverJitterMs,driverIntervalP95LimitMs=16+injectedDriverJitterMs;
      diagnosticBase.driverSampling={acceptedCount:acceptedDriverSamples.length,driverIntervalP50Ms,driverIntervalP95Ms,driverIntervalP50LimitMs,driverIntervalP95LimitMs,driverAcceptanceRatio,eligiblePackets,ineligiblePackets,unexpectedVehicleWreck,authority:authority.vehicleStats,fast:authority.fast};
      await fs.writeFile(path.join(out,'guest-driver-observations.json'),JSON.stringify(diagnosticBase,null,2));
      assert.ok(driverIntervalP50Ms<=driverIntervalP50LimitMs && driverIntervalP95Ms<=driverIntervalP95LimitMs,`Host driver snapshot timing exceeded its measured target: p50 ${driverIntervalP50Ms}/${driverIntervalP50LimitMs} ms, p95 ${driverIntervalP95Ms}/${driverIntervalP95LimitMs} ms`);
      assert.ok(driverAcceptanceRatio>=0.9,`Host dropped too many valid driver snapshots: ${(driverAcceptanceRatio*100).toFixed(1)}% accepted`);
      if(!collisionTested)assert.equal(unexpectedVehicleWreck,false,'The vehicle wrecked during a clean sync run; collision/damage needs a separate controlled test');
      if(process.env.VT_TEST_CAR_BLAST==='1'){
        assert.ok(worldStatusHistory.every(history=>history.some(world=>world.wreckedVehicles>=1)),'Shared wreck did not become wrecked in both engines');const respawns=local.map(samples=>{const dead=samples.find(sample=>sample.state[8]<=0),alive=dead&&samples.find(sample=>sample.time>dead.time+1000&&sample.state[8]>0);assert.ok(dead&&alive,'Both occupants must die and respawn after the shared car explosion');const distance=Math.hypot(...alive.state.slice(0,3).map((v,k)=>v-dead.state[k]));assert.ok(distance<110,'Respawn was not near the death location');return {distance,delayMs:alive.time-dead.time};});return {success:true,scenario:'Guest-driven car explosion, shared wreck and near-death respawn',worldObserved,maximumWrecks:worldStatusHistory.map(history=>Math.max(...history.map(world=>world.wreckedVehicles))),respawns,samePC:true,internetTested:false};
      }
      const model=Number(process.env.VT_TEST_VEHICLE||130),vehicleClass=VEHICLE_CLASSES[model]||'unknown',expectedType=({car:0,bike:1,boat:2,helicopter:3,plane:4})[vehicleClass];
      assert.equal(acceptedDriverSamples[0].state[1],expectedType,`Model ${model} was constructed as the wrong native vehicle class; expected ${vehicleClass}`);
      const vehicleDriverSamples=driverSamples.filter(sample=>sample.id===vehicleId);
      const movingSpeedFloor=collisionTested?0.1:(({bike:0.02,boat:0.05,helicopter:0.1,plane:0.1,car:0.5})[vehicleClass]??0.1);
      const movingDriverSamples=vehicleDriverSamples.filter(sample=>Math.hypot(...sample.state.slice(14,vehicleClass==='helicopter'||vehicleClass==='plane'?17:16))>movingSpeedFloor);
      assert.ok(movingDriverSamples.length>10,`Guest did not stream enough moving ${vehicleClass} snapshots above ${movingSpeedFloor} m/s`);
      const guestCarTravel=Math.hypot(...vehicleDriverSamples.at(-1).state.slice(2,5).map((v,k)=>v-vehicleDriverSamples[0].state[k+2]));
      assert.ok(guestCarTravel>20,`Guest-driven car only moved ${guestCarTravel.toFixed(1)} m`);
      const planarSpeedFloor=({bike:0.02,boat:0.04,helicopter:0.08,plane:0.08,car:0.1})[vehicleClass]??0.05;
      assert.ok(movingDriverSamples.filter(s=>Math.hypot(...s.state.slice(14,vehicleClass==='helicopter'||vehicleClass==='plane'?17:16))>planarSpeedFloor).length>10,`Guest ${vehicleClass} did not maintain measurable native movement`);
      const hostCarSamples=hostVehicleSamples.filter(sample=>sample.id===vehicleId);
      assert.ok(hostCarSamples.length>10,'Host did not capture the same car during the drive');
      const hostCarTravel=Math.hypot(...hostCarSamples.at(-1).state.slice(2,5).map((v,k)=>v-hostCarSamples[0].state[k+2]));
      assert.ok(hostCarTravel>20,`Host’s copy of the shared car only moved ${hostCarTravel.toFixed(1)} m`);
      const exits=localSeats.map((seats,i)=>{const entered=seats.findIndex(s=>s.id>=0);const exit=seats.findIndex((s,n)=>n>entered&&s.id<0);return {player:i?'Guest':'Host',expected:i===1||hasPassengerSeat,enteredSamples:entered,exitSamples:exit,exited:entered>=0&&exit>entered,reseated:exit>entered&&!seats.slice(exit).every(s=>s.id<0)};});
      const carStart=guestDriver[0].time,carEnd=guestDriver.at(-1).time;
      const remoteSeatStates=skeleton.map((samples,i)=>{const expectedSeat=i===0||!hasPassengerSeat?-1:0;const visible=remote[i].filter(sample=>sample.time>=carStart+500&&sample.time<=carEnd-500);const visibleCount=visible.filter(sample=>sample.state[7]>32).length;if(i===1&&!hasPassengerSeat)return {expectedSeat,samples:0,attachedSamples:0,attachmentRatio:1,visibleSamples:visible.length,visibleRatio:visible.length?visibleCount/visible.length:0};const segment=samples.filter(sample=>sample.time>=carStart+500&&sample.time<=carEnd-500&&sample.state[30]===vehicleId);const correct=segment.filter(sample=>sample.state[27]===1&&sample.state[28]===1&&sample.state[29]===vehicleId&&sample.state[31]===expectedSeat&&sample.state[32]===expectedSeat&&sample.state[33]===expectedSeat);return {expectedSeat,samples:segment.length,attachedSamples:correct.length,attachmentRatio:segment.length?correct.length/segment.length:0,visibleSamples:visible.length,visibleRatio:visible.length?visibleCount/visible.length:0};});
      const motionTimeline=worldStatusTimeline[0].filter(sample=>sample.time>=carStart&&sample.time<=carEnd),motionStart=motionTimeline[0],motionEnd=motionTimeline.at(-1);
      const driverMotion={statusSamples:motionTimeline.length,interpolatedFrames:motionStart&&motionEnd?motionEnd.driverMotionFrames-motionStart.driverMotionFrames:0,driverPackets:motionStart&&motionEnd?motionEnd.driverMotionPackets-motionStart.driverMotionPackets:0,framesPerPacket:motionStart&&motionEnd?(motionEnd.driverMotionFrames-motionStart.driverMotionFrames)/Math.max(1,motionEnd.driverMotionPackets-motionStart.driverMotionPackets):0,observedHz:motionStart&&motionEnd?(motionEnd.driverMotionFrames-motionStart.driverMotionFrames)*1000/Math.max(1,motionEnd.time-motionStart.time):0};
      const guestDriverSnapshots=acceptedDriverSamples.filter(sample=>sample.id===vehicleId&&Number.isFinite(sample.time)).sort((a,b)=>(a.testSentAt??a.time)-(b.testSentAt??b.time));
      const matchedCarSamples=[];let snapshotCursor=0;
      for(const host of hostVehicleSamples.filter(sample=>sample.id===vehicleId&&sample.time>=carStart+1000&&sample.time<=carEnd-1000).sort((a,b)=>a.time-b.time)){
        const snapshotTime=sample=>Number.isFinite(sample?.testSentAt)?sample.testSentAt:sample?.time;
        while(snapshotCursor+1<guestDriverSnapshots.length&&snapshotTime(guestDriverSnapshots[snapshotCursor+1])<host.time)snapshotCursor++;
        const before=guestDriverSnapshots[snapshotCursor],after=guestDriverSnapshots[snapshotCursor+1],beforeTime=snapshotTime(before),afterTime=snapshotTime(after);
        if(!before||!after||beforeTime>host.time||afterTime<host.time||afterTime-beforeTime>125)continue;
        const bracketMs=afterTime-beforeTime,ratio=(host.time-beforeTime)/Math.max(1,bracketMs),lerp=(a,b)=>a.map((value,index)=>value+(b[index]-value)*ratio),state=lerp(before.state,after.state);
        const positionErrorMetres=Math.hypot(...state.slice(2,5).map((value,index)=>value-host.state[index+2]));
        const basisErrors=[0,3,6].map(offset=>Math.hypot(...state.slice(5+offset,8+offset).map((value,index)=>value-host.state[5+offset+index])));
        const turnSpeedError=Math.hypot(...state.slice(23,26).map((value,index)=>value-host.state[23+index]));
        matchedCarSamples.push({id:vehicleId,bracketMs,sourceTimeAligned:Number.isFinite(before.testSentAt)&&Number.isFinite(after.testSentAt),positionErrorMetres,basisError:Math.max(...basisErrors),turnSpeedError,healthError:Math.abs(state[17]-host.state[17]),driverHealth:state[17],hostHealth:host.state[17],driverStatus:state[19],hostStatus:host.visual?.[31]??null});
      }
      assert.ok(matchedCarSamples.length>10,'Host did not publish enough car samples to compare against the guest driver');
      const positionErrors=matchedCarSamples.map(sample=>sample.positionErrorMetres).sort((a,b)=>a-b),basisErrors=matchedCarSamples.map(sample=>sample.basisError).sort((a,b)=>a-b),turnSpeedErrors=matchedCarSamples.map(sample=>sample.turnSpeedError).sort((a,b)=>a-b),healthErrors=matchedCarSamples.map(sample=>sample.healthError).sort((a,b)=>a-b);
      const carReplication={matchedSamples:matchedCarSamples.length,driverIntervalP50Ms,driverIntervalP95Ms,positionErrorP95Metres:positionErrors[Math.floor(positionErrors.length*.95)],basisErrorP95:basisErrors[Math.floor(basisErrors.length*.95)],turnSpeedErrorP95:turnSpeedErrors[Math.floor(turnSpeedErrors.length*.95)],healthErrorP95:healthErrors[Math.floor(healthErrors.length*.95)],maximumSnapshotBracketMs:Math.max(...matchedCarSamples.map(sample=>sample.bracketMs)),recent:matchedCarSamples.slice(-12)};
      await fs.writeFile(path.join(out,'guest-driver-observations.json'),JSON.stringify({...diagnosticBase,guestCarTravel,hostCarTravel,movingDriverSamples:movingDriverSamples.slice(-5000),matchedCarSamples:matchedCarSamples.slice(-5000),acceptedDriverSampleCount:acceptedDriverSamples.length,acceptedDriverSamples:acceptedDriverSamples.slice(-5000),carReplication},null,2));
      assert.ok(carReplication.positionErrorP95Metres<1,`Host car transform lagged the guest driver by ${carReplication.positionErrorP95Metres.toFixed(2)} m at p95 after timestamp alignment`);
      assert.ok(carReplication.basisErrorP95<0.35,`Host car orientation disagreed with the guest driver by ${carReplication.basisErrorP95.toFixed(3)} at p95`);
      assert.ok(carReplication.turnSpeedErrorP95<0.75,`Host car rotation velocity disagreed with the guest driver by ${carReplication.turnSpeedErrorP95.toFixed(3)} at p95`);
      assert.ok(carReplication.healthErrorP95<=1,`Host vehicle health disagreed with the guest driver by ${carReplication.healthErrorP95.toFixed(1)} at p95`);
      const carPerformance=performance.map((samples,i)=>{const segment=samples.filter(sample=>sample.time>=carStart&&sample.time<=carEnd);assert.ok(segment.length>5,`Engine ${i} did not report performance during the shared-car drive`);const fps=segment.map(sample=>sample.fps).sort((a,b)=>a-b);const p95=segment.map(sample=>sample.frameMsP95).sort((a,b)=>a-b);const result={minFps:fps[0],p10Fps:fps[Math.floor(fps.length*.1)],medianFps:fps[Math.floor(fps.length/2)],below100FpsSamples:fps.filter(value=>value<100).length,frameMsP95P95:p95[Math.floor(p95.length*.95)],samples:segment.length};assert.ok(result.medianFps>120,`Engine ${i} median FPS dropped below 120 during the shared-car drive: ${result.medianFps}`);assert.ok(result.frameMsP95P95<16.7,`Engine ${i} p95 frame time exceeded 16.7 ms during the shared-car drive: ${result.frameMsP95P95}`);return result;});
      const vehicleAnimationSamples=sourceSkeleton.map(samples=>samples.filter(sample=>sample.time>=carStart&&sample.time<=carEnd&&sample.state[6]===1&&sample.state[12]>=0&&sample.state[14]>.05));
      const vehicleAnimationIds=vehicleAnimationSamples.map(samples=>[...new Set(samples.map(sample=>sample.state[12]))]);
      const hostPedStates=sourceSkeleton[0].filter(sample=>sample.time>=carStart&&sample.time<=carEnd).map(sample=>({pedState:sample.state[4],objective:sample.state[5],inVehicle:sample.state[6],driver:sample.state[8]}));
      const openDoorSamples=acceptedDoors.filter(sample=>sample.doors.some(angle=>Math.abs(angle)>0.04));
      const hostOpenDoorSamples=hostVehicleSamples.filter(sample=>sample.id===vehicleId&&sample.visual?.slice(19,25).some(angle=>Math.abs(angle)>0.04));
      const rotorMotion=vehicleClass==='helicopter'?worldStatusTimeline.map((timeline,i)=>{const samples=timeline.filter(sample=>sample.time>=carStart&&sample.time<=carEnd&&sample.heliRotorModel===model&&Number.isFinite(sample.heliRotorRotation));const rates=[];for(let n=1;n<samples.length;n++){let delta=samples[n].heliRotorRotation-samples[n-1].heliRotorRotation;while(delta>Math.PI)delta-=Math.PI*2;while(delta< -Math.PI)delta+=Math.PI*2;const elapsed=(samples[n].time-samples[n-1].time)/1000;if(elapsed>0)rates.push(Math.abs(delta)/elapsed);}rates.sort((a,b)=>a-b);const totalRadians=rates.reduce((sum,rate)=>sum+rate,0)*(samples.length>1?(samples.at(-1).time-samples[0].time)/1000/Math.max(1,rates.length):0);return {client:i?'guest':'host',samples:samples.length,medianRadiansPerSecond:rates[Math.floor(rates.length/2)]??0,totalObservedRadians:totalRadians};}):null;
      const wheelMotion=vehicleClass==='car'||vehicleClass==='bike'?(()=>{const visuals=acceptedDriverSamples.filter(sample=>sample.visual?.length===34).map(sample=>sample.visual.slice(3,vehicleClass==='bike'?5:7));const ranges=visuals[0]?.map((_,wheel)=>{const values=visuals.map(sample=>sample[wheel]);return Math.max(...values)-Math.min(...values);})||[];return {samples:visuals.length,rotationRanges:ranges};})():null;
      const vehicleResult={success:false,scenario:`Guest ${vehicleClass} driver and ${hasPassengerSeat?'host passenger':'on-foot host'} replicate the vehicle; available occupants exit`,vehicleModel:model,vehicleClass,passengerCapacity,guestVehicleTravelMetres:guestCarTravel,hostVehicleTravelMetres:hostCarTravel,guestDriverSamples:guestDriver.length,hostPassengerSamples:hostPassenger.length,acceptedDriverStates:acceptedDriverSamples.length,sharedVehicleId:vehicleId,heliHostPassengerSetup,rotorMotion,wheelMotion,exits,remoteSeatStates,carReplication,driverMotion,carPerformance,vehicleAnimationSamples:vehicleAnimationSamples.map(samples=>samples.length),vehicleAnimationIds,hostPedStates:hostPedStates.slice(-20),vehicleDoorSamples:acceptedDoors.length,openDoorSamples:openDoorSamples.length,hostOpenDoorSamples:hostOpenDoorSamples.length,doorAnimationTested:vehicleClass==='car',maximumDoorAngle:Math.max(0,...acceptedDoors.flatMap(sample=>sample.doors.map(Math.abs))),collisionTested,collisionDamageSeen,movingPassengerExit:hostExitAttempt?{tested:true,speed:hostExitAttempt.hostExitSpeed,driverStillSeated:hostExitAttempt.hostExitWithDriver}:{tested:false},samePC:true,internetTested:false};
      await fs.writeFile(path.join(out,'vehicle-scenario.json'),JSON.stringify(vehicleResult,null,2));
      assert.ok(exits.every(exit=>!exit.expected||exit.exited),`${exits.filter(exit=>exit.expected&&!exit.exited).map(exit=>`${exit.player} did not exit the shared vehicle normally`).join('; ')}`);
      assert.ok(exits.every(exit=>!exit.reseated),`${exits.filter(exit=>exit.reseated).map(exit=>`${exit.player} was silently re-seated after exiting`).join('; ')}`);
      assert.ok(vehicleAnimationSamples[1].length>10&&(!hasPassengerSeat||vehicleAnimationSamples[0].length>10),'An occupied vehicle seat did not play a native in-vehicle animation');
      assert.ok(remoteSeatStates.every((state,i)=>i===1&&!hasPassengerSeat?state.visibleSamples>10&&state.visibleRatio>=0.98:state.samples>10&&state.attachmentRatio>=0.98&&state.visibleRatio>=0.98),`A remote player left the rendered seat or ghosted while riding: ${JSON.stringify(remoteSeatStates)}`);
      if(vehicleClass==='helicopter')assert.ok(rotorMotion.every(result=>result.samples>=8&&result.totalObservedRadians>1&&result.medianRadiansPerSecond>=5&&result.medianRadiansPerSecond<=35),`Helicopter rotor did not animate at a stable native rate on both clients: ${JSON.stringify(rotorMotion)}`);
      if(vehicleClass==='car'||vehicleClass==='bike')assert.ok(wheelMotion.samples>10&&wheelMotion.rotationRanges.some(range=>range>0.1),`Moving ${vehicleClass} did not replicate visible wheel rotation: ${JSON.stringify(wheelMotion)}`);
      if(vehicleClass==='car')assert.ok(openDoorSamples.length>0,'Host received no open/close door animation samples for the car');
      if(vehicleClass==='car')assert.ok(hostOpenDoorSamples.length>0,'Host native game did not apply the remote car door angle');
      if(collisionTested)assert.ok(collisionDamageSeen,'The controlled car-to-barrier collision did not replicate car damage or health to the host');
      if(!collisionTested&&hasPassengerSeat&&['car','bike'].includes(vehicleClass))assert.ok(hostExitAttempt?.hostExitWithDriver&&hostExitAttempt.hostExitSpeed>0.32,`Host passenger exit was not tested in the stock moving jump-out window while the guest was driving (native speed ${hostExitAttempt?.hostExitSpeed??'unknown'})`);
      if(!collisionTested&&hasPassengerSeat&&['boat','helicopter','plane'].includes(vehicleClass))assert.ok(hostExitAttempt&&hostExitAttempt.hostExitSpeed<0.1,`Host aircraft/boat passenger did not exit at a safe stop (native speed ${hostExitAttempt?.hostExitSpeed??'unknown'})`);
      vehicleResult.success=true;
      await fs.writeFile(path.join(out,'vehicle-scenario.json'),JSON.stringify(vehicleResult,null,2));
      return vehicleResult;
    }
    if(process.env.VT_TEST_GUEST_SPAWN==='1'){
      await waitFor(()=>windows[0].webContents.executeJavaScript(`(()=>{const guest=[...testLobby.players.keys()].find(id=>id!==testLobby.hostId);const sample=guest&&testLobby.states.get(guest);return !!sample&&performance.now()-sample.time<1500&&sample.state?.[8]>0&&sample.state?.[9]===0})()`),'Host did not receive a fresh, living guest position for a vehicle request',15000);
      // A lobby can be authenticated before the native process has emitted its
      // first local UDP packet. Do not approve a vehicle while the host bridge
      // still has no destination endpoint; that creates a timing-only rejection.
      await waitFor(()=>engines.every(engine=>engine.socket&&Number.isInteger(engine.endpoint)&&engine.endpoint>0),'Both native game bridges did not become ready before the vehicle request',20000);
      if(process.env.VT_TEST_RESET==='1'){
        await waitFor(()=>resetInjected&&resetRecovered,'Guest did not finish its in-process world rejoin before the helicopter request',20000);
        await fs.writeFile(path.join(out,'native-reset.json'),JSON.stringify({resetRecovered,pidUnchanged:engines[1].child.pid===resetPid,previousWorldSequence:1000000,freshWorldSequence:worldObserved[1]?.seq,loadedPeds:worldObserved[1]?.loadedPeds,loadedVehicles:worldObserved[1]?.loadedVehicles},null,2));
      }
      const heliBaselineCounts=worldStatusHistory.map(history=>history.at(-1)?.testHelicopters?.count);
      assert.ok(heliBaselineCounts.every(Number.isFinite),'Native clients did not report their pre-request helicopter counts');
      const nativeRequestStart=guestSpawnRequests.length;
      try{await waitFor(()=>guestSpawnRequests.length>nativeRequestStart,'Native guest menu did not emit a helicopter request',12000);}catch{}
      const nativeRequest=guestSpawnRequests.find(request=>request.model===217);
      if(nativeRequest){
        heliRequestPath='native guest menu -> local bridge -> authenticated lobby -> host engine';
        heliLobbyRequest=nativeRequest.sent;
        heliRequestSentAt=nativeRequest.time;
      }else{
        // Some bundled game builds predate the menu test hook. Exercise the same
        // authenticated lobby action used by the menu rather than reporting a
        // false vehicle-spawn failure caused by missing test-only key injection.
        heliRequestPath='guest lobby spawn action (menu hook unavailable in this native executable)';
        heliRequestSentAt=Date.now();
        heliLobbyRequest=await windows[1].webContents.executeJavaScript('testLobby.sendVehicleSpawnRequest(217)');
      }
      assert.equal(heliLobbyRequest,true,'Guest lobby did not accept the helicopter request');
      await waitFor(()=>hostSpawnResults.some(result=>result.model===217),'Host did not approve and forward the guest helicopter request',12000);
      assert.equal(hostSpawnResults.findLast(result=>result.model===217)?.accepted,true,'Host native engine rejected the approved helicopter request');
      const heliApproval=hostSpawnApprovals.findLast(request=>request.model===217);
      const requesterState=heliApproval?.requesterState;
      const approvalClearance=requesterState&&Array.isArray(heliApproval.position)?Math.hypot(heliApproval.position[0]-requesterState[0],heliApproval.position[1]-requesterState[1]):null;
      assert.ok(heliApproval&&requesterState,'Host approval did not retain the fresh guest position used to calculate helicopter placement');
      assert.ok(approvalClearance>=12,`Host approval placed the helicopter ${approvalClearance} m from the requester; minimum is 12 m`);
      const samplesForClient=i=>worldStatusTimeline[i].filter(sample=>sample.time>=heliRequestSentAt&&sample.testHelicopters?.nearest.model===217&&Math.hypot(sample.testHelicopters.nearest.position[0]-heliApproval.position[0],sample.testHelicopters.nearest.position[1]-heliApproval.position[1])<=4);
      try{await waitFor(()=>samplesForClient(0).length>0&&samplesForClient(1).length>0,'The approved helicopter did not appear at safe player-level height in both native game worlds',35000);}
      catch(error){
        const lobbyState=await Promise.all(windows.map(window=>window.webContents.executeJavaScript("({isHost:testLobby.isHost,hostId:testLobby.hostId,players:[...testLobby.players.keys()],states:[...testLobby.states.entries()].map(([id,s])=>({id,time:s.time,state:s.state.slice(0,10)})),sessionStarted:testLobby.sessionStarted})")));
        const lobbyFlow=await Promise.all(windows.map(window=>window.webContents.executeJavaScript("({testAmbientReceived,ambientSequence:testLobby.ambientSequence,ambientEvents:testEvents.filter(e=>e.name==='ambient').length,lastAmbientSeq:testEvents.findLast(e=>e.name==='ambient')?.detail?.seq??null,sentWorldCount:window.testAmbientSent??0,fast:testLobby.fast.report(),connectionPhase:testLobby.connectionPhase()})")));
        await fs.writeFile(path.join(out,'guest-heli-spawn-diagnostics.json'),JSON.stringify({requestPath:heliRequestPath,heliLobbyRequest,heliRequestSentAt,heliApproval,approvalClearanceMetres:approvalClearance,heliBaselineCounts,guestSpawnRequests,hostSpawnApprovals,hostSpawnResults,menuObserved,menuObservedAt,worldStatusTimeline:worldStatusTimeline.map(history=>history.slice(-40)),nearbyHostVehicleTimeline:hostVehicleSamples.filter(sample=>sample.state[0]===217&&Math.hypot(sample.state[2]-heliApproval.position[0],sample.state[3]-heliApproval.position[1])<=12).slice(-120).map(sample=>({time:sample.time,id:sample.id,position:sample.state.slice(2,5),health:sample.state[17]})),models:vehicleModels.map(models=>[...models]),worldFrames,enginePackets:engines.map(engine=>engine.diagnostics().packets),lobbyState,lobbyFlow,errors:error.message},null,2));
        throw error;
      }
      const collectClearanceSamples=()=>[0,1].flatMap(i=>samplesForClient(i).map(sample=>{const heli=sample.testHelicopters.nearest;return {client:i?'guest':'host',time:sample.time,id:heli.id,horizontalDistance:Math.hypot(heli.position[0]-requesterState[0],heli.position[1]-requesterState[1]),verticalDistance:heli.position[2]-requesterState[2],groundClearance:heli.position[2]-heli.groundZ,groundZ:heli.groundZ,requesterPosition:requesterState.slice(0,3),vehiclePosition:heli.position,health:heli.health,rotorRotation:heli.rotorRotation,rotorSpeed:heli.rotorSpeed,status:heli.status,engineOn:heli.engineOn};}));
      let nativeClearanceSamples=collectClearanceSamples();
      // The native status reports the most recent spawn stage separately from
      // the last successfully created vehicle. A later duplicate/busy request
      // must not erase proof that the approved helicopter was rendered.
      const hostCreatedSpawn=worldStatusTimeline[0].findLast(sample=>sample.time>=heliRequestSentAt&&sample.testSpawn?.createdModel===217&&sample.testSpawn.createdHasRenderObject&&sample.testSpawn.createdVehicleId>=0&&Number.isFinite(sample.testSpawn.groundZ)&&Math.abs(sample.testSpawn.createdZ-sample.testSpawn.groundZ-1.0)<=2.5);
      if(!hostCreatedSpawn)await fs.writeFile(path.join(out,'guest-heli-spawn-diagnostics.json'),JSON.stringify({requestPath:heliRequestPath,heliLobbyRequest,heliRequestSentAt,heliApproval,hostSpawnResults,requesterState,approvalClearanceMetres:approvalClearance,heliBaselineCounts,guestSpawnRequests,hostSpawnApprovals,worldStatusTimeline:worldStatusTimeline.map(history=>history.slice(-160)),errors:errors.slice(-100)},null,2));
      assert.ok(hostCreatedSpawn,'Host native engine did not report a rendered model-217 object created on safe ground');
      let hostHeliSamples=nativeClearanceSamples.filter(sample=>sample.client==='host'),guestHeliSamples=nativeClearanceSamples.filter(sample=>sample.client==='guest');
      assert.ok(hostHeliSamples.length>0&&guestHeliSamples.length>0,'The new helicopter must be present in both native engines, not merely already visible in the city');
      assert.ok(nativeClearanceSamples.every(sample=>sample.horizontalDistance>=12),`A guest-requested helicopter entered the requester’s rotor/head clearance: ${JSON.stringify(nativeClearanceSamples.slice(-10))}`);
      assert.ok(nativeClearanceSamples.every(sample=>Number.isFinite(sample.groundZ)&&Math.abs(sample.groundClearance-1.0)<=2.5),`A guest-requested helicopter was not grounded: ${JSON.stringify(nativeClearanceSamples.slice(-10))}`);
      const spawnVisibleAt=Math.min(...nativeClearanceSamples.map(sample=>sample.time));
      const idleSamples=()=>collectClearanceSamples().filter(sample=>sample.client==='host'&&sample.time>=spawnVisibleAt+4000);
      try{await waitFor(()=>idleSamples().length>=20,'Approved helicopter did not provide 20 post-spawn idle observations within 15 seconds',15000);}
      catch(error){
        nativeClearanceSamples=collectClearanceSamples();
        await fs.writeFile(path.join(out,'guest-heli-spawn-diagnostics.json'),JSON.stringify({requestPath:heliRequestPath,heliLobbyRequest,heliRequestSentAt,heliApproval,hostSpawnResults,requesterState,approvalClearanceMetres:approvalClearance,heliBaselineCounts,hostSpawnSamples:nativeClearanceSamples.filter(sample=>sample.client==='host').slice(-120),guestReplicaSamples:nativeClearanceSamples.filter(sample=>sample.client==='guest').slice(-120),hostWorldStatus:worldStatusTimeline[0].slice(-160),guestWorldStatus:worldStatusTimeline[1].slice(-160),errors:error.message},null,2));
        throw error;
      }
      nativeClearanceSamples=collectClearanceSamples();
      hostHeliSamples=nativeClearanceSamples.filter(sample=>sample.client==='host');guestHeliSamples=nativeClearanceSamples.filter(sample=>sample.client==='guest');
      const idleHeliSamples=idleSamples();
      await fs.writeFile(path.join(out,'guest-heli-spawn-diagnostics.json'),JSON.stringify({requestPath:heliRequestPath,heliLobbyRequest,heliRequestSentAt,heliApproval,hostSpawnResults,requesterState,approvalClearanceMetres:approvalClearance,heliBaselineCounts,hostSpawnSamples:hostHeliSamples.slice(-120),guestReplicaSamples:guestHeliSamples.slice(-120),hostWorldStatus:worldStatusTimeline[0].slice(-160),guestWorldStatus:worldStatusTimeline[1].slice(-160)},null,2));
      const idleOrigin=idleHeliSamples[0].vehiclePosition;
      const idleDriftMetres=Math.max(...idleHeliSamples.map(sample=>Math.hypot(...sample.vehiclePosition.map((value,index)=>value-idleOrigin[index]))));
      const idleMinimumHealth=Math.min(...idleHeliSamples.map(sample=>sample.health));
      const rotorMotion=[0,1].map(i=>{const samples=(i?guestHeliSamples:hostHeliSamples).filter(sample=>sample.time>=spawnVisibleAt+1000);const rates=[];for(let n=1;n<samples.length;n++){let delta=samples[n].rotorRotation-samples[n-1].rotorRotation;while(delta>Math.PI)delta-=Math.PI*2;while(delta< -Math.PI)delta+=Math.PI*2;const elapsed=(samples[n].time-samples[n-1].time)/1000;if(elapsed>0)rates.push(Math.abs(delta)/elapsed);}rates.sort((a,b)=>a-b);return {client:i?'guest':'host',samples:samples.length,medianRadiansPerSecond:rates[Math.floor(rates.length/2)]??0};});
      assert.ok(rotorMotion.every(sample=>sample.samples>10&&sample.medianRadiansPerSecond<0.15),`Unpiloted Maverick rotors kept moving: ${JSON.stringify(rotorMotion)}`);
      const rotorSpeedSamples={host:hostHeliSamples.filter(sample=>sample.time>=spawnVisibleAt+1000).map(sample=>sample.rotorSpeed),guest:guestHeliSamples.filter(sample=>sample.time>=spawnVisibleAt+1000).map(sample=>sample.rotorSpeed)};
      assert.ok(Object.values(rotorSpeedSamples).every(samples=>samples.length>10&&samples.every(speed=>Math.abs(speed)<=0.01)),`Unpiloted Maverick rotor speed did not stay stopped: ${JSON.stringify(rotorSpeedSamples)}`);
      assert.ok(nativeClearanceSamples.filter(sample=>sample.time>=spawnVisibleAt+1000).every(sample=>!sample.engineOn),`The unpiloted Maverick engine started before a player took the controls`);
      assert.ok(idleMinimumHealth>0,`Idle multiplayer helicopter was wrecked before a player boarded (minimum health ${idleMinimumHealth})`);
      assert.ok(idleDriftMetres<1.0,`Idle multiplayer helicopter drifted ${idleDriftMetres.toFixed(2)} m before a player piloted it`);
      const fastChannels=await Promise.all(windows.map(window=>window.webContents.executeJavaScript('testLobby.fast.report()')));
      const fastChannelConfirmedAfterRejoin=fastChannels.every(report=>report.some(channel=>channel.state==='open'&&channel.confirmed));
      if(!fastChannelConfirmedAfterRejoin){await fs.writeFile(path.join(out,'guest-heli-fast-channel-diagnostics.json'),JSON.stringify({fastChannels,lobbyState:await Promise.all(windows.map(window=>window.webContents.executeJavaScript("({isHost:testLobby.isHost,hostId:testLobby.hostId,players:[...testLobby.players.keys()]})"))),enginePackets:engines.map(engine=>engine.diagnostics().packets),reliableMovementFallback:await windows[0].webContents.executeJavaScript('testLobby.states.size>0')},null,2));}
      const result={success:true,scenario:'Guest requests a helicopter after live-session rejoin; both native clients verify it is grounded, silent, and parked before a player takes the controls',requestPath:heliRequestPath,requestAccepted:heliLobbyRequest,hostApproved:hostSpawnResults.findLast(result=>result.model===217)?.accepted===true,helicopterCountBaseline:heliBaselineCounts,helicopterCountAfter:[worldObserved[0]?.testHelicopters?.count,worldObserved[1]?.testHelicopters?.count],helicopterVisible:[hostHeliSamples.length>0,guestHeliSamples.length>0],hostCreatedSpawn:hostCreatedSpawn.testSpawn,approvalClearanceMetres:approvalClearance,minimumObservedNativeClearanceMetres:Math.min(...nativeClearanceSamples.map(sample=>sample.horizontalDistance)),maximumGroundClearanceErrorMetres:Math.max(...nativeClearanceSamples.map(sample=>Math.abs(sample.groundClearance-1.0))),rotorMotion,rotorSpeedSamples,idleHealth:idleMinimumHealth,idleDriftMetres,fastChannelConfirmedAfterRejoin,fastChannelWarning:fastChannelConfirmedAfterRejoin?null:'Fast snapshot stream did not reconfirm; lobby movement continued on reliable fallback',fastChannels,spawnSamples:nativeClearanceSamples.slice(-40),nativeMenuInjectionTested:heliRequestPath.startsWith('native guest menu'),midSessionRejoinTested:process.env.VT_TEST_RESET==='1',samePC:true,internetTested:false};
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
    if(process.env.VT_TEST_CAR==='1'){
      const hostDriveSeats=localSeats[0].filter(s=>s.id>=0&&s.seat===-1),guestPassengerSeats=localSeats[1].filter(s=>s.id>=0&&s.seat>=0);
      assert.ok(hostDriveSeats.length>20,'Host did not drive a real native vehicle');
      const sharedId=hostDriveSeats.at(-1).id;
      const outbound=driverSamples.filter(sample=>sample.player===0&&sample.id===sharedId&&sample.state[20]===1);
      const inbound=await windows[1].webContents.executeJavaScript('window.testReceivedDriverStates');
      const received=inbound.filter(sample=>sample.id===sharedId&&sample.state?.[20]===1);
      const intervals=received.slice(1).map((sample,index)=>sample.time-received[index].time).filter(value=>value>0).sort((a,b)=>a-b);
      const arrivalRateHz=intervals.length*1000/Math.max(1,received.at(-1)?.time-received[0]?.time);
      const lobbyDiagnostics=await Promise.all(windows.map(window=>window.webContents.executeJavaScript("({isHost:testLobby.isHost,hostId:testLobby.hostId,players:[...testLobby.players.keys()],localDriverEvents:window.testLocalDriverEvents,localDriverFallbacks:window.testLocalDriverFallbacks,localDriverCalls:window.testLocalDriverCalls,localDriverAccepted:window.testLocalDriverAccepted,localDriverRejected:window.testLocalDriverRejected,fast:testLobby.fast.report(),seen:[...testLobby.fast.peers].map(([id,entry])=>({id,channel:entry.channel?.readyState,driverSequence:entry.seen.get('driver')||0}))})")));
      const guestStatus=worldStatusTimeline[1],firstStatus=guestStatus[0],lastStatus=guestStatus.at(-1);
      const appliedPackets=(lastStatus?.driverMotionPackets||0)-(firstStatus?.driverMotionPackets||0);
      const renderedFrames=(lastStatus?.driverMotionFrames||0)-(firstStatus?.driverMotionFrames||0);
      const framesPerPacket=renderedFrames/Math.max(1,appliedPackets);
      const hostDrivenVehicle={outboundSnapshots:outbound.length,receivedSnapshots:received.length,arrivalRateHz,arrivalIntervalP50Ms:intervals[Math.floor(intervals.length*.5)]??null,arrivalIntervalP95Ms:intervals[Math.floor(intervals.length*.95)]??null,guestNativeAppliedPackets:appliedPackets,guestInterpolatedFrames:renderedFrames,guestFramesPerPacket:framesPerPacket,guestInterpolationHz:firstStatus&&lastStatus?(renderedFrames*1000/Math.max(1,lastStatus.time-firstStatus.time)):0,lobbyDiagnostics};
      await fs.writeFile(path.join(out,'host-driven-vehicle-stream.json'),JSON.stringify(hostDrivenVehicle,null,2));
      assert.ok(outbound.length>100,'Host did not publish local driver snapshots');
      assert.ok(received.length>100,'Guest did not receive the host driver stream over P2P');
      assert.ok(arrivalRateHz>=75,`Host-to-guest vehicle stream did not reach the 90 Hz target: ${arrivalRateHz.toFixed(1)} Hz`);
      assert.ok(intervals.length>50&&intervals[Math.floor(intervals.length*.5)]<=25&&intervals[Math.floor(intervals.length*.95)]<=50,'Host-to-guest vehicle snapshots arrived too slowly');
      assert.ok(appliedPackets>100,'Guest native game did not apply the host vehicle snapshots');
      assert.ok(framesPerPacket>1.1,'Guest native game did not interpolate the host vehicle between snapshots');
      const result={success:true,scenario:'Hidden host-driven shared-car stream',durationSeconds,sharedVehicleId:sharedId,hostDriverSamples:hostDriveSeats.length,guestPassengerSamples:guestPassengerSeats.filter(s=>s.id===sharedId).length,hostDrivenVehicle,playerFrameRates:performance.map(samples=>samples.at(-1)?.fps??null),samePC:true,internetTested:false};
      await fs.writeFile(path.join(out,'native-gameplay.json'),JSON.stringify(result,null,2));return result;
    }
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
      const shapeErrors=combatTest?[]:upright.map(s=>{const recent=sourceSkeleton[1-i].filter(p=>p.time<=s.time && s.time-p.time<350 && p.state[3]>0);return recent.length?Math.min(...recent.map(p=>Math.hypot(...p.state.slice(0,3).map((v,k)=>v-s.state[k])))):null;}).filter(e=>e!==null).sort((a,b)=>a-b);
      if(!combatTest)assert.ok(shapeErrors.length>50 && shapeErrors[Math.floor(shapeErrors.length*.95)]<0.25,`Engine ${i} remote skeleton does not match actual source bones: p95 ${shapeErrors[Math.floor(shapeErrors.length*.95)]}`);
      const headPositionErrors=combatTest?[]:upright.map(s=>{if(!s.state.slice(17,20).every(Number.isFinite))return null;const recent=sourceSkeleton[1-i].filter(p=>p.time<=s.time && s.time-p.time<350 && p.state[3]>0 && p.state.slice(17,20).every(Number.isFinite));return recent.length?Math.min(...recent.map(p=>Math.hypot(...p.state.slice(17,20).map((v,k)=>v-s.state[17+k])))):null;}).filter(e=>e!==null).sort((a,b)=>a-b);
      // A seated driver and passenger have intentionally different world-space
      // head positions. Keep this on-foot alignment assertion out of the shared
      // vehicle test; vehicle transform cadence is measured independently below.
      if(process.env.VT_TEST_CAR!=='1'&&!combatTest)assert.ok(headPositionErrors.length>50 && headPositionErrors[Math.floor(headPositionErrors.length*.95)]<0.75,`Engine ${i} animated head spacing disagreed with the other view: p95 ${headPositionErrors[Math.floor(headPositionErrors.length*.95)]} m`);
      let tagAlignmentErrors=[],headClearanceSamples=[],projectedTagCount=null;
      if(process.env.VT_TEST_CAR!=='1'&&!combatTest){
        const projectedTags=upright.filter(s=>s.state[23]===1&&s.state.slice(20,23).every(Number.isFinite)&&s.state[27]===0);
        projectedTagCount=projectedTags.length;
        assert.ok(projectedTags.length>20,`Engine ${i} did not report a name tag actually drawn in the remote head render hook`);
        assert.ok(projectedTags.every(s=>s.state[26]>0&&s.state[22]>s.state[21]&&s.state[22]-s.state[21]<25),`Engine ${i} name and health line did not stay tightly aligned`);
        tagAlignmentErrors=projectedTags.map(s=>Math.max(Math.abs(s.state[24]-s.state[25]),Math.abs(s.state[24]+s.state[26]*0.5-s.state[29]))).sort((a,b)=>a-b);
        assert.ok(tagAlignmentErrors.length>20&&tagAlignmentErrors[Math.floor(tagAlignmentErrors.length*.95)]<0.01,`Engine ${i} actual rendered name/health left edges diverged or their shared center missed the head`);
        headClearanceSamples=projectedTags.map(s=>s.state[28]-s.state[22]).sort((a,b)=>a-b);
        assert.ok(headClearanceSamples.every(v=>v>65&&v<71),`Engine ${i} health line is not kept a small, consistent distance above the actual rendered head anchor`);
      }
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
      // Combat fixtures deliberately teleport the attacker into contact range
      // and may respawn a defeated player; those discontinuities are not normal
      // remote movement errors. Combat has its own hit, damage and reaction gates.
      if(!combatTest)assert.ok(p95 < 1, `Engine ${i} ${authoritativeCarPassenger?'passenger seat distance from authoritative driver':'replication error'} exceeded one metre: ${p95}`);
      const sourcePositionAt=time=>{let upper=source.findIndex(point=>point.time>=time);if(upper<1||upper>=source.length)return null;const before=source[upper-1],after=source[upper],span=after.time-before.time;if(span<=0||span>100)return null;const amount=(time-before.time)/span;return before.state.slice(0,3).map((value,index)=>value+(after.state[index]-value)*amount);};
      const sourceVelocityAt=time=>{let upper=source.findIndex(point=>point.time>=time);if(upper<1||upper>=source.length)return null;const before=source[upper-1],after=source[upper],span=after.time-before.time;if(span<=0||span>100)return null;return before.state.slice(0,3).map((value,index)=>(after.state[index]-value)*1000/span);};
      const sourceVelocityAgreement=source.slice(1).map((after,index)=>{const before=source[index],span=after.time-before.time;if(span<=0||span>100)return null;const derivative=before.state.slice(0,3).map((value,k)=>(after.state[k]-value)*1000/span),reported=after.state.slice(4,7);if(!derivative.every(Number.isFinite)||!reported.every(Number.isFinite))return null;return {derivativeSpeed:Math.hypot(...derivative),reportedSpeed:Math.hypot(...reported),vectorError:Math.hypot(...derivative.map((value,k)=>value-reported[k]))};}).filter(Boolean);
      const interpolationBufferSamples=remote[i].map(sample=>sample.state[19]).filter(value=>Number.isFinite(value)&&value>0).sort((a,b)=>a-b);
      assert.ok(interpolationBufferSamples.length>50,`Engine ${i} did not report its active interpolation buffer`);
      const interpolationBufferP95Ms=interpolationBufferSamples[Math.floor(interpolationBufferSamples.length*0.95)];
      assert.ok(interpolationBufferP95Ms<90,`Engine ${i} interpolation buffer remained too high: p95 ${interpolationBufferP95Ms} ms`);
      const gaps = settled.slice(1).map((s,j) => s.time-settled[j].time).sort((a,b)=>a-b);
      const presentPositionErrors=[],presentAlongTrackErrors=[];
      if(!combatTest&&!authoritativeCarPassenger&&process.env.VT_TEST_CAR!=='1')for(const sample of remote[i]){
        const bufferMs=sample.state[19];if(!Number.isFinite(bufferMs)||bufferMs<=0)continue;
        // The display state is deliberately projected across measured route
        // time plus the native interpolation buffer, so compare it to the
        // source's current position rather than the old delayed sample time.
        const current=sourcePositionAt(sample.time);
        if(current){
          presentPositionErrors.push(Math.hypot(...current.map((value,index)=>value-sample.state[index])));
          const velocity=sourceVelocityAt(sample.time),speed=velocity?Math.hypot(...velocity):0;
          if(speed>0.15){const along=sample.state.slice(0,3).reduce((sum,value,index)=>sum+(value-current[index])*velocity[index]/speed,0);presentAlongTrackErrors.push(along);}
        }
      }
      presentPositionErrors.sort((a,b)=>a-b);
      presentAlongTrackErrors.sort((a,b)=>a-b);
      if(!combatTest&&!authoritativeCarPassenger&&process.env.VT_TEST_CAR!=='1'){
        assert.ok(presentPositionErrors.length>50,'Missing timestamp-aligned player spacing samples');
        const maxPresentPositionError=networkDelayPerDirectionMs>0?0.4:0.22;
        assert.ok(presentPositionErrors[Math.floor(presentPositionErrors.length*0.95)]<maxPresentPositionError,`Present-position error exceeded ${Math.round(maxPresentPositionError*100)} cm at p95: ${presentPositionErrors[Math.floor(presentPositionErrors.length*0.95)]}; signed along-track lead p50: ${presentAlongTrackErrors.length?presentAlongTrackErrors[Math.floor(presentAlongTrackErrors.length*0.5)]:'unavailable'} m`);
      }
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
        statePacketIntervalP95Ms:gaps[Math.floor(gaps.length*0.95)]??null,
        currentSourceSeparationP95Metres:presentPositionErrors[Math.floor(presentPositionErrors.length*0.95)]??null,
        currentSourceSeparationLimitMetres:!combatTest&&!authoritativeCarPassenger&&process.env.VT_TEST_CAR!=='1'?(networkDelayPerDirectionMs>0?0.4:0.22):null,
        signedAlongTrackLeadP50Metres:presentAlongTrackErrors.length?presentAlongTrackErrors[Math.floor(presentAlongTrackErrors.length*0.5)]:null,
        sourceReportedSpeedP50:sourceVelocityAgreement.length?sourceVelocityAgreement.map(sample=>sample.reportedSpeed).sort((a,b)=>a-b)[Math.floor(sourceVelocityAgreement.length*0.5)]:null,
        sourcePositionDerivativeSpeedP50:sourceVelocityAgreement.length?sourceVelocityAgreement.map(sample=>sample.derivativeSpeed).sort((a,b)=>a-b)[Math.floor(sourceVelocityAgreement.length*0.5)]:null,
        sourceVelocityVectorErrorP95:sourceVelocityAgreement.length?sourceVelocityAgreement.map(sample=>sample.vectorError).sort((a,b)=>a-b)[Math.floor(sourceVelocityAgreement.length*0.95)]:null,
        simulatedOneWayDelayMs:networkDelayPerDirectionMs,
        simulatedRoundTripMs:networkDelayPerDirectionMs*2,
        simulatedJitterAmplitudePerDirectionMs:networkJitterAmplitudeMs,
        skeletonSamples:upright.length,minimumHeadToFootMetres:Math.min(...heights),maximumHeadToFootMetres:Math.max(...heights),
        animatedHeadSpacingErrorP95Metres:headPositionErrors[Math.floor(headPositionErrors.length*.95)],projectedNameTagSamples:projectedTagCount,
        nameHealthHeadAlignmentErrorP95Pixels:tagAlignmentErrors[Math.floor(tagAlignmentErrors.length*.95)]??null,
        nameHealthHeadClearanceP95Pixels:headClearanceSamples[Math.floor(headClearanceSamples.length*.95)]??null,
        coloredRemoteDraws:Math.max(0,...upright.map(s=>s.state[7])),recoloredTexturePixels:Math.max(0,...upright.map(s=>s.state[8])),
        replicatedGunAimSamples:gunAimSamples.length,
        replicatedJumpSamples:jumpSamples.length,
        interpolationBufferP95Ms,
        closestRecentSourceSkeletonErrorP95Metres:shapeErrors[Math.floor(shapeErrors.length*.95)],
        ...(authoritativeCarPassenger?{passengerToAuthoritativeDriverDistanceP95Metres:p95}:{closestRecentPositionErrorP95Metres:p95}), statePacketGapP95Ms: gaps[Math.floor(gaps.length * .95)] };
    });
    const combatTargets=[];
    if(combatTest) {
      assert.ok(hits[0]>1,'Actual pad-input punches did not hit the remote native ped');
      assert.ok(local[1].some(s=>s.state[8]<100),'The guest native player never received shared health damage');
      combatTargets.push(1);
      if(process.env.VT_TEST_COMBAT_BIDIRECTIONAL==='1'){
        assert.ok(hits[1]>1,'Guest pad-input punches did not hit the remote native ped');
        assert.ok(local[0].some(s=>s.state[8]<100),'The host native player never received shared health damage from the guest');
        combatTargets.push(0);
      }
      for(const target of combatTargets){
        const applications=playerHitApplications[target];
        assert.ok(applications.some(event=>event.applied),`Native client ${target} did not apply the host-validated hit to its local player`);
        const reactions=sourceSkeleton[target].filter(sample=>sample.state[15]>=0);
        assert.ok(reactions.length>0,`Native client ${target} never played a stock hit reaction on its local Tommy`);
        applications.forEach(event=>event.reactionObserved=reactions.some(sample=>sample.time>=event.time-100&&sample.time<=event.time+1200));
        assert.ok(applications.some(event=>event.reactionObserved),`Native client ${target} received damage but did not render the hit animation`);
        const otherView=remote[1-target].filter(sample=>hitAnimation(sample.state[11])||hitAnimation(sample.state[16]));
        assert.ok(otherView.length>0,`The other client's native game never rendered client ${target}'s hit animation`);
      }
      const attackSamples=local.map(samples=>samples.filter(sample=>[11,16,21,26].some(index=>sample.state[index]>=49&&sample.state[index]<=62)).length);
      assert.ok(attackSamples[0]>2,'Host did not play a real native punch animation');
      if(process.env.VT_TEST_COMBAT_BIDIRECTIONAL==='1')assert.ok(attackSamples[1]>2,'Guest did not play a real native punch animation');
      if(process.env.VT_TEST_MOVING_COMBAT==='1')assert.ok(players[1].displacementMetres>0.2,'Defender did not actually move');
    }
    if(process.env.VT_TEST_SHOTS==='1')for(let i=0;i<2;i++) {
      assert.ok(shots[i].length>5,`Engine ${i} did not fire real native shots`);
      assert.ok(playedShots[1-i].length>5,`Engine ${1-i} did not execute remote shot effects`);
      assert.ok(playedShots[1-i].every(p=>shots[i].some(s=>Math.hypot(...s.end.map((v,k)=>v-p.end[k]))<0.001)), 'Remote trace endpoint differs from the actual source shot');
    }
    const healthTransitions=local[1].slice(1).map((s,i)=>[local[1][i].state[8],s.state[8]]);
    assert.ok(worldFrames[0]>10 && worldObserved[1]?.seq>10,'Guest did not apply host-owned native world snapshots');
    if(process.env.VT_TEST_REQUIRE_WORLD_ENTITY==='1')assert.ok((worldObserved[1]?.loadedPeds||0)+(worldObserved[1]?.loadedVehicles||0)>0,'Guest did not load any host-owned police or vehicle entities');
    if(process.env.VT_TEST_CAR==='1'){
      assert.ok(players.every(p=>p.displacementMetres>25),'Driver/passenger did not travel at least 25 metres in the shared car');
      assert.ok(localSeats[0].filter(s=>s.id>=0 && s.seat===-1).length>100,'Host did not drive a real native vehicle');
      assert.ok(localSeats[1].filter(s=>s.id>=0 && s.seat>=0).length>100,'Guest did not occupy a real native passenger seat');
      assert.equal(localSeats[0].at(-1).id,localSeats[1].at(-1).id,'Players rode different shared vehicle identities');
      const driverId=localSeats[0].at(-1).id;
      assert.ok(localSeats.every(seats=>seats.slice(-200).every(s=>s.id===driverId)),'A player lost the shared car during the drive');
    }
    return { success: true, durationSeconds, players,sharedWorld:{hostFrames:worldFrames[0],guestAppliedSequence:worldObserved[1]?.seq,guestPolice:worldObserved[1]?.loadedPeds||0,guestVehicles:worldObserved[1]?.loadedVehicles||0,hostDroppedUnsupportedPeds:engines[0].diagnostics().worldFrames.droppedUnsupportedPeds},launchedFromActualUIButton:!!registerLauncher,combatTest,bidirectionalCombatTest:process.env.VT_TEST_COMBAT_BIDIRECTIONAL==='1',playerHitEvents:playerHitEvents.map(events=>events.length),playerHitApplications,localHitReactionSamples:sourceSkeleton.map(samples=>samples.filter(sample=>sample.state[15]>=0).length),remoteHitReactionSamples:remote.map(samples=>samples.filter(sample=>hitAnimation(sample.state[11])||hitAnimation(sample.state[16])).length),guestNpcShot, movingDefenderFixture:combatTest&&process.env.VT_TEST_MOVING_COMBAT==='1',nativeHits:hits,nativeShots:shots.map(s=>s.length),remoteShotEffects:playedShots.map(s=>s.length), guestMinimumHealth:Math.min(...local[1].map(s=>s.state[8])),guestDeaths:healthTransitions.filter(([a,b])=>a>0&&b===0).length,guestRespawns:healthTransitions.filter(([a,b])=>a===0&&b===100).length, importedAssetCacheTested: !!importTest, importedFileCount: importTest?.gameFiles || null, automatedPadInput: true,
      transport: 'Two native reVC engines → loopback bridge → two sandboxed Chromium contexts → real Trystero WebRTC → remote CPeds',
      limitation: 'Same-PC prototype. Closest recent position metric allows up to 350 ms lag and does not prove visual smoothness. Player hit reactions are a targeted stock-animation prototype; vehicle impacts, knockdown/death logic, NPC-wide AI ownership, police pursuit behavior, cross-internet combat and a fresh Windows installation remain unverified.' };
  } finally {
    clearInterval(timer); stopping = true; engines.forEach(e=>e.stop());
    const projectionTelemetry=process.env.VT_TEST_CAPTURE_PROJECTION==='1'?await Promise.all(windows.map(window=>window.webContents.executeJavaScript('window.testProjectionTelemetry||[]').catch(()=>[]))):undefined;
    await fs.writeFile(path.join(out, 'native-game-samples.json'), JSON.stringify({ local, remote, skeleton,sourceSkeleton,projectionTelemetry,localSeats,worldFrames,worldObserved,nativeWorldVehicleModels:vehicleModels.map(models=>[...models].sort((a,b)=>a-b)), performance, errors, diagnostics,hits,shots,playedShots,engineDiagnostics:engines.map(e=>e.diagnostics()) }));
  }
}
module.exports = { runNativeGameTest };
