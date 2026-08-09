// Allgemeine, reisenunabhaengige Dokumente (z.B. eine Perso-Kopie) - im
// Gegensatz zu den reisenspezifischen Dokumenten in trip-detail.js sind
// diese hier tripId:null und tauchen bei keiner einzelnen Reise auf.
// Nutzt dieselbe TripDocument-Tabelle wie die Reisen selbst, nur ohne
// Reise-Zuordnung - kein neues Datenmodell/Storage-Key noetig.

import { setTitle, setActions, setBack } from '../router.js';
import { getDocuments, createDocument, deleteDocument } from '../db.js';
import { openModal, confirmDialog, toast } from '../ui.js';
import { formatDateKey, escapeHtml, compressImageFile } from '../utils.js';

export function render() {
  setTitle('Dokumente');
  setBack(null);
  setActions('');
  draw();
}

function draw() {
  const view = document.getElementById('view');
  const docs = getDocuments(null);
  view.innerHTML = `
    <p class="faint" style="margin-bottom:12px">Allgemeine Dokumente, die zu keiner bestimmten Reise gehören (z.B. eine Perso-Kopie). Reisenspezifische Dokumente legst du im jeweiligen Reise-Detail unter "Dokumente" an. Für sensible Dokumente wie Ausweiskopien empfiehlt sich stattdessen der verschlüsselte Digitale Safe.</p>
    ${docs.length === 0 ? '<div class="empty"><p class="faint">Noch keine allgemeinen Dokumente hinterlegt.</p></div>' : `
      <div class="card">
        ${docs.map((d) => `
          <div class="due-row">
            <div class="col grow" style="min-width:0">
              <p class="due-row__title truncate">${escapeHtml(d.title)}</p>
              <p class="due-row__meta">${d.fileType === 'pdf' ? 'PDF' : 'Bild'} · ${formatDateKey(d.createdAt.slice(0, 10))}</p>
            </div>
            ${d.fileType === 'image' ? `<a href="${d.fileData}" target="_blank" rel="noopener"><img src="${d.fileData}" style="width:40px;height:40px;object-fit:cover;border-radius:6px"></a>` : `<a class="btn btn-ghost btn-sm" href="${d.fileData}" target="_blank" rel="noopener" download="${escapeHtml(d.title)}.pdf">Öffnen</a>`}
            <button class="icon-btn" data-del="${d.id}" aria-label="Löschen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg></button>
          </div>
        `).join('')}
      </div>
    `}
    <button class="btn btn-primary" id="d-add" style="margin-top:14px">+ Dokument</button>
  `;
  view.querySelectorAll('[data-del]').forEach((el) => el.addEventListener('click', async () => {
    const ok = await confirmDialog('Dokument löschen?', 'Wird unwiderruflich gelöscht.');
    if (!ok) return;
    deleteDocument(el.dataset.del);
    draw();
  }));
  view.querySelector('#d-add').addEventListener('click', () => openDocumentModal());
}

function openDocumentModal() {
  let fileData = null;
  let fileType = null;
  const handle = openModal(`
    <h3 class="modal-title">Dokument hinzufügen</h3>
    <div class="field">
      <label>Titel</label>
      <input class="input" id="d-title" placeholder="z.B. Perso-Kopie">
    </div>
    <div class="field">
      <label>Datei (Bild oder PDF)</label>
      <input class="input" type="file" accept="image/*,application/pdf" id="d-file">
      <p class="faint" id="d-file-status" style="margin-top:6px"></p>
    </div>
    <button class="btn btn-primary" id="d-save">Speichern</button>
  `, { center: true });

  handle.sheet.querySelector('#d-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const status = handle.sheet.querySelector('#d-file-status');
    if (file.type === 'application/pdf') {
      fileType = 'pdf';
      fileData = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(file);
      });
    } else {
      fileType = 'image';
      fileData = await compressImageFile(file);
    }
    status.textContent = `${file.name} bereit zum Speichern.`;
  });

  handle.sheet.querySelector('#d-save').addEventListener('click', () => {
    const title = handle.sheet.querySelector('#d-title').value.trim();
    if (!title) { toast('Bitte einen Titel eingeben'); return; }
    if (!fileData) { toast('Bitte eine Datei auswählen'); return; }
    createDocument(null, title, fileData, fileType);
    toast('Gespeichert');
    handle.close();
    draw();
  });
}
