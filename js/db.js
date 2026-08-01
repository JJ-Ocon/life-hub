// Persistenz-Schicht: localStorage fuer Textdaten, IndexedDB fuer Fotos.
// Alles bleibt lokal auf dem Geraet.

import { uid, nowIso, addDaysToDateKey, mondayOfWeekKey, daysBetweenDateKeys } from './utils.js';

const KEYS = {
  exercises: 'tl_exercises_v1',
  routines: 'tl_routines_v1',
  sessions: 'tl_sessions_v1',
  activeSession: 'tl_active_session_v1',
  bodyEntries: 'tl_body_entries_v1',
  settings: 'tl_settings_v1',
  seeded: 'tl_seeded_v1',
  calendarEntries: 'tl_calendar_entries_v1',
  userRoutinesSeeded: 'tl_user_routines_seeded_v2',
  weeklyPlan: 'tl_weekly_plan_v1',
  migrations: 'tl_migrations_v1',
  rotations: 'tl_rotations_v1',
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

/* =========================================================
   Uebungsdatenbank (Text-only, keine Bilder)
   ========================================================= */

export const MUSCLE_GROUPS = [
  'Brust', 'Rücken', 'Schultern', 'Bizeps', 'Trizeps', 'Beine', 'Gesäß', 'Bauch', 'Ganzkörper', 'Cardio',
];

const SEED_EXERCISES = [
  ['Bankdrücken (Langhantel)', 'Brust'],
  ['Bankdrücken (Kurzhantel)', 'Brust'],
  ['Schrägbankdrücken', 'Brust'],
  ['Liegestütze', 'Brust'],
  ['Kabelzug Fliegende', 'Brust'],
  ['Dips', 'Trizeps'],
  ['Kreuzheben', 'Rücken'],
  ['Klimmzüge', 'Rücken'],
  ['Latzug', 'Rücken'],
  ['Rudern vorgebeugt (Langhantel)', 'Rücken'],
  ['Kabelrudern sitzend', 'Rücken'],
  ['Einarmiges Rudern (Kurzhantel)', 'Rücken'],
  ['Kreuzheben rumänisch', 'Beine'],
  ['Schulterdrücken (Langhantel)', 'Schultern'],
  ['Schulterdrücken (Kurzhantel)', 'Schultern'],
  ['Seitheben', 'Schultern'],
  ['Frontheben', 'Schultern'],
  ['Reverse Flys', 'Schultern'],
  ['Kniebeugen (Langhantel)', 'Beine'],
  ['Frontkniebeugen', 'Beine'],
  ['Beinpresse', 'Beine'],
  ['Ausfallschritte', 'Beine'],
  ['Beinstrecker', 'Beine'],
  ['Beinbeuger', 'Beine'],
  ['Wadenheben stehend', 'Beine'],
  ['Hüftstoßen (Hip Thrust)', 'Gesäß'],
  ['Bizepscurls (Langhantel)', 'Bizeps'],
  ['Bizepscurls (Kurzhantel)', 'Bizeps'],
  ['Hammercurls', 'Bizeps'],
  ['Trizepsdrücken am Kabel', 'Trizeps'],
  ['Enges Bankdrücken', 'Trizeps'],
  ['Trizeps-Kickback', 'Trizeps'],
  ['Crunches', 'Bauch'],
  ['Plank', 'Bauch'],
  ['Beinheben hängend', 'Bauch'],
  ['Kabel-Crunches', 'Bauch'],
  ['Russian Twists', 'Bauch'],
  ['Burpees', 'Ganzkörper'],
  ['Kettlebell Swings', 'Ganzkörper'],
  ['Laufen', 'Cardio'],
  ['Rudergerät', 'Cardio'],
  ['Radfahren', 'Cardio'],
  ['Seilspringen', 'Cardio'],
];

function seedIfNeeded() {
  if (read(KEYS.seeded, false)) return;
  const exercises = SEED_EXERCISES.map(([name, group]) => ({
    id: uid(), name, muscleGroup: group, custom: false, createdAt: nowIso(),
  }));
  write(KEYS.exercises, exercises);
  write(KEYS.seeded, true);
}
seedIfNeeded();

export function getExercises() {
  return read(KEYS.exercises, []);
}

export function saveExercise(ex) {
  const list = getExercises();
  const idx = list.findIndex((e) => e.id === ex.id);
  if (idx >= 0) list[idx] = ex; else list.push(ex);
  write(KEYS.exercises, list);
  return ex;
}

export function addCustomExercise(name, muscleGroup) {
  const ex = { id: uid(), name: name.trim(), muscleGroup: muscleGroup || 'Ganzkörper', custom: true, createdAt: nowIso() };
  return saveExercise(ex);
}

export function deleteExercise(id) {
  write(KEYS.exercises, getExercises().filter((e) => e.id !== id));
}

export function getExerciseById(id) {
  return getExercises().find((e) => e.id === id) || null;
}

/* =========================================================
   Routinen
   ========================================================= */
// Routine: { id, name, color?, exercises: [ {id, exerciseId, groupId, restSeconds, sets:[{reps,weight}]} ], createdAt, updatedAt, fromTemplate? }

export function getRoutines() {
  return read(KEYS.routines, []);
}

export function getRoutineById(id) {
  return getRoutines().find((r) => r.id === id) || null;
}

export function saveRoutine(routine) {
  const list = getRoutines();
  const idx = list.findIndex((r) => r.id === routine.id);
  routine.updatedAt = nowIso();
  if (idx >= 0) list[idx] = routine; else { routine.createdAt = routine.createdAt || nowIso(); list.push(routine); }
  write(KEYS.routines, list);
  return routine;
}

export function deleteRoutine(id) {
  write(KEYS.routines, getRoutines().filter((r) => r.id !== id));
}

export function newRoutineSkeleton(name = 'Neue Routine') {
  return { id: uid(), name, exercises: [], createdAt: nowIso(), updatedAt: nowIso() };
}

/** Kopiert eine Routine als eigenstaendige, sofort speicherte neue Routine
 *  (eigene IDs inkl. neu verknuepfter Supersatz-Gruppen) – Aenderungen an der
 *  Kopie wirken sich nie auf das Original aus. */
export function duplicateRoutine(routine) {
  const groupMap = new Map();
  const copy = {
    id: uid(),
    name: `${routine.name} (Kopie)`,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    exercises: routine.exercises.map((re) => {
      let groupId = null;
      if (re.groupId) {
        if (!groupMap.has(re.groupId)) groupMap.set(re.groupId, uid());
        groupId = groupMap.get(re.groupId);
      }
      return {
        id: uid(),
        exerciseId: re.exerciseId,
        groupId,
        restSeconds: re.restSeconds,
        mode: re.mode || 'reps',
        cardioFields: re.cardioFields ? [...re.cardioFields] : undefined,
        note: re.note || '',
        sets: re.sets.map((s) => ({ ...s })),
        alternatives: re.alternatives?.map((a) => ({
          exerciseId: a.exerciseId, mode: a.mode, cardioFields: a.cardioFields ? [...a.cardioFields] : undefined,
          note: a.note || '', sets: a.sets.map((s) => ({ ...s })),
        })),
      };
    }),
  };
  return saveRoutine(copy);
}

/* =========================================================
   Alternative Uebungen je Slot
   Ein Routinen-Slot kann mehrere gleichwertige Uebungs-Alternativen haben
   (z.B. Kniebeuge ODER Beinpresse), jede mit eigener Satz/Wdh-Struktur.
   Aus Kompatibilitaetsgruenden bleiben die Top-Level-Felder des Slots
   (exerciseId, mode, cardioFields, note, sets) immer eine Kopie der
   AKTIVEN Alternative ("Spiegel") – so funktioniert bestehender Code
   (Statistik, Kalorienrechner, CSV-Export, ...), der diese Felder direkt
   liest, unveraendert weiter.
   ========================================================= */
// Alternative: { exerciseId, mode, cardioFields?, note, sets }

/** Alternativen eines Slots, mit Fallback fuer Slots ohne alternatives[]. */
export function slotAlternatives(re) {
  if (re.alternatives && re.alternatives.length) return re.alternatives;
  return [{ exerciseId: re.exerciseId, mode: re.mode || 'reps', cardioFields: re.cardioFields, note: re.note || '', sets: re.sets }];
}

/** Legt re.alternatives an (aus dem bisherigen Einzel-Slot), falls noch nicht vorhanden. */
export function ensureSlotAlternatives(re) {
  if (!re.alternatives || !re.alternatives.length) {
    re.alternatives = [{ exerciseId: re.exerciseId, mode: re.mode || 'reps', cardioFields: re.cardioFields, note: re.note || '', sets: re.sets }];
  }
  return re.alternatives;
}

/** Kopiert eine Alternative (per Index) in die Top-Level-Spiegelfelder des Slots. */
export function syncSlotMirror(re, index = 0) {
  const alt = re.alternatives?.[index];
  if (!alt) return re;
  re.exerciseId = alt.exerciseId;
  re.mode = alt.mode;
  re.cardioFields = alt.cardioFields;
  re.note = alt.note;
  re.sets = alt.sets;
  return re;
}

function defaultSetsForMode(mode) {
  if (mode === 'cardio') return [{ seconds: 600 }];
  if (mode === 'time') return [{ seconds: 60, weight: 0 }];
  return Array.from({ length: 3 }, () => ({ reps: 10, weight: 0 }));
}

/** Fuegt dem Slot eine neue Alternative hinzu und synchronisiert den Spiegel nicht
 *  automatisch (das entscheidet der Aufrufer, je nachdem ob sie aktiv werden soll). */
export function addSlotAlternative(re, exerciseId, mode = 'reps') {
  ensureSlotAlternatives(re);
  const alt = { exerciseId, mode, cardioFields: mode === 'cardio' ? ['duration'] : undefined, note: '', sets: defaultSetsForMode(mode) };
  re.alternatives.push(alt);
  return alt;
}

export function removeSlotAlternative(re, index) {
  ensureSlotAlternatives(re);
  if (re.alternatives.length <= 1) return re.alternatives;
  re.alternatives.splice(index, 1);
  return re.alternatives;
}

/* =========================================================
   Trainingsplan-Vorlagen (Push/Pull/Legs, 5x5)
   Werden anhand von Uebungsnamen aufgeloest -> legen bei Bedarf
   fehlende Uebungen automatisch als Custom-Eintraege an.
   ========================================================= */

function findOrCreateExercise(name, group) {
  const existing = getExercises().find((e) => e.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  return addCustomExercise(name, group);
}

const TEMPLATE_DEFS = [
  {
    key: 'ppl-push', label: 'Push (Brust/Schulter/Trizeps)', group: 'Push/Pull/Legs',
    items: [
      ['Bankdrücken (Langhantel)', 4, 6],
      ['Schrägbankdrücken', 3, 8],
      ['Schulterdrücken (Kurzhantel)', 3, 10],
      ['Seitheben', 3, 15],
      ['Trizepsdrücken am Kabel', 3, 12],
      ['Dips', 3, 10],
    ],
  },
  {
    key: 'ppl-pull', label: 'Pull (Rücken/Bizeps)', group: 'Push/Pull/Legs',
    items: [
      ['Kreuzheben', 3, 5],
      ['Klimmzüge', 4, 8],
      ['Rudern vorgebeugt (Langhantel)', 3, 8],
      ['Kabelrudern sitzend', 3, 12],
      ['Bizepscurls (Langhantel)', 3, 10],
      ['Hammercurls', 3, 12],
    ],
  },
  {
    key: 'ppl-legs', label: 'Legs (Beine/Gesäß)', group: 'Push/Pull/Legs',
    items: [
      ['Kniebeugen (Langhantel)', 4, 6],
      ['Kreuzheben rumänisch', 3, 8],
      ['Beinpresse', 3, 12],
      ['Beinstrecker', 3, 15],
      ['Beinbeuger', 3, 15],
      ['Wadenheben stehend', 4, 15],
    ],
  },
  {
    key: '5x5-a', label: '5×5 – Workout A', group: '5×5 Ganzkörper',
    items: [
      ['Kniebeugen (Langhantel)', 5, 5],
      ['Bankdrücken (Langhantel)', 5, 5],
      ['Rudern vorgebeugt (Langhantel)', 5, 5],
    ],
  },
  {
    key: '5x5-b', label: '5×5 – Workout B', group: '5×5 Ganzkörper',
    items: [
      ['Kniebeugen (Langhantel)', 5, 5],
      ['Schulterdrücken (Langhantel)', 5, 5],
      ['Kreuzheben', 1, 5],
    ],
  },
];

export function getTemplateDefs() {
  return TEMPLATE_DEFS;
}

/** Erstellt aus einer Vorlage eine echte, bearbeitbare Routine (Gewicht startet bei 0). */
export function instantiateTemplate(key) {
  const def = TEMPLATE_DEFS.find((t) => t.key === key);
  if (!def) return null;
  const routine = newRoutineSkeleton(def.label);
  routine.fromTemplate = def.key;
  routine.exercises = def.items.map(([name, sets, reps]) => {
    const ex = findOrCreateExercise(name, guessGroupForTemplateItem(name));
    return {
      id: uid(),
      exerciseId: ex.id,
      groupId: null,
      restSeconds: 90,
      sets: Array.from({ length: sets }, () => ({ reps, weight: 0 })),
    };
  });
  return saveRoutine(routine);
}

function guessGroupForTemplateItem(name) {
  const found = getExercises().find((e) => e.name === name);
  return found?.muscleGroup;
}

/* =========================================================
   Nutzer-Routinen A/B/C – einmalig aus den vom Nutzer gelieferten
   Trainingsprotokollen angelegt (echte Routinen, keine Vorlagen).
   Fuer A und B liegen wörtliche Feedback-Kommentare vor -> diese werden
   zusaetzlich als abgeschlossene, protokollierte Sessions gespeichert.
   ========================================================= */

// Baut eine Routinen-Uebung. mode 'reps' -> value ist Ziel-Wdh., 'time'/'cardio'
// -> value ist die Dauer in Sekunden. note transportiert alles, was sich nicht in
// Zahlen fassen laesst (Seitenangabe, Zielbereiche, Alternativ-Uebungen, bpm).
function rEx(name, group, sets, value, weight, note, groupId, mode = 'reps', extra = {}) {
  const ex = findOrCreateExercise(name, group);
  const makeSet = () => {
    if (mode === 'cardio') return { seconds: value, ...extra.setDefaults };
    if (mode === 'time') return { seconds: value, weight };
    return { reps: value, weight };
  };
  return {
    id: uid(),
    exerciseId: ex.id,
    groupId: groupId || null,
    restSeconds: 90,
    mode,
    cardioFields: mode === 'cardio' ? (extra.cardioFields || ['duration']) : undefined,
    note: note || '',
    sets: Array.from({ length: sets }, makeSet),
  };
}

function buildRoutineA() {
  const g1 = uid(), g2 = uid(), g3 = uid(), g4 = uid(), g5 = uid();
  return {
    id: uid(),
    name: 'Routine A',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    exercises: [
      rEx('Calve raises', 'Beine', 3, 15, 15, 'pro Seite (single leg)', g1),
      rEx('Lunges', 'Beine', 2, 7, 0, '', g1),
      rEx('Squats', 'Beine', 3, 5, 65, 'Zielbereich 5–8 Wdh. (zuletzt: 5)', null),
      rEx('Hip Thrusts', 'Gesäß', 3, 11, 55, '10–12 Wdh.; Alternative: 40 Kg schwer (M)', g2),
      rEx('Sissy squats', 'Beine', 3, 10, 0, '', g2),
      rEx('Dumbbell 45° Incline Benchpress', 'Brust', 4, 5, 22, '22 Kg pro Seite (Kurzhantel)', g3),
      rEx('Dead Hangs', 'Rücken', 3, 60, 0, '', g3, 'time'),
      rEx('Pulldowns', 'Rücken', 3, 11, 57.5, '10–12 Wdh.', g4),
      rEx('Dumbbell side raises', 'Schultern', 3, 15, 0, 'volle Bewegungsamplitude (full ROM)', g4),
      rEx('Face pulls', 'Schultern', 3, 15, 13.25, '', g5),
      rEx('Bicep cable curls', 'Bizeps', 3, 11, 18.75, '10–12 Wdh.', g5),
      rEx('Farmers carry', 'Ganzkörper', 3, 50, 30, '50 Schritte statt Wiederholungen', null),
      rEx('Cardio – Recliner Bike', 'Cardio', 1, 3600, 0, 'ca. 140 bpm · Stufe 22', null, 'cardio',
        { cardioFields: ['duration', 'distance', 'watt', 'rpm'] }),
    ],
  };
}

function buildRoutineB() {
  const g1 = uid(), g3 = uid(), g4 = uid(), g5 = uid(), g6 = uid();
  return {
    id: uid(),
    name: 'Routine B',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    exercises: [
      rEx('Calve raises', 'Beine', 3, 15, 15, 'single leg', g1),
      rEx('Lunges', 'Beine', 2, 7, 0, '', g1),
      rEx('Deadlifts', 'Rücken', 3, 6, 75, 'Zielbereich 5–8 Wdh.; Tendenz steigern (go up)', null),
      rEx('Lunges (schwer)', 'Beine', 3, 10, 30, 'pro Seite; Alternative: Leg Press 3×10 @ 100 Kg', g3),
      rEx('Dumbbell side raises', 'Schultern', 3, 15, 4, '4 Kg pro Seite, volle ROM', g3),
      rEx('Shoulder press', 'Schultern', 3, 6, 30, 'Zielbereich 5–8 Wdh.', g4),
      rEx('Dead Hang', 'Rücken', 1, 60, 0, '', g4, 'time'),
      rEx('Flexion Rows', 'Rücken', 3, 11, 57.5, '10–12 Wdh.', g5),
      rEx('Dumbbell 45° Incline Benchpress', 'Brust', 4, 5, 22, '22 Kg pro Seite', g5),
      rEx('Face pulls', 'Schultern', 3, 15, 13.25, '', g6),
      rEx('Triceps overhead push', 'Trizeps', 3, 15, 18, '', g6),
      rEx('Cardio – Recliner Bike', 'Cardio', 1, 3600, 0, 'ca. 140 bpm · Stufe 22; motivierende Sportvideos', null, 'cardio',
        { cardioFields: ['duration', 'distance', 'watt', 'rpm'] }),
    ],
  };
}

function buildRoutineC() {
  const g1 = uid(), g2 = uid();
  return {
    id: uid(),
    name: 'Routine C',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    exercises: [
      rEx('Leg raises', 'Bauch', 3, 20, 0, '', g1),
      rEx('45° back extension', 'Rücken', 3, 15, 10, '', g1),
      rEx('Crunches', 'Bauch', 3, 15, 0, '', g1),
      rEx('Lower back curls', 'Rücken', 3, 15, 15, '', g1),
      rEx('Hip abduction', 'Gesäß', 3, 15, 75, 'Gewicht steigend (up)', g2),
      rEx('Hip adduction', 'Gesäß', 3, 15, 81, '', g2),
      rEx('Leg curls', 'Beine', 3, 10, 70, '', g2),
      rEx('Airbike', 'Cardio', 1, 300, 0, '', null, 'cardio',
        { cardioFields: ['duration', 'watt', 'rpm'], setDefaults: { watt: 250 } }),
      rEx('Running', 'Cardio', 1, 600, 0, '160–180 bpm', null, 'cardio',
        { cardioFields: ['duration', 'distance', 'speed'] }),
    ],
  };
}

/** Erstellt aus einer Routine eine abgeschlossene, bereits protokollierte Session
 *  (alle Sätze auf erledigt) an einem bestimmten Datum – fuer rueckwirkend
 *  erfasste Trainingsprotokolle inkl. Kommentar. */
function logFinishedSessionForRoutine(routine, dateKey, startTime, durationMin, comment) {
  const startedAt = new Date(`${dateKey}T${startTime}:00`);
  const endedAt = new Date(startedAt.getTime() + durationMin * 60000);
  const session = {
    id: uid(),
    routineId: routine.id,
    routineName: routine.name,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    comment: comment || '',
    exercises: routine.exercises.map((re) => ({
      exerciseId: re.exerciseId,
      exerciseName: getExerciseById(re.exerciseId)?.name || 'Übung',
      groupId: re.groupId || null,
      restSeconds: re.restSeconds ?? 90,
      mode: re.mode || 'reps',
      cardioFields: re.cardioFields ? [...re.cardioFields] : undefined,
      note: re.note || '',
      comment: '',
      sets: re.sets.map((s) => ({ ...s, done: true, isWarmup: false })),
    })),
  };
  saveFinishedSession(session);
  return session;
}

/* =========================================================
   Migrationen – laufen einmalig und passen bestehende Daten an,
   damit ein Update keine Routinen doppelt anlegt.
   ========================================================= */

function appliedMigrations() {
  return read(KEYS.migrations, []);
}

function runMigration(name, fn) {
  const applied = appliedMigrations();
  if (applied.includes(name)) return;
  try {
    fn();
  } catch {
    return; // fehlgeschlagene Migration nicht als erledigt markieren
  }
  write(KEYS.migrations, [...applied, name]);
}

// Uebungen, die vor der Modus-Umstellung als Wiederholungen gespeichert waren,
// obwohl sie eigentlich Zeit bzw. Cardio sind. Alte Werte standen fuer Minuten.
const HOLD_PATTERN = /dead\s?hang|plank|hold|halten/i;
const CARDIO_FIELD_PRESETS = [
  [/airbike|air\s?bike|assault/i, ['duration', 'watt', 'rpm']],
  [/lauf|running|\brun\b|treadmill|laufband/i, ['duration', 'distance', 'speed']],
  [/bike|rad|ergometer|recliner|spinning|cycl/i, ['duration', 'distance', 'watt', 'rpm']],
  [/ruder|row/i, ['duration', 'distance', 'watt']],
];

function migrateExerciseModes() {
  const exercises = new Map(getExercises().map((e) => [e.id, e]));
  const routines = getRoutines();
  let changed = false;

  for (const routine of routines) {
    for (const re of routine.exercises || []) {
      if (re.mode) continue; // bereits auf einen Modus festgelegt
      const ex = exercises.get(re.exerciseId);
      const name = ex?.name || '';
      const isCardio = ex?.muscleGroup === 'Cardio';
      const isHold = HOLD_PATTERN.test(name);
      if (!isCardio && !isHold) { re.mode = 'reps'; changed = true; continue; }

      // Bisher steckte die Minutenzahl im Wiederholungsfeld
      re.sets = (re.sets || []).map((s) => ({
        seconds: Math.round((Number(s.reps) || 0) * 60),
        ...(isCardio ? {} : { weight: s.weight || 0 }),
      }));
      re.mode = isCardio ? 'cardio' : 'time';
      if (isCardio) {
        const preset = CARDIO_FIELD_PRESETS.find(([pattern]) => pattern.test(name));
        re.cardioFields = preset ? preset[1] : ['duration'];
      }
      changed = true;
    }
  }
  if (changed) write(KEYS.routines, routines);
}

function seedUserRoutinesIfNeeded() {
  if (read(KEYS.userRoutinesSeeded, false)) return;
  const a = saveRoutine(buildRoutineA());
  const b = saveRoutine(buildRoutineB());
  saveRoutine(buildRoutineC());

  logFinishedSessionForRoutine(a, '2026-07-25', '09:00', 110, '');
  logFinishedSessionForRoutine(b, '2026-07-28', '09:00', 105, '');

  write(KEYS.userRoutinesSeeded, true);
}
seedUserRoutinesIfNeeded();
runMigration('exercise-modes', migrateExerciseModes);

/* =========================================================
   Trainingseinheiten (Sessions) – geplant/laufend/abgeschlossen
   ========================================================= */
// Session: { id, routineId, routineName, startedAt, endedAt|null,
//            exercises: [{exerciseId, exerciseName, groupId, restSeconds, sets:[{reps,weight,done,isWarmup}]}] }

export function getSessions() {
  return read(KEYS.sessions, []).sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
}

export function getSessionById(id) {
  return read(KEYS.sessions, []).find((s) => s.id === id) || null;
}

export function saveFinishedSession(session) {
  const list = read(KEYS.sessions, []);
  const idx = list.findIndex((s) => s.id === session.id);
  if (idx >= 0) list[idx] = session; else list.push(session);
  write(KEYS.sessions, list);
}

export function deleteSession(id) {
  write(KEYS.sessions, read(KEYS.sessions, []).filter((s) => s.id !== id));
}

export function getActiveSession() {
  return read(KEYS.activeSession, null);
}

export function setActiveSession(session) {
  write(KEYS.activeSession, session);
}

export function clearActiveSession() {
  localStorage.removeItem(KEYS.activeSession);
}

/** Baut eine Session-taugliche Kopie einer Alternative (frische Satz-Zustaende). */
function toSessionAlternative(alt) {
  return {
    exerciseId: alt.exerciseId,
    exerciseName: getExerciseById(alt.exerciseId)?.name || 'Übung',
    mode: alt.mode || 'reps',
    cardioFields: alt.cardioFields ? [...alt.cardioFields] : undefined,
    note: alt.note || '',
    // targetReps merkt sich die urspruengliche Vorgabe, damit man live erkennen
    // kann, wenn ein Satz deutlich schwaecher ausfaellt als geplant.
    sets: alt.sets.map((s) => ({
      ...s,
      ...((alt.mode || 'reps') === 'reps' ? { targetReps: s.reps } : {}),
      done: false,
      isWarmup: false,
    })),
  };
}

export function startSessionFromRoutine(routine) {
  const session = {
    id: uid(),
    routineId: routine.id,
    routineName: routine.name,
    startedAt: nowIso(),
    endedAt: null,
    comment: '',
    exercises: routine.exercises.map((re) => {
      const alternatives = slotAlternatives(re).map(toSessionAlternative);
      const active = alternatives[0]; // ganz linke Alternative ist immer zuerst ausgewaehlt
      return {
        exerciseId: active.exerciseId,
        exerciseName: active.exerciseName,
        groupId: re.groupId || null,
        restSeconds: re.restSeconds ?? 90,
        mode: active.mode,
        cardioFields: active.cardioFields,
        note: active.note,
        comment: '',
        sets: active.sets,
        alternatives,
        activeAlternativeIndex: 0,
      };
    }),
  };
  setActiveSession(session);
  return session;
}

/* =========================================================
   Koerperdaten (Gewicht, Koerperanalyse-Werte, Umfaenge)
   ========================================================= */
// Entry: { id, date (YYYY-MM-DD), weight, bodyFat, water, muscle, bone,
//          waist, chest, arm, thigh, hips, note }
// bodyFat/water in %, muscle/bone in kg (typische Ausgabe einer Koerperanalysewaage)

/** Alle auswertbaren Koerpermetriken – Basis fuer Eingabeformular und Diagramme. */
export const BODY_METRICS = [
  { key: 'weight', label: 'Gewicht', unit: 'kg', group: 'Körperanalyse', decimals: 1 },
  { key: 'bodyFat', label: 'Körperfett', unit: '%', group: 'Körperanalyse', decimals: 1 },
  { key: 'muscle', label: 'Muskelmasse', unit: 'kg', group: 'Körperanalyse', decimals: 1 },
  { key: 'water', label: 'Wasser', unit: '%', group: 'Körperanalyse', decimals: 1 },
  { key: 'bone', label: 'Knochenmasse', unit: 'kg', group: 'Körperanalyse', decimals: 1 },
  { key: 'waist', label: 'Taille', unit: 'cm', group: 'Umfänge', decimals: 1 },
  { key: 'chest', label: 'Brust', unit: 'cm', group: 'Umfänge', decimals: 1 },
  { key: 'arm', label: 'Arm', unit: 'cm', group: 'Umfänge', decimals: 1 },
  { key: 'thigh', label: 'Oberschenkel', unit: 'cm', group: 'Umfänge', decimals: 1 },
  { key: 'hips', label: 'Hüfte', unit: 'cm', group: 'Umfänge', decimals: 1 },
];

/** BMI aus Gewicht (kg) und Koerpergroesse (cm). */
export function calcBmi(weightKg, heightCm) {
  if (!weightKg || !heightCm) return null;
  const m = heightCm / 100;
  return weightKg / (m * m);
}

/** Gibt fuer eine Metrik die Zeitreihe zurueck ('bmi' wird berechnet). */
export function bodySeries(metricKey) {
  const entries = getBodyEntries();
  const { heightCm } = getSettings();
  const out = [];
  for (const e of entries) {
    let value;
    if (metricKey === 'bmi') value = calcBmi(e.weight, heightCm);
    else value = e[metricKey];
    if (value != null && !Number.isNaN(value)) out.push({ date: e.date, value: Number(value) });
  }
  return out;
}

export function getBodyEntries() {
  return read(KEYS.bodyEntries, []).sort((a, b) => a.date.localeCompare(b.date));
}

export function getLatestBodyEntry() {
  const list = getBodyEntries();
  return list.length ? list[list.length - 1] : null;
}

/** Letztes erfasstes Koerpergewicht (fuer Kalorienrechner). */
export function getLatestWeight() {
  const withWeight = getBodyEntries().filter((e) => e.weight != null);
  return withWeight.length ? withWeight[withWeight.length - 1].weight : null;
}

export function saveBodyEntry(entry) {
  const list = read(KEYS.bodyEntries, []);
  const idx = list.findIndex((e) => e.id === entry.id || e.date === entry.date);
  if (idx >= 0) list[idx] = { ...list[idx], ...entry }; else list.push({ id: uid(), ...entry });
  write(KEYS.bodyEntries, list);
}

export function deleteBodyEntry(id) {
  write(KEYS.bodyEntries, read(KEYS.bodyEntries, []).filter((e) => e.id !== id));
}

/* =========================================================
   Einstellungen
   ========================================================= */

const DEFAULT_SETTINGS = {
  theme: 'dark', // 'dark' | 'light' | 'grey' | 'colored'
  accentHue: 160,
  units: 'kg', // 'kg' | 'lb'
  defaultRest: 90,
  userName: '',
  // Profil – Basis fuer BMI und Kalorienbedarf
  heightCm: null,
  birthDate: '',      // YYYY-MM-DD
  sex: '',            // 'male' | 'female' | ''
  dailyActivity: 'sedentary', // Alltagsaktivitaet OHNE Training
  // Training – Feinsteuerung
  trackRpe: false,    // RPE/RIR je Satz erfassen
  barWeight: 20,      // Langhantel-Gewicht fuer den Plattenrechner
  plateInventory: [25, 20, 15, 10, 5, 2.5, 1.25], // verfuegbare Scheiben je Seite
  progressionStep: 2.5, // Standard-Steigerung
  lastBackupAt: '',     // fuer die Backup-Erinnerung
};

/* =========================================================
   Cardio-Kennzahlen
   Je Uebung waehlbar, damit die Eingabemaske nur zeigt, was das
   jeweilige Geraet ueberhaupt anzeigt (Rad: Watt/RPM, Laufband: km/h ...).
   'higherIsBetter' steuert die Rekord-Erkennung.
   ========================================================= */
export const CARDIO_FIELDS = [
  { key: 'duration', label: 'Dauer', short: 'Zeit', unit: 'min', prLabel: 'längste Dauer', higherIsBetter: true, always: true },
  { key: 'distance', label: 'Distanz', short: 'Dist.', unit: 'km', prLabel: 'weiteste Distanz', higherIsBetter: true, decimals: 2 },
  { key: 'watt', label: 'Leistung', short: 'Watt', unit: 'W', prLabel: 'höchste Leistung', higherIsBetter: true, decimals: 0 },
  { key: 'speed', label: 'Geschwindigkeit', short: 'km/h', unit: 'km/h', prLabel: 'höchstes Tempo', higherIsBetter: true, decimals: 1 },
  { key: 'rpm', label: 'Trittfrequenz', short: 'RPM', unit: 'rpm', prLabel: 'höchste Trittfrequenz', higherIsBetter: true, decimals: 0 },
];

export function cardioFieldDef(key) {
  return CARDIO_FIELDS.find((f) => f.key === key);
}

/* RPE-Skala (Rate of Perceived Exertion) mit Wiederholungen in Reserve (RIR). */
export const RPE_SCALE = [
  { value: 6, label: '6', rir: '4+ in Reserve' },
  { value: 7, label: '7', rir: '3 in Reserve' },
  { value: 8, label: '8', rir: '2 in Reserve' },
  { value: 9, label: '9', rir: '1 in Reserve' },
  { value: 10, label: '10', rir: 'Muskelversagen' },
];

/* Erholungszustand nach einer Einheit – Grundlage fuer reaktives Deloaden. */
export const RECOVERY_LEVELS = [
  { key: 'fresh', label: 'Frisch', hint: 'Leistung stieg, kaum Ermüdung', score: 0 },
  { key: 'normal', label: 'Normal', hint: 'Fordernd, aber gut machbar', score: 1 },
  { key: 'fatigued', label: 'Ermüdet', hint: 'Schwerer als sonst, Leistung stagniert', score: 2 },
  { key: 'overreached', label: 'Überlastet', hint: 'Leistungsabfall, anhaltender Muskelkater', score: 3 },
];

/** Alltagsaktivitaet (ohne Training – das kommt separat aus dem Wochenplan dazu). */
export const DAILY_ACTIVITY_LEVELS = [
  { key: 'sedentary', label: 'Überwiegend sitzend', factor: 1.2, hint: 'Bürojob, wenig Bewegung im Alltag' },
  { key: 'light', label: 'Leicht aktiv', factor: 1.375, hint: 'etwas Gehen, Haushalt, Wege zu Fuß' },
  { key: 'moderate', label: 'Aktiv', factor: 1.55, hint: 'viel auf den Beinen' },
  { key: 'high', label: 'Sehr aktiv', factor: 1.725, hint: 'körperliche Arbeit' },
];

/** true, wenn alle fuer den Kalorienrechner noetigen Profildaten vorliegen. */
export function hasCompleteProfile(settings = getSettings()) {
  return !!(settings.heightCm && settings.birthDate && settings.sex);
}

export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...read(KEYS.settings, {}) };
}

