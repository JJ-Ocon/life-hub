// Persistenz-Schicht: alles in localStorage, bleibt lokal auf dem Geraet.

import { uid, nowIso, todayKey, addMonthsToDateKey, daysBetweenDateKeys } from './utils.js';
import { createCalendarEvent } from '../../shared/calendar-schema.js';
import { replaceSourceEvents } from '../../shared/event-store.js';

const KEYS = {
  products: 'cs_products_v1',
  usageLogs: 'cs_usage_logs_v1',
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
  // 'bart' und 'rasur' waren zwei getrennte Kategorien, die sich in der
  // Praxis kaum unterscheiden liessen (Bugreport: "gegeneinander redundant")
  // - zu einer zusammengelegt, bestehende Produkte werden beim Laden
  // automatisch migriert (siehe migrateProductCategory unten).
  { key: 'bart-rasur', label: 'Bart & Rasur' },
  { key: 'zaehne', label: 'Zähne' },
  { key: 'dusche', label: 'Duschen/Baden' },
  { key: 'koerper', label: 'Körper' },
  { key: 'achseln', label: 'Achseln' },
  { key: 'haende', label: 'Hände' },
  { key: 'fuesse', label: 'Füße' },
  { key: 'makeup', label: 'Make-up' },
  { key: 'sonstiges', label: 'Sonstiges' },
];

export function categoryLabel(key) {
  return CATEGORIES.find((c) => c.key === key)?.label || 'Sonstiges';
}

const CATEGORY_MIGRATIONS = { bart: 'bart-rasur', rasur: 'bart-rasur' };

function migrateProductCategory(p) {
  const mapped = CATEGORY_MIGRATIONS[p.category];
  return mapped ? { ...p, category: mapped } : p;
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
//            reminderLeadDays, purchaseDate (YYYY-MM-DD|null), purchasePrice, retailer,
//            usedUpDate (YYYY-MM-DD|null), note, photo (dataURL|null), createdAt, updatedAt }

export function getProducts() {
  const list = read(KEYS.products, []);
  const migrated = list.map(migrateProductCategory);
  if (migrated.some((p, i) => p !== list[i])) write(KEYS.products, migrated);
  return migrated.sort((a, b) => a.name.localeCompare(b.name, 'de'));
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
    purchaseDate: fields.purchaseDate || null, purchasePrice: fields.purchasePrice ?? null,
    retailer: fields.retailer || '', usedUpDate: fields.usedUpDate || null,
    note: fields.note || '', photo: fields.photo || null, createdAt: nowIso(),
  });
}

export function deleteProduct(id) {
  write(KEYS.products, read(KEYS.products, []).filter((p) => p.id !== id));
  write(KEYS.usageLogs, read(KEYS.usageLogs, []).filter((u) => u.productId !== id));
  refreshSharedCalendarMirror();
}

export function markUsedUp(id) {
  const p = getProductById(id);
  if (p) saveProduct({ ...p, usedUpDate: todayKey() });
}

/** Tage von Anbruch (oder Kauf, falls nie als geoeffnet markiert) bis
 *  "aufgebraucht" - nur wenn beide Datumsangaben vorhanden sind. */
export function daysInUse(product) {
  const start = product.openedDate || product.purchaseDate;
  if (!start || !product.usedUpDate) return null;
  return daysBetweenDateKeys(start, product.usedUpDate);
}

/** Durchschnittliche Nutzungsdauer (Tage) gruppiert nach Produktname
 *  (Gross-/Kleinschreibung ignoriert) - "Nutzungszeitraum-Statistik",
 *  gleiches Konzept wie Budgets noch offene Vertiefung zu wiederkehrenden
 *  Produkten, hier bereits fuer Kosmetik umgesetzt. Nur Produkte mit
 *  bekannter Nutzungsdauer fliessen ein; Gruppen mit nur einem Sample
 *  werden trotzdem angezeigt (Durchschnitt = der eine Wert). */
