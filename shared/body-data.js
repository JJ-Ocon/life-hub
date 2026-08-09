// Gemeinsames Koerperdaten-Modul: Fitness ist die alleinige Quelle (schreibt
// nach jeder Kalorienbedarfsrechnung), andere Apps lesen nur. Gespeichert wird
// das FERTIGE Rechenergebnis (BMR, Aktivitaetsfaktor, Trainingsverbrauch,
// Zielwerte), nicht die Rohdaten - so muss keine zweite App die Mifflin-St-Jeor-
// Formel oder die Trainings-Kalorienschaetzung duplizieren.

const KEY = 'bd_calorie_needs_v1';
const PROPORTIONS_KEY = 'bd_body_proportions_v1';

function read(key) {
  try {
    const raw = localStorage.getItem(key);
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
  return read(KEY);
}

/** Von der Fitness-App aufgerufen, sobald sich der neueste bekannte Wert
 *  einer Koerper-Maß-Metrik (Beinlaenge, Torsolaenge, Schulterbreite,
 *  Taillenbreite - alle in cm) aendert. Gleiches Prinzip wie die
 *  Kalorienbedarfs-Werte: nur der letzte bekannte Stand pro Feld, keine
 *  Zeitreihe. `proportions` mit einem Feld auf null loescht nur dieses
 *  Feld, nicht den ganzen geteilten Stand. */
export function publishBodyProportions(proportions) {
  try {
    if (!proportions || Object.values(proportions).every((v) => v == null)) {
      localStorage.removeItem(PROPORTIONS_KEY);
      return;
    }
    localStorage.setItem(PROPORTIONS_KEY, JSON.stringify({ ...proportions, updatedAt: new Date().toISOString() }));
  } catch {
    // Geteilter Speicher ist ein optionales Extra, kein Kernfeature.
  }
}

/** Von anderen Apps (aktuell Kleidung) gelesen. */
export function getSharedBodyProportions() {
  return read(PROPORTIONS_KEY);
}
