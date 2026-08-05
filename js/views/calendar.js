import { setTitle, setActions, setBack } from '../router.js';
import {
  getSessions, getRoutines, getActiveSession, startSessionFromRoutine, startRetroactiveSession, sessionVolume, getSettings,
  getCalendarEntriesForDate, saveCalendarEntry, deleteCalendarEntry, deleteCalendarGroup, createDeloadWeek,
  getWeeklyPlan, syncWeeklyPlanToCalendar, getCalendarColor, clearMissedPlannedEntries,
} from '../db.js';
import { openModal, confirmDialog, toast } from '../ui.js';
import {
  todayKey, addDaysToDateKey, mondayOfWeekKey, weekdayOfDateKey, daysInMonth, formatDateKey, monthLabel,
  formatDuration, formatNum, escapeHtml,
} from '../utils.js';

const WEEKDAY_HEADERS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

let mode = 'month'; // 'month' | 'week'
let cursor = todayKey(); // Referenzdatum fuer Monat/Woche

export function render() {
  setTitle('Kalender');
  setBack(null);

  // Verpasste Rotations-Termine vor dem Zeichnen nachrutschen lassen
  const plan = getWeeklyPlan();
  if (plan.autoFill) syncWeeklyPlanToCalendar(plan);
  clearMissedPlannedEntries();

  setActions(`
    <button class="icon-btn" id="cal-weekplan" aria-label="Wochenplan">
      <svg viewBox="0 0 24 24"><path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h10"/><circle cx="19" cy="18" r="2"/></svg>
    </button>
    <button class="icon-btn" id="cal-toggle-mode" aria-label="Ansicht wechseln">
      ${mode === 'month'
        ? '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 10h18"/><path d="M8 2v4"/><path d="M16 2v4"/></svg>'
        : '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 5h18"/><path d="M8 3v4"/><path d="M16 3v4"/><path d="M7 14h2"/><path d="M11 14h2"/><path d="M15 14h2"/></svg>'}
    </button>
  `);

  draw();

  document.getElementById('cal-weekplan').addEventListener('click', () => { location.hash = '#/weekplan'; });
  document.getElementById('cal-toggle-mode').addEventListener('click', () => {
    mode = mode === 'month' ? 'week' : 'month';
    render();
  });
}

function draw() {
  const view = document.getElementById('view');
  view.innerHTML = `
    <div class="row row--between cal-nav">
      <button class="icon-btn" id="cal-prev" aria-label="Zurück"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
      <div class="col" style="align-items:center; text-align:center">
        <h3>${headerLabel()}</h3>
        <button class="chip" id="cal-today" style="margin-top:4px">Heute</button>
      </div>
      <button class="icon-btn" id="cal-next" aria-label="Weiter"><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>
    </div>
    ${mode === 'month' ? monthGridHtml() : weekListHtml()}
  `;

  document.getElementById('cal-prev').addEventListener('click', () => { step(-1); draw(); });
  document.getElementById('cal-next').addEventListener('click', () => { step(1); draw(); });
  document.getElementById('cal-today').addEventListener('click', () => { cursor = todayKey(); draw(); });

  view.querySelectorAll('[data-day]').forEach((el) => {
    el.addEventListener('click', () => openDayModal(el.dataset.day));
  });
}

function headerLabel() {
  if (mode === 'month') {
    const [y, m] = cursor.split('-').map(Number);
    return monthLabel(y, m - 1);
  }
  const monday = mondayOfWeekKey(cursor);
  const sunday = addDaysToDateKey(monday, 6);
  return `${formatDateKey(monday)} – ${formatDateKey(sunday, { withYear: true })}`;
}

function step(dir) {
  if (mode === 'month') {
    const [y, m] = cursor.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + dir, 1));
    cursor = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
  } else {
    cursor = addDaysToDateKey(cursor, dir * 7);
  }
}

/* ---------- Tages-Info ---------- */

function dayInfo(dateKey) {
  const sessions = getSessions().filter((s) => s.endedAt && todayKey(new Date(s.startedAt)) === dateKey);
  const entries = getCalendarEntriesForDate(dateKey);
  const deloadEntry = entries.find((e) => e.type === 'deload');
  const planned = entries.filter((e) => e.type !== 'deload');
  return { sessions, planned, deloadEntry };
}

/* ---------- Monatsansicht ---------- */