export function saveSettings(patch) {
  const merged = { ...getSettings(), ...patch };
  write(KEYS.settings, merged);
  return merged;
}

/* =========================================================
   Export / Import / Reset (alles inkl. Fotos aus IndexedDB)
   ========================================================= */

export async function exportAllData() {
  const photos = await listPhotos();
  return {
    exportedAt: nowIso(),
    version: 1,
    exercises: getExercises(),
    routines: getRoutines(),
    sessions: read(KEYS.sessions, []),
    bodyEntries: getBodyEntries(),
    settings: getSettings(),
    calendarEntries: getCalendarEntries(),
    weeklyPlan: getWeeklyPlan(),
    rotations: getRotations(),
    photos,
  };
}

export async function importAllData(data) {
  if (!data || typeof data !== 'object') throw new Error('Ungültige Datei');
  if (data.exercises) write(KEYS.exercises, data.exercises);
  if (data.routines) write(KEYS.routines, data.routines);
  if (data.sessions) write(KEYS.sessions, data.sessions);
  if (data.bodyEntries) write(KEYS.bodyEntries, data.bodyEntries);
  if (data.settings) write(KEYS.settings, data.settings);
  if (data.calendarEntries) write(KEYS.calendarEntries, data.calendarEntries);
  if (data.weeklyPlan) write(KEYS.weeklyPlan, data.weeklyPlan);
  if (data.rotations) write(KEYS.rotations, data.rotations);
  if (Array.isArray(data.photos)) {
    for (const p of data.photos) await putPhoto(p);
  }
}

