// Data Dragon helpers for Korean champion/item icons. Version is fetched once.
let version = '14.1.1'; // fallback; replaced on load

export async function loadDDragonVersion(): Promise<string> {
  try {
    const r = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
    const list = (await r.json()) as string[];
    if (list?.[0]) version = list[0];
  } catch { /* keep fallback */ }
  return version;
}

export const champIcon = (champKey: string) =>
  `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${champKey}.png`;

export const itemIcon = (id: number) =>
  `https://ddragon.leagueoflegends.com/cdn/${version}/img/item/${id}.png`;

export const profileIcon = (id: number) =>
  `https://ddragon.leagueoflegends.com/cdn/${version}/img/profileicon/${id}.png`;

// Skin loading art (versionless path). skinNum = skinId - championId*1000.
export const skinArt = (champKey: string, skinNum: number) =>
  `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${champKey}_${skinNum}.jpg`;

// Official Riot lane/position icons (CommunityDragon mirror).
export const positionIcon = (pos: string) =>
  `https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-clash/global/default/assets/images/position-selector/positions/icon-position-${(pos || 'fill').toLowerCase()}.png`;

// Official summoner-spell icon. Shaper key "Flash"/"Dot" -> "SummonerFlash".
export const spellIcon = (key: string) =>
  `https://ddragon.leagueoflegends.com/cdn/${version}/img/spell/Summoner${key}.png`;

// numeric championId -> { key: "Ahri", name: "아리" } for champ-select and portraits.
let champById: Record<number, { key: string; name: string }> = {};
export async function loadChampions(): Promise<void> {
  try {
    const r = await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/ko_KR/champion.json`);
    const d = (await r.json()) as { data: Record<string, { key: string; name: string; id: string }> };
    champById = Object.fromEntries(Object.values(d.data).map((c) => [Number(c.key), { key: c.id, name: c.name }]));
  } catch { /* keep empty */ }
}
export const champ = (id: number) => champById[id];
export const champIconById = (id: number) => (champById[id] ? champIcon(champById[id].key) : '');
// Full roster from ddragon — auto-updates each patch, so new champs need no code change.
export const allChampions = () =>
  Object.entries(champById).map(([id, c]) => ({ id: Number(id), ...c })).sort((a, b) => a.name.localeCompare(b.name, 'ko'));

// Summoner spells: icon-by-id map + a filterable list (used by the slot spell picker).
let spellImgById: Record<number, string> = {};
let spellList: { id: number; name: string; modes: string[] }[] = [];
export async function loadSummonerSpells(): Promise<void> {
  try {
    const r = await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/ko_KR/summoner.json`);
    const d = (await r.json()) as { data: Record<string, { key: string; name: string; image: { full: string }; modes: string[] }> };
    const all = Object.values(d.data);
    spellImgById = Object.fromEntries(all.map((s) => [Number(s.key), s.image.full]));
    spellList = all.map((s) => ({ id: Number(s.key), name: s.name, modes: s.modes || [] }));
  } catch { /* keep empty */ }
}
export const summonerSpells = (mode = 'CLASSIC') =>
  spellList.filter((s) => s.modes.includes(mode)).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
export const sumSpellIcon = (id: number) =>
  spellImgById[id] ? `https://ddragon.leagueoflegends.com/cdn/${version}/img/spell/${spellImgById[id]}` : '';

// Riot's built-in recommended items for a champion (free, basic — not op.gg-grade).
export async function loadRecommended(champKey: string, mapId: number): Promise<number[]> {
  try {
    const r = await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/ko_KR/champion/${champKey}.json`);
    const d = (await r.json()) as { data: Record<string, { recommended: { map: string; blocks: { items: { id: string }[] }[] }[] }> };
    const rec = Object.values(d.data)[0]?.recommended ?? [];
    const forMap = rec.find((x) => x.map === `Map${mapId}`) ?? rec[0];
    const ids = (forMap?.blocks ?? []).flatMap((b) => b.items.map((i) => Number(i.id)));
    return [...new Set(ids)].slice(0, 18);
  } catch { return []; }
}

// Official per-rank ultimate (R) cooldowns from ddragon, cached by champion key.
const ultCache: Record<string, number[]> = {};
export async function loadUltCd(champKey: string): Promise<number[]> {
  if (ultCache[champKey]) return ultCache[champKey];
  try {
    const r = await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/ko_KR/champion/${champKey}.json`);
    const d = (await r.json()) as { data: Record<string, { spells: { cooldown: number[] }[] }> };
    const cd = Object.values(d.data)[0]?.spells?.[3]?.cooldown ?? [];
    return (ultCache[champKey] = cd.map((n) => Math.round(n)));
  } catch { return (ultCache[champKey] = []); }
}
// R rank from champion level: 6-10 -> 1, 11-15 -> 2, 16+ -> 3.
export const ultRank = (level: number) => (level >= 16 ? 3 : level >= 11 ? 2 : 1);

