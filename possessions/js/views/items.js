import { setTitle, setActions, setBack } from '../router.js';
import {
  getItems, getItemById, createItem, saveItem, deleteItem, categoryLabel, CATEGORIES, totalValue,
  suggestLifespanMonths, estimatedCurrentValue, suggestedMonthlyReserve, totalSuggestedMonthlyReserve,
  getSubcategoriesForCategory, addAttachment, removeAttachment, getAttachmentUrl, attachmentsSupported,
} from '../db.js';
import { openModal, confirmDialog, toast } from '../ui.js';
import { todayKey, formatDateKey, formatMoney, escapeHtml, compressImageFile } from '../utils.js';
import { recognizeText, parseReceiptText } from '../../../shared/receipt-ocr.js';

export function render() {
  setTitle('Inventar');
  setBack(null);
  setActions('');
  draw();

  const q = new URLSearchParams((location.hash.split('?')[1] || ''));
  const openId = q.get('open');
  if (openId) {
    const item = getItemById(openId);
    if (item) openItemModal(item, draw);
  }
}

function draw() {
  const view = document.getElementById('view');
  const items = getItems();
  const reserve = totalSuggestedMonthlyReserve();
  view.innerHTML = `
    ${items.length > 0 ? `
      <div class="stat-tile" style="margin-bottom:14px">
        <div class="stat-tile__value">${formatMoney(totalValue())}</div>
        <div class="stat-tile__label">Gesamtwert (aktueller bzw. geschätzter Wert)</div>
      </div>
    ` : ''}
    ${reserve > 0 ? `
      <div class="card" style="margin-bottom:14px">
        <div class="row row--between">
          <div class="col">
            <p>Empfohlene Ersatz-Rücklage</p>
            <p class="faint">${formatMoney(reserve)}/Monat, aus Nutzungsdauer &amp; Restwert aller Gegenstände</p>
          </div>
          <button class="btn btn-ghost btn-sm" id="item-reserve-link">Sparumschlag anlegen</button>
        </div>
      </div>
    ` : ''}
    ${items.length === 0 ? `
      <div class="empty">
        <h3>Noch keine Gegenstände</h3>
        <p class="faint">Lege Elektronik, Möbel, Werkzeug oder andere Wertsachen mit Seriennummer, Kaufbeleg und Garantie an.</p>
      </div>
    ` : `
      <div class="card">
        ${items.map((i) => {
          const value = i.currentValue ?? estimatedCurrentValue(i);
          const estimated = i.currentValue == null && value !== null;
          return `
          <div class="due-row" data-open="${i.id}" style="cursor:pointer">
            <div class="col grow" style="min-width:0">
              <p class="due-row__title truncate">${escapeHtml(i.name)}</p>
              <p class="due-row__meta">${escapeHtml(categoryLabel(i.category))}${i.subcategory ? ' · ' + escapeHtml(i.subcategory) : ''}${i.serialNumber ? ' · ' + escapeHtml(i.serialNumber) : ''}</p>
            </div>
            ${value != null || i.purchasePrice ? `<span class="due-row__date">${estimated ? '≈ ' : ''}${formatMoney(value ?? i.purchasePrice)}</span>` : ''}
          </div>
        `;
        }).join('')}
      </div>
    `}
    <button class="btn btn-primary" id="item-add" style="margin-top:16px">+ Gegenstand</button>
  `;
  view.querySelectorAll('[data-open]').forEach((el) => {
    el.addEventListener('click', () => openItemModal(getItemById(el.dataset.open), draw));
  });
  document.getElementById('item-add').addEventListener('click', () => openItemModal(null, draw));
  document.getElementById('item-reserve-link')?.addEventListener('click', () => {
    const params = new URLSearchParams({ envName: 'Ersatzbeschaffung', envAmount: reserve.toFixed(2) });
    location.href = `../budget/#/savings?${params.toString()}`;
  });
}

