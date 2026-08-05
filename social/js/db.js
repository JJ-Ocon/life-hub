// App-eigene Einstellungen. Die eigentlichen Kontaktdaten liegen im
// geteilten Modul ../../shared/contacts.js - Views importieren das direkt,
// diese Datei buendelt nur Settings + Backup ueber beide Quellen.

import { exportContacts, importContacts, resetContacts } from '../../shared/contacts.js';

const KEYS = { settings: 'sc_settings_v1' };

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

const DEFAULT_SETTINGS = { theme: 'dark', accentHue: 340, lastBackupAt: '' };

export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...read(KEYS.settings, {}) };
}

export function saveSettings(patch) {
  const merged = { ...getSettings(), ...patch };
  write(KEYS.settings, merged);
  return merged;
}

export function exportAllData() {
  return { exportedAt: new Date().toISOString(), settings: getSettings(), ...exportContacts() };
}

export function importAllData(data) {
  if (data.settings) write(KEYS.settings, data.settings);
  importContacts(data);
}

export function resetAllData() {
  localStorage.removeItem(KEYS.settings);
  resetContacts();
}
