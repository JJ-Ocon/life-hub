import { setTitle, setActions, setBack, navigate } from '../router.js';
import {
  getGoals, getGoalById, createGoal, saveGoal, deleteGoal, goalProgress,
  getMilestonesForGoal, createMilestone, toggleMilestone, deleteMilestone,
  getTodos,
} from '../db.js';
import { openModal, confirmDialog, toast } from '../ui.js';
import { escapeHtml, formatNum } from '../utils.js';

export function render() {
  setTitle('Ziele');
  setBack(null);
  setActions(`
    <button class="icon-btn" id="goal-add" aria-label="Ziel anlegen">
      <svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
    </button>
  `);
  draw();
  document.getElementById('goal-add').addEventListener('click', () => openGoalModal(null, draw));
}

function draw() {
  const view = document.getElementById('view');
  const goals = getGoals();

  if (!goals.length) {
    view.innerHTML = `
      <div class="empty">
        <h3>Noch keine Ziele</h3>
        <p class="faint">Lege ein Ziel an und teile es in Meilensteine auf.</p>
      </div>
    `;
    return;
  }

  view.innerHTML = `
    <div class="stack">
      ${goals.map((g) => {
        const pct = goalProgress(g.id);
        return `
          <div class="card card--tap" data-open="${g.id}">
            <p>${escapeHtml(g.title)}</p>
            ${pct === null ? `
              <p class="faint goal-card__pct">Noch keine Meilensteine</p>
            ` : `
              <div class="pbar goal-card__progress"><div class="pbar__fill" style="width:${pct * 100}%"></div></div>
              <p class="goal-card__pct">${formatNum(pct * 100)}% erledigt</p>
            `}
          </div>
        `;
      }).join('')}
    </div>
  `;

  view.querySelectorAll('[data-open]').forEach((el) => {
    el.addEventListener('click', () => navigate(`#/goals/${el.dataset.open}`));
  });
}

export function renderDetail({ id }) {
  const goal = getGoalById(id);
  if (!goal) { navigate('#/goals'); return; }

  setTitle(goal.title);
  setBack(() => navigate('#/goals'));
  setActions(`
    <button class="icon-btn" id="goal-edit" aria-label="Bearbeiten">
      <svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
    </button>
  `);

  function drawDetail() {
    const milestones = getMilestonesForGoal(id);
    const linkedTodos = getTodos().filter((t) => t.goalId === id);
    const pct = goalProgress(id);

    document.getElementById('view').innerHTML = `
      ${goal.note ? `<p class="faint" style="margin-bottom:16px">${escapeHtml(goal.note)}</p>` : ''}
      ${pct !== null ? `
        <div class="pbar goal-card__progress"><div class="pbar__fill" style="width:${pct * 100}%"></div></div>
        <p class="goal-card__pct" style="margin-bottom:16px">${formatNum(pct * 100)}% erledigt</p>
      ` : ''}

      <div class="section-title" style="margin-top:0">Meilensteine</div>
      <div class="card">
        ${milestones.length === 0 ? '<p class="faint">Noch keine Meilensteine.</p>' : milestones.map((m) => `
          <div class="milestone-row ${m.done ? 'done' : ''}">
            <span class="set-check ${m.done ? 'done' : ''}" data-toggle-milestone="${m.id}">
              <svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>
            </span>
            <span class="milestone-row__title">${escapeHtml(m.title)}</span>
            <button class="icon-btn" data-delete-milestone="${m.id}" aria-label="Entfernen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg></button>
          </div>
        `).join('')}
      </div>
      <button class="btn btn-ghost" id="milestone-add" style="margin-bottom:20px">+ Meilenstein</button>

      ${linkedTodos.length ? `
        <div class="section-title">Verknüpfte Todos</div>
        <div class="card">
          ${linkedTodos.map((t) => `<p style="padding:6px 0">${t.done ? '✓ ' : '○ '}${escapeHtml(t.title)}</p>`).join('')}
        </div>
      ` : ''}

      <button class="btn btn-danger" id="goal-delete" style="margin-top:20px">Ziel löschen</button>
    `;

    document.querySelectorAll('[data-toggle-milestone]').forEach((el) => {
      el.addEventListener('click', () => { toggleMilestone(el.dataset.toggleMilestone); drawDetail(); });
    });
    document.querySelectorAll('[data-delete-milestone]').forEach((el) => {
      el.addEventListener('click', () => { deleteMilestone(el.dataset.deleteMilestone); drawDetail(); });
    });
    document.getElementById('milestone-add').addEventListener('click', async () => {
      const title = await promptMilestoneTitle();
      if (title) { createMilestone(id, title); drawDetail(); }
    });
    document.getElementById('goal-delete').addEventListener('click', async () => {
      const ok = await confirmDialog('Ziel löschen?', 'Meilensteine werden mit-entfernt. Verknüpfte Todos bleiben erhalten.');
      if (!ok) return;
      deleteGoal(id);
      toast('Gelöscht');
      navigate('#/goals');
    });
  }

  drawDetail();
  document.getElementById('goal-edit').addEventListener('click', () => openGoalModal(goal, () => {
    setTitle(getGoalById(id).title);
    drawDetail();
  }));

  function promptMilestoneTitle() {
    return new Promise((resolve) => {
      const handle = openModal(`
        <h3 class="modal-title">Meilenstein</h3>
        <input class="input" id="milestone-title" placeholder="z.B. Erste 5km laufen" style="margin-bottom:16px">
        <div class="row" style="gap:10px">
          <button class="btn btn-ghost" data-act="cancel">Abbrechen</button>
          <button class="btn btn-primary" data-act="ok">Anlegen</button>
        </div>
      `, { center: true, onClose: () => resolve(null) });
      const input = handle.sheet.querySelector('#milestone-title');
      input.focus();
      handle.sheet.querySelector('[data-act="cancel"]').addEventListener('click', () => { resolve(null); handle.close(); });
      handle.sheet.querySelector('[data-act="ok"]').addEventListener('click', () => {
        const v = input.value.trim();
        resolve(v || null);
        handle.close();
      });
    });
  }
}

function openGoalModal(existing, onSaved) {
  const isNew = !existing;
  const handle = openModal(`
    <h3 class="modal-title">${isNew ? 'Ziel anlegen' : 'Ziel bearbeiten'}</h3>
    <div class="field">
      <label>Titel</label>
      <input class="input" id="goal-title" value="${escapeHtml(existing?.title || '')}" placeholder="z.B. 10km-Lauf schaffen">
    </div>
    <div class="field">
      <label>Notiz (optional)</label>
      <textarea class="input" id="goal-note">${escapeHtml(existing?.note || '')}</textarea>
    </div>
    <button class="btn btn-primary" id="goal-save">Speichern</button>
  `, { center: true });

  handle.sheet.querySelector('#goal-save').addEventListener('click', () => {
    const title = handle.sheet.querySelector('#goal-title').value.trim();
    if (!title) { toast('Bitte einen Titel eingeben'); return; }
    const note = handle.sheet.querySelector('#goal-note').value.trim();
    if (isNew) {
      createGoal(title, note);
    } else {
      saveGoal({ ...existing, title, note });
    }
    toast('Gespeichert');
    handle.close();
    onSaved?.();
  });
}
