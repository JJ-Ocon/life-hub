import { setTitle, setActions, setBack, navigate } from '../router.js';
import { getDueItems, categoryLabel } from '../db.js';
import { todayKey, formatDateKey, escapeHtml } from '../utils.js';

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
        <p class="faint">Dokumente, deren Ablaufdatum sich nähert, erscheinen hier automatisch.</p>
      </div>
    ` : `
      <div class="card">
        ${items.map((d) => {
          const overdue = d.expiryDate <= today;
          return `
            <div class="due-row" data-open="${d.id}" style="cursor:pointer">
              <div class="col grow" style="min-width:0">
                <p class="due-row__title truncate">${escapeHtml(d.title)}</p>
                <p class="due-row__meta"><span class="badge kind-badge">${escapeHtml(categoryLabel(d.category))}</span></p>
              </div>
              <span class="due-row__date ${overdue ? 'due-row__date--overdue' : ''}">${formatDateKey(d.expiryDate)}</span>
            </div>
          `;
        }).join('')}
      </div>
    `}
  `;

  view.querySelectorAll('[data-open]').forEach((el) => {
    el.addEventListener('click', () => navigate(`#/documents?open=${el.dataset.open}`));
  });
}
