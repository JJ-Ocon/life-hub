import { setTitle, setActions, setBack } from '../router.js';
import {
  getItems, getItemById, createItem, saveItem, deleteItem, categoryLabel, getAllCategories, createCustomCategory,
  shuffleOutfit, getStyleRules, LAYERS, layerLabel, incrementDaysWorn, resetDaysWorn,
} from '../db.js';
import { getNotesForApp, updateAssignedNoteContent, unassignNote } from '../../../shared/notes-bridge.js';
import { openModal, confirmDialog, toast, promptDialog } from '../ui.js';
import { escapeHtml, compressImageFile } from '../utils.js';

let activeCategory = 'alle';

export function render() {
  setTitle('Kleiderschrank');
  setBack(null);
  setActions('');
  draw();
}

function draw() {
  const view = document.getElementById('view');
  const items = getItems().filter((i) => activeCategory === 'alle' || i.category === activeCategory);
  const assignedNotes = getNotesForApp('kleidung');

  view.innerHTML = `
    ${assignedNotes.length ? `
      <div class="section-title" style="margin-top:0">📝 Aus Notizen zugeordnet</div>
      <div class="card stack" style="margin-bottom:16px">
        ${assignedNotes.map((n) => `
          <div class="row row--between" data-note-open="${n.id}" style="cursor:pointer">
            <div class="col grow" style="min-width:0">
              ${n.title ? `<span class="truncate" style="font-weight:700">${escapeHtml(n.title)}</span>` : ''}
              <span class="faint truncate">${escapeHtml(n.type === 'checklist' ? (n.items[0]?.text || '') : n.text)}</span>
            </div>
          </div>
        `).join('')}
      </div>
    ` : ''}
    ${getItems().length > 0 ? `<button class="btn btn-primary" id="wd-shuffle" style="margin-bottom:14px">🎲 Outfit mischen</button>` : ''}
    <div class="chip-row" style="margin-bottom:14px" id="wd-filters">
      <div class="chip ${activeCategory === 'alle' ? 'active' : ''}" data-cat="alle">Alle</div>
      ${getAllCategories().map((c) => `<div class="chip ${activeCategory === c.key ? 'active' : ''}" data-cat="${c.key}">${escapeHtml(c.label)}</div>`).join('')}
    </div>
    ${items.length === 0 ? `
      <div class="empty">
        <h3>Noch nichts im Schrank</h3>
        <p class="faint">Leg dein erstes Kleidungsstück mit Foto, Kategorie und Farbe an.</p>
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
              <div class="photo-grid__meta truncate">${escapeHtml(categoryLabel(i.category))}${i.color ? ' · ' + escapeHtml(i.color) : ''}</div>
            </div>
          </div>
        `).join('')}
      </div>
    `}
    <button class="fab" id="wd-add" aria-label="Kleidungsstück hinzufügen">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
    </button>
  `;

  view.querySelectorAll('[data-cat]').forEach((el) => {
    el.addEventListener('click', () => { activeCategory = el.dataset.cat; draw(); });
  });
  view.querySelectorAll('[data-open]').forEach((el) => {
    el.addEventListener('click', () => openItemModal(getItemById(el.dataset.open), draw));
  });
  view.querySelectorAll('[data-note-open]').forEach((node) => {
    const note = assignedNotes.find((n) => n.id === node.dataset.noteOpen);
    node.addEventListener('click', () => openAssignedNoteModal(note));
  });
  document.getElementById('wd-add').addEventListener('click', () => openItemModal(null, draw));
  document.getElementById('wd-shuffle')?.addEventListener('click', openOutfitModal);
}

/** Notizen, die dieser App zugeordnet wurden (E57, ab E61 auch hier statt
 *  nur in Goals) - Notizen bleibt Besitzer, siehe shared/notes-bridge.js. */
function openAssignedNoteModal(note) {
  const isChecklist = note.type === 'checklist';
  const handle = openModal(`
    <h3 class="modal-title">Aus Notizen</h3>
    <div class="field">
      <label>Titel</label>
      <input class="input" id="an-title" value="${escapeHtml(note.title || '')}">
    </div>
    ${isChecklist ? `
      <div class="stack" style="margin-bottom:14px">
        ${(note.items || []).map((it) => `
          <label class="row checklist-row" style="gap:8px">
            <input type="checkbox" class="check-item" data-an-item="${it.id}" ${it.done ? 'checked' : ''}>
            <span class="grow ${it.done ? 'faint' : ''}">${escapeHtml(it.text)}</span>
          </label>
        `).join('')}
      </div>
    ` : `
      <div class="field">
        <label>Text</label>
        <textarea class="input" id="an-text" rows="6">${escapeHtml(note.text || '')}</textarea>
      </div>
    `}
    <div class="stack">
      <button class="btn btn-primary" id="an-save">Speichern</button>
      <a class="btn btn-ghost" href="../notes/#/note/${note.id}">In Notizen öffnen</a>
      <button class="btn btn-ghost" id="an-unassign">Zuordnung aufheben</button>
    </div>
  `, { center: true });

  handle.sheet.querySelectorAll('[data-an-item]').forEach((cb) => {
    cb.addEventListener('change', () => {
      updateAssignedNoteContent(note.id, 'kleidung', { itemId: cb.dataset.anItem, itemDone: cb.checked });
    });
  });
  handle.sheet.querySelector('#an-save').addEventListener('click', () => {
    const title = handle.sheet.querySelector('#an-title').value.trim();
    const patch = { title };
    const textEl = handle.sheet.querySelector('#an-text');
    if (textEl) patch.text = textEl.value;
    updateAssignedNoteContent(note.id, 'kleidung', patch);
    toast('Gespeichert');
    handle.close();
    draw();
  });
  handle.sheet.querySelector('#an-unassign').addEventListener('click', async () => {
    const ok = await confirmDialog('Zuordnung aufheben?', 'Die Notiz bleibt in Notizen bestehen, verschwindet aber aus dieser Liste hier.', 'Aufheben', false);
    if (!ok) return;
    unassignNote(note.id, 'kleidung');
    toast('Zuordnung aufgehoben');
    handle.close();
    draw();
  });
}

function openOutfitModal() {
  const rules = getStyleRules();

  function draw(handle) {
    const outfit = shuffleOutfit();
    const content = handle.sheet.querySelector('#outfit-content');
    if (!outfit) {
      content.innerHTML = `<div class="empty"><h3>Zu wenig im Schrank</h3><p class="faint">Für ein Outfit braucht es mindestens ein Kleid/Rock oder ein Oberteil + eine Hose.</p></div>`;
      return;
    }
    content.innerHTML = `
      <div class="photo-grid">
        ${outfit.map((i) => `
          <div class="photo-grid__item">
            ${i.photo ? `<img src="${i.photo}" alt="">` : `<div class="photo-grid__item--noimg"><span class="faint">Kein Foto</span></div>`}
            <div class="photo-grid__caption">
              <div class="photo-grid__title truncate">${escapeHtml(i.name)}</div>
              <div class="photo-grid__meta truncate">${escapeHtml(categoryLabel(i.category))}</div>
            </div>
          </div>
        `).join('')}
      </div>
      ${rules.length ? `
        <p class="faint" style="margin:14px 0 8px">Denk an deine Style-Regeln:</p>
        <div class="card" style="margin-bottom:0">
          <div class="stack">
            ${rules.map((r) => `<p class="faint">• ${escapeHtml(r.text)}</p>`).join('')}
          </div>
        </div>
      ` : ''}
    `;
  }

  const handle = openModal(`
    <h3 class="modal-title">Outfit-Vorschlag</h3>
    <div id="outfit-content"></div>
    <button class="btn btn-primary" id="outfit-reshuffle" style="margin-top:16px">🎲 Nochmal mischen</button>
  `, { center: true });
  handle.sheet.querySelector('#outfit-reshuffle').addEventListener('click', () => draw(handle));
  draw(handle);
}

function openItemModal(existing, onSaved) {
  const isNew = !existing?.id;
  let photoData = existing?.photo || null;
  let layer = existing?.layer || null;

  function categoryOptionsHtml() {
    return getAllCategories().map((c) => `<option value="${c.key}" ${existing?.category === c.key ? 'selected' : ''}>${escapeHtml(c.label)}</option>`).join('')
      + `<option value="__new__">+ Neue Kategorie…</option>`;
  }

  const handle = openModal(`
    <h3 class="modal-title">${isNew ? 'Kleidungsstück anlegen' : 'Kleidungsstück bearbeiten'}</h3>
    <div class="field">
      <label>Name</label>
      <input class="input" id="w-name" value="${escapeHtml(existing?.name || '')}" placeholder="z.B. Blauer Wollpullover">
    </div>
    <div class="field">
      <label>Kategorie</label>
      <select class="input" id="w-category">${categoryOptionsHtml()}</select>
    </div>
    <div class="grid-2">
      <div class="field">
        <label>Farbe (optional)</label>
        <input class="input" id="w-color" value="${escapeHtml(existing?.color || '')}" placeholder="z.B. Marineblau">
      </div>
      <div class="field">
        <label>Größe (optional)</label>
        <input class="input" id="w-size" value="${escapeHtml(existing?.size || '')}" placeholder="z.B. M">
      </div>
    </div>
    <div class="field">
      <label>Farbton (optional)</label>
      <input type="color" class="color-input" id="w-color-hex" value="${existing?.colorHex || '#888888'}">
    </div>
    <div class="field">
      <label>Schicht (optional, fürs Layering beim Outfit-Mischen)</label>
      <div class="chip-row" id="w-layer-row">
        <button type="button" class="chip ${!layer ? 'active' : ''}" data-layer="">Keine Angabe</button>
        ${LAYERS.map((l) => `<button type="button" class="chip ${layer === l.key ? 'active' : ''}" data-layer="${l.key}">${l.label}</button>`).join('')}
      </div>
    </div>
    ${!isNew ? `
      <div class="field">
        <label>Getragen</label>
        <div class="row row--between">
          <span id="w-wear-count">${existing.daysWorn || 0} Tage getragen</span>
          <div class="row" style="gap:8px">
            <button type="button" class="btn btn-ghost btn-sm" id="w-wear" style="width:auto">+1 Heute getragen</button>
            <button type="button" class="btn btn-ghost btn-sm" id="w-wear-reset" style="width:auto">Zurücksetzen</button>
          </div>
        </div>
      </div>
    ` : ''}
    <div class="field">
      <label>Notiz (optional)</label>
      <textarea class="input" id="w-note">${escapeHtml(existing?.note || '')}</textarea>
    </div>
    <div class="field">
      <label>Foto (optional)</label>
      <input class="input" type="file" accept="image/*" id="w-photo">
      <div id="w-photo-preview" style="margin-top:8px">${photoData ? `<img src="${photoData}" style="max-width:100%;border-radius:10px">` : ''}</div>
    </div>
    <div class="stack">
      <button class="btn btn-primary" id="w-save">Speichern</button>
      ${!isNew ? '<button class="btn btn-danger" id="w-delete">Löschen</button>' : ''}
    </div>
  `, { center: true });

  handle.sheet.querySelector('#w-layer-row').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-layer]');
    if (!btn) return;
    layer = btn.dataset.layer || null;
    handle.sheet.querySelectorAll('[data-layer]').forEach((b) => b.classList.toggle('active', (b.dataset.layer || null) === layer));
  });

  handle.sheet.querySelector('#w-category').addEventListener('change', async (e) => {
    if (e.target.value !== '__new__') return;
    const name = await promptDialog('Neue Kategorie', { placeholder: 'z.B. Sportbekleidung' });
    if (!name) { e.target.value = existing?.category || getAllCategories()[0].key; return; }
    const created = createCustomCategory(name);
    const select = handle.sheet.querySelector('#w-category');
    const opt = document.createElement('option');
    opt.value = created.key;
    opt.textContent = created.label;
    select.insertBefore(opt, select.lastElementChild);
    select.value = created.key;
  });

  handle.sheet.querySelector('#w-photo').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    photoData = await compressImageFile(file);
    handle.sheet.querySelector('#w-photo-preview').innerHTML = `<img src="${photoData}" style="max-width:100%;border-radius:10px">`;
  });

  handle.sheet.querySelector('#w-wear')?.addEventListener('click', () => {
    const updated = incrementDaysWorn(existing.id);
    handle.sheet.querySelector('#w-wear-count').textContent = `${updated.daysWorn} Tage getragen`;
    toast('Getragen erfasst');
  });
  handle.sheet.querySelector('#w-wear-reset')?.addEventListener('click', async () => {
    const ok = await confirmDialog('Tragezähler zurücksetzen?', 'Setzt den Zähler auf 0 zurück.', 'Zurücksetzen', false);
    if (!ok) return;
    const updated = resetDaysWorn(existing.id);
    handle.sheet.querySelector('#w-wear-count').textContent = `${updated.daysWorn} Tage getragen`;
    toast('Zurückgesetzt');
  });

  handle.sheet.querySelector('#w-save').addEventListener('click', () => {
    const name = handle.sheet.querySelector('#w-name').value.trim();
    if (!name) { toast('Bitte einen Namen eingeben'); return; }
    const categoryVal = handle.sheet.querySelector('#w-category').value;
    const fields = {
      name,
      category: categoryVal === '__new__' ? 'sonstiges' : categoryVal,
      color: handle.sheet.querySelector('#w-color').value.trim(),
      colorHex: handle.sheet.querySelector('#w-color-hex').value,
      size: handle.sheet.querySelector('#w-size').value.trim(),
      layer,
      note: handle.sheet.querySelector('#w-note').value.trim(),
      photo: photoData,
    };
    if (isNew) createItem(fields);
    else saveItem({ ...existing, ...fields });
    toast('Gespeichert');
    handle.close();
    onSaved?.();
  });
  handle.sheet.querySelector('#w-delete')?.addEventListener('click', async () => {
    const ok = await confirmDialog('Kleidungsstück löschen?', 'Wird unwiderruflich gelöscht.');
    if (!ok) return;
    deleteItem(existing.id);
    toast('Gelöscht');
    handle.close();
    onSaved?.();
  });
}
