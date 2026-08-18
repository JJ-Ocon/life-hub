// App-eigene Daten: Termine + Einstellungen. Die Kontaktdaten selbst liegen
// im geteilten Modul ../../shared/contacts.js (gleicher Personendatensatz
// wie in der Social-App, hier nur um jobProfile erweitert).

import { createCalendarEvent } from '../../shared/calendar-schema.js';
import { replaceSourceEvents } from '../../shared/event-store.js';
import { clearJobProfiles } from '../../shared/contacts.js';
import { uid, nowIso, addDaysToDateKey, addMonthsToDateKey, addYearsToDateKey } from './utils.js';

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
// Appointment: { id, title, date (YYYY-MM-DD), time (HH:MM|null), location,
//                note, personId (optional), done, repeat (siehe unten|null), createdAt }

export const REPEAT_FREQUENCIES = [
  { key: 'daily', label: 'Täglich' },
  { key: 'weekly', label: 'Wöchentlich' },
  { key: 'monthly', label: 'Monatlich' },
  { key: 'yearly', label: 'Jährlich' },
  { key: 'custom', label: 'Benutzerdefiniert' },
];

export function repeatLabel(repeat) {
  if (!repeat) return null;
  if (repeat.freq === 'custom') return `Alle ${repeat.intervalDays || 1} Tage`;
  return REPEAT_FREQUENCIES.find((f) => f.key === repeat.freq)?.label || null;
}

/** Naechstes Datum ausgehend vom aktuellen, nach Wiederholungsregel - gleiches
 *  Muster wie goals/js/db.js's nextRepeatDate(). */
export function nextRepeatDate(dateKey, repeat) {
  if (!repeat || !dateKey) return null;
  switch (repeat.freq) {
    case 'daily': return addDaysToDateKey(dateKey, 1);
    case 'weekly': return addDaysToDateKey(dateKey, 7);
    case 'monthly': return addMonthsToDateKey(dateKey, 1);
    case 'yearly': return addYearsToDateKey(dateKey, 1);
    case 'custom': return addDaysToDateKey(dateKey, Math.max(1, Number(repeat.intervalDays) || 1));
    default: return null;
  }
}

export function getAppointments() {
  return read(KEYS.appointments, []);
}

export function getAppointmentById(id) {
  return getAppointments().find((a) => a.id === id) || null;
}

export function getAppointmentsForPerson(personId) {
  return getAppointments().filter((a) => a.personId === personId);
}

export function getAppointmentsForDate(dateKey) {
  return getAppointments().filter((a) => a.date === dateKey);
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
    time: fields.time || null,
    location: fields.location || '',
    note: fields.note || '',
    personId: fields.personId || null,
    done: false,
    repeat: fields.repeat || null,
    createdAt: nowIso(),
  });
}

export function deleteAppointment(id) {
  write(KEYS.appointments, getAppointments().filter((a) => a.id !== id));
  refreshSharedCalendarMirror();
}

/** Beim Erledigen eines wiederkehrenden Termins (nicht-erledigt -> erledigt)
 *  wird direkt die naechste Instanz angelegt, ausgehend vom bisherigen Datum
 *  - gleiches Muster wie goals/js/db.js's toggleTodo(). */
export function toggleAppointmentDone(id) {
  const a = getAppointments().find((x) => x.id === id);
  if (!a) return;
  const wasDone = a.done;
  saveAppointment({ ...a, done: !wasDone });
  if (!wasDone && a.repeat) {
    const nextDate = nextRepeatDate(a.date, a.repeat);
    if (nextDate) {
      createAppointment({
        title: a.title, date: nextDate, time: a.time, location: a.location,
        personId: a.personId, repeat: a.repeat,
      });
    }
  }
}

export function getAppointmentsSorted() {
  return getAppointments().slice().sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''));
}

/** Spiegelt Termine in den geteilten Kalender-Event-Store (viertes Beispiel
 *  dieses Musters, nach Fitness/Ziele-Todo - "eigener Kalender-Kanal, spiegelt
 *  in den Hauptkalender" laut Oekosystem-Dokument). */
export async function refreshSharedCalendarMirror() {
  try {
    const events = getAppointments().map((a) => createCalendarEvent({
      id: `job-appt-${a.id}`,
      title: a.done ? `✓ ${a.title}` : a.title,
      start: a.date,
      source: 'job',
      link: '#/appointments',
    }));
    await replaceSourceEvents('job', events);
  } catch {
    // Shared Storage ist ein optionales Extra, kein Kernfeature.
  }
}

/** Inline-Bearbeitung eines gespiegelten Termins direkt aus dem Hub-Kalender
 *  heraus (E-Hub-Edit-Cross-App) - siehe goals/js/db.js fuer das gleiche Muster. */
export function getCalendarEditableEntity(eventId) {
  const m = eventId.match(/^job-appt-(.+)$/);
  if (!m) return null;
  const appt = getAppointments().find((a) => a.id === m[1]);
  if (!appt) return null;
  return { title: appt.title, date: appt.date, time: appt.time || '' };
}

export function applyCalendarEdit(eventId, patch) {
  const m = eventId.match(/^job-appt-(.+)$/);
  if (!m) return false;
  const appt = getAppointments().find((a) => a.id === m[1]);
  if (!appt) return false;
  saveAppointment({ ...appt, title: patch.title, date: patch.date, time: patch.time || null });
  return true;
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
