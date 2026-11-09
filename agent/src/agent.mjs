// Reusable agent loop. Reads local League state and forwards snapshots to the
// relay (phone companion) and, optionally, to an in-process consumer (the macOS
// overlay) via onSnapshot. Call startAgent(cfg, { onSnapshot, onStatus }).
//  - in a game: Live Client Data (:2999), no auth needed
//  - in client (lobby / champ select): LCU API via discovered port + token
import { shapeSnapshot } from '../../shared/snapshot.mjs';
import { shapeLobby, shapeChampSelect, filterQueues, cdragonAsset } from '../../shared/clientstate.mjs';
import { getAllGameData } from './liveclient.mjs';
import { discoverLCU, lcuGet, lcuPost, lcuPatch, lcuPut, lcuDelete } from './lcu.mjs';
import { createRelay } from './relay.mjs';

let lcu = null;          // {port, token}
let lastAction = null;   // current champ-select action id for pick/ban commands
let lastKind = '';
let queues = [];         // available matchmade queues, fetched once per client session
let recPos = null;       // {championId: ["MIDDLE",...]} Riot's recommended lanes
let me = null;           // {name, tag, iconId, level}, fetched once per client session
let sid = null;          // numeric summonerId, for inventory lookups
let skinCache = {};      // {championId: [{id,name,base}]} owned skins
let autoAccept = true;   // toggled from the phone
let icons = null;        // owned summoner icon ids
let owned = null;        // owned champion ids
const recSetCache = {};

let relay = null;        // transport to the phone (may be null if relay disabled)
let onSnap = null;       // in-process consumer (overlay)
let timer = null;
let pollMs = 1500;
let idleMs = 2000;

// Fan one shaped snapshot out to both the phone relay and the local overlay.
function emit(snap) {
  try { relay?.send(snap); } catch { /* transport best-effort */ }
  try { onSnap?.(snap); } catch { /* consumer best-effort */ }
}

const logKind = (k) => { if (k !== lastKind) { console.log('[agent]', k); lastKind = k; } };

// Start the loop. Returns { stop(), command(c) }.
export function startAgent(cfg, { onSnapshot = null, onStatus = (s) => console.log('[relay]', s) } = {}) {
  onSnap = onSnapshot;
  pollMs = Number(process.env.POLL_MS || 1500);
  idleMs = Number(process.env.IDLE_POLL_MS || 2000);
  if (cfg.relay && cfg.room && cfg.token) {
    relay = createRelay({
      url: cfg.relay, room: cfg.room, token: cfg.token,
      onStatus,
      onCommand: (c) => runCommand(c).catch((e) => console.log('[cmd] failed:', c.cmd, e.message)).finally(refreshSoon),
    });
  }
  tick();
  return {
    stop() { clearTimeout(timer); try { relay?.close(); } catch { /* noop */ } },
    command: (c) => runCommand(c).catch((e) => console.log('[cmd] failed:', c.cmd, e.message)).finally(refreshSoon),
  };
}

