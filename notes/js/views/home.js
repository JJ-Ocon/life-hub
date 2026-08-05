import { setTitle, setActions, setBack } from '../router.js';
import { getNotesSorted, createNote, saveNote, deleteNote } from '../db.js';
import { openModal, confirmDialog, toast } from '../ui.js';
import { todayKey, formatDateKey, escapeHtml } from '../utils.js';

export function render() {
  setTitle('Notizen');
  setBack(null);
  setActions('');
  draw();
}

function draw() {
  const view = document.getElementById('view');
  const notes = getNotesSorted();
  const today = todayKey();

  view.innerHTML = `
    <div class="quick-add">
      <textarea class="input" id="quick-text" placeholder="Neue Notiz … (GTD: erst erfassen, später einsortieren)" rows="2"></textarea>
      <button class="btn btn-primary" id="quick-add-btn" style="width:auto">+</button>
    </div>
    ${notes.length === 0 ? `
      <div class="empty">
        <h3>Inbox leer</h3>
        <p class="faint">Alles erfasst, was dir gerade im Kopf rumgeht? Gut so.</p>
      </div>
    ` : `
      <div class="stack">
        ${notes.map((n) => {
          const overdue = n.remindAt && n.remindAt <= today;
          return `
            <div class="card note-card" data-open="${n.id}">
              <p class="note-card__text">${escapeHtml(n.text)}</p>
              <div class="note-card__meta">
                ${n.remindAt ? `<span class="badge remind-badge${overdue ? ' remind-badge--due' : ''}">🔔 ${formatDateKey(n.remindAt)}</span>` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `}
  `;

  document.getElementById('quick-add-btn').addEventListener('click', () => {
    const textarea = document.getElementById('quick-text');
    const text = textarea.value.trim();
    if (!text) return;
    createNote(text);
    draw();
  });
  view.querySelectorAll('[data-open]').forEach((el) => {
    el.addEventListener('click', () => openNoteModal(notes.find((n) => n.id === el.dataset.open), draw));
  });
}

function openNoteModal(note, onSaved) {
  const handle = openModal(`
    <h3 class="modal-title">Notiz</h3>
    <div class="field">
      <textarea class="input" id="note-text" rows="4">${escapeHtml(note.text)}</textarea>
    </div>
    <div class="field">
      <label>Wiedervorlage (optional) - "erneut zeigen am ..."</label>
      <input class="input" type="date" id="note-remind" value="${note.remindAt || ''}">
    </div>
    <div class="stack" style="margin-top:6px">
      <button class="btn btn-primary" id="note-save">Speichern</button>
      <button class="btn btn-ghost" id="note-todo">→ Als Todo anlegen</button>
      <button class="btn btn-danger" id="note-delete">Löschen</button>
    </div>
  `, { center: true });

  handle.sheet.querySelector('#note-save').addEventListener('click', () => {
    const text = handle.sheet.querySelector('#note-text').value.trim();
    if (!text) { toast('Notiz ist leer'); return; }
    const remindAt = handle.sheet.querySelector('#note-remind').value || null;
    saveNote({ ...note, text, remindAt });
    toast('Gespeichert');
    handle.close();
    onSaved?.();
  });

  handle.sheet.querySelector('#note-todo').addEventListener('click', () => {
    const text = handle.sheet.querySelector('#note-text').value.trim();
    if (!text) { toast('Notiz ist leer'); return; }
    location.href = `../goals/#/?quickAdd=${encodeURIComponent(text)}`;
  });

  handle.sheet.querySelector('#note-delete').addEventListener('click', async () => {
    const ok = await confirmDialog('Notiz löschen?', 'Wird unwiderruflich gelöscht.');
    if (!ok) return;
    deleteNote(note.id);
    toast('Gelöscht');
    handle.close();
    onSaved?.();
  });
}
