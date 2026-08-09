import { setTitle, setActions, setBack, navigate } from '../router.js';
import { getSkills, getSkillById, createLearningPlan, getLearningPlans, deleteLearningPlan } from '../db.js';
import { openModal, toast, confirmDialog } from '../ui.js';
import {
  todayKey, addDaysToDateKey, weekdayOfDateKey, daysInMonth, formatDateKey, monthLabel, weekdayLabel, escapeHtml,
} from '../utils.js';
import { openTodoModal } from './home.js';

const WEEKDAY_HEADERS = [0, 1, 2, 3, 4, 5, 6].map((i) => weekdayLabel(i));

let cursor = todayKey();
let presetSkillId = null;

/** Tagesauswahl-Kalender (E58, angelehnt an Fitness' Kalender-Ansicht):
 *  von hier aus lassen sich Todos ODER Lernplaene fuer einen bestimmten Tag
 *  anlegen - Lernplaene inkl. Wochentags-Wiederholung und Dauer. */
export function render() {
  setTitle('Kalender');
  setBack(null);
  setActions('');

  const query = new URLSearchParams(location.hash.split('?')[1] || '');
  const skillId = query.get('skillId');
  if (skillId) {
    history.replaceState(null, '', location.pathname + '#/calendar');
    presetSkillId = skillId;
  }

  draw();
}

function draw() {
  const view = document.getElementById('view');
  const [year, month] = cursor.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n)));
  const firstOfMonth = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const offset = (weekdayOfDateKey(firstOfMonth) + 6) % 7; // Montag-Start
  const total = daysInMonth(year, month);
  const gridStart = addDaysToDateKey(firstOfMonth, -offset);
  const today = todayKey();
  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  const plans = getLearningPlans();

  let cells = '';
  for (let i = 0; i < 42; i++) {
    const dateKey = addDaysToDateKey(gridStart, i);
    if (i >= 35 && !dateKey.startsWith(monthPrefix)) break;
    const inMonth = dateKey.startsWith(monthPrefix);
    const weekday = weekdayOfDateKey(dateKey);
    const hasPlan = plans.some((p) => p.weekdays.includes((weekday + 6) % 7) && dateKey >= p.startDate);
    cells += `
      <div class="gcal-cell ${inMonth ? '' : 'gcal-cell--muted'} ${dateKey === today ? 'gcal-cell--today' : ''}" data-day="${dateKey}">
        <span class="gcal-cell__num">${Number(dateKey.slice(8, 10))}</span>
        ${hasPlan ? '<span class="gcal-dot"></span>' : ''}
      </div>
    `;
  }

  view.innerHTML = `
    <div class="row row--between cal-nav" style="margin-bottom:14px">
      <button class="icon-btn" id="cal-prev" aria-label="Zurück"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
      <div class="col" style="align-items:center;text-align:center">
        <h3>${monthLabel(year, month)}</h3>
        <button class="chip" id="cal-today" style="margin-top:4px">Heute</button>
      </div>
      <button class="icon-btn" id="cal-next" aria-label="Weiter"><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>
    </div>
    <div class="gcal-grid gcal-grid--headers">
      ${WEEKDAY_HEADERS.map((w) => `<div class="gcal-weekday">${w}</div>`).join('')}
    </div>
    <div class="gcal-grid">${cells}</div>

    ${plans.length ? `
      <div class="section-title">Lernpläne</div>
      <div class="card stack">
        ${plans.map((p) => {
          const skill = getSkillById(p.skillId);
          return `
            <div class="row row--between">
              <div class="col grow" style="min-width:0">
                <span class="truncate">${escapeHtml(skill?.name || '?')}</span>
                <span class="faint">${p.weekdays.map((w) => weekdayLabel(w)).join(', ')} · ${p.durationMinutes} Min.</span>
              </div>
              <button class="icon-btn" data-del-plan="${p.id}" aria-label="Löschen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg></button>
            </div>
          `;
        }).join('')}
      </div>
    ` : ''}
  `;

  document.getElementById('cal-prev').addEventListener('click', () => { cursor = addDaysToDateKey(firstOfMonth, -1); draw(); });
  document.getElementById('cal-next').addEventListener('click', () => { cursor = addDaysToDateKey(firstOfMonth, total); draw(); });
  document.getElementById('cal-today').addEventListener('click', () => { cursor = todayKey(); draw(); });
  view.querySelectorAll('[data-day]').forEach((el) => {
    el.addEventListener('click', () => openDayModal(el.dataset.day));
  });
  view.querySelectorAll('[data-del-plan]').forEach((el) => {
    el.addEventListener('click', async () => {
      const ok = await confirmDialog('Lernplan löschen?', 'Wird unwiderruflich gelöscht.');
      if (!ok) return;
      deleteLearningPlan(el.dataset.delPlan);
      toast('Gelöscht');
      draw();
    });
  });
}

