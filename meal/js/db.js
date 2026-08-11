// Persistenz-Schicht: alles in localStorage, bleibt lokal auf dem Geraet.
// Die Lebensmittel-Datenbank (shared/foods.json, USDA SR Legacy) ist eine
// read-only Referenztabelle und wird separat per fetch geladen, nicht hier
// gespeichert - siehe tools/build-foods.js.

import { uid, nowIso, todayKey, addDaysToDateKey, mondayOfWeekKey } from './utils.js';
import { getSharedGrocerySpend } from '../../shared/grocery-cost.js';

const KEYS = {
  recipes: 'ml_recipes_v1',
  mealPlan: 'ml_meal_plan_v1',
  settings: 'ml_settings_v1',
  shoppingChecked: 'ml_shopping_checked_v1',
  customFoods: 'ml_custom_foods_v1',
  ingredientPrices: 'ml_ingredient_prices_v1',
  diets: 'ml_diets_v1',
  recurringRules: 'ml_recurring_rules_v1',
  pantry: 'ml_pantry_v1',
  barcodeCache: 'ml_barcode_cache_v1',
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
   Lebensmittel-Datenbank (read-only, USDA SR Legacy)
   ========================================================= */

let foodsPromise = null;

export function loadFoods() {
  if (!foodsPromise) {
    foodsPromise = fetch(new URL('../../shared/foods.json', import.meta.url))
      .then((r) => r.json())
      .catch(() => []);
  }
  return foodsPromise;
}

/* =========================================================
   Eigene Zutaten – die USDA-Datenbank ist englischsprachig und deckt
   naturgemaess nicht jede rohe Zutat unter dem gesuchten (oft deutschen)
   Namen ab; wer nichts Passendes findet, legt selbst eine Zutat mit den
   Naehrwerten pro 100g an. Gleiche Form wie ein foods.json-Eintrag, damit
   recipeNutrition() etc. nicht zwischen beiden Quellen unterscheiden muss.
   ========================================================= */
// CustomFood: { id, name, kcal_100g, protein_100g, carbs_100g, fat_100g, createdAt }

export function getCustomFoods() {
  return read(KEYS.customFoods, []);
}

export function createCustomFood(fields) {
  const food = {
    id: uid(),
    name: (fields.name || '').trim(),
    kcal_100g: Number(fields.kcal_100g) || 0,
    protein_100g: Number(fields.protein_100g) || 0,
    carbs_100g: Number(fields.carbs_100g) || 0,
    fat_100g: Number(fields.fat_100g) || 0,
    createdAt: nowIso(),
  };
  write(KEYS.customFoods, [...getCustomFoods(), food]);
  return food;
}

/** Aendert der Name sich, werden bestehende Rezept-Zutaten mitgezogen (siehe
 *  recipeNutrition: ingredients[].foodName ist ein Namens-, kein ID-Verweis -
 *  ohne diese Kaskade wuerden bestehende Rezepte die umbenannte Zutat sonst
 *  stillschweigend nicht mehr finden und mit 0 Naehrwerten rechnen). */
export function updateCustomFood(id, fields) {
  const list = getCustomFoods();
  const idx = list.findIndex((f) => f.id === id);
  if (idx === -1) return null;
  const oldName = list[idx].name;
  const updated = {
    ...list[idx],
    name: fields.name !== undefined ? fields.name.trim() : list[idx].name,
    kcal_100g: fields.kcal_100g !== undefined ? Number(fields.kcal_100g) || 0 : list[idx].kcal_100g,
    protein_100g: fields.protein_100g !== undefined ? Number(fields.protein_100g) || 0 : list[idx].protein_100g,
    carbs_100g: fields.carbs_100g !== undefined ? Number(fields.carbs_100g) || 0 : list[idx].carbs_100g,
    fat_100g: fields.fat_100g !== undefined ? Number(fields.fat_100g) || 0 : list[idx].fat_100g,
  };
  list[idx] = updated;
  write(KEYS.customFoods, list);
  if (updated.name && updated.name !== oldName) renameFoodInRecipes(oldName, updated.name);
  return updated;
}

function renameFoodInRecipes(oldName, newName) {
  let changed = false;
  const recipes = getRecipes().map((r) => {
    const ingredients = r.ingredients.map((ing) => {
      if (ing.foodName !== oldName) return ing;
      changed = true;
      return { ...ing, foodName: newName };
    });
    return { ...r, ingredients };
  });
  if (changed) write(KEYS.recipes, recipes);
}

export function deleteCustomFood(id) {
  write(KEYS.customFoods, getCustomFoods().filter((f) => f.id !== id));
}

async function loadAllFoods() {
  const usda = await loadFoods();
  return [...getCustomFoods(), ...usda];
}

/** Eigene Zutaten zuerst (meist gezielter angelegt als ein USDA-Treffer). */
export async function searchFoods(query, limit = 20) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const foods = await loadAllFoods();
  const out = [];
  for (const f of foods) {
    if (f.name.toLowerCase().includes(q)) {
      out.push(f);
      if (out.length >= limit) break;
    }
  }
  return out;
}

