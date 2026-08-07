import { setTitle, setActions, setBack, navigate } from '../router.js';
import { getPeople, createPerson, lastContactDate } from '../../../shared/contacts.js';
import { escapeHtml, todayKey, daysBetweenDateKeys, formatDateKey } from '../utils.js';
import { openModal, toast } from '../ui.js';

let activeTag = null;
let query = '';

export function render() {
  setTitle('Kontakte');
  setBack(null);
  setActions(`
    <button class="icon-btn" id="person-add" aria-label="Person hinzufügen">
      <svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
    </button>
  `);

  document.getElementById('view').innerHTML = `
    <div class="search-wrap">
      <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
      <input class="input" id="person-search" placeholder="Kontakt suchen…" value="${escapeHtml(query)}">
    </div>
    <div id="person-list"></div>
  `;

  document.getElementById('person-add').addEventListener('click', () => openAddModal(draw));
  const searchInput = document.getElementById('person-search');
  searchInput.addEventListener('input', () => { query = searchInput.value; draw(); });
  draw();
}

function allTags(people) {
  const set = new Set();
  people.forEach((p) => p.socialProfile?.tags?.forEach((t) => set.add(t)));
  return [...set].sort();
}

function draw() {
  const list = document.getElementById('person-list');
  if (!list) return;
  const people = getPeople().sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const tags = allTags(people);
  const today = todayKey();
  const q = query.trim().toLowerCase();
  let filtered = activeTag ? people.filter((p) => p.socialProfile?.tags?.includes(activeTag)) : people;
  if (q) filtered = filtered.filter((p) => p.name.toLowerCase().includes(q));

  list.innerHTML = `
    ${tags.length ? `
      <div class="filter-row">
        <button class="chip ${!activeTag ? 'active' : ''}" data-tag="">Alle</button>
        ${tags.map((t) => `<button class="chip ${activeTag === t ? 'active' : ''}" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join('')}
      </div>
    ` : ''}
    ${filtered.length === 0 ? `
      <div class="empty">
        <h3>${q || activeTag ? 'Keine Treffer' : 'Noch keine Kontakte'}</h3>
        <p class="faint">${q || activeTag ? 'Andere Suche oder Filter versuchen.' : 'Lege deinen ersten Kontakt über das Plus oben rechts an.'}</p>
      </div>
    ` : `
      <div class="stack">
        ${filtered.map((p) => {
          const last = lastContactDate(p.id);
          const weeks = p.socialProfile?.remindWeeks;
          const overdue = weeks && (!last || daysBetweenDateKeys(last, today) >= weeks * 7);
          return `
            <div class="card card--tap person-row" data-open="${p.id}">
              <span class="avatar">${escapeHtml(initials(p.name))}</span>
              <div class="col grow" style="min-width:0">
                <p class="truncate">${escapeHtml(p.name)}</p>
                <p class="person-row__meta">
                  ${p.socialProfile?.groupName ? escapeHtml(p.socialProfile.groupName) + ' · ' : ''}
                  ${(p.socialProfile?.tags || []).map((t) => `<span class="tag-chip">${escapeHtml(t)}</span>`).join('')}
                </p>
                <p class="last-contact ${overdue ? 'last-contact--overdue' : ''}">
                  ${last ? `Letzter Kontakt: ${formatDateKey(last)}` : 'Noch kein Kontakt geloggt'}${overdue ? ' · fällig' : ''}
                </p>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `}
  `;

  list.querySelectorAll('[data-tag]').forEach((el) => {
    el.addEventListener('click', () => { activeTag = el.dataset.tag || null; draw(); });
  });
  list.querySelectorAll('[data-open]').forEach((el) => {
    el.addEventListener('click', () => navigate(`#/person/${el.dataset.open}`));
  });
}

function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('');
}

function openAddModal(onSaved) {
  const handle = openModal(`
    <h3 class="modal-title">Kontakt anlegen</h3>
    <div class="field">
      <label>Name</label>
      <input class="input" id="p-name" placeholder="Vor- und Nachname">
    </div>
    <div class="field">
      <label>Geburtstag (optional)</label>
      <input class="input" type="date" id="p-birthday">
    </div>
    <div class="field">
      <label>Freundeskreis-Gruppe (optional)</label>
      <input class="input" id="p-group" placeholder="z.B. Studienfreunde">
    </div>
    <div class="field">
      <label>Wie kennengelernt? (optional)</label>
      <input class="input" id="p-howmet" placeholder="z.B. Uni, Arbeit, Party">
    </div>
    <div class="field">
      <label>Tags (kommagetrennt, optional)</label>
      <input class="input" id="p-tags" placeholder="z.B. enger Freund, Nachbar">
    </div>
    <div class="field">
      <label>Erinnerungsintervall (Wochen, optional)</label>
      <input class="input" type="number" min="1" id="p-remind" placeholder="z.B. 6">
    </div>
    <button class="btn btn-primary" id="p-save">Speichern</button>
  `, { center: true });

  handle.sheet.querySelector('#p-save').addEventListener('click', () => {
    const name = handle.sheet.querySelector('#p-name').value.trim();
    if (!name) { toast('Bitte einen Namen eingeben'); return; }
    const tags = handle.sheet.querySelector('#p-tags').value.split(',').map((t) => t.trim()).filter(Boolean);
    createPerson({
      name,
      birthday: handle.sheet.querySelector('#p-birthday').value || null,
      socialProfile: {
        groupName: handle.sheet.querySelector('#p-group').value.trim(),
        howMet: handle.sheet.querySelector('#p-howmet').value.trim(),
        tags,
        remindWeeks: Number(handle.sheet.querySelector('#p-remind').value) || null,
      },
    });
    toast('Gespeichert');
    handle.close();
    onSaved?.();
  });
}
