import { setTitle, setActions, setBack } from '../router.js';
import {
  getProducts, getProductById, createProduct, saveProduct, deleteProduct, markOpened, markUsedUp,
  computeExpiry, categoryLabel, CATEGORIES, PAO_PRESETS,
  logUsage, latestRemainingPercent, estimateWeeksRemaining, daysInUse,
} from '../db.js';
import { openModal, confirmDialog, toast } from '../ui.js';
import { todayKey, formatDateKey, escapeHtml, compressImageFile } from '../utils.js';
import { recognizeText, parseReceiptText } from '../../../shared/receipt-ocr.js';

export function render() {
  setTitle('Produkte');
  setBack(null);
  setActions('');
  draw();

  const q = new URLSearchParams((location.hash.split('?')[1] || ''));
  const openId = q.get('open');
  if (openId) {
    const product = getProductById(openId);
    if (product) openProductModal(product, draw);
  }
}

function draw() {
  const view = document.getElementById('view');
  const products = getProducts();
  view.innerHTML = `
    ${products.length === 0 ? `
      <div class="empty">
        <h3>Noch keine Produkte</h3>
        <p class="faint">Lege Pflegeprodukte mit PAO- oder Mindesthaltbarkeitsdatum an, um den Überblick zu behalten.</p>
      </div>
    ` : `
      <div class="card">
        ${products.map((p) => {
          const expiry = computeExpiry(p);
          const remaining = latestRemainingPercent(p.id);
          return `
            <div class="due-row" data-open="${p.id}" style="cursor:pointer">
              <div class="col grow" style="min-width:0">
                <p class="due-row__title truncate">${escapeHtml(p.name)}${p.usedUpDate ? ' · aufgebraucht' : ''}</p>
                <p class="due-row__meta">${escapeHtml(categoryLabel(p.category))}${p.brand ? ' · ' + escapeHtml(p.brand) : ''}${remaining !== null && !p.usedUpDate ? ` · noch ${remaining}%` : ''}</p>
              </div>
              ${expiry ? `<span class="due-row__date">${formatDateKey(expiry)}</span>` : (p.expiryMode === 'pao' ? '<span class="faint">ungeöffnet</span>' : '<span class="faint">–</span>')}
            </div>
          `;
        }).join('')}
      </div>
    `}
    <button class="btn btn-primary" id="product-add" style="margin-top:16px">+ Produkt</button>
  `;
  view.querySelectorAll('[data-open]').forEach((el) => {
    el.addEventListener('click', () => openProductModal(getProductById(el.dataset.open), draw));
  });
  document.getElementById('product-add').addEventListener('click', () => openProductModal(null, draw));
}

