import { getAllCalendarEvents } from './shared/event-store.js';
import { getSourceColor, getSourceLabel, setSourceColor } from './shared/calendar-schema.js';

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

let cursor = new Date();
let selectedDay = toDateKey(new Date());
let allEvents = [];

const HIDDEN_KEY = 'hub_hidden_sources_v1';
function getHiddenSources() {
  try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]')); } catch { return new Set(); }
}
function setHiddenSources(set) {
  localStorage.setItem(HIDDEN_KEY, JSON.stringify([...set]));
}
function toggleSourceVisibility(source) {
  const hidden = getHiddenSources();
  if (hidden.has(source)) hidden.delete(source); else hidden.add(source);
  setHiddenSources(hidden);
}

function pad(n) { return String(n).padStart(2, '0'); }
function toDateKey(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
/** 'yearly' Events (z.B. Social's Geburtstags-Mirror) treffen jedes Jahr am
 *  gleichen Monat/Tag zu, unabhaengig vom Jahr ihres gespeicherten `start` -
 *  das `recurrence`-Feld existiert im Schema seit E3, wird hier zum ersten
 *  Mal tatsaechlich ausgewertet statt nur durchgereicht. */
function matchesDate(event, dateKey) {
  if (event.start.slice(0, 10) === dateKey) return true;
  if (event.recurrence === 'yearly') return event.start.slice(5, 10) === dateKey.slice(5, 10);
  return false;
}
function eventsForDay(dateKey) {
  const hidden = getHiddenSources();
  return allEvents.filter((e) => matchesDate(e, dateKey) && !hidden.has(e.source));
}

async function load() {
  allEvents = await getAllCalendarEvents().catch(() => []);
  render();
}

function render() {
  document.getElementById('cal-title').textContent = `${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`;
  renderGrid();
  renderDayPanel();
  renderLegend();
}

function renderGrid() {
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
    const sources = [...new Set(eventsForDay(dateKey).map((e) => e.source))];
    const dots = sources.map((src) => `<span class="cal-dot" style="background:${getSourceColor(src)}"></span>`).join('');
    cells += `
      <div class="cal-cell ${inMonth ? '' : 'cal-cell--muted'} ${dateKey === todayKey ? 'cal-cell--today' : ''} ${dateKey === selectedDay ? 'cal-cell--selected' : ''}" data-day="${dateKey}">
        <span>${d.getDate()}</span>
        <span class="cal-dots">${dots}</span>
      </div>`;
  }
  const grid = document.getElementById('cal-grid');
  grid.innerHTML = cells;
  grid.querySelectorAll('[data-day]').forEach((el) => {
    el.addEventListener('click', () => { selectedDay = el.dataset.day; render(); });
  });
}

function renderDayPanel() {
  const panel = document.getElementById('day-panel');
  const events = eventsForDay(selectedDay).sort((a, b) => a.start.localeCompare(b.start));
  const [y, m, d] = selectedDay.split('-');
  const label = `${d}.${m}.${y}`;
  if (!events.length) {
    panel.innerHTML = `<h3>${label}</h3><p class="empty-hint">Keine Einträge.</p>`;
    return;
  }
  panel.innerHTML = `<h3>${label}</h3>` + events.map((e) => `
    <div class="day-event">
      <span class="day-event__dot" style="background:${getSourceColor(e.source)}"></span>
      <div>
        <div class="day-event__title">${escapeHtml(e.title)}</div>
        <div class="day-event__source">${escapeHtml(getSourceLabel(e.source))}</div>
      </div>
    </div>
  `).join('');
}

function renderLegend() {
  const sources = [...new Set(allEvents.map((e) => e.source))];
  const legend = document.getElementById('legend');
  if (!sources.length) { legend.innerHTML = ''; return; }
  const hidden = getHiddenSources();
  legend.innerHTML = sources.map((src) => `
    <div class="legend-item ${hidden.has(src) ? 'legend-item--hidden' : ''}">
      <input type="color" class="legend-swatch" value="${getSourceColor(src)}" data-source="${src}" style="background:${getSourceColor(src)}">
      <span class="legend-item__text" data-toggle-source="${src}" title="Ein-/ausblenden">${escapeHtml(getSourceLabel(src))}</span>
    </div>
  `).join('');
  legend.querySelectorAll('input[type=color]').forEach((el) => {
    el.addEventListener('input', () => {
      setSourceColor(el.dataset.source, el.value);
      render();
    });
  });
  legend.querySelectorAll('[data-toggle-source]').forEach((el) => {
    el.addEventListener('click', () => {
      toggleSourceVisibility(el.dataset.toggleSource);
      render();
    });
  });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

document.getElementById('cal-prev').addEventListener('click', () => { cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1); render(); });
document.getElementById('cal-next').addEventListener('click', () => { cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1); render(); });

load();
