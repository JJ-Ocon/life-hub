import { setTitle, setActions, setBack, navigate } from '../router.js';
import { getNoteById, createNote, saveNote, deleteNote, getFolders } from '../db.js';
import { confirmDialog, toast, promptDialog } from '../ui.js';
import { escapeHtml, uid, compressImageFile } from '../utils.js';

let draft = null; // Arbeitskopie waehrend des Bearbeitens
let editingId = null; // null = noch nicht gespeicherte neue Notiz
let draftKey = null;
let hubLinkHandler = null;
let pagehideHandler = null;
let viewportHandler = null;

// Unfertige Entwuerfe bleiben in-memory erhalten, wenn man innerhalb der App
// zu einer anderen Ansicht wechselt (z.B. Ordner-Chip, Startseite) und zum
// Editor zurueckkommt - die eigentliche Persistierung passiert aber laengst
// automatisch (siehe commitAutosave), dieser In-Memory-Zwischenstand dient nur
// dazu, dass ein noch nicht "committetes" Zeichen im aktiven Feld nicht verloren geht.
const pendingDrafts = {};

export function render(params) {
  editingId = params.id === 'new' ? null : params.id;
  const existing = editingId ? getNoteById(editingId) : null;
  if (editingId && !existing) { navigate('#/'); return; }

  draftKey = editingId || 'new';
  if (pendingDrafts[draftKey]) {
    draft = pendingDrafts[draftKey];
  } else {
    draft = existing
      ? { ...existing, items: (existing.items || []).map((i) => ({ ...i })) }
      : { title: '', type: 'text', text: '', items: [], folder: null, photo: null, remindAt: null, archived: false };
    pendingDrafts[draftKey] = draft;
  }

  setTitle(editingId ? 'Notiz bearbeiten' : 'Neue Notiz');
  setBack(() => { commitAutosave(); navigate('#/'); });
  setActions(editingId ? `
    <button class="icon-btn" id="note-delete" aria-label="Löschen">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/></svg>
    </button>
  ` : '');

  draw();

  // Automatische Speicherung statt eines Speicherbuttons (E56): das Verlassen
  // der Seite ueber den Hub-Link ist eine echte Seitennavigation ausserhalb
  // des Routers, deshalb hier ein eigener Klick-Abfang; pagehide sichert
  // zusaetzlich das komplette Schliessen der App/des Tabs ab.
  hubLinkHandler = () => commitAutosave();
  document.querySelector('.topbar__hub-link')?.addEventListener('click', hubLinkHandler);
  pagehideHandler = () => commitAutosave();
  window.addEventListener('pagehide', pagehideHandler);
  document.addEventListener('visibilitychange', pagehideHandler);

  // Texteingabefenster so hoch wie moeglich, ohne dass die Bildschirmtastatur
  // noch beschreibbare Zeilen verdeckt (E56) - die Visual-Viewport-API meldet
  // die tatsaechlich sichtbare Hoehe nach Tastatur-Ein-/Ausblenden, "resize"
  // feuert zuverlaessiger dafuer als ein einfacher window-resize-Listener.
  viewportHandler = () => adjustTextareaHeight();
  window.visualViewport?.addEventListener('resize', viewportHandler);
  adjustTextareaHeight();

  return function cleanup() {
    commitAutosave();
    document.querySelector('.topbar__hub-link')?.removeEventListener('click', hubLinkHandler);
    window.removeEventListener('pagehide', pagehideHandler);
    document.removeEventListener('visibilitychange', pagehideHandler);
    window.visualViewport?.removeEventListener('resize', viewportHandler);
    document.getElementById('view')?.classList.remove('editor-view');
  };
}

function adjustTextareaHeight() {
  const ta = document.getElementById('note-text');
  if (!ta) return;
  const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  const top = ta.getBoundingClientRect().top;
  const available = vh - top - 20;
  ta.style.height = Math.max(140, available) + 'px';
}