function openProductModal(existing, onSaved) {
  const isNew = !existing?.id;
  let photoData = existing?.photo || null;
  let expiryMode = existing?.expiryMode || 'pao';
  let paoMonths = existing?.paoMonths ?? 12;
  const weeksRemaining = !isNew ? estimateWeeksRemaining(existing.id) : null;
  const remaining = !isNew ? latestRemainingPercent(existing.id) : null;
  const usedDays = !isNew ? daysInUse(existing) : null;

  const handle = openModal(`
    <h3 class="modal-title">${isNew ? 'Produkt anlegen' : 'Produkt bearbeiten'}</h3>
    <button class="btn btn-ghost" id="p-scan" type="button" style="margin-bottom:14px">📷 Kaufbeleg scannen</button>
    <input type="file" accept="image/*" id="p-scan-input" hidden>
    <p class="faint" id="p-scan-status" hidden style="margin:-6px 0 14px"></p>
    <div class="field">
      <label>Name</label>
      <input class="input" id="p-name" value="${escapeHtml(existing?.name || '')}" placeholder="z.B. Tagescreme">
    </div>
    <div class="grid-2">
      <div class="field">
        <label>Marke (optional)</label>
        <input class="input" id="p-brand" value="${escapeHtml(existing?.brand || '')}">
      </div>
      <div class="field">
        <label>Größe (optional)</label>
        <input class="input" id="p-size" value="${escapeHtml(existing?.size || '')}" placeholder="z.B. 50ml">
      </div>
    </div>
    <div class="field">
      <label>Kategorie</label>
      <select class="input" id="p-category">
        ${CATEGORIES.map((c) => `<option value="${c.key}" ${existing?.category === c.key ? 'selected' : ''}>${c.label}</option>`).join('')}
      </select>
    </div>
    <div class="grid-2">
      <div class="field">
        <label>Kaufdatum (optional)</label>
        <input class="input" type="date" id="p-purchase-date" value="${existing?.purchaseDate || ''}">
      </div>
      <div class="field">
        <label>Kaufpreis (optional)</label>
        <input class="input" type="number" min="0" step="0.01" id="p-purchase-price" value="${existing?.purchasePrice ?? ''}">
      </div>
    </div>
    <div class="field">
      <label>Händler (optional)</label>
      <input class="input" id="p-retailer" value="${escapeHtml(existing?.retailer || '')}">
    </div>
    ${!isNew ? `
      <div class="field">
        <label>Restmenge${remaining !== null ? `: ${remaining}%` : ' - noch nicht erfasst'}${weeksRemaining !== null ? ` · noch ca. ${weeksRemaining} Wochen` : ''}</label>
        ${remaining !== null ? `<div class="pbar" style="margin-bottom:8px"><div class="pbar__fill" style="width:${remaining}%"></div></div>` : ''}
        <button type="button" class="btn btn-ghost btn-sm" id="p-log-usage">Restmenge aktualisieren</button>
      </div>
      ${existing.usedUpDate ? `
        <p class="faint">Aufgebraucht am ${formatDateKey(existing.usedUpDate)}${usedDays !== null ? ` · ${usedDays} Tage genutzt` : ''}</p>
      ` : `
        <button type="button" class="btn btn-ghost" id="p-used-up" style="margin-bottom:14px">Als aufgebraucht markieren</button>
      `}
    ` : ''}
    <div class="field">
      <label>Verfall</label>
      <div class="chip-row" id="mode-row">
        <button type="button" class="chip ${expiryMode === 'pao' ? 'active' : ''}" data-mode="pao">Nach Anbruch (PAO)</button>
        <button type="button" class="chip ${expiryMode === 'date' ? 'active' : ''}" data-mode="date">Festes Datum (MHD)</button>
      </div>
    </div>
    <div id="pao-fields" style="${expiryMode === 'pao' ? '' : 'display:none'}">
      <div class="field">
        <label>Haltbar nach Anbruch</label>
        <div class="chip-row" id="pao-row">
          ${PAO_PRESETS.map((m) => `<button type="button" class="chip ${paoMonths === m ? 'active' : ''}" data-pao="${m}">${m}M</button>`).join('')}
        </div>
      </div>
      <div class="field">
        <label>Geöffnet am (leer = noch ungeöffnet)</label>
        <input class="input" type="date" id="p-opened" value="${existing?.openedDate || ''}">
      </div>
    </div>
    <div id="date-fields" style="${expiryMode === 'date' ? '' : 'display:none'}">
      <div class="field">
        <label>Mindesthaltbarkeitsdatum</label>
        <input class="input" type="date" id="p-expiry" value="${existing?.expiryDate || ''}">
      </div>
    </div>
    <div class="field">
      <label>Erinnerung — Tage vor Verfall</label>
      <input class="input" type="number" min="0" id="p-lead" value="${existing?.reminderLeadDays ?? 30}">
    </div>
    <div class="field">
      <label>Notiz (optional)</label>
      <textarea class="input" id="p-note">${escapeHtml(existing?.note || '')}</textarea>
    </div>
    <div class="field">
      <label>Foto (optional)</label>
      <input class="input" type="file" accept="image/*" id="p-photo">
      <div id="p-photo-preview" style="margin-top:8px">${photoData ? `<img src="${photoData}" style="max-width:100%;border-radius:10px">` : ''}</div>
    </div>
    <div class="stack">
      <button class="btn btn-primary" id="p-save">Speichern</button>
      ${!isNew && existing?.expiryMode === 'pao' && !existing?.openedDate ? '<button class="btn btn-ghost" id="p-open">Als geöffnet markieren (heute)</button>' : ''}
      ${!isNew ? '<button class="btn btn-danger" id="p-delete">Löschen</button>' : ''}
    </div>
  `, { center: true });

  handle.sheet.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    expiryMode = b.dataset.mode;
    handle.sheet.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('active', x.dataset.mode === expiryMode));
    handle.sheet.querySelector('#pao-fields').style.display = expiryMode === 'pao' ? '' : 'none';
    handle.sheet.querySelector('#date-fields').style.display = expiryMode === 'date' ? '' : 'none';
  }));
  handle.sheet.querySelectorAll('[data-pao]').forEach((b) => b.addEventListener('click', () => {
    paoMonths = Number(b.dataset.pao);
    handle.sheet.querySelectorAll('[data-pao]').forEach((x) => x.classList.toggle('active', Number(x.dataset.pao) === paoMonths));
  }));

  handle.sheet.querySelector('#p-photo').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    photoData = await compressImageFile(file);
    handle.sheet.querySelector('#p-photo-preview').innerHTML = `<img src="${photoData}" style="max-width:100%;border-radius:10px">`;
  });

  handle.sheet.querySelector('#p-scan').addEventListener('click', () => handle.sheet.querySelector('#p-scan-input').click());
  handle.sheet.querySelector('#p-scan-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const status = handle.sheet.querySelector('#p-scan-status');
    status.hidden = false;
    status.textContent = 'Beleg wird erkannt … (beim ersten Mal laedt die OCR-Engine, das dauert etwas laenger)';
    try {
      const text = await recognizeText(file, (info) => {
        if (info.status === 'recognizing text') status.textContent = `Text wird erkannt … ${Math.round(info.progress * 100)}%`;
      });
      const parsed = parseReceiptText(text);
      if (parsed.amount !== null) handle.sheet.querySelector('#p-purchase-price').value = parsed.amount.toFixed(2);
      if (parsed.date) handle.sheet.querySelector('#p-purchase-date').value = parsed.date;
      if (parsed.merchant) handle.sheet.querySelector('#p-retailer').value = parsed.merchant;
      status.textContent = 'Erkannt - bitte prüfen und bei Bedarf korrigieren.';
    } catch {
      status.textContent = 'Beleg-Scan fehlgeschlagen. Bitte manuell eintragen.';
    }
  });

  handle.sheet.querySelector('#p-save').addEventListener('click', () => {
    const name = handle.sheet.querySelector('#p-name').value.trim();
    if (!name) { toast('Bitte einen Namen eingeben'); return; }
    const fields = {
      name,
      brand: handle.sheet.querySelector('#p-brand').value.trim(),
      size: handle.sheet.querySelector('#p-size').value.trim(),
      category: handle.sheet.querySelector('#p-category').value,
      purchaseDate: handle.sheet.querySelector('#p-purchase-date').value || null,
      purchasePrice: handle.sheet.querySelector('#p-purchase-price').value ? Number(handle.sheet.querySelector('#p-purchase-price').value) : null,
      retailer: handle.sheet.querySelector('#p-retailer').value.trim(),
      expiryMode, paoMonths,
      openedDate: handle.sheet.querySelector('#p-opened')?.value || null,
      expiryDate: handle.sheet.querySelector('#p-expiry')?.value || null,
      reminderLeadDays: Number(handle.sheet.querySelector('#p-lead').value) || 0,
      note: handle.sheet.querySelector('#p-note').value.trim(),
      photo: photoData,
    };
    if (isNew) createProduct(fields);
    else saveProduct({ ...existing, ...fields });
    toast('Gespeichert');
    handle.close();
    onSaved?.();
  });
  handle.sheet.querySelector('#p-open')?.addEventListener('click', () => {
    markOpened(existing.id);
    toast('Als geöffnet markiert');
    handle.close();
    onSaved?.();
  });
  handle.sheet.querySelector('#p-log-usage')?.addEventListener('click', () => {
    openUsageLogModal(existing, () => {
      handle.close();
      openProductModal(getProductById(existing.id), onSaved);
    });
  });
  handle.sheet.querySelector('#p-used-up')?.addEventListener('click', async () => {
    const ok = await confirmDialog('Als aufgebraucht markieren?', 'Setzt das heutige Datum als Ende der Nutzungsdauer.', 'Markieren', false);
    if (!ok) return;
    markUsedUp(existing.id);
    toast('Als aufgebraucht markiert');
    handle.close();
    onSaved?.();
  });
  handle.sheet.querySelector('#p-delete')?.addEventListener('click', async () => {
    const ok = await confirmDialog('Produkt löschen?', 'Wird unwiderruflich gelöscht.');
    if (!ok) return;
    deleteProduct(existing.id);
    toast('Gelöscht');
    handle.close();
    onSaved?.();
  });
}

function openUsageLogModal(product, onLogged) {
  const current = latestRemainingPercent(product.id) ?? 100;
  const handle = openModal(`
    <h3 class="modal-title">Restmenge aktualisieren</h3>
    <p class="faint" style="margin:-10px 0 14px">${escapeHtml(product.name)}</p>
    <div class="field">
      <label>Noch übrig (%)</label>
      <input class="input" type="number" min="0" max="100" id="u-percent" value="${current}">
    </div>
    <div class="field">
      <label>Datum</label>
      <input class="input" type="date" id="u-date" value="${todayKey()}">
    </div>
    <button class="btn btn-primary" id="u-save">Speichern</button>
  `, { center: true });

  handle.sheet.querySelector('#u-save').addEventListener('click', () => {
    const percent = Number(handle.sheet.querySelector('#u-percent').value);
    if (Number.isNaN(percent)) { toast('Bitte einen Prozentwert angeben'); return; }
    const date = handle.sheet.querySelector('#u-date').value || todayKey();
    logUsage(product.id, percent, date);
    toast('Gespeichert');
    handle.close();
    onLogged?.();
  });
}
