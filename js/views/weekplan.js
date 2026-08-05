import { setTitle, setActions, setBack } from '../router.js';
import {
  getWeeklyPlan, saveWeeklyPlan, syncWeeklyPlanToCalendar, projectPlanDays, getRoutines,
  getLatestWeight, weeklyPlanHasWorkouts,
  getRotations, getRotationById, createRotation, saveRotation, deleteRotation,
  addRoutineToRotation, removeRoutineFromRotation, reorderRotation, getRoutineById,
  clearMissedPlannedEntries,
} from '../db.js';
import { estimateRoutineLoad, weeklyTrainingLoad } from '../nutrition.js';
import { toast, confirmDialog, promptDialog } from '../ui.js';
import { escapeHtml, formatNum, formatDateKey, mondayOfWeekKey } from '../utils.js';

const WEEKDAY_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

export function render() {
  setTitle('Trainingsplan');
  setBack(() => { location.hash = '#/calendar'; });
  setActions('');

  // Kaskaden-Effekt (verpasste Rotationstermine) sichtbar machen, bevor gezeichnet wird
  const plan = getWeeklyPlan();
  if (plan.autoFill) syncWeeklyPlanToCalendar(plan);
  clearMissedPlannedEntries();

  const routines = getRoutines();
  const rotations = getRotations();
  const weightKg = getLatestWeight() || 75; // ohne erfasstes Gewicht nur grobe Referenz
  const load = weeklyTrainingLoad(weightKg, plan);
  const weeks = (plan.cycleLength || 7) / 7;

  document.getElementById('view').innerHTML = `
    <p class="faint" style="padding:0 2px 12px">
      Lege dein wiederkehrendes Trainingsmuster fest – über eine oder mehrere Wochen, mit festen
      Routinen und/oder Rotationen. Es füllt den Kalender automatisch und liefert die Basis für
      deinen Kalorienbedarf.
    </p>

    ${routines.length === 0 ? `
      <div class="empty">
        <h3>Noch keine Routinen</h3>
        <p>Lege zuerst eine Routine an, um sie hier einplanen zu können.</p>
        <button class="btn btn-primary" style="margin-top:14px" id="go-routines">Zu den Routinen</button>
      </div>
    ` : `
      <div class="card">
        <div class="field" style="margin-bottom:0">
          <label>Länge des Zyklus</label>
          <div class="chip-row" id="wp-cycle-weeks">
            ${[1, 2, 3, 4].map((w) => `<button class="chip ${weeks === w ? 'active' : ''}" data-weeks="${w}">${w} Woche${w > 1 ? 'n' : ''}</button>`).join('')}
          </div>
        </div>
      </div>

      ${Array.from({ length: weeks }, (_, w) => weekBlockHtml(w, plan, routines, rotations, weightKg)).join('')}

      <div class="grid-3" style="margin-top:16px">
        <div class="stat-tile"><div class="stat-tile__value">${formatNum(load.sessions, 1)}</div><div class="stat-tile__label">Einheiten/Woche Ø</div></div>
        <div class="stat-tile"><div class="stat-tile__value">${Math.round(load.weeklyMinutes)}</div><div class="stat-tile__label">Minuten/Woche Ø</div></div>
        <div class="stat-tile"><div class="stat-tile__value">${Math.round(load.weeklyKcal)}</div><div class="stat-tile__label">kcal/Woche Ø</div></div>
      </div>

      ${rotationsSectionHtml(rotations, routines)}

      <div class="section-title">Vorschau</div>
      <div class="card">
        ${previewHtml(plan)}
      </div>

      <div class="section-title">Kalender-Übernahme</div>
      <div class="card">
        <div class="switch-row" style="padding-top:0">
          <div class="col grow">
            <p>Automatisch in den Kalender eintragen</p>
            <p class="faint">Trägt die geplanten Workouts für die kommenden Wochen ein</p>
          </div>
          <label class="switch">
            <input type="checkbox" id="wp-autofill" ${plan.autoFill ? 'checked' : ''}>
            <span class="switch__track"></span><span class="switch__thumb"></span>
          </label>
        </div>
        <div class="field" style="margin-top:10px;margin-bottom:0">
          <label>Wie viele Wochen im Voraus?</label>
          <input class="input" type="number" id="wp-weeks" min="1" max="52" value="${plan.weeksAhead}">
        </div>
        <button class="btn btn-primary" id="wp-sync" style="margin-top:14px">Jetzt in den Kalender übernehmen</button>
        <p class="faint" style="margin-top:10px">
          Ersetzt nur zukünftige Einträge aus dem Plan. Manuell geplante Termine und bereits
          absolvierte Workouts bleiben unverändert. Verpasste Rotations-Termine rutschen
          automatisch auf den nächsten Trainingstag nach.
        </p>
      </div>
    `}
  `;

  wire(plan, routines, rotations);
}