export async function getFoodByName(name) {
  const foods = await loadAllFoods();
  return foods.find((f) => f.name === name) || null;
}

/* =========================================================
   Rezepte
   ========================================================= */
// Recipe: { id, name, servings, ingredients: [{foodName, grams}], note, createdAt }

export function getRecipes() {
  return read(KEYS.recipes, []);
}

export function getRecipeById(id) {
  return getRecipes().find((r) => r.id === id) || null;
}

export function saveRecipe(recipe) {
  const list = getRecipes();
  const idx = list.findIndex((r) => r.id === recipe.id);
  if (idx >= 0) list[idx] = recipe; else list.push(recipe);
  write(KEYS.recipes, list);
  return recipe;
}

export function createRecipe(fields) {
  const recipe = {
    id: uid(),
    name: fields.name,
    servings: fields.servings || 1,
    ingredients: fields.ingredients || [],
    note: fields.note || '',
    createdAt: nowIso(),
  };
  return saveRecipe(recipe);
}

export function deleteRecipe(id) {
  write(KEYS.recipes, getRecipes().filter((r) => r.id !== id));
  // Geplante Mahlzeiten und Wiederkehrend-Regeln mit diesem Rezept werden
  // mit-entfernt, damit weder Wochenplan noch Auto-Planung auf ein nicht
  // mehr existierendes Rezept verweisen.
  write(KEYS.mealPlan, getMealPlanEntries().filter((e) => e.recipeId !== id));
  write(KEYS.recurringRules, getRecurringRules().filter((r) => r.recipeId !== id));
}

/** Naehrwerte eines Rezepts (Summe + pro Portion) anhand der Zutatenliste. */
export async function recipeNutrition(recipe) {
  const usda = await loadFoods();
  // USDA zuerst in die Map, eigene Zutaten danach - bei einem Namenskonflikt
  // (Map.set ueberschreibt) gewinnt bewusst die eigene, gezielt angelegte Zutat.
  const byName = new Map([...usda, ...getCustomFoods()].map((f) => [f.name, f]));
  const total = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  for (const ing of recipe.ingredients) {
    const food = byName.get(ing.foodName);
    if (!food) continue;
    const factor = ing.grams / 100;
    total.kcal += food.kcal_100g * factor;
    total.protein += food.protein_100g * factor;
    total.carbs += food.carbs_100g * factor;
    total.fat += food.fat_100g * factor;
  }
  const servings = recipe.servings || 1;
  const perServing = {
    kcal: total.kcal / servings,
    protein: total.protein / servings,
    carbs: total.carbs / servings,
    fat: total.fat / servings,
  };
  return { total, perServing };
}

/* =========================================================
   Zutatenpreise & echte Kosten (E52) - unabhaengig von der Naehrwert-
   Zutatenliste (USDA/eigene Zutaten), da Preise personenbezogen/lokal
   variieren und nicht Teil einer allgemeinen Naehrwert-Referenztabelle
   sein koennen. Ein Preis pro 100g je Zutatenname, optional - Zutaten
   ohne hinterlegten Preis fliessen einfach nicht in die Kostenrechnung
   ein (klar als "unvollstaendig" ausgewiesen statt geraten).
   ========================================================= */
