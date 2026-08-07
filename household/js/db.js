// Persistenz-Schicht: alles in localStorage, bleibt lokal auf dem Geraet.

import { uid, nowIso, todayKey, addDaysToDateKey, addMonthsToDateKey } from './utils.js';
import { createCalendarEvent } from '../../shared/calendar-schema.js';
import { replaceSourceEvents } from '../../shared/event-store.js';
import { publishExternalSubscriptions } from '../../shared/subscriptions.js';

const KEYS = {
  maintenance: 'hh_maintenance_v1',
  contracts: 'hh_contracts_v1',
  plants: 'hh_plants_v1',
  pets: 'hh_pets_v1',
  invoices: 'hh_invoices_v1',
  settings: 'hh_settings_v1',
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

/* =========================================================
   Wartungsaufgaben – wiederkehrend nach festem Monats-Intervall
   (Rauchmelder-Batterie, Dunstabzugshauben-Filter, ...).
   ========================================================= */
// MaintenanceTask: { id, title, intervalMonths, lastDone (YYYY-MM-DD|null), note, createdAt }

export function getMaintenanceTasks() {
  return read(KEYS.maintenance, []);
}

export function getMaintenanceTaskById(id) {
  return getMaintenanceTasks().find((t) => t.id === id) || null;
}

export function saveMaintenanceTask(task) {
  const list = getMaintenanceTasks();
  const idx = list.findIndex((t) => t.id === task.id);
  if (idx >= 0) list[idx] = task; else list.push(task);
  write(KEYS.maintenance, list);
  refreshSharedCalendarMirror();
  return task;
}

export function createMaintenanceTask(fields) {
  return saveMaintenanceTask({
    id: uid(), title: fields.title, intervalMonths: fields.intervalMonths,
    lastDone: fields.lastDone || null, note: fields.note || '', createdAt: nowIso(),
  });
}

export function deleteMaintenanceTask(id) {
  write(KEYS.maintenance, getMaintenanceTasks().filter((t) => t.id !== id));
  refreshSharedCalendarMirror();
}

export function markMaintenanceDone(id) {
  const t = getMaintenanceTaskById(id);
  if (t) saveMaintenanceTask({ ...t, lastDone: todayKey() });
}

export function maintenanceNextDue(task) {
  return task.lastDone ? addMonthsToDateKey(task.lastDone, task.intervalMonths) : todayKey();
}

/* =========================================================
   Vertraege – Anbieter, Kosten, Kuendigungsfrist. Vertraege mit
   monatlichen Kosten werden in shared/subscriptions.js veroeffentlicht,
   damit Budgets Abo-Radar sie zusammen mit den eigenen wiederkehrenden
   Ausgaben anzeigt (Anbindung "Vertraege <-> Abo-Radar" aus dem
   Oekosystem-Dokument, nachgezogen sobald Abo-Radar existierte).
   ========================================================= */
// Contract: { id, provider, monthlyCost, cancellationNoticeWeeks, renewalDate (YYYY-MM-DD), note, createdAt }

export function getContracts() {
  return read(KEYS.contracts, []);
}

export function getContractById(id) {
  return getContracts().find((c) => c.id === id) || null;
}

export function saveContract(contract) {
  const list = getContracts();
  const idx = list.findIndex((c) => c.id === contract.id);
  if (idx >= 0) list[idx] = contract; else list.push(contract);
  write(KEYS.contracts, list);
  refreshSharedCalendarMirror();
  refreshSharedSubscriptions();
  return contract;
}

export function createContract(fields) {
  return saveContract({
    id: uid(), provider: fields.provider, monthlyCost: fields.monthlyCost || 0,
    cancellationNoticeWeeks: fields.cancellationNoticeWeeks || 0, renewalDate: fields.renewalDate,
    note: fields.note || '', createdAt: nowIso(),
  });
}

export function deleteContract(id) {
  write(KEYS.contracts, getContracts().filter((c) => c.id !== id));
  refreshSharedCalendarMirror();
  refreshSharedSubscriptions();
}

/** Datum, ab dem spaetestens gekuendigt werden muss. */
export function contractReminderDate(contract) {
  return addDaysToDateKey(contract.renewalDate, -(contract.cancellationNoticeWeeks || 0) * 7);
}

/** Veroeffentlicht alle Vertraege mit Kosten > 0 als externe Abo-Eintraege. */
function refreshSharedSubscriptions() {
  const items = getContracts()
    .filter((c) => c.monthlyCost > 0)
    .map((c) => ({ id: c.id, label: c.provider, monthlyEquivalent: c.monthlyCost, note: 'Vertrag' }));
  publishExternalSubscriptions('household', items);
}

/* =========================================================
   Pflanzen – Giessplan. Giessen selbst wird NICHT in den Hub-Kalender
   gespiegelt (zu hochfrequent, wuerde den Kalender zumuellen) - nur
   hier als Faellig-Liste gefuehrt.
   ========================================================= */
// Plant: { id, name, species, wateringIntervalDays, lastWatered (YYYY-MM-DD|null), note, createdAt }

/** Grobe Standard-Giessintervalle je Pflanzenart (Tage) - kein externer
 *  Datensatz, nur eine kleine eingebaute Faustregel-Tabelle als Vorschlag. */
export const PLANT_INTERVAL_SUGGESTIONS = {
  'kaktus': 21, 'sukkulente': 14, 'orchidee': 7, 'grünlilie': 10,
  'basilikum': 3, 'efeu': 7, 'ficus': 7, 'monstera': 7, 'bonsai': 4,
  'zamioculcas': 18, 'aloe vera': 14, 'bogenhanf': 18, 'philodendron': 6,
};

export function suggestWateringInterval(species) {
  if (!species) return null;
  const q = species.trim().toLowerCase();
  for (const [name, days] of Object.entries(PLANT_INTERVAL_SUGGESTIONS)) {
    if (q.includes(name)) return days;
  }
  return null;
}

export function getPlants() {
  return read(KEYS.plants, []);
}

export function getPlantById(id) {
  return getPlants().find((p) => p.id === id) || null;
}

export function savePlant(plant) {
  const list = getPlants();
  const idx = list.findIndex((p) => p.id === plant.id);
  if (idx >= 0) list[idx] = plant; else list.push(plant);
  write(KEYS.plants, list);
  return plant;
}

export function createPlant(fields) {
  return savePlant({
    id: uid(), name: fields.name, species: fields.species || '',
    wateringIntervalDays: fields.wateringIntervalDays || 7,
    lastWatered: fields.lastWatered || null, note: fields.note || '', createdAt: nowIso(),
  });
}

export function deletePlant(id) {
  write(KEYS.plants, getPlants().filter((p) => p.id !== id));
}

export function markPlantWatered(id) {
  const p = getPlantById(id);
  if (p) savePlant({ ...p, lastWatered: todayKey() });
}

export function plantNextWaterDue(plant) {
  return plant.lastWatered ? addDaysToDateKey(plant.lastWatered, plant.wateringIntervalDays) : todayKey();
}

/* =========================================================
   Haustiere – Tierarzt-Erinnerung (spiegelt in den Hub-Kalender, da
   seltenes/wichtiges Ereignis, anders als taegliches Fuettern).
   Fuetterungsplan bewusst nicht granular nachverfolgt (taegliche
   Routine, kein sinnvoller App-Mehrwert fuer v1).
   ========================================================= */
// Pet: { id, name, species, vetIntervalMonths (optional), lastVet (YYYY-MM-DD|null), note, createdAt }

export function getPets() {
  return read(KEYS.pets, []);
}

export function getPetById(id) {
  return getPets().find((p) => p.id === id) || null;
}

export function savePet(pet) {
  const list = getPets();
  const idx = list.findIndex((p) => p.id === pet.id);
  if (idx >= 0) list[idx] = pet; else list.push(pet);
  write(KEYS.pets, list);
  refreshSharedCalendarMirror();
  return pet;
}

export function createPet(fields) {
  return savePet({
    id: uid(), name: fields.name, species: fields.species || '',
    vetIntervalMonths: fields.vetIntervalMonths || null,
    lastVet: fields.lastVet || null, note: fields.note || '', createdAt: nowIso(),
  });
}

export function deletePet(id) {
  write(KEYS.pets, getPets().filter((p) => p.id !== id));
  refreshSharedCalendarMirror();
}

export function markPetVetDone(id) {
  const p = getPetById(id);
  if (p) savePet({ ...p, lastVet: todayKey() });
}

/** null, wenn kein Intervall gepflegt ist (kein Termin faellig). */
export function petNextVetDue(pet) {
  if (!pet.vetIntervalMonths) return null;
  return pet.lastVet ? addMonthsToDateKey(pet.lastVet, pet.vetIntervalMonths) : todayKey();
}

/* =========================================================
   Faellig-Uebersicht – vereinheitlicht Wartung/Vertragsfristen/
   Giessen/Tierarzt fuer die Startseite.
   ========================================================= */

export function getDueItems() {
  const items = [];
  for (const t of getMaintenanceTasks()) {
    items.push({ kind: 'maintenance', id: t.id, title: t.title, dueDate: maintenanceNextDue(t), meta: 'Wartung' });
  }
  for (const c of getContracts()) {
    items.push({ kind: 'contract', id: c.id, title: `Kündigungsfrist ${c.provider}`, dueDate: contractReminderDate(c), meta: 'Vertrag' });
  }
  for (const p of getPlants()) {
    items.push({ kind: 'plant', id: p.id, title: `${p.name} gießen`, dueDate: plantNextWaterDue(p), meta: 'Pflanze' });
  }
  for (const p of getPets()) {
    const due = petNextVetDue(p);
    if (due) items.push({ kind: 'pet', id: p.id, title: `${p.name}: Tierarzt`, dueDate: due, meta: 'Haustier' });
  }
  return items.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/**
 * Spiegelt Wartungsaufgaben, Vertrags-Kuendigungsfristen und Tierarzt-
 * Termine in den geteilten Kalender-Event-Store (fuenftes Beispiel dieses
 * Musters). Giessen bewusst ausgenommen (siehe Kommentar oben).
 */
export async function refreshSharedCalendarMirror() {
  try {
    const events = [];
    for (const t of getMaintenanceTasks()) {
      events.push(createCalendarEvent({ id: `household-maint-${t.id}`, title: t.title, start: maintenanceNextDue(t), source: 'household' }));
    }
    for (const c of getContracts()) {
      events.push(createCalendarEvent({ id: `household-contract-${c.id}`, title: `Kündigungsfrist ${c.provider}`, start: contractReminderDate(c), source: 'household' }));
    }
    for (const p of getPets()) {
      const due = petNextVetDue(p);
      if (due) events.push(createCalendarEvent({ id: `household-pet-${p.id}`, title: `${p.name}: Tierarzt`, start: due, source: 'household' }));
    }
    await replaceSourceEvents('household', events);
  } catch {
    // Shared Storage ist ein optionales Extra, kein Kernfeature.
  }
}

/* =========================================================
   Rechnungsablage – nutzt dieselbe Beleg-OCR-Pipeline wie die
   Budget-App (shared/receipt-ocr.js), nur andere Ablage-Kategorie
   statt Ausgaben-Tracking.
   ========================================================= */
// Invoice: { id, date, amount, merchant, category, note, createdAt }

export const INVOICE_CATEGORIES = ['Wartung', 'Vertrag', 'Reparatur', 'Sonstiges'];

export function getInvoices() {
  return read(KEYS.invoices, []);
}

export function saveInvoice(invoice) {
  const list = getInvoices();
  const idx = list.findIndex((i) => i.id === invoice.id);
  if (idx >= 0) list[idx] = invoice; else list.push(invoice);
  write(KEYS.invoices, list);
  return invoice;
}

export function createInvoice(fields) {
  return saveInvoice({
    id: uid(), date: fields.date, amount: fields.amount || null, merchant: fields.merchant || '',
    category: fields.category || 'Sonstiges', note: fields.note || '', createdAt: nowIso(),
  });
}

export function deleteInvoice(id) {
  write(KEYS.invoices, getInvoices().filter((i) => i.id !== id));
}

/* =========================================================
   Einstellungen
   ========================================================= */

const DEFAULT_SETTINGS = { theme: 'dark', accentHue: 130, lastBackupAt: '' };

export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...read(KEYS.settings, {}) };
}

