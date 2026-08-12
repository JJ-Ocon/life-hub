// Service Worker: cached die App-Shell fuer Offline-Nutzung.
// Bei einer neuen Version einfach CACHE_VERSION erhoehen.

const CACHE_VERSION = 'goals-v10';

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/router.js',
  './js/db.js',
  './js/ui.js',
  './js/utils.js',
  './js/theme.js',
  './js/views/home.js',
  './js/views/goals.js',
  './js/views/learning.js',
  './js/views/calendar.js',
  './js/views/more.js',
  './icons/icon.svg',
  '../shared/calendar-schema.js',
  '../shared/event-store.js',
  '../shared/notes-bridge.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

// Strategie: Netzwerk zuerst (fuer frische Inhalte), Fallback auf Cache bei Offline.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match('./index.html')))
  );
});
