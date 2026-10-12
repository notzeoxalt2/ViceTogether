import { SnapshotBuffer } from './sync.js';
const canvas = document.getElementById('canvas');
const status = document.getElementById('status');
const progress = document.getElementById('progress');
const remotes = new Map();
let module, localPointer = 0, syncing = false;
const maxCacheBytes = 32 * 1024 * 1024;
let cacheBytes = 0;
const chunks = new Map();
function fail(error) {
  document.getElementById('loading').hidden = false;
  status.textContent = `The game could not start: ${error.message || error}. Your files are kept. Close this window and run Check & repair.`;
  progress.hidden = true;
}
window.addEventListener('error', event => fail(event.error || event.message));
window.addEventListener('unhandledrejection', event => fail(event.reason));
document.getElementById('capture').onclick = () => { canvas.focus(); canvas.requestPointerLock(); };
// A bounded archive cache keeps IMG/audio data outside the WASM heap. Range reads are local.
function mountArchive(FS, file, target) {
  FS.createFile(target.slice(0, target.lastIndexOf('/')), target.slice(target.lastIndexOf('/') + 1), {}, true, false);
  const node = FS.lookupPath(target).node;
  node.usedBytes = file.size;
  const oldNode = node.node_ops;
  node.node_ops = { ...oldNode, getattr: entry => ({ ...oldNode.getattr(entry), size: file.size }) };
  node.stream_ops = {
    ...node.stream_ops,
    llseek(stream, offset, whence) {
      const next = whence === 0 ? offset : whence === 1 ? stream.position + offset : file.size + offset;
      if (next < 0) throw new FS.ErrnoError(28);
      return next;
    },
    read(stream, buffer, offset, length, position) {
      const count = Math.min(length, file.size - position);
      if (count <= 0) return 0;
      let copied = 0;
      while (copied < count) {
        const start = Math.floor((position + copied) / 262144) * 262144;
        const key = file.path + ':' + start;
        let data = chunks.get(key);
        if (!data) {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', `assets/${file.path.split('/').map(encodeURIComponent).join('/')}`, false);
          xhr.overrideMimeType('text/plain; charset=x-user-defined');
          xhr.setRequestHeader('Range', `bytes=${start}-${Math.min(start + 262143, file.size - 1)}`);
          xhr.send();
          if (xhr.status !== 206) throw new Error(`Could not read ${file.path} locally (${xhr.status}).`);
          data = Uint8Array.from(xhr.responseText, c => c.charCodeAt(0) & 255);
          if (!data.length) throw new Error('An archive read returned no data.');
          while (cacheBytes + data.length > maxCacheBytes && chunks.size) {
            const first = chunks.keys().next().value;
            cacheBytes -= chunks.get(first).length; chunks.delete(first);
          }
          chunks.set(key, data); cacheBytes += data.length;
        }
        const within = position + copied - start;
        const take = Math.min(data.length - within, count - copied);
        if (take <= 0) throw new Error('Unexpected end of archive.');
        buffer.set(data.subarray(within, within + take), offset + copied);
        copied += take;
      }
      return copied;
    }
  };
}
async function mountFiles(m) {
  const response = await fetch('assets/index.json');
  if (!response.ok) throw new Error('Import your own Vice City game folder first.');
  const files = await response.json();
  const FS = m.FS;
  FS.mkdirTree('/gtavc');
  progress.max = files.length;
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    const target = '/gtavc/' + file.path.replaceAll('\\', '/').toLowerCase();
    FS.mkdirTree(target.slice(0, target.lastIndexOf('/')));
    status.textContent = `Preparing your files (${index + 1}/${files.length})`;
    progress.value = index + 1;
    if (file.size >= 4 * 1024 * 1024) mountArchive(FS, file, target);
    else {
      const data = await fetch('assets/' + file.path.replaceAll('\\', '/').split('/').map(encodeURIComponent).join('/'));
      if (!data.ok) throw new Error('A cached game file is missing.');
      FS.writeFile(target, new Uint8Array(await data.arrayBuffer()));
    }
  }
  FS.mkdirTree('/gtavc/userfiles');
  FS.mount(m.IDBFS, {}, '/gtavc/userfiles');
  await new Promise((resolve, reject) => FS.syncfs(true, error => error ? reject(error) : resolve()));
  FS.chdir('/gtavc');
}
window.desktopGame.onFrame(frame => {
  if (!module || !syncing || !Array.isArray(frame)) return;
  const live = new Set();
  for (const entry of frame.slice(0, 8)) {
    if (!entry || typeof entry.id !== 'string' || entry.self) continue;
    live.add(entry.id);
    if (!remotes.has(entry.id)) {
      const used = new Set([...remotes.values()].map(r => r.slot));
      const slot = [0, 1, 2, 3, 4, 5, 6].find(n => !used.has(n));
      if (slot === undefined) continue;
      remotes.set(entry.id, { slot, history: new SnapshotBuffer() });
    }
    remotes.get(entry.id).history.push(entry.state, performance.now());
  }
  for (const [id, remote] of remotes) if (!live.has(id)) { module._VT_RemoveRemote(remote.slot); remotes.delete(id); }
});
function sendLocalState() {
  if (module && syncing && module._ViceGameState() === 9) {
    if (module._VT_ReadLocal(localPointer)) {
      const local = Array.from(module.HEAPF32.subarray(localPointer / 4, localPointer / 4 + 10));
      window.desktopGame.sendState(local);
    }
  }
}
function renderRemotes() {
  if (module && syncing && module._ViceGameState() === 9) {
    for (const remote of remotes.values()) {
      const state = remote.history.sample(performance.now() - 100);
      if (state) module._VT_SetRemote(remote.slot, state[0], state[1], state[2], state[3], state[7]);
    }
  }
  requestAnimationFrame(renderRemotes);
}
try {
  const { default: createEngine } = await import('./reVC.js');
  let mountError;
  module = await createEngine({
    canvas, noInitialRun: true,
    print: text => console.log(text), printErr: text => console.error(text),
    onAbort: message => fail(new Error(message)),
    preRun: [function(m) {
      m.addRunDependency('local-assets');
      mountFiles(m).catch(error => { mountError = error; }).finally(() => m.removeRunDependency('local-assets'));
    }]
  });
  if (mountError) throw mountError;
  syncing = new URLSearchParams(location.search).get('multiplayer') === '1';
  if (syncing && !module._VT_Version) throw new Error('This engine has no multiplayer bridge.');
  if (syncing) { localPointer = module._malloc(40); module._VT_Enable(1); }
  document.getElementById('loading').hidden = true;
  document.getElementById('hud').hidden = false;
  document.getElementById('mode').textContent = syncing ? 'EXPERIMENTAL · ON-FOOT SYNC ONLY' : 'SINGLEPLAYER';
  canvas.focus();
  setInterval(sendLocalState, 50);
  requestAnimationFrame(renderRemotes);
  module.callMain([]);
} catch (error) { fail(error); }
