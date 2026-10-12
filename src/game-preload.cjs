const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktopGame', {
  sendState: value => ipcRenderer.send('local-state', value),
  onFrame: callback => ipcRenderer.on('remote-frame', (_, value) => callback(value))
});
