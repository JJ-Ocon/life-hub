import { setTitle, setActions, setBack, navigate } from '../router.js';
import { lastPlayed, mostPlayed } from '../db.js';
import { escapeHtml } from '../utils.js';
import { trackRowHtml, wireTrackRows } from '../track-row.js';

export function render() {
  setTitle('Musik');
  setActions('');
  setBack(null);

  const recent = lastPlayed(8);
  const top = mostPlayed(8);

  document.getElementById('view').innerHTML = `
    <div class="grid-2" style="margin-bottom:20px">
      <a class="btn btn-ghost" href="#/library">🔍 Bibliothek &amp; Suche</a>
      <a class="btn btn-ghost" href="#/library?mode=playlists">🎵 Playlists</a>
    </div>
    ${recent.length === 0 && top.length === 0 ? `
      <div class="empty">
        <h3>Noch nichts gespielt</h3>
        <p class="faint">Sobald du Titel abspielst, tauchen hier "Zuletzt gespielt" und "Meistgespielt" auf.</p>
      </div>
    ` : ''}
    ${recent.length ? `
      <div class="section-title" style="margin-top:0">Zuletzt gespielt</div>
      <div class="card" id="home-recent"></div>
    ` : ''}
    ${top.length ? `
      <div class="section-title">Meistgespielt</div>
      <div class="card" id="home-top"></div>
    ` : ''}
  `;

  if (recent.length) {
    const el = document.getElementById('home-recent');
    el.innerHTML = recent.map((t, i) => trackRowHtml(t, i, { showNum: false })).join('');
    wireTrackRows(el, recent);
  }
  if (top.length) {
    const el = document.getElementById('home-top');
    el.innerHTML = top.map((t, i) => `
      <div class="track-row" data-track-idx="${i}">
        <div class="grow">
          <div class="track-row__title truncate">${escapeHtml(t.title)}</div>
          <div class="track-row__meta truncate">${escapeHtml(t.artist || '')}</div>
        </div>
        <span class="faint">${t.count}×</span>
      </div>
    `).join('');
    wireTrackRows(el, top);
  }

  document.querySelectorAll('a.btn').forEach((a) => {
    a.addEventListener('click', (e) => {
      const href = a.getAttribute('href');
      if (href?.startsWith('#/')) { e.preventDefault(); navigate(href); }
    });
  });
}
