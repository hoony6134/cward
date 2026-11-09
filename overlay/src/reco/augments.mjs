// ARAM: Mayhem augment reference — names, tiers (Silver/Gold/Prismatic) and
// descriptions. There is no clean JSON/API for Mayhem augments (CommunityDragon
// only ships Arena augments; OP.GG is RSC-only), so we parse the LoL Wiki's Lua
// data module. Fetched in the main process (no CORS) and cached per session.
const WIKI = 'https://wiki.leagueoflegends.com/en-us/Module:MayhemAugmentData/data?action=raw';
const TIER_RANK = { Prismatic: 0, Gold: 1, Silver: 2 };

let cache = null;

// Strip MediaWiki markup to plain, readable text.
function clean(s) {
  return (s || '')
    .replace(/\\"/g, '"').replace(/\\n/g, ' ')
    .replace(/\{\{as\|([^|}]+)(?:\|[^}]*)?\}\}/g, '$1')
    .replace(/\{\{tip\|([^|}]+)(?:\|[^}]*)?\}\}/g, '$1')
    .replace(/\{\{fd\|([^|}]+)\}\}/g, '$1')
    .replace(/\{\{[a-zA-Z]+\|([^|}]+)(?:\|[^}]*)?\}\}/g, '$1')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1').replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/'''/g, '').replace(/''/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ').trim();
}

export async function getAugments() {
  if (cache) return cache;
  try {
    const r = await fetch(WIKI, { headers: { 'User-Agent': 'cward-overlay' } });
    const txt = await r.text();
    // ["Name"] = { ["description"] = "....", ["tier"] = "Silver", }
    const re = /\["([^"]+)"\]\s*=\s*\{\s*\["description"\]\s*=\s*"((?:\\.|[^"\\])*)"\s*,\s*\["tier"\]\s*=\s*"([^"]+)"/g;
    const out = [];
    let m;
    while ((m = re.exec(txt))) out.push({ name: m[1], desc: clean(m[2]), tier: m[3] });
    out.sort((a, b) => (TIER_RANK[a.tier] ?? 9) - (TIER_RANK[b.tier] ?? 9) || a.name.localeCompare(b.name));
    cache = out.length ? out : null;
    return cache;
  } catch { return null; }
}

// CLI: node src/reco/augments.mjs
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  getAugments().then((a) => { console.log('count:', a?.length); console.log(a?.slice(0, 3)); });
}
