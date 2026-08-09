// Persistenz-Schicht: verschluesselt (AES-GCM, Passphrase nie persistiert),
// gleiches Muster wie der Digitale Safe (shared/crypto.js). Sensibelster
// Datensatz im Oekosystem (Stimmungsdaten, Freitext-Reflexionen) - war bis
// Etappe 36 bewusst noch unverschluesselt, jetzt nachgeruestet ohne das
// Datenmodell unten anzufassen.

import { uid, nowIso, todayKey, addDaysToDateKey, daysBetweenDateKeys } from './utils.js';
import { generateSaltB64, deriveKey, encryptJson, decryptJson } from '../../shared/crypto.js';
import * as vaultLockout from '../../shared/vault-lockout.js';

const KEYS = {
  vault: 'dy_vault_v1',
  settings: 'dy_settings_v1',
  lockout: 'dy_lockout_v1',
  legacyEntries: 'dy_entries_v1', // Klartext-Eintraege von vor der Verschluesselung (Etappe 36)
};

export const MAX_ATTEMPTS = vaultLockout.MAX_ATTEMPTS;
export const lockoutStatus = () => vaultLockout.lockoutStatus(KEYS.lockout);
export const registerFailedUnlockAttempt = () => vaultLockout.registerFailedUnlockAttempt(KEYS.lockout);
export const clearLockout = () => vaultLockout.clearLockout(KEYS.lockout);

export const SUGGESTED_TAGS = [
  'gestresst', 'gut geschlafen', 'schlecht geschlafen', 'sozialer Tag', 'allein',
  'produktiv', 'erschöpft', 'krank', 'bewegt', 'entspannt',
];

const REFLECTION_QUESTIONS = [
  'Was hat dich heute zum Lächeln gebracht?',
  'Wofür bist du heute dankbar?',
  'Was hat dich heute am meisten gefordert?',
  'Was würdest du morgen gerne anders machen?',
  'Was hast du heute über dich gelernt?',
  'Wem bist du heute begegnet, der/die dir gutgetan hat?',
  'Was hat heute mehr Energie gekostet, als es sollte?',
  'Welcher Moment heute war der beste?',
  'Was brauchst du gerade am meisten?',
  'Worauf freust du dich morgen?',
  'Wie hat sich dein Körper heute angefühlt?',
  'Was hast du heute für dich selbst getan?',
];

/** Rotiert deterministisch nach Tag im Jahr, damit dieselbe Frage nicht taeglich wiederkehrt, aber am selben Tag stabil bleibt. */
export function reflectionQuestionFor(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dayOfYear = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 86400000);
  return REFLECTION_QUESTIONS[dayOfYear % REFLECTION_QUESTIONS.length];
}

// ---------- Nicht-sensible Einstellungen (Theme) — bewusst AUSSERHALB des
// verschluesselten Vaults, damit der Sperr-Bildschirm selbst das gewaehlte
// Theme respektieren kann. Enthaelt keine Eintrags-/Stimmungsdaten. ----------
const DEFAULT_SETTINGS = { theme: 'dark', accentHue: 275 };

export function getSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEYS.settings) || '{}') };
  } catch { return { ...DEFAULT_SETTINGS }; }
}

export function saveSettings(patch) {
  const s = { ...getSettings(), ...patch };
  localStorage.setItem(KEYS.settings, JSON.stringify(s));
  return s;
}

// ---------- Verschluesselter Vault ----------
// _key/_entries leben NUR im Speicher dieser Sitzung. Die Passphrase wird
// nirgends persistiert; beim Reload muss neu entsperrt werden (Absicht, kein Bug).
let _key = null;
let _entries = [];

export function hasVault() {
  return localStorage.getItem(KEYS.vault) !== null;
}

export function isUnlocked() {
  return _key !== null;
}

function readStoredVault() {
  try { return JSON.parse(localStorage.getItem(KEYS.vault)); } catch { return null; }
}

function writeStoredVault(v) {
  localStorage.setItem(KEYS.vault, JSON.stringify(v));
}

