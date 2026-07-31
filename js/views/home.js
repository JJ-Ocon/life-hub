import { setTitle, setActions } from '../router.js';
import {
  getRoutines, getSessions, getActiveSession, startSessionFromRoutine, sessionVolume, getSettings,
  getCalendarEntriesForDate, plannedForDate, planAdherence,
} from '../db.js';
import { formatDate, formatDateKey, formatDuration, formatNum, isoWeekKey, todayKey, escapeHtml } from '../utils.js';
import { toast } from '../ui.js';

export function render() {
  setTitle('Start');
  setActions('');

  const routines = getRoutines();
  const sessions = getSessions().filter((s) => s.endedAt);
  const active = getActiveSession();
  const settings = getSettings();

  const thisWeekKey = isoWeekKey(new Date());
  const weekSessions = sessions.filter((s) => isoWeekKey(new Date(s.startedAt)) === thisWeekKey);
  const weekVolume = weekSessions.reduce((sum, s) => sum + sessionVolume(s), 0);

  // Streak: aufeinanderfolgende Wochen mit mind. 1 Workout
  let streak = 0;
  {
    let cursor = new Date();
    for (;;) {
      const key = isoWeekKey(cursor);
      const has = sessions.some((s) => isoWeekKey(new Date(s.startedAt)) === key);
      if (!has) break;
      streak++;
      cursor.setDate(cursor.getDate() - 7);
    }
  }

  const recent = sessions.slice(0, 4);

  // Heutiger Plan: Kalendereintrag hat Vorrang, sonst der wiederkehrende Wochenplan
  const today = todayKey();
  const todaysCalendar = getCalendarEntriesForDate(today).filter((e) => e.type === 'workout');
  const planned = todaysCalendar.length
    ? { routine: routines.find((r) => r.id === todaysCalendar[0].routineId), fromCalendar: true }
    : plannedForDate(today);
  const doneToday = sessions.some((s) => todayKey(new Date(s.startedAt)) === today);
  const todaysRoutine = planned?.routine || null;

  // Verpasste Workouts der letzten 7 Tage – dezenter Hinweis, kein Ton/Push
  const recentMissed = planAdherence(7).missed;

  const html = `
    ${recentMissed.length ? `
      <div class="card" style="border-color:var(--warn)">
        <p class="faint">Verpasst</p>
        <p>${recentMissed.map((m) => `${escapeHtml(m.routineName)} (${formatDateKey(m.date)})`).join(', ')}</p>
      </div>
    ` : ''}

    ${!active && todaysRoutine ? `
      <div class="card today-plan ${doneToday ? 'today-plan--done' : ''}">
        <div class="row row--between">
          <div class="col grow">
            <p class="faint">Heute geplant</p>
            <h3 class="truncate">${escapeHtml(todaysRoutine.name)}</h3>
            <p class="faint">${todaysRoutine.exercises.length} Übungen${doneToday ? ' · heute schon trainiert ✅' : ''}</p>
          </div>
          ${!doneToday ? `<button class="btn btn-primary btn-sm" data-start="${todaysRoutine.id}">Start</button>` : ''}
        </div>
      </div>
    ` : ''}

    ${active ? `
      <div class="card" style="border-color:var(--accent)">
        <div class="row row--between">
          <div class="col">
            <h3>Training läuft: ${active.routineName}</h3>
            <p class="faint">Gestartet ${formatDate(active.startedAt, { withWeekday: true })}</p>
          </div>
        </div>
        <button class="btn btn-primary" style="margin-top:12px" id="resume-session">Fortsetzen</button>
      </div>
    ` : ''}

    <div class="grid-3">
      <div class="stat-tile"><div class="stat-tile__value">${weekSessions.length}</div><div class="stat-tile__label">Workouts diese Woche</div></div>
      <div class="stat-tile"><div class="stat-tile__value">${formatNum(weekVolume, 0)}</div><div class="stat-tile__label">Volumen (${settings.units}) diese Woche</div></div>
      <div class="stat-tile"><div class="stat-tile__value">${streak}</div><div class="stat-tile__label">Wochen-Streak</div></div>
    </div>

    <div class="section-title">Schnellstart</div>
    ${routines.length === 0 ? `
      <div class="card empty" style="margin:0">
        <h3>Noch keine Routine</h3>
        <p class="faint">Lege eine Routine an, um ein Workout zu starten.</p>
        <button class="btn btn-primary" style="margin-top:14px" id="go-routines">Routine erstellen</button>
      </div>
    ` : `
      <div class="stack" id="quickstart-list">
        ${routines.slice(0, 4).map((r) => `
          <div class="card card--tap row row--between" data-quickstart="${r.id}">
            <div class="col grow">
              <h3 class="truncate">${r.name}</h3>
              <p class="faint">${r.exercises.length} Übung${r.exercises.length === 1 ? '' : 'en'}</p>
            </div>
            <button class="btn btn-primary btn-sm" data-start="${r.id}" ${active ? 'disabled' : ''}>Start</button>
          </div>
        `).join('')}
      </div>
    `}

    <div class="section-title">Letzte Workouts</div>
    ${recent.length === 0 ? `<p class="faint" style="padding:0 2px">Noch keine abgeschlossenen Workouts.</p>` : `
      <div class="stack">
        ${recent.map((s) => `
          <div class="card card--tap row row--between" data-open-session="${s.id}">
            <div class="col grow">
              <h3 class="truncate">${s.routineName}</h3>
              <p class="faint">${formatDate(s.startedAt, { withWeekday: true })} · ${formatDuration((new Date(s.endedAt) - new Date(s.startedAt)) / 1000)}</p>
            </div>
            <div class="badge">${formatNum(sessionVolume(s), 0)} ${settings.units}</div>
          </div>
        `).join('')}
      </div>
    `}
  `;

  document.getElementById('view').innerHTML = html;

  document.getElementById('resume-session')?.addEventListener('click', () => location.hash = '#/session');
  document.getElementById('go-routines')?.addEventListener('click', () => location.hash = '#/routines');
  document.querySelectorAll('[data-quickstart]').forEach((card) => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      location.hash = `#/routines/${card.dataset.quickstart}/edit`;
    });
  });
  document.querySelectorAll('[data-start]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (getActiveSession()) { toast('Es läuft bereits ein Training'); return; }
      const routine = routines.find((r) => r.id === btn.dataset.start);
      startSessionFromRoutine(routine);
      location.hash = '#/session';
    });
  });
  document.querySelectorAll('[data-open-session]').forEach((card) => {
    card.addEventListener('click', () => location.hash = `#/history/${card.dataset.openSession}`);
  });
}