async function tick() {
  try {
    // 1) In an active game — richest data, no auth.
    const data = await getAllGameData();
    logKind('in-game');
    emit(shapeSnapshot(data, 'InProgress'));
    return schedule(pollMs);
  } catch { /* not in game */ }

  // 2) Client up — read phase and shape lobby / champ-select.
  if (!lcu) lcu = await discoverLCU();
  if (lcu) {
    try {
      if (!me) me = await getMe();
      const phase = await lcuGet(lcu, '/lol-gameflow/v1/gameflow-phase');
      if (phase === 'ChampSelect') {
        const [session, pickable, bannable] = await Promise.all([
          lcuGet(lcu, '/lol-champ-select/v1/session'),
          lcuGet(lcu, '/lol-champ-select/v1/pickable-champion-ids').catch(() => []),
          lcuGet(lcu, '/lol-champ-select/v1/bannable-champion-ids').catch(() => []),
        ]);
        const snap = shapeChampSelect(session, pickable, bannable);
        // 아수라장/Brawl: the initial "pick one of a few offered" set (empty in normal modes).
        const subset = await lcuGet(lcu, '/lol-lobby-team-builder/champ-select/v1/subset-champion-list').catch(() => []);
        snap.subset = (Array.isArray(subset) ? subset : []).map((x) => (typeof x === 'number' ? x : x?.championId)).filter(Boolean);
        if (snap.subset.length) console.log('[cs] subset', snap.subset);
        lastAction = snap.myAction?.id ?? null;
        await ensureRecPos();
        if (snap.mine?.championId) {
          const pos = snap.myTeam?.find((c) => c.me)?.position || recPos?.[snap.mine.championId]?.[0] || '';
          const mapId = (await lcuGet(lcu, '/lol-gameflow/v1/session').catch(() => null))?.map?.id || 11;
          snap.mine.skins = await ensureSkins(snap.mine.championId);
          snap.mine.recSets = await ensureRecSets(snap.mine.championId, pos, mapId);
          const cur = await lcuGet(lcu, '/lol-perks/v1/currentpage').catch(() => null);
          if (cur) snap.mine.perks = { perkIds: cur.selectedPerkIds || [], perkStyle: cur.primaryStyleId, perkSubStyle: cur.subStyleId };
        }
        logKind('champ-select');
        emit({ ...snap, me, recPos, owned: await ensureOwned() });
      } else if (phase === 'Lobby') {
        await ensureQueues(); await ensureRecPos();
        const lob = shapeLobby(await lcuGet(lcu, '/lol-lobby/v2/lobby'), queues);
        if (lob.quickPlay) for (const s of lob.slots) {
          s.skins = await ensureSkins(s.championId);
          s.recSets = await ensureRecSets(s.championId, s.position, lob.mapId);
        }
        // "우선순위 포지션" = at least one slot lane must be a scarce role (client requirement).
        const gm = await lcuGet(lcu, '/lol-lobby/v1/parties/gamemode').catch(() => null);
        try { lob.scarce = JSON.parse(gm?.gameCustomization?.scarcePositions || '[]'); } catch { lob.scarce = []; }
        logKind('lobby');
        emit({ ...lob, me, autoAccept, recPos, owned: await ensureOwned(), friends: await getFriends(), icons: await ensureIcons(), loot: await getLoot() });
      } else if (phase === 'Matchmaking') {
        const s = await lcuGet(lcu, '/lol-matchmaking/v1/search').catch(() => ({}));
        logKind('searching');
        emit({ kind: 'searching', t: Date.now(), phase, me, autoAccept, queueTime: Math.round(s.timeInQueue ?? 0), estTime: Math.round(s.estimatedQueueTime ?? 0) });
      } else if (phase === 'ReadyCheck') {
        if (autoAccept) lcuPost(lcu, '/lol-matchmaking/v1/ready-check/accept').catch(() => {});
        logKind('ready-check' + (autoAccept ? ' (auto-accept)' : ''));
        emit({ kind: 'readycheck', t: Date.now(), phase, me, autoAccept });
      } else if (phase === 'PreEndOfGame' || phase === 'EndOfGame') {
        const b = await lcuGet(lcu, '/lol-honor-v2/v1/ballot').catch(() => null);
        const allies = (b?.eligibleAllies || b?.eligiblePlayers || []).map((p) => ({ sid: p.summonerId, puuid: p.puuid, name: p.summonerName || p.gameName || '', champId: p.championId || p.championName }));
        logKind('postgame');
        emit({ kind: 'postgame', t: Date.now(), phase, me, honorVotes: b?.votePool?.votes ?? 0, ballot: b ? { gameId: b.gameId, allies } : null });
      } else {
        // Client open at the main menu (None) or other non-lobby state: offer mode select.
        await ensureQueues();
        logKind('menu:' + phase);
        emit({ kind: 'menu', t: Date.now(), phase, me, autoAccept, queues, friends: await getFriends(), icons: await ensureIcons(), loot: await getLoot() });
      }
      return schedule(idleMs);
    } catch {
      lcu = null; queues = []; me = null; recPos = null; owned = null; sid = null; skinCache = {}; icons = null; // client closed; rediscover next tick
      for (const k in recSetCache) delete recSetCache[k];
    }
  }
  logKind('off');
  emit({ kind: 'off', t: Date.now(), phase: 'None' });
  schedule(idleMs);
}

// Fetch the available queues + official mode icons once per client session.
async function ensureQueues() {
  if (queues.length) return;
  const [raw, maps] = await Promise.all([
    lcuGet(lcu, '/lol-game-queues/v1/queues').catch(() => []),
    lcuGet(lcu, '/lol-maps/v2/maps').catch(() => []),
  ]);
  const mapIcon = {};
  for (const m of maps) mapIcon[m.id] ??= cdragonAsset(m.assets?.['game-select-icon-default']);
  queues = filterQueues(raw).map((q) => ({ id: q.id, name: q.name, ai: q.ai, cat: q.cat, icon: mapIcon[q.mapId] || '' }));
}

