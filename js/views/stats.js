import { setTitle, setActions, setBack } from '../router.js';
import { getSessions, getExercises, sessionVolume, allSetsForExercise, getSettings } from '../db.js';
import { formatNum, estimate1RM, isoWeekKey, startOfWeek, addDays } from '../utils.js';
import { barChart, lineChart } from '../charts.js';
import { openModal } from '../ui.js';
import { escapeHtml } from '../utils.js';

export function render() {
  setTitle('Statistik');
  setActions('');
  setBack(null);

  const sessions = getSessions().filter((s) => s.endedAt);
  const settings = getSettings();

  const totalWorkouts = sessions.length;
  const avgDuration = totalWorkouts
    ? sessions.reduce((sum, s) => sum + (new Date(s.endedAt) - new Date(s.startedAt)), 0) / totalWorkouts / 1000
    : 0;

  let streak = 0;
  {
    let cursor = new Date();
    for (;;) {
      const key = isoWeekKey(cursor);
      if (!sessions.some((s) => isoWeekKey(new Date(s.startedAt)) === key)) break;
      streak++;
      cursor = addDays(cursor, -7);
    }
  }

  // Volumen der letzten 8 Wochen
  const weekBars = [];
  for (let i = 7; i >= 0; i--) {
    const weekStart = startOfWeek(addDays(new Date(), -7 * i));
    const key = isoWeekKey(weekStart);
    const vol = sessions.filter((s) => isoWeekKey(new Date(s.startedAt)) === key).reduce((sum, s) => sum + sessionVolume(s), 0);
    weekBars.push({ label: `${weekStart.getDate()}.${weekStart.getMonth() + 1}`, value: Math.round(vol), highlight: i === 0 });
  }

  // Uebungen mit vorhandenen Daten, fuer PR-Liste & Auswahl
  const exercises = getExercises();
  const exercisesWithData = exercises
    .map((e) => ({ ex: e, sets: allSetsForExercise(e.id) }))
    .filter((x) => x.sets.length > 0)
    .map((x) => {
      const best = x.sets.reduce((b, s) => estimate1RM(s.weight, s.reps) > estimate1RM(b.weight, b.reps) ? s : b, x.sets[0]);
      return { ex: x.ex, sets: x.sets, best };
    })
    .sort((a, b) => b.sets.length - a.sets.length);

  document.getElementById('view').innerHTML = `
    <div class="grid-3">
      <div class="stat-tile"><div class="stat-tile__value">${totalWorkouts}</div><div class="stat-tile__label">Workouts gesamt</div></div>
      <div class="stat-tile"><div class="stat-tile__value">${Math.round(avgDuration / 60)} min</div><div class="stat-tile__label">Ø Dauer</div></div>
      <div class="stat-tile"><div class="stat-tile__value">${streak}</div><div class="stat-tile__label">Wochen-Streak</div></div>
    </div>

    <div class="section-title">Trainingsvolumen (8 Wochen)</div>
    <div class="card">${barChart(weekBars, { unit: '' })}</div>

    <button class="btn btn-ghost" id="show-history">Gesamten Trainingsverlauf ansehen</button>

    <div class="section-title">Persönliche Rekorde</div>
    ${exercisesWithData.length === 0 ? `<p class="faint" style="padding:0 2px">Noch keine abgeschlossenen Sätze mit Gewicht.</p>` : `
      <div class="stack" id="pr-list">
        ${exercisesWithData.map(({ ex, best }) => `
          <div class="card card--tap row row--between" data-exid="${ex.id}">
            <div class="col grow">
              <h3 class="truncate">${escapeHtml(ex.name)}</h3>
              <p class="faint">Bestes Set</p>
            </div>
            <div class="badge badge--pr">${formatNum(best.weight)} ${settings.units} × ${best.reps}</div>
          </div>
        `).join('')}
      </div>
    `}
  `;

  document.querySelectorAll('[data-exid]').forEach((card) => {
    card.addEventListener('click', () => openExerciseProgress(card.dataset.exid, exercisesWithData, settings));
  });
  document.getElementById('show-history').addEventListener('click', () => { location.hash = '#/history'; });
}

function openExerciseProgress(exerciseId, exercisesWithData, settings) {
  const entry = exercisesWithData.find((x) => x.ex.id === exerciseId);
  if (!entry) return;
  const points = entry.sets.map((s) => ({ date: s.date, value: estimate1RM(s.weight, s.reps) }));
  const weightPoints = entry.sets.map((s) => ({ date: s.date, value: s.weight }));

  openModal(`
    <h3 class="modal-title">${escapeHtml(entry.ex.name)}</h3>
    <p class="faint" style="margin-bottom:6px">Geschätztes 1-Wdh.-Maximum über Zeit</p>
    <div class="card" style="padding:8px 4px">${lineChart(points, { unit: settings.units })}</div>
    <p class="faint" style="margin:14px 0 6px">Verwendetes Gewicht pro Satz</p>
    <div class="card" style="padding:8px 4px">${lineChart(weightPoints, { unit: settings.units })}</div>
    <button class="btn btn-primary" data-close-modal style="margin-top:10px">Schließen</button>
  `, {});
}
