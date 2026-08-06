import { setTitle, setActions, setBack } from '../router.js';
import { getAppointmentsSorted, getAppointmentById, createAppointment, saveAppointment, deleteAppointment } from '../db.js';
import { getPeople, getPersonById } from '../../../shared/contacts.js';
import { openModal, confirmDialog, toast } from '../ui.js';
import { todayKey, formatDateKey, escapeHtml } from '../utils.js';

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
          const overdue = a.date < today;
          return `
            <div class="appt-row" data-open="${a.id}">
              <div class="col grow" style="min-width:0">
                <p class="appt-row__title truncate">${escapeHtml(a.title)}</p>
                ${person ? `<p class="appt-row__meta">${escapeHtml(person.name)}</p>` : ''}
              </div>
              <span class="appt-row__due ${overdue ? 'appt-row__due--overdue' : ''}">${formatDateKey(a.date)}</span>
            </div>
          `;
        }).join('')}
      </div>
    `}
  `;

  view.querySelectorAll('[data-open]').forEach((el) => {
    el.addEventListener('click', () => openApptModal(getAppointmentById(el.dataset.open), draw));
  });
}

function openApptModal(existing, onSaved) {
  const people = getPeople().filter((p) => p.jobProfile);
  const isNew = !existing;

  const handle = openModal(`
    <h3 class="modal-title">${isNew ? 'Termin anlegen' : 'Termin bearbeiten'}</h3>
    <div class="field">
      <label>Titel</label>
      <input class="input" id="a-title" value="${escapeHtml(existing?.title || '')}" placeholder="z.B. Projekt-Kickoff">
    </div>
    <div class="field">
      <label>Datum</label>
      <input class="input" type="date" id="a-date" value="${existing?.date || todayKey()}">
    </div>
    ${people.length ? `
      <div class="field">
        <label>Kontakt (optional)</label>
        <select class="input" id="a-person">
          <option value="">Kein Kontakt</option>
          ${people.map((p) => `<option value="${p.id}" ${existing?.personId === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
        </select>
      </div>
    ` : ''}
    <div class="field">
      <label>Notiz (optional)</label>
      <textarea class="input" id="a-note">${escapeHtml(existing?.note || '')}</textarea>
    </div>
    <div class="stack">
      <button class="btn btn-primary" id="a-save">Speichern</button>
      ${!isNew ? '<button class="btn btn-danger" id="a-delete">Löschen</button>' : ''}
    </div>
  `, { center: true });

  handle.sheet.querySelector('#a-save').addEventListener('click', () => {
    const title = handle.sheet.querySelector('#a-title').value.trim();
    if (!title) { toast('Bitte einen Titel eingeben'); return; }
    const date = handle.sheet.querySelector('#a-date').value || todayKey();
    const personId = handle.sheet.querySelector('#a-person')?.value || null;
    const note = handle.sheet.querySelector('#a-note').value.trim();
    if (isNew) {
      createAppointment({ title, date, personId, note });
    } else {
      saveAppointment({ ...existing, title, date, personId, note });
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
