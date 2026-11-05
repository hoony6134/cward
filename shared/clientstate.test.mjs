// Self-check for lobby / champ-select shapers. Run: node shared/clientstate.test.mjs
import assert from 'node:assert/strict';
import { shapeLobby, shapeChampSelect, filterQueues } from './clientstate.mjs';

// Queue filter: keep available PvP matchmade modes, drop TFT/tutorial/custom, dedupe.
const queues = filterQueues([
  { id: 450, name: '무작위 총력전', category: 'PvP', gameMode: 'ARAM', queueAvailability: 'Available' },
  { id: 2400, name: '무작위 총력전: 아수라장', category: 'PvP', gameMode: 'KIWI', queueAvailability: 'Available' },
  { id: 880, name: '초보', category: 'VersusAi', gameMode: 'SWIFTPLAY', queueAvailability: 'Available' }, // AI 대전
  { id: 1100, name: 'TFT 랭크', category: 'PvP', gameMode: 'TFT', queueAvailability: 'Available' },
  { id: 2000, name: '튜토리얼', category: 'PvP', gameMode: 'TUTORIAL_MODULE_1', queueAvailability: 'Available' },
  { id: 999, name: '꺼진 모드', category: 'PvP', gameMode: 'ARAM', queueAvailability: 'PlatformDisabled' },
  { id: 741, name: '무작위 총력전', category: 'PvP', gameMode: 'URF', queueAvailability: 'Available' }, // dup name
]);
assert.deepEqual(queues.map((q) => q.id), [450, 2400, 880]);
assert.equal(queues.find((q) => q.id === 880).name, 'AI · 초보'); // VersusAi prefixed
assert.equal(queues.find((q) => q.id === 880).ai, true);
assert.equal(queues.find((q) => q.id === 450).cat, 'aram');  // 무작위 총력전 → 칼바람
assert.equal(queues.find((q) => q.id === 2400).cat, 'special'); // 아수라장(KIWI) → 특별
assert.equal(queues.find((q) => q.id === 880).cat, 'ai');

// Lobby shape taken from a live Swiftplay lobby.
const lobby = shapeLobby({
  gameConfig: { queueId: 480, gameMode: 'SWIFTPLAY', mapId: 11, maxLobbySize: 5, showQuickPlaySlotSelection: true },
  localMember: {
    firstPositionPreference: 'MIDDLE', secondPositionPreference: 'TOP',
    playerSlots: [{ championId: 103, spell1: 14, spell2: 4, positionPreference: 'MIDDLE' }, { championId: 518, spell1: 14, spell2: 4, positionPreference: 'UTILITY' }],
  },
  members: [{ summonerName: 'Me', isLeader: true, firstPositionPreference: 'MIDDLE', secondPositionPreference: 'TOP' }],
});
assert.equal(lobby.kind, 'lobby');
assert.equal(lobby.queueName, '신속 대전');
assert.equal(lobby.quickPlay, true);
assert.equal(lobby.slots.length, 2);
assert.equal(lobby.slots[0].championId, 103);         // current Swiftplay pick shown
assert.equal(lobby.positions.first, 'MIDDLE');
assert.equal(lobby.members[0].leader, true);

// Champ-select: my cell has an in-progress pick action.
const cs = shapeChampSelect({
  localPlayerCellId: 2,
  timer: { adjustedTimeLeftInPhase: 27000, phase: 'BAN_PICK' },
  actions: [[{ id: 11, actorCellId: 2, championId: 0, type: 'pick', isInProgress: true, completed: false }]],
  myTeam: [{ cellId: 2, championId: 103, assignedPosition: 'middle' }],
  theirTeam: [{ cellId: 7, championId: 0 }],
  bans: { myTeamBans: [64], theirTeamBans: [] },
}, [103, 1, 2], [64]);
assert.equal(cs.kind, 'champselect');
assert.equal(cs.timeLeft, 27);
assert.equal(cs.myAction.id, 11);
assert.equal(cs.myAction.type, 'pick');
assert.equal(cs.myTeam[0].me, true);
assert.equal(cs.myTeam[0].championId, 103);
assert.deepEqual(cs.pickable, [103, 1, 2]);

console.log('ok: clientstate shapers pass');
