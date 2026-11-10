// Secure bridge (contextIsolation on). Exposes only what the renderer needs.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cward', {
  // Pairing window: receive { link, qr } and ask main to (re)send it.
  onPairing: (cb) => ipcRenderer.on('pairing', (_e, d) => cb(d)),
  ready: () => ipcRenderer.send('ui:ready'),
  // Overlay window: live snapshot + build recommendation stream.
  onSnapshot: (cb) => ipcRenderer.on('snapshot', (_e, s) => cb(s)),
  onReco: (cb) => ipcRenderer.on('reco', (_e, r) => cb(r)),
  onEditMode: (cb) => ipcRenderer.on('editmode', (_e, on) => cb(on)),
  getAugments: () => ipcRenderer.invoke('augments:get'),
  // While playing the overlay is click-through; the renderer flips this on only
  // while the pointer is over a clickable panel, so you can click cooldowns etc.
  // without edit mode. No show/hide here (that caused focus churn before).
  setClickable: (on) => ipcRenderer.send('overlay:clickable', !!on),
  // Team cooldown sync (same game, same team).
  sendTeamCd: (m) => ipcRenderer.send('team:cd', m),
  getTeam: () => ipcRenderer.invoke('team:get'),
  onTeam: (cb) => { const h = (_e, m) => cb(m); ipcRenderer.on('team', h); return () => ipcRenderer.removeListener('team', h); },
});
