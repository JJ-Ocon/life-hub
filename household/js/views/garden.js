import { setTitle, setActions, setBack } from '../router.js';
import {
  getPlants, getPlantById, createPlant, savePlant, deletePlant, markPlantWatered, plantNextWaterDue, suggestWateringInterval,
  getPets, getPetById, createPet, savePet, deletePet, markPetVetDone, petNextVetDue,
} from '../db.js';
import { openModal, confirmDialog, toast } from '../ui.js';
import { todayKey, formatDateKey, escapeHtml } from '../utils.js';

let section = 'plants'; // 'plants' | 'pets'

export function render() {
  setTitle('Pflanzen & Tiere');
  setBack(null);
  setActions('');
  draw();
}

function draw() {
  const view = document.getElementById('view');
  view.innerHTML = `
    <div class="section-tabs">
      <button class="chip ${section === 'plants' ? 'active' : ''}" data-sec="plants">Pflanzen</button>
      <button class="chip ${section === 'pets' ? 'active' : ''}" data-sec="pets">Haustiere</button>
    </div>
    <div id="section-body"></div>
    <button class="btn btn-primary" id="section-add" style="margin-top:16px">${section === 'plants' ? '+ Pflanze' : '+ Haustier'}</button>
  `;
  document.querySelectorAll('[data-sec]').forEach((el) => el.addEventListener('click', () => { section = el.dataset.sec; draw(); }));
  document.getElementById('section-add').addEventListener('click', () => {
    if (section === 'plants') openPlantModal(null, draw);
    else openPetModal(null, draw);
  });
  drawSection();
}

function drawSection() {
  const body = document.getElementById('section-body');
  const today = todayKey();
  if (section === 'plants') {
    const plants = getPlants();
    body.innerHTML = plants.length === 0 ? `<div class="empty"><p class="faint">Noch keine Pflanzen.</p></div>` : `
      <div class="card">
        ${plants.map((p) => {
          const due = plantNextWaterDue(p);
          const overdue = due <= today;
          return `
            <div class="due-row">
              <div class="col grow" style="min-width:0" data-open="${p.id}" style="cursor:pointer">
                <p class="due-row__title truncate">${escapeHtml(p.name)}</p>
                <p class="due-row__meta">${escapeHtml(p.species || '')}${p.species ? ' · ' : ''}alle ${p.wateringIntervalDays} Tage</p>
              </div>
              <span class="due-row__date ${overdue ? 'due-row__date--overdue' : ''}">${formatDateKey(due)}</span>
              <button class="icon-btn" data-water="${p.id}" aria-label="Gegossen"><svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg></button>
            </div>
          `;
        }).join('')}
      </div>
    `;
    body.querySelectorAll('[data-open]').forEach((el) => el.addEventListener('click', () => openPlantModal(getPlantById(el.dataset.open), draw)));
    body.querySelectorAll('[data-water]').forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); markPlantWatered(el.dataset.water); toast('Gegossen'); drawSection(); }));
  } else {
    const pets = getPets();
    body.innerHTML = pets.length === 0 ? `<div class="empty"><p class="faint">Noch keine Haustiere.</p></div>` : `
      <div class="card">
        ${pets.map((p) => {
          const due = petNextVetDue(p);
          const overdue = due && due <= today;
          return `
            <div class="due-row">
              <div class="col grow" style="min-width:0" data-open="${p.id}" style="cursor:pointer">
                <p class="due-row__title truncate">${escapeHtml(p.name)}</p>
                <p class="due-row__meta">${escapeHtml(p.species || '')}</p>
              </div>
              ${due ? `<span class="due-row__date ${overdue ? 'due-row__date--overdue' : ''}">${formatDateKey(due)}</span>
                <button class="icon-btn" data-vet="${p.id}" aria-label="Tierarzt erledigt"><svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg></button>` : ''}
            </div>
          `;
        }).join('')}
      </div>
    `;
    body.querySelectorAll('[data-open]').forEach((el) => el.addEventListener('click', () => openPetModal(getPetById(el.dataset.open), draw)));
    body.querySelectorAll('[data-vet]').forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); markPetVetDone(el.dataset.vet); toast('Vermerkt'); drawSection(); }));
  }
}

