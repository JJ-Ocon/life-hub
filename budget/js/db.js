// Persistenz-Schicht: alles in localStorage, bleibt lokal auf dem Geraet.

import { uid, nowIso, todayKey, monthKey, addMonths, mondayOfWeekKey, addDaysToDateKey } from './utils.js';
import { publishGrocerySpend } from '../../shared/grocery-cost.js';

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
  { id: 'housing', name: 'Wohnen', icon: '🏠', color: '#2f6fd9', budgetAmount: null, budgetPeriod: 'monthly', carryover: 0, lastRolloverPeriod: null },
  { id: 'groceries', name: 'Lebensmittel', icon: '🛒', color: '#3ddc84', budgetAmount: null, budgetPeriod: 'monthly', carryover: 0, lastRolloverPeriod: null },
  { id: 'transport', name: 'Transport', icon: '🚗', color: '#e0a63a', budgetAmount: null, budgetPeriod: 'monthly', carryover: 0, lastRolloverPeriod: null },
  { id: 'leisure', name: 'Freizeit & Hobbys', icon: '🎉', color: '#c76ae0', budgetAmount: null, budgetPeriod: 'monthly', carryover: 0, lastRolloverPeriod: null },
  { id: 'health', name: 'Gesundheit', icon: '💊', color: '#f06464', budgetAmount: null, budgetPeriod: 'monthly', carryover: 0, lastRolloverPeriod: null },
  { id: 'clothing', name: 'Kleidung', icon: '👕', color: '#4fc3d9', budgetAmount: null, budgetPeriod: 'monthly', carryover: 0, lastRolloverPeriod: null },
  { id: 'subscriptions', name: 'Abos & Mitgliedschaften', icon: '🔁', color: '#8f7ee0', budgetAmount: null, budgetPeriod: 'monthly', carryover: 0, lastRolloverPeriod: null },
  { id: 'household', name: 'Haushalt', icon: '🧺', color: '#d98f4f', budgetAmount: null, budgetPeriod: 'monthly', carryover: 0, lastRolloverPeriod: null },
  { id: 'education', name: 'Bildung', icon: '📚', color: '#5b9bd9', budgetAmount: null, budgetPeriod: 'monthly', carryover: 0, lastRolloverPeriod: null },
  { id: 'other', name: 'Sonstiges', icon: '📦', color: '#8891a0', budgetAmount: null, budgetPeriod: 'monthly', carryover: 0, lastRolloverPeriod: null },
];

function ensureSeeded() {
  if (read(KEYS.seeded, false)) return;
  write(KEYS.categories, DEFAULT_CATEGORIES);
  write(KEYS.seeded, true);
}
ensureSeeded();

/** Altbestand (vor E62, nur budgetMonthly) wird beim Lesen einmalig auf das
 *  neue Schema gehoben - bestehende Limits bleiben als monatliches Budget
 *  erhalten, kein Datenverlust. */
function migrateCategoryShape(c) {
  if (c.budgetAmount !== undefined) return c;
  return { ...c, budgetAmount: c.budgetMonthly ?? null, budgetPeriod: 'monthly', carryover: 0, lastRolloverPeriod: null };
}

export function getCategories() {
  const list = read(KEYS.categories, DEFAULT_CATEGORIES);
  const upgraded = list.map(migrateCategoryShape);
  if (upgraded.some((c, i) => c !== list[i])) write(KEYS.categories, upgraded);
  return upgraded;
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
  const cat = { id: uid(), name: name.trim(), icon, color, budgetAmount: null, budgetPeriod: 'monthly', carryover: 0, lastRolloverPeriod: null };
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
  syncGrocerySpend();
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
  syncGrocerySpend();
}

/** Veroeffentlicht den aktuellen Monatsbetrag der Kategorie "Lebensmittel"
 *  fuer Meal Plannings Kosten-Abgleich (E52). Kategorie-Id 'groceries' ist
 *  Teil der Standard-Kategorien und wird nie umbenannt/geloescht (deleteCategory
 *  verweigert das Loeschen von 'other', 'groceries' selbst kann der Nutzer
 *  aber theoretisch entfernen - in dem Fall wird einfach 0 veroeffentlicht). */