// IngredientPrices: { [foodName]: pricePer100g }

export function getIngredientPrices() {
  return read(KEYS.ingredientPrices, {});
}

export function getIngredientPrice(foodName) {
  return getIngredientPrices()[foodName] ?? null;
}

export function setIngredientPrice(foodName, pricePer100g) {
  const all = getIngredientPrices();
  if (pricePer100g == null || pricePer100g === '') delete all[foodName];
  else all[foodName] = Number(pricePer100g);
  write(KEYS.ingredientPrices, all);
}

/** Kosten eines Rezepts (gesamt + pro Portion) anhand hinterlegter
 *  Zutatenpreise. `missingCount` zaehlt Zutaten ohne Preis - der
 *  Gesamtbetrag ist dann eine Teilsumme, nie geraten/geschaetzt. */
export function recipeCost(recipe) {
  const prices = getIngredientPrices();
  let total = 0;
  let missingCount = 0;
  for (const ing of recipe.ingredients) {
    const price = prices[ing.foodName];
    if (price == null) { missingCount++; continue; }
    total += (ing.grams / 100) * price;
  }
  const servings = recipe.servings || 1;
  return { total, perServing: total / servings, missingCount, ingredientCount: recipe.ingredients.length };
}

/** Kosten einer geplanten Mahlzeit (Rezept-Kosten pro Portion, skaliert auf
 *  die tatsaechlich geplante Portionenzahl) - "echte Kosten pro Mahlzeit"
 *  aus dem Verbrauch (Wochenplan), nicht aus dem reinen Einkauf. */
export function mealCost(entry) {
  const recipe = getRecipeById(entry.recipeId);
  if (!recipe) return { total: 0, missingCount: 0 };
  const { perServing, missingCount } = recipeCost(recipe);
  return { total: perServing * (entry.servings || 1), missingCount };
}

/** Summierte Kosten aller geplanten Mahlzeiten in einem Datumsbereich. */
export function costForRange(startDate, endDate) {
  const entries = getMealPlanForRange(startDate, endDate);
  let total = 0;
  let missingCount = 0;
  for (const e of entries) {
    const c = mealCost(e);
    total += c.total;
    missingCount += c.missingCount;
  }
  return { total, missingCount };
}

/** Vergleich mit Budgets tatsaechlichen Lebensmittel-Ausgaben diesen Monat
 *  (shared/grocery-cost.js, Budget ist alleinige Quelle) - reiner Abgleich
 *  zur Einordnung, keine automatische Verrechnung/Buchung. */
export function getSharedGroceryComparison() {
  return getSharedGrocerySpend();
}

/* =========================================================
   Diaet-Planung mit woechentlicher Anpassung (E52) - ein zeitlich
   begrenztes Kalorienziel, das sich automatisch woechentlich um einen
   festen Betrag veraendert (z.B. -100 kcal/Woche fuer eine sanfte,
   schrittweise Diaet statt eines abrupten Sprungs). Ueberschreibt das
   statische settings.targetKcal nur waehrend der aktiven Diaet.
   ========================================================= */
// Diet: { id, name, startDate, durationWeeks, startTargetKcal, weeklyStepKcal, active, createdAt }

export function getDiets() {
  return read(KEYS.diets, []);
}

export function getActiveDiet() {
  return getDiets().find((d) => d.active) || null;
}

function saveDiet(diet) {
  const list = getDiets();
  const idx = list.findIndex((d) => d.id === diet.id);
  if (idx >= 0) list[idx] = diet; else list.push(diet);
  write(KEYS.diets, list);
  return diet;
}

/** Legt eine neue Diaet an und aktiviert sie (deaktiviert dabei jede
 *  andere - immer nur eine aktive Diaet gleichzeitig). */
