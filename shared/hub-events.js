// Vom Hub selbst direkt angelegte Termine (nicht aus einer Unter-App gespiegelt).
// Eigenes lokales Array in localStorage bleibt die Quelle der Wahrheit; bei
// jeder Aenderung wird es komplett als 'hub'-Quelle in den gemeinsamen
// Event-Store gespiegelt - exakt das gleiche replaceSourceEvents-Muster, das
// auch jede andere App fuer ihre eigenen Termine verwendet.
import { createCalendarEvent } from './calendar-schema.js';
import { replaceSourceEvents } from './event-store.js';

const KEY = 'hub_own_events_v1';

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}

/** Schreibt synchron nach localStorage, spiegelt aber ASYNCHRON (IndexedDB) -
 *  jeder Aufrufer muss dieses Promise abwarten, bevor er den Kalender neu
 *  laedt, sonst liest getAllCalendarEvents() den Store, bevor die
 *  replaceSourceEvents-Transaktion committet ist (Race Condition). */
async function write(list) {
  localStorage.setItem(KEY, JSON.stringify(list));
  await syncToStore(list);
}

function syncToStore(list) {
  const events = list.map((e) => createCalendarEvent({
    id: `hub-${e.id}`,
    title: e.title,
    start: e.allDay ? e.dateStart : `${e.dateStart}T${e.timeStart}`,
    end: e.allDay ? e.dateEnd : `${e.dateEnd}T${e.timeEnd}`,
    source: 'hub',
  }));
  return replaceSourceEvents('hub', events).catch(() => {});
}

export function stripHubId(calendarEventId) {
  return calendarEventId.replace(/^hub-/, '');
}

export function getHubEvents() {
  return read().sort((a, b) => a.dateStart.localeCompare(b.dateStart));
}

export function getHubEventById(id) {
  return read().find((e) => e.id === id) || null;
}

export async function createHubEvent(fields) {
  const list = read();
  const entry = {
    id: crypto.randomUUID(),
    title: fields.title,
    dateStart: fields.dateStart,
    dateEnd: fields.dateEnd || fields.dateStart,
    allDay: !!fields.allDay,
    timeStart: fields.allDay ? null : (fields.timeStart || '09:00'),
    timeEnd: fields.allDay ? null : (fields.timeEnd || '10:00'),
  };
  if (entry.dateEnd < entry.dateStart) entry.dateEnd = entry.dateStart;
  list.push(entry);
  await write(list);
  return entry;
}

export async function updateHubEvent(id, fields) {
  const list = read();
  const idx = list.findIndex((e) => e.id === id);
  if (idx === -1) return;
  const merged = { ...list[idx], ...fields };
  if (merged.allDay) { merged.timeStart = null; merged.timeEnd = null; }
  if (!merged.dateEnd || merged.dateEnd < merged.dateStart) merged.dateEnd = merged.dateStart;
  list[idx] = merged;
  await write(list);
}

export async function deleteHubEvent(id) {
  await write(read().filter((e) => e.id !== id));
}

/** Einmal beim App-Start syncen, falls der gemeinsame Store (IndexedDB) seit
 *  der letzten Session geleert wurde, waehrend die eigenen Termine (localStorage)
 *  erhalten blieben - sonst wuerden sie im Kalender bis zur naechsten Aenderung
 *  unsichtbar bleiben. */
export function ensureHubEventsSynced() {
  return syncToStore(read());
}
