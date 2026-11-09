// Fixture test for the OP.GG MCP text-DSL parser. Run: node src/reco/opgg.test.mjs
// Catches upstream format drift without hitting the live endpoint.
import assert from 'node:assert';
import { parseBuild, toOpggChamp, toOpggMode } from './opgg.mjs';

const FIXTURE = 'LolGetChampionAnalysis("ANNIE",Data(Summary(AverageStats(0.48)),CoreItems([3118,4646,4645],["Malignance","Stormsurge","Shadowflame"],1754,885),SummonerSpells([4,32],[4,32]),Runes([8128,8126,8140,8106],[8210,8236],[5008,5008,5001]),Skills(["Q","W","E","Q","Q","R","Q","W","Q","W","R","W","W","E","E"]),CountersMeta("x")))';

const b = parseBuild(FIXTURE);
assert.ok(b, 'parseBuild returned null');
assert.deepStrictEqual(b.items.ids, [3118, 4646, 4645], 'core item ids');
assert.deepStrictEqual(b.items.names, ['Malignance', 'Stormsurge', 'Shadowflame'], 'core item names');
assert.strictEqual(b.items.play, 1754, 'play');
assert.strictEqual(b.items.win, 885, 'win');
assert.strictEqual(b.winRate, 0.48, 'win rate');
assert.deepStrictEqual(b.spells, [4, 32], 'summoner spells');
assert.strictEqual(b.skills.length, 15, 'skill order length');
assert.strictEqual(b.skills[0], 'Q', 'first skill');
assert.deepStrictEqual(b.runes.primary, [8128, 8126, 8140, 8106], 'primary runes');
assert.deepStrictEqual(b.runes.secondary, [8210, 8236], 'secondary runes');
assert.deepStrictEqual(b.runes.statMods, [5008, 5008, 5001], 'stat mods');

// Garbage → null (fail soft).
assert.strictEqual(parseBuild('totally unexpected format'), null, 'garbage → null');
assert.strictEqual(parseBuild(''), null, 'empty → null');

// Name + mode mapping.
assert.strictEqual(toOpggChamp('MissFortune'), 'MISS_FORTUNE', 'MissFortune');
assert.strictEqual(toOpggChamp('MonkeyKing'), 'WUKONG', 'MonkeyKing override');
assert.strictEqual(toOpggChamp('Annie'), 'ANNIE', 'Annie');
assert.strictEqual(toOpggMode('ARAM'), 'aram', 'aram');
assert.strictEqual(toOpggMode('CLASSIC'), 'ranked', 'classic');
assert.strictEqual(toOpggMode('CHERRY'), 'ranked', 'unknown → ranked fallback');

console.log('opgg parser: all assertions passed ✓');
