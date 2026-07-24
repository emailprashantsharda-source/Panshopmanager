/* RentalNow service worker — NETWORK-FIRST for the HTML shell.
 * Same strategy as HisaabNow: the app is redeployed often, so a cached
 * shell must never outlive a new build. Cache is the offline fallback
 * only, after NAV_TIMEOUT.
 */
const SW_VERSION = 'rn_v3_3_1_nav';
const CACHE = 'rentalnow-' + SW_VERSION;
const NAV_TIMEOUT = 4000;
const SHELL = ['./rentalnow.html'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
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
      }).catch(() => caches.match(req).then((r) => r || caches.match('./rentalnow.html')))
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