export function startDiet(fields) {
  const list = getDiets().map((d) => ({ ...d, active: false }));
  write(KEYS.diets, list);
  return saveDiet({
    id: uid(),
    name: fields.name || 'Diät',
    startDate: fields.startDate || todayKey(),
    durationWeeks: Math.max(1, Number(fields.durationWeeks) || 4),
    startTargetKcal: Number(fields.startTargetKcal) || 0,
    weeklyStepKcal: Number(fields.weeklyStepKcal) || 0,
    active: true,
    createdAt: nowIso(),
  });
}

export function stopDiet(id) {
  const diet = getDiets().find((d) => d.id === id);
  if (diet) saveDiet({ ...diet, active: false });
}

export function deleteDiet(id) {
  write(KEYS.diets, getDiets().filter((d) => d.id !== id));
}

/** Aktuelle Woche (1-basiert, geclampt auf durationWeeks) und daraus
 *  abgeleitetes Kalorienziel fuer ein gegebenes Datum. */
export function dietStatusForDate(diet, date = todayKey()) {
  const daysElapsed = Math.max(0, daysBetweenDateKeys(diet.startDate, date));
  const weekIndex = Math.min(diet.durationWeeks - 1, Math.floor(daysElapsed / 7));
  const targetKcal = Math.max(0, diet.startTargetKcal + weekIndex * diet.weeklyStepKcal);
  const finished = daysElapsed >= diet.durationWeeks * 7;
  return { week: weekIndex + 1, totalWeeks: diet.durationWeeks, targetKcal, finished };
}

