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

const SW_VERSION  = 'v34_auto_20261011_1400';
const CACHE       = 'hisaabnow-' + SW_VERSION;
const NAV_TIMEOUT = 1200; /* ms before falling back to cached HTML (the download keeps going and refreshes the cache for next time) */

/* (Oct 2026) Each new build used to start with an EMPTY cache: activate deleted the old
   cache, so the next open had nothing to fall back on and sat on "page still
   downloading" while the whole 6 MB page came down again. Now the new worker
   (1) copies the last good page across from the old cache straight away, and
   (2) downloads the new page into its own cache while the old worker is still
   serving — so by the time it takes over, the new page is already on the phone. */
function hnCarryOver() {
  return caches.open(CACHE).then(function (mine) {
    return mine.match('./index.html').then(function (have) {
      if (have) return;
      return caches.keys().then(function (keys) {
        var olds = keys.filter(function (k) { return k !== CACHE && k.indexOf('hisaabnow-') === 0; });
        var i = 0;
        function next() {
          if (i >= olds.length) return;
          return caches.open(olds[i++]).then(function (c) { return c.match('./index.html'); })
            .then(function (m) { return m ? mine.put('./index.html', m) : next(); });
        }
        return next();
      });
    });
  }).catch(function () {});
}

function hnPrefetchShell() {
  return new Promise(function (resolve) {
    var t = setTimeout(resolve, 90000); /* never hold the update back forever */
    fetch(new Request('./index.html', { cache: 'no-store' })).then(function (res) {
      if (res && res.status === 200) return caches.open(CACHE).then(function (c) { return c.put('./index.html', res); });
    }).catch(function () {}).then(function () { clearTimeout(t); resolve(); });
  });
}

self.addEventListener('install', function (event) {
  event.waitUntil(hnCarryOver().then(hnPrefetchShell).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    hnCarryOver().then(function () { return caches.keys(); }).then(function (keys) {
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

function hnOfflinePage() {
  var html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>HisaabNow</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#FFFBF5;font-family:system-ui,sans-serif;color:#1c1c1c;text-align:center;padding:24px;box-sizing:border-box}'
    + 'h1{font-size:19px;margin:0 0 8px}p{font-size:14px;color:#666;margin:0 0 18px;line-height:1.5}button{background:#0A0A0A;color:#F5A623;border:0;border-radius:12px;padding:13px 22px;font-size:15px;font-weight:700}</style></head>'
    + '<body><div><h1>No internet right now</h1><p>HisaabNow will open as soon as your connection is back.<br>We will keep trying automatically.</p>'
    + '<button onclick="location.reload()">Try again</button></div>'
    + '<script>addEventListener("online",function(){location.reload()});setTimeout(function(){location.reload()},8000);<\/script></body></html>';
  return new Response(html, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
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
        /* (Oct 2026) BUG FIX: this used to be `m || caches.match(req) || fetch(req)`. caches.match()
           returns a Promise, which is always truthy, so with an empty cache (right after an update)
           and a network slower than NAV_TIMEOUT the page got `undefined` back and the phone showed
           "This site can't be reached · ERR_FAILED". Now: no saved copy -> keep waiting for the real
           download; download truly failed -> a small page that retries by itself. */
        return caches.match('./index.html').then(function (m) {
          if (m) return m;
          return caches.match(req).then(function (m2) {
            if (m2) return m2;
            return _full.then(function (res) { return res; }, function () { return hnOfflinePage(); });
          });
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
      }).catch(function () { return cached || new Response('', { status: 504 }); });
      return cached || net;
    })
  );
});
