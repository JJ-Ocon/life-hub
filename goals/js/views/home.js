import { setTitle, setActions, setBack } from '../router.js';
import { getTodosSorted, getTodoById, createTodo, saveTodo, deleteTodo, toggleTodo, getGoals } from '../db.js';
import { openModal, confirmDialog, toast } from '../ui.js';
import { todayKey, formatDateKey, escapeHtml } from '../utils.js';
import { findConflictingEvents } from '../../../shared/event-store.js';
import { getSourceLabel } from '../../../shared/calendar-schema.js';

export function render() {
  setTitle('Todos');
  setBack(null);
  setActions('');
  draw();
  handleQuickAddParam();
}

function handleQuickAddParam() {
  const query = new URLSearchParams(location.hash.split('?')[1] || '');
  const text = query.get('quickAdd');
  if (!text) return;
  history.replaceState(null, '', location.pathname + '#/');
  openTodoModal({ id: null, title: text, dueDate: null, goalId: null }, draw);
}

function draw() {
  const view = document.getElementById('view');
  const todos = getTodosSorted();
  const today = todayKey();

  view.innerHTML = `
    <div class="quick-add">
      <input class="input" id="quick-title" placeholder="Neues Todo …">
      <button class="btn btn-primary" id="quick-add-btn" style="width:auto">+</button>
    </div>
    ${todos.length === 0 ? `
      <div class="empty">
        <h3>Keine Todos</h3>
        <p class="faint">Alles erledigt, oder noch nichts erfasst.</p>
      </div>
    ` : `
      <div class="card">
        ${todos.map((t) => {
          const overdue = t.dueDate && t.dueDate < today && !t.done;
          return `
            <div class="todo-row ${t.done ? 'done' : ''}">
              <span class="set-check ${t.done ? 'done' : ''}" data-toggle="${t.id}">
                <svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>
              </span>
              <span class="todo-row__title" data-open="${t.id}">${escapeHtml(t.title)}</span>
              ${t.dueDate ? `<span class="todo-row__due ${overdue ? 'todo-row__due--overdue' : ''}">${formatDateKey(t.dueDate)}</span>` : ''}
            </div>
          `;
        }).join('')}
      </div>
    `}
  `;

  document.getElementById('quick-add-btn').addEventListener('click', () => {
    const input = document.getElementById('quick-title');
    const title = input.value.trim();
    if (!title) return;
    createTodo({ title });
    draw();
  });
  view.querySelectorAll('[data-toggle]').forEach((el) => {
    el.addEventListener('click', () => { toggleTodo(el.dataset.toggle); draw(); });
  });
  view.querySelectorAll('[data-open]').forEach((el) => {
    el.addEventListener('click', () => openTodoModal(getTodoById(el.dataset.open), draw));
  });
}

function openTodoModal(todo, onSaved) {
  const goals = getGoals();
  const isNew = !todo.id;

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

  handle.sheet.querySelector('#todo-save').addEventListener('click', async () => {
    const title = handle.sheet.querySelector('#todo-title').value.trim();
    if (!title) { toast('Bitte einen Titel eingeben'); return; }
    const dueDate = handle.sheet.querySelector('#todo-due').value || null;
    const goalId = handle.sheet.querySelector('#todo-goal')?.value || null;
    if (dueDate && dueDate !== todo.dueDate) {
      const conflicts = await findConflictingEvents(dueDate, 'goals').catch(() => []);
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
      createTodo({ title, dueDate, goalId });
    } else {
      saveTodo({ ...todo, title, dueDate, goalId });
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
