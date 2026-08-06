// Service Worker fuer den Hub-Shell (App-Launcher). Bei neuer Version
// CACHE_VERSION erhoehen. Cached bewusst nicht die Unterordner der
// Einzel-Apps (fitness/, ...) - die haben ihren eigenen Service Worker
// mit eigenem Scope.
const CACHE_VERSION = 'life-hub-v2';
const ASSETS = [
  './', './index.html', './calendar.html', './manifest.webmanifest', './styles.css', './calendar.js',
  './shared/calendar-schema.js', './shared/event-store.js', './icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

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
