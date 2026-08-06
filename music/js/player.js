// Persistente Player-Bar + Wiedergabe-Engine. Lebt ausserhalb des Router-Views
// (eigenes DOM in index.html), damit sie Routenwechsel unbeschadet uebersteht.

import { streamUrl, coverArtUrl, star as apiStar, unstar as apiUnstar, fetchTrackBlob } from './api.js';
import { isDownloaded, getDownloadedTrackUrl, downloadTrack, downloadsSupported } from './db.js';
import { openModal, toast } from './ui.js';
import { formatDuration, escapeHtml } from './utils.js';

const audio = new Audio();
audio.preload = 'metadata';

let queue = [];
let currentIndex = -1;
let nowPlayingOpen = false;
let downloadingIds = new Set();

let bar, barCover, barTitle, barArtist, toggleIcon;

const ICON_PLAY = '<path d="M8 5v14l11-7z"/>';
const ICON_PAUSE = '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>';

export function initPlayer() {
  bar = document.getElementById('player-bar');
  barCover = document.getElementById('player-cover');
  barTitle = document.getElementById('player-title');
  barArtist = document.getElementById('player-artist');
  toggleIcon = document.getElementById('player-toggle-icon');

  document.getElementById('player-toggle').addEventListener('click', (e) => {
    e.stopPropagation();
    togglePlayPause();
  });
  bar.addEventListener('click', () => openNowPlaying());

  audio.addEventListener('play', renderAll);
  audio.addEventListener('pause', renderAll);
  audio.addEventListener('ended', () => { if (currentIndex < queue.length - 1) next(); else renderAll(); });
  audio.addEventListener('timeupdate', renderNowPlayingProgress);
  audio.addEventListener('loadedmetadata', renderNowPlayingProgress);
}

export function currentTrack() {
  return currentIndex >= 0 ? queue[currentIndex] : null;
}

export function isCurrentlyPlaying(id) {
  return currentTrack()?.id === id && !audio.paused;
}

/** Startet Wiedergabe einer Warteschlange ab startIndex. tracks: [{id,title,artist,album,coverArtId,durationSec,starred}] */
export async function playQueue(tracks, startIndex = 0) {
  queue = tracks;
  currentIndex = startIndex;
  await loadAndPlay();
}

async function loadAndPlay() {
  const track = currentTrack();
  if (!track) return;
  let src;
  if (isDownloaded(track.id)) {
    src = await getDownloadedTrackUrl(track.id);
  } else {
    src = streamUrl(track.id);
  }
  audio.src = src;
  try {
    await audio.play();
  } catch {
    toast('Wiedergabe konnte nicht automatisch starten');
  }
  renderAll();
}

export function togglePlayPause() {
  if (!currentTrack()) return;
  if (audio.paused) audio.play().catch(() => {}); else audio.pause();
}

export function next() {
  if (currentIndex < queue.length - 1) { currentIndex++; loadAndPlay(); }
}

export function prev() {
  if (audio.currentTime > 3 || currentIndex === 0) { audio.currentTime = 0; return; }
  if (currentIndex > 0) { currentIndex--; loadAndPlay(); }
}

export function seekTo(sec) {
  audio.currentTime = sec;
}

function renderAll() {
  renderBar();
  renderNowPlayingIfOpen();
}

function renderBar() {
  if (!bar) return;
  const track = currentTrack();
  if (!track) { bar.hidden = true; return; }
  bar.hidden = false;
  const cover = coverArtUrl(track.coverArtId, 80);
  barCover.src = cover || '';
  barTitle.textContent = track.title;
  barArtist.textContent = track.artist || '';
  toggleIcon.innerHTML = audio.paused ? ICON_PLAY : ICON_PAUSE;
}

/* ---------- Now-Playing-Modal ---------- */

