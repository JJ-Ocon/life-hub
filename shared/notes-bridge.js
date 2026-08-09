// Cross-App-Zuordnung von Notizen (E57) - bewusst ANDERS als die uebrigen
// shared/*.js-Module (body-data.js, grocery-cost.js, subscriptions.js), die
// alle nach dem Einweg-Publish/Read-Muster arbeiten (Quell-App schreibt einen
// eigenen kleinen Spiegel-Datensatz, andere Apps lesen nur). Hier geht es um
// echtes Vor-Ort-Bearbeiten derselben Notiz aus einer zweiten App heraus -
// zwei getrennte Kopien wuerden auseinanderlaufen, sobald beide Seiten
// unabhaengig editieren. Deshalb liest/schreibt dieses Modul direkt Notizens
// eigenen localStorage-Schluessel (nt_notes_v1) als die eine gemeinsame
// Quelle der Wahrheit - Notizen bleibt trotzdem alleiniger "Besitzer" des
// Datenmodells: nur Titel/Text/Checklisten-Haken duerfen von aussen
// veraendert werden, niemals Ordner/Foto/Wiedervorlage/Archiv-Status.

const NOTES_KEY = 'nt_notes_v1';

function readNotes() {
  try {
    const raw = localStorage.getItem(NOTES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeNotes(list) {
  localStorage.setItem(NOTES_KEY, JSON.stringify(list));
}

/** Alle (nicht archivierten) Notizen, die der gegebenen App zugeordnet sind. */
export function getNotesForApp(appId) {
  return readNotes()
    .filter((n) => n.assignedApp === appId && !n.archived)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Titel/Text (bzw. bei Checklisten einen einzelnen Punkt) einer zugeordneten
 *  Notiz von der anderen App aus aendern. Nur die Inhaltsfelder sind
 *  editierbar, nicht Ordner/Foto/Wiedervorlage - die bleiben Notizen
 *  vorbehalten. Gibt false zurueck, wenn die Notiz nicht (mehr) existiert
 *  oder nicht (mehr) dieser App zugeordnet ist. */
export function updateAssignedNoteContent(id, appId, patch) {
  const list = readNotes();
  const idx = list.findIndex((n) => n.id === id && n.assignedApp === appId);
  if (idx < 0) return false;
  const note = list[idx];
  const updated = { ...note, updatedAt: new Date().toISOString() };
  if (patch.title !== undefined) updated.title = patch.title;
  if (patch.text !== undefined) updated.text = patch.text;
  if (patch.itemId && patch.itemDone !== undefined) {
    updated.items = (note.items || []).map((it) => (it.id === patch.itemId ? { ...it, done: patch.itemDone } : it));
  }
  list[idx] = updated;
  writeNotes(list);
  return true;
}

/** Loest die Zuordnung wieder - die Notiz bleibt in Notizen bestehen, taucht
 *  dort aber nicht mehr als "einer anderen App zugeordnet" auf. */
export function unassignNote(id, appId) {
  const list = readNotes();
  const idx = list.findIndex((n) => n.id === id && n.assignedApp === appId);
  if (idx < 0) return false;
  list[idx] = { ...list[idx], assignedApp: null, updatedAt: new Date().toISOString() };
  writeNotes(list);
  return true;
}
