// Persistenz-Schicht: alles in localStorage, bleibt lokal auf dem Geraet.

import { uid, nowIso, addDaysToDateKey, addMonthsToDateKey, addYearsToDateKey, todayKey, mondayOfWeekKey, daysBetweenDateKeys } from './utils.js';
import { createCalendarEvent } from '../../shared/calendar-schema.js';
import { replaceSourceEvents } from '../../shared/event-store.js';

const KEYS = {
  goals: 'gl_goals_v1',
  milestones: 'gl_milestones_v1',
  todos: 'gl_todos_v1',
  settings: 'gl_settings_v1',
  skills: 'gl_skills_v1',
  sessions: 'gl_sessions_v1',
  learningPlans: 'gl_learning_plans_v1',
  migrated: 'gl_learning_migrated_v1',
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

/** Einmalige Uebernahme von Lernens Altdaten (E58: Lernen-App in Ziele/Todo
 *  integriert) - laeuft beim ersten Laden nach dem Merge, kopiert lr_*-
 *  Schluessel unter dem neuen gl_*-Namensraum, ruehrt die alten Schluessel
 *  selbst nicht an (falls die alte App-Seite noch irgendwo verlinkt ist,
 *  bleiben ihre Daten unveraendert lesbar). Idempotent ueber ein eigenes
 *  Merker-Flag, damit ein spaeteres manuelles Loeschen der gl_*-Daten nicht
 *  versehentlich die alten lr_*-Daten erneut hereinkopiert. */
function migrateLearningDataIfNeeded() {
  if (read(KEYS.migrated, false)) return;
  try {
    const oldSkills = localStorage.getItem('lr_skills_v1');
    const oldSessions = localStorage.getItem('lr_sessions_v1');
    if (oldSkills) write(KEYS.skills, JSON.parse(oldSkills));
    if (oldSessions) write(KEYS.sessions, JSON.parse(oldSessions));
  } catch {
    // Fehlerhafte Altdaten sollen den Merge nicht blockieren.
  }
  write(KEYS.migrated, true);
}
migrateLearningDataIfNeeded();

/* =========================================================
   Ziele + Meilensteine
   Hierarchie: Ziel -> Meilensteine -> (optional verknuepfte) Todos.
   Der Fortschritt eines Ziels wird ausschliesslich aus seinen
   Meilensteinen berechnet (erledigt vs. offen).
   ========================================================= */
// Goal: { id, title, note, createdAt }
// Milestone: { id, goalId, title, done, createdAt }

export function getGoals() {
  return read(KEYS.goals, []);
}

export function getGoalById(id) {
  return getGoals().find((g) => g.id === id) || null;
}

export function saveGoal(goal) {
  const list = getGoals();
  const idx = list.findIndex((g) => g.id === goal.id);
  if (idx >= 0) list[idx] = goal; else list.push(goal);
  write(KEYS.goals, list);
  return goal;
}

export function createGoal(title, note = '') {
  return saveGoal({ id: uid(), title, note, createdAt: nowIso() });
}

export function deleteGoal(id) {
  write(KEYS.goals, getGoals().filter((g) => g.id !== id));
  write(KEYS.milestones, getMilestones().filter((m) => m.goalId !== id));
  // Verknuepfte Todos bleiben erhalten, verlieren nur die Ziel-Verknuepfung.
  write(KEYS.todos, getTodos().map((t) => (t.goalId === id ? { ...t, goalId: null } : t)));
}

export function getMilestones() {
  return read(KEYS.milestones, []);
}

export function getMilestonesForGoal(goalId) {
  return getMilestones().filter((m) => m.goalId === goalId);
}

export function saveMilestone(milestone) {
  const list = getMilestones();
  const idx = list.findIndex((m) => m.id === milestone.id);
  if (idx >= 0) list[idx] = milestone; else list.push(milestone);
  write(KEYS.milestones, list);
  return milestone;
}

export function createMilestone(goalId, title) {
  return saveMilestone({ id: uid(), goalId, title, done: false, createdAt: nowIso() });
}

export function toggleMilestone(id) {
  const m = getMilestones().find((x) => x.id === id);
  if (m) saveMilestone({ ...m, done: !m.done });
}

export function deleteMilestone(id) {
  write(KEYS.milestones, getMilestones().filter((m) => m.id !== id));
}

/** Fortschritt eines Ziels (0-1) aus erledigten/offenen Meilensteinen, oder
 *  null, wenn das Ziel noch keine Meilensteine hat. */
export function goalProgress(goalId) {
  const milestones = getMilestonesForGoal(goalId);
  if (!milestones.length) return null;
  const done = milestones.filter((m) => m.done).length;
  return done / milestones.length;
}

/* =========================================================
   Todos
   ========================================================= */
// Todo: { id, title, dueDate (YYYY-MM-DD|null), startTime (HH:MM|null), endTime (HH:MM|null),
//         done, goalId (optional),
//         repeat ({freq:'daily'|'weekly'|'monthly'|'yearly'|'custom', intervalDays?} | null),
//         createdAt }
// startTime/endTime sind bewusst nur bei gesetztem dueDate sinnvoll und optional -
// ein Todo ohne Uhrzeit gilt automatisch als flexibel (siehe shared/event-store.js's
// findConflictingEvents) und wird nie als Terminkonflikt markiert.

export const REPEAT_FREQUENCIES = [
  { key: 'daily', label: 'Täglich' },
  { key: 'weekly', label: 'Wöchentlich' },
  { key: 'monthly', label: 'Monatlich' },
  { key: 'yearly', label: 'Jährlich' },
  { key: 'custom', label: 'Benutzerdefiniert' },
];

export function repeatLabel(repeat) {
  if (!repeat) return null;
  if (repeat.freq === 'custom') return `Alle ${repeat.intervalDays || 1} Tage`;
  return REPEAT_FREQUENCIES.find((f) => f.key === repeat.freq)?.label || null;
}

/** Naechstes Faelligkeitsdatum ausgehend vom aktuellen, nach Wiederholungsregel. */
export function nextRepeatDate(dateKey, repeat) {
  if (!repeat || !dateKey) return null;
  switch (repeat.freq) {
    case 'daily': return addDaysToDateKey(dateKey, 1);
    case 'weekly': return addDaysToDateKey(dateKey, 7);
    case 'monthly': return addMonthsToDateKey(dateKey, 1);
    case 'yearly': return addYearsToDateKey(dateKey, 1);
    case 'custom': return addDaysToDateKey(dateKey, Math.max(1, Number(repeat.intervalDays) || 1));
    default: return null;
  }
}

export function getTodos() {
  return read(KEYS.todos, []);
}

export function getTodoById(id) {
  return getTodos().find((t) => t.id === id) || null;
}

/** Offene zuerst (nach Faelligkeit sortiert, ohne Datum ans Ende), dann erledigte. */
export function getTodosSorted() {
  const todos = getTodos();
  const open = todos.filter((t) => !t.done).sort((a, b) => {
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return b.createdAt.localeCompare(a.createdAt);
  });
  const done = todos.filter((t) => t.done).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return [...open, ...done];
}

export function saveTodo(todo) {
  const list = getTodos();
  const idx = list.findIndex((t) => t.id === todo.id);
  if (idx >= 0) list[idx] = todo; else list.push(todo);
  write(KEYS.todos, list);
  refreshSharedCalendarMirror();
  return todo;
}

export function createTodo(fields) {
  const todo = {
    id: uid(),
    title: fields.title,
    dueDate: fields.dueDate || null,
    startTime: fields.dueDate ? (fields.startTime || null) : null,
    endTime: fields.dueDate ? (fields.endTime || null) : null,
    done: false,
    order: fields.order ?? null, // manuelle Reihenfolge (E-Todo-Reorder) - null = wie bisher nach Faelligkeit/Erstellzeit
    subtasks: fields.subtasks || [],
    goalId: fields.goalId || null,
    repeat: fields.repeat || null,
    createdAt: nowIso(),
  };
  return saveTodo(todo);
}

/** Beim Erledigen eines wiederkehrenden Todos mit Faelligkeitsdatum wird
 *  direkt die naechste Instanz angelegt (Datum ausgehend vom bisherigen
 *  Faelligkeitsdatum fortgeschrieben, nicht vom heutigen - so bleibt z.B.
 *  ein woechentliches Todo immer auf demselben Wochentag). */
export function toggleTodo(id) {
  const t = getTodos().find((x) => x.id === id);
  if (!t) return;
  const wasDone = t.done;
  // Hat das Todo Untertasks (E-Todo-Subtasks), setzt ein Tap auf die
  // Haupt-Checkbox ALLE Untertasks mit auf denselben Zustand - done bleibt
  // dadurch weiterhin der abgeleitete Wert (alle Untertasks abgehakt),
  // erlaubt aber trotzdem den schnellen Ein-Klick-Weg, alles auf einmal
  // (ab)zuhaken, statt jede Untertask einzeln antippen zu muessen.
  const subtasks = (t.subtasks || []).length
    ? t.subtasks.map((s) => ({ ...s, done: !wasDone }))
    : t.subtasks;
  saveTodo({ ...t, done: !wasDone, subtasks });
  if (!wasDone && t.repeat && t.dueDate) {
    const nextDate = nextRepeatDate(t.dueDate, t.repeat);
    if (nextDate) createTodo({ title: t.title, dueDate: nextDate, goalId: t.goalId, repeat: t.repeat });
  }
}

export function deleteTodo(id) {
  write(KEYS.todos, getTodos().filter((t) => t.id !== id));
  refreshSharedCalendarMirror();
}

/* =========================================================
   Untertasks (E-Todo-Subtasks) - ein Todo mit Untertasks gilt automatisch
   als erledigt, sobald alle seine Untertasks abgehakt sind; die Haupt-Todo
   selbst bleibt weiterhin die "Ueberschrift" (Titel, Faelligkeit, Ziel,
   Wiederholung), Untertasks tragen nur einen Titel + erledigt-Status.
   ========================================================= */
// Subtask: { id, title, done }

function syncTodoDoneFromSubtasks(t) {
  if (!t.subtasks?.length) return t;
  return { ...t, done: t.subtasks.every((s) => s.done) };
}

export function addSubtask(todoId, title) {
  const t = getTodoById(todoId);
  if (!t) return;
  const subtasks = [...(t.subtasks || []), { id: uid(), title, done: false }];
  saveTodo(syncTodoDoneFromSubtasks({ ...t, subtasks }));
}

export function removeSubtask(todoId, subtaskId) {
  const t = getTodoById(todoId);
  if (!t) return;
  const subtasks = (t.subtasks || []).filter((s) => s.id !== subtaskId);
  saveTodo(syncTodoDoneFromSubtasks({ ...t, subtasks }));
}

export function toggleSubtask(todoId, subtaskId) {
  const t = getTodoById(todoId);
  if (!t) return;
  const subtasks = (t.subtasks || []).map((s) => (s.id === subtaskId ? { ...s, done: !s.done } : s));
  saveTodo(syncTodoDoneFromSubtasks({ ...t, subtasks }));
}

/**
 * Spiegelt Todos mit Faelligkeitsdatum, Kurs-Deadlines und Lernplaene (E58)
 * gemeinsam unter der einen Quelle 'goals' in den geteilten Kalender-Event-
 * Store, damit sie im Hub-Kalender auftauchen. Alle drei zusammen in einer
 * Funktion, da replaceSourceEvents() je Quelle immer ALLE bisherigen Events
 * ersetzt - zwei getrennte Funktionen unter derselben Quelle wuerden sich
 * gegenseitig die Eintraege wegloeschen.
 */
export async function refreshSharedCalendarMirror() {
  try {
    const events = getTodos()
      .filter((t) => t.dueDate)
      .map((t) => createCalendarEvent({
        id: `goals-todo-${t.id}`,
        title: t.done ? `✓ ${t.title}` : t.title,
        start: t.startTime ? `${t.dueDate}T${t.startTime}` : t.dueDate,
        end: t.endTime ? `${t.dueDate}T${t.endTime}` : null,
        source: 'goals',
        link: '#/',
      }));
    for (const s of read(KEYS.skills, [])) {
      if (s.type === 'course' && s.deadlineDate) {
        events.push(createCalendarEvent({ id: `goals-course-${s.id}`, title: `Kurs-Deadline: ${s.name}`, start: s.deadlineDate, source: 'goals', link: `#/learning` }));
      }
    }
    for (const plan of read(KEYS.learningPlans, [])) {
      const skill = getSkillById(plan.skillId);
      if (!skill) continue;
      for (const dateKey of upcomingLearningPlanDates(plan)) {
        events.push(createCalendarEvent({ id: `goals-learnplan-${plan.id}-${dateKey}`, title: `📚 ${skill.name}`, start: dateKey, source: 'goals', link: '#/calendar' }));
      }
    }
    await replaceSourceEvents('goals', events);
  } catch {
    // Shared Storage ist ein optionales Extra, kein Kernfeature.
  }
}

/** Inline-Bearbeitung eines gespiegelten Termins direkt aus dem Hub-Kalender
 *  heraus (E-Hub-Edit-Cross-App): nur "goals-todo-*" ist ein direkt
 *  editierbares Einzel-Entity (Titel/Datum/Zeit sind rohe Todo-Felder) -
 *  Kurs-Deadlines und Lernplan-Termine sind aus anderen Feldern abgeleitet
 *  und bleiben bewusst nur ueber "Weiterleiten" erreichbar. */
export function getCalendarEditableEntity(eventId) {
  const m = eventId.match(/^goals-todo-(.+)$/);
  if (!m) return null;
  const todo = getTodoById(m[1]);
  if (!todo) return null;
  return { title: todo.title, date: todo.dueDate, time: todo.startTime || '', endTime: todo.endTime || '' };
}

export function applyCalendarEdit(eventId, patch) {
  const m = eventId.match(/^goals-todo-(.+)$/);
  if (!m) return false;
  const todo = getTodoById(m[1]);
  if (!todo) return false;
  saveTodo({
    ...todo,
    title: patch.title,
    dueDate: patch.date,
    startTime: patch.time || null,
    endTime: patch.date && patch.time ? (patch.endTime || null) : null,
  });
  return true;
}

/* =========================================================
   Lernen (E58: aus der frueheren eigenstaendigen Lernen-App integriert) -
   Skills mit optionalem woechentlichem Zeitziel, Sessions als geloggte
   Uebungszeit. Datenmodell 1:1 uebernommen, nur der localStorage-
   Namensraum ist neu (gl_* statt lr_*).
   ========================================================= */
// Skill: { id, name, category, type ('generic'|'book'|'course'), note,
//          targetMinutesPerWeek (optional), totalPages (optional, nur 'book'),
//          progressPercent (optional, nur 'course'),
//          deadlineDate (YYYY-MM-DD|null, nur 'course'), createdAt }
// Session: { id, skillId, date, durationMinutes, pageAt (optional), note, createdAt }

export const CATEGORIES = [
  { key: 'sprache', label: 'Sprache' },
  { key: 'instrument', label: 'Instrument' },
  { key: 'programmieren', label: 'Programmieren' },
  { key: 'sport', label: 'Sport' },
  { key: 'handwerk', label: 'Handwerk' },
  { key: 'sonstiges', label: 'Sonstiges' },
];

export function categoryLabel(category) {
  return CATEGORIES.find((c) => c.key === category)?.label || category || 'Sonstiges';
}

export function getCategories() {
  const set = new Set(read(KEYS.skills, []).map((s) => categoryLabel(s.category)));
  return [...set].sort((a, b) => a.localeCompare(b, 'de'));
}

export const SKILL_TYPES = [
  { key: 'generic', label: 'Allgemein' },
  { key: 'book', label: 'Buch' },
  { key: 'course', label: 'Kurs' },
];

export function skillTypeLabel(type) {
  return SKILL_TYPES.find((t) => t.key === type)?.label || 'Allgemein';
}

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
  refreshSharedCalendarMirror();
  return skill;
}

