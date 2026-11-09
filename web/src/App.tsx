import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRelay, clearPairing, parsePairing, savePairing, type Snapshot, type Player, type Command } from './useRelay';
import {
  loadDDragonVersion, loadChampions, loadSummonerSpells, allChampions, champIcon, champIconById, champ, itemIcon,
  loadRecommended, fmtClock, eventKo, spellCd, spellIcon, sumSpellIcon, summonerSpells, loadUltCd, ultRank, profileIcon, positionIcon,
  loadItemHaste, itemHaste, withHaste, skinArt,
  loadRunes, perk, perkIcon, runeTrees, styleIcon, shardRows, keystoneRow, runeRows,
} from './ddragon';
import { POSITIONS } from '../../shared/clientstate.mjs';

const RELAY = (import.meta.env.VITE_RELAY_WS_URL as string) || 'wss://relay.cward.gg.scian.xyz/ws';
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
  const [drawer, setDrawer] = useState(false);
  useEffect(() => { (async () => { await loadDDragonVersion(); await Promise.all([loadChampions(), loadSummonerSpells(), loadItemHaste(), loadRunes()]); setReady(true); })(); }, []);

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
      <div className="sticky top-0 z-10 bg-[#070d16]/90 backdrop-blur border-b hair" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="topbar">{status !== '연결됨' && <i />}</div>
        <header className="flex items-center gap-2 px-4 py-3">
        <span className="font-hud text-xl font-bold text-[var(--gold)]">CWARD</span>
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
        <button onClick={() => setDrawer(true)} aria-label="메뉴" className="text-[var(--gold)] px-1 flex items-center">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 5h12M3 9h12M3 13h12" /></svg>
        </button>
        </header>
      </div>

      {drawer && snap && <MoreDrawer snap={snap} send={send} ready={ready} onClose={() => setDrawer(false)} />}

      <div className="enter" key={kind}>
        {!snap ? <Loading />
          : kind === 'ingame' && snap.players?.length ? <Ingame snap={snap} ready={ready} />
          : kind === 'champselect' ? <ChampSelect snap={snap} ready={ready} send={send} />
          : kind === 'lobby' ? <Lobby snap={snap} ready={ready} send={send} />
          : kind === 'readycheck' ? <ReadyCheck send={send} />
          : kind === 'searching' ? <Searching snap={snap} send={send} />
          : kind === 'menu' ? <Menu snap={snap} send={send} />
          : kind === 'postgame' ? <PostGame snap={snap} ready={ready} send={send} />
          : <Waiting status={status} clientOff={kind === 'off' || kind === 'idle'} phase={snap.phase} />}
      </div>

      <button onClick={() => { if (confirm('페어링을 해제할까요? 다시 링크로 연결해야 해요.')) clearPairing(); }} className="mt-8 mx-auto block text-xs text-[var(--muted)]/60 underline">페어링 해제</button>
    </div>
  );
}