/* ---------- Wochen-Block mit Tagesreihen ---------- */

function weekBlockHtml(weekIndex, plan, routines, rotations, weightKg) {
  return `
    <div class="section-title">${(plan.cycleLength / 7) > 1 ? `Woche ${weekIndex + 1}` : 'Trainingswoche'}</div>
    <div class="stack" data-week="${weekIndex}">
      ${Array.from({ length: 7 }, (_, d) => dayRowHtml(weekIndex * 7 + d, plan, routines, rotations, weightKg)).join('')}
    </div>
  `;
}

function dayRowHtml(dayIndex, plan, routines, rotations, weightKg) {
  const slot = plan.days[dayIndex] || { type: 'rest' };
  const weekdayLabel = WEEKDAY_SHORT[dayIndex % 7];

  let badgeHtml = '<span class="badge">Ruhetag</span>';
  let hintHtml = '';
  if (slot.type === 'routine' && slot.routineId) {
    const routine = routines.find((r) => r.id === slot.routineId);
    if (routine) {
      const load = estimateRoutineLoad(routine, weightKg);
      badgeHtml = `<span class="badge badge--accent">${Math.round(load.totalMin)} min</span>`;
      hintHtml = `<p class="faint" style="margin-top:8px">ca. ${Math.round(load.kcal)} kcal · ${routine.exercises.length} Übungen</p>`;
    }
  } else if (slot.type === 'rotation' && slot.rotationId) {
    const rotation = rotations.find((r) => r.id === slot.rotationId);
    if (rotation && rotation.sequence.length) {
      const nextRoutine = getRoutineById(rotation.sequence[rotation.cursor % rotation.sequence.length]);
      badgeHtml = `<span class="badge badge--accent">🔁 Rotation</span>`;
      hintHtml = `<p class="faint" style="margin-top:8px">nächste fällige: ${escapeHtml(nextRoutine?.name || '?')}</p>`;
    } else {
      badgeHtml = `<span class="badge">🔁 Rotation (leer)</span>`;
    }
  }

  return `
    <div class="card weekplan-day ${slot.type !== 'rest' ? 'weekplan-day--active' : ''}">
      <div class="row row--between">
        <h3>${weekdayLabel}</h3>
        ${badgeHtml}
      </div>
      <select class="input" data-day="${dayIndex}" style="margin-top:10px">
        <option value="">Ruhetag</option>
        ${routines.length ? `<optgroup label="Feste Routine">
          ${routines.map((r) => `<option value="routine:${r.id}" ${slot.type === 'routine' && slot.routineId === r.id ? 'selected' : ''}>${escapeHtml(r.name)}</option>`).join('')}
        </optgroup>` : ''}
        ${rotations.length ? `<optgroup label="Rotation">
          ${rotations.map((rot) => `<option value="rotation:${rot.id}" ${slot.type === 'rotation' && slot.rotationId === rot.id ? 'selected' : ''}>${escapeHtml(rot.name)}</option>`).join('')}
        </optgroup>` : ''}
      </select>
      ${hintHtml}
    </div>
  `;
}

/* ---------- Rotationen verwalten ---------- */

function rotationsSectionHtml(rotations, routines) {
  return `
    <div class="section-title row row--between">
      <span>Rotationen</span>
      <button class="btn btn-ghost btn-sm" id="rotation-add" style="width:auto">+ Neue Rotation</button>
    </div>
    ${rotations.length === 0 ? `
      <p class="faint" style="padding:0 2px">
        Noch keine Rotation angelegt. Eine Rotation ist eine Reihenfolge von Routinen (z.B. A → C → B → C),
        die einem Tag zugewiesen wird und bei jedem Durchlauf zur nächsten Routine weiterspringt.
        Verpasst du einen Termin, rutscht die Reihenfolge automatisch nach.
      </p>
    ` : `
      <div class="stack">
        ${rotations.map((rot) => rotationCardHtml(rot, routines)).join('')}
      </div>
    `}
  `;
}

