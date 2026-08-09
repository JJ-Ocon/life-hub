import { setTitle, setActions, setBack, navigate } from '../router.js';
import { getNotesSorted, getFolders, checklistProgress, archiveNote, unarchiveNote, deleteNote } from '../db.js';
import { todayKey, formatDateKey, escapeHtml } from '../utils.js';
import { openModal, confirmDialog, toast } from '../ui.js';

let activeFolder = null; // null = alle, '' = ohne Ordner, sonst Ordnername
let viewMode = 'active'; // 'active' | 'archive'

export function render() {
  setTitle('Notizen');
  setBack(null);
  setActions(`
    <button class="icon-btn" id="note-add" aria-label="Neue Notiz">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
    </button>
  `);
  draw();
  document.getElementById('note-add').addEventListener('click', () => navigate('#/note/new'));
}

function draw() {
  const view = document.getElementById('view');
  const allNotes = getNotesSorted(todayKey(), { archived: viewMode === 'archive' });
  const folders = getFolders();
  const today = todayKey();

  const notes = viewMode === 'archive' || activeFolder === null
    ? allNotes
    : activeFolder === ''
      ? allNotes.filter((n) => !n.folder)
      : allNotes.filter((n) => n.folder === activeFolder);

  view.innerHTML = `
    <div class="chip-row" style="margin-bottom:16px">
      <button class="chip ${viewMode === 'active' && activeFolder === null ? 'active' : ''}" data-folder-filter="__all">Alle</button>
      ${folders.length ? `<button class="chip ${viewMode === 'active' && activeFolder === '' ? 'active' : ''}" data-folder-filter="__none">Ohne Ordner</button>` : ''}
      ${viewMode === 'active' ? folders.map((f) => `<button class="chip ${activeFolder === f ? 'active' : ''}" data-folder-filter="${escapeHtml(f)}">${escapeHtml(f)}</button>`).join('') : ''}
      <button class="chip ${viewMode === 'archive' ? 'active' : ''}" data-folder-filter="__archive">📦 Archiv</button>
    </div>
    ${notes.length === 0 ? `
      <div class="empty">
        <h3>${viewMode === 'archive' ? 'Archiv leer' : allNotes.length === 0 ? 'Inbox leer' : 'Keine Notizen hier'}</h3>
        <p class="faint">${viewMode === 'archive' ? 'Archivierte Notizen erscheinen hier.' : allNotes.length === 0 ? 'Alles erfasst, was dir gerade im Kopf rumgeht? Gut so.' : 'In diesem Ordner liegt noch nichts.'}</p>
      </div>
    ` : `
      <div class="notes-grid">
        ${notes.map((n) => {
          const overdue = n.remindAt && n.remindAt <= today;
          const progress = checklistProgress(n);
          const preview = n.type === 'checklist'
            ? (n.items[0]?.text || '')
            : n.text;
          return `
            <div class="card note-card" data-note-id="${n.id}">
              <div class="row" style="gap:10px; align-items:flex-start">
                ${n.photo ? `<img class="note-card__thumb" src="${n.photo}" alt="">` : ''}
                <div class="col grow" style="min-width:0">
                  ${n.title ? `<p class="note-card__title truncate">${escapeHtml(n.title)}</p>` : ''}
                  <p class="note-card__preview">${n.type === 'checklist' ? '☑ ' : ''}${escapeHtml(preview)}</p>
                  <div class="note-card__meta">
                    ${progress ? `<span class="badge">${progress.done}/${progress.total} erledigt</span>` : ''}
                    ${n.folder ? `<span class="badge">📁 ${escapeHtml(n.folder)}</span>` : ''}
                    ${n.remindAt ? `<span class="badge remind-badge${overdue ? ' remind-badge--due' : ''}">🔔 ${formatDateKey(n.remindAt)}</span>` : ''}
                  </div>
                  <p class="note-card__date">${formatDateKey(n.createdAt.slice(0, 10))}</p>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `}
  `;

  view.querySelectorAll('[data-folder-filter]').forEach((el) => {
    el.addEventListener('click', () => {
      const v = el.dataset.folderFilter;
      if (v === '__archive') { viewMode = viewMode === 'archive' ? 'active' : 'archive'; }
      else { viewMode = 'active'; activeFolder = v === '__all' ? null : v === '__none' ? '' : v; }
      draw();
    });
  });
  view.querySelectorAll('[data-note-id]').forEach((el) => {
    wireCard(el, notes.find((n) => n.id === el.dataset.noteId));
  });
}

/** 2-Sekunden-Halten oeffnet Archivieren/Loeschen ohne die Notiz zu oeffnen
 *  (E56) - ein normaler (kurzer) Klick oeffnet wie gewohnt den Editor. */
function wireCard(el, note) {
  let timer = null;
  let longPressed = false;

  const start = () => {
    longPressed = false;
    el.classList.add('note-card--pressing');
    timer = setTimeout(() => {
      longPressed = true;
      el.classList.remove('note-card--pressing');
      openQuickActions(note);
    }, 2000);
  };
  const cancel = () => {
    clearTimeout(timer);
    el.classList.remove('note-card--pressing');
  };

  el.addEventListener('pointerdown', start);
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointerleave', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('click', (e) => {
    if (longPressed) { e.preventDefault(); e.stopPropagation(); return; }
    navigate(`#/note/${note.id}`);
  });
}

function openQuickActions(note) {
  const label = note.title || (note.type === 'checklist' ? note.items[0]?.text : note.text) || 'Notiz';
  const handle = openModal(`
    <h3 class="modal-title">${escapeHtml(label)}</h3>
    <div class="stack">
      <button class="btn btn-ghost" id="qa-archive">${note.archived ? '📤 Wiederherstellen' : '📦 Archivieren'}</button>
      <button class="btn btn-danger" id="qa-delete">Löschen</button>
    </div>
  `, { center: true });

  handle.sheet.querySelector('#qa-archive').addEventListener('click', () => {
    if (note.archived) unarchiveNote(note.id); else archiveNote(note.id);
    toast(note.archived ? 'Wiederhergestellt' : 'Archiviert');
    handle.close();
    draw();
  });
  handle.sheet.querySelector('#qa-delete').addEventListener('click', async () => {
    handle.close();
    const ok = await confirmDialog('Notiz löschen?', 'Wird unwiderruflich gelöscht.');
    if (!ok) return;
    deleteNote(note.id);
    toast('Gelöscht');
    draw();
  });
}
