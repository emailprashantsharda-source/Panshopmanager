/*
 * hisaabnow Service Worker v1.0.0
 * ---------------------------------------------------------------------------
 * Responsibilities:
 *   1. Precache the app shell for offline-capable launch (required for WebAPK
 *      generation by Android Chrome — no SW fetch handler = no installability
 *      = no Play Store TWA).
 *   2. Serve navigation requests network-first, fall back to cached index.html
 *      when offline. This makes the PWA feel app-like on flaky kiryana-shop
 *      Jio connections.
 *   3. Serve static assets (icons, fonts, manifest) cache-first with network
 *      fallback, to keep first paint fast.
 *   4. Auto-invalidate old cache versions on activate (bump CACHE_VERSION on
 *      each release to force clients to refresh).
 *
 * What this SW deliberately does NOT do:
 *   - Cache API calls to Firebase/Firestore. Those have their own offline
 *     persistence via enableIndexedDbPersistence(). Caching them here would
 *     cause stale reads.
 *   - Intercept Cloud Function calls. Same reason.
 *   - Cache Google Fonts woff2 files. Google's own Cache-Control handles that
 *     better than we can.
 *   - Push notifications. Add later if we ship FCM.
 *
 * Scope: "/" — intercepts all requests under app.hisaabnow.com.
 * Must be served at the origin root (/sw.js), not nested in a subfolder.
 * ---------------------------------------------------------------------------
 */

'use strict';

// Bump this on every release to invalidate old caches.
// Pattern: YYYYMMDD-hhmm (or a build hash if you add build tooling).
const CACHE_VERSION = '20260424-v1';
const CACHE_NAME = `hisaabnow-${CACHE_VERSION}`;

// App shell — the minimum set of assets needed to render the app offline.
// Keep this list SHORT. Every entry blocks SW install; a 404 here = install
// fails = SW never activates = PWA not installable.
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-192-maskable.png',
  '/icon-512-maskable.png',
];

// Domains we're happy to cache GET responses from (read-only data).
// NOT included on purpose: Firebase, Cloud Functions, Firestore — their SDKs
// handle offline, and us caching them would cause stale reads + auth bugs.
const CACHEABLE_ORIGINS = [
  self.location.origin,                // own domain
  'https://fonts.gstatic.com',          // Google Fonts woff2 files
  'https://api.qrserver.com',           // UPI QR images (same URL = same QR)
];

// ─── INSTALL ────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        // Use addAll so one 404 fails the whole install loudly.
        // Better than a silent partial cache that breaks offline mode later.
        return cache.addAll(PRECACHE_ASSETS);
      })
      .then(() => self.skipWaiting())   // activate immediately, don't wait for tabs to close
      .catch((err) => {
        console.error('[SW] precache failed:', err);
        // Don't swallow — let install fail loudly so client sees it
        throw err;
      })
  );
});

// ─── ACTIVATE ───────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((k) => k.startsWith('hisaabnow-') && k !== CACHE_NAME)
          .map((k) => {
            console.log('[SW] deleting old cache:', k);
            return caches.delete(k);
          })
      ))
      .then(() => self.clients.claim())   // take control of open tabs immediately
  );
});

// ─── FETCH ──────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only GETs. POST/PUT/DELETE must pass through untouched.
  if (request.method !== 'GET') return;

  // Skip cross-origin requests to domains we don't control (Firebase, etc).
  // Those SDKs handle offline themselves.
  const url = new URL(request.url);
  if (!CACHEABLE_ORIGINS.includes(url.origin)) return;

  // ── Strategy 1: Navigation (HTML documents) — network-first ──────────────
  // User sees fresh app on good network, cached shell when offline.
  if (request.mode === 'navigate' ||
      (request.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache the fresh response for next offline visit
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() =>
          // Network failed — serve cached shell
          caches.match(request)
            .then((cached) => cached || caches.match('/index.html'))
        )
    );
    return;
  }

  // ── Strategy 2: Static assets — cache-first, network fallback ────────────
  // Icons, fonts, images. Fast first paint + updates when user goes online.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        // Serve from cache; revalidate in background (stale-while-revalidate)
        fetch(request)
          .then((response) => {
            if (response.ok) {
              caches.open(CACHE_NAME).then((cache) => cache.put(request, response));
            }
          })
          .catch(() => {/* offline or blocked — fine, we served cached */});
        return cached;
      }

      // Not cached — fetch and cache for next time
      return fetch(request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          // Total fail — no cache, no network. Let browser handle the error
          // (will show a broken image icon for icons, generic error for fonts).
          // We could return a 1x1 pixel fallback but that tends to mask real bugs.
          return new Response('', { status: 504, statusText: 'Offline' });
        });
    })
  );
});

// ─── MESSAGE ────────────────────────────────────────────────────────────────
// Allow the app to force an SW update after deploy:
//   navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' });
// Useful for showing "new version available — reload" toasts in the future.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
