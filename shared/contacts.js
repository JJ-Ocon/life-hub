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
  me: 'ct_me_v1',
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
//   role (string, frei, z.B. "Mutter"/"Bester Freund" - E59),
//   closeness (CLOSENESS_LEVELS-Key|null - E59),
//   phone (string), email (string), socialHandles: {id,platform,handle}[] - E59,
//   socialProfile: { groupName, howMet, tags: string[], remindWeeks } | null,
//   jobProfile: { company, position, relation: 'colleague'|'client', careerNotes } | null,
//   createdAt
// }
//
// phone/email/socialHandles bewusst im Klartext (E59): dieselbe
// Bedrohungsmodell-Begruendung wie ueberall sonst im Oekosystem ausserhalb
// von Safety/Diary - die Daten verlassen nie dieses Geraet (kein Cloud-Sync),
// ein Angreifer braeuchte ohnehin Geraetezugriff. Eine volle Verschluesselung
// wie beim Digitalen Safe wuerde ausserdem einen App-weiten Entsperr-Screen
// erzwingen, waehrend Social's eigene Geburtstage (E37) schon plaintext in
// den geteilten Kalender gespiegelt werden - eine Teil-Verschluesselung nur
// dieser drei Felder haette also ohnehin keine saubere Sicherheitsgrenze.

/** Feste Naehe-Stufen zu "Ich" (E59) - Rang bestimmt den Ring-Abstand im
 *  Netzwerk-Graphen (1 = innerster Ring/naechste Stufe). Die Reihenfolge im
 *  Plan-Dokument war keine Rangfolge, nur eine Aufzaehlung mit Beispielen -
 *  Rang hier bewusst so gewaehlt, dass "Bester Freund" naeher sitzt als
 *  "Familie" ohne "eng", was der ueblichen Intuition entspricht. */
export const CLOSENESS_LEVELS = [
  { key: 'enge_familie', label: 'Enge Familie', rank: 1 },
  { key: 'bester_freund', label: 'Bester Freund', rank: 2 },
  { key: 'familie', label: 'Familie', rank: 3 },
  { key: 'freunde', label: 'Freunde', rank: 4 },
  { key: 'entfernte_familie', label: 'Entfernte Familie', rank: 5 },
  { key: 'bekannte', label: 'Bekannte', rank: 6 },
];

export function closenessLabel(key) {
  return CLOSENESS_LEVELS.find((c) => c.key === key)?.label || null;
}

/** Rang fuer die Ring-Platzierung - unklassifizierte Kontakte bekommen den
 *  aeussersten Ring (kein `key`/unbekannter Wert), statt ausgeblendet zu werden. */
export function closenessRank(key) {
  return CLOSENESS_LEVELS.find((c) => c.key === key)?.rank ?? CLOSENESS_LEVELS.length + 1;
}

export function getPeople() {
  return read(KEYS.people, []);
}

export function getPersonById(id) {
  return getPeople().find((p) => p.id === id) || null;
}

/** Bereits vergebene Rollen-Werte, alphabetisch - fuer Vorschlag-Chips beim
 *  Anlegen/Bearbeiten, gleiches "was schon benutzt wird" Prinzip wie
 *  Inventars Unterkategorien (E53) statt einer separat gepflegten Liste. */
export function getRolesInUse() {
  const set = new Set(getPeople().map((p) => p.role).filter(Boolean));
  return [...set].sort((a, b) => a.localeCompare(b, 'de'));
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
    role: fields.role || '',
    closeness: fields.closeness || null,
    phone: fields.phone || '',
    email: fields.email || '',
    socialHandles: fields.socialHandles || [],
    socialProfile: fields.socialProfile || null,
    jobProfile: fields.jobProfile || null,
    createdAt: new Date().toISOString(),
  };
  return savePerson(person);
}

