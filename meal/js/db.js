// Persistenz-Schicht: alles in localStorage, bleibt lokal auf dem Geraet.
// Die Lebensmittel-Datenbank (shared/foods.json, USDA SR Legacy) ist eine
// read-only Referenztabelle und wird separat per fetch geladen, nicht hier
// gespeichert - siehe tools/build-foods.js.

import { uid, nowIso, todayKey } from './utils.js';

const KEYS = {
  recipes: 'ml_recipes_v1',
  mealPlan: 'ml_meal_plan_v1',
  settings: 'ml_settings_v1',
  shoppingChecked: 'ml_shopping_checked_v1',
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

export async function searchFoods(query, limit = 20) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const foods = await loadFoods();
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
  const foods = await loadFoods();
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
  // Geplante Mahlzeiten mit diesem Rezept werden mit-entfernt, damit der
  // Wochenplan nicht auf nicht mehr existierende Rezepte verweist.
  write(KEYS.mealPlan, getMealPlanEntries().filter((e) => e.recipeId !== id));
}

/** Naehrwerte eines Rezepts (Summe + pro Portion) anhand der Zutatenliste. */
export async function recipeNutrition(recipe) {
  const foods = await loadFoods();
  const byName = new Map(foods.map((f) => [f.name, f]));
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
    settings: getSettings(),
  };
}

export function importAllData(data) {
  if (data.recipes) write(KEYS.recipes, data.recipes);
  if (data.mealPlan) write(KEYS.mealPlan, data.mealPlan);
  if (data.settings) write(KEYS.settings, data.settings);
}

export function resetAllData() {
  localStorage.removeItem(KEYS.recipes);
  localStorage.removeItem(KEYS.mealPlan);
  localStorage.removeItem(KEYS.settings);
  localStorage.removeItem(KEYS.shoppingChecked);
}
