import { setTitle, setActions, setBack, navigate } from '../router.js';
import { getNoteById, createNote, saveNote, deleteNote, getFolders } from '../db.js';
import { confirmDialog, toast, promptDialog } from '../ui.js';
import { escapeHtml, uid, compressImageFile } from '../utils.js';

let draft = null; // Arbeitskopie waehrend des Bearbeitens
let editingId = null; // null = neue Notiz

export function render(params) {
  editingId = params.id === 'new' ? null : params.id;
  const existing = editingId ? getNoteById(editingId) : null;
  if (editingId && !existing) { navigate('#/'); return; }

  draft = existing
    ? { ...existing, items: (existing.items || []).map((i) => ({ ...i })) }
    : { type: 'text', text: '', items: [], folder: null, photo: null, remindAt: null };

  setTitle(editingId ? 'Notiz bearbeiten' : 'Neue Notiz');
  setBack(() => navigate('#/'));
  setActions(editingId ? `
    <button class="icon-btn" id="note-delete" aria-label="Löschen">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/></svg>
    </button>
  ` : '');

  draw();
}

function draw() {
  const folders = getFolders();
  // Ein gerade erst gewaehlter, noch ungespeicherter neuer Ordner steht noch
  // in keiner Notiz - trotzdem muss sein Chip sofort sichtbar/aktiv sein.
  if (draft.folder && !folders.includes(draft.folder)) folders.push(draft.folder);
  const view = document.getElementById('view');

  view.innerHTML = `
    <div class="chip-row" style="margin-bottom:16px">
      <button type="button" class="chip ${draft.type === 'text' ? 'active' : ''}" data-type="text">📝 Text</button>
      <button type="button" class="chip ${draft.type === 'checklist' ? 'active' : ''}" data-type="checklist">☑ Checkliste</button>
    </div>

    ${draft.type === 'text' ? `
      <div class="field">
        <textarea class="input" id="note-text" rows="8" placeholder="Notiz … (GTD: erst erfassen, später einsortieren)">${escapeHtml(draft.text)}</textarea>
      </div>
    ` : `
      <div class="stack" id="checklist-items" style="margin-bottom:10px">
        ${draft.items.map((it) => `
          <div class="row checklist-row" style="gap:8px" data-item-row="${it.id}">
            <input type="checkbox" class="check-item" data-item-check="${it.id}" ${it.done ? 'checked' : ''}>
            <input class="input grow" data-item-text="${it.id}" value="${escapeHtml(it.text)}" placeholder="Punkt …">
            <button type="button" class="icon-btn" data-item-remove="${it.id}" aria-label="Entfernen">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
            </button>
          </div>
        `).join('')}
      </div>
      <button type="button" class="btn btn-ghost" id="item-add">+ Punkt hinzufügen</button>
    `}

    <div class="section-title">Ordner</div>
    <div class="chip-row" id="folder-row">
      <button type="button" class="chip ${!draft.folder ? 'active' : ''}" data-folder="">Kein Ordner</button>
      ${folders.map((f) => `<button type="button" class="chip ${draft.folder === f ? 'active' : ''}" data-folder="${escapeHtml(f)}">${escapeHtml(f)}</button>`).join('')}
      <button type="button" class="chip" id="folder-new">+ Neu</button>
    </div>

    <div class="section-title">Bild (optional)</div>
    <div class="card">
      ${draft.photo ? `<img src="${draft.photo}" alt="" style="max-width:100%;border-radius:10px;margin-bottom:10px;display:block">` : ''}
      <div class="row" style="gap:10px">
        <label class="btn btn-ghost grow" for="note-photo-input">${draft.photo ? 'Bild ändern' : '📷 Bild hinzufügen'}</label>
        <input type="file" accept="image/*" capture="environment" id="note-photo-input" hidden>
        ${draft.photo ? '<button type="button" class="btn btn-ghost" id="note-photo-remove">Entfernen</button>' : ''}
      </div>
    </div>

    <div class="field" style="margin-top:16px">
      <label>Wiedervorlage (optional) - "erneut zeigen am ..."</label>
      <input class="input" type="date" id="note-remind" value="${draft.remindAt || ''}">
    </div>

    <div class="stack" style="margin-top:18px">
      <button type="button" class="btn btn-primary" id="note-save">Speichern</button>
      <button type="button" class="btn btn-ghost" id="note-todo">→ Als Todo anlegen</button>
    </div>
  `;

  wire();
}

