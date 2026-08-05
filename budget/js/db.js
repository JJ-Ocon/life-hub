// Persistenz-Schicht: alles in localStorage, bleibt lokal auf dem Geraet.

import { uid, nowIso, todayKey, monthKey } from './utils.js';

const KEYS = {
  categories: 'bg_categories_v1',
  expenses: 'bg_expenses_v1',
  settings: 'bg_settings_v1',
  seeded: 'bg_seeded_v1',
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
   Kategorien – Struktur wird einmalig geseedet (keine erfundenen
   Ausgaben, nur die Kategorie-Liste als sinnvoller Startpunkt).
   ========================================================= */

const DEFAULT_CATEGORIES = [
  { id: 'housing', name: 'Wohnen', icon: '🏠', color: '#2f6fd9', budgetMonthly: null },
  { id: 'groceries', name: 'Lebensmittel', icon: '🛒', color: '#3ddc84', budgetMonthly: null },
  { id: 'transport', name: 'Transport', icon: '🚗', color: '#e0a63a', budgetMonthly: null },
  { id: 'leisure', name: 'Freizeit & Hobbys', icon: '🎉', color: '#c76ae0', budgetMonthly: null },
  { id: 'health', name: 'Gesundheit', icon: '💊', color: '#f06464', budgetMonthly: null },
  { id: 'clothing', name: 'Kleidung', icon: '👕', color: '#4fc3d9', budgetMonthly: null },
  { id: 'subscriptions', name: 'Abos & Mitgliedschaften', icon: '🔁', color: '#8f7ee0', budgetMonthly: null },
  { id: 'household', name: 'Haushalt', icon: '🧺', color: '#d98f4f', budgetMonthly: null },
  { id: 'education', name: 'Bildung', icon: '📚', color: '#5b9bd9', budgetMonthly: null },
  { id: 'other', name: 'Sonstiges', icon: '📦', color: '#8891a0', budgetMonthly: null },
];

function ensureSeeded() {
  if (read(KEYS.seeded, false)) return;
  write(KEYS.categories, DEFAULT_CATEGORIES);
  write(KEYS.seeded, true);
}
ensureSeeded();

export function getCategories() {
  return read(KEYS.categories, DEFAULT_CATEGORIES);
}

export function getCategoryById(id) {
  return getCategories().find((c) => c.id === id) || null;
}

export function saveCategory(cat) {
  const list = getCategories();
  const idx = list.findIndex((c) => c.id === cat.id);
  if (idx >= 0) list[idx] = cat; else list.push(cat);
  write(KEYS.categories, list);
  return cat;
}

export function createCategory(name, icon = '📦', color = '#8891a0') {
  const cat = { id: uid(), name: name.trim(), icon, color, budgetMonthly: null };
  return saveCategory(cat);
}

/** Loescht eine Kategorie; vorhandene Ausgaben wandern nach 'other', damit keine Daten verloren gehen. */
export function deleteCategory(id) {
  if (id === 'other') return;
  write(KEYS.categories, getCategories().filter((c) => c.id !== id));
  const expenses = getExpenses().map((e) => (e.categoryId === id ? { ...e, categoryId: 'other' } : e));
  write(KEYS.expenses, expenses);
}

/* =========================================================
   Ausgaben
   ========================================================= */
// Expense: { id, date (YYYY-MM-DD), amount, categoryId, merchant, note,
//            recurring, taxRelevant, createdAt }

export function getExpenses() {
  return read(KEYS.expenses, []);
}

export function getExpenseById(id) {
  return getExpenses().find((e) => e.id === id) || null;
}

export function getExpensesForMonth(yearMonth) {
  return getExpenses()
    .filter((e) => monthKey(e.date) === yearMonth)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

export function saveExpense(expense) {
  const list = getExpenses();
  const idx = list.findIndex((e) => e.id === expense.id);
  if (idx >= 0) list[idx] = expense; else list.push(expense);
  write(KEYS.expenses, list);
  return expense;
}

export function createExpense(fields) {
  const expense = {
    id: uid(),
    date: fields.date || todayKey(),
    amount: Number(fields.amount) || 0,
    categoryId: fields.categoryId || 'other',
    merchant: fields.merchant || '',
    note: fields.note || '',
    recurring: !!fields.recurring,
    taxRelevant: !!fields.taxRelevant,
    createdAt: nowIso(),
  };
  return saveExpense(expense);
}

export function deleteExpense(id) {
  write(KEYS.expenses, getExpenses().filter((e) => e.id !== id));
}

/* =========================================================
   Auswertung / Ampel-Logik
   ========================================================= */

/** Summe je Kategorie fuer einen Monat. @returns {Object<string, number>} */
export function monthlySpendByCategory(yearMonth) {
  const sums = {};
  for (const e of getExpensesForMonth(yearMonth)) {
    sums[e.categoryId] = (sums[e.categoryId] || 0) + e.amount;
  }
  return sums;
}

export function monthTotal(yearMonth) {
  return getExpensesForMonth(yearMonth).reduce((sum, e) => sum + e.amount, 0);
}

/**
 * Ampel-Status einer Kategorie fuer einen Monat.
 * @returns {{spent:number, budget:number|null, pct:number|null, level:'ok'|'warn'|'over'|'nolimit'}}
 */
export function budgetStatus(category, yearMonth) {
  const spent = monthlySpendByCategory(yearMonth)[category.id] || 0;
  const budget = category.budgetMonthly;
  if (!budget || budget <= 0) return { spent, budget: null, pct: null, level: 'nolimit' };
  const pct = spent / budget;
  const level = pct >= 1 ? 'over' : pct >= 0.8 ? 'warn' : 'ok';
  return { spent, budget, pct, level };
}

/* =========================================================
   Einstellungen
   ========================================================= */

const DEFAULT_SETTINGS = {
  theme: 'dark',
  accentHue: 214,
  currency: '€',
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
    categories: getCategories(),
    expenses: getExpenses(),
    settings: getSettings(),
  };
}

export function importAllData(data) {
  if (data.categories) write(KEYS.categories, data.categories);
  if (data.expenses) write(KEYS.expenses, data.expenses);
  if (data.settings) write(KEYS.settings, data.settings);
}

export function resetAllData() {
  localStorage.removeItem(KEYS.categories);
  localStorage.removeItem(KEYS.expenses);
  localStorage.removeItem(KEYS.settings);
  localStorage.removeItem(KEYS.seeded);
  ensureSeeded();
}