export function saveSettings(patch) {
  const merged = { ...getSettings(), ...patch };
  write(KEYS.settings, merged);
  return merged;
}

/* =========================================================
   Export / Import / Reset
   ========================================================= */

export function exportAllData() {
  return {
    exportedAt: nowIso(),
    maintenance: getMaintenanceTasks(),
    contracts: getContracts(),
    plants: getPlants(),
    pets: getPets(),
    invoices: getInvoices(),
    settings: getSettings(),
  };
}

export function importAllData(data) {
  if (data.maintenance) write(KEYS.maintenance, data.maintenance);
  if (data.contracts) write(KEYS.contracts, data.contracts);
  if (data.plants) write(KEYS.plants, data.plants);
  if (data.pets) write(KEYS.pets, data.pets);
  if (data.invoices) write(KEYS.invoices, data.invoices);
  if (data.settings) write(KEYS.settings, data.settings);
  refreshSharedCalendarMirror();
  refreshSharedSubscriptions();
}

export function resetAllData() {
  localStorage.removeItem(KEYS.maintenance);
  localStorage.removeItem(KEYS.contracts);
  localStorage.removeItem(KEYS.plants);
  localStorage.removeItem(KEYS.pets);
  localStorage.removeItem(KEYS.invoices);
  localStorage.removeItem(KEYS.settings);
  refreshSharedCalendarMirror();
  refreshSharedSubscriptions();
}
