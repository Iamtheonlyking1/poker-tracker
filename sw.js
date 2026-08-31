/* Poker Night service worker — offline app shell.
   Bump CACHE on every deploy that changes any cached file. */
const CACHE = 'poker-v19';
const ASSETS = [
  './',
  './index.html',
  './toolkit.html',
  './manifest.json',
  './src/app.js',
  './src/fx.js',
  './src/ui.js',
  './src/money.js',
  './src/id.js',
  './src/store.js',
  './src/migrate.js',
  './src/report.js',
  './src/install.js',
  './src/state.js',
  './src/settle.js',
  './src/share.js',
  './src/poker.js',
  './src/tools.js',
  './src/charts.js',
  './src/backup.js',
  './src/qr.js',
  './src/sound.js',
  './src/share-image.js',
  './src/config.js',
  './src/entitlements.js',
  './src/upsell.js',
  './src/supabase.js',
  './src/auth.js',
  './src/sync-boot.js',
  './src/sync-ui.js',
  './src/sync/merge.js',
  './src/sync/queue.js',
  './src/sync/engine.js',
  './src/sync/onboard.js',
  './src/sync/backend-supabase.js',
  './src/live/session.js',
  './src/live/realtime.js',
  './src/live/fold.js',
  './src/live-controller.js',
  './src/tournament.js',
  './src/tournament-views.js',
  './src/styles.css',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Stale-while-revalidate for same-origin GET; network passthrough otherwise.
self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(request).then((cached) => {
      const fresh = fetch(request)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || fresh;
    }),
  );
});
