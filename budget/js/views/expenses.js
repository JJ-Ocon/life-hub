import { setTitle, setActions, setBack } from '../router.js';
import {
  getExpenses, getExpensesForMonth, createExpense, saveExpense, deleteExpense, getExpenseById,
  getIncome, getIncomeForMonth, createIncome, saveIncome, deleteIncome, getIncomeById, monthIncomeTotal, monthTotal,
  getCategories, getSettings, suggestCategoryForMerchant, ensureNextRecurringOccurrence, ensureNextRecurringIncomeOccurrence,
} from '../db.js';
import { openModal, confirmDialog, toast } from '../ui.js';
import { todayKey, monthKey, addMonths, monthLabel, formatDateKey, formatMoney, escapeHtml } from '../utils.js';
import { recognizeText, parseReceiptText } from '../../../shared/receipt-ocr.js';

let cursor = monthKey();
let section = 'expenses'; // 'expenses' | 'income'
let searchOpen = false;
let searchQuery = '';

export function render() {
  setTitle('Kontostand');
  setBack(null);
  setActions(`
    <button class="icon-btn" id="exp-search" aria-label="Suchen">
      <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
    </button>
    <button class="icon-btn" id="exp-add" aria-label="Erfassen">
      <svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
    </button>
  `);
  draw();
  document.getElementById('exp-add').addEventListener('click', () => {
    if (section === 'income') openIncomeModal(null, draw);
    else openExpenseModal(null, draw);
  });
  document.getElementById('exp-search').addEventListener('click', () => {
    searchOpen = !searchOpen;
    if (!searchOpen) searchQuery = '';
    draw();
  });
}

function draw() {
  const settings = getSettings();
  const view = document.getElementById('view');
  const net = monthIncomeTotal(cursor) - monthTotal(cursor);

  view.innerHTML = `
    <div class="row row--between cal-nav" style="margin-bottom:14px">
      <button class="icon-btn" id="exp-prev" aria-label="Zurück"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
      <h3>${monthLabel(cursor)}</h3>
      <button class="icon-btn" id="exp-next" aria-label="Weiter"><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>
    </div>
    <div class="section-tabs">
      <button class="chip ${section === 'expenses' ? 'active' : ''}" data-section="expenses">Ausgaben</button>
      <button class="chip ${section === 'income' ? 'active' : ''}" data-section="income">Einnahmen</button>
    </div>
    ${searchOpen ? `
      <div class="field" style="margin-top:12px">
        <input class="input" id="exp-search-input" type="search" placeholder="Suchen …" value="${escapeHtml(searchQuery)}">
      </div>
    ` : ''}
    <div class="stat-tile" style="margin-bottom:14px">
      <div class="stat-tile__value">${formatMoney(net, settings.currency)}</div>
      <div class="stat-tile__label">Netto ${monthLabel(cursor)}</div>
    </div>
    <div id="list-content"></div>
  `;

  document.getElementById('exp-prev').addEventListener('click', () => { cursor = addMonths(cursor, -1); draw(); });
  document.getElementById('exp-next').addEventListener('click', () => { cursor = addMonths(cursor, 1); draw(); });
  view.querySelectorAll('[data-section]').forEach((el) => el.addEventListener('click', () => { section = el.dataset.section; draw(); }));

  const searchInput = document.getElementById('exp-search-input');
  if (searchInput) {
    searchInput.focus();
    searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      if (section === 'income') drawIncomeList(); else drawExpenseList();
    });
  }

  if (section === 'income') drawIncomeList(); else drawExpenseList();
}

/** Gruppiert eine bereits absteigend nach Datum sortierte Liste in
 *  Tagesabschnitte (Budget-Kontostand-Tagesgruppen) - Reihenfolge der Liste
 *  bleibt erhalten, nur mit Ueberschriften je Tag versehen. */
function groupByDay(list, dateOf) {
  const groups = [];
  for (const item of list) {
    const day = dateOf(item);
    let g = groups[groups.length - 1];
    if (!g || g.day !== day) { g = { day, items: [] }; groups.push(g); }
    g.items.push(item);
  }
  return groups;
}

