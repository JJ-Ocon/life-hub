// Persistenz-Schicht: alles in localStorage, bleibt lokal auf dem Geraet.
//
// Sensibelster Datensatz im gesamten Oekosystem (Stimmungsdaten, Freitext-
// Reflexionen). Bewusst noch UNVERSCHLUESSELT wie fast alle anderen Apps -
// aber als erster Kandidat fuer eine spaetere Verschluesselung markiert,
// sobald der Bedarf entsteht. Das Muster dafuer existiert bereits im
// Digitalen Safe (safety/js/crypto.js: PBKDF2 + AES-GCM, Passphrase nie
// persistiert) und liesse sich hier unveraendert uebernehmen, ohne das
// Datenmodell unten anzufassen - einfach db.js um dieselbe Vault-Huelle
// erweitern, wie es dort gemacht wurde.

import { uid, nowIso, todayKey, addDaysToDateKey, daysBetweenDateKeys } from './utils.js';

const KEYS = {
  entries: 'dy_entries_v1',
  settings: 'dy_settings_v1',
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

export const SUGGESTED_TAGS = [
  'gestresst', 'gut geschlafen', 'schlecht geschlafen', 'sozialer Tag', 'allein',
  'produktiv', 'erschöpft', 'krank', 'bewegt', 'entspannt',
];

const REFLECTION_QUESTIONS = [
  'Was hat dich heute zum Lächeln gebracht?',
  'Wofür bist du heute dankbar?',
  'Was hat dich heute am meisten gefordert?',
  'Was würdest du morgen gerne anders machen?',
  'Was hast du heute über dich gelernt?',
  'Wem bist du heute begegnet, der/die dir gutgetan hat?',
  'Was hat heute mehr Energie gekostet, als es sollte?',
  'Welcher Moment heute war der beste?',
  'Was brauchst du gerade am meisten?',
  'Worauf freust du dich morgen?',
  'Wie hat sich dein Körper heute angefühlt?',
  'Was hast du heute für dich selbst getan?',
];

/** Rotiert deterministisch nach Tag im Jahr, damit dieselbe Frage nicht taeglich wiederkehrt, aber am selben Tag stabil bleibt. */
export function reflectionQuestionFor(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dayOfYear = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 86400000);
  return REFLECTION_QUESTIONS[dayOfYear % REFLECTION_QUESTIONS.length];
}

/* =========================================================
   Eintraege – ein Eintrag pro Tag (Datum ist der Schluessel).
   Kein Kalender-Mirror (bewusst): taegliche Stimmungs-Check-ins waeren
   hochfrequent wie die Uebe-Sessions der Lernen-App - kein sinnvolles
   Einzeldatum zum Spiegeln.
   ========================================================= */
// Entry: { id, date (YYYY-MM-DD), mood (1-10), tags: string[], note,
//          reflectionQuestion, reflectionAnswer, createdAt, updatedAt }

export function getEntries() {
  return read(KEYS.entries, []).sort((a, b) => b.date.localeCompare(a.date));
}

export function getEntryByDate(dateKey) {
  return read(KEYS.entries, []).find((e) => e.date === dateKey) || null;
}

export function saveEntry(fields) {
  const list = read(KEYS.entries, []);
  const idx = list.findIndex((e) => e.date === fields.date);
  const base = idx >= 0 ? list[idx] : { id: uid(), createdAt: nowIso() };
  const entry = {
    ...base,
    date: fields.date, mood: fields.mood, tags: fields.tags || [],
    note: fields.note || '', reflectionQuestion: fields.reflectionQuestion || '',
    reflectionAnswer: fields.reflectionAnswer || '', updatedAt: nowIso(),
  };
  if (idx >= 0) list[idx] = entry; else list.push(entry);
  write(KEYS.entries, list);
  return entry;
}

export function deleteEntry(id) {
  write(KEYS.entries, read(KEYS.entries, []).filter((e) => e.id !== id));
}

/** Aktueller Streak in Tagen (aufeinanderfolgende Tage mit Eintrag, endend heute oder gestern). */
export function currentStreak() {
  const dates = [...new Set(read(KEYS.entries, []).map((e) => e.date))].sort().reverse();
  if (dates.length === 0) return 0;
  const today = todayKey();
  let expected = dates[0] === today ? today : (daysBetweenDateKeys(dates[0], today) === 1 ? dates[0] : null);
  if (!expected) return 0;
  let streak = 0;
  for (const d of dates) {
    if (d === expected) {
      streak += 1;
      expected = addDaysToDateKey(expected, -1);
    } else if (d < expected) {
      break;
    }
  }
  return streak;
}

/**
 * Sanfter Hinweis, wenn die Stimmung ueber die letzten Tage durchgaengig
 * niedrig war - kein Ersatz fuer professionelle Hilfe, nur ein
 * nicht bevormundender Fingerzeig. Braucht mindestens 5 Eintraege in den
 * letzten 7 Tagen, um Fehlalarme bei duenner Datenlage zu vermeiden.
 */
export function shouldShowSupportHint() {
  const today = todayKey();
  const windowStart = addDaysToDateKey(today, -6);
  const recent = read(KEYS.entries, []).filter((e) => e.date >= windowStart && e.date <= today);
  if (recent.length < 5) return false;
  const avg = recent.reduce((sum, e) => sum + e.mood, 0) / recent.length;
  return avg <= 3.5;
}

/* ---------- Einstellungen ---------- */
const DEFAULT_SETTINGS = { theme: 'dark', accentHue: 275 };

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
    entries: read(KEYS.entries, []),
    settings: getSettings(),
  };
}

export function importAllData(data) {
  if (data.entries) write(KEYS.entries, data.entries);
  if (data.settings) write(KEYS.settings, data.settings);
}

export function resetAllData() {
  localStorage.removeItem(KEYS.entries);
  localStorage.removeItem(KEYS.settings);
}