function monthGridHtml() {
  const [year, month] = cursor.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n)));
  const firstOfMonth = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const offset = (weekdayOfDateKey(firstOfMonth) + 6) % 7; // Montag-Start
  const total = daysInMonth(year, month);
  const gridStart = addDaysToDateKey(firstOfMonth, -offset);
  const today = todayKey();
  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;

  let cells = '';
  for (let i = 0; i < 42; i++) {
    const dateKey = addDaysToDateKey(gridStart, i);
    const inMonth = dateKey.startsWith(monthPrefix);
    const { sessions, planned, deloadEntry } = dayInfo(dateKey);
    const dayNum = Number(dateKey.slice(8, 10));
    const deloadColor = getCalendarColor('deload');
    cells += `
      <div class="cal-cell ${inMonth ? '' : 'cal-cell--muted'} ${dateKey === today ? 'cal-cell--today' : ''}" data-day="${dateKey}"
        ${deloadEntry ? `style="background:color-mix(in srgb, ${deloadColor} 20%, var(--bg-card)); border-color:${deloadColor}"` : ''}>
        <span class="cal-cell__num">${dayNum}</span>
        <span class="cal-dots">
          ${sessions.length ? `<span class="cal-dot" style="background:${getCalendarColor('done')}"></span>` : ''}
          ${planned.length ? `<span class="cal-dot" style="background:${getCalendarColor('planned')}"></span>` : ''}
        </span>
      </div>
    `;
    if (i === 34 && !hasContentInLastRow(gridStart, 35, 42, monthPrefix)) { i = 41; break; }
  }

  return `
    <div class="cal-grid cal-grid--headers">
      ${WEEKDAY_HEADERS.map((w) => `<div class="cal-weekday">${w}</div>`).join('')}
    </div>
    <div class="cal-grid">${cells}</div>
    ${legendHtml()}
  `;
}

function hasContentInLastRow(gridStart, from, to, monthPrefix) {
  for (let i = from; i < to; i++) {
    if (addDaysToDateKey(gridStart, i).startsWith(monthPrefix)) return true;
  }
  return false;
}

function legendHtml() {
  return `
    <div class="row cal-legend">
      <span class="cal-dot" style="background:${getCalendarColor('done')}"></span><span class="faint">Absolviert</span>
      <span class="cal-dot" style="background:${getCalendarColor('planned')}"></span><span class="faint">Geplant</span>
      <span class="cal-legend__deload" style="background:${getCalendarColor('deload')}"></span><span class="faint">Deload</span>
    </div>
  `;
}

/* ---------- Wochenansicht ---------- */

