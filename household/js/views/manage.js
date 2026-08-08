import { setTitle, setActions, setBack } from '../router.js';
import {
  getMaintenanceTasks, getMaintenanceTaskById, createMaintenanceTask, saveMaintenanceTask, deleteMaintenanceTask, maintenanceNextDue,
  getContracts, getContractById, createContract, saveContract, deleteContract, contractReminderDate,
  getInvoices, createInvoice, deleteInvoice, INVOICE_CATEGORIES,
} from '../db.js';
import { openModal, confirmDialog, toast } from '../ui.js';
import { todayKey, formatDateKey, formatMoney, escapeHtml } from '../utils.js';
import { recognizeText, parseReceiptText } from '../../../shared/receipt-ocr.js';

let section = 'maintenance'; // 'maintenance' | 'contracts' | 'invoices'

export function render() {
  setTitle('Verwaltung');
  setBack(null);
  setActions('');
  draw();
}

function draw() {
  const view = document.getElementById('view');
  view.innerHTML = `
    <div class="section-tabs">
      <button class="chip ${section === 'maintenance' ? 'active' : ''}" data-sec="maintenance">Wartung</button>
      <button class="chip ${section === 'contracts' ? 'active' : ''}" data-sec="contracts">Verträge</button>
      <button class="chip ${section === 'invoices' ? 'active' : ''}" data-sec="invoices">Rechnungen</button>
    </div>
    <div id="section-body"></div>
    <button class="btn btn-primary" id="section-add" style="margin-top:16px">
      ${section === 'maintenance' ? '+ Wartungsaufgabe' : section === 'contracts' ? '+ Vertrag' : '+ Rechnung ablegen'}
    </button>
  `;
  document.querySelectorAll('[data-sec]').forEach((el) => {
    el.addEventListener('click', () => { section = el.dataset.sec; draw(); });
  });
  document.getElementById('section-add').addEventListener('click', () => {
    if (section === 'maintenance') openMaintenanceModal(null, draw);
    else if (section === 'contracts') openContractModal(null, draw);
    else openInvoiceModal(draw);
  });
  drawSection();
}

function drawSection() {
  const body = document.getElementById('section-body');
  if (section === 'maintenance') {
    const tasks = getMaintenanceTasks();
    body.innerHTML = tasks.length === 0 ? emptyHtml('Noch keine Wartungsaufgaben.') : `
      <div class="card">
        ${tasks.map((t) => `
          <div class="due-row" data-open="${t.id}" style="cursor:pointer">
            <div class="col grow" style="min-width:0">
              <p class="due-row__title truncate">${escapeHtml(t.title)}</p>
              <p class="due-row__meta">alle ${t.intervalMonths} Monate</p>
            </div>
            <span class="due-row__date">${formatDateKey(maintenanceNextDue(t))}</span>
          </div>
        `).join('')}
      </div>
    `;
    body.querySelectorAll('[data-open]').forEach((el) => el.addEventListener('click', () => openMaintenanceModal(getMaintenanceTaskById(el.dataset.open), draw)));
  } else if (section === 'contracts') {
    const contracts = getContracts();
    body.innerHTML = contracts.length === 0 ? emptyHtml('Noch keine Verträge.') : `
      <div class="card">
        ${contracts.map((c) => `
          <div class="due-row" data-open="${c.id}" style="cursor:pointer">
            <div class="col grow" style="min-width:0">
              <p class="due-row__title truncate">${escapeHtml(c.provider)}</p>
              <p class="due-row__meta">${formatMoney(c.monthlyCost)}/Monat · Kündigungsfrist ${formatDateKey(contractReminderDate(c))}</p>
            </div>
          </div>
        `).join('')}
      </div>
    `;
    body.querySelectorAll('[data-open]').forEach((el) => el.addEventListener('click', () => openContractModal(getContractById(el.dataset.open), draw)));
  } else {
    const invoices = getInvoices().slice().sort((a, b) => b.date.localeCompare(a.date));
    body.innerHTML = invoices.length === 0 ? emptyHtml('Noch keine Rechnungen abgelegt.') : `
      <div class="card">
        ${invoices.map((i) => `
          <div class="due-row" data-inv="${i.id}">
            <div class="col grow" style="min-width:0">
              <p class="due-row__title truncate">${escapeHtml(i.merchant || i.category)}</p>
              <p class="due-row__meta">${escapeHtml(i.category)} · ${formatDateKey(i.date)}</p>
            </div>
            <span class="due-row__date">${i.amount ? formatMoney(i.amount) : ''}</span>
            <button class="icon-btn" data-del="${i.id}" aria-label="Löschen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg></button>
          </div>
        `).join('')}
      </div>
    `;
    body.querySelectorAll('[data-del]').forEach((el) => el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = await confirmDialog('Rechnung löschen?', 'Wird unwiderruflich gelöscht.');
      if (!ok) return;
      deleteInvoice(el.dataset.del);
      drawSection();
      toast('Gelöscht');
    }));
  }
}

