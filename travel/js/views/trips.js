import { setTitle, setActions, setBack, navigate } from '../router.js';
import { getTrips, createTrip, saveTrip, tripDaysUntilStart, TRIP_TYPES, tripTypeLabel } from '../db.js';
import { getNotesForApp, updateAssignedNoteContent, unassignNote } from '../../../shared/notes-bridge.js';
import { openModal, confirmDialog, toast } from '../ui.js';
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
  const assignedNotes = getNotesForApp('travel');

  view.innerHTML = `
    ${assignedNotes.length ? `
      <div class="section-title" style="margin-top:0">📝 Aus Notizen zugeordnet</div>
      <div class="card stack" style="margin-bottom:16px">
        ${assignedNotes.map((n) => `
          <div class="row row--between" data-note-open="${n.id}" style="cursor:pointer">
            <div class="col grow" style="min-width:0">
              ${n.title ? `<span class="truncate" style="font-weight:700">${escapeHtml(n.title)}</span>` : ''}
              <span class="faint truncate">${escapeHtml(n.type === 'checklist' ? (n.items[0]?.text || '') : n.text)}</span>
            </div>
          </div>
        `).join('')}
      </div>
    ` : ''}
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
  view.querySelectorAll('[data-note-open]').forEach((node) => {
    const note = assignedNotes.find((n) => n.id === node.dataset.noteOpen);
    node.addEventListener('click', () => openAssignedNoteModal(note));
  });
  document.getElementById('trip-add').addEventListener('click', () => openTripModal(null, draw));

  function tripRow(t) {
    const days = tripDaysUntilStart(t);
    const countdown = days > 0 ? `in ${days} Tagen` : days === 0 ? 'heute' : 'läuft/vorbei';
    return `
      <div class="due-row" data-open="${t.id}" style="cursor:pointer">
        <div class="col grow" style="min-width:0">
          <p class="due-row__title truncate">${escapeHtml(t.name)}</p>
          <p class="due-row__meta">${escapeHtml(t.destination)}${t.destination ? ' · ' : ''}${formatDateKey(t.startDate)} – ${formatDateKey(t.endDate)} · ${tripTypeLabel(t.type)}</p>
        </div>
        <span class="due-row__date">${countdown}</span>
      </div>
    `;
  }
}

/** Notizen, die dieser App zugeordnet wurden (E57, ab E61 auch hier statt
 *  nur in Goals) - Notizen bleibt Besitzer, siehe shared/notes-bridge.js. */
function openAssignedNoteModal(note) {
  const isChecklist = note.type === 'checklist';
  const handle = openModal(`
    <h3 class="modal-title">Aus Notizen</h3>
    <div class="field">
      <label>Titel</label>
      <input class="input" id="an-title" value="${escapeHtml(note.title || '')}">
    </div>
    ${isChecklist ? `
      <div class="stack" style="margin-bottom:14px">
        ${(note.items || []).map((it) => `
          <label class="row checklist-row" style="gap:8px">
            <input type="checkbox" class="check-item" data-an-item="${it.id}" ${it.done ? 'checked' : ''}>
            <span class="grow ${it.done ? 'faint' : ''}">${escapeHtml(it.text)}</span>
          </label>
        `).join('')}
      </div>
    ` : `
      <div class="field">
        <label>Text</label>
        <textarea class="input" id="an-text" rows="6">${escapeHtml(note.text || '')}</textarea>
      </div>
    `}
    <div class="stack">
      <button class="btn btn-primary" id="an-save">Speichern</button>
      <a class="btn btn-ghost" href="../notes/#/note/${note.id}">In Notizen öffnen</a>
      <button class="btn btn-ghost" id="an-unassign">Zuordnung aufheben</button>
    </div>
  `, { center: true });

  handle.sheet.querySelectorAll('[data-an-item]').forEach((cb) => {
    cb.addEventListener('change', () => {
      updateAssignedNoteContent(note.id, 'travel', { itemId: cb.dataset.anItem, itemDone: cb.checked });
    });
  });
  handle.sheet.querySelector('#an-save').addEventListener('click', () => {
    const title = handle.sheet.querySelector('#an-title').value.trim();
    const patch = { title };
    const textEl = handle.sheet.querySelector('#an-text');
    if (textEl) patch.text = textEl.value;
    updateAssignedNoteContent(note.id, 'travel', patch);
    toast('Gespeichert');
    handle.close();
    draw();
  });
  handle.sheet.querySelector('#an-unassign').addEventListener('click', async () => {
    const ok = await confirmDialog('Zuordnung aufheben?', 'Die Notiz bleibt in Notizen bestehen, verschwindet aber aus dieser Liste hier.', 'Aufheben', false);
    if (!ok) return;
    unassignNote(note.id, 'travel');
    toast('Zuordnung aufgehoben');
    handle.close();
    draw();
  });
}

export function openTripModal(existing, onSaved) {
  const isNew = !existing?.id;
  let type = existing?.type || 'sonstiges';
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
    <div class="field">
      <label>Reisetyp</label>
      <div class="chip-row" id="type-row">
        ${TRIP_TYPES.map((t) => `<button type="button" class="chip ${type === t.key ? 'active' : ''}" data-type="${t.key}">${t.label}</button>`).join('')}
      </div>
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

  handle.sheet.querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => {
    type = b.dataset.type;
    handle.sheet.querySelectorAll('[data-type]').forEach((x) => x.classList.toggle('active', x.dataset.type === type));
  }));

  handle.sheet.querySelector('#t-save').addEventListener('click', () => {
    const name = handle.sheet.querySelector('#t-name').value.trim();
    if (!name) { toast('Bitte einen Namen eingeben'); return; }
    const startDate = handle.sheet.querySelector('#t-start').value || todayKey();
    const endDate = handle.sheet.querySelector('#t-end').value || startDate;
    const fields = {
      name, type,
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
