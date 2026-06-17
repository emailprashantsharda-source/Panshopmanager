/* HisaabNow service worker — network-first HTML shell.
 *
 * ROOT-CAUSE FIX for "new build won't show until I clear cache":
 *   The HTML document (index.html) is served NETWORK-FIRST. When the device
 *   is online, the freshest index.html is always fetched, so a new deploy
 *   loads on the very next open — no manual cache clear, ever. The cached
 *   copy is only used as an OFFLINE fallback.
 *
 * DEPLOY RULE: bump SW_VERSION on every deploy (easiest: set it to the same
 *   value as window.HISAABNOW_BUILD in index.html). Changing this one line
 *   makes the sw.js bytes differ, so the browser detects the update, installs
 *   the new worker, skips waiting, and purges every old cache on activate.
 */

const SW_VERSION = 'v33_44_activate_hard';
const CACHE = 'hisaabnow-' + SW_VERSION;

/* ---- install: precache the shell (best-effort) + take over immediately ---- */
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // Best-effort: don't let one failed asset abort the install.
      return cache.add(new Request('./index.html', { cache: 'reload' })).catch(function () {});
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

/* ---- activate: purge every old cache, claim open clients ---- */
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE; })
            .map(function (k) { return caches.delete(k); })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

/* ---- allow the page to activate a waiting worker on demand ---- */
self.addEventListener('message', function (event) {
  if (event.data === 'SKIP_WAITING' || (event.data && event.data.type === 'SKIP_WAITING')) {
    self.skipWaiting();
  }
});

/* ---- fetch strategy ---- */
self.addEventListener('fetch', function (event) {
  var req = event.request;

  // Only handle GET. Never touch POST (PayU, Firebase writes, etc.).
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }

  // Bypass cross-origin entirely: Firebase, PayU bolt SDK, gstatic, CDNs.
  if (url.origin !== self.location.origin) return;

  // Never intercept the FCM worker or its scope (it manages itself).
  if (url.pathname.indexOf('firebase-messaging-sw') !== -1) return;

  var accept = req.headers.get('accept') || '';
  var isNavigation =
    req.mode === 'navigate' ||
    accept.indexOf('text/html') !== -1 ||
    url.pathname === '/' ||
    url.pathname.endsWith('/') ||
    url.pathname.endsWith('/index.html');

  /* HTML document → NETWORK-FIRST (newest build wins), cache only for offline. */
  if (isNavigation) {
    event.respondWith(
      fetch(req).then(function (res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put('./index.html', copy); }).catch(function () {});
        }
        return res;
      }).catch(function () {
        return caches.match('./index.html').then(function (m) {
          return m || caches.match(req);
        });
      })
    );
    return;
  }

  /* Other same-origin GETs (manifest, icons, etc.) → stale-while-revalidate. */
  event.respondWith(
    caches.match(req).then(function (cached) {
      var network = fetch(req).then(function (res) {
        if (res && res.status === 200 && (res.type === 'basic' || res.type === 'default')) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
        }
        return res;
      }).catch(function () { return cached; });
      return cached || network;
    })
  );
});