// Riot's recommended lanes per champion: { championId: ["MIDDLE", ...] }.
async function ensureRecPos() {
  if (recPos) return;
  const r = await lcuGet(lcu, '/lol-perks/v1/recommended-champion-positions').catch(() => ({}));
  recPos = Object.fromEntries(Object.entries(r).map(([id, v]) => [id, v.recommendedPositions || []]));
}

// Riot's recommended rune+spell sets for a champion/position (several to choose from).
async function ensureRecSets(championId, position, mapId) {
  const key = `${championId}:${position}:${mapId}`;
  if (recSetCache[key]) return recSetCache[key];
  const pages = await lcuGet(lcu, `/lol-perks/v1/recommended-pages/champion/${championId}/position/${position}/map/${mapId}`).catch(() => []);
  return (recSetCache[key] = pages.slice(0, 4).map((pg) => ({
    keyIcon: cdragonAsset(pg.keystone?.iconPath),
    perkIds: pg.perks.map((x) => x.id),
    perkStyle: pg.primaryPerkStyleId,
    perkSubStyle: pg.secondaryPerkStyleId,
    spells: pg.summonerSpellIds || [],
  })));
}

const schedule = (ms) => { timer = setTimeout(tick, ms); };
const refreshSoon = () => { clearTimeout(timer); timer = setTimeout(tick, 150); }; // push updated state right after a command

async function getMe() {
  try {
    const s = await lcuGet(lcu, '/lol-summoner/v1/current-summoner');
    sid = s.summonerId;
    const rk = await lcuGet(lcu, '/lol-ranked/v1/current-ranked-stats').catch(() => null);
    const solo = rk?.queueMap?.RANKED_SOLO_5x5;
    const rank = solo && solo.tier && solo.tier !== 'NONE' ? { tier: solo.tier, div: solo.division, lp: solo.leaguePoints, w: solo.wins, l: solo.losses } : null;
    const mas = await lcuGet(lcu, `/lol-champion-mastery/v1/${s.puuid}/champion-mastery`).catch(() => []);
    const sorted = mas.sort((a, b) => b.championPoints - a.championPoints);
    const mastery = sorted.slice(0, 3).map((m) => ({ id: m.championId, lv: m.championLevel, pt: m.championPoints }));
    const mByChamp = Object.fromEntries(sorted.map((m) => [m.championId, m.championLevel]));
    return { name: s.gameName || s.displayName || '', tag: s.tagLine || '', iconId: s.profileIconId ?? 0, level: s.summonerLevel ?? 0, rank, mastery, mByChamp, puuid: s.puuid };
  } catch { return null; }
}

async function ensureIcons() {
  if (icons) return icons;
  const inv = await lcuGet(lcu, '/lol-inventory/v2/inventory/SUMMONER_ICON').catch(() => []);
  return (icons = inv.map((i) => i.itemId).filter((id) => id > 0).sort((a, b) => a - b));
}

// Loot summary: essences + disenchantable shard ids + chests/keys.
async function getLoot() {
  const loot = await lcuGet(lcu, '/lol-loot/v1/player-loot').catch(() => []);
  const cur = (name) => loot.find((l) => l.lootId === name)?.count ?? 0;
  const ids = (type) => loot.filter((l) => l.type === type);
  const champ = ids('CHAMPION_RENTAL'); const skin = ids('SKIN_RENTAL'); const chest = ids('CHEST'); const key = loot.find((l) => /KEY$/.test(l.lootId) || l.lootId === 'MATERIAL_key');
  return {
    blue: cur('CURRENCY_champion'), orange: cur('CURRENCY_cosmetic'), mythic: cur('CURRENCY_mythic'), rp: cur('CURRENCY_RP'),
    champShards: { n: champ.reduce((s, l) => s + (l.count || 1), 0), value: champ.reduce((s, l) => s + (l.disenchantValue || 0) * (l.count || 1), 0) },
    skinShards: { n: skin.reduce((s, l) => s + (l.count || 1), 0), value: skin.reduce((s, l) => s + (l.disenchantValue || 0) * (l.count || 1), 0) },
    chests: chest.reduce((s, l) => s + (l.count || 1), 0), keys: key?.count ?? 0,
  };
}