function matchesSearch(text) {
  if (!searchQuery.trim()) return true;
  return text.toLowerCase().includes(searchQuery.trim().toLowerCase());
}

function drawExpenseList() {
  const settings = getSettings();
  const categories = getCategories();
  const list = getExpensesForMonth(cursor).filter((e) => {
    const cat = categories.find((c) => c.id === e.categoryId);
    return matchesSearch(`${e.merchant || ''} ${cat?.name || ''}`);
  });
  const content = document.getElementById('list-content');
  const groups = groupByDay(list, (e) => e.date);
  content.innerHTML = `
    ${list.length === 0 ? `
      <div class="empty">
        <h3>${searchQuery.trim() ? 'Keine Treffer' : 'Noch keine Ausgaben'}</h3>
        <p class="faint">${searchQuery.trim() ? 'Andere Suche versuchen.' : 'Erfasse deine erste Ausgabe über das Plus oben rechts.'}</p>
      </div>
    ` : groups.map((g) => {
      const dayTotal = g.items.reduce((sum, e) => sum + e.amount, 0);
      return `
        <div class="row row--between day-group-header">
          <span>${formatDateKey(g.day)}</span>
          <span class="faint">${formatMoney(dayTotal, settings.currency)}</span>
        </div>
        <div class="stack" style="margin-bottom:16px">
          ${g.items.map((e) => {
            const cat = categories.find((c) => c.id === e.categoryId) || categories[categories.length - 1];
            return `
              <div class="card card--tap" data-open="${e.id}" style="margin-bottom:0">
                <div class="row row--between">
                  <div class="row grow" style="min-width:0">
                    <span style="font-size:1.3rem">${cat.icon}</span>
                    <div class="col grow" style="min-width:0">
                      <p class="truncate">${escapeHtml(e.merchant || cat.name)}</p>
                      ${e.recurring ? `<p class="faint">wiederkehrend</p>` : ''}
                    </div>
                  </div>
                  <div class="badge">${formatMoney(e.amount, settings.currency)}</div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }).join('')}
  `;
  content.querySelectorAll('[data-open]').forEach((el) => {
    el.addEventListener('click', () => openExpenseModal(getExpenseById(el.dataset.open), draw));
  });
}

function drawIncomeList() {
  const settings = getSettings();
  const list = getIncomeForMonth(cursor).filter((i) => matchesSearch(i.source || ''));
  const content = document.getElementById('list-content');
  const groups = groupByDay(list, (i) => i.date);
  content.innerHTML = `
    ${list.length === 0 ? `
      <div class="empty">
        <h3>${searchQuery.trim() ? 'Keine Treffer' : 'Noch keine Einnahmen'}</h3>
        <p class="faint">${searchQuery.trim() ? 'Andere Suche versuchen.' : 'Erfasse Gehalt, Nebenjob oder andere Einnahmen über das Plus oben rechts.'}</p>
      </div>
    ` : groups.map((g) => {
      const dayTotal = g.items.reduce((sum, i) => sum + i.amount, 0);
      return `
        <div class="row row--between day-group-header">
          <span>${formatDateKey(g.day)}</span>
          <span class="faint">${formatMoney(dayTotal, settings.currency)}</span>
        </div>
        <div class="stack" style="margin-bottom:16px">
          ${g.items.map((i) => `
            <div class="card card--tap" data-open="${i.id}" style="margin-bottom:0">
              <div class="row row--between">
                <div class="row grow" style="min-width:0">
                  <span style="font-size:1.3rem">💰</span>
                  <div class="col grow" style="min-width:0">
                    <p class="truncate">${escapeHtml(i.source || 'Einnahme')}</p>
                    ${i.recurring ? `<p class="faint">wiederkehrend</p>` : ''}
                  </div>
                </div>
                <div class="badge">${formatMoney(i.amount, settings.currency)}</div>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }).join('')}
  `;
  content.querySelectorAll('[data-open]').forEach((el) => {
    el.addEventListener('click', () => openIncomeModal(getIncomeById(el.dataset.open), draw));
  });
}

/**
 * Erfassen/Bearbeiten einer Ausgabe. Von home.js und expenses.js genutzt.
 * @param {object|null} existing null = neue Ausgabe
 * @param {Function} onSaved
 */
export function openExpenseModal(existing, onSaved) {
  const categories = getCategories();
  let categoryId = existing?.categoryId || categories[0].id;
  let recurringInterval = existing?.recurringInterval || 'monthly';
  let categoryManuallySet = !!existing; // beim Bearbeiten nie automatisch ueberschreiben

  function content() {
    return `
      <h3 class="modal-title">${existing ? 'Ausgabe bearbeiten' : 'Ausgabe erfassen'}</h3>
      <button class="btn btn-ghost" id="exp-scan" type="button" style="margin-bottom:14px">📷 Beleg scannen</button>
      <input type="file" accept="image/*" id="exp-scan-input" hidden>
      <p class="faint" id="exp-scan-status" hidden style="margin:-6px 0 14px"></p>
      <div class="field">
        <label>Betrag</label>
        <input class="input" type="number" inputmode="decimal" id="exp-amount" min="0" step="0.01" value="${existing?.amount ?? ''}" placeholder="0.00">
      </div>
      <div class="field">
        <label>Datum</label>
        <input class="input" type="date" id="exp-date" value="${existing?.date || todayKey()}">
      </div>
      <div class="field">
        <label>Kategorie</label>
        <div class="chip-row" id="exp-cat-row">
          ${categories.map((c) => `<button class="chip ${c.id === categoryId ? 'active' : ''}" data-cat="${c.id}">${c.icon} ${escapeHtml(c.name)}</button>`).join('')}
        </div>
      </div>
      <div class="field">
        <label>Händler / Bezeichnung (optional)</label>
        <input class="input" id="exp-merchant" value="${escapeHtml(existing?.merchant || '')}" placeholder="z.B. Rewe">
      </div>
      <div class="field">
        <label>Notiz (optional)</label>
        <textarea class="input" id="exp-note">${escapeHtml(existing?.note || '')}</textarea>
      </div>
      <div class="switch-row">
        <p>Wiederkehrend</p>
        <label class="switch">
          <input type="checkbox" id="exp-recurring" ${existing?.recurring ? 'checked' : ''}>
          <span class="switch__track"></span><span class="switch__thumb"></span>
        </label>
      </div>
      <div class="field" id="exp-interval-wrap" style="${existing?.recurring ? '' : 'display:none'}">
        <label>Rhythmus</label>
        <div class="chip-row">
          <button type="button" class="chip ${(existing?.recurringInterval || 'monthly') === 'monthly' ? 'active' : ''}" data-interval="monthly">Monatlich</button>
          <button type="button" class="chip ${existing?.recurringInterval === 'yearly' ? 'active' : ''}" data-interval="yearly">Jährlich</button>
        </div>
      </div>
      <div class="switch-row" style="padding-bottom:0">
        <p>Steuerlich relevant</p>
        <label class="switch">
          <input type="checkbox" id="exp-tax" ${existing?.taxRelevant ? 'checked' : ''}>
          <span class="switch__track"></span><span class="switch__thumb"></span>
        </label>
      </div>
      <div class="stack" style="margin-top:16px">
        <button class="btn btn-primary" id="exp-save">Speichern</button>
        ${existing ? '<button class="btn btn-danger" id="exp-delete">Löschen</button>' : ''}
      </div>
    `;
  }

  const handle = openModal(content(), { center: true });
  wire();

  function applySuggestionIfNeeded() {
    if (categoryManuallySet) return;
    const suggestion = suggestCategoryForMerchant(handle.sheet.querySelector('#exp-merchant').value);
    if (!suggestion || suggestion === categoryId) return;
    categoryId = suggestion;
    handle.sheet.querySelectorAll('[data-cat]').forEach((x) => x.classList.toggle('active', x.dataset.cat === categoryId));
    toast('Kategorie anhand früherer Einträge vorgeschlagen');
  }

  function wire() {
    handle.sheet.querySelector('#exp-scan').addEventListener('click', () => {
      handle.sheet.querySelector('#exp-scan-input').click();
    });
    handle.sheet.querySelector('#exp-scan-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const scanBtn = handle.sheet.querySelector('#exp-scan');
      const status = handle.sheet.querySelector('#exp-scan-status');
      scanBtn.disabled = true;
      status.hidden = false;
      status.textContent = 'Beleg wird erkannt … (beim ersten Mal laedt die OCR-Engine, das dauert etwas laenger)';
      try {
        const text = await recognizeText(file, (info) => {
          if (info.status === 'recognizing text') {
            status.textContent = `Text wird erkannt … ${Math.round(info.progress * 100)}%`;
          }
        });
        const parsed = parseReceiptText(text);
        if (parsed.amount !== null) handle.sheet.querySelector('#exp-amount').value = parsed.amount.toFixed(2);
        if (parsed.date) handle.sheet.querySelector('#exp-date').value = parsed.date;
        if (parsed.merchant) { handle.sheet.querySelector('#exp-merchant').value = parsed.merchant; applySuggestionIfNeeded(); }
        status.textContent = (parsed.amount === null && !parsed.date && !parsed.merchant)
          ? 'Konnte nichts Eindeutiges erkennen - bitte manuell eintragen.'
          : 'Erkannt - bitte pruefen und bei Bedarf korrigieren.';
      } catch (err) {
        status.textContent = 'Beleg-Scan fehlgeschlagen. Bitte manuell eintragen.';
      } finally {
        scanBtn.disabled = false;
      }
    });
    handle.sheet.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => {
      categoryId = b.dataset.cat;
      categoryManuallySet = true;
      handle.sheet.querySelectorAll('[data-cat]').forEach((x) => x.classList.toggle('active', x.dataset.cat === categoryId));
    }));
    handle.sheet.querySelector('#exp-merchant').addEventListener('blur', applySuggestionIfNeeded);
    handle.sheet.querySelectorAll('[data-interval]').forEach((b) => b.addEventListener('click', () => {
      recurringInterval = b.dataset.interval;
      handle.sheet.querySelectorAll('[data-interval]').forEach((x) => x.classList.toggle('active', x.dataset.interval === recurringInterval));
    }));
    handle.sheet.querySelector('#exp-recurring').addEventListener('change', (e) => {
      handle.sheet.querySelector('#exp-interval-wrap').style.display = e.target.checked ? '' : 'none';
    });
    handle.sheet.querySelector('#exp-save').addEventListener('click', async () => {
      const amount = Number(handle.sheet.querySelector('#exp-amount').value);
      if (!amount || amount <= 0) { toast('Bitte einen Betrag eingeben'); return; }
      const date = handle.sheet.querySelector('#exp-date').value || todayKey();
      const merchant = handle.sheet.querySelector('#exp-merchant').value.trim();
      const note = handle.sheet.querySelector('#exp-note').value.trim();
      const recurring = handle.sheet.querySelector('#exp-recurring').checked;
      const taxRelevant = handle.sheet.querySelector('#exp-tax').checked;
      if (!existing) {
        // Duplikat-Warnung (E-Budget-Duplikat-Warnung): faengt versehentliches
        // Doppelt-Erfassen ab (z.B. Beleg zweimal gescannt) - bewusst nur
        // gleicher Betrag AM GLEICHEN TAG, nicht ueberhaupt jemals, sonst
        // wuerde jeder zufaellig gleich teure Kauf an einem anderen Tag warnen.
        const dupes = getExpenses().filter((e) => e.date === date && e.amount === amount);
        if (dupes.length) {
          const names = dupes.map((e) => e.merchant || 'ohne Bezeichnung').join(', ');
          const ok = await confirmDialog(
            'Möglicherweise doppelt erfasst',
            `Am ${formatDateKey(date)} gibt es bereits eine Ausgabe über ${formatMoney(amount, getSettings().currency)} (${escapeHtml(names)}). Trotzdem speichern?`,
            'Trotzdem speichern', false
          );
          if (!ok) return;
        }
      }
      let saved;
      if (existing) {
        saved = saveExpense({ ...existing, amount, date, categoryId, merchant, note, recurring, recurringInterval, taxRelevant });
      } else {
        saved = createExpense({ amount, date, categoryId, merchant, note, recurring, recurringInterval, taxRelevant });
      }
      // Plant den naechsten Zyklus SOFORT vorausschauend ein (E-Budget-Recurring-Vorausplanung),
      // statt ihn erst nachtraeglich zu erzeugen, sobald er schon faellig ist.
      ensureNextRecurringOccurrence(saved);
      toast('Gespeichert');
      handle.close();
      onSaved?.();
    });
    handle.sheet.querySelector('#exp-delete')?.addEventListener('click', async () => {
      const ok = await confirmDialog('Ausgabe löschen?', 'Dieser Eintrag wird unwiderruflich gelöscht.');
      if (!ok) return;
      deleteExpense(existing.id);
      toast('Gelöscht');
      handle.close();
      onSaved?.();
    });
  }
}

export function openIncomeModal(existing, onSaved) {
  const isNew = !existing?.id;
  const handle = openModal(`
    <h3 class="modal-title">${isNew ? 'Einnahme erfassen' : 'Einnahme bearbeiten'}</h3>
    <div class="field">
      <label>Betrag</label>
      <input class="input" type="number" inputmode="decimal" id="inc-amount" min="0" step="0.01" value="${existing?.amount ?? ''}" placeholder="0.00">
    </div>
    <div class="field">
      <label>Datum</label>
      <input class="input" type="date" id="inc-date" value="${existing?.date || todayKey()}">
    </div>
    <div class="field">
      <label>Quelle (optional)</label>
      <input class="input" id="inc-source" value="${escapeHtml(existing?.source || '')}" placeholder="z.B. Gehalt, Nebenjob">
    </div>
    <div class="field">
      <label>Notiz (optional)</label>
      <textarea class="input" id="inc-note">${escapeHtml(existing?.note || '')}</textarea>
    </div>
    <div class="switch-row">
      <p>Wiederkehrend</p>
      <label class="switch">
        <input type="checkbox" id="inc-recurring" ${existing?.recurring ? 'checked' : ''}>
        <span class="switch__track"></span><span class="switch__thumb"></span>
      </label>
    </div>
    <div class="stack" style="margin-top:16px">
      <button class="btn btn-primary" id="inc-save">Speichern</button>
      ${!isNew ? '<button class="btn btn-danger" id="inc-delete">Löschen</button>' : ''}
    </div>
  `, { center: true });

  handle.sheet.querySelector('#inc-save').addEventListener('click', async () => {
    const amount = Number(handle.sheet.querySelector('#inc-amount').value);
    if (!amount || amount <= 0) { toast('Bitte einen Betrag eingeben'); return; }
    const date = handle.sheet.querySelector('#inc-date').value || todayKey();
    const source = handle.sheet.querySelector('#inc-source').value.trim();
    const note = handle.sheet.querySelector('#inc-note').value.trim();
    const recurring = handle.sheet.querySelector('#inc-recurring').checked;
    if (isNew) {
      const dupes = getIncome().filter((i) => i.date === date && i.amount === amount);
      if (dupes.length) {
        const names = dupes.map((i) => i.source || 'ohne Bezeichnung').join(', ');
        const ok = await confirmDialog(
          'Möglicherweise doppelt erfasst',
          `Am ${formatDateKey(date)} gibt es bereits eine Einnahme über ${formatMoney(amount, getSettings().currency)} (${escapeHtml(names)}). Trotzdem speichern?`,
          'Trotzdem speichern', false
        );
        if (!ok) return;
      }
      const saved = createIncome({ amount, date, source, note, recurring });
      ensureNextRecurringIncomeOccurrence(saved);
    } else {
      const saved = saveIncome({ ...existing, amount, date, source, note, recurring });
      ensureNextRecurringIncomeOccurrence(saved);
    }
    toast('Gespeichert');
    handle.close();
    onSaved?.();
  });
  handle.sheet.querySelector('#inc-delete')?.addEventListener('click', async () => {
    const ok = await confirmDialog('Einnahme löschen?', 'Dieser Eintrag wird unwiderruflich gelöscht.');
    if (!ok) return;
    deleteIncome(existing.id);
    toast('Gelöscht');
    handle.close();
    onSaved?.();
  });
}
