/* =========================================================
   Trainings-Auswertung je Uebung: Progression und reaktives Deloaden.

   Ansatz nach Mike Israetel / Menno Henselmans (RP-Podcast): Deloads
   werden nicht starr nach Kalender eingelegt, sondern in eskalierenden
   Stufen, je nachdem wie deutlich und wie lange sich Ermuedung zeigt:
   Stufe 0 (live im Workout) – ein Satz faellt deutlich schwaecher aus
             als geplant -> restliche Saetze dieser Uebung heute streichen
             (siehe workout-session.js, direkt beim Abhaken eines Satzes).
   Stufe 1 (2 Einheiten in Folge schwaecher) – "das ist definitiv ein
             Trend" -> moderate Lastreduktion, nur fuer diese Uebung.
   Stufe 2 (3+ Einheiten in Folge schwaecher, Reduktion hat nicht
             gereicht) – Recovery-Halbwoche: die ganze betroffene
             Muskelgruppe fuer rund eine halbe Mesozyklus-Laenge auf
             ca. halbes Volumen/Last/Wiederholungen setzen.
   ========================================================= */

import { exerciseHistory, getSettings, getExerciseById, getExercises, RECOVERY_LEVELS, isDeloadWeek } from './db.js';
import { estimate1RM, daysBetween } from './utils.js';

/** Bestes geschaetztes 1RM einer Einheit. */
function bestE1rm(sets) {
  return sets.reduce((max, s) => Math.max(max, estimate1RM(Number(s.weight) || 0, Number(s.reps) || 0)), 0);
}

