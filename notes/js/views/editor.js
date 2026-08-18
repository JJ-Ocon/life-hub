import { setTitle, setActions, setBack, navigate } from '../router.js';
import { getNoteById, createNote, saveNote, deleteNote, getFolders, ASSIGNABLE_APPS, archiveNote, unarchiveNote } from '../db.js';
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
    // Aus einem Ordner heraus angelegte Notizen (E61): Ordner-Vorauswahl per
    // Query-Param, einmalig gelesen und die URL danach bereinigt (gleiches
    // "einmal lesen, URL saeubern"-Muster wie Goals' quickAdd-Deep-Link).
    let presetFolder = null;
    if (!editingId) {
      const query = new URLSearchParams(location.hash.split('?')[1] || '');
      presetFolder = query.get('folder');
      if (presetFolder) history.replaceState(null, '', location.pathname + '#/note/new');
    }
    draft = existing
      ? { ...existing, items: (existing.items || []).map((i) => ({ ...i })) }
      : { title: '', type: 'text', text: '', items: [], folder: presetFolder || null, photo: null, remindAt: null, archived: false, assignedApp: null };
    pendingDrafts[draftKey] = draft;
  }

  setTitle(editingId ? 'Notiz bearbeiten' : 'Neue Notiz');
  setBack(() => { commitAutosaveOnClose(); navigate('#/'); });
  setActions(editingId ? `
    <button class="icon-btn" id="note-archive" aria-label="${existing?.archived ? 'Wiederherstellen' : 'Archivieren'}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>
    </button>
    <button class="icon-btn" id="note-delete" aria-label="Löschen">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/></svg>
    </button>
  ` : '');

  draw();

  // Automatische Speicherung statt eines Speicherbuttons (E56): das Verlassen
  // der Seite ueber den Hub-Link ist eine echte Seitennavigation ausserhalb
  // des Routers, deshalb hier ein eigener Klick-Abfang; pagehide sichert
  // zusaetzlich das komplette Schliessen der App/des Tabs ab.
  hubLinkHandler = () => commitAutosaveOnClose();
  document.querySelector('.topbar__hub-link')?.addEventListener('click', hubLinkHandler);
  pagehideHandler = () => commitAutosaveOnClose();
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
    commitAutosaveOnClose();
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
        <textarea class="input editor-textarea" id="note-text" placeholder="Notiz … (GTD: erst erfassen, später einsortieren) &#10;Tipp: '- ' am Zeilenanfang beginnt eine Liste, die sich beim Enter fortsetzt.">${escapeHtml(draft.text)}</textarea>
      </div>
      ${looksLikeList(draft.text) ? `<button type="button" class="btn btn-ghost" id="list-to-checklist" style="margin-top:-6px;margin-bottom:16px">☑ Als Checkliste übernehmen</button>` : ''}
    ` : `
      <div class="stack" id="checklist-items" style="margin-bottom:10px">
        ${draft.items.map((it, i) => `
          <div class="row checklist-row" style="gap:6px" data-item-row="${it.id}">
            <input type="checkbox" class="check-item" data-item-check="${it.id}" ${it.done ? 'checked' : ''}>
            <input class="input grow" data-item-text="${it.id}" value="${escapeHtml(it.text)}" placeholder="Punkt …">
            <div class="checklist-reorder">
              <button type="button" data-item-up="${it.id}" aria-label="Nach oben" ${i === 0 ? 'disabled' : ''}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>
              </button>
              <button type="button" data-item-down="${it.id}" aria-label="Nach unten" ${i === draft.items.length - 1 ? 'disabled' : ''}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
              </button>
            </div>
            <button type="button" class="icon-btn" data-item-todo="${it.id}" aria-label="Als Todo anlegen">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
            </button>
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

    <div class="section-title">Andere App (optional)</div>
    <p class="faint" style="margin:-4px 0 10px">Zugeordnete Notizen erscheinen dort in einem eigenen Bereich, lesbar und mit Titel/Text direkt bearbeitbar - Notizen bleibt trotzdem die eigentliche Ablage.</p>
    <div class="chip-row" id="assign-row">
      <button type="button" class="chip ${!draft.assignedApp ? 'active' : ''}" data-assign="">Keine</button>
      ${ASSIGNABLE_APPS.map((a) => `<button type="button" class="chip ${draft.assignedApp === a.id ? 'active' : ''}" data-assign="${a.id}">${escapeHtml(a.label)}</button>`).join('')}
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
      <button class="icon-btn" id="note-archive" aria-label="Archivieren">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>
      </button>
      <button class="icon-btn" id="note-delete" aria-label="Löschen">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/></svg>
      </button>
    `);
    document.getElementById('note-archive')?.addEventListener('click', onArchiveClick);
    document.getElementById('note-delete')?.addEventListener('click', onDeleteClick);
  }
}

