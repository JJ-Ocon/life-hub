import { setTitle, setActions, setBack } from '../router.js';
import {
  getPantryItems, createPantryItem, adjustPantryQuantity, deletePantryItem, getPantryItemById,
  PANTRY_CATEGORIES, lookupBarcode, cacheBarcode, suggestRecipesFromPantry, getRecipeById,
  extractReceiptItemCandidates,
} from '../db.js';
import { openModal, confirmDialog, toast } from '../ui.js';
import { escapeHtml, formatNum } from '../utils.js';
import { barcodeScanSupported, startBarcodeScan } from '../barcode-scanner.js';
import { recognizeText } from '../../../shared/receipt-ocr.js';

export function render() {
  setTitle('Vorrat');
  setBack(null);
  setActions(`
    <button class="icon-btn" id="pantry-add" aria-label="Hinzufügen">
      <svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
    </button>
  `);
  draw();
  document.getElementById('pantry-add').addEventListener('click', () => openAddMenu());
}

function draw() {
  const view = document.getElementById('view');
  const items = getPantryItems();
  const suggestions = suggestRecipesFromPantry(5);

  view.innerHTML = `
    ${suggestions.length ? `
      <div class="section-title" style="margin-top:0">Rezeptvorschläge aus deinem Vorrat</div>
      <div class="card">
        <div class="stack">
          ${suggestions.map((s) => `
            <div class="row row--between">
              <span>${escapeHtml(s.recipe.name)}</span>
              <span class="faint">${s.matched}/${s.total} Zutaten vorhanden</span>
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}
    <div class="section-title" style="margin-top:${suggestions.length ? '20px' : '0'}">Vorratsliste</div>
    ${items.length === 0 ? `
      <div class="empty">
        <h3>Noch nichts im Vorrat</h3>
        <p class="faint">Füge Produkte manuell oder per Barcode-Scan hinzu.</p>
      </div>
    ` : `
      <div class="card">
        <div class="stack">
          ${items.map((p) => `
            <div class="row row--between">
              <div class="col grow" style="min-width:0;cursor:pointer" data-open="${p.id}">
                <span class="truncate">${escapeHtml(p.name)}</span>
                <span class="faint">${PANTRY_CATEGORIES.find((c) => c.key === p.category)?.label || 'Sonstiges'}</span>
              </div>
              <div class="row" style="gap:4px;flex-shrink:0">
                <button class="icon-btn" data-adjust="${p.id}" data-delta="-1" aria-label="Weniger"><svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg></button>
                <span class="badge" style="min-width:52px;text-align:center">${formatNum(p.quantity, 1)} ${escapeHtml(p.unit)}</span>
                <button class="icon-btn" data-adjust="${p.id}" data-delta="1" aria-label="Mehr"><svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M5 12h14"/></svg></button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `}
  `;

  view.querySelectorAll('[data-adjust]').forEach((el) => {
    el.addEventListener('click', () => {
      adjustPantryQuantity(el.dataset.adjust, Number(el.dataset.delta));
      draw();
    });
  });
  view.querySelectorAll('[data-open]').forEach((el) => {
    el.addEventListener('click', () => openItemDetail(el.dataset.open));
  });
}

function openItemDetail(id) {
  const item = getPantryItemById(id);
  if (!item) return;
  openModal(`
    <h3 class="modal-title">${escapeHtml(item.name)}</h3>
    <p class="faint" style="margin-bottom:14px">${formatNum(item.quantity, 1)} ${escapeHtml(item.unit)} · ${PANTRY_CATEGORIES.find((c) => c.key === item.category)?.label || 'Sonstiges'}</p>
    <button class="btn btn-danger" id="pantry-delete">Aus dem Vorrat entfernen</button>
  `, { center: true }).sheet.querySelector('#pantry-delete').addEventListener('click', async () => {
    const ok = await confirmDialog('Entfernen?', `${escapeHtml(item.name)} wird aus der Vorratsliste entfernt.`);
    if (!ok) return;
    deletePantryItem(id);
    document.querySelectorAll('.modal-overlay').forEach((m) => m.remove());
    toast('Entfernt');
    draw();
  });
}

function openAddMenu() {
  const handle = openModal(`
    <h3 class="modal-title">Zum Vorrat hinzufügen</h3>
    <div class="stack">
      ${barcodeScanSupported() ? '<button class="btn btn-primary" id="add-scan">📷 Barcode scannen</button>' : ''}
      <button class="btn btn-ghost" id="add-receipt">🧾 Kassenbon scannen</button>
      <button class="btn btn-ghost" id="add-manual">✏️ Manuell eingeben</button>
    </div>
    ${barcodeScanSupported() ? '' : '<p class="faint" style="margin-top:12px">Barcode-Scan wird von diesem Browser nicht unterstützt - hier funktionieren Kassenbon-Scan und manuelle Eingabe.</p>'}
  `, { center: true });
  handle.sheet.querySelector('#add-scan')?.addEventListener('click', () => { handle.close(); openScanModal(); });
  handle.sheet.querySelector('#add-receipt').addEventListener('click', () => { handle.close(); openReceiptScanModal(); });
  handle.sheet.querySelector('#add-manual').addEventListener('click', () => { handle.close(); openManualModal(); });
}

/** Kassenbon-Foto per OCR auswerten (E63), fuer spontane Einkaufe ohne
 *  vorherigen Plan in der App - anders als der Barcode-Scan (ein Produkt
 *  pro Scan) liefert das hier mehrere Produkt-KANDIDATEN auf einmal, die
 *  der Nutzer per Checkliste bestaetigt. Bewusst KEINE Mengen-/Einheiten-
 *  Erkennung (shared/receipt-ocr.js liefert dafuer auf Zeilenebene keine
 *  verlaessliche Grundlage) - jede bestaetigte Zeile landet mit Menge 1
 *  Stück im Vorrat und ist danach ganz normal +/- korrigierbar. */
function openReceiptScanModal() {
  const handle = openModal(`
    <h3 class="modal-title">Kassenbon scannen</h3>
    <button class="btn btn-primary" id="receipt-photo" type="button">📷 Foto aufnehmen/auswählen</button>
    <input type="file" accept="image/*" id="receipt-photo-input" hidden>
    <p class="faint" id="receipt-status" style="margin-top:10px"></p>
    <div id="receipt-candidates"></div>
  `, { center: true });

  handle.sheet.querySelector('#receipt-photo').addEventListener('click', () => {
    handle.sheet.querySelector('#receipt-photo-input').click();
  });

  handle.sheet.querySelector('#receipt-photo-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const status = handle.sheet.querySelector('#receipt-status');
    const photoBtn = handle.sheet.querySelector('#receipt-photo');
    photoBtn.disabled = true;
    status.textContent = 'Beleg wird erkannt … (beim ersten Mal laedt die OCR-Engine, das dauert etwas laenger)';
    try {
      const text = await recognizeText(file, (info) => {
        if (info.status === 'recognizing text') {
          status.textContent = `Text wird erkannt … ${Math.round(info.progress * 100)}%`;
        }
      });
      const candidates = extractReceiptItemCandidates(text);
      if (!candidates.length) {
        status.textContent = 'Keine Produktzeilen erkannt - bitte manuell eingeben.';
        photoBtn.disabled = false;
        return;
      }
      status.textContent = `${candidates.length} mögliche Produkte erkannt - bitte prüfen und Menge/Einheit bei Bedarf anpassen.`;
      renderCandidates(candidates);
    } catch {
      status.textContent = 'Beleg konnte nicht erkannt werden - bitte manuell eingeben.';
      photoBtn.disabled = false;
    }
  });

  function renderCandidates(candidates) {
    const list = handle.sheet.querySelector('#receipt-candidates');
    list.innerHTML = `
      <div class="stack" style="margin-top:14px">
        ${candidates.map((c, i) => `
          <div class="row" style="gap:8px; align-items:center">
            <input type="checkbox" id="rc-check-${i}" checked>
            <input class="input" id="rc-name-${i}" value="${escapeHtml(c.name)}" style="flex:2">
            <input class="input" type="number" min="0" step="0.1" id="rc-qty-${i}" value="1" style="flex:1">
            <input class="input" id="rc-unit-${i}" value="Stück" style="flex:1">
          </div>
        `).join('')}
      </div>
      <button class="btn btn-primary" id="rc-add-all" style="margin-top:14px">Ausgewählte hinzufügen</button>
    `;
    list.querySelector('#rc-add-all').addEventListener('click', () => {
      let added = 0;
      candidates.forEach((c, i) => {
        if (!list.querySelector(`#rc-check-${i}`).checked) return;
        const name = list.querySelector(`#rc-name-${i}`).value.trim();
        if (!name) return;
        const quantity = list.querySelector(`#rc-qty-${i}`).value;
        const unit = list.querySelector(`#rc-unit-${i}`).value.trim() || 'Stück';
        createPantryItem({ name, quantity, unit });
        added++;
      });
      toast(`${added} Produkt${added === 1 ? '' : 'e'} hinzugefügt`);
      handle.close();
      draw();
    });
  }
}

