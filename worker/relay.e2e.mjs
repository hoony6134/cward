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

// 4. team room: peers relay cooldowns to each other; a late peer gets the state
const troom = 'team-e2e-' + Date.now();
const nextOf = (ws, pred) => Promise.race([
  new Promise((res) => { const h = (d) => { const m = JSON.parse(d.toString()); if (pred(m)) { ws.off('message', h); res(m); } }; ws.on('message', h); }),
  wait(3000).then(() => null),
]);
const pa = await open(`${BASE}?room=${troom}&role=peer&token=tt`);
const pb = await open(`${BASE}?room=${troom}&role=peer&token=tt`);
const bGets = nextOf(pb, (m) => m.type === 'cd');
await wait(100);
pa.send(JSON.stringify({ type: 'cd', k: 'Enemy#KR:s1', endAt: 612.5 }));
pa.send('not json'); pa.send(JSON.stringify({ type: 'cd', k: 5, endAt: 'x' })); // junk is ignored
const bMsg = await bGets;
assert.ok(bMsg && bMsg.k === 'Enemy#KR:s1' && bMsg.endAt === 612.5, 'peer B should get peer A cooldown');
console.log('✓ peer → peer cooldown relay works');
const cntP = nextOf(pa, (m) => m.type === 'peers' && m.n === 3); // listen before C joins
const pc = await open(`${BASE}?room=${troom}&role=peer&token=tt`);
const st = await nextOf(pc, (m) => m.type === 'state');
assert.ok(st && st.cds['Enemy#KR:s1'] === 612.5 && Object.keys(st.cds).length === 1, 'late peer should get state only with valid cds');
console.log('✓ late peer gets cooldown state (junk dropped)');
const cnt = await cntP;
assert.ok(cnt, 'peers should learn the head count');
console.log('✓ peer head count broadcast');
for (const w of [pa, pb, pc]) w.close();

for (const w of [claimer, viewer, agent, late]) w.close();
console.log(fails ? `FAILED (${fails})` : 'ALL OK');
process.exit(fails ? 1 : 0);