export function usageStatsByName() {
  const groups = new Map();
  for (const p of read(KEYS.products, [])) {
    const days = daysInUse(p);
    if (days === null) continue;
    const key = p.name.trim().toLowerCase();
    if (!groups.has(key)) groups.set(key, { name: p.name, samples: [] });
    groups.get(key).samples.push(days);
  }
  return [...groups.values()]
    .map((g) => ({ name: g.name, avgDays: Math.round(g.samples.reduce((s, d) => s + d, 0) / g.samples.length), count: g.samples.length }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/* =========================================================
   Ausgaben-Statistik – rein aus purchasePrice/-date abgeleitet (seit E30
   erfasst, bisher aber nirgends aggregiert dargestellt). Kein eigenes
   Ledger, nur Auswertungen ueber die bestehenden Produktdaten.
   ========================================================= */

export function totalSpent() {
  return read(KEYS.products, []).reduce((sum, p) => sum + (p.purchasePrice || 0), 0);
}

export function spendingByCategory() {
  const sums = {};
  for (const p of read(KEYS.products, [])) {
    if (!p.purchasePrice) continue;
    sums[p.category] = (sums[p.category] || 0) + p.purchasePrice;
  }
  return Object.entries(sums)
    .map(([category, total]) => ({ category, label: categoryLabel(category), total }))
    .sort((a, b) => b.total - a.total);
}

export function spendingByYear() {
  const sums = {};
  for (const p of read(KEYS.products, [])) {
    if (!p.purchasePrice || !p.purchaseDate) continue;
    const year = p.purchaseDate.slice(0, 4);
    sums[year] = (sums[year] || 0) + p.purchasePrice;
  }
  return Object.entries(sums).map(([year, total]) => ({ year, total })).sort((a, b) => a.year.localeCompare(b.year));
}

export function productCounts() {
  const products = read(KEYS.products, []);
  return {
    total: products.length,
    active: products.filter((p) => !p.usedUpDate).length,
    usedUp: products.filter((p) => p.usedUpDate).length,
  };
}

/* =========================================================
   Restmengen-Log – manuell erfasste Prozent-Checkpoints pro Produkt,
   daraus ein linearer Verbrauchstrend ("noch ca. X Wochen").
   ========================================================= */
// UsageLog: { id, productId, date, remainingPercent (0-100), createdAt }

export function getUsageLogs(productId) {
  return read(KEYS.usageLogs, [])
    .filter((u) => u.productId === productId)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function logUsage(productId, remainingPercent, date = todayKey()) {
  const list = read(KEYS.usageLogs, []);
  list.push({ id: uid(), productId, date, remainingPercent: Math.max(0, Math.min(100, remainingPercent)), createdAt: nowIso() });
  write(KEYS.usageLogs, list);
}

export function latestRemainingPercent(productId) {
  const logs = getUsageLogs(productId);
  return logs.length ? logs[logs.length - 1].remainingPercent : null;
}

/** Lineare Extrapolation aus den ersten und letzten beiden Checkpoints:
 *  Prozentverlust pro Tag fortgeschrieben bis 0% - null wenn weniger als
 *  zwei Log-Eintraege vorliegen oder der Trend nicht fallend ist. */
export function estimateWeeksRemaining(productId) {
  const logs = getUsageLogs(productId);
  if (logs.length < 2) return null;
  const first = logs[0];
  const last = logs[logs.length - 1];
  const daysSpan = daysBetweenDateKeys(first.date, last.date);
  if (daysSpan <= 0) return null;
  const percentPerDay = (first.remainingPercent - last.remainingPercent) / daysSpan;
  if (percentPerDay <= 0) return null;
  const daysRemaining = last.remainingPercent / percentPerDay;
  return Math.round((daysRemaining / 7) * 10) / 10;
}

/** Produkte, die laut Restmengen-Trend bald leer sind (fuer die
 *  Einkaufsliste) - Vorlauf ueber Settings konfigurierbar. */
export function getLowStockItems() {
  const leadWeeks = getSettings().shoppingLeadWeeks ?? 2;
  return read(KEYS.products, [])
    .filter((p) => !p.usedUpDate)
    .map((p) => ({ product: p, weeksRemaining: estimateWeeksRemaining(p.id) }))
    .filter(({ weeksRemaining }) => weeksRemaining !== null && weeksRemaining <= leadWeeks)
    .sort((a, b) => a.weeksRemaining - b.weeksRemaining);
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
      events.push(createCalendarEvent({ id: `cosmetics-${p.id}`, title: `Verfällt: ${p.name}`, start: expiry, source: 'cosmetics', link: `#/products?open=${p.id}` }));
    }
    await replaceSourceEvents('cosmetics', events);
  } catch {
    // Shared Storage ist ein optionales Extra, kein Kernfeature.
  }
}

/* ---------- Einstellungen ---------- */
const DEFAULT_SETTINGS = { theme: 'dark', accentHue: 330, shoppingLeadWeeks: 2 };

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
    usageLogs: read(KEYS.usageLogs, []),
    settings: getSettings(),
  };
}

export function importAllData(data) {
  if (data.products) write(KEYS.products, data.products);
  if (data.usageLogs) write(KEYS.usageLogs, data.usageLogs);
  if (data.settings) write(KEYS.settings, data.settings);
  refreshSharedCalendarMirror();
}

export function resetAllData() {
  localStorage.removeItem(KEYS.products);
  localStorage.removeItem(KEYS.usageLogs);
  localStorage.removeItem(KEYS.settings);
  refreshSharedCalendarMirror();
}
