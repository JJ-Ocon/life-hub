import { setTitle, setActions, setBack, navigate } from '../router.js';
import {
  getVehicles, getVehicleById, createVehicle, saveVehicle, deleteVehicle, VEHICLE_TYPES, vehicleTypeLabel, isFuelPowered,
  getMaintenanceTasks, createMaintenanceTask, markMaintenanceDone, deleteMaintenanceTask, maintenanceNextDue,
  MAINTENANCE_SUGGESTIONS,
  getFuelLogs, createFuelLog, deleteFuelLog, fuelConsumptionSeries, avgFuelConsumption, totalFuelCost, avgMonthlyFuelCost,
  estimatedMonthlyCost,
} from '../db.js';
import { openModal, confirmDialog, toast } from '../ui.js';
import { todayKey, formatDateKey, formatMoney, formatNum, escapeHtml } from '../utils.js';

let section = 'overview'; // 'overview' | 'maintenance' | 'fuel'
let vehicleId = null;

export function render() {
  setTitle('Fahrzeuge');
  setBack(null);
  setActions(`
    <button class="icon-btn" id="vehicle-add" aria-label="Fahrzeug hinzufügen">
      <svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
    </button>
  `);
  draw();
  document.getElementById('vehicle-add').addEventListener('click', () => openVehicleModal(null, draw));
}

function draw() {
  const view = document.getElementById('view');
  const vehicles = getVehicles();
  view.innerHTML = `
    ${vehicles.length === 0 ? `
      <div class="empty">
        <h3>Noch keine Fahrzeuge</h3>
        <p class="faint">Lege ein Auto, Motorrad, Fahrrad, E-Bike oder ein anderes Fahrzeug an, um Wartung und (falls zutreffend) Tankkosten zu verwalten.</p>
      </div>
    ` : `
      <div class="card">
        ${vehicles.map((v) => `
          <div class="due-row" data-open="${v.id}" style="cursor:pointer">
            <div class="col grow" style="min-width:0">
              <p class="due-row__title truncate">${escapeHtml(v.name)}</p>
              <p class="due-row__meta">${escapeHtml(vehicleTypeLabel(v.type))}${v.licensePlate ? ' · ' + escapeHtml(v.licensePlate) : ''}</p>
            </div>
          </div>
        `).join('')}
      </div>
    `}
  `;
  view.querySelectorAll('[data-open]').forEach((el) => {
    el.addEventListener('click', () => navigate(`#/vehicle/${el.dataset.open}`));
  });
}

export function openVehicleModal(existing, onSaved) {
  const isNew = !existing?.id;
  let type = existing?.type || 'auto';

  const handle = openModal(`
    <h3 class="modal-title">${isNew ? 'Fahrzeug anlegen' : 'Fahrzeug bearbeiten'}</h3>
    <div class="field">
      <label>Name</label>
      <input class="input" id="v-name" value="${escapeHtml(existing?.name || '')}" placeholder="z.B. VW Golf">
    </div>
    <div class="field">
      <label>Art</label>
      <div class="chip-row" id="type-row">
        ${VEHICLE_TYPES.map((t) => `<button type="button" class="chip ${type === t.key ? 'active' : ''}" data-type="${t.key}">${t.label}</button>`).join('')}
      </div>
    </div>
    <div class="field">
      <label>Kennzeichen (optional)</label>
      <input class="input" id="v-plate" value="${escapeHtml(existing?.licensePlate || '')}">
    </div>
    <div class="field">
      <label>Kaufdatum (optional)</label>
      <input class="input" type="date" id="v-purchase" value="${existing?.purchaseDate || ''}">
    </div>
    <div class="field">
      <label>Notiz (optional)</label>
      <textarea class="input" id="v-note">${escapeHtml(existing?.note || '')}</textarea>
    </div>
    <div class="stack">
      <button class="btn btn-primary" id="v-save">Speichern</button>
      ${!isNew ? '<button class="btn btn-danger" id="v-delete">Löschen</button>' : ''}
    </div>
  `, { center: true });

  handle.sheet.querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => {
    type = b.dataset.type;
    handle.sheet.querySelectorAll('[data-type]').forEach((x) => x.classList.toggle('active', x.dataset.type === type));
  }));

  handle.sheet.querySelector('#v-save').addEventListener('click', () => {
    const name = handle.sheet.querySelector('#v-name').value.trim();
    if (!name) { toast('Bitte einen Namen eingeben'); return; }
    const fields = {
      name, type,
      licensePlate: handle.sheet.querySelector('#v-plate').value.trim(),
      purchaseDate: handle.sheet.querySelector('#v-purchase').value || null,
      note: handle.sheet.querySelector('#v-note').value.trim(),
    };
    if (isNew) createVehicle(fields);
    else saveVehicle({ ...existing, ...fields });
    toast('Gespeichert');
    handle.close();
    onSaved?.();
  });
  handle.sheet.querySelector('#v-delete')?.addEventListener('click', async () => {
    const ok = await confirmDialog('Fahrzeug löschen?', 'Wartung und Tankverlauf werden unwiderruflich mit gelöscht.');
    if (!ok) return;
    deleteVehicle(existing.id);
    toast('Gelöscht');
    handle.close();
    onSaved?.();
    navigate('#/vehicles');
  });
}

