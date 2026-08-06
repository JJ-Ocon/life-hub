import { setTitle, setActions, setBack, navigate } from '../router.js';
import {
  getTripById, deleteTrip, tripSpent, EXPENSE_CATEGORIES,
  getPackingItems, addPackingItem, addCommonPackingItems, togglePackingItem, deletePackingItem,
  getItineraryEntries, createItineraryEntry, deleteItineraryEntry,
  getExpenses, createExpense, deleteExpense,
} from '../db.js';
import { openModal, confirmDialog, toast } from '../ui.js';
import { todayKey, formatDateKey, formatMoney, escapeHtml } from '../utils.js';
import { openTripModal } from './trips.js';
import { findConflictingEvents } from '../../../shared/event-store.js';
import { getSourceLabel } from '../../../shared/calendar-schema.js';

let section = 'overview'; // 'overview' | 'packing' | 'itinerary' | 'expenses'
let tripId = null;

export function render(id) {
  tripId = id;
  const trip = getTripById(id);
  if (!trip) {
    setTitle('Reise nicht gefunden');
    setBack(() => navigate('#/'));
    document.getElementById('view').innerHTML = `<div class="empty"><h3>Reise nicht gefunden</h3></div>`;
    return;
  }
  setTitle(trip.name);
  setBack(() => navigate('#/'));
  setActions('');
  draw();
}

function draw() {
  const trip = getTripById(tripId);
  if (!trip) { navigate('#/'); return; }
  const view = document.getElementById('view');
  view.innerHTML = `
    <div class="section-tabs">
      <button class="chip ${section === 'overview' ? 'active' : ''}" data-sec="overview">Übersicht</button>
      <button class="chip ${section === 'packing' ? 'active' : ''}" data-sec="packing">Packliste</button>
      <button class="chip ${section === 'itinerary' ? 'active' : ''}" data-sec="itinerary">Reiseplan</button>
      <button class="chip ${section === 'expenses' ? 'active' : ''}" data-sec="expenses">Ausgaben</button>
    </div>
    <div id="section-body"></div>
  `;
  view.querySelectorAll('[data-sec]').forEach((el) => el.addEventListener('click', () => { section = el.dataset.sec; draw(); }));
  drawSection(trip);
}

