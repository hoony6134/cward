// First-time setup: generates a fresh random ROOM and writes agent/.env.
// Usage: npm run init   (then paste the ROOM_TOKEN your friend shared with you)
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';

const DEFAULT_RELAY = 'wss://relay.ward.gg.scian.xyz/ws';
const envPath = path.join(import.meta.dirname, '.env');

if (fs.existsSync(envPath)) {
  console.error('agent/.env 가 이미 있습니다. 다시 만들려면 먼저 지우세요.');
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const relay = (await rl.question(`릴레이 주소 [${DEFAULT_RELAY}]: `)).trim() || DEFAULT_RELAY;
const token = (await rl.question('ROOM_TOKEN (받은 공유 토큰 붙여넣기): ')).trim();
rl.close();

if (!token) { console.error('ROOM_TOKEN 이 필요합니다.'); process.exit(1); }

const room = randomUUID();
fs.writeFileSync(envPath, `RELAY_WS_URL=${relay}\nROOM=${room}\nROOM_TOKEN=${token}\n`);
console.log(`\n완료. 새 방: ${room}\n이제  npm start  로 실행하고,  npm run qr  로 폰을 연결하세요.`);
