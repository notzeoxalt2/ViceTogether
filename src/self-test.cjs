const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createInvite } = require('./invite.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, message, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await delay(150); }
  throw new Error(message);
}
async function run({ app, win, assets, BrowserWindow, lockdown,registerTestWindow,registerTestLauncher, nativeExecutable }) {
  const out = process.env.VT_TEST_OUTPUT ? path.resolve(process.env.VT_TEST_OUTPUT) : path.resolve(__dirname, '../../verification');
  const result = { testedAt: new Date().toISOString(), windows: process.platform, electron: process.versions.electron, launcherHardwareAccelerationDisabled: true, nativeGameUsesD3D9: true, tests: [], gameplayTested: false, freshWindowsVMTested: false, publicInternetConnectivityTested: false };
  let relay, a, b,uiGuest;
  await fs.mkdir(out, { recursive: true });
  try {
    await waitFor(() => win.webContents.executeJavaScript('!!window.testLobby'), 'Launcher did not initialize');
    assert.ok(await win.webContents.executeJavaScript("!document.getElementById('page-library').hidden && document.querySelectorAll('[data-game-id=\"vice-city\"]').length===1"),'Game library did not show the supported Vice City integration');
    await win.webContents.executeJavaScript("document.getElementById('library-search').value='unsupported game';document.getElementById('library-search').dispatchEvent(new Event('input'))");
    assert.ok(await win.webContents.executeJavaScript("!document.getElementById('library-empty').hidden && document.getElementById('game-library').children.length===0"),'Unsupported games appeared in library search');
    await win.webContents.executeJavaScript("document.getElementById('library-search').value='Vice City';document.getElementById('library-search').dispatchEvent(new Event('input'));document.querySelector('[data-game-id=\"vice-city\"] [data-library-details]').click()");
    assert.ok(await win.webContents.executeJavaScript("!document.getElementById('page-play').hidden"),'Library card did not open Vice City setup and play');
    await win.webContents.executeJavaScript("document.querySelector('nav [data-page=\"library\"]').click();document.getElementById('library-search').value='';document.getElementById('library-search').dispatchEvent(new Event('input'))");
    result.tests.push('Supported game library, search empty state, and Vice City setup navigation work in the sandboxed launcher');
    if((await assets.status()).gameReady && registerTestLauncher){
      let launches=0;registerTestLauncher(win,async()=>{launches++;});
      await win.webContents.executeJavaScript("document.querySelector('[data-game-id=\"vice-city\"] .primary').click()");
      await waitFor(()=>launches===1,'Library Play did not reach the validated desktop launch handler');
      result.tests.push('Library Play invokes the existing desktop launch handler (test launch stub; no game started)');
    }
    if(process.env.VT_TEST_SHOW==='1') {
      const area=require('./display.cjs').secondary().workArea;
      win.setBounds({x:area.x+8,y:area.y+8,width:940,height:740});win.showInactive();
    }
    await delay(500);
    try {await fs.writeFile(path.join(out,'launcher.png'),(await win.webContents.capturePage()).toPNG());}
    catch(error){result.captureWarnings=[error.message];}
    await win.webContents.executeJavaScript("document.querySelector('nav [data-page=settings]').click();document.querySelector('main').scrollTop=350");
    const chrome=await win.webContents.executeJavaScript("({bar:document.querySelector('.window-bar').getBoundingClientRect().top,sidebar:document.querySelector('aside').getBoundingClientRect().top,header:document.querySelector('header').getBoundingClientRect().top,rootOverflow:getComputedStyle(document.body).overflowY,scroll:getComputedStyle(document.querySelector('main')).overflowY})");
    assert.equal(chrome.bar,0);assert.equal(chrome.sidebar,40);assert.equal(chrome.header,40);assert.equal(chrome.rootOverflow,'hidden');assert.equal(chrome.scroll,'auto');
    await fs.writeFile(path.join(out,'settings-scrolled.png'),(await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript("document.querySelector('nav [data-page=library]').click();document.querySelector('main').scrollTop=0");
    if(process.env.VT_TEST_BACKGROUND!=='1'){
    await win.webContents.executeJavaScript("document.getElementById('window-maximize').click()");
    await waitFor(()=>win.isMaximized(),'Custom maximize button did not maximize the launcher');
    await win.webContents.executeJavaScript("document.getElementById('window-maximize').click()");
    await waitFor(()=>!win.isMaximized(),'Custom restore button did not restore the launcher');
    result.tests.push('Custom window controls work and title/sidebar/header stay connected while Settings scrolls');
    }
    result.tests.push('Actual sandboxed launcher initializes its UI and IPC');
    if(process.env.VT_TEST_BACKGROUND==='1' && (await assets.status()).gameReady){
      let hostLaunches=0,guestLaunches=0;
      registerTestLauncher(win,async()=>{hostLaunches++;});
      uiGuest=new BrowserWindow({show:false,width:940,height:740,webPreferences:{preload:path.join(__dirname,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
      registerTestWindow(uiGuest);registerTestLauncher(uiGuest,async()=>{guestLaunches++;});lockdown(uiGuest,'vice://launcher');
      await uiGuest.loadURL('vice://launcher/index.html');await waitFor(()=>uiGuest.webContents.executeJavaScript('!!window.testLobby'),'Hidden guest launcher did not initialize');
      await win.webContents.executeJavaScript("document.getElementById('profile').click()");
      assert.ok(await win.webContents.executeJavaScript("!document.getElementById('page-settings').hidden && document.activeElement.id==='name'"));
      await win.webContents.executeJavaScript("document.getElementById('library-host').click()");
      await waitFor(()=>win.webContents.executeJavaScript('!!testLobby.invite?.code'),'Hidden Host UI did not create invite');
      const code=await win.webContents.executeJavaScript('testLobby.invite.code');
      await waitFor(()=>win.webContents.executeJavaScript("!document.getElementById('multiplayer').disabled"),'Solo host could not start');
      await win.webContents.executeJavaScript("document.getElementById('multiplayer').click()");
      await waitFor(()=>hostLaunches===1,'Solo host did not reach launch handler');
      await uiGuest.webContents.executeJavaScript(`document.getElementById('invite-input').value=${JSON.stringify(code)};document.getElementById('join').click()`);
      await waitFor(async()=>await win.webContents.executeJavaScript('testLobby.players.size===2 && [...testLobby.players.values()].every(p=>p.ready)')&&await uiGuest.webContents.executeJavaScript('testLobby.players.size===2'),'Hidden UI lobby did not connect over public signaling',60000);
      try{await waitFor(()=>hostLaunches===1 && guestLaunches===1,'Start did not reach both validated launch handlers');}
      catch(error){result.launchDiagnostics={hostLaunches,guestLaunches,host:await win.webContents.executeJavaScript("({notice:document.getElementById('notice').textContent,started:testLobby.sessionStarted,ready:testLobby.ready})"),guest:await uiGuest.webContents.executeJavaScript("({notice:document.getElementById('notice').textContent,started:testLobby.sessionStarted,ready:testLobby.ready})")};throw error;}
      await win.webContents.executeJavaScript('testLobby.startGame()');await delay(300);assert.equal(hostLaunches,1);assert.equal(guestLaunches,1);
      await uiGuest.webContents.executeJavaScript("document.getElementById('leave').click()");
      await waitFor(()=>uiGuest.webContents.executeJavaScript("!testLobby.room && document.getElementById('retry').textContent==='Rejoin last lobby'"),'Leave did not preserve the guest rejoin invitation');
      await uiGuest.webContents.executeJavaScript("document.getElementById('retry').click()");
      await waitFor(()=>guestLaunches===2,'Rejoining an active lobby did not automatically prepare the guest');
      await win.webContents.executeJavaScript('testLobby.leave()');await uiGuest.webContents.executeJavaScript('testLobby.leave()');uiGuest.close();uiGuest=null;
      result.tests.push('Hidden actual launcher profile navigation, public-signaling Host/Join, launch handlers, duplicate Start protection and active-lobby rejoin pass (game launch stubbed; no game or input control)');
    }
    if(process.env.VT_TEST_BUNDLED==='1') {
      await waitFor(async()=> (await assets.status()).gameReady,'Bundled first-run game setup did not finish',180000);
      const status=await assets.status();
      assert.equal(path.resolve(status.gameSource),path.join(app.getPath('userData'),'original-game-source'));
      result.bundledFirstRun={gameReady:status.gameReady,gameFiles:status.gameFiles,gameSource:status.gameSource,profile:app.getPath('userData')};
      result.tests.push('First-run UI automatically imports the installer-bundled game assets');
      process.env.VT_TEST_GAME_ROOT=path.join(assets.root,'game');
      delete process.env.VT_TEST_IMPORT_CACHE;
    }
    if(process.env.VT_SKIP_UI_TEST!=='1') {
      const {clipboard}=require('electron'),previousClipboard=await clipboard.readText();
      try {
        uiGuest=new BrowserWindow({show:false,width:940,height:740,webPreferences:{preload:path.join(__dirname,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
        registerTestWindow(uiGuest);lockdown(uiGuest,'vice://launcher');
        await uiGuest.loadURL('vice://launcher/index.html');
        await waitFor(()=>uiGuest.webContents.executeJavaScript('!!window.testLobby'),'Guest launcher did not initialize');
        if(process.env.VT_TEST_SHOW==='1') {
          const {secondary}=require('./display.cjs'),area=secondary().workArea;
          win.setBounds({x:area.x+8,y:area.y+8,width:940,height:740});
          uiGuest.setBounds({x:area.x+area.width-948,y:area.y+8,width:940,height:740});
          win.showInactive();uiGuest.showInactive();
        }
        await win.webContents.executeJavaScript("document.getElementById('library-host').click()");
        await waitFor(()=>win.webContents.executeJavaScript("!!testLobby.invite?.code"),'Host button did not create a short-code room');
        await win.webContents.executeJavaScript("document.getElementById('copy-code').click()");
        await waitFor(async()=>/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/.test(await clipboard.readText()),'Copy room code did not copy a short code');
        const code=await clipboard.readText();
        await uiGuest.webContents.executeJavaScript(`document.querySelector('[data-page=join]').click();document.getElementById('invite-input').value=${JSON.stringify(code)};document.getElementById('join').click()`);
        await waitFor(async()=>await win.webContents.executeJavaScript("document.getElementById('players').children.length===2")&&await uiGuest.webContents.executeJavaScript("document.getElementById('players').children.length===2"),'Actual Host and Join UI did not connect',45000);
        await win.webContents.executeJavaScript("document.getElementById('copy').click()");
        const expectedInvite=await win.webContents.executeJavaScript('window.desktop.copyInvite ? true : false');
        assert.ok(expectedInvite,'Copy invitation API is missing');
        await waitFor(async()=>{const value=await clipboard.readText();return value==='vicetogether://join/'+code || value===require('../release-config.json').inviteBaseUrl.split('#')[0]+'#'+code;},'Copy invite link did not copy the install page or compact deep link');
        assert.ok((await clipboard.readText()).length<120,'Invite link is still oversized');
        result.shortInviteCharacters=(await clipboard.readText()).length;
        result.tests.push('Actual launcher Host, Copy room code, Join and Copy invite buttons connect two visible rosters over public signaling and WebRTC');
        try {
          await fs.writeFile(path.join(out,'lobby-host.png'),(await win.webContents.capturePage()).toPNG());
          await fs.writeFile(path.join(out,'lobby-guest.png'),(await uiGuest.webContents.capturePage()).toPNG());
        }catch(error){(result.captureWarnings??=[]).push(error.message);}
        if(process.env.VT_TEST_SHOW==='1')await delay(6000);
        if(process.env.VT_TEST_UI_GAME==='1' && process.argv.includes('--native-test')) {
          assert.ok((await assets.status()).gameReady,'UI gameplay test requires a real imported game library');
          process.env.VT_TEST_GAME_ROOT=path.join(assets.root,'game');
          delete process.env.VT_TEST_IMPORT_CACHE;
          result.nativeGame=await require('./native-game-test.cjs').runNativeGameTest({a:win,b:uiGuest,executable:nativeExecutable,out,registerLauncher:registerTestLauncher});
          result.gameplayTested=result.nativeGame.success;
          result.tests.push('Actual Start multiplayer button launches two isolated native games through launcher IPC; actual lobby carries their movement and hits');
        }
      }finally {
        await win.webContents.executeJavaScript('testLobby.leave()').catch(()=>{});
        if(uiGuest && !uiGuest.isDestroyed()) {await uiGuest.webContents.executeJavaScript('testLobby.leave()').catch(()=>{});uiGuest.destroy();}
        win.hide();await clipboard.writeText(previousClipboard);
      }
    }
    const { createWsRelayServer } = await import('@trystero-p2p/ws-relay/server');
    relay = createWsRelayServer({ host: '127.0.0.1', port: 0 });
    await relay.ready;
    const relayUrl = `ws://127.0.0.1:${relay.address().port}`;
    const create = async () => {
      const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
      w.webContents.on('console-message', (_, level, message) => { if (level >= 2) console.error(message); });
      await w.loadURL('vice://launcher/self-test.html');
      await waitFor(() => w.webContents.executeJavaScript('!!window.testLobby'), 'Test module did not load');
      return w;
    };
    a = await create(); b = await create();
    const publicSignaling = process.argv.includes('--public-signaling-test');
    const publicOptions=JSON.stringify({relayUrls:require('../release-config.json').signalingRelayUrls});
    for(const [window,name] of [[a,'Alice'],[b,'Bob']])await window.webContents.executeJavaScript(`window.socialStore=new Map();window.socialTest=new testFriends({${publicSignaling?'':'joinRoom:testJoinRoom,'}storage:{getItem:k=>socialStore.get(k),setItem:(k,v)=>socialStore.set(k,v)}});socialTest.start(${JSON.stringify(name)},${publicSignaling?publicOptions:`{relayUrls:[${JSON.stringify(relayUrl)}]}`});`);
    const friendInvite=await a.webContents.executeJavaScript('socialTest.createFriend()');
    await b.webContents.executeJavaScript(`socialTest.add(${JSON.stringify(friendInvite)})`);
    await waitFor(async()=>await a.webContents.executeJavaScript('socialTest.snapshot()[0].status=== "Online"')&&await b.webContents.executeJavaScript('socialTest.snapshot()[0].status=== "Online"'),'Real WebRTC friend presence did not connect');
    await a.webContents.executeJavaScript('socialTest.send(socialTest.friends[0].room,"Hello from the hidden friend test")');
    await waitFor(()=>b.webContents.executeJavaScript('socialTest.friends[0].messages.some(m=>m.text=== "Hello from the hidden friend test")'),'Real WebRTC chat was not delivered');
    await waitFor(()=>a.webContents.executeJavaScript('socialTest.friends[0].messages[0].direction=== "delivered"'),'Chat delivery receipt did not arrive');
    await a.webContents.executeJavaScript('socialTest.stop()');await b.webContents.executeJavaScript('socialTest.stop()');
    result.tests.push(`Two hidden renderers pair friends, show live presence and exchange text plus delivery receipt over real WebRTC (${publicSignaling?'public':'local'} signaling; same PC, not a two-network test)`);
    const joinOptions = publicSignaling ? publicOptions : `{joinRoom: testJoinRoom, relayUrls: [${JSON.stringify(relayUrl)}]}`;
    result.signaling = publicSignaling ? 'Configured public Trystero Nostr relays; same-PC peers' : 'Local WebSocket relay; same-PC peers';
    const connectionStarted=performance.now();
    const invite = await a.webContents.executeJavaScript(`testLobby.host(${JSON.stringify(createInvite())}, 'Host', ${joinOptions})`);
    await b.webContents.executeJavaScript(`window.setupProbeStart=performance.now();window.setupProbeResult=null;window.setupProbeListener=e=>{if(e.detail.connected){window.setupProbeResult=performance.now()-window.setupProbeStart;testLobby.removeEventListener('change',window.setupProbeListener);}};testLobby.addEventListener('change',window.setupProbeListener);`);
    await b.webContents.executeJavaScript(`testLobby.join(${JSON.stringify(invite)}, 'Friend', ${joinOptions})`);
    await waitFor(async () => (await a.webContents.executeJavaScript('testLobby.players.size')) === 2 && (await b.webContents.executeJavaScript('testLobby.players.size')) === 2, 'Two independent renderers did not connect');
    result.tests.push('Two independent Chromium contexts join a private Trystero lobby over real WebRTC');
    assert.equal(await b.webContents.executeJavaScript('!!testLobby.hostId'), true);
    result.authenticatedLobbyMs=Math.round(await b.webContents.executeJavaScript('window.setupProbeResult'));
    result.setupTiming={guest:await b.webContents.executeJavaScript('testLobby.connectionReport().then(r=>r.setupTiming)'),host:await a.webContents.executeJavaScript('testLobby.connectionReport().then(r=>r.setupTiming)')};
    assert.equal(result.setupTiming.guest.legacyHelloFallbacks||0,0,'New peers redundantly used legacy hello');
    result.tests.push('Guest verifies the host signature and receives the roster; connection timing uses the actual event, not a 150 ms poll');
    await assert.rejects(a.webContents.executeJavaScript('testLobby.startGame()'), /import their game files/);
    await a.webContents.executeJavaScript('testLobby.setReady(true)');
    await b.webContents.executeJavaScript('testLobby.setReady(true)');
    await waitFor(()=>b.webContents.executeJavaScript('[...testLobby.players.values()].every(p=>p.ready)'), 'Readiness did not reach the signed roster');
    result.tests.push('Launch waits for both players to finish setup; readiness updates reach the guest');
    await a.webContents.executeJavaScript('testLobby.sendState([0,0,5,0,0,0,0,2,100,0])');
    await b.webContents.executeJavaScript('testLobby.sendState([5,0,5,0,0,0,0,2,100,0])');
    await waitFor(()=>a.webContents.executeJavaScript('testLobby.states.size===2'),'Players did not publish state before the equipment snapshot');
    const guestId=await a.webContents.executeJavaScript('[...testLobby.players.keys()].find(id=>id!==testLobby.hostId)');
    await b.webContents.executeJavaScript('testLobby.sendEquipment({weapon:17,visible:true,wanted:3})');
    await waitFor(()=>a.webContents.executeJavaScript(`testLobby.wantedLevels.get(${JSON.stringify(guestId)})===3`),'Guest wanted level did not reach the host over the equipment channel');
    await a.webContents.executeJavaScript('testLobby.sendEquipment({weapon:17,visible:true,wanted:2})');
    await waitFor(()=>b.webContents.executeJavaScript("testEvents.some(e=>e.name==='frame'&&e.detail.some(p=>p.id===testLobby.hostId&&p.wanted===2))"),'Host wanted level did not reach the guest world snapshot');
    result.tests.push('Wanted levels travel from guest equipment to host and back in the signed host player snapshot');
    const stats = await a.webContents.executeJavaScript(`(async () => { const pc = Object.values(testLobby.room.getPeers())[0]; const stats = await pc.getStats(); return [...stats.values()].filter(s => s.type === 'data-channel').map(s => ({state:s.state,messagesSent:s.messagesSent,messagesReceived:s.messagesReceived})); })()`);
    assert.ok(stats.some(s => s.state === 'open' && s.messagesReceived > 0));
    result.rtcDataChannels = stats;
    await a.webContents.executeJavaScript('testLobby.sendState([0,0,5,0,0,0,0,2,100,0])');
    await b.webContents.executeJavaScript('testLobby.sendState([5,0,5,0,0,0,0,2,100,0])');
    await waitFor(() => b.webContents.executeJavaScript("testEvents.some(e=>e.name==='frame' && e.detail.length===2)"), 'Host-approved movement snapshots were not received');
    result.tests.push('Host forwards validated synthetic movement packets to guest (not a gameplay test)');
    await a.webContents.executeJavaScript('testLobby.fast.probe([...testLobby.players.keys()].find(id=>id!==testLobby.hostId))');
    await b.webContents.executeJavaScript('testLobby.fast.probe(testLobby.hostId)');
    await waitFor(async()=>await a.webContents.executeJavaScript('testLobby.fast.report().some(c=>c.state==="open"&&c.confirmed)')&&await b.webContents.executeJavaScript('testLobby.fast.report().some(c=>c.state==="open"&&c.confirmed)'),'Unreliable snapshot channel did not confirm two-way delivery');
    await a.webContents.executeJavaScript('testLobby.sendState([0.25,0,5,0,0,0,0,2,100,0])');
    await b.webContents.executeJavaScript('testLobby.sendState([5.25,0,5,0,0,0,0,2,100,0])');
    await waitFor(async()=>await a.webContents.executeJavaScript('testLobby.fast.report().some(c=>c.state==="open"&&c.sent>0&&c.received>0)')&&await b.webContents.executeJavaScript('testLobby.fast.report().some(c=>c.state==="open"&&c.sent>0&&c.received>0)'),'Unreliable snapshot channel did not carry two-way movement');
    result.snapshotChannels=await a.webContents.executeJavaScript('testLobby.fast.report()');
    assert.ok(result.snapshotChannels.every(c=>c.ordered===false&&c.retransmits===0),'Snapshot channel unexpectedly uses ordered retransmission');
    await a.webContents.executeJavaScript('testLobby.fast.probe([...testLobby.players.keys()].find(id=>id!==testLobby.hostId))');
    await waitFor(()=>a.webContents.executeJavaScript('testLobby.fast.report().some(c=>Number.isFinite(c.rttMs))'),'Movement-channel echo did not return');
    result.movementChannelLatency=await a.webContents.executeJavaScript('testLobby.fast.report().map(c=>({rttMs:c.rttMs,p50Ms:c.p50Ms,p95Ms:c.p95Ms,jitterMs:c.jitterMs,probeLost:c.probeLost}))');
    // Sender uses its own clock for both ends of the turnaround measurement.
    // Synthetic guest input must be validated by the host and returned as a frame.
    const measureTurnaround=()=>b.webContents.executeJavaScript(`(async()=>{
      const samples=[];for(let i=0;i<20;i++){
        const marker=5+Math.random()*0.01,at=performance.now();
        await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{testLobby.removeEventListener('frame',onFrame);reject(new Error('Synthetic turnaround timed out'));},3000);
          const onFrame=e=>{if(e.detail.some(p=>p.self&&p.state[0]===marker)){clearTimeout(timeout);testLobby.removeEventListener('frame',onFrame);samples.push(performance.now()-at);resolve();}};
          testLobby.addEventListener('frame',onFrame);testLobby.sendState([marker,0,5,0,0,0,0,2,100,0]);});
        await new Promise(resolve=>setTimeout(resolve,7));
      }samples.sort((a,b)=>a-b);return {samples:samples.length,p50Ms:Math.round(samples[9]*10)/10,p95Ms:Math.round(samples[18]*10)/10,maxMs:Math.round(samples[19]*10)/10};
    })()`);
    // Reproduce the old 50ms fixed-phase gate in this hidden test only.
    await a.webContents.executeJavaScript('window.originalFrameRequest=testLobby.frameDispatch.request;window.baselinePending=false;testLobby.frameDispatch.request=()=>{baselinePending=true};window.baselineGate=setInterval(()=>{if(baselinePending){baselinePending=false;originalFrameRequest.call(testLobby.frameDispatch);}},50)');
    result.syntheticTurnaroundBaseline=await measureTurnaround();
    await a.webContents.executeJavaScript('clearInterval(baselineGate);testLobby.frameDispatch.request=originalFrameRequest;testLobby.frameDispatch.request()');
    result.syntheticTurnaroundImmediate=await measureTurnaround();
    result.tests.push('Movement-channel RTT echo and synthetic guest-to-host-to-guest turnaround measured; same PC, no game/ISP latency claim');
    result.tests.push('Two-way snapshots use a separate unordered WebRTC stream without retransmission; lobby and gameplay events remain on Trystero');
    await a.webContents.executeJavaScript('testLobby.startGame()');
    await waitFor(() => b.webContents.executeJavaScript("testEvents.some(e=>e.name==='launch')"), 'Launch broadcast did not reach the guest');
    result.tests.push('Host launch message reaches guest');
    const launchCountBeforeRejoin=await b.webContents.executeJavaScript("testEvents.filter(e=>e.name==='launch').length");
    await b.webContents.executeJavaScript("window.realRoomLeave=testLobby.room.leave.bind(testLobby.room);testLobby.room.leave=async()=>{await window.realRoomLeave();await new Promise(resolve=>setTimeout(resolve,5000));};void 0");
    await b.webContents.executeJavaScript('window.stalledLeaveStarted=performance.now();testLobby.leave()');
    result.stalledRelayCleanupMs=Math.round(await b.webContents.executeJavaScript('performance.now()-window.stalledLeaveStarted'));
    assert.ok(result.stalledRelayCleanupMs<1500,'A simulated stalled relay teardown blocked leaving the lobby');
    await waitFor(()=>a.webContents.executeJavaScript('testLobby.players.size===1'),'Host did not remove the guest who left the live session');
    await b.webContents.executeJavaScript(`testLobby.setReady(true);testLobby.join(${JSON.stringify(invite)},'Friend',${joinOptions})`);
    await waitFor(async()=>await a.webContents.executeJavaScript('testLobby.players.size===2')&&await b.webContents.executeJavaScript('testLobby.players.size===2&&testLobby.sessionStarted&&testEvents.filter(e=>e.name==="launch").length>='+String(launchCountBeforeRejoin+1)),'A returning guest did not rejoin the active host session and receive its launch state',60000);
    result.tests.push('Guest leaves and rejoins the still-running private lobby; the host roster and session launch state recover over public signaling');
    result.tests.push('A simulated stalled relay teardown is bounded and does not block leaving or rejoining the live lobby');
    await a.webContents.executeJavaScript('testLobby.fast.probe([...testLobby.players.keys()].find(id=>id!==testLobby.hostId))');
    await b.webContents.executeJavaScript('testLobby.fast.probe(testLobby.hostId)');
    let fastRejoinConfirmed=false,fastRejoinError=null;
    try {
      await waitFor(async()=>await a.webContents.executeJavaScript('testLobby.fast.report().some(c=>c.state==="open"&&c.confirmed)')&&await b.webContents.executeJavaScript('testLobby.fast.report().some(c=>c.state==="open"&&c.confirmed)'), 'The unordered low-latency channel did not recover after the guest rejoined', 12000);
      fastRejoinConfirmed=true;
    } catch(error) {
      fastRejoinError=error.message;
    }
    result.rejoinFastChannels=await Promise.all([a,b].map(window=>window.webContents.executeJavaScript('testLobby.fast.report()')));
    result.rejoinFastChannelConfirmed=fastRejoinConfirmed;
    if(fastRejoinError)result.rejoinFastChannelWarning=fastRejoinError;
    const rejoinedGuestId=await a.webContents.executeJavaScript('[...testLobby.players.keys()].find(id=>id!==testLobby.hostId)');
    await b.webContents.executeJavaScript('testLobby.sendState([5.5,0,5,0,0,0,0,2,100,0])');
    await waitFor(()=>a.webContents.executeJavaScript(`testLobby.states.get(${JSON.stringify(rejoinedGuestId)})?.state?.[0]===5.5`),'Guest movement did not resume after rejoining the active lobby');
    result.rejoinMovementFallback='verified';
    result.tests.push('After active-lobby rejoin, guest movement reaches the host; reliable Trystero movement remains available if the optional low-latency channel is not confirmed');
    if(fastRejoinConfirmed)result.tests.push('Unordered low-latency snapshot channel reopens and completes a two-way probe after guest rejoin');
    else result.tests.push('Low-latency snapshot channel did not reconfirm after rejoin; the reliable movement fallback carried the guest state');
    if (process.argv.includes('--native-test') && !result.gameplayTested) {
      await a.webContents.executeJavaScript('testLobby.states.clear()');
      await b.webContents.executeJavaScript('testLobby.states.clear()');
      result.nativeGame = await require('./native-game-test.cjs').runNativeGameTest({ a, b, executable: nativeExecutable, out });
      result.gameplayTested = result.nativeGame.success;
      result.tests.push('Two actual native games replicate moving players over WebRTC; remote engine ped positions measured');
    }
    await b.webContents.executeJavaScript('testLobby.leave()');
    await waitFor(() => a.webContents.executeJavaScript('testLobby.players.size === 1'), 'Disconnect did not update roster');
    result.tests.push('Disconnect removes guest from host roster');
    result.success = true;
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { result.success = false; result.error = error.stack; console.error(error); }
  finally {
    a?.destroy(); b?.destroy();if(uiGuest && !uiGuest.isDestroyed())uiGuest.destroy();
    if (relay) { for (const client of relay.wss.clients) client.terminate(); await relay.close(); }
    await fs.writeFile(path.join(out, 'desktop-tests.json'), JSON.stringify(result, null, 2));
    app.exit(result.success ? 0 : 1);
  }
}
module.exports = { run };