/* =========================================================
   "Ich" – Mittelpunkt der Netzwerk-Darstellung (E59). Kein Person-Datensatz
   (keine Verknuepfungen/Interaktionen mit sich selbst noetig) - nur ein
   optionaler Namens-Override fuer die Beschriftung im Graphen, Default "Ich".
   ========================================================= */

export function getMe() {
  return read(KEYS.me, { name: 'Ich' });
}

export function saveMe(fields) {
  const merged = { ...getMe(), ...fields };
  write(KEYS.me, merged);
  return merged;
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
   speist die Netzwerk-Darstellung von Social/Job.

   `confirmedBy` haelt fest, von welcher Seite(n) aus die Verknuepfung
   angelegt wurde: wird sie nur von einer Person aus deren eigenem
   Kontakt-Detail hinzugefuegt, ist es (noch) einseitiges Kennen; legt die
   andere Person spaeter unabhaengig ebenfalls eine Verknuepfung zu dieser
   Person an, wird derselbe Datensatz nur um die zweite Bestaetigung
   ergaenzt statt dupliziert - `confirmedBy.length === 2` heisst beidseitig
   bestaetigt. Alt-Datensaetze ohne `confirmedBy` (vor dieser Etappe
   angelegt) gelten als nur von personIdA aus bestaetigt, siehe
   confirmedByOf() unten - keine Migration noetig.
   ========================================================= */
// Link: { id, personIdA, personIdB, confirmedBy: string[] }

export function getLinks() {
  return read(KEYS.links, []);
}

export function getLinksForPerson(personId) {
  return getLinks().filter((l) => l.personIdA === personId || l.personIdB === personId);
}

/** Wer die Verknuepfung (mindestens) bestaetigt hat - faellt bei
 *  Alt-Datensaetzen ohne das Feld auf personIdA zurueck. */
export function confirmedByOf(link) {
  return link.confirmedBy || [link.personIdA];
}

/** true, wenn beide Seiten die Verknuepfung unabhaengig angelegt haben. */
export function isMutualLink(link) {
  return confirmedByOf(link).length >= 2;
}

/** `fromId` bestaetigt, `toId` zu kennen. Existiert die Verknuepfung (in
 *  beliebiger Richtung) schon, wird `fromId` nur als zusaetzliche
 *  Bestaetigung ergaenzt statt einen zweiten Datensatz anzulegen. */
export function addLink(fromId, toId) {
  if (fromId === toId) return null;
  const links = getLinks();
  const existing = links.find((l) =>
    (l.personIdA === fromId && l.personIdB === toId) ||
    (l.personIdA === toId && l.personIdB === fromId));
  if (existing) {
    const confirmedBy = confirmedByOf(existing);
    if (confirmedBy.includes(fromId)) return existing;
    const updated = { ...existing, confirmedBy: [...confirmedBy, fromId] };
    write(KEYS.links, links.map((l) => (l.id === existing.id ? updated : l)));
    return updated;
  }
  const link = { id: uid(), personIdA: fromId, personIdB: toId, confirmedBy: [fromId] };
  write(KEYS.links, [...links, link]);
  return link;
}

export function removeLink(id) {
  write(KEYS.links, getLinks().filter((l) => l.id !== id));
}

/* =========================================================
   Export / Import (fuer die App-eigenen Backup-Funktionen)
   ========================================================= */

export function exportContacts() {
  return { people: getPeople(), interactions: getInteractions(), links: getLinks(), me: getMe() };
}

export function importContacts(data) {
  if (data.people) write(KEYS.people, data.people);
  if (data.interactions) write(KEYS.interactions, data.interactions);
  if (data.links) write(KEYS.links, data.links);
  if (data.me) write(KEYS.me, data.me);
}

export function resetContacts() {
  localStorage.removeItem(KEYS.people);
  localStorage.removeItem(KEYS.interactions);
  localStorage.removeItem(KEYS.links);
  localStorage.removeItem(KEYS.me);
}
