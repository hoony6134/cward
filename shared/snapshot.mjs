// Shapes the League Live Client Data `/liveclientdata/allgamedata` blob into a
// compact, UI-ready snapshot. Pure function so it is trivially testable and runs
// the same on the agent. Input is the parsed allgamedata JSON; `phase` is the LCU
// gameflow phase (or null when only Live Client is available).

const champKey = (raw, name) => {
  // rawChampionName looks like "game_character_displayname_Ahri"; fall back to name.
  if (raw && raw.includes('_')) return raw.split('_').pop();
  return (name || '').replace(/[^A-Za-z0-9]/g, '');
};

const normalizeSpell = (k) => (k.startsWith('Smite') ? 'Smite' : k);

const DRAGON = {
  Fire: '불', Air: '바람', Earth: '대지', Water: '바다',
  Hextech: '마공학', Chemtech: '화학공학', Elder: '장로',
};

export function shapeSnapshot(data, phase = null) {
  const g = data?.gameData ?? {};
  const players = (data?.allPlayers ?? []).map((p) => ({
    riotId: p.riotId || p.summonerName || p.riotIdGameName || '',
    name: p.riotIdGameName || p.summonerName || p.riotId || '',
    champion: p.championName || '',
    champKey: champKey(p.rawChampionName, p.championName),
    team: p.team,                       // "ORDER" | "CHAOS"
    position: p.position || '',         // TOP/JUNGLE/MIDDLE/BOTTOM/UTILITY ('' in some modes)
    level: p.level ?? 0,
    isBot: !!p.isBot,
    dead: !!p.isDead,
    respawn: Math.round(p.respawnTimer ?? 0),
    k: p.scores?.kills ?? 0,
    d: p.scores?.deaths ?? 0,
    a: p.scores?.assists ?? 0,
    cs: p.scores?.creepScore ?? 0,
    ward: p.scores?.wardScore ?? 0,
    spells: [p.summonerSpells?.summonerSpellOne, p.summonerSpells?.summonerSpellTwo].map((s) => ({
      name: s?.displayName || '',
      // key from rawDisplayName e.g. "..._SummonerFlash_DisplayName" -> "Flash" (last match).
      // Smite upgrades (SmiteAvatarOffensive/Utility, 원시의 강타) collapse to base Smite — ddragon has no variant icons.
      key: normalizeSpell((s?.rawDisplayName?.match(/Summoner([A-Z][a-zA-Z]+)/g)?.pop() || '').replace('Summoner', '')),
    })),
    items: (p.items ?? []).map((it) => ({ id: it.itemID, name: it.displayName || '', count: it.count ?? 1 })),
  }));

  // Derive objective tallies from the event feed so the UI doesn't re-parse events.
  const events = data?.events?.Events ?? [];
  const dragons = [];
  let barons = 0, heralds = 0, atakhan = 0;
  const towers = { ORDER: 0, CHAOS: 0 }; // towers the team DESTROYED (killer's team)
  for (const e of events) {
    switch (e.EventName) {
      case 'DragonKill':
        dragons.push({ type: DRAGON[e.DragonType] || e.DragonType || '용', time: Math.round(e.EventTime || 0) });
        break;
      case 'BaronKill': barons++; break;
      case 'HeraldKill': heralds++; break;
      case 'AtakhanKill': atakhan++; break;
      case 'TurretKilled': {
        // TurretKilled names the turret by the team that OWNED it; the other team destroyed it.
        const owned = /T100/.test(e.TurretKilled) ? 'ORDER' : /T200/.test(e.TurretKilled) ? 'CHAOS' : null;
        if (owned === 'ORDER') towers.CHAOS++;
        else if (owned === 'CHAOS') towers.ORDER++;
        break;
      }
    }
  }

  const ap = data?.activePlayer ?? null;
  const active = ap
    ? {
        riotId: ap.riotId || ap.summonerName || '',
        level: ap.level ?? 0,
        gold: Math.round(ap.currentGold ?? 0),
        hp: Math.round(ap.championStats?.currentHealth ?? 0),
        maxHp: Math.round(ap.championStats?.maxHealth ?? 0),
        resourceType: ap.championStats?.resourceType || '',
        res: Math.round(ap.championStats?.resourceValue ?? 0),
        maxRes: Math.round(ap.championStats?.resourceMax ?? 0),
        abilities: {
          Q: ap.abilities?.Q?.abilityLevel ?? 0,
          W: ap.abilities?.W?.abilityLevel ?? 0,
          E: ap.abilities?.E?.abilityLevel ?? 0,
          R: ap.abilities?.R?.abilityLevel ?? 0,
        },
      }
    : null;

  return {
    kind: 'ingame',
    t: Date.now(),
    phase,
    game: {
      mode: g.gameMode || '',
      mapId: g.mapNumber ?? null,
      time: Math.round(g.gameTime ?? 0), // seconds
    },
    active,
    players,
    objectives: { dragons, barons, heralds, atakhan, towers },
    recent: events.slice(-12).map((e) => ({ id: e.EventID, name: e.EventName, time: Math.round(e.EventTime || 0) })),
  };
}
