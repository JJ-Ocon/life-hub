import { setTitle, setActions, setBack } from '../router.js';
import { getBodyEntries, saveBodyEntry, deleteBodyEntry, getSettings, listPhotos, putPhoto, deletePhoto } from '../db.js';
import { todayKey, formatDate, formatDateShort, formatNum, uid, resizeImage } from '../utils.js';
import { lineChart } from '../charts.js';
import { openModal, confirmDialog, toast } from '../ui.js';

const MEASURE_FIELDS = [
  ['weight', 'Gewicht'],
  ['waist', 'Taille'],
  ['chest', 'Brust'],
  ['arm', 'Arm'],
  ['thigh', 'Oberschenkel'],
  ['hips', 'Hüfte'],
];

export async function render() {
  setTitle('Körperdaten');
  setActions('');
  setBack(null);

  const settings = getSettings();
  const entries = getBodyEntries();
  const photos = await listPhotos();

  const weightPoints = entries.filter((e) => e.weight != null).map((e) => ({ date: e.date, value: e.weight }));
  const latest = entries[entries.length - 1];
  const first = entries[0];
  const diff = latest && first && latest !== first ? latest.weight - first.weight : null;

  document.getElementById('view').innerHTML = `
    <div class="grid-3">
      <div class="stat-tile"><div class="stat-tile__value">${latest?.weight != null ? formatNum(latest.weight) : '–'}</div><div class="stat-tile__label">Aktuell (${settings.units})</div></div>
      <div class="stat-tile"><div class="stat-tile__value">${diff != null ? (diff > 0 ? '+' : '') + formatNum(diff) : '–'}</div><div class="stat-tile__label">Veränderung gesamt</div></div>
      <div class="stat-tile"><div class="stat-tile__value">${entries.length}</div><div class="stat-tile__label">Einträge</div></div>
    </div>

    <div class="section-title">Gewichtsverlauf</div>
    <div class="card" style="padding:8px 4px">${lineChart(weightPoints, { unit: settings.units })}</div>
    <button class="btn btn-primary" id="add-entry" style="margin-top:4px">+ Eintrag hinzufügen</button>

    <div class="section-title">Verlauf</div>
    ${entries.length === 0 ? `<p class="faint" style="padding:0 2px">Noch keine Einträge.</p>` : `
      <div class="stack">
        ${entries.slice().reverse().slice(0, 10).map((e) => `
          <div class="card row row--between" data-entry="${e.id}">
            <div class="col grow">
              <h3>${formatDate(e.date, { withWeekday: true })}</h3>
              <p class="faint">${MEASURE_FIELDS.filter(([k]) => e[k] != null).map(([k, l]) => `${l}: ${formatNum(e[k])}${k === 'weight' ? settings.units : ' cm'}`).join(' · ') || '–'}</p>
            </div>
            <button class="icon-btn" data-del-entry="${e.id}" aria-label="Löschen"><svg viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/></svg></button>
          </div>
        `).join('')}
      </div>
    `}

    <div class="section-title row row--between">
      <span>Fortschrittsfotos</span>
      <label class="btn btn-ghost btn-sm" style="width:auto" for="photo-input">+ Foto</label>
    </div>
    <input type="file" id="photo-input" accept="image/*" capture="environment" hidden>
    ${photos.length === 0 ? `<p class="faint" style="padding:0 2px">Noch keine Fotos. Fotos werden nur lokal auf deinem Gerät gespeichert.</p>` : `
      <div class="photo-grid">
        ${photos.slice().reverse().map((p) => `
          <div class="photo-item" data-photo="${p.id}">
            <img src="${p.dataUrl}" alt="Fortschrittsfoto ${formatDateShort(p.date)}">
            <div class="photo-item__date">${formatDateShort(p.date)}</div>
          </div>
        `).join('')}
      </div>
    `}
  `;

  document.getElementById('add-entry').addEventListener('click', () => openEntryForm(settings));
  document.querySelectorAll('[data-del-entry]').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    const ok = await confirmDialog('Eintrag löschen?', 'Dieser Körperdaten-Eintrag wird entfernt.');
    if (ok) { deleteBodyEntry(b.dataset.delEntry); render(); }
  }));

  document.getElementById('photo-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    toast('Foto wird gespeichert…');
    const reader = new FileReader();
    reader.onload = async () => {
      const resized = await resizeImage(reader.result);
      await putPhoto({ id: uid(), date: todayKey(), dataUrl: resized });
      toast('Foto gespeichert');
      render();
    };
    reader.readAsDataURL(file);
  });

  document.querySelectorAll('[data-photo]').forEach((el) => {
    el.addEventListener('click', () => openPhotoViewer(el.dataset.photo, photos));
  });
}

function openEntryForm(settings) {
  const handle = openModal(`
    <h3 class="modal-title">Körperdaten-Eintrag</h3>
    <div class="field"><label>Datum</label><input class="input" type="date" id="be-date" value="${todayKey()}"></div>
    ${MEASURE_FIELDS.map(([key, label]) => `
      <div class="field"><label>${label}${key === 'weight' ? ` (${settings.units})` : ' (cm)'}</label>
        <input class="input" type="number" inputmode="decimal" id="be-${key}" placeholder="optional">
      </div>
    `).join('')}
    <button class="btn btn-primary" id="be-save">Speichern</button>
  `, {});

  handle.sheet.querySelector('#be-save').addEventListener('click', () => {
    const date = handle.sheet.querySelector('#be-date').value || todayKey();
    const entry = { id: uid(), date };
    let any = false;
    for (const [key] of MEASURE_FIELDS) {
      const v = handle.sheet.querySelector(`#be-${key}`).value;
      if (v !== '') { entry[key] = Number(v); any = true; }
    }
    if (!any) { toast('Bitte mindestens einen Wert eingeben'); return; }
    saveBodyEntry(entry);
    toast('Gespeichert');
    handle.close();
    render();
  });
}

function openPhotoViewer(id, photos) {
  const photo = photos.find((p) => p.id === id);
  if (!photo) return;
  const handle = openModal(`
    <h3 class="modal-title">${formatDate(photo.date, { withWeekday: true, withYear: true })}</h3>
    <img src="${photo.dataUrl}" style="width:100%;border-radius:12px;margin-bottom:14px">
    <button class="btn btn-danger" id="photo-del">Foto löschen</button>
  `, {});
  handle.sheet.querySelector('#photo-del').addEventListener('click', async () => {
    const ok = await confirmDialog('Foto löschen?', 'Dieses Fortschrittsfoto wird dauerhaft entfernt.');
    if (ok) { await deletePhoto(id); handle.close(); render(); }
  });
}
