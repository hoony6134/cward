// Minimal service worker: makes Ward installable and ready for push.
// Real server push (closed-app) needs VAPID + the relay sending pushes — next step.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== IMG_CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

// Cache-first for champion/item/spell/rune art from the two LoL CDNs — versioned,
// so they never change under a URL. JSON (ddragon data) is left to the network.
const IMG_CACHE = 'ward-img-v1';
const IMG_HOSTS = ['ddragon.leagueoflegends.com', 'raw.communitydragon.org'];
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url; try { url = new URL(req.url); } catch { return; }
  const isImg = IMG_HOSTS.includes(url.hostname) && (req.destination === 'image' || /\.(png|jpe?g|webp|svg|gif)$/i.test(url.pathname));
  if (!isImg) return; // pass-through for everything else
  e.respondWith((async () => {
    const cache = await caches.open(IMG_CACHE);
    const hit = await cache.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    try { await cache.put(req, res.clone()); } catch { /* opaque/quota — serve anyway */ }
    return res;
  })());
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { /* ignore */ }
  e.waitUntil(self.registration.showNotification(d.title || 'Ward', { body: d.body || '', icon: '/icon.svg' }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((cs) => (cs[0] ? cs[0].focus() : self.clients.openWindow('/'))));
});
