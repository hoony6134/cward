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
let overlayManual = null;     // null = auto (show only in-game); true/false = user override
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
      const active = s.kind === 'ingame' || s.kind === 'champselect';
      // Auto-follow: show in game/champ-select unless the user hid it for THIS game.
      // Leaving the game resets the manual override so the next game auto-shows again.
      // The 3-tick debounce tolerates a transient failed :2999 poll without flicker.
      if (active) {
        activeMiss = 0;
        if (overlayManual !== false) setOverlayShown(true);
      } else if (++activeMiss >= 3) {
        setOverlayShown(false);
        overlayManual = null;
      }
      if (active) updateReco(s);
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
    focusable: false, show: false, fullscreenable: false, enableLargerThanScreen: true,
    // Non-activating panel: clicking/dragging the overlay does NOT activate our app,
    // so the game keeps focus (otherwise borderless LoL drops to the desktop).
    type: 'panel',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs') },
  });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  // Clicking the game deactivates this dock-hidden (accessory) app, and macOS then
  // orders our window out — a "hide" event we didn't ask for. Bring it straight back
  // (showInactive doesn't steal focus from the game). Our own hides set
  // overlayShouldShow=false first, so those are left alone.
  // If macOS still orders the window out when we're deactivated, bring it right
  // back with no visible delay (showInactive doesn't steal focus from the game).
  overlayWin.on('hide', () => {
    if (overlayShouldShow && overlayWin && !overlayWin.isDestroyed()) {
      setImmediate(() => {
        try {
          if (overlayShouldShow && overlayWin && !overlayWin.isDestroyed()) {
            overlayWin.showInactive();
            overlayWin.setAlwaysOnTop(true, 'screen-saver');
          }
        } catch { /* noop */ }
      });
    }
  });
  overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWin.setIgnoreMouseEvents(true, { forward: true }); // click-through; panels toggle capture on hover
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

function toggleOverlay() {
  if (!overlayWin || overlayWin.isDestroyed()) createOverlay();
  const show = !overlayWin.isVisible();
  overlayManual = show; // user override sticks until they toggle again
  setOverlayShown(show);
}

// Renderer toggles mouse capture as the pointer moves on/off a clickable panel,
// so only the panels catch clicks and the rest of the screen stays click-through.
ipcMain.on('overlay:mouse-ignore', (_e, ignore) => {
  if (overlayWin && !overlayWin.isDestroyed()) overlayWin.setIgnoreMouseEvents(!!ignore, { forward: true });
});

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
  globalShortcut.register('CommandOrControl+Shift+O', () => toggleOverlay());
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
