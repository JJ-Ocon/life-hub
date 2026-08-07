// Persistenz-Schicht: alles in localStorage, bleibt lokal auf dem Geraet.

import { uid, nowIso, todayKey, daysBetweenDateKeys } from './utils.js';
import { createCalendarEvent } from '../../shared/calendar-schema.js';
import { replaceSourceEvents } from '../../shared/event-store.js';

const KEYS = {
  trips: 'tr_trips_v1',
  packing: 'tr_packing_v1',
  itinerary: 'tr_itinerary_v1',
  expenses: 'tr_expenses_v1',
  documents: 'tr_documents_v1',
  photos: 'tr_photos_v1',
  settings: 'tr_settings_v1',
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

export const EXPENSE_CATEGORIES = ['Unterkunft', 'Transport', 'Verpflegung', 'Aktivitäten', 'Sonstiges'];

export const COMMON_PACKING_ITEMS = [
  'Reisepass/Ausweis', 'Ladekabel', 'Zahnbürste', 'Kopfhörer', 'Sonnencreme',
  'Medikamente', 'Powerbank', 'Adapter/Steckdose', 'Unterwäsche', 'Wetterjacke',
];

export const TRIP_TYPES = [
  { key: 'strand', label: 'Strand' },
  { key: 'city', label: 'Städtetrip' },
  { key: 'wandern', label: 'Wandern' },
  { key: 'business', label: 'Geschäftsreise' },
  { key: 'sonstiges', label: 'Sonstiges' },
];

export function tripTypeLabel(type) {
  return TRIP_TYPES.find((t) => t.key === type)?.label || 'Sonstiges';
}

/** Zusaetzliche Packlisten-Punkte je Reisetyp, on top von COMMON_PACKING_ITEMS -
 *  gleiches "eingebaute Vorschlagsliste" Muster wie Household's
 *  PLANT_INTERVAL_SUGGESTIONS, hier nur als vollstaendige Item-Liste statt
 *  einer Zahl. */
export const PACKING_TEMPLATES = {
  strand: ['Badebekleidung', 'Sonnenbrille', 'Strandtuch', 'Flip-Flops', 'Aftersun'],
  city: ['Bequeme Schuhe', 'Offline-Stadtplan', 'Kamera', 'Kleiner Tagesrucksack'],
  wandern: ['Wanderschuhe', 'Wanderrucksack', 'Regenjacke', 'Erste-Hilfe-Set', 'Trinkflasche'],
  business: ['Laptop', 'Laptop-Ladegerät', 'Business-Kleidung', 'Visitenkarten'],
  sonstiges: [],
};

/* =========================================================
   Reisen – Grunddaten (Ziel, Zeitraum, Budget).
   ========================================================= */
// Trip: { id, name, destination, type, startDate, endDate, budgetTotal (optional), note, createdAt }

export function getTrips() {
  return read(KEYS.trips, []).sort((a, b) => a.startDate.localeCompare(b.startDate));
}

export function getTripById(id) {
  return read(KEYS.trips, []).find((t) => t.id === id) || null;
}

export function saveTrip(trip) {
  const list = read(KEYS.trips, []);
  const idx = list.findIndex((t) => t.id === trip.id);
  if (idx >= 0) list[idx] = trip; else list.push(trip);
  write(KEYS.trips, list);
  refreshSharedCalendarMirror();
  return trip;
}

export function createTrip(fields) {
  return saveTrip({
    id: uid(), name: fields.name, destination: fields.destination || '',
    type: fields.type || 'sonstiges',
    startDate: fields.startDate, endDate: fields.endDate,
    budgetTotal: fields.budgetTotal ?? null, note: fields.note || '', createdAt: nowIso(),
  });
}

export function deleteTrip(id) {
  write(KEYS.trips, read(KEYS.trips, []).filter((t) => t.id !== id));
  write(KEYS.packing, read(KEYS.packing, []).filter((p) => p.tripId !== id));
  write(KEYS.itinerary, read(KEYS.itinerary, []).filter((i) => i.tripId !== id));
  write(KEYS.expenses, read(KEYS.expenses, []).filter((e) => e.tripId !== id));
  write(KEYS.documents, read(KEYS.documents, []).filter((d) => d.tripId !== id));
  write(KEYS.photos, read(KEYS.photos, []).filter((p) => p.tripId !== id));
  refreshSharedCalendarMirror();
}

export function tripDaysUntilStart(trip) {
  return daysBetweenDateKeys(todayKey(), trip.startDate);
}

/* =========================================================
   Packliste – einfache Checkliste pro Reise.
   ========================================================= */
// PackingItem: { id, tripId, text, packed, createdAt }

export function getPackingItems(tripId) {
  return read(KEYS.packing, []).filter((p) => p.tripId === tripId);
}

export function addPackingItem(tripId, text) {
  const list = read(KEYS.packing, []);
  list.push({ id: uid(), tripId, text, packed: false, createdAt: nowIso() });
  write(KEYS.packing, list);
}

/** Fuegt die generische Standardliste plus die typspezifischen Zusatzpunkte
 *  hinzu (z.B. Badebekleidung bei 'strand'), dedupliziert gegen bereits
 *  vorhandene Eintraege. */
export function addPackingTemplate(tripId, type) {
  const existing = new Set(getPackingItems(tripId).map((p) => p.text.toLowerCase()));
  const list = read(KEYS.packing, []);
  const items = [...COMMON_PACKING_ITEMS, ...(PACKING_TEMPLATES[type] || [])];
  for (const text of items) {
    if (!existing.has(text.toLowerCase())) { list.push({ id: uid(), tripId, text, packed: false, createdAt: nowIso() }); existing.add(text.toLowerCase()); }
  }
  write(KEYS.packing, list);
}

export function togglePackingItem(id) {
  const list = read(KEYS.packing, []);
  const item = list.find((p) => p.id === id);
  if (item) item.packed = !item.packed;
  write(KEYS.packing, list);
}

export function deletePackingItem(id) {
  write(KEYS.packing, read(KEYS.packing, []).filter((p) => p.id !== id));
}

/* =========================================================
   Reiseplan – Termine/Aktivitaeten mit Datum, spiegeln sich in
   den Hub-Kalender (echte Einzeltermine, anders als z.B. taegliche
   Gewohnheiten).
   ========================================================= */
// ItineraryEntry: { id, tripId, date, time (optional HH:MM), title, note, createdAt }

export function getItineraryEntries(tripId) {
  return read(KEYS.itinerary, [])
    .filter((i) => i.tripId === tripId)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''));
}