export function renderDetail({ id }) {
  vehicleId = id;
  const vehicle = getVehicleById(id);
  if (!vehicle) {
    setTitle('Fahrzeug nicht gefunden');
    setBack(() => navigate('#/vehicles'));
    document.getElementById('view').innerHTML = `<div class="empty"><h3>Fahrzeug nicht gefunden</h3></div>`;
    return;
  }
  setTitle(vehicle.name);
  setBack(() => navigate('#/vehicles'));
  setActions('');
  drawDetail();
}

function drawDetail() {
  const vehicle = getVehicleById(vehicleId);
  if (!vehicle) { navigate('#/vehicles'); return; }
  const fuelPowered = isFuelPowered(vehicle.type);
  if (section === 'fuel' && !fuelPowered) section = 'overview';
  const view = document.getElementById('view');
  view.innerHTML = `
    <div class="section-tabs">
      <button class="chip ${section === 'overview' ? 'active' : ''}" data-sec="overview">Übersicht</button>
      <button class="chip ${section === 'maintenance' ? 'active' : ''}" data-sec="maintenance">Wartung</button>
      ${fuelPowered ? `<button class="chip ${section === 'fuel' ? 'active' : ''}" data-sec="fuel">Tanken</button>` : ''}
    </div>
    <div id="section-body"></div>
  `;
  view.querySelectorAll('[data-sec]').forEach((el) => el.addEventListener('click', () => { section = el.dataset.sec; drawDetail(); }));
  drawSection(vehicle);
}

