// Gemeinsames Kalender-Event-Schema fuers Oekosystem (siehe Brainstorm-Dokument,
// Abschnitt "Gemeinsame Datenmodelle"). Jede App, die Termine in den
// Haupt-Kalender spiegeln will, erzeugt ihre Eintraege ueber createCalendarEvent()
// und haelt sich an dieses Schema - der Hub kennt dadurch keine App-Interna,
// nur dieses eine gemeinsame Format.
//
// Wird noch nicht aktiv genutzt (die Fitness-App hat ihr eigenes,
// aelteres Kalender-Datenmodell) - Anschluss folgt in einer spaeteren Etappe,
// sobald der Same-Origin-Trick auf echten Geraeten verifiziert ist.

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
