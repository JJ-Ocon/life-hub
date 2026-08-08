import { setTitle, setActions, setBack, navigate } from '../router.js';
import {
  getTripById, deleteTrip, tripSpent, EXPENSE_CATEGORIES, tripTypeLabel,
  getPackingItems, addPackingItem, addPackingTemplate, togglePackingItem, deletePackingItem,
  getItineraryEntries, createItineraryEntry, deleteItineraryEntry,
  getExpenses, createExpense, deleteExpense,
  getDocuments, createDocument, deleteDocument,
  getPhotos, createPhoto, deletePhoto,
} from '../db.js';
import { openModal, confirmDialog, toast } from '../ui.js';
import { todayKey, formatDateKey, formatMoney, escapeHtml, compressImageFile } from '../utils.js';
import { openTripModal } from './trips.js';
import { findConflictingEvents } from '../../../shared/event-store.js';
import { getSourceLabel } from '../../../shared/calendar-schema.js';
import { recognizeText, parseReceiptText } from '../../../shared/receipt-ocr.js';

let section = 'overview'; // 'overview' | 'packing' | 'itinerary' | 'expenses' | 'documents' | 'photos'
let tripId = null;

export function render(id) {
  tripId = id;
  const trip = getTripById(id);
  if (!trip) {
    setTitle('Reise nicht gefunden');
    setBack(() => navigate('#/'));
    document.getElementById('view').innerHTML = `<div class="empty"><h3>Reise nicht gefunden</h3></div>`;
    return;
  }
  setTitle(trip.name);
  setBack(() => navigate('#/'));
  setActions('');
  draw();
}

function draw() {
  const trip = getTripById(tripId);
  if (!trip) { navigate('#/'); return; }
  const view = document.getElementById('view');
  view.innerHTML = `
    <div class="section-tabs">
      <button class="chip ${section === 'overview' ? 'active' : ''}" data-sec="overview">Übersicht</button>
      <button class="chip ${section === 'packing' ? 'active' : ''}" data-sec="packing">Packliste</button>
      <button class="chip ${section === 'itinerary' ? 'active' : ''}" data-sec="itinerary">Reiseplan</button>
      <button class="chip ${section === 'expenses' ? 'active' : ''}" data-sec="expenses">Ausgaben</button>
      <button class="chip ${section === 'documents' ? 'active' : ''}" data-sec="documents">Dokumente</button>
      <button class="chip ${section === 'photos' ? 'active' : ''}" data-sec="photos">Fotos</button>
    </div>
    <div id="section-body"></div>
  `;
  view.querySelectorAll('[data-sec]').forEach((el) => el.addEventListener('click', () => { section = el.dataset.sec; draw(); }));
  drawSection(trip);
}

