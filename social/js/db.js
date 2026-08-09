// App-eigene Einstellungen. Die eigentlichen Kontaktdaten liegen im
// geteilten Modul ../../shared/contacts.js - Views importieren das direkt,
// diese Datei buendelt nur Settings + Backup ueber beide Quellen, sowie
// den Geburtstags-Kalender-Mirror.

import { exportContacts, importContacts, resetContacts, getPeople } from '../../shared/contacts.js';
import { createCalendarEvent } from '../../shared/calendar-schema.js';
import { replaceSourceEvents } from '../../shared/event-store.js';

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

/**
 * Spiegelt Geburtstage aller Kontakte mit gesetztem Geburtstag als
 * jaehrlich wiederkehrende Kalender-Eintraege (recurrence: 'yearly') in
 * den geteilten Hub-Kalender. Das `recurrence`-Feld existiert im Schema
 * seit E3, wurde bisher aber von keiner App genutzt - der Hub-Kalender
 * (calendar.js) expandiert `yearly` beim Rendern ueber Monat/Tag, nicht
 * ueber das exakte Jahr, damit ein einziger gemirrorter Eintrag pro Person
 * in jedem Jahr erscheint. Fire-and-forget wie bei jeder anderen App -
 * ein Fehler im geteilten Speicher darf Social nie blockieren.
 */
export async function refreshBirthdayCalendarMirror() {
  try {
    const events = getPeople()
      .filter((p) => p.birthday)
      .map((p) => createCalendarEvent({
        id: `social-birthday-${p.id}`,
        title: `🎂 ${p.name}`,
        start: p.birthday,
        source: 'social',
        recurrence: 'yearly',
      }));
    await replaceSourceEvents('social', events);
  } catch {
    // Shared Storage ist ein optionales Extra, kein Kernfeature.
  }
}

export function exportAllData() {
  return { exportedAt: new Date().toISOString(), settings: getSettings(), ...exportContacts() };
}

export function importAllData(data) {
  if (data.settings) write(KEYS.settings, data.settings);
  importContacts(data);
  refreshBirthdayCalendarMirror();
}

export function resetAllData() {
  localStorage.removeItem(KEYS.settings);
  resetContacts();
  refreshBirthdayCalendarMirror();
}
