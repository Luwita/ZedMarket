/* Zed Market service worker: makes the app installable and usable on weak or no connection.
 *  - App files (hashed JS/CSS) and product photos: served from cache first, they never change.
 *  - Pages: network first, falling back to the cached app when offline.
 *  - Public catalogue API (products, shops, reviews): network first, cached copy when offline.
 *  - Anything signed in (orders, messages, checkout): never cached.
 * Bump VERSION to clear old caches after changing this file.
 */
const VERSION = 'v2';
const APP_CACHE = `zed-market-app-${VERSION}`;
const DATA_CACHE = `zed-market-data-${VERSION}`;
const DATA_LIMIT = 150; // cached API responses kept for offline browsing
const SHELL = ['/', '/manifest.json', '/icon-192.png', '/favicon-32.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(APP_CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => ![APP_CACHE, DATA_CACHE].includes(k)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

const PUBLIC_API = /^\/api\/(products|shops|stats)(\/|\?|$)/;

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - max)).map((k) => cache.delete(k)));
}

async function networkFirst(request, cacheName, fallbackUrl) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(fallbackUrl ?? request, response.clone());
      if (cacheName === DATA_CACHE) trim(DATA_CACHE, DATA_LIMIT);
    }
    return response;
  } catch (err) {
    const cached = await caches.match(fallbackUrl ?? request);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) (await caches.open(APP_CACHE)).put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.headers.has('authorization')) return; // personal data is never cached

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, APP_CACHE, '/'));
  } else if (url.pathname.startsWith('/static/') || url.pathname.startsWith('/uploads/')) {
    event.respondWith(cacheFirst(request));
  } else if (PUBLIC_API.test(url.pathname + url.search)) {
    event.respondWith(networkFirst(request, DATA_CACHE));
  }
});
