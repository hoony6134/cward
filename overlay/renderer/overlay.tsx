import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  loadDDragonVersion, loadChampions, loadSummonerSpells, loadItemHaste, loadRunes,
  champIcon, champIconById, champ, spellIcon, fmtClock, spellCd, loadUltCd, ultRank, itemHaste, withHaste,
  itemIcon, perkIcon, sumSpellIcon,
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
    cward: {
      onSnapshot: (cb: (s: Snapshot) => void) => void;
      onReco: (cb: (b: Build) => void) => void;
      onPairing: (cb: (d: { link: string; qr: string }) => void) => void;
      ready: () => void;
    };
  }
}

function useNow() {
  const [, set] = useState(0);
  useEffect(() => { const id = setInterval(() => set((n) => n + 1), 1000); return () => clearInterval(id); }, []);
  return Date.now();
}

function Objectives({ snap }: { snap: Snapshot }) {
  const o = snap.objectives;
  if (!o) return null;
  return (
    <div className="card">
      <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
        <span className="pill muted">용 <b>{o.dragons.map((d) => d.type).join('·') || '—'}</b></span>
        {o.barons > 0 && <span className="pill muted">바론 <b>{o.barons}</b></span>}
        {o.heralds > 0 && <span className="pill muted">전령 <b>{o.heralds}</b></span>}
        {o.atakhan > 0 && <span className="pill muted">아타칸 <b>{o.atakhan}</b></span>}
        <span className="pill muted" style={{ marginLeft: 'auto' }}>
          포탑 <b style={{ color: '#5aa0e6' }}>{o.towers.ORDER}</b> · <b style={{ color: '#e06a6a' }}>{o.towers.CHAOS}</b>
        </span>
      </div>
    </div>
  );
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
  return (
    <div className="card">
      <div className="title">상대 스펠 · 궁 쿨</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {enemies.map((p) => (
          <div className="row" key={p.riotId}>
            {ready && <img className="champ" src={champIcon(p.champKey)} alt={p.champion} />}
            <span className="name muted">{p.champion}</span>
            <div className="row nodrag" style={{ gap: 4, flexWrap: 'wrap' }}>
              {p.spells.map((s, i) => s?.key ? (
                <Chip key={i} icon={ready ? spellIcon(s.key) : ''} left={left(`${p.riotId}:s${i}`)}
                  title={s.name || s.key} onClick={() => toggle(`${p.riotId}:s${i}`, spellCd(s.key))} />
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
  return (
    <button className={`chip${left ? ' cooling' : ''}`} title={title} onClick={onClick}>
      {icon ? <img src={icon} alt={title} /> : <span className="cd" style={{ color: left ? '#8aa0b8' : '#9ec1ff' }}>{label}</span>}
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

function Icons({ ids, kind, size = 26 }: { ids: number[]; kind: 'item' | 'rune'; size?: number }) {
  return (
    <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
      {ids.map((id, i) => {
        const src = kind === 'item' ? itemIcon(id) : perkIcon(id);
        return src ? <img key={i} src={src} width={size} height={size} style={{ borderRadius: 6, border: '1px solid rgba(120,150,190,.3)' }} />
          : <span key={i} style={{ width: size, height: size, borderRadius: 6, background: '#122235', display: 'inline-block' }} />;
      })}
    </div>
  );
}

function BuildPanel({ build, ready }: { build: NonNullable<Build>; ready: boolean }) {
  const wr = build.winRate != null ? ` · 승률 ${Math.round(build.winRate * 100)}%` : '';
  return (
    <div className="card nodrag">
      <div className="title">추천 빌드 · OP.GG ({build.mode}){wr}</div>
      {build.items?.ids?.length ? (
        <>
          <div className="muted" style={{ fontSize: 10, margin: '2px 0 4px' }}>코어 아이템</div>
          {ready && <Icons ids={[...build.items.ids, ...build.boots]} kind="item" />}
        </>
      ) : null}
      {build.skills.length ? (
        <div style={{ marginTop: 8 }}>
          <span className="muted" style={{ fontSize: 10 }}>선마 </span>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#e9c877' }}>{maxOrder(build.skills).join(' › ')}</span>
        </div>
      ) : null}
      {build.runes ? (
        <div style={{ marginTop: 8 }}>
          <div className="muted" style={{ fontSize: 10, marginBottom: 4 }}>룬</div>
          {ready && <Icons ids={[...build.runes.primary, ...build.runes.secondary]} kind="rune" size={22} />}
        </div>
      ) : null}
      {build.spells.length ? (
        <div className="row" style={{ marginTop: 8, gap: 4 }}>
          <span className="muted" style={{ fontSize: 10 }}>스펠</span>
          {ready && build.spells.map((id, i) => {
            const src = sumSpellIcon(id);
            return src ? <img key={i} src={src} width={22} height={22} style={{ borderRadius: 5 }} /> : null;
          })}
        </div>
      ) : null}
    </div>
  );
}

function Hud({ snap, ready }: { snap: Snapshot; ready: boolean }) {
  const players = snap.players ?? [];
  const me = players.find((p) => p.riotId === snap.active?.riotId);
  const enemies = me ? players.filter((p) => p.team !== me.team) : players.filter((p) => p.team === 'CHAOS');
  return (
    <>
      <div className="card drag">
        <div className="row">
          <span className="clock">{fmtClock(snap.game?.time ?? 0)}</span>
          <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>{snap.game?.mode ?? ''}</span>
          {snap.active && <span className="pill" style={{ marginLeft: 'auto' }}><b>{snap.active.gold.toLocaleString('ko-KR')}</b> G</span>}
        </div>
      </div>
      <Objectives snap={snap} />
      <SpellTracker enemies={enemies} ready={ready} />
    </>
  );
}

function ChampSelectHead({ snap, ready }: { snap: Snapshot; ready: boolean }) {
  const id = snap.mine?.championId;
  const c = id ? champ(id) : null;
  return (
    <div className="card drag">
      <div className="row">
        {ready && id ? <img className="champ" src={champIconById(id)} alt={c?.name} /> : <span className="champ" style={{ background: '#122235' }} />}
        <span style={{ fontSize: 13, fontWeight: 700 }}>{c?.name ?? '챔피언 선택'}</span>
        <span className="muted" style={{ fontSize: 11, marginLeft: 'auto' }}>
          {snap.timeLeft ? `${snap.timeLeft}s` : '챔프 선택'}
        </span>
      </div>
    </div>
  );
}

function App() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [build, setBuild] = useState<Build>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => { await loadDDragonVersion(); await Promise.all([loadChampions(), loadSummonerSpells(), loadItemHaste(), loadRunes()]); setReady(true); })();
    window.cward.onSnapshot((s) => setSnap(s));
    window.cward.onReco((b) => setBuild(b));
    window.cward.ready();
  }, []);
  if (snap?.kind === 'ingame' && snap.players?.length) {
    return (
      <>
        <Hud snap={snap} ready={ready} />
        {build && <BuildPanel build={build} ready={ready} />}
      </>
    );
  }
  if (snap?.kind === 'champselect') {
    return (
      <>
        <ChampSelectHead snap={snap} ready={ready} />
        {build ? <BuildPanel build={build} ready={ready} />
          : <div className="card idle">{snap.mine?.championId ? '빌드 불러오는 중…' : '챔피언을 고르면 추천이 떠요'}</div>}
      </>
    );
  }
  return <div className="card drag idle">cward · 대기 중{snap?.kind ? ` (${snap.kind})` : ''}</div>;
}

createRoot(document.getElementById('root')!).render(<App />);
