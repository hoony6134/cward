import { useEffect, useRef, useState } from 'react';
import { useRelay, clearPairing, parsePairing, savePairing, type Snapshot, type Player, type Command } from './useRelay';
import {
  loadDDragonVersion, loadChampions, loadSummonerSpells, allChampions, champIcon, champIconById, champ, itemIcon,
  loadRecommended, fmtClock, eventKo, spellCd, spellIcon, sumSpellIcon, summonerSpells, loadUltCd, ultRank, profileIcon, positionIcon,
  loadItemHaste, itemHaste, withHaste,
} from './ddragon';
import { POSITIONS } from '../../shared/clientstate.mjs';

const RELAY = import.meta.env.VITE_RELAY_WS_URL as string;
const posKo = (p: string) =>
  ({ TOP: '탑', JUNGLE: '정글', MIDDLE: '미드', BOTTOM: '원딜', UTILITY: '서폿', '': '지정안함' } as Record<string, string>)[p] ?? p;

function useNow() {
  const [, set] = useState(0);
  useEffect(() => { const id = setInterval(() => set((n) => n + 1), 1000); return () => clearInterval(id); }, []);
  return Date.now();
}

function notify(title: string, body: string) {
  if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification(title, { body, icon: '/icon.svg' }); } catch { /* ignore */ }
  }
}

export default function App() {
  const { snap, status, paired, send } = useRelay(RELAY);
  const [ready, setReady] = useState(false);
  useEffect(() => { (async () => { await loadDDragonVersion(); await Promise.all([loadChampions(), loadSummonerSpells(), loadItemHaste()]); setReady(true); })(); }, []);

  // Notify on queue pop (match found) even when the tab is backgrounded.
  const prev = useRef<string>();
  useEffect(() => {
    if (snap?.kind === 'readycheck' && prev.current !== 'readycheck') notify('매칭 완료', '자동 수락됨 — 게임으로 이동하세요');
    prev.current = snap?.kind;
  }, [snap?.kind]);

  if (!paired) return <Pairing />;
  const kind = snap?.kind;

  return (
    <div className="min-h-dvh pb-12">
      <div className="topbar">{status !== '연결됨' && <i />}</div>
      <header className="sticky top-0 z-10 flex items-center gap-2 px-4 py-3 bg-[#070d16]/90 backdrop-blur border-b hair">
        <span className="font-hud text-xl font-bold text-[var(--gold)]">WARD</span>
        <span className="text-xs text-[var(--muted)] tracking-wide">{headerLabel(snap)}</span>
        {snap?.me?.name && ready && kind !== 'ingame' && (
          <span className="flex items-center gap-1.5 ml-1 min-w-0">
            {snap.me.iconId > 0 && <img src={profileIcon(snap.me.iconId)} className="w-5 h-5 rounded-full ring-1 ring-[var(--gold-dim)]" />}
            <span className="text-xs text-[var(--text)] truncate">{snap.me.name}</span>
          </span>
        )}
        {kind === 'ingame' && <span className="ml-auto font-mono text-xl tabular-nums text-[var(--gold-br)]">{fmtClock(snap!.game?.time ?? 0)}</span>}
        <NotifBell className={kind === 'ingame' ? '' : 'ml-auto'} />
        <Dot status={status} />
      </header>

      <div className="enter" key={kind}>
        {!snap ? <Loading />
          : kind === 'ingame' && snap.players?.length ? <Ingame snap={snap} ready={ready} />
          : kind === 'champselect' ? <ChampSelect snap={snap} ready={ready} send={send} />
          : kind === 'lobby' ? <Lobby snap={snap} ready={ready} send={send} />
          : kind === 'readycheck' ? <ReadyCheck send={send} />
          : kind === 'searching' ? <Searching snap={snap} send={send} />
          : <Waiting status={status} phase={snap.phase} />}
      </div>

      <button onClick={clearPairing} className="mt-8 mx-auto block text-xs text-[var(--muted)]/60 underline">페어링 해제</button>
    </div>
  );
}

function headerLabel(snap: Snapshot | null) {
  if (!snap) return '';
  return ({ ingame: '', lobby: '로비', champselect: '챔피언 선택', readycheck: '수락', searching: '매칭 중' } as Record<string, string>)[snap.kind || ''] || '';
}

function Dot({ status }: { status: string }) {
  const c = status === '연결됨' ? 'bg-[var(--blue)]' : status === '끊김' ? 'bg-[var(--red)]' : 'bg-[var(--gold)]';
  return <span className={`inline-block w-2 h-2 rounded-full ${c}`} title={status} />;
}

