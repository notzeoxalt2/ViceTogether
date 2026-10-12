const { contextBridge, ipcRenderer } = require('electron');
const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
contextBridge.exposeInMainWorld('desktop', {
  init: () => invoke('init'),
  windowAction: action => invoke('window-action', action),
  prepareBundled: () => invoke('prepare-bundled'),
  importGame: candidate => invoke('import-game', candidate),
  importRuntime: () => invoke('import-runtime'),
  repair: () => invoke('repair'),
  createInvite: () => invoke('invite-create'),
  parseInvite: text => invoke('invite-parse', text),
  copyInvite: invite => invoke('invite-copy', invite),
  copyCode: invite => invoke('invite-code-copy',invite),
  copyText: text => invoke('copy-text', text),
  saveSettings: value => invoke('settings', value),
  play: (multiplayer,authoritativeWorld=false) => invoke('play', multiplayer,authoritativeWorld),
  sendFrame: value => invoke('remote-frame', value),
  sendShot: value => invoke('remote-shot',value),
  sendWorld: value => invoke('remote-world',value),
  seatGrant: value=>invoke('seat-grant',value),
  glassRequest: value=>invoke('glass-request',value),
  checkUpdates: () => invoke('updates'),
  quit: () => invoke('quit'),
  on: (name, callback) => {
    if (!['invite', 'progress', 'update', 'game-error', 'local-state', 'local-hit', 'local-world-damage', 'local-equipment', 'local-shot','local-world','local-glass-request','local-seat-state','local-seat-request','detected'].includes(name)) return;
    const handler = (_, payload) => callback(payload);
    ipcRenderer.on(name, handler);
    return () => ipcRenderer.removeListener(name, handler);
  }
});
