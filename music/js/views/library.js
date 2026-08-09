import { setTitle, setActions, setBack, navigate } from '../router.js';
import {
  getArtists, search3, getStarred2, normalizeArtist, normalizeAlbum, normalizeSong, coverArtUrl,
  getPlaylists, createPlaylist,
} from '../api.js';
import { escapeHtml } from '../utils.js';
import { trackRowHtml, wireTrackRows } from '../track-row.js';
import { toast, promptDialog } from '../ui.js';

let mode = 'artists'; // 'artists' | 'favorites' | 'playlists'
let searchTimer = null;
let lastQuery = '';

export async function render() {
  setTitle('Bibliothek');
  setActions('');
  setBack(null);

  const query = new URLSearchParams(location.hash.split('?')[1] || '');
  const requestedMode = query.get('mode');
  if (requestedMode) {
    history.replaceState(null, '', location.pathname + '#/library');
    mode = requestedMode;
  }

  document.getElementById('view').innerHTML = `
    <div class="search-wrap">
      <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
      <input class="input" id="lib-search" placeholder="Künstler, Alben, Titel suchen…" value="${escapeHtml(lastQuery)}">
    </div>
    <div class="chip-row" style="margin-bottom:16px" id="lib-modes">
      <div class="chip ${mode === 'artists' ? 'active' : ''}" data-mode="artists">Künstler</div>
      <div class="chip ${mode === 'favorites' ? 'active' : ''}" data-mode="favorites">★ Favoriten</div>
      <div class="chip ${mode === 'playlists' ? 'active' : ''}" data-mode="playlists">🎵 Playlists</div>
    </div>
    <div id="lib-content"><div class="empty"><span class="spinner"></span></div></div>
  `;

  const searchInput = document.getElementById('lib-search');
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    searchTimer = setTimeout(() => runSearchOrMode(q), 350);
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { clearTimeout(searchTimer); runSearchOrMode(searchInput.value.trim()); }
  });

  document.querySelectorAll('[data-mode]').forEach((el) => {
    el.addEventListener('click', () => {
      mode = el.dataset.mode;
      render();
    });
  });

  await runSearchOrMode(lastQuery);
  return () => clearTimeout(searchTimer);
}

async function runSearchOrMode(query) {
  lastQuery = query;
  const content = document.getElementById('lib-content');
  if (!content) return;
  content.innerHTML = `<div class="empty"><span class="spinner"></span></div>`;
  try {
    if (query) {
      const results = await search3(query);
      renderSearchResults(content, results);
    } else if (mode === 'favorites') {
      const starred = await getStarred2();
      renderFavorites(content, starred);
    } else if (mode === 'playlists') {
      const playlists = await getPlaylists();
      renderPlaylists(content, playlists);
    } else {
      const artists = await getArtists();
      renderArtists(content, artists);
    }
  } catch (err) {
    content.innerHTML = emptyState('Verbindung fehlgeschlagen', err.message);
  }
}

function emptyState(title, sub) {
  return `<div class="empty"><h3>${escapeHtml(title)}</h3><p class="faint">${escapeHtml(sub || '')}</p></div>`;
}

function renderPlaylists(content, playlists) {
  content.innerHTML = `
    <button class="btn btn-primary" id="playlist-create" style="margin-bottom:14px">+ Neue Playlist</button>
    ${playlists.length === 0 ? emptyState('Noch keine Playlists', 'Lege eine an oder füge Titel aus einer bestehenden Playlist auf dem Server hinzu.') : `
      <div class="card" style="padding:4px 14px">
        ${playlists.map((p) => `
          <a class="artist-list-row" href="#/playlist/${p.id}">
            <div class="artist-list-row__avatar">🎵</div>
            <div class="grow">
              <div class="artist-list-row__name truncate">${escapeHtml(p.name)}</div>
              <div class="artist-list-row__meta">${p.songCount || 0} Titel</div>
            </div>
          </a>
        `).join('')}
      </div>
    `}
  `;
  content.querySelector('#playlist-create').addEventListener('click', async () => {
    const name = await promptDialog('Neue Playlist', { placeholder: 'z.B. Roadtrip' });
    if (!name) return;
    try {
      const playlist = await createPlaylist(name);
      navigate(`#/playlist/${playlist.id}`);
    } catch {
      toast('Playlist konnte nicht angelegt werden');
    }
  });
}

function renderArtists(content, artistsRaw) {
  const list = artistsRaw.map(normalizeArtist);
  if (!list.length) { content.innerHTML = emptyState('Keine Künstler gefunden', 'Sobald Musik im Ordner liegt, taucht sie hier auf.'); return; }
  content.innerHTML = list.map((a) => `
    <a class="artist-list-row" href="#/artist/${a.id}">
      <div class="artist-list-row__avatar">${escapeHtml(a.name.slice(0, 1).toUpperCase())}</div>
      <div class="grow">
        <div class="artist-list-row__name truncate">${escapeHtml(a.name)}</div>
        <div class="artist-list-row__meta">${a.albumCount} Album${a.albumCount === 1 ? '' : 'en'}</div>
      </div>
    </a>
  `).join('');
}

function renderFavorites(content, starred) {
  const songs = (starred.songs || []).map(normalizeSong);
  if (!songs.length) { content.innerHTML = emptyState('Noch keine Favoriten', 'Markiere Titel im Player mit ★.'); return; }
  content.innerHTML = `<div class="card">${songs.map((t, i) => trackRowHtml(t, i)).join('')}</div>`;
  wireTrackRows(content, songs);
}

function renderSearchResults(content, results) {
  const artists = results.artists.map(normalizeArtist);
  const albums = results.albums.map(normalizeAlbum);
  const songs = results.songs.map(normalizeSong);

  if (!artists.length && !albums.length && !songs.length) {
    content.innerHTML = emptyState('Nichts gefunden', 'Versuch es mit einem anderen Suchbegriff.');
    return;
  }

  let html = '';
  if (artists.length) {
    html += `<div class="section-title" style="margin-top:0">Künstler</div><div class="card" style="padding:4px 14px">${artists.map((a) => `
      <a class="artist-list-row" href="#/artist/${a.id}">
        <div class="artist-list-row__avatar">${escapeHtml(a.name.slice(0, 1).toUpperCase())}</div>
        <div class="grow"><div class="artist-list-row__name truncate">${escapeHtml(a.name)}</div></div>
      </a>`).join('')}</div>`;
  }
  if (albums.length) {
    html += `<div class="section-title">Alben</div><div class="album-grid" style="margin-bottom:16px">${albums.map((a) => `
      <a href="#/album/${a.id}">
        <img class="album-tile__cover" src="${coverArtUrl(a.coverArtId, 300) || ''}" alt="" onerror="this.style.visibility='hidden'">
        <div class="album-tile__title truncate">${escapeHtml(a.name)}</div>
        <div class="album-tile__meta truncate">${escapeHtml(a.artist)}</div>
      </a>`).join('')}</div>`;
  }
  if (songs.length) {
    html += `<div class="section-title">Titel</div><div class="card" id="search-songs">${songs.map((t, i) => trackRowHtml(t, i)).join('')}</div>`;
  }
  content.innerHTML = html;
  const songsEl = document.getElementById('search-songs');
  if (songsEl) wireTrackRows(songsEl, songs);
}