/** Durchschnittliches RPE einer Einheit (nur erfasste Werte). */
function avgRpe(sets) {
  const values = sets.map((s) => Number(s.rpe)).filter((v) => v > 0);
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/** Gesamtvolumen (kg) einer Einheit. */
function volume(sets) {
  return sets.reduce((sum, s) => sum + (Number(s.weight) || 0) * (Number(s.reps) || 0), 0);
}

const RECOVERY_SCORE = Object.fromEntries(RECOVERY_LEVELS.map((l) => [l.key, l.score]));

/**
 * Wie viele der juengsten Einheiten in Folge unter dem bis dahin
 * erreichten Bestwert lagen. e1rms muss neueste zuerst sortiert sein.
 * Ein einzelner schwacher Ausreisser zaehlt nicht als Trend; erst wenn
 * es mehrfach hintereinander passiert.
 */
function declineStreak(e1rmsNewestFirst) {
  const asc = e1rmsNewestFirst.slice().reverse(); // aelteste zuerst
  let peak = -Infinity;
  let streak = 0;
  for (let i = 0; i < asc.length; i++) {
    const v = asc[i];
    if (i > 0 && v < peak * 0.97) streak++;
    else streak = 0;
    peak = Math.max(peak, v);
  }
  return streak;
}

/**
 * Analysiert eine Uebung anhand ihrer letzten Einheiten.
 *
 * @returns {{
 *   status: 'new'|'progressing'|'watch'|'deload'|'recovery-half-week',
 *   headline: string,
 *   reasons: string[],
 *   suggestion: null | {type:'increase'|'hold'|'deload'|'half_week', weight:number|null, factor?:number, text:string},
 *   lastWeight: number|null,
 *   sessionsAnalysed: number,
 *   muscleGroup?: string|null,
 *   affectedExercises?: string[]
 * }}
 */
export function analyzeExercise(exerciseId) {
  const settings = getSettings();
  const historyRaw = exerciseHistory(exerciseId, 6);

  const empty = {
    status: 'new', headline: 'Noch zu wenig Daten',
    reasons: [], suggestion: null, lastWeight: null, sessionsAnalysed: historyRaw.length,
  };
  if (historyRaw.length === 0) return empty;

  // Zeit-basierte Uebungen (Halten, Cardio) werden nicht ueber Last gesteuert
  if (historyRaw[0].mode === 'time') {
    return { ...empty, headline: 'Zeit-basiert – keine Lastanalyse' };
  }

  // Eine als Deload markierte Woche senkt Gewicht/Volumen absichtlich - das darf
  // nicht als Ermuedungssignal gewertet werden (sonst empfiehlt der Coach nach
  // einem geplanten Deload faelschlich noch einen weiteren Deload).
  if (isDeloadWeek(historyRaw[0].date.slice(0, 10))) {
    const exerciseName = getExerciseById(exerciseId)?.name || 'Übung';
    return {
      ...empty,
      status: 'progressing',
      headline: `${exerciseName}: Deload-Woche`,
      reasons: ['Aktuelle Woche ist als Deload markiert – reduzierte Last/Sätze sind hier beabsichtigt, keine Ermüdung.'],
      lastWeight: Math.max(...historyRaw[0].sets.map((s) => Number(s.weight) || 0)),
    };
  }

  // Fuer die Trendanalyse zaehlen vergangene Deload-Wochen nicht mit - sonst wirkt
  // die erste normale Einheit danach faelschlich wie ein Leistungseinbruch.
  const history = historyRaw.filter((h) => !isDeloadWeek(h.date.slice(0, 10)));
  if (history.length === 0) return empty;

  const last = history[0];
  const lastWeight = Math.max(...last.sets.map((s) => Number(s.weight) || 0));
  const lastE1rm = bestE1rm(last.sets);
  const lastRpe = avgRpe(last.sets);

  const reasons = [];
  let fatigueSignals = 0;

  // --- Signal 1: Leistungsentwicklung (bestes e1RM ueber die letzten Einheiten)
  const e1rms = history.map((h) => bestE1rm(h.sets)).filter((v) => v > 0);
  let declining = false;
  let stagnating = false;
  if (e1rms.length >= 3) {
    const previousBest = Math.max(...e1rms.slice(1));
    if (lastE1rm < previousBest * 0.97) {
      declining = true;
      fatigueSignals += 2;
      reasons.push(`Leistung zuletzt ${Math.round((1 - lastE1rm / previousBest) * 100)} % unter deinem bisherigen Bestwert`);
    } else if (Math.abs(lastE1rm - previousBest) / previousBest < 0.01 && e1rms.length >= 4) {
      // drei Einheiten praktisch ohne Fortschritt
      const flat = e1rms.slice(0, 3).every((v) => Math.abs(v - e1rms[0]) / e1rms[0] < 0.015);
      if (flat) {
        stagnating = true;
        fatigueSignals += 1;
        reasons.push('Seit drei Einheiten kein Fortschritt mehr');
      }
    }
  }

  // --- Signal 2: gleiche Last faellt schwerer (RPE steigt)
  const rpeNow = lastRpe;
  const rpeBefore = history.length > 1 ? avgRpe(history[1].sets) : null;
  if (rpeNow != null && rpeBefore != null && rpeNow - rpeBefore >= 1) {
    const weightBefore = Math.max(...history[1].sets.map((s) => Number(s.weight) || 0));
    if (lastWeight <= weightBefore) {
      fatigueSignals += 1;
      reasons.push(`Gleiche Last fühlt sich schwerer an (RPE ${rpeBefore.toFixed(1)} → ${rpeNow.toFixed(1)})`);
    }
  }
  if (rpeNow != null && rpeNow >= 9.5) {
    fatigueSignals += 1;
    reasons.push('Sätze zuletzt durchgehend am Limit (RPE ≈ 10)');
  }

  // --- Signal 3: selbst eingeschaetzte Erholung
  const recentRecovery = history.slice(0, 3).map((h) => h.recovery?.level).filter(Boolean);
  const overreached = recentRecovery.filter((r) => RECOVERY_SCORE[r] >= 3).length;
  const fatigued = recentRecovery.filter((r) => RECOVERY_SCORE[r] === 2).length;
  if (overreached >= 1) {
    fatigueSignals += 2;
    reasons.push('Du hast dich zuletzt als überlastet eingeschätzt');
  } else if (fatigued >= 2) {
    fatigueSignals += 1;
    reasons.push('Mehrfach hintereinander ermüdet eingeschätzt');
  }

  // --- Signal 4: Volumen bricht ein (abgebrochene Saetze)
  if (history.length >= 2) {
    const volNow = volume(last.sets);
    const volBefore = volume(history[1].sets);
    if (volBefore > 0 && volNow < volBefore * 0.85) {
      fatigueSignals += 1;
      reasons.push('Deutlich weniger Volumen als in der Einheit davor');
    }
  }

  const exercise = getExerciseById(exerciseId);
  const name = exercise?.name || 'Übung';

  // --- Stufe 2: Trend haelt schon seit 3+ Einheiten an – eine kleine
  // Lastreduktion allein hat das offenbar nicht geloest. Jetzt geht es
  // um die ganze Muskelgruppe, nicht mehr nur um diese eine Uebung.
  const streak = declineStreak(e1rms);
  if (streak >= 3) {
    const { muscleGroup, siblings } = muscleGroupSiblings(exerciseId);
    return {
      status: 'recovery-half-week',
      headline: `${name}: Recovery-Halbwoche sinnvoll`,
      reasons: [...reasons, `Leistung ist jetzt ${streak} Einheiten in Folge gesunken – eine einzelne Lastreduktion reicht hier nicht mehr`],
      lastWeight,
      sessionsAnalysed: history.length,
      muscleGroup,
      affectedExercises: siblings.map((s) => s.name),
      suggestion: {
        type: 'half_week',
        weight: null,
        text: muscleGroup
          ? `Für die nächste knappe Woche alle ${muscleGroup}-Übungen auf ungefähr die Hälfte bei Last, Volumen und Wiederholungen setzen – so leicht, dass es sich wie ein Aufwärmen anfühlt. Danach zur normalen Belastung zurückkehren.`
          : 'Für die nächste knappe Woche bei dieser Übung ungefähr auf die Hälfte bei Last, Volumen und Wiederholungen gehen. Danach zur normalen Belastung zurückkehren.',
      },
    };
  }

  // --- Stufe 1: zwei Einheiten in Folge schwaecher ist laut Israetel/
  // Henselmans allein schon ein klarer Trend, unabhaengig von anderen Signalen.
  if (streak === 2) {
    fatigueSignals += 2;
    reasons.push('Leistung ist jetzt zwei Einheiten in Folge gesunken – das ist ein klarer Trend');
  }

  // --- Entscheidung
  if (fatigueSignals >= 3 || (declining && fatigueSignals >= 2)) {
    const factor = 0.85; // ca. 15 % weniger Last
    return {
      status: 'deload',
      headline: `${name}: gezielter Deload sinnvoll`,
      reasons,
      lastWeight,
      sessionsAnalysed: history.length,
      suggestion: {
        type: 'deload',
        factor,
        weight: roundToIncrement(lastWeight * factor, settings),
        text: `Für die nächsten 1–2 Einheiten ca. 15 % weniger Last (oder ein bis zwei Sätze weniger) – nur bei dieser Übung, der Rest deines Plans bleibt normal.`,
      },
    };
  }

  if (fatigueSignals === 2 || stagnating) {
    return {
      status: 'watch',
      headline: `${name}: Last halten`,
      reasons,
      lastWeight,
      sessionsAnalysed: history.length,
      suggestion: {
        type: 'hold',
        weight: lastWeight,
        text: 'Erste Ermüdungszeichen. Gewicht diesmal halten und auf saubere Technik/Atmung achten, statt weiter zu steigern.',
      },
    };
  }

  // --- Progression: alle Zielwiederholungen erreicht und noch Reserve da?
  const allRepsHit = last.sets.every((s) => (Number(s.reps) || 0) > 0);
  const roomLeft = rpeNow == null || rpeNow <= 8.5;
  if (allRepsHit && roomLeft && lastWeight > 0) {
    const step = settings.progressionStep || 2.5;
    return {
      status: 'progressing',
      headline: `${name}: bereit für mehr`,
      reasons: rpeNow != null
        ? [`Alle Sätze geschafft bei RPE ${rpeNow.toFixed(1)} – da ist noch Luft`]
        : ['Alle Sätze der letzten Einheit geschafft'],
      lastWeight,
      sessionsAnalysed: history.length,
      suggestion: {
        type: 'increase',
        weight: roundToIncrement(lastWeight + step, settings),
        text: `Nächste Einheit ${formatKg(roundToIncrement(lastWeight + step, settings))} statt ${formatKg(lastWeight)} versuchen.`,
      },
    };
  }

  return {
    status: 'progressing',
    headline: `${name}: auf Kurs`,
    reasons,
    lastWeight,
    sessionsAnalysed: history.length,
    suggestion: null,
  };
}

function formatKg(v) {
  return `${Math.round(v * 100) / 100} kg`;
}

/** Rundet auf die kleinste sinnvoll ladbare Stufe (2 x kleinste Scheibe). */
function roundToIncrement(weight, settings) {
  const plates = (settings.plateInventory || [1.25]).slice().sort((a, b) => a - b);
  const increment = (plates[0] || 1.25) * 2;
  return Math.round(weight / increment) * increment;
}

/**
 * Andere Uebungen derselben Muskelgruppe, die zuletzt tatsaechlich
 * trainiert wurden – das sind die von einer Recovery-Halbwoche
 * mitbetroffenen Uebungen.
 */
export function muscleGroupSiblings(exerciseId, { withinDays = 21 } = {}) {
  const exercise = getExerciseById(exerciseId);
  if (!exercise) return { muscleGroup: null, siblings: [] };
  const group = exercise.muscleGroup;
  const siblings = getExercises()
    .filter((e) => e.id !== exerciseId && e.muscleGroup === group)
    .filter((e) => {
      const d = daysSinceLastSession(e.id);
      return d != null && d <= withinDays;
    });
  return { muscleGroup: group, siblings };
}

/**
 * Uebersicht ueber alle Uebungen, die Aufmerksamkeit brauchen.
 * @returns {{exerciseId:string, name:string, analysis:object}[]}
 */
export function exercisesNeedingAttention(exerciseIds) {
  const out = [];
  for (const id of exerciseIds) {
    const analysis = analyzeExercise(id);
    if (['deload', 'watch', 'recovery-half-week'].includes(analysis.status)) {
      out.push({ exerciseId: id, name: getExerciseById(id)?.name || 'Übung', analysis });
    }
  }
  const rank = (x) => (x.analysis.status === 'recovery-half-week' ? 0 : x.analysis.status === 'deload' ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b) || b.analysis.reasons.length - a.analysis.reasons.length);
}

