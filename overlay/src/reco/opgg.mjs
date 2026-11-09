// OP.GG build recommendations via the official OP.GG MCP endpoint.
// Covers SR (ranked/flex) + ARAM + URF + Nexus Blitz: items, skill order, runes,
// summoner spells, each with win rate. NOT ARAM: Mayhem augments (see augments.mjs).
//
// The MCP returns an LLM-oriented text DSL (not JSON), e.g.
//   LolGetChampionAnalysis("ANNIE",Data(Summary(AverageStats(0.48)),CoreItems([3118,..],["Malignance",..],1754,885),...))
// We extract by class name with regex (resilient to field/class reordering) and
// fail soft to null so a format change degrades gracefully instead of crashing.

const MCP = 'https://mcp-api.op.gg/mcp';

const FIELDS = [
  'champion',
  'data.core_items.ids', 'data.core_items.ids_names', 'data.core_items.play', 'data.core_items.win',
  'data.boots.ids', 'data.starter_items.ids',
  'data.skills.order',
  'data.summoner_spells.ids', 'data.summoner_spells.ids_names',
  'data.runes.primary_rune_ids', 'data.runes.secondary_rune_ids', 'data.runes.stat_mod_ids',
  'data.summary.average_stats.win_rate',
];

// ddragon champ key -> OP.GG champion name (UPPER_SNAKE_CASE). Most keys upper-snake
// directly; only the handful where the display name differs need an override.
const OVERRIDES = { MonkeyKing: 'WUKONG', Nunu: 'NUNU', FiddleSticks: 'FIDDLESTICKS' };
export function toOpggChamp(champKey) {
  if (!champKey) return '';
  if (OVERRIDES[champKey]) return OVERRIDES[champKey];
  return champKey.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z_]/g, '').toUpperCase();
}

// Live Client gameMode -> MCP game_mode. ARAM: Mayhem reports as an ARAM variant,
// so builds fall back to aram (augments are fetched separately).
export function toOpggMode(liveMode) {
  const m = (liveMode || '').toUpperCase();
  // KIWI = Live Client gameMode for ARAM: Mayhem (증강 칼바람 / 아수라장). MCP has no
  // mayhem build, so fall back to aram (same map/items); augments come separately.
  if (m.includes('ARAM') || m === 'MAYHEM' || m === 'KIWI') return 'aram';
  if (m.includes('URF')) return 'urf';
  if (m.includes('NEXUS') || m === 'NEXUSBLITZ') return 'nexus_blitz';
  return 'ranked';
}

function numList(s) { return (s || '').split(',').map((x) => Number(x.trim())).filter((n) => Number.isFinite(n)); }
function strList(s) { return [...(s || '').matchAll(/"([^"]*)"/g)].map((m) => m[1]); }

export function parseBuild(text) {
  if (!text) return null;
  const grab = (re) => text.match(re);
  const core = grab(/CoreItems\(\[([^\]]*)\],\[([^\]]*)\](?:,(\d+),(\d+))?/);
  const runes = grab(/Runes\(\[([^\]]*)\],\[([^\]]*)\],\[([^\]]*)\]/);
  const skills = grab(/Skills\(\[([^\]]*)\]/);
  const spells = grab(/SummonerSpells\(\[([^\]]*)\]/);
  const boots = grab(/Boots\(\[([^\]]*)\]/);
  const starter = grab(/StarterItems\(\[([^\]]*)\]/);
  const wr = grab(/AverageStats\(([\d.]+)\)/);
  const out = {
    winRate: wr ? Number(wr[1]) : null,
    items: core ? { ids: numList(core[1]), names: strList(core[2]), play: core[3] ? Number(core[3]) : null, win: core[4] ? Number(core[4]) : null } : null,
    boots: boots ? numList(boots[1]) : [],
    starter: starter ? numList(starter[1]) : [],
    skills: skills ? strList(skills[1]) : [],
    spells: spells ? numList(spells[1]) : [],
    runes: runes ? { primary: numList(runes[1]), secondary: numList(runes[2]), statMods: numList(runes[3]) } : null,
  };
  // Nothing parsed at all → treat as failure.
  if (!out.items && !out.runes && !out.skills.length) return null;
  return out;
}

async function callMcp(body) {
  const r = await fetch(MCP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
    body: JSON.stringify(body),
  });
  const raw = await r.text();
  // Handle both plain JSON and SSE (data: ... lines).
  const jsonStr = raw.startsWith('data:')
    ? raw.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('')
    : raw;
  return JSON.parse(jsonStr);
}

// champion: ddragon champKey (e.g. "Annie"); mode: Live Client gameMode; position: lane or null.
export async function getBuild({ champion, mode = 'CLASSIC', position = 'mid', tier } = {}) {
  const name = toOpggChamp(champion);
  if (!name) return null;
  const args = {
    champion: name,
    game_mode: toOpggMode(mode),
    position: position || 'mid',
    desired_output_fields: FIELDS,
  };
  if (tier) args.tier = tier;
  try {
    const j = await callMcp({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name: 'lol_get_champion_analysis', arguments: args } });
    const text = j?.result?.content?.[0]?.text;
    const build = parseBuild(text);
    return build ? { champion: name, mode: args.game_mode, ...build } : null;
  } catch {
    return null;
  }
}

// CLI: node src/reco/opgg.mjs <champKey> [mode] [position]
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const [, , champ = 'Annie', mode = 'ARAM', pos = 'mid'] = process.argv;
  getBuild({ champion: champ, mode, position: pos }).then((b) => console.log(JSON.stringify(b, null, 2)));
}
