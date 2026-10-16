// hollow service worker. Generated into dist/sw.js at build time by vite.config.ts, which fills in
// the two placeholders below: the cache version (changes whenever any built file changes) and the
// list of every file to keep offline.
//
// Strategy:
//   - everything the game needs is cached when the app is first opened, so it runs with no network
//   - the page itself: network first (so updates arrive), but gives up after a moment and uses the
//     cached copy, so it opens instantly on a bad connection and fully offline
//   - other files: cache first
//   - the game server connection (/ws, WebSocket) is never touched
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const PAGE_TIMEOUT_MS = 2500;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname === '/ws') return;

  if (req.mode === 'navigate') {
    event.respondWith(
      Promise.race([
        fetch(req),
        new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), PAGE_TIMEOUT_MS)),
      ])
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/').then((hit) => hit || caches.match('/index.html'))),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
