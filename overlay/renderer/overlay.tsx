import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  loadDDragonVersion, loadChampions, loadSummonerSpells, loadItemHaste, loadRunes,
  champIcon, champIconById, champ, spellIcon, spellIconByName, fmtClock, spellCd, loadUltCd, ultRank, itemHaste, withHaste,
  itemIcon, perkIcon, sumSpellIcon, loadAbilityIcons,
} from '@web/ddragon';
import type { Snapshot, Player } from '@web/useRelay';

type Build = {
  champion: string; mode: string; winRate: number | null;
  items: { ids: number[]; names: string[]; play: number | null; win: number | null } | null;
  boots: number[]; starter: number[]; skills: string[]; spells: number[];
  runes: { primary: number[]; secondary: number[]; statMods: number[] } | null;
} | null;

declare global {
  interface Window {
    cward?: {
      onSnapshot: (cb: (s: Snapshot) => void) => void;
      onReco: (cb: (b: Build) => void) => void;
      onPairing: (cb: (d: { link: string; qr: string }) => void) => void;
      setMouseIgnore: (ignore: boolean) => void;
      getAugments: () => Promise<Augment[] | null>;
      ready: () => void;
    };
  }
}

type Augment = { id: string; name: string; tier: string; desc: string; icon: string; champs: string[] };

// When a panel captures clicks, the full-screen window must briefly stop ignoring
// the mouse while the pointer is over it; otherwise clicks fall through to the game.
let dragging = false;
const capture = window.cward
  ? {
      onPointerEnter: () => { if (!dragging) window.cward!.setMouseIgnore(false); },
      onPointerLeave: () => { if (!dragging) window.cward!.setMouseIgnore(true); },
    }
  : {};