function openItemModal(existing, onSaved) {
  const isNew = !existing;
  let photoData = existing?.photo || null;

  const handle = openModal(`
    <h3 class="modal-title">${isNew ? 'Gegenstand anlegen' : 'Gegenstand bearbeiten'}</h3>
    <button class="btn btn-ghost" id="i-scan" type="button" style="margin-bottom:14px">📷 Kaufbeleg scannen</button>
    <input type="file" accept="image/*" id="i-scan-input" hidden>
    <p class="faint" id="i-scan-status" hidden style="margin:-6px 0 14px"></p>
    <div class="field">
      <label>Name</label>
      <input class="input" id="i-name" value="${escapeHtml(existing?.name || '')}" placeholder="z.B. Laptop Dell XPS 13">
    </div>
    <div class="field">
      <label>Kategorie</label>
      <select class="input" id="i-category">
        ${CATEGORIES.map((c) => `<option value="${c.key}" ${existing?.category === c.key ? 'selected' : ''}>${c.label}</option>`).join('')}
      </select>
    </div>
    <div class="field">
      <label>Unterkategorie (optional)</label>
      <input class="input" id="i-subcategory" value="${escapeHtml(existing?.subcategory || '')}" placeholder="z.B. Fantasy, Kochbuch, ...">
      <div class="chip-row" id="i-subcategory-suggestions" style="margin-top:8px"></div>
    </div>
    <div class="field">
      <label>Seriennummer (optional)</label>
      <input class="input" id="i-serial" value="${escapeHtml(existing?.serialNumber || '')}">
    </div>
    <div class="grid-2">
      <div class="field">
        <label>Kaufdatum</label>
        <input class="input" type="date" id="i-purchase-date" value="${existing?.purchaseDate || ''}">
      </div>
      <div class="field">
        <label>Kaufpreis (optional)</label>
        <input class="input" type="number" min="0" step="0.01" id="i-purchase-price" value="${existing?.purchasePrice ?? ''}">
      </div>
    </div>
    <div class="grid-2">
      <div class="field">
        <label>Aktueller Wert (optional)</label>
        <input class="input" type="number" min="0" step="0.01" id="i-current-value" value="${existing?.currentValue ?? ''}">
      </div>
      <div class="field">
        <label>Händler (optional)</label>
        <input class="input" id="i-retailer" value="${escapeHtml(existing?.retailer || '')}">
      </div>
    </div>
    <div class="field">
      <label>Nutzungsdauer (Monate, optional)</label>
      <input class="input" type="number" min="0" id="i-lifespan" value="${existing?.lifespanMonths ?? ''}" placeholder="für Wert-Schätzung &amp; Ersatz-Rücklage">
    </div>
    <p class="faint" id="i-estimate-hint" style="margin:-8px 0 12px"></p>
    <div class="field">
      <label>Garantie läuft ab (optional)</label>
      <input class="input" type="date" id="i-warranty" value="${existing?.warrantyExpiryDate || ''}">
    </div>
    <div class="field">
      <label>Erinnerung — Tage vor Garantie-Ablauf</label>
      <input class="input" type="number" min="0" id="i-lead" value="${existing?.warrantyReminderLeadDays ?? 30}">
    </div>
    <div class="field">
      <label>Notiz (optional)</label>
      <textarea class="input" id="i-note">${escapeHtml(existing?.note || '')}</textarea>
    </div>
    <div class="field">
      <label>Foto (optional)</label>
      <input class="input" type="file" accept="image/*" id="i-photo">
      <div id="i-photo-preview" style="margin-top:8px">${photoData ? `<img src="${photoData}" style="max-width:100%;border-radius:10px">` : ''}</div>
    </div>
    ${!isNew ? `
      <div class="field" id="i-attachments-field">
        <label>Belege &amp; Dokumente (Kaufbeleg, Garantie-PDF, ...)</label>
        <div id="i-attachments-list"></div>
        ${attachmentsSupported() ? `
          <label class="btn btn-ghost btn-sm" for="i-attachment-input" style="margin-top:8px;width:auto">+ Beleg hinzufügen</label>
          <input type="file" id="i-attachment-input" accept="application/pdf,image/*" hidden>
        ` : `<p class="faint" style="margin-top:8px">Anhänge brauchen eine sichere Verbindung (HTTPS) – funktioniert auf der veröffentlichten App.</p>`}
      </div>
    ` : ''}
    <div class="stack">
      <button class="btn btn-primary" id="i-save">Speichern</button>
      ${!isNew ? '<button class="btn btn-danger" id="i-delete">Löschen</button>' : ''}
    </div>
  `, { center: true });

  function updateEstimateHint() {
    const category = handle.sheet.querySelector('#i-category').value;
    const lifespanRaw = handle.sheet.querySelector('#i-lifespan').value;
    const lifespanMonths = lifespanRaw ? Number(lifespanRaw) : null;
    const purchasePrice = Number(handle.sheet.querySelector('#i-purchase-price').value) || null;
    const purchaseDate = handle.sheet.querySelector('#i-purchase-date').value || null;
    const hint = handle.sheet.querySelector('#i-estimate-hint');
    if (!lifespanMonths) {
      const suggestion = suggestLifespanMonths(category);
      hint.textContent = suggestion ? `Vorschlag für diese Kategorie: ${suggestion} Monate` : '';
      return;
    }
    const est = estimatedCurrentValue({ purchaseDate, purchasePrice, lifespanMonths });
    if (est === null) { hint.textContent = ''; return; }
    const reserve = suggestedMonthlyReserve({ purchaseDate, purchasePrice, lifespanMonths });
    hint.textContent = `≈ geschätzter Wert heute: ${formatMoney(est)} · empfohlene Rücklage: ${formatMoney(reserve)}/Monat`;
  }
  handle.sheet.querySelector('#i-category').addEventListener('change', updateEstimateHint);
  handle.sheet.querySelector('#i-lifespan').addEventListener('input', updateEstimateHint);
  handle.sheet.querySelector('#i-purchase-price').addEventListener('input', updateEstimateHint);
  handle.sheet.querySelector('#i-purchase-date').addEventListener('input', updateEstimateHint);
  updateEstimateHint();

  function renderSubcategorySuggestions() {
    const category = handle.sheet.querySelector('#i-category').value;
    const suggestions = getSubcategoriesForCategory(category);
    const row = handle.sheet.querySelector('#i-subcategory-suggestions');
    row.innerHTML = suggestions.map((s) => `<button type="button" class="chip" data-sub="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('');
    row.querySelectorAll('[data-sub]').forEach((b) => b.addEventListener('click', () => {
      handle.sheet.querySelector('#i-subcategory').value = b.dataset.sub;
    }));
  }
  handle.sheet.querySelector('#i-category').addEventListener('change', renderSubcategorySuggestions);
  renderSubcategorySuggestions();

  if (!isNew) {
    renderAttachments();
    handle.sheet.querySelector('#i-attachment-input')?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      await addAttachment(existing.id, file);
      existing.attachments = getItemById(existing.id).attachments;
      toast('Beleg hinzugefügt');
      renderAttachments();
    });
  }

  function renderAttachments() {
    const list = handle.sheet.querySelector('#i-attachments-list');
    if (!list) return;
    const attachments = getItemById(existing.id)?.attachments || [];
    list.innerHTML = attachments.length === 0
      ? `<p class="faint">Noch keine Belege hinterlegt.</p>`
      : attachments.map((a) => `
        <div class="row row--between" style="padding:6px 0">
          <span class="faint truncate" style="min-width:0">${escapeHtml(a.name)} · ${Math.round(a.sizeBytes / 1024)} KB</span>
          <div class="row" style="gap:2px;flex-shrink:0">
            <button class="icon-btn" data-att-open="${a.id}" aria-label="Öffnen"><svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/></svg></button>
            <button class="icon-btn" data-att-del="${a.id}" aria-label="Entfernen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg></button>
          </div>
        </div>
      `).join('');
    list.querySelectorAll('[data-att-open]').forEach((b) => b.addEventListener('click', async () => {
      const url = await getAttachmentUrl(existing.id, b.dataset.attOpen);
      if (url) window.open(url, '_blank');
      else toast('Beleg nicht gefunden');
    }));
    list.querySelectorAll('[data-att-del]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await confirmDialog('Beleg entfernen?', 'Wird unwiderruflich gelöscht.');
      if (!ok) return;
      await removeAttachment(existing.id, b.dataset.attDel);
      toast('Entfernt');
      renderAttachments();
    }));
  }

  handle.sheet.querySelector('#i-scan').addEventListener('click', () => handle.sheet.querySelector('#i-scan-input').click());
  handle.sheet.querySelector('#i-scan-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const status = handle.sheet.querySelector('#i-scan-status');
    status.hidden = false;
    status.textContent = 'Beleg wird erkannt … (beim ersten Mal laedt die OCR-Engine, das dauert etwas laenger)';
    try {
      const text = await recognizeText(file, (info) => {
        if (info.status === 'recognizing text') status.textContent = `Text wird erkannt … ${Math.round(info.progress * 100)}%`;
      });
      const parsed = parseReceiptText(text);
      if (parsed.amount !== null) handle.sheet.querySelector('#i-purchase-price').value = parsed.amount.toFixed(2);
      if (parsed.date) handle.sheet.querySelector('#i-purchase-date').value = parsed.date;
      if (parsed.merchant) handle.sheet.querySelector('#i-retailer').value = parsed.merchant;
      status.textContent = 'Erkannt - bitte prüfen und bei Bedarf korrigieren.';
    } catch {
      status.textContent = 'Beleg-Scan fehlgeschlagen. Bitte manuell eintragen.';
    }
  });

  handle.sheet.querySelector('#i-photo').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    photoData = await compressImageFile(file);
    handle.sheet.querySelector('#i-photo-preview').innerHTML = `<img src="${photoData}" style="max-width:100%;border-radius:10px">`;
  });

  handle.sheet.querySelector('#i-save').addEventListener('click', () => {
    const name = handle.sheet.querySelector('#i-name').value.trim();
    if (!name) { toast('Bitte einen Namen eingeben'); return; }
    const fields = {
      name,
      category: handle.sheet.querySelector('#i-category').value,
      subcategory: handle.sheet.querySelector('#i-subcategory').value.trim(),
      serialNumber: handle.sheet.querySelector('#i-serial').value.trim(),
      purchaseDate: handle.sheet.querySelector('#i-purchase-date').value || null,
      purchasePrice: handle.sheet.querySelector('#i-purchase-price').value ? Number(handle.sheet.querySelector('#i-purchase-price').value) : null,
      currentValue: handle.sheet.querySelector('#i-current-value').value ? Number(handle.sheet.querySelector('#i-current-value').value) : null,
      lifespanMonths: handle.sheet.querySelector('#i-lifespan').value ? Number(handle.sheet.querySelector('#i-lifespan').value) : null,
      retailer: handle.sheet.querySelector('#i-retailer').value.trim(),
      warrantyExpiryDate: handle.sheet.querySelector('#i-warranty').value || null,
      warrantyReminderLeadDays: Number(handle.sheet.querySelector('#i-lead').value) || 0,
      note: handle.sheet.querySelector('#i-note').value.trim(),
      photo: photoData,
    };
    if (isNew) createItem(fields);
    else saveItem({ ...existing, ...fields });
    toast('Gespeichert');
    handle.close();
    onSaved?.();
  });
  handle.sheet.querySelector('#i-delete')?.addEventListener('click', async () => {
    const ok = await confirmDialog('Gegenstand löschen?', 'Wird unwiderruflich gelöscht.');
    if (!ok) return;
    await deleteItem(existing.id);
    toast('Gelöscht');
    handle.close();
    onSaved?.();
  });
}
