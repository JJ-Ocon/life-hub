// Minimaler iCalendar (.ics) Parser fuers Importieren fremder Kalender in
// den Hub-Kalender (E-Hub-ICS-Import). Bewusst simpel gehalten (wie
// shared/receipt-ocr.js's Heuristiken) - deckt die haeufigen Faelle ab
// (SUMMARY/DTSTART/DTEND/LOCATION, ganztaegig oder mit Uhrzeit), keine
// wiederkehrenden Termine (RRULE) und keine echte Zeitzonen-Umrechnung
// (TZID-Parameter wird ignoriert, die Uhrzeit wird als lokale Zeit
// uebernommen - fuer den persoenlichen Gebrauch ausreichend genau).

/** Loest Zeilenumbrueche nach RFC5545 auf: eine Fortsetzungszeile beginnt
 *  mit einem Leerzeichen/Tab und gehoert zur vorherigen Zeile. */
function unfoldLines(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '');
}

/** "20260815" (ganztaegig) oder "20260815T090000"/"...Z" (mit Uhrzeit). */
function parseICSDate(raw) {
  const clean = raw.replace('Z', '');
  if (clean.length < 8) return null;
  const dateKey = `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`;
  if (clean.length < 13 || clean[8] !== 'T') return { dateKey, time: null };
  return { dateKey, time: `${clean.slice(9, 11)}:${clean.slice(11, 13)}` };
}

function unescapeText(s) {
  return s.replace(/\\n/gi, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

/**
 * @param {string} icsText
 * @returns {Array<{title:string, start:{dateKey:string,time:string|null}, end:{dateKey:string,time:string|null}|null, location:string|null}>}
 */
export function parseICS(icsText) {
  const lines = unfoldLines(icsText).split('\n').map((l) => l.trim()).filter(Boolean);
  const events = [];
  let current = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { current = {}; continue; }
    if (line === 'END:VEVENT') { if (current) events.push(current); current = null; continue; }
    if (!current) continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).split(';')[0].toUpperCase();
    const value = line.slice(colonIdx + 1);
    if (key === 'SUMMARY') current.title = unescapeText(value);
    else if (key === 'DTSTART') current.start = parseICSDate(value);
    else if (key === 'DTEND') current.end = parseICSDate(value);
    else if (key === 'LOCATION') current.location = unescapeText(value);
  }
  return events.filter((e) => e.title && e.start);
}