function NotifBell({ className = '' }: { className?: string }) {
  const [perm, setPerm] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'denied');
  if (perm === 'granted' || typeof Notification === 'undefined') return <span className={className} />;
  return (
    <button className={`${className} text-xs btn btn-ghost px-2 py-1`}
      onClick={() => Notification.requestPermission().then(setPerm)}>알림 켜기</button>
  );
}

/* ---------------- shared bits ---------------- */

function Panel({ title, children, className = '' }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`panel px-4 py-3 ${className}`}>
      {title && <h2 className="panel-title mb-2">{title}</h2>}
      {children}
    </section>
  );
}

function ChampImg({ id, className }: { id: number; className?: string }) {
  return id ? <img src={champIconById(id)} alt={champ(id)?.name} className={className} loading="lazy" />
    : <span className={`skeleton ${className}`} />;
}

function Loading() {
  return (
    <main className="px-3 space-y-3 mt-3">
      {[0, 1, 2].map((i) => <div key={i} className="panel px-4 py-3"><div className="skeleton h-4 w-24 mb-3" /><div className="skeleton h-16 w-full" /></div>)}
    </main>
  );
}

/* ---------------- In-game ---------------- */

function Ingame({ snap, ready }: { snap: Snapshot; ready: boolean }) {
  const players = snap.players!;
  const me = players.find((p) => p.riotId === snap.active?.riotId);
  const enemies = me ? players.filter((p) => p.team !== me.team) : players.filter((p) => p.team === 'CHAOS');
  return (
    <main className="px-3 space-y-3 mt-3">
      <Objectives snap={snap} />
      <SpellTracker enemies={enemies} ready={ready} />
      {me && <ItemReco champKey={me.champKey} mapId={snap.game?.mapId ?? 11} ready={ready} />}
      {snap.active && <ActivePanel snap={snap} />}
      <Teams players={players} meId={snap.active?.riotId} ready={ready} />
      <EventFeed snap={snap} />
    </main>
  );
}

function Pill({ label, value, tone = 'gold' }: { label: string; value: string | number; tone?: 'gold' | 'blue' | 'red' }) {
  const c = tone === 'blue' ? 'text-[var(--blue)]' : tone === 'red' ? 'text-[var(--red)]' : 'text-[var(--gold)]';
  return <span className="text-sm"><span className="text-[var(--muted)] text-xs mr-1">{label}</span><span className={c}>{value}</span></span>;
}

function Objectives({ snap }: { snap: Snapshot }) {
  const o = snap.objectives!;
  return (
    <section className="panel flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <Pill label="용" value={o.dragons.map((d) => d.type).join('·') || '—'} />
      {o.barons > 0 && <Pill label="바론" value={o.barons} />}
      {o.heralds > 0 && <Pill label="전령" value={o.heralds} />}
      {o.atakhan > 0 && <Pill label="아타칸" value={o.atakhan} />}
      <span className="ml-auto flex items-center gap-3">
        <Pill label="블루 포탑" value={o.towers.ORDER} tone="blue" />
        <Pill label="레드" value={o.towers.CHAOS} tone="red" />
      </span>
    </section>
  );
}

