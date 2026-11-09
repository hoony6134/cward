// Secure bridge (contextIsolation on). Exposes only what the renderer needs.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cward', {
  // Pairing window: receive { link, qr } and ask main to (re)send it.
  onPairing: (cb) => ipcRenderer.on('pairing', (_e, d) => cb(d)),
  ready: () => ipcRenderer.send('ui:ready'),
  // Overlay window: live snapshot + build recommendation stream.
  onSnapshot: (cb) => ipcRenderer.on('snapshot', (_e, s) => cb(s)),
  onReco: (cb) => ipcRenderer.on('reco', (_e, r) => cb(r)),
  setMouseIgnore: (ignore) => ipcRenderer.send('overlay:mouse-ignore', ignore),
  getAugments: () => ipcRenderer.invoke('augments:get'),
});
