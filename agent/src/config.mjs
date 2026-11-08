// Resolves agent config. Dev: from env (npm start uses --env-file=.env).
// Standalone binary (bun --compile): a ward.config.json beside the executable,
// created with a fresh random room+token on first run — nothing to set up.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import qrcode from 'qrcode-terminal';

const DEFAULT_RELAY = 'wss://relay.ward.gg.scian.xyz/ws';
const DEFAULT_WEB = 'https://ward.gg.scian.xyz';
const compiled = typeof Bun !== 'undefined'; // the Bun global exists only in a bun-compiled binary

export function loadConfig() {
  const { RELAY_WS_URL, ROOM, ROOM_TOKEN, WEB_URL } = process.env;
  if (RELAY_WS_URL && ROOM && ROOM_TOKEN) {
    return { relay: RELAY_WS_URL, room: ROOM, token: ROOM_TOKEN, web: WEB_URL || DEFAULT_WEB };
  }
  if (!compiled) {
    console.error('설정이 없습니다. 먼저  npm run init  을 실행하세요.');
    process.exit(1);
  }
  const p = path.join(path.dirname(process.execPath), 'ward.config.json');
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  const cfg = { relay: DEFAULT_RELAY, room: randomUUID(), token: randomUUID(), web: DEFAULT_WEB };
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
  console.log(`새 설정을 만들었습니다: ${p}`);
  return cfg;
}

export function printPairing(cfg) {
  const link = `${cfg.web}/#room=${encodeURIComponent(cfg.room)}&token=${encodeURIComponent(cfg.token)}`;
  console.log('\n폰 카메라로 QR을 스캔하거나 링크를 여세요:\n');
  qrcode.generate(link, { small: true }, (qr) => console.log(qr));
  console.log(link + '\n');
}
