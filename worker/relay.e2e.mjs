// End-to-end check of the relay against a running `wrangler dev` on :8787.
// Verifies: token rejection, and agent -> room -> viewer fan-out.
import WebSocket from 'ws';
import assert from 'node:assert/strict';

const BASE = `ws://localhost:${process.env.PORT || 8787}/ws`;
const room = 'e2e-' + Date.now();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const open = (url) => new Promise((res, rej) => {
  const ws = new WebSocket(url);
  ws.once('open', () => res(ws));
  ws.once('error', rej);
  ws.once('unexpected-response', (_req, r) => rej(new Error('http ' + r.statusCode)));
});

let fails = 0;

// 1. first connection claims this room's token; empty or mismatched tokens are rejected
const claimer = await open(`${BASE}?room=${room}&role=agent&token=testtoken`);
try { await open(`${BASE}?room=${room}&role=viewer&token=`); console.error('✗ empty token was accepted'); fails++; }
catch { console.log('✓ empty token rejected'); }
try { await open(`${BASE}?room=${room}&role=viewer&token=WRONG`); console.error('✗ wrong token was accepted'); fails++; }
catch { console.log('✓ wrong token rejected'); }

// 2. agent -> viewer fan-out
const viewer = await open(`${BASE}?room=${room}&role=viewer&token=testtoken`);
const got = new Promise((res) => viewer.once('message', (d) => res(JSON.parse(d.toString()))));
const agent = await open(`${BASE}?room=${room}&role=agent&token=testtoken`);
await wait(100);
agent.send(JSON.stringify({ phase: 'InProgress', hello: 'world' }));
const msg = await Promise.race([got, wait(3000).then(() => null)]);
assert.ok(msg && msg.hello === 'world', 'viewer should receive agent snapshot');
console.log('✓ agent → viewer fan-out works');

// 3. late viewer gets the stored last snapshot immediately
const late = await open(`${BASE}?room=${room}&role=viewer&token=testtoken`);
const lateMsg = await Promise.race([
  new Promise((res) => late.once('message', (d) => res(JSON.parse(d.toString())))),
  wait(3000).then(() => null),
]);
assert.ok(lateMsg && lateMsg.hello === 'world', 'late viewer should get last snapshot');
console.log('✓ late viewer gets last snapshot');

for (const w of [claimer, viewer, agent, late]) w.close();
console.log(fails ? `FAILED (${fails})` : 'ALL OK');
process.exit(fails ? 1 : 0);
