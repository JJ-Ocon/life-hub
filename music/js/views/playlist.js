import { setTitle, setActions, setBack, navigate } from '../router.js';
import {
  getPlaylist, normalizeSong, coverArtUrl, renamePlaylist, deletePlaylist,
  addToPlaylist, removeFromPlaylist, search3,
} from '../api.js';
import { escapeHtml, formatDuration } from '../utils.js';
import { playQueue } from '../player.js';
import { openModal, confirmDialog, promptDialog, toast } from '../ui.js';

let currentId = null;

export async function render({ id }) {
  currentId = id;
  setActions('');
  setBack(() => navigate('#/library?mode=playlists'));
  setTitle('Playlist');
  await draw();
}

async function draw() {
  const view = document.getElementById('view');
  view.innerHTML = `<div class="empty"><span class="spinner"></span></div>`;

  let playlist;
  try {
    playlist = await getPlaylist(currentId);
  } catch (err) {
    view.innerHTML = `<div class="empty"><h3>Fehler</h3><p class="faint">${escapeHtml(err.message)}</p></div>`;
    return;
  }

  setTitle(playlist.name);
  const songs = (playlist.entry || []).map(normalizeSong);
  const cover = songs[0] ? coverArtUrl(songs[0].coverArtId, 400) : null;
  const totalSec = songs.reduce((s, t) => s + (t.durationSec || 0), 0);

  view.innerHTML = `
    <div class="album-header">
      <img class="album-header__cover" src="${cover || ''}" alt="" onerror="this.style.visibility='hidden'">
      <div class="grow col" style="justify-content:center">
        <h2>${escapeHtml(playlist.name)}</h2>
        <div class="faint">${songs.length} Titel · ${formatDuration(totalSec)}</div>
      </div>
    </div>
    <div class="grid-3" style="margin-bottom:16px">
      <button class="btn btn-primary" id="pl-play-all">▶ Alle</button>
      <button class="btn btn-ghost" id="pl-add">+ Titel</button>
      <button class="btn btn-ghost" id="pl-rename">Umbenennen</button>
    </div>
    ${songs.length === 0 ? `
      <div class="empty"><p class="faint">Noch keine Titel in dieser Playlist.</p></div>
    ` : `
      <div class="card" id="pl-tracks">
        ${songs.map((t, i) => `
          <div class="track-row">
            <div class="grow" data-play="${i}" style="cursor:pointer">
              <div class="track-row__title truncate">${escapeHtml(t.title)}</div>
              <div class="track-row__meta truncate">${escapeHtml(t.artist || '')}</div>
            </div>
            <div class="track-row__dur">${formatDuration(t.durationSec)}</div>
            <button class="icon-btn" data-remove="${i}" aria-label="Entfernen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg></button>
          </div>
        `).join('')}
      </div>
    `}
    <button class="btn btn-danger" id="pl-delete" style="margin-top:16px">Playlist löschen</button>
  `;

  document.getElementById('pl-play-all').addEventListener('click', () => {
    if (songs.length) playQueue(songs, 0);
  });
  view.querySelectorAll('[data-play]').forEach((el) => {
    el.addEventListener('click', () => playQueue(songs, Number(el.dataset.play)));
  });
  view.querySelectorAll('[data-remove]').forEach((el) => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await removeFromPlaylist(currentId, Number(el.dataset.remove));
        toast('Entfernt');
        await draw();
      } catch {
        toast('Konnte nicht entfernt werden');
      }
    });
  });
  document.getElementById('pl-add').addEventListener('click', () => openAddTrackModal());
  document.getElementById('pl-rename').addEventListener('click', async () => {
    const name = await promptDialog('Playlist umbenennen', { value: playlist.name });
    if (!name) return;
    try {
      await renamePlaylist(currentId, name);
      await draw();
    } catch {
      toast('Konnte nicht umbenannt werden');
    }
  });
  document.getElementById('pl-delete').addEventListener('click', async () => {
    const ok = await confirmDialog('Playlist löschen?', 'Wird unwiderruflich gelöscht (nur die Playlist, nicht die Titel selbst).');
    if (!ok) return;
    try {
      await deletePlaylist(currentId);
      navigate('#/library?mode=playlists');
    } catch {
      toast('Konnte nicht gelöscht werden');
    }
  });
}

function openAddTrackModal() {
  let searchTimer = null;
  const handle = openModal(`
    <h3 class="modal-title">Titel hinzufügen</h3>
    <div class="search-wrap" style="margin-bottom:12px">
      <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
      <input class="input" id="pl-search-input" placeholder="Titel, Künstler suchen…" autocomplete="off">
    </div>
    <div id="pl-search-results"></div>
  `, { center: true });

  const input = handle.sheet.querySelector('#pl-search-input');
  const results = handle.sheet.querySelector('#pl-search-results');
  input.focus();
  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = input.value.trim();
    if (!q) { results.innerHTML = ''; return; }
    searchTimer = setTimeout(async () => {
      results.innerHTML = `<div class="empty"><span class="spinner"></span></div>`;
      try {
        const found = await search3(q);
        const songs = found.songs.map(normalizeSong);
        if (!songs.length) { results.innerHTML = `<p class="faint">Nichts gefunden.</p>`; return; }
        results.innerHTML = `<div class="card">${songs.map((t) => `
          <div class="track-row">
            <div class="grow">
              <div class="track-row__title truncate">${escapeHtml(t.title)}</div>
              <div class="track-row__meta truncate">${escapeHtml(t.artist || '')}</div>
            </div>
            <button class="icon-btn" data-add="${t.id}" aria-label="Hinzufügen"><svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M5 12h14"/></svg></button>
          </div>
        `).join('')}</div>`;
        results.querySelectorAll('[data-add]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            btn.disabled = true;
            try {
              await addToPlaylist(currentId, btn.dataset.add);
              toast('Hinzugefügt');
              draw();
            } catch {
              toast('Konnte nicht hinzugefügt werden');
              btn.disabled = false;
            }
          });
        });
      } catch {
        results.innerHTML = `<p class="faint">Suche fehlgeschlagen.</p>`;
      }
    }, 350);
  });
}
