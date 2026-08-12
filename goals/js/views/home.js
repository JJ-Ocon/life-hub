import { setTitle, setActions, setBack } from '../router.js';
import {
  getTodosSorted, getTodoById, createTodo, saveTodo, deleteTodo, toggleTodo, getGoals,
  REPEAT_FREQUENCIES, repeatLabel,
} from '../db.js';
import { openModal, confirmDialog, toast } from '../ui.js';
import { todayKey, formatDateKey, escapeHtml } from '../utils.js';
import { findConflictingEvents } from '../../../shared/event-store.js';
import { getSourceLabel } from '../../../shared/calendar-schema.js';
import { getNotesForApp, updateAssignedNoteContent, unassignNote } from '../../../shared/notes-bridge.js';

export function render() {
  setTitle('Todos');
  setBack(null);
  setActions('');
  draw();
  handleQuickAddParam();
}

/** Ein quickAdd-Deep-Link kann mehrere zeilengetrennte Titel tragen (z.B.
 *  aus Notizen' Checklisten-Uebertragung, siehe shared/notes-bridge-nahe
 *  Pattern in notes/js/views/editor.js) - bei genau einem Titel oeffnet sich
 *  wie bisher das Modal zum Nachbearbeiten, bei mehreren werden alle direkt
 *  angelegt (ein Bestaetigungsdialog pro Todo waere bei einer ganzen
 *  Checkliste nur laestig). */
function handleQuickAddParam() {
  const query = new URLSearchParams(location.hash.split('?')[1] || '');
  const text = query.get('quickAdd');
  if (!text) return;
  history.replaceState(null, '', location.pathname + '#/');
  const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
  if (lines.length > 1) {
    lines.forEach((title) => createTodo({ title, dueDate: null, goalId: null }));
    toast(`${lines.length} Todos angelegt`);
    draw();
  } else {
    openTodoModal({ id: null, title: lines[0] || text, dueDate: null, goalId: null }, draw);
  }
}

// Welche Abschnitte aufgeklappt sind (E68+-Nachtrag: die Startseite war eine
// einzige endlos scrollende Liste, inkl. fuer immer angesammelter erledigter
// Todos). "Ohne Termin" und "Erledigt" sind die eigentlichen Ansammlungs-
// treiber und starten deshalb eingeklappt; ueberfaellig/heute/demnaechst
// bleiben immer offen, da die gerade relevanten Todos nicht extra
// aufgeklappt werden sollen. Zurueckgesetzt bei jedem Laden der View.
let expandedSections = new Set();

function todoRowHtml(t, today) {
  const overdue = t.dueDate && t.dueDate < today && !t.done;
  const timeLabel = t.startTime ? `${t.startTime}${t.endTime ? '–' + t.endTime : ''} · ` : '';
  return `
    <div class="todo-row ${t.done ? 'done' : ''}">
      <span class="set-check ${t.done ? 'done' : ''}" data-toggle="${t.id}">
        <svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>
      </span>
      <span class="todo-row__title" data-open="${t.id}">${escapeHtml(t.title)}</span>
      ${t.dueDate ? `<span class="todo-row__due ${overdue ? 'todo-row__due--overdue' : ''}">${t.repeat ? `🔁 ${repeatLabel(t.repeat)} · ` : ''}${timeLabel}${formatDateKey(t.dueDate)}</span>` : ''}
    </div>
  `;
}

function sectionHtml(key, label, todos, today, collapsedByDefault) {
  if (!todos.length) return '';
  const expanded = expandedSections.has(key) || !collapsedByDefault;
  return `
    <div class="section-title row row--between" data-section-toggle="${key}" style="cursor:pointer">
      <span>${label} (${todos.length})</span>
      <span class="faint">${expanded ? '▾' : '▸'}</span>
    </div>
    ${expanded ? `<div class="card">${todos.map((t) => todoRowHtml(t, today)).join('')}</div>` : ''}
  `;
}

