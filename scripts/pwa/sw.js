/* FrontMapper service worker: works offline once loaded. Generated at build time by scripts/pwa/plugin.ts. */
const VERSION = '__VERSION__';
/** Everything the app needs to start and edit maps, relative to the service worker. */
const PRECACHE = __PRECACHE__;
const SHELL = `fm-shell-${VERSION}`;
const DATA = 'fm-data';
const FLAGS = 'fm-flags';

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('fm-shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const index = new URL('./index.html', self.registration.scope).href;

/** Serve from any cache (precached files included), refresh `cacheName` in the background. */
async function staleWhileRevalidate(cacheName, req) {
  const cache = await caches.open(cacheName);
  const hit = await caches.match(req, { ignoreVary: true });
  const fresh = fetch(req)
    .then((r) => {
      if (r.ok || r.type === 'opaque') cache.put(req, r.clone());
      return r;
    })
    .catch(() => hit);
  return hit ?? fresh;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Pages: the network first so a new deploy shows up, the cached app when offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((r) => {
          if (r.ok) caches.open(SHELL).then((c) => c.put(index, r.clone()));
          return r;
        })
        .catch(() => caches.match(index, { ignoreVary: true })),
    );
    return;
  }

  if (url.origin === self.location.origin) {
    // Border, province and city data: unversioned files, so refresh them while serving the cache.
    if (url.pathname.includes('/data/')) {
      e.respondWith(staleWhileRevalidate(DATA, req));
      return;
    }
    // Built files have content hashes: the cache is always right. (Hosts may send Vary: Origin;
    // module scripts carry an Origin header the precache requests did not.)
    e.respondWith(caches.match(req, { ignoreVary: true }).then((hit) => hit ?? fetch(req)));
    return;
  }

  // OpenFront flags shown in the Nations tab.
  if (url.hostname === 'raw.githubusercontent.com' && url.pathname.includes('/resources/flags/')) {
    e.respondWith(staleWhileRevalidate(FLAGS, req));
  }
  // Satellite imagery and terrain tiles always come from the network.
});
