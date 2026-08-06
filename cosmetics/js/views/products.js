import { setTitle, setActions, setBack } from '../router.js';
import {
  getProducts, getProductById, createProduct, saveProduct, deleteProduct, markOpened,
  computeExpiry, categoryLabel, CATEGORIES, PAO_PRESETS,
} from '../db.js';
import { openModal, confirmDialog, toast } from '../ui.js';
import { formatDateKey, escapeHtml, compressImageFile } from '../utils.js';

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
          return `
            <div class="due-row" data-open="${p.id}" style="cursor:pointer">
              <div class="col grow" style="min-width:0">
                <p class="due-row__title truncate">${escapeHtml(p.name)}</p>
                <p class="due-row__meta">${escapeHtml(categoryLabel(p.category))}${p.brand ? ' · ' + escapeHtml(p.brand) : ''}</p>
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
  const isNew = !existing;
  let photoData = existing?.photo || null;
  let expiryMode = existing?.expiryMode || 'pao';
  let paoMonths = existing?.paoMonths ?? 12;

  const handle = openModal(`
    <h3 class="modal-title">${isNew ? 'Produkt anlegen' : 'Produkt bearbeiten'}</h3>
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

  handle.sheet.querySelector('#p-save').addEventListener('click', () => {
    const name = handle.sheet.querySelector('#p-name').value.trim();
    if (!name) { toast('Bitte einen Namen eingeben'); return; }
    const fields = {
      name,
      brand: handle.sheet.querySelector('#p-brand').value.trim(),
      size: handle.sheet.querySelector('#p-size').value.trim(),
      category: handle.sheet.querySelector('#p-category').value,
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
  handle.sheet.querySelector('#p-delete')?.addEventListener('click', async () => {
    const ok = await confirmDialog('Produkt löschen?', 'Wird unwiderruflich gelöscht.');
    if (!ok) return;
    deleteProduct(existing.id);
    toast('Gelöscht');
    handle.close();
    onSaved?.();
  });
}
