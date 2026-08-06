// Gemeinsames Rendering fuer Titel-Zeilen (Album-Detail, Suche, Favoriten).
// Klick auf eine Zeile spielt die gesamte sichtbare Liste als Warteschlange ab,
// beginnend beim angetippten Titel.

import { escapeHtml, formatDuration } from './utils.js';
import { isDownloaded } from './db.js';
import { playQueue } from './player.js';

export function trackRowHtml(track, index, { showNum = true } = {}) {
  const dl = isDownloaded(track.id);
  return `
    <div class="track-row" data-track-idx="${index}">
      ${showNum ? `<div class="track-row__num">${track.trackNum || index + 1}</div>` : ''}
      <div class="grow">
        <div class="track-row__title truncate">${escapeHtml(track.title)}</div>
        <div class="track-row__meta truncate">${escapeHtml(track.artist || '')}</div>
      </div>
      ${dl ? '<span class="faint" title="Offline verfügbar">⬇</span>' : ''}
      ${track.starred ? '<span class="faint" title="Favorit">★</span>' : ''}
      <div class="track-row__dur">${formatDuration(track.durationSec)}</div>
    </div>`;
}

export function wireTrackRows(container, tracks) {
  container.querySelectorAll('[data-track-idx]').forEach((el) => {
    el.addEventListener('click', () => {
      const idx = Number(el.dataset.trackIdx);
      playQueue(tracks, idx);
    });
  });
}