function daysBetweenDateKeys(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

/** Kalorienziel fuer ein Datum - aktive Diaet hat Vorrang vor dem
 *  statischen Einstellungs-Ziel. */
export function targetKcalForDate(date = todayKey()) {
  const diet = getActiveDiet();
  if (diet) return dietStatusForDate(diet, date).targetKcal;
  return getSettings().targetKcal;
}

/* =========================================================
   Automatisches Planen wiederkehrender Mahlzeiten (E52) - eine Regel
   "dieses Rezept an diesem Wochentag zu dieser Mahlzeit" fuellt beim
   Anwenden nur LEERE Slots der Zielwoche, ueberschreibt also nie eine
   bereits bewusst getroffene Wahl.
   ========================================================= */
// RecurringRule: { id, recipeId, weekday (0=Mo..6=So), meal, servings, createdAt }

export function getRecurringRules() {
  return read(KEYS.recurringRules, []);
}

export function getRecurringRulesForRecipe(recipeId) {
  return getRecurringRules().filter((r) => r.recipeId === recipeId);
}

export function createRecurringRule(fields) {
  const list = getRecurringRules();
  list.push({
    id: uid(), recipeId: fields.recipeId, weekday: Number(fields.weekday),
    meal: fields.meal, servings: Number(fields.servings) || 1, createdAt: nowIso(),
  });
  write(KEYS.recurringRules, list);
}

export function deleteRecurringRule(id) {
  write(KEYS.recurringRules, getRecurringRules().filter((r) => r.id !== id));
}

/** Wendet alle Regeln auf die Woche an, die `weekStartMonday` enthaelt -
 *  fuellt nur leere Slots, gibt die Anzahl neu befuellter Slots zurueck. */
export function applyRecurringRules(weekStartMonday) {
  const rules = getRecurringRules();
  let filled = 0;
  for (const rule of rules) {
    const date = addDaysToDateKey(weekStartMonday, rule.weekday);
    const existing = getMealPlanForDate(date).find((e) => e.meal === rule.meal);
    if (existing) continue;
    setMealSlot(date, rule.meal, rule.recipeId, rule.servings);
    filled++;
  }
  return filled;
}

/* =========================================================
   Wochenplan
   ========================================================= */
// MealPlanEntry: { id, date (YYYY-MM-DD), meal, recipeId, servings, createdAt }

export const MEALS = [
  { key: 'breakfast', label: 'Frühstück' },
  { key: 'lunch', label: 'Mittag' },
  { key: 'dinner', label: 'Abend' },
  { key: 'snack', label: 'Snack' },
];

export function getMealPlanEntries() {
  return read(KEYS.mealPlan, []);
}

export function getMealPlanForDate(date) {
  return getMealPlanEntries().filter((e) => e.date === date);
}

export function getMealPlanForRange(startDate, endDate) {
  return getMealPlanEntries().filter((e) => e.date >= startDate && e.date <= endDate);
}

/** Setzt (oder loescht, wenn recipeId null ist) das Rezept fuer einen Mahlzeit-Slot. */
export function setMealSlot(date, meal, recipeId, servings = 1) {
  const list = getMealPlanEntries();
  const idx = list.findIndex((e) => e.date === date && e.meal === meal);
  if (!recipeId) {
    if (idx >= 0) list.splice(idx, 1);
  } else if (idx >= 0) {
    list[idx] = { ...list[idx], recipeId, servings };
  } else {
    list.push({ id: uid(), date, meal, recipeId, servings, createdAt: nowIso() });
  }
  write(KEYS.mealPlan, list);
}

/** Naehrwert-Summe eines Tages ueber alle geplanten Mahlzeiten. */
export async function dayNutrition(date) {
  const entries = getMealPlanForDate(date);
  const totals = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  for (const e of entries) {
    const recipe = getRecipeById(e.recipeId);
    if (!recipe) continue;
    const { total } = await recipeNutrition(recipe);
    const ratio = (e.servings || 1) / (recipe.servings || 1);
    totals.kcal += total.kcal * ratio;
    totals.protein += total.protein * ratio;
    totals.carbs += total.carbs * ratio;
    totals.fat += total.fat * ratio;
  }
  return totals;
}

/* =========================================================
   Einkaufsliste (abgeleitet aus dem Wochenplan, kein Vorratsabzug)
   ========================================================= */

/** Aggregierte Zutatenmengen fuer einen Datumsbereich. */
export async function shoppingListForRange(startDate, endDate) {
  const entries = getMealPlanForRange(startDate, endDate);
  const totals = new Map();
  for (const e of entries) {
    const recipe = getRecipeById(e.recipeId);
    if (!recipe) continue;
    const ratio = (e.servings || 1) / (recipe.servings || 1);
    for (const ing of recipe.ingredients) {
      totals.set(ing.foodName, (totals.get(ing.foodName) || 0) + ing.grams * ratio);
    }
  }
  return [...totals.entries()]
    .map(([foodName, grams]) => ({ foodName, grams }))
    .sort((a, b) => a.foodName.localeCompare(b.foodName));
}

export function getCheckedShoppingItems(weekStart) {
  return read(KEYS.shoppingChecked, {})[weekStart] || [];
}

export function toggleShoppingItem(weekStart, foodName) {
  const all = read(KEYS.shoppingChecked, {});
  const set = new Set(all[weekStart] || []);
  if (set.has(foodName)) set.delete(foodName); else set.add(foodName);
  all[weekStart] = [...set];
  write(KEYS.shoppingChecked, all);
}

/* =========================================================
   Vorratsverwaltung (E55) - lokaler, sich selbst aufbauender Barcode-
   Cache statt einer mehrere GB grossen Open-Food-Facts-Datenbank: beim
   ersten Scan eines Produkts wird Name/Einheit einmalig manuell erfasst,
   ab dann lokal wiedererkannt. Kein externer API-Call (local-first).
   ========================================================= */
// PantryItem: { id, name, quantity, unit, category, barcode (optional), createdAt, updatedAt }

export const PANTRY_CATEGORIES = [
  { key: 'kuehlschrank', label: 'Kühlschrank' },
  { key: 'tiefkuehl', label: 'Tiefkühl' },
  { key: 'vorrat', label: 'Vorratsschrank' },
  { key: 'sonstiges', label: 'Sonstiges' },
];

export function getPantryItems() {
  return read(KEYS.pantry, []).sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

export function getPantryItemById(id) {
  return read(KEYS.pantry, []).find((p) => p.id === id) || null;
}

export function getPantryItemByName(name) {
  const key = name.trim().toLowerCase();
  return read(KEYS.pantry, []).find((p) => p.name.trim().toLowerCase() === key) || null;
}

function savePantryItem(item) {
  const list = read(KEYS.pantry, []);
  const idx = list.findIndex((p) => p.id === item.id);
  const updated = { ...item, updatedAt: nowIso() };
  if (idx >= 0) list[idx] = updated; else list.push(updated);
  write(KEYS.pantry, list);
  return updated;
}

export function createPantryItem(fields) {
  return savePantryItem({
    id: uid(), name: fields.name, quantity: Number(fields.quantity) || 0,
    unit: fields.unit || 'Stück', category: fields.category || 'sonstiges',
    barcode: fields.barcode || null, createdAt: nowIso(),
  });
}

export function adjustPantryQuantity(id, delta) {
  const item = getPantryItemById(id);
  if (!item) return null;
  return savePantryItem({ ...item, quantity: Math.max(0, item.quantity + delta) });
}

/** Heuristische Zeilenerkennung fuer Kassenbon-Fotos (E63) - bewusst nur
 *  Produktnamen-Kandidaten, KEINE Mengen-/Einheiten-Erkennung (auf deutschen
 *  Kassenbons zu uneinheitlich formatiert, um das zuverlaessig zu raten).
 *  Eine Zeile gilt als Produktkandidat, wenn sie mit einem typischen
 *  Preis-Muster endet und nicht zu den bekannten Nicht-Produkt-Zeilen
 *  (Summe, MwSt, Kartenzahlung, ...) gehoert - der Preis selbst wird
 *  verworfen, nur der Name links davon ist relevant. Ergebnis ist immer nur
 *  ein Vorschlag zum Abhaken, keine automatische Buchung. */
const RECEIPT_NON_ITEM = /summe|gesamt|zwischensumme|total|zu\s*zahlen|betrag|mwst|ust\b|steuer|\bbar\b|ec-?karte|kartenzahlung|rückgeld|geg\.|kassenbon|bon-?nr|datum|uhrzeit|kunden|filiale|tel\.?:|www\.|kassierer|rabatt|pfand/i;
// Das optionale Steuerkategorie-Kuerzel (A/B) steht je nach Kassensystem vor
// ODER nach dem Preis (z.B. "2,49 A" oder "A 2,49") - beide Positionen erlaubt.
const RECEIPT_ITEM_LINE = /^(.{2,40}?)\s+[A-Za-z]?\s*(\d{1,3}[.,]\d{2})\s*(?:€|eur)?\s*[A-Za-z]?\s*$/i;

export function extractReceiptItemCandidates(rawText) {
  const seen = new Set();
  const out = [];
  for (const rawLine of rawText.split('\n')) {
    const line = rawLine.trim();
    if (!line || RECEIPT_NON_ITEM.test(line)) continue;
    const m = line.match(RECEIPT_ITEM_LINE);
    if (!m) continue;
    const name = m[1].trim().replace(/\s{2,}/g, ' ');
    if (!name || /^\d+$/.test(name) || name.length < 2) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name });
  }
  return out;
}

