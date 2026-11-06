// Pure shapers for pre-game LCU state (lobby, champ-select) into compact snapshots.

// Curated queues for the game-mode picker (queueId -> Korean label).
export const QUEUES = [
  { id: 430, ko: '일반 (블라인드)' },
  { id: 400, ko: '일반 (드래프트)' },
  { id: 480, ko: '신속 대전' },
  { id: 420, ko: '솔로/듀오 랭크' },
  { id: 440, ko: '자유 랭크' },
  { id: 450, ko: '칼바람 나락' },
  { id: 1700, ko: '아레나' },
  { id: 1900, ko: 'U.R.F.' },
];
const queueKo = (id) => QUEUES.find((q) => q.id === id)?.ko || (id ? `큐 ${id}` : '');

export const POSITIONS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];

// Real matchmade PvP modes (excludes TFT, tutorials, custom/bot). Rotating modes
// like 아수라장(KIWI) and 아레나(CHERRY) come straight from the client, so the
// picker always matches what's actually playable.
const PLAYABLE_MODES = new Set(['CLASSIC', 'ARAM', 'SWIFTPLAY', 'URF', 'CHERRY', 'KIWI']);
export function filterQueues(rawQueues = []) {
  const out = [];
  const seen = new Set();
  for (const q of rawQueues) {
    const ai = q.category === 'VersusAi';
    if (q.queueAvailability !== 'Available' || q.isCustom || (q.category !== 'PvP' && !ai)) continue;
    if (!PLAYABLE_MODES.has(q.gameMode) || !q.name) continue;
    const name = ai ? `AI · ${q.name}` : q.name;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ id: q.id, name, ai, mapId: q.mapId, cat: queueCategory(q) });
  }
  return out;
}

// Group modes: sr(협곡) / aram(칼바람) / special(특별·기타) / ai(상대대전).
function queueCategory(q) {
  if (q.category === 'VersusAi') return 'ai';
  if (q.gameMode === 'ARAM') return 'aram';
  if (q.gameMode === 'CLASSIC' || q.gameMode === 'SWIFTPLAY') return 'sr';
  return 'special';
}

// Convert an LCU asset path ("lol-game-data/assets/...") to its CommunityDragon URL.
export function cdragonAsset(path) {
  if (!path) return '';
  const rest = String(path).replace(/^\/?lol-game-data\/assets\//i, '').toLowerCase();
  return `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/${rest}`;
}

export function shapeLobby(lobby, queues = []) {
  const gc = lobby?.gameConfig ?? {};
  const lm = lobby?.localMember ?? {};
  // Swiftplay/Quickplay pre-pick champion+spell slots (empty for other modes).
  const slots = (lm.playerSlots ?? []).map((s) => {
    let perks = null;
    try { perks = typeof s.perks === 'string' ? JSON.parse(s.perks) : s.perks; } catch { /* leave null */ }
    return { championId: s.championId || 0, spell1: s.spell1 || 0, spell2: s.spell2 || 0, position: s.positionPreference || '', skinId: s.skinId || 0, perks };
  });
  return {
    kind: 'lobby',
    t: Date.now(),
    phase: 'Lobby',
    queues, // [{id,name}] available from the client; UI falls back to QUEUES if empty
    queueId: gc.queueId ?? null,
    queueName: queueKo(gc.queueId),
    quickPlay: gc.showQuickPlaySlotSelection === true,
    mapId: gc.mapId ?? 11,
    slots,
    mode: gc.gameMode || '',
    maxSize: gc.maxLobbySize ?? null,
    canPickPosition: [420, 440].includes(gc.queueId) || gc.showPositionSelector === true,
    positions: { first: lm.firstPositionPreference || '', second: lm.secondPositionPreference || '' },
    members: (lobby?.members ?? []).map((m) => ({
      name: m.summonerName || m.gameName || '',
      leader: !!m.isLeader,
      ready: !!m.ready,
      first: m.firstPositionPreference || '', second: m.secondPositionPreference || '',
    })),
  };
}

export function shapeChampSelect(session, pickable = [], bannable = []) {
  const myCell = session?.localPlayerCellId;
  const actions = (session?.actions ?? []).flat();
  const mine = actions.find((a) => a.actorCellId === myCell && a.isInProgress);
  const timer = session?.timer ?? {};
  const cellChamp = (t) => (session?.[t] ?? []).map((p) => ({
    cellId: p.cellId,
    championId: p.championId || 0,
    position: p.assignedPosition || '',
    me: p.cellId === myCell,
  }));
  return {
    kind: 'champselect',
    t: Date.now(),
    phase: 'ChampSelect',
    timeLeft: Math.round((timer.adjustedTimeLeftInPhase ?? 0) / 1000),
    timerPhase: timer.phase || '',
    myAction: mine ? { id: mine.id, type: mine.type, championId: mine.championId || 0 } : null,
    myTeam: cellChamp('myTeam'),
    theirTeam: cellChamp('theirTeam'),
    bans: {
      mine: session?.bans?.myTeamBans ?? [],
      theirs: session?.bans?.theirTeamBans ?? [],
    },
    pickable, // champion ids the client allows picking now
    bannable,
    // ARAM/bench + trades + my current selection (for reroll/bench/trade/skin/spell)
    benchEnabled: !!session?.benchEnabled,
    bench: (session?.benchChampions ?? []).map((b) => b.championId),
    rerolls: session?.rerollsRemaining ?? 0,
    trades: (session?.trades ?? []).filter((t) => t.state && t.state !== 'INVALID' && t.state !== 'BUSY')
      .map((t) => ({ id: t.id, cellId: t.cellId, state: t.state })),
    mine: (() => { const m = (session?.myTeam ?? []).find((p) => p.cellId === myCell); return m ? { championId: m.championId || 0, skinId: m.selectedSkinId || 0, spell1: m.spell1Id || 0, spell2: m.spell2Id || 0 } : null; })(),
  };
}