export function saveItineraryEntry(entry) {
  const list = read(KEYS.itinerary, []);
  const idx = list.findIndex((i) => i.id === entry.id);
  if (idx >= 0) list[idx] = entry; else list.push(entry);
  write(KEYS.itinerary, list);
  refreshSharedCalendarMirror();
}

export function createItineraryEntry(fields) {
  saveItineraryEntry({
    id: uid(), tripId: fields.tripId, date: fields.date, time: fields.time || null,
    title: fields.title, note: fields.note || '', createdAt: nowIso(),
  });
}

export function deleteItineraryEntry(id) {
  write(KEYS.itinerary, read(KEYS.itinerary, []).filter((i) => i.id !== id));
  refreshSharedCalendarMirror();
}

/* =========================================================
   Ausgaben – Budget-Abgleich pro Reise.
   ========================================================= */
// TripExpense: { id, tripId, date, amount, category, note, createdAt }

export function getExpenses(tripId) {
  return read(KEYS.expenses, [])
    .filter((e) => e.tripId === tripId)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function createExpense(fields) {
  const list = read(KEYS.expenses, []);
  list.push({
    id: uid(), tripId: fields.tripId, date: fields.date || todayKey(),
    amount: fields.amount || 0, category: fields.category || 'Sonstiges',
    note: fields.note || '', createdAt: nowIso(),
  });
  write(KEYS.expenses, list);
}

export function deleteExpense(id) {
  write(KEYS.expenses, read(KEYS.expenses, []).filter((e) => e.id !== id));
}

export function tripSpent(tripId) {
  return getExpenses(tripId).reduce((sum, e) => sum + e.amount, 0);
}

/* =========================================================
   Dokumente – Tickets, Buchungsbestaetigungen etc. pro Reise.
   Bewusst plaintext wie der Rest der App (keine sensiblen Ausweisdaten -
   dafuer gibt es den Deep-Link zum verschluesselten Digitalen Safe in der
   UI, siehe trip-detail.js).
   ========================================================= */
// TripDocument: { id, tripId, title, fileData (dataURL), fileType ('image'|'pdf'), createdAt }

export function getDocuments(tripId) {
  return read(KEYS.documents, []).filter((d) => d.tripId === tripId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function createDocument(tripId, title, fileData, fileType) {
  const list = read(KEYS.documents, []);
  list.push({ id: uid(), tripId, title, fileData, fileType, createdAt: nowIso() });
  write(KEYS.documents, list);
}

export function deleteDocument(id) {
  write(KEYS.documents, read(KEYS.documents, []).filter((d) => d.id !== id));
}

/* =========================================================
   Fotos – eigener Fotobereich pro Reise.
   ========================================================= */
// TripPhoto: { id, tripId, photoData (dataURL, komprimiert), caption, createdAt }

export function getPhotos(tripId) {
  return read(KEYS.photos, []).filter((p) => p.tripId === tripId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function createPhoto(tripId, photoData, caption) {
  const list = read(KEYS.photos, []);
  list.push({ id: uid(), tripId, photoData, caption: caption || '', createdAt: nowIso() });
  write(KEYS.photos, list);
}

export function deletePhoto(id) {
  write(KEYS.photos, read(KEYS.photos, []).filter((p) => p.id !== id));
}

/* =========================================================
   Kalender-Spiegelung – Reise-Start/-Ende + Reiseplan-Eintraege.
   ========================================================= */

export async function refreshSharedCalendarMirror() {
  try {
    const events = [];
    for (const t of read(KEYS.trips, [])) {
      events.push(createCalendarEvent({ id: `travel-start-${t.id}`, title: `Reise: ${t.name} beginnt`, start: t.startDate, source: 'travel' }));
      events.push(createCalendarEvent({ id: `travel-end-${t.id}`, title: `Reise: ${t.name} endet`, start: t.endDate, source: 'travel' }));
    }
    for (const i of read(KEYS.itinerary, [])) {
      events.push(createCalendarEvent({ id: `travel-itin-${i.id}`, title: i.title, start: i.date, source: 'travel' }));
    }
    await replaceSourceEvents('travel', events);
  } catch {
    // Shared Storage ist ein optionales Extra, kein Kernfeature.
  }
}

/* ---------- Einstellungen ---------- */
const DEFAULT_SETTINGS = { theme: 'dark', accentHue: 190 };

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
    trips: read(KEYS.trips, []),
    packing: read(KEYS.packing, []),
    itinerary: read(KEYS.itinerary, []),
    expenses: read(KEYS.expenses, []),
    documents: read(KEYS.documents, []),
    photos: read(KEYS.photos, []),
    settings: getSettings(),
  };
}

export function importAllData(data) {
  if (data.trips) write(KEYS.trips, data.trips);
  if (data.packing) write(KEYS.packing, data.packing);
  if (data.itinerary) write(KEYS.itinerary, data.itinerary);
  if (data.expenses) write(KEYS.expenses, data.expenses);
  if (data.documents) write(KEYS.documents, data.documents);
  if (data.photos) write(KEYS.photos, data.photos);
  if (data.settings) write(KEYS.settings, data.settings);
  refreshSharedCalendarMirror();
}

export function resetAllData() {
  localStorage.removeItem(KEYS.trips);
  localStorage.removeItem(KEYS.packing);
  localStorage.removeItem(KEYS.itinerary);
  localStorage.removeItem(KEYS.expenses);
  localStorage.removeItem(KEYS.documents);
  localStorage.removeItem(KEYS.photos);
  localStorage.removeItem(KEYS.settings);
  refreshSharedCalendarMirror();
}