function drawSection(trip) {
  const body = document.getElementById('section-body');
  if (section === 'overview') {
    const spent = tripSpent(trip.id);
    body.innerHTML = `
      <div class="card">
        <p class="faint">${escapeHtml(trip.destination || '–')}</p>
        <h2 style="margin-top:4px">${formatDateKey(trip.startDate)} – ${formatDateKey(trip.endDate)}</h2>
        ${trip.note ? `<p style="margin-top:10px">${escapeHtml(trip.note)}</p>` : ''}
      </div>
      ${trip.budgetTotal ? `
        <div class="grid-2">
          <div class="stat-tile">
            <div class="stat-tile__value">${formatMoney(spent)}</div>
            <div class="stat-tile__label">Ausgegeben</div>
          </div>
          <div class="stat-tile">
            <div class="stat-tile__value">${formatMoney(trip.budgetTotal - spent)}</div>
            <div class="stat-tile__label">Verbleibend von ${formatMoney(trip.budgetTotal)}</div>
          </div>
        </div>
      ` : `
        <div class="stat-tile">
          <div class="stat-tile__value">${formatMoney(spent)}</div>
          <div class="stat-tile__label">Ausgegeben (kein Budget gesetzt)</div>
        </div>
      `}
      <div class="stack" style="margin-top:14px">
        <button class="btn btn-ghost" id="trip-edit">Reise bearbeiten</button>
        <button class="btn btn-danger" id="trip-delete">Reise löschen</button>
      </div>
    `;
    body.querySelector('#trip-edit').addEventListener('click', () => openTripModal(trip, () => render(trip.id)));
    body.querySelector('#trip-delete').addEventListener('click', async () => {
      const ok = await confirmDialog('Reise löschen?', 'Packliste, Reiseplan und Ausgaben dieser Reise werden unwiderruflich gelöscht.');
      if (!ok) return;
      deleteTrip(trip.id);
      toast('Gelöscht');
      navigate('#/');
    });
  } else if (section === 'packing') {
    const items = getPackingItems(trip.id);
    body.innerHTML = `
      <div class="row" style="gap:8px;margin-bottom:12px">
        <input class="input" id="p-new" placeholder="Neuer Gegenstand">
        <button class="btn btn-primary btn-sm" id="p-add">+</button>
      </div>
      <button class="btn btn-ghost" id="p-suggest" style="margin-bottom:14px">Vorlage für "${tripTypeLabel(trip.type)}" hinzufügen</button>
      ${items.length === 0 ? '<div class="empty"><p class="faint">Noch nichts auf der Packliste.</p></div>' : `
        <div class="card">
          ${items.map((p) => `
            <div class="switch-row">
              <label class="row" style="gap:10px;flex:1;min-width:0">
                <input type="checkbox" data-toggle="${p.id}" ${p.packed ? 'checked' : ''}>
                <span class="${p.packed ? 'faint' : ''}" style="text-decoration:${p.packed ? 'line-through' : 'none'}">${escapeHtml(p.text)}</span>
              </label>
              <button class="icon-btn" data-del="${p.id}" aria-label="Löschen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg></button>
            </div>
          `).join('')}
        </div>
      `}
    `;
    body.querySelector('#p-add').addEventListener('click', () => {
      const input = body.querySelector('#p-new');
      const text = input.value.trim();
      if (!text) return;
      addPackingItem(trip.id, text);
      drawSection(trip);
    });
    body.querySelector('#p-new').addEventListener('keydown', (e) => { if (e.key === 'Enter') body.querySelector('#p-add').click(); });
    body.querySelector('#p-suggest').addEventListener('click', () => { addPackingTemplate(trip.id, trip.type); drawSection(trip); });
    body.querySelectorAll('[data-toggle]').forEach((el) => el.addEventListener('change', () => { togglePackingItem(el.dataset.toggle); drawSection(trip); }));
    body.querySelectorAll('[data-del]').forEach((el) => el.addEventListener('click', () => { deletePackingItem(el.dataset.del); drawSection(trip); }));
  } else if (section === 'itinerary') {
    const entries = getItineraryEntries(trip.id);
    body.innerHTML = `
      ${entries.length === 0 ? '<div class="empty"><p class="faint">Noch keine Termine im Reiseplan.</p></div>' : `
        <div class="card">
          ${entries.map((i) => `
            <div class="due-row">
              <div class="col grow" style="min-width:0">
                <p class="due-row__title truncate">${escapeHtml(i.title)}</p>
                <p class="due-row__meta">${formatDateKey(i.date)}${i.time ? ' · ' + i.time : ''}${i.note ? ' · ' + escapeHtml(i.note) : ''}</p>
              </div>
              <button class="icon-btn" data-del="${i.id}" aria-label="Löschen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg></button>
            </div>
          `).join('')}
        </div>
      `}
      <button class="btn btn-primary" id="i-add" style="margin-top:14px">+ Termin</button>
    `;
    body.querySelectorAll('[data-del]').forEach((el) => el.addEventListener('click', async () => {
      const ok = await confirmDialog('Termin löschen?', 'Wird unwiderruflich gelöscht.');
      if (!ok) return;
      deleteItineraryEntry(el.dataset.del);
      drawSection(trip);
    }));
    body.querySelector('#i-add').addEventListener('click', () => openItineraryModal(trip));
  } else if (section === 'documents') {
    const docs = getDocuments(trip.id);
    body.innerHTML = `
      <p class="faint" style="margin-bottom:12px">Tickets, Buchungsbestätigungen und andere Reisedokumente. Für sensible Dokumente wie Reisepass-Kopien empfiehlt sich stattdessen der verschlüsselte Digitale Safe.</p>
      <button class="btn btn-ghost" id="d-safe-link" style="margin-bottom:14px">🔒 Sensibles Dokument im Digitalen Safe anlegen</button>
      ${docs.length === 0 ? '<div class="empty"><p class="faint">Noch keine Dokumente hinterlegt.</p></div>' : `
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
    body.querySelector('#d-safe-link').addEventListener('click', () => {
      const params = new URLSearchParams({ docQuickAdd: `Reise: ${trip.name}` });
      location.href = `../safety/#/documents?${params.toString()}`;
    });
    body.querySelectorAll('[data-del]').forEach((el) => el.addEventListener('click', async () => {
      const ok = await confirmDialog('Dokument löschen?', 'Wird unwiderruflich gelöscht.');
      if (!ok) return;
      deleteDocument(el.dataset.del);
      drawSection(trip);
    }));
    body.querySelector('#d-add').addEventListener('click', () => openDocumentModal(trip));
  } else if (section === 'photos') {
    const photos = getPhotos(trip.id);
    body.innerHTML = `
      ${photos.length === 0 ? '<div class="empty"><p class="faint">Noch keine Fotos hinterlegt.</p></div>' : `
        <div class="photo-grid">
          ${photos.map((p) => `
            <div class="photo-grid__item">
              <img src="${p.photoData}" alt="${escapeHtml(p.caption)}">
              <button class="icon-btn photo-grid__del" data-del="${p.id}" aria-label="Löschen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg></button>
              ${p.caption ? `<p class="photo-grid__caption">${escapeHtml(p.caption)}</p>` : ''}
            </div>
          `).join('')}
        </div>
      `}
      <button class="btn btn-primary" id="ph-add" style="margin-top:14px">+ Foto</button>
    `;
    body.querySelectorAll('[data-del]').forEach((el) => el.addEventListener('click', async () => {
      const ok = await confirmDialog('Foto löschen?', 'Wird unwiderruflich gelöscht.');
      if (!ok) return;
      deletePhoto(el.dataset.del);
      drawSection(trip);
    }));
    body.querySelector('#ph-add').addEventListener('click', () => openPhotoModal(trip));
  } else {
    const expenses = getExpenses(trip.id);
    body.innerHTML = `
      ${expenses.length === 0 ? '<div class="empty"><p class="faint">Noch keine Ausgaben erfasst.</p></div>' : `
        <div class="card">
          ${expenses.map((e) => `
            <div class="due-row">
              <div class="col grow" style="min-width:0">
                <p class="due-row__title truncate">${escapeHtml(e.category)}${e.note ? ' · ' + escapeHtml(e.note) : ''}</p>
                <p class="due-row__meta">${formatDateKey(e.date)}</p>
              </div>
              <span class="due-row__date">${formatMoney(e.amount)}</span>
              <button class="icon-btn" data-del="${e.id}" aria-label="Löschen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg></button>
            </div>
          `).join('')}
        </div>
      `}
      <button class="btn btn-primary" id="e-add" style="margin-top:14px">+ Ausgabe</button>
    `;
    body.querySelectorAll('[data-del]').forEach((el) => el.addEventListener('click', async () => {
      const ok = await confirmDialog('Ausgabe löschen?', 'Wird unwiderruflich gelöscht.');
      if (!ok) return;
      deleteExpense(el.dataset.del);
      drawSection(trip);
    }));
    body.querySelector('#e-add').addEventListener('click', () => openExpenseModal(trip));
  }
}

