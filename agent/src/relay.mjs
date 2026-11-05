// WebSocket client to the Cloudflare relay with auto-reconnect and backoff.
import WebSocket from 'ws';

export function createRelay({ url, room, token, onStatus = () => {}, onCommand = () => {} }) {
  let ws = null;
  let backoff = 1000;
  let closed = false;

  const connect = () => {
    if (closed) return;
    const full = `${url}?room=${encodeURIComponent(room)}&role=agent&token=${encodeURIComponent(token)}`;
    ws = new WebSocket(full);
    ws.on('open', () => { backoff = 1000; onStatus('connected'); });
    ws.on('message', (d) => { try { onCommand(JSON.parse(d.toString())); } catch { /* ignore */ } });
    ws.on('close', (code) => {
      onStatus(`disconnected (${code})`);
      if (!closed) setTimeout(connect, backoff = Math.min(backoff * 2, 15000));
    });
    ws.on('error', () => { /* 'close' follows and handles reconnect */ });
  };

  connect();

  return {
    send(obj) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify(obj)); return true; } catch { return false; }
      }
      return false;
    },
    close() { closed = true; try { ws?.close(); } catch { /* noop */ } },
  };
}