function openPlantModal(existing, onSaved) {
  const isNew = !existing;
  const handle = openModal(`
    <h3 class="modal-title">${isNew ? 'Pflanze anlegen' : 'Pflanze bearbeiten'}</h3>
    <div class="field">
      <label>Name</label>
      <input class="input" id="p-name" value="${escapeHtml(existing?.name || '')}" placeholder="z.B. Wohnzimmer-Ficus">
    </div>
    <div class="field">
      <label>Art (optional)</label>
      <input class="input" id="p-species" value="${escapeHtml(existing?.species || '')}" placeholder="z.B. Ficus">
    </div>
    <div class="field">
      <label>Gießintervall (Tage)</label>
      <input class="input" type="number" min="1" id="p-interval" value="${existing?.wateringIntervalDays || 7}">
    </div>
    <p class="faint" id="p-suggest" style="margin:-8px 0 12px"></p>
    <div class="field">
      <label>Zuletzt gegossen am (optional)</label>
      <input class="input" type="date" id="p-last" value="${existing?.lastWatered || ''}">
    </div>
    <div class="field">
      <label>Notiz (optional)</label>
      <textarea class="input" id="p-note">${escapeHtml(existing?.note || '')}</textarea>
    </div>
    <div class="stack">
      <button class="btn btn-primary" id="p-save">Speichern</button>
      ${!isNew ? '<button class="btn btn-danger" id="p-delete">Löschen</button>' : ''}
    </div>
  `, { center: true });

  handle.sheet.querySelector('#p-species').addEventListener('input', (e) => {
    const suggestion = suggestWateringInterval(e.target.value);
    const hint = handle.sheet.querySelector('#p-suggest');
    hint.textContent = suggestion ? `Vorschlag für diese Art: alle ${suggestion} Tage` : '';
  });

  handle.sheet.querySelector('#p-save').addEventListener('click', () => {
    const name = handle.sheet.querySelector('#p-name').value.trim();
    if (!name) { toast('Bitte einen Namen eingeben'); return; }
    const species = handle.sheet.querySelector('#p-species').value.trim();
    const wateringIntervalDays = Number(handle.sheet.querySelector('#p-interval').value) || 7;
    const lastWatered = handle.sheet.querySelector('#p-last').value || null;
    const note = handle.sheet.querySelector('#p-note').value.trim();
    if (isNew) createPlant({ name, species, wateringIntervalDays, lastWatered, note });
    else savePlant({ ...existing, name, species, wateringIntervalDays, lastWatered, note });
    toast('Gespeichert');
    handle.close();
    onSaved?.();
  });
  handle.sheet.querySelector('#p-delete')?.addEventListener('click', async () => {
    const ok = await confirmDialog('Pflanze löschen?', 'Wird unwiderruflich gelöscht.');
    if (!ok) return;
    deletePlant(existing.id);
    toast('Gelöscht');
    handle.close();
    onSaved?.();
  });
}

function openPetModal(existing, onSaved) {
  const isNew = !existing;
  const handle = openModal(`
    <h3 class="modal-title">${isNew ? 'Haustier anlegen' : 'Haustier bearbeiten'}</h3>
    <div class="field">
      <label>Name</label>
      <input class="input" id="p-name" value="${escapeHtml(existing?.name || '')}">
    </div>
    <div class="field">
      <label>Art (optional)</label>
      <input class="input" id="p-species" value="${escapeHtml(existing?.species || '')}" placeholder="z.B. Katze">
    </div>
    <div class="field">
      <label>Tierarzt-Intervall (Monate, optional)</label>
      <input class="input" type="number" min="1" id="p-interval" value="${existing?.vetIntervalMonths || ''}" placeholder="leer = kein Erinnerungs-Intervall">
    </div>
    <div class="field">
      <label>Letzter Tierarztbesuch (optional)</label>
      <input class="input" type="date" id="p-last" value="${existing?.lastVet || ''}">
    </div>
    <div class="field">
      <label>Notiz (optional)</label>
      <textarea class="input" id="p-note">${escapeHtml(existing?.note || '')}</textarea>
    </div>
    <div class="stack">
      <button class="btn btn-primary" id="p-save">Speichern</button>
      ${!isNew ? '<button class="btn btn-danger" id="p-delete">Löschen</button>' : ''}
    </div>
  `, { center: true });

  handle.sheet.querySelector('#p-save').addEventListener('click', () => {
    const name = handle.sheet.querySelector('#p-name').value.trim();
    if (!name) { toast('Bitte einen Namen eingeben'); return; }
    const species = handle.sheet.querySelector('#p-species').value.trim();
    const vetIntervalMonths = Number(handle.sheet.querySelector('#p-interval').value) || null;
    const lastVet = handle.sheet.querySelector('#p-last').value || null;
    const note = handle.sheet.querySelector('#p-note').value.trim();
    if (isNew) createPet({ name, species, vetIntervalMonths, lastVet, note });
    else savePet({ ...existing, name, species, vetIntervalMonths, lastVet, note });
    toast('Gespeichert');
    handle.close();
    onSaved?.();
  });
  handle.sheet.querySelector('#p-delete')?.addEventListener('click', async () => {
    const ok = await confirmDialog('Haustier löschen?', 'Wird unwiderruflich gelöscht.');
    if (!ok) return;
    deletePet(existing.id);
    toast('Gelöscht');
    handle.close();
    onSaved?.();
  });
}