function drawSection(vehicle) {
  const body = document.getElementById('section-body');
  if (section === 'overview') {
    const fuelPowered = isFuelPowered(vehicle.type);
    const monthly = estimatedMonthlyCost(vehicle.id);
    const consumption = fuelPowered ? avgFuelConsumption(vehicle.id) : null;
    body.innerHTML = `
      <div class="card">
        <p class="faint">${escapeHtml(vehicleTypeLabel(vehicle.type))}${vehicle.licensePlate ? ' · ' + escapeHtml(vehicle.licensePlate) : ''}</p>
        ${vehicle.purchaseDate ? `<p class="faint" style="margin-top:4px">Gekauft am ${formatDateKey(vehicle.purchaseDate)}</p>` : ''}
        ${vehicle.note ? `<p style="margin-top:10px">${escapeHtml(vehicle.note)}</p>` : ''}
      </div>
      <div class="${fuelPowered ? 'grid-2' : ''}">
        <div class="stat-tile">
          <div class="stat-tile__value">${monthly > 0 ? formatMoney(monthly) : '–'}</div>
          <div class="stat-tile__label">Geschätzte Kosten/Monat${fuelPowered ? '' : ' (Wartung)'}</div>
        </div>
        ${fuelPowered ? `
          <div class="stat-tile">
            <div class="stat-tile__value">${consumption !== null ? formatNum(consumption, 1) + ' l' : '–'}</div>
            <div class="stat-tile__label">Ø Verbrauch/100km</div>
          </div>
        ` : ''}
      </div>
      <div class="stack" style="margin-top:14px">
        <button class="btn btn-ghost" id="v-edit">Fahrzeug bearbeiten</button>
      </div>
    `;
    body.querySelector('#v-edit').addEventListener('click', () => openVehicleModal(vehicle, () => renderDetail({ id: vehicle.id })));
  } else if (section === 'maintenance') {
    const tasks = getMaintenanceTasks(vehicle.id);
    const today = todayKey();
    body.innerHTML = `
      ${tasks.length === 0 ? '<div class="empty"><p class="faint">Noch keine Wartungsaufgaben.</p></div>' : `
        <div class="card">
          ${tasks.map((t) => {
            const due = maintenanceNextDue(t);
            const overdue = due <= today;
            return `
              <div class="due-row">
                <div class="col grow" style="min-width:0">
                  <p class="due-row__title truncate">${escapeHtml(t.title)}</p>
                  <p class="due-row__meta">alle ${t.intervalMonths} Monate${t.cost ? ' · ' + formatMoney(t.cost) : ''}</p>
                </div>
                <span class="due-row__date ${overdue ? 'due-row__date--overdue' : ''}">${formatDateKey(due)}</span>
                <button class="icon-btn" data-done="${t.id}" aria-label="Erledigt"><svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg></button>
                <button class="icon-btn" data-del="${t.id}" aria-label="Löschen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg></button>
              </div>
            `;
          }).join('')}
        </div>
      `}
      <button class="btn btn-primary" id="m-add" style="margin-top:14px">+ Wartungsaufgabe</button>
    `;
    body.querySelectorAll('[data-done]').forEach((el) => el.addEventListener('click', () => { markMaintenanceDone(el.dataset.done); toast('Als erledigt markiert'); drawSection(vehicle); }));
    body.querySelectorAll('[data-del]').forEach((el) => el.addEventListener('click', async () => {
      const ok = await confirmDialog('Wartungsaufgabe löschen?', 'Wird unwiderruflich gelöscht.');
      if (!ok) return;
      deleteMaintenanceTask(el.dataset.del);
      drawSection(vehicle);
    }));
    body.querySelector('#m-add').addEventListener('click', () => openMaintenanceModal(vehicle));
  } else {
    const logs = getFuelLogs(vehicle.id).slice().reverse();
    const series = fuelConsumptionSeries(vehicle.id);
    const avg = avgFuelConsumption(vehicle.id);
    const monthlyCost = avgMonthlyFuelCost(vehicle.id);
    body.innerHTML = `
      ${logs.length > 0 ? `
        <div class="grid-2" style="margin-bottom:14px">
          <div class="stat-tile">
            <div class="stat-tile__value">${formatMoney(totalFuelCost(vehicle.id))}</div>
            <div class="stat-tile__label">Tankkosten gesamt</div>
          </div>
          <div class="stat-tile">
            <div class="stat-tile__value">${avg !== null ? formatNum(avg, 1) + ' l' : '–'}</div>
            <div class="stat-tile__label">Ø Verbrauch/100km${monthlyCost !== null ? ` · ${formatMoney(monthlyCost)}/Monat` : ''}</div>
          </div>
        </div>
      ` : ''}
      ${logs.length === 0 ? '<div class="empty"><p class="faint">Noch keine Tankfüllungen erfasst.</p></div>' : `
        <div class="card">
          ${logs.map((f) => {
            const entry = series.find((s) => s.date === f.date);
            return `
              <div class="due-row">
                <div class="col grow" style="min-width:0">
                  <p class="due-row__title truncate">${formatDateKey(f.date)} · ${formatNum(f.liters, 1)} l · ${f.odometerKm.toLocaleString('de-DE')} km</p>
                  <p class="due-row__meta">${f.totalCost ? formatMoney(f.totalCost) : ''}${entry ? ` · ${formatNum(entry.consumptionL100km, 1)} l/100km` : ''}</p>
                </div>
                <button class="icon-btn" data-del="${f.id}" aria-label="Löschen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg></button>
              </div>
            `;
          }).join('')}
        </div>
      `}
      <button class="btn btn-primary" id="f-add" style="margin-top:14px">+ Tankfüllung</button>
    `;
    body.querySelectorAll('[data-del]').forEach((el) => el.addEventListener('click', async () => {
      const ok = await confirmDialog('Tankfüllung löschen?', 'Wird unwiderruflich gelöscht.');
      if (!ok) return;
      deleteFuelLog(el.dataset.del);
      drawSection(vehicle);
    }));
    body.querySelector('#f-add').addEventListener('click', () => openFuelModal(vehicle));
  }
}

