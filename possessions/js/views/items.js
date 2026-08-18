import { setTitle, setActions, setBack } from '../router.js';
import {
  getItems, getItemById, createItem, saveItem, deleteItem, categoryLabel, CATEGORIES, totalValue,
  suggestLifespanMonths, estimatedCurrentValue, suggestedMonthlyReserve, totalSuggestedMonthlyReserve,
  getSubcategoriesForCategory, addAttachment, removeAttachment, getAttachmentUrl, attachmentsSupported,
  addSparePart, removeSparePart, markSparePartReplaced, sparePartNextDue,
} from '../db.js';
import { openModal, confirmDialog, toast } from '../ui.js';
import { todayKey, formatDateKey, formatMoney, escapeHtml, compressImageFile } from '../utils.js';
import { recognizeText, parseReceiptText } from '../../../shared/receipt-ocr.js';

let searchOpen = false;
let searchQuery = '';

export function render() {
  setTitle('Inventar');
  setBack(null);
  setActions(`
    <button class="icon-btn" id="item-search" aria-label="Suchen">
      <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
    </button>
  `);
  draw();
  document.getElementById('item-search').addEventListener('click', () => {
    searchOpen = !searchOpen;
    if (!searchOpen) searchQuery = '';
    draw();
  });

  const q = new URLSearchParams((location.hash.split('?')[1] || ''));
  const openId = q.get('open');
  if (openId) {
    const item = getItemById(openId);
    if (item) openItemModal(item, draw);
  }
}

function matchesSearch(i) {
  if (!searchQuery.trim()) return true;
  const needle = searchQuery.trim().toLowerCase();
  const haystack = [i.name, i.serialNumber, i.subcategory, categoryLabel(i.category), i.retailer, i.note].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(needle);
}

// Ein-/ausgeklappter Zustand je Oberkategorie und je Unterkategorie
// (E-Inventar-Verschachtelung) - Default offen, damit beim ersten Aufruf
// nichts scheinbar "verschwunden" ist; Schluessel bleiben ueber draw()-Aufrufe
// hinweg erhalten (Modul-Zustand), gehen nur beim vollen Reload verloren.
const collapsedCategories = new Set();
const collapsedSubcats = new Set(); // Schluessel: `${category}::${subcategory}`

function collapseChevronSvg(collapsed) {
  return `
    <svg class="collapse-chevron ${collapsed ? '' : 'collapse-chevron--open'}" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 9l6 6 6-6"/>
    </svg>
  `;
}

/** Gruppiert Gegenstaende nach Oberkategorie (in CATEGORIES-Reihenfolge,
 *  nur Kategorien mit mindestens einem Gegenstand) und darin nach
 *  Unterkategorie (Gegenstaende ohne Unterkategorie zuerst, ohne eigene
 *  Zwischenueberschrift). */
function groupItems(items) {
  const byCategory = new Map();
  for (const i of items) {
    if (!byCategory.has(i.category)) byCategory.set(i.category, new Map());
    const subMap = byCategory.get(i.category);
    const subKey = i.subcategory || '';
    if (!subMap.has(subKey)) subMap.set(subKey, []);
    subMap.get(subKey).push(i);
  }
  const orderedKeys = [...CATEGORIES.map((c) => c.key), ...[...byCategory.keys()].filter((k) => !CATEGORIES.some((c) => c.key === k))];
  return orderedKeys.filter((k) => byCategory.has(k)).map((key) => ({
    key,
    label: categoryLabel(key),
    subgroups: [...byCategory.get(key).entries()].sort(([a], [b]) => a.localeCompare(b, 'de')),
    count: [...byCategory.get(key).values()].reduce((sum, arr) => sum + arr.length, 0),
  }));
}

function itemRowHtml(i) {
  const value = i.currentValue ?? estimatedCurrentValue(i);
  const estimated = i.currentValue == null && value !== null;
  return `
    <div class="due-row" data-open="${i.id}" style="cursor:pointer">
      <div class="col grow" style="min-width:0">
        <p class="due-row__title truncate">${escapeHtml(i.name)}</p>
        ${i.serialNumber ? `<p class="due-row__meta">${escapeHtml(i.serialNumber)}</p>` : ''}
      </div>
      ${value != null || i.purchasePrice ? `<span class="due-row__date">${estimated ? '≈ ' : ''}${formatMoney(value ?? i.purchasePrice)}</span>` : ''}
    </div>
  `;
}

