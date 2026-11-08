// Free Cloudflare relay: one Durable Object per pairing room. The headless agent
// connects as role=agent and pushes snapshots; phones connect as role=viewer and
// receive them. Uses the WebSocket Hibernation API so idle rooms cost nothing.

export interface Env {
  ROOM: DurableObjectNamespace<RelayRoom>;
}

const sanitizeRoom = (r: string) => r.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/ws') {
      return new Response('lol-companion relay', { status: 200 });
    }
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    const room = sanitizeRoom(url.searchParams.get('room') || '');
    if (!room) {
      return new Response('unauthorized', { status: 401 });
    }
    // The token is a per-room shared secret between the agent and the phone, verified
    // inside the DO (trust-on-first-use). No server-wide secret: the room id is random.
    const stub = env.ROOM.getByName(room);
    return stub.fetch(request);
  },
};

import { DurableObject } from 'cloudflare:workers';

export class RelayRoom extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const role = url.searchParams.get('role') === 'agent' ? 'agent' : 'viewer';
    const token = url.searchParams.get('token') || '';
    // Trust-on-first-use: the first connector fixes this room's token; others must match.
    const known = await this.ctx.storage.get<string>('token');
    if (!token || (known !== undefined && token !== known)) {
      return new Response('unauthorized', { status: 401 });
    }
    if (known === undefined) await this.ctx.storage.put('token', token);
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    // Tag the socket with its role so we can target broadcasts after hibernation.
    this.ctx.acceptWebSocket(server, [role]);

    if (role === 'viewer') {
      // Send the last known snapshot immediately so a phone joining mid-game isn't blank.
      const last = await this.ctx.storage.get<string>('last');
      if (last) try { server.send(last); } catch { /* socket may be closing */ }
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
    if (this.ctx.getTags(ws).includes('agent')) {
      // snapshot: store latest and fan out to viewers
      await this.ctx.storage.put('last', text);
      for (const v of this.ctx.getWebSockets('viewer')) {
        try { v.send(text); } catch { /* drop dead viewers */ }
      }
    } else {
      // command from a phone: forward to the agent(s), don't store or echo
      for (const a of this.ctx.getWebSockets('agent')) {
        try { a.send(text); } catch { /* agent offline */ }
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number) {
    try { ws.close(code, 'bye'); } catch { /* already closed */ }
  }
}