export function openNowPlaying() {
  const track = currentTrack();
  if (!track) return;
  nowPlayingOpen = true;
  const cover = coverArtUrl(track.coverArtId, 500);
  const handle = openModal(`
    <img class="now-playing__cover" src="${cover || ''}" alt="" onerror="this.style.visibility='hidden'">
    <div class="now-playing__title truncate">${escapeHtml(track.title)}</div>
    <div class="now-playing__artist truncate">${escapeHtml(track.artist || '')} ${track.album ? '· ' + escapeHtml(track.album) : ''}</div>
    <div class="now-playing__progress">
      <input type="range" class="now-playing__seek" id="np-seek" min="0" max="${track.durationSec || 0}" value="0" step="1">
      <div class="now-playing__times"><span id="np-time-cur">0:00</span><span id="np-time-dur">${formatDuration(track.durationSec)}</span></div>
    </div>
    <div class="now-playing__controls">
      <span class="icon-btn" id="np-prev" aria-label="Vorheriger Titel"><svg viewBox="0 0 24 24"><path d="M19 5v14L8 12z"/><path d="M6 5v14"/></svg></span>
      <span class="icon-btn now-playing__play" id="np-toggle" aria-label="Abspielen/Pause"><svg id="np-toggle-icon" viewBox="0 0 24 24">${ICON_PLAY}</svg></span>
      <span class="icon-btn" id="np-next" aria-label="Naechster Titel"><svg viewBox="0 0 24 24"><path d="M5 5v14l11-7z"/><path d="M18 5v14"/></svg></span>
    </div>
    <div class="now-playing__extra">
      <span class="icon-btn ${track.starred ? 'active' : ''}" id="np-star" aria-label="Favorit"><svg viewBox="0 0 24 24" fill="${track.starred ? 'currentColor' : 'none'}"><path d="M12 3l2.9 6.3 6.9.9-5 4.8 1.3 6.8-6.1-3.4-6.1 3.4 1.3-6.8-5-4.8 6.9-.9z"/></svg></span>
      <span class="icon-btn ${isDownloaded(track.id) ? 'active' : ''}" id="np-download" aria-label="Herunterladen">
        ${downloadingIds.has(track.id) ? '<span class="spinner"></span>' : '<svg viewBox="0 0 24 24"><path d="M12 3v12m0 0l-5-5m5 5l5-5"/><path d="M4 19h16"/></svg>'}
      </span>
    </div>
  `, { center: true, onClose: () => { nowPlayingOpen = false; } });

  handle.sheet.querySelector('#np-toggle').addEventListener('click', togglePlayPause);
  handle.sheet.querySelector('#np-prev').addEventListener('click', prev);
  handle.sheet.querySelector('#np-next').addEventListener('click', next);
  handle.sheet.querySelector('#np-seek').addEventListener('input', (e) => seekTo(Number(e.target.value)));
  handle.sheet.querySelector('#np-star').addEventListener('click', async () => {
    try {
      if (track.starred) { await apiUnstar(track.id); track.starred = false; }
      else { await apiStar(track.id); track.starred = true; }
      openNowPlaying(); handle.close();
    } catch { toast('Favorit konnte nicht geändert werden'); }
  });
  handle.sheet.querySelector('#np-download').addEventListener('click', async () => {
    if (isDownloaded(track.id) || downloadingIds.has(track.id)) return;
    if (!downloadsSupported()) {
      toast('Downloads brauchen eine sichere Verbindung (HTTPS) – funktioniert auf der veröffentlichten App');
      return;
    }
    downloadingIds.add(track.id);
    openNowPlaying(); handle.close();
    try {
      const blob = await fetchTrackBlob(track.id);
      await downloadTrack(track, blob);
      toast('Für offline heruntergeladen');
    } catch {
      toast('Download fehlgeschlagen');
    } finally {
      downloadingIds.delete(track.id);
      if (nowPlayingOpen) renderNowPlayingIfOpen();
    }
  });

  renderNowPlayingProgress();
}

function renderNowPlayingIfOpen() {
  if (!nowPlayingOpen) return;
  const track = currentTrack();
  if (!track) return;
  const icon = document.getElementById('np-toggle-icon');
  if (icon) icon.innerHTML = audio.paused ? ICON_PLAY : ICON_PAUSE;
  const star = document.getElementById('np-star');
  if (star) star.classList.toggle('active', !!track.starred);
  const dl = document.getElementById('np-download');
  if (dl && !downloadingIds.has(track.id)) {
    dl.classList.toggle('active', isDownloaded(track.id));
    dl.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 3v12m0 0l-5-5m5 5l5-5"/><path d="M4 19h16"/></svg>';
  }
}

function renderNowPlayingProgress() {
  if (!nowPlayingOpen) return;
  const seek = document.getElementById('np-seek');
  const cur = document.getElementById('np-time-cur');
  if (seek && !seek.matches(':active')) seek.value = String(Math.floor(audio.currentTime));
  if (cur) cur.textContent = formatDuration(audio.currentTime);
}