function openDayModal(dateKey) {
  const skills = getSkills();
  const handle = openModal(`
    <h3 class="modal-title">${formatDateKey(dateKey, { withWeekday: true })}</h3>
    <div class="stack">
      <button class="btn btn-primary" id="dm-todo">+ Todo für diesen Tag</button>
      ${skills.length ? '<button class="btn btn-ghost" id="dm-plan">📚 Lernplan für diesen Tag</button>' : ''}
    </div>
  `, { center: true });

  handle.sheet.querySelector('#dm-todo').addEventListener('click', () => {
    handle.close();
    openTodoModal({ id: null, title: '', dueDate: dateKey, goalId: null }, draw);
  });
  handle.sheet.querySelector('#dm-plan')?.addEventListener('click', () => {
    handle.close();
    openLearningPlanModal(dateKey);
  });
}

function openLearningPlanModal(dateKey) {
  const skills = getSkills();
  const weekday = (weekdayOfDateKey(dateKey) + 6) % 7;
  let weekdays = new Set([weekday]);

  const handle = openModal(`
    <h3 class="modal-title">Lernplan anlegen</h3>
    <div class="field">
      <label>Skill</label>
      <select class="input" id="lp-skill">
        ${skills.map((s) => `<option value="${s.id}" ${presetSkillId === s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
      </select>
    </div>
    <div class="field">
      <label>An diesen Wochentagen</label>
      <div class="chip-row" id="lp-weekday-row">
        ${[0, 1, 2, 3, 4, 5, 6].map((d) => `<button type="button" class="chip ${weekdays.has(d) ? 'active' : ''}" data-weekday="${d}">${weekdayLabel(d)}</button>`).join('')}
      </div>
    </div>
    <div class="field">
      <label>Dauer (Minuten)</label>
      <input class="input" type="number" min="1" id="lp-duration" value="30">
    </div>
    <p class="faint" style="margin:-6px 0 14px">Ab ${formatDateKey(dateKey)}, für die nächsten Wochen im Kalender sichtbar.</p>
    <button class="btn btn-primary" id="lp-save">Anlegen</button>
  `, { center: true });

  handle.sheet.querySelectorAll('[data-weekday]').forEach((b) => b.addEventListener('click', () => {
    const d = Number(b.dataset.weekday);
    if (weekdays.has(d)) weekdays.delete(d); else weekdays.add(d);
    b.classList.toggle('active', weekdays.has(d));
  }));

  handle.sheet.querySelector('#lp-save').addEventListener('click', () => {
    const skillId = handle.sheet.querySelector('#lp-skill').value;
    if (!skillId) { toast('Bitte einen Skill wählen'); return; }
    if (!weekdays.size) { toast('Bitte mindestens einen Wochentag wählen'); return; }
    const durationMinutes = Number(handle.sheet.querySelector('#lp-duration').value) || 30;
    createLearningPlan({ skillId, weekdays: [...weekdays], startDate: dateKey, durationMinutes });
    toast('Lernplan angelegt');
    presetSkillId = null;
    handle.close();
    draw();
  });
}