function draftHasContent(d) {
  return d.title.trim() || (d.type === 'text' ? d.text.trim() : d.items.some((i) => i.text.trim()));
}

/** Wird an allen Stellen aufgerufen, an denen der Editor tatsaechlich
 *  verlassen wird (Zurueck, Hub-Link, App schliessen/verstecken, Router-
 *  Wechsel) - im Unterschied zu commitAutosave(), das auch waehrend des
 *  Tippens/Editierens laufend feuert und dort keine Notiz loeschen darf, nur
 *  weil sie GERADE zwischenzeitlich leer ist. Eine beim Verlassen leere
 *  Notiz (Titel und Text/Punkte leer) wird statt als Leiche gespeichert
 *  gleich entfernt. */
function commitAutosaveOnClose() {
  commitAutosave();
  if (editingId && draft && !draftHasContent(draft)) {
    deleteNote(editingId);
    delete pendingDrafts[draftKey];
    editingId = null;
    draft = null;
  }
}

function currentPlainText() {
  if (draft.type === 'checklist') return draft.items.map((i) => i.text).filter(Boolean).join('\n');
  return draft.text;
}

/** Erkennt eine "- "-Liste im Freitext - Grundlage fuer den "Als Checkliste
 *  uebernehmen"-Button. Mindestens eine Zeile mit tatsaechlichem Inhalt nach
 *  dem Listenzeichen reicht, muss keine reine Liste sein. */
function looksLikeList(text) {
  return text.split('\n').some((line) => line.startsWith('- ') && line.slice(2).trim());
}

function parseListLines(text) {
  return text.split('\n').filter((line) => line.startsWith('- ') && line.slice(2).trim());
}

/** Enter am Ende einer "- "-Zeile setzt automatisch "- " auf der naechsten
 *  Zeile fort; Enter auf einer bereits leeren "- "-Zeile beendet die Liste
 *  wieder, statt eine weitere leere Zeile anzuhaengen. */
function wireListToChecklistButton() {
  document.getElementById('list-to-checklist')?.addEventListener('click', async () => {
    syncDraftFromDom();
    const listLines = parseListLines(draft.text);
    const hasExtra = draft.text.split('\n').some((line) => line.trim() && !listLines.includes(line));
    if (hasExtra) {
      const ok = await confirmDialog('In Checkliste umwandeln?', 'Text außerhalb der "- "-Liste geht dabei verloren.', 'Umwandeln', true);
      if (!ok) return;
    }
    draft.type = 'checklist';
    draft.items = listLines.map((line) => ({ id: uid(), text: line.slice(2).trim(), done: false }));
    commitAutosave();
    draw();
  });
}

function handleListAutoContinue(e) {
  if (e.key !== 'Enter') return;
  const ta = e.target;
  const cursor = ta.selectionStart;
  if (cursor !== ta.selectionEnd) return; // Textauswahl statt reinem Cursor - Standardverhalten
  const value = ta.value;
  const lineStart = value.lastIndexOf('\n', cursor - 1) + 1;
  const currentLine = value.slice(lineStart, cursor);
  if (currentLine === '- ') {
    e.preventDefault();
    ta.value = value.slice(0, lineStart) + value.slice(cursor);
    ta.selectionStart = ta.selectionEnd = lineStart;
  } else if (currentLine.startsWith('- ')) {
    e.preventDefault();
    const insertion = '\n- ';
    ta.value = value.slice(0, cursor) + insertion + value.slice(cursor);
    ta.selectionStart = ta.selectionEnd = cursor + insertion.length;
  }
}

function onArchiveClick() {
  const note = getNoteById(editingId);
  if (!note) return;
  if (note.archived) unarchiveNote(editingId); else archiveNote(editingId);
  draft.archived = !note.archived;
  toast(note.archived ? 'Wiederhergestellt' : 'Archiviert');
  navigate('#/');
}

