// Self-check for the snapshot shaper. Run: node shared/snapshot.test.mjs
import assert from 'node:assert/strict';
import { shapeSnapshot } from './snapshot.mjs';

const sample = {
  activePlayer: {
    riotId: 'Me#KR1', level: 7, currentGold: 1234.5,
    championStats: { currentHealth: 800, maxHealth: 1000, resourceType: 'MANA', resourceValue: 200, resourceMax: 400 },
    abilities: { Q: { abilityLevel: 3 }, W: { abilityLevel: 1 }, E: { abilityLevel: 1 }, R: { abilityLevel: 1 } },
  },
  allPlayers: [
    {
      riotId: 'Me#KR1', riotIdGameName: 'Me', championName: '아리', rawChampionName: 'game_character_displayname_Ahri',
      team: 'ORDER', position: 'MIDDLE', level: 7, isDead: false, respawnTimer: 0,
      scores: { kills: 2, deaths: 1, assists: 3, creepScore: 95, wardScore: 12.3 },
      summonerSpells: {
        summonerSpellOne: { displayName: '점멸', rawDisplayName: 'GeneratedTip_SummonerSpell_SummonerFlash_DisplayName' },
        summonerSpellTwo: { displayName: '점화', rawDisplayName: 'GeneratedTip_SummonerSpell_SummonerDot_DisplayName' },
      },
      items: [{ itemID: 6655, displayName: '루덴의 동반자', count: 1 }],
    },
    {
      riotId: 'Foe#KR2', championName: 'Zed', rawChampionName: 'game_character_displayname_Zed',
      team: 'CHAOS', position: 'MIDDLE', level: 6, isDead: true, respawnTimer: 8.2,
      scores: { kills: 1, deaths: 2, assists: 0, creepScore: 80, wardScore: 4 },
      items: [],
    },
  ],
  events: { Events: [
    { EventID: 0, EventName: 'GameStart', EventTime: 0 },
    { EventID: 5, EventName: 'DragonKill', DragonType: 'Fire', EventTime: 320.5, KillerName: 'Me' },
    { EventID: 6, EventName: 'TurretKilled', TurretKilled: 'Turret_T200_L_03_A', EventTime: 400 }, // CHAOS-owned → ORDER destroyed
    { EventID: 7, EventName: 'BaronKill', EventTime: 1500 },
  ] },
  gameData: { gameMode: 'CLASSIC', gameTime: 1523.7, mapNumber: 11 },
};

const s = shapeSnapshot(sample, 'InProgress');

assert.equal(s.kind, 'ingame');
assert.equal(s.phase, 'InProgress');
assert.equal(s.game.time, 1524);
assert.equal(s.game.mode, 'CLASSIC');
assert.equal(s.players.length, 2);
assert.equal(s.players[0].champKey, 'Ahri');           // derived from rawChampionName
assert.equal(s.players[0].champion, '아리');            // keeps localized display name
assert.equal(s.players[0].cs, 95);
assert.equal(s.players[0].spells[0].name, '점멸');       // localized spell name
assert.equal(s.players[0].spells[0].key, 'Flash');      // stable key for cooldown lookup
assert.equal(s.players[0].spells[1].key, 'Dot');        // Ignite is "SummonerDot"
// Upgraded smite collapses to base Smite (ddragon has no variant icon).
assert.equal(shapeSnapshot({ allPlayers: [{ team: 'CHAOS', summonerSpells: { summonerSpellOne: { rawDisplayName: 'GeneratedTip_SummonerSpell_SummonerSmiteAvatarOffensive_DisplayName' } } }], gameData: {} }).players[0].spells[0].key, 'Smite');
assert.equal(s.players[1].dead, true);
assert.equal(s.players[1].respawn, 8);
assert.equal(s.active.gold, 1235);
assert.equal(s.active.abilities.Q, 3);
assert.equal(s.objectives.dragons.length, 1);
assert.equal(s.objectives.dragons[0].type, '불');       // Korean dragon label
assert.equal(s.objectives.barons, 1);
assert.equal(s.objectives.towers.ORDER, 1);             // ORDER destroyed a CHAOS turret
assert.equal(s.objectives.towers.CHAOS, 0);
assert.ok(s.recent.length >= 1);

console.log('ok: snapshot shaper passes', s.players.length, 'players,', s.objectives.dragons.length, 'dragon');