function emptyHtml(text) {
  return `<div class="empty"><p class="faint">${text}</p></div>`;
}

function openMaintenanceModal(existing, onSaved) {
  const isNew = !existing;
  const handle = openModal(`
    <h3 class="modal-title">${isNew ? 'Wartungsaufgabe anlegen' : 'Wartungsaufgabe bearbeiten'}</h3>
    <div class="field">
      <label>Titel</label>
      <input class="input" id="m-title" value="${escapeHtml(existing?.title || '')}" placeholder="z.B. Rauchmelder-Batterie">
    </div>
    <div class="field">
      <label>Intervall (Monate)</label>
      <input class="input" type="number" min="1" id="m-interval" value="${existing?.intervalMonths || 12}">
    </div>
    <div class="field">
      <label>Zuletzt erledigt am (optional)</label>
      <input class="input" type="date" id="m-last" value="${existing?.lastDone || ''}">
    </div>
    <div class="field">
      <label>Notiz (optional)</label>
      <textarea class="input" id="m-note">${escapeHtml(existing?.note || '')}</textarea>
    </div>
    <div class="stack">
      <button class="btn btn-primary" id="m-save">Speichern</button>
      ${!isNew ? '<button class="btn btn-danger" id="m-delete">Löschen</button>' : ''}
    </div>
  `, { center: true });

  handle.sheet.querySelector('#m-save').addEventListener('click', () => {
    const title = handle.sheet.querySelector('#m-title').value.trim();
    if (!title) { toast('Bitte einen Titel eingeben'); return; }
    const intervalMonths = Number(handle.sheet.querySelector('#m-interval').value) || 12;
    const lastDone = handle.sheet.querySelector('#m-last').value || null;
    const note = handle.sheet.querySelector('#m-note').value.trim();
    if (isNew) createMaintenanceTask({ title, intervalMonths, lastDone, note });
    else saveMaintenanceTask({ ...existing, title, intervalMonths, lastDone, note });
    toast('Gespeichert');
    handle.close();
    onSaved?.();
  });
  handle.sheet.querySelector('#m-delete')?.addEventListener('click', async () => {
    const ok = await confirmDialog('Wartungsaufgabe löschen?', 'Wird unwiderruflich gelöscht.');
    if (!ok) return;
    deleteMaintenanceTask(existing.id);
    toast('Gelöscht');
    handle.close();
    onSaved?.();
  });
}

function openContractModal(existing, onSaved) {
  const isNew = !existing;
  const handle = openModal(`
    <h3 class="modal-title">${isNew ? 'Vertrag anlegen' : 'Vertrag bearbeiten'}</h3>
    <div class="field">
      <label>Anbieter</label>
      <input class="input" id="c-provider" value="${escapeHtml(existing?.provider || '')}" placeholder="z.B. Stadtwerke">
    </div>
    <div class="field">
      <label>Monatliche Kosten</label>
      <input class="input" type="number" min="0" step="0.01" id="c-cost" value="${existing?.monthlyCost || ''}">
    </div>
    <div class="field">
      <label>Vertragsende/Verlängerung am</label>
      <input class="input" type="date" id="c-renewal" value="${existing?.renewalDate || ''}">
    </div>
    <div class="field">
      <label>Kündigungsfrist (Wochen)</label>
      <input class="input" type="number" min="0" id="c-notice" value="${existing?.cancellationNoticeWeeks || 4}">
    </div>
    <div class="field">
      <label>Notiz (optional)</label>
      <textarea class="input" id="c-note">${escapeHtml(existing?.note || '')}</textarea>
    </div>
    <div class="stack">
      <button class="btn btn-primary" id="c-save">Speichern</button>
      ${!isNew ? '<button class="btn btn-danger" id="c-delete">Löschen</button>' : ''}
    </div>
  `, { center: true });

  handle.sheet.querySelector('#c-save').addEventListener('click', () => {
    const provider = handle.sheet.querySelector('#c-provider').value.trim();
    const renewalDate = handle.sheet.querySelector('#c-renewal').value;
    if (!provider || !renewalDate) { toast('Bitte Anbieter und Datum angeben'); return; }
    const monthlyCost = Number(handle.sheet.querySelector('#c-cost').value) || 0;
    const cancellationNoticeWeeks = Number(handle.sheet.querySelector('#c-notice').value) || 0;
    const note = handle.sheet.querySelector('#c-note').value.trim();
    if (isNew) createContract({ provider, monthlyCost, renewalDate, cancellationNoticeWeeks, note });
    else saveContract({ ...existing, provider, monthlyCost, renewalDate, cancellationNoticeWeeks, note });
    toast('Gespeichert');
    handle.close();
    onSaved?.();
  });
  handle.sheet.querySelector('#c-delete')?.addEventListener('click', async () => {
    const ok = await confirmDialog('Vertrag löschen?', 'Wird unwiderruflich gelöscht.');
    if (!ok) return;
    deleteContract(existing.id);
    toast('Gelöscht');
    handle.close();
    onSaved?.();
  });
}

