import { getAllCalendarEvents } from './shared/event-store.js';
import { getSourceColor, getSourceLabel } from './shared/calendar-schema.js';
import { getHubEventById, createHubEvent, updateHubEvent, deleteHubEvent, stripHubId, ensureHubEventsSynced } from './shared/hub-events.js';

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const HOUR_PX = 56;
const MAX_BARS_PER_CELL = 4;

let cursor = new Date();
let selectedDay = toDateKey(new Date());
let allEvents = [];
let viewMode = 'month'; // 'month' | 'day'

function pad(n) { return String(n).padStart(2, '0'); }
function toDateKey(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Individuelle Termin-Farbe (E68+-Nachtrag) hat Vorrang vor der sonst
 *  gemeinsamen Quell-Farbe - bisher nur von Hub-eigenen Terminen gesetzt. */
function eventColor(event) {
  return event.color || getSourceColor(event.source);
}

/** Ein Event ist ganztaegig/mehrtaegig-Balken (oben, ohne Uhrzeit), wenn sein
 *  `start` keine Uhrzeit traegt ODER `end` auf ein anderes Kalenderdatum faellt. */
function hasTime(iso) { return iso.length > 10; }
function endDateKey(event) { return event.end ? event.end.slice(0, 10) : event.start.slice(0, 10); }
function isAllDayBar(event) { return !hasTime(event.start) || endDateKey(event) !== event.start.slice(0, 10); }

function matchesDate(event, dateKey) {
  if (event.recurrence === 'yearly') return event.start.slice(5, 10) === dateKey.slice(5, 10);
  const startKey = event.start.slice(0, 10);
  const endKey = endDateKey(event);
  return dateKey >= startKey && dateKey <= endKey;
}
function eventsForDay(dateKey) {
  return allEvents.filter((e) => matchesDate(e, dateKey));
}

async function load() {
  await ensureHubEventsSynced();
  allEvents = await getAllCalendarEvents().catch(() => []);
  render();
}

function render() {
  document.getElementById('cal-title').textContent = `${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`;
  renderMonthGrid();
  renderLegend();
  if (viewMode === 'day') renderDayView();
}

function renderMonthGrid() {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // Montag-Start
  const todayKey = toDateKey(new Date());
  const gridStart = new Date(year, month, 1 - offset);

  let cells = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    const dateKey = toDateKey(d);
    const inMonth = d.getMonth() === month;
    const dayEvents = eventsForDay(dateKey);
    const bars = dayEvents.slice(0, MAX_BARS_PER_CELL)
      .map((e) => `<div class="cal-bar" style="background:${eventColor(e)}"></div>`).join('');
    const overflow = dayEvents.length - MAX_BARS_PER_CELL;
    cells += `
      <div class="cal-cell ${inMonth ? '' : 'cal-cell--muted'} ${dateKey === todayKey ? 'cal-cell--today' : ''} ${dateKey === selectedDay ? 'cal-cell--selected' : ''}" data-day="${dateKey}">
        <span class="cal-cell__num">${d.getDate()}</span>
        <div class="cal-cell__bars">${bars}${overflow > 0 ? `<div class="cal-bar-more">+${overflow}</div>` : ''}</div>
      </div>`;
  }
  const grid = document.getElementById('cal-grid');
  grid.innerHTML = cells;
  grid.querySelectorAll('[data-day]').forEach((el) => {
    el.addEventListener('click', () => { selectedDay = el.dataset.day; openDayView(); });
  });
}

function renderLegend() {
  const sources = [...new Set(allEvents.map((e) => e.source))];
  const legend = document.getElementById('legend');
  if (!sources.length) { legend.innerHTML = ''; return; }
  legend.innerHTML = sources.map((src) => `
    <div class="legend-item">
      <span class="legend-swatch" style="background:${getSourceColor(src)}"></span>
      <span class="legend-item__text">${escapeHtml(getSourceLabel(src))}</span>
    </div>
  `).join('');
}

function openDayView() {
  viewMode = 'day';
  document.getElementById('month-view').hidden = true;
  document.getElementById('day-view').hidden = false;
  renderDayView();
}
function closeDayView() {
  viewMode = 'month';
  document.getElementById('day-view').hidden = true;
  document.getElementById('month-view').hidden = false;
  render();
}

function minutesOf(hhmm) { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; }

