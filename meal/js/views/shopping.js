import { setTitle, setActions, setBack } from '../router.js';
import { pantryAdjustedShoppingList, getCheckedShoppingItems, toggleShoppingItem } from '../db.js';
import { todayKey, addDaysToDateKey, mondayOfWeekKey, formatDateKey, formatNum, escapeHtml } from '../utils.js';

let cursor = mondayOfWeekKey(todayKey());

export function render() {
  setTitle('Einkaufsliste');
  setBack(null);
  setActions('');
  draw();
}

async function draw() {
  const view = document.getElementById('view');
  const weekEnd = addDaysToDateKey(cursor, 6);
  const items = await pantryAdjustedShoppingList(cursor, weekEnd);
  const checked = new Set(getCheckedShoppingItems(cursor));

  view.innerHTML = `
    <div class="row row--between week-nav">
      <button class="icon-btn" id="week-prev" aria-label="Vorige Woche"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
      <h3>${formatDateKey(cursor)} – ${formatDateKey(weekEnd)}</h3>
      <button class="icon-btn" id="week-next" aria-label="Nächste Woche"><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>
    </div>
    ${items.length === 0 ? `
      <div class="empty">
        <h3>Nichts einzukaufen</h3>
        <p class="faint">Plane Mahlzeiten für diese Woche im Wochenplan, dann erscheint hier die Zutatenliste.</p>
      </div>
    ` : `
      <div class="card">
        ${items.map((item) => {
          const covered = item.hasStock && !item.unclearUnit && item.remainingGrams <= 0;
          return `
          <div class="shop-item ${checked.has(item.foodName) ? 'checked' : ''}" data-item="${escapeHtml(item.foodName)}">
            <span class="set-check ${checked.has(item.foodName) ? 'done' : ''}">
              <svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>
            </span>
            <span class="shop-item__name">${escapeHtml(item.foodName)}${item.hasStock ? ` <span class="faint">${item.unclearUnit ? '(im Vorrat, Menge unklar)' : covered ? '(im Vorrat gedeckt)' : '(teilweise im Vorrat)'}</span>` : ''}</span>
            <span class="shop-item__amount">${covered ? '–' : formatNum(item.remainingGrams) + ' g'}</span>
          </div>
        `;
        }).join('')}
      </div>
      <p class="faint" style="margin-top:10px">Bereits im Vorrat vorhandene Mengen (nach Name abgeglichen, nur bei Gramm-Einheiten automatisch abgezogen) sind bereits berücksichtigt.</p>
    `}
  `;

  document.getElementById('week-prev').addEventListener('click', () => { cursor = addDaysToDateKey(cursor, -7); draw(); });
  document.getElementById('week-next').addEventListener('click', () => { cursor = addDaysToDateKey(cursor, 7); draw(); });
  view.querySelectorAll('[data-item]').forEach((el) => {
    el.addEventListener('click', () => { toggleShoppingItem(cursor, el.dataset.item); draw(); });
  });
}
