// Persistenz-Schicht: alles in localStorage, bleibt lokal auf dem Geraet.

import { uid, nowIso } from './utils.js';
import { createCalendarEvent } from '../../shared/calendar-schema.js';
import { replaceSourceEvents } from '../../shared/event-store.js';

const KEYS = {
  goals: 'gl_goals_v1',
  milestones: 'gl_milestones_v1',
  todos: 'gl_todos_v1',
  settings: 'gl_settings_v1',
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
// Todo: { id, title, dueDate (YYYY-MM-DD|null), done, goalId (optional), createdAt }

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
    done: false,
    goalId: fields.goalId || null,
    createdAt: nowIso(),
  };
  return saveTodo(todo);
}

export function toggleTodo(id) {
  const t = getTodos().find((x) => x.id === id);
  if (t) saveTodo({ ...t, done: !t.done });
}

export function deleteTodo(id) {
  write(KEYS.todos, getTodos().filter((t) => t.id !== id));
  refreshSharedCalendarMirror();
}

/**
 * Spiegelt Todos mit Faelligkeitsdatum in den geteilten Kalender-Event-Store,
 * damit sie im Hub-Kalender auftauchen ("Sync zum Hauptkalender" laut
 * Oekosystem-Dokument). Feuert asynchron im Hintergrund.
 */
export async function refreshSharedCalendarMirror() {
  try {
    const events = getTodos()
      .filter((t) => t.dueDate)
      .map((t) => createCalendarEvent({
        id: `goals-todo-${t.id}`,
        title: t.done ? `✓ ${t.title}` : t.title,
        start: t.dueDate,
        source: 'goals',
      }));
    await replaceSourceEvents('goals', events);
  } catch {
    // Shared Storage ist ein optionales Extra, kein Kernfeature.
  }
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
  };
}

export function importAllData(data) {
  if (data.goals) write(KEYS.goals, data.goals);
  if (data.milestones) write(KEYS.milestones, data.milestones);
  if (data.todos) write(KEYS.todos, data.todos);
  if (data.settings) write(KEYS.settings, data.settings);
  refreshSharedCalendarMirror();
}

export function resetAllData() {
  localStorage.removeItem(KEYS.goals);
  localStorage.removeItem(KEYS.milestones);
  localStorage.removeItem(KEYS.todos);
  localStorage.removeItem(KEYS.settings);
  refreshSharedCalendarMirror();
}
