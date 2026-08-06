import { uid, nowIso, todayKey, addDaysToDateKey } from './utils.js';
import { generateSaltB64, deriveKey, encryptJson, decryptJson } from './crypto.js';

const KEYS = {
  vault: 'ds_vault_v1',
  settings: 'ds_settings_v1',
};

export const CATEGORIES = [
  { key: 'ausweis', label: 'Ausweis/Reisepass' },
  { key: 'fuehrerschein', label: 'Führerschein' },
  { key: 'vertrag', label: 'Vertrag' },
  { key: 'versicherung', label: 'Versicherung' },
  { key: 'zertifikat', label: 'Zertifikat/TÜV' },
  { key: 'sonstiges', label: 'Sonstiges' },
];

// ---------- Nicht-sensible Einstellungen (Theme) — bewusst AUSSERHALB des
// verschluesselten Vaults, damit der Sperr-Bildschirm selbst das gewaehlte
// Theme respektieren kann. Enthaelt keine Dokumentdaten. ----------
const DEFAULT_SETTINGS = { theme: 'dark', accentHue: 210 };

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
// _key/_documents leben NUR im Speicher dieser Sitzung. Die Passphrase wird
// nirgends persistiert; beim Reload muss neu entsperrt werden (Absicht, kein Bug).
let _key = null;
let _documents = [];

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

/** Erstellt einen neuen, leeren Vault mit dieser Passphrase (nur wenn noch keiner existiert). */
export async function setupVault(passphrase) {
  const salt = generateSaltB64();
  const key = await deriveKey(passphrase, salt);
  const { iv, ciphertext } = await encryptJson(key, { documents: [] });
  writeStoredVault({ salt, iv, ciphertext });
  _key = key;
  _documents = [];
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
  _documents = data.documents || [];
}

/** Sperrt die App wieder: entfernt Schluessel und Klartext aus dem Speicher. */
export function lockVault() {
  _key = null;
  _documents = [];
}

async function persist() {
  const stored = readStoredVault();
  const { iv, ciphertext } = await encryptJson(_key, { documents: _documents });
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
  const { iv, ciphertext } = await encryptJson(newKey, { documents: _documents });
  writeStoredVault({ salt: newSalt, iv, ciphertext });
  _key = newKey;
}

// ---------- Dokumente ----------
export function getDocuments() {
  assertUnlocked();
  return [..._documents].sort((a, b) => (a.expiryDate || '9999').localeCompare(b.expiryDate || '9999'));
}

export function getDocumentById(id) {
  assertUnlocked();
  return _documents.find((d) => d.id === id) || null;
}

export async function createDocument({ title, category, expiryDate, reminderLeadDays, note, photo }) {
  assertUnlocked();
  const doc = {
    id: uid(), title, category, expiryDate: expiryDate || null,
    reminderLeadDays: reminderLeadDays ?? 30, note: note || '', photo: photo || null,
    createdAt: nowIso(), updatedAt: nowIso(),
  };
  _documents.push(doc);
  await persist();
  return doc;
}

export async function saveDocument(doc) {
  assertUnlocked();
  const i = _documents.findIndex((d) => d.id === doc.id);
  if (i === -1) return;
  _documents[i] = { ...doc, updatedAt: nowIso() };
  await persist();
}

export async function deleteDocument(id) {
  assertUnlocked();
  _documents = _documents.filter((d) => d.id !== id);
  await persist();
}

export function documentReminderDate(doc) {
  if (!doc.expiryDate) return null;
  return addDaysToDateKey(doc.expiryDate, -(doc.reminderLeadDays ?? 30));
}

/** Faellige/bald faellige Dokumente, sortiert nach Ablaufdatum. */
export function getDueItems() {
  assertUnlocked();
  const today = todayKey();
  return _documents
    .filter((d) => d.expiryDate)
    .filter((d) => {
      const reminder = documentReminderDate(d);
      return reminder && reminder <= today;
    })
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
}

export function categoryLabel(key) {
  return CATEGORIES.find((c) => c.key === key)?.label || 'Sonstiges';
}

// ---------- Backup (bleibt verschluesselt — Export ist sicher weitergebbar) ----------
export function exportEncryptedBackup() {
  const stored = readStoredVault();
  if (!stored) throw new Error('Kein Vault vorhanden');
  return { app: 'digitaler-safe', version: 1, ...stored };
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