/* =========================================================
   Plattenrechner
   ========================================================= */

/**
 * Verteilt das Zielgewicht auf Scheiben je Seite.
 * @returns {{perSide:number[], achievable:number, rest:number, barWeight:number}}
 */
export function platesForWeight(targetWeight, settings = getSettings()) {
  const barWeight = Number(settings.barWeight) || 20;
  const inventory = (settings.plateInventory || []).slice().sort((a, b) => b - a);
  let perSideRemaining = (targetWeight - barWeight) / 2;

  const perSide = [];
  if (perSideRemaining > 0) {
    for (const plate of inventory) {
      while (perSideRemaining >= plate - 1e-9) {
        perSide.push(plate);
        perSideRemaining -= plate;
      }
    }
  }

  const achievable = barWeight + perSide.reduce((a, b) => a + b, 0) * 2;
  return { perSide, achievable, rest: Math.max(0, targetWeight - achievable), barWeight };
}

/* =========================================================
   Aufwaermsaetze
   ========================================================= */

/**
 * Schlaegt Aufwaermsaetze als Anteil des Arbeitsgewichts vor.
 * @returns {{percent:number, weight:number, reps:number}[]}
 */
export function warmupSets(workingWeight, settings = getSettings()) {
  if (!workingWeight || workingWeight <= 0) return [];
  const scheme = [
    { percent: 0.4, reps: 8 },
    { percent: 0.6, reps: 5 },
    { percent: 0.8, reps: 3 },
  ];
  const barWeight = Number(settings.barWeight) || 20;
  return scheme
    .map((s) => ({ ...s, weight: roundToIncrement(workingWeight * s.percent, settings) }))
    // Saetze unterhalb der leeren Stange sind sinnlos
    .filter((s) => s.weight >= barWeight)
    .filter((s, i, arr) => i === 0 || s.weight > arr[i - 1].weight);
}

/** Tage seit der letzten Einheit dieser Uebung (fuer 72-Stunden-Faustregel). */
export function daysSinceLastSession(exerciseId) {
  const history = exerciseHistory(exerciseId, 1);
  if (!history.length) return null;
  return daysBetween(history[0].date, new Date());
}
