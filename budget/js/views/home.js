import { setTitle, setActions, setBack } from '../router.js';
import { getCategories, budgetStatus, monthTotal, getSettings } from '../db.js';
import { monthKey, monthLabel, formatMoney, escapeHtml, clamp } from '../utils.js';
import { openExpenseModal } from './expenses.js';

const cursor = monthKey();

export function render() {
  setTitle('Budget');
  setBack(null);
  setActions('');
  draw();
}

function draw() {
  const settings = getSettings();
  const categories = getCategories();
  const total = monthTotal(cursor);
  const view = document.getElementById('view');

  view.innerHTML = `
    <div class="stat-tile" style="margin-bottom:16px">
      <div class="stat-tile__value">${formatMoney(total, settings.currency)}</div>
      <div class="stat-tile__label">Ausgaben ${monthLabel(cursor)}</div>
    </div>

    <button class="btn btn-primary" id="home-add" style="margin-bottom:20px">+ Ausgabe erfassen</button>

    <div class="section-title" style="margin-top:0">Kategorien</div>
    <div class="card">
      ${categories.map((c) => {
        const status = budgetStatus(c, cursor);
        const pct = status.pct === null ? 0 : clamp(status.pct * 100, 0, 100);
        const levelClass = status.level === 'nolimit' ? '' : status.level;
        return `
          <div class="cat-row">
            <div class="row row--between" style="margin-bottom:8px">
              <div class="row" style="gap:8px">
                <span class="cat-row__dot" style="background:${c.color}"></span>
                <span class="cat-row__name">${c.icon} ${escapeHtml(c.name)}</span>
              </div>
              ${status.level === 'nolimit'
                ? `<span class="badge">${formatMoney(status.spent, settings.currency)}</span>`
                : `<span class="badge cat-badge--${levelClass}">${Math.round(status.pct * 100)}%</span>`}
            </div>
            ${status.level === 'nolimit' ? `
              <p class="cat-row__amounts">Kein Budget-Limit gesetzt</p>
            ` : `
              <div class="pbar"><div class="pbar__fill cat-pbar__fill--${levelClass}" style="width:${pct}%"></div></div>
              <p class="cat-row__amounts">${formatMoney(status.spent, settings.currency)} von ${formatMoney(status.budget, settings.currency)}</p>
            `}
          </div>
        `;
      }).join('')}
    </div>
  `;

  document.getElementById('home-add').addEventListener('click', () => openExpenseModal(null, draw));
}
