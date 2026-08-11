import { setTitle, setActions, setBack, navigate } from '../router.js';
import {
  getPeople, createPerson, lastContactDate, CLOSENESS_LEVELS, closenessLabel, closenessRank, getRolesInUse,
} from '../../../shared/contacts.js';
import { getNotesForApp, updateAssignedNoteContent, unassignNote } from '../../../shared/notes-bridge.js';
import { refreshBirthdayCalendarMirror } from '../db.js';
import { escapeHtml, todayKey, daysBetweenDateKeys, formatDateKey } from '../utils.js';
import { openModal, confirmDialog, toast } from '../ui.js';

let activeTag = null;
let activeCloseness = null;
let sortMode = 'name'; // 'name' | 'closeness'
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
    <div id="assigned-notes"></div>
    <div class="search-wrap">
      <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
      <input class="input" id="person-search" placeholder="Kontakt suchen…" value="${escapeHtml(query)}">
    </div>
    <div id="person-list"></div>
  `;

  document.getElementById('person-add').addEventListener('click', () => openAddModal(draw));
  const searchInput = document.getElementById('person-search');
  searchInput.addEventListener('input', () => { query = searchInput.value; draw(); });
  drawAssignedNotes();
  draw();
}

/** Notizen, die dieser App zugeordnet wurden (E57, ab E61 auch hier statt
 *  nur in Goals) - Notizen bleibt Besitzer, siehe shared/notes-bridge.js. */
function drawAssignedNotes() {
  const el = document.getElementById('assigned-notes');
  if (!el) return;
  const assignedNotes = getNotesForApp('social');
  el.innerHTML = !assignedNotes.length ? '' : `
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
  `;
  el.querySelectorAll('[data-note-open]').forEach((node) => {
    const note = assignedNotes.find((n) => n.id === node.dataset.noteOpen);
    node.addEventListener('click', () => openAssignedNoteModal(note));
  });
}

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
      updateAssignedNoteContent(note.id, 'social', { itemId: cb.dataset.anItem, itemDone: cb.checked });
    });
  });
  handle.sheet.querySelector('#an-save').addEventListener('click', () => {
    const title = handle.sheet.querySelector('#an-title').value.trim();
    const patch = { title };
    const textEl = handle.sheet.querySelector('#an-text');
    if (textEl) patch.text = textEl.value;
    updateAssignedNoteContent(note.id, 'social', patch);
    toast('Gespeichert');
    handle.close();
    drawAssignedNotes();
  });
  handle.sheet.querySelector('#an-unassign').addEventListener('click', async () => {
    const ok = await confirmDialog('Zuordnung aufheben?', 'Die Notiz bleibt in Notizen bestehen, verschwindet aber aus dieser Liste hier.', 'Aufheben', false);
    if (!ok) return;
    unassignNote(note.id, 'social');
    toast('Zuordnung aufgehoben');
    handle.close();
    drawAssignedNotes();
  });
}

function allTags(people) {
  const set = new Set();
  people.forEach((p) => p.socialProfile?.tags?.forEach((t) => set.add(t)));
  return [...set].sort();
}

function draw() {
  const list = document.getElementById('person-list');
  if (!list) return;
  const people = getPeople();
  const tags = allTags(people);
  const today = todayKey();
  const q = query.trim().toLowerCase();
  let filtered = activeTag ? people.filter((p) => p.socialProfile?.tags?.includes(activeTag)) : people;
  if (activeCloseness) filtered = filtered.filter((p) => p.closeness === activeCloseness);
  if (q) filtered = filtered.filter((p) => p.name.toLowerCase().includes(q));
  filtered = sortMode === 'closeness'
    ? [...filtered].sort((a, b) => closenessRank(a.closeness) - closenessRank(b.closeness) || a.name.localeCompare(b.name, 'de'))
    : [...filtered].sort((a, b) => a.name.localeCompare(b.name, 'de'));

  list.innerHTML = `
    <div class="filter-row">
      <button class="chip ${sortMode === 'name' ? 'active' : ''}" data-sort="name">Name</button>
      <button class="chip ${sortMode === 'closeness' ? 'active' : ''}" data-sort="closeness">Nähe zu Dir</button>
    </div>
    ${tags.length ? `
      <div class="filter-row">
        <button class="chip ${!activeTag ? 'active' : ''}" data-tag="">Alle Tags</button>
        ${tags.map((t) => `<button class="chip ${activeTag === t ? 'active' : ''}" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join('')}
      </div>
    ` : ''}
    <div class="filter-row">
      <button class="chip ${!activeCloseness ? 'active' : ''}" data-closeness-filter="">Alle Nähe-Stufen</button>
      ${CLOSENESS_LEVELS.map((c) => `<button class="chip ${activeCloseness === c.key ? 'active' : ''}" data-closeness-filter="${c.key}">${c.label}</button>`).join('')}
    </div>
    ${filtered.length === 0 ? `
      <div class="empty">
        <h3>${q || activeTag || activeCloseness ? 'Keine Treffer' : 'Noch keine Kontakte'}</h3>
        <p class="faint">${q || activeTag || activeCloseness ? 'Andere Suche oder Filter versuchen.' : 'Lege deinen ersten Kontakt über das Plus oben rechts an.'}</p>
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
                <p class="truncate">${escapeHtml(p.name)}${p.role ? ` <span class="faint">· ${escapeHtml(p.role)}</span>` : ''}</p>
                <p class="person-row__meta">
                  ${p.closeness ? `<span class="tag-chip tag-chip--closeness">${escapeHtml(closenessLabel(p.closeness))}</span>` : ''}
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

  list.querySelectorAll('[data-sort]').forEach((el) => {
    el.addEventListener('click', () => { sortMode = el.dataset.sort; draw(); });
  });
  list.querySelectorAll('[data-tag]').forEach((el) => {
    el.addEventListener('click', () => { activeTag = el.dataset.tag || null; draw(); });
  });
  list.querySelectorAll('[data-closeness-filter]').forEach((el) => {
    el.addEventListener('click', () => { activeCloseness = el.dataset.closenessFilter || null; draw(); });
  });
  list.querySelectorAll('[data-open]').forEach((el) => {
    el.addEventListener('click', () => navigate(`#/person/${el.dataset.open}`));
  });
}

