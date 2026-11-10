import assert from 'node:assert/strict';
import { teamRoomOf } from './team.mjs';

const players = [
  { riotId: 'Me#KR1', team: 'ORDER' }, { riotId: 'Ally#KR1', team: 'ORDER' },
  { riotId: 'Foe#KR1', team: 'CHAOS' }, { riotId: 'Foe2#KR1', team: 'CHAOS' },
];
const snap = (me, list = players) => ({ kind: 'ingame', game: { mode: 'KIWI' }, active: { riotId: me }, players: list });

const mine = teamRoomOf(snap('Me#KR1'));
assert.ok(mine && /^t[0-9a-f]{40}$/.test(mine.room), 'room id is short hex, relay-safe');
assert.deepEqual(teamRoomOf(snap('Ally#KR1', [...players].reverse())), mine, 'teammate (any player order) gets the same room');
assert.notEqual(teamRoomOf(snap('Foe#KR1')).room, mine.room, 'enemy team gets a different room');
assert.notEqual(teamRoomOf({ ...snap('Me#KR1'), game: { mode: 'CLASSIC' } }).room, mine.room, 'other mode -> other room');
assert.equal(teamRoomOf({ kind: 'menu' }), null, 'no room outside a game');
assert.equal(teamRoomOf(snap('Ghost#KR1')), null, 'no room if I am not in the player list');
console.log('team.test ok');
