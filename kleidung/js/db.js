// Persistenz-Schicht: alles in localStorage, bleibt lokal auf dem Geraet.

import { uid, nowIso } from './utils.js';
import { getSharedBodyProportions } from '../../shared/body-data.js';

const KEYS = {
  items: 'kl_items_v1',
  settings: 'kl_settings_v1',
  styleRules: 'kl_style_rules_v1',
  palette: 'kl_palette_v1',
  customCategories: 'kl_custom_categories_v1',
  wishlist: 'kl_wishlist_v1',
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

/** Frei anlegbare zusaetzliche Kategorien (E64), oben drauf auf die
 *  eingebauten - die eingebauten Keys ('oberteile', 'hosen', ...) bleiben
 *  bewusst fest, weil shuffleOutfit() sich strukturell auf sie verlaesst
 *  (Kleid- vs. Oberteil+Hose-Basis, Jacke/Schuhe/Accessoires als Ergaenzung).
 *  Neue Kategorien sind reine Zusatz-Schubladen fuer Dinge, die in kein
 *  eingebautes Fach passen, tragen aber selbst keine Shuffle-Logik. */
export function getCustomCategories() {
  return read(KEYS.customCategories, []);
}

export function createCustomCategory(label) {
  const list = getCustomCategories();
  const cat = { key: uid(), label: label.trim(), custom: true };
  write(KEYS.customCategories, [...list, cat]);
  return cat;
}

export function deleteCustomCategory(key) {
  write(KEYS.customCategories, getCustomCategories().filter((c) => c.key !== key));
  const items = read(KEYS.items, []).map((i) => (i.category === key ? { ...i, category: 'sonstiges' } : i));
  write(KEYS.items, items);
}

export function getAllCategories() {
  return [...CATEGORIES, ...getCustomCategories()];
}

export function categoryLabel(key) {
  return getAllCategories().find((c) => c.key === key)?.label || 'Sonstiges';
}

/** Layering (E64): Basis-/Mittel-/Aussenschicht, aktuell nur bei Oberteilen
 *  sinnvoll abgefragt (siehe wardrobe.js) - shuffleOutfit() kombiniert bei
 *  vorhandenen unterschiedlichen Schichten optional mehrere Oberteile statt
 *  nur eines, siehe dortige Doku. */
export const LAYERS = [
  { key: 'base', label: 'Basisschicht' },
  { key: 'mid', label: 'Mittelschicht' },
  { key: 'outer', label: 'Außenschicht' },
];

export function layerLabel(key) {
  return LAYERS.find((l) => l.key === key)?.label || '';
}

/* =========================================================
   Kleiderschrank – Kleidungsstücke, die ich besitze.
   ========================================================= */
// WardrobeItem: { id, name, category, color, colorHex (#rrggbb|null), size,
//                 layer (LAYERS-Key|null), daysWorn, note, photo (dataURL|null),
//                 createdAt, updatedAt }

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
    photo: fields.photo || null, layer: fields.layer || null, daysWorn: 0, createdAt: nowIso(),
  });
}

export function deleteItem(id) {
  write(KEYS.items, read(KEYS.items, []).filter((i) => i.id !== id));
}

/** "Heute getragen" (E64) - erhoeht den Tragezaehler um eins; Reset setzt
 *  ihn auf 0 zurueck (z.B. nach dem Waschen oder zu Saisonbeginn). */
export function incrementDaysWorn(id) {
  const item = getItemById(id);
  if (!item) return null;
  return saveItem({ ...item, daysWorn: (item.daysWorn || 0) + 1 });
}

export function resetDaysWorn(id) {
  const item = getItemById(id);
  if (!item) return null;
  return saveItem({ ...item, daysWorn: 0 });
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
    outfit.push(...pickLayeredTops(tops), randomFrom(bottoms));
  }
  for (const key of ['jacken', 'schuhe', 'accessoires']) {
    const pool = byCategory(key);
    if (pool.length) outfit.push(randomFrom(pool));
  }
  return outfit;
}

/** Waehlt ein oder mehrere Oberteile fuer den Shuffle (E64, Layering).
 *  Sind Oberteile mit unterschiedlichen Schichten (Basis/Mittel/Aussen)
 *  getaggt, kombiniert der Shuffler mit 50% Chance eine Basisschicht mit
 *  einer Mittel- oder Aussenschicht statt nur ein einzelnes Oberteil zu
 *  waehlen. Ohne Schicht-Tags (Altbestand, oder bewusst nicht eingeordnet)
 *  bleibt es beim bisherigen Verhalten: genau ein zufaelliges Oberteil. */
function pickLayeredTops(tops) {
  const base = tops.filter((t) => t.layer === 'base');
  const outer = tops.filter((t) => t.layer === 'mid' || t.layer === 'outer');
  if (base.length && outer.length && Math.random() < 0.5) {
    return [randomFrom(base), randomFrom(outer)];
  }
  return [randomFrom(tops)];
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
   Wunschliste (E64) – Dinge, die (noch) nicht im Kleiderschrank sind.
   "Gekauft" verschiebt den Eintrag in den echten Kleiderschrank (createItem)
   statt ihn nur zu loeschen, damit nichts doppelt erfasst werden muss.
   ========================================================= */
// WishlistItem: { id, name, category, note, link (URL|null), photo (dataURL|null), createdAt }

export function getWishlistItems() {
  return read(KEYS.wishlist, []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getWishlistItemById(id) {
  return read(KEYS.wishlist, []).find((i) => i.id === id) || null;
}

function saveWishlistItem(item) {
  const list = read(KEYS.wishlist, []);
  const idx = list.findIndex((i) => i.id === item.id);
  if (idx >= 0) list[idx] = item; else list.push(item);
  write(KEYS.wishlist, list);
  return item;
}

export function createWishlistItem(fields) {
  return saveWishlistItem({
    id: uid(), name: fields.name, category: fields.category || 'sonstiges',
    note: fields.note || '', link: fields.link || null, photo: fields.photo || null, createdAt: nowIso(),
  });
}

export function updateWishlistItem(id, fields) {
  const existing = getWishlistItemById(id);
  if (!existing) return null;
  return saveWishlistItem({ ...existing, ...fields });
}

export function deleteWishlistItem(id) {
  write(KEYS.wishlist, read(KEYS.wishlist, []).filter((i) => i.id !== id));
}

/** Verschiebt einen Wunschlisten-Eintrag in den echten Kleiderschrank. */
export function buyWishlistItem(id) {
  const item = getWishlistItemById(id);
  if (!item) return null;
  const created = createItem({ name: item.name, category: item.category, note: item.note, photo: item.photo });
  deleteWishlistItem(id);
  return created;
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
    customCategories: getCustomCategories(),
    wishlist: read(KEYS.wishlist, []),
  };
}

export function importAllData(data) {
  if (data.items) write(KEYS.items, data.items);
  if (data.settings) write(KEYS.settings, data.settings);
  if (data.styleRules) write(KEYS.styleRules, data.styleRules);
  if (data.palette) write(KEYS.palette, data.palette);
  if (data.customCategories) write(KEYS.customCategories, data.customCategories);
  if (data.wishlist) write(KEYS.wishlist, data.wishlist);
}

export function resetAllData() {
  localStorage.removeItem(KEYS.items);
  localStorage.removeItem(KEYS.settings);
  localStorage.removeItem(KEYS.styleRules);
  localStorage.removeItem(KEYS.palette);
  localStorage.removeItem(KEYS.customCategories);
  localStorage.removeItem(KEYS.wishlist);
}
