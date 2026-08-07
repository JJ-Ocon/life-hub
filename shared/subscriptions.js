// Geteiltes Modul: externe Apps (aktuell nur Haushalt) veroeffentlichen ihre
// wiederkehrenden Kosten hier, damit Budgets Abo-Radar sie zusammen mit den
// eigenen wiederkehrenden Ausgaben anzeigen kann - gleiches Muster wie
// shared/body-data.js (E21): das Ergebnis wird geteilt, nicht die Rohdaten,
// und die Quelle bleibt fuer ihre eigenen Datensaetze verantwortlich.

const KEY = 'sub_external_v1'; // { [source]: Array<{id, label, monthlyEquivalent, note}> }

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function write(all) {
  localStorage.setItem(KEY, JSON.stringify(all));
}

/** Ersetzt komplett die veroeffentlichte Liste einer Quelle (z.B. 'household'). */
export function publishExternalSubscriptions(source, items) {
  const all = read();
  if (!items || !items.length) {
    delete all[source];
  } else {
    all[source] = items;
  }
  write(all);
}

/** Alle veroeffentlichten Eintraege ueber alle Quellen hinweg, je mit `source` markiert. */
export function getExternalSubscriptions() {
  const all = read();
  return Object.entries(all).flatMap(([source, items]) => items.map((i) => ({ ...i, source })));
}
