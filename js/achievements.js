/* =========================================================
   Meilensteine – rein lokale Motivationsmarken, kein Vergleich
   mit anderen. Alles wird aus dem vorhandenen Verlauf berechnet.
   ========================================================= */

import { getSessions, sessionVolume, getExercises, allSetsForExercise } from './db.js';
import { estimate1RM, isoWeekKey, addDays } from './utils.js';

/** Erste Einheit, ab der eine Schwelle erreicht wurde (fuer das Datum). */
function firstReaching(sessionsAsc, threshold, accessor) {
  let running = 0;
  for (const s of sessionsAsc) {
    running += accessor(s);
    if (running >= threshold) return s.endedAt;
  }
  return null;
}

const WORKOUT_TIERS = [10, 25, 50, 100, 250, 500];
const VOLUME_TIERS = [50_000, 250_000, 1_000_000, 5_000_000]; // kg
const STREAK_TIERS = [4, 12, 26, 52]; // Wochen in Folge
const STRENGTH_TIERS = [60, 100, 140, 180]; // kg in einem Arbeitssatz

/**
 * @returns {{key:string, label:string, hint:string, icon:string,
 *            achieved:boolean, at:string|null, progress:number, target:number, current:number}[]}
 */
export function computeAchievements() {
  const sessions = getSessions().filter((s) => s.endedAt);
  const asc = [...sessions].reverse(); // aelteste zuerst
  const out = [];

  /* ---------- Anzahl Einheiten ---------- */
  const total = asc.length;
  for (const tier of WORKOUT_TIERS) {
    out.push({
      key: `workouts-${tier}`,
      icon: '🏋️',
      label: `${tier} Workouts`,
      hint: 'abgeschlossene Einheiten',
      achieved: total >= tier,
      at: total >= tier ? asc[tier - 1].endedAt : null,
      current: total,
      target: tier,
      progress: Math.min(1, total / tier),
    });
  }

  /* ---------- Gesamtvolumen ---------- */
  const totalVolume = asc.reduce((sum, s) => sum + sessionVolume(s), 0);
  for (const tier of VOLUME_TIERS) {
    out.push({
      key: `volume-${tier}`,
      icon: '📦',
      label: `${formatTons(tier)} bewegt`,
      hint: 'Gesamtvolumen aller Sätze',
      achieved: totalVolume >= tier,
      at: totalVolume >= tier ? firstReaching(asc, tier, sessionVolume) : null,
      current: totalVolume,
      target: tier,
      progress: Math.min(1, totalVolume / tier),
    });
  }

  /* ---------- Wochen-Streak ---------- */
  const streak = currentWeekStreak(sessions);
  for (const tier of STREAK_TIERS) {
    out.push({
      key: `streak-${tier}`,
      icon: '🔥',
      label: `${tier} Wochen am Stück`,
      hint: 'jede Woche mindestens ein Training',
      achieved: streak >= tier,
      at: null,
      current: streak,
      target: tier,
      progress: Math.min(1, streak / tier),
    });
  }

  /* ---------- Kraftmeilensteine (bestes Arbeitsgewicht ueberhaupt) ---------- */
  let bestWeight = 0;
  let bestWeightExercise = '';
  let bestE1rm = 0;
  for (const ex of getExercises()) {
    for (const set of allSetsForExercise(ex.id)) {
      if (set.weight > bestWeight) { bestWeight = set.weight; bestWeightExercise = ex.name; }
      bestE1rm = Math.max(bestE1rm, estimate1RM(set.weight, set.reps));
    }
  }
  for (const tier of STRENGTH_TIERS) {
    out.push({
      key: `strength-${tier}`,
      icon: '💪',
      label: `${tier} kg in einem Satz`,
      hint: bestWeightExercise ? `Bestwert: ${bestWeightExercise}` : 'schwerster Arbeitssatz',
      achieved: bestWeight >= tier,
      at: null,
      current: bestWeight,
      target: tier,
      progress: Math.min(1, bestWeight / tier),
    });
  }

  return out;
}

/** Erreichte Meilensteine, zuletzt erreichte zuerst. */
export function unlockedAchievements() {
  return computeAchievements().filter((a) => a.achieved);
}

/** Die naechsten realistisch erreichbaren Ziele. */
export function nextAchievements(limit = 3) {
  return computeAchievements()
    .filter((a) => !a.achieved)
    .sort((a, b) => b.progress - a.progress)
    .slice(0, limit);
}

function currentWeekStreak(sessions) {
  let streak = 0;
  let cursor = new Date();
  for (;;) {
    const key = isoWeekKey(cursor);
    if (!sessions.some((s) => isoWeekKey(new Date(s.startedAt)) === key)) break;
    streak++;
    cursor = addDays(cursor, -7);
  }
  return streak;
}

function formatTons(kg) {
  return kg >= 1000 ? `${Math.round(kg / 1000)} Tonnen` : `${kg} kg`;
}