function openItineraryModal(trip) {
  const handle = openModal(`
    <h3 class="modal-title">Termin anlegen</h3>
    <div class="field">
      <label>Titel</label>
      <input class="input" id="i-title" placeholder="z.B. Abflug, Hotel Check-in">
    </div>
    <div class="grid-2">
      <div class="field">
        <label>Datum</label>
        <input class="input" type="date" id="i-date" value="${trip.startDate}">
      </div>
      <div class="field">
        <label>Uhrzeit (optional)</label>
        <input class="input" type="time" id="i-time">
      </div>
    </div>
    <div class="field">
      <label>Notiz (optional)</label>
      <textarea class="input" id="i-note"></textarea>
    </div>
    <button class="btn btn-primary" id="i-save">Speichern</button>
  `, { center: true });

  handle.sheet.querySelector('#i-save').addEventListener('click', async () => {
    const title = handle.sheet.querySelector('#i-title').value.trim();
    if (!title) { toast('Bitte einen Titel eingeben'); return; }
    const date = handle.sheet.querySelector('#i-date').value || trip.startDate;
    const time = handle.sheet.querySelector('#i-time').value || null;
    const note = handle.sheet.querySelector('#i-note').value.trim();
    const conflicts = await findConflictingEvents(date, 'travel').catch(() => []);
    if (conflicts.length) {
      const names = [...new Set(conflicts.map((c) => getSourceLabel(c.source)))].join(', ');
      const ok = await confirmDialog(
        'Termin überschneidet sich',
        `Am ${formatDateKey(date)} gibt es bereits Einträge in: ${names}. Trotzdem speichern?`,
        'Trotzdem speichern', false
      );
      if (!ok) return;
    }
    createItineraryEntry({ tripId: trip.id, date, time, title, note });
    toast('Gespeichert');
    handle.close();
    drawSection(trip);
  });
}

