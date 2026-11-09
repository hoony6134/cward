// App config for the macOS Electron app. Stored in Electron's userData dir
// (not beside a binary), created with a fresh random room+token on first run —
// nothing to set up, no terminal. Same shape as the CLI agent's config.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const DEFAULT_RELAY = 'wss://relay.cward.gg.scian.xyz/ws';
const DEFAULT_WEB = 'https://cward.gg.scian.xyz';

export function loadConfig(dir) {
  const p = path.join(dir, 'cward.config.json');
  if (fs.existsSync(p)) {
    try { return { path: p, created: false, ...JSON.parse(fs.readFileSync(p, 'utf8')) }; } catch { /* corrupt → recreate */ }
  }
  const cfg = {
    relay: process.env.RELAY_WS_URL || DEFAULT_RELAY,
    room: randomUUID(),
    token: randomUUID(),
    web: process.env.WEB_URL || DEFAULT_WEB,
  };
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
  return { path: p, created: true, ...cfg };
}

// The phone pairing link. room+token live in the URL fragment, so they never
// reach the relay server in a request URL/log (the web app strips them too).
export function pairingLink(cfg) {
  return `${cfg.web}/#room=${encodeURIComponent(cfg.room)}&token=${encodeURIComponent(cfg.token)}`;
}
