// Gemeinsames Kontakt-Datenmodell fuers Oekosystem (siehe Brainstorm-Dokument,
// Abschnitt "Kontakt-Schema, vertieft"). Anders als der Kalender (jede App
// spiegelt eigene, App-besessene Events in einen geteilten Store) sind
// Personen echte GEMEINSAME Stammdaten: Social- und Job-App lesen und
// schreiben denselben Datensatz direkt, jede App erweitert ihn nur um ihr
// eigenes optionales Profil-Feld (socialProfile / jobProfile).
//
// Fotos sind bewusst nicht Teil von v1 (Avatar-Kuerzel statt Bild-Upload) -
// spart Speicher-/UI-Komplexitaet, die fuer den Kernnutzen nicht noetig ist.

const KEYS = {
  people: 'ct_people_v1',
  interactions: 'ct_interactions_v1',
  links: 'ct_links_v1',
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

function uid() {
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
}

/* =========================================================
   Personen – gemeinsamer Kern + optionale App-Profile
   ========================================================= */
// Person: {
//   id, name, birthday (YYYY-MM-DD|null), interests (string),
//   socialProfile: { groupName, howMet, tags: string[], remindWeeks } | null,
//   jobProfile: { company, position, relation: 'colleague'|'client', careerNotes } | null,
//   createdAt
// }

export function getPeople() {
  return read(KEYS.people, []);
}

export function getPersonById(id) {
  return getPeople().find((p) => p.id === id) || null;
}

export function savePerson(person) {
  const list = getPeople();
  const idx = list.findIndex((p) => p.id === person.id);
  if (idx >= 0) list[idx] = person; else list.push(person);
  write(KEYS.people, list);
  return person;
}

export function createPerson(fields) {
  const person = {
    id: uid(),
    name: fields.name,
    birthday: fields.birthday || null,
    interests: fields.interests || '',
    socialProfile: fields.socialProfile || null,
    jobProfile: fields.jobProfile || null,
    createdAt: new Date().toISOString(),
  };
  return savePerson(person);
}

/** Entfernt nur das jobProfile aller Personen (Social-Profil, Kern-Daten,
 *  Beziehungs-Log und Verknuepfungen bleiben unangetastet) - fuer die
 *  Job-App, damit "Alle Daten loeschen" dort NICHT versehentlich die
 *  geteilten Kontaktdaten der Social-App mitreisst. */
export function clearJobProfiles() {
  write(KEYS.people, getPeople().map((p) => ({ ...p, jobProfile: null })));
}

/** Loescht eine Person inkl. Beziehungs-Log-Eintraegen und Verknuepfungen -
 *  Loeschung soll bewusst niedrigschwellig sein (Datenschutz-Punkt im Dokument). */
export function deletePerson(id) {
  write(KEYS.people, getPeople().filter((p) => p.id !== id));
  write(KEYS.interactions, getInteractions().filter((i) => i.personId !== id));
  write(KEYS.links, getLinks().filter((l) => l.personIdA !== id && l.personIdB !== id));
}

/* =========================================================
   Beziehungs-Log – von Social-App (Beziehungspflege) und Job-App
   (leichtes CRM) gemeinsam genutzt.
   ========================================================= */
// Interaction: { id, personId, date (YYYY-MM-DD), note, createdAt }

export function getInteractions() {
  return read(KEYS.interactions, []);
}

export function getInteractionsForPerson(personId) {
  return getInteractions()
    .filter((i) => i.personId === personId)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function logInteraction(personId, date, note = '') {
  const list = getInteractions();
  list.push({ id: uid(), personId, date, note, createdAt: new Date().toISOString() });
  write(KEYS.interactions, list);
}

export function deleteInteraction(id) {
  write(KEYS.interactions, getInteractions().filter((i) => i.id !== id));
}

export function lastContactDate(personId) {
  const list = getInteractionsForPerson(personId);
  return list.length ? list[0].date : null;
}

/* =========================================================
   Verknuepfungstabelle ("wer kennt wen") – manuell gepflegt,
   speist die Netzwerk-Darstellung der Social-App.
   ========================================================= */
// Link: { id, personIdA, personIdB }

export function getLinks() {
  return read(KEYS.links, []);
}

export function getLinksForPerson(personId) {
  return getLinks().filter((l) => l.personIdA === personId || l.personIdB === personId);
}

export function addLink(personIdA, personIdB) {
  if (personIdA === personIdB) return null;
  const exists = getLinks().some((l) =>
    (l.personIdA === personIdA && l.personIdB === personIdB) ||
    (l.personIdA === personIdB && l.personIdB === personIdA));
  if (exists) return null;
  const link = { id: uid(), personIdA, personIdB };
  write(KEYS.links, [...getLinks(), link]);
  return link;
}

export function removeLink(id) {
  write(KEYS.links, getLinks().filter((l) => l.id !== id));
}

/* =========================================================
   Export / Import (fuer die App-eigenen Backup-Funktionen)
   ========================================================= */

export function exportContacts() {
  return { people: getPeople(), interactions: getInteractions(), links: getLinks() };
}

export function importContacts(data) {
  if (data.people) write(KEYS.people, data.people);
  if (data.interactions) write(KEYS.interactions, data.interactions);
  if (data.links) write(KEYS.links, data.links);
}

export function resetContacts() {
  localStorage.removeItem(KEYS.people);
  localStorage.removeItem(KEYS.interactions);
  localStorage.removeItem(KEYS.links);
}