function SpellTracker({ enemies, ready }: { enemies: Player[]; ready: boolean }) {
  const now = useNow();
  const [until, setUntil] = useState<Record<string, number>>({});
  const [ultCd, setUltCd] = useState<Record<string, number[]>>({});
  useEffect(() => {
    enemies.forEach((p) => { if (p.champKey && !ultCd[p.champKey]) loadUltCd(p.champKey).then((cd) => setUltCd((m) => ({ ...m, [p.champKey]: cd }))); });
  }, [enemies, ultCd]);
  const toggle = (k: string, cd: number) => setUntil((u) => ({ ...u, [k]: u[k] && u[k] > now ? 0 : now + cd * 1000 }));
  const left = (k: string) => Math.max(0, Math.ceil(((until[k] || 0) - now) / 1000));
  const ah = (p: Player) => p.items.reduce((sum, it) => sum + itemHaste(it.id), 0);
  const rCd = (p: Player) => withHaste(ultCd[p.champKey]?.[ultRank(p.level) - 1] ?? 100, ah(p));
  if (!enemies.length) return null;
  return (
    <Panel title="상대 스펠 · 궁 쿨">
      <ul className="space-y-2">
        {enemies.map((p) => (
          <li key={p.riotId} className="flex items-center gap-2">
            {ready && <img src={champIcon(p.champKey)} alt={p.champion} className="w-8 h-8 rounded shrink-0 ring-1 ring-[var(--gold-dim)]" />}
            <span className="text-xs w-16 truncate text-[var(--muted)]">{p.champion}</span>
            <div className="flex gap-1.5 flex-wrap">
              {p.spells.map((s, i) => s?.key ? (
                <SpellChip key={i} icon={ready ? spellIcon(s.key) : ''} title={s.name || s.key}
                  left={left(`${p.riotId}:s${i}`)} onClick={() => toggle(`${p.riotId}:s${i}`, spellCd(s.key))} />
              ) : null)}
              <SpellChip title={`궁 ${rCd(p)}초 · AH ${ah(p)}`} ult left={left(`${p.riotId}:R`)} onClick={() => toggle(`${p.riotId}:R`, rCd(p))} />
            </div>
          </li>
        ))}
      </ul>
      <p className="text-[10px] text-[var(--muted)]/60 mt-2">궁 쿨 = 공식값(레벨로 R랭크 추정) × 아이템 능력가속 반영 · 룬 가속은 Riot이 상대 룬을 안 줘서 미반영</p>
    </Panel>
  );
}

function SpellChip({ icon, title, left, onClick, ult }: { icon?: string; title: string; left: number; onClick: () => void; ult?: boolean }) {
  return (
    <button onClick={onClick} title={title} className="relative w-8 h-8 rounded overflow-hidden shrink-0 ring-1 ring-[var(--gold-dim)]">
      {icon ? <img src={icon} alt={title} className={`w-full h-full ${left ? 'grayscale brightness-50' : ''}`} />
        : <span className={`w-full h-full grid place-items-center text-xs font-bold ${left ? 'bg-[#122235] text-[var(--muted)]' : ult ? 'bg-[var(--blue-dim)] text-[var(--blue)]' : 'bg-[#122235] text-[var(--text)]'}`}>R</span>}
      {left > 0 && <span className="absolute inset-0 grid place-items-center text-[11px] font-mono font-bold text-white">{left}</span>}
    </button>
  );
}

function ItemReco({ champKey, mapId, ready }: { champKey: string; mapId: number; ready: boolean }) {
  const [items, setItems] = useState<number[]>([]);
  useEffect(() => { if (champKey) loadRecommended(champKey, mapId).then(setItems); }, [champKey, mapId]);
  if (!items.length) return null;
  return (
    <Panel title="추천 아이템 · Riot 기본">
      <div className="flex gap-1.5 flex-wrap">
        {ready && items.map((id, i) => <img key={i} src={itemIcon(id)} className="w-8 h-8 rounded ring-1 ring-[var(--gold-dim)]" loading="lazy" />)}
      </div>
    </Panel>
  );
}

function ActivePanel({ snap }: { snap: Snapshot }) {
  const a = snap.active!;
  const pct = (v: number, m: number) => (m ? (v / m) * 100 : 0);
  return (
    <Panel>
      <div className="flex items-center justify-between text-sm mb-2">
        <span className="font-semibold">내 챔피언 · Lv {a.level}</span>
        <span className="text-[var(--gold)]">{a.gold.toLocaleString('ko-KR')} G</span>
      </div>
      <Bar pct={pct(a.hp, a.maxHp)} color="#1fb355" label={`${a.hp} / ${a.maxHp}`} />
      {a.maxRes > 0 && <div className="mt-1.5"><Bar pct={pct(a.res, a.maxRes)} color="#2b7fd8" label={`${a.res} / ${a.maxRes}`} /></div>}
      <div className="flex gap-2 text-xs text-[var(--muted)] mt-2">
        {(['Q', 'W', 'E', 'R'] as const).map((k) => <span key={k} className="px-2 py-0.5 rounded bg-[#122235]">{k} {a.abilities[k]}</span>)}
      </div>
    </Panel>
  );
}

function Bar({ pct, color, label }: { pct: number; color: string; label: string }) {
  return (
    <div className="relative h-5 rounded bg-[#0a1420] overflow-hidden ring-1 ring-[var(--gold-dim)]">
      <div className="h-full transition-all" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-mono">{label}</span>
    </div>
  );
}

