// Reads the League Live Client Data API on https://127.0.0.1:2999. It serves a
// self-signed cert, so we skip verification for this one localhost origin only.
import https from 'node:https';

const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });

export function getAllGameData(timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      'https://127.0.0.1:2999/liveclientdata/allgamedata',
      { agent, timeout: timeoutMs },
      (res) => {
        if (res.statusCode !== 200) { res.resume(); return reject(new Error('http ' + res.statusCode)); }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject); // ECONNREFUSED when no game is running
  });
}
