// Persistenz-Schicht: alles in localStorage, bleibt lokal auf dem Geraet.

import { uid, nowIso, todayKey, addDaysToDateKey, addMonthsToDateKey, daysBetweenDateKeys } from './utils.js';
import { createCalendarEvent } from '../../shared/calendar-schema.js';
import { replaceSourceEvents } from '../../shared/event-store.js';

const KEYS = {
  items: 'ps_items_v1',
  settings: 'ps_settings_v1',
};

const ATTACHMENT_CACHE = 'possessions-attachments-v1';

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
  { key: 'buecher', label: 'Bücher & Medien' },
  { key: 'kueche', label: 'Küche & Haushalt' },
  { key: 'garten', label: 'Garten & Outdoor' },
  { key: 'musik', label: 'Musikinstrumente' },
  { key: 'foto', label: 'Foto & Video' },
  { key: 'spiele', label: 'Spielzeug & Spiele' },
  { key: 'deko', label: 'Kunst & Deko' },
  { key: 'sonstiges', label: 'Sonstiges' },
];

export function categoryLabel(key) {
  return CATEGORIES.find((c) => c.key === key)?.label || 'Sonstiges';
}

/** Frei vergebene Unterkategorien je Hauptkategorie (z.B. Bücher →
 *  Fantasy/Kochbuch/Sachbuch) - bewusst kein eigenes verwaltetes Vokabular,
 *  sondern einfach die bereits bei anderen Gegenstaenden derselben
 *  Kategorie genutzten Werte, damit sich das Vokabular organisch aus der
 *  tatsaechlichen Nutzung ergibt statt vorab gepflegt werden zu muessen. */
export function getSubcategoriesForCategory(category) {
  const set = new Set();
  for (const i of read(KEYS.items, [])) {
    if (i.category === category && i.subcategory) set.add(i.subcategory);
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'de'));
}

/** Grobe Standard-Nutzungsdauern je Kategorie (Monate) - kein externer
 *  Datensatz, nur eine kleine eingebaute Faustregel-Tabelle als Vorschlag,
 *  gleiches Muster wie Household's PLANT_INTERVAL_SUGGESTIONS. */
export const LIFESPAN_SUGGESTIONS = {
  elektronik: 48, moebel: 120, werkzeug: 96, wertsachen: 0, sport: 60,
  buecher: 0, kueche: 84, garten: 96, musik: 180, foto: 60, spiele: 48, deko: 0,
  sonstiges: 60,
};

export function suggestLifespanMonths(category) {
  return LIFESPAN_SUGGESTIONS[category] || null;
}

/* =========================================================
   Gegenstaende – Inventar mit Seriennummer, Kaufdaten, Garantie
   und optionalem Foto. Garantie-Ablauf spiegelt sich (unkritisch,
   keine sensiblen Daten) in den Hub-Kalender - anders als der
   Digitale Safe braucht dieses Inventar keine Verschluesselung.
   ========================================================= */
// Item: { id, name, category, subcategory, serialNumber, purchaseDate (YYYY-MM-DD|null),
//         purchasePrice, currentValue, lifespanMonths (fuer Abschreibung/Ruecklage, optional),
//         retailer, warrantyExpiryDate (YYYY-MM-DD|null),
//         warrantyReminderLeadDays, note, photo (dataURL|null),
//         attachments: [{id, name, type, sizeBytes, addedAt}], createdAt, updatedAt }
// Anhaenge (Belege, Garantie-PDFs, ...) liegen als Blobs in der Cache Storage,
// nicht als dataURL in localStorage - PDFs koennen mehrere MB gross sein und
// wuerden das ~5-10MB-localStorage-Kontingent schnell sprengen. Gleiches
// Muster wie Musiks Downloads (music/js/db.js).

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
    subcategory: fields.subcategory || '',
    serialNumber: fields.serialNumber || '', purchaseDate: fields.purchaseDate || null,
    purchasePrice: fields.purchasePrice ?? null, currentValue: fields.currentValue ?? null,
    lifespanMonths: fields.lifespanMonths ?? null,
    retailer: fields.retailer || '', warrantyExpiryDate: fields.warrantyExpiryDate || null,
    warrantyReminderLeadDays: fields.warrantyReminderLeadDays ?? 30,
    spareParts: fields.spareParts || [],
    note: fields.note || '', photo: fields.photo || null, attachments: [], createdAt: nowIso(),
  });
}