// Rune data (CommunityDragon): perk id -> {name, icon}, and the tree structure for the editor.
const CD = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default';
const cdragon = (p?: string) => (p ? `${CD}${p.toLowerCase().replace('/lol-game-data/assets', '')}` : '');
type Slot = { type: string; perks: number[] };
type Style = { id: number; name: string; iconPath: string; slots: Slot[] };
let perkById: Record<number, { name: string; icon: string }> = {};
let styles: Style[] = [];
const MAIN = [8000, 8100, 8200, 8300, 8400];
export async function loadRunes(): Promise<void> {
  try {
    const [perks, ps] = await Promise.all([
      fetch(`${CD}/v1/perks.json`).then((r) => r.json()),
      fetch(`${CD}/v1/perkstyles.json`).then((r) => r.json()),
    ]) as [{ id: number; name: string; iconPath: string }[], { styles: Style[] }];
    perkById = Object.fromEntries(perks.map((p) => [p.id, { name: p.name, icon: cdragon(p.iconPath) }]));
    styles = ps.styles;
  } catch { /* keep empty */ }
}
export const perk = (id: number) => perkById[id];
export const perkIcon = (id: number) => perkById[id]?.icon || '';
export const runeTrees = () => styles.filter((s) => MAIN.includes(s.id));
export const styleById = (id: number) => styles.find((s) => s.id === id);
export const styleIcon = (id: number) => cdragon(styleById(id)?.iconPath);
// The 3 universal stat-shard rows (offense / flex / defense).
export const shardRows = () => (runeTrees()[0]?.slots.filter((s) => s.type === 'kStatMod').map((s) => s.perks) ?? []);
// Primary: keystone row + 3 rune rows. Secondary: the same 3 rune rows (pick 2).
export const keystoneRow = (styleId: number) => styleById(styleId)?.slots.find((s) => s.type === 'kKeyStone')?.perks ?? [];
export const runeRows = (styleId: number) => styleById(styleId)?.slots.filter((s) => s.type === 'kMixedRegularSplashable').map((s) => s.perks) ?? [];

// Ability Haste per item, parsed from ddragon descriptions (auto-updates per patch).
let itemAHById: Record<number, number> = {};
export async function loadItemHaste(): Promise<void> {
  try {
    const r = await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/item.json`);
    const d = (await r.json()) as { data: Record<string, { description?: string }> };
    const re = /<attention>(\d+)<\/attention>\s*Ability Haste/i;
    const out: Record<number, number> = {};
    for (const [id, it] of Object.entries(d.data)) { const m = it.description?.match(re); if (m) out[Number(id)] = Number(m[1]); }
    itemAHById = out;
  } catch { /* keep empty */ }
}
export const itemHaste = (id: number) => itemAHById[id] || 0;
// Effective cooldown after ability haste: base * 100/(100+AH).
export const withHaste = (baseCd: number, ah: number) => Math.round((baseCd * 100) / (100 + ah));

// Fixed summoner-spell cooldowns (s), keyed by the shaper's spell key. Ult is manual.
export const SPELL_CD: Record<string, number> = {
  Flash: 300, Dot: 180, Heal: 240, Barrier: 180, Exhaust: 210, Teleport: 330,
  Haste: 210, Ghost: 210, Boost: 210, Cleanse: 210, Mana: 240, Clarity: 240,
  Smite: 15, Mark: 80, Snowball: 80,
};
export const spellCd = (key: string) => SPELL_CD[key] ?? 180;

export const fmtClock = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

// Korean labels for the Live Client event feed.
const EVENT_KO: Record<string, string> = {
  GameStart: '게임 시작', MinionsSpawning: '미니언 생성', FirstBlood: '퍼스트 블러드',
  ChampionKill: '챔피언 처치', Multikill: '멀티킬', Ace: '에이스',
  DragonKill: '드래곤 처치', BaronKill: '바론 처치', HeraldKill: '전령 처치',
  AtakhanKill: '아타칸 처치', TurretKilled: '포탑 파괴', InhibKilled: '억제기 파괴',
  InhibRespawned: '억제기 부활',
};
export const eventKo = (name: string) => EVENT_KO[name] || name;
