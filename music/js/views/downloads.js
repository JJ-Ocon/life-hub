import { setTitle, setActions, setBack } from '../router.js';
import { getDownloads, removeDownloadedTrack, clearAllDownloads, totalDownloadSize } from '../db.js';
import { coverArtUrl } from '../api.js';
import { escapeHtml, formatDuration, formatBytes } from '../utils.js';
import { confirmDialog, toast } from '../ui.js';
import { playQueue } from '../player.js';

export function render() {
  setTitle('Downloads');
  setActions('');
  setBack(null);

  draw();
}

function draw() {
  const downloads = getDownloads().slice().sort((a, b) => b.downloadedAt.localeCompare(a.downloadedAt));
  const view = document.getElementById('view');

  if (!downloads.length) {
    view.innerHTML = `
      <div class="empty">
        <svg viewBox="0 0 24 24"><path d="M12 3v12m0 0l-5-5m5 5l5-5"/><path d="M4 19h16"/></svg>
        <h3>Noch nichts heruntergeladen</h3>
        <p class="faint">Lade Titel im Player oder auf einer Album-Seite herunter, um sie offline zu hören.</p>
      </div>
    `;
    return;
  }

  view.innerHTML = `
    <div class="stat-tile" style="margin-bottom:16px">
      <div class="stat-tile__value">${formatBytes(totalDownloadSize())}</div>
      <div class="stat-tile__label">${downloads.length} Titel offline verfügbar</div>
    </div>
    <div class="card" id="dl-list">
      ${downloads.map((d) => `
        <div class="download-row" data-id="${d.id}">
          <img class="album-header__cover" style="width:44px;height:44px;border-radius:8px" src="${coverArtUrl(d.coverArtId, 88) || ''}" alt="" onerror="this.style.visibility='hidden'">
          <div class="grow" data-play="${d.id}">
            <div class="track-row__title truncate">${escapeHtml(d.title)}</div>
            <div class="download-row__meta truncate">${escapeHtml(d.artist)} · ${formatDuration(d.durationSec)} · ${formatBytes(d.sizeBytes)}</div>
          </div>
          <button class="icon-btn" data-remove="${d.id}" aria-label="Download entfernen">
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>
      `).join('')}
    </div>
    <button class="btn btn-danger" id="dl-clear-all" style="margin-top:16px">Alle Downloads entfernen</button>
  `;

  view.querySelectorAll('[data-play]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.dataset.play;
      const d = downloads.find((x) => x.id === id);
      if (!d) return;
      playQueue(downloads.map((x) => ({ id: x.id, title: x.title, artist: x.artist, album: x.album, coverArtId: x.coverArtId, durationSec: x.durationSec })), downloads.indexOf(d));
    });
  });

  view.querySelectorAll('[data-remove]').forEach((el) => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      await removeDownloadedTrack(el.dataset.remove);
      toast('Download entfernt');
      draw();
    });
  });

  document.getElementById('dl-clear-all').addEventListener('click', async () => {
    const ok = await confirmDialog('Alle Downloads entfernen?', 'Die Titel bleiben auf dem Server, werden aber lokal nicht mehr offline verfügbar sein.', 'Entfernen', true);
    if (!ok) return;
    await clearAllDownloads();
    toast('Alle Downloads entfernt');
    draw();
  });
}
