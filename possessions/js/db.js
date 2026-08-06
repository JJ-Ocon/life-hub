// Persistenz-Schicht: alles in localStorage, bleibt lokal auf dem Geraet.

import { uid, nowIso, todayKey, addDaysToDateKey } from './utils.js';
import { createCalendarEvent } from '../../shared/calendar-schema.js';
import { replaceSourceEvents } from '../../shared/event-store.js';

const KEYS = {
  items: 'ps_items_v1',
  settings: 'ps_settings_v1',
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

export const CATEGORIES = [
  { key: 'elektronik', label: 'Elektronik' },
  { key: 'moebel', label: 'Möbel' },
  { key: 'werkzeug', label: 'Werkzeug' },
  { key: 'wertsachen', label: 'Schmuck/Wertsachen' },
  { key: 'sport', label: 'Sport/Freizeit' },
  { key: 'sonstiges', label: 'Sonstiges' },
];

export function categoryLabel(key) {
  return CATEGORIES.find((c) => c.key === key)?.label || 'Sonstiges';
}

/* =========================================================
   Gegenstaende – Inventar mit Seriennummer, Kaufdaten, Garantie
   und optionalem Foto. Garantie-Ablauf spiegelt sich (unkritisch,
   keine sensiblen Daten) in den Hub-Kalender - anders als der
   Digitale Safe braucht dieses Inventar keine Verschluesselung.
   ========================================================= */
// Item: { id, name, category, serialNumber, purchaseDate (YYYY-MM-DD|null),
//         purchasePrice, currentValue, retailer, warrantyExpiryDate (YYYY-MM-DD|null),
//         warrantyReminderLeadDays, note, photo (dataURL|null), createdAt, updatedAt }

export function getItems() {
  return read(KEYS.items, []).sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

export function getItemById(id) {
  return read(KEYS.items, []).find((i) => i.id === id) || null;
}

export function saveItem(item) {
  const list = read(KEYS.items, []);
  const idx = list.findIndex((i) => i.id === item.id);
  const updated = { ...item, updatedAt: nowIso() };
  if (idx >= 0) list[idx] = updated; else list.push(updated);
  write(KEYS.items, list);
  refreshSharedCalendarMirror();
  return updated;
}

export function createItem(fields) {
  return saveItem({
    id: uid(), name: fields.name, category: fields.category || 'sonstiges',
    serialNumber: fields.serialNumber || '', purchaseDate: fields.purchaseDate || null,
    purchasePrice: fields.purchasePrice ?? null, currentValue: fields.currentValue ?? null,
    retailer: fields.retailer || '', warrantyExpiryDate: fields.warrantyExpiryDate || null,
    warrantyReminderLeadDays: fields.warrantyReminderLeadDays ?? 30,
    note: fields.note || '', photo: fields.photo || null, createdAt: nowIso(),
  });
}

export function deleteItem(id) {
  write(KEYS.items, read(KEYS.items, []).filter((i) => i.id !== id));
  refreshSharedCalendarMirror();
}

export function warrantyReminderDate(item) {
  if (!item.warrantyExpiryDate) return null;
  return addDaysToDateKey(item.warrantyExpiryDate, -(item.warrantyReminderLeadDays ?? 30));
}

/** Summe aus aktuellem Wert (falls gepflegt) sonst Kaufpreis - grobe Orientierung, z.B. fuer die Hausratversicherung. */
export function totalValue() {
  return read(KEYS.items, []).reduce((sum, i) => sum + (i.currentValue ?? i.purchasePrice ?? 0), 0);
}

/** Gegenstaende, deren Garantie-Erinnerungsfenster erreicht ist. */
export function getDueItems() {
  const today = todayKey();
  return read(KEYS.items, [])
    .filter((i) => i.warrantyExpiryDate)
    .filter((i) => {
      const reminder = warrantyReminderDate(i);
      return reminder && reminder <= today;
    })
    .sort((a, b) => a.warrantyExpiryDate.localeCompare(b.warrantyExpiryDate));
}

export async function refreshSharedCalendarMirror() {
  try {
    const events = [];
    for (const i of read(KEYS.items, [])) {
      if (!i.warrantyExpiryDate) continue;
      events.push(createCalendarEvent({
        id: `possessions-${i.id}`, title: `Garantie läuft ab: ${i.name}`,
        start: i.warrantyExpiryDate, source: 'possessions',
      }));
    }
    await replaceSourceEvents('possessions', events);
  } catch {
    // Shared Storage ist ein optionales Extra, kein Kernfeature.
  }
}

/* ---------- Einstellungen ---------- */
const DEFAULT_SETTINGS = { theme: 'dark', accentHue: 32 };

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
    items: read(KEYS.items, []),
    settings: getSettings(),
  };
}

export function importAllData(data) {
  if (data.items) write(KEYS.items, data.items);
  if (data.settings) write(KEYS.settings, data.settings);
  refreshSharedCalendarMirror();
}

export function resetAllData() {
  localStorage.removeItem(KEYS.items);
  localStorage.removeItem(KEYS.settings);
  refreshSharedCalendarMirror();
}
