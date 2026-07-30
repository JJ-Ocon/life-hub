import { getExercises, addCustomExercise, MUSCLE_GROUPS, deleteExercise } from '../db.js';
import { openModal, toast, confirmDialog } from '../ui.js';
import { escapeHtml } from '../utils.js';

/**
 * Oeffnet den Uebungsauswahl-Dialog.
 * @param {(exerciseId:string)=>void} onPick
 */
export function openExercisePicker(onPick) {
  let query = '';
  let group = 'Alle';
  let manageMode = false;

  const handle = openModal(`
    <h3 class="modal-title">Übung auswählen</h3>
    <input class="input" id="ex-search" placeholder="Suchen…" style="margin-bottom:12px" />
    <div class="chip-row" id="ex-groups" style="margin-bottom:12px"></div>
    <div id="ex-list" style="max-height:44vh; overflow-y:auto"></div>
    <div class="row" style="gap:10px; margin-top:14px">
      <button class="btn btn-ghost" id="ex-manage">Verwalten</button>
      <button class="btn btn-primary" id="ex-add-custom">+ Eigene Übung</button>
    </div>
  `, { });

  const groupsEl = handle.sheet.querySelector('#ex-groups');
  const listEl = handle.sheet.querySelector('#ex-list');
  const searchEl = handle.sheet.querySelector('#ex-search');

  function groupsHtml() {
    const all = ['Alle', ...MUSCLE_GROUPS];
    return all.map((g) => `<button class="chip ${g === group ? 'active' : ''}" data-g="${g}">${g}</button>`).join('');
  }

  function renderList() {
    const exercises = getExercises()
      .filter((e) => (group === 'Alle' || e.muscleGroup === group))
      .filter((e) => e.name.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name, 'de'));

    if (exercises.length === 0) {
      listEl.innerHTML = `<div class="empty" style="padding:24px"><p>Keine Übung gefunden</p></div>`;
      return;
    }
    listEl.innerHTML = exercises.map((e) => `
      <div class="list-row" data-id="${e.id}" style="cursor:pointer">
        <div class="col grow">
          <p>${escapeHtml(e.name)}</p>
          <p class="faint">${e.muscleGroup}${e.custom ? ' · eigene' : ''}</p>
        </div>
        ${manageMode && e.custom ? `<button class="icon-btn" data-del="${e.id}" aria-label="Löschen"><svg viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/></svg></button>` : ''}
      </div>
    `).join('');

    listEl.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const ok = await confirmDialog('Übung löschen?', 'Diese eigene Übung wird entfernt.');
        if (ok) { deleteExercise(btn.dataset.del); renderList(); }
      });
    });
    listEl.querySelectorAll('.list-row').forEach((row) => {
      row.addEventListener('click', () => {
        if (manageMode) return;
        onPick(row.dataset.id);
        handle.close();
      });
    });
  }

  groupsEl.innerHTML = groupsHtml();
  groupsEl.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => { group = chip.dataset.g; groupsEl.innerHTML = groupsHtml(); attachGroupEvents(); renderList(); });
  });
  function attachGroupEvents() {
    groupsEl.querySelectorAll('.chip').forEach((chip) => {
      chip.addEventListener('click', () => { group = chip.dataset.g; groupsEl.innerHTML = groupsHtml(); attachGroupEvents(); renderList(); });
    });
  }

  searchEl.addEventListener('input', () => { query = searchEl.value; renderList(); });

  handle.sheet.querySelector('#ex-manage').addEventListener('click', (e) => {
    manageMode = !manageMode;
    e.target.textContent = manageMode ? 'Fertig' : 'Verwalten';
    renderList();
  });

  handle.sheet.querySelector('#ex-add-custom').addEventListener('click', () => {
    openAddCustomExercise((ex) => {
      if (ex) { onPick(ex.id); handle.close(); }
    });
  });

  renderList();
}

function openAddCustomExercise(cb) {
  const handle = openModal(`
    <h3 class="modal-title">Eigene Übung anlegen</h3>
    <div class="field"><label>Name</label><input class="input" id="new-ex-name" placeholder="z.B. Cable Crossover"></div>
    <div class="field">
      <label>Muskelgruppe</label>
      <select class="input" id="new-ex-group">
        ${MUSCLE_GROUPS.map((g) => `<option value="${g}">${g}</option>`).join('')}
      </select>
    </div>
    <button class="btn btn-primary" id="new-ex-save">Speichern</button>
  `, { center: true, onClose: () => cb(null) });

  const nameInput = handle.sheet.querySelector('#new-ex-name');
  nameInput.focus();
  handle.sheet.querySelector('#new-ex-save').addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) { toast('Bitte einen Namen eingeben'); return; }
    const group = handle.sheet.querySelector('#new-ex-group').value;
    const ex = addCustomExercise(name, group);
    cb(ex);
    handle.close();
  });
}
