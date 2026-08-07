import { setTitle, setActions, setBack, navigate } from '../router.js';
import { getDueItems, getLowStockItems, usageStatsByName, categoryLabel } from '../db.js';
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
  const lowStock = getLowStockItems();
  const stats = usageStatsByName();
  const today = todayKey();

  view.innerHTML = `
    ${lowStock.length > 0 ? `
      <div class="section-title" style="margin-top:0">Einkaufsliste — bald leer</div>
      <div class="card" style="margin-bottom:20px">
        ${lowStock.map(({ product, weeksRemaining }) => `
          <div class="due-row" data-open="${product.id}" style="cursor:pointer">
            <div class="col grow" style="min-width:0">
              <p class="due-row__title truncate">${escapeHtml(product.name)}</p>
              <p class="due-row__meta"><span class="badge kind-badge">${escapeHtml(categoryLabel(product.category))}</span></p>
            </div>
            <span class="due-row__date">noch ${weeksRemaining} Wo.</span>
          </div>
        `).join('')}
      </div>
    ` : ''}
    ${items.length === 0 ? `
      <div class="empty">
        <h3>Nichts Fälliges</h3>
        <p class="faint">Produkte, deren Verfallsdatum sich nähert, erscheinen hier automatisch.</p>
      </div>
    ` : `
      <div class="section-title" style="margin-top:0">Verfall</div>
      <div class="card">
        ${items.map(({ product, expiry }) => {
          const overdue = expiry <= today;
          return `
            <div class="due-row" data-open="${product.id}" style="cursor:pointer">
              <div class="col grow" style="min-width:0">
                <p class="due-row__title truncate">${escapeHtml(product.name)}</p>
                <p class="due-row__meta"><span class="badge kind-badge">${escapeHtml(categoryLabel(product.category))}</span></p>
              </div>
              <span class="due-row__date ${overdue ? 'due-row__date--overdue' : ''}">${formatDateKey(expiry)}</span>
            </div>
          `;
        }).join('')}
      </div>
    `}
    ${stats.length > 0 ? `
      <div class="section-title">Nutzungsdauer-Statistik</div>
      <div class="card">
        ${stats.map((s) => `
          <div class="due-row">
            <div class="col grow" style="min-width:0">
              <p class="due-row__title truncate">${escapeHtml(s.name)}</p>
              <p class="due-row__meta">${s.count} Produkt${s.count === 1 ? '' : 'e'} aufgebraucht</p>
            </div>
            <span class="due-row__date">Ø ${s.avgDays} Tage</span>
          </div>
        `).join('')}
      </div>
    ` : ''}
  `;

  view.querySelectorAll('[data-open]').forEach((el) => {
    el.addEventListener('click', () => navigate(`#/products?open=${el.dataset.open}`));
  });
}
