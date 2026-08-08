import { setTitle, setActions, setBack } from '../router.js';
import {
  getExpensesForMonth, createExpense, saveExpense, deleteExpense, getExpenseById,
  getCategories, getSettings,
} from '../db.js';
import { openModal, confirmDialog, toast } from '../ui.js';
import { todayKey, monthKey, addMonths, monthLabel, formatDateKey, formatMoney, escapeHtml } from '../utils.js';
import { recognizeText, parseReceiptText } from '../../../shared/receipt-ocr.js';

let cursor = monthKey();

export function render() {
  setTitle('Ausgaben');
  setBack(null);
  setActions(`
    <button class="icon-btn" id="exp-add" aria-label="Ausgabe erfassen">
      <svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
    </button>
  `);
  draw();
  document.getElementById('exp-add').addEventListener('click', () => openExpenseModal(null, draw));
}

function draw() {
  const settings = getSettings();
  const categories = getCategories();
  const list = getExpensesForMonth(cursor);
  const view = document.getElementById('view');

  view.innerHTML = `
    <div class="row row--between cal-nav" style="margin-bottom:14px">
      <button class="icon-btn" id="exp-prev" aria-label="Zurück"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
      <h3>${monthLabel(cursor)}</h3>
      <button class="icon-btn" id="exp-next" aria-label="Weiter"><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>
    </div>
    ${list.length === 0 ? `
      <div class="empty">
        <h3>Noch keine Ausgaben</h3>
        <p class="faint">Erfasse deine erste Ausgabe über das Plus oben rechts.</p>
      </div>
    ` : `
      <div class="stack">
        ${list.map((e) => {
          const cat = categories.find((c) => c.id === e.categoryId) || categories[categories.length - 1];
          return `
            <div class="card card--tap" data-open="${e.id}" style="margin-bottom:0">
              <div class="row row--between">
                <div class="row grow" style="min-width:0">
                  <span style="font-size:1.3rem">${cat.icon}</span>
                  <div class="col grow" style="min-width:0">
                    <p class="truncate">${escapeHtml(e.merchant || cat.name)}</p>
                    <p class="faint">${formatDateKey(e.date)}${e.recurring ? ' · wiederkehrend' : ''}</p>
                  </div>
                </div>
                <div class="badge">${formatMoney(e.amount, settings.currency)}</div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `}
  `;

  document.getElementById('exp-prev').addEventListener('click', () => { cursor = addMonths(cursor, -1); draw(); });
  document.getElementById('exp-next').addEventListener('click', () => { cursor = addMonths(cursor, 1); draw(); });
  view.querySelectorAll('[data-open]').forEach((el) => {
    el.addEventListener('click', () => openExpenseModal(getExpenseById(el.dataset.open), draw));
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
        if (parsed.merchant) handle.sheet.querySelector('#exp-merchant').value = parsed.merchant;
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
      handle.sheet.querySelectorAll('[data-cat]').forEach((x) => x.classList.toggle('active', x.dataset.cat === categoryId));
    }));
    handle.sheet.querySelectorAll('[data-interval]').forEach((b) => b.addEventListener('click', () => {
      recurringInterval = b.dataset.interval;
      handle.sheet.querySelectorAll('[data-interval]').forEach((x) => x.classList.toggle('active', x.dataset.interval === recurringInterval));
    }));
    handle.sheet.querySelector('#exp-recurring').addEventListener('change', (e) => {
      handle.sheet.querySelector('#exp-interval-wrap').style.display = e.target.checked ? '' : 'none';
    });
    handle.sheet.querySelector('#exp-save').addEventListener('click', () => {
      const amount = Number(handle.sheet.querySelector('#exp-amount').value);
      if (!amount || amount <= 0) { toast('Bitte einen Betrag eingeben'); return; }
      const date = handle.sheet.querySelector('#exp-date').value || todayKey();
      const merchant = handle.sheet.querySelector('#exp-merchant').value.trim();
      const note = handle.sheet.querySelector('#exp-note').value.trim();
      const recurring = handle.sheet.querySelector('#exp-recurring').checked;
      const taxRelevant = handle.sheet.querySelector('#exp-tax').checked;
      if (existing) {
        saveExpense({ ...existing, amount, date, categoryId, merchant, note, recurring, recurringInterval, taxRelevant });
      } else {
        createExpense({ amount, date, categoryId, merchant, note, recurring, recurringInterval, taxRelevant });
      }
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
