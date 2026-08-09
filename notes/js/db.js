// Persistenz-Schicht: alles in localStorage, bleibt lokal auf dem Geraet.

import { uid, nowIso, todayKey } from './utils.js';

const KEYS = {
  notes: 'nt_notes_v1',
  settings: 'nt_settings_v1',
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
   Notizen – schnelle Erfassung ohne Zwangs-Kategorisierung (GTD-Prinzip),
   optional trotzdem in einen Ordner einsortierbar. remindAt ("Wiedervorlage")
   ist optional: ein Datum, an dem die Notiz wieder auffallen soll, statt in
   der Liste unterzugehen.
   ========================================================= */
// Note: { id, title, type ('text'|'checklist'), text, items ({id,text,done}[] - nur
//         bei type 'checklist'), folder (string|null), photo (dataURL|null),
//         remindAt (YYYY-MM-DD|null), archived, createdAt, updatedAt }

export function getNotes() {
  return read(KEYS.notes, []);
}

export function getNoteById(id) {
  return getNotes().find((n) => n.id === id) || null;
}

/** Notizen sortiert: faellige/ueberfaellige Wiedervorlagen zuerst, dann
 *  zukuenftige Wiedervorlagen, dann der Rest nach Erfassungsdatum (neueste zuerst).
 *  Archivierte Notizen sind standardmaessig ausgeblendet - eigener Archiv-Filter
 *  in der Ordner-Chip-Reihe zeigt nur sie. */
export function getNotesSorted(today = todayKey(), { archived = false } = {}) {
  const notes = getNotes().filter((n) => !!n.archived === archived);
  const due = notes.filter((n) => n.remindAt && n.remindAt <= today).sort((a, b) => a.remindAt.localeCompare(b.remindAt));
  const upcoming = notes.filter((n) => n.remindAt && n.remindAt > today).sort((a, b) => a.remindAt.localeCompare(b.remindAt));
  const plain = notes.filter((n) => !n.remindAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return [...due, ...upcoming, ...plain];
}

export function archiveNote(id) {
  const note = getNoteById(id);
  if (note) saveNote({ ...note, archived: true });
}

export function unarchiveNote(id) {
  const note = getNoteById(id);
  if (note) saveNote({ ...note, archived: false });
}

/** Alle bereits benutzten Ordnernamen, alphabetisch - keine eigene
 *  Ordner-Verwaltung noetig, ein Ordner existiert einfach dadurch, dass
 *  mindestens eine Notiz ihn traegt. */
export function getFolders() {
  const set = new Set(getNotes().map((n) => n.folder).filter(Boolean));
  return [...set].sort((a, b) => a.localeCompare(b, 'de'));
}

export function saveNote(note) {
  const list = getNotes();
  const idx = list.findIndex((n) => n.id === note.id);
  const updated = { ...note, updatedAt: nowIso() };
  if (idx >= 0) list[idx] = updated; else list.push(updated);
  write(KEYS.notes, list);
  return updated;
}

export function createNote(fields) {
  return saveNote({
    id: uid(),
    title: fields.title || '',
    type: fields.type || 'text',
    text: fields.text || '',
    items: fields.items || [],
    folder: fields.folder || null,
    photo: fields.photo || null,
    remindAt: fields.remindAt || null,
    archived: !!fields.archived,
    createdAt: nowIso(),
  });
}

export function deleteNote(id) {
  write(KEYS.notes, getNotes().filter((n) => n.id !== id));
}

/** Fortschritt einer Checklisten-Notiz, sonst null. */
export function checklistProgress(note) {
  if (note.type !== 'checklist' || !note.items?.length) return null;
  const done = note.items.filter((i) => i.done).length;
  return { done, total: note.items.length };
}

/* =========================================================
   Einstellungen
   ========================================================= */

const DEFAULT_SETTINGS = {
  theme: 'dark',
  accentHue: 45,
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
  return { exportedAt: nowIso(), notes: getNotes(), settings: getSettings() };
}

export function importAllData(data) {
  if (data.notes) write(KEYS.notes, data.notes);
  if (data.settings) write(KEYS.settings, data.settings);
}

export function resetAllData() {
  localStorage.removeItem(KEYS.notes);
  localStorage.removeItem(KEYS.settings);
}
