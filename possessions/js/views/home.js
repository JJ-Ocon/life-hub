import { setTitle, setActions, setBack, navigate } from '../router.js';
import { getDueReminders, categoryLabel } from '../db.js';
import { todayKey, formatDateKey, escapeHtml } from '../utils.js';

export function render() {
  setTitle('Fällig');
  setBack(null);
  setActions('');
  draw();
}

function draw() {
  const view = document.getElementById('view');
  const reminders = getDueReminders();
  const today = todayKey();

  view.innerHTML = `
    ${reminders.length === 0 ? `
      <div class="empty">
        <h3>Nichts Fälliges</h3>
        <p class="faint">Ablaufende Garantien und fällige Ersatzteile erscheinen hier automatisch.</p>
      </div>
    ` : `
      <div class="card">
        ${reminders.map((r) => {
          const overdue = r.dueDate <= today;
          return `
            <div class="due-row" data-open="${r.itemId}" style="cursor:pointer">
              <div class="col grow" style="min-width:0">
                <p class="due-row__title truncate">${escapeHtml(r.itemName)}</p>
                <p class="due-row__meta">
                  <span class="badge kind-badge">${escapeHtml(categoryLabel(r.category))}</span>
                  ${escapeHtml(r.label)}
                </p>
              </div>
              <span class="due-row__date ${overdue ? 'due-row__date--overdue' : ''}">${formatDateKey(r.dueDate)}</span>
            </div>
          `;
        }).join('')}
      </div>
    `}
  `;

  view.querySelectorAll('[data-open]').forEach((el) => {
    el.addEventListener('click', () => navigate(`#/items?open=${el.dataset.open}`));
  });
}
