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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let tray = null;
let pairWin = null;
let overlayWin = null;
let cfg = null;
let pairData = null;          // { link, qr }
let latestSnap = null;
let agent = null;
let overlayManual = null;     // null = auto (show only in-game); true/false = user override
let overlayInteractive = false;

// Single instance only — a second launch just reveals pairing.
if (!app.requestSingleInstanceLock()) { app.quit(); }
app.on('second-instance', () => showPairing());

app.whenReady().then(async () => {
  app.dock?.hide(); // menu-bar app
  cfg = loadConfig(app.getPath('userData'));
  pairData = { link: pairingLink(cfg), qr: await QRCode.toDataURL(pairingLink(cfg), { margin: 1, width: 320 }) };

  agent = startAgent(cfg, {
    onSnapshot: (s) => {
      latestSnap = s;
      overlayWin?.webContents.send('snapshot', s);
      if (overlayManual === null) setOverlayShown(s.kind === 'ingame'); // auto-follow unless user overrode
      if (s.kind === 'ingame') updateReco(s);
    },
    onStatus: (s) => { if (tray) tray.setToolTip(`cward — relay ${s}`); },
  });

  createOverlay();
  buildTray();
  registerShortcuts();
  if (process.env.CWARD_SHOW_OVERLAY) { overlayManual = true; setOverlayShown(true); } // manual smoke test
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
    { label: '오버레이 표시/숨기기  ⌘⇧O', click: () => toggleOverlay() },
    { label: '오버레이 조작 모드  ⌘⇧I', click: () => setInteractive(!overlayInteractive) },
    { type: 'separator' },
    { label: '종료', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  if (process.platform === 'darwin' && trayIcon().isEmpty()) tray.setTitle('cward');
}

// ---- Overlay window: transparent, always-on-top, click-through by default ----
function createOverlay() {
  const { workArea } = screen.getPrimaryDisplay();
  const w = 340;
  const h = Math.min(760, workArea.height - 24);
  overlayWin = new BrowserWindow({
    x: workArea.x + workArea.width - w - 12,
    y: workArea.y + 12,
    width: w, height: h,
    transparent: true, frame: false, hasShadow: false,
    resizable: false, movable: true, skipTaskbar: true,
    focusable: false, show: false, fullscreenable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs') },
  });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWin.setIgnoreMouseEvents(true, { forward: true }); // click-through until interactive
  overlayWin.webContents.on('did-finish-load', () => console.log('[overlay] loaded'));
  overlayWin.webContents.on('did-fail-load', (_e, code, desc) => console.log('[overlay] load failed', code, desc));
  overlayWin.loadFile(path.join(__dirname, '../renderer-dist/overlay.html'));
  overlayWin.on('closed', () => { overlayWin = null; });
}

function setOverlayShown(show) {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  if (show && !overlayWin.isVisible()) overlayWin.showInactive();
  else if (!show && overlayWin.isVisible()) overlayWin.hide();
}

function toggleOverlay() {
  if (!overlayWin || overlayWin.isDestroyed()) createOverlay();
  const show = !overlayWin.isVisible();
  overlayManual = show; // user override sticks until they toggle again
  setOverlayShown(show);
}

function setInteractive(on) {
  overlayInteractive = on;
  if (!overlayWin || overlayWin.isDestroyed()) return;
  overlayWin.setIgnoreMouseEvents(!on, { forward: true });
  overlayWin.setFocusable(on);
  if (on) { overlayManual = true; setOverlayShown(true); overlayWin.focus(); }
}

// ---- Build recommendations (OP.GG), fetched once per champ+mode+position ----
const buildCache = new Map(); // key -> build | null
const buildInflight = new Set();
const POS = { TOP: 'top', JUNGLE: 'jungle', MIDDLE: 'mid', BOTTOM: 'adc', UTILITY: 'support' };

async function updateReco(snap) {
  const me = snap.players?.find((p) => p.riotId === snap.active?.riotId);
  if (!me?.champKey) return;
  const mode = snap.game?.mode || 'CLASSIC';
  const position = POS[me.position] || 'mid';
  const key = `${me.champKey}:${mode}:${position}`;
  if (buildCache.has(key)) { overlayWin?.webContents.send('reco', buildCache.get(key)); return; }
  if (buildInflight.has(key)) return;
  buildInflight.add(key);
  const build = await getBuild({ champion: me.champKey, mode, position });
  buildInflight.delete(key);
  buildCache.set(key, build);
  overlayWin?.webContents.send('reco', build);
}

function registerShortcuts() {
  globalShortcut.register('CommandOrControl+Shift+O', () => toggleOverlay());
  globalShortcut.register('CommandOrControl+Shift+I', () => setInteractive(!overlayInteractive));
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