function rotationCardHtml(rotation, routines) {
  const availableToAdd = routines.filter((r) => !rotation.sequence.includes(r.id));
  return `
    <div class="card" data-rotation-card="${rotation.id}">
      <div class="row row--between">
        <h3 class="truncate" data-rotation-rename="${rotation.id}" style="cursor:pointer">${escapeHtml(rotation.name)} ✏️</h3>
        <button class="icon-btn" data-rotation-delete="${rotation.id}" aria-label="Rotation löschen">
          <svg viewBox="0 0 24 24" style="width:20px;height:20px"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/></svg>
        </button>
      </div>
      ${rotation.sequence.length === 0 ? `<p class="faint" style="margin-top:6px">Noch keine Routine in dieser Rotation.</p>` : `
        <div class="stack" style="margin-top:10px">
          ${rotation.sequence.map((routineId, i) => {
            const routine = routines.find((r) => r.id === routineId);
            const isNext = i === rotation.cursor % rotation.sequence.length;
            return `
              <div class="row row--between rotation-item ${isNext ? 'rotation-item--next' : ''}">
                <span class="truncate">${isNext ? '▶ ' : ''}${escapeHtml(routine?.name || 'Gelöschte Routine')}</span>
                <div class="row" style="gap:0">
                  <button class="icon-btn" data-rot-up="${rotation.id}:${i}" aria-label="Nach oben" ${i === 0 ? 'disabled' : ''}><svg viewBox="0 0 24 24"><path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></svg></button>
                  <button class="icon-btn" data-rot-down="${rotation.id}:${i}" aria-label="Nach unten" ${i === rotation.sequence.length - 1 ? 'disabled' : ''}><svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M18 13l-6 6-6-6"/></svg></button>
                  <button class="icon-btn" data-rot-remove="${rotation.id}:${routineId}" aria-label="Entfernen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg></button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `}
      ${availableToAdd.length ? `
        <select class="input" data-rot-add="${rotation.id}" style="margin-top:10px">
          <option value="">+ Routine hinzufügen…</option>
          ${availableToAdd.map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('')}
        </select>
      ` : ''}
    </div>
  `;
}

/* ---------- Vorschau ---------- */

function previewHtml(plan) {
  const upcoming = projectPlanDays(plan, null, 90).slice(0, 10);
  if (!upcoming.length) return `<p class="faint">Noch nichts geplant.</p>`;
  return `
    <div class="stack">
      ${upcoming.map((u) => `
        <div class="row row--between">
          <span class="muted">${formatDateKey(u.date, { withWeekday: true })}</span>
          <span>${escapeHtml(u.routine.name)}</span>
        </div>
      `).join('')}
    </div>
  `;
}

/* ---------- Events ---------- */

function wire(plan, routines, rotations) {
  document.getElementById('go-routines')?.addEventListener('click', () => { location.hash = '#/routines'; });

  document.querySelectorAll('[data-weeks]').forEach((b) => b.addEventListener('click', async () => {
    const weeks = +b.dataset.weeks;
    const newLength = weeks * 7;
    if (newLength < plan.cycleLength) {
      const ok = await confirmDialog('Zyklus verkürzen?', 'Tage am Ende des Zyklus, die dadurch wegfallen, gehen verloren.', 'Kürzen', true);
      if (!ok) return;
    }
    const newDays = Array.from({ length: newLength }, (_, i) => plan.days[i] || { type: 'rest' });
    plan.cycleLength = newLength;
    plan.days = newDays;
    if (!plan.anchorDate) plan.anchorDate = mondayOfWeekKey(new Date().toISOString().slice(0, 10));
    saveWeeklyPlan(plan);
    if (plan.autoFill) syncWeeklyPlanToCalendar(plan);
    render();
  }));

  document.querySelectorAll('[data-day]').forEach((sel) => sel.addEventListener('change', () => {
    const i = +sel.dataset.day;
    const [type, id] = sel.value ? sel.value.split(':') : [null, null];
    if (type === 'routine') plan.days[i] = { type: 'routine', routineId: id };
    else if (type === 'rotation') plan.days[i] = { type: 'rotation', rotationId: id };
    else plan.days[i] = { type: 'rest' };
    saveWeeklyPlan(plan);
    if (plan.autoFill) syncWeeklyPlanToCalendar(plan);
    render();
  }));

  document.getElementById('rotation-add')?.addEventListener('click', async () => {
    const name = await promptDialog('Name der Rotation', { placeholder: 'z.B. Kraft A/B/C', confirmLabel: 'Anlegen' });
    if (!name) return;
    createRotation(name);
    toast('Rotation angelegt');
    render();
  });

  document.querySelectorAll('[data-rotation-rename]').forEach((el) => el.addEventListener('click', async () => {
    const rotation = getRotationById(el.dataset.rotationRename);
    if (!rotation) return;
    const name = await promptDialog('Rotation umbenennen', { value: rotation.name, confirmLabel: 'Speichern' });
    if (!name) return;
    rotation.name = name;
    saveRotation(rotation);
    render();
  }));

  document.querySelectorAll('[data-rotation-delete]').forEach((b) => b.addEventListener('click', async () => {
    const rotation = getRotationById(b.dataset.rotationDelete);
    if (!rotation) return;
    const ok = await confirmDialog('Rotation löschen?', `"${rotation.name}" wird entfernt. Tage, die dieser Rotation zugewiesen waren, werden zu Ruhetagen.`, 'Löschen', true);
    if (!ok) return;
    deleteRotation(rotation.id);
    const freshPlan = getWeeklyPlan();
    if (freshPlan.autoFill) syncWeeklyPlanToCalendar(freshPlan);
    toast('Rotation gelöscht');
    render();
  }));

  document.querySelectorAll('[data-rot-up]').forEach((b) => b.addEventListener('click', () => {
    const [rotId, idx] = b.dataset.rotUp.split(':');
    const rotation = getRotationById(rotId);
    const i = +idx;
    if (!rotation || i === 0) return;
    [rotation.sequence[i - 1], rotation.sequence[i]] = [rotation.sequence[i], rotation.sequence[i - 1]];
    reorderRotation(rotId, rotation.sequence);
    syncAfterRotationChange();
  }));
  document.querySelectorAll('[data-rot-down]').forEach((b) => b.addEventListener('click', () => {
    const [rotId, idx] = b.dataset.rotDown.split(':');
    const rotation = getRotationById(rotId);
    const i = +idx;
    if (!rotation || i >= rotation.sequence.length - 1) return;
    [rotation.sequence[i + 1], rotation.sequence[i]] = [rotation.sequence[i], rotation.sequence[i + 1]];
    reorderRotation(rotId, rotation.sequence);
    syncAfterRotationChange();
  }));
  document.querySelectorAll('[data-rot-remove]').forEach((b) => b.addEventListener('click', () => {
    const [rotId, routineId] = b.dataset.rotRemove.split(':');
    removeRoutineFromRotation(rotId, routineId);
    syncAfterRotationChange();
  }));
  document.querySelectorAll('[data-rot-add]').forEach((sel) => sel.addEventListener('change', () => {
    if (!sel.value) return;
    addRoutineToRotation(sel.dataset.rotAdd, sel.value);
    syncAfterRotationChange();
  }));

  function syncAfterRotationChange() {
    const freshPlan = getWeeklyPlan();
    if (freshPlan.autoFill) syncWeeklyPlanToCalendar(freshPlan);
    render();
  }

  document.getElementById('wp-autofill')?.addEventListener('change', (e) => {
    plan.autoFill = e.target.checked;
    saveWeeklyPlan(plan);
    syncWeeklyPlanToCalendar(plan);
    toast(plan.autoFill ? 'Automatische Übernahme aktiv' : 'Automatische Übernahme aus');
  });

  document.getElementById('wp-weeks')?.addEventListener('change', (e) => {
    plan.weeksAhead = Math.max(1, Math.min(52, Number(e.target.value) || 8));
    saveWeeklyPlan(plan);
    if (plan.autoFill) syncWeeklyPlanToCalendar(plan);
    toast('Gespeichert');
  });

  document.getElementById('wp-sync')?.addEventListener('click', async () => {
    if (!weeklyPlanHasWorkouts(plan)) { toast('Noch kein Workout im Plan'); return; }
    const ok = await confirmDialog(
      'In den Kalender übernehmen?',
      `Für die nächsten ${plan.weeksAhead} Wochen werden die geplanten Workouts eingetragen. Bestehende Plan-Einträge in der Zukunft werden dabei erneuert.`,
      'Übernehmen', false,
    );
    if (!ok) return;
    const count = syncWeeklyPlanToCalendar(plan);
    toast(`${count} Termine eingetragen`);
  });
}