type Pos = { left: number; top: number };
// Drag a panel by its title bar; position persists in localStorage. Double-click
// the title to reset to the default spot.
function useDraggable(key: string, def: Pos) {
  const [pos, setPos] = useState<Pos>(() => {
    try { const s = localStorage.getItem('cward:pos:' + key); if (s) return JSON.parse(s); } catch { /* ignore */ }
    return def;
  });
  const onPointerDown = (e: { clientX: number; clientY: number; preventDefault: () => void }) => {
    e.preventDefault();
    dragging = true;
    window.cward?.setMouseIgnore(false);
    const sx = e.clientX, sy = e.clientY, base = pos;
    const move = (ev: PointerEvent) => setPos({ left: Math.max(0, base.left + ev.clientX - sx), top: Math.max(0, base.top + ev.clientY - sy) });
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      dragging = false; window.cward?.setMouseIgnore(true);
      setPos((p) => { try { localStorage.setItem('cward:pos:' + key, JSON.stringify(p)); } catch { /* ignore */ } return p; });
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const onDoubleClick = () => { try { localStorage.removeItem('cward:pos:' + key); } catch { /* ignore */ } setPos(def); };
  return { style: { left: pos.left, top: pos.top } as const, handle: { onPointerDown, onDoubleClick, style: { cursor: 'move' } as const } };
}

function useNow() {
  const [, set] = useState(0);
  useEffect(() => { const id = setInterval(() => set((n) => n + 1), 1000); return () => clearInterval(id); }, []);
  return Date.now();
}

function SpellTracker({ enemies, ready }: { enemies: Player[]; ready: boolean }) {
  const now = useNow();
  const [until, setUntil] = useState<Record<string, number>>({});
  const [ultCd, setUltCd] = useState<Record<string, number[]>>({});
  useEffect(() => {
    enemies.forEach((p) => { if (p.champKey && !ultCd[p.champKey]) loadUltCd(p.champKey).then((cd) => setUltCd((m) => ({ ...m, [p.champKey]: cd }))); });
  }, [enemies, ultCd]);
  if (!enemies.length) return null;
  const toggle = (k: string, cd: number) => setUntil((u) => ({ ...u, [k]: u[k] && u[k] > now ? 0 : now + cd * 1000 }));
  const left = (k: string) => Math.max(0, Math.ceil(((until[k] || 0) - now) / 1000));
  const ah = (p: Player) => p.items.reduce((s, it) => s + itemHaste(it.id), 0);
  const rCd = (p: Player) => withHaste(ultCd[p.champKey]?.[ultRank(p.level) - 1] ?? 100, ah(p));
  const drag = useDraggable('spell', { left: 10, top: Math.round(window.innerHeight * 0.5 - 130) });
  return (
    <div className="card left-rail" style={drag.style} {...capture}>
      <div className="title" {...drag.handle}>상대 스펠 · 궁 쿨 ⠿</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {enemies.map((p) => (
          <div className="row" key={p.riotId}>
            {ready && <img className="champ" src={champIcon(p.champKey)} alt={p.champion} />}
            <div className="wrap">
              {p.spells.map((s, i) => (s?.key || s?.name) ? (
                <Chip key={i} icon={ready ? (spellIconByName(s.name) || spellIcon(s.key)) : ''} left={left(`${p.riotId}:s${i}`)}
                  label={(s.name || s.key || '').slice(0, 2)} title={s.name || s.key} onClick={() => toggle(`${p.riotId}:s${i}`, spellCd(s.key))} />
              ) : null)}
              <Chip label="R" left={left(`${p.riotId}:R`)} title={`궁 ${rCd(p)}초`} onClick={() => toggle(`${p.riotId}:R`, rCd(p))} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Chip({ icon, label, left, title, onClick }: { icon?: string; label?: string; left: number; title: string; onClick: () => void }) {
  const [err, setErr] = useState(false);
  const showImg = icon && !err;
  return (
    <button className={`chip${left ? ' cooling' : ''}`} title={title} onClick={onClick}>
      {showImg ? <img src={icon} alt={title} onError={() => setErr(true)} />
        : <span className="cd chip-l" style={{ color: left ? '#8aa0b8' : '#9ec1ff' }}>{label}</span>}
      {left > 0 && <span className="cd">{left}</span>}
    </button>
  );
}

// Skill max priority from the leveling order: most-leveled first, ties by earliest.
function maxOrder(order: string[]): string[] {
  const c: Record<string, [number, number]> = { Q: [0, 99], W: [0, 99], E: [0, 99] };
  order.forEach((k, i) => { if (c[k]) { c[k][0]++; if (c[k][1] === 99) c[k][1] = i; } });
  return ['Q', 'W', 'E'].sort((a, b) => c[b][0] - c[a][0] || c[a][1] - c[b][1]);
}

// The player's Q/W/E/R ability icons with the next-to-level one highlighted (pink).
// Drag it next to the game's own skill bar.
function AbilityBar({ champKey, abilities, skills, ready }: { champKey: string; abilities?: { Q: number; W: number; E: number; R: number } | null; skills: string[]; ready: boolean }) {
  const [icons, setIcons] = useState<{ Q: string; W: string; E: string; R: string } | null>(null);
  useEffect(() => { if (champKey) loadAbilityIcons(champKey).then(setIcons); }, [champKey]);
  const drag = useDraggable('ability', { left: Math.round(window.innerWidth / 2 - 96), top: window.innerHeight - 150 });
  const spent = abilities ? abilities.Q + abilities.W + abilities.E + abilities.R : 0;
  const next = skills[spent]; // which ability to level with the next point
  const keys = ['Q', 'W', 'E', 'R'] as const;
  return (
    <div className="card ability-bar" style={drag.style} {...capture}>
      <div className="title" {...drag.handle}>스킬 추천 ⠿</div>
      <div className="row" style={{ gap: 6 }}>
        {keys.map((k) => (
          <div className={`abil${next === k ? ' next' : ''}`} key={k}>
            {ready && icons?.[k] ? <img src={icons[k]} alt={k} /> : <span className="abil-l">{k}</span>}
            <span className="abil-k">{k}{abilities ? abilities[k] : 0}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Recommended build. In-game: items only (what to buy). Champ select (full): also
// skill order, runes and summoner spells — the things you set at the pick screen.
function BuildDock({ build, ready, full }: { build: NonNullable<Build>; ready: boolean; full?: boolean }) {
  const wr = build.winRate != null ? ` · 승률 ${Math.round(build.winRate * 100)}%` : '';
  const items = [...(build.items?.ids ?? []), ...build.boots];
  const drag = useDraggable('build', { left: Math.max(0, window.innerWidth - 314), top: Math.max(0, window.innerHeight - 230) });
  return (
    <div className="card build-dock" style={drag.style} {...capture}>
      <div className="title" {...drag.handle}>추천 {full ? '빌드' : '아이템'} · OP.GG ({build.mode}){wr} ⠿</div>
      {items.length ? <div className="wrap">{ready && items.map((id, i) => <img key={i} className="itm" src={itemIcon(id)} />)}</div> : null}
      {full && build.skills.length ? (
        <div style={{ marginTop: 8 }}><span className="muted" style={{ fontSize: 10 }}>선마 </span><b style={{ color: '#e9c877', fontSize: 12 }}>{maxOrder(build.skills).join(' › ')}</b></div>
      ) : null}
      {full && (build.runes || build.spells.length) ? (
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
          {build.runes && ready ? <span className="wrap">{[...build.runes.primary.slice(0, 1), ...build.runes.secondary.slice(0, 1)].map((id, i) => <img key={i} className="rune" src={perkIcon(id)} />)}</span> : null}
          {build.spells.length && ready ? <span className="wrap">{build.spells.map((id, i) => { const s = sumSpellIcon(id); return s ? <img key={i} className="sp" src={s} /> : null; })}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

// ARAM: Mayhem augment tier list (S/A/B/C/D) — which augments are good, from Blitz.
const TIER_COLOR: Record<string, string> = { S: '#ff5d73', A: '#ff9f43', B: '#e9c877', C: '#6aa6e6', D: '#8aa0b8' };
function AugmentPanel() {
  const [list, setList] = useState<Augment[] | null>(null);
  const [q, setQ] = useState('');
  const drag = useDraggable('augments', { left: Math.max(0, window.innerWidth - 314), top: 60 });
  useEffect(() => {
    if (window.cward) { window.cward.getAugments().then((a) => setList(a)); return; }
    setList([ // browser-preview demo only
      { id: '1', name: '거인', tier: 'S', desc: '', icon: '', champs: [] },
      { id: '2', name: '보석 장식 건틀릿', tier: 'A', desc: '', icon: '', champs: [] },
      { id: '3', name: '둔기', tier: 'C', desc: '', icon: '', champs: [] },
    ]);
  }, []);
  const shown = (list ?? []).filter((a) => !q || a.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="card augment-panel" style={drag.style} {...capture}>
      <div className="title" {...drag.handle}>증강 티어 (아수라장) ⠿</div>
      <input className="aug-search" placeholder="증강 검색…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="aug-list">
        {list == null ? <div className="muted" style={{ fontSize: 11, padding: 6 }}>불러오는 중…</div>
          : shown.length === 0 ? <div className="muted" style={{ fontSize: 11, padding: 6 }}>결과 없음</div>
          : shown.map((a) => (
            <div className="aug-row" key={a.id} title={a.desc}>
              <span className="aug-tier" style={{ background: TIER_COLOR[a.tier] ?? '#888' }}>{a.tier}</span>
              {a.icon ? <img className="aug-ic" src={a.icon} onError={(e) => ((e.currentTarget.style.display = 'none'))} /> : null}
              <b style={{ fontSize: 12 }}>{a.name}</b>
            </div>
          ))}
      </div>
    </div>
  );
}

function TopHud({ snap }: { snap: Snapshot }) {
  const o = snap.objectives;
  const drag = useDraggable('hud', { left: Math.round(window.innerWidth / 2 - 120), top: 12 });
  return (
    <div className="card top-hud" style={drag.style} {...capture}>
      <div className="row" style={{ gap: 10 }} {...drag.handle}>
        <span className="clock">{fmtClock(snap.game?.time ?? 0)}</span>
        <span className="muted" style={{ fontSize: 11 }}>{snap.game?.mode ?? ''}</span>
        {snap.active && <span className="pill"><b>{snap.active.gold.toLocaleString('ko-KR')}</b> G</span>}
        {o && <span className="pill muted">· 용 <b>{o.dragons.map((d) => d.type).join('') || '—'}</b> · 탑 <b style={{ color: '#5aa0e6' }}>{o.towers.ORDER}</b>:<b style={{ color: '#e06a6a' }}>{o.towers.CHAOS}</b></span>}
      </div>
    </div>
  );
}

function App() {
  const [snap, setSnap] = useState<Snapshot | null>(demoSnap());
  const [build, setBuild] = useState<Build>(demoBuild());
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => { await loadDDragonVersion(); await Promise.all([loadChampions(), loadSummonerSpells(), loadItemHaste(), loadRunes()]); setReady(true); })();
    if (window.cward) {
      setSnap(null); setBuild(null); // live mode: wait for real data
      window.cward.onSnapshot((s) => setSnap(s));
      window.cward.onReco((b) => setBuild(b));
      window.cward.ready();
    }
  }, []);

  const inGame = snap && (snap.kind === 'ingame' || snap.kind === 'champselect') && (snap.players?.length || snap.kind === 'champselect');
  if (!inGame) return <div className="idle">cward · 대기 중{snap?.kind ? ` (${snap.kind})` : ''}</div>;

  const players = snap!.players ?? [];
  const me = players.find((p) => p.riotId === snap!.active?.riotId);
  const enemies = me ? players.filter((p) => p.team !== me.team) : players.filter((p) => p.team === 'CHAOS');
  if (snap!.kind === 'champselect') {
    return <><ChampSelectHead snap={snap!} ready={ready} />{build && <BuildDock build={build} ready={ready} full />}</>;
  }
  return (
    <>
      <TopHud snap={snap!} />
      <SpellTracker enemies={enemies} ready={ready} />
      {me?.champKey && build?.skills?.length ? <AbilityBar champKey={me.champKey} abilities={snap!.active?.abilities} skills={build.skills} ready={ready} /> : null}
      {build && <BuildDock build={build} ready={ready} />}
      {snap!.game?.mode === 'KIWI' && <AugmentPanel />}
    </>
  );
}

// ---- demo data (browser preview only; replaced by live data when window.cward exists) ----
function demoSnap(): Snapshot | null {
  if (window.cward) return null;
  const mk = (riotId: string, champion: string, champKey: string, team: 'ORDER' | 'CHAOS', spells: string[]): Player => ({
    riotId, name: riotId, champion, champKey, team, position: '', level: 11, isBot: false, dead: false, respawn: 0,
    k: 3, d: 2, a: 5, cs: 120, ward: 2, spells: spells.map((k) => ({ name: k, key: k })), items: [],
  });
  return {
    kind: 'ingame', t: Date.now(), phase: 'InProgress', game: { mode: 'KIWI', mapId: 12, time: 723 },
    active: { riotId: 'me#KR1', level: 6, gold: 2450, hp: 1400, maxHp: 1800, resourceType: 'MANA', res: 300, maxRes: 600, abilities: { Q: 3, W: 1, E: 1, R: 1 } },
    players: [
      mk('me#KR1', 'Annie', 'Annie', 'ORDER', ['Flash', 'Dot']),
      mk('A#KR', 'Ezreal', 'Ezreal', 'CHAOS', ['Flash', 'Heal']),
      mk('B#KR', 'Fiddlesticks', 'FiddleSticks', 'CHAOS', ['Flash', 'Teleport']),
      mk('C#KR', 'Caitlyn', 'Caitlyn', 'CHAOS', ['Flash', 'Heal']),
    ],
    objectives: { dragons: [{ type: '화', time: 300 }], barons: 0, heralds: 1, atakhan: 0, towers: { ORDER: 3, CHAOS: 1 } },
    recent: [],
  };
}
function demoBuild(): Build {
  if (window.cward) return null;
  return {
    champion: 'ANNIE', mode: 'aram', winRate: 0.47,
    items: { ids: [3118, 4646, 4645], names: ['Malignance', 'Stormsurge', 'Shadowflame'], play: 1754, win: 885 },
    boots: [3020], starter: [], skills: ['Q', 'W', 'E', 'Q', 'Q', 'R', 'Q', 'W', 'Q', 'W', 'R', 'W', 'W', 'E', 'E'], spells: [4, 32],
    runes: { primary: [8128, 8126, 8140, 8106], secondary: [8210, 8236], statMods: [5008, 5008, 5001] },
  };
}

createRoot(document.getElementById('root')!).render(<App />);
