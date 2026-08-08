import { setTitle, setActions, setBack } from '../router.js';
import {
  getDocuments, getDocumentById, createDocument, saveDocument, deleteDocument, categoryLabel, getFolders,
} from '../db.js';
import { openModal, confirmDialog, promptDialog, toast } from '../ui.js';
import { formatDateKey, escapeHtml, compressImageFile } from '../utils.js';

let activeFolder = null;
let docSection = 'list'; // 'list' | 'gallery'

/** Rueckgabe-Adresse fuer den Cross-App-Anlege-Flow (siehe openDocModal
 *  unten): eine rufende App haengt beim Deep-Link zusaetzlich `returnTo`
 *  (volle URL inkl. Hash, wohin nach dem Speichern zurueckgesprungen wird)
 *  und `returnParam` (Name des Query-Parameters, unter dem die neue
 *  Dokument-ID an `returnTo` angehaengt wird) an - z.B. Travel's
 *  trip-detail.js. Ohne diese beiden Parameter verhaelt sich das Anlegen
 *  wie gewohnt (Modal schliessen, Liste bleibt in Safety). */
let pendingReturn = null;

export function render() {
  setTitle('Dokumente');
  setBack(null);
  setActions('');
  draw();

  const q = new URLSearchParams((location.hash.split('?')[1] || ''));
  const openId = q.get('open');
  if (openId) {
    const doc = getDocumentById(openId);
    if (doc) openDocModal(doc, draw);
  }
  const quickAddFolder = q.get('docQuickAdd');
  if (quickAddFolder) {
    const returnTo = q.get('returnTo');
    const returnParam = q.get('returnParam');
    pendingReturn = returnTo && returnParam ? { returnTo, returnParam } : null;
    history.replaceState(null, '', location.pathname + '#/documents');
    openDocModal({ category: quickAddFolder }, draw);
  }
}

function draw() {
  const view = document.getElementById('view');
  const allDocs = getDocuments();
  const folders = getFolders();
  const docs = activeFolder ? allDocs.filter((d) => categoryLabel(d.category) === activeFolder) : allDocs;
  const photoDocs = docs.filter((d) => d.photo);
  view.innerHTML = `
    <div class="section-tabs">
      <button class="chip ${docSection === 'list' ? 'active' : ''}" data-section="list">📋 Liste</button>
      <button class="chip ${docSection === 'gallery' ? 'active' : ''}" data-section="gallery">🖼️ Galerie</button>
    </div>
    ${folders.length ? `
      <div class="filter-row" style="margin-bottom:14px">
        <button class="chip ${!activeFolder ? 'active' : ''}" data-folder="">Alle</button>
        ${folders.map((f) => `<button class="chip ${activeFolder === f ? 'active' : ''}" data-folder="${escapeHtml(f)}">${escapeHtml(f)}</button>`).join('')}
      </div>
    ` : ''}
    ${docSection === 'gallery' ? `
      ${photoDocs.length === 0 ? `
        <div class="empty">
          <h3>Noch keine Fotos</h3>
          <p class="faint">Dokumente mit hinterlegtem Foto tauchen hier als Galerie auf.</p>
        </div>
      ` : `
        <div class="photo-grid">
          ${photoDocs.map((d) => `
            <div class="photo-grid__item" data-open="${d.id}" style="cursor:pointer">
              <img src="${d.photo}" alt="${escapeHtml(d.title)}">
              <p class="photo-grid__caption truncate">${escapeHtml(d.title)}</p>
            </div>
          `).join('')}
        </div>
      `}
    ` : `
      ${docs.length === 0 ? `
        <div class="empty">
          <h3>${activeFolder ? 'Keine Dokumente in diesem Ordner' : 'Noch keine Dokumente'}</h3>
          <p class="faint">Lege Ausweise, Verträge, Versicherungen oder Zertifikate mit Ablaufdatum an.</p>
        </div>
      ` : `
        <div class="card">
          ${docs.map((d) => `
            <div class="due-row" data-open="${d.id}" style="cursor:pointer">
              <div class="col grow" style="min-width:0">
                <p class="due-row__title truncate">${escapeHtml(d.title)}</p>
                <p class="due-row__meta">${escapeHtml(categoryLabel(d.category))}</p>
              </div>
              ${d.expiryDate ? `<span class="due-row__date">${formatDateKey(d.expiryDate)}</span>` : '<span class="faint">–</span>'}
            </div>
          `).join('')}
        </div>
      `}
    `}
    <button class="btn btn-primary" id="doc-add" style="margin-top:16px">+ Dokument</button>
  `;
  view.querySelectorAll('[data-section]').forEach((el) => {
    el.addEventListener('click', () => { docSection = el.dataset.section; draw(); });
  });
  view.querySelectorAll('[data-folder]').forEach((el) => {
    el.addEventListener('click', () => { activeFolder = el.dataset.folder || null; draw(); });
  });
  view.querySelectorAll('[data-open]').forEach((el) => {
    el.addEventListener('click', () => openDocModal(getDocumentById(el.dataset.open), draw));
  });
  document.getElementById('doc-add').addEventListener('click', () => openDocModal(null, draw));
}

