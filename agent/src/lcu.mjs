// LCU (League Client) access: discover the local client's port + auth token, then
// a small REST helper. The client serves a self-signed cert on 127.0.0.1, so we
// skip verification for that origin only. Discovery reads the running process args
// (works on macOS/Windows) and falls back to the lockfile.
import https from 'node:https';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });

const LOCKFILE_PATHS = [
  '/Applications/League of Legends.app/Contents/LoL/lockfile',
  path.join(os.homedir(), 'Library/Application Support/Riot Games/League of Legends/lockfile'),
];

function fromProcess() {
  return new Promise((resolve) => {
    execFile('ps', ['x', '-o', 'args='], { maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
      if (err) return resolve(null);
      const line = out.split('\n').find((l) => l.includes('LeagueClientUx') && l.includes('--app-port='));
      if (!line) return resolve(null);
      const port = line.match(/--app-port=(\d+)/)?.[1];
      const token = line.match(/--remoting-auth-token=([\w-]+)/)?.[1];
      resolve(port && token ? { port: Number(port), token } : null);
    });
  });
}

function fromLockfile() {
  for (const p of LOCKFILE_PATHS) {
    try {
      const [, , port, token] = fs.readFileSync(p, 'utf8').split(':'); // name:pid:port:password:protocol
      if (port && token) return { port: Number(port), token };
    } catch { /* try next */ }
  }
  return null;
}

export async function discoverLCU() {
  return (await fromProcess()) || fromLockfile();
}

function request(creds, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const data = body != null ? JSON.stringify(body) : null;
    const req = https.request(
      {
        host: '127.0.0.1', port: creds.port, method, path: pathname, agent, timeout: 4000,
        headers: {
          Authorization: 'Basic ' + Buffer.from('riot:' + creds.token).toString('base64'),
          Accept: 'application/json',
          ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          if (res.statusCode >= 400) return reject(new Error(`${method} ${pathname} -> ${res.statusCode} ${buf.slice(0, 120)}`));
          try { resolve(buf ? JSON.parse(buf) : null); } catch { resolve(buf); }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

export const lcuGet = (c, p) => request(c, 'GET', p);
export const lcuPost = (c, p, b) => request(c, 'POST', p, b);
export const lcuPatch = (c, p, b) => request(c, 'PATCH', p, b);
export const lcuPut = (c, p, b) => request(c, 'PUT', p, b);
export const lcuDelete = (c, p) => request(c, 'DELETE', p);
