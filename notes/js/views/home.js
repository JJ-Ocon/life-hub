import { setTitle, setActions, setBack, navigate } from '../router.js';
import { getNotesSorted, getFolders, checklistProgress } from '../db.js';
import { todayKey, formatDateKey, escapeHtml } from '../utils.js';

let activeFolder = null; // null = alle, '' = ohne Ordner, sonst Ordnername

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
  const allNotes = getNotesSorted();
  const folders = getFolders();
  const today = todayKey();

  const notes = activeFolder === null
    ? allNotes
    : activeFolder === ''
      ? allNotes.filter((n) => !n.folder)
      : allNotes.filter((n) => n.folder === activeFolder);

  view.innerHTML = `
    ${folders.length ? `
      <div class="chip-row" style="margin-bottom:16px">
        <button class="chip ${activeFolder === null ? 'active' : ''}" data-folder-filter="__all">Alle</button>
        <button class="chip ${activeFolder === '' ? 'active' : ''}" data-folder-filter="__none">Ohne Ordner</button>
        ${folders.map((f) => `<button class="chip ${activeFolder === f ? 'active' : ''}" data-folder-filter="${escapeHtml(f)}">${escapeHtml(f)}</button>`).join('')}
      </div>
    ` : ''}
    ${notes.length === 0 ? `
      <div class="empty">
        <h3>${allNotes.length === 0 ? 'Inbox leer' : 'Keine Notizen hier'}</h3>
        <p class="faint">${allNotes.length === 0 ? 'Alles erfasst, was dir gerade im Kopf rumgeht? Gut so.' : 'In diesem Ordner liegt noch nichts.'}</p>
      </div>
    ` : `
      <div class="stack">
        ${notes.map((n) => {
          const overdue = n.remindAt && n.remindAt <= today;
          const progress = checklistProgress(n);
          const preview = n.type === 'checklist'
            ? (n.items[0]?.text || '')
            : n.text;
          return `
            <div class="card note-card" data-open="${n.id}">
              <div class="row" style="gap:10px; align-items:flex-start">
                ${n.photo ? `<img class="note-card__thumb" src="${n.photo}" alt="">` : ''}
                <div class="col grow" style="min-width:0">
                  <p class="note-card__preview">${n.type === 'checklist' ? '☑ ' : ''}${escapeHtml(preview)}</p>
                  <div class="note-card__meta">
                    ${progress ? `<span class="badge">${progress.done}/${progress.total} erledigt</span>` : ''}
                    ${n.folder ? `<span class="badge">📁 ${escapeHtml(n.folder)}</span>` : ''}
                    ${n.remindAt ? `<span class="badge remind-badge${overdue ? ' remind-badge--due' : ''}">🔔 ${formatDateKey(n.remindAt)}</span>` : ''}
                  </div>
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
      activeFolder = v === '__all' ? null : v === '__none' ? '' : v;
      draw();
    });
  });
  view.querySelectorAll('[data-open]').forEach((el) => {
    el.addEventListener('click', () => navigate(`#/note/${el.dataset.open}`));
  });
}
