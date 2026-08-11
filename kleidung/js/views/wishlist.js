import { setTitle, setActions, setBack } from '../router.js';
import {
  getWishlistItems, getWishlistItemById, createWishlistItem, updateWishlistItem, deleteWishlistItem, buyWishlistItem,
  categoryLabel, getAllCategories,
} from '../db.js';
import { openModal, confirmDialog, toast } from '../ui.js';
import { escapeHtml, compressImageFile } from '../utils.js';

export function render() {
  setTitle('Wunschliste');
  setBack(null);
  setActions('');
  draw();
}

function draw() {
  const view = document.getElementById('view');
  const items = getWishlistItems();

  view.innerHTML = `
    <p class="faint" style="margin-bottom:14px">Dinge, die du dir wünschst, aber noch nicht besitzt. "Gekauft" verschiebt einen Eintrag direkt in deinen Kleiderschrank.</p>
    ${items.length === 0 ? `
      <div class="empty">
        <h3>Noch nichts auf der Wunschliste</h3>
        <p class="faint">Leg über das Plus unten einen Wunsch an.</p>
      </div>
    ` : `
      <div class="photo-grid">
        ${items.map((i) => `
          <div class="photo-grid__item" data-open="${i.id}" style="cursor:pointer">
            ${i.photo
              ? `<img src="${i.photo}" alt="">`
              : `<div class="photo-grid__item--noimg"><svg viewBox="0 0 24 24"><circle cx="12" cy="5.5" r="1"/><path d="M5 15c0-.75.375-1.375 1.125-1.75l5.375-3a1 1 0 0 1 1 0l5.375 3C18.625 13.625 19 14.25 19 15"/><path d="M5 15h14"/></svg><span class="faint">Kein Foto</span></div>`}
            <div class="photo-grid__caption">
              <div class="photo-grid__title truncate">${escapeHtml(i.name)}</div>
              <div class="photo-grid__meta truncate">${escapeHtml(categoryLabel(i.category))}</div>
            </div>
          </div>
        `).join('')}
      </div>
    `}
    <button class="fab" id="wl-add" aria-label="Wunsch hinzufügen">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
    </button>
  `;

  view.querySelectorAll('[data-open]').forEach((el) => {
    el.addEventListener('click', () => openWishModal(getWishlistItemById(el.dataset.open), draw));
  });
  document.getElementById('wl-add').addEventListener('click', () => openWishModal(null, draw));
}

function openWishModal(existing, onSaved) {
  const isNew = !existing?.id;
  let photoData = existing?.photo || null;

  const handle = openModal(`
    <h3 class="modal-title">${isNew ? 'Wunsch hinzufügen' : 'Wunsch bearbeiten'}</h3>
    <div class="field">
      <label>Name</label>
      <input class="input" id="wl-name" value="${escapeHtml(existing?.name || '')}" placeholder="z.B. Lederjacke">
    </div>
    <div class="field">
      <label>Kategorie</label>
      <select class="input" id="wl-category">
        ${getAllCategories().map((c) => `<option value="${c.key}" ${existing?.category === c.key ? 'selected' : ''}>${escapeHtml(c.label)}</option>`).join('')}
      </select>
    </div>
    <div class="field">
      <label>Link (optional)</label>
      <input class="input" type="url" id="wl-link" value="${escapeHtml(existing?.link || '')}" placeholder="https://…">
    </div>
    <div class="field">
      <label>Notiz (optional)</label>
      <textarea class="input" id="wl-note">${escapeHtml(existing?.note || '')}</textarea>
    </div>
    <div class="field">
      <label>Foto (optional)</label>
      <input class="input" type="file" accept="image/*" id="wl-photo">
      <div id="wl-photo-preview" style="margin-top:8px">${photoData ? `<img src="${photoData}" style="max-width:100%;border-radius:10px">` : ''}</div>
    </div>
    <div class="stack">
      <button class="btn btn-primary" id="wl-save">Speichern</button>
      ${!isNew ? '<button class="btn btn-primary" id="wl-buy">✓ Gekauft - in Kleiderschrank verschieben</button>' : ''}
      ${!isNew ? '<button class="btn btn-danger" id="wl-delete">Löschen</button>' : ''}
    </div>
  `, { center: true });

  handle.sheet.querySelector('#wl-photo').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    photoData = await compressImageFile(file);
    handle.sheet.querySelector('#wl-photo-preview').innerHTML = `<img src="${photoData}" style="max-width:100%;border-radius:10px">`;
  });

  handle.sheet.querySelector('#wl-save').addEventListener('click', () => {
    const name = handle.sheet.querySelector('#wl-name').value.trim();
    if (!name) { toast('Bitte einen Namen eingeben'); return; }
    const fields = {
      name,
      category: handle.sheet.querySelector('#wl-category').value,
      link: handle.sheet.querySelector('#wl-link').value.trim(),
      note: handle.sheet.querySelector('#wl-note').value.trim(),
      photo: photoData,
    };
    if (isNew) createWishlistItem(fields);
    else updateWishlistItem(existing.id, fields);
    toast('Gespeichert');
    handle.close();
    onSaved?.();
  });
  handle.sheet.querySelector('#wl-buy')?.addEventListener('click', async () => {
    const ok = await confirmDialog('Als gekauft markieren?', `"${escapeHtml(existing.name)}" wird in den Kleiderschrank verschoben und von der Wunschliste entfernt.`, 'Verschieben', false);
    if (!ok) return;
    buyWishlistItem(existing.id);
    toast('In den Kleiderschrank verschoben');
    handle.close();
    onSaved?.();
  });
  handle.sheet.querySelector('#wl-delete')?.addEventListener('click', async () => {
    const ok = await confirmDialog('Wunsch löschen?', 'Wird unwiderruflich gelöscht.');
    if (!ok) return;
    deleteWishlistItem(existing.id);
    toast('Gelöscht');
    handle.close();
    onSaved?.();
  });
}
