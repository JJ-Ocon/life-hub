// Persistenz-Schicht: alles in localStorage, bleibt lokal auf dem Geraet.

import { uid, nowIso, todayKey, addDaysToDateKey, mondayOfWeekKey, daysBetweenDateKeys } from './utils.js';

const KEYS = {
  skills: 'lr_skills_v1',
  sessions: 'lr_sessions_v1',
  settings: 'lr_settings_v1',
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
  { key: 'sprache', label: 'Sprache' },
  { key: 'instrument', label: 'Instrument' },
  { key: 'programmieren', label: 'Programmieren' },
  { key: 'sport', label: 'Sport' },
  { key: 'handwerk', label: 'Handwerk' },
  { key: 'sonstiges', label: 'Sonstiges' },
];

export function categoryLabel(key) {
  return CATEGORIES.find((c) => c.key === key)?.label || 'Sonstiges';
}

/* =========================================================
   Skills – was gelernt/geuebt wird, optional mit woechentlichem
   Zeitziel. Keine Kalender-Spiegelung (bewusst): Uebe-Erinnerungen
   waeren taeglich/hochfrequent wie das Giessen im Haushalt - kein
   sinnvolles einzelnes Fristdatum zum Spiegeln.
   ========================================================= */
// Skill: { id, name, category, note, targetMinutesPerWeek (optional), createdAt }

export function getSkills() {
  return read(KEYS.skills, []).sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

export function getSkillById(id) {
  return read(KEYS.skills, []).find((s) => s.id === id) || null;
}

export function saveSkill(skill) {
  const list = read(KEYS.skills, []);
  const idx = list.findIndex((s) => s.id === skill.id);
  if (idx >= 0) list[idx] = skill; else list.push(skill);
  write(KEYS.skills, list);
  return skill;
}

export function createSkill(fields) {
  return saveSkill({
    id: uid(), name: fields.name, category: fields.category || 'sonstiges',
    note: fields.note || '', targetMinutesPerWeek: fields.targetMinutesPerWeek || null,
    createdAt: nowIso(),
  });
}

export function deleteSkill(id) {
  write(KEYS.skills, read(KEYS.skills, []).filter((s) => s.id !== id));
  write(KEYS.sessions, read(KEYS.sessions, []).filter((s) => s.skillId !== id));
}

/* =========================================================
   Sessions – geloggte Uebungszeit pro Skill.
   ========================================================= */
// Session: { id, skillId, date (YYYY-MM-DD), durationMinutes, note, createdAt }

export function getSessions(skillId = null) {
  const all = read(KEYS.sessions, []);
  const filtered = skillId ? all.filter((s) => s.skillId === skillId) : all;
  return filtered.slice().sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

export function logSession(fields) {
  const list = read(KEYS.sessions, []);
  list.push({
    id: uid(), skillId: fields.skillId, date: fields.date || todayKey(),
    durationMinutes: fields.durationMinutes || 0, note: fields.note || '', createdAt: nowIso(),
  });
  write(KEYS.sessions, list);
}

export function deleteSession(id) {
  write(KEYS.sessions, read(KEYS.sessions, []).filter((s) => s.id !== id));
}

/** Minuten, die in der Kalenderwoche von weekMondayKey fuer diesen Skill geloggt wurden. */
export function weeklyMinutes(skillId, weekMondayKey = mondayOfWeekKey(todayKey())) {
  const weekEnd = addDaysToDateKey(weekMondayKey, 6);
  return getSessions(skillId)
    .filter((s) => s.date >= weekMondayKey && s.date <= weekEnd)
    .reduce((sum, s) => sum + s.durationMinutes, 0);
}

export function totalMinutes(skillId) {
  return getSessions(skillId).reduce((sum, s) => sum + s.durationMinutes, 0);
}

/** Aktueller Streak in Tagen (aufeinanderfolgende Tage mit mind. einer Session, endend heute oder gestern). */
export function currentStreak(skillId) {
  const dates = [...new Set(getSessions(skillId).map((s) => s.date))].sort().reverse();
  if (dates.length === 0) return 0;
  const today = todayKey();
  let cursor = dates[0] === today ? today : (daysBetweenDateKeys(dates[0], today) === 1 ? dates[0] : null);
  if (!cursor) return 0;
  let streak = 0;
  let expected = cursor;
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

/* ---------- Einstellungen ---------- */
const DEFAULT_SETTINGS = { theme: 'dark', accentHue: 258 };

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
    skills: read(KEYS.skills, []),
    sessions: read(KEYS.sessions, []),
    settings: getSettings(),
  };
}

export function importAllData(data) {
  if (data.skills) write(KEYS.skills, data.skills);
  if (data.sessions) write(KEYS.sessions, data.sessions);
  if (data.settings) write(KEYS.settings, data.settings);
}

export function resetAllData() {
  localStorage.removeItem(KEYS.skills);
  localStorage.removeItem(KEYS.sessions);
  localStorage.removeItem(KEYS.settings);
}
