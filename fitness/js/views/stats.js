import { setTitle, setActions, setBack } from '../router.js';
import {
  getSessions, getExercises, sessionVolume, allSetsForExercise, getSettings,
  cardioExerciseIds, cardioRecords, cardioFieldDef, getExerciseById,
  dailyTrainingLoad, volumeByMuscleGroup, planAdherence,
} from '../db.js';
import { exercisesNeedingAttention } from '../coach.js';
import { unlockedAchievements, nextAchievements } from '../achievements.js';
import { formatNum, formatDuration, estimate1RM, isoWeekKey, startOfWeek, addDays, todayKey, addDaysToDateKey } from '../utils.js';
import { barChart, lineChart, heatmap, hBarChart } from '../charts.js';
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

  // Cardio-Rekorde: pro Uebung die beste Kennzahl je erfasstem Feld
  const cardioPrRows = cardioExerciseIds().map((id) => ({ ex: getExerciseById(id), records: cardioRecords(id) })).filter((c) => c.ex);

  // Heatmap: letzte 53 Wochen bis heute
  const today = todayKey();
  const heatmapStart = addDaysToDateKey(today, -52 * 7);
  const loadByDate = dailyTrainingLoad();

  const muscleRows = volumeByMuscleGroup(28);
  const adherence = planAdherence(28);
  const unlocked = unlockedAchievements();
  const upcoming = nextAchievements(3);

  document.getElementById('view').innerHTML = `
    <div class="grid-3">
      <div class="stat-tile"><div class="stat-tile__value">${totalWorkouts}</div><div class="stat-tile__label">Workouts gesamt</div></div>
      <div class="stat-tile"><div class="stat-tile__value">${Math.round(avgDuration / 60)} min</div><div class="stat-tile__label">Ø Dauer</div></div>
      <div class="stat-tile"><div class="stat-tile__value">${streak}</div><div class="stat-tile__label">Wochen-Streak</div></div>
    </div>

    <div class="section-title">Trainings-Übersicht</div>
    <div class="card">${heatmap(loadByDate, { weeks: 53, todayKey: today, startKey: heatmapStart })}</div>

    <div class="section-title">Trainingsvolumen (8 Wochen)</div>
    <div class="card">${barChart(weekBars, { unit: '' })}</div>

    <button class="btn btn-ghost" id="show-history">Gesamten Trainingsverlauf ansehen</button>

    ${adherenceSectionHtml(adherence)}

    ${muscleRows.length ? `
      <div class="section-title">Muskelgruppen-Balance (4 Wochen)</div>
      <div class="card">${hBarChart(muscleRows.map((r) => ({ label: r.group, value: r.sets, sub: `${Math.round(r.volume)} kg` })), { unit: 'Sätze' })}</div>
    ` : ''}

    ${attentionSectionHtml(exercisesWithData.map((x) => x.ex.id))}

    ${achievementsSectionHtml(unlocked, upcoming)}

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

    ${cardioPrRows.length ? `
      <div class="section-title">Cardio-Rekorde</div>
      <div class="stack">
        ${cardioPrRows.map(({ ex, records }) => `
          <div class="card">
            <h3 class="truncate" style="margin-bottom:8px">${escapeHtml(ex.name)}</h3>
            <div class="stack">
              ${Object.entries(records).map(([key, r]) => {
                const def = cardioFieldDef(key);
                const value = key === 'duration' ? formatDuration(r.value) : `${formatNum(r.value, def.decimals ?? 1)} ${def.unit}`;
                return `<div class="row row--between"><span class="muted">${def.prLabel}</span><span class="badge badge--pr">🏆 ${value}</span></div>`;
              }).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    ` : ''}
  `;

  document.querySelectorAll('[data-exid]').forEach((card) => {
    card.addEventListener('click', () => openExerciseProgress(card.dataset.exid, exercisesWithData, settings));
  });
  document.getElementById('show-history').addEventListener('click', () => { location.hash = '#/history'; });
}

/** Geplant vs. tatsaechlich absolviert – nur sichtbar, wenn ein Wochenplan existiert. */
function adherenceSectionHtml(a) {
  if (a.planned === 0) return '';
  const percent = Math.round((a.rate ?? 0) * 100);
  return `
    <div class="section-title">Plan-Treue (4 Wochen)</div>
    <div class="card">
      <div class="row row--between">
        <div class="col grow">
          <p>${a.completed} von ${a.planned} geplanten Workouts</p>
          <p class="faint">${a.missed.length ? `Verpasst: ${a.missed.slice(0, 3).map((m) => m.routineName).join(', ')}${a.missed.length > 3 ? '…' : ''}` : 'Alles absolviert 🎉'}</p>
        </div>
        <div class="kcal-value ${percent < 60 ? 'kcal-value--warn' : ''}">${percent}%</div>
      </div>
      <div class="pbar" style="margin-top:10px"><div class="pbar__fill" style="width:${percent}%"></div></div>
    </div>
  `;
}

/** Erreichte und naechste Meilensteine – rein lokal, kein Vergleich mit anderen. */
function achievementsSectionHtml(unlocked, upcoming) {
  if (!unlocked.length && !upcoming.length) return '';
  return `
    <div class="section-title">Meilensteine</div>
    <div class="card">
      ${unlocked.length ? `
        <div class="chip-row" style="margin-bottom:${upcoming.length ? '14px' : '0'}">
          ${unlocked.map((a) => `<span class="chip active" title="${escapeHtml(a.hint)}">${a.icon} ${escapeHtml(a.label)}</span>`).join('')}
        </div>
      ` : `<p class="faint" style="${upcoming.length ? 'margin-bottom:14px' : ''}">Noch keine Meilensteine erreicht – leg los!</p>`}
      ${upcoming.length ? `
        <div class="stack">
          ${upcoming.map((a) => `
            <div>
              <div class="row row--between">
                <span class="faint">${a.icon} ${escapeHtml(a.label)}</span>
                <span class="faint">${Math.round(a.progress * 100)}%</span>
              </div>
              <div class="pbar" style="margin-top:4px"><div class="pbar__fill" style="width:${Math.round(a.progress * 100)}%"></div></div>
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

/**
 * Zeigt nur die Uebungen, bei denen Leistung/Erholung tatsaechlich fuer eine
 * Entlastung sprechen – bewusst kein pauschaler Deload nach Kalender.
 */
function attentionSectionHtml(exerciseIds) {
  const flagged = exercisesNeedingAttention(exerciseIds);
  if (!flagged.length) {
    return `
      <div class="section-title">Erholung</div>
      <div class="card">
        <p class="muted">Keine Übung zeigt aktuell Ermüdungszeichen. Weiter wie geplant.</p>
        <p class="faint" style="margin-top:8px">
          Die App prüft Leistungsentwicklung, Anstrengung (RPE) und deine Einschätzung nach
          jeder Einheit – und schlägt eine Entlastung nur dort vor, wo sie nötig ist.
        </p>
      </div>
    `;
  }

  const statusMeta = {
    'recovery-half-week': { icon: '🛑', label: 'Recovery-Halbwoche' },
    deload: { icon: '🔄', label: 'Deload' },
    watch: { icon: '⏸️', label: 'Beobachten' },
  };

  return `
    <div class="section-title">Erholung & Deload</div>
    <div class="stack">
      ${flagged.map(({ name, analysis }) => {
        const meta = statusMeta[analysis.status] || statusMeta.watch;
        return `
        <div class="card advice advice--${analysis.suggestion?.type || 'hold'}" style="margin-bottom:0">
          <div class="row row--between">
            <span class="advice__title">${meta.icon} ${escapeHtml(name)}</span>
            <span class="badge ${analysis.status !== 'watch' ? 'badge--pr' : ''}">${meta.label}</span>
          </div>
          ${analysis.suggestion ? `<p class="advice__text">${escapeHtml(analysis.suggestion.text)}</p>` : ''}
          ${analysis.affectedExercises?.length ? `
            <p class="advice__text faint">Betrifft auch: ${escapeHtml(analysis.affectedExercises.join(', '))}</p>
          ` : ''}
          ${analysis.reasons.length ? `
            <ul class="advice__list">${analysis.reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
          ` : ''}
        </div>
      `;
      }).join('')}
    </div>
  `;
}

function openExerciseProgress(exerciseId, exercisesWithData, settings) {
  const entry = exercisesWithData.find((x) => x.ex.id === exerciseId);
  if (!entry) return;
  const points = entry.sets.map((s) => ({ date: s.date, value: estimate1RM(s.weight, s.reps) }));
  const weightPoints = entry.sets.map((s) => ({ date: s.date, value: s.weight }));
  const prTimeline = buildPrTimeline(entry.sets);

  openModal(`
    <h3 class="modal-title">${escapeHtml(entry.ex.name)}</h3>
    <p class="faint" style="margin-bottom:6px">Geschätztes 1-Wdh.-Maximum über Zeit</p>
    <div class="card" style="padding:8px 4px">${lineChart(points, { unit: settings.units })}</div>
    <p class="faint" style="margin:14px 0 6px">Verwendetes Gewicht pro Satz</p>
    <div class="card" style="padding:8px 4px">${lineChart(weightPoints, { unit: settings.units })}</div>

    ${prTimeline.length ? `
      <p class="faint" style="margin:14px 0 6px">Rekord-Verlauf</p>
      <div class="stack">
        ${prTimeline.slice().reverse().map((p) => `
          <div class="row row--between">
            <span class="muted">${new Date(p.date).toLocaleDateString('de-DE')}</span>
            <span class="badge badge--pr">🏆 ${formatNum(p.weight)} ${settings.units} × ${p.reps}</span>
          </div>
        `).join('')}
      </div>
    ` : ''}
    <button class="btn btn-primary" data-close-modal style="margin-top:16px">Schließen</button>
  `, {});
}

/** Chronologische Liste aller Momente, in denen ein neues e1RM-Bestwert aufgestellt wurde. */
function buildPrTimeline(setsAsc) {
  const timeline = [];
  let best = 0;
  for (const s of setsAsc) {
    const e1rm = estimate1RM(s.weight, s.reps);
    if (e1rm > best) {
      best = e1rm;
      timeline.push({ date: s.date, weight: s.weight, reps: s.reps });
    }
  }
  return timeline;
}
