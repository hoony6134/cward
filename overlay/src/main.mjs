// cward macOS app — Electron main process.
// Runs the existing agent loop in-process (phone companion keeps working),
// shows the phone-pairing QR in a window (no terminal), and (Phase 2+) the
// in-game overlay. Menu-bar (tray) app: no dock, no main window.
import { app, Tray, Menu, BrowserWindow, ipcMain, nativeImage, globalShortcut, screen } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { loadConfig, pairingLink } from './config.mjs';
import { startAgent } from '../../agent/src/agent.mjs';
import { getBuild } from './reco/opgg.mjs';
import { getAugments } from './reco/augments.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let tray = null;
let pairWin = null;
let overlayWin = null;
let cfg = null;
let pairData = null;          // { link, qr }
let latestSnap = null;
let agent = null;
let activeMiss = 0;           // consecutive non-active snapshots (debounces auto-hide)
let overlayShouldShow = false; // what WE want; distinguishes our hide from a system hide

// Single instance only — a second launch just reveals pairing.
if (!app.requestSingleInstanceLock()) { app.quit(); }
app.on('second-instance', () => showPairing());

app.whenReady().then(async () => {
  // NOTE: do NOT app.dock.hide() here. A dock-hidden (accessory) app has macOS
  // order its windows out when it's deactivated (i.e. when you click the game),
  // which made the overlay vanish on click. Keeping a normal activation policy
  // keeps the always-on-top overlay visible. (A dock icon shows; we can hide it
  // properly later via LSUIElement in the packaged build.)
  cfg = loadConfig(app.getPath('userData'));
  pairData = { link: pairingLink(cfg), qr: await QRCode.toDataURL(pairingLink(cfg), { margin: 1, width: 320 }) };

  agent = startAgent(cfg, {
    onSnapshot: (s) => {
      latestSnap = s;
      overlayWin?.webContents.send('snapshot', s);
      // A failed :2999 poll DURING a game makes the agent fall back to LCU and emit
      // kind:'menu' with phase:'InProgress' — that's still in-game, so keep the overlay
      // shown (this was making it vanish during fights). Only a real idle state hides it.
      const inProgress = s.kind === 'menu' && s.phase === 'InProgress';
      const active = s.kind === 'ingame' || s.kind === 'champselect' || inProgress;
      if (active) { activeMiss = 0; setOverlayShown(true); }
      else if (++activeMiss >= 6) setOverlayShown(false); // ~12s sustained idle before hiding
      if (s.kind === 'ingame' || s.kind === 'champselect') updateReco(s);
    },
    onStatus: (s) => { if (tray) tray.setToolTip(`cward — relay ${s}`); },
  });

  createOverlay();
  buildTray();
  registerShortcuts();
  if (process.env.CWARD_SHOW_OVERLAY) setOverlayShown(true); // manual smoke test
  if (cfg.created) showPairing(); // first run: guide the user to pair the phone
});

// Keep running when all windows are closed (tray app).
app.on('window-all-closed', () => { /* do not quit */ });
app.on('before-quit', () => {
  try { agent?.stop(); } catch { /* noop */ }
  globalShortcut.unregisterAll();
});

function buildTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('cward');
  const menu = Menu.buildFromTemplate([
    { label: '폰 연동 QR 보기', click: showPairing },
    { label: '위치 편집 모드  ⌘⇧E', click: () => setEditMode(!editMode) },
    { type: 'separator' },
    { label: '종료', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  if (process.platform === 'darwin' && trayIcon().isEmpty()) tray.setTitle('cward');
}

// ---- Overlay window: transparent, always-on-top, click-through by default ----
function createOverlay() {
  const { workArea } = screen.getPrimaryDisplay();
  // Full work-area overlay; panels are positioned by CSS (left rail, build dock…).
  // The window is click-through everywhere; panels that need clicks toggle mouse
  // capture on hover (ipc 'overlay:mouse-ignore').
  overlayWin = new BrowserWindow({
    x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height,
    transparent: true, frame: false, hasShadow: false,
    resizable: false, movable: false, skipTaskbar: true,
    // NOTE: focusable stays true. A focusable:false window is ordered out by macOS
    // when the app deactivates (clicking the game) → the overlay vanished on click.
    // It's click-through during play anyway, so it never actually takes focus.
    show: false, fullscreenable: false, enableLargerThanScreen: true,
    // Regular window (NOT a panel): a panel has hidesOnDeactivate, so it only shows
    // while OUR app is active — i.e. it vanishes whenever the game is focused. A
    // regular window has no such behavior, so it stays visible. During play the
    // overlay is fully click-through (edit mode off), so our app never activates and
    // never steals the game's focus; dragging happens only in edit mode (⌘⇧E).
    webPreferences: { preload: path.join(__dirname, 'preload.cjs') },
  });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWin.setIgnoreMouseEvents(true, { forward: true }); // click-through; panels toggle capture on hover
  // If macOS orders our window out while we want it shown (it does this occasionally
  // when the app deactivates), bring it straight back. Our own hides clear
  // overlayShouldShow first, so those are respected. Regular windows get this event
  // rarely, so there's no hide/show churn.
  overlayWin.on('hide', () => {
    if (overlayShouldShow && !editMode && overlayWin && !overlayWin.isDestroyed()) overlayWin.showInactive();
  });
  overlayWin.webContents.on('did-finish-load', () => console.log('[overlay] loaded'));
  overlayWin.webContents.on('did-fail-load', (_e, code, desc) => console.log('[overlay] load failed', code, desc));
  overlayWin.loadFile(path.join(__dirname, '../renderer-dist/overlay.html'));
  overlayWin.on('closed', () => { overlayWin = null; });
}

function setOverlayShown(show) {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  overlayShouldShow = show; // record intent BEFORE hide(), so the 'hide' handler won't fight it
  if (show && !overlayWin.isVisible()) overlayWin.showInactive();
  else if (!show && overlayWin.isVisible()) overlayWin.hide();
}

// Edit mode: normally the overlay is fully click-through (never intercepts a game
// click, so it can't steal focus or get hidden). Toggling edit mode makes the whole
// overlay catch the mouse so you can drag panels; toggle off to play again.
let editMode = false;
function setEditMode(on) {
  editMode = on;
  if (!overlayWin || overlayWin.isDestroyed()) return;
  overlayWin.setIgnoreMouseEvents(!on, { forward: true });
  if (on) setOverlayShown(true);
  overlayWin.webContents.send('editmode', on);
}

// ARAM: Mayhem augment reference (name/tier/description) for the overlay.
ipcMain.handle('augments:get', () => getAugments());

// ---- Build recommendations (OP.GG) — in-game AND champ select ----
const buildCache = new Map(); // key -> build | null
const buildInflight = new Set();
const POS = { TOP: 'top', JUNGLE: 'jungle', MIDDLE: 'mid', BOTTOM: 'adc', UTILITY: 'support' };

// championId -> ddragon champ key (e.g. 1 -> "Annie"), loaded once from Data Dragon.
let champKeys = null;
async function champKeyOf(id) {
  if (!champKeys) {
    try {
      const vers = await fetch('https://ddragon.leagueoflegends.com/api/versions.json').then((r) => r.json());
      const d = await fetch(`https://ddragon.leagueoflegends.com/cdn/${vers[0]}/data/en_US/champion.json`).then((r) => r.json());
      champKeys = Object.fromEntries(Object.values(d.data).map((c) => [Number(c.key), c.id]));
    } catch { champKeys = {}; }
  }
  return champKeys[id] || null;
}

// Resolve (champKey, mode, position) for either an in-game or a champ-select snapshot.
async function recoTarget(snap) {
  if (snap.kind === 'ingame') {
    const me = snap.players?.find((p) => p.riotId === snap.active?.riotId);
    if (!me?.champKey) return null;
    return { champKey: me.champKey, mode: snap.game?.mode || 'CLASSIC', position: POS[me.position] || 'mid' };
  }
  if (snap.kind === 'champselect') {
    const id = snap.mine?.championId;
    if (!id) return null; // no champion picked yet
    const champKey = await champKeyOf(id);
    if (!champKey) return null;
    // ARAM champ select has a bench + rerolls; draft SR does not. (Mayhem shares ARAM builds.)
    const mode = (snap.benchEnabled || snap.bench?.length || snap.rerolls) ? 'ARAM' : 'CLASSIC';
    const position = POS[snap.myTeam?.find((c) => c.me)?.position] || 'mid';
    return { champKey, mode, position };
  }
  return null;
}

async function updateReco(snap) {
  const t = await recoTarget(snap);
  if (!t) { overlayWin?.webContents.send('reco', null); return; } // clear panel (no champ yet)
  const key = `${t.champKey}:${t.mode}:${t.position}`;
  if (buildCache.has(key)) { overlayWin?.webContents.send('reco', buildCache.get(key)); return; }
  if (buildInflight.has(key)) return;
  buildInflight.add(key);
  const build = await getBuild({ champion: t.champKey, mode: t.mode, position: t.position });
  buildInflight.delete(key);
  buildCache.set(key, build);
  overlayWin?.webContents.send('reco', build);
}

function registerShortcuts() {
  globalShortcut.register('CommandOrControl+Shift+E', () => setEditMode(!editMode));
}

function trayIcon() {
  // TODO(polish): ship a real template icon. Empty image + title for now.
  return nativeImage.createEmpty();
}

function showPairing() {
  if (pairWin && !pairWin.isDestroyed()) { pairWin.show(); pairWin.focus(); return; }
  pairWin = new BrowserWindow({
    width: 420, height: 580, resizable: false, fullscreenable: false,
    title: 'cward 폰 연동', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs') },
  });
  pairWin.loadFile(path.join(__dirname, '../renderer/pairing.html'));
  pairWin.once('ready-to-show', () => pairWin.show());
  pairWin.on('closed', () => { pairWin = null; });
}

// Renderer announces it's ready → push pairing data.
ipcMain.on('ui:ready', (e) => {
  if (pairData) e.sender.send('pairing', pairData);
});
