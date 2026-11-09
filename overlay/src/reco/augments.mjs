// ARAM: Mayhem augment tier list — "which augments are good" (S/A/B/C/D), from
// Blitz's backend (iesdev), the one source that exposes clean JSON for Mayhem:
//   stats:  data.v2.iesdev.com/.../aram_mayhem_augments  → per-augment tier (1-5) + top champions
//   meta:   utils.iesdev.com/static/json/lol/mayham/<patch>/augments_ko_kr → Korean name/desc/icon
// Fetched in the main process (no CORS) and cached per session; fails soft to null.
const STATS = 'https://data.v2.iesdev.com/api/v1/query_objects/prod/lol/aram_mayhem_augments';
const META = (patch) => `https://utils.iesdev.com/static/json/lol/mayham/${patch}/augments_ko_kr`;
const CDN = (icon) => (icon ? `https://blitz-cdn.blitz.gg/blitz/lol/arena/augments/${icon.replace(/\.png$/, '.webp')}` : '');
const TIER = { 1: 'S', 2: 'A', 3: 'B', 4: 'C', 5: 'D' };
const RANK = { S: 0, A: 1, B: 2, C: 3, D: 4 };

let cache = null;

const strip = (s) => (s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

export async function getAugments() {
  if (cache) return cache;
  try {
    const sj = await (await fetch(STATS)).json();
    const stats = Array.isArray(sj) ? sj : (sj.data || []);
    const patch = stats.find((s) => s?.patch)?.patch;
    if (!patch) return null;
    const meta = await (await fetch(META(patch))).json(); // { "1001": { displayName, description, iconLarge } }
    const out = stats.map((s) => {
      const id = String(s.augment_id);
      const m = meta[id] || {};
      return {
        id,
        name: m.displayName || '',
        tier: TIER[s.stats?.tier] || '?',
        desc: strip(m.description),
        icon: CDN(m.iconLarge),
        champs: (s.stats?.top_champions || []).map((c) => String(c.champion_id)),
      };
    }).filter((a) => a.name && a.tier !== '?');
    out.sort((a, b) => (RANK[a.tier] ?? 9) - (RANK[b.tier] ?? 9) || a.name.localeCompare(b.name, 'ko'));
    cache = out.length ? out : null;
    return cache;
  } catch { return null; }
}

// CLI: node src/reco/augments.mjs
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  getAugments().then((a) => { console.log('count:', a?.length); console.log(a?.slice(0, 5).map((x) => `${x.tier} ${x.name}`)); });
}