export function createSkill(fields) {
  return saveSkill({
    id: uid(), name: fields.name, category: fields.category || 'Sonstiges',
    type: fields.type || 'generic',
    note: fields.note || '', targetMinutesPerWeek: fields.targetMinutesPerWeek || null,
    totalPages: fields.totalPages || null,
    progressPercent: fields.progressPercent ?? null,
    deadlineDate: fields.deadlineDate || null,
    createdAt: nowIso(),
  });
}

export function deleteSkill(id) {
  write(KEYS.skills, read(KEYS.skills, []).filter((s) => s.id !== id));
  write(KEYS.sessions, read(KEYS.sessions, []).filter((s) => s.skillId !== id));
  write(KEYS.learningPlans, read(KEYS.learningPlans, []).filter((p) => p.skillId !== id));
  refreshSharedCalendarMirror();
}

/** Leseforschritt eines Buch-Skills (0-1), aus der zuletzt geloggten Seite
 *  gegen die Gesamtseitenzahl - null wenn nicht berechenbar. */
export function bookProgress(skill) {
  if (skill.type !== 'book' || !skill.totalPages) return null;
  const latest = getSessions(skill.id).find((s) => s.pageAt != null);
  if (!latest) return null;
  return Math.min(1, latest.pageAt / skill.totalPages);
}