function syncDraftFromDom() {
  const textEl = document.getElementById('note-text');
  if (textEl) draft.text = textEl.value;
  document.querySelectorAll('[data-item-text]').forEach((input) => {
    const item = draft.items.find((i) => i.id === input.dataset.itemText);
    if (item) item.text = input.value;
  });
  document.querySelectorAll('[data-item-check]').forEach((cb) => {
    const item = draft.items.find((i) => i.id === cb.dataset.itemCheck);
    if (item) item.done = cb.checked;
  });
  const remindEl = document.getElementById('note-remind');
  if (remindEl) draft.remindAt = remindEl.value || null;
}

function currentPlainText() {
  if (draft.type === 'checklist') return draft.items.map((i) => i.text).filter(Boolean).join('\n');
  return draft.text;
}

function wire() {
  document.querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => {
    syncDraftFromDom();
    draft.type = b.dataset.type;
    draw();
  }));

  document.getElementById('item-add')?.addEventListener('click', () => {
    syncDraftFromDom();
    draft.items.push({ id: uid(), text: '', done: false });
    draw();
    const inputs = document.querySelectorAll('[data-item-text]');
    inputs[inputs.length - 1]?.focus();
  });

  document.querySelectorAll('[data-item-remove]').forEach((b) => b.addEventListener('click', () => {
    syncDraftFromDom();
    draft.items = draft.items.filter((i) => i.id !== b.dataset.itemRemove);
    draw();
  }));

  document.querySelectorAll('[data-folder]').forEach((b) => b.addEventListener('click', () => {
    syncDraftFromDom();
    draft.folder = b.dataset.folder || null;
    draw();
  }));
  document.getElementById('folder-new')?.addEventListener('click', async () => {
    const name = await promptDialog('Neuer Ordner', { placeholder: 'z.B. Ideen' });
    if (!name) return;
    syncDraftFromDom();
    draft.folder = name;
    draw();
  });

  document.getElementById('note-photo-input')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    syncDraftFromDom();
    draft.photo = await compressImageFile(file);
    draw();
  });
  document.getElementById('note-photo-remove')?.addEventListener('click', () => {
    syncDraftFromDom();
    draft.photo = null;
    draw();
  });

  document.getElementById('note-save').addEventListener('click', () => {
    syncDraftFromDom();
    if (draft.type === 'checklist') draft.items = draft.items.filter((i) => i.text.trim());
    const empty = draft.type === 'text' ? !draft.text.trim() : draft.items.length === 0;
    if (empty) { toast(draft.type === 'text' ? 'Notiz ist leer' : 'Mindestens einen Punkt eintragen'); return; }
    if (editingId) saveNote({ ...draft, id: editingId });
    else createNote(draft);
    toast('Gespeichert');
    navigate('#/');
  });

  document.getElementById('note-todo').addEventListener('click', () => {
    syncDraftFromDom();
    const text = currentPlainText().trim();
    if (!text) { toast('Notiz ist leer'); return; }
    location.href = `../goals/#/?quickAdd=${encodeURIComponent(text)}`;
  });

  document.getElementById('note-delete')?.addEventListener('click', async () => {
    const ok = await confirmDialog('Notiz löschen?', 'Wird unwiderruflich gelöscht.');
    if (!ok) return;
    deleteNote(editingId);
    toast('Gelöscht');
    navigate('#/');
  });
}