function drawSection(trip) {
  const body = document.getElementById('section-body');
  if (section === 'overview') {
    const spent = tripSpent(trip.id);
    body.innerHTML = `
      <div class="card">
        <p class="faint">${escapeHtml(trip.destination || '–')}</p>
        <h2 style="margin-top:4px">${formatDateKey(trip.startDate)} – ${formatDateKey(trip.endDate)}</h2>
        ${trip.note ? `<p style="margin-top:10px">${escapeHtml(trip.note)}</p>` : ''}
      </div>
      ${trip.budgetTotal ? `
        <div class="grid-2">
          <div class="stat-tile">
            <div class="stat-tile__value">${formatMoney(spent)}</div>
            <div class="stat-tile__label">Ausgegeben</div>
          </div>
          <div class="stat-tile">
            <div class="stat-tile__value">${formatMoney(trip.budgetTotal - spent)}</div>
            <div class="stat-tile__label">Verbleibend von ${formatMoney(trip.budgetTotal)}</div>
          </div>
        </div>
      ` : `
        <div class="stat-tile">
          <div class="stat-tile__value">${formatMoney(spent)}</div>
          <div class="stat-tile__label">Ausgegeben (kein Budget gesetzt)</div>
        </div>
      `}
      <div class="stack" style="margin-top:14px">
        <button class="btn btn-ghost" id="trip-edit">Reise bearbeiten</button>
        <button class="btn btn-danger" id="trip-delete">Reise löschen</button>
      </div>
    `;
    body.querySelector('#trip-edit').addEventListener('click', () => openTripModal(trip, () => render(trip.id)));
    body.querySelector('#trip-delete').addEventListener('click', async () => {
      const ok = await confirmDialog('Reise löschen?', 'Packliste, Reiseplan und Ausgaben dieser Reise werden unwiderruflich gelöscht.');
      if (!ok) return;
      deleteTrip(trip.id);
      toast('Gelöscht');
      navigate('#/');
    });
  } else if (section === 'packing') {
    const items = getPackingItems(trip.id);
    body.innerHTML = `
      <div class="row" style="gap:8px;margin-bottom:12px">
        <input class="input" id="p-new" placeholder="Neuer Gegenstand">
        <button class="btn btn-primary btn-sm" id="p-add">+</button>
      </div>
      <button class="btn btn-ghost" id="p-suggest" style="margin-bottom:14px">Standardliste hinzufügen</button>
      ${items.length === 0 ? '<div class="empty"><p class="faint">Noch nichts auf der Packliste.</p></div>' : `
        <div class="card">
          ${items.map((p) => `
            <div class="switch-row">
              <label class="row" style="gap:10px;flex:1;min-width:0">
                <input type="checkbox" data-toggle="${p.id}" ${p.packed ? 'checked' : ''}>
                <span class="${p.packed ? 'faint' : ''}" style="text-decoration:${p.packed ? 'line-through' : 'none'}">${escapeHtml(p.text)}</span>
              </label>
              <button class="icon-btn" data-del="${p.id}" aria-label="Löschen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg></button>
            </div>
          `).join('')}
        </div>
      `}
    `;
    body.querySelector('#p-add').addEventListener('click', () => {
      const input = body.querySelector('#p-new');
      const text = input.value.trim();
      if (!text) return;
      addPackingItem(trip.id, text);
      drawSection(trip);
    });
    body.querySelector('#p-new').addEventListener('keydown', (e) => { if (e.key === 'Enter') body.querySelector('#p-add').click(); });
    body.querySelector('#p-suggest').addEventListener('click', () => { addCommonPackingItems(trip.id); drawSection(trip); });
    body.querySelectorAll('[data-toggle]').forEach((el) => el.addEventListener('change', () => { togglePackingItem(el.dataset.toggle); drawSection(trip); }));
    body.querySelectorAll('[data-del]').forEach((el) => el.addEventListener('click', () => { deletePackingItem(el.dataset.del); drawSection(trip); }));
  } else if (section === 'itinerary') {
    const entries = getItineraryEntries(trip.id);
    body.innerHTML = `
      ${entries.length === 0 ? '<div class="empty"><p class="faint">Noch keine Termine im Reiseplan.</p></div>' : `
        <div class="card">
          ${entries.map((i) => `
            <div class="due-row">
              <div class="col grow" style="min-width:0">
                <p class="due-row__title truncate">${escapeHtml(i.title)}</p>
                <p class="due-row__meta">${formatDateKey(i.date)}${i.time ? ' · ' + i.time : ''}${i.note ? ' · ' + escapeHtml(i.note) : ''}</p>
              </div>
              <button class="icon-btn" data-del="${i.id}" aria-label="Löschen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg></button>
            </div>
          `).join('')}
        </div>
      `}
      <button class="btn btn-primary" id="i-add" style="margin-top:14px">+ Termin</button>
    `;
    body.querySelectorAll('[data-del]').forEach((el) => el.addEventListener('click', async () => {
      const ok = await confirmDialog('Termin löschen?', 'Wird unwiderruflich gelöscht.');
      if (!ok) return;
      deleteItineraryEntry(el.dataset.del);
      drawSection(trip);
    }));
    body.querySelector('#i-add').addEventListener('click', () => openItineraryModal(trip));
  } else {
    const expenses = getExpenses(trip.id);
    body.innerHTML = `
      ${expenses.length === 0 ? '<div class="empty"><p class="faint">Noch keine Ausgaben erfasst.</p></div>' : `
        <div class="card">
          ${expenses.map((e) => `
            <div class="due-row">
              <div class="col grow" style="min-width:0">
                <p class="due-row__title truncate">${escapeHtml(e.category)}${e.note ? ' · ' + escapeHtml(e.note) : ''}</p>
                <p class="due-row__meta">${formatDateKey(e.date)}</p>
              </div>
              <span class="due-row__date">${formatMoney(e.amount)}</span>
              <button class="icon-btn" data-del="${e.id}" aria-label="Löschen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg></button>
            </div>
          `).join('')}
        </div>
      `}
      <button class="btn btn-primary" id="e-add" style="margin-top:14px">+ Ausgabe</button>
    `;
    body.querySelectorAll('[data-del]').forEach((el) => el.addEventListener('click', async () => {
      const ok = await confirmDialog('Ausgabe löschen?', 'Wird unwiderruflich gelöscht.');
      if (!ok) return;
      deleteExpense(el.dataset.del);
      drawSection(trip);
    }));
    body.querySelector('#e-add').addEventListener('click', () => openExpenseModal(trip));
  }
}