export function bookCurrentPage(skill) {
  const latest = getSessions(skill.id).find((s) => s.pageAt != null);
  return latest ? latest.pageAt : null;
}

export function getSessions(skillId = null) {
  const all = read(KEYS.sessions, []);
  const filtered = skillId ? all.filter((s) => s.skillId === skillId) : all;
  return filtered.slice().sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

export function logSession(fields) {
  const list = read(KEYS.sessions, []);
  list.push({
    id: uid(), skillId: fields.skillId, date: fields.date || todayKey(),
    durationMinutes: fields.durationMinutes || 0, pageAt: fields.pageAt ?? null,
    note: fields.note || '', createdAt: nowIso(),
  });
  write(KEYS.sessions, list);
}

export function deleteSession(id) {
  write(KEYS.sessions, read(KEYS.sessions, []).filter((s) => s.id !== id));
}

export function weeklyMinutes(skillId, weekMondayKey = mondayOfWeekKey(todayKey())) {
  const weekEnd = addDaysToDateKey(weekMondayKey, 6);
  return getSessions(skillId)
    .filter((s) => s.date >= weekMondayKey && s.date <= weekEnd)
    .reduce((sum, s) => sum + s.durationMinutes, 0);
}

export function totalMinutes(skillId) {
  return getSessions(skillId).reduce((sum, s) => sum + s.durationMinutes, 0);
}

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

/* =========================================================
   Lernplaene (E58, neu) - "an diesen Wochentagen ueben", angelegt ueber den
   neuen Kalender-Tag-Picker. Rein terminliche Erinnerung (Kalender-Spiegel),
   erzeugt KEINE Sessions automatisch - das Ueben/Loggen bleibt manuell.
   ========================================================= */
// LearningPlan: { id, skillId, weekdays (0=Mo..6=So)[], startDate, durationMinutes, createdAt }

export function getLearningPlans() {
  return read(KEYS.learningPlans, []);
}

export function createLearningPlan(fields) {
  const list = read(KEYS.learningPlans, []);
  list.push({
    id: uid(), skillId: fields.skillId, weekdays: fields.weekdays || [],
    startDate: fields.startDate || todayKey(), durationMinutes: fields.durationMinutes || 30,
    createdAt: nowIso(),
  });
  write(KEYS.learningPlans, list);
  refreshSharedCalendarMirror();
}

export function deleteLearningPlan(id) {
  write(KEYS.learningPlans, read(KEYS.learningPlans, []).filter((p) => p.id !== id));
  refreshSharedCalendarMirror();
}

/** Naechste 8 Wochen an Terminen fuer einen Lernplan, an denen sein
 *  Wochentags-Muster zutrifft (ab startDate, nie in der Vergangenheit). */
function upcomingLearningPlanDates(plan) {
  const out = [];
  const start = plan.startDate > todayKey() ? plan.startDate : todayKey();
  for (let i = 0; i < 56; i++) {
    const dateKey = addDaysToDateKey(start, i);
    const dt = new Date(dateKey + 'T00:00:00Z');
    const weekday = (dt.getUTCDay() + 6) % 7; // Montag = 0
    if (plan.weekdays.includes(weekday)) out.push(dateKey);
  }
  return out;
}

/* =========================================================
   Einstellungen
   ========================================================= */

const DEFAULT_SETTINGS = {
  theme: 'dark',
  accentHue: 262,
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
    goals: getGoals(),
    milestones: getMilestones(),
    todos: getTodos(),
    settings: getSettings(),
    skills: read(KEYS.skills, []),
    sessions: read(KEYS.sessions, []),
    learningPlans: read(KEYS.learningPlans, []),
  };
}

export function importAllData(data) {
  if (data.goals) write(KEYS.goals, data.goals);
  if (data.milestones) write(KEYS.milestones, data.milestones);
  if (data.todos) write(KEYS.todos, data.todos);
  if (data.settings) write(KEYS.settings, data.settings);
  if (data.skills) write(KEYS.skills, data.skills);
  if (data.sessions) write(KEYS.sessions, data.sessions);
  if (data.learningPlans) write(KEYS.learningPlans, data.learningPlans);
  refreshSharedCalendarMirror();
}

export function resetAllData() {
  localStorage.removeItem(KEYS.goals);
  localStorage.removeItem(KEYS.milestones);
  localStorage.removeItem(KEYS.todos);
  localStorage.removeItem(KEYS.settings);
  localStorage.removeItem(KEYS.skills);
  localStorage.removeItem(KEYS.sessions);
  localStorage.removeItem(KEYS.learningPlans);
  refreshSharedCalendarMirror();
}
