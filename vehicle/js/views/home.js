import { setTitle, setActions, setBack, navigate } from '../router.js';
import { getDueItems, markMaintenanceDone } from '../db.js';
import { getNotesForApp, updateAssignedNoteContent, unassignNote } from '../../../shared/notes-bridge.js';
import { todayKey, formatDateKey, escapeHtml } from '../utils.js';
import { openModal, confirmDialog, toast } from '../ui.js';

export function render() {
  setTitle('Fällig');
  setBack(null);
  setActions('');
  draw();
}

function draw() {
  const view = document.getElementById('view');
  const items = getDueItems();
  const today = todayKey();
  const assignedNotes = getNotesForApp('vehicle');

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
    ${items.length === 0 ? `
      <div class="empty">
        <h3>Nichts Fälliges</h3>
        <p class="faint">Wartungsaufgaben und TÜV-Termine deiner Fahrzeuge erscheinen hier automatisch.</p>
      </div>
    ` : `
      <div class="card">
        ${items.map(({ task, vehicle, due }) => {
          const overdue = due <= today;
          return `
            <div class="due-row" data-open="${vehicle.id}" style="cursor:pointer">
              <div class="col grow" style="min-width:0">
                <p class="due-row__title truncate">${escapeHtml(task.title)}</p>
                <p class="due-row__meta"><span class="badge kind-badge">${escapeHtml(vehicle.name)}</span></p>
              </div>
              <span class="due-row__date ${overdue ? 'due-row__date--overdue' : ''}">${formatDateKey(due)}</span>
              <button class="icon-btn" data-done="${task.id}" aria-label="Erledigt"><svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg></button>
            </div>
          `;
        }).join('')}
      </div>
    `}
  `;

  view.querySelectorAll('[data-open]').forEach((el) => {
    el.addEventListener('click', () => navigate(`#/vehicle/${el.dataset.open}`));
  });
  view.querySelectorAll('[data-done]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      markMaintenanceDone(el.dataset.done);
      toast('Als erledigt markiert');
      draw();
    });
  });
  view.querySelectorAll('[data-note-open]').forEach((node) => {
    const note = assignedNotes.find((n) => n.id === node.dataset.noteOpen);
    node.addEventListener('click', () => openAssignedNoteModal(note));
  });
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
      updateAssignedNoteContent(note.id, 'vehicle', { itemId: cb.dataset.anItem, itemDone: cb.checked });
    });
  });
  handle.sheet.querySelector('#an-save').addEventListener('click', () => {
    const title = handle.sheet.querySelector('#an-title').value.trim();
    const patch = { title };
    const textEl = handle.sheet.querySelector('#an-text');
    if (textEl) patch.text = textEl.value;
    updateAssignedNoteContent(note.id, 'vehicle', patch);
    toast('Gespeichert');
    handle.close();
    draw();
  });
  handle.sheet.querySelector('#an-unassign').addEventListener('click', async () => {
    const ok = await confirmDialog('Zuordnung aufheben?', 'Die Notiz bleibt in Notizen bestehen, verschwindet aber aus dieser Liste hier.', 'Aufheben', false);
    if (!ok) return;
    unassignNote(note.id, 'vehicle');
    toast('Zuordnung aufgehoben');
    handle.close();
    draw();
  });
}
