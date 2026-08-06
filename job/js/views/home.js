import { setTitle, setActions, setBack, navigate } from '../router.js';
import { getPeople, createPerson, savePerson, getPersonById } from '../../../shared/contacts.js';
import { escapeHtml } from '../utils.js';
import { openModal, toast } from '../ui.js';

let activeRelation = null; // null = alle, 'colleague', 'client'

export function render() {
  setTitle('Kontakte');
  setBack(null);
  setActions(`
    <button class="icon-btn" id="person-add" aria-label="Job-Kontakt hinzufügen">
      <svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
    </button>
  `);
  draw();
  document.getElementById('person-add').addEventListener('click', () => openAddModal(draw));
}

function draw() {
  const view = document.getElementById('view');
  const jobPeople = getPeople().filter((p) => p.jobProfile).sort((a, b) => a.name.localeCompare(b.name));
  const filtered = activeRelation ? jobPeople.filter((p) => p.jobProfile.relation === activeRelation) : jobPeople;

  view.innerHTML = `
    <div class="filter-row">
      <button class="chip ${!activeRelation ? 'active' : ''}" data-rel="">Alle</button>
      <button class="chip ${activeRelation === 'colleague' ? 'active' : ''}" data-rel="colleague">Kollegen</button>
      <button class="chip ${activeRelation === 'client' ? 'active' : ''}" data-rel="client">Kunden</button>
    </div>
    ${filtered.length === 0 ? `
      <div class="empty">
        <h3>Noch keine Job-Kontakte</h3>
        <p class="faint">Lege über das Plus oben rechts einen Kontakt an - entweder neu oder ergänze das Job-Profil einer bestehenden Person.</p>
      </div>
    ` : `
      <div class="stack">
        ${filtered.map((p) => `
          <div class="card card--tap person-row" data-open="${p.id}">
            <span class="avatar">${escapeHtml(initials(p.name))}</span>
            <div class="col grow" style="min-width:0">
              <p class="truncate">${escapeHtml(p.name)}</p>
              <p class="person-row__meta">
                ${p.jobProfile.company ? escapeHtml(p.jobProfile.company) : ''}
                ${p.jobProfile.position ? ' · ' + escapeHtml(p.jobProfile.position) : ''}
              </p>
              <span class="badge relation-badge--${p.jobProfile.relation}">${p.jobProfile.relation === 'client' ? 'Kunde' : 'Kollege'}</span>
            </div>
          </div>
        `).join('')}
      </div>
    `}
  `;

  view.querySelectorAll('[data-rel]').forEach((el) => {
    el.addEventListener('click', () => { activeRelation = el.dataset.rel || null; draw(); });
  });
  view.querySelectorAll('[data-open]').forEach((el) => {
    el.addEventListener('click', () => navigate(`#/person/${el.dataset.open}`));
  });
}

function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('');
}

function openAddModal(onSaved) {
  const withoutJob = getPeople().filter((p) => !p.jobProfile);

  const handle = openModal(`
    <h3 class="modal-title">Job-Kontakt anlegen</h3>
    ${withoutJob.length ? `
      <div class="field">
        <label>Bestehende Person auswählen (optional)</label>
        <select class="input" id="pick-existing">
          <option value="">— Neue Person —</option>
          ${withoutJob.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}
        </select>
      </div>
    ` : ''}
    <div class="field">
      <label>Name</label>
      <input class="input" id="p-name" placeholder="Vor- und Nachname">
    </div>
    <div class="field">
      <label>Firma (optional)</label>
      <input class="input" id="p-company">
    </div>
    <div class="field">
      <label>Position (optional)</label>
      <input class="input" id="p-position">
    </div>
    <div class="field">
      <label>Rolle</label>
      <div class="chip-row" id="rel-row">
        <button class="chip active" data-rel="colleague">Kollege</button>
        <button class="chip" data-rel="client">Kunde</button>
      </div>
    </div>
    <div class="field">
      <label>Laufbahn-Notizen (optional)</label>
      <textarea class="input" id="p-notes"></textarea>
    </div>
    <button class="btn btn-primary" id="p-save">Speichern</button>
  `, { center: true });

  let relation = 'colleague';
  handle.sheet.querySelectorAll('[data-rel]').forEach((b) => b.addEventListener('click', () => {
    relation = b.dataset.rel;
    handle.sheet.querySelectorAll('[data-rel]').forEach((x) => x.classList.toggle('active', x.dataset.rel === relation));
  }));

  handle.sheet.querySelector('#pick-existing')?.addEventListener('change', (e) => {
    const person = getPersonById(e.target.value);
    handle.sheet.querySelector('#p-name').value = person ? person.name : '';
  });

  handle.sheet.querySelector('#p-save').addEventListener('click', () => {
    const existingId = handle.sheet.querySelector('#pick-existing')?.value;
    const name = handle.sheet.querySelector('#p-name').value.trim();
    if (!name) { toast('Bitte einen Namen eingeben'); return; }
    const jobProfile = {
      company: handle.sheet.querySelector('#p-company').value.trim(),
      position: handle.sheet.querySelector('#p-position').value.trim(),
      relation,
      careerNotes: handle.sheet.querySelector('#p-notes').value.trim(),
    };
    if (existingId) {
      const existing = getPersonById(existingId);
      savePerson({ ...existing, name, jobProfile });
    } else {
      createPerson({ name, jobProfile });
    }
    toast('Gespeichert');
    handle.close();
    onSaved?.();
  });
}
