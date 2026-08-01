/* =========================================================
   Kalorienbedarf
   Grundumsatz nach Mifflin-St-Jeor, Alltagsaktivitaet als Faktor,
   Trainingsverbrauch aus dem Wochenplan ueber MET-Werte.

   Alle Werte sind Schaetzungen auf Basis gaengiger Formeln – keine
   medizinische oder ernaehrungsberatende Empfehlung.
   ========================================================= */

import {
  getSettings, getWeeklyPlan, getExerciseById, projectPlanDays,
  getLatestWeight, hasCompleteProfile, DAILY_ACTIVITY_LEVELS,
} from './db.js';
import { ageFromBirthDate } from './utils.js';

/* ---------- MET-Werte (metabolisches Aequivalent) ---------- */
// Quelle der Groessenordnungen: Compendium of Physical Activities.
// Zuordnung ueber Namensmuster, sonst Fallback ueber die Muskelgruppe.

const MET_BY_PATTERN = [
  [/seilspring|jump\s?rope/i, 11.0],
  [/lauf|running|\brun\b|jog/i, 9.8],
  [/airbike|air\s?bike|assault/i, 8.5],
  [/rudergerät|rowing machine|ergometer/i, 7.0],
  [/bike|rad(fahren)?|cycl|recliner|spinning/i, 7.0],
  [/schwimm|swim/i, 8.0],
  [/burpee|hiit|circuit/i, 8.0],
  [/carry|farmer/i, 6.0],
  [/dead\s?hang|plank|hold/i, 3.5],
];

const MET_CARDIO_DEFAULT = 7.0;
const MET_STRENGTH_DEFAULT = 5.0; // kraeftiges Krafttraining
const MET_REST_BETWEEN_SETS = 1.5; // Pausen zaehlen kaum

/** Schaetzt den MET-Wert einer Uebung. */
function metForExercise(exercise) {
  const name = exercise?.name || '';
  for (const [pattern, met] of MET_BY_PATTERN) {
    if (pattern.test(name)) return met;
  }
  if (exercise?.muscleGroup === 'Cardio') return MET_CARDIO_DEFAULT;
  return MET_STRENGTH_DEFAULT;
}

/** kcal fuer eine Aktivitaet: MET x 3,5 x kg / 200 = kcal pro Minute */
function kcalFor(met, minutes, weightKg) {
  return (met * 3.5 * weightKg / 200) * minutes;
}

// Annahme fuer Wiederholungs-Saetze: reine Arbeitszeit je Satz.
const SECONDS_PER_WORKING_SET = 40;

/**
 * Schaetzt Dauer und Kalorienverbrauch einer Routine.
 * @returns {{workMin:number, restMin:number, totalMin:number, kcal:number}}
 */
export function estimateRoutineLoad(routine, weightKg) {
  let workSeconds = 0;
  let restSeconds = 0;
  let kcal = 0;

  for (const re of routine.exercises || []) {
    const exercise = getExerciseById(re.exerciseId);
    const met = metForExercise(exercise);
    const sets = re.sets || [];

    let exerciseSeconds = 0;
    for (const s of sets) {
      // 'time' und 'cardio' tragen ihre Dauer direkt in Sekunden, sonst Pauschale je Satz
      exerciseSeconds += (re.mode === 'time' || re.mode === 'cardio') ? (Number(s.seconds) || 0) : SECONDS_PER_WORKING_SET;
    }
    workSeconds += exerciseSeconds;
    kcal += kcalFor(met, exerciseSeconds / 60, weightKg);

    // Pausen nur zwischen den Saetzen, nicht nach dem letzten
    const pauses = Math.max(0, sets.length - 1) * (Number(re.restSeconds) || 0);
    restSeconds += pauses;
    kcal += kcalFor(MET_REST_BETWEEN_SETS, pauses / 60, weightKg);
  }

  return {
    workMin: workSeconds / 60,
    restMin: restSeconds / 60,
    totalMin: (workSeconds + restSeconds) / 60,
    kcal,
  };
}