function openInvoiceModal(onSaved) {
  const handle = openModal(`
    <h3 class="modal-title">Rechnung ablegen</h3>
    <button class="btn btn-ghost" id="inv-scan" type="button" style="margin-bottom:14px">📷 Beleg scannen</button>
    <input type="file" accept="image/*" id="inv-scan-input" hidden>
    <p class="faint" id="inv-scan-status" hidden style="margin:-6px 0 14px"></p>
    <div class="field">
      <label>Datum</label>
      <input class="input" type="date" id="inv-date" value="${todayKey()}">
    </div>
    <div class="field">
      <label>Betrag (optional)</label>
      <input class="input" type="number" min="0" step="0.01" id="inv-amount">
    </div>
    <div class="field">
      <label>Händler/Firma (optional)</label>
      <input class="input" id="inv-merchant">
    </div>
    <div class="field">
      <label>Kategorie</label>
      <div class="chip-row" id="cat-row">
        ${INVOICE_CATEGORIES.map((c, i) => `<button class="chip ${i === 0 ? 'active' : ''}" data-cat="${c}">${c}</button>`).join('')}
      </div>
    </div>
    <div class="field">
      <label>Notiz (optional)</label>
      <textarea class="input" id="inv-note"></textarea>
    </div>
    <button class="btn btn-primary" id="inv-save">Speichern</button>
  `, { center: true });

  let category = INVOICE_CATEGORIES[0];
  handle.sheet.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => {
    category = b.dataset.cat;
    handle.sheet.querySelectorAll('[data-cat]').forEach((x) => x.classList.toggle('active', x.dataset.cat === category));
  }));

  handle.sheet.querySelector('#inv-scan').addEventListener('click', () => handle.sheet.querySelector('#inv-scan-input').click());
  handle.sheet.querySelector('#inv-scan-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const status = handle.sheet.querySelector('#inv-scan-status');
    status.hidden = false;
    status.textContent = 'Beleg wird erkannt … (beim ersten Mal laedt die OCR-Engine, das dauert etwas laenger)';
    try {
      const text = await recognizeText(file, (info) => {
        if (info.status === 'recognizing text') status.textContent = `Text wird erkannt … ${Math.round(info.progress * 100)}%`;
      });
      const parsed = parseReceiptText(text);
      if (parsed.amount !== null) handle.sheet.querySelector('#inv-amount').value = parsed.amount.toFixed(2);
      if (parsed.date) handle.sheet.querySelector('#inv-date').value = parsed.date;
      if (parsed.merchant) handle.sheet.querySelector('#inv-merchant').value = parsed.merchant;
      status.textContent = 'Erkannt - bitte prüfen und bei Bedarf korrigieren.';
    } catch {
      status.textContent = 'Beleg-Scan fehlgeschlagen. Bitte manuell eintragen.';
    }
  });

  handle.sheet.querySelector('#inv-save').addEventListener('click', () => {
    const date = handle.sheet.querySelector('#inv-date').value || todayKey();
    const amount = Number(handle.sheet.querySelector('#inv-amount').value) || null;
    const merchant = handle.sheet.querySelector('#inv-merchant').value.trim();
    const note = handle.sheet.querySelector('#inv-note').value.trim();
    createInvoice({ date, amount, merchant, category, note });
    toast('Gespeichert');
    handle.close();
    onSaved?.();
  });
}