function headerLabel(snap: Snapshot | null) {
  if (!snap) return '';
  return ({ ingame: '', lobby: '로비', champselect: '챔피언 선택', readycheck: '수락', searching: '매칭 중', menu: '메뉴', postgame: '게임 종료' } as Record<string, string>)[snap.kind || ''] || '';
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
    <Panel title="추천 아이템">
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

// Reusable grouped mode picker with pending shimmer (used in lobby and menu).
function ModePicker({ snap, send }: { snap: Snapshot; send: (c: Command) => void }) {
  const modes = snap.queues ?? [];
  const [pendingMode, setPendingMode] = useState<number | null>(null);
  useEffect(() => { if (pendingMode != null && snap.queueId === pendingMode) setPendingMode(null); }, [snap.queueId, pendingMode]);
  const GROUPS: [string, string][] = [['sr', '소환사의 협곡'], ['aram', '칼바람 나락'], ['special', '특별 모드 / 기타'], ['ai', 'AI 상대대전']];
  return (
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
  );
}

// Client open at main menu (no lobby yet): pick a mode to create a lobby from the phone.
function Menu({ snap, send }: { snap: Snapshot; send: (c: Command) => void }) {
  return (
    <main className="px-3 space-y-3 mt-3">
      <ModePicker snap={snap} send={send} />
    </main>
  );
}

function LootPanel({ loot }: { loot: NonNullable<Snapshot['loot']> }) {
  return (
    <Panel title="전리품">
      <div className="grid grid-cols-2 gap-y-1 text-sm">
        <span>파랑 정수 <b className="text-[var(--blue)]">{loot.blue.toLocaleString('ko-KR')}</b></span>
        <span>주황 정수 <b className="text-[var(--gold)]">{loot.orange.toLocaleString('ko-KR')}</b></span>
        <span>신화 정수 <b>{loot.mythic}</b></span>
        <span>상자 {loot.chests} · 열쇠 {loot.keys}</span>
        <span>챔프 조각 <b>{loot.champShards.n}</b></span>
        <span>스킨 조각 <b>{loot.skinShards.n}</b></span>
      </div>
    </Panel>
  );
}

function IconPickerModal({ icons, current, ready, onClose, onPick }: { icons: number[]; current: number; ready: boolean; onClose: () => void; onPick: (id: number) => void }) {
  return (
    <div className="fixed inset-0 z-20 bg-black/70 flex items-end" onClick={onClose}>
      <div className="panel w-full p-4 h-[70dvh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2"><h2 className="panel-title">소환사 아이콘</h2><button onClick={onClose} className="text-[var(--muted)] text-sm">닫기</button></div>
        <div className="grid grid-cols-6 gap-1.5 overflow-y-auto">
          {ready && icons.map((id) => (
            <button key={id} onClick={() => onPick(id)} className={`rounded-full overflow-hidden ring-2 ${id === current ? 'ring-[var(--gold)]' : 'ring-transparent'}`}>
              <img src={profileIcon(id)} className="w-full aspect-square" loading="lazy" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Hamburger drawer: profile, loot, friends — cross-phase utilities out of the main view.
function MoreDrawer({ snap, send, ready, onClose }: { snap: Snapshot; send: (c: Command) => void; ready: boolean; onClose: () => void }) {
  const [iconOpen, setIconOpen] = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [flash, setFlash] = useState(getFlashSlot());
  // Show only one sheet at a time (nested sheets look broken).
  if (iconOpen) return <IconPickerModal icons={snap.icons || []} current={snap.me?.iconId || 0} ready={ready} onClose={() => setIconOpen(false)} onPick={(id) => { send({ cmd: 'setIcon', iconId: id }); setIconOpen(false); }} />;
  if (friendsOpen) return <FriendsModal friends={snap.friends || []} ready={ready} onClose={() => setFriendsOpen(false)} onInvite={(sid) => send({ cmd: 'inviteFriend', summonerId: sid })} send={send} />;
  return (
    <div className="fixed inset-0 z-20 bg-black/80 flex items-end" onClick={onClose}>
      <div className="panel w-full p-4 max-h-[88dvh] overflow-y-auto space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h2 className="panel-title">메뉴</h2><button onClick={onClose} className="text-[var(--muted)] text-sm">닫기</button></div>
        <ProfilePanel me={snap.me} ready={ready} onEditIcon={() => setIconOpen(true)} />
        <button onClick={() => setFriendsOpen(true)} className="btn btn-ghost w-full py-2 text-sm">친구 초대 · 메시지</button>
        <Panel title="설정">
          <div className="flex items-center justify-between">
            <span className="text-sm">점멸 위치</span>
            <div className="flex gap-1">
              {(['D', 'F'] as const).map((s) => (
                <button key={s} onClick={() => { setFlashSlot(s); setFlash(s); }}
                  className={`px-3 py-1 rounded text-sm font-bold ${flash === s ? 'bg-[var(--gold)]/20 ring-2 ring-[var(--gold)]' : 'btn btn-ghost'}`}>{s}</button>
              ))}
            </div>
          </div>
          <p className="text-[11px] text-[var(--muted)] mt-1">프리셋·스펠 적용 시 점멸이 항상 이 슬롯으로 들어갑니다.</p>
        </Panel>
        {snap.loot && <LootPanel loot={snap.loot} />}
      </div>
    </div>
  );
}

function ProfilePanel({ me, ready, onEditIcon }: { me: Snapshot['me']; ready: boolean; onEditIcon?: () => void }) {
  if (!me) return null;
  return (
    <Panel title="내 정보">
      <div className="flex items-center gap-2 mb-1.5">
        <button onClick={onEditIcon} disabled={!onEditIcon}>
          {ready && me.iconId > 0 ? <img src={profileIcon(me.iconId)} className="w-7 h-7 rounded-full ring-1 ring-[var(--gold-dim)]" /> : <span className="w-7 h-7 rounded-full bg-[#122235] block" />}
        </button>
        <span className="text-sm font-medium truncate">{me.name}</span>
        <span className="text-xs text-[var(--muted)]">Lv {me.level}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm">
          {me.rank ? <><b className="text-[var(--gold)]">{me.rank.tier} {me.rank.div}</b> <span className="text-[var(--muted)]">{me.rank.lp}LP · {me.rank.w}승 {me.rank.l}패</span></>
            : <span className="text-[var(--muted)]">솔로 랭크 기록 없음</span>}
        </span>
        {me.mastery?.length ? (
          <div className="flex items-center gap-1.5">
            {me.mastery.map((m) => (
              <div key={m.id} className="relative">
                {ready ? <img src={champIconById(m.id)} className="w-8 h-8 rounded" /> : <span className="skeleton w-8 h-8 rounded block" />}
                <span className="absolute -bottom-1 -right-1 text-[9px] font-bold bg-[#070d16]/90 rounded px-0.5">{m.lv}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

function FriendsModal({ friends, ready, onClose, onInvite, send }: { friends: { name: string; sid: number; avail: string; note?: string; icon?: number; status?: string; id?: string }[]; ready: boolean; onClose: () => void; onInvite: (sid: number) => void; send: (c: Command) => void }) {
  const [sent, setSent] = useState<Set<number>>(new Set());
  const color = (a: string) => (a === 'chat' || a === 'online' ? 'bg-[var(--blue)]' : a === 'dnd' ? 'bg-[var(--red)]' : a === 'mobile' ? 'bg-sky-400' : 'bg-[var(--gold)]');
  return (
    <div className="fixed inset-0 z-20 bg-black/70 flex items-end" onClick={onClose}>
      <div className="panel w-full p-4 min-h-[60dvh] max-h-[85dvh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2"><h2 className="panel-title">친구 초대 · 접속 중</h2><button onClick={onClose} className="text-[var(--muted)] text-sm">닫기</button></div>
        <ul className="overflow-y-auto divide-y divide-[color:var(--line)]">
          {friends.length ? friends.map((f) => (
            <li key={f.sid} className="flex items-center gap-2.5 py-2">
              <div className="relative shrink-0">
                {ready && f.icon ? <img src={profileIcon(f.icon)} className="w-8 h-8 rounded-full" /> : <span className="w-8 h-8 rounded-full bg-[#122235] block" />}
                <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-[#0b1a2c] ${color(f.avail)}`} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{f.name}{f.note ? <span className="text-[var(--muted)] text-xs"> · {f.note}</span> : ''}</div>
                {f.status ? <div className="truncate text-[11px] text-[var(--muted)]">{f.status}</div> : null}
              </div>
              {f.id && <button onClick={() => { const t = prompt(`${f.name}에게 보낼 메시지`); if (t && confirm('메시지를 보낼까요?')) send({ cmd: 'chatSend', to: f.id, text: t }); }}
                className="btn btn-ghost text-xs px-2 py-1 shrink-0">메시지</button>}
              <button disabled={sent.has(f.sid)} onClick={() => { onInvite(f.sid); setSent((s) => new Set(s).add(f.sid)); }}
                className="btn btn-ghost text-xs px-3 py-1 disabled:opacity-40 shrink-0">{sent.has(f.sid) ? '초대됨' : '초대'}</button>
            </li>
          )) : <li className="text-sm text-[var(--muted)] py-4 text-center">접속 중인 친구가 없어요</li>}
        </ul>
      </div>
    </div>
  );
}

function Lobby({ snap, ready, send }: { snap: Snapshot; ready: boolean; send: (c: Command) => void }) {
  const [pick, setPick] = useState<{ slot: number } | null>(null);
  const [spellPick, setSpellPick] = useState<{ slot: number } | null>(null);
  const [skinPick, setSkinPick] = useState<{ slot: number } | null>(null);
  const [runePick, setRunePick] = useState<{ slot: number } | null>(null);
  return (
    <main className="px-3 space-y-3 mt-3">
      <ModePicker snap={snap} send={send} />

      {snap.quickPlay && snap.slots?.length && !snap.slots.some((s) => (snap.scarce ?? []).includes(s.position)) && (
        <p className="panel px-4 py-2 text-sm text-[var(--red)] text-center">우선순위 포지션(◆)을 하나는 선택해야 매칭돼요</p>
      )}

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
                    {s.skins?.length ? (() => {
                      const cur = s.skins.find((sk) => sk.id === s.skinId);
                      const name = cur?.chroma ? cur.name.replace(/\s*\([^)]*\)\s*$/, '') : (cur?.name || '기본');
                      return (
                        <button onClick={() => setSkinPick({ slot: i })} className="btn btn-ghost text-xs px-2 py-1 flex items-center gap-1 max-w-[60%]">
                          {cur?.chroma && <span className="w-3 h-3 rounded-full ring-1 ring-white/60 shrink-0" style={{ background: cur.color }} />}
                          <span className="truncate">{name}</span>
                        </button>
                      );
                    })() : null}
                    <div className="flex items-center gap-1 ml-auto">
                      <button onClick={() => send({ cmd: 'setSlotSpells', index: i, spell1: s.spell2, spell2: s.spell1 })} title="D/F 교환" className="btn btn-ghost px-1.5 py-1 text-xs">⇄</button>
                      <button onClick={() => setSpellPick({ slot: i })} className="flex gap-0.5" >
                        {[s.spell1, s.spell2].map((sp, j) => ready && sp
                          ? <img key={j} src={sumSpellIcon(sp)} className="w-6 h-6 rounded ring-1 ring-[var(--gold-dim)]" />
                          : <span key={j} className="w-6 h-6 rounded bg-[#122235]" />)}
                      </button>
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    {POSITIONS.map((pos: string) => {
                      const sel = s.position === pos;
                      const scarce = (snap.scarce ?? []).includes(pos);
                      return (
                        <button key={pos} onClick={() => send({ cmd: 'setSlotPosition', index: i, position: pos })}
                          className={`relative p-1 flex-1 grid place-items-center rounded ${sel ? 'ring-2 ring-[var(--gold)] bg-[#0a1420]' : 'ring-1 ring-[var(--gold-dim)] bg-[#122235]'}`}>
                          {ready && <img src={positionIcon(pos)} className="w-5 h-5" />}
                          {scarce && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rotate-45 bg-[var(--blue)]" title="우선순위(빠른 대기열)" />}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {/* current keystone — tap to open detailed rune editor */}
                    <button onClick={() => setRunePick({ slot: i })} title="룬 편집">
                      {s.perks?.perkIds?.[0] && ready && perkIcon(s.perks.perkIds[0])
                        ? <img src={perkIcon(s.perks.perkIds[0])} className="w-7 h-7 rounded-full bg-[#0a1420] ring-1 ring-[var(--gold)]" />
                        : <span className="w-7 h-7 rounded-full bg-[#122235] ring-1 ring-[var(--gold-dim)] grid place-items-center text-[10px] text-[var(--muted)]">룬</span>}
                    </button>
                    {/* recommended sets, matching one highlighted */}
                    {s.recSets?.map((set, si) => {
                      const on = sameRunes(s.perks, set);
                      return (
                        <button key={si} onClick={() => send({ cmd: 'applyRecommendedSet', index: i, perkIds: set.perkIds, perkStyle: set.perkStyle, perkSubStyle: set.perkSubStyle, ...flashOrder(set.spells[0], set.spells[1]) })}
                          className={`flex items-center gap-0.5 px-1.5 py-1 rounded ${on ? 'bg-[var(--gold)]/20 ring-2 ring-[var(--gold)]' : 'btn btn-ghost'}`}>
                          {set.keyIcon ? <img src={set.keyIcon} className="w-5 h-5" /> : <span className="skeleton w-5 h-5 rounded-full" />}
                          {ready && set.spells.map((sp, j) => sp ? <img key={j} src={sumSpellIcon(sp)} className="w-3.5 h-3.5 rounded-sm" /> : null)}
                        </button>
                      );
                    })}
                  </div>
                  <SlotItemReco champId={s.championId} mapId={snap.mapId ?? 11} ready={ready} />
                </div>
              </li>
            ))}
          </ul>
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
        <ul className="text-sm space-y-1 mb-2">
          {(snap.members ?? []).map((m, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="text-[var(--gold)]">{m.leader ? '★' : '·'}</span><span className="truncate">{m.name || '소환사'}</span>
              {m.first && ready && <img src={positionIcon(m.first)} className="w-4 h-4 ml-auto opacity-70" />}
            </li>
          ))}
        </ul>
      </Panel>

      <button onClick={() => send({ cmd: 'startQueue' })} className="btn btn-blue w-full py-3 font-bold text-lg font-hud tracking-wide">대전 찾기</button>

      {pick && <ChampPickerModal lane={snap.slots?.[pick.slot]?.position || ''} recPos={snap.recPos} owned={snap.owned} mByChamp={snap.me?.mByChamp} onClose={() => setPick(null)}
        onPick={(championId) => { send({ cmd: 'setSlotChampion', index: pick.slot, championId }); setPick(null); }} />}
      {spellPick && snap.slots?.[spellPick.slot] && (
        <SpellPickerModal current={[snap.slots[spellPick.slot].spell1, snap.slots[spellPick.slot].spell2]} onClose={() => setSpellPick(null)}
          onPick={(spell1, spell2) => send({ cmd: 'setSlotSpells', index: spellPick.slot, ...flashOrder(spell1, spell2) })} />
      )}
      {skinPick && snap.slots?.[skinPick.slot] && (
        <SkinPickerModal skins={snap.slots[skinPick.slot].skins || []} current={snap.slots[skinPick.slot].skinId}
          champKey={champ(snap.slots[skinPick.slot].championId)?.key || ''} onClose={() => setSkinPick(null)}
          onPick={(skinId) => { send({ cmd: 'setSlotSkin', index: skinPick.slot, skinId }); setSkinPick(null); }} />
      )}
      {runePick && snap.slots?.[runePick.slot] && (
        <RuneEditorModal current={snap.slots[runePick.slot].perks ?? null} onClose={() => setRunePick(null)}
          onApply={(perkIds, perkStyle, perkSubStyle) => { send({ cmd: 'setSlotPerks', index: runePick.slot, perkIds, perkStyle, perkSubStyle }); setRunePick(null); }} />
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

// Riot's recommended items for a slot's champion (compact strip).
function SlotItemReco({ champId, mapId, ready }: { champId: number; mapId: number; ready: boolean }) {
  const [items, setItems] = useState<number[]>([]);
  const key = champ(champId)?.key;
  useEffect(() => { if (key) loadRecommended(key, mapId).then((ids) => setItems(ids.slice(0, 6))); }, [key, mapId]);
  if (!items.length) return null;
  return (
    <div className="flex items-center gap-1">
      {ready && items.map((id, i) => <img key={i} src={itemIcon(id)} className="w-5 h-5 rounded-sm ring-1 ring-[var(--gold-dim)]" loading="lazy" />)}
    </div>
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
  const [spellPick, setSpellPick] = useState(false);
  const [skinPick, setSkinPick] = useState(false);
  const [runePick, setRunePick] = useState(false);
  const mine = snap.mine;
  const incoming = (snap.trades ?? []).filter((t) => t.state === 'RECEIVED');
  return (
    <main className="px-3 space-y-3 mt-3">
      <section className="panel flex items-center justify-between px-4 py-3">
        <span className="text-xs text-[var(--muted)]">{snap.timerPhase || '진행 중'}</span>
        <span className="font-mono text-2xl tabular-nums text-[var(--gold-br)]">{snap.timeLeft ?? 0}s</span>
      </section>

      {incoming.length > 0 && (
        <Panel title="챔피언 교환 요청">
          {incoming.map((t) => (
            <div key={t.id} className="flex items-center gap-2 mb-1 last:mb-0">
              <span className="text-sm flex-1">교환 요청이 왔어요</span>
              <button onClick={() => send({ cmd: 'tradeAccept', id: t.id })} className="btn btn-blue text-xs px-3 py-1">수락</button>
              <button onClick={() => send({ cmd: 'tradeDecline', id: t.id })} className="btn btn-danger text-xs px-3 py-1">거절</button>
            </div>
          ))}
        </Panel>
      )}

      <TeamCells title="우리 팀" cells={snap.myTeam ?? []} ready={ready} />
      <Bans mine={snap.bans?.mine ?? []} theirs={snap.bans?.theirs ?? []} ready={ready} />

      {action ? (
        <Panel title={isBan ? '챔피언 밴' : (snap.subset?.length ? '챔피언 선택 (제공된 챔피언)' : '챔피언 선택')}>
          <ChampGrid pool={isBan ? (snap.bannable ?? []) : (snap.subset?.length ? snap.subset : (snap.pickable ?? []))} ready={ready} sel={sel}
            onTap={(id) => { setSel(id); send({ cmd: isBan ? 'ban' : 'pick', championId: id, lock: false }); }} />
          <button disabled={!sel} onClick={() => send({ cmd: isBan ? 'ban' : 'pick', championId: sel, lock: true })}
            className={`btn w-full mt-3 py-3 font-bold font-hud ${isBan ? 'btn-danger' : 'btn-blue'} disabled:opacity-40`}>{isBan ? '밴 확정' : '픽 확정'}</button>
        </Panel>
      ) : <p className="text-center text-sm text-[var(--muted)]">내 차례 대기 중…</p>}

      {/* ARAM bench + reroll */}
      {snap.benchEnabled && (
        <Panel title={`벤치 교체 · 리롤 ${snap.rerolls ?? 0}`}>
          <div className="flex gap-1.5 flex-wrap mb-2">
            {(snap.bench ?? []).map((id) => (
              <button key={id} onClick={() => send({ cmd: 'benchSwap', championId: id })}><ChampImg id={id} className="w-10 h-10 rounded ring-1 ring-[var(--gold-dim)]" /></button>
            ))}
            {!snap.bench?.length && <span className="text-xs text-[var(--muted)]">벤치가 비어 있어요</span>}
          </div>
          <button disabled={!snap.rerolls} onClick={() => send({ cmd: 'reroll' })} className="btn btn-ghost w-full py-2 text-sm disabled:opacity-40">리롤 ({snap.rerolls ?? 0})</button>
        </Panel>
      )}

      {/* my runes + skin + spells */}
      {mine?.championId ? (
        <Panel title="내 룬 · 스킨 · 스펠">
          <div className="flex items-center gap-3">
            <button onClick={() => setSkinPick(true)} disabled={!mine.skins?.length}>
              <ChampImg id={mine.championId} className="w-12 h-12 rounded ring-1 ring-[var(--gold-dim)]" />
            </button>
            <button onClick={() => send({ cmd: 'csSelect', spell1: mine.spell2, spell2: mine.spell1 })} title="D/F 교환" className="btn btn-ghost px-2 py-1 text-xs">⇄</button>
            <button onClick={() => setSpellPick(true)} className="flex gap-1">
              {[mine.spell1, mine.spell2].map((sp, j) => ready && sp ? <img key={j} src={sumSpellIcon(sp)} className="w-7 h-7 rounded ring-1 ring-[var(--gold-dim)]" /> : <span key={j} className="w-7 h-7 rounded bg-[#122235]" />)}
            </button>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap mt-2">
            {/* current keystone — tap to open detailed rune editor */}
            <button onClick={() => setRunePick(true)} title="룬 편집">
              {mine.perks?.perkIds?.[0] && ready && perkIcon(mine.perks.perkIds[0])
                ? <img src={perkIcon(mine.perks.perkIds[0])} className="w-7 h-7 rounded-full bg-[#0a1420] ring-1 ring-[var(--gold)]" />
                : <span className="w-7 h-7 rounded-full bg-[#122235] ring-1 ring-[var(--gold-dim)] grid place-items-center text-[10px] text-[var(--muted)]">룬</span>}
            </button>
            {/* recommended sets, matching one highlighted */}
            {mine.recSets?.map((set, si) => {
              const on = sameRunes(mine.perks, set);
              return (
                <button key={si} onClick={() => { send({ cmd: 'applyRunePage', perkIds: set.perkIds, perkStyle: set.perkStyle, perkSubStyle: set.perkSubStyle }); if (set.spells[0] && set.spells[1]) send({ cmd: 'csSelect', ...flashOrder(set.spells[0], set.spells[1]) }); }}
                  className={`flex items-center gap-0.5 px-1.5 py-1 rounded ${on ? 'bg-[var(--gold)]/20 ring-2 ring-[var(--gold)]' : 'btn btn-ghost'}`}>
                  {set.keyIcon ? <img src={set.keyIcon} className="w-5 h-5" /> : <span className="skeleton w-5 h-5 rounded-full" />}
                  {ready && set.spells.map((sp, j) => sp ? <img key={j} src={sumSpellIcon(sp)} className="w-3.5 h-3.5 rounded-sm" /> : null)}
                </button>
              );
            })}
          </div>
        </Panel>
      ) : null}

      <button onClick={() => { if (confirm('챔피언 선택에서 나가면 닷지 처리돼요 (LP 감소 + 대기열 제한). 나갈까요?')) send({ cmd: 'dodge' }); }}
        className="btn btn-danger w-full py-2 text-sm">나가기 (닷지)</button>

      {spellPick && mine && <SpellPickerModal current={[mine.spell1, mine.spell2]} onClose={() => setSpellPick(false)}
        onPick={(spell1, spell2) => send({ cmd: 'csSelect', ...flashOrder(spell1, spell2) })} />}
      {skinPick && mine && <SkinPickerModal skins={mine.skins || []} current={mine.skinId} champKey={champ(mine.championId)?.key || ''}
        onClose={() => setSkinPick(false)} onPick={(skinId) => { send({ cmd: 'csSelect', skinId }); setSkinPick(false); }} />}
      {runePick && mine && <RuneEditorModal current={mine.perks ?? null} onClose={() => setRunePick(false)}
        onApply={(perkIds, perkStyle, perkSubStyle) => { send({ cmd: 'applyRunePage', perkIds, perkStyle, perkSubStyle }); setRunePick(false); }} />}
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

// Global preference: which slot Flash goes in (spell1=D, spell2=F). Applied to every
// spell the app sets, so presets and the spell picker always keep Flash where you want it.
const FLASH = 4;
export function getFlashSlot(): 'D' | 'F' { try { return localStorage.getItem('ward:flashSlot') === 'F' ? 'F' : 'D'; } catch { return 'D'; } }
export function setFlashSlot(s: 'D' | 'F') { try { localStorage.setItem('ward:flashSlot', s); } catch { /* ignore */ } }
function flashOrder(spell1: number, spell2: number): { spell1: number; spell2: number } {
  if (spell1 !== FLASH && spell2 !== FLASH) return { spell1, spell2 };
  const other = spell1 === FLASH ? spell2 : spell1;
  return getFlashSlot() === 'D' ? { spell1: FLASH, spell2: other } : { spell1: other, spell2: FLASH };
}

// Full-roster picker (for Swiftplay slots): all champions + per-lane favorites + Riot's lane recommendations.
function ChampPickerModal({ lane, recPos, owned, mByChamp, onClose, onPick }: { lane: string; recPos?: Record<string, string[]>; owned?: number[]; mByChamp?: Record<string, number>; onClose: () => void; onPick: (id: number) => void }) {
  const [fav, setFavState] = useState(() => getFav(lane));
  const [q, setQ] = useState('');
  const [recOnly, setRecOnly] = useState(false);
  const ownedSet = new Set(owned ?? []);
  const has = (id: number) => !owned || ownedSet.has(id); // treat as owned if list absent
  const all = allChampions();
  const rec = (id: number) => recPos?.[String(id)]?.includes(lane);
  const list = all
    .filter((c) => (!q || c.name.includes(q)) && (!recOnly || !lane || rec(c.id)))
    .sort((a, b) => (has(b.id) ? 1 : 0) - (has(a.id) ? 1 : 0)); // owned first
  const toggle = (id: number) => { const n = fav.includes(id) ? fav.filter((x) => x !== id) : [...fav, id]; setFav(lane, n); setFavState(n); };
  return (
    <div className="fixed inset-0 z-20 bg-black/70 flex items-end" onClick={onClose}>
      <div className="panel w-full p-4 h-[75dvh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
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
        {recPos && lane && (
          <label className="flex items-center gap-2 mb-2 text-sm">
            <Toggle on={recOnly} onChange={setRecOnly} />
            <span>{posKo(lane)} 추천 챔피언만</span>
          </label>
        )}
        <div className="grid grid-cols-5 gap-1.5 overflow-y-auto">
          {list.map((c) => (
            <div key={c.id} className="relative">
              <button onClick={() => onPick(c.id)} className="w-full"><img src={champIconById(c.id)} alt={c.name} className={`w-full aspect-square rounded ${has(c.id) ? '' : 'grayscale opacity-40'}`} loading="lazy" /></button>
              {mByChamp?.[String(c.id)] ? <span className="absolute bottom-0.5 left-0.5 text-[9px] font-bold bg-black/75 text-[var(--gold)] rounded px-1">M{mByChamp[String(c.id)]}</span> : null}
              <button onClick={() => toggle(c.id)}
                className={`absolute top-0.5 right-0.5 w-5 h-5 grid place-items-center text-xs rounded-full bg-black/70 ${fav.includes(c.id) ? 'text-[var(--gold)]' : 'text-white/80'}`}>★</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

type Perks = { perkIds: number[]; perkStyle: number; perkSubStyle: number };
function sameRunes(a: Perks | null | undefined, b: { perkIds: number[]; perkStyle: number; perkSubStyle: number }) {
  if (!a) return false;
  return a.perkStyle === b.perkStyle && a.perkSubStyle === b.perkSubStyle && a.perkIds.length === b.perkIds.length && a.perkIds.every((v, i) => v === b.perkIds[i]);
}

// Full rune page editor: primary tree + keystone + 3 runes, secondary tree + 2 runes, 3 stat shards.
function RuneEditorModal({ current, onClose, onApply }: { current: Perks | null; onClose: () => void; onApply: (perkIds: number[], pri: number, sec: number) => void }) {
  const trees = runeTrees();
  const [pri, setPri] = useState(current?.perkStyle || 8000);
  const [sec, setSec] = useState(current?.perkSubStyle || 8100);
  const [keystone, setKeystone] = useState(0);
  const [prim, setPrim] = useState<Record<number, number>>({});   // row -> perkId
  const [second, setSecond] = useState<Record<number, number>>({}); // row -> perkId (max 2 rows)
  const [shards, setShards] = useState<Record<number, number>>({});

  // Initialise selections from the current page once rune data is available.
  useEffect(() => {
    if (!trees.length || !current?.perkIds) return;
    const [ks, ...rest] = current.perkIds;
    setKeystone(ks);
    const pr: Record<number, number> = {}; runeRows(current.perkStyle).forEach((row, r) => { const hit = rest.find((id) => row.includes(id)); if (hit) pr[r] = hit; });
    setPrim(pr);
    const sc: Record<number, number> = {}; runeRows(current.perkSubStyle).forEach((row, r) => { const hit = rest.find((id) => row.includes(id)); if (hit) sc[r] = hit; });
    setSecond(sc);
    const sh: Record<number, number> = {}; shardRows().forEach((row, r) => { const hit = current.perkIds.find((id) => row.includes(id)); if (hit) sh[r] = hit; });
    setShards(sh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trees.length]);

  const pickSecond = (r: number, id: number) => setSecond((p) => {
    const n = { ...p }; if (n[r] === id) { delete n[r]; return n; }
    n[r] = id; const rows = Object.keys(n); if (rows.length > 2) delete n[Number(rows[0])]; return n;
  });
  const chooseTree = (id: number, primary: boolean) => {
    if (primary) { setPri(id); setKeystone(0); setPrim({}); if (sec === id) setSec(0); }
    else { setSec(id); setSecond({}); }
  };

  const valid = keystone && Object.keys(prim).length === 3 && Object.keys(second).length === 2 && Object.keys(shards).length === 3 && pri && sec && pri !== sec;
  const apply = () => {
    const perkIds = [keystone, ...[0, 1, 2].map((r) => prim[r]),
      ...Object.keys(second).sort().map((r) => second[Number(r)]),
      ...[0, 1, 2].map((r) => shards[r])];
    onApply(perkIds, pri, sec);
  };

  const RuneBtn = ({ id, on, onClick, sz = 'w-9 h-9' }: { id: number; on: boolean; onClick: () => void; sz?: string }) =>
    perkIcon(id)
      ? <button onClick={onClick} title={perk(id)?.name} className={`${sz} rounded-full p-0.5 ${on ? 'bg-[var(--gold)]/25 ring-2 ring-[var(--gold)]' : 'ring-1 ring-[var(--gold-dim)]'}`}><img src={perkIcon(id)} className="w-full h-full" /></button>
      : <span className={`${sz} rounded-full skeleton`} />;

  return (
    <div className="fixed inset-0 z-20 bg-black/80 flex items-end" onClick={onClose}>
      <div className="panel w-full p-4 min-h-[70dvh] max-h-[90dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3"><h2 className="panel-title">룬 상세 편집</h2><button onClick={onClose} className="text-[var(--muted)] text-sm">닫기</button></div>
        {!trees.length ? (
          <div className="space-y-3">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-12" />)}</div>
        ) : (
          <div className="space-y-4">
            {/* trees */}
            <div className="flex items-center gap-2">
              {trees.map((t) => <button key={t.id} onClick={() => chooseTree(t.id, true)} className={`w-9 h-9 rounded-full p-1 ${pri === t.id ? 'bg-[var(--gold)]/25 ring-2 ring-[var(--gold)]' : 'ring-1 ring-[var(--gold-dim)]'}`}><img src={styleIcon(t.id)} className="w-full h-full" /></button>)}
              <span className="text-xs text-[var(--muted)] ml-1">주 룬</span>
            </div>
            {/* keystone */}
            <div className="flex gap-2">{keystoneRow(pri).map((id) => <RuneBtn key={id} id={id} on={keystone === id} onClick={() => setKeystone(id)} sz="w-11 h-11" />)}</div>
            {/* primary rows */}
            {runeRows(pri).map((row, r) => (
              <div key={r} className="flex gap-2">{row.map((id) => <RuneBtn key={id} id={id} on={prim[r] === id} onClick={() => setPrim((p) => ({ ...p, [r]: id }))} />)}</div>
            ))}
            {/* secondary trees */}
            <div className="flex items-center gap-2 pt-2 border-t hair">
              {trees.filter((t) => t.id !== pri).map((t) => <button key={t.id} onClick={() => chooseTree(t.id, false)} className={`w-8 h-8 rounded-full p-1 ${sec === t.id ? 'bg-[var(--gold)]/25 ring-2 ring-[var(--gold)]' : 'ring-1 ring-[var(--gold-dim)]'}`}><img src={styleIcon(t.id)} className="w-full h-full" /></button>)}
              <span className="text-xs text-[var(--muted)] ml-1">보조 (2개)</span>
            </div>
            {runeRows(sec).map((row, r) => (
              <div key={r} className="flex gap-2">{row.map((id) => <RuneBtn key={id} id={id} on={second[r] === id} onClick={() => pickSecond(r, id)} sz="w-8 h-8" />)}</div>
            ))}
            {/* shards */}
            <div className="pt-2 border-t hair space-y-2">
              <span className="text-xs text-[var(--muted)]">능력치 파편</span>
              {shardRows().map((row, r) => (
                <div key={r} className="flex gap-2">{row.map((id) => <RuneBtn key={id} id={id} on={shards[r] === id} onClick={() => setShards((p) => ({ ...p, [r]: id }))} sz="w-7 h-7" />)}</div>
              ))}
            </div>
            <button disabled={!valid} onClick={apply} className="btn btn-blue w-full py-3 font-bold font-hud disabled:opacity-40">적용</button>
          </div>
        )}
      </div>
    </div>
  );
}

function SkinPickerModal({ skins, current, champKey, onClose, onPick }: { skins: { id: number; name: string; base?: boolean; chroma?: boolean; color?: string }[]; current: number; champKey: string; onClose: () => void; onPick: (id: number) => void }) {
  return (
    <div className="fixed inset-0 z-20 bg-black/70 flex items-end" onClick={onClose}>
      <div className="panel w-full p-4 min-h-[60dvh] max-h-[85dvh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2"><h2 className="panel-title">스킨 · 크로마 (소유)</h2><button onClick={onClose} className="text-[var(--muted)] text-sm">닫기</button></div>
        <div className="grid grid-cols-2 gap-2 overflow-y-auto">
          {skins.map((sk) => (
            <button key={sk.id} onClick={() => onPick(sk.id)}
              className={`relative rounded overflow-hidden ring-2 ${sk.id === current ? 'ring-[var(--gold)]' : 'ring-transparent'}`}>
              {sk.chroma
                ? <div className="w-full aspect-[16/9] grid place-items-center bg-[#0a1420]"><span className="w-8 h-8 rounded-full ring-2 ring-white/80" style={{ background: sk.color }} /></div>
                : <img src={skinArt(champKey, sk.id % 1000)} alt={sk.name} className="w-full aspect-[16/9] object-cover object-top" loading="lazy" />}
              <span className="absolute bottom-0 inset-x-0 bg-black/70 text-[11px] py-0.5 truncate px-1">{sk.name}</span>
            </button>
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
      <div className="panel w-full p-4 min-h-[55dvh]" onClick={(e) => e.stopPropagation()}>
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

function PostGame({ snap, ready, send }: { snap: Snapshot; ready: boolean; send: (c: Command) => void }) {
  const [honored, setHonored] = useState<number[]>([]); // sids already honored this game
  const allies = snap.ballot?.allies ?? [];
  const votes = snap.honorVotes ?? 0;
  const left = Math.max(0, votes - honored.length);
  return (
    <main className="px-3 space-y-3 mt-3">
      <Panel title={votes ? `명예 평가 · 남은 명예 ${left}/${votes}` : '명예 평가'}>
        {allies.length ? (
          <ul className="space-y-2">
            {allies.map((p) => {
              const done = honored.includes(p.sid);
              return (
                <li key={p.sid || p.puuid} className="flex items-center gap-2">
                  {ready && p.champId ? <ChampImg id={p.champId} className="w-8 h-8 rounded" /> : <span className="w-8 h-8 rounded bg-[#122235] block" />}
                  <span className="flex-1 truncate text-sm">{p.name || '소환사'}</span>
                  <button disabled={done || (!!votes && left <= 0)} onClick={() => { send({ cmd: 'honor', sid: p.sid, puuid: p.puuid }); setHonored((h) => [...h, p.sid]); }}
                    className="btn btn-gold text-xs px-3 py-1 disabled:opacity-40">{done ? '완료' : '명예'}</button>
                </li>
              );
            })}
          </ul>
        ) : <p className="text-sm text-[var(--muted)]">명예 평가 대상이 없어요.</p>}
      </Panel>

      <div className="flex gap-2">
        <button onClick={() => send({ cmd: 'continueEog' })} className="btn btn-ghost flex-1 py-3 font-hud">계속</button>
        <button onClick={() => send({ cmd: 'playAgain' })} className="btn btn-blue flex-1 py-3 font-bold font-hud">한번 더 하기</button>
      </div>
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

function Waiting({ status, clientOff, phase }: { status: string; clientOff: boolean; phase?: string | null }) {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-2 mt-24 px-6">
      <div className="font-hud text-3xl text-[var(--gold)]">CWARD</div>
      <p className="text-[var(--text)] font-medium mt-2">{clientOff ? 'PC 클라이언트 꺼짐' : '대기 중'}</p>
      <p className="text-sm text-[var(--muted)]">{clientOff ? 'PC에서 롤 클라이언트를 켜면 자동으로 연결돼요.' : '게임을 시작하면 자동으로 표시돼요.'}</p>
      <p className="text-xs text-[var(--muted)]/60">서버 연결: {status}{clientOff || !phase ? '' : ` · ${phase}`}</p>
    </div>
  );
}

const RELEASES_URL = 'https://github.com/hoony6134/cward/releases';
const DL = {
  win: `${RELEASES_URL}/latest/download/cward-agent-windows-x64.exe`,
  macApp: `${RELEASES_URL}/latest/download/cward-overlay-macos-arm64.dmg`,
  macX64: `${RELEASES_URL}/latest/download/cward-agent-macos-x64`,
};

function WardMark() {
  return (
    <svg className="wardmark" width="104" height="130" viewBox="0 0 120 150" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="wm-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e4cf94" /><stop offset=".55" stopColor="#c8aa6e" /><stop offset="1" stopColor="#8a6f3c" />
        </linearGradient>
        <linearGradient id="wm-gem" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff7ab0" /><stop offset=".45" stopColor="#ff3d82" /><stop offset="1" stopColor="#b51e5f" />
        </linearGradient>
        <radialGradient id="wm-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#ff4e8e" stopOpacity=".85" /><stop offset=".6" stopColor="#ff4e8e" stopOpacity=".16" /><stop offset="1" stopColor="#ff4e8e" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle className="glow" cx="60" cy="46" r="54" fill="url(#wm-glow)" />
      <path d="M60 96 L80 108 L72 146 Q60 152 48 146 L40 108 Z" fill="url(#wm-gold)" />
      <path d="M44 114 H76 M47 130 H73" stroke="#0a1626" strokeWidth="3" strokeLinecap="round" opacity=".5" />
      <path d="M42 96 Q60 82 78 96 L72 103 Q60 94 48 103 Z" fill="url(#wm-gold)" />
      <g stroke="#ffd8e8" strokeWidth="2" strokeLinejoin="round">
        <path d="M60 10 L86 42 L60 96 L34 42 Z" fill="url(#wm-gem)" />
        <path d="M34 42 H86" strokeWidth="1.5" opacity=".6" />
        <path d="M60 10 L60 96" strokeWidth="1.5" opacity=".6" />
      </g>
      <path d="M60 20 L76 40 L60 50 L44 40 Z" fill="#fff" opacity=".45" />
    </svg>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <div className="panel p-4 flex gap-3 text-left enter">
      <div className="step-num">{n}</div>
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="text-sm font-bold text-[var(--text)]">{title}</div>
        <div className="text-xs text-[var(--muted)] leading-relaxed space-y-2">{children}</div>
      </div>
    </div>
  );
}

function Pairing() {
  const [v, setV] = useState('');
  const [err, setErr] = useState(false);
  const connect = () => { const p = parsePairing(v); if (p) savePairing(p); else setErr(true); };
  return (
    <div className="landing">
      <div className="landing-bg" aria-hidden="true" />
      <main className="relative z-10 min-h-dvh flex flex-col items-center gap-9 px-6 py-14" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 2.5rem)' }}>
        <section className="flex flex-col items-center text-center gap-4">
          <WardMark />
          <div>
            <div className="font-hud text-5xl text-[var(--gold)] drop-gold">CWARD</div>
            <p className="mt-2 text-sm text-[var(--muted)]">제어와드처럼, 시야 밖까지 — 폰에서 보는 League 인게임</p>
          </div>
        </section>

        <section className="panel w-full max-w-sm p-5 flex flex-col gap-3 enter">
          <div className="panel-title">페어링</div>
          <input value={v} onChange={(e) => { setV(e.target.value); setErr(false); }} placeholder="페어링 링크 붙여넣기"
            onKeyDown={(e) => { if (e.key === 'Enter') connect(); }}
            className={`w-full px-3 py-3 rounded bg-[#0a1420] text-sm outline-none ring-1 transition ${err ? 'ring-[var(--red)]' : 'ring-[var(--gold-dim)] focus:ring-[var(--blue)]'}`} />
          {err && <p className="text-xs text-[var(--red)]">링크에 room·token이 없어요. 전체 링크를 붙여넣어 주세요.</p>}
          <button onClick={connect} className="btn btn-blue w-full py-3 font-bold font-hud">연결</button>
          <p className="text-xs text-[var(--muted)]">PC에서 에이전트를 실행하면 나오는 링크를 붙여넣으세요. 토큰은 이 기기에만 저장돼 다음부턴 자동 연결돼요.</p>
        </section>

        <section className="w-full max-w-sm flex flex-col gap-3">
          <div className="panel-title text-center">설치 가이드</div>
          <Step n="1" title="PC에 에이전트 설치">
            <p>League가 켜진 PC의 OS에 맞는 파일을 받아 실행하면 끝 — Node 설치 불필요.</p>
            <div className="grid grid-cols-3 gap-2 not-prose">
              <a href={DL.win} className="btn btn-gold flex flex-col items-center gap-0.5 py-2 text-[11px] font-bold leading-tight">Windows<span className="opacity-70 font-normal">x64 .exe</span></a>
              <a href={DL.macApp} className="btn btn-gold flex flex-col items-center gap-0.5 py-2 text-[11px] font-bold leading-tight">macOS 앱<span className="opacity-70 font-normal">Apple Silicon .dmg</span></a>
              <a href={DL.macX64} className="btn btn-gold flex flex-col items-center gap-0.5 py-2 text-[11px] font-bold leading-tight">macOS<span className="opacity-70 font-normal">Intel (에이전트)</span></a>
            </div>
            <p className="text-center"><a href={RELEASES_URL} target="_blank" rel="noreferrer" className="underline text-[var(--gold)]">전체 릴리스 보기 ↗</a></p>
            <p><b className="text-[var(--text)]">Windows</b>: 다운로드한 <code className="text-[var(--text)]">.exe</code> 더블클릭 → "추가 정보 → 실행".</p>
            <p><b className="text-[var(--text)]">macOS (Apple Silicon)</b>: <code className="text-[var(--text)]">.dmg</code>를 열어 <b className="text-[var(--text)]">cward</b> 앱을 실행 — 서명·공증돼 격리 해제가 필요 없어요. 메뉴바 앱으로 떠서 QR 페어링 + 인게임 오버레이를 제공합니다(터미널 불필요).</p>
            <p><b className="text-[var(--text)]">macOS (Intel)</b> (서명 없는 에이전트라 격리 해제 필요):</p>
            <pre className="whitespace-pre-wrap break-all rounded bg-[#060c14] p-2 text-[11px] text-[var(--gold-br)] ring-1 ring-[var(--gold-dim)]">xattr -dr com.apple.quarantine ~/Downloads/cward-agent-macos-x64
chmod +x ~/Downloads/cward-agent-macos-x64 && ~/Downloads/cward-agent-macos-x64</pre>
          </Step>
          <Step n="2" title="실행 → 페어링 링크 생성">
            <p>첫 실행 때 방·토큰이 자동 생성되고(<code>cward.config.json</code>), 폰 연결 QR과 링크가 콘솔에 떠요. 게임 전엔 그 파일만 다시 실행하면 됩니다.</p>
          </Step>
          <Step n="3" title="링크 붙여넣기 → 연결">
            <p>콘솔의 링크를 복사해 위 칸에 붙여넣고 <b className="text-[var(--text)]">연결</b>. QR을 폰 카메라로 스캔해 열어도 돼요.</p>
          </Step>
        </section>

        <footer className="text-[10px] text-[var(--muted)] opacity-60 pb-4">wss(TLS) · 방별 공유 토큰 · 서버 시크릿 없음</footer>
      </main>
    </div>
  );
}
