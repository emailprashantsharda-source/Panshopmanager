/* RentalNow service worker — NETWORK-FIRST for the HTML shell.
 * Same strategy as HisaabNow: the app is redeployed often, so a cached
 * shell must never outlive a new build. Cache is the offline fallback
 * only, after NAV_TIMEOUT.
 */
const SW_VERSION = 'rn_v3_37_1_fastsettle';
const CACHE = 'rentalnow-' + SW_VERSION;
const NAV_TIMEOUT = 4000;
/* './' is what the manifest's start_url resolves to, and what index.html is
 * served as. There is no second filename to cover: rentalnow.html was the old
 * name of this app, it went live under the new name on the same day, so no
 * bookmark to the old one exists and the redirect stub that guarded it has
 * been deleted rather than maintained. */
const SHELL = [
  './',
  './manifest.webmanifest',
  './icon-192.png', './icon-512.png',
  './icon-192-maskable.png', './icon-512-maskable.png',
  './apple-touch-icon.png', './favicon-32.png'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  /* Added one at a time rather than with addAll. addAll is atomic — a single
   * 404 rejects the whole batch and leaves the cache empty, so one missing
   * icon would silently cost the app its entire offline shell. */
  e.waitUntil(
    caches.open(CACHE).then((c) => Promise.all(
      SHELL.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => {}))
    )).catch(() => {})
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function fetchWithTimeout(req, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(req).then((r) => { clearTimeout(t); resolve(r); },
                    (e) => { clearTimeout(t); reject(e); });
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const isDoc = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  if (isDoc) {
    e.respondWith(
      fetchWithTimeout(req, NAV_TIMEOUT).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(req).then((r) => r || caches.match('./')))
    );
    return;
  }

  /* Cache cross-origin assets too.
     The Firebase SDK is five ES modules served from gstatic — roughly half a
     megabyte. The old check only cached res.type === 'basic', which means
     SAME-ORIGIN, so every one of those modules was re-fetched from Google on
     every single load. On a shop's connection that is most of the wait before
     anything appears on screen. They are version-pinned URLs, so caching them
     forever is safe: a new SDK version is a different URL. */
  const cacheable = (res) =>
    res && (res.status === 200 || res.type === 'opaque') &&
    (res.type === 'basic' || res.type === 'cors' || res.type === 'opaque');

  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) {
        /* Serve instantly, refresh quietly in the background. */
        if (/gstatic\.com|googleapis\.com/.test(req.url) === false) {
          fetch(req).then((res) => {
            if (cacheable(res)) caches.open(CACHE).then((c) => c.put(req, res.clone())).catch(() => {});
          }).catch(() => {});
        }
        return hit;
      }
      return fetch(req).then((res) => {
        if (cacheable(res)) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      });
    })
  );
});
