// Import von Koerperdaten aus offenen Formaten (Apple-Health-Export-XML,
// FHIR-Observation-Bundles) statt einer geraeteproprietaeren Anbindung -
// beides laesst sich rein clientseitig parsen (DOMParser fuer XML, JSON.parse
// fuer FHIR), kein Server/Backend noetig, passt zum local-first-Prinzip.

const LB_TO_KG = 0.453592;
const IN_TO_CM = 2.54;

function toKg(value, unit) {
  const u = (unit || 'kg').toLowerCase();
  if (u === 'lb' || u === 'lbs' || u === '[lb_av]') return value * LB_TO_KG;
  return value;
}

function toCm(value, unit) {
  const u = (unit || 'cm').toLowerCase();
  if (u === 'in' || u === 'inch' || u === '[in_i]') return value * IN_TO_CM;
  return value;
}

/** Nimmt eine kg-Zahl und rechnet sie in die aktuell eingestellte Anzeige-
 *  Einheit um - Koerpergewicht wird in dieser App nicht als echtes
 *  Einheitensystem gefuehrt, sondern die eingetragene Zahl einfach mit der
 *  jeweils aktuellen settings.units-Einheit beschriftet (siehe body.js).
 *  Importierte Werte muessen sich also an diese bestehende Konvention
 *  anpassen, sonst zeigt die App nach einem lb-Export ploetzlich kg-Zahlen
 *  mit "lb" beschriftet an. */
function kgToDisplayUnit(kg, displayUnit) {
  return displayUnit === 'lb' ? kg / LB_TO_KG : kg;
}

/* ---------- Apple Health Export (export.xml) ---------- */
// Record-Typen, die diese App auswerten kann - alles andere (Schritte,
// Herzfrequenz, Schlaf, ...) wird ignoriert, da es keine passenden Felder
// in Fitness' Koerperdaten-Modell hat.
const HK_TYPES = {
  HKQuantityTypeIdentifierBodyMass: 'weight',
  HKQuantityTypeIdentifierBodyFatPercentage: 'bodyFat',
  HKQuantityTypeIdentifierLeanBodyMass: 'muscle',
  HKQuantityTypeIdentifierWaistCircumference: 'waist',
};

/** Parst ein Apple-Health-Export-XML (export.xml aus dem "Gesundheit"-App-
 *  Export). Gibt { entriesByDate: Map<date, {weight?, bodyFat?, muscle?, waist?}>,
 *  heightCm: number|null, counts: {[metricKey]: number} } zurueck. */
export function parseHealthKitXml(text, displayUnit = 'kg') {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('Ungültiges XML - ist das wirklich eine export.xml?');

  const entriesByDate = new Map();
  const counts = {};
  let heightCm = null;
  let heightDate = '';

  const records = doc.querySelectorAll('Record');
  for (const r of records) {
    const type = r.getAttribute('type');
    const startDate = r.getAttribute('startDate'); // "2026-08-01 08:00:00 +0200"
    const value = parseFloat(r.getAttribute('value'));
    const unit = r.getAttribute('unit');
    if (!startDate || Number.isNaN(value)) continue;
    const dateKey = startDate.slice(0, 10);

    if (type === 'HKQuantityTypeIdentifierHeight') {
      const cm = toCm(value, unit);
      if (!heightDate || startDate > heightDate) { heightCm = cm; heightDate = startDate; }
      continue;
    }

    const metricKey = HK_TYPES[type];
    if (!metricKey) continue;

    let v;
    if (metricKey === 'bodyFat') {
      v = value <= 1 ? value * 100 : value; // HealthKit speichert Anteil (0-1) unter Einheit "%"
    } else if (metricKey === 'waist') {
      v = toCm(value, unit);
    } else {
      v = kgToDisplayUnit(toKg(value, unit), displayUnit);
    }

    const entry = entriesByDate.get(dateKey) || {};
    entry[metricKey] = v;
    entriesByDate.set(dateKey, entry);
    counts[metricKey] = (counts[metricKey] || 0) + 1;
  }

  return { entriesByDate, heightCm, counts };
}

/* ---------- FHIR Observation Bundle ---------- */
// LOINC-Codes fuer die relevanten Vitalwerte, plus Text-Fallback fuer
// Bundles, die keine (oder andere) Codes mitliefern.
const FHIR_LOINC = {
  '29463-7': 'weight',
  '3141-9': 'weight',
  '41982-0': 'bodyFat',
  '8302-2': 'height',
};
const FHIR_TEXT_HINTS = [
  { re: /body\s*weight|gewicht/i, key: 'weight' },
  { re: /body\s*fat|körperfett/i, key: 'bodyFat' },
  { re: /\bheight\b|körpergröße/i, key: 'height' },
];

function fhirObservationKey(coding, text) {
  for (const c of coding || []) {
    if (FHIR_LOINC[c.code]) return FHIR_LOINC[c.code];
  }
  const combined = `${text || ''} ${(coding || []).map((c) => c.display || '').join(' ')}`;
  for (const hint of FHIR_TEXT_HINTS) {
    if (hint.re.test(combined)) return hint.key;
  }
  return null;
}

/** Parst ein FHIR-Bundle (resourceType "Bundle" mit Observation-Eintraegen,
 *  z.B. aus einem Export-Tool eines anderen Gesundheits-Anbieters). Gleiche
 *  Rueckgabeform wie parseHealthKitXml. */
export function parseFhirBundle(json, displayUnit = 'kg') {
  const entries = json.entry || (json.resourceType === 'Observation' ? [{ resource: json }] : []);
  if (!entries.length) throw new Error('Kein FHIR-Bundle mit Observation-Einträgen gefunden.');

  const entriesByDate = new Map();
  const counts = {};
  let heightCm = null;
  let heightDate = '';

  for (const e of entries) {
    const res = e.resource;
    if (!res || res.resourceType !== 'Observation') continue;
    const key = fhirObservationKey(res.code?.coding, res.code?.text);
    if (!key) continue;
    const q = res.valueQuantity;
    if (!q || typeof q.value !== 'number') continue;
    const dateKey = (res.effectiveDateTime || res.issued || '').slice(0, 10);
    if (!dateKey) continue;

    if (key === 'height') {
      const cm = toCm(q.value, q.unit || q.code);
      if (!heightDate || dateKey > heightDate) { heightCm = cm; heightDate = dateKey; }
      continue;
    }

    let v;
    if (key === 'bodyFat') {
      v = q.value <= 1 ? q.value * 100 : q.value;
    } else {
      v = kgToDisplayUnit(toKg(q.value, q.unit || q.code), displayUnit);
    }

    const entry = entriesByDate.get(dateKey) || {};
    entry[key] = v;
    entriesByDate.set(dateKey, entry);
    counts[key] = (counts[key] || 0) + 1;
  }

  return { entriesByDate, heightCm, counts };
}

/** Erkennt das Format anhand des Dateiinhalts (nicht nur der Endung, damit
 *  z.B. eine umbenannte Datei trotzdem korrekt erkannt wird). */
export function detectFormatAndParse(text, displayUnit = 'kg') {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{')) {
    return { format: 'fhir', ...parseFhirBundle(JSON.parse(trimmed), displayUnit) };
  }
  if (trimmed.startsWith('<')) {
    return { format: 'healthkit', ...parseHealthKitXml(trimmed, displayUnit) };
  }
  throw new Error('Format nicht erkannt - weder XML (Apple Health) noch JSON (FHIR).');
}
