// Persistenz-Schicht: Verbindungsdaten + Einstellungen in localStorage,
// heruntergeladene Titel als Blobs in der Cache Storage (fuer echten Offline-
// Zugriff auch ohne Service-Worker-Interception) + Metadaten-Register in localStorage.

import { nowIso } from './utils.js';

const KEYS = {
  config: 'mu_config_v1',
  settings: 'mu_settings_v1',
  downloads: 'mu_downloads_v1',
};

const DOWNLOAD_CACHE = 'music-downloads-v1';

/** Cache Storage (und damit echtes Offline-Download) steht nur in sicheren Kontexten
 *  zur Verfuegung (HTTPS oder localhost) - z.B. nicht ueber eine blanke http://<Tailscale-IP>
 *  Dev-Vorschau. Auf GitHub Pages (https) ist das immer erfuellt. */
export function downloadsSupported() {
  return typeof caches !== 'undefined' && window.isSecureContext;
}

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

/* ---------- Server-Verbindung ---------- */
// Passwort liegt hier bewusst in Klartext wie bei jeder anderen Nicht-Safety-App
// im Oekosystem; die Kommunikation laeuft ausschliesslich ueber das per Firewall
// auf Tailscale beschraenkte Heimnetz, nie ueber das offene Internet.
export function getConfig() {
  return read(KEYS.config, { serverUrl: '', username: '', password: '' });
}

export function saveConfig(cfg) {
  write(KEYS.config, { ...getConfig(), ...cfg });
  return getConfig();
}

export function isConnected() {
  const c = getConfig();
  return !!(c.serverUrl && c.username && c.password);
}

export function disconnect() {
  localStorage.removeItem(KEYS.config);
}

/* ---------- Einstellungen ---------- */
const DEFAULT_SETTINGS = { theme: 'dark', accentHue: 213 };

export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...read(KEYS.settings, {}) };
}

export function saveSettings(patch) {
  const merged = { ...getSettings(), ...patch };
  write(KEYS.settings, merged);
  return merged;
}

/* ---------- Downloads: Metadaten-Register ---------- */
// Entry: { id, title, artist, album, coverArtId, durationSec, sizeBytes, downloadedAt }

export function getDownloads() {
  return read(KEYS.downloads, []);
}

export function isDownloaded(id) {
  return getDownloads().some((d) => d.id === id);
}

export function getDownload(id) {
  return getDownloads().find((d) => d.id === id) || null;
}

export function totalDownloadSize() {
  return getDownloads().reduce((sum, d) => sum + (d.sizeBytes || 0), 0);
}

function addDownloadEntry(meta) {
  const list = getDownloads().filter((d) => d.id !== meta.id);
  list.push({ ...meta, downloadedAt: nowIso() });
  write(KEYS.downloads, list);
}

function removeDownloadEntry(id) {
  write(KEYS.downloads, getDownloads().filter((d) => d.id !== id));
}

/* ---------- Downloads: Audio-Blobs in der Cache Storage ---------- */
function blobCacheKey(id) {
  return `./__dl__/${id}`;
}

export async function downloadTrack(track, blob) {
  const cache = await caches.open(DOWNLOAD_CACHE);
  await cache.put(blobCacheKey(track.id), new Response(blob, { headers: { 'Content-Type': blob.type || 'audio/mpeg' } }));
  addDownloadEntry({
    id: track.id, title: track.title, artist: track.artist || '',
    album: track.album || '', coverArtId: track.coverArtId || track.albumId || null,
    durationSec: track.durationSec || 0, sizeBytes: blob.size,
  });
}

export async function removeDownloadedTrack(id) {
  const cache = await caches.open(DOWNLOAD_CACHE);
  await cache.delete(blobCacheKey(id));
  removeDownloadEntry(id);
}

export async function clearAllDownloads() {
  await caches.delete(DOWNLOAD_CACHE);
  write(KEYS.downloads, []);
}

/** Liefert eine abspielbare Object-URL fuer einen heruntergeladenen Titel, oder null. */
export async function getDownloadedTrackUrl(id) {
  const cache = await caches.open(DOWNLOAD_CACHE);
  const res = await cache.match(blobCacheKey(id));
  if (!res) return null;
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

/* ---------- Export / Import / Reset ---------- */
export function exportAllData() {
  return {
    exportedAt: nowIso(),
    settings: getSettings(),
    downloads: getDownloads(),
  };
}

export async function resetAllData() {
  localStorage.removeItem(KEYS.config);
  localStorage.removeItem(KEYS.settings);
  localStorage.removeItem(KEYS.downloads);
  await caches.delete(DOWNLOAD_CACHE);
}
