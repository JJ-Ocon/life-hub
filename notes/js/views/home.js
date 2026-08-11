import { setTitle, setActions, setBack, navigate } from '../router.js';
import {
  getNotesSorted, getFolders, getFolderColor, setFolderColor, getFolderCounts, getUnassignedNotes, notesInFolder,
  checklistProgress, archiveNote, unarchiveNote, deleteNote,
} from '../db.js';
import { todayKey, formatDateKey, escapeHtml } from '../utils.js';
import { openModal, confirmDialog, toast } from '../ui.js';

let viewMode = 'overview'; // 'overview' | 'folder' | 'archive'
let activeFolder = null;

export function render() {
  setTitle('Notizen');
  setBack(null);
  setActions(`
    <button class="icon-btn" id="note-add" aria-label="Neue Notiz">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
    </button>
  `);
  draw();
  document.getElementById('note-add').addEventListener('click', () => {
    // Aus einem Ordner heraus angelegte Notizen landen automatisch in genau
    // diesem Ordner (E61), statt danach manuell im Editor zugewiesen werden
    // zu muessen - der Editor liest den Query-Param einmalig und uebernimmt
    // ihn ins Draft, aendern bleibt dort jederzeit weiter moeglich.
    const target = viewMode === 'folder' && activeFolder
      ? `#/note/new?folder=${encodeURIComponent(activeFolder)}`
      : '#/note/new';
    navigate(target);
  });
}

function draw() {
  const view = document.getElementById('view');
  const today = todayKey();

  if (viewMode === 'overview') {
    const folders = getFolders();
    const counts = getFolderCounts();
    const unassigned = getUnassignedNotes();
    view.innerHTML = `
      ${folders.length ? `
        <div class="section-title" style="margin-top:0">Ordner</div>
        <div class="folder-grid">
          ${folders.map((f) => `
            <button type="button" class="folder-tile" data-open-folder="${escapeHtml(f)}" style="background:${getFolderColor(f)}">
              <span class="folder-tile__count">${counts[f] || 0}</span>
              <span class="folder-tile__name">${escapeHtml(f)}</span>
            </button>
          `).join('')}
        </div>
      ` : ''}
      <div class="row row--between" style="margin-top:${folders.length ? '20px' : '0'};margin-bottom:8px">
        <div class="section-title" style="margin:0">Nicht zugeordnete Notizen</div>
        <button class="chip" id="archive-chip">📦 Archiv</button>
      </div>
      ${notesGridOrEmpty(unassigned, 'Keine nicht zugeordneten Notizen.', 'Alles einsortiert - oder noch nichts erfasst.')}
    `;
    document.getElementById('archive-chip').addEventListener('click', () => { viewMode = 'archive'; draw(); });
    view.querySelectorAll('[data-open-folder]').forEach((el) => {
      el.addEventListener('click', () => { viewMode = 'folder'; activeFolder = el.dataset.openFolder; draw(); });
    });
    wireNoteCards(view, unassigned);
    return;
  }

  if (viewMode === 'folder') {
    const notes = notesInFolder(activeFolder);
    view.innerHTML = `
      <div class="row" style="gap:10px;margin-bottom:16px">
        <button class="icon-btn" id="folder-back" aria-label="Zurück zu Ordnern"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
        <h3 class="row" style="gap:8px">
          <input type="color" class="folder-color-input" id="folder-color-pick" value="${getFolderColor(activeFolder)}" aria-label="Ordnerfarbe wählen">
          ${escapeHtml(activeFolder)}
        </h3>
      </div>
      ${notesGridOrEmpty(notes, 'Keine Notizen in diesem Ordner.', '')}
    `;
    document.getElementById('folder-back').addEventListener('click', () => { viewMode = 'overview'; draw(); });
    document.getElementById('folder-color-pick').addEventListener('input', (e) => {
      setFolderColor(activeFolder, e.target.value);
      draw();
    });
    wireNoteCards(view, notes);
    return;
  }

  // viewMode === 'archive'
  const archived = getNotesSorted(today, { archived: true });
  view.innerHTML = `
    <div class="row" style="gap:10px;margin-bottom:16px">
      <button class="icon-btn" id="archive-back" aria-label="Zurück"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
      <h3>📦 Archiv</h3>
    </div>
    ${notesGridOrEmpty(archived, 'Archiv leer.', 'Archivierte Notizen erscheinen hier.')}
  `;
  document.getElementById('archive-back').addEventListener('click', () => { viewMode = 'overview'; draw(); });
  wireNoteCards(view, archived);
}

function notesGridOrEmpty(notes, emptyTitle, emptySub) {
  if (notes.length === 0) {
    return `<div class="empty"><h3>${emptyTitle}</h3>${emptySub ? `<p class="faint">${emptySub}</p>` : ''}</div>`;
  }
  const today = todayKey();
  return `
    <div class="notes-grid">
      ${notes.map((n) => {
        const overdue = n.remindAt && n.remindAt <= today;
        const progress = checklistProgress(n);
        const preview = n.type === 'checklist' ? (n.items[0]?.text || '') : n.text;
        return `
          <div class="card note-card" data-note-id="${n.id}">
            <div class="row" style="gap:10px; align-items:flex-start">
              ${n.photo ? `<img class="note-card__thumb" src="${n.photo}" alt="">` : ''}
              <div class="col grow" style="min-width:0">
                ${n.title ? `<p class="note-card__title truncate">${escapeHtml(n.title)}</p>` : ''}
                <p class="note-card__preview">${n.type === 'checklist' ? '☑ ' : ''}${escapeHtml(preview)}</p>
                <div class="note-card__meta">
                  ${progress ? `<span class="badge">${progress.done}/${progress.total} erledigt</span>` : ''}
                  ${n.remindAt ? `<span class="badge remind-badge${overdue ? ' remind-badge--due' : ''}">🔔 ${formatDateKey(n.remindAt)}</span>` : ''}
                </div>
                <p class="note-card__date">${formatDateKey(n.createdAt.slice(0, 10))}</p>
              </div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function wireNoteCards(view, notes) {
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