function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('');
}

function openAddModal(onSaved) {
  const roles = getRolesInUse();
  let closeness = null;

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
      <label>Rolle (optional)</label>
      <input class="input" id="p-role" placeholder="z.B. Bester Freund, Mutter, Bruder">
      ${roles.length ? `
        <div class="chip-row" id="role-suggest-row" style="margin-top:8px">
          ${roles.map((r) => `<button type="button" class="chip" data-role-suggest="${escapeHtml(r)}">${escapeHtml(r)}</button>`).join('')}
        </div>
      ` : ''}
    </div>
    <div class="field">
      <label>Nähe zu Dir (optional)</label>
      <div class="chip-row" id="closeness-row">
        <button type="button" class="chip active" data-closeness="">Keine Angabe</button>
        ${CLOSENESS_LEVELS.map((c) => `<button type="button" class="chip" data-closeness="${c.key}">${c.label}</button>`).join('')}
      </div>
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

  handle.sheet.querySelector('#role-suggest-row')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-role-suggest]');
    if (!btn) return;
    handle.sheet.querySelector('#p-role').value = btn.dataset.roleSuggest;
  });

  handle.sheet.querySelector('#closeness-row').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-closeness]');
    if (!btn) return;
    closeness = btn.dataset.closeness || null;
    handle.sheet.querySelectorAll('[data-closeness]').forEach((b) => b.classList.toggle('active', (b.dataset.closeness || null) === closeness));
  });

  handle.sheet.querySelector('#p-save').addEventListener('click', () => {
    const name = handle.sheet.querySelector('#p-name').value.trim();
    if (!name) { toast('Bitte einen Namen eingeben'); return; }
    const tags = handle.sheet.querySelector('#p-tags').value.split(',').map((t) => t.trim()).filter(Boolean);
    createPerson({
      name,
      birthday: handle.sheet.querySelector('#p-birthday').value || null,
      role: handle.sheet.querySelector('#p-role').value.trim(),
      closeness,
      socialProfile: {
        groupName: handle.sheet.querySelector('#p-group').value.trim(),
        howMet: handle.sheet.querySelector('#p-howmet').value.trim(),
        tags,
        remindWeeks: Number(handle.sheet.querySelector('#p-remind').value) || null,
      },
    });
    refreshBirthdayCalendarMirror();
    toast('Gespeichert');
    handle.close();
    onSaved?.();
  });
}
