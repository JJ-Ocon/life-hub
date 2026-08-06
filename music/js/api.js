// Subsonic-API-Client fuer Navidrome. Kein externes SDK - alles roh per fetch(),
// inkl. einer kompakten MD5-Implementierung (fuer den Subsonic-Token: md5(passwort+salt)),
// da die Web-Crypto-API kein MD5 anbietet.

import { getConfig } from './db.js';

const API_VERSION = '1.16.1';
const CLIENT_NAME = 'lifehub-music';

/* ---------- MD5 (public-domain Algorithmus, gegen Testvektoren verifiziert) ---------- */
function md5(str) {
  function rotl(x, c) { return (x << c) | (x >>> (32 - c)); }
  function toBytesUtf8(s) {
    const utf8 = unescape(encodeURIComponent(s));
    const bytes = new Uint8Array(utf8.length);
    for (let i = 0; i < utf8.length; i++) bytes[i] = utf8.charCodeAt(i);
    return bytes;
  }
  const K = new Int32Array([
    -680876936, -389564586, 606105819, -1044525330, -176418897, 1200080426, -1473231341, -45705983,
    1770035416, -1958414417, -42063, -1990404162, 1804603682, -40341101, -1502002290, 1236535329,
    -165796510, -1069501632, 643717713, -373897302, -701558691, 38016083, -660478335, -405537848,
    568446438, -1019803690, -187363961, 1163531501, -1444681467, -51403784, 1735328473, -1926607734,
    -378558, -2022574463, 1839030562, -35309556, -1530992060, 1272893353, -155497632, -1094730640,
    681279174, -358537222, -722521979, 76029189, -640364487, -421815835, 530742520, -995338651,
    -198630844, 1126891415, -1416354905, -57434055, 1700485571, -1894986606, -1051523, -2054922799,
    1873313359, -30611744, -1560198380, 1309151649, -145523070, -1120210379, 718787259, -343485551,
  ]);
  const S = [
    7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,
    5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,
    4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,
    6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21,
  ];
  const msg = toBytesUtf8(str);
  const origLenBits = msg.length * 8;
  const padded = Array.from(msg);
  padded.push(0x80);
  while (padded.length % 64 !== 56) padded.push(0);
  for (let i = 0; i < 8; i++) padded.push((origLenBits / Math.pow(2, 8 * i)) & 0xff);

  let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;

  for (let chunkStart = 0; chunkStart < padded.length; chunkStart += 64) {
    const M = new Int32Array(16);
    for (let j = 0; j < 16; j++) {
      const o = chunkStart + j * 4;
      M[j] = padded[o] | (padded[o + 1] << 8) | (padded[o + 2] << 16) | (padded[o + 3] << 24);
    }
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + M[g]) | 0;
      A = D; D = C; C = B;
      B = (B + rotl(F, S[i])) | 0;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }
  const toHexLE = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  return toHexLE(a0) + toHexLE(b0) + toHexLE(c0) + toHexLE(d0);
}

function randomSalt(len = 10) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = '';
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  for (let i = 0; i < len; i++) s += chars[arr[i] % chars.length];
  return s;
}

function authParams(cfg) {
  const salt = randomSalt();
  const token = md5(cfg.password + salt);
  return { u: cfg.username, t: token, s: salt, v: API_VERSION, c: CLIENT_NAME, f: 'json' };
}

export function buildUrl(endpoint, params = {}, cfgOverride = null) {
  const cfg = cfgOverride || getConfig();
  const base = (cfg.serverUrl || '').replace(/\/+$/, '');
  const qp = new URLSearchParams({ ...authParams(cfg), ...params });
  return `${base}/rest/${endpoint}?${qp.toString()}`;
}

async function call(endpoint, params = {}, cfgOverride = null) {
  const url = buildUrl(endpoint, params, cfgOverride);
  let res;
  try {
    res = await fetch(url);
  } catch {
    throw new Error('Server nicht erreichbar. Tailscale verbunden?');
  }
  if (!res.ok) throw new Error(`Serverfehler (${res.status})`);
  const data = await res.json();
  const body = data['subsonic-response'];
  if (!body || body.status !== 'ok') {
    throw new Error(body?.error?.message || 'Unbekannter Fehler vom Server');
  }
  return body;
}

/** Testet eine (ggf. noch nicht gespeicherte) Verbindung. */
export async function testConnection(cfg) {
  const body = await call('ping.view', {}, cfg);
  return body;
}

export async function getArtists() {
  const body = await call('getArtists.view');
  return body.artists?.index?.flatMap((idx) => idx.artist || []) || [];
}

export async function getArtist(id) {
  const body = await call('getArtist.view', { id });
  return body.artist;
}

export async function getAlbum(id) {
  const body = await call('getAlbum.view', { id });
  return body.album;
}

export async function search3(query) {
  const body = await call('search3.view', { query, artistCount: 20, albumCount: 20, songCount: 40 });
  return {
    artists: body.searchResult3?.artist || [],
    albums: body.searchResult3?.album || [],
    songs: body.searchResult3?.song || [],
  };
}

export async function getStarred2() {
  const body = await call('getStarred2.view');
  return {
    artists: body.starred2?.artist || [],
    albums: body.starred2?.album || [],
    songs: body.starred2?.song || [],
  };
}

export async function star(id) {
  await call('star.view', { id });
}

export async function unstar(id) {
  await call('unstar.view', { id });
}

export function coverArtUrl(id, size = 300) {
  if (!id) return null;
  return buildUrl('getCoverArt.view', { id, size });
}

export function streamUrl(id) {
  return buildUrl('stream.view', { id });
}

export async function fetchTrackBlob(id) {
  const res = await fetch(streamUrl(id));
  if (!res.ok) throw new Error(`Download fehlgeschlagen (${res.status})`);
  return res.blob();
}

/* ---------- Normalisierung: Subsonic-Rohdaten -> internes, schlankes Format ---------- */

export function normalizeSong(s) {
  return {
    id: s.id,
    title: s.title || 'Unbenannt',
    artist: s.artist || '',
    album: s.album || '',
    albumId: s.albumId || null,
    coverArtId: s.coverArt || s.albumId || null,
    durationSec: s.duration || 0,
    trackNum: s.track ?? null,
    starred: !!s.starred,
  };
}

export function normalizeAlbum(a) {
  return {
    id: a.id,
    name: a.name || a.title || 'Unbenannt',
    artist: a.artist || '',
    artistId: a.artistId || null,
    coverArtId: a.coverArt || a.id,
    songCount: a.songCount || 0,
    year: a.year || null,
  };
}

export function normalizeArtist(a) {
  return {
    id: a.id,
    name: a.name || 'Unbenannt',
    albumCount: a.albumCount || 0,
    coverArtId: a.coverArt || null,
  };
}