function readLegacyEntries() {
  try {
    const raw = localStorage.getItem(KEYS.legacyEntries);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/** Erstellt einen neuen Vault mit dieser Passphrase. Uebernimmt automatisch
 *  Eintraege aus der Zeit vor der Verschluesselung (Etappe 36), falls
 *  vorhanden, statt sie kommentarlos verwaist liegen zu lassen. */
export async function setupVault(passphrase) {
  const salt = generateSaltB64();
  const key = await deriveKey(passphrase, salt);
  const legacy = readLegacyEntries();
  const entries = legacy || [];
  const { iv, ciphertext } = await encryptJson(key, { entries });
  writeStoredVault({ salt, iv, ciphertext });
  if (legacy) localStorage.removeItem(KEYS.legacyEntries);
  _key = key;
  _entries = entries;
}

/** Entsperrt den bestehenden Vault. Wirft bei falscher Passphrase. */
export async function unlockVault(passphrase) {
  const stored = readStoredVault();
  if (!stored) throw new Error('Kein Vault vorhanden');
  const key = await deriveKey(passphrase, stored.salt);
  let data;
  try {
    data = await decryptJson(key, stored.iv, stored.ciphertext);
  } catch {
    throw new Error('Falsche Passphrase');
  }
  _key = key;
  _entries = data.entries || [];
}

/** Sperrt die App wieder: entfernt Schluessel und Klartext aus dem Speicher. */
export function lockVault() {
  _key = null;
  _entries = [];
}

async function persist() {
  const stored = readStoredVault();
  const { iv, ciphertext } = await encryptJson(_key, { entries: _entries });
  writeStoredVault({ salt: stored.salt, iv, ciphertext });
}

function assertUnlocked() {
  if (!_key) throw new Error('Vault ist gesperrt');
}

export async function changePassphrase(oldPassphrase, newPassphrase) {
  assertUnlocked();
  const stored = readStoredVault();
  const oldKey = await deriveKey(oldPassphrase, stored.salt);
  try {
    await decryptJson(oldKey, stored.iv, stored.ciphertext);
  } catch {
    throw new Error('Aktuelle Passphrase ist falsch');
  }
  const newSalt = generateSaltB64();
  const newKey = await deriveKey(newPassphrase, newSalt);
  const { iv, ciphertext } = await encryptJson(newKey, { entries: _entries });
  writeStoredVault({ salt: newSalt, iv, ciphertext });
  _key = newKey;
}

/* =========================================================
   Eintraege – ein Eintrag pro Tag (Datum ist der Schluessel).
   Kein Kalender-Mirror (bewusst): taegliche Stimmungs-Check-ins waeren
   hochfrequent wie die Uebe-Sessions der Lernen-App - kein sinnvolles
   Einzeldatum zum Spiegeln.
   ========================================================= */
// Entry: { id, date (YYYY-MM-DD), mood (1-10), tags: string[], note,
//          reflectionQuestion, reflectionAnswer, createdAt, updatedAt }

export function getEntries() {
  assertUnlocked();
  return [..._entries].sort((a, b) => b.date.localeCompare(a.date));
}

export function getEntryByDate(dateKey) {
  assertUnlocked();
  return _entries.find((e) => e.date === dateKey) || null;
}

export async function saveEntry(fields) {
  assertUnlocked();
  const idx = _entries.findIndex((e) => e.date === fields.date);
  const base = idx >= 0 ? _entries[idx] : { id: uid(), createdAt: nowIso() };
  const entry = {
    ...base,
    date: fields.date, mood: fields.mood, tags: fields.tags || [],
    note: fields.note || '', reflectionQuestion: fields.reflectionQuestion || '',
    reflectionAnswer: fields.reflectionAnswer || '', updatedAt: nowIso(),
  };
  if (idx >= 0) _entries[idx] = entry; else _entries.push(entry);
  await persist();
  return entry;
}

export async function deleteEntry(id) {
  assertUnlocked();
  _entries = _entries.filter((e) => e.id !== id);
  await persist();
}

/** Aktueller Streak in Tagen (aufeinanderfolgende Tage mit Eintrag, endend heute oder gestern). */
export function currentStreak() {
  assertUnlocked();
  const dates = [...new Set(_entries.map((e) => e.date))].sort().reverse();
  if (dates.length === 0) return 0;
  const today = todayKey();
  let expected = dates[0] === today ? today : (daysBetweenDateKeys(dates[0], today) === 1 ? dates[0] : null);
  if (!expected) return 0;
  let streak = 0;
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

/**
 * Sanfter Hinweis, wenn die Stimmung ueber die letzten Tage durchgaengig
 * niedrig war - kein Ersatz fuer professionelle Hilfe, nur ein
 * nicht bevormundender Fingerzeig. Braucht mindestens 5 Eintraege in den
 * letzten 7 Tagen, um Fehlalarme bei duenner Datenlage zu vermeiden.
 */
export function shouldShowSupportHint() {
  assertUnlocked();
  const today = todayKey();
  const windowStart = addDaysToDateKey(today, -6);
  const recent = _entries.filter((e) => e.date >= windowStart && e.date <= today);
  if (recent.length < 5) return false;
  const avg = recent.reduce((sum, e) => sum + e.mood, 0) / recent.length;
  return avg <= 3.5;
}

// ---------- Backup (bleibt verschluesselt — Export ist sicher weitergebbar) ----------
export function exportEncryptedBackup() {
  const stored = readStoredVault();
  if (!stored) throw new Error('Kein Vault vorhanden');
  return { app: 'tagebuch', version: 1, ...stored };
}

export function importEncryptedBackup(data) {
  if (!data || !data.salt || !data.iv || !data.ciphertext) throw new Error('Ungültige Backup-Datei');
  writeStoredVault({ salt: data.salt, iv: data.iv, ciphertext: data.ciphertext });
  lockVault();
}

export function resetVault() {
  localStorage.removeItem(KEYS.vault);
  lockVault();
}
