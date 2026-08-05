// Geteiltes IndexedDB-Helferlein fuer den Same-Origin-Trick-Test (siehe
// /test-a/ und /test-b/). Beide Test-Seiten importieren dieselbe Datei von
// hier aus dem Repo-Root - liegt bewusst NICHT in einem der beiden
// Unterordner, um zu zeigen, dass der Pfad fuer Same-Origin keine Rolle
// spielt (nur Schema+Host+Port zaehlen).
const DB_NAME = 'shared-test';
const STORE_NAME = 'events';

function openSharedDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function writeEvent(from) {
  const db = await openSharedDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).add({ ts: Date.now(), from });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function readEvents() {
  const db = await openSharedDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
