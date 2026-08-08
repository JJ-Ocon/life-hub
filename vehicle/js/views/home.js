import { setTitle, setActions, setBack, navigate } from '../router.js';
import { getDueItems, markMaintenanceDone } from '../db.js';
import { todayKey, formatDateKey, escapeHtml } from '../utils.js';
import { toast } from '../ui.js';

export function render() {
  setTitle('Fällig');
  setBack(null);
  setActions('');
  draw();
}

function draw() {
  const view = document.getElementById('view');
  const items = getDueItems();
  const today = todayKey();

  view.innerHTML = `
    ${items.length === 0 ? `
      <div class="empty">
        <h3>Nichts Fälliges</h3>
        <p class="faint">Wartungsaufgaben und TÜV-Termine deiner Fahrzeuge erscheinen hier automatisch.</p>
      </div>
    ` : `
      <div class="card">
        ${items.map(({ task, vehicle, due }) => {
          const overdue = due <= today;
          return `
            <div class="due-row" data-open="${vehicle.id}" style="cursor:pointer">
              <div class="col grow" style="min-width:0">
                <p class="due-row__title truncate">${escapeHtml(task.title)}</p>
                <p class="due-row__meta"><span class="badge kind-badge">${escapeHtml(vehicle.name)}</span></p>
              </div>
              <span class="due-row__date ${overdue ? 'due-row__date--overdue' : ''}">${formatDateKey(due)}</span>
              <button class="icon-btn" data-done="${task.id}" aria-label="Erledigt"><svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg></button>
            </div>
          `;
        }).join('')}
      </div>
    `}
  `;

  view.querySelectorAll('[data-open]').forEach((el) => {
    el.addEventListener('click', () => navigate(`#/vehicle/${el.dataset.open}`));
  });
  view.querySelectorAll('[data-done]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      markMaintenanceDone(el.dataset.done);
      toast('Als erledigt markiert');
      draw();
    });
  });
}