function openManualModal(prefill = {}) {
  const handle = openModal(`
    <h3 class="modal-title">${prefill.barcode ? 'Neues Produkt' : 'Vorrat manuell eingeben'}</h3>
    <div class="field">
      <label>Name</label>
      <input class="input" id="pm-name" value="${escapeHtml(prefill.name || '')}" placeholder="z.B. Basmatireis">
    </div>
    <div class="grid-2">
      <div class="field">
        <label>Menge</label>
        <input class="input" type="number" min="0" step="0.1" id="pm-qty" value="${prefill.quantity ?? 1}">
      </div>
      <div class="field">
        <label>Einheit</label>
        <input class="input" id="pm-unit" value="${escapeHtml(prefill.unit || 'Stück')}" placeholder="Stück, g, kg, Packung, ...">
      </div>
    </div>
    <div class="field">
      <label>Kategorie</label>
      <select class="input" id="pm-category">
        ${PANTRY_CATEGORIES.map((c) => `<option value="${c.key}">${c.label}</option>`).join('')}
      </select>
    </div>
    <button class="btn btn-primary" id="pm-save">Speichern</button>
  `, { center: true });

  handle.sheet.querySelector('#pm-save').addEventListener('click', () => {
    const name = handle.sheet.querySelector('#pm-name').value.trim();
    if (!name) { toast('Bitte einen Namen eingeben'); return; }
    const quantity = handle.sheet.querySelector('#pm-qty').value;
    const unit = handle.sheet.querySelector('#pm-unit').value.trim() || 'Stück';
    const category = handle.sheet.querySelector('#pm-category').value;
    if (prefill.barcode) cacheBarcode(prefill.barcode, name, unit);
    createPantryItem({ name, quantity, unit, category, barcode: prefill.barcode || null });
    toast('Hinzugefügt');
    handle.close();
    draw();
  });
}