function openItineraryModal(trip) {
  const handle = openModal(`
    <h3 class="modal-title">Termin anlegen</h3>
    <div class="field">
      <label>Titel</label>
      <input class="input" id="i-title" placeholder="z.B. Abflug, Hotel Check-in">
    </div>
    <div class="grid-2">
      <div class="field">
        <label>Datum</label>
        <input class="input" type="date" id="i-date" value="${trip.startDate}">
      </div>
      <div class="field">
        <label>Uhrzeit (optional)</label>
        <input class="input" type="time" id="i-time">
      </div>
    </div>
    <div class="field">
      <label>Notiz (optional)</label>
      <textarea class="input" id="i-note"></textarea>
    </div>
    <button class="btn btn-primary" id="i-save">Speichern</button>
  `, { center: true });

  handle.sheet.querySelector('#i-save').addEventListener('click', async () => {
    const title = handle.sheet.querySelector('#i-title').value.trim();
    if (!title) { toast('Bitte einen Titel eingeben'); return; }
    const date = handle.sheet.querySelector('#i-date').value || trip.startDate;
    const time = handle.sheet.querySelector('#i-time').value || null;
    const note = handle.sheet.querySelector('#i-note').value.trim();
    const conflicts = await findConflictingEvents(date, 'travel').catch(() => []);
    if (conflicts.length) {
      const names = [...new Set(conflicts.map((c) => getSourceLabel(c.source)))].join(', ');
      const ok = await confirmDialog(
        'Termin überschneidet sich',
        `Am ${formatDateKey(date)} gibt es bereits Einträge in: ${names}. Trotzdem speichern?`,
        'Trotzdem speichern', false
      );
      if (!ok) return;
    }
    createItineraryEntry({ tripId: trip.id, date, time, title, note });
    toast('Gespeichert');
    handle.close();
    drawSection(trip);
  });
}

function openExpenseModal(trip) {
  const handle = openModal(`
    <h3 class="modal-title">Ausgabe erfassen</h3>
    <div class="field">
      <label>Betrag</label>
      <input class="input" type="number" min="0" step="0.01" id="e-amount">
    </div>
    <div class="field">
      <label>Kategorie</label>
      <div class="chip-row" id="cat-row">
        ${EXPENSE_CATEGORIES.map((c, i) => `<button class="chip ${i === 0 ? 'active' : ''}" data-cat="${c}">${c}</button>`).join('')}
      </div>
    </div>
    <div class="field">
      <label>Datum</label>
      <input class="input" type="date" id="e-date" value="${todayKey()}">
    </div>
    <div class="field">
      <label>Notiz (optional)</label>
      <textarea class="input" id="e-note"></textarea>
    </div>
    <button class="btn btn-primary" id="e-save">Speichern</button>
  `, { center: true });

  let category = EXPENSE_CATEGORIES[0];
  handle.sheet.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => {
    category = b.dataset.cat;
    handle.sheet.querySelectorAll('[data-cat]').forEach((x) => x.classList.toggle('active', x.dataset.cat === category));
  }));

  handle.sheet.querySelector('#e-save').addEventListener('click', () => {
    const amount = Number(handle.sheet.querySelector('#e-amount').value) || 0;
    if (amount <= 0) { toast('Bitte einen Betrag angeben'); return; }
    const date = handle.sheet.querySelector('#e-date').value || todayKey();
    const note = handle.sheet.querySelector('#e-note').value.trim();
    createExpense({ tripId: trip.id, amount, category, date, note });
    toast('Gespeichert');
    handle.close();
    drawSection(trip);
  });
}