function openMaintenanceModal(vehicle) {
  const handle = openModal(`
    <h3 class="modal-title">Wartungsaufgabe anlegen</h3>
    <div class="field">
      <label>Vorschläge</label>
      <div class="chip-row" id="suggest-row">
        ${MAINTENANCE_SUGGESTIONS.map((s) => `<button type="button" class="chip" data-suggest="${escapeHtml(s.title)}" data-interval="${s.intervalMonths}">${escapeHtml(s.title)}</button>`).join('')}
      </div>
    </div>
    <div class="field">
      <label>Titel</label>
      <input class="input" id="m-title" placeholder="z.B. Ölwechsel">
    </div>
    <div class="field">
      <label>Intervall (Monate)</label>
      <input class="input" type="number" min="1" id="m-interval" value="12">
    </div>
    <div class="field">
      <label>Zuletzt durchgeführt (optional)</label>
      <input class="input" type="date" id="m-last">
    </div>
    <div class="field">
      <label>Kosten pro Durchführung (optional)</label>
      <input class="input" type="number" min="0" step="0.01" id="m-cost">
    </div>
    <div class="field">
      <label>Notiz (optional)</label>
      <textarea class="input" id="m-note"></textarea>
    </div>
    <button class="btn btn-primary" id="m-save">Speichern</button>
  `, { center: true });

  handle.sheet.querySelectorAll('[data-suggest]').forEach((b) => b.addEventListener('click', () => {
    handle.sheet.querySelector('#m-title').value = b.dataset.suggest;
    handle.sheet.querySelector('#m-interval').value = b.dataset.interval;
  }));

  handle.sheet.querySelector('#m-save').addEventListener('click', () => {
    const title = handle.sheet.querySelector('#m-title').value.trim();
    if (!title) { toast('Bitte einen Titel eingeben'); return; }
    const intervalMonths = Number(handle.sheet.querySelector('#m-interval').value) || 12;
    const lastDoneDate = handle.sheet.querySelector('#m-last').value || null;
    const cost = handle.sheet.querySelector('#m-cost').value ? Number(handle.sheet.querySelector('#m-cost').value) : null;
    const note = handle.sheet.querySelector('#m-note').value.trim();
    createMaintenanceTask({ vehicleId: vehicle.id, title, intervalMonths, lastDoneDate, cost, note });
    toast('Gespeichert');
    handle.close();
    drawSection(vehicle);
  });
}

function openFuelModal(vehicle) {
  const lastLog = getFuelLogs(vehicle.id).slice(-1)[0];
  const handle = openModal(`
    <h3 class="modal-title">Tankfüllung erfassen</h3>
    <div class="field">
      <label>Datum</label>
      <input class="input" type="date" id="f-date" value="${todayKey()}">
    </div>
    <div class="grid-2">
      <div class="field">
        <label>Menge (Liter)</label>
        <input class="input" type="number" min="0" step="0.01" id="f-liters">
      </div>
      <div class="field">
        <label>Kosten gesamt (optional)</label>
        <input class="input" type="number" min="0" step="0.01" id="f-cost">
      </div>
    </div>
    <div class="field">
      <label>Kilometerstand${lastLog ? ` (zuletzt: ${lastLog.odometerKm.toLocaleString('de-DE')} km)` : ''}</label>
      <input class="input" type="number" min="0" id="f-odometer">
    </div>
    <div class="field">
      <label>Notiz (optional)</label>
      <textarea class="input" id="f-note"></textarea>
    </div>
    <button class="btn btn-primary" id="f-save">Speichern</button>
  `, { center: true });

  handle.sheet.querySelector('#f-save').addEventListener('click', () => {
    const liters = Number(handle.sheet.querySelector('#f-liters').value) || 0;
    if (liters <= 0) { toast('Bitte eine Menge angeben'); return; }
    const odometerKm = Number(handle.sheet.querySelector('#f-odometer').value) || 0;
    if (odometerKm <= 0) { toast('Bitte einen Kilometerstand angeben'); return; }
    const date = handle.sheet.querySelector('#f-date').value || todayKey();
    const totalCost = handle.sheet.querySelector('#f-cost').value ? Number(handle.sheet.querySelector('#f-cost').value) : null;
    const note = handle.sheet.querySelector('#f-note').value.trim();
    createFuelLog({ vehicleId: vehicle.id, date, liters, totalCost, odometerKm, note });
    toast('Gespeichert');
    handle.close();
    drawSection(vehicle);
  });
}
