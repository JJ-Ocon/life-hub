// Service Worker: cached nur die App-Shell fuer Offline-Nutzung.
// Heruntergeladene Titel werden bewusst NICHT hier verwaltet, sondern direkt
// von db.js in einer eigenen Cache-Storage-Bucket (music-downloads-v1) abgelegt -
// einfacher als Fetch-Interception, da Subsonic-URLs bei jedem Aufruf einen
// neuen Auth-Token/Salt tragen und sich daher nicht als stabiler Cache-Key eignen.
// Bei einer neuen Version einfach CACHE_VERSION erhoehen.

const CACHE_VERSION = 'music-v2';

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/router.js',
  './js/db.js',
  './js/api.js',
  './js/player.js',
  './js/ui.js',
  './js/utils.js',
  './js/theme.js',
  './js/track-row.js',
  './js/views/connect.js',
  './js/views/home.js',
  './js/views/library.js',
  './js/views/artist.js',
  './js/views/album.js',
  './js/views/playlist.js',
  './js/views/downloads.js',
  './js/views/more.js',
  './icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE_VERSION && k !== 'music-downloads-v1').map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

// Strategie: Netzwerk zuerst (fuer frische Inhalte), Fallback auf Cache bei Offline.
// Nur fuer Anfragen an den eigenen Ursprung - Navidrome-Requests (anderer Origin)
// laufen unveraendert direkt durch.
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