function renderDayView() {
  const [y, m, d] = selectedDay.split('-');
  document.getElementById('day-view-title').textContent = `${d}.${m}.${y}`;

  const dayEvents = eventsForDay(selectedDay).sort((a, b) => a.start.localeCompare(b.start));
  const allDayEvents = dayEvents.filter(isAllDayBar);
  const timedEvents = dayEvents.filter((e) => !isAllDayBar(e));

  const alldayEl = document.getElementById('day-allday');
  alldayEl.innerHTML = allDayEvents.length
    ? allDayEvents.map((e) => `
        <div class="day-allday-bar" data-event="${e.id}" style="background:${eventColor(e)}">
          ${escapeHtml(e.title)}
        </div>`).join('')
    : '';

  // Einfache Spalten-Zuteilung fuer sich zeitlich ueberschneidende Termine.
  const sorted = [...timedEvents].map((e) => {
    const startM = minutesOf(e.start.slice(11, 16));
    const endHasTime = e.end && hasTime(e.end);
    const endM = endHasTime ? minutesOf(e.end.slice(11, 16)) : startM + 60;
    return { e, startM, endM: Math.max(endM, startM + 20) };
  }).sort((a, b) => a.startM - b.startM);
  const colEnds = [];
  const placed = sorted.map((item) => {
    let col = colEnds.findIndex((endM) => endM <= item.startM);
    if (col === -1) { col = colEnds.length; colEnds.push(item.endM); }
    else colEnds[col] = item.endM;
    return { ...item, col };
  });
  const totalCols = Math.max(colEnds.length, 1);

  const hoursEl = document.getElementById('day-hours');
  hoursEl.innerHTML = Array.from({ length: 24 }, (_, h) => `<div class="hour-label">${pad(h)}:00</div>`).join('');

  const gridEl = document.getElementById('day-grid');
  gridEl.style.height = `${24 * HOUR_PX}px`;
  gridEl.innerHTML = placed.map(({ e, startM, endM, col }) => {
    const top = (startM / 60) * HOUR_PX;
    const height = ((endM - startM) / 60) * HOUR_PX;
    const width = `calc(${100 / totalCols}% - 6px)`;
    const left = `calc(${(100 / totalCols) * col}% + 3px)`;
    const timeLabel = `${e.start.slice(11, 16)}${e.end && hasTime(e.end) ? '–' + e.end.slice(11, 16) : ''}`;
    return `
      <div class="day-event-bar" data-event="${e.id}" style="top:${top}px; height:${height}px; left:${left}; width:${width}; background:${eventColor(e)}">
        <div class="day-event-bar__title">${escapeHtml(e.title)}</div>
        <div class="day-event-bar__time">${timeLabel}</div>
      </div>`;
  }).join('');

  [...alldayEl.querySelectorAll('[data-event]'), ...gridEl.querySelectorAll('[data-event]')].forEach((el) => {
    el.addEventListener('click', () => onEventTap(el.dataset.event));
  });

  // Beim ersten Oeffnen an die aktuelle Uhrzeit scrollen (heute) bzw. auf 7 Uhr (andere Tage).
  const scrollEl = document.getElementById('day-scroll');
  const isToday = selectedDay === toDateKey(new Date());
  const anchorMinutes = isToday ? (new Date().getHours() * 60 + new Date().getMinutes()) : 7 * 60;
  requestAnimationFrame(() => {
    scrollEl.scrollTop = Math.max(0, (anchorMinutes / 60) * HOUR_PX - scrollEl.clientHeight / 2);
  });
}

function onEventTap(calendarEventId) {
  const event = allEvents.find((e) => e.id === calendarEventId);
  if (!event) return;
  if (event.source === 'hub') {
    const hubEvent = getHubEventById(stripHubId(calendarEventId));
    if (hubEvent) openEventModal(hubEvent);
    return;
  }
  openForwardDialog(event);
}

/** Termine aus anderen Apps verwaltet der Hub bewusst nicht selbst (siehe
 *  App-Architektur) - stattdessen wird angeboten, direkt zur Quell-App und,
 *  falls die App beim Spiegeln einen link mitgegeben hat (siehe
 *  calendar-schema.js), zur genauen Stelle des Termins weiterzuleiten. */
