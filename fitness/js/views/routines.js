import { setTitle, setActions } from '../router.js';
import { getRoutines, deleteRoutine, newRoutineSkeleton, saveRoutine, duplicateRoutine, getTemplateDefs, instantiateTemplate, getActiveSession, startSessionFromRoutine, startMergedSession } from '../db.js';
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
      ${routines.length >= 2 ? `<button class="btn btn-ghost" id="merge-routines" ${active ? 'disabled' : ''} style="margin-bottom:12px">🔗 Zwei Routinen zusammenlegen</button>` : ''}
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
  document.getElementById('merge-routines')?.addEventListener('click', () => openMergeModal(routines));

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

/** Waehlt zwei Routinen aus und startet eine gemeinsame Session daraus -
 *  spart Zeit, wenn man z.B. in einer Deload-Woche nicht an zwei
 *  getrennten Tagen trainieren will. */
function openMergeModal(routines) {
  let pickedA = null;
  let pickedB = null;

  const handle = openModal(`
    <h3 class="modal-title">Zwei Routinen zusammenlegen</h3>
    <p class="faint" style="margin-bottom:14px">Beide Übungslisten werden zu einer einzigen Session zusammengefügt - praktisch z.B. in einer Deload-Woche, um Zeit zu sparen.</p>
    <div class="field">
      <label>Erste Routine</label>
      <div class="chip-row" id="merge-a-row">
        ${routines.map((r) => `<button type="button" class="chip" data-pick-a="${r.id}">${escapeHtml(r.name)}</button>`).join('')}
      </div>
    </div>
    <div class="field">
      <label>Zweite Routine</label>
      <div class="chip-row" id="merge-b-row">
        ${routines.map((r) => `<button type="button" class="chip" data-pick-b="${r.id}">${escapeHtml(r.name)}</button>`).join('')}
      </div>
    </div>
    <button class="btn btn-primary" id="merge-go">Zusammengelegte Session starten</button>
  `, { center: true });

  handle.sheet.querySelectorAll('[data-pick-a]').forEach((b) => b.addEventListener('click', () => {
    pickedA = b.dataset.pickA;
    handle.sheet.querySelectorAll('[data-pick-a]').forEach((x) => x.classList.toggle('active', x.dataset.pickA === pickedA));
  }));
  handle.sheet.querySelectorAll('[data-pick-b]').forEach((b) => b.addEventListener('click', () => {
    pickedB = b.dataset.pickB;
    handle.sheet.querySelectorAll('[data-pick-b]').forEach((x) => x.classList.toggle('active', x.dataset.pickB === pickedB));
  }));

  handle.sheet.querySelector('#merge-go').addEventListener('click', () => {
    if (!pickedA || !pickedB) { toast('Bitte zwei Routinen auswählen'); return; }
    if (pickedA === pickedB) { toast('Bitte zwei unterschiedliche Routinen auswählen'); return; }
    if (getActiveSession()) { toast('Es läuft bereits ein Training'); return; }
    const routineA = routines.find((r) => r.id === pickedA);
    const routineB = routines.find((r) => r.id === pickedB);
    startMergedSession(routineA, routineB);
    handle.close();
    location.hash = '#/session';
  });
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
