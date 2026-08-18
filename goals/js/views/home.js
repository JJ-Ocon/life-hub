import { setTitle, setActions, setBack } from '../router.js';
import {
  getTodosSorted, getTodoById, createTodo, saveTodo, deleteTodo, toggleTodo, getGoals,
  REPEAT_FREQUENCIES, repeatLabel, addSubtask, removeSubtask, toggleSubtask,
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

// Welche Todos mit Untertasks gerade aufgeklappt sind (E-Todo-Subtasks) -
// wie expandedSections modul-lokal, bei jedem View-Laden zurueckgesetzt.
let expandedSubtasks = new Set();

/** Stabile Sortierung nach manueller Reihenfolge (E-Todo-Reorder): Todos mit
 *  gesetztem order zuerst (danach sortiert), alle anderen dahinter in ihrer
 *  bisherigen (Faelligkeits-/Erstell-)Reihenfolge - so bleibt ein Abschnitt,
 *  in dem noch nie manuell verschoben wurde, exakt wie bisher sortiert. */
function sortByOrder(list) {
  return list
    .map((t, i) => ({ t, i }))
    .sort((a, b) => {
      if (a.t.order != null && b.t.order != null) return a.t.order - b.t.order;
      if (a.t.order != null) return -1;
      if (b.t.order != null) return 1;
      return a.i - b.i;
    })
    .map((x) => x.t);
}

function todoRowHtml(t, today, sectionKey, idx, total) {
  const overdue = t.dueDate && t.dueDate < today && !t.done;
  const timeLabel = t.startTime ? `${t.startTime}${t.endTime ? '–' + t.endTime : ''} · ` : '';
  const reorderable = sectionKey != null;
  const subtasks = t.subtasks || [];
  const hasSubtasks = subtasks.length > 0;
  const subtasksExpanded = expandedSubtasks.has(t.id);
  const doneCount = subtasks.filter((s) => s.done).length;
  return `
    <div class="todo-row-wrap">
      <div class="todo-row ${t.done ? 'done' : ''}">
        <span class="set-check ${t.done ? 'done' : ''}" data-toggle="${t.id}">
          <svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>
        </span>
        ${hasSubtasks ? `
          <button type="button" class="icon-btn" data-toggle-subtasks="${t.id}" aria-label="Untertasks anzeigen">
            <svg class="collapse-chevron ${subtasksExpanded ? 'collapse-chevron--open' : ''}" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
          </button>
        ` : ''}
        <span class="todo-row__title" data-open="${t.id}">${escapeHtml(t.title)}</span>
        ${hasSubtasks ? `<span class="badge">${doneCount}/${subtasks.length}</span>` : ''}
        ${t.dueDate ? `<span class="todo-row__due ${overdue ? 'todo-row__due--overdue' : ''}">${t.repeat ? `🔁 ${repeatLabel(t.repeat)} · ` : ''}${timeLabel}${formatDateKey(t.dueDate)}</span>` : ''}
        ${reorderable ? `
          <span class="todo-row__reorder">
            <button type="button" class="icon-btn" data-move="${sectionKey}:${t.id}:-1" aria-label="Nach oben" ${idx === 0 ? 'disabled' : ''}>
              <svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg>
            </button>
            <button type="button" class="icon-btn" data-move="${sectionKey}:${t.id}:1" aria-label="Nach unten" ${idx === total - 1 ? 'disabled' : ''}>
              <svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>
            </button>
          </span>
        ` : ''}
      </div>
      ${hasSubtasks && subtasksExpanded ? `
        <div class="subtask-list">
          ${subtasks.map((s) => `
            <div class="subtask-row">
              <span class="set-check ${s.done ? 'done' : ''}" data-toggle-subtask="${t.id}:${s.id}">
                <svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>
              </span>
              <span class="subtask-row__title ${s.done ? 'done' : ''}">${escapeHtml(s.title)}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

function sectionHtml(key, label, todos, today, collapsedByDefault, reorderable) {
  if (!todos.length) return '';
  const expanded = expandedSections.has(key) || !collapsedByDefault;
  return `
    <div class="section-title row row--between" data-section-toggle="${key}" style="cursor:pointer">
      <span>${label} (${todos.length})</span>
      <span class="faint">${expanded ? '▾' : '▸'}</span>
    </div>
    ${expanded ? `<div class="card">${todos.map((t, i) => todoRowHtml(t, today, reorderable ? key : null, i, todos.length)).join('')}</div>` : ''}
  `;
}

function draw() {
  const view = document.getElementById('view');
  const todos = getTodosSorted();
  const today = todayKey();
  const assignedNotes = getNotesForApp('goals');

  const open = todos.filter((t) => !t.done);
  const done = todos.filter((t) => t.done);
  const overdue = sortByOrder(open.filter((t) => t.dueDate && t.dueDate < today));
  const dueToday = sortByOrder(open.filter((t) => t.dueDate === today));
  const upcoming = sortByOrder(open.filter((t) => t.dueDate && t.dueDate > today));
  const noDate = sortByOrder(open.filter((t) => !t.dueDate));
  const SECTION_ARRAYS = { overdue, today: dueToday, upcoming, nodate: noDate };

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
      ${sectionHtml('overdue', '⚠️ Überfällig', overdue, today, false, true)}
      ${sectionHtml('today', 'Heute', dueToday, today, false, true)}
      ${sectionHtml('upcoming', 'Demnächst', upcoming, today, false, true)}
      ${sectionHtml('nodate', 'Ohne Termin', noDate, today, true, true)}
      ${sectionHtml('done', 'Erledigt', done, today, true, false)}
    `}
  `;

  // "+" oeffnet jetzt das volle Todo-Menue (Faelligkeit, Zeit, Wiederholung,
  // Ziel, Untertasks) statt nur einen reinen Titel-Eintrag anzulegen - gleiche
  // Menue-Ansicht wie beim Antippen eines Eintrags im Kalender-Tab dieser App,
  // mit dem getippten Text als Titel vorausgefuellt.
  document.getElementById('quick-add-btn').addEventListener('click', () => {
    const input = document.getElementById('quick-title');
    const title = input.value.trim();
    input.value = '';
    openTodoModal({ id: null, title, dueDate: null, goalId: null }, draw);
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
  view.querySelectorAll('[data-toggle-subtasks]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.dataset.toggleSubtasks;
      if (expandedSubtasks.has(id)) expandedSubtasks.delete(id); else expandedSubtasks.add(id);
      draw();
    });
  });
  view.querySelectorAll('[data-toggle-subtask]').forEach((el) => {
    el.addEventListener('click', () => {
      const [todoId, subtaskId] = el.dataset.toggleSubtask.split(':');
      toggleSubtask(todoId, subtaskId);
      draw();
    });
  });
  view.querySelectorAll('[data-move]').forEach((el) => {
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const [sectionKey, id, dir] = el.dataset.move.split(':');
      const list = SECTION_ARRAYS[sectionKey];
      const idx = list.findIndex((t) => t.id === id);
      const swapIdx = idx + Number(dir);
      if (swapIdx < 0 || swapIdx >= list.length) return;
      const reordered = list.slice();
      [reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]];
      reordered.forEach((t, i) => saveTodo({ ...t, order: i }));
      draw();
    });
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
    ${!isNew ? `
      <div class="field" id="subtasks-field">
        <label>Untertasks (optional) — Haupt-Todo gilt automatisch als erledigt, sobald alle abgehakt sind</label>
        <div id="subtasks-list"></div>
        <div class="row" style="gap:8px;margin-top:8px">
          <input class="input" id="subtask-title" placeholder="Neue Untertask …" style="flex:1">
          <button class="btn btn-ghost btn-sm" id="subtask-add" type="button">+</button>
        </div>
      </div>
    ` : ''}
    <div class="stack" style="margin-top:6px">
      <button class="btn btn-primary" id="todo-save">Speichern</button>
      ${!isNew ? '<button class="btn btn-danger" id="todo-delete">Löschen</button>' : ''}
    </div>
  `, { center: true });

  if (!isNew) {
    renderSubtasksInModal();
    handle.sheet.querySelector('#subtask-add').addEventListener('click', () => {
      const input = handle.sheet.querySelector('#subtask-title');
      const title = input.value.trim();
      if (!title) return;
      addSubtask(todo.id, title);
      input.value = '';
      renderSubtasksInModal();
    });
  }

  function renderSubtasksInModal() {
    const list = handle.sheet.querySelector('#subtasks-list');
    if (!list) return;
    const current = getTodoById(todo.id);
    const subtasks = current?.subtasks || [];
    list.innerHTML = subtasks.length === 0
      ? `<p class="faint">Noch keine Untertasks.</p>`
      : subtasks.map((s) => `
        <div class="row row--between" style="padding:6px 0">
          <div class="row grow" style="min-width:0;gap:8px">
            <span class="set-check ${s.done ? 'done' : ''}" data-modal-toggle-subtask="${s.id}">
              <svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>
            </span>
            <span class="truncate ${s.done ? 'subtask-row__title done' : ''}">${escapeHtml(s.title)}</span>
          </div>
          <button class="icon-btn" data-modal-remove-subtask="${s.id}" aria-label="Entfernen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg></button>
        </div>
      `).join('');
    list.querySelectorAll('[data-modal-toggle-subtask]').forEach((b) => b.addEventListener('click', () => {
      toggleSubtask(todo.id, b.dataset.modalToggleSubtask);
      renderSubtasksInModal();
    }));
    list.querySelectorAll('[data-modal-remove-subtask]').forEach((b) => b.addEventListener('click', () => {
      removeSubtask(todo.id, b.dataset.modalRemoveSubtask);
      renderSubtasksInModal();
    }));
  }

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