function draw() {
  const view = document.getElementById('view');
  const todos = getTodosSorted();
  const today = todayKey();
  const assignedNotes = getNotesForApp('goals');

  const open = todos.filter((t) => !t.done);
  const done = todos.filter((t) => t.done);
  const overdue = open.filter((t) => t.dueDate && t.dueDate < today);
  const dueToday = open.filter((t) => t.dueDate === today);
  const upcoming = open.filter((t) => t.dueDate && t.dueDate > today);
  const noDate = open.filter((t) => !t.dueDate);

  view.innerHTML = `
    <div class="quick-add">
      <input class="input" id="quick-title" placeholder="Neues Todo …">
      <button class="btn btn-primary" id="quick-add-btn" style="width:auto">+</button>
    </div>
    ${assignedNotes.length ? `
      <div class="section-title" style="margin-top:0">📝 Aus Notizen zugeordnet</div>
      <div class="card stack" style="margin-bottom:16px">
        ${assignedNotes.map((n) => `
          <div class="row row--between" data-note-open="${n.id}" style="cursor:pointer">
            <div class="col grow" style="min-width:0">
              ${n.title ? `<span class="truncate" style="font-weight:700">${escapeHtml(n.title)}</span>` : ''}
              <span class="faint truncate">${escapeHtml(n.type === 'checklist' ? (n.items[0]?.text || '') : n.text)}</span>
            </div>
          </div>
        `).join('')}
      </div>
    ` : ''}
    ${todos.length === 0 ? `
      <div class="empty">
        <h3>Keine Todos</h3>
        <p class="faint">Alles erledigt, oder noch nichts erfasst.</p>
      </div>
    ` : `
      ${sectionHtml('overdue', '⚠️ Überfällig', overdue, today, false)}
      ${sectionHtml('today', 'Heute', dueToday, today, false)}
      ${sectionHtml('upcoming', 'Demnächst', upcoming, today, false)}
      ${sectionHtml('nodate', 'Ohne Termin', noDate, today, true)}
      ${sectionHtml('done', 'Erledigt', done, today, true)}
    `}
  `;

  document.getElementById('quick-add-btn').addEventListener('click', () => {
    const input = document.getElementById('quick-title');
    const title = input.value.trim();
    if (!title) return;
    createTodo({ title });
    draw();
  });
  view.querySelectorAll('[data-section-toggle]').forEach((el) => {
    el.addEventListener('click', () => {
      const key = el.dataset.sectionToggle;
      if (expandedSections.has(key)) expandedSections.delete(key); else expandedSections.add(key);
      draw();
    });
  });
  view.querySelectorAll('[data-toggle]').forEach((el) => {
    el.addEventListener('click', () => { toggleTodo(el.dataset.toggle); draw(); });
  });
  view.querySelectorAll('[data-open]').forEach((el) => {
    el.addEventListener('click', () => openTodoModal(getTodoById(el.dataset.open), draw));
  });
  view.querySelectorAll('[data-note-open]').forEach((el) => {
    const note = assignedNotes.find((n) => n.id === el.dataset.noteOpen);
    el.addEventListener('click', () => openAssignedNoteModal(note));
  });
}

/** Zeigt/bearbeitet eine aus Notizen zugeordnete Notiz direkt hier vor Ort
 *  (E57) - nur Titel/Text bzw. Checklisten-Haken sind editierbar, Ordner/
 *  Foto/Wiedervorlage bleiben Notizen vorbehalten (shared/notes-bridge.js
 *  erlaubt bewusst nur diese Felder von aussen zu aendern). Eine
 *  Checklisten-Notiz zeigt ihre Punkte nur mit Haken zum Abhaken, kein
 *  vollstaendiger Checklisten-Editor - fuer alles andere verlinkt "In
 *  Notizen öffnen" in die eigentliche App. */
