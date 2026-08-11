// Persistenz-Schicht: alles in localStorage, bleibt lokal auf dem Geraet.

import { uid, nowIso, todayKey, addMonthsToDateKey, daysBetweenDateKeys } from './utils.js';
import { createCalendarEvent } from '../../shared/calendar-schema.js';
import { replaceSourceEvents } from '../../shared/event-store.js';
import { publishExternalSubscriptions } from '../../shared/subscriptions.js';

const KEYS = {
  vehicles: 'vh_vehicles_v1',
  maintenance: 'vh_maintenance_v1',
  fuelLogs: 'vh_fuel_logs_v1',
  settings: 'vh_settings_v1',
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export const VEHICLE_TYPES = [
  { key: 'auto', label: 'Auto' },
  { key: 'motorrad', label: 'Motorrad' },
  { key: 'fahrrad', label: 'Fahrrad' },
  { key: 'e-bike', label: 'E-Bike' },
  { key: 'sonstiges', label: 'Sonstiges' },
];

export function vehicleTypeLabel(type) {
  return VEHICLE_TYPES.find((t) => t.key === type)?.label || 'Sonstiges';
}

/** Der Tanken-Bereich rechnet in Litern/Kilometerstand - das passt weder
 *  auf ein rein muskelbetriebenes Fahrrad noch auf ein E-Bike (das laedt
 *  Strom statt zu tanken, hier noch nicht separat modelliert). Fuer beide
 *  bleibt nur Wartung relevant (Kette, Bremsen, Reifen, Akku-Check). */
export function isFuelPowered(type) {
  return type !== 'fahrrad' && type !== 'e-bike';
}

/** Vorschlaege fuer wiederkehrende Wartungsaufgaben inkl. typischem
 *  Intervall (Monate) - gleiches "eingebaute Vorschlagsliste"-Muster wie
 *  Household's PLANT_INTERVAL_SUGGESTIONS. TÜV ist bewusst mit dabei, kein
 *  Sonderfall - technisch einfach eine Wartungsaufgabe mit 24-Monats-Turnus. */
export const MAINTENANCE_SUGGESTIONS = [
  { title: 'TÜV/Hauptuntersuchung', intervalMonths: 24 },
  { title: 'Ölwechsel', intervalMonths: 12 },
  { title: 'Reifenwechsel (saisonal)', intervalMonths: 6 },
  { title: 'Bremsen prüfen', intervalMonths: 12 },
  { title: 'Inspektion', intervalMonths: 12 },
];

/* =========================================================
   Fahrzeuge – Grunddaten.
   ========================================================= */
// Vehicle: { id, name, type, licensePlate, purchaseDate (YYYY-MM-DD|null), note, createdAt }

export function getVehicles() {
  return read(KEYS.vehicles, []).sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

export function getVehicleById(id) {
  return read(KEYS.vehicles, []).find((v) => v.id === id) || null;
}

export function saveVehicle(vehicle) {
  const list = read(KEYS.vehicles, []);
  const idx = list.findIndex((v) => v.id === vehicle.id);
  if (idx >= 0) list[idx] = vehicle; else list.push(vehicle);
  write(KEYS.vehicles, list);
  refreshSharedCalendarMirror();
  refreshSharedSubscriptions();
  return vehicle;
}

export function createVehicle(fields) {
  return saveVehicle({
    id: uid(), name: fields.name, type: fields.type || 'auto',
    licensePlate: fields.licensePlate || '', purchaseDate: fields.purchaseDate || null,
    note: fields.note || '', createdAt: nowIso(),
  });
}

export function deleteVehicle(id) {
  write(KEYS.vehicles, read(KEYS.vehicles, []).filter((v) => v.id !== id));
  write(KEYS.maintenance, read(KEYS.maintenance, []).filter((m) => m.vehicleId !== id));
  write(KEYS.fuelLogs, read(KEYS.fuelLogs, []).filter((f) => f.vehicleId !== id));
  refreshSharedCalendarMirror();
  refreshSharedSubscriptions();
}

/* =========================================================
   Wartung – wiederkehrende Aufgaben nach festem Monats-Intervall,
   inkl. TÜV (siehe MAINTENANCE_SUGGESTIONS oben). Optionaler Kosten-
   Schaetzwert pro Durchfuehrung fliesst in die Budget-Anbindung ein.
   ========================================================= */
// MaintenanceTask: { id, vehicleId, title, intervalMonths, lastDoneDate (YYYY-MM-DD|null), cost (optional), note, createdAt }

export function getMaintenanceTasks(vehicleId) {
  return read(KEYS.maintenance, []).filter((m) => m.vehicleId === vehicleId);
}

export function getAllMaintenanceTasks() {
  return read(KEYS.maintenance, []);
}

export function saveMaintenanceTask(task) {
  const list = read(KEYS.maintenance, []);
  const idx = list.findIndex((m) => m.id === task.id);
  if (idx >= 0) list[idx] = task; else list.push(task);
  write(KEYS.maintenance, list);
  refreshSharedCalendarMirror();
  refreshSharedSubscriptions();
  return task;
}

export function createMaintenanceTask(fields) {
  return saveMaintenanceTask({
    id: uid(), vehicleId: fields.vehicleId, title: fields.title,
    intervalMonths: fields.intervalMonths, lastDoneDate: fields.lastDoneDate || null,
    cost: fields.cost ?? null, note: fields.note || '', createdAt: nowIso(),
  });
}

export function markMaintenanceDone(id) {
  const list = read(KEYS.maintenance, []);
  const t = list.find((m) => m.id === id);
  if (t) saveMaintenanceTask({ ...t, lastDoneDate: todayKey() });
}

export function deleteMaintenanceTask(id) {
  write(KEYS.maintenance, read(KEYS.maintenance, []).filter((m) => m.id !== id));
  refreshSharedCalendarMirror();
  refreshSharedSubscriptions();
}

export function maintenanceNextDue(task) {
  return task.lastDoneDate ? addMonthsToDateKey(task.lastDoneDate, task.intervalMonths) : todayKey();
}

/** Faellige/bald faellige Wartungsaufgaben ueber alle Fahrzeuge, sortiert nach Faelligkeit. */
export function getDueItems() {
  return read(KEYS.maintenance, [])
    .map((t) => ({ task: t, vehicle: getVehicleById(t.vehicleId), due: maintenanceNextDue(t) }))
    .filter(({ vehicle }) => vehicle)
    .sort((a, b) => a.due.localeCompare(b.due));
}

/* =========================================================
   Tanken – Tankfuellungen mit Kilometerstand fuer die
   Verbrauchsberechnung (Voll-zu-Voll-Methode: der Verbrauch einer
   Fuellung bezieht sich auf die seit der letzten Fuellung gefahrene
   Strecke).
   ========================================================= */
// FuelLog: { id, vehicleId, date, liters, totalCost, odometerKm, note, createdAt }

export function getFuelLogs(vehicleId) {
  return read(KEYS.fuelLogs, [])
    .filter((f) => f.vehicleId === vehicleId)
    .sort((a, b) => a.odometerKm - b.odometerKm);
}

export function createFuelLog(fields) {
  const list = read(KEYS.fuelLogs, []);
  list.push({
    id: uid(), vehicleId: fields.vehicleId, date: fields.date || todayKey(),
    liters: fields.liters, totalCost: fields.totalCost ?? null, odometerKm: fields.odometerKm,
    note: fields.note || '', createdAt: nowIso(),
  });
  write(KEYS.fuelLogs, list);
  refreshSharedSubscriptions();
}

export function deleteFuelLog(id) {
  write(KEYS.fuelLogs, read(KEYS.fuelLogs, []).filter((f) => f.id !== id));
  refreshSharedSubscriptions();
}

/** Verbrauch (l/100km) je Fuellung ab der zweiten, aus der seit der
 *  vorherigen Fuellung gefahrenen Strecke. */
export function fuelConsumptionSeries(vehicleId) {
  const logs = getFuelLogs(vehicleId);
  const series = [];
  for (let i = 1; i < logs.length; i++) {
    const distanceKm = logs[i].odometerKm - logs[i - 1].odometerKm;
    if (distanceKm <= 0) continue;
    series.push({ date: logs[i].date, consumptionL100km: Math.round((logs[i].liters / (distanceKm / 100)) * 10) / 10 });
  }
  return series;
}

export function avgFuelConsumption(vehicleId) {
  const series = fuelConsumptionSeries(vehicleId);
  if (!series.length) return null;
  return Math.round((series.reduce((s, e) => s + e.consumptionL100km, 0) / series.length) * 10) / 10;
}

export function totalFuelCost(vehicleId) {
  return getFuelLogs(vehicleId).reduce((sum, f) => sum + (f.totalCost || 0), 0);
}

/** Durchschnittliche monatliche Tankkosten, aus der Spanne zwischen erster
 *  und letzter Tankung - null bei weniger als zwei Eintraegen. */
export function avgMonthlyFuelCost(vehicleId) {
  const logs = getFuelLogs(vehicleId);
  if (logs.length < 2) return null;
  const days = daysBetweenDateKeys(logs[0].date, logs[logs.length - 1].date);
  if (days <= 0) return null;
  const months = days / 30.44;
  return Math.round((totalFuelCost(vehicleId) / months) * 100) / 100;
}

/** Monatlich umgelegte Wartungskosten (Kosten pro Durchfuehrung / Intervall in Monaten), summiert. */
export function avgMonthlyMaintenanceCost(vehicleId) {
  return getMaintenanceTasks(vehicleId)
    .filter((t) => t.cost)
    .reduce((sum, t) => sum + t.cost / t.intervalMonths, 0);
}

/** Geschaetzte monatliche Gesamtkosten (Tanken + Wartung), fuer den
 *  Vergleichsrechner und die Budget-Anbindung. */
export function estimatedMonthlyCost(vehicleId) {
  return (avgMonthlyFuelCost(vehicleId) || 0) + avgMonthlyMaintenanceCost(vehicleId);
}

/* =========================================================
   Kalender-Spiegelung – nur Wartung/TÜV-Faelligkeiten, keine
   einzelnen Tankfuellungen (zu hochfrequent, gleiche Begruendung wie
   bei jeder anderen App im Oekosystem).
   ========================================================= */

export async function refreshSharedCalendarMirror() {
  try {
    const events = [];
    for (const t of read(KEYS.maintenance, [])) {
      const vehicle = getVehicleById(t.vehicleId);
      if (!vehicle) continue;
      events.push(createCalendarEvent({
        id: `vehicle-${t.id}`, title: `${t.title}: ${vehicle.name}`, start: maintenanceNextDue(t), source: 'vehicle',
        link: `#/vehicle/${vehicle.id}`,
      }));
    }
    await replaceSourceEvents('vehicle', events);
  } catch {
    // Shared Storage ist ein optionales Extra, kein Kernfeature.
  }
}

/** Veroeffentlicht pro Fahrzeug die geschaetzten monatlichen Kosten als
 *  externes Abo in shared/subscriptions.js, damit Budgets Abo-Radar sie
 *  mit anzeigen kann - gleiches Muster wie Household's Vertraege (E26). */
function refreshSharedSubscriptions() {
  const items = read(KEYS.vehicles, [])
    .map((v) => ({ id: v.id, label: v.name, monthlyEquivalent: Math.round(estimatedMonthlyCost(v.id) * 100) / 100, note: 'Fahrzeug' }))
    .filter((i) => i.monthlyEquivalent > 0);
  publishExternalSubscriptions('vehicle', items);
}

/* ---------- Einstellungen ---------- */
const DEFAULT_SETTINGS = { theme: 'dark', accentHue: 6, lastTransitPrice: null };

export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...read(KEYS.settings, {}) };
}

export function saveSettings(patch) {
  const merged = { ...getSettings(), ...patch };
  write(KEYS.settings, merged);
  return merged;
}

/* ---------- Export / Import / Reset ---------- */
export function exportAllData() {
  return {
    exportedAt: nowIso(),
    vehicles: read(KEYS.vehicles, []),
    maintenance: read(KEYS.maintenance, []),
    fuelLogs: read(KEYS.fuelLogs, []),
    settings: getSettings(),
  };
}

export function importAllData(data) {
  if (data.vehicles) write(KEYS.vehicles, data.vehicles);
  if (data.maintenance) write(KEYS.maintenance, data.maintenance);
  if (data.fuelLogs) write(KEYS.fuelLogs, data.fuelLogs);
  if (data.settings) write(KEYS.settings, data.settings);
  refreshSharedCalendarMirror();
  refreshSharedSubscriptions();
}

export function resetAllData() {
  localStorage.removeItem(KEYS.vehicles);
  localStorage.removeItem(KEYS.maintenance);
  localStorage.removeItem(KEYS.fuelLogs);
  localStorage.removeItem(KEYS.settings);
  refreshSharedCalendarMirror();
  refreshSharedSubscriptions();
}
