// Statistik-Uebersicht: Ausgaben (aus purchasePrice/-date, seit E30
// erfasst, hier erstmals aggregiert) und Nutzungsdauer (bisher unter
// "Fällig" mit-angezeigt, thematisch aber ein Statistik-Punkt - hierher
// verschoben statt dupliziert).

import { setTitle, setActions, setBack } from '../router.js';
import { totalSpent, spendingByCategory, spendingByYear, productCounts, usageStatsByName } from '../db.js';
import { escapeHtml, formatMoney } from '../utils.js';

export function render() {
  setTitle('Statistik');
  setBack(null);
  setActions('');
  draw();
}

function draw() {
  const view = document.getElementById('view');
  const total = totalSpent();
  const byCategory = spendingByCategory();
  const byYear = spendingByYear();
  const counts = productCounts();
  const usageStats = usageStatsByName();

  view.innerHTML = `
    <div class="grid-3" style="margin-bottom:16px">
      <div class="stat-tile">
        <div class="stat-tile__value">${formatMoney(total)}</div>
        <div class="stat-tile__label">Ausgaben gesamt</div>
      </div>
      <div class="stat-tile">
        <div class="stat-tile__value">${counts.active}</div>
        <div class="stat-tile__label">Aktiv</div>
      </div>
      <div class="stat-tile">
        <div class="stat-tile__value">${counts.usedUp}</div>
        <div class="stat-tile__label">Aufgebraucht</div>
      </div>
    </div>

    ${byCategory.length === 0 ? '' : `
      <div class="section-title" style="margin-top:0">Ausgaben nach Kategorie</div>
      <div class="card">
        ${byCategory.map((c) => `
          <div class="due-row">
            <div class="col grow" style="min-width:0">
              <p class="due-row__title truncate">${escapeHtml(c.label)}</p>
            </div>
            <span class="due-row__date">${formatMoney(c.total)}</span>
          </div>
        `).join('')}
      </div>
    `}

    ${byYear.length === 0 ? '' : `
      <div class="section-title">Ausgaben nach Jahr</div>
      <div class="card">
        ${byYear.map((y) => `
          <div class="due-row">
            <div class="col grow" style="min-width:0">
              <p class="due-row__title truncate">${y.year}</p>
            </div>
            <span class="due-row__date">${formatMoney(y.total)}</span>
          </div>
        `).join('')}
      </div>
    `}

    ${usageStats.length === 0 ? `
      <div class="empty">
        <h3>Noch keine Statistik</h3>
        <p class="faint">Sobald Produkte mit Kaufpreis erfasst oder als aufgebraucht markiert sind, tauchen hier Auswertungen auf.</p>
      </div>
    ` : `
      <div class="section-title">Nutzungsdauer</div>
      <div class="card">
        ${usageStats.map((s) => `
          <div class="due-row">
            <div class="col grow" style="min-width:0">
              <p class="due-row__title truncate">${escapeHtml(s.name)}</p>
              <p class="due-row__meta">${s.count} Produkt${s.count === 1 ? '' : 'e'} aufgebraucht</p>
            </div>
            <span class="due-row__date">Ø ${s.avgDays} Tage</span>
          </div>
        `).join('')}
      </div>
    `}
  `;
}
