import { setTitle, setActions, setBack } from '../router.js';
import {
  monthlyTotalsSeries, linearForecast, monthlySpendByCategory, spendByCategoryInRange, getCategories, getSettings,
  purchaseIntervalStats, taxRelevantExpensesForYear, taxYearsAvailable,
} from '../db.js';
import { barChart } from '../charts.js';
import { toast } from '../ui.js';
import { monthKey, monthLabel, addMonths, todayKey, addDaysToDateKey, formatMoney, formatDateKey, download, escapeHtml } from '../utils.js';

/** Baut die Kategorie-Balken fuer einen Zeitraum-Vergleichsabschnitt -
 *  gemeinsam genutzt von "diesen Monat"/"letzte 7 Tage"/"letzter Monat". */
function categoryBarsHtml(sums, categories, settings, emptyText) {
  const rows = categories
    .map((c) => ({ cat: c, amount: sums[c.id] || 0 }))
    .filter((r) => r.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  if (!rows.length) return `<p class="faint">${emptyText}</p>`;
  const maxAmount = Math.max(...rows.map((r) => r.amount), 1);
  return `
    <div class="stack">
      ${rows.map((r) => `
        <div>
          <div class="row row--between" style="margin-bottom:4px">
            <span>${r.cat.icon} ${escapeHtml(r.cat.name)}</span>
            <span class="faint">${formatMoney(r.amount, settings.currency)}</span>
          </div>
          <div class="pbar"><div class="pbar__fill" style="width:${(r.amount / maxAmount) * 100}%;background:${r.cat.color}"></div></div>
        </div>
      `).join('')}
    </div>
  `;
}

export function render() {
  setTitle('Statistik');
  setBack(null);
  setActions('');
  draw();
}

function draw() {
  const settings = getSettings();
  const series = monthlyTotalsSeries(6);
  const forecast = linearForecast(series);
  const categories = getCategories();
  const currentMonth = monthKey();
  const lastMonth = addMonths(currentMonth, -1);
  const weekStart = addDaysToDateKey(todayKey(), -6);
  const spendByCat = monthlySpendByCategory(currentMonth);
  const spendLastWeek = spendByCategoryInRange(weekStart, todayKey());
  const spendLastMonth = monthlySpendByCategory(lastMonth);
  const intervals = purchaseIntervalStats();
  const years = taxYearsAvailable();

  document.getElementById('view').innerHTML = `
    <div class="section-title" style="margin-top:0">Ausgaben-Verlauf (6 Monate)</div>
    <div class="card">
      ${barChart(series.map((s, i) => ({
        label: monthLabel(s.month).slice(0, 3),
        value: s.total,
        highlight: i === series.length - 1,
      })), { unit: '' })}
    </div>

    <div class="section-title">Prognose nächster Monat</div>
    <div class="card">
      ${forecast ? `
        <div class="stat-tile" style="margin-bottom:0">
          <div class="stat-tile__value">${formatMoney(forecast.value, settings.currency)}</div>
          <div class="stat-tile__label">geschätzt für ${monthLabel(forecast.nextMonth)}</div>
        </div>
        <p class="faint" style="margin-top:10px">
          ${forecast.trendPerMonth > 0.5 ? `Trend steigend, +${formatMoney(forecast.trendPerMonth, settings.currency)}/Monat` :
            forecast.trendPerMonth < -0.5 ? `Trend fallend, ${formatMoney(forecast.trendPerMonth, settings.currency)}/Monat` :
            'Trend etwa konstant'}
          · lineare Schätzung aus den letzten ${series.length} Monaten.
        </p>
      ` : `<p class="faint">Noch nicht genug Monate mit Daten für eine Prognose.</p>`}
    </div>

    <div class="section-title">Kategorie-Vergleich (${monthLabel(currentMonth)})</div>
    <div class="card">
      ${categoryBarsHtml(spendByCat, categories, settings, 'Noch keine Ausgaben diesen Monat.')}
    </div>

    <div class="section-title">Kategorie-Vergleich (letzte 7 Tage)</div>
    <div class="card">
      ${categoryBarsHtml(spendLastWeek, categories, settings, 'Keine Ausgaben in den letzten 7 Tagen.')}
    </div>

    <div class="section-title">Kategorie-Vergleich (${monthLabel(lastMonth)})</div>
    <div class="card">
      ${categoryBarsHtml(spendLastMonth, categories, settings, 'Keine Ausgaben im letzten Monat.')}
    </div>

    <div class="section-title">Kauf-Rhythmus je Händler</div>
    <div class="card">
      ${intervals.length === 0 ? `<p class="faint">Braucht mindestens zwei Ausgaben beim selben Händler, um einen Rhythmus zu erkennen.</p>` : `
        <div class="stack">
          ${intervals.slice(0, 8).map((i) => `
            <div class="row row--between">
              <div class="col">
                <span>${escapeHtml(i.name)}</span>
                <span class="faint">${i.count}× · zuletzt ${formatDateKey(i.lastDate)}</span>
              </div>
              <span class="badge">alle ${i.avgDays} Tage</span>
            </div>
          `).join('')}
        </div>
      `}
    </div>

    <div class="section-title">Steuer-Jahresreport</div>
    <div class="card">
      ${years.length === 0 ? `<p class="faint">Noch keine als „steuerlich relevant“ markierten Ausgaben.</p>` : `
        <div class="field" style="margin-bottom:12px">
          <label>Jahr</label>
          <select class="input" id="tax-year">
            ${years.map((y) => `<option value="${y}">${y}</option>`).join('')}
          </select>
        </div>
        <button class="btn btn-primary" id="tax-export">CSV exportieren</button>
      `}
    </div>
  `;

  document.getElementById('tax-export')?.addEventListener('click', () => {
    const year = document.getElementById('tax-year').value;
    const rows = taxRelevantExpensesForYear(year);
    exportTaxCsv(year, rows, settings);
  });
}

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportTaxCsv(year, rows, settings) {
  const categories = getCategories();
  const header = ['Datum', 'Betrag', `Währung`, 'Kategorie', 'Händler', 'Notiz'].map(csvEscape).join(';');
  const lines = rows.map((e) => {
    const cat = categories.find((c) => c.id === e.categoryId);
    return [e.date, e.amount.toFixed(2), settings.currency, cat?.name || '', e.merchant, e.note].map(csvEscape).join(';');
  });
  const total = rows.reduce((sum, e) => sum + e.amount, 0);
  lines.push(['', total.toFixed(2), settings.currency, 'Summe', '', ''].map(csvEscape).join(';'));
  const csv = [header, ...lines].join('\n');
  download(`budget-steuer-${year}.csv`, csv, 'text/csv');
  toast(`${rows.length} Einträge exportiert`);
}