function draw() {
  const folders = getFolders();
  // Ein gerade erst gewaehlter, noch ungespeicherter neuer Ordner steht noch
  // in keiner Notiz - trotzdem muss sein Chip sofort sichtbar/aktiv sein.
  if (draft.folder && !folders.includes(draft.folder)) folders.push(draft.folder);
  const view = document.getElementById('view');
  view.classList.add('editor-view');

  view.innerHTML = `
    <input class="input note-title-input" id="note-title" value="${escapeHtml(draft.title || '')}" placeholder="Überschrift (optional)">

    <div class="chip-row" style="margin:12px 0 16px">
      <button type="button" class="chip ${draft.type === 'text' ? 'active' : ''}" data-type="text">📝 Text</button>
      <button type="button" class="chip ${draft.type === 'checklist' ? 'active' : ''}" data-type="checklist">☑ Checkliste</button>
    </div>

    ${draft.type === 'text' ? `
      <div class="field editor-text-field">
        <textarea class="input editor-textarea" id="note-text" placeholder="Notiz … (GTD: erst erfassen, später einsortieren)">${escapeHtml(draft.text)}</textarea>
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
        <input type="file" accept="image/*" id="note-photo-input" hidden>
        ${draft.photo ? '<button type="button" class="btn btn-ghost" id="note-photo-remove">Entfernen</button>' : ''}
      </div>
    </div>

    <div class="field" style="margin-top:16px">
      <label>Wiedervorlage (optional) - "erneut zeigen am ..."</label>
      <input class="input" type="date" id="note-remind" value="${draft.remindAt || ''}">
    </div>

    ${draft.archived ? `<p class="faint" style="margin-top:14px">📦 Archiviert</p>` : ''}

    <div class="stack" style="margin-top:18px">
      <button type="button" class="btn btn-ghost" id="note-todo">→ Als Todo anlegen</button>
    </div>
  `;

  wire();
  adjustTextareaHeight();
}

function syncDraftFromDom() {
  const titleEl = document.getElementById('note-title');
  if (titleEl) draft.title = titleEl.value;
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

/** Automatische Speicherung (E56) - ersetzt den frueheren Speicherbutton.
 *  Legt eine neue Notiz erst beim ersten Mal mit tatsaechlichem Inhalt an
 *  (kein Muell durch leere Entwuerfe), aktualisiert eine bereits bestehende
 *  Notiz danach bei jedem Aufruf, auch wenn sie zwischenzeitlich geleert wird -
 *  das explizite Loeschen bleibt dem Papierkorb-Icon vorbehalten. */
function commitAutosave() {
  if (!draft) return;
  syncDraftFromDom();
  const hasContent = draft.title.trim() || (draft.type === 'text' ? draft.text.trim() : draft.items.some((i) => i.text.trim()));
  if (!editingId && !hasContent) return;

  if (editingId) {
    saveNote({ ...draft, id: editingId });
  } else {
    const created = createNote(draft);
    editingId = created.id;
    draft.createdAt = created.createdAt;
    delete pendingDrafts['new'];
    draftKey = editingId;
    pendingDrafts[draftKey] = draft;
    setTitle('Notiz bearbeiten');
    setActions(`
      <button class="icon-btn" id="note-delete" aria-label="Löschen">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/></svg>
      </button>
    `);
    document.getElementById('note-delete')?.addEventListener('click', onDeleteClick);
  }
}

function currentPlainText() {
  if (draft.type === 'checklist') return draft.items.map((i) => i.text).filter(Boolean).join('\n');
  return draft.text;
}

async function onDeleteClick() {
  const ok = await confirmDialog('Notiz löschen?', 'Wird unwiderruflich gelöscht.');
  if (!ok) return;
  deleteNote(editingId);
  delete pendingDrafts[draftKey];
  editingId = null;
  toast('Gelöscht');
  navigate('#/');
}

function wire() {
  document.getElementById('note-title').addEventListener('blur', commitAutosave);
  document.getElementById('note-text')?.addEventListener('blur', commitAutosave);
  document.getElementById('note-text')?.addEventListener('focus', adjustTextareaHeight);

  document.querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => {
    syncDraftFromDom();
    draft.type = b.dataset.type;
    commitAutosave();
    draw();
  }));

  document.getElementById('item-add')?.addEventListener('click', () => {
    syncDraftFromDom();
    draft.items.push({ id: uid(), text: '', done: false });
    draw();
    const inputs = document.querySelectorAll('[data-item-text]');
    inputs[inputs.length - 1]?.focus();
  });

  document.querySelectorAll('[data-item-text]').forEach((el) => el.addEventListener('blur', commitAutosave));
  document.querySelectorAll('[data-item-check]').forEach((el) => el.addEventListener('change', () => { commitAutosave(); }));

  document.querySelectorAll('[data-item-remove]').forEach((b) => b.addEventListener('click', () => {
    syncDraftFromDom();
    draft.items = draft.items.filter((i) => i.id !== b.dataset.itemRemove);
    commitAutosave();
    draw();
  }));

  document.querySelectorAll('[data-folder]').forEach((b) => b.addEventListener('click', () => {
    syncDraftFromDom();
    draft.folder = b.dataset.folder || null;
    commitAutosave();
    draw();
  }));
  document.getElementById('folder-new')?.addEventListener('click', async () => {
    const name = await promptDialog('Neuer Ordner', { placeholder: 'z.B. Ideen' });
    if (!name) return;
    syncDraftFromDom();
    draft.folder = name;
    commitAutosave();
    draw();
  });

  document.getElementById('note-photo-input')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    syncDraftFromDom();
    draft.photo = await compressImageFile(file);
    commitAutosave();
    draw();
  });
  document.getElementById('note-photo-remove')?.addEventListener('click', () => {
    syncDraftFromDom();
    draft.photo = null;
    commitAutosave();
    draw();
  });

  document.getElementById('note-remind').addEventListener('change', commitAutosave);

  document.getElementById('note-todo').addEventListener('click', () => {
    syncDraftFromDom();
    const text = currentPlainText().trim();
    if (!text) { toast('Notiz ist leer'); return; }
    commitAutosave();
    location.href = `../goals/#/?quickAdd=${encodeURIComponent(draft.title ? `${draft.title}: ${text}` : text)}`;
  });

  document.getElementById('note-delete')?.addEventListener('click', onDeleteClick);
}
