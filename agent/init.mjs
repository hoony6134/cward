// First-time setup: generates a fresh random room + token and writes agent/.env.
// Usage: npm run init   (no secret to paste — the room id is the shared secret)
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const DEFAULT_RELAY = 'wss://relay.ward.gg.scian.xyz/ws';
const envPath = path.join(import.meta.dirname, '.env');

if (fs.existsSync(envPath)) {
  console.error('agent/.env 가 이미 있습니다. 다시 만들려면 먼저 지우세요.');
  process.exit(1);
}

const relay = process.env.RELAY_WS_URL || DEFAULT_RELAY;
const room = randomUUID();
const token = randomUUID();
fs.writeFileSync(envPath, `RELAY_WS_URL=${relay}\nROOM=${room}\nROOM_TOKEN=${token}\n`);
console.log(`\n완료. 릴레이: ${relay}\n이제  npm start  로 실행하고,  npm run qr  로 폰을 연결하세요.`);
