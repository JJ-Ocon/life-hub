// Lokale Musik (E60): Audiodateien aus anderen Quellen als dem eigenen
// Navidrome-Server direkt vom Geraet importieren - unabhaengig vom
// Downloads-Mechanismus, der immer einen bereits auf dem Server vorhandenen
// Titel voraussetzt. Bewusst KEIN echtes ID3-Tag-Parsing (kein Vendoring
// einer Tag-Bibliothek fuer eine Randfunktion) - Titel/Interpret werden aus
// dem Dateinamen geraten ("Interpret - Titel.mp3") und bleiben jederzeit
// per Umbenennen-Dialog korrigierbar.

import { setTitle, setActions, setBack, navigate } from '../router.js';
import {
  getLocalTracks, addLocalTrack, removeLocalTrack, renameLocalTrack, clearAllLocalTracks,
} from '../db.js';
import { escapeHtml, formatDuration, formatBytes } from '../utils.js';
import { confirmDialog, toast, promptDialog } from '../ui.js';
import { playQueue } from '../player.js';

let importing = false;

export function render() {
  setTitle('Lokale Musik');
  setActions(`
    <button class="icon-btn" id="local-add" aria-label="Titel hinzufügen">
      <svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
    </button>
  `);
  setBack(() => { navigate('#/more'); });

  draw();

  document.getElementById('local-add').addEventListener('click', () => {
    document.getElementById('local-file-input')?.click();
  });
}

function draw() {
  const tracks = getLocalTracks().slice().sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  const view = document.getElementById('view');

  view.innerHTML = `
    <input type="file" id="local-file-input" accept="audio/*" multiple hidden>
    <p class="faint" style="margin-bottom:14px">Audiodateien von diesem Gerät hinzufügen (z.B. heruntergeladene Songs aus anderen Quellen) - bleiben ausschließlich lokal auf diesem Gerät, unabhängig vom Navidrome-Server.</p>
    ${importing ? `<div class="empty"><span class="spinner"></span><p class="faint" style="margin-top:8px">Importiere…</p></div>` : ''}
    ${!tracks.length && !importing ? `
      <div class="empty">
        <svg viewBox="0 0 24 24"><path d="M12 3v12m0 0l-5-5m5 5l5-5"/><path d="M4 19h16"/></svg>
        <h3>Noch keine lokale Musik</h3>
        <p class="faint">Über das Plus oben rechts Audiodateien von diesem Gerät auswählen.</p>
      </div>
    ` : ''}
    ${tracks.length ? `
      <div class="card" id="local-list">
        ${tracks.map((t) => `
          <div class="download-row" data-id="${t.id}">
            <div class="grow" data-play="${t.id}">
              <div class="track-row__title truncate">${escapeHtml(t.title)}</div>
              <div class="download-row__meta truncate">${escapeHtml(t.artist || 'Unbekannter Interpret')} · ${formatDuration(t.durationSec)} · ${formatBytes(t.sizeBytes)}</div>
            </div>
            <button class="icon-btn" data-rename="${t.id}" aria-label="Umbenennen">
              <svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
            </button>
            <button class="icon-btn" data-remove="${t.id}" aria-label="Entfernen">
              <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
            </button>
          </div>
        `).join('')}
      </div>
      <button class="btn btn-danger" id="local-clear-all" style="margin-top:16px">Alle lokalen Titel entfernen</button>
    ` : ''}
  `;

  document.getElementById('local-file-input').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    importing = true;
    draw();
    for (const file of files) {
      try {
        const meta = await guessMeta(file);
        await addLocalTrack(meta, file);
      } catch {
        toast(`"${file.name}" konnte nicht importiert werden`);
      }
    }
    importing = false;
    toast(`${files.length} Titel importiert`);
    draw();
  });

  view.querySelectorAll('[data-play]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.dataset.play;
      const t = tracks.find((x) => x.id === id);
      if (!t) return;
      playQueue(tracks.map((x) => ({ id: x.id, title: x.title, artist: x.artist, album: x.album, coverArtId: null, durationSec: x.durationSec })), tracks.indexOf(t));
    });
  });

  view.querySelectorAll('[data-rename]').forEach((el) => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const t = tracks.find((x) => x.id === el.dataset.rename);
      if (!t) return;
      const title = await promptDialog('Titel', { placeholder: 'Titel', value: t.title });
      if (title === null) return;
      const artist = await promptDialog('Interpret (optional)', { placeholder: 'Interpret', value: t.artist });
      renameLocalTrack(t.id, { title: title.trim() || t.title, artist: (artist || '').trim() });
      draw();
    });
  });

  view.querySelectorAll('[data-remove]').forEach((el) => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      await removeLocalTrack(el.dataset.remove);
      toast('Entfernt');
      draw();
    });
  });

  document.getElementById('local-clear-all')?.addEventListener('click', async () => {
    const ok = await confirmDialog('Alle lokalen Titel entfernen?', 'Diese Titel sind nur hier gespeichert (nicht auf dem Server) - sie gehen dabei unwiderruflich verloren.', 'Entfernen', true);
    if (!ok) return;
    await clearAllLocalTracks();
    toast('Alle lokalen Titel entfernt');
    draw();
  });
}

/** Dauer ueber ein temporaeres Audio-Element ermitteln (File API liefert das
 *  nicht direkt); Titel/Interpret aus dem Dateinamen raten. */
function guessMeta(file) {
  return new Promise((resolve) => {
    const base = file.name.replace(/\.[^.]+$/, '');
    const parts = base.split(' - ');
    const meta = parts.length >= 2
      ? { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() }
      : { artist: '', title: base.trim() };

    const url = URL.createObjectURL(file);
    const probe = new Audio();
    const done = () => { URL.revokeObjectURL(url); resolve({ ...meta, durationSec: Math.round(probe.duration) || 0 }); };
    probe.addEventListener('loadedmetadata', done, { once: true });
    probe.addEventListener('error', () => resolve({ ...meta, durationSec: 0 }), { once: true });
    probe.src = url;
  });
}