export async function resetAllData() {
  Object.values(KEYS).forEach((k) => localStorage.removeItem(k));
  await clearPhotos();
  seedIfNeeded();
  seedUserRoutinesIfNeeded();
}

/* =========================================================
   Fortschrittsfotos – IndexedDB (lokal, kein Upload)
   ========================================================= */

const IDB_NAME = 'tl_photos_db';
const IDB_STORE = 'photos';

function openPhotoDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putPhoto(photo) {
  const db = await openPhotoDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(photo);
    tx.oncomplete = () => resolve(photo);
    tx.onerror = () => reject(tx.error);
  });
}

export async function listPhotos() {
  const db = await openPhotoDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).getAll();
    req.onsuccess = () => resolve((req.result || []).sort((a, b) => a.date.localeCompare(b.date)));
    req.onerror = () => reject(req.error);
  });
}

export async function deletePhoto(id) {
  const db = await openPhotoDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearPhotos() {
  const db = await openPhotoDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* =========================================================
   Kalender – geplante Workouts, Ruhetage, Notizen, Deload-Wochen
   ========================================================= */
// Entry: { id, date (YYYY-MM-DD), type: 'workout'|'rest'|'note'|'deload',
//          routineId?, routineName?, note?, groupId?, createdAt }

export function getCalendarEntries() {
  return read(KEYS.calendarEntries, []);
}

export function getCalendarEntriesForDate(date) {
  return getCalendarEntries().filter((e) => e.date === date);
}

export function getCalendarEntriesForRange(startDate, endDate) {
  return getCalendarEntries().filter((e) => e.date >= startDate && e.date <= endDate);
}

export function saveCalendarEntry(entry) {
  const list = getCalendarEntries();
  const e = { id: uid(), createdAt: nowIso(), ...entry };
  const idx = list.findIndex((x) => x.id === e.id);
  if (idx >= 0) list[idx] = e; else list.push(e);
  write(KEYS.calendarEntries, list);
  return e;
}

export function deleteCalendarEntry(id) {
  write(KEYS.calendarEntries, getCalendarEntries().filter((e) => e.id !== id));
}

export function deleteCalendarGroup(groupId) {
  write(KEYS.calendarEntries, getCalendarEntries().filter((e) => e.groupId !== groupId));
}

/** Markiert eine ganze Woche (Mo–So, ausgehend von einem beliebigen Datum darin) als Deload. */
export function createDeloadWeek(anyDateInWeek, note = 'Deload-Woche') {
  const monday = mondayOfWeekKey(anyDateInWeek);
  const groupId = uid();
  const created = [];
  for (let i = 0; i < 7; i++) {
    created.push(saveCalendarEntry({ type: 'deload', date: addDaysToDateKey(monday, i), note, groupId }));
  }
  return created;
}

export function isDeloadWeek(anyDateInWeek) {
  const monday = mondayOfWeekKey(anyDateInWeek);
  return getCalendarEntriesForDate(monday).some((e) => e.type === 'deload');
}

/* =========================================================
   Rotationen – geordnete Routinen-Warteschlangen
   Der Zeiger (cursor) rueckt NUR vor, wenn ein Workout aus der Rotation
   tatsaechlich abgeschlossen wird (advanceRotationIfNeeded). Wird ein
   geplanter Rotations-Termin verpasst, bleibt der Zeiger stehen -> beim
   naechsten Trainingstag dieser Rotation kommt automatisch dieselbe
   Routine dran, und alles Nachfolgende rutscht mit. Das ergibt die
   "Verpasst-Kaskade" ganz ohne Sonderfall-Code.
   ========================================================= */
// Rotation: { id, name, sequence: [routineId,...], cursor: number, createdAt }

export function getRotations() {
  return read(KEYS.rotations, []);
}

export function getRotationById(id) {
  return getRotations().find((r) => r.id === id) || null;
}

export function saveRotation(rotation) {
  const list = getRotations();
  const idx = list.findIndex((r) => r.id === rotation.id);
  if (idx >= 0) list[idx] = rotation; else list.push(rotation);
  write(KEYS.rotations, list);
  return rotation;
}

export function createRotation(name) {
  return saveRotation({ id: uid(), name: (name || 'Rotation').trim(), sequence: [], cursor: 0, createdAt: nowIso() });
}

export function deleteRotation(id) {
  write(KEYS.rotations, getRotations().filter((r) => r.id !== id));
  // Betroffene Routinen von der geloeschten Rotation loesen
  for (const routine of getRoutines()) {
    if (routine.rotationId === id) { delete routine.rotationId; saveRoutine(routine); }
  }
  // Zyklus-Slots, die auf diese Rotation zeigten, zu Ruhetagen machen
  const plan = getWeeklyPlan();
  let changed = false;
  plan.days.forEach((slot) => {
    if (slot.type === 'rotation' && slot.rotationId === id) { slot.type = 'rest'; delete slot.rotationId; changed = true; }
  });
  if (changed) saveWeeklyPlan(plan);
}

/** Fuegt eine Routine ans Ende der Rotation an und markiert sie entsprechend. */
export function addRoutineToRotation(rotationId, routineId) {
  const rotation = getRotationById(rotationId);
  if (!rotation) return null;
  if (!rotation.sequence.includes(routineId)) rotation.sequence.push(routineId);
  saveRotation(rotation);
  const routine = getRoutineById(routineId);
  if (routine) { routine.rotationId = rotationId; saveRoutine(routine); }
  return rotation;
}

export function removeRoutineFromRotation(rotationId, routineId) {
  const rotation = getRotationById(rotationId);
  if (!rotation) return null;
  rotation.sequence = rotation.sequence.filter((id) => id !== routineId);
  if (rotation.cursor >= rotation.sequence.length) rotation.cursor = 0;
  saveRotation(rotation);
  const routine = getRoutineById(routineId);
  if (routine?.rotationId === rotationId) { delete routine.rotationId; saveRoutine(routine); }
  return rotation;
}

export function reorderRotation(rotationId, newSequence) {
  const rotation = getRotationById(rotationId);
  if (!rotation) return null;
  rotation.sequence = newSequence;
  saveRotation(rotation);
  return rotation;
}

/** Rueckt den Zeiger einer Rotation auf die Position direkt nach der
 *  abgeschlossenen Routine vor – aufrufen, wenn eine Session beendet wird. */
export function advanceRotationIfNeeded(routineId) {
  let changed = false;
  for (const rotation of getRotations()) {
    const pos = rotation.sequence.indexOf(routineId);
    if (pos === -1) continue;
    rotation.cursor = (pos + 1) % rotation.sequence.length;
    saveRotation(rotation);
    changed = true;
  }
  return changed;
}

/* =========================================================
   Trainings-Zyklus – wiederkehrendes Muster ueber N Wochen
   Jeder Tag im Zyklus ist entweder Ruhetag, eine feste Routine oder ein
   Rotations-Slot (zieht die jeweils naechste Routine aus einer Rotation).
   Dient zwei Zwecken: (1) traegt sich automatisch in den Kalender ein,
   (2) liefert den Trainingsumfang fuer den Kalorienbedarf.
   ========================================================= */
// Plan: { anchorDate, cycleLength, days: [ {type:'rest'} | {type:'routine',routineId} |
//         {type:'rotation',rotationId}, ...cycleLength x ], autoFill: bool, weeksAhead: number }

export const WEEKDAY_LABELS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

/** Tagesschluessel ohne Import-Zyklus (lokales Datum). */
function todayDateKey() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function emptyPlan() {
  return {
    anchorDate: mondayOfWeekKey(todayDateKey()),
    cycleLength: 7,
    autoFill: true,
    weeksAhead: 8,
    days: Array.from({ length: 7 }, () => ({ type: 'rest' })),
  };
}

export function getWeeklyPlan() {
  const stored = read(KEYS.weeklyPlan, null);
  if (!stored) return emptyPlan();

  // Altes Modell (vor Mehrwochen-/Rotations-Unterstuetzung, nur 7 feste Tage)
  // automatisch ins neue Format ueberfuehren – Bestandsdaten bleiben erhalten.
  if (!stored.cycleLength) {
    const converted = {
      anchorDate: mondayOfWeekKey(todayDateKey()),
      cycleLength: 7,
      autoFill: stored.autoFill ?? true,
      weeksAhead: stored.weeksAhead ?? 8,
      days: Array.from({ length: 7 }, (_, i) => {
        const d = stored.days?.[i];
        return d?.type === 'workout' && d.routineId ? { type: 'routine', routineId: d.routineId } : { type: 'rest' };
      }),
    };
    write(KEYS.weeklyPlan, converted);
    return converted;
  }

  const base = emptyPlan();
  const days = Array.from({ length: stored.cycleLength }, (_, i) => stored.days?.[i] || { type: 'rest' });
  return { ...base, ...stored, days };
}

export function saveWeeklyPlan(plan) {
  write(KEYS.weeklyPlan, plan);
  return plan;
}

export function weeklyPlanHasWorkouts(plan = getWeeklyPlan()) {
  return plan.days.some((slot) => {
    if (slot.type === 'routine') return !!slot.routineId;
    if (slot.type === 'rotation') return !!getRotationById(slot.rotationId)?.sequence.length;
    return false;
  });
}

function cycleDayIndex(dateKey, plan) {
  const len = plan.cycleLength || 7;
  const diff = daysBetweenDateKeys(plan.anchorDate, dateKey);
  return ((diff % len) + len) % len;
}

/**
 * Loest einen einzelnen Zyklus-Tag zu einer Routine auf. rotationOffsets
 * zaehlt fuer die Vorschau/Projektion mit, das wievielte Mal eine Rotation
 * seit dem Ausgangspunkt "dran" war (0 = der naechste anstehende Termin).
 */
function resolvePlanDay(plan, dateKey, rotationOffsets) {
  const slot = plan.days[cycleDayIndex(dateKey, plan)];
  if (!slot) return null;
  if (slot.type === 'routine' && slot.routineId) {
    return getRoutineById(slot.routineId);
  }
  if (slot.type === 'rotation' && slot.rotationId) {
    const rotation = getRotationById(slot.rotationId);
    if (!rotation || !rotation.sequence.length) return null;
    const offset = rotationOffsets.get(slot.rotationId) || 0;
    rotationOffsets.set(slot.rotationId, offset + 1);
    return getRoutineById(rotation.sequence[(rotation.cursor + offset) % rotation.sequence.length]);
  }
  return null;
}

/**
 * Projiziert die kommenden geplanten Einheiten ab einem Datum (rein lesend,
 * fuer die Vorschau im Editor). Rotations-Termine gehen davon aus, dass alle
 * Termine bis dahin planmaessig absolviert werden.
 * @returns {{date:string, routine:object}[]}
 */
export function projectPlanDays(plan = getWeeklyPlan(), fromDate = null, totalDays = 60) {
  if (!plan.autoFill || !plan.cycleLength) return [];
  const start = fromDate || todayDateKey();
  const rotationOffsets = new Map();
  const out = [];
  for (let i = 0; i < totalDays; i++) {
    const date = addDaysToDateKey(start, i);
    const routine = resolvePlanDay(plan, date, rotationOffsets);
    if (routine) out.push({ date, routine });
  }
  return out;
}

/**
 * Traegt den Zyklus fuer die kommenden Wochen in den Kalender ein. Alte,
 * noch nicht absolvierte Plan-Eintraege (source 'weeklyPlan') ab heute
 * werden vorher entfernt, damit Planaenderungen/Rotations-Fortschritt
 * sauber durchschlagen. Manuell angelegte Eintraege bleiben unangetastet.
 * Sollte nach jedem abgeschlossenen Workout und beim Oeffnen von Kalender/
 * Wochenplan erneut aufgerufen werden, damit verpasste Rotations-Termine
 * sichtbar nachrutschen.
 */
export function syncWeeklyPlanToCalendar(plan = getWeeklyPlan(), fromDate = null) {
  const start = fromDate || todayDateKey();
  const all = getCalendarEntries();
  const kept = all.filter((e) => !(e.source === 'weeklyPlan' && e.date >= start));

  const projected = projectPlanDays(plan, start, (plan.weeksAhead || 8) * 7);
  const created = [];
  for (const { date, routine } of projected) {
    const dup = kept.some((e) => e.date === date && e.type === 'workout' && e.routineId === routine.id);
    if (dup) continue;
    created.push({
      id: uid(), createdAt: nowIso(), source: 'weeklyPlan',
      type: 'workout', date, routineId: routine.id, routineName: routine.name, note: '',
    });
  }

  write(KEYS.calendarEntries, [...kept, ...created]);
  return created.length;
}

/** Was ist laut Plan HEUTE vorgesehen (aktueller Rotations-Stand)? Fuer
 *  beliebige zukuenftige Daten stattdessen die synchronisierten
 *  Kalender-Eintraege verwenden (getCalendarEntriesForDate) – die
 *  beruecksichtigen die Projektion inkl. aller Rotationen korrekt. */
export function plannedForDate(dateKey, plan = getWeeklyPlan()) {
  const routine = resolvePlanDay(plan, dateKey, new Map());
  return routine ? { routine } : null;
}

/* =========================================================
   Abgeleitete Statistiken
   ========================================================= */

export function sessionVolume(session) {
  let vol = 0;
  for (const ex of session.exercises) {
    // Zeit-/Cardio-Uebungen haben kein kg-Volumen
    if (ex.mode === 'time' || ex.mode === 'cardio') continue;
    for (const s of ex.sets) {
      if (s.done && !s.isWarmup) vol += (Number(s.weight) || 0) * (Number(s.reps) || 0);
    }
  }
  return vol;
}

/** Nur Gewicht/Wdh.-Saetze (fuer 1RM-Schaetzung & PR-Liste). */
export function allSetsForExercise(exerciseId) {
  const out = [];
  for (const session of getSessions()) {
    if (!session.endedAt) continue;
    for (const ex of session.exercises) {
      if (ex.exerciseId !== exerciseId || ex.mode === 'time' || ex.mode === 'cardio') continue;
      for (const s of ex.sets) {
        if (s.done && !s.isWarmup) out.push({ date: session.endedAt, reps: s.reps, weight: s.weight });
      }
    }
  }
  return out.sort((a, b) => new Date(a.date) - new Date(b.date));
}

/**
 * Bestwerte einer Cardio-Uebung je erfasster Kennzahl.
 * Die Dauer wird in Sekunden, alles andere in seiner Einheit gefuehrt.
 * @returns {Object<string, {value:number, date:string}>}
 */
export function cardioRecords(exerciseId) {
  const best = {};
  for (const session of getSessions()) {
    if (!session.endedAt) continue;
    for (const ex of session.exercises) {
      if (ex.exerciseId !== exerciseId || ex.mode !== 'cardio') continue;
      for (const s of ex.sets) {
        if (!s.done) continue;
        for (const field of CARDIO_FIELDS) {
          const raw = field.key === 'duration' ? s.seconds : s[field.key];
          const value = Number(raw) || 0;
          if (value <= 0) continue;
          if (!best[field.key] || value > best[field.key].value) {
            best[field.key] = { value, date: session.endedAt };
          }
        }
      }
    }
  }
  return best;
}

/** Alle Uebungen, die als Cardio protokolliert wurden. */
export function cardioExerciseIds() {
  const ids = new Set();
  for (const session of getSessions()) {
    if (!session.endedAt) continue;
    for (const ex of session.exercises) {
      if (ex.mode === 'cardio' && ex.sets.some((s) => s.done)) ids.add(ex.exerciseId);
    }
  }
  return [...ids];
}

/**
 * Vergleicht geplante mit tatsaechlich absolvierten Einheiten.
 * Zaehlt nur Tage in der Vergangenheit (heute noch nicht bewertet).
 * @returns {{planned:number, completed:number, missed:{date:string,routineName:string}[], rate:number}}
 */
export function planAdherence(daysBack = 28) {
  const today = todayDateKey();
  const from = addDaysToDateKey(today, -daysBack);
  const planned = getCalendarEntries().filter(
    (e) => e.type === 'workout' && e.date >= from && e.date < today,
  );

  const sessionsByDate = new Map();
  for (const s of getSessions()) {
    if (!s.endedAt) continue;
    const key = s.startedAt.slice(0, 10);
    if (!sessionsByDate.has(key)) sessionsByDate.set(key, []);
    sessionsByDate.get(key).push(s);
  }

  const missed = [];
  let completed = 0;
  for (const p of planned) {
    const done = (sessionsByDate.get(p.date) || []).some(
      (s) => !p.routineId || s.routineId === p.routineId,
    );
    if (done) completed++;
    else missed.push({ date: p.date, routineName: p.routineName || 'Workout' });
  }

  return {
    planned: planned.length,
    completed,
    missed: missed.sort((a, b) => b.date.localeCompare(a.date)),
    rate: planned.length ? completed / planned.length : null,
  };
}

/** Volumen und Satzzahl je Muskelgruppe im gewaehlten Zeitraum. */
export function volumeByMuscleGroup(daysBack = 28) {
  const from = addDaysToDateKey(todayDateKey(), -daysBack);
  const byGroup = new Map();
  const exercises = new Map(getExercises().map((e) => [e.id, e]));

  for (const session of getSessions()) {
    if (!session.endedAt || session.startedAt.slice(0, 10) < from) continue;
    for (const ex of session.exercises) {
      const group = exercises.get(ex.exerciseId)?.muscleGroup || 'Sonstige';
      if (!byGroup.has(group)) byGroup.set(group, { group, sets: 0, volume: 0 });
      const entry = byGroup.get(group);
      for (const s of ex.sets) {
        if (!s.done || s.isWarmup) continue;
        entry.sets++;
        if (ex.mode !== 'time') entry.volume += (Number(s.weight) || 0) * (Number(s.reps) || 0);
      }
    }
  }
  return [...byGroup.values()].sort((a, b) => b.sets - a.sets);
}

/** Trainingsintensitaet je Tag (fuer die Heatmap): Volumen, sonst Satzzahl. */
export function dailyTrainingLoad() {
  const map = new Map();
  for (const session of getSessions()) {
    if (!session.endedAt) continue;
    const key = session.startedAt.slice(0, 10);
    const vol = sessionVolume(session);
    const setsDone = session.exercises.reduce(
      (n, ex) => n + ex.sets.filter((s) => s.done && !s.isWarmup).length, 0,
    );
    // Reine Cardio-/Zeit-Einheiten haetten sonst den Wert 0 und blieben unsichtbar
    const value = vol > 0 ? vol : setsDone * 100;
    map.set(key, (map.get(key) || 0) + value);
  }
  return map;
}

/**
 * Abgeschlossene Einheiten, in denen eine bestimmte Uebung vorkam – neueste zuerst.
 * Basis fuer Progressions- und Deload-Analyse.
 * @returns {{date:string, sets:object[], mode:string, comment:string, recovery:object|null}[]}
 */
export function exerciseHistory(exerciseId, limit = 8) {
  const out = [];
  for (const session of getSessions()) { // bereits absteigend sortiert
    if (!session.endedAt) continue;
    const ex = session.exercises.find((e) => e.exerciseId === exerciseId);
    if (!ex) continue;
    const working = ex.sets.filter((s) => s.done && !s.isWarmup);
    if (!working.length) continue;
    out.push({
      date: session.endedAt,
      sessionId: session.id,
      mode: ex.mode || 'reps',
      sets: working,
      comment: ex.comment || '',
      recovery: session.recovery || null,
    });
    if (out.length >= limit) break;
  }
  return out;
}
