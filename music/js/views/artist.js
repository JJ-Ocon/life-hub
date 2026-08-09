import { setTitle, setActions, setBack, navigate } from '../router.js';
import { getArtist, normalizeAlbum, coverArtUrl } from '../api.js';
import { escapeHtml } from '../utils.js';

export async function render({ id }) {
  setActions('');
  setBack(() => navigate('#/library'));
  setTitle('Künstler');

  const view = document.getElementById('view');
  view.innerHTML = `<div class="empty"><span class="spinner"></span></div>`;

  let artist;
  try {
    artist = await getArtist(id);
  } catch (err) {
    view.innerHTML = `<div class="empty"><h3>Fehler</h3><p class="faint">${escapeHtml(err.message)}</p></div>`;
    return;
  }

  setTitle(artist.name);
  const albums = (artist.album || []).map(normalizeAlbum);

  if (!albums.length) {
    view.innerHTML = `<div class="empty"><h3>Keine Alben</h3></div>`;
    return;
  }

  view.innerHTML = `
    <div class="section-title" style="margin-top:0">${albums.length} Album${albums.length === 1 ? '' : 'en'}</div>
    <div class="album-grid">
      ${albums.map((a) => `
        <a href="#/album/${a.id}">
          <img class="album-tile__cover" src="${coverArtUrl(a.coverArtId, 300) || ''}" alt="" onerror="this.style.visibility='hidden'">
          <div class="album-tile__title truncate">${escapeHtml(a.name)}</div>
          <div class="album-tile__meta truncate">${a.year || ''}</div>
        </a>
      `).join('')}
    </div>
  `;
}
