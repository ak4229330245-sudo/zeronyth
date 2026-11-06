// ZERONYTH Quantum Wallet — service worker.
//
// CACHE NAME DISCIPLINE (deploy rule): the cache name below MUST be
// bumped on every deployment that changes any cached asset, following
// the v1 sequence — v1 ended at "zeronyth-qwallet-912701v6", so v2
// starts at v7. Deployments also bump the gateway's redirect target
// (index.html?v=N) in lockstep, as v1 did. A stale cache name means
// users keep running the previous build (the exact trap that blocked
// v1's in-browser verification), so: bump here, bump ?v= there.
//   next: zeronyth-qwallet-912701v13
const CACHE = 'zeronyth-qwallet-912701v13';

const SHELL = [
  './',
  './index.html',
  './main.mjs',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  // Resilient install: cache each shell asset independently so a single
  // missing/failed asset can never brick the SW update itself (an
  // atomic cache.addAll() failure here is what can strand a phone on a
  // broken older generation forever).
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        Promise.allSettled(SHELL.map((url) => cache.add(url))),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // RPC and any non-GET traffic always go to the network — never cache
  // JSON-RPC responses or signed transactions.
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Navigations and the HTML shell are NETWORK-FIRST: a fresh index
  // (with its boot guard) must always be able to reach the client, even
  // if an older cache is poisoned. Fall back to cache only offline.
  const isShell =
    request.mode === 'navigate' ||
    url.pathname.endsWith('/index.html') ||
    url.pathname.endsWith('/quantum-wallet/');
  if (isShell) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return res;
        })
        .catch(() => caches.match(request)),
    );
    return;
  }
  // Static modules/assets: cache-first with runtime fill.
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return res;
        }),
    ),
  );
});
