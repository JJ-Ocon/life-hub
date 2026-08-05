import { setTitle, setActions, setBack } from '../router.js';
import { getCategories, saveCategory, createCategory, deleteCategory, getSettings } from '../db.js';
import { openModal, confirmDialog, toast } from '../ui.js';
import { escapeHtml } from '../utils.js';

export function render() {
  setTitle('Kategorien');
  setBack(null);
  setActions(`
    <button class="icon-btn" id="cat-add" aria-label="Kategorie hinzufügen">
      <svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
    </button>
  `);
  draw();
  document.getElementById('cat-add').addEventListener('click', () => openCategoryModal(null, draw));
}

function draw() {
  const settings = getSettings();
  const categories = getCategories();
  const view = document.getElementById('view');

  view.innerHTML = `
    <p class="faint" style="margin-bottom:14px">Tippe eine Kategorie an, um Name, Farbe oder das monatliche Budget-Limit zu ändern.</p>
    <div class="stack">
      ${categories.map((c) => `
        <div class="card card--tap" data-open="${c.id}" style="margin-bottom:0">
          <div class="row row--between">
            <div class="row">
              <span class="cat-row__dot" style="background:${c.color}"></span>
              <span>${c.icon} ${escapeHtml(c.name)}</span>
            </div>
            <span class="faint">${c.budgetMonthly ? `${c.budgetMonthly} ${settings.currency}/Monat` : 'kein Limit'}</span>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  view.querySelectorAll('[data-open]').forEach((el) => {
    el.addEventListener('click', () => {
      const cat = categories.find((c) => c.id === el.dataset.open);
      openCategoryModal(cat, draw);
    });
  });
}

function openCategoryModal(existing, onSaved) {
  const isNew = !existing;

  const handle = openModal(`
    <h3 class="modal-title">${isNew ? 'Kategorie hinzufügen' : 'Kategorie bearbeiten'}</h3>
    <div class="field">
      <label>Name</label>
      <input class="input" id="cat-name" value="${escapeHtml(existing?.name || '')}" placeholder="z.B. Streaming-Abos">
    </div>
    <div class="row" style="gap:12px; margin-bottom:12px">
      <div class="field" style="flex:1; margin-bottom:0">
        <label>Symbol (Emoji)</label>
        <input class="input" id="cat-icon" value="${existing?.icon || '📦'}" maxlength="4">
      </div>
      <div class="field" style="margin-bottom:0">
        <label>Farbe</label>
        <input type="color" class="color-input" id="cat-color" value="${existing?.color || '#8891a0'}">
      </div>
    </div>
    <div class="field">
      <label>Monatliches Budget-Limit (optional)</label>
      <input class="input" type="number" inputmode="decimal" id="cat-budget" min="0" step="1" value="${existing?.budgetMonthly ?? ''}" placeholder="leer = kein Limit">
    </div>
    <div class="stack" style="margin-top:16px">
      <button class="btn btn-primary" id="cat-save">Speichern</button>
      ${!isNew && existing.id !== 'other' ? '<button class="btn btn-danger" id="cat-delete">Kategorie löschen</button>' : ''}
    </div>
  `, { center: true });

  handle.sheet.querySelector('#cat-save').addEventListener('click', () => {
    const name = handle.sheet.querySelector('#cat-name').value.trim();
    if (!name) { toast('Bitte einen Namen eingeben'); return; }
    const icon = handle.sheet.querySelector('#cat-icon').value.trim() || '📦';
    const color = handle.sheet.querySelector('#cat-color').value;
    const budgetRaw = handle.sheet.querySelector('#cat-budget').value;
    const budgetMonthly = budgetRaw ? Number(budgetRaw) : null;
    if (isNew) {
      createCategory(name, icon, color);
      const created = getCategories()[getCategories().length - 1];
      saveCategory({ ...created, budgetMonthly });
    } else {
      saveCategory({ ...existing, name, icon, color, budgetMonthly });
    }
    toast('Gespeichert');
    handle.close();
    onSaved?.();
  });

  handle.sheet.querySelector('#cat-delete')?.addEventListener('click', async () => {
    const ok = await confirmDialog('Kategorie löschen?', 'Bestehende Ausgaben in dieser Kategorie wandern nach "Sonstiges".');
    if (!ok) return;
    deleteCategory(existing.id);
    toast('Gelöscht');
    handle.close();
    onSaved?.();
  });
}
