// Minimaler vCard (.vcf) Generator/Parser fuers Kontakt-Sync mit dem
// Android-Geraet (E-Kontakte-VCF) - deckt genau die Felder ab, die
// shared/contacts.js's Person-Modell tatsaechlich hat (Name, Geburtstag,
// Telefon, E-Mail, Rolle als Notiz), keine Fotos/Organisationen. vCard 3.0,
// am breitesten unterstuetzt (Android Contacts, Outlook, iOS alle kompatibel).

function escapeVcf(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n');
}

function unescapeVcf(s) {
  return String(s ?? '').replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

/** Naive Vor-/Nachname-Aufteilung fuers strukturierte N-Feld: letztes Wort
 *  = Nachname, Rest = Vorname - Person hat kein eigenes Vor-/Nachname-Feld,
 *  das ist die einzig sinnvolle Heuristik ohne dafuer extra UI einzufuehren. */
function splitName(fullName) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { given: fullName.trim(), family: '' };
  return { given: parts.slice(0, -1).join(' '), family: parts[parts.length - 1] };
}

/** @param {Array} people shared/contacts.js Person-Objekte */
export function generateVcf(people) {
  const cards = people.map((p) => {
    const { given, family } = splitName(p.name);
    const lines = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      `FN:${escapeVcf(p.name)}`,
      `N:${escapeVcf(family)};${escapeVcf(given)};;;`,
    ];
    if (p.phone) lines.push(`TEL;TYPE=CELL:${escapeVcf(p.phone)}`);
    if (p.email) lines.push(`EMAIL:${escapeVcf(p.email)}`);
    if (p.birthday) lines.push(`BDAY:${p.birthday}`);
    if (p.role) lines.push(`NOTE:${escapeVcf(p.role)}`);
    lines.push('END:VCARD');
    return lines.join('\r\n');
  });
  return cards.join('\r\n');
}

function unfoldLines(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '');
}

/**
 * @param {string} vcfText
 * @returns {Array<{name:string, phone?:string, email?:string, birthday?:string, role?:string}>}
 */
export function parseVcf(vcfText) {
  const lines = unfoldLines(vcfText).split('\n').map((l) => l.trim()).filter(Boolean);
  const cards = [];
  let current = null;
  for (const line of lines) {
    if (line.toUpperCase() === 'BEGIN:VCARD') { current = {}; continue; }
    if (line.toUpperCase() === 'END:VCARD') { if (current?.name) cards.push(current); current = null; continue; }
    if (!current) continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).split(';')[0].toUpperCase();
    const value = unescapeVcf(line.slice(colonIdx + 1));
    if (key === 'FN') {
      current.name = value;
    } else if (key === 'N' && !current.name) {
      const [family, given] = value.split(';');
      current.name = [given, family].filter(Boolean).join(' ').trim();
    } else if (key === 'TEL' && !current.phone) {
      current.phone = value;
    } else if (key === 'EMAIL' && !current.email) {
      current.email = value;
    } else if (key === 'BDAY') {
      current.birthday = value.length >= 10 ? value.slice(0, 10) : null;
    } else if (key === 'NOTE' && !current.role) {
      current.role = value;
    }
  }
  return cards;
}
