const { app, BrowserWindow, ipcMain, dialog, clipboard, protocol, net, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { inside, gameBytes } = require('./assets.cjs');
const { readJSON, writeJSON } = require('./storage.cjs');
const { createInvite, decodeInvite, inviteLink } = require('./invite.cjs');
const { getGameIntegration, listGames } = require('./games.cjs');
const activeGame = getGameIntegration('vice-city');
const config = require('../release-config.json');
// Only the 2D launcher uses Electron. The native game's D3D9 renderer is independent.
// Avoid Chromium GPU initialization failures on this Windows graphics driver.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');

protocol.registerSchemesAsPrivileged([{ scheme: 'vice', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
const selfTest = process.argv.includes('--self-test');
if (selfTest) app.setPath('userData', process.env.VT_TEST_PROFILE ? path.resolve(process.env.VT_TEST_PROFILE) : path.resolve(__dirname, '../../../work/desktop-test-profile'));
let win, gameWindow, assets, settings = {}, detected = [], pendingInvite = null;
let updateBusy = false;
const nativeExecutable = () => selfTest && process.env.VT_TEST_NATIVE_ENGINE ? path.resolve(process.env.VT_TEST_NATIVE_ENGINE) : activeGame.executable({packaged:app.isPackaged,resourcesPath:process.resourcesPath,sourceRoot:path.join(__dirname,'..')});
let nativeEngine;
const launchGate=new (require('./launch-gate.cjs').LaunchGate)();
const testWindows=new Set();
const testLaunchers=new Map();
const testDriverStateHandlers=new Map();
const testVehicleDoorHandlers=new Map();
const testVehicleSpawnHandlers=new Map();
const testLaunchGates=new WeakMap();
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function handleInvite(argv) {
  const input = argv.find(v => v.startsWith('vicetogether:'));
  if (!input) return;
  try {
    pendingInvite = decodeInvite(input);
    win?.webContents.send('invite', pendingInvite);
    if (win?.isMinimized()) win.restore();
    win?.show();
    win?.focus();
  } catch (e) { if (app.isReady()) dialog.showErrorBox('Invitation could not open', e.message); }
}
if (!selfTest) handleInvite(process.argv);
if (!selfTest && !app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_, argv) => handleInvite(argv));
  app.on('open-url', (event, url) => { event.preventDefault(); handleInvite([url]); });
  app.whenReady().then(start).catch(error => { console.error(error); if(!selfTest)dialog.showErrorBox('ViceTogether could not start', error.message); app.exit(1); });
}

async function serve(request) {
  try {
    const url = new URL(request.url);
    let root, relative;
    const assetRoot = assets.root;
    if (url.hostname === 'launcher') { root = path.join(__dirname, '../ui'); relative = decodeURIComponent(url.pathname).slice(1) || 'index.html'; }
    else if (url.hostname === 'game') {
      relative = decodeURIComponent(url.pathname).slice(1) || 'game.html';
      if (relative === 'assets/index.json') {
        const manifest = await readJSON(path.join(assetRoot, 'game/manifest.json'), null);
        return new Response(JSON.stringify(manifest?.files.map(f => ({ path: f.path.replaceAll('\\', '/'), size: f.size })) || []), { headers: { 'Content-Type': 'application/json' } });
      }
      if (relative.startsWith('assets/')) {
        relative = relative.slice(7); root = path.join(assetRoot, 'game');
        const manifest = await readJSON(path.join(root, 'manifest.json'), null);
        const entry = manifest?.files.find(f => f.path.replaceAll('\\', '/') === relative);
        if (!entry) return new Response('Not found', { status: 404 });
      }
      else if (relative.startsWith('vcsky/')) { root = path.join(assetRoot, 'runtime'); }
      else if (relative === 'index.wasm' || relative === 'index.data') root = path.join(assetRoot, 'runtime/decoded');
      else root = path.join(__dirname, '../engine');
    } else return new Response('Not found', { status: 404 });
    const file = inside(root, relative);
    const real = await fs.realpath(file);
    const realRoot = await fs.realpath(root);
    if (!real.startsWith(realRoot + path.sep)) return new Response('Forbidden', { status: 403 });
    const range = request.headers.get('Range');
    if (range) {
      const stat = await fs.stat(real);
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      const start = match ? Number(match[1]) : -1;
      const end = match ? Math.min(match[2] ? Number(match[2]) : stat.size - 1, stat.size - 1) : -1;
      if (start < 0 || end < start || start >= stat.size || end - start + 1 > 4 * 1024 * 1024) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
      const handle = await fs.open(real);
      const buffer = Buffer.alloc(end - start + 1);
      try { await handle.read(buffer, 0, buffer.length, start); } finally { await handle.close(); }
      return new Response(buffer, { status: 206, headers: { 'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': String(buffer.length), 'Cross-Origin-Resource-Policy': 'same-origin' } });
    }
    const response = await net.fetch(pathToFileURL(real).href);
    const headers = new Headers(response.headers);
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
    headers.set('Cross-Origin-Resource-Policy', 'same-origin');
    if (file.endsWith('.wasm')) headers.set('Content-Type', 'application/wasm');
    if (file.endsWith('.js') || file.endsWith('.mjs')) headers.set('Content-Type', 'text/javascript');
    if (url.hostname === 'launcher') headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' wss:" + (selfTest ? ' ws://127.0.0.1:*' : '') + "; object-src 'none'; base-uri 'none'; frame-src 'none'");
    else headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; connect-src 'self'; img-src 'self' data:; media-src 'self' blob:; object-src 'none'; base-uri 'none'");
    return new Response(response.body, { status: response.status, headers });
  } catch { return new Response('File unavailable. Return to Settings and run Check & repair.', { status: 404 }); }
}
function lockdown(window, origin) {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(origin + '/')) event.preventDefault(); });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
}
function ipc(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    if ((event.sender !== win?.webContents && !(selfTest && testWindows.has(event.sender))) || !event.senderFrame?.url.startsWith('vice://launcher/')) throw new Error('Unavailable outside launcher.');
    try { return { ok: true, value: await handler.call({sender:event.sender},...args) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
}
async function start() {
  nativeEngine = activeGame.createEngine(nativeExecutable());
  nativeEngine.on('state', state => win?.webContents.send('local-state', state));
  nativeEngine.on('hit', hit => win?.webContents.send('local-hit',hit));
  nativeEngine.on('world-damage',event=>win?.webContents.send('local-world-damage',event));
  nativeEngine.on('equipment',weapon=>win?.webContents.send('local-equipment',weapon));
  nativeEngine.on('shot',shot=>win?.webContents.send('local-shot',shot));
  nativeEngine.on('world',frame=>win?.webContents.send('local-world',frame));
  nativeEngine.on('driver-state',update=>win?.webContents.send('local-driver-state',update));
  nativeEngine.on('vehicle-doors',update=>win?.webContents.send('local-vehicle-doors',update));
  nativeEngine.on('glass-request',state=>win?.webContents.send('local-glass-request',state));
  nativeEngine.on('seat-state',seat=>win?.webContents.send('local-seat-state',seat));
  nativeEngine.on('seat-request',request=>win?.webContents.send('local-seat-request',request));
  nativeEngine.on('vehicle-spawn-request',model=>win?.webContents.send('local-vehicle-spawn-request',model));
  nativeEngine.on('shared-cheat-request',cheatId=>win?.webContents.send('local-shared-cheat-request',cheatId));
  nativeEngine.on('melee-request',request=>win?.webContents.send('local-melee-request',request));
  nativeEngine.on('problem', message => win?.webContents.send('game-error', message));
  nativeEngine.on('ended', ({ code }) => { if(code) win?.webContents.send('game-error', 'The game stopped unexpectedly. Your imported files are kept. Try Check & repair.'); });
  settings = await readJSON(settingsFile(), { name: 'Player', fps: 144, fullscreen: true });
  if(settings.graphicsVersion !== 1) {
    settings={...settings,fps:144,fullscreen:true,graphicsVersion:1};
    await writeJSON(settingsFile(),settings);
  }
  const progress = p => win?.webContents.send('progress', p);
  assets = activeGame.createAssetStore(selfTest && process.env.VT_TEST_LIBRARY ? path.resolve(process.env.VT_TEST_LIBRARY) : settings.libraryRoot || path.join(app.getPath('userData'), 'library'), progress);
  protocol.handle('vice', serve);
  session.defaultSession.setPermissionRequestHandler((_, permission, callback) => callback(permission === 'pointerLock' || permission === 'fullscreen'));
  session.defaultSession.setPermissionCheckHandler((_, permission) => ['pointerLock', 'fullscreen'].includes(permission));
  ipc('init', async () => {
    let engineBuilt = false;
    try { await fs.access(nativeExecutable()); engineBuilt = true; } catch {}
    return { settings, detected, games:listGames(),activeGameId:activeGame.metadata.id, assets: await assets.status(), engineBuilt, invite: pendingInvite, config, version: app.getVersion(), selfTest };
  });
  let lastSocialNotification=0;
  ipc('social-notification',text=>{if(typeof text!=='string'||text.length>100||/[\u0000-\u001f]/.test(text))throw new Error('Invalid notification.');if(!selfTest&&!win?.isFocused()&&Date.now()-lastSocialNotification>1500){const {Notification}=require('electron');if(Notification.isSupported()){new Notification({title:'ViceTogether',body:text,silent:true}).show();lastSocialNotification=Date.now();}}return true;});
  ipc('import-game', async candidate => {
    let folder;
    if (Number.isInteger(candidate) && candidate >= 0 && candidate < detected.length) folder = detected[candidate].root;
    else {
      const result = await dialog.showOpenDialog(win, { title: 'Select your legally obtained Vice City folder', properties: ['openDirectory'] });
      if (result.canceled) return null;
      folder = result.filePaths[0];
    }
    if (!(await assets.status()).gameReady && !settings.libraryRoot) {
      const disk = await fs.statfs(app.getPath('userData'));
      const bytes = await gameBytes(folder);
      if (Number(disk.bavail) * Number(disk.bsize) < bytes + 1024 ** 3 && path.parse(folder).root.toLowerCase() !== path.parse(app.getPath('userData')).root.toLowerCase()) {
        // Keep a low-space system drive usable; cache beside the existing game on its larger drive.
        const libraryRoot = path.join(path.dirname(folder), 'ViceTogether-library');
        await fs.mkdir(libraryRoot, { recursive: true });
        settings.libraryRoot = libraryRoot;
        await writeJSON(settingsFile(), settings);
        assets = activeGame.createAssetStore(libraryRoot, progress);
      }
    }
    return assets.import(folder, 'game');
  });
  ipc('prepare-bundled', async () => {
    if((await assets.status()).gameReady) return null;
    const bundled=path.join(process.resourcesPath,'offline-game');
    try { await fs.access(path.join(bundled,'Mss32.dll')); } catch { return null; }
    const source=await require('./offline-source.cjs').preserveOfflineSource(bundled,path.join(app.getPath('userData'),'original-game-source'));
    return assets.import(source,'game');
  });
  ipc('import-runtime', async () => {
    const result = await dialog.showOpenDialog(win, { title: 'Select your authorized prepared reVCDOS runtime (vcsky and vcbr)', properties: ['openDirectory'] });
    return result.canceled ? null : assets.import(result.filePaths[0], 'runtime');
  });
  ipc('repair', () => assets.repair());
  ipc('invite-create', () => createInvite());
  ipc('invite-parse', decodeInvite);
  ipc('invite-copy', async invite => { const link = inviteLink(invite, config.inviteBaseUrl); await clipboard.writeText(link); return link; });
  ipc('invite-code-copy', async value=>{const invite=decodeInvite(inviteLink(value));if(!invite.code)throw new Error('Create a new lobby to use a short code.');await clipboard.writeText(invite.code);return invite.code;});
  ipc('copy-text', async text => { if(typeof text!=='string'||text.length>8192)throw new Error('Text is too long to copy.');clipboard.writeText(text);return true; });
  ipc('settings', async value => {
    if (!value || typeof value.name !== 'string' || value.name.length > 24 || ![0, 30, 60, 120, 144, 240].includes(value.fps) || typeof value.fullscreen !== 'boolean') throw new Error('Please choose valid settings.');
    const mouseSensitivity=Number(value.mouseSensitivity??settings.mouseSensitivity??1.5);
    if(!Number.isFinite(mouseSensitivity)||mouseSensitivity<0.25||mouseSensitivity>4)throw new Error('Choose a mouse sensitivity between 0.25 and 4.');
    settings = { ...settings, name: value.name.trim() || 'Player', fps: value.fps, fullscreen: value.fullscreen,mouseSensitivity };
    await writeJSON(settingsFile(), settings);
    return settings;
  });
  ipc('play', async function(multiplayer = false,authoritativeWorld = false) {
    let gate=launchGate;
    // Hidden renderer tests stand in for separate installed applications.
    if(selfTest && testLaunchers.has(this.sender)){
      if(!testLaunchGates.has(this.sender))testLaunchGates.set(this.sender,new (require('./launch-gate.cjs').LaunchGate)());
      gate=testLaunchGates.get(this.sender);
    }
    return gate.run(async()=>{
    if (typeof multiplayer !== 'boolean') throw new Error('Invalid game mode.');
    if(typeof authoritativeWorld!=='boolean')throw new Error('Invalid world role.');
    const status = await assets.ensureReady();
    if (!status.gameReady) throw new Error('Import your legally obtained Vice City folder first.');
    if(selfTest && testLaunchers.has(this.sender)) {await testLaunchers.get(this.sender)();return true;}
    await nativeEngine.start(path.join(assets.root, 'game'), { multiplayer, authoritativeWorld, name: settings.name, fps: settings.fps, fullscreen: settings.fullscreen,mouseSensitivity:settings.mouseSensitivity,windowBounds:require('./display.cjs').gameWindow(), userDir: path.join(app.getPath('userData'), 'saves') });
    return true;
  });});
  ipc('updates', checkUpdates);
  ipc('diagnostics',()=>({version:app.getVersion(),native:nativeEngine.diagnostics()}));
  ipc('remote-frame', frame => {
    if (!Array.isArray(frame) || frame.length > 8) throw new Error('Invalid game state.');
    nativeEngine.frame(frame);
  });
  ipc('remote-shot',shot=>{nativeEngine.remoteShot(shot);return true;});
  ipc('player-hit',hit=>hit?.selfTarget===true?nativeEngine.playerHit(hit):false);
  ipc('remote-world',frame=>nativeEngine.remoteWorld(frame));
  ipc('remote-driver-state',function(update){
    const testHandler=testDriverStateHandlers.get(this.sender);
    if(selfTest&&testHandler)return testHandler(update);
    return nativeEngine.driverState(update);
  });
  ipc('remote-vehicle-doors',function(update){
    const testHandler=testVehicleDoorHandlers.get(this.sender);
    if(selfTest&&testHandler)return testHandler(update);
    return nativeEngine.driverDoors(update);
  });
  ipc('network-status',status=>nativeEngine.networkStatus(status));
  ipc('seat-grant',claim=>nativeEngine.seatGrant(claim));
  ipc('vehicle-spawn',function(request){const testHandler=testVehicleSpawnHandlers.get(this.sender);if(selfTest&&testHandler)return testHandler(request);return nativeEngine.spawnVehicle(request);});
  ipc('shared-cheat-toggle',(cheatId,position)=>nativeEngine.toggleSharedCheat(cheatId,position));
  ipc('glass-request',state=>nativeEngine.glassRequest(state));
  ipc('melee-grant',request=>nativeEngine.meleeGrant(request));
  ipcMain.on('local-state', (event, state) => {
    if (event.sender === gameWindow?.webContents && Array.isArray(state) && state.length === 10 && state.every(Number.isFinite)) win?.webContents.send('local-state', state);
  });
  ipc('quit', () => app.quit());
  ipc('window-action',function(action){
    const target=BrowserWindow.fromWebContents(this.sender);
    if(!target)throw new Error('The launcher window is unavailable.');
    if(action==='minimize')target.minimize();
    else if(action==='maximize'){if(target.isMaximized())target.unmaximize();else target.maximize();}
    else if(action==='close')target.close();
    else throw new Error('Unsupported window action.');
    return true;
  });
  const launchArea=require('./display.cjs').secondary().workArea;
  win = new BrowserWindow({ title: 'ViceTogether Alpha',frame:false,x:launchArea.x+24,y:launchArea.y+24, width:Math.min(1130,launchArea.width-48), height:Math.min(790,launchArea.height-48), minWidth: 920, minHeight: 690, backgroundColor: '#10141d', autoHideMenuBar: true, show: false, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  lockdown(win, 'vice://launcher');
  win.once('ready-to-show', () => { if (!selfTest) win.show(); });
  // Show the launcher before scanning installations; scanning never delays window creation.
  await win.loadURL('vice://launcher/index.html');
  if (!selfTest) win.show();
  activeGame.detectInstallations().then(found => { detected = found; win?.webContents.send('detected', found); }).catch(() => {});
  if (!selfTest) {
    if (app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR) app.setAsDefaultProtocolClient('vicetogether');
    setTimeout(() => checkUpdates().catch(() => {}), 15000).unref();
  } else await require('./self-test.cjs').run({ app, win, assets, BrowserWindow, lockdown,registerTestWindow:w=>testWindows.add(w.webContents),registerTestLauncher:(w,launch,driverState,vehicleDoors,vehicleSpawn)=>{testLaunchers.set(w.webContents,launch);if(driverState)testDriverStateHandlers.set(w.webContents,driverState);if(vehicleDoors)testVehicleDoorHandlers.set(w.webContents,vehicleDoors);if(vehicleSpawn)testVehicleSpawnHandlers.set(w.webContents,vehicleSpawn);}, nativeExecutable: nativeExecutable() });
}
async function checkUpdates() {
  if (!config.updateFeedUrl) return { message: 'Updates are not published yet. This alpha has no update feed configured.' };
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR) return { message: 'Automatic updates require the installed edition. Download a newer portable build manually.' };
  if (updateBusy) return { message: 'Checking for updates…' };
  const url = new URL(config.updateFeedUrl);
  if (url.protocol !== 'https:') throw new Error('The update service is not configured securely.');
  updateBusy = true;
  const { autoUpdater } = require('electron-updater');
  autoUpdater.channel = 'alpha';
  autoUpdater.setFeedURL({ provider: 'generic', url: url.href, channel: 'alpha' });
  autoUpdater.autoDownload = true;
  autoUpdater.allowPrerelease = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.removeAllListeners('error'); autoUpdater.removeAllListeners('update-downloaded');autoUpdater.removeAllListeners('download-progress');
  autoUpdater.on('error', () => win?.webContents.send('update', 'The update service could not be reached. You can continue using the launcher.'));
  autoUpdater.on('update-downloaded', () => win?.webContents.send('update', 'An update is ready and will install when you close the launcher.'));
  let lastProgress=0;
  autoUpdater.on('download-progress',progress=>{if(Date.now()-lastProgress<1500)return;lastProgress=Date.now();win?.webContents.send('update',`Downloading launcher update: ${Math.round(progress.percent)}%. Your game files stay installed.`);});
  try { const result=await autoUpdater.checkForUpdates();result?.downloadPromise?.catch(()=>{});return {message:result?.isUpdateAvailable?`Launcher ${result.updateInfo.version} is downloading. Finish playing, then close the launcher to install it.`:`You’re up to date (${app.getVersion()}).`}; }
  catch{throw new Error('The update could not be checked. Please retry shortly; your current game remains usable.');}
  finally { updateBusy = false; }
}
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => nativeEngine?.stop());