function syncGrocerySpend() {
  const month = monthKey();
  const amount = monthlySpendByCategory(month).groceries || 0;
  publishGrocerySpend(month, amount);
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

/** Einnahmen-Pendant zu ensureNextRecurringOccurrence() (Ausgaben) - gleiches
 *  Vorausplanungs-Prinzip, nur nach `source` statt `merchant`/`categoryId`
 *  gruppiert, da Einnahmen keine Kategorie haben. */
export function ensureNextRecurringIncomeOccurrence(income) {
  if (!income.recurring) return null;
  const interval = income.recurringInterval || 'monthly';
  const key = (income.source || '').trim().toLowerCase();
  const nextDue = addIntervalToDateKey(income.date, interval);
  const alreadyExists = getIncome().some((i) => i.date === nextDue && (i.source || '').trim().toLowerCase() === key);
  if (alreadyExists) return null;
  return createIncome({ source: income.source, amount: income.amount, date: nextDue, recurring: true, recurringInterval: interval, note: income.note });
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

/** Summe je Kategorie fuer einen beliebigen Datumsbereich (inklusive beider
 *  Enden) - Grundlage fuer die "letzte Woche"-Statistik, die anders als der
 *  Monatsvergleich nicht an Kalendermonatsgrenzen gebunden ist. */
export function spendByCategoryInRange(startDate, endDate) {
  const sums = {};
  for (const e of getExpenses()) {
    if (e.date < startDate || e.date > endDate) continue;
    sums[e.categoryId] = (sums[e.categoryId] || 0) + e.amount;
  }
  return sums;
}

export function monthTotal(yearMonth) {
  return getExpensesForMonth(yearMonth).reduce((sum, e) => sum + e.amount, 0);
}

/* =========================================================
   Woechentliche/monatliche Budgets mit Uebertrag (E62) - jede Kategorie
   waehlt ihre eigene Periode (Woche oder Monat). Der Uebertrag (+/-) aus
   der VORHERIGEN Periode fliesst als carryover in die aktuelle ein, sodass
   Unterschreitung/Ueberschreitung sich Periode fuer Periode fortsetzt, statt
   am Periodenende einfach zu verfallen.
   ========================================================= */

function periodKeyFor(category, dateKey = todayKey()) {
  return category.budgetPeriod === 'weekly' ? mondayOfWeekKey(dateKey) : monthKey(dateKey);
}

function nextPeriodKey(category, periodKey) {
  return category.budgetPeriod === 'weekly' ? addDaysToDateKey(periodKey, 7) : addMonths(periodKey, 1);
}

function spentInPeriod(category, periodKey) {
  const expenses = getExpenses().filter((e) => e.categoryId === category.id);
  if (category.budgetPeriod === 'weekly') {
    const end = addDaysToDateKey(periodKey, 6);
    return expenses.filter((e) => e.date >= periodKey && e.date <= end).reduce((sum, e) => sum + e.amount, 0);
  }
  return expenses.filter((e) => monthKey(e.date) === periodKey).reduce((sum, e) => sum + e.amount, 0);
}

/** Wandert den Uebertrag jeder budgetierten Kategorie bis zur aktuellen
 *  Periode nach - unconditionally auf jedem App-Start aufgerufen, gleiches
 *  Muster wie accrueEnvelopes() (E20).
 *
 *  WICHTIG (Bugfix): rechnet den kompletten Zeitraum ab budgetStartPeriod bis
 *  zur aktuellen Periode bei JEDEM Aufruf komplett aus den LIVE-Ausgaben neu
 *  durch, statt sich inkrementell auf einem Wasserzeichen (frueher
 *  lastRolloverPeriod) auszuruhen. Die fruehere Version hat bereits "abgehakte"
 *  Vormonate nie wieder angefasst - eine nachtraeglich erfasste oder
 *  geaenderte Ausgabe in einem laengst ueberrollten Monat floss dadurch nie in
 *  den Uebertrag ein (dauerhaft falscher Saldo, nichts hat das je repariert).
 *  Voller Replay bei jedem Aufruf ist fuer die hier realistische Anzahl an
 *  Perioden (Monate/Wochen) und Ausgaben trivial billig.
 *
 *  budgetStartPeriod markiert den Ausgangspunkt, ab dem ueberhaupt Uebertrag
 *  getrackt wird - wird einmalig beim Aktivieren eines Budget-Limits gesetzt
 *  und danach NIE wieder veraendert (kein rueckwirkender Uebertrag fuer davor
 *  erfunden). Migration von Kategorien aus der alten Wasserzeichen-Logik:
 *  deren vorhandenes lastRolloverPeriod/carryover-Paar wird 1:1 als
 *  Ausgangspunkt uebernommen, statt eine moeglicherweise sehr lange Historie
 *  rueckwirkend neu zu erfinden. Ein Schutzzaehler verhindert eine
 *  Endlosschleife bei defekten/sehr alten Datumswerten. */
export function applyBudgetRollovers() {
  const categories = getCategories();
  let changed = false;
  const today = todayKey();
  const updated = categories.map((c) => {
    if (!c.budgetAmount || c.budgetAmount <= 0) return c;
    const currentPeriod = periodKeyFor(c, today);
    let startPeriod = c.budgetStartPeriod;
    let startCarryover = c.budgetStartCarryover || 0;
    if (!startPeriod) {
      startPeriod = c.lastRolloverPeriod || currentPeriod;
      startCarryover = c.carryover || 0;
    }

    let periodCursor = startPeriod;
    let carryover = startCarryover;
    let guard = 0;
    while (periodCursor !== currentPeriod && guard < 600) {
      const spent = spentInPeriod(c, periodCursor);
      const effectiveBudget = c.budgetAmount + carryover;
      carryover = effectiveBudget - spent;
      periodCursor = nextPeriodKey(c, periodCursor);
      guard++;
    }

    if (carryover !== c.carryover || currentPeriod !== c.lastRolloverPeriod
      || startPeriod !== c.budgetStartPeriod || startCarryover !== c.budgetStartCarryover) changed = true;
    return { ...c, budgetStartPeriod: startPeriod, budgetStartCarryover: startCarryover, carryover, lastRolloverPeriod: currentPeriod };
  });
  if (changed) write(KEYS.categories, updated);
}

/**
 * Ampel-Status einer Kategorie fuer ihre aktuelle Periode (Woche oder Monat,
 * je nach category.budgetPeriod) - inklusive Uebertrag aus der Vorperiode.
 * @returns {{spent:number, budget:number|null, pct:number|null, level:'ok'|'warn'|'over'|'nolimit', carryover:number}}
 */
export function budgetStatus(category) {
  const periodKey = periodKeyFor(category);
  const spent = spentInPeriod(category, periodKey);
  const budget = category.budgetAmount;
  if (!budget || budget <= 0) return { spent, budget: null, pct: null, level: 'nolimit', carryover: 0 };
  const carryover = category.carryover || 0;
  const effectiveBudget = budget + carryover;
  const pct = effectiveBudget > 0 ? spent / effectiveBudget : (spent > 0 ? 1 : 0);
  const level = pct >= 1 ? 'over' : pct >= 0.8 ? 'warn' : 'ok';
  return { spent, budget: effectiveBudget, pct, level, carryover };
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

/** Legt fuer EINE konkrete wiederkehrende Ausgabe die naechste Faelligkeit
 *  an, falls sie noch nicht existiert - unabhaengig davon, ob dieses Datum
 *  bereits erreicht ist oder noch in der Zukunft liegt. Wird direkt beim
 *  Speichern jeder wiederkehrenden Ausgabe aufgerufen (expenses.js), damit
 *  der naechste Zyklus IMMER schon vorab (vorausschauend, mit einem in dem
 *  Moment noch zukuenftigen Datum) existiert, statt erst nachtraeglich beim
 *  naechsten App-Start rueckwirkend nachgetragen zu werden, sobald er schon
 *  faellig/ueberfaellig ist - genau das wurde als falsch empfunden ("dieser
 *  Eintrag der in der Vergangenheit liegt sollte nicht existieren"): eine
 *  wiederkehrende Ausgabe soll an ihrem Datum erscheinen, weil sie LANGE
 *  VORHER schon dafuer eingeplant wurde, nicht weil sie nachtraeglich
 *  rueckwirkend erfunden wird. Gibt die neu angelegte Ausgabe zurueck, oder
 *  null wenn die naechste Faelligkeit schon existierte. */
export function ensureNextRecurringOccurrence(expense) {
  if (!expense.recurring) return null;
  const interval = expense.recurringInterval || 'monthly';
  const key = (expense.merchant || '').trim().toLowerCase() || `kategorie:${expense.categoryId}`;
  const nextDue = addIntervalToDateKey(expense.date, interval);
  const alreadyExists = getExpenses().some((e) => {
    if (e.date !== nextDue) return false;
    const eKey = (e.merchant || '').trim().toLowerCase() || `kategorie:${e.categoryId}`;
    return eKey === key;
  });
  if (alreadyExists) return null;
  return createExpense({
    merchant: expense.merchant, amount: expense.amount, categoryId: expense.categoryId,
    date: nextDue, recurring: true, recurringInterval: interval, note: expense.note,
  });
}

/** Sicherheitsnetz beim App-Start: verlaesst sich in der ueblichen Nutzung
 *  (App regelmaessig geoeffnet) NICHT darauf, faellige Folgeeintraege selbst
 *  nachzutragen - das erledigt ensureNextRecurringOccurrence() bereits
 *  vorausschauend beim Speichern jeder Ausgabe. Faengt nur den Fall ab, dass
 *  die App laengere Zeit gar nicht geoeffnet wurde (oder Daten aus der Zeit
 *  vor diesem Feature importiert wurden) und deshalb mehrere Monate
 *  nachzuholen sind (Schutzzaehler gegen Endlosschleife bei kaputten
 *  Datumswerten). */
export function applyRecurringExpenses() {
  const recurring = getExpenses().filter((e) => e.recurring);
  const groups = new Map();
  for (const e of recurring) {
    const key = e.merchant.trim().toLowerCase() || `kategorie:${e.categoryId}`;
    const current = groups.get(key);
    if (!current || current.date < e.date) groups.set(key, e);
  }
  const today = todayKey();
  let created = false;
  for (let latest of groups.values()) {
    let guard = 0;
    // Nur nachholen, solange der bisher letzte bekannte Eintrag schon
    // faellig/ueberfaellig ist (<=today) - sobald er selbst in der Zukunft
    // liegt, ist bereits (mindestens) ein Zyklus vorausgeplant und die
    // Schleife stoppt, statt unbegrenzt weit im Voraus zu produzieren.
    while (latest.date <= today && guard < 60) {
      const next = ensureNextRecurringOccurrence(latest);
      if (!next) break;
      latest = next;
      created = true;
      guard++;
    }
  }
  return created;
}

/** Einnahmen-Pendant zu applyRecurringExpenses() - gleiches Sicherheitsnetz-Prinzip. */
export function applyRecurringIncome() {
  const recurring = getIncome().filter((i) => i.recurring);
  const groups = new Map();
  for (const i of recurring) {
    const key = i.source.trim().toLowerCase();
    const current = groups.get(key);
    if (!current || current.date < i.date) groups.set(key, i);
  }
  const today = todayKey();
  let created = false;
  for (let latest of groups.values()) {
    let guard = 0;
    while (latest.date <= today && guard < 60) {
      const next = ensureNextRecurringIncomeOccurrence(latest);
      if (!next) break;
      latest = next;
      created = true;
      guard++;
    }
  }
  return created;
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
