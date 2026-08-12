import { setTitle, setActions, setBack } from '../router.js';
import {
  getAppointmentsSorted, getAppointmentById, createAppointment, saveAppointment, deleteAppointment,
  toggleAppointmentDone, REPEAT_FREQUENCIES, repeatLabel,
} from '../db.js';
import { getPeople, getPersonById } from '../../../shared/contacts.js';
import { openModal, confirmDialog, toast } from '../ui.js';
import { todayKey, formatDateKey, escapeHtml } from '../utils.js';
import { findConflictingEvents } from '../../../shared/event-store.js';
import { getSourceLabel } from '../../../shared/calendar-schema.js';

export function render() {
  setTitle('Termine');
  setBack(null);
  setActions(`
    <button class="icon-btn" id="appt-add" aria-label="Termin hinzufügen">
      <svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
    </button>
  `);
  draw();
  document.getElementById('appt-add').addEventListener('click', () => openApptModal(null, draw));
}

function draw() {
  const view = document.getElementById('view');
  const appts = getAppointmentsSorted();
  const today = todayKey();

  view.innerHTML = `
    ${appts.length === 0 ? `
      <div class="empty">
        <h3>Keine Termine</h3>
        <p class="faint">Lege einen Termin oder eine Deadline an - erscheint auch im Hub-Kalender.</p>
      </div>
    ` : `
      <div class="card">
        ${appts.map((a) => {
          const person = a.personId ? getPersonById(a.personId) : null;
          const overdue = a.date < today && !a.done;
          return `
            <div class="appt-row ${a.done ? 'done' : ''}">
              <span class="set-check ${a.done ? 'done' : ''}" data-toggle="${a.id}">
                <svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>
              </span>
              <div class="col grow" style="min-width:0" data-open="${a.id}">
                <p class="appt-row__title truncate">${escapeHtml(a.title)}</p>
                <p class="appt-row__meta">
                  ${person ? escapeHtml(person.name) + ' · ' : ''}
                  ${a.location ? '📍 ' + escapeHtml(a.location) : ''}
                  ${a.repeat ? `${a.location ? ' · ' : ''}🔁 ${repeatLabel(a.repeat)}` : ''}
                </p>
              </div>
              <span class="appt-row__due ${overdue ? 'appt-row__due--overdue' : ''}" data-open="${a.id}">${formatDateKey(a.date)}${a.time ? ` · ${a.time}` : ''}</span>
            </div>
          `;
        }).join('')}
      </div>
    `}
  `;

  view.querySelectorAll('[data-open]').forEach((el) => {
    el.addEventListener('click', () => openApptModal(getAppointmentById(el.dataset.open), draw));
  });
  view.querySelectorAll('[data-toggle]').forEach((el) => {
    el.addEventListener('click', () => { toggleAppointmentDone(el.dataset.toggle); draw(); });
  });
}