function openScanModal() {
  const handle = openModal(`
    <h3 class="modal-title">Barcode scannen</h3>
    <video id="scan-video" autoplay playsinline muted style="width:100%;border-radius:var(--radius-m);background:#000"></video>
    <p class="faint" id="scan-status" style="margin-top:10px">Kamera wird gestartet …</p>
  `, { center: true, onClose: () => scanHandle?.stop() });

  let scanHandle = null;
  const status = handle.sheet.querySelector('#scan-status');
  const video = handle.sheet.querySelector('#scan-video');

  startBarcodeScan(video, (code) => {
    handle.close();
    const known = lookupBarcode(code);
    if (known) {
      const handle2 = openModal(`
        <h3 class="modal-title">${escapeHtml(known.name)}</h3>
        <p class="faint" style="margin-bottom:14px">Bereits bekannt (${escapeHtml(known.unit)}). Menge hinzufügen:</p>
        <input class="input" type="number" min="0" step="0.1" id="scan-qty" value="1" style="margin-bottom:14px">
        <button class="btn btn-primary" id="scan-add">Zum Vorrat hinzufügen</button>
      `, { center: true });
      handle2.sheet.querySelector('#scan-add').addEventListener('click', () => {
        const quantity = handle2.sheet.querySelector('#scan-qty').value;
        createPantryItem({ name: known.name, quantity, unit: known.unit, barcode: code });
        toast('Hinzugefügt');
        handle2.close();
        draw();
      });
    } else {
      toast('Neuer Barcode - bitte einmalig Name und Einheit angeben');
      openManualModal({ barcode: code });
    }
  }).then((h) => {
    scanHandle = h;
    status.textContent = 'Kamera aktiv - Barcode ins Bild halten …';
  }).catch(() => {
    status.textContent = 'Kamera konnte nicht gestartet werden (Berechtigung verweigert oder nicht verfügbar).';
  });
}
