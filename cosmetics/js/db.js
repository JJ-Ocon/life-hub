// Persistenz-Schicht: alles in localStorage, bleibt lokal auf dem Geraet.

import { uid, nowIso, todayKey, addMonthsToDateKey } from './utils.js';
import { createCalendarEvent } from '../../shared/calendar-schema.js';
import { replaceSourceEvents } from '../../shared/event-store.js';

const KEYS = {
  products: 'cs_products_v1',
  settings: 'cs_settings_v1',
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
  { key: 'gesicht', label: 'Gesicht' },
  { key: 'haare', label: 'Haare' },
  { key: 'bart', label: 'Bart' },
  { key: 'rasur', label: 'Rasur' },
  { key: 'dusche', label: 'Duschen/Baden' },
  { key: 'makeup', label: 'Make-up' },
  { key: 'sonstiges', label: 'Sonstiges' },
];

export function categoryLabel(key) {
  return CATEGORIES.find((c) => c.key === key)?.label || 'Sonstiges';
}

/** Gaengige PAO-Werte (Period-After-Opening), wie auf Kosmetik-Verpackungen als "6M"/"12M" etc. angegeben. */
export const PAO_PRESETS = [3, 6, 9, 12, 18, 24, 36];

/* =========================================================
   Pflegeprodukte – Verfall entweder ueber ein festes Datum (MHD) oder
   ueber PAO (Period-After-Opening: X Monate ab Anbruchdatum). Keine
   sensiblen Daten, daher unproblematischer Kalender-Mirror wie bei
   Inventar/Haushalt.
   ========================================================= */
// Product: { id, name, brand, category, size, openedDate (YYYY-MM-DD|null),
//            expiryMode ('date'|'pao'), expiryDate (YYYY-MM-DD|null), paoMonths,
//            reminderLeadDays, note, photo (dataURL|null), createdAt, updatedAt }

export function getProducts() {
  return read(KEYS.products, []).sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

export function getProductById(id) {
  return read(KEYS.products, []).find((p) => p.id === id) || null;
}

export function saveProduct(product) {
  const list = read(KEYS.products, []);
  const idx = list.findIndex((p) => p.id === product.id);
  const updated = { ...product, updatedAt: nowIso() };
  if (idx >= 0) list[idx] = updated; else list.push(updated);
  write(KEYS.products, list);
  refreshSharedCalendarMirror();
  return updated;
}

export function createProduct(fields) {
  return saveProduct({
    id: uid(), name: fields.name, brand: fields.brand || '', category: fields.category || 'sonstiges',
    size: fields.size || '', openedDate: fields.openedDate || null,
    expiryMode: fields.expiryMode || 'pao', expiryDate: fields.expiryDate || null,
    paoMonths: fields.paoMonths ?? 12, reminderLeadDays: fields.reminderLeadDays ?? 30,
    note: fields.note || '', photo: fields.photo || null, createdAt: nowIso(),
  });
}

export function deleteProduct(id) {
  write(KEYS.products, read(KEYS.products, []).filter((p) => p.id !== id));
  refreshSharedCalendarMirror();
}

/** Berechnetes Verfallsdatum. Bei PAO-Modus ohne Anbruchdatum: noch kein Verfall bekannt (null). */
export function computeExpiry(product) {
  if (product.expiryMode === 'date') return product.expiryDate || null;
  if (!product.openedDate) return null;
  return addMonthsToDateKey(product.openedDate, product.paoMonths ?? 12);
}

export function markOpened(id) {
  const p = getProductById(id);
  if (p) saveProduct({ ...p, openedDate: todayKey() });
}

/** Faellige/bald faellige Produkte, sortiert nach Verfallsdatum. */
export function getDueItems() {
  const today = todayKey();
  return read(KEYS.products, [])
    .map((p) => ({ product: p, expiry: computeExpiry(p) }))
    .filter(({ expiry }) => expiry)
    .filter(({ product, expiry }) => expiry <= addLeadDays(today, product.reminderLeadDays ?? 30))
    .sort((a, b) => a.expiry.localeCompare(b.expiry));
}

function addLeadDays(dateKey, days) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export async function refreshSharedCalendarMirror() {
  try {
    const events = [];
    for (const p of read(KEYS.products, [])) {
      const expiry = computeExpiry(p);
      if (!expiry) continue;
      events.push(createCalendarEvent({ id: `cosmetics-${p.id}`, title: `Verfällt: ${p.name}`, start: expiry, source: 'cosmetics' }));
    }
    await replaceSourceEvents('cosmetics', events);
  } catch {
    // Shared Storage ist ein optionales Extra, kein Kernfeature.
  }
}

/* ---------- Einstellungen ---------- */
const DEFAULT_SETTINGS = { theme: 'dark', accentHue: 330 };

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
    products: read(KEYS.products, []),
    settings: getSettings(),
  };
}

export function importAllData(data) {
  if (data.products) write(KEYS.products, data.products);
  if (data.settings) write(KEYS.settings, data.settings);
  refreshSharedCalendarMirror();
}

export function resetAllData() {
  localStorage.removeItem(KEYS.products);
  localStorage.removeItem(KEYS.settings);
  refreshSharedCalendarMirror();
}