/* =========================================================
   Ersatzteile (E-Inventar-Ersatzteile) - einzelne Bestandteile eines
   Gegenstands koennen eine EIGENE, kuerzere Nutzungsdauer haben als das
   Gesamtstueck (z.B. Bügelbrett: Bezug alle 3-5 Jahre, Gestell 10-20 Jahre) -
   das pauschale item.lifespanMonths bildet nur EINE Zahl fuer den ganzen
   Gegenstand ab und passt fuer sowas nicht. Rein am Gegenstand gefuehrt,
   kein eigener Store.
   ========================================================= */
// SparePart: { id, name, lifespanMonths, lastReplacedDate (YYYY-MM-DD|null - faellt auf
//              item.purchaseDate zurueck, wenn nie gepflegt) }

export function addSparePart(itemId, fields) {
  const item = getItemById(itemId);
  if (!item) return null;
  const part = { id: uid(), name: fields.name, lifespanMonths: Number(fields.lifespanMonths) || null, lastReplacedDate: fields.lastReplacedDate || null };
  saveItem({ ...item, spareParts: [...(item.spareParts || []), part] });
  return part;
}

export function updateSparePart(itemId, partId, patch) {
  const item = getItemById(itemId);
  if (!item) return;
  const spareParts = (item.spareParts || []).map((p) => (p.id === partId ? { ...p, ...patch } : p));
  saveItem({ ...item, spareParts });
}

export function removeSparePart(itemId, partId) {
  const item = getItemById(itemId);
  if (!item) return;
  saveItem({ ...item, spareParts: (item.spareParts || []).filter((p) => p.id !== partId) });
}

export function markSparePartReplaced(itemId, partId) {
  updateSparePart(itemId, partId, { lastReplacedDate: todayKey() });
}

/** Naechstes Faelligkeitsdatum eines Ersatzteils, oder null wenn keine
 *  Nutzungsdauer gepflegt ist. Faellt auf das Kaufdatum des Gegenstands
 *  zurueck, solange das Teil noch nie ersetzt wurde. */
export function sparePartNextDue(item, part) {
  if (!part.lifespanMonths) return null;
  const base = part.lastReplacedDate || item.purchaseDate;
  if (!base) return null;
  return addMonthsToDateKey(base, part.lifespanMonths);
}

/** Linear abgeschriebener Schaetzwert (Kaufpreis * (1 - vergangene Monate /
 *  Nutzungsdauer), nie unter 0) - nur berechenbar wenn Kaufdatum, Kaufpreis
 *  und Nutzungsdauer gepflegt sind. Rein informativ, ueberschreibt nie den
 *  manuell gepflegten `currentValue`. */
export function estimatedCurrentValue(item) {
  if (!item.purchaseDate || item.purchasePrice == null || !item.lifespanMonths) return null;
  const monthsElapsed = daysBetweenDateKeys(item.purchaseDate, todayKey()) / 30.44;
  const fraction = Math.max(0, 1 - monthsElapsed / item.lifespanMonths);
  return Math.round(item.purchasePrice * fraction * 100) / 100;
}

/** Empfohlene monatliche Ersatz-Ruecklage: geschaetzter Restwert geteilt
 *  durch die verbleibende Nutzungsdauer - "was muesste ich monatlich
 *  zurueckelegen, um am Ende der Nutzungsdauer einen Ersatz finanzieren zu
 *  koennen". null wenn kein Schaetzwert berechenbar ist. */
export function suggestedMonthlyReserve(item) {
  const value = estimatedCurrentValue(item);
  if (value === null) return null;
  const monthsElapsed = daysBetweenDateKeys(item.purchaseDate, todayKey()) / 30.44;
  const remaining = Math.max(1, item.lifespanMonths - monthsElapsed);
  return Math.round((value / remaining) * 100) / 100;
}

export function totalSuggestedMonthlyReserve() {
  return read(KEYS.items, []).reduce((sum, i) => sum + (suggestedMonthlyReserve(i) || 0), 0);
}

export async function deleteItem(id) {
  const item = getItemById(id);
  if (item) {
    for (const att of item.attachments || []) await deleteAttachmentBlob(id, att.id);
  }
  write(KEYS.items, read(KEYS.items, []).filter((i) => i.id !== id));
  refreshSharedCalendarMirror();
}

/* ---------- Anhaenge (Belege/Dokumente, insbesondere PDF) ---------- */

function attachmentCacheKey(itemId, attachmentId) {
  return `./__att__/${itemId}/${attachmentId}`;
}

