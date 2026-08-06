// App-eigene Daten: Termine + Einstellungen. Die Kontaktdaten selbst liegen
// im geteilten Modul ../../shared/contacts.js (gleicher Personendatensatz
// wie in der Social-App, hier nur um jobProfile erweitert).

import { createCalendarEvent } from '../../shared/calendar-schema.js';
import { replaceSourceEvents } from '../../shared/event-store.js';
import { clearJobProfiles } from '../../shared/contacts.js';
import { uid, nowIso } from './utils.js';

const KEYS = {
  appointments: 'jb_appointments_v1',
  settings: 'jb_settings_v1',
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
   Termine/Deadlines – App-eigen (nicht Teil des geteilten
   Kontaktmodells), optional mit einer Person verknuepft.
   ========================================================= */
// Appointment: { id, title, date (YYYY-MM-DD), note, personId (optional), createdAt }

export function getAppointments() {
  return read(KEYS.appointments, []);
}

export function getAppointmentById(id) {
  return getAppointments().find((a) => a.id === id) || null;
}

export function getAppointmentsForPerson(personId) {
  return getAppointments().filter((a) => a.personId === personId);
}

export function saveAppointment(appt) {
  const list = getAppointments();
  const idx = list.findIndex((a) => a.id === appt.id);
  if (idx >= 0) list[idx] = appt; else list.push(appt);
  write(KEYS.appointments, list);
  refreshSharedCalendarMirror();
  return appt;
}

export function createAppointment(fields) {
  return saveAppointment({
    id: uid(),
    title: fields.title,
    date: fields.date,
    note: fields.note || '',
    personId: fields.personId || null,
    createdAt: nowIso(),
  });
}

export function deleteAppointment(id) {
  write(KEYS.appointments, getAppointments().filter((a) => a.id !== id));
  refreshSharedCalendarMirror();
}

export function getAppointmentsSorted() {
  return getAppointments().slice().sort((a, b) => a.date.localeCompare(b.date));
}

/** Spiegelt Termine in den geteilten Kalender-Event-Store (viertes Beispiel
 *  dieses Musters, nach Fitness/Ziele-Todo - "eigener Kalender-Kanal, spiegelt
 *  in den Hauptkalender" laut Oekosystem-Dokument). */
export async function refreshSharedCalendarMirror() {
  try {
    const events = getAppointments().map((a) => createCalendarEvent({
      id: `job-appt-${a.id}`,
      title: a.title,
      start: a.date,
      source: 'job',
    }));
    await replaceSourceEvents('job', events);
  } catch {
    // Shared Storage ist ein optionales Extra, kein Kernfeature.
  }
}

/* =========================================================
   Einstellungen
   ========================================================= */

const DEFAULT_SETTINGS = { theme: 'dark', accentHue: 210, lastBackupAt: '' };

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
   Bewusst NUR die App-eigenen Termine/Einstellungen - nicht die geteilten
   Kontaktdaten (Personen/Beziehungs-Log/Verknuepfungen). Ein Job-Backup
   wuerde sonst beim Wiederherstellen die komplette Social-App-Datenbank
   ueberschreiben. Fuer ein vollstaendiges Kontakt-Backup die Social-App
   nutzen - "Alle Daten loeschen" hier entfernt nur Termine + jobProfile.
   ========================================================= */

export function exportAllData() {
  return { exportedAt: nowIso(), appointments: getAppointments(), settings: getSettings() };
}

export function importAllData(data) {
  if (data.appointments) write(KEYS.appointments, data.appointments);
  if (data.settings) write(KEYS.settings, data.settings);
  refreshSharedCalendarMirror();
}

export function resetAllData() {
  localStorage.removeItem(KEYS.appointments);
  localStorage.removeItem(KEYS.settings);
  clearJobProfiles();
  refreshSharedCalendarMirror();
}
