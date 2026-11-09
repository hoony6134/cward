// Prints the phone pairing link from agent/.env. Usage: node scripts/pairing-link.mjs [pages-url]
import fs from 'node:fs';
import path from 'node:path';

const envPath = path.join(import.meta.dirname, '../agent/.env');
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const pages = process.argv[2] || 'https://cward.gg.scian.xyz';
const { ROOM, ROOM_TOKEN } = env;
if (!ROOM || !ROOM_TOKEN) { console.error('agent/.env 에 ROOM / ROOM_TOKEN 이 필요합니다.'); process.exit(1); }

console.log(`${pages}/#room=${encodeURIComponent(ROOM)}&token=${encodeURIComponent(ROOM_TOKEN)}`);