function weekListHtml() {
  const monday = mondayOfWeekKey(cursor);
  const settings = getSettings();
  const today = todayKey();
  const days = Array.from({ length: 7 }, (_, i) => addDaysToDateKey(monday, i));

  return `
    <div class="stack">
      ${days.map((dateKey) => {
        const { sessions, planned, deloadEntry } = dayInfo(dateKey);
        return `
          <div class="card card--tap ${dateKey === today ? 'cal-week-row--today' : ''}" data-day="${dateKey}">
            <div class="row row--between">
              <h3>${formatDateKey(dateKey, { withWeekday: true })}</h3>
              ${deloadEntry ? `<span class="badge" style="background:${getCalendarColor('deload')};color:#1a1400">Deload</span>` : ''}
            </div>
            ${sessions.length === 0 && planned.length === 0 ? `<p class="faint" style="margin-top:6px">–</p>` : ''}
            ${sessions.map((s) => `
              <div class="row row--between" style="margin-top:8px">
                <div class="col grow">
                  <p><span class="cal-dot" style="background:${getCalendarColor('done')}"></span> ${escapeHtml(s.routineName)}</p>
                  ${s.comment ? `<p class="faint truncate">${escapeHtml(s.comment.split('\n')[0])}</p>` : ''}
                </div>
                <div class="badge">${formatNum(sessionVolume(s), 0)} ${settings.units}</div>
              </div>
            `).join('')}
            ${planned.map((p) => `
              <p class="faint" style="margin-top:8px"><span class="cal-dot" style="background:${getCalendarColor(p.type === 'workout' ? 'planned' : p.type)}"></span> ${plannedIcon(p)} ${escapeHtml(p.routineName || p.note || plannedLabel(p))}</p>
            `).join('')}
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function plannedIcon(p) {
  if (p.type === 'workout') return '📅';
  if (p.type === 'rest') return '💤';
  return '📝';
}
function plannedLabel(p) {
  if (p.type === 'rest') return 'Ruhetag';
  if (p.type === 'workout') return 'Workout geplant';
  return 'Notiz';
}

/* ---------- Tages-Detail-Modal ---------- */

function openDayModal(dateKey) {
  const settings = getSettings();

  function content() {
    const { sessions, planned, deloadEntry } = dayInfo(dateKey);
    return `
      <h3 class="modal-title">${formatDateKey(dateKey, { withWeekday: true, withYear: true })}</h3>
      ${deloadEntry ? `
        <div class="row row--between" style="margin-bottom:14px">
          <span class="badge" style="background:${getCalendarColor('deload')};color:#1a1400">Deload-Woche</span>
          <button class="btn btn-ghost btn-sm" id="cal-unset-deload">Aufheben</button>
        </div>
      ` : ''}

      <div class="section-title" style="margin-top:0">Absolvierte Workouts</div>
      ${sessions.length === 0 ? `<p class="faint" style="padding:0 2px">Keine Workouts an diesem Tag.</p>` : `
        <div class="stack" style="margin-bottom:6px">
          ${sessions.map((s) => `
            <div class="card card--tap" data-open-session="${s.id}" style="margin-bottom:0">
              <div class="row row--between">
                <div class="col grow">
                  <h3 class="truncate"><span class="cal-dot" style="background:${getCalendarColor('done')}"></span> ${escapeHtml(s.routineName)}</h3>
                  <p class="faint">${formatDuration((new Date(s.endedAt) - new Date(s.startedAt)) / 1000)}</p>
                </div>
                <div class="badge">${formatNum(sessionVolume(s), 0)} ${settings.units}</div>
              </div>
              ${s.comment ? `<p class="faint" style="margin-top:8px; white-space:pre-wrap">${escapeHtml(s.comment)}</p>` : ''}
            </div>
          `).join('')}
        </div>
      `}

      <div class="section-title">Geplant</div>
      ${planned.length === 0 ? `<p class="faint" style="padding:0 2px 4px">Nichts geplant.</p>` : `
        <div class="stack" style="margin-bottom:6px">
          ${planned.map((p) => `
            <div class="row row--between">
              <div class="col grow">
                <p><span class="cal-dot" style="background:${getCalendarColor(p.type === 'workout' ? 'planned' : p.type)}"></span> ${plannedIcon(p)} ${escapeHtml(p.routineName || plannedLabel(p))}</p>
                ${p.note ? `<p class="faint">${escapeHtml(p.note)}</p>` : ''}
              </div>
              <div class="row" style="gap:6px">
                ${p.type === 'workout' ? `<button class="btn btn-primary btn-sm" data-start-plan="${p.id}" ${getActiveSession() ? 'disabled' : ''}>Starten</button>` : ''}
                <button class="icon-btn" data-del-plan="${p.id}" aria-label="Entfernen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg></button>
              </div>
            </div>
          `).join('')}
        </div>
      `}

      <div class="stack" style="margin-top:16px">
        ${dateKey <= todayKey() ? `<button class="btn btn-primary" id="cal-log-retro" ${getActiveSession() ? 'disabled' : ''}>✓ Workout nachtragen (bereits absolviert)</button>` : ''}
        <button class="btn btn-ghost" id="cal-add-entry">+ Workout / Notiz planen</button>
        ${!deloadEntry ? `<button class="btn btn-ghost" id="cal-set-deload">Diese Woche als Deload markieren</button>` : ''}
      </div>
    `;
  }

  const handle = openModal(content(), {});
  wire(handle);

  function wire(h) {
    h.sheet.querySelectorAll('[data-open-session]').forEach((el) => el.addEventListener('click', () => {
      h.close();
      location.hash = `#/history/${el.dataset.openSession}`;
    }));
    h.sheet.querySelectorAll('[data-del-plan]').forEach((el) => el.addEventListener('click', async () => {
      const ok = await confirmDialog('Eintrag entfernen?', 'Dieser geplante Eintrag wird gelöscht.');
      if (!ok) return;
      deleteCalendarEntry(el.dataset.delPlan);
      refresh(h);
    }));
    h.sheet.querySelectorAll('[data-start-plan]').forEach((el) => el.addEventListener('click', () => {
      if (getActiveSession()) { toast('Es läuft bereits ein Training'); return; }
      const { planned } = dayInfo(dateKey);
      const plan = planned.find((p) => p.id === el.dataset.startPlan);
      const routine = getRoutines().find((r) => r.id === plan?.routineId);
      if (!routine) { toast('Routine nicht mehr vorhanden'); return; }
      startSessionFromRoutine(routine);
      h.close();
      location.hash = '#/session';
    }));
    h.sheet.querySelector('#cal-unset-deload')?.addEventListener('click', async () => {
      const { deloadEntry } = dayInfo(dateKey);
      const ok = await confirmDialog('Deload-Woche aufheben?', 'Die Deload-Markierung wird für die gesamte Woche entfernt.');
      if (!ok || !deloadEntry) return;
      deleteCalendarGroup(deloadEntry.groupId);
      refresh(h);
    });
    h.sheet.querySelector('#cal-set-deload')?.addEventListener('click', async () => {
      const ok = await confirmDialog('Woche als Deload markieren?', 'Die ganze Woche (Mo–So) wird als Deload-Woche markiert.', 'Markieren', false);
      if (!ok) return;
      createDeloadWeek(dateKey);
      toast('Deload-Woche markiert');
      refresh(h);
    });
    h.sheet.querySelector('#cal-add-entry')?.addEventListener('click', () => {
      openPlanEntryModal(dateKey, () => refresh(h));
    });
    h.sheet.querySelector('#cal-log-retro')?.addEventListener('click', () => {
      if (getActiveSession()) { toast('Es läuft bereits ein Training'); return; }
      openRetroLogModal(dateKey, h);
    });
  }

  function refresh(h) {
    h.sheet.innerHTML = '<div class="modal-handle"></div>' + content();
    wire(h);
    draw();
  }
}

/* ---------- Workout nachtragen (bereits real absolviert, nur vergessen einzutragen) ---------- */

function openRetroLogModal(dateKey, dayModalHandle) {
  const routines = getRoutines();
  if (!routines.length) { toast('Noch keine Routinen vorhanden'); return; }

  const handle = openModal(`
    <h3 class="modal-title">Workout nachtragen · ${formatDateKey(dateKey, { withWeekday: true })}</h3>
    <p class="faint" style="margin-bottom:14px">
      Für Workouts, die du real gemacht, aber vergessen hast einzutragen. Du landest gleich in der
      normalen Trainingsansicht für dieses Datum – dort reicht "Komplettes Workout abhaken", wenn du
      alles wie geplant absolviert hast, oder du trägst einzelne Sätze wie tatsächlich gemacht ein.
    </p>
    <div class="stack">
      ${routines.map((r) => `<button class="btn btn-ghost" data-retro-routine="${r.id}">${escapeHtml(r.name)}</button>`).join('')}
    </div>
  `, { center: true });

  handle.sheet.querySelectorAll('[data-retro-routine]').forEach((b) => b.addEventListener('click', () => {
    const routine = routines.find((r) => r.id === b.dataset.retroRoutine);
    if (!routine) return;
    startRetroactiveSession(routine, dateKey);
    handle.close();
    dayModalHandle.close();
    location.hash = '#/session';
  }));
}

/* ---------- Eintrag planen (Workout / Ruhetag / Notiz) ---------- */

function openPlanEntryModal(dateKey, onSaved) {
  const routines = getRoutines();
  let type = routines.length ? 'workout' : 'note';

  function content() {
    return `
      <h3 class="modal-title">Eintrag planen · ${formatDateKey(dateKey, { withWeekday: true })}</h3>
      <div class="chip-row" id="plan-type-row" style="margin-bottom:14px">
        <button class="chip ${type === 'workout' ? 'active' : ''}" data-plan-type="workout">Workout</button>
        <button class="chip ${type === 'rest' ? 'active' : ''}" data-plan-type="rest">Ruhetag</button>
        <button class="chip ${type === 'note' ? 'active' : ''}" data-plan-type="note">Notiz</button>
      </div>
      ${type === 'workout' ? `
        <div class="field">
          <label>Routine</label>
          <select class="input" id="plan-routine">
            ${routines.length === 0 ? '<option value="">Keine Routinen vorhanden</option>' : routines.map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('')}
          </select>
        </div>
      ` : ''}
      <div class="field">
        <label>Notiz (optional)</label>
        <textarea class="input" id="plan-note" placeholder="${type === 'rest' ? 'z.B. Grund für den Ruhetag' : 'z.B. Details, Erinnerung'}"></textarea>
      </div>
      <button class="btn btn-primary" id="plan-save" style="margin-top:6px">Speichern</button>
    `;
  }

  const handle = openModal(content(), { center: true });
  wire();

  function wire() {
    handle.sheet.querySelectorAll('[data-plan-type]').forEach((b) => b.addEventListener('click', () => {
      type = b.dataset.planType;
      handle.sheet.innerHTML = content();
      wire();
    }));
    handle.sheet.querySelector('#plan-save').addEventListener('click', () => {
      const note = handle.sheet.querySelector('#plan-note').value.trim();
      if (type === 'workout') {
        const routineId = handle.sheet.querySelector('#plan-routine')?.value;
        const routine = routines.find((r) => r.id === routineId);
        if (!routine) { toast('Bitte eine Routine wählen'); return; }
        saveCalendarEntry({ type: 'workout', date: dateKey, routineId, routineName: routine.name, note });
      } else {
        saveCalendarEntry({ type, date: dateKey, note });
      }
      toast('Geplant');
      handle.close();
      onSaved?.();
    });
  }
}
