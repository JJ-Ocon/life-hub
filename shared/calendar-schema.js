// Gemeinsames Kalender-Event-Schema fuers Oekosystem (siehe Brainstorm-Dokument,
// Abschnitt "Gemeinsame Datenmodelle"). Jede App, die Termine in den
// Haupt-Kalender spiegeln will, erzeugt ihre Eintraege ueber createCalendarEvent()
// und haelt sich an dieses Schema - der Hub kennt dadurch keine App-Interna,
// nur dieses eine gemeinsame Format. Aktiv genutzt von: fitness, goals, job.

/**
 * @typedef {Object} CalendarEvent
 * @property {string} id
 * @property {string} title
 * @property {string} start        ISO-Datum/-Zeit
 * @property {string} [end]        ISO-Datum/-Zeit, optional bei ganztaegigen Eintraegen
 * @property {string} source       Kurzname der Quell-App, z.B. 'fitness', 'budget'
 * @property {string} [recurrence] z.B. 'weekly', 'monthly' - frei je App interpretiert
 */

/** @param {Partial<CalendarEvent>} fields */
export function createCalendarEvent(fields) {
  if (!fields.title || !fields.start || !fields.source) {
    throw new Error('createCalendarEvent: title, start und source sind Pflichtfelder');
  }
  return {
    id: fields.id || crypto.randomUUID(),
    title: fields.title,
    start: fields.start,
    end: fields.end ?? null,
    source: fields.source,
    recurrence: fields.recurrence ?? null,
  };
}

/* ---------- Farben pro Quell-App ----------
 * Jede App bekommt eine Default-Farbe, damit man sie im Hauptkalender
 * unterscheiden kann. Ueberschreibungen liegen (App-uebergreifend, da
 * localStorage same-origin geteilt wird) unter COLOR_OVERRIDES_KEY. */
const SOURCE_META = {
  fitness: { label: 'Trainingslog', color: '#2fd9a0' },
  goals: { label: 'Ziele/Todo', color: '#c76ae0' },
  job: { label: 'Job', color: '#4f8fd9' },
};
const COLOR_OVERRIDES_KEY = 'hub_source_colors_v1';

function readOverrides() {
  try { return JSON.parse(localStorage.getItem(COLOR_OVERRIDES_KEY) || '{}'); } catch { return {}; }
}

export function knownSources() {
  return Object.keys(SOURCE_META);
}

export function getSourceLabel(source) {
  return SOURCE_META[source]?.label || source;
}

export function getSourceColor(source) {
  return readOverrides()[source] || SOURCE_META[source]?.color || '#888888';
}

export function setSourceColor(source, color) {
  const overrides = readOverrides();
  overrides[source] = color;
  localStorage.setItem(COLOR_OVERRIDES_KEY, JSON.stringify(overrides));
}
