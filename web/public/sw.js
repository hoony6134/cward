// Minimal service worker: makes Ward installable and ready for push.
// Real server push (closed-app) needs VAPID + the relay sending pushes — next step.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {}); // pass-through; presence enables install

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { /* ignore */ }
  e.waitUntil(self.registration.showNotification(d.title || 'Ward', { body: d.body || '', icon: '/icon.svg' }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((cs) => (cs[0] ? cs[0].focus() : self.clients.openWindow('/'))));
});
