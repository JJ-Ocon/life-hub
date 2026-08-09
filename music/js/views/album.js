import { setTitle, setActions, setBack, navigate } from '../router.js';
import { getAlbum, normalizeSong, coverArtUrl, fetchTrackBlob } from '../api.js';
import { escapeHtml, formatDuration } from '../utils.js';
import { trackRowHtml, wireTrackRows } from '../track-row.js';
import { playQueue } from '../player.js';
import { downloadTrack, isDownloaded, downloadsSupported } from '../db.js';
import { toast } from '../ui.js';

export async function render({ id }) {
  setActions('');
  setBack(() => navigate('#/library'));
  setTitle('Album');

  const view = document.getElementById('view');
  view.innerHTML = `<div class="empty"><span class="spinner"></span></div>`;

  let album;
  try {
    album = await getAlbum(id);
  } catch (err) {
    view.innerHTML = `<div class="empty"><h3>Fehler</h3><p class="faint">${escapeHtml(err.message)}</p></div>`;
    return;
  }

  setTitle(album.name);
  const songs = (album.song || []).map(normalizeSong);
  const cover = coverArtUrl(album.coverArt || id, 400);
  const totalSec = songs.reduce((s, t) => s + (t.durationSec || 0), 0);

  view.innerHTML = `
    <div class="album-header">
      <img class="album-header__cover" src="${cover || ''}" alt="" onerror="this.style.visibility='hidden'">
      <div class="grow col" style="justify-content:center">
        <h2>${escapeHtml(album.name)}</h2>
        <div class="faint">${escapeHtml(album.artist || '')}</div>
        <div class="faint">${songs.length} Titel · ${formatDuration(totalSec)}</div>
      </div>
    </div>
    <div class="grid-2" style="margin-bottom:16px">
      <button class="btn btn-primary" id="album-play-all">▶ Alle abspielen</button>
      <button class="btn btn-ghost" id="album-download-all">⬇ Album herunterladen</button>
    </div>
    <div class="card" id="album-tracks">${songs.map((t, i) => trackRowHtml(t, i, { showNum: true })).join('')}</div>
  `;

  const tracksEl = document.getElementById('album-tracks');
  wireTrackRows(tracksEl, songs);

  document.getElementById('album-play-all').addEventListener('click', () => {
    if (songs.length) playQueue(songs, 0);
  });

  document.getElementById('album-download-all').addEventListener('click', async (e) => {
    if (!downloadsSupported()) {
      toast('Downloads brauchen eine sichere Verbindung (HTTPS) – funktioniert auf der veröffentlichten App');
      return;
    }
    const btn = e.currentTarget;
    const todo = songs.filter((t) => !isDownloaded(t.id));
    if (!todo.length) { toast('Album bereits vollständig heruntergeladen'); return; }
    btn.disabled = true;
    let done = 0;
    for (const track of todo) {
      btn.textContent = `⬇ ${done}/${todo.length}…`;
      try {
        const blob = await fetchTrackBlob(track.id);
        await downloadTrack(track, blob);
        done++;
      } catch {
        toast(`Fehler bei „${track.title}“`);
      }
    }
    btn.disabled = false;
    btn.textContent = '⬇ Album herunterladen';
    tracksEl.innerHTML = songs.map((t, i) => trackRowHtml(t, i, { showNum: true })).join('');
    wireTrackRows(tracksEl, songs);
    toast(`${done} Titel heruntergeladen`);
  });
}
