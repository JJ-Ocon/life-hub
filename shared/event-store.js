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

/** Findet Kalender-Events an einem Datum aus ANDEREN Quellen - Konfliktpruefung
 *  beim Anlegen neuer Termine, damit zwei Apps nicht unbemerkt denselben Tag belegen. */
export async function findConflictingEvents(dateKey, excludeSource) {
  const all = await getAllCalendarEvents();
  return all.filter((e) => e.source !== excludeSource && e.start.slice(0, 10) === dateKey);
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
