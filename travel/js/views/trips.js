import { setTitle, setActions, setBack, navigate } from '../router.js';
import { getTrips, createTrip, saveTrip, tripDaysUntilStart } from '../db.js';
import { openModal, toast } from '../ui.js';
import { todayKey, formatDateKey, escapeHtml } from '../utils.js';

export function render() {
  setTitle('Reisen');
  setBack(null);
  setActions('');
  draw();
}

function draw() {
  const view = document.getElementById('view');
  const trips = getTrips();
  const today = todayKey();
  const upcoming = trips.filter((t) => t.endDate >= today);
  const past = trips.filter((t) => t.endDate < today);

  view.innerHTML = `
    ${trips.length === 0 ? `
      <div class="empty">
        <h3>Noch keine Reisen</h3>
        <p class="faint">Lege eine Reise mit Ziel und Zeitraum an — Packliste, Reiseplan und Ausgaben verwaltest du danach im Detail.</p>
      </div>
    ` : `
      ${upcoming.length > 0 ? `
        <div class="section-title" style="margin-top:0">Bevorstehend</div>
        <div class="card">${upcoming.map(tripRow).join('')}</div>
      ` : ''}
      ${past.length > 0 ? `
        <div class="section-title">Vergangen</div>
        <div class="card">${past.map(tripRow).join('')}</div>
      ` : ''}
    `}
    <button class="btn btn-primary" id="trip-add" style="margin-top:16px">+ Reise</button>
  `;

  view.querySelectorAll('[data-open]').forEach((el) => {
    el.addEventListener('click', () => navigate(`#/trip/${el.dataset.open}`));
  });
  document.getElementById('trip-add').addEventListener('click', () => openTripModal(null, draw));

  function tripRow(t) {
    const days = tripDaysUntilStart(t);
    const countdown = days > 0 ? `in ${days} Tagen` : days === 0 ? 'heute' : 'läuft/vorbei';
    return `
      <div class="due-row" data-open="${t.id}" style="cursor:pointer">
        <div class="col grow" style="min-width:0">
          <p class="due-row__title truncate">${escapeHtml(t.name)}</p>
          <p class="due-row__meta">${escapeHtml(t.destination)}${t.destination ? ' · ' : ''}${formatDateKey(t.startDate)} – ${formatDateKey(t.endDate)}</p>
        </div>
        <span class="due-row__date">${countdown}</span>
      </div>
    `;
  }
}

export function openTripModal(existing, onSaved) {
  const isNew = !existing;
  const handle = openModal(`
    <h3 class="modal-title">${isNew ? 'Reise anlegen' : 'Reise bearbeiten'}</h3>
    <div class="field">
      <label>Name</label>
      <input class="input" id="t-name" value="${escapeHtml(existing?.name || '')}" placeholder="z.B. Sommerurlaub Italien">
    </div>
    <div class="field">
      <label>Ziel (optional)</label>
      <input class="input" id="t-destination" value="${escapeHtml(existing?.destination || '')}" placeholder="z.B. Rom">
    </div>
    <div class="grid-2">
      <div class="field">
        <label>Start</label>
        <input class="input" type="date" id="t-start" value="${existing?.startDate || todayKey()}">
      </div>
      <div class="field">
        <label>Ende</label>
        <input class="input" type="date" id="t-end" value="${existing?.endDate || todayKey()}">
      </div>
    </div>
    <div class="field">
      <label>Budget gesamt (optional)</label>
      <input class="input" type="number" min="0" step="0.01" id="t-budget" value="${existing?.budgetTotal ?? ''}">
    </div>
    <div class="field">
      <label>Notiz (optional)</label>
      <textarea class="input" id="t-note">${escapeHtml(existing?.note || '')}</textarea>
    </div>
    <button class="btn btn-primary" id="t-save">Speichern</button>
  `, { center: true });

  handle.sheet.querySelector('#t-save').addEventListener('click', () => {
    const name = handle.sheet.querySelector('#t-name').value.trim();
    if (!name) { toast('Bitte einen Namen eingeben'); return; }
    const startDate = handle.sheet.querySelector('#t-start').value || todayKey();
    const endDate = handle.sheet.querySelector('#t-end').value || startDate;
    const fields = {
      name,
      destination: handle.sheet.querySelector('#t-destination').value.trim(),
      startDate, endDate: endDate < startDate ? startDate : endDate,
      budgetTotal: handle.sheet.querySelector('#t-budget').value ? Number(handle.sheet.querySelector('#t-budget').value) : null,
      note: handle.sheet.querySelector('#t-note').value.trim(),
    };
    if (isNew) createTrip(fields);
    else saveTrip({ ...existing, ...fields });
    toast('Gespeichert');
    handle.close();
    onSaved?.();
  });
}
