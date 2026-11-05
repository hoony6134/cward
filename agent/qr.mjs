// One command to pair your phone: prints the link + a scannable QR in the terminal.
// Usage: npm run qr   (from agent/)   or   node scripts/qr.mjs [web-url]
import fs from 'node:fs';
import path from 'node:path';
import qrcode from 'qrcode-terminal';

const envPath = path.join(import.meta.dirname, '.env');
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const web = process.argv[2] || 'https://ward.gg.scian.xyz';
const { ROOM, ROOM_TOKEN } = env;
if (!ROOM || !ROOM_TOKEN) { console.error('agent/.env 에 ROOM / ROOM_TOKEN 이 필요합니다.'); process.exit(1); }

const link = `${web}/#room=${encodeURIComponent(ROOM)}&token=${encodeURIComponent(ROOM_TOKEN)}`;
console.log('\n폰 카메라로 QR을 스캔하거나 링크를 여세요:\n');
qrcode.generate(link, { small: true }, (qr) => console.log(qr));
console.log(link + '\n');