export function deletePantryItem(id) {
  write(KEYS.pantry, read(KEYS.pantry, []).filter((p) => p.id !== id));
}

/* ---------- Barcode-Cache ---------- */
// { [barcode]: { name, unit } }

export function getBarcodeCache() {
  return read(KEYS.barcodeCache, {});
}

export function lookupBarcode(barcode) {
  return read(KEYS.barcodeCache, {})[barcode] || null;
}

export function cacheBarcode(barcode, name, unit) {
  const all = read(KEYS.barcodeCache, {});
  all[barcode] = { name, unit };
  write(KEYS.barcodeCache, all);
}

/* ---------- Einkaufsliste abzueglich Vorrat ---------- */

/** Wie shoppingListForRange(), aber je Position mit hasStock/verbleibender
 *  Menge nach Vorratsabzug. Abzug nur, wenn ein Vorratsposten mit
 *  passendem Namen existiert UND dessen Einheit in Gramm umrechenbar ist
 *  (g/kg) - bei anderen Einheiten (Stueck, Packung, ...) ist eine korrekte
 *  automatische Umrechnung nicht moeglich, dann wird nur "vorhanden"
 *  markiert statt eine falsche Zahl vorzutaeuschen. */
export async function pantryAdjustedShoppingList(startDate, endDate) {
  const items = await shoppingListForRange(startDate, endDate);
  return items.map((item) => {
    const pantryItem = getPantryItemByName(item.foodName);
    if (!pantryItem || pantryItem.quantity <= 0) return { ...item, hasStock: false, remainingGrams: item.grams };
    const unit = (pantryItem.unit || '').toLowerCase();
    const pantryGrams = unit === 'kg' ? pantryItem.quantity * 1000 : unit === 'g' ? pantryItem.quantity : null;
    if (pantryGrams == null) return { ...item, hasStock: true, remainingGrams: item.grams, unclearUnit: true };
    return { ...item, hasStock: true, remainingGrams: Math.max(0, item.grams - pantryGrams) };
  });
}

