// Gemeinsamer lokaler Event-Store (IndexedDB), same-origin von allen Apps
// nutzbar - auf Android verifiziert (siehe /test-a/, /test-b/). Ersetzt fuers
// Single-Device-Szenario den im Brainstorm-Dokument beschriebenen Event-Bus:
// jede App schreibt ihre eigenen Kalender-Events hier rein (per source
// vollstaendig ersetzbar via replaceSourceEvents), der Hub liest nur.
const DB_NAME = 'hub-events';
const DB_VERSION = 1;
const STORE = 'calendar';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllCalendarEvents() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Ein Termin ohne Uhrzeit (reines Datum, z.B. Fitness' geplante Workout-
 *  Eintraege) ist automatisch "flexibel" und faellt bewusst nicht unter die
 *  Konfliktpruefung - weder als neuer Termin noch als bestehender Kandidat. */
function hasTime(iso) {
  return iso.length > 10;
}

/** Findet Kalender-Events an einem Datum aus ANDEREN Quellen, deren Zeitfenster
 *  sich tatsaechlich mit dem neuen Termin ueberschneidet - Konfliktpruefung
 *  beim Anlegen neuer Termine, damit zwei Apps nicht unbemerkt dieselbe Zeit
 *  belegen. Ohne startTime (der neue Termin selbst ist flexibel/ohne Uhrzeit)
 *  liefert die Funktion bewusst immer [] - ein flexibler Termin kann per
 *  Definition mit nichts kollidieren. */
export async function findConflictingEvents(dateKey, excludeSource, options = {}) {
  const { startTime, endTime } = options;
  if (!startTime) return [];
  const newStart = toMinutes(startTime);
  const newEnd = endTime ? toMinutes(endTime) : newStart + 1;

  const all = await getAllCalendarEvents();
  return all.filter((e) => {
    if (e.source === excludeSource) return false;
    if (e.start.slice(0, 10) !== dateKey) return false;
    if (!hasTime(e.start)) return false; // bestehender Termin ist selbst flexibel -> kein Konflikt
    const existStart = toMinutes(e.start.slice(11, 16));
    const existEnd = e.end && hasTime(e.end) ? toMinutes(e.end.slice(11, 16)) : existStart + 1;
    return newStart < existEnd && existStart < newEnd;
  });
}

/** Ersetzt alle Events einer Quell-App in einem Rutsch (loeschen + neu einfuegen) -
 *  vermeidet Drift zwischen App-eigenem Datenmodell und gespiegelten Events. */
export async function replaceSourceEvents(source, events) {
  const db = await openDb();
  const existing = await getAllCalendarEvents();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    existing.filter((e) => e.source === source).forEach((e) => store.delete(e.id));
    events.forEach((e) => store.put(e));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
