// Persistenz-Schicht: alles in localStorage, bleibt lokal auf dem Geraet.

import { uid, nowIso, todayKey, monthKey, addMonths } from './utils.js';

const KEYS = {
  categories: 'bg_categories_v1',
  expenses: 'bg_expenses_v1',
  income: 'bg_income_v1',
  settings: 'bg_settings_v1',
  seeded: 'bg_seeded_v1',
  envelopes: 'bg_envelopes_v1',
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
    recurringInterval: fields.recurringInterval || 'monthly', // 'monthly'|'yearly' - nur relevant wenn recurring
    taxRelevant: !!fields.taxRelevant,
    createdAt: nowIso(),
  };
  return saveExpense(expense);
}

export function deleteExpense(id) {
  write(KEYS.expenses, getExpenses().filter((e) => e.id !== id));
}

/* =========================================================
   Einnahmen – bewusst ein eigenes, einfacheres Modell statt einer
   "negativen Ausgabe": keine Kategorie/Steuerrelevanz noetig, dafuer ein
   freier Quelle-Text (Gehalt, Nebenjob, ...).
   ========================================================= */
// Income: { id, date (YYYY-MM-DD), amount, source, note, recurring,
//           recurringInterval, createdAt }

export function getIncome() {
  return read(KEYS.income, []);
}

export function getIncomeById(id) {
  return getIncome().find((i) => i.id === id) || null;
}

export function getIncomeForMonth(yearMonth) {
  return getIncome()
    .filter((i) => monthKey(i.date) === yearMonth)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

export function saveIncome(income) {
  const list = getIncome();
  const idx = list.findIndex((i) => i.id === income.id);
  if (idx >= 0) list[idx] = income; else list.push(income);
  write(KEYS.income, list);
  return income;
}

export function createIncome(fields) {
  const income = {
    id: uid(),
    date: fields.date || todayKey(),
    amount: Number(fields.amount) || 0,
    source: fields.source || '',
    note: fields.note || '',
    recurring: !!fields.recurring,
    recurringInterval: fields.recurringInterval || 'monthly',
    createdAt: nowIso(),
  };
  return saveIncome(income);
}

export function deleteIncome(id) {
  write(KEYS.income, getIncome().filter((i) => i.id !== id));
}

export function monthIncomeTotal(yearMonth) {
  return getIncomeForMonth(yearMonth).reduce((sum, i) => sum + i.amount, 0);
}

/** Einnahmen minus Ausgaben fuer einen Monat. */
export function monthNet(yearMonth) {
  return monthIncomeTotal(yearMonth) - monthTotal(yearMonth);
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
   Statistik/Auswertung (E51) - Monatstrend, lineare Prognose,
   Kategorie-Vorschlag aus der Historie, Kauf-Intervall je Haendler,
   Steuer-Jahresreport. Rein aus den bestehenden Ausgaben/Einnahmen
   abgeleitet, kein eigenes Ledger.
   ========================================================= */

/** Monatssummen der letzten n Monate (inkl. aktuellem), aeltester zuerst. */
export function monthlyTotalsSeries(months = 6, endMonth = monthKey()) {
  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    const ym = addMonths(endMonth, -i);
    out.push({ month: ym, total: monthTotal(ym) });
  }
  return out;
}

/** Lineare Regression (kleinste Quadrate) ueber eine Monatsreihe, liefert
 *  die Prognose fuer den jeweils naechsten Monat. Braucht mindestens 2
 *  Datenpunkte, sonst null. */
export function linearForecast(series) {
  const n = series.length;
  if (n < 2) return null;
  const xs = series.map((_, i) => i);
  const ys = series.map((p) => p.total);
  const xMean = xs.reduce((s, x) => s + x, 0) / n;
  const yMean = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xMean) * (ys[i] - yMean);
    den += (xs[i] - xMean) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = yMean - slope * xMean;
  const nextX = n; // naechster Monat nach der Reihe
  return { nextMonth: addMonths(series[n - 1].month, 1), value: Math.max(0, slope * nextX + intercept), trendPerMonth: slope };
}

