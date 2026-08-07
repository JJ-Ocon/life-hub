// Gemeinsames Koerperdaten-Modul: Fitness ist die alleinige Quelle (schreibt
// nach jeder Kalorienbedarfsrechnung), andere Apps lesen nur. Gespeichert wird
// das FERTIGE Rechenergebnis (BMR, Aktivitaetsfaktor, Trainingsverbrauch,
// Zielwerte), nicht die Rohdaten - so muss keine zweite App die Mifflin-St-Jeor-
// Formel oder die Trainings-Kalorienschaetzung duplizieren.

const KEY = 'bd_calorie_needs_v1';

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Von der Fitness-App aufgerufen, sobald ein neues Rechenergebnis vorliegt.
 *  `result` ist null, wenn das Profil (noch) unvollstaendig ist - loescht
 *  dann den geteilten Stand, statt veraltete Werte stehen zu lassen. */
export function publishCalorieNeeds(result) {
  try {
    if (!result) { localStorage.removeItem(KEY); return; }
    localStorage.setItem(KEY, JSON.stringify({ ...result, updatedAt: new Date().toISOString() }));
  } catch {
    // Geteilter Speicher ist ein optionales Extra, kein Kernfeature.
  }
}

/** Von anderen Apps (aktuell Meal-Planning) gelesen. */
export function getSharedCalorieNeeds() {
  return read();
}
