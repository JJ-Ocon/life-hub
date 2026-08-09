// Gemeinsamer Kanal fuer den Lebensmittel-Kosten-Abgleich zwischen Budget
// und Meal Planning (E52): Budget ist alleinige Quelle (schreibt nach jeder
// Ausgaben-Aenderung den aktuellen Monats-Betrag der Kategorie "Lebensmittel"),
// Meal liest nur - gleiches Einweg-Muster wie shared/body-data.js.

const KEY = 'gc_grocery_spend_v1';

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Von der Budget-App aufgerufen. `amount` ist die Summe der Kategorie
 *  "Lebensmittel" fuer `month` (YYYY-MM). */
export function publishGrocerySpend(month, amount) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ month, amount, updatedAt: new Date().toISOString() }));
  } catch {
    // Geteilter Speicher ist ein optionales Extra, kein Kernfeature.
  }
}

/** Von Meal Planning gelesen - null, wenn Budget noch nie publiziert hat. */
export function getSharedGrocerySpend() {
  return read();
}