function openAssignedNoteModal(note) {
  const isChecklist = note.type === 'checklist';
  const handle = openModal(`
    <h3 class="modal-title">Aus Notizen</h3>
    <div class="field">
      <label>Titel</label>
      <input class="input" id="an-title" value="${escapeHtml(note.title || '')}">
    </div>
    ${isChecklist ? `
      <div class="stack" style="margin-bottom:14px">
        ${(note.items || []).map((it) => `
          <label class="row checklist-row" style="gap:8px">
            <input type="checkbox" class="check-item" data-an-item="${it.id}" ${it.done ? 'checked' : ''}>
            <span class="grow ${it.done ? 'faint' : ''}">${escapeHtml(it.text)}</span>
          </label>
        `).join('')}
      </div>
    ` : `
      <div class="field">
        <label>Text</label>
        <textarea class="input" id="an-text" rows="6">${escapeHtml(note.text || '')}</textarea>
      </div>
    `}
    <div class="stack">
      <button class="btn btn-primary" id="an-save">Speichern</button>
      <a class="btn btn-ghost" href="../notes/#/note/${note.id}">In Notizen öffnen</a>
      <button class="btn btn-ghost" id="an-unassign">Zuordnung aufheben</button>
    </div>
  `, { center: true });

  handle.sheet.querySelectorAll('[data-an-item]').forEach((cb) => {
    cb.addEventListener('change', () => {
      updateAssignedNoteContent(note.id, 'goals', { itemId: cb.dataset.anItem, itemDone: cb.checked });
    });
  });
  handle.sheet.querySelector('#an-save').addEventListener('click', () => {
    const title = handle.sheet.querySelector('#an-title').value.trim();
    const patch = { title };
    const textEl = handle.sheet.querySelector('#an-text');
    if (textEl) patch.text = textEl.value;
    updateAssignedNoteContent(note.id, 'goals', patch);
    toast('Gespeichert');
    handle.close();
    draw();
  });
  handle.sheet.querySelector('#an-unassign').addEventListener('click', async () => {
    const ok = await confirmDialog('Zuordnung aufheben?', 'Die Notiz bleibt in Notizen bestehen, verschwindet aber aus dieser Liste hier.', 'Aufheben', false);
    if (!ok) return;
    unassignNote(note.id, 'goals');
    toast('Zuordnung aufgehoben');
    handle.close();
    draw();
  });
}

