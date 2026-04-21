// hisaabnow service worker — offline cache + WebAPK eligibility
const CACHE = 'hisaabnow-v25-6';
const URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-192-maskable.png',
  './icon-512-maskable.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(URLS).catch(err => console.warn('[SW] some URLs failed to cache', err)))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = e.request.url;
  // Never cache Firebase / Firestore / Google APIs — always hit the network
  if (url.includes('firestore') || url.includes('googleapis') || url.includes('firebase') || url.includes('gstatic')) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      const net = fetch(e.request)
        .then(r => {
          if (r && r.status === 200) {
            const c = r.clone();
            caches.open(CACHE).then(ch => ch.put(e.request, c));
          }
          return r;
        })
        .catch(() => cached);
      return cached || net;
    })
  );
});