/**
 * Summiert den Trainingsaufwand des geplanten Zyklus, gemittelt auf eine Woche.
 * Projiziert einen vollen Zyklus (kann mehrere Wochen umfassen, inkl. Rotationen)
 * und teilt die Summen durch die Anzahl Wochen im Zyklus.
 * @returns {{days:{date:string, routineName:string, minutes:number, kcal:number}[],
 *            weeklyKcal:number, weeklyMinutes:number, dailyKcal:number, sessions:number}}
 */
export function weeklyTrainingLoad(weightKg, plan = getWeeklyPlan()) {
  const cycleDays = plan.cycleLength || 7;
  const projected = projectPlanDays(plan, plan.anchorDate, cycleDays);
  const weeks = cycleDays / 7;

  const days = projected.map(({ date, routine }) => {
    const load = estimateRoutineLoad(routine, weightKg);
    return { date, routineName: routine.name, minutes: load.totalMin, kcal: load.kcal };
  });
  const totalKcal = days.reduce((sum, d) => sum + d.kcal, 0);
  const totalMinutes = days.reduce((sum, d) => sum + d.minutes, 0);

  return {
    days,
    weeklyKcal: totalKcal / weeks,
    weeklyMinutes: totalMinutes / weeks,
    dailyKcal: totalKcal / cycleDays,
    sessions: days.length / weeks,
  };
}

/** Grundumsatz nach Mifflin-St-Jeor. */
export function calcBmr({ weightKg, heightCm, age, sex }) {
  if (!weightKg || !heightCm || age == null || !sex) return null;
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === 'female' ? base - 161 : base + 5;
}

/**
 * Vollstaendige Kalorienbedarfs-Rechnung.
 * @returns {null | {
 *   bmr:number, activityFactor:number, activityLabel:string,
 *   baseWithoutTraining:number, trainingDaily:number, maintenance:number,
 *   targets:{key:string,label:string,kcal:number,hint:string,belowBmr:boolean}[],
 *   training:ReturnType<typeof weeklyTrainingLoad>, weightKg:number, age:number
 * }}
 */
export function calcCalorieNeeds() {
  const settings = getSettings();
  if (!hasCompleteProfile(settings)) return null;

  const weightKg = getLatestWeight();
  if (!weightKg) return null;

  const age = ageFromBirthDate(settings.birthDate);
  const bmr = calcBmr({ weightKg, heightCm: settings.heightCm, age, sex: settings.sex });
  if (!bmr) return null;

  const level = DAILY_ACTIVITY_LEVELS.find((l) => l.key === settings.dailyActivity) || DAILY_ACTIVITY_LEVELS[0];
  const baseWithoutTraining = bmr * level.factor;

  const training = weeklyTrainingLoad(weightKg);
  const maintenance = baseWithoutTraining + training.dailyKcal;

  const targets = [
    { key: 'cut1000', label: 'Diät – aggressiv', kcal: maintenance - 1000, hint: '−1000 kcal · ca. 1 kg/Woche' },
    { key: 'cut500', label: 'Diät – moderat', kcal: maintenance - 500, hint: '−500 kcal · ca. 0,5 kg/Woche' },
    { key: 'maintain', label: 'Erhaltung', kcal: maintenance, hint: 'Gewicht halten' },
    { key: 'bulk5', label: 'Aufbau – leicht', kcal: maintenance * 1.05, hint: '+5 % Überschuss' },
    { key: 'bulk10', label: 'Aufbau – stark', kcal: maintenance * 1.10, hint: '+10 % Überschuss' },
  ].map((t) => ({ ...t, kcal: Math.round(t.kcal), belowBmr: t.kcal < bmr }));

  return {
    bmr: Math.round(bmr),
    activityFactor: level.factor,
    activityLabel: level.label,
    baseWithoutTraining: Math.round(baseWithoutTraining),
    trainingDaily: Math.round(training.dailyKcal),
    maintenance: Math.round(maintenance),
    targets,
    training,
    weightKg,
    age,
  };
}

/** Welche Profilangaben fehlen noch fuer die Berechnung? */
export function missingProfileFields() {
  const s = getSettings();
  const missing = [];
  if (!s.heightCm) missing.push('Körpergröße');
  if (!s.birthDate) missing.push('Geburtsdatum');
  if (!s.sex) missing.push('Geschlecht');
  if (!getLatestWeight()) missing.push('Körpergewicht (Eintrag anlegen)');
  return missing;
}