export function openTodoModal(todo, onSaved) {
  const goals = getGoals();
  const isNew = !todo.id;
  let repeat = todo.repeat || null;

  const handle = openModal(`
    <h3 class="modal-title">${isNew ? 'Todo anlegen' : 'Todo bearbeiten'}</h3>
    <div class="field">
      <label>Titel</label>
      <input class="input" id="todo-title" value="${escapeHtml(todo.title)}">
    </div>
    <div class="field">
      <label>Fällig am (optional)</label>
      <input class="input" type="date" id="todo-due" value="${todo.dueDate || ''}">
    </div>
    <div class="field" id="time-wrap" style="${todo.dueDate ? '' : 'display:none'}">
      <label>Uhrzeit (optional)</label>
      <div class="input-row">
        <input class="input" type="time" id="todo-start-time" value="${todo.startTime || ''}">
        <input class="input" type="time" id="todo-end-time" value="${todo.endTime || ''}">
      </div>
      <p class="faint" style="margin:2px 0 0">Ohne Uhrzeit gilt das Todo als flexibel und wird nie als Terminkonflikt markiert.</p>
    </div>
    <div class="field" id="repeat-wrap" style="${todo.dueDate ? '' : 'display:none'}">
      <label>Wiederholung (optional)</label>
      <div class="chip-row">
        <button type="button" class="chip ${!repeat ? 'active' : ''}" data-repeat="">Keine</button>
        ${REPEAT_FREQUENCIES.map((f) => `<button type="button" class="chip ${repeat?.freq === f.key ? 'active' : ''}" data-repeat="${f.key}">${f.label}</button>`).join('')}
      </div>
      <div class="row" style="gap:8px;align-items:center;margin-top:10px" id="repeat-custom-wrap" ${repeat?.freq === 'custom' ? '' : 'hidden'}>
        <span class="faint">Alle</span>
        <input class="input" type="number" min="1" step="1" id="repeat-days" value="${repeat?.intervalDays || 2}" style="width:70px">
        <span class="faint">Tage</span>
      </div>
    </div>
    ${goals.length ? `
      <div class="field">
        <label>Ziel (optional)</label>
        <select class="input" id="todo-goal">
          <option value="">Kein Ziel</option>
          ${goals.map((g) => `<option value="${g.id}" ${todo.goalId === g.id ? 'selected' : ''}>${escapeHtml(g.title)}</option>`).join('')}
        </select>
      </div>
    ` : ''}
    <div class="stack" style="margin-top:6px">
      <button class="btn btn-primary" id="todo-save">Speichern</button>
      ${!isNew ? '<button class="btn btn-danger" id="todo-delete">Löschen</button>' : ''}
    </div>
  `, { center: true });

  handle.sheet.querySelector('#todo-due').addEventListener('change', (e) => {
    handle.sheet.querySelector('#repeat-wrap').style.display = e.target.value ? '' : 'none';
    handle.sheet.querySelector('#time-wrap').style.display = e.target.value ? '' : 'none';
  });
  handle.sheet.querySelectorAll('[data-repeat]').forEach((b) => b.addEventListener('click', () => {
    const key = b.dataset.repeat;
    repeat = key ? { freq: key, intervalDays: key === 'custom' ? (repeat?.intervalDays || 2) : undefined } : null;
    handle.sheet.querySelectorAll('[data-repeat]').forEach((x) => x.classList.toggle('active', x.dataset.repeat === key));
    handle.sheet.querySelector('#repeat-custom-wrap').hidden = key !== 'custom';
  }));

  handle.sheet.querySelector('#todo-save').addEventListener('click', async () => {
    const title = handle.sheet.querySelector('#todo-title').value.trim();
    if (!title) { toast('Bitte einen Titel eingeben'); return; }
    const dueDate = handle.sheet.querySelector('#todo-due').value || null;
    const startTime = dueDate ? (handle.sheet.querySelector('#todo-start-time').value || null) : null;
    const endTime = dueDate ? (handle.sheet.querySelector('#todo-end-time').value || null) : null;
    const goalId = handle.sheet.querySelector('#todo-goal')?.value || null;
    if (repeat?.freq === 'custom') repeat.intervalDays = Math.max(1, Number(handle.sheet.querySelector('#repeat-days').value) || 1);
    // Wiederholung braucht ein Faelligkeitsdatum als Anker - ohne Datum ergibt sie keinen Sinn.
    const finalRepeat = dueDate ? repeat : null;
    if (dueDate && startTime && (dueDate !== todo.dueDate || startTime !== todo.startTime || endTime !== todo.endTime)) {
      const conflicts = await findConflictingEvents(dueDate, 'goals', { startTime, endTime }).catch(() => []);
      if (conflicts.length) {
        const names = [...new Set(conflicts.map((c) => getSourceLabel(c.source)))].join(', ');
        const ok = await confirmDialog(
          'Termin überschneidet sich',
          `Am ${formatDateKey(dueDate)} gibt es bereits Einträge in: ${names}. Trotzdem speichern?`,
          'Trotzdem speichern', false
        );
        if (!ok) return;
      }
    }
    if (isNew) {
      createTodo({ title, dueDate, startTime, endTime, goalId, repeat: finalRepeat });
    } else {
      saveTodo({ ...todo, title, dueDate, startTime, endTime, goalId, repeat: finalRepeat });
    }
    toast('Gespeichert');
    handle.close();
    onSaved?.();
  });

  handle.sheet.querySelector('#todo-delete')?.addEventListener('click', async () => {
    const ok = await confirmDialog('Todo löschen?', 'Wird unwiderruflich gelöscht.');
    if (!ok) return;
    deleteTodo(todo.id);
    toast('Gelöscht');
    handle.close();
    onSaved?.();
  });
}