// Online, invitable friends.
async function getFriends() {
  const fr = await lcuGet(lcu, '/lol-chat/v1/friends').catch(() => []);
  return fr.filter((f) => f.availability && f.availability !== 'offline' && f.summonerId)
    .map((f) => ({ name: f.gameName || f.name || '', sid: f.summonerId, avail: f.availability, note: f.note || '', icon: f.icon > 0 ? f.icon : 0, status: f.statusMessage || '', id: f.id }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

async function ensureOwned() {
  if (owned) return owned;
  const list = await lcuGet(lcu, '/lol-champions/v1/owned-champions-minimal').catch(() => []);
  owned = list.map((c) => c.id);
  return owned;
}

async function ensureSkins(championId) {
  if (skinCache[championId]) return skinCache[championId];
  if (!sid || !championId) return [];
  const skins = await lcuGet(lcu, `/lol-champions/v1/inventories/${sid}/champions/${championId}/skins`).catch(() => []);
  return (skinCache[championId] = skins.filter((s) => s.ownership?.owned).flatMap((s) => [
    { id: s.id, name: s.name, base: !!s.isBase },
    ...(s.chromas || []).filter((ch) => ch.ownership?.owned).map((ch) => ({ id: ch.id, name: ch.name, chroma: true, color: (ch.colors || [])[0] || '#888888' })),
  ]));
}

// Phone -> agent commands. Each maps to one LCU write.
async function runCommand({ cmd, ...a }) {
  if (cmd === 'setAutoAccept') { autoAccept = !!a.on; console.log('[cmd] autoAccept', autoAccept); return; }
  if (!lcu) lcu = await discoverLCU();
  if (!lcu) return console.log('[cmd] no client for', cmd);
  console.log('[cmd]', cmd, a);
  switch (cmd) {
    case 'setMode':       return void (await lcuPost(lcu, '/lol-lobby/v2/lobby', { queueId: a.queueId }));
    case 'setPosition':   return void (await lcuPut(lcu, '/lol-lobby/v2/lobby/members/localMember/position-preferences', { firstPreference: a.first, secondPreference: a.second }));
    case 'inviteFriend':  return void (await lcuPost(lcu, '/lol-lobby/v2/lobby/invitations', [{ toSummonerId: a.summonerId }]));
    case 'setIcon':       icons = null; return void (await lcuPut(lcu, '/lol-summoner/v1/current-summoner/icon', { profileIconId: a.iconId }));
    case 'dodge':         return void (await lcuPost(lcu, `/lol-login/v1/session/invoke?destination=lcdsServiceProxy&method=call&args=${encodeURIComponent(JSON.stringify(['', 'teambuilder-draft', 'quitV2', '']))}`));
    case 'honor': {       // post-game honor a teammate
      const cfg = await lcuGet(lcu, '/lol-honor-v2/v1/config').catch(() => null);
      const honorType = cfg?.honorCategories?.[0] || 'HEART';
      const b = await lcuGet(lcu, '/lol-honor-v2/v1/ballot').catch(() => ({}));
      try { await lcuPost(lcu, '/lol-honor-v2/v1/honor-player', { summonerId: a.sid, puuid: a.puuid, honorType, gameId: b.gameId }); }
      catch { await lcuPost(lcu, '/lol-honor-v2/v1/honor', { honorCategory: honorType, summonerId: a.sid, recipientPuuid: a.puuid, ballotId: b.gameId }).catch(() => {}); }
      return;
    }
    case 'chatSend':      return void (await lcuPost(lcu, `/lol-chat/v1/conversations/${encodeURIComponent(a.to)}/messages`, { body: a.text, type: 'chat' }));
    case 'continueEog':   return void (await lcuPost(lcu, '/lol-end-of-game/v1/state/dismiss-stats'));
    case 'playAgain':     return void (await lcuPost(lcu, '/lol-lobby/v2/play-again'));
    case 'startQueue':    return void (await lcuPost(lcu, '/lol-lobby/v2/lobby/matchmaking/search'));
    case 'stopQueue':     return void (await lcuDelete(lcu, '/lol-lobby/v2/lobby/matchmaking/search'));
    case 'acceptReady':   return void (await lcuPost(lcu, '/lol-matchmaking/v1/ready-check/accept'));
    case 'declineReady':  return void (await lcuPost(lcu, '/lol-matchmaking/v1/ready-check/decline'));
    case 'setSlotChampion': { // Swiftplay/Quickplay: change one pre-pick slot's champion
      const slots = (await lcuGet(lcu, '/lol-lobby/v1/lobby/members/localMember/player-slots')).map((s) => ({ ...s }));
      if (!slots[a.index]) return console.log('[cmd] no slot', a.index);
      slots[a.index].championId = a.championId;
      return void (await lcuPut(lcu, '/lol-lobby/v1/lobby/members/localMember/player-slots', slots));
    }
    case 'setSlotSpells': { // change a slot's summoner spells
      const slots = (await lcuGet(lcu, '/lol-lobby/v1/lobby/members/localMember/player-slots')).map((s) => ({ ...s }));
      if (!slots[a.index]) return console.log('[cmd] no slot', a.index);
      slots[a.index].spell1 = a.spell1; slots[a.index].spell2 = a.spell2;
      return void (await lcuPut(lcu, '/lol-lobby/v1/lobby/members/localMember/player-slots', slots));
    }
    case 'setSlotPosition': { // Swiftplay: change a slot's lane preference
      const slots = (await lcuGet(lcu, '/lol-lobby/v1/lobby/members/localMember/player-slots')).map((s) => ({ ...s }));
      if (!slots[a.index]) return console.log('[cmd] no slot', a.index);
      slots[a.index].positionPreference = a.position;
      return void (await lcuPut(lcu, '/lol-lobby/v1/lobby/members/localMember/player-slots', slots));
    }
    case 'setSlotSkin': { // Swiftplay: set an owned skin on a slot
      const slots = (await lcuGet(lcu, '/lol-lobby/v1/lobby/members/localMember/player-slots')).map((s) => ({ ...s }));
      if (!slots[a.index]) return console.log('[cmd] no slot', a.index);
      slots[a.index].skinId = a.skinId;
      return void (await lcuPut(lcu, '/lol-lobby/v1/lobby/members/localMember/player-slots', slots));
    }
    case 'applyRecommendedSet': { // Swiftplay: apply a chosen recommended rune+spell set
      const slots = (await lcuGet(lcu, '/lol-lobby/v1/lobby/members/localMember/player-slots')).map((s) => ({ ...s }));
      const slot = slots[a.index];
      if (!slot) return console.log('[cmd] no slot', a.index);
      slot.perks = JSON.stringify({ perkIds: a.perkIds, perkStyle: a.perkStyle, perkSubStyle: a.perkSubStyle });
      if (a.spell1 && a.spell2) { slot.spell1 = a.spell1; slot.spell2 = a.spell2; }
      return void (await lcuPut(lcu, '/lol-lobby/v1/lobby/members/localMember/player-slots', slots));
    }
    case 'setSlotPerks': { // Swiftplay: apply a fully custom rune page
      const slots = (await lcuGet(lcu, '/lol-lobby/v1/lobby/members/localMember/player-slots')).map((s) => ({ ...s }));
      if (!slots[a.index]) return console.log('[cmd] no slot', a.index);
      slots[a.index].perks = JSON.stringify({ perkIds: a.perkIds, perkStyle: a.perkStyle, perkSubStyle: a.perkSubStyle });
      return void (await lcuPut(lcu, '/lol-lobby/v1/lobby/members/localMember/player-slots', slots));
    }
    case 'reroll':       return void (await lcuPost(lcu, '/lol-champ-select/v1/session/my-selection/reroll'));
    case 'benchSwap':    return void (await lcuPost(lcu, `/lol-champ-select/v1/session/bench/swap/${a.championId}`));
    case 'tradeRequest': return void (await lcuPost(lcu, `/lol-champ-select/v1/session/trades/${a.id}/request`));
    case 'tradeAccept':  return void (await lcuPost(lcu, `/lol-champ-select/v1/session/trades/${a.id}/accept`));
    case 'tradeDecline': return void (await lcuPost(lcu, `/lol-champ-select/v1/session/trades/${a.id}/decline`));
    case 'csSelect': {   // champ-select skin/spell via my-selection
      const body = {};
      if (a.skinId) body.selectedSkinId = a.skinId;
      if (a.spell1) body.spell1Id = a.spell1;
      if (a.spell2) body.spell2Id = a.spell2;
      return void (await lcuPatch(lcu, '/lol-champ-select/v1/session/my-selection', body));
    }
    case 'applyRunePage': { // champ-select: write runes into the current rune page
      const cur = await lcuGet(lcu, '/lol-perks/v1/currentpage').catch(() => null);
      const page = { name: cur?.name || 'CWard', primaryStyleId: a.perkStyle, subStyleId: a.perkSubStyle, selectedPerkIds: a.perkIds, current: true };
      if (cur?.id && cur.isEditable) return void (await lcuPut(lcu, `/lol-perks/v1/pages/${cur.id}`, { ...page, id: cur.id, order: cur.order }));
      return void (await lcuPost(lcu, '/lol-perks/v1/pages', page)); // shortcut: current page locked → add one (may hit page cap); upgrade: delete an editable page first
    }
    case 'pick':
    case 'ban':
      if (lastAction == null) return console.log('[cmd] no active action');
      return void (await lcuPatch(lcu, `/lol-champ-select/v1/session/actions/${lastAction}`, { championId: a.championId, completed: !!a.lock }));
    default: console.log('[cmd] unknown', cmd);
  }
}
