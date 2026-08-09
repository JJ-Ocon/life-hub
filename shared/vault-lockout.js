// Wiederverwendbare Versuchssperre fuer passphrase-geschuetzte Apps
// (Digitaler Safe, Tagebuch). Bewusst nur eine UI-seitige Bremse gegen
// jemanden, der ein kurz unbeaufsichtigtes, entsperrtes Geraet findet und
// ein paar Passphrasen durchprobiert - kein Schutz gegen Offline-Brute-
// Force auf die Ciphertext-Datei selbst (dagegen schuetzt PBKDF2 mit
// 250k Iterationen, siehe shared/crypto.js).
//
// Jede App uebergibt ihren eigenen localStorage-Key, damit die Zaehler
// unabhaengig bleiben (z.B. 'ds_lockout_v1' vs 'dy_lockout_v1') - Zaehler/
// Sperrzeit liegen bewusst als Klartext ausserhalb des jeweiligen Vaults,
// enthalten keine Nutzdaten.

export const MAX_ATTEMPTS = 3;
const LOCKOUT_MS = 30000;

function readLockout(key) {
  try { return JSON.parse(localStorage.getItem(key)) || { attempts: 0, lockedUntil: 0 }; }
  catch { return { attempts: 0, lockedUntil: 0 }; }
}

function writeLockout(key, state) {
  localStorage.setItem(key, JSON.stringify(state));
}

export function lockoutStatus(key) {
  const { attempts, lockedUntil } = readLockout(key);
  const remainingMs = Math.max(0, lockedUntil - Date.now());
  return { attempts, remainingMs, locked: remainingMs > 0 };
}

/** Nach einer falschen Passphrase aufzurufen. Ab dem MAX_ATTEMPTS-ten
 *  Fehlversuch in Folge wird fuer LOCKOUT_MS gesperrt und der Zaehler
 *  zurueckgesetzt, damit die naechsten Fehlversuche wieder eine neue Sperre
 *  ausloesen. */
export function registerFailedUnlockAttempt(key) {
  const state = readLockout(key);
  state.attempts += 1;
  if (state.attempts >= MAX_ATTEMPTS) {
    state.lockedUntil = Date.now() + LOCKOUT_MS;
    state.attempts = 0;
  }
  writeLockout(key, state);
  return lockoutStatus(key);
}

export function clearLockout(key) {
  writeLockout(key, { attempts: 0, lockedUntil: 0 });
}