async function onDeleteClick() {
  const ok = await confirmDialog('Notiz löschen?', 'Wird unwiderruflich gelöscht.');
  if (!ok) return;
  deleteNote(editingId);
  delete pendingDrafts[draftKey];
  editingId = null;
  // draft muss vor dem navigate() geleert werden: der Router ruft beim
  // Verlassen der Editor-Ansicht cleanup() -> commitAutosave() auf, das sonst
  // die gerade geloeschte Notiz anhand des noch vorhandenen draft-Inhalts
  // (Titel/Text) sofort wieder neu anlegen wuerde (kein editingId mehr, aber
  // hasContent weiterhin true).
  draft = null;
  toast('Gelöscht');
  navigate('#/');
}

function wire() {
  document.getElementById('note-title').addEventListener('blur', commitAutosave);
  document.getElementById('note-text')?.addEventListener('blur', commitAutosave);
  document.getElementById('note-text')?.addEventListener('focus', adjustTextareaHeight);
  document.getElementById('note-text')?.addEventListener('keydown', handleListAutoContinue);
  // Button-Sichtbarkeit live nach jedem Tastendruck aktualisieren, statt erst
  // beim naechsten vollen draw() (z.B. beim Verlassen des Feldes) - sonst
  // waere der Button erst nach einem Ordner-/Typ-Wechsel sichtbar.
  document.getElementById('note-text')?.addEventListener('input', (e) => {
    const shouldShow = looksLikeList(e.target.value);
    const existing = document.getElementById('list-to-checklist');
    if (shouldShow && !existing) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-ghost';
      btn.id = 'list-to-checklist';
      btn.style.cssText = 'margin-top:-6px;margin-bottom:16px';
      btn.textContent = '☑ Als Checkliste übernehmen';
      e.target.insertAdjacentElement('afterend', btn);
      wireListToChecklistButton();
    } else if (!shouldShow && existing) {
      existing.remove();
    }
  });

  wireListToChecklistButton();

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

  document.querySelectorAll('[data-item-up]').forEach((b) => b.addEventListener('click', () => {
    syncDraftFromDom();
    const i = draft.items.findIndex((it) => it.id === b.dataset.itemUp);
    if (i <= 0) return;
    [draft.items[i - 1], draft.items[i]] = [draft.items[i], draft.items[i - 1]];
    commitAutosave();
    draw();
  }));
  document.querySelectorAll('[data-item-down]').forEach((b) => b.addEventListener('click', () => {
    syncDraftFromDom();
    const i = draft.items.findIndex((it) => it.id === b.dataset.itemDown);
    if (i === -1 || i >= draft.items.length - 1) return;
    [draft.items[i + 1], draft.items[i]] = [draft.items[i], draft.items[i + 1]];
    commitAutosave();
    draw();
  }));
  document.querySelectorAll('[data-item-todo]').forEach((b) => b.addEventListener('click', () => {
    syncDraftFromDom();
    const item = draft.items.find((it) => it.id === b.dataset.itemTodo);
    const text = item?.text.trim();
    if (!text) { toast('Punkt ist leer'); return; }
    commitAutosave();
    location.href = `../goals/#/?quickAdd=${encodeURIComponent(text)}`;
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

  document.querySelectorAll('[data-assign]').forEach((b) => b.addEventListener('click', () => {
    syncDraftFromDom();
    draft.assignedApp = b.dataset.assign || null;
    commitAutosave();
    draw();
  }));

  document.getElementById('note-todo').addEventListener('click', () => {
    syncDraftFromDom();
    // Bei einer Checkliste wird jeder noch offene Punkt ein eigenes Todo
    // (siehe home.js's handleQuickAddParam), statt alles zu einem einzigen
    // Todo-Titel zusammenzuquetschen - einzelne Punkte lassen sich zusaetzlich
    // per data-item-todo-Knopf gezielt einzeln uebertragen.
    if (draft.type === 'checklist') {
      const openItems = draft.items.filter((i) => !i.done && i.text.trim());
      if (!openItems.length) { toast('Keine offenen Punkte'); return; }
      commitAutosave();
      location.href = `../goals/#/?quickAdd=${encodeURIComponent(openItems.map((i) => i.text.trim()).join('\n'))}`;
      return;
    }
    const text = currentPlainText().trim();
    if (!text) { toast('Notiz ist leer'); return; }
    commitAutosave();
    location.href = `../goals/#/?quickAdd=${encodeURIComponent(draft.title ? `${draft.title}: ${text}` : text)}`;
  });

  document.getElementById('note-archive')?.addEventListener('click', onArchiveClick);
  document.getElementById('note-delete')?.addEventListener('click', onDeleteClick);
}
