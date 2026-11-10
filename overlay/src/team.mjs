// Team cooldown sync: teammates in the same game derive the same relay room from
// what they all see in the Live Client data — the 10 players, the mode and their
// own side — so nothing has to be shared or configured. Enemies land in a
// different room (their side differs). Riot IDs only leave the machine hashed.
import { createHash } from 'node:crypto';

const sha = (s) => createHash('sha256').update(s).digest('hex');

// -> { room, token } for this snapshot's game + my team, or null if not resolvable.
export function teamRoomOf(snap) {
  if (snap?.kind !== 'ingame' || !snap.players?.length) return null;
  const me = snap.players.find((p) => p.riotId === snap.active?.riotId);
  if (!me?.team) return null;
  const ids = snap.players.map((p) => p.riotId).filter(Boolean).sort();
  const base = `${snap.game?.mode ?? ''}|${ids.join(',')}|${me.team}`;
  return { room: 't' + sha('room|' + base).slice(0, 40), token: sha('tok|' + base).slice(0, 32) };
}
