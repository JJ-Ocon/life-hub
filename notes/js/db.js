// Persistenz-Schicht: alles in localStorage, bleibt lokal auf dem Geraet.

import { uid, nowIso, todayKey } from './utils.js';

const KEYS = {
  notes: 'nt_notes_v1',
  settings: 'nt_settings_v1',
  folderColors: 'nt_folder_colors_v1',
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
//         remindAt (YYYY-MM-DD|null), archived, assignedApp (string|null),
//         createdAt, updatedAt }

/** Andere Apps, denen eine Notiz zugeordnet werden kann (E57) - bewusst ohne
 *  Digitaler Safe/Tagebuch (verschluesselte Apps, keine Plaintext-Notizen
 *  ueber einen Seitenkanal einschleusen) und ohne Notizen selbst. */
export const ASSIGNABLE_APPS = [
  { id: 'goals', label: 'Ziele, Todo & Lernen' },
  { id: 'job', label: 'Job' },
  { id: 'social', label: 'Social' },
  { id: 'household', label: 'Haushalt' },
  { id: 'travel', label: 'Reisen' },
  { id: 'vehicle', label: 'Fahrzeug' },
  { id: 'kleidung', label: 'Kleidung' },
];

export function assignableAppLabel(id) {
  return ASSIGNABLE_APPS.find((a) => a.id === id)?.label || id;
}

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
    pinned: !!fields.pinned,
    assignedApp: fields.assignedApp || null,
    createdAt: nowIso(),
  });
}

/** Notizen ohne Ordner (und nicht archiviert) - fuer die Gruppe unterhalb
 *  der Ordner-Kacheln im Ordner-Bereich. */
export function getUnassignedNotes() {
  return getNotesSorted(todayKey(), { archived: false }).filter((n) => !n.folder && !n.pinned);
}

/** Angepinnte Notizen (E-Notizen-Pin): sollen immer sofort sichtbar sein,
 *  unabhaengig von Ordner-Zuordnung - deshalb aus Ordner-/Unzugeordnet-Listen
 *  ausgenommen (s.o.) und hier gesondert gefuehrt. */
export function getPinnedNotes() {
  return getNotesSorted(todayKey(), { archived: false }).filter((n) => n.pinned);
}

export function togglePin(id) {
  const note = getNoteById(id);
  if (note) saveNote({ ...note, pinned: !note.pinned });
}

export function notesInFolder(folder) {
  return getNotesSorted(todayKey(), { archived: false }).filter((n) => n.folder === folder);
}

/** Anzahl nicht-archivierter Notizen je Ordner, fuer die Kachel-Badges. */
export function getFolderCounts() {
  const counts = {};
  for (const n of getNotes()) {
    if (n.archived || !n.folder) continue;
    counts[n.folder] = (counts[n.folder] || 0) + 1;
  }
  return counts;
}

/* =========================================================
   Ordner-Farben (E57) - jedem Ordnernamen wird beim ersten Auftauchen
   automatisch eine feste Farbe aus einer kleinen Palette zugewiesen und
   dauerhaft gemerkt (Reihum-Vergabe, keine manuelle Farbwahl noetig).
   ========================================================= */
const FOLDER_COLOR_PALETTE = ['#e0629a', '#5b9bd9', '#3ddc84', '#e0a63a', '#8f7ee0', '#4fc3d9', '#f06464', '#c76ae0'];

export function getFolderColor(name) {
  const map = read(KEYS.folderColors, {});
  if (map[name]) return map[name];
  const color = FOLDER_COLOR_PALETTE[Object.keys(map).length % FOLDER_COLOR_PALETTE.length];
  map[name] = color;
  write(KEYS.folderColors, map);
  return color;
}

/** Manuelle Farbwahl (E61) - ueberschreibt die automatische Zuweisung dauerhaft. */
export function setFolderColor(name, color) {
  const map = read(KEYS.folderColors, {});
  map[name] = color;
  write(KEYS.folderColors, map);
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
  return { exportedAt: nowIso(), notes: getNotes(), settings: getSettings(), folderColors: read(KEYS.folderColors, {}) };
}

export function importAllData(data) {
  if (data.notes) write(KEYS.notes, data.notes);
  if (data.settings) write(KEYS.settings, data.settings);
  if (data.folderColors) write(KEYS.folderColors, data.folderColors);
}

export function resetAllData() {
  localStorage.removeItem(KEYS.notes);
  localStorage.removeItem(KEYS.settings);
  localStorage.removeItem(KEYS.folderColors);
}