/** Haeufigste Kategorie fuer einen Haendlernamen (case-insensitiv) aus der
 *  bisherigen Ausgaben-Historie - "lernt" implizit aus jeder gespeicherten
 *  Ausgabe: waehlt der Nutzer fuer denselben Haendler kuenftig eine andere
 *  Kategorie, verschiebt sich die Mehrheit bei genuegend Korrekturen von
 *  selbst, ohne eigenes ML-Modell. */
export function suggestCategoryForMerchant(merchant) {
  const key = (merchant || '').trim().toLowerCase();
  if (!key) return null;
  const counts = new Map();
  for (const e of getExpenses()) {
    if (e.merchant.trim().toLowerCase() !== key) continue;
    counts.set(e.categoryId, (counts.get(e.categoryId) || 0) + 1);
  }
  if (!counts.size) return null;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/** Durchschnittlicher Abstand (Tage) zwischen aufeinanderfolgenden Ausgaben
 *  desselben Haendlers - eigene, einfachere Variante als Kosmetiks
 *  Nutzungsdauer-Statistik (dort: wie lange EIN Produkt bis "aufgebraucht"
 *  haelt; hier: wie oft derselbe Haendler ueberhaupt erneut bezahlt wird -
 *  Budget hat kein "aufgebraucht"-Konzept, nur wiederholte Ausgaben). Nur
 *  Haendler mit mindestens zwei Ausgaben werden beruecksichtigt. */
export function purchaseIntervalStats() {
  const groups = new Map();
  for (const e of getExpenses()) {
    const key = e.merchant.trim();
    if (!key) continue;
    const keyLower = key.toLowerCase();
    if (!groups.has(keyLower)) groups.set(keyLower, { name: key, dates: [] });
    groups.get(keyLower).dates.push(e.date);
  }
  const out = [];
  for (const g of groups.values()) {
    const dates = g.dates.slice().sort();
    if (dates.length < 2) continue;
    let totalDays = 0;
    for (let i = 1; i < dates.length; i++) {
      totalDays += daysBetween(dates[i - 1], dates[i]);
    }
    out.push({ name: g.name, avgDays: Math.round(totalDays / (dates.length - 1)), count: dates.length, lastDate: dates[dates.length - 1] });
  }
  return out.sort((a, b) => a.avgDays - b.avgDays);
}

function daysBetween(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

/** Alle steuerlich relevanten Ausgaben eines Jahres, sortiert nach Datum -
 *  Basis fuer den Steuer-Jahresreport (eigener CSV-Export statt nur der
 *  generischen JSON-Komplettsicherung). */
export function taxRelevantExpensesForYear(year) {
  return getExpenses()
    .filter((e) => e.taxRelevant && e.date.startsWith(String(year)))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function taxYearsAvailable() {
  const years = new Set(getExpenses().filter((e) => e.taxRelevant).map((e) => e.date.slice(0, 4)));
  return [...years].sort().reverse();
}

/* =========================================================
   Sparumschlaege - Ruecklagen fuer Zukunftskaeufe mit automatischer
   monatlicher Zufuehrung. Kein separates Buchungs-Ledger noetig: pro
   Kalendermonat wird einmalig geprueft und der Kontostand direkt
   fortgeschrieben (lastAccrualMonth verhindert Doppelbuchung).
   ========================================================= */
// Envelope: { id, name, icon, monthlyAmount, targetAmount (null=offenes Sparziel),
//             balance, lastAccrualMonth (YYYY-MM|null), createdAt }

export function getEnvelopes() {
  return read(KEYS.envelopes, []);
}

export function getEnvelopeById(id) {
  return getEnvelopes().find((e) => e.id === id) || null;
}

function saveEnvelope(env) {
  const list = getEnvelopes();
  const idx = list.findIndex((e) => e.id === env.id);
  if (idx >= 0) list[idx] = env; else list.push(env);
  write(KEYS.envelopes, list);
  return env;
}

export function createEnvelope(fields) {
  return saveEnvelope({
    id: uid(),
    name: (fields.name || '').trim(),
    icon: fields.icon || '💰',
    monthlyAmount: Number(fields.monthlyAmount) || 0,
    targetAmount: fields.targetAmount ? Number(fields.targetAmount) : null,
    balance: 0,
    lastAccrualMonth: null,
    createdAt: nowIso(),
  });
}

export function updateEnvelope(id, patch) {
  const env = getEnvelopeById(id);
  if (!env) return null;
  return saveEnvelope({ ...env, ...patch });
}

export function deleteEnvelope(id) {
  write(KEYS.envelopes, getEnvelopes().filter((e) => e.id !== id));
}

export function depositToEnvelope(id, amount) {
  const env = getEnvelopeById(id);
  if (!env || !amount) return env;
  return saveEnvelope({ ...env, balance: env.balance + amount });
}

export function withdrawFromEnvelope(id, amount) {
  const env = getEnvelopeById(id);
  if (!env || !amount) return env;
  return saveEnvelope({ ...env, balance: Math.max(0, env.balance - amount) });
}

/** Automatische monatliche Zufuehrung - einmal pro Kalendermonat je Umschlag,
 *  beim App-Start ausgeloest (idempotent ueber lastAccrualMonth). */
export function accrueEnvelopes(currentMonth = monthKey()) {
  const list = getEnvelopes();
  let changed = false;
  const updated = list.map((env) => {
    if (env.lastAccrualMonth === currentMonth || env.monthlyAmount <= 0) return env;
    changed = true;
    return { ...env, balance: env.balance + env.monthlyAmount, lastAccrualMonth: currentMonth };
  });
  if (changed) write(KEYS.envelopes, updated);
  return changed;
}

export function totalEnvelopeBalance() {
  return getEnvelopes().reduce((sum, e) => sum + e.balance, 0);
}

/* =========================================================
   Abo-Radar - erkennt wiederkehrende Ausgaben (recurring:true) und
   fasst sie pro Haendler (oder Kategorie, falls kein Haendler angegeben)
   zusammen: monatliches Aequivalent, letzte Zahlung, geschaetzte naechste
   Faelligkeit. Rein aus den Ausgaben abgeleitet, kein eigenes Abo-Modell -
   ein einzelner als "wiederkehrend" markierter Eintrag reicht, damit ein
   Abo hier auftaucht.
   ========================================================= */

function addIntervalToDateKey(dateKey, interval) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = interval === 'yearly'
    ? new Date(Date.UTC(y + 1, m - 1, d))
    : new Date(Date.UTC(y, m, d));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/** @returns {{items: Array, totalMonthly: number}} */
export function subscriptionSummary() {
  const recurring = getExpenses().filter((e) => e.recurring);
  const groups = new Map(); // Gruppen-Key -> neuester Eintrag dieser Gruppe
  for (const e of recurring) {
    const key = e.merchant.trim().toLowerCase() || `kategorie:${e.categoryId}`;
    const current = groups.get(key);
    if (!current || current.date < e.date) groups.set(key, e);
  }
  const items = [...groups.values()].map((e) => {
    const interval = e.recurringInterval || 'monthly';
    const monthlyEquivalent = interval === 'yearly' ? e.amount / 12 : e.amount;
    return {
      expenseId: e.id,
      merchant: e.merchant || getCategoryById(e.categoryId)?.name || 'Unbenannt',
      categoryId: e.categoryId,
      amount: e.amount,
      interval,
      monthlyEquivalent,
      lastDate: e.date,
      nextDueEstimate: addIntervalToDateKey(e.date, interval),
    };
  }).sort((a, b) => b.monthlyEquivalent - a.monthlyEquivalent);
  const totalMonthly = items.reduce((sum, i) => sum + i.monthlyEquivalent, 0);
  return { items, totalMonthly };
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
    income: getIncome(),
    envelopes: getEnvelopes(),
    settings: getSettings(),
  };
}

export function importAllData(data) {
  if (data.categories) write(KEYS.categories, data.categories);
  if (data.expenses) write(KEYS.expenses, data.expenses);
  if (data.income) write(KEYS.income, data.income);
  if (data.envelopes) write(KEYS.envelopes, data.envelopes);
  if (data.settings) write(KEYS.settings, data.settings);
}

export function resetAllData() {
  localStorage.removeItem(KEYS.categories);
  localStorage.removeItem(KEYS.expenses);
  localStorage.removeItem(KEYS.income);
  localStorage.removeItem(KEYS.envelopes);
  localStorage.removeItem(KEYS.settings);
  localStorage.removeItem(KEYS.seeded);
  ensureSeeded();
}
