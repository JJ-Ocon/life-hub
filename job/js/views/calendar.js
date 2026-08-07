import { setTitle, setActions, setBack } from '../router.js';
import { getAppointmentsForDate } from '../db.js';
import { getPersonById } from '../../../shared/contacts.js';
import { openModal, toast } from '../ui.js';
import {
  todayKey, addDaysToDateKey, weekdayOfDateKey, daysInMonth, monthLabel, formatDateKey, escapeHtml,
} from '../utils.js';
import { openApptModal } from './appointments.js';

const WEEKDAY_HEADERS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

let cursor = todayKey(); // Referenzdatum, immer der 1. des angezeigten Monats

export function render() {
  setTitle('Kalender');
  setBack(null);
  setActions(`
    <button class="icon-btn" id="jcal-add" aria-label="Termin hinzufügen">
      <svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
    </button>
  `);
  draw();
  document.getElementById('jcal-add').addEventListener('click', () => openApptModal(null, draw, todayKey()));
}

function draw() {
  const view = document.getElementById('view');
  view.innerHTML = `
    <div class="row row--between cal-nav">
      <button class="icon-btn" id="jcal-prev" aria-label="Zurück"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
      <div class="col" style="align-items:center; text-align:center">
        <h3>${headerLabel()}</h3>
        <button class="chip" id="jcal-today" style="margin-top:4px">Heute</button>
      </div>
      <button class="icon-btn" id="jcal-next" aria-label="Weiter"><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>
    </div>
    ${monthGridHtml()}
  `;

  document.getElementById('jcal-prev').addEventListener('click', () => { step(-1); draw(); });
  document.getElementById('jcal-next').addEventListener('click', () => { step(1); draw(); });
  document.getElementById('jcal-today').addEventListener('click', () => { cursor = todayKey(); draw(); });

  view.querySelectorAll('[data-day]').forEach((el) => {
    el.addEventListener('click', () => openDayModal(el.dataset.day));
  });
}

function headerLabel() {
  const [y, m] = cursor.split('-').map(Number);
  return monthLabel(y, m - 1);
}

function step(dir) {
  const [y, m] = cursor.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + dir, 1));
  cursor = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function monthGridHtml() {
  const [year, month] = cursor.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n)));
  const firstOfMonth = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const offset = (weekdayOfDateKey(firstOfMonth) + 6) % 7; // Montag-Start
  const total = daysInMonth(year, month);
  const gridStart = addDaysToDateKey(firstOfMonth, -offset);
  const today = todayKey();
  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  const cellCount = offset + total <= 35 ? 35 : 42;

  let cells = '';
  for (let i = 0; i < cellCount; i++) {
    const dateKey = addDaysToDateKey(gridStart, i);
    const inMonth = dateKey.startsWith(monthPrefix);
    const count = getAppointmentsForDate(dateKey).length;
    const dayNum = Number(dateKey.slice(8, 10));
    cells += `
      <div class="cal-cell ${inMonth ? '' : 'cal-cell--muted'} ${dateKey === today ? 'cal-cell--today' : ''}" data-day="${dateKey}">
        <span>${dayNum}</span>
        ${count ? '<span class="cal-cell__dot"></span>' : ''}
      </div>
    `;
  }

  return `
    <div class="cal-grid" style="margin-bottom:6px">
      ${WEEKDAY_HEADERS.map((w) => `<div class="cal-weekday">${w}</div>`).join('')}
    </div>
    <div class="cal-grid">${cells}</div>
  `;
}

function openDayModal(dateKey) {
  const draw2 = () => {
    const appts = getAppointmentsForDate(dateKey).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    handle.sheet.querySelector('#jcal-day-list').innerHTML = appts.length === 0
      ? '<p class="faint" style="padding:8px 0">Keine Termine an diesem Tag.</p>'
      : appts.map((a) => {
        const person = a.personId ? getPersonById(a.personId) : null;
        return `
          <div class="cal-day-appt card--tap" data-open="${a.id}" style="cursor:pointer">
            <div class="col grow" style="min-width:0">
              <p class="truncate">${a.done ? '✓ ' : ''}${escapeHtml(a.title)}</p>
              <p class="faint" style="font-size:.78rem">
                ${a.time ? a.time + ' · ' : ''}${a.location ? '📍 ' + escapeHtml(a.location) : ''}${person ? (a.location ? ' · ' : '') + escapeHtml(person.name) : ''}
              </p>
            </div>
          </div>
        `;
      }).join('');

    handle.sheet.querySelectorAll('[data-open]').forEach((el) => {
      const appt = appts.find((a) => a.id === el.dataset.open);
      el.addEventListener('click', () => {
        handle.close();
        openApptModal(appt, () => { toast('Gespeichert'); draw(); }, dateKey);
      });
    });
  };

  const handle = openModal(`
    <h3 class="modal-title">${formatDateKey(dateKey, { withWeekday: true, withYear: true })}</h3>
    <div id="jcal-day-list" style="margin-bottom:16px"></div>
    <button class="btn btn-primary" id="jcal-day-add">+ Termin an diesem Tag</button>
  `, { center: true, onClose: () => draw() });

  draw2();
  handle.sheet.querySelector('#jcal-day-add').addEventListener('click', () => {
    handle.close();
    openApptModal(null, draw, dateKey);
  });
}
