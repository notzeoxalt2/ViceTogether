import { PrivateLobby } from './network.bundle.js';
import { setupFriends } from './social-ui.js';
const $ = id => document.getElementById(id);
for(const operation of ['minimize','maximize','close'])$('window-'+operation).addEventListener('click',()=>call(window.desktop.windowAction(operation)).catch(error=>notice(error.message)));
let state, invitation, lobbyInfo, deferredInvite, latestDetected;
let social;
function showDetected(found) {
  $('detected').replaceChildren(); $('detected').hidden = !found.length;
  for(let i=0;i<found.length;i++) { const option=document.createElement('option');option.value=i;option.textContent=found[i].root;$('detected').append(option); }
}
window.desktop.on('detected', found => { latestDetected = found; if(state) { state.detected=found;showDetected(found); } });
const lobby = new PrivateLobby();
function notice(text) { $('notice').textContent = text; $('notice').hidden = !text; }
function renderLibrary() {
  if(!state)return;
  const search=$('library-search').value.trim().toLowerCase();
  const games=state.games.filter(game=>`${game.title} ${game.mod}`.toLowerCase().includes(search));
  $('game-library').replaceChildren();$('library-empty').hidden=games.length>0;
  $('library-count').textContent=`${games.length} ${games.length===1?'GAME':'GAMES'}`;
  for(const game of games){
    const card=document.createElement('article');card.className='game-card';card.dataset.gameId=game.id;
    const cover=document.createElement('div');cover.className='game-cover';cover.setAttribute('aria-hidden','true');
    const body=document.createElement('div');body.className='game-card-body';
    const status=document.createElement('span');status.className='tag';status.textContent=game.status.toUpperCase();
    const title=document.createElement('h2');title.textContent=game.title;
    const description=document.createElement('p');description.textContent='Back to the beach. Bring the crew.';
    const setup=document.createElement('p');setup.className='game-setup-status';setup.textContent=state.assets.gameReady&&state.engineBuilt?'● Installed · Your game files are ready':game.assetSetup;
    const meta=document.createElement('div');meta.className='game-card-meta';
    for(const text of [`${game.minimumPlayers}–${game.maximumPlayers} players`,'Private lobbies','Singleplayer']){const item=document.createElement('span');item.textContent=text;meta.append(item);}
    const actions=document.createElement('div');actions.className='game-card-actions';
    const button=document.createElement('button');button.className='primary';button.textContent=state.assets.gameReady&&state.engineBuilt?'▷ Play singleplayer':'Set up Vice City →';button.addEventListener('click',()=>{if(state.assets.gameReady&&state.engineBuilt){if(!$('play').disabled)$('play').click();}else page('play');});
    const details=document.createElement('button');details.className='game-details';details.dataset.libraryDetails='true';details.textContent='Game setup ↗';details.addEventListener('click',()=>page('play'));
    actions.append(button,details);body.append(status,title,description,meta,actions,setup);card.append(cover,body);$('game-library').append(card);
  }
}
$('library-search').addEventListener('input',renderLibrary);
async function call(operation) {
  const result = await operation;
  if (!result.ok) throw new Error(result.error.replace(/^Error invoking remote method '[^']+': Error: /, ''));
  return result.value;
}
function page(name) {
  document.querySelectorAll('.page').forEach(el => el.hidden = el.id !== `page-${name}`);
  document.querySelectorAll('nav button').forEach(el => el.classList.toggle('active', el.dataset.page === name));
  $('crumb').textContent = name.toUpperCase();
}
const profileButton=$('profile');
profileButton.setAttribute('role','button');profileButton.tabIndex=0;profileButton.title='Edit your local profile';
function editProfile(){page('settings');$('name').focus();$('name').select();}
profileButton.addEventListener('click',editProfile);
profileButton.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();editProfile();}});
function action(id, operation) {
  $(id).addEventListener('click', async () => {
    const button = $(id); button.disabled = true;
    try { await operation(); } catch (error) { notice(error.message); }
    finally { button.disabled = false; $('progress-overlay').hidden = true; }
  });
}
function assetStatus(assets) {
  state.assets = assets;
  lobby.setReady(!!assets.gameReady && !!state.engineBuilt && state.capabilities?.nativeMultiplayer!==false);
  $('game-title').textContent = assets.gameReady ? 'Your game files are cached' : 'Bring your Vice City';
  $('game-description').textContent = assets.gameReady ? `${assets.gameFiles} files stored locally. Native reVC engine. On-foot multiplayer is an early prototype.` : 'Choose your legally obtained PC game files. We’ll keep a local copy for faster starts.';
  $('play').textContent = assets.gameReady ? '▷ Play singleplayer' : '▷ Set up your game';
  $('lobby-setup').hidden=!!assets.gameReady;
  renderLibrary();
}
async function importGame() {
  const index = $('detected').hidden ? undefined : Number($('detected').value);
  const result = await call(window.desktop.importGame(index));
  if (result) { assetStatus(result); notice('Your files are imported. No game assets were downloaded.'); }
}
async function join(invite) {
  await lobby.join(invite, state.settings.name, { iceServers: state.config.iceServers });
  invitation = invite; $('lobby').hidden = false; page('host');
  social?.update(state.settings.name, 'In private lobby');
  $('room-code').textContent=invite.code||'Legacy invite';
  notice('Looking for your friend… Keep their lobby open.');
}
document.querySelectorAll('[data-page]').forEach(el => el.addEventListener('click', () => page(el.dataset.page)));
lobby.addEventListener('notice', event => notice(event.detail));
lobby.addEventListener('frame', event => window.desktop.sendFrame(event.detail));
lobby.addEventListener('launch', () => call(window.desktop.play(true,lobby.isHost)).catch(e => { lobby.sessionStarted=false; notice(e.message); }));
window.desktop.on('local-state', state => lobby.sendState(state));
window.desktop.on('local-hit', hit => lobby.sendHit(hit));
window.desktop.on('local-world-damage', event => lobby.sendWorldDamage(event));
window.desktop.on('local-equipment',weapon=>lobby.sendEquipment(weapon));
window.desktop.on('local-shot',shot=>lobby.sendShot(shot));
lobby.addEventListener('shot',event=>window.desktop.sendShot(event.detail));
window.desktop.on('local-world',frame=>lobby.sendWorld(frame));
window.desktop.on('local-glass-request',state=>lobby.sendGlass(state));
lobby.addEventListener('glass-request',event=>window.desktop.glassRequest(event.detail));
lobby.addEventListener('ambient',event=>window.desktop.sendWorld(event.detail));
let lastSeat=-1;
window.desktop.on('local-seat-state',seat=>{if(lobby.isHost)lobby.sendSeat({driver:true,car:seat});else if(seat.id<0 && lastSeat>=0)lobby.sendSeat({release:true});lastSeat=seat.id;});
window.desktop.on('local-seat-request',request=>lobby.sendSeat(request));
lobby.addEventListener('seat-grant',event=>window.desktop.seatGrant(event.detail));
lobby.addEventListener('change', event => {
  lobbyInfo = event.detail;
  $('connection').textContent = lobbyInfo.connected ? lobbyInfo.isHost ? 'HOSTING' : 'CONNECTED' : 'CONNECTING';
  $('players').replaceChildren();
  for (const player of lobbyInfo.players) {
    const row = document.createElement('div'); row.className = 'player';
    const name = document.createElement('strong'); name.textContent = player.name + (player.self ? ' (you)' : '');
    const info = document.createElement('span'); info.textContent = `${player.host ? 'HOST · ' : ''}${player.ready ? 'READY' : 'IMPORT GAME FILES'} · ${player.ping === null ? 'Measuring ping…' : player.ping + ' ms'}`;
    row.append(name, info); $('players').append(row);
  }
  $('lobby-note').textContent = `${lobbyInfo.players.length}/8 players · Private WebRTC lobby · On-foot prototype`;
  social?.update(state.settings.name, 'In private lobby', lobbyInfo.isHost && invitation?.code ? `vicetogether://join/${invitation.code}` : null);
  $('multiplayer').disabled = state?.capabilities?.nativeMultiplayer===false || !state?.engineBuilt || !state?.assets.gameReady || !lobbyInfo.isHost || lobbyInfo.players.length<2 || lobby.sessionStarted || lobbyInfo.players.some(p=>!p.ready);
  if (lobbyInfo.connected && lobbyInfo.players.length > 1) notice('Your lobby is connected. Movement, combat and the shared world are experimental. Guest driving and complete police interactions remain unfinished.');
});
action('import-game', importGame);
action('lobby-import', importGame);
action('play', async () => { if (!state.assets.gameReady) await importGame(); else await call(window.desktop.play()); });
action('host', async () => {
  const invite = await call(window.desktop.createInvite());
  invitation = await lobby.host(invite, state.settings.name, { iceServers: state.config.iceServers });
  social?.update(state.settings.name, 'In private lobby', invitation.code ? `vicetogether://join/${invitation.code}` : null);
  $('room-code').textContent=invitation.code||'Legacy invite';
  $('lobby').hidden = false;
  notice('Your private lobby is open. Copy its invite to share it.');
});
$('library-host').addEventListener('click',()=>{page('host');if(!$('host').disabled)$('host').click();});
action('join', async () => join(await call(window.desktop.parseInvite($('invite-input').value))));
action('multiplayer', () => lobby.startGame());
action('copy', async () => { await call(window.desktop.copyInvite(invitation)); notice(state.config.inviteBaseUrl ? 'Invite copied. Send it to your friend.' : 'Invite copied. Your friend needs this alpha installed, then can paste the link into Join. The install-from-link website is not published yet.'); });
action('copy-code',async()=>{await call(window.desktop.copyCode(invitation));notice('Room code copied. Your friend can paste it into Join.');});
action('retry', async () => { if (lobbyInfo?.isHost) notice('The host lobby is open. Ask your friend to retry their invite.'); else if (invitation) await join(invitation); });
action('leave', async () => { await lobby.leave(); invitation = null; social?.update(state.settings.name, 'In launcher'); $('lobby').hidden = true; notice('You left the lobby.'); });
action('save', async () => {
  state.settings = await call(window.desktop.saveSettings({ name: $('name').value, fps: Number($('fps').value), fullscreen: $('fullscreen').checked,mouseSensitivity:Number($('mouse-sensitivity').value) }));
  $('profile').firstChild.textContent = state.settings.name;
  social?.update(state.settings.name, invitation ? 'In private lobby' : 'In launcher', lobbyInfo?.isHost && invitation?.code ? `vicetogether://join/${invitation.code}` : null);
  document.querySelector('.sidebar-bottom .avatar').textContent=state.settings.name[0].toUpperCase();
  notice('Preferences saved. Your player name applies when you next join a lobby or launch a game.');
});
action('repair', async () => { const result = await call(window.desktop.repair()); assetStatus(result); notice(`File check complete. ${result.repaired} file(s) restored.`); });
action('updates', async () => { const result = await call(window.desktop.checkUpdates()); notice(result.message); });
action('import-runtime', async () => { const result = await call(window.desktop.importRuntime()); if (result) { assetStatus(result); notice('Legacy runtime imported. It has no multiplayer integration.'); } });
action('exit', () => window.desktop.quit());
window.desktop.on('invite', invite => { if(!state) { deferredInvite = invite; return; } join(invite).catch(e => notice(e.message)); });
window.desktop.on('progress', progress => {
  $('progress-overlay').hidden = false;
  $('progress-title').textContent = progress.phase;
  $('progress-file').textContent = progress.file;
  $('progress').value = progress.total ? Math.round(progress.done / progress.total * 100) : 0;
});
window.desktop.on('update', notice); window.desktop.on('game-error', notice);
try {
  state = await call(window.desktop.init());
  social = setupFriends({ state, call, notice, join });
  page('library');
  if(state.selfTest) {
    window.testLobby=lobby;window.testEvents=[];
    for(const name of ['frame','change','launch','notice','shot','ambient','seat-grant'])lobby.addEventListener(name,e=>{window.testEvents.push({name,detail:e.detail});if(window.testEvents.length>500)window.testEvents.shift();});
  }
  $('mouse-sensitivity').value=String(state.settings.mouseSensitivity??1.5);
  $('name').value = state.settings.name; $('fps').value = String(state.settings.fps); $('fullscreen').checked = state.settings.fullscreen;
  $('profile').firstChild.textContent = state.settings.name; $('version').textContent = state.version;
  if(state.config.updateFeedUrl)$('update-note').textContent='Launcher updates download automatically and install when you close the app. Your game files and saves stay in place.';
  document.querySelector('.sidebar-bottom .avatar').textContent=state.settings.name[0].toUpperCase();
  assetStatus(state.assets);
  if (state.engineBuilt) { $('multiplayer').textContent = 'Start experimental on-foot session'; $('build-status').textContent = 'Native engine with real on-foot replication, tested with two games on this PC. Internet connectivity, visual smoothness, vehicles and combat remain unfinished.'; }
  if(state.backend==='rust'){
    document.querySelector('header .tag').textContent='RUST MIGRATION PREVIEW';
    $('multiplayer').textContent='Multiplayer bridge migration pending';
    $('build-status').textContent='Rust preview: library, settings, import, repair and singleplayer. Native multiplayer, protocol registration and updates still use the Electron prototype.';
    notice('Rust migration preview. Singleplayer and library tools are available; multiplayer gameplay still needs the Electron build.');
  }
  state.detected = latestDetected || state.detected;
  showDetected(state.detected);
  if(!state.assets.gameReady) {
    try { const prepared=await call(window.desktop.prepareBundled()); if(prepared)assetStatus(prepared); }
    finally { $('progress-overlay').hidden=true; }
  }
  if (deferredInvite || state.invite) await join(deferredInvite || state.invite);
  if(state.backend==='rust'&&state.verification){await call(window.desktop.verificationResult({backend:'rust',uiInitialized:true,gameCards:document.querySelectorAll('[data-game-id="vice-city"]').length,gameReady:state.assets.gameReady,gameFiles:state.assets.gameFiles,nativeEnginePresent:state.engineBuilt,multiplayerNativeBridge:state.capabilities.nativeMultiplayer,titleBarTop:document.querySelector('.window-bar').getBoundingClientRect().top,rootOverflow:getComputedStyle(document.body).overflowY}));}
} catch (error) { notice(error.message); }
