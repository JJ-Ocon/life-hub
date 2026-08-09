import { setTitle, setActions, setBack, navigate } from '../router.js';
import {
  getPersonById, savePerson, deletePerson, getInteractionsForPerson, logInteraction,
  getLinksForPerson, addLink, removeLink, getPeople,
} from '../../../shared/contacts.js';
import { refreshBirthdayCalendarMirror } from '../db.js';
import { openModal, confirmDialog, toast } from '../ui.js';
import { escapeHtml, todayKey, formatDateKey } from '../utils.js';

export function render({ id }) {
  const person = getPersonById(id);
  if (!person) { navigate('#/'); return; }

  setTitle(person.name);
  setBack(() => navigate('#/'));
  setActions(`
    <button class="icon-btn" id="p-edit" aria-label="Bearbeiten">
      <svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
    </button>
  `);

  function draw() {
    const p = getPersonById(id);
    const interactions = getInteractionsForPerson(id);
    const links = getLinksForPerson(id).map((l) => {
      const otherId = l.personIdA === id ? l.personIdB : l.personIdA;
      return { linkId: l.id, person: getPersonById(otherId) };
    }).filter((l) => l.person);

    document.getElementById('view').innerHTML = `
      ${p.birthday ? `<p class="faint" style="margin-bottom:4px">🎂 ${formatDateKey(p.birthday, { withYear: true })}</p>` : ''}
      ${p.socialProfile?.groupName ? `<p class="faint" style="margin-bottom:4px">${escapeHtml(p.socialProfile.groupName)}</p>` : ''}
      ${p.socialProfile?.howMet ? `<p class="faint" style="margin-bottom:4px">Kennengelernt: ${escapeHtml(p.socialProfile.howMet)}</p>` : ''}
      ${(p.socialProfile?.tags || []).length ? `<p style="margin:8px 0 16px">${p.socialProfile.tags.map((t) => `<span class="tag-chip">${escapeHtml(t)}</span>`).join('')}</p>` : ''}
      ${p.interests ? `<p class="faint" style="margin-bottom:16px">Interessen: ${escapeHtml(p.interests)}</p>` : ''}

      <button class="btn btn-primary" id="log-contact" style="margin-bottom:20px">✓ Kontakt heute geloggt</button>

      <div class="section-title" style="margin-top:0">Beziehungs-Log</div>
      <div class="card">
        ${interactions.length === 0 ? '<p class="faint">Noch keine Einträge.</p>' : interactions.map((i) => `
          <div class="interaction-row">
            <div class="interaction-row__date">${formatDateKey(i.date)}</div>
            ${i.note ? `<div class="interaction-row__note">${escapeHtml(i.note)}</div>` : ''}
          </div>
        `).join('')}
      </div>

      <div class="section-title">Kennt auch</div>
      <div class="card">
        ${links.length === 0 ? '<p class="faint">Noch keine Verknüpfung.</p>' : links.map((l) => `
          <div class="row row--between" style="padding:6px 0">
            <span>${escapeHtml(l.person.name)}</span>
            <button class="icon-btn" data-unlink="${l.linkId}" aria-label="Verknüpfung entfernen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg></button>
          </div>
        `).join('')}
      </div>
      <button class="btn btn-ghost" id="link-add" style="margin-bottom:20px">+ Verknüpfung</button>

      <button class="btn btn-danger" id="p-delete">Kontakt löschen</button>
    `;

    document.getElementById('log-contact').addEventListener('click', async () => {
      const note = await promptNote();
      logInteraction(id, todayKey(), note || '');
      toast('Kontakt geloggt');
      draw();
    });
    document.querySelectorAll('[data-unlink]').forEach((el) => {
      el.addEventListener('click', () => { removeLink(el.dataset.unlink); draw(); });
    });
    document.getElementById('link-add').addEventListener('click', () => openLinkModal(id, draw));
    document.getElementById('p-delete').addEventListener('click', async () => {
      const ok = await confirmDialog('Kontakt löschen?', 'Beziehungs-Log und Verknüpfungen werden mit-entfernt.');
      if (!ok) return;
      deletePerson(id);
      refreshBirthdayCalendarMirror();
      toast('Gelöscht');
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
      <h3 class="modal-title">Kontakt loggen</h3>
      <div class="field">
        <label>Notiz (optional)</label>
        <textarea class="input" id="note-text" placeholder="Worüber gesprochen, was ansteht ..."></textarea>
      </div>
      <button class="btn btn-primary" id="note-save">Speichern</button>
    `, { center: true, onClose: () => resolve('') });
    handle.sheet.querySelector('#note-save').addEventListener('click', () => {
      resolve(handle.sheet.querySelector('#note-text').value.trim());
      handle.close();
    });
  });
}

function openLinkModal(personId, onSaved) {
  const others = getPeople().filter((p) => p.id !== personId);
  if (!others.length) { toast('Keine anderen Kontakte vorhanden'); return; }
  const handle = openModal(`
    <h3 class="modal-title">Verknüpfung hinzufügen</h3>
    <div class="stack">
      ${others.map((p) => `<button class="btn btn-ghost" data-link="${p.id}">${escapeHtml(p.name)}</button>`).join('')}
    </div>
  `, { center: true });
  handle.sheet.querySelectorAll('[data-link]').forEach((b) => b.addEventListener('click', () => {
    addLink(personId, b.dataset.link);
    handle.close();
    onSaved?.();
  }));
}

function openEditModal(person, onSaved) {
  const handle = openModal(`
    <h3 class="modal-title">Kontakt bearbeiten</h3>
    <div class="field">
      <label>Name</label>
      <input class="input" id="p-name" value="${escapeHtml(person.name)}">
    </div>
    <div class="field">
      <label>Geburtstag (optional)</label>
      <input class="input" type="date" id="p-birthday" value="${person.birthday || ''}">
    </div>
    <div class="field">
      <label>Freundeskreis-Gruppe (optional)</label>
      <input class="input" id="p-group" value="${escapeHtml(person.socialProfile?.groupName || '')}">
    </div>
    <div class="field">
      <label>Wie kennengelernt? (optional)</label>
      <input class="input" id="p-howmet" value="${escapeHtml(person.socialProfile?.howMet || '')}">
    </div>
    <div class="field">
      <label>Tags (kommagetrennt)</label>
      <input class="input" id="p-tags" value="${escapeHtml((person.socialProfile?.tags || []).join(', '))}">
    </div>
    <div class="field">
      <label>Erinnerungsintervall (Wochen, optional)</label>
      <input class="input" type="number" min="1" id="p-remind" value="${person.socialProfile?.remindWeeks || ''}">
    </div>
    <div class="field">
      <label>Interessen (optional)</label>
      <textarea class="input" id="p-interests">${escapeHtml(person.interests || '')}</textarea>
    </div>
    <button class="btn btn-primary" id="p-save">Speichern</button>
  `, { center: true });

  handle.sheet.querySelector('#p-save').addEventListener('click', () => {
    const name = handle.sheet.querySelector('#p-name').value.trim();
    if (!name) { toast('Bitte einen Namen eingeben'); return; }
    const tags = handle.sheet.querySelector('#p-tags').value.split(',').map((t) => t.trim()).filter(Boolean);
    savePerson({
      ...person,
      name,
      birthday: handle.sheet.querySelector('#p-birthday').value || null,
      interests: handle.sheet.querySelector('#p-interests').value.trim(),
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