export function openApptModal(existing, onSaved, presetDate) {
  const people = getPeople().filter((p) => p.jobProfile);
  const isNew = !existing;
  const base = existing || { title: '', date: presetDate || todayKey(), time: '', location: '', note: '', personId: '', repeat: null };
  let repeat = base.repeat || null;

  const handle = openModal(`
    <h3 class="modal-title">${isNew ? 'Termin anlegen' : 'Termin bearbeiten'}</h3>
    <div class="field">
      <label>Titel</label>
      <input class="input" id="a-title" value="${escapeHtml(base.title)}" placeholder="z.B. Projekt-Kickoff">
    </div>
    <div class="row" style="gap:10px">
      <div class="field grow">
        <label>Datum</label>
        <input class="input" type="date" id="a-date" value="${base.date}">
      </div>
      <div class="field" style="width:120px">
        <label>Uhrzeit (optional)</label>
        <input class="input" type="time" id="a-time" value="${base.time || ''}">
      </div>
    </div>
    <div class="field">
      <label>Ort (optional)</label>
      <input class="input" id="a-location" value="${escapeHtml(base.location || '')}" placeholder="z.B. Büro, Zoom, Kundenstandort">
    </div>
    <div class="field" id="repeat-wrap">
      <label>Wiederholung (optional)</label>
      <div class="chip-row">
        <button type="button" class="chip ${!repeat ? 'active' : ''}" data-repeat="">Keine</button>
        ${REPEAT_FREQUENCIES.map((f) => `<button type="button" class="chip ${repeat?.freq === f.key ? 'active' : ''}" data-repeat="${f.key}">${f.label}</button>`).join('')}
      </div>
      <div class="row" style="gap:8px;align-items:center;margin-top:10px" id="repeat-custom-wrap" ${repeat?.freq === 'custom' ? '' : 'hidden'}>
        <span class="faint">Alle</span>
        <input class="input" type="number" min="1" step="1" id="repeat-days" value="${repeat?.intervalDays || 2}" style="width:70px">
        <span class="faint">Tage</span>
      </div>
    </div>
    ${people.length ? `
      <div class="field">
        <label>Kontakt (optional)</label>
        <select class="input" id="a-person">
          <option value="">Kein Kontakt</option>
          ${people.map((p) => `<option value="${p.id}" ${base.personId === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
        </select>
      </div>
    ` : ''}
    <div class="field">
      <label>Notiz (optional)</label>
      <textarea class="input" id="a-note">${escapeHtml(base.note || '')}</textarea>
    </div>
    <div class="stack">
      <button class="btn btn-primary" id="a-save">Speichern</button>
      ${!isNew ? '<button class="btn btn-danger" id="a-delete">Löschen</button>' : ''}
    </div>
  `, { center: true });

  handle.sheet.querySelectorAll('[data-repeat]').forEach((b) => b.addEventListener('click', () => {
    const key = b.dataset.repeat;
    repeat = key ? { freq: key, intervalDays: key === 'custom' ? (repeat?.intervalDays || 2) : undefined } : null;
    handle.sheet.querySelectorAll('[data-repeat]').forEach((x) => x.classList.toggle('active', x.dataset.repeat === key));
    handle.sheet.querySelector('#repeat-custom-wrap').hidden = key !== 'custom';
  }));

  handle.sheet.querySelector('#a-save').addEventListener('click', async () => {
    const title = handle.sheet.querySelector('#a-title').value.trim();
    if (!title) { toast('Bitte einen Titel eingeben'); return; }
    const date = handle.sheet.querySelector('#a-date').value || todayKey();
    const time = handle.sheet.querySelector('#a-time').value || null;
    const location = handle.sheet.querySelector('#a-location').value.trim();
    const personId = handle.sheet.querySelector('#a-person')?.value || null;
    const note = handle.sheet.querySelector('#a-note').value.trim();
    if (repeat?.freq === 'custom') repeat.intervalDays = Math.max(1, Number(handle.sheet.querySelector('#repeat-days').value) || 1);
    if (date !== existing?.date || time !== existing?.time) {
      const conflicts = time ? await findConflictingEvents(date, 'job', { startTime: time }).catch(() => []) : [];
      if (conflicts.length) {
        const names = [...new Set(conflicts.map((c) => getSourceLabel(c.source)))].join(', ');
        const ok = await confirmDialog(
          'Termin überschneidet sich',
          `Am ${formatDateKey(date)} gibt es bereits Einträge in: ${names}. Trotzdem speichern?`,
          'Trotzdem speichern', false
        );
        if (!ok) return;
      }
    }
    if (isNew) {
      createAppointment({ title, date, time, location, personId, note, repeat });
    } else {
      saveAppointment({ ...existing, title, date, time, location, personId, note, repeat });
    }
    toast('Gespeichert');
    handle.close();
    onSaved?.();
  });

  handle.sheet.querySelector('#a-delete')?.addEventListener('click', async () => {
    const ok = await confirmDialog('Termin löschen?', 'Wird unwiderruflich gelöscht.');
    if (!ok) return;
    deleteAppointment(existing.id);
    toast('Gelöscht');
    handle.close();
    onSaved?.();
  });
}
