import { setTitle, setActions } from '../router.js';
import { getRoutines, deleteRoutine, newRoutineSkeleton, saveRoutine, duplicateRoutine, getTemplateDefs, instantiateTemplate, getActiveSession, startSessionFromRoutine } from '../db.js';
import { confirmDialog, toast, openModal } from '../ui.js';
import { escapeHtml } from '../utils.js';

export function render() {
  setTitle('Routinen');
  setActions(`<button class="icon-btn" id="add-routine" aria-label="Neue Routine"><svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M5 12h14"/></svg></button>`);

  const routines = getRoutines();
  const active = getActiveSession();

  document.getElementById('view').innerHTML = `
    <button class="btn btn-primary" id="create-routine">+ Neue Routine von Grund auf erstellen</button>
    ${routines.length === 0 ? `
      <div class="empty">
        <svg viewBox="0 0 24 24"><path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h10"/></svg>
        <h3>Noch keine Routinen</h3>
        <p>Erstelle eine eigene Routine oder starte mit einer Vorlage.</p>
      </div>
    ` : `
      <div class="section-title">Meine Routinen</div>
      <div class="stack" id="routine-list">
        ${routines.map((r) => `
          <div class="card" data-id="${r.id}">
            <div class="row row--between card--tap" data-open="${r.id}">
              <div class="col grow">
                <h3 class="truncate">${escapeHtml(r.name)}</h3>
                <p class="faint">${r.exercises.length} Übung${r.exercises.length === 1 ? '' : 'en'}</p>
              </div>
            </div>
            <div class="row" style="gap:8px; margin-top:10px">
              <button class="btn btn-primary btn-sm grow" data-start="${r.id}" ${active ? 'disabled' : ''}>Starten</button>
              <button class="icon-btn" data-duplicate="${r.id}" aria-label="Duplizieren"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg></button>
              <button class="btn btn-ghost btn-sm" data-edit="${r.id}">Bearbeiten</button>
              <button class="btn btn-danger btn-sm" data-del="${r.id}">Löschen</button>
            </div>
          </div>
        `).join('')}
      </div>
    `}

    <div class="section-title">Vorlagen</div>
    <p class="faint" style="padding:0 2px 10px">Fertige Pläne zum Sofort-Loslegen – Gewichte trägst du beim Training selbst ein.</p>
    <div class="stack" id="template-list">
      ${groupedTemplates()}
    </div>
  `;

  function createRoutine() {
    const r = newRoutineSkeleton();
    saveRoutine(r);
    location.hash = `#/routines/${r.id}/edit`;
  }
  document.getElementById('add-routine').addEventListener('click', createRoutine);
  document.getElementById('create-routine').addEventListener('click', createRoutine);

  document.querySelectorAll('[data-open]').forEach((el) => el.addEventListener('click', () => location.hash = `#/routines/${el.dataset.open}/edit`));
  document.querySelectorAll('[data-edit]').forEach((el) => el.addEventListener('click', () => location.hash = `#/routines/${el.dataset.edit}/edit`));
  document.querySelectorAll('[data-start]').forEach((el) => el.addEventListener('click', () => {
    if (getActiveSession()) { toast('Es läuft bereits ein Training'); return; }
    const routine = routines.find((r) => r.id === el.dataset.start);
    startSessionFromRoutine(routine);
    location.hash = '#/session';
  }));
  document.querySelectorAll('[data-duplicate]').forEach((el) => el.addEventListener('click', () => {
    const routine = routines.find((r) => r.id === el.dataset.duplicate);
    const copy = duplicateRoutine(routine);
    toast('Routine dupliziert');
    location.hash = `#/routines/${copy.id}/edit`;
  }));
  document.querySelectorAll('[data-del]').forEach((el) => el.addEventListener('click', async () => {
    const ok = await confirmDialog('Routine löschen?', 'Diese Routine wird dauerhaft entfernt. Bereits absolvierte Workouts bleiben in deinem Verlauf erhalten.');
    if (ok) { deleteRoutine(el.dataset.del); render(); }
  }));
  document.querySelectorAll('[data-template]').forEach((el) => el.addEventListener('click', () => {
    const routine = instantiateTemplate(el.dataset.template);
    if (routine) { toast('Routine hinzugefügt'); location.hash = `#/routines/${routine.id}/edit`; }
  }));
}

function groupedTemplates() {
  const defs = getTemplateDefs();
  const groups = [...new Set(defs.map((d) => d.group))];
  return groups.map((g) => `
    <div class="card">
      <h3 style="margin-bottom:8px">${g}</h3>
      <div class="stack">
        ${defs.filter((d) => d.group === g).map((d) => `
          <div class="row row--between">
            <div class="col grow">
              <p>${d.label}</p>
              <p class="faint">${d.items.length} Übungen</p>
            </div>
            <button class="btn btn-ghost btn-sm" data-template="${d.key}">Übernehmen</button>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}