function draw() {
  const view = document.getElementById('view');
  const items = getItems();
  const searching = !!searchQuery.trim();
  const visibleItems = searching ? items.filter(matchesSearch) : items;
  const reserve = totalSuggestedMonthlyReserve();
  const groups = groupItems(visibleItems);
  view.innerHTML = `
    ${searchOpen ? `
      <div class="field" style="margin-bottom:14px">
        <input class="input" id="item-search-input" type="search" placeholder="Suchen …" value="${escapeHtml(searchQuery)}">
      </div>
    ` : ''}
    ${items.length > 0 && !searching ? `
      <div class="stat-tile" style="margin-bottom:14px">
        <div class="stat-tile__value">${formatMoney(totalValue())}</div>
        <div class="stat-tile__label">Gesamtwert (aktueller bzw. geschätzter Wert)</div>
      </div>
    ` : ''}
    ${reserve > 0 && !searching ? `
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
    ` : visibleItems.length === 0 ? `
      <div class="empty">
        <h3>Keine Treffer</h3>
        <p class="faint">Andere Suche versuchen.</p>
      </div>
    ` : groups.map((g) => {
      const catCollapsed = !searching && collapsedCategories.has(g.key);
      return `
        <button type="button" class="cat-group-header" data-toggle-cat="${g.key}">
          ${collapseChevronSvg(catCollapsed)}
          <span class="grow" style="text-align:left">${escapeHtml(g.label)}</span>
          <span class="faint">${g.count}</span>
        </button>
        ${catCollapsed ? '' : `
          <div class="card" style="margin-bottom:14px">
            ${g.subgroups.map(([subKey, subItems]) => {
              if (!subKey) return subItems.map(itemRowHtml).join('');
              const subCollapseKey = `${g.key}::${subKey}`;
              const subCollapsed = !searching && collapsedSubcats.has(subCollapseKey);
              return `
                <button type="button" class="subcat-group-header" data-toggle-subcat="${escapeHtml(subCollapseKey)}">
                  ${collapseChevronSvg(subCollapsed)}
                  <span class="grow" style="text-align:left">${escapeHtml(subKey)}</span>
                  <span class="faint">${subItems.length}</span>
                </button>
                ${subCollapsed ? '' : subItems.map(itemRowHtml).join('')}
              `;
            }).join('')}
          </div>
        `}
      `;
    }).join('')}
    <button class="btn btn-primary" id="item-add" style="margin-top:16px">+ Gegenstand</button>
  `;
  view.querySelectorAll('[data-open]').forEach((el) => {
    el.addEventListener('click', () => openItemModal(getItemById(el.dataset.open), draw));
  });
  view.querySelectorAll('[data-toggle-cat]').forEach((el) => {
    el.addEventListener('click', () => {
      const key = el.dataset.toggleCat;
      if (collapsedCategories.has(key)) collapsedCategories.delete(key); else collapsedCategories.add(key);
      draw();
    });
  });
  view.querySelectorAll('[data-toggle-subcat]').forEach((el) => {
    el.addEventListener('click', () => {
      const key = el.dataset.toggleSubcat;
      if (collapsedSubcats.has(key)) collapsedSubcats.delete(key); else collapsedSubcats.add(key);
      draw();
    });
  });
  document.getElementById('item-add').addEventListener('click', () => openItemModal(null, draw));
  document.getElementById('item-reserve-link')?.addEventListener('click', () => {
    const params = new URLSearchParams({ envName: 'Ersatzbeschaffung', envAmount: reserve.toFixed(2) });
    location.href = `../budget/#/savings?${params.toString()}`;
  });
  const searchInput = document.getElementById('item-search-input');
  if (searchInput) {
    searchInput.focus();
    searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      draw();
    });
  }
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
    ${!isNew ? `
      <div class="field" id="i-spareparts-field">
        <label>Ersatzteile (optional) — eigene, kürzere Nutzungsdauer als der Gegenstand selbst (z.B. Bügelbrett-Bezug alle 3-5 Jahre, Gestell 10-20 Jahre)</label>
        <div id="i-spareparts-list"></div>
        <div class="row" style="gap:8px;margin-top:8px">
          <input class="input" id="i-sp-name" placeholder="Bezeichnung, z.B. Bezug" style="flex:2">
          <input class="input" type="number" min="0" id="i-sp-months" placeholder="Monate" style="flex:1">
          <button class="btn btn-ghost btn-sm" id="i-sp-add" type="button">+</button>
        </div>
      </div>
    ` : ''}
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
    renderSpareParts();
    handle.sheet.querySelector('#i-sp-add').addEventListener('click', () => {
      const name = handle.sheet.querySelector('#i-sp-name').value.trim();
      const months = handle.sheet.querySelector('#i-sp-months').value;
      if (!name || !months) { toast('Bitte Bezeichnung und Monate angeben'); return; }
      addSparePart(existing.id, { name, lifespanMonths: Number(months) });
      handle.sheet.querySelector('#i-sp-name').value = '';
      handle.sheet.querySelector('#i-sp-months').value = '';
      renderSpareParts();
    });
  }

  function renderSpareParts() {
    const list = handle.sheet.querySelector('#i-spareparts-list');
    if (!list) return;
    const current = getItemById(existing.id);
    const parts = current?.spareParts || [];
    list.innerHTML = parts.length === 0
      ? `<p class="faint">Noch keine Ersatzteile hinterlegt.</p>`
      : parts.map((p) => {
        const due = sparePartNextDue(current, p);
        const overdue = due && due <= todayKey();
        return `
          <div class="row row--between" style="padding:6px 0">
            <div class="col grow" style="min-width:0">
              <span class="truncate">${escapeHtml(p.name)} · alle ${p.lifespanMonths} Monate</span>
              ${due ? `<span class="faint ${overdue ? 'due-row__date--overdue' : ''}" style="display:block">nächster Wechsel: ${formatDateKey(due)}</span>` : ''}
            </div>
            <div class="row" style="gap:2px;flex-shrink:0">
              <button class="icon-btn" data-sp-replaced="${p.id}" aria-label="Als gewechselt markieren"><svg viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></button>
              <button class="icon-btn" data-sp-del="${p.id}" aria-label="Entfernen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg></button>
            </div>
          </div>
        `;
      }).join('');
    list.querySelectorAll('[data-sp-replaced]').forEach((b) => b.addEventListener('click', () => {
      markSparePartReplaced(existing.id, b.dataset.spReplaced);
      toast('Als gewechselt markiert');
      renderSpareParts();
    }));
    list.querySelectorAll('[data-sp-del]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await confirmDialog('Ersatzteil entfernen?', 'Wird unwiderruflich gelöscht.');
      if (!ok) return;
      removeSparePart(existing.id, b.dataset.spDel);
      toast('Entfernt');
      renderSpareParts();
    }));
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
