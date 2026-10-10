/* HisaabNow service worker — NETWORK-FIRST (with timeout) for the HTML shell.
 *
 * Why network-first: this app is online-dependent and redeployed often. The
 * HTML must always be the freshest build when the network is available, so a
 * new deploy shows up on the next open with no manual cache clear — and a bad
 * cached copy can never trap the app, because every online load goes to the
 * network first and overwrites the cache. The cached copy is used ONLY as an
 * offline / slow-network fallback (after NAV_TIMEOUT), so it is not the
 * "wait for the whole 3.8MB before anything renders" experience.
 *
 * DEPLOY RULE: bump SW_VERSION every deploy (set it to window.HISAABNOW_BUILD).
 *
 * (Aug 2026) Both this file's SW_VERSION and index.html's HISAABNOW_BUILD are
 * now auto-stamped with a timestamp (format v34_auto_YYYYMMDD_HHMM, IST) at
 * the moment a build is generated, instead of a manually-chosen name someone
 * has to remember to change. This guarantees the two files are always in
 * sync AND always differ from whatever was previously deployed, so the
 * service-worker update check (index.html registers with
 * updateViaCache:'none' and polls reg.update() every 30s) always has a real
 * byte difference to detect. If you hand-edit either file outside of that
 * process, re-stamp both with a fresh matching timestamp before shipping —
 * identical SW_VERSION strings across two different deploys is what causes
 * "the build isn't updating" (the browser sees byte-identical sw.js and
 * never installs anything new, no matter how often it's polled).
 */

const SW_VERSION  = 'v34_auto_20261010_2345';
const CACHE       = 'hisaabnow-' + SW_VERSION;
const NAV_TIMEOUT = 1200; /* ms before falling back to cached HTML (the download keeps going and refreshes the cache for next time) */

self.addEventListener('install', function (event) {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
                            .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (event) {
  if (event.data === 'SKIP_WAITING' || (event.data && event.data.type === 'SKIP_WAITING')) {
    self.skipWaiting();
  }
});

function fetchWithTimeout(req, ms) {
  return new Promise(function (resolve, reject) {
    var done = false;
    var timer = setTimeout(function () { if (!done) { done = true; reject(new Error('timeout')); } }, ms);
    /* (Aug 2026 fix) ROOT CAUSE of "the build isn't updating" surviving even
       a full app-storage clear, on BOTH the installed TWA and a plain
       browser tab: fetch(req) here had no explicit cache directive, so this
       "network-first" logic was still subject to ordinary HTTP caching —
       if the host serving these files sets any Cache-Control lifetime
       (which static hosts commonly do by default), this call could be
       silently satisfied from the browser's own HTTP disk cache instead of
       a genuine network round-trip. That's a layer BELOW both the service
       worker's own Cache API (which "activate" already purges old versions
       of) and the app-specific storage a user can clear from Settings —
       clearing either of those does nothing to it, which is exactly why
       neither helped. Reconstructing the request with cache:'no-store'
       forces a real network fetch every time, ignoring any HTTP cache
       entirely, so "network-first" now actually means network-first. */
    var freshReq = new Request(req.url, { cache: 'no-store' });
    fetch(freshReq).then(function (res) {
      if (done) return; done = true; clearTimeout(timer); resolve(res);
    }).catch(function (err) {
      if (done) return; done = true; clearTimeout(timer); reject(err);
    });
  });
}

function hnNavNetworkFirst(event, req) {
    /* (Oct 2026) On a slow network the page used to give up after NAV_TIMEOUT, show
       the cached copy, and THROW AWAY the download it had already started — so the
       cache never caught up and the next open was slow again. Now the same download
       is kept and stored for next time even when we fall back to the cached copy. */
    var _bgDone;
    var _bg = new Promise(function (r) { _bgDone = r; });
    event.waitUntil(_bg);
    var _net = new Request(req.url, { cache: 'no-store' });
    var _full = fetch(_net).then(function (res) {
      if (res && res.status === 200) {
        /* hand the response on immediately (so the page streams in), and store a copy in the background */
        var keep = res.clone();
        caches.open(CACHE).then(function (c) { return c.put('./index.html', keep); }).catch(function () {}).then(function () { _bgDone(); });
      } else { _bgDone(); }
      return res;
    }, function (e) { _bgDone(); throw e; });
    var _timed = new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error('timeout')); }, NAV_TIMEOUT);
      _full.then(function (res) { clearTimeout(t); resolve(res); }, function (e) { clearTimeout(t); reject(e); });
    });
    return (
      _timed.catch(function () {
        /* offline or network stalled past NAV_TIMEOUT -> last good copy */
        return caches.match('./index.html').then(function (m) {
          return m || caches.match(req) || fetch(req);
        });
      })
    );
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;                 /* Firebase, PayU, CDNs pass through */
  if (url.pathname.indexOf('firebase-messaging-sw') !== -1) return; /* FCM worker manages itself */

  var accept = req.headers.get('accept') || '';
  var isNavigation =
    req.mode === 'navigate' ||
    accept.indexOf('text/html') !== -1 ||
    url.pathname === '/' ||
    url.pathname.endsWith('/') ||
    url.pathname.endsWith('/index.html');

  /* HTML document -> NETWORK-FIRST with timeout, cache only as offline fallback. */
  if (isNavigation) {
    /* (Oct 2026) STALE-WHILE-REVALIDATE. The page is ~6 MB; waiting on the network for it on every
       refresh is what kept the tab spinner going. If we already hold a copy, show it immediately and
       refresh the stored copy in the background (conditional request, so usually a tiny 304). A new
       build therefore applies on the next open — same "open twice" rhythm as before, but instant. */
    event.respondWith(caches.match('./index.html').then(function (cached) {
      if (!cached) return null;
      var upd = fetch(new Request(req.url, { cache: 'no-cache' })).then(function (res) {
        if (res && res.status === 200) {
          return caches.open(CACHE).then(function (c) { return c.put('./index.html', res.clone()); });
        }
      }).catch(function () {});
      event.waitUntil(upd);
      return cached;
    }).then(function (hit) { return hit || hnNavNetworkFirst(event, req); }));
    return;
  }

  /* Other same-origin GETs (manifest, icons) -> cache-first, refresh in background. */
  event.respondWith(
    caches.match(req).then(function (cached) {
      var net = fetch(req).then(function (res) {
        if (res && res.status === 200 && (res.type === 'basic' || res.type === 'default')) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
        }
        return res;
      }).catch(function () { return cached; });
      return cached || net;
    })
  );
});