/* ---------- Rezeptvorschlaege aus dem Vorrat ---------- */

/** Rezepte, deren Zutaten (nach Namen) am ehesten im Vorrat vorhanden sind -
 *  Namensabgleich, keine Mengen-/Einheitenpruefung (gleiche Einschraenkung
 *  wie beim Einkaufslisten-Abzug: Vorratseinheiten sind zu uneinheitlich
 *  fuer eine verlaessliche automatische Mengenrechnung). Nur Rezepte mit
 *  mindestens einer Uebereinstimmung, absteigend nach Trefferquote sortiert. */
export function suggestRecipesFromPantry(limit = 10) {
  const pantryNames = new Set(read(KEYS.pantry, []).filter((p) => p.quantity > 0).map((p) => p.name.trim().toLowerCase()));
  if (!pantryNames.size) return [];
  const scored = getRecipes().map((r) => {
    const total = r.ingredients.length;
    const matched = r.ingredients.filter((ing) => pantryNames.has(ing.foodName.trim().toLowerCase())).length;
    return { recipe: r, matched, total };
  }).filter((s) => s.matched > 0);
  scored.sort((a, b) => (b.matched / b.total) - (a.matched / a.total) || b.matched - a.matched);
  return scored.slice(0, limit);
}

/* =========================================================
   Einstellungen
   ========================================================= */

const DEFAULT_SETTINGS = {
  theme: 'dark',
  accentHue: 28,
  targetKcal: null,
  lastBackupAt: '',
};

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
    recipes: getRecipes(),
    mealPlan: getMealPlanEntries(),
    customFoods: getCustomFoods(),
    settings: getSettings(),
    ingredientPrices: getIngredientPrices(),
    diets: getDiets(),
    recurringRules: getRecurringRules(),
    pantry: getPantryItems(),
    barcodeCache: getBarcodeCache(),
  };
}

export function importAllData(data) {
  if (data.recipes) write(KEYS.recipes, data.recipes);
  if (data.mealPlan) write(KEYS.mealPlan, data.mealPlan);
  if (data.customFoods) write(KEYS.customFoods, data.customFoods);
  if (data.settings) write(KEYS.settings, data.settings);
  if (data.ingredientPrices) write(KEYS.ingredientPrices, data.ingredientPrices);
  if (data.diets) write(KEYS.diets, data.diets);
  if (data.recurringRules) write(KEYS.recurringRules, data.recurringRules);
  if (data.pantry) write(KEYS.pantry, data.pantry);
  if (data.barcodeCache) write(KEYS.barcodeCache, data.barcodeCache);
}

export function resetAllData() {
  localStorage.removeItem(KEYS.recipes);
  localStorage.removeItem(KEYS.mealPlan);
  localStorage.removeItem(KEYS.settings);
  localStorage.removeItem(KEYS.shoppingChecked);
  localStorage.removeItem(KEYS.customFoods);
  localStorage.removeItem(KEYS.ingredientPrices);
  localStorage.removeItem(KEYS.diets);
  localStorage.removeItem(KEYS.recurringRules);
  localStorage.removeItem(KEYS.pantry);
  localStorage.removeItem(KEYS.barcodeCache);
}
