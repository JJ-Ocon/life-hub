import { setTitle, setActions, setBack } from '../router.js';
import {
  getWeeklyPlan, saveWeeklyPlan, syncWeeklyPlanToCalendar, getRoutines,
  getLatestWeight, WEEKDAY_LABELS, weeklyPlanHasWorkouts,
} from '../db.js';
import { estimateRoutineLoad, weeklyTrainingLoad } from '../nutrition.js';
import { toast, confirmDialog } from '../ui.js';
import { escapeHtml, formatNum } from '../utils.js';

export function render() {
  setTitle('Wochenplan');
  setBack(() => { location.hash = '#/calendar'; });
  setActions('');

  const plan = getWeeklyPlan();
  const routines = getRoutines();
  // Ohne erfasstes Gewicht nur eine grobe Referenz fuer die Kalorien-Vorschau
  const weightKg = getLatestWeight() || 75;
  const load = weeklyTrainingLoad(weightKg, plan);

  document.getElementById('view').innerHTML = `
    <p class="faint" style="padding:0 2px 12px">
      Lege deine Standard-Trainingswoche fest. Sie füllt den Kalender automatisch
      für die kommenden Wochen und liefert die Basis für deinen Kalorienbedarf.
    </p>

    ${routines.length === 0 ? `
      <div class="empty">
        <h3>Noch keine Routinen</h3>
        <p>Lege zuerst eine Routine an, um sie hier einplanen zu können.</p>
        <button class="btn btn-primary" style="margin-top:14px" id="go-routines">Zu den Routinen</button>
      </div>
    ` : `
      <div class="stack" id="weekplan-days">
        ${plan.days.map((slot, i) => dayRowHtml(slot, i, routines, weightKg)).join('')}
      </div>

      <div class="grid-3" style="margin-top:16px">
        <div class="stat-tile"><div class="stat-tile__value">${load.sessions}</div><div class="stat-tile__label">Einheiten/Woche</div></div>
        <div class="stat-tile"><div class="stat-tile__value">${Math.round(load.weeklyMinutes)}</div><div class="stat-tile__label">Minuten/Woche</div></div>
        <div class="stat-tile"><div class="stat-tile__value">${Math.round(load.weeklyKcal)}</div><div class="stat-tile__label">kcal/Woche</div></div>
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
          Ersetzt nur zukünftige Einträge aus dem Wochenplan. Manuell geplante Termine
          und bereits absolvierte Workouts bleiben unverändert.
        </p>
      </div>
    `}
  `;

  wire(plan, routines);
}

function dayRowHtml(slot, i, routines, weightKg) {
  const routine = slot.routineId ? routines.find((r) => r.id === slot.routineId) : null;
  const load = routine ? estimateRoutineLoad(routine, weightKg) : null;
  const isWorkout = slot.type === 'workout' && routine;

  return `
    <div class="card weekplan-day ${isWorkout ? 'weekplan-day--active' : ''}">
      <div class="row row--between">
        <h3>${WEEKDAY_LABELS[i]}</h3>
        ${isWorkout ? `<span class="badge badge--accent">${Math.round(load.totalMin)} min</span>` : '<span class="badge">Ruhetag</span>'}
      </div>
      <select class="input" data-day="${i}" style="margin-top:10px">
        <option value="">Ruhetag</option>
        ${routines.map((r) => `
          <option value="${r.id}" ${slot.routineId === r.id ? 'selected' : ''}>${escapeHtml(r.name)}</option>
        `).join('')}
      </select>
      ${isWorkout ? `<p class="faint" style="margin-top:8px">ca. ${Math.round(load.kcal)} kcal · ${routine.exercises.length} Übungen</p>` : ''}
    </div>
  `;
}

function wire(plan, routines) {
  document.getElementById('go-routines')?.addEventListener('click', () => { location.hash = '#/routines'; });

  document.querySelectorAll('[data-day]').forEach((sel) => sel.addEventListener('change', () => {
    const i = +sel.dataset.day;
    const routineId = sel.value || null;
    plan.days[i] = routineId ? { type: 'workout', routineId } : { type: 'rest', routineId: null };
    saveWeeklyPlan(plan);
    if (plan.autoFill) syncWeeklyPlanToCalendar(plan);
    render();
  }));

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
      `Für die nächsten ${plan.weeksAhead} Wochen werden die geplanten Workouts eingetragen. Bestehende Wochenplan-Einträge in der Zukunft werden dabei erneuert.`,
      'Übernehmen', false,
    );
    if (!ok) return;
    const count = syncWeeklyPlanToCalendar(plan);
    toast(`${count} Termine eingetragen`);
  });
}