function Teams({ players, meId, ready }: { players: Player[]; meId?: string; ready: boolean }) {
  return (
    <div className="space-y-3">
      {(['ORDER', 'CHAOS'] as const).map((team) => (
        <section key={team} className="panel overflow-hidden">
          <div className={`px-4 py-1.5 panel-title ${team === 'ORDER' ? 'text-[var(--blue)]' : 'text-[var(--red)]'}`}>{team === 'ORDER' ? '블루팀' : '레드팀'}</div>
          <ul className="divide-y divide-[color:var(--line)]">
            {players.filter((p) => p.team === team).map((p) => <Row key={p.riotId} p={p} me={p.riotId === meId} ready={ready} />)}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Row({ p, me, ready }: { p: Player; me: boolean; ready: boolean }) {
  return (
    <li className={`flex items-center gap-2 px-3 py-2 ${me ? 'bg-[var(--gold)]/10' : ''}`}>
      <div className="relative shrink-0">
        {ready && <img src={champIcon(p.champKey)} alt={p.champion} className="w-9 h-9 rounded" loading="lazy" />}
        <span className="absolute -bottom-1 -right-1 text-[10px] font-bold bg-[#070d16]/90 rounded px-1">{p.level}</span>
        {p.dead && <span className="absolute inset-0 grid place-items-center bg-black/60 rounded text-[11px] font-mono text-[var(--red)]">{p.respawn}s</span>}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {p.position && ready && <img src={positionIcon(p.position)} className="w-3.5 h-3.5 opacity-70" />}
          <span className="truncate text-sm font-medium">{p.name}</span>
        </div>
        <div className="text-xs text-[var(--muted)] tabular-nums"><span className="text-[var(--text)]">{p.k}/{p.d}/{p.a}</span> · CS {p.cs}</div>
      </div>
      <div className="flex gap-0.5 shrink-0">
        {Array.from({ length: 6 }).map((_, i) => {
          const it = p.items[i];
          return it && ready ? <img key={i} src={itemIcon(it.id)} title={it.name} className="w-5 h-5 rounded-sm" loading="lazy" />
            : <span key={i} className="w-5 h-5 rounded-sm bg-[#122235]" />;
        })}
      </div>
    </li>
  );
}

function EventFeed({ snap }: { snap: Snapshot }) {
  const ev = (snap.recent ?? []).slice().reverse();
  if (!ev.length) return null;
  return (
    <Panel title="최근 이벤트">
      <ul className="space-y-1 text-sm">
        {ev.map((e) => (
          <li key={e.id} className="flex gap-2"><span className="font-mono text-[var(--muted)] tabular-nums w-12">{fmtClock(e.time)}</span><span>{eventKo(e.name)}</span></li>
        ))}
      </ul>
    </Panel>
  );
}

/* ---------------- Lobby ---------------- */

function Lobby({ snap, ready, send }: { snap: Snapshot; ready: boolean; send: (c: Command) => void }) {
  const modes = snap.queues ?? [];
  const [pick, setPick] = useState<{ slot: number } | null>(null);
  const [spellPick, setSpellPick] = useState<{ slot: number } | null>(null);
  const [pendingMode, setPendingMode] = useState<number | null>(null);
  useEffect(() => { if (pendingMode != null && snap.queueId === pendingMode) setPendingMode(null); }, [snap.queueId, pendingMode]);
  const GROUPS: [string, string][] = [['sr', '소환사의 협곡'], ['aram', '칼바람 나락'], ['special', '특별 모드 / 기타'], ['ai', 'AI 상대대전']];
  return (
    <main className="px-3 space-y-3 mt-3">
      <Panel title="게임 모드">
        {modes.length ? GROUPS.map(([cat, label]) => {
          const inCat = modes.filter((q) => (q.cat ?? 'special') === cat);
          if (!inCat.length) return null;
          return (
            <div key={cat} className="mb-3 last:mb-0">
              <div className="text-xs text-[var(--muted)] mb-1.5">{label}</div>
              <div className="grid grid-cols-2 gap-2">
                {inCat.map((q) => {
                  const pending = pendingMode === q.id && snap.queueId !== q.id;
                  return (
                    <button key={q.id} disabled={pending}
                      onClick={() => { setPendingMode(q.id); send({ cmd: 'setMode', queueId: q.id }); }}
                      className={`relative overflow-hidden btn flex items-center gap-2 px-3 py-2 text-sm text-left ${snap.queueId === q.id ? 'btn-gold' : 'bg-[#122235] text-[var(--text)]'}`}>
                      {q.icon && <img src={q.icon} className="w-6 h-6 shrink-0" />}
                      <span className="truncate">{q.ai ? q.name.replace(/^AI · /, '') : q.name}</span>
                      {pending && <span className="skeleton absolute inset-0 opacity-60" />}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        }) : <div className="grid grid-cols-2 gap-2">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-11" />)}</div>}
      </Panel>

      {snap.quickPlay && snap.slots?.length ? (
        <Panel title="챔피언 · 스펠 · 라인 (신속 대전)">
          <ul className="space-y-4">
            {snap.slots.map((s, i) => (
              <li key={i} className="flex items-start gap-3">
                <button onClick={() => setPick({ slot: i })} className="shrink-0">
                  <ChampImg id={s.championId} className="w-14 h-14 rounded ring-1 ring-[var(--gold-dim)]" />
                </button>
                <div className="flex-1 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--muted)]">{i === 0 ? '1번 슬롯' : '2번 슬롯'} · 우선순위 {posKo(s.position)}</span>
                    <button onClick={() => setSpellPick({ slot: i })} className="flex gap-0.5 ml-auto" title="스펠 변경">
                      {[s.spell1, s.spell2].map((sp, j) => ready && sp
                        ? <img key={j} src={sumSpellIcon(sp)} className="w-6 h-6 rounded ring-1 ring-[var(--gold-dim)]" />
                        : <span key={j} className="w-6 h-6 rounded bg-[#122235]" />)}
                    </button>
                  </div>
                  <div className="flex gap-1.5">
                    {POSITIONS.map((pos: string) => {
                      const sel = s.position === pos;
                      return (
                        <button key={pos} onClick={() => send({ cmd: 'setSlotPosition', index: i, position: pos })}
                          className={`p-1 flex-1 grid place-items-center rounded ${sel ? 'ring-2 ring-[var(--gold)] bg-[#0a1420]' : 'ring-1 ring-[var(--gold-dim)] bg-[#122235]'}`}>
                          {ready && <img src={positionIcon(pos)} className="w-5 h-5" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-[var(--muted)]/60 mt-3">초상화 → 챔피언 · 스펠 아이콘 → 소환사 주문 · 라인 아이콘 → 포지션</p>
        </Panel>
      ) : null}

      {snap.canPickPosition && !snap.quickPlay && (
        <PositionPicker current={snap.positions!} ready={ready} onPick={(first, second) => send({ cmd: 'setPosition', first, second })} />
      )}

      <section className="panel flex items-center px-4 py-3">
        <span className="text-sm">자동 수락</span>
        <Toggle className="ml-auto" on={snap.autoAccept ?? true} onChange={(v) => send({ cmd: 'setAutoAccept', on: v })} />
      </section>

      <Panel title={`파티 ${snap.members?.length ?? 0}/${snap.maxSize ?? '?'}`}>
        <ul className="text-sm space-y-1">
          {(snap.members ?? []).map((m, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="text-[var(--gold)]">{m.leader ? '★' : '·'}</span><span className="truncate">{m.name || '소환사'}</span>
              {m.first && ready && <img src={positionIcon(m.first)} className="w-4 h-4 ml-auto opacity-70" />}
            </li>
          ))}
        </ul>
      </Panel>

      <button onClick={() => send({ cmd: 'startQueue' })} className="btn btn-blue w-full py-3 font-bold text-lg font-hud tracking-wide">대전 찾기</button>

      {pick && <ChampPickerModal lane={snap.slots?.[pick.slot]?.position || ''} onClose={() => setPick(null)}
        onPick={(championId) => { send({ cmd: 'setSlotChampion', index: pick.slot, championId }); setPick(null); }} />}
      {spellPick && snap.slots?.[spellPick.slot] && (
        <SpellPickerModal current={[snap.slots[spellPick.slot].spell1, snap.slots[spellPick.slot].spell2]} onClose={() => setSpellPick(null)}
          onPick={(spell1, spell2) => send({ cmd: 'setSlotSpells', index: spellPick.slot, spell1, spell2 })} />
      )}
    </main>
  );
}

function Toggle({ on, onChange, className = '' }: { on: boolean; onChange: (v: boolean) => void; className?: string }) {
  return (
    <button onClick={() => onChange(!on)} className={`w-11 h-6 rounded-full p-0.5 transition-colors ${on ? 'bg-[var(--blue)]' : 'bg-[#122235] ring-1 ring-[var(--gold-dim)]'} ${className}`}>
      <span className={`block w-5 h-5 rounded-full bg-white transition-transform ${on ? 'translate-x-5' : ''}`} />
    </button>
  );
}

function PositionPicker({ current, ready, onPick }: { current: { first: string; second: string }; ready: boolean; onPick: (f: string, s: string) => void }) {
  return (
    <Panel title="우선순위 포지션">
      {(['first', 'second'] as const).map((slot) => (
        <div key={slot} className="mb-2 last:mb-0">
          <div className="text-xs text-[var(--muted)] mb-1">{slot === 'first' ? '1순위' : '2순위'}</div>
          <div className="flex gap-2">
            {POSITIONS.map((pos: string) => {
              const sel = current[slot] === pos;
              return (
                <button key={pos}
                  className={`p-1.5 flex-1 grid place-items-center rounded ${sel ? 'ring-2 ring-[var(--gold)] bg-[#0a1420]' : 'ring-1 ring-[var(--gold-dim)] bg-[#122235]'}`}
                  onClick={() => onPick(slot === 'first' ? pos : current.first, slot === 'second' ? pos : current.second)}>
                  {ready && <img src={positionIcon(pos)} className="w-6 h-6" />}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </Panel>
  );
}

/* ---------------- Champ select ---------------- */

function ChampSelect({ snap, ready, send }: { snap: Snapshot; ready: boolean; send: (c: Command) => void }) {
  const action = snap.myAction;
  const isBan = action?.type === 'ban';
  const [sel, setSel] = useState(0);
  return (
    <main className="px-3 space-y-3 mt-3">
      <section className="panel flex items-center justify-between px-4 py-3">
        <span className="text-xs text-[var(--muted)]">{snap.timerPhase || '진행 중'}</span>
        <span className="font-mono text-2xl tabular-nums text-[var(--gold-br)]">{snap.timeLeft ?? 0}s</span>
      </section>
      <TeamCells title="우리 팀" cells={snap.myTeam ?? []} ready={ready} />
      <Bans mine={snap.bans?.mine ?? []} theirs={snap.bans?.theirs ?? []} ready={ready} />
      {action ? (
        <Panel title={isBan ? '챔피언 밴' : '챔피언 선택'}>
          <ChampGrid pool={(isBan ? snap.bannable : snap.pickable) ?? []} ready={ready} sel={sel}
            onTap={(id) => { setSel(id); send({ cmd: isBan ? 'ban' : 'pick', championId: id, lock: false }); }} />
          <button disabled={!sel} onClick={() => send({ cmd: isBan ? 'ban' : 'pick', championId: sel, lock: true })}
            className={`btn w-full mt-3 py-3 font-bold font-hud ${isBan ? 'btn-danger' : 'btn-blue'} disabled:opacity-40`}>{isBan ? '밴 확정' : '픽 확정'}</button>
        </Panel>
      ) : <p className="text-center text-sm text-[var(--muted)]">내 차례 대기 중…</p>}
    </main>
  );
}

function TeamCells({ title, cells, ready }: { title: string; cells: { championId: number; position: string; me: boolean }[]; ready: boolean }) {
  return (
    <Panel title={title}>
      <div className="flex gap-2">
        {cells.map((c, i) => (
          <div key={i} className={`relative rounded ${c.me ? 'ring-2 ring-[var(--gold)]' : ''}`}>
            {c.championId ? <ChampImg id={c.championId} className="w-10 h-10 rounded" />
              : <span className="w-10 h-10 rounded bg-[#122235] grid place-items-center">{c.position && ready && <img src={positionIcon(c.position)} className="w-5 h-5 opacity-60" />}</span>}
          </div>
        ))}
      </div>
    </Panel>
  );
}

function Bans({ mine, theirs, ready }: { mine: number[]; theirs: number[]; ready: boolean }) {
  const list = [...mine, ...theirs].filter((id) => id > 0);
  if (!list.length) return null;
  return (
    <Panel title="밴">
      <div className="flex gap-1.5 flex-wrap">
        {ready && list.map((id, i) => <div key={i} className="relative"><img src={champIconById(id)} className="w-7 h-7 rounded grayscale" /><span className="absolute inset-0 grid place-items-center text-[var(--red)]">✕</span></div>)}
      </div>
    </Panel>
  );
}

// Searchable grid over a given champion-id pool (or the full roster).
function ChampGrid({ pool, ready, sel, onTap }: { pool: number[]; ready: boolean; sel?: number; onTap: (id: number) => void }) {
  const [q, setQ] = useState('');
  const list = pool.filter((id) => !q || (champ(id)?.name || '').includes(q));
  return (
    <>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="챔피언 검색"
        className="w-full mb-2 px-3 py-2 rounded bg-[#0a1420] text-sm outline-none ring-1 ring-[var(--gold-dim)]" />
      <div className="grid grid-cols-6 gap-1.5 max-h-56 overflow-y-auto">
        {ready && list.map((id) => (
          <button key={id} onClick={() => onTap(id)} className={`rounded overflow-hidden ring-2 ${sel === id ? 'ring-[var(--gold)]' : 'ring-transparent'}`}>
            <img src={champIconById(id)} alt={champ(id)?.name} className="w-full aspect-square" loading="lazy" />
          </button>
        ))}
      </div>
    </>
  );
}

// Per-lane favorite champions, stored locally on the phone.
const favKey = (pos: string) => `ward:fav:${pos || 'ANY'}`;
function getFav(pos: string): number[] { try { return JSON.parse(localStorage.getItem(favKey(pos)) || '[]'); } catch { return []; } }
function setFav(pos: string, ids: number[]) { try { localStorage.setItem(favKey(pos), JSON.stringify(ids)); } catch { /* ignore */ } }

// Full-roster picker (for Swiftplay slots): all champions + per-lane favorites.
function ChampPickerModal({ lane, onClose, onPick }: { lane: string; onClose: () => void; onPick: (id: number) => void }) {
  const [fav, setFavState] = useState(() => getFav(lane));
  const [q, setQ] = useState('');
  const all = allChampions();
  const list = all.filter((c) => !q || c.name.includes(q));
  const toggle = (id: number) => { const n = fav.includes(id) ? fav.filter((x) => x !== id) : [...fav, id]; setFav(lane, n); setFavState(n); };
  return (
    <div className="fixed inset-0 z-20 bg-black/70 flex items-end" onClick={onClose}>
      <div className="panel w-full p-4 max-h-[85dvh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <h2 className="panel-title">챔피언 선택 · {posKo(lane)}</h2>
          <button onClick={onClose} className="text-[var(--muted)] text-sm">닫기</button>
        </div>
        {fav.length > 0 && (
          <>
            <div className="text-xs text-[var(--gold)] mb-1">★ 선호 챔피언</div>
            <div className="flex gap-1.5 flex-wrap mb-3">
              {fav.map((id) => <button key={id} onClick={() => onPick(id)}><img src={champIconById(id)} className="w-10 h-10 rounded ring-1 ring-[var(--gold)]" /></button>)}
            </div>
          </>
        )}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="챔피언 검색"
          className="w-full mb-2 px-3 py-2 rounded bg-[#0a1420] text-sm outline-none ring-1 ring-[var(--gold-dim)]" />
        <div className="grid grid-cols-5 gap-1.5 overflow-y-auto">
          {list.map((c) => (
            <div key={c.id} className="relative">
              <button onClick={() => onPick(c.id)} className="w-full"><img src={champIconById(c.id)} alt={c.name} className="w-full aspect-square rounded" loading="lazy" /></button>
              <button onClick={() => toggle(c.id)} title="즐겨찾기"
                className={`absolute top-0.5 right-0.5 w-5 h-5 grid place-items-center text-xs rounded-full bg-black/70 ${fav.includes(c.id) ? 'text-[var(--gold)]' : 'text-white/80'}`}>★</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SpellPickerModal({ current, onClose, onPick }: { current: [number, number]; onClose: () => void; onPick: (s1: number, s2: number) => void }) {
  const [edit, setEdit] = useState(0); // which spell slot is being edited
  const [pair, setPair] = useState<[number, number]>(current);
  const spells = summonerSpells('CLASSIC');
  const choose = (id: number) => {
    const next: [number, number] = edit === 0 ? [id, pair[1]] : [pair[0], id];
    setPair(next); onPick(next[0], next[1]); setEdit(edit === 0 ? 1 : 0);
  };
  return (
    <div className="fixed inset-0 z-20 bg-black/70 flex items-end" onClick={onClose}>
      <div className="panel w-full p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3"><h2 className="panel-title">소환사 주문</h2><button onClick={onClose} className="text-[var(--muted)] text-sm">닫기</button></div>
        <div className="flex gap-3 justify-center mb-3">
          {[0, 1].map((i) => (
            <button key={i} data-on={edit === i} onClick={() => setEdit(i)} className="btn btn-ghost p-1.5">
              {pair[i] ? <img src={sumSpellIcon(pair[i])} className="w-10 h-10 rounded" /> : <span className="w-10 h-10 grid place-items-center">{i + 1}</span>}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-5 gap-2">
          {spells.map((s) => (
            <button key={s.id} onClick={() => choose(s.id)} className="rounded overflow-hidden ring-1 ring-[var(--gold-dim)]" title={s.name}>
              <img src={sumSpellIcon(s.id)} alt={s.name} className="w-full aspect-square" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Ready / searching / waiting / pairing ---------------- */

function ReadyCheck({ send }: { send: (c: Command) => void }) {
  return (
    <main className="flex flex-col items-center gap-4 mt-24 px-6">
      <div className="font-hud text-2xl font-bold text-[var(--gold)]">매칭 완료</div>
      <p className="text-sm text-[var(--blue)]">자동 수락됨 ✓</p>
      <button onClick={() => send({ cmd: 'acceptReady' })} className="btn btn-blue w-full max-w-xs py-4 font-bold text-xl font-hud">수락</button>
      <button onClick={() => send({ cmd: 'declineReady' })} className="btn btn-danger w-full max-w-xs py-2">거절</button>
    </main>
  );
}

function Searching({ snap, send }: { snap: Snapshot; send: (c: Command) => void }) {
  const now = useNow();
  const elapsed = Math.max(0, (snap.queueTime ?? 0) + Math.floor((now - snap.t) / 1000));
  return (
    <main className="flex flex-col items-center justify-center gap-3 mt-24 px-6 text-center">
      <div className="w-12 h-12 border-4 border-[#122235] border-t-[var(--blue)] rounded-full spin" />
      <p className="font-hud text-lg text-[var(--gold)]">매칭 중</p>
      <p className="font-mono text-3xl tabular-nums text-[var(--gold-br)]">{fmtClock(elapsed)}</p>
      {snap.estTime ? <p className="text-xs text-[var(--muted)]">예상 {fmtClock(snap.estTime)}</p> : null}
      <button onClick={() => send({ cmd: 'stopQueue' })} className="btn btn-danger px-8 py-2 mt-2">매칭 취소</button>
      <div className="flex items-center gap-2 mt-2"><span className="text-sm">자동 수락</span><Toggle on={snap.autoAccept ?? true} onChange={(v) => send({ cmd: 'setAutoAccept', on: v })} /></div>
    </main>
  );
}

function Waiting({ status, phase }: { status: string; phase?: string | null }) {
  const off = !phase || phase === 'None';
  return (
    <div className="flex flex-col items-center justify-center text-center gap-2 mt-24 px-6">
      <div className="font-hud text-3xl text-[var(--gold)]">WARD</div>
      <p className="text-[var(--text)] font-medium mt-2">{off ? 'PC 클라이언트 꺼짐' : '대기 중'}</p>
      <p className="text-sm text-[var(--muted)]">{off ? 'PC에서 롤 클라이언트를 켜면 자동으로 연결돼요.' : '클라이언트에서 로비/게임을 시작하면 자동 표시돼요.'}</p>
      <p className="text-xs text-[var(--muted)]/60">서버 연결: {status}{off ? '' : ` · ${phase}`}</p>
    </div>
  );
}

function Pairing() {
  const [v, setV] = useState('');
  const [err, setErr] = useState(false);
  const connect = () => { const p = parsePairing(v); if (p) savePairing(p); else setErr(true); };
  return (
    <div className="min-h-dvh grid place-items-center px-6 text-center">
      <div className="space-y-4 max-w-sm w-full">
        <div className="font-hud text-4xl text-[var(--gold)]">WARD</div>
        <h1 className="text-xl font-bold">페어링</h1>
        <p className="text-sm text-[var(--muted)]">PC에서 <code className="text-[var(--text)]">npm run qr</code>로 나온 <b>페어링 링크를 복사해 아래에 붙여넣으세요.</b> (설치형 앱은 링크가 자동으로 안 넘어와요.)</p>
        <input value={v} onChange={(e) => { setV(e.target.value); setErr(false); }} placeholder="페어링 링크 붙여넣기"
          className={`w-full px-3 py-3 rounded bg-[#0a1420] text-sm outline-none ring-1 ${err ? 'ring-[var(--red)]' : 'ring-[var(--gold-dim)]'}`} />
        {err && <p className="text-xs text-[var(--red)]">링크에 room·token이 없어요. 전체 링크를 붙여넣어 주세요.</p>}
        <button onClick={connect} className="btn btn-blue w-full py-3 font-bold font-hud">연결</button>
      </div>
    </div>
  );
}
