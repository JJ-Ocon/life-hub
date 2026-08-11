import { setTitle, setActions, setBack, navigate } from '../router.js';
import {
  getCategories, budgetStatus, monthTotal, monthIncomeTotal, monthNet, getSettings,
  totalEnvelopeBalance, subscriptionSummary, applyBudgetRollovers,
} from '../db.js';
import { monthKey, monthLabel, formatMoney, escapeHtml, clamp } from '../utils.js';
import { openExpenseModal, openIncomeModal } from './expenses.js';

const cursor = monthKey();

export function render() {
  setTitle('Budget');
  setBack(null);
  setActions('');
  applyBudgetRollovers();
  draw();
}

function draw() {
  const settings = getSettings();
  const categories = getCategories();
  const total = monthTotal(cursor);
  const view = document.getElementById('view');

  const savedTotal = totalEnvelopeBalance();
  const abosMonthly = subscriptionSummary().totalMonthly;
  const income = monthIncomeTotal(cursor);
  const net = monthNet(cursor);

  view.innerHTML = `
    <p class="faint" style="margin-bottom:8px">${monthLabel(cursor)}</p>
    <div class="grid-3" style="margin-bottom:16px">
      <div class="stat-tile">
        <div class="stat-tile__value">${formatMoney(total, settings.currency)}</div>
        <div class="stat-tile__label">Ausgaben</div>
      </div>
      <div class="stat-tile">
        <div class="stat-tile__value">${formatMoney(income, settings.currency)}</div>
        <div class="stat-tile__label">Einnahmen</div>
      </div>
      <div class="stat-tile">
        <div class="stat-tile__value">${formatMoney(net, settings.currency)}</div>
        <div class="stat-tile__label">Netto</div>
      </div>
    </div>
    <div class="grid-2" style="margin-bottom:16px">
      <div class="stat-tile card--tap" id="home-savings-tile">
        <div class="stat-tile__value">${formatMoney(savedTotal, settings.currency)}</div>
        <div class="stat-tile__label">Gespart</div>
      </div>
      <div class="stat-tile card--tap" id="home-subs-tile">
        <div class="stat-tile__value">${formatMoney(abosMonthly, settings.currency)}</div>
        <div class="stat-tile__label">Abos/Monat</div>
      </div>
    </div>

    <div class="row" style="gap:10px; margin-bottom:20px">
      <button class="btn btn-primary grow" id="home-add">+ Ausgabe</button>
      <button class="btn btn-ghost grow" id="home-add-income">+ Einnahme</button>
    </div>

    <div class="section-title" style="margin-top:0">Kategorien</div>
    <div class="card">
      ${categories.map((c) => {
        const status = budgetStatus(c);
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
  document.getElementById('home-add-income').addEventListener('click', () => openIncomeModal(null, draw));
  document.getElementById('home-savings-tile').addEventListener('click', () => navigate('#/savings'));
  document.getElementById('home-subs-tile').addEventListener('click', () => navigate('#/savings'));
}
