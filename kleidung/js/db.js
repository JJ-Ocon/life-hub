// Persistenz-Schicht: alles in localStorage, bleibt lokal auf dem Geraet.

import { uid, nowIso } from './utils.js';
import { getSharedBodyProportions } from '../../shared/body-data.js';

const KEYS = {
  items: 'kl_items_v1',
  settings: 'kl_settings_v1',
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
  { key: 'oberteile', label: 'Oberteile' },
  { key: 'hosen', label: 'Hosen' },
  { key: 'kleider', label: 'Kleider & Röcke' },
  { key: 'jacken', label: 'Jacken & Mäntel' },
  { key: 'schuhe', label: 'Schuhe' },
  { key: 'accessoires', label: 'Accessoires' },
  { key: 'unterwaesche', label: 'Unterwäsche' },
  { key: 'sonstiges', label: 'Sonstiges' },
];

export function categoryLabel(key) {
  return CATEGORIES.find((c) => c.key === key)?.label || 'Sonstiges';
}

/* =========================================================
   Kleiderschrank – Kleidungsstücke, die ich besitze.
   ========================================================= */
// WardrobeItem: { id, name, category, color, size, note, photo (dataURL|null), createdAt, updatedAt }

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
  return updated;
}

export function createItem(fields) {
  return saveItem({
    id: uid(), name: fields.name, category: fields.category || 'sonstiges',
    color: fields.color || '', size: fields.size || '', note: fields.note || '',
    photo: fields.photo || null, createdAt: nowIso(),
  });
}

export function deleteItem(id) {
  write(KEYS.items, read(KEYS.items, []).filter((i) => i.id !== id));
}

export function itemCounts() {
  const items = read(KEYS.items, []);
  const byCategory = {};
  for (const i of items) byCategory[i.category] = (byCategory[i.category] || 0) + 1;
  return { total: items.length, byCategory };
}

/* =========================================================
   Profil – Hautton/Unterton (fuer Farbberatung, siehe Style-Guide-Etappe)
   plus schreibgeschuetzte Koerperproportionen aus der Fitness-App.
   ========================================================= */

export const SKIN_TONES = [
  { key: 'hell', label: 'Hell' },
  { key: 'mittel-hell', label: 'Mittel-hell' },
  { key: 'mittel', label: 'Mittel' },
  { key: 'mittel-dunkel', label: 'Mittel-dunkel' },
  { key: 'dunkel', label: 'Dunkel' },
];

export const UNDERTONES = [
  { key: 'kuehl', label: 'Kühl' },
  { key: 'warm', label: 'Warm' },
  { key: 'neutral', label: 'Neutral' },
];

/** Koerperproportionen (Beinlaenge, Torsolaenge, Schulterbreite, Taillenbreite,
 *  alle in cm) - werden ausschliesslich in der Fitness-App erfasst und hier
 *  nur schreibgeschuetzt angezeigt (shared/body-data.js publish/read-Muster,
 *  wie Meal-Plannings Kalorienbedarf). Null, wenn Fitness noch keine Werte hat. */
export function getBodyProportions() {
  return getSharedBodyProportions();
}

/* ---------- Einstellungen ---------- */
const DEFAULT_SETTINGS = { theme: 'dark', accentHue: 265, skinTone: '', undertone: '' };

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
}

export function resetAllData() {
  localStorage.removeItem(KEYS.items);
  localStorage.removeItem(KEYS.settings);
}