function openForwardDialog(event) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-sheet modal-sheet--center">
      <button class="modal-close" data-close type="button"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      <div class="modal-title">${escapeHtml(event.title)}</div>
      <p class="empty-hint">Aus: ${escapeHtml(getSourceLabel(event.source))}</p>
      <p style="margin:10px 0 16px">Zur ${escapeHtml(getSourceLabel(event.source))}-App und zum Ort dieses Termins wechseln?</p>
      <button type="button" class="btn btn-primary" id="forward-go">Weiterleiten</button>
      <button type="button" class="btn btn-ghost" id="forward-cancel" style="margin-top:8px">Abbrechen</button>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', (ev) => { if (ev.target === overlay) close(); });
  overlay.querySelector('[data-close]').addEventListener('click', close);
  overlay.querySelector('#forward-cancel').addEventListener('click', close);
  overlay.querySelector('#forward-go').addEventListener('click', () => {
    // Bewusst ein echtes <a>-Element mit target="_blank" statt location.href:
    // eine reine Skript-Navigation bleibt auf Android innerhalb des Hub-PWA-
    // Fensters haengen, selbst wenn das Ziel im Scope einer ANDEREN
    // installierten, verwandten PWA liegt - ein echter Link-Klick wird vom
    // System dagegen als eigenstaendige Navigation erkannt und kann in die
    // Ziel-App (statt in einen Browser-Tab) weitergeleitet werden.
    // ./ statt ../: die Hub-Seite selbst liegt (anders als jede Unter-App,
    // die eine Ebene tiefer liegt) direkt im Repo-Wurzelverzeichnis. Lokal
    // faellt das nicht auf (../ am Origin-Root ist dort ein No-op), aber auf
    // GitHub Pages liegt der Hub unter /life-hub/ - ../ ging dort faelschlich
    // eine Ebene ÜBER die ganze Seite hinaus (per Screenshot bestaetigt: 404
    // auf der nackten Domain-Wurzel statt der Ziel-App).
    const a = document.createElement('a');
    a.href = `./${event.source}/${event.link || ''}`;
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
}

function openEventModal(existing) {
  const isEdit = !!existing;
  const dateStart = existing?.dateStart || selectedDay;
  const dateEnd = existing?.dateEnd || selectedDay;
  const allDay = existing ? existing.allDay : false;
  const timeStart = existing?.timeStart || '09:00';
  const timeEnd = existing?.timeEnd || '10:00';
  const color = existing?.color || getSourceColor('hub');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-sheet">
      <button class="modal-close" data-close type="button"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      <div class="modal-handle"></div>
      <div class="modal-title">${isEdit ? 'Termin bearbeiten' : 'Termin hinzufügen'}</div>
      <form id="event-form">
        <div class="field">
          <label>Titel</label>
          <input class="input" name="title" type="text" required value="${escapeHtml(existing?.title || '')}">
        </div>
        <div class="field">
          <label>Zeitraum</label>
          <div class="input-row">
            <input class="input" name="dateStart" type="date" value="${dateStart}" required>
            <input class="input" name="dateEnd" type="date" value="${dateEnd}" required>
          </div>
        </div>
        <div class="chip-row" style="margin-bottom:12px">
          <button type="button" class="chip ${allDay ? 'active' : ''}" id="chip-allday">Ganztägig</button>
        </div>
        <div class="field" id="time-fields" ${allDay ? 'hidden' : ''}>
          <label>Uhrzeit</label>
          <div class="input-row">
            <input class="input" name="timeStart" type="time" value="${timeStart}">
            <input class="input" name="timeEnd" type="time" value="${timeEnd}">
          </div>
        </div>
        <div class="field">
          <label>Farbe</label>
          <input class="color-input" name="color" type="color" value="${color}">
        </div>
        <button type="submit" class="btn btn-primary">Speichern</button>
        ${isEdit ? '<button type="button" class="btn btn-ghost btn-danger" id="event-delete">Löschen</button>' : ''}
      </form>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener('click', (ev) => { if (ev.target === overlay) close(); });
  overlay.querySelector('[data-close]').addEventListener('click', close);

  let allDayState = allDay;
  const chip = overlay.querySelector('#chip-allday');
  chip.addEventListener('click', () => {
    allDayState = !allDayState;
    chip.classList.toggle('active', allDayState);
    overlay.querySelector('#time-fields').hidden = allDayState;
  });

  const form = overlay.querySelector('#event-form');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const data = new FormData(form);
    const fields = {
      title: data.get('title').trim(),
      dateStart: data.get('dateStart'),
      dateEnd: data.get('dateEnd'),
      allDay: allDayState,
      timeStart: data.get('timeStart'),
      timeEnd: data.get('timeEnd'),
      color: data.get('color'),
    };
    if (!fields.title) return;
    if (isEdit) await updateHubEvent(existing.id, fields);
    else await createHubEvent(fields);
    close();
    await load();
  });

  if (isEdit) {
    overlay.querySelector('#event-delete').addEventListener('click', async () => {
      await deleteHubEvent(existing.id);
      close();
      await load();
    });
  }
}

document.getElementById('cal-prev').addEventListener('click', () => { cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1); render(); });
document.getElementById('cal-next').addEventListener('click', () => { cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1); render(); });
document.getElementById('day-back').addEventListener('click', closeDayView);
document.getElementById('day-add').addEventListener('click', () => openEventModal(null));
document.getElementById('cal-fab').addEventListener('click', () => openEventModal(null));

load();