async function deleteAttachmentBlob(itemId, attachmentId) {
  try {
    const cache = await caches.open(ATTACHMENT_CACHE);
    await cache.delete(attachmentCacheKey(itemId, attachmentId));
  } catch {
    // Cache Storage kann in unsicheren Kontexten fehlen - dann bleibt nur die Metadaten-Liste.
  }
}

export async function addAttachment(itemId, file) {
  const item = getItemById(itemId);
  if (!item) return null;
  const attachment = { id: uid(), name: file.name, type: file.type || 'application/octet-stream', sizeBytes: file.size, addedAt: nowIso() };
  const cache = await caches.open(ATTACHMENT_CACHE);
  await cache.put(attachmentCacheKey(itemId, attachment.id), new Response(file, { headers: { 'Content-Type': attachment.type } }));
  saveItem({ ...item, attachments: [...(item.attachments || []), attachment] });
  return attachment;
}

export async function removeAttachment(itemId, attachmentId) {
  const item = getItemById(itemId);
  if (!item) return;
  await deleteAttachmentBlob(itemId, attachmentId);
  saveItem({ ...item, attachments: (item.attachments || []).filter((a) => a.id !== attachmentId) });
}

/** Objekt-URL zum Anzeigen/Herunterladen eines Anhangs - vom Aufrufer nach
 *  Gebrauch per URL.revokeObjectURL freizugeben. null, wenn nicht (mehr) im Cache. */
export async function getAttachmentUrl(itemId, attachmentId) {
  try {
    const cache = await caches.open(ATTACHMENT_CACHE);
    const res = await cache.match(attachmentCacheKey(itemId, attachmentId));
    if (!res) return null;
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

export function attachmentsSupported() {
  return typeof caches !== 'undefined' && window.isSecureContext;
}

export function warrantyReminderDate(item) {
  if (!item.warrantyExpiryDate) return null;
  return addDaysToDateKey(item.warrantyExpiryDate, -(item.warrantyReminderLeadDays ?? 30));
}

/** Summe aus aktuellem Wert (falls gepflegt), sonst linear geschaetzter Wert
 *  (falls berechenbar), sonst Kaufpreis - grobe Orientierung, z.B. fuer die
 *  Hausratversicherung. */
export function totalValue() {
  return read(KEYS.items, []).reduce((sum, i) => sum + (i.currentValue ?? estimatedCurrentValue(i) ?? i.purchasePrice ?? 0), 0);
}

/** Faellige Erinnerungen ueber alle Gegenstaende - Garantie-Ablauf UND
 *  faellige Ersatzteile (E-Inventar-Ersatzteile) in einer gemeinsamen,
 *  nach Datum sortierten Liste, damit ein Gegenstand mit z.B. sowohl
 *  ablaufender Garantie als auch einem faelligen Ersatzteil beides separat
 *  zeigt statt nur eins zu gewinnen.
 *  @returns {Array<{itemId, itemName, category, kind: 'warranty'|'sparepart', label, dueDate}>}
 */
export function getDueReminders() {
  const today = todayKey();
  const out = [];
  for (const item of read(KEYS.items, [])) {
    if (item.warrantyExpiryDate) {
      const reminder = warrantyReminderDate(item);
      if (reminder && reminder <= today) {
        out.push({ itemId: item.id, itemName: item.name, category: item.category, kind: 'warranty', label: 'Garantie läuft ab', dueDate: item.warrantyExpiryDate });
      }
    }
    for (const part of item.spareParts || []) {
      const due = sparePartNextDue(item, part);
      if (due && due <= today) {
        out.push({ itemId: item.id, itemName: item.name, category: item.category, kind: 'sparepart', label: `Ersatzteil fällig: ${part.name}`, dueDate: due, partId: part.id });
      }
    }
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export async function refreshSharedCalendarMirror() {
  try {
    const events = [];
    for (const i of read(KEYS.items, [])) {
      if (!i.warrantyExpiryDate) continue;
      events.push(createCalendarEvent({
        id: `possessions-${i.id}`, title: `Garantie läuft ab: ${i.name}`,
        start: i.warrantyExpiryDate, source: 'possessions', link: `#/items?open=${i.id}`,
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

export async function resetAllData() {
  localStorage.removeItem(KEYS.items);
  localStorage.removeItem(KEYS.settings);
  try { await caches.delete(ATTACHMENT_CACHE); } catch { /* siehe attachmentsSupported() */ }
  refreshSharedCalendarMirror();
}
