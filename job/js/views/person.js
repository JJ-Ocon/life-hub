import { setTitle, setActions, setBack, navigate } from '../router.js';
import { getPersonById, savePerson, getInteractionsForPerson, logInteraction } from '../../../shared/contacts.js';
import { getAppointmentsForPerson } from '../db.js';
import { openModal, confirmDialog, toast } from '../ui.js';
import { escapeHtml, todayKey, formatDateKey } from '../utils.js';

export function render({ id }) {
  const person = getPersonById(id);
  if (!person || !person.jobProfile) { navigate('#/'); return; }

  setTitle(person.name);
  setBack(() => navigate('#/'));
  setActions(`
    <button class="icon-btn" id="p-edit" aria-label="Bearbeiten">
      <svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
    </button>
  `);

  function draw() {
    const p = getPersonById(id);
    const jp = p.jobProfile;
    const interactions = getInteractionsForPerson(id);
    const appts = getAppointmentsForPerson(id);

    document.getElementById('view').innerHTML = `
      <span class="badge relation-badge--${jp.relation}" style="margin-bottom:10px; display:inline-flex">${jp.relation === 'client' ? 'Kunde' : 'Kollege'}</span>
      ${jp.company ? `<p class="faint" style="margin-bottom:4px">${escapeHtml(jp.company)}</p>` : ''}
      ${jp.position ? `<p class="faint" style="margin-bottom:4px">${escapeHtml(jp.position)}</p>` : ''}
      ${jp.careerNotes ? `<p class="faint" style="margin-bottom:16px">${escapeHtml(jp.careerNotes)}</p>` : ''}

      <button class="btn btn-primary" id="log-contact" style="margin:12px 0 20px">✓ Termin/Gespräch loggen</button>

      <div class="section-title" style="margin-top:0">CRM-Log</div>
      <div class="card">
        ${interactions.length === 0 ? '<p class="faint">Noch keine Einträge.</p>' : interactions.map((i) => `
          <div class="interaction-row">
            <div class="interaction-row__date">${formatDateKey(i.date)}</div>
            ${i.note ? `<div class="interaction-row__note">${escapeHtml(i.note)}</div>` : ''}
          </div>
        `).join('')}
      </div>

      ${appts.length ? `
        <div class="section-title">Termine</div>
        <div class="card">
          ${appts.map((a) => `<p style="padding:6px 0">${formatDateKey(a.date)} – ${escapeHtml(a.title)}</p>`).join('')}
        </div>
      ` : ''}

      <button class="btn btn-danger" id="p-remove" style="margin-top:20px">Als Job-Kontakt entfernen</button>
      <p class="faint" style="margin-top:8px">Entfernt nur das Job-Profil - falls diese Person auch ein Social-Kontakt ist, bleibt das unangetastet.</p>
    `;

    document.getElementById('log-contact').addEventListener('click', async () => {
      const note = await promptNote();
      logInteraction(id, todayKey(), note || '');
      toast('Geloggt');
      draw();
    });
    document.getElementById('p-remove').addEventListener('click', async () => {
      const ok = await confirmDialog('Als Job-Kontakt entfernen?', 'Das Job-Profil wird entfernt. CRM-Log und eine eventuelle Social-Verbindung bleiben erhalten.');
      if (!ok) return;
      savePerson({ ...p, jobProfile: null });
      toast('Entfernt');
      navigate('#/');
    });
  }

  draw();
  document.getElementById('p-edit').addEventListener('click', () => openEditModal(person, () => {
    setTitle(getPersonById(id).name);
    draw();
  }));
}

function promptNote() {
  return new Promise((resolve) => {
    const handle = openModal(`
      <h3 class="modal-title">Termin/Gespräch loggen</h3>
      <div class="field">
        <label>Notiz (optional)</label>
        <textarea class="input" id="note-text" placeholder="Worüber gesprochen, naechste Schritte ..."></textarea>
      </div>
      <button class="btn btn-primary" id="note-save">Speichern</button>
    `, { center: true, onClose: () => resolve('') });
    handle.sheet.querySelector('#note-save').addEventListener('click', () => {
      resolve(handle.sheet.querySelector('#note-text').value.trim());
      handle.close();
    });
  });
}

function openEditModal(person, onSaved) {
  const jp = person.jobProfile;
  const handle = openModal(`
    <h3 class="modal-title">Job-Profil bearbeiten</h3>
    <div class="field">
      <label>Name</label>
      <input class="input" id="p-name" value="${escapeHtml(person.name)}">
    </div>
    <div class="field">
      <label>Firma</label>
      <input class="input" id="p-company" value="${escapeHtml(jp.company || '')}">
    </div>
    <div class="field">
      <label>Position</label>
      <input class="input" id="p-position" value="${escapeHtml(jp.position || '')}">
    </div>
    <div class="field">
      <label>Rolle</label>
      <div class="chip-row" id="rel-row">
        <button class="chip ${jp.relation === 'colleague' ? 'active' : ''}" data-rel="colleague">Kollege</button>
        <button class="chip ${jp.relation === 'client' ? 'active' : ''}" data-rel="client">Kunde</button>
      </div>
    </div>
    <div class="field">
      <label>Laufbahn-Notizen</label>
      <textarea class="input" id="p-notes">${escapeHtml(jp.careerNotes || '')}</textarea>
    </div>
    <button class="btn btn-primary" id="p-save">Speichern</button>
  `, { center: true });

  let relation = jp.relation;
  handle.sheet.querySelectorAll('[data-rel]').forEach((b) => b.addEventListener('click', () => {
    relation = b.dataset.rel;
    handle.sheet.querySelectorAll('[data-rel]').forEach((x) => x.classList.toggle('active', x.dataset.rel === relation));
  }));

  handle.sheet.querySelector('#p-save').addEventListener('click', () => {
    const name = handle.sheet.querySelector('#p-name').value.trim();
    if (!name) { toast('Bitte einen Namen eingeben'); return; }
    savePerson({
      ...person,
      name,
      jobProfile: {
        company: handle.sheet.querySelector('#p-company').value.trim(),
        position: handle.sheet.querySelector('#p-position').value.trim(),
        relation,
        careerNotes: handle.sheet.querySelector('#p-notes').value.trim(),
      },
    });
    toast('Gespeichert');
    handle.close();
    onSaved?.();
  });
}
