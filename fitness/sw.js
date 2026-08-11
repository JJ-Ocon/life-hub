// Service Worker: cached die App-Shell fuer Offline-Nutzung.
// Bei einer neuen Version einfach CACHE_VERSION erhoehen.

const CACHE_VERSION = 'trainingslog-v17';

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
  './js/charts.js',
  './js/health-import.js',
  './js/nutrition.js',
  './js/coach.js',
  './js/achievements.js',
  './js/views/home.js',
  './js/views/routines.js',
  './js/views/routine-edit.js',
  './js/views/exercise-picker.js',
  './js/views/workout-session.js',
  './js/views/history.js',
  './js/views/stats.js',
  './js/views/body.js',
  './js/views/calendar.js',
  './js/views/weekplan.js',
  './js/views/more.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  '../shared/calendar-schema.js',
  '../shared/event-store.js',
  '../shared/body-data.js',
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