function openDocModal(existing, onSaved) {
  const isNew = !existing?.id;
  const returnCtx = isNew ? pendingReturn : null;
  pendingReturn = null;
  let photoData = existing?.photo || null;
  let folder = existing ? categoryLabel(existing.category) : (activeFolder || '');
  const folders = getFolders();
  if (folder && !folders.includes(folder)) folders.push(folder);

  const handle = openModal(`
    <h3 class="modal-title">${isNew ? 'Dokument anlegen' : 'Dokument bearbeiten'}</h3>
    <div class="field">
      <label>Titel</label>
      <input class="input" id="d-title" value="${escapeHtml(existing?.title || '')}" placeholder="z.B. Reisepass">
    </div>
    <div class="field">
      <label>Ordner</label>
      <div class="chip-row" id="folder-row">
        ${folders.map((f) => `<button type="button" class="chip ${folder === f ? 'active' : ''}" data-folder="${escapeHtml(f)}">${escapeHtml(f)}</button>`).join('')}
        <button type="button" class="chip" id="folder-new">+ Neu</button>
      </div>
    </div>
    <div class="field">
      <label>Ablaufdatum (optional)</label>
      <input class="input" type="date" id="d-expiry" value="${existing?.expiryDate || ''}">
    </div>
    <div class="field">
      <label>Erinnerung — Tage vor Ablauf</label>
      <input class="input" type="number" min="0" id="d-lead" value="${existing?.reminderLeadDays ?? 30}">
    </div>
    <div class="field">
      <label>Notiz (optional)</label>
      <textarea class="input" id="d-note">${escapeHtml(existing?.note || '')}</textarea>
    </div>
    <div class="field">
      <label>Foto (optional)</label>
      <input class="input" type="file" accept="image/*" id="d-photo">
      <div id="d-photo-preview" style="margin-top:8px">${photoData ? `<img src="${photoData}" style="max-width:100%;border-radius:10px">` : ''}</div>
    </div>
    <div class="stack">
      <button class="btn btn-primary" id="d-save">Speichern</button>
      ${!isNew ? '<button class="btn btn-danger" id="d-delete">Löschen</button>' : ''}
    </div>
  `, { center: true });

  function wireFolderChips() {
    handle.sheet.querySelectorAll('[data-folder]').forEach((b) => b.addEventListener('click', () => {
      folder = b.dataset.folder;
      handle.sheet.querySelectorAll('[data-folder]').forEach((x) => x.classList.toggle('active', x.dataset.folder === folder));
    }));
    handle.sheet.querySelector('#folder-new').addEventListener('click', async () => {
      const name = await promptDialog('Neuer Ordner', { placeholder: 'z.B. Verträge' });
      if (!name) return;
      folder = name;
      if (!folders.includes(name)) folders.push(name);
      handle.sheet.querySelector('#folder-row').innerHTML = `
        ${folders.map((f) => `<button type="button" class="chip ${folder === f ? 'active' : ''}" data-folder="${escapeHtml(f)}">${escapeHtml(f)}</button>`).join('')}
        <button type="button" class="chip" id="folder-new">+ Neu</button>
      `;
      wireFolderChips();
    });
  }
  wireFolderChips();

  handle.sheet.querySelector('#d-photo').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    photoData = await compressImageFile(file);
    handle.sheet.querySelector('#d-photo-preview').innerHTML = `<img src="${photoData}" style="max-width:100%;border-radius:10px">`;
  });

  handle.sheet.querySelector('#d-save').addEventListener('click', async () => {
    const title = handle.sheet.querySelector('#d-title').value.trim();
    if (!title) { toast('Bitte einen Titel eingeben'); return; }
    const category = folder || 'Sonstiges';
    const expiryDate = handle.sheet.querySelector('#d-expiry').value || null;
    const reminderLeadDays = Number(handle.sheet.querySelector('#d-lead').value) || 0;
    const note = handle.sheet.querySelector('#d-note').value.trim();
    if (isNew) {
      const created = await createDocument({ title, category, expiryDate, reminderLeadDays, note, photo: photoData });
      if (returnCtx) {
        // returnTo ist eine Hash-Route der rufenden App (z.B. ".../travel/#/trip/123") -
        // die Rueckgabe-Parameter gehoeren also in die Query HINTER dem Hash, nicht in
        // die echte URL-Query (die vor dem Hash liegt und vom Hash-Router nicht gelesen wird).
        const [base, existingQuery] = returnCtx.returnTo.split('?');
        const params = new URLSearchParams(existingQuery || '');
        params.set(returnCtx.returnParam, created.id);
        params.set(`${returnCtx.returnParam}Title`, created.title);
        location.href = `${base}?${params.toString()}`;
        return;
      }
    } else {
      await saveDocument({ ...existing, title, category, expiryDate, reminderLeadDays, note, photo: photoData });
    }
    toast('Gespeichert');
    handle.close();
    onSaved?.();
  });
  handle.sheet.querySelector('#d-delete')?.addEventListener('click', async () => {
    const ok = await confirmDialog('Dokument löschen?', 'Wird unwiderruflich gelöscht.');
    if (!ok) return;
    await deleteDocument(existing.id);
    toast('Gelöscht');
    handle.close();
    onSaved?.();
  });
}
