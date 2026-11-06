import { useEffect, useRef, useState } from 'react';

export type Spell = { name: string; key: string };
export type Player = {
  riotId: string; name: string; champion: string; champKey: string;
  team: 'ORDER' | 'CHAOS'; position: string; level: number; isBot: boolean;
  dead: boolean; respawn: number; k: number; d: number; a: number; cs: number; ward: number;
  spells: Spell[]; items: { id: number; name: string; count: number }[];
};
export type Cell = { cellId: number; championId: number; position: string; me: boolean };
export type Snapshot = {
  kind?: 'ingame' | 'lobby' | 'champselect' | 'readycheck' | 'searching' | 'menu' | 'postgame' | 'off' | 'client' | 'idle';
  ballot?: { gameId: number; allies: { sid: number; puuid: string; name: string; champId: number }[] } | null;
  t: number; phase: string | null;
  me?: {
    name: string; tag: string; iconId: number; level: number;
    rank?: { tier: string; div: string; lp: number; w: number; l: number } | null;
    mastery?: { id: number; lv: number; pt: number }[];
    mByChamp?: Record<string, number>;
  };
  friends?: { name: string; sid: number; avail: string; note?: string; icon?: number; status?: string; id?: string }[];
  icons?: number[];
  loot?: { blue: number; orange: number; mythic: number; rp: number; champShards: { n: number; value: number }; skinShards: { n: number; value: number }; chests: number; keys: number };
  autoAccept?: boolean;
  recPos?: Record<string, string[]>; // championId -> Riot recommended lanes
  // in-game
  game?: { mode: string; mapId: number | null; time: number };
  active?: null | {
    riotId: string; level: number; gold: number; hp: number; maxHp: number;
    resourceType: string; res: number; maxRes: number;
    abilities: { Q: number; W: number; E: number; R: number };
  };
  players?: Player[];
  objectives?: { dragons: { type: string; time: number }[]; barons: number; heralds: number; atakhan: number; towers: { ORDER: number; CHAOS: number } };
  recent?: { id: number; name: string; time: number }[];
  // lobby
  queues?: { id: number; name: string; ai?: boolean; icon?: string; cat?: string }[];
  queueId?: number | null; queueName?: string; mode?: string; maxSize?: number | null;
  canPickPosition?: boolean; positions?: { first: string; second: string };
  quickPlay?: boolean;
  mapId?: number;
  priorityPos?: string[]; // mandatory matchmaking priority positions (≥1)
  scarce?: string[];      // positions that get faster queue
  owned?: number[]; // owned champion ids
  slots?: {
    championId: number; spell1: number; spell2: number; position: string; skinId: number;
    perks?: { perkIds: number[]; perkStyle: number; perkSubStyle: number } | null;
    skins?: { id: number; name: string; base?: boolean; chroma?: boolean; color?: string }[];
    recSets?: { keyIcon: string; perkIds: number[]; perkStyle: number; perkSubStyle: number; spells: number[] }[];
  }[];
  members?: { name: string; leader: boolean; ready: boolean; first: string; second: string }[];
  // searching
  queueTime?: number; estTime?: number;
  // champ-select
  timeLeft?: number; timerPhase?: string;
  myAction?: null | { id: number; type: string; championId: number };
  myTeam?: Cell[]; theirTeam?: Cell[];
  bans?: { mine: number[]; theirs: number[] };
  pickable?: number[]; bannable?: number[];
  benchEnabled?: boolean; bench?: number[]; rerolls?: number;
  trades?: { id: number; cellId: number; state: string }[];
  mine?: { championId: number; skinId: number; spell1: number; spell2: number; skins?: { id: number; name: string; base?: boolean; chroma?: boolean; color?: string }[] } | null;
};
export type Command = Record<string, unknown> & { cmd: string };

// Pairing: room + token come from the URL fragment (#room=..&token=..) once, then
// persist in localStorage so reopening the page just works. The fragment never
// reaches the server, so the token isn't logged in request URLs.
// Accepts a full pairing link, a "?..."/"#..." string, or "room=x&token=y".
export function parsePairing(input: string): { room: string; token: string } | null {
  const frag = (input || '').trim().split(/[#?]/).pop() || '';
  const p = new URLSearchParams(frag);
  const room = p.get('room'); const token = p.get('token');
  return room && token ? { room, token } : null;
}

function readPairing(): { room: string; token: string } | null {
  // Launch via link: accept token from hash OR query, save to this origin's storage.
  const fromUrl = parsePairing(location.hash) || parsePairing(location.search);
  if (fromUrl) {
    try { localStorage.setItem('pairing', JSON.stringify(fromUrl)); } catch { /* ignore */ }
    history.replaceState(null, '', location.pathname);
    return fromUrl;
  }
  try { return JSON.parse(localStorage.getItem('pairing') || 'null'); } catch { return null; }
}

export function savePairing(p: { room: string; token: string }) {
  try { localStorage.setItem('pairing', JSON.stringify(p)); } catch { /* ignore */ }
  location.href = location.pathname;
}

export function clearPairing() { localStorage.removeItem('pairing'); location.reload(); }

export function useRelay(baseWsUrl: string) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [status, setStatus] = useState<'연결 중' | '연결됨' | '끊김' | '페어링 필요'>('연결 중');
  const pairing = useRef(readPairing());
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const p = pairing.current;
    if (!p) { setStatus('페어링 필요'); return; }
    let closed = false; let backoff = 1000; let timer: number;

    const connect = () => {
      if (closed) return;
      const ws = new WebSocket(`${baseWsUrl}?room=${encodeURIComponent(p.room)}&role=viewer&token=${encodeURIComponent(p.token)}`);
      wsRef.current = ws;
      ws.onopen = () => { backoff = 1000; setStatus('연결됨'); };
      ws.onmessage = (e) => { try { setSnap(JSON.parse(e.data)); } catch { /* ignore */ } };
      ws.onclose = () => { setStatus('끊김'); if (!closed) timer = setTimeout(connect, backoff = Math.min(backoff * 2, 15000)); };
      ws.onerror = () => { try { ws.close(); } catch { /* noop */ } };
    };
    connect();
    return () => { closed = true; clearTimeout(timer); try { wsRef.current?.close(); } catch { /* noop */ } };
  }, [baseWsUrl]);

  const send = (c: Command) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(c));
  };
  return { snap, status, paired: !!pairing.current, send };
}
