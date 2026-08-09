import { setTitle, setActions, setBack, navigate } from '../router.js';
import {
  getPersonById, savePerson, deletePerson, getInteractionsForPerson, logInteraction,
  getLinksForPerson, addLink, removeLink, getPeople, isMutualLink, confirmedByOf,
  CLOSENESS_LEVELS, closenessLabel, getRolesInUse,
} from '../../../shared/contacts.js';
import { refreshBirthdayCalendarMirror } from '../db.js';
import { openModal, confirmDialog, toast } from '../ui.js';
import { escapeHtml, todayKey, formatDateKey, uid } from '../utils.js';

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
      const mutual = isMutualLink(l);
      // Aus Sicht DIESER Person: hat sie selbst bestaetigt (-> zeigt weg von ihr),
      // oder nur die andere Seite (<- die andere Person kennt sie, noch unbestaetigt)?
      const confirmedByThisPerson = confirmedByOf(l).includes(id);
      return { linkId: l.id, person: getPersonById(otherId), mutual, confirmedByThisPerson };
    }).filter((l) => l.person);

    document.getElementById('view').innerHTML = `
      <div class="row" style="gap:8px; flex-wrap:wrap; margin-bottom:8px">
        ${p.role ? `<span class="badge">${escapeHtml(p.role)}</span>` : ''}
        ${p.closeness ? `<span class="badge badge--closeness">${escapeHtml(closenessLabel(p.closeness))}</span>` : ''}
      </div>
      ${p.birthday ? `<p class="faint" style="margin-bottom:4px">🎂 ${formatDateKey(p.birthday, { withYear: true })}</p>` : ''}
      ${p.socialProfile?.groupName ? `<p class="faint" style="margin-bottom:4px">${escapeHtml(p.socialProfile.groupName)}</p>` : ''}
      ${p.socialProfile?.howMet ? `<p class="faint" style="margin-bottom:4px">Kennengelernt: ${escapeHtml(p.socialProfile.howMet)}</p>` : ''}
      ${(p.socialProfile?.tags || []).length ? `<p style="margin:8px 0 16px">${p.socialProfile.tags.map((t) => `<span class="tag-chip">${escapeHtml(t)}</span>`).join('')}</p>` : ''}
      ${p.interests ? `<p class="faint" style="margin-bottom:16px">Interessen: ${escapeHtml(p.interests)}</p>` : ''}

      ${(p.phone || p.email || (p.socialHandles || []).length) ? `
        <div class="card stack" style="margin-bottom:20px">
          ${p.phone ? `<a class="contact-line" href="tel:${escapeHtml(p.phone)}">📞 ${escapeHtml(p.phone)}</a>` : ''}
          ${p.email ? `<a class="contact-line" href="mailto:${escapeHtml(p.email)}">✉️ ${escapeHtml(p.email)}</a>` : ''}
          ${(p.socialHandles || []).map((h) => `<p class="contact-line">💬 ${escapeHtml(h.platform)}: ${escapeHtml(h.handle)}</p>`).join('')}
        </div>
      ` : ''}

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
            <span>${l.mutual ? '⇄' : (l.confirmedByThisPerson ? '→' : '←')} ${escapeHtml(l.person.name)}${l.mutual ? '' : ` <span class="faint">(einseitig${l.confirmedByThisPerson ? '' : ', noch nicht bestätigt'})</span>`}</span>
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
  const roles = getRolesInUse();
  let closeness = person.closeness || null;
  let handles = (person.socialHandles || []).map((h) => ({ ...h }));

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
      <label>Rolle (optional)</label>
      <input class="input" id="p-role" value="${escapeHtml(person.role || '')}" placeholder="z.B. Bester Freund, Mutter, Bruder">
      ${roles.length ? `
        <div class="chip-row" id="role-suggest-row" style="margin-top:8px">
          ${roles.map((r) => `<button type="button" class="chip" data-role-suggest="${escapeHtml(r)}">${escapeHtml(r)}</button>`).join('')}
        </div>
      ` : ''}
    </div>
    <div class="field">
      <label>Nähe zu Dir (optional)</label>
      <div class="chip-row" id="closeness-row">
        <button type="button" class="chip ${!closeness ? 'active' : ''}" data-closeness="">Keine Angabe</button>
        ${CLOSENESS_LEVELS.map((c) => `<button type="button" class="chip ${closeness === c.key ? 'active' : ''}" data-closeness="${c.key}">${c.label}</button>`).join('')}
      </div>
    </div>
    <div class="field">
      <label>Telefon (optional)</label>
      <input class="input" type="tel" id="p-phone" value="${escapeHtml(person.phone || '')}">
    </div>
    <div class="field">
      <label>E-Mail (optional)</label>
      <input class="input" type="email" id="p-email" value="${escapeHtml(person.email || '')}">
    </div>
    <div class="field">
      <label>Social-Media (optional)</label>
      <div id="handle-list" class="stack"></div>
      <button type="button" class="btn btn-ghost" id="handle-add" style="margin-top:8px">+ Handle hinzufügen</button>
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

  function drawHandles() {
    const list = handle.sheet.querySelector('#handle-list');
    list.innerHTML = handles.map((h) => `
      <div class="row" style="gap:8px" data-handle-row="${h.id}">
        <input class="input" data-handle-platform="${h.id}" placeholder="Plattform" value="${escapeHtml(h.platform)}" style="flex:1">
        <input class="input" data-handle-value="${h.id}" placeholder="@handle" value="${escapeHtml(h.handle)}" style="flex:1">
        <button type="button" class="icon-btn" data-handle-remove="${h.id}" aria-label="Entfernen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg></button>
      </div>
    `).join('');
    list.querySelectorAll('[data-handle-platform]').forEach((el) => {
      el.addEventListener('input', () => {
        const h = handles.find((x) => x.id === el.dataset.handlePlatform);
        if (h) h.platform = el.value;
      });
    });
    list.querySelectorAll('[data-handle-value]').forEach((el) => {
      el.addEventListener('input', () => {
        const h = handles.find((x) => x.id === el.dataset.handleValue);
        if (h) h.handle = el.value;
      });
    });
    list.querySelectorAll('[data-handle-remove]').forEach((el) => {
      el.addEventListener('click', () => {
        handles = handles.filter((x) => x.id !== el.dataset.handleRemove);
        drawHandles();
      });
    });
  }
  drawHandles();

  handle.sheet.querySelector('#handle-add').addEventListener('click', () => {
    handles.push({ id: uid(), platform: '', handle: '' });
    drawHandles();
  });

  handle.sheet.querySelector('#p-save').addEventListener('click', () => {
    const name = handle.sheet.querySelector('#p-name').value.trim();
    if (!name) { toast('Bitte einen Namen eingeben'); return; }
    const tags = handle.sheet.querySelector('#p-tags').value.split(',').map((t) => t.trim()).filter(Boolean);
    savePerson({
      ...person,
      name,
      birthday: handle.sheet.querySelector('#p-birthday').value || null,
      interests: handle.sheet.querySelector('#p-interests').value.trim(),
      role: handle.sheet.querySelector('#p-role').value.trim(),
      closeness,
      phone: handle.sheet.querySelector('#p-phone').value.trim(),
      email: handle.sheet.querySelector('#p-email').value.trim(),
      socialHandles: handles.filter((h) => h.platform.trim() || h.handle.trim()).map((h) => ({ ...h, platform: h.platform.trim(), handle: h.handle.trim() })),
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
