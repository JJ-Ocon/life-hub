// Persistenz-Schicht: alles in localStorage, bleibt lokal auf dem Geraet.

import { uid, nowIso } from './utils.js';
import { getSharedBodyProportions } from '../../shared/body-data.js';

const KEYS = {
  items: 'kl_items_v1',
  settings: 'kl_settings_v1',
  styleRules: 'kl_style_rules_v1',
  palette: 'kl_palette_v1',
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
// WardrobeItem: { id, name, category, color, colorHex (#rrggbb|null), size, note, photo (dataURL|null), createdAt, updatedAt }

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
    color: fields.color || '', colorHex: fields.colorHex || null, size: fields.size || '', note: fields.note || '',
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
   Outfit-Shuffling – zufaellige, aber strukturell sinnvolle Kombination
   aus vorhandenen Kleidungsstuecken. Kann freie Text-Style-Regeln nicht
   auswerten (kein NLP), zeigt sie stattdessen zum gewuerfelten Outfit an,
   damit selbst geprueft werden kann, ob die Kombination dazu passt.
   ========================================================= */

function randomFrom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/** Wuerfelt ein Outfit: entweder Kleid/Rock-basiert oder Oberteil+Hose-
 *  basiert (je nachdem was vorhanden ist, bei beidem verfuegbar zufaellig),
 *  plus optional Jacke/Schuhe/Accessoires falls vorhanden. Gibt null zurueck,
 *  wenn nicht mal eine Basis (Kleid ODER Oberteil+Hose) moeglich ist. */
export function shuffleOutfit() {
  const items = read(KEYS.items, []);
  const byCategory = (key) => items.filter((i) => i.category === key);

  const dresses = byCategory('kleider');
  const tops = byCategory('oberteile');
  const bottoms = byCategory('hosen');
  const canDress = dresses.length > 0;
  const canTopBottom = tops.length > 0 && bottoms.length > 0;
  if (!canDress && !canTopBottom) return null;

  const useDress = canDress && (!canTopBottom || Math.random() < 0.5);
  const outfit = [];
  if (useDress) {
    outfit.push(randomFrom(dresses));
  } else {
    outfit.push(randomFrom(tops), randomFrom(bottoms));
  }
  for (const key of ['jacken', 'schuhe', 'accessoires']) {
    const pool = byCategory(key);
    if (pool.length) outfit.push(randomFrom(pool));
  }
  return outfit;
}

/* =========================================================
   Style-Regeln – frei formulierte, selbst notierte Richtlinien
   ("Nie mehr als zwei Muster kombinieren", ...). Werden dem
   Outfit-Shuffler nur als Erinnerung angezeigt, nicht ausgewertet.
   ========================================================= */
// StyleRule: { id, text, createdAt }

export function getStyleRules() {
  return read(KEYS.styleRules, []).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function createStyleRule(text) {
  const list = read(KEYS.styleRules, []);
  list.push({ id: uid(), text, createdAt: nowIso() });
  write(KEYS.styleRules, list);
}

export function deleteStyleRule(id) {
  write(KEYS.styleRules, read(KEYS.styleRules, []).filter((r) => r.id !== id));
}

/* =========================================================
   Gespeicherte Palette – Farben, die ueber das Farbrad ausgewaehlt und
   gemerkt wurden (fuer spaetere Wiederverwendung, z.B. beim Anlegen
   von Kleidungsstuecken).
   ========================================================= */
const MAX_PALETTE = 16;

export function getPalette() {
  return read(KEYS.palette, []);
}

export function addToPalette(hex) {
  const list = read(KEYS.palette, []);
  if (list.includes(hex)) return list;
  const updated = [...list, hex].slice(-MAX_PALETTE);
  write(KEYS.palette, updated);
  return updated;
}

export function removeFromPalette(hex) {
  write(KEYS.palette, read(KEYS.palette, []).filter((h) => h !== hex));
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
    styleRules: read(KEYS.styleRules, []),
    palette: read(KEYS.palette, []),
  };
}

export function importAllData(data) {
  if (data.items) write(KEYS.items, data.items);
  if (data.settings) write(KEYS.settings, data.settings);
  if (data.styleRules) write(KEYS.styleRules, data.styleRules);
  if (data.palette) write(KEYS.palette, data.palette);
}

export function resetAllData() {
  localStorage.removeItem(KEYS.items);
  localStorage.removeItem(KEYS.settings);
  localStorage.removeItem(KEYS.styleRules);
  localStorage.removeItem(KEYS.palette);
}