function openExpenseModal(trip) {
  const handle = openModal(`
    <h3 class="modal-title">Ausgabe erfassen</h3>
    <button class="btn btn-ghost" id="e-scan" type="button" style="margin-bottom:14px">📷 Beleg scannen</button>
    <input type="file" accept="image/*" id="e-scan-input" hidden>
    <p class="faint" id="e-scan-status" hidden style="margin:-6px 0 14px"></p>
    <div class="field">
      <label>Betrag</label>
      <input class="input" type="number" min="0" step="0.01" id="e-amount">
    </div>
    <div class="field">
      <label>Kategorie</label>
      <div class="chip-row" id="cat-row">
        ${EXPENSE_CATEGORIES.map((c, i) => `<button class="chip ${i === 0 ? 'active' : ''}" data-cat="${c}">${c}</button>`).join('')}
      </div>
    </div>
    <div class="field">
      <label>Datum</label>
      <input class="input" type="date" id="e-date" value="${todayKey()}">
    </div>
    <div class="field">
      <label>Notiz (optional)</label>
      <textarea class="input" id="e-note"></textarea>
    </div>
    <button class="btn btn-primary" id="e-save">Speichern</button>
  `, { center: true });

  handle.sheet.querySelector('#e-scan').addEventListener('click', () => handle.sheet.querySelector('#e-scan-input').click());
  handle.sheet.querySelector('#e-scan-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const status = handle.sheet.querySelector('#e-scan-status');
    status.hidden = false;
    status.textContent = 'Beleg wird erkannt … (beim ersten Mal laedt die OCR-Engine, das dauert etwas laenger)';
    try {
      const text = await recognizeText(file, (info) => {
        if (info.status === 'recognizing text') status.textContent = `Text wird erkannt … ${Math.round(info.progress * 100)}%`;
      });
      const parsed = parseReceiptText(text);
      if (parsed.amount !== null) handle.sheet.querySelector('#e-amount').value = parsed.amount.toFixed(2);
      if (parsed.date) handle.sheet.querySelector('#e-date').value = parsed.date;
      if (parsed.merchant) handle.sheet.querySelector('#e-note').value = parsed.merchant;
      status.textContent = 'Erkannt - bitte prüfen und bei Bedarf korrigieren.';
    } catch {
      status.textContent = 'Beleg-Scan fehlgeschlagen. Bitte manuell eintragen.';
    }
  });

  let category = EXPENSE_CATEGORIES[0];
  handle.sheet.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => {
    category = b.dataset.cat;
    handle.sheet.querySelectorAll('[data-cat]').forEach((x) => x.classList.toggle('active', x.dataset.cat === category));
  }));

  handle.sheet.querySelector('#e-save').addEventListener('click', () => {
    const amount = Number(handle.sheet.querySelector('#e-amount').value) || 0;
    if (amount <= 0) { toast('Bitte einen Betrag angeben'); return; }
    const date = handle.sheet.querySelector('#e-date').value || todayKey();
    const note = handle.sheet.querySelector('#e-note').value.trim();
    createExpense({ tripId: trip.id, amount, category, date, note });
    toast('Gespeichert');
    handle.close();
    drawSection(trip);
  });
}

function openDocumentModal(trip) {
  let fileData = null;
  let fileType = null;
  const handle = openModal(`
    <h3 class="modal-title">Dokument hinzufügen</h3>
    <div class="field">
      <label>Titel</label>
      <input class="input" id="d-title" placeholder="z.B. Flugticket, Hotel-Buchung">
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
    createDocument(trip.id, title, fileData, fileType);
    toast('Gespeichert');
    handle.close();
    drawSection(trip);
  });
}

function openPhotoModal(trip) {
  let photoData = null;
  const handle = openModal(`
    <h3 class="modal-title">Foto hinzufügen</h3>
    <div class="field">
      <label>Foto</label>
      <input class="input" type="file" accept="image/*" id="ph-file">
      <div id="ph-preview" style="margin-top:8px"></div>
    </div>
    <div class="field">
      <label>Bildunterschrift (optional)</label>
      <input class="input" id="ph-caption">
    </div>
    <button class="btn btn-primary" id="ph-save">Speichern</button>
  `, { center: true });

  handle.sheet.querySelector('#ph-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    photoData = await compressImageFile(file);
    handle.sheet.querySelector('#ph-preview').innerHTML = `<img src="${photoData}" style="max-width:100%;border-radius:10px">`;
  });

  handle.sheet.querySelector('#ph-save').addEventListener('click', () => {
    if (!photoData) { toast('Bitte ein Foto auswählen'); return; }
    const caption = handle.sheet.querySelector('#ph-caption').value.trim();
    createPhoto(trip.id, photoData, caption);
    toast('Gespeichert');
    handle.close();
    drawSection(trip);
  });
}
