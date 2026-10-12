const fs = require('node:fs/promises');
const { createReadStream, createWriteStream } = require('node:fs');
const { createHash, randomBytes } = require('node:crypto');
const { createBrotliDecompress } = require('node:zlib');
const { pipeline } = require('node:stream/promises');
const path = require('node:path');
const { readJSON, writeJSON } = require('./storage.cjs');

const ESSENTIAL = ['models/gta3.img', 'models/gta3.dir', 'data/gta_vc.dat', 'anim/ped.ifp', 'mss32.dll'];
const AUDIO_PLUGINS = new Set(['mp3dec.asi','mssa3d.m3d','mssa3d2.m3d','mssds3dh.m3d','mssds3ds.m3d','msseax.m3d','msseax3.m3d','mssfast.m3d','mssrsx.m3d','reverb3.flt']);
const RUNTIME = ['vcbr/vc-sky-en-v6.wasm.br', 'vcbr/vc-sky-en-v6.data.br'];
const ALLOWED = new Set(['.img', '.dir', '.dat', '.zon', '.ifp', '.txd', '.dff', '.col', '.ipl', '.ide', '.cfg', '.ini', '.scm', '.sc', '.gxt', '.adf', '.wav', '.mp3', '.mpg', '.sdt', '.raw', '.cache', '.txt', '.bmp', '.png', '.jpg', '.br']);
function inside(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\0') || path.isAbsolute(relative) || relative.includes(':')) throw new Error('Unsafe file path.');
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(path.resolve(root) + path.sep)) throw new Error('Unsafe file path.');
  return resolved;
}
async function filesIn(root, prefix = '') {
  const result = [];
  for (const entry of await fs.readdir(path.join(root, prefix), { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) result.push(...await filesIn(root, relative));
    else if (entry.isFile() && (ALLOWED.has(path.extname(entry.name).toLowerCase()) || (!prefix && entry.name.toLowerCase() === 'mss32.dll') || (prefix.toLowerCase() === 'mss' && AUDIO_PLUGINS.has(entry.name.toLowerCase())))) result.push(relative);
    if (result.length > 100000) throw new Error('This folder contains too many files. Select the Vice City folder.');
  }
  return result;
}
async function inventory(root) {
  const info = await fs.lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Select a regular game folder.');
  const files = await filesIn(root);
  const map = new Map(files.map(f => [f.replaceAll('\\', '/').toLowerCase(), f]));
  return { files, map };
}
async function inspectGame(root) {
  const { map } = await inventory(root);
  const missing = ESSENTIAL.filter(f => !map.has(f));
  return { root, valid: !missing.length, missing };
}
async function gameBytes(root) {
  const files = await filesIn(root);
  let bytes=0;
  for(const file of files) bytes += (await fs.stat(inside(root,file))).size;
  return bytes;
}
async function detectGames() {
  const roots = new Set();
  const programRoots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean);
  for (const base of programRoots) {
    for (const suffix of ['Rockstar Games/Grand Theft Auto Vice City', 'Rockstar Games/GTA Vice City', 'Steam/steamapps/common/Grand Theft Auto Vice City']) roots.add(path.join(base, suffix));
    const steam = path.join(base, 'Steam');
    try {
      const vdf = await fs.readFile(path.join(steam, 'steamapps/libraryfolders.vdf'), 'utf8');
      for (const match of vdf.matchAll(/"path"\s+"([^"]+)"/g)) roots.add(path.join(match[1].replaceAll('\\\\', '\\'), 'steamapps/common/Grand Theft Auto Vice City'));
    } catch {}
  }
  for (const drive of ['C', 'D', 'E', 'F']) {
    for (const suffix of ['Games/GTA Vice City', 'Games/Grand Theft Auto Vice City', 'SteamLibrary/steamapps/common/Grand Theft Auto Vice City']) roots.add(`${drive}:/${suffix}`);
  }
  const detected = [];
  for (const root of roots) {
    try {
      await fs.access(root);
      const found = await inspectGame(root);
      if (found.valid) detected.push(found);
    } catch {}
  }
  return detected;
}
async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
class AssetStore {
  constructor(root, progress = () => {}) { this.root = root; this.progress = progress; this.busy = false; }
  async import(source, type = 'game') {
    if (this.busy) throw new Error('Please wait for the current import or repair to finish.');
    this.busy = true;
    try { return await this.importUnlocked(source, type); } finally { this.busy = false; }
  }
  async importUnlocked(source, type) {
    const target = path.join(this.root, type);
    const sourceReal = await fs.realpath(source);
    const storeReal = path.resolve(this.root);
    if (sourceReal.toLowerCase() === storeReal.toLowerCase() || sourceReal.toLowerCase().startsWith(storeReal.toLowerCase() + path.sep)) throw new Error('Choose your original installation, outside the launcher cache.');
    const { files, map } = await inventory(sourceReal);
    const required = type === 'runtime' ? RUNTIME : ESSENTIAL;
    const missing = required.filter(f => !map.has(f));
    if (missing.length) throw new Error(type === 'runtime' ? 'This is not a prepared reVCDOS runtime folder. Both vcbr engine files are required.' : `This does not look like the original PC edition of Vice City. Missing ${missing.join(', ')}. Select another folder.`);
    if (type === 'runtime' && !files.some(f => f.replaceAll('\\', '/').startsWith('vcsky/'))) throw new Error('The runtime folder also needs its prepared vcsky assets.');
    const previous = await readJSON(path.join(target, 'manifest.json'), { files: [] });
    const old = new Map(previous.files.map(f => [f.path, f]));
    let total = 0;
    const entries = [];
    for (const relative of files) {
      const stat = await fs.stat(inside(sourceReal, relative));
      total += stat.size;
      if (stat.size > 3 * 1024 ** 3 || total > 12 * 1024 ** 3) throw new Error('The selected folder is larger than a supported Vice City installation.');
      entries.push({ path: relative, size: stat.size, sourceMtime: stat.mtimeMs });
    }
    await fs.mkdir(target, { recursive: true });
    const disk = await fs.statfs(target);
    if (Number(disk.bavail) * Number(disk.bsize) < total + 512 * 1024 ** 2 && !previous.files.length) throw new Error('There is not enough free space to cache your game safely. Free some space on this drive and try again.');
    let done = 0;
    const manifest = { format: 1, type, source: sourceReal, importedAt: new Date().toISOString(), files: [] };
    for (const entry of entries) {
      const from = inside(sourceReal, entry.path);
      const to = inside(target, entry.path);
      const cached = old.get(entry.path);
      let reuse = false;
      if (cached && cached.size === entry.size && cached.sourceMtime === entry.sourceMtime) {
        try { reuse = (await hashFile(to)) === cached.sha256; } catch {}
      }
      if (reuse) entry.sha256 = cached.sha256;
      else {
        await fs.mkdir(path.dirname(to), { recursive: true });
        const temp = to + '.' + randomBytes(5).toString('hex') + '.tmp';
        try {
          await pipeline(createReadStream(from), createWriteStream(temp, { flags: 'wx' }));
          entry.sha256 = await hashFile(temp);
          await fs.rename(temp, to);
        } finally { await fs.rm(temp, { force: true }).catch(() => {}); }
      }
      manifest.files.push(entry);
      done += entry.size;
      this.progress({ phase: 'Importing your files', file: entry.path, done, total });
    }
    // Publish the manifest only when every file has been copied successfully.
    await writeJSON(path.join(target, 'manifest.json'), manifest);
    if (type === 'runtime') await this.prepareRuntime(manifest);
    return this.status();
  }
  async prepareRuntime(manifest) {
    const target = path.join(this.root, 'runtime');
    const decoded = path.join(target, 'decoded');
    await fs.mkdir(decoded, { recursive: true });
    for (const relative of RUNTIME) {
      const entry = manifest.files.find(f => f.path.replaceAll('\\', '/').toLowerCase() === relative);
      const name = relative.endsWith('.wasm.br') ? 'index.wasm' : 'index.data';
      const output = path.join(decoded, name);
      const stamp = await readJSON(output + '.json');
      try { if (stamp.sourceHash === entry.sha256 && (await hashFile(output)) === stamp.sha256) continue; } catch {}
      const temp = output + '.tmp';
      try {
        await pipeline(createReadStream(inside(target, entry.path)), createBrotliDecompress(), createWriteStream(temp));
        if (name === 'index.wasm') {
          const handle = await fs.open(temp);
          const magic = Buffer.alloc(8);
          try { await handle.read(magic, 0, 8, 0); } finally { await handle.close(); }
          if (!magic.equals(Buffer.from([0,97,115,109,1,0,0,0]))) throw new Error('The engine file is not valid WebAssembly.');
        }
        await fs.rename(temp, output);
        await writeJSON(output + '.json', { sourceHash: entry.sha256, sha256: await hashFile(output) });
      } finally { await fs.rm(temp, { force: true }).catch(() => {}); }
    }
  }
  async status() {
    const game = await readJSON(path.join(this.root, 'game/manifest.json'), null);
    const runtime = await readJSON(path.join(this.root, 'runtime/manifest.json'), null);
    let gameReady = !!game, runtimeReady = !!runtime;
    for (const [type, manifest] of [['game', game], ['runtime', runtime]]) {
      if (!manifest) continue;
      for (const relative of type === 'game' ? ESSENTIAL : RUNTIME) {
        const entry = manifest.files.find(f => f.path.replaceAll('\\', '/').toLowerCase() === relative);
        try {
          if (!entry || (await fs.stat(inside(path.join(this.root, type), entry.path))).size !== entry.size) throw new Error('Missing file');
        } catch { if (type === 'game') gameReady = false; else runtimeReady = false; }
      }
    }
    if (runtimeReady) {
      try { await fs.access(path.join(this.root, 'runtime/decoded/index.wasm')); await fs.access(path.join(this.root, 'runtime/decoded/index.data')); }
      catch { runtimeReady = false; }
    }
    return { gameReady, runtimeReady, gameFiles: game?.files.length || 0, gameSource: game?.source || '', multiplayerReady: false };
  }
  async repair() {
    if (this.busy) throw new Error('An import or repair is already running.');
    this.busy = true;
    try {
      let repaired = 0;
      for (const type of ['game', 'runtime']) {
        const target = path.join(this.root, type);
        const manifest = await readJSON(path.join(target, 'manifest.json'), null);
        if (!manifest) continue;
        let index = 0;
        for (const entry of manifest.files) {
          const to = inside(target, entry.path);
          this.progress({ phase: 'Checking your files', file: entry.path, done: index++, total: manifest.files.length });
          let hash;
          try { hash = await hashFile(to); } catch {}
          if (hash === entry.sha256) continue;
          const from = inside(manifest.source, entry.path);
          let sourceHash;
          try { sourceHash = await hashFile(from); } catch {}
          if (sourceHash !== entry.sha256) throw new Error(`Your original copy of ${entry.path} is missing or has changed. Import your game folder again.`);
          await fs.mkdir(path.dirname(to), { recursive: true });
          await fs.copyFile(from, to + '.repair');
          await fs.rename(to + '.repair', to);
          repaired++;
        }
        if (type === 'runtime') await this.prepareRuntime(manifest);
      }
      return { ...await this.status(), repaired };
    } finally { this.busy = false; }
  }
  async ensureReady() {
    if(this.busy) throw new Error('Please wait for your game import or repair to finish.');
    const manifest = await readJSON(path.join(this.root,'game/manifest.json'), null);
    if(!manifest) throw new Error('Import your legally obtained Vice City folder first.');
    for(const entry of manifest.files) {
      let okay = false;
      try { const stat=await fs.stat(inside(path.join(this.root,'game'),entry.path));okay=stat.isFile() && stat.size===entry.size; } catch {}
      if(!okay) return this.repair();
    }
    return this.status();
  }
}
module.exports = { AssetStore, inspectGame, detectGames, inside, hashFile, ESSENTIAL, gameBytes };
