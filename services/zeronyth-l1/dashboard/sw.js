// ZERONYTH light node service worker: caches the static app shell only. Never caches /rpc or /api.
const CACHE = 'znyt-shell-v1';
const SHELL = ['node.html', 'assets/styles.css', 'assets/web-node.css', 'assets/light-node.css', 'assets/light-node-ui.mjs', 'assets/light-client.mjs',
  'assets/pq-finality-core.mjs', 'assets/vendor-noble.mjs', 'assets/p2p-ui.mjs', 'assets/web-p2p.mjs', 'assets/web-node-ui.mjs', 'assets/i18n-ui.mjs', 'assets/favicon-64.png', 'assets/znyt-token-168.png'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.endsWith('/rpc') || u.pathname.includes('/api/') || u.pathname.includes('/ai-lab/')) return;
  // network-first, fall back to cache when offline
  e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return r; }).catch(() => caches.match(e.request)));
});
