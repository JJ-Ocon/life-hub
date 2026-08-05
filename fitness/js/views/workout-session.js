import { setTitle, setActions, setBack } from '../router.js';
import {
  getActiveSession, setActiveSession, clearActiveSession, saveFinishedSession, allSetsForExercise,
  sessionVolume, getSettings, getCalendarEntriesForDate, deleteCalendarEntry, getExerciseById, getExercises,
  advanceRotationIfNeeded, syncWeeklyPlanToCalendar, refreshSharedCalendarMirror,
  RPE_SCALE, RECOVERY_LEVELS, cardioFieldDef, cardioRecords,
} from '../db.js';
import { analyzeExercise, platesForWeight, warmupSets } from '../coach.js';
import { estimateRoutineLoad } from '../nutrition.js';
import { openModal, confirmDialog, toast, toastWithUndo } from '../ui.js';
import { formatDuration, estimate1RM, formatNum, nowIso, escapeHtml, todayKey } from '../utils.js';

let restTimer = null; // { remaining, total, intervalId, exerciseName }
let tickHandle = null;
let openNotes = new Set(); // Indizes der Uebungen mit sichtbarem Notizfeld
let cueDismissed = false; // Atmung/Bracing-Banner fuer diesen Besuch ausgeblendet?
// Empfehlungen werden einmal beim Oeffnen berechnet, nicht bei jedem Neuzeichnen
let adviceByExercise = new Map();
// Uebungen, fuer die die Live-Nachfrage (Stufe 0) diese Sitzung schon beantwortet wurde
let liveCheckHandled = new Set();

function exerciseMuscleGroup(exerciseId) {
  return getExerciseById(exerciseId)?.muscleGroup || null;
}

export function render() {
  const session = getActiveSession();
  if (!session) {
    location.hash = '#/';
    return;
  }
  const settings = getSettings();

  session.comment = session.comment || '';
  session.exercises.forEach((ex) => { ex.note = ex.note || ''; ex.comment = ex.comment || ''; });
  openNotes = new Set();
  cueDismissed = false;
  liveCheckHandled = new Set();

  // Empfehlungen aus der Historie – nur fuer Uebungen mit Vorgeschichte
  adviceByExercise = new Map();
  for (const ex of session.exercises) {
    if (adviceByExercise.has(ex.exerciseId)) continue;
    const analysis = analyzeExercise(ex.exerciseId);
    if (analysis.suggestion) adviceByExercise.set(ex.exerciseId, analysis);
  }
  // Recovery-Halbwoche betrifft die ganze Muskelgruppe und ist sicherheitsrelevanter
  // als eine einzelne Progressions-/Beobachten-Empfehlung – sie ueberschreibt diese
  // bewusst fuer alle Uebungen derselben Gruppe in dieser Sitzung. Die ausloesende
  // Uebung muss dafuer nicht selbst Teil dieser Session sein.
  for (const ex of session.exercises) {
    if (adviceByExercise.get(ex.exerciseId)?.status === 'recovery-half-week') continue;
    const group = exerciseMuscleGroup(ex.exerciseId);
    if (!group) continue;
    const sibling = getExercises().find((e) => e.id !== ex.exerciseId && e.muscleGroup === group
      && analyzeExercise(e.id).status === 'recovery-half-week');
    if (sibling) {
      const siblingAnalysis = analyzeExercise(sibling.id);
      adviceByExercise.set(ex.exerciseId, {
        ...siblingAnalysis,
        headline: `${ex.exerciseName}: Teil der Recovery-Halbwoche`,
        reasons: [`Gehört wie ${sibling.name} zur Muskelgruppe ${group}`],
        affectedExercises: [],
      });
    }
  }

  setBack(async () => {
    const ok = await confirmDialog('Training verlassen?', 'Dein Fortschritt bleibt gespeichert – du kannst später hier weitermachen.', 'Verlassen', false);
    if (ok) location.hash = '#/';
  });
  setTitle(session.routineName);
  setActions(`
    <button class="icon-btn" id="manual-rest" aria-label="Pause starten"><svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2"/><path d="M9 2h6"/></svg></button>
    <button class="icon-btn" id="cancel-session" aria-label="Abbrechen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg></button>
  `);

  function persist() { setActiveSession(session); }

  function draw() {
    const view = document.getElementById('view');
    view.innerHTML = `
      ${!cueDismissed ? formCueBannerHtml() : ''}
      ${restTimer && restTimer.exIdx == null ? restBannerHtml() : ''}
      <div class="stack" id="ex-blocks">
        ${session.exercises.map((ex, i) => `
          ${restTimer && restTimer.exIdx === i ? restBannerHtml() : ''}
          ${exerciseBlockHtml(ex, i, session)}
        `).join('')}
      </div>
      <button class="btn btn-ghost" id="check-all-session" style="margin-top:6px">✓ Komplettes Workout abhaken</button>
      <div class="field" style="margin-top:12px">
        <label>Notiz zum gesamten Workout</label>
        <textarea class="input" id="session-comment" placeholder="Wie fühlt sich das Training an? Beschwerden, Highlights, …">${escapeHtml(session.comment)}</textarea>
      </div>
      <button class="btn btn-primary" id="finish-session" style="margin-top:6px">Workout beenden</button>
    `;
    wire();
  }

  function formCueBannerHtml() {
    return `
      <div class="form-cue-banner" id="form-cue-banner">
        <svg viewBox="0 0 24 24"><path d="M12 2v6"/><circle cx="12" cy="13" r="8"/><path d="M9.5 13.5l1.8 1.8 3.2-3.6"/></svg>
        <span>Achte bei <strong>allen</strong> Übungen auf saubere Atmung &amp; Bracing (unterer Rücken stabil halten, gleichmäßiger Rhythmus) – so holst du mehr Wiederholungen sauber raus.</span>
        <button class="form-cue-banner__close" id="form-cue-dismiss" aria-label="Ausblenden"><svg viewBox="0 0 24 24"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg></button>
      </div>
    `;
  }

  function restBannerHtml() {
    return `
      <div class="timer-banner" id="rest-banner">
        <div class="col">
          <span class="faint">Pause${restTimer.exerciseName ? ' · ' + escapeHtml(restTimer.exerciseName) : ''}</span>
          <span class="timer-banner__time" id="rest-time">${formatDuration(restTimer.remaining)}</span>
        </div>
        <div class="row" style="gap:6px">
          <button class="btn btn-ghost btn-sm" id="rest-minus">-15s</button>
          <button class="btn btn-ghost btn-sm" id="rest-plus">+15s</button>
          <button class="btn btn-primary btn-sm" id="rest-skip">Überspringen</button>
        </div>
      </div>
    `;
  }

  function exerciseBlockHtml(ex, i, session) {
    const grouped = !!ex.groupId;
    const sameAsPrev = i > 0 && session.exercises[i - 1].groupId === ex.groupId && grouped;
    const noteOpen = openNotes.has(i);
    const advice = adviceByExercise.get(ex.exerciseId);
    const showRpe = settings.trackRpe && ex.mode === 'reps';
    const isCardio = ex.mode === 'cardio';
    const cardioFields = isCardio ? (ex.cardioFields || ['duration']) : null;

    const hasAlternatives = ex.alternatives?.length > 1;

    return `
      <div class="card" style="${sameAsPrev ? 'margin-top:-6px' : ''}" data-swipe-area="${i}">
        ${grouped ? `<div class="badge badge--accent" style="margin-bottom:8px">🔁 Zirkel/Supersatz</div>` : ''}
        <div class="row row--between">
          <h3 style="margin-bottom:2px">${escapeHtml(ex.exerciseName)}</h3>
          <div class="row" style="gap:0">
            ${ex.mode === 'reps' ? `<button class="icon-btn" data-tools="${i}" aria-label="Scheiben & Aufwärmen">
              <svg viewBox="0 0 24 24"><path d="M4 9v6"/><path d="M8 6v12"/><path d="M12 8v8"/><path d="M16 6v12"/><path d="M20 9v6"/></svg>
            </button>` : ''}
            <button class="icon-btn" data-toggle-note="${i}" aria-label="Notiz zur Übung" style="${ex.comment ? 'color:var(--accent)' : ''}">
              <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            </button>
          </div>
        </div>
        ${hasAlternatives ? `
          <div class="alt-dots">
            ${ex.alternatives.map((a, ai) => `<button class="alt-dot ${ai === ex.activeAlternativeIndex ? 'active' : ''}" data-alt-select="${i}:${ai}" aria-label="${escapeHtml(a.exerciseName)}"></button>`).join('')}
            <span class="faint alt-dots__hint">◂ wischen für Alternative ▸</span>
          </div>
        ` : ''}
        ${ex.note ? `<p class="exercise-note">${escapeHtml(ex.note)}</p>` : ''}
        ${advice ? adviceHtml(advice, i) : ''}
        ${noteOpen ? `<textarea class="input" data-ex-comment="${i}" placeholder="Notiz zu dieser Übung (z.B. Ausführung, Gefühl)" style="margin:8px 0">${escapeHtml(ex.comment)}</textarea>` : ''}
        <table class="set-table" style="margin-top:8px">
          <thead><tr>
            <th>Satz</th>
            ${isCardio
              ? cardioFields.map((k) => `<th>${cardioFieldDef(k).short}</th>`).join('')
              : `<th>${ex.mode === 'time' ? 'Min.' : 'Wdh.'}</th><th>${settings.units}</th>`}
            ${showRpe ? '<th>RPE</th>' : ''}
            <th>✓</th><th></th>
          </tr></thead>
          <tbody>
            ${ex.sets.map((s, si) => `
              <tr class="set-row ${s.done ? 'done' : ''}" data-ex="${i}" data-set="${si}">
                <td class="set-num">${si + 1}${s.isWarmup ? ' <span class=\"faint\">W</span>' : ''}</td>
                ${isCardio
                  ? cardioFields.map((k) => `<td><input class="mini-input" type="number" inputmode="decimal" step="${k === 'duration' ? '0.5' : '0.1'}" value="${k === 'duration' ? (s.seconds || 0) / 60 : (s[k] ?? '')}" data-field="${k === 'duration' ? 'minutes' : k}"></td>`).join('')
                  : `
                    <td>${ex.mode === 'time'
                      ? `<input class="mini-input" type="number" inputmode="decimal" step="0.5" min="0" value="${(s.seconds || 0) / 60}" data-field="minutes">`
                      : `<input class="mini-input" type="number" inputmode="numeric" value="${s.reps}" data-field="reps">`}</td>
                    <td><input class="mini-input" type="number" inputmode="decimal" value="${s.weight}" data-field="weight"></td>
                  `}
                ${showRpe ? `<td><button class="rpe-btn ${s.rpe ? 'set' : ''}" data-rpe-pick aria-label="RPE wählen">${s.rpe || '–'}</button></td>` : ''}
                <td><button class="set-check ${s.done ? 'done' : ''}" data-toggle-done aria-label="Satz erledigt">
                  <svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>
                </button></td>
                <td><button class="set-remove" data-remove-set aria-label="Satz entfernen">
                  <svg viewBox="0 0 24 24"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>
                </button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <div class="row" style="gap:8px; margin-top:10px">
          <button class="btn btn-ghost btn-sm grow" data-add-set="${i}">+ Satz</button>
          ${ex.mode === 'reps' ? `<button class="btn btn-ghost btn-sm" data-add-warmup="${i}">+ Aufwärmsatz</button>` : ''}
          <button class="btn btn-ghost btn-sm" data-check-all="${i}">✓ Alle</button>
        </div>
      </div>
    `;
  }

  /** Formatiert einen Cardio-PR-Wert menschenlesbar (Dauer als Zeit, Rest mit Einheit). */
  function formatCardioValue(p) {
    if (p.key === 'duration') return formatDuration(p.value);
    const def = cardioFieldDef(p.key);
    return `${formatNum(p.value, def?.decimals ?? 1)} ${p.unit}`;
  }

  /** Hinweis-Box mit Progressions- bzw. Deload-Empfehlung. */
  function adviceHtml(advice, i) {
    if (!advice.suggestion) return '';
    const kind = advice.suggestion.type; // 'increase' | 'hold' | 'deload' | 'half_week'
    const icon = kind === 'increase' ? '📈' : kind === 'deload' ? '🔄' : kind === 'half_week' ? '🛑' : '⏸️';
    return `
      <div class="advice advice--${kind}">
        <div class="row row--between">
          <span class="advice__title">${icon} ${escapeHtml(advice.headline)}</span>
          <button class="icon-btn" data-advice-why="${i}" aria-label="Begründung">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/></svg>
          </button>
        </div>
        <p class="advice__text">${escapeHtml(advice.suggestion.text)}</p>
        ${kind === 'half_week' && advice.affectedExercises?.length ? `
          <p class="advice__text faint">Betrifft auch: ${escapeHtml(advice.affectedExercises.join(', '))}</p>
        ` : ''}
        ${advice.suggestion.weight ? `
          <button class="btn btn-ghost btn-sm" data-apply-advice="${i}" style="margin-top:8px">
            ${formatNum(advice.suggestion.weight)} ${settings.units} für alle Sätze übernehmen
          </button>
        ` : ''}
      </div>
    `;
  }

  function wire() {
    document.querySelectorAll('.mini-input').forEach((inp) => {
      inp.addEventListener('input', () => {
        const tr = inp.closest('tr');
        const exIdx = +tr.dataset.ex, setIdx = +tr.dataset.set;
        const set = session.exercises[exIdx].sets[setIdx];
        if (inp.dataset.field === 'minutes') {
          set.seconds = Math.round((Number(inp.value) || 0) * 60);
        } else if (inp.value === '') {
          delete set[inp.dataset.field];
        } else {
          set[inp.dataset.field] = Number(inp.value) || 0;
        }
        session.lastActiveExerciseIndex = +inp.closest('tr').dataset.ex;
        persist();
      });
    });
    document.querySelectorAll('[data-toggle-done]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tr = btn.closest('tr');
        const exIdx = +tr.dataset.ex, setIdx = +tr.dataset.set;
        const ex = session.exercises[exIdx];
        const s = ex.sets[setIdx];
        s.done = !s.done;
        session.lastActiveExerciseIndex = exIdx;
        persist();
        if (s.done) {
          startRestTimer(ex.restSeconds || settings.defaultRest, ex.exerciseName, exIdx);
          if (navigator.vibrate) navigator.vibrate(15);
          maybeAskCancelRemaining(exIdx, setIdx);
        }
        draw();
      });
    });
    document.querySelectorAll('[data-remove-set]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tr = btn.closest('tr');
        const exIdx = +tr.dataset.ex, setIdx = +tr.dataset.set;
        session.exercises[exIdx].sets.splice(setIdx, 1);
        persist(); draw();
      });
    });
    document.querySelectorAll('[data-add-set]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ex = session.exercises[+btn.dataset.addSet];
        const last = ex.sets[ex.sets.length - 1];
        let fresh;
        if (ex.mode === 'cardio') fresh = { ...(last || { seconds: 600 }), done: false, isWarmup: false };
        else if (ex.mode === 'time') fresh = { seconds: last?.seconds ?? 60, weight: last?.weight ?? 0, done: false, isWarmup: false };
        else fresh = { reps: last?.reps ?? 10, weight: last?.weight ?? 0, done: false, isWarmup: false };
        ex.sets.push(fresh);
        persist(); draw();
      });
    });
    document.querySelectorAll('[data-add-warmup]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ex = session.exercises[+btn.dataset.addWarmup];
        const fresh = ex.mode === 'time'
          ? { seconds: 30, weight: 0, done: false, isWarmup: true }
          : { reps: 10, weight: 0, done: false, isWarmup: true };
        ex.sets.unshift(fresh);
        persist(); draw();
      });
    });
    document.querySelectorAll('[data-alt-select]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const [exIdx, altIdx] = btn.dataset.altSelect.split(':').map(Number);
        switchAlternative(exIdx, altIdx);
      });
    });
    document.querySelectorAll('[data-swipe-area]').forEach((area) => {
      let startX = 0, startY = 0, tracking = false;
      area.addEventListener('touchstart', (e) => {
        const t = e.touches[0];
        startX = t.clientX; startY = t.clientY; tracking = true;
      }, { passive: true });
      area.addEventListener('touchend', (e) => {
        if (!tracking) return;
        tracking = false;
        const t = e.changedTouches[0];
        const dx = t.clientX - startX;
        const dy = t.clientY - startY;
        if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        const exIdx = +area.dataset.swipeArea;
        const ex = session.exercises[exIdx];
        if (!ex.alternatives || ex.alternatives.length < 2) return;
        const dir = dx < 0 ? 1 : -1; // nach links wischen = naechste Alternative
        const next = Math.max(0, Math.min(ex.alternatives.length - 1, ex.activeAlternativeIndex + dir));
        if (next !== ex.activeAlternativeIndex) switchAlternative(exIdx, next);
      }, { passive: true });
    });
    document.querySelectorAll('[data-toggle-note]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = +btn.dataset.toggleNote;
        if (openNotes.has(i)) openNotes.delete(i); else openNotes.add(i);
        draw();
      });
    });
    document.querySelectorAll('[data-rpe-pick]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tr = btn.closest('tr');
        openRpePicker(+tr.dataset.ex, +tr.dataset.set);
      });
    });
    document.querySelectorAll('[data-tools]').forEach((btn) => {
      btn.addEventListener('click', () => openExerciseTools(+btn.dataset.tools));
    });
    document.querySelectorAll('[data-advice-why]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ex = session.exercises[+btn.dataset.adviceWhy];
        const advice = adviceByExercise.get(ex.exerciseId);
        if (!advice) return;
        openModal(`
          <h3 class="modal-title">${escapeHtml(advice.headline)}</h3>
          ${advice.reasons.length ? `
            <p class="muted" style="margin-bottom:10px">Worauf das beruht:</p>
            <ul class="advice__list">${advice.reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
          ` : '<p class="muted">Keine Auffälligkeiten in den letzten Einheiten.</p>'}
          <p class="faint" style="margin-top:14px">
            Ausgewertet wurden die letzten ${advice.sessionsAnalysed} Einheiten mit dieser Übung.
            Deloads werden bewusst nur dort vorgeschlagen, wo Leistung und Erholung es nahelegen –
            nicht pauschal nach Kalender.
          </p>
          <button class="btn btn-primary" data-close-modal style="margin-top:16px">Verstanden</button>
        `, { center: true });
      });
    });
    document.querySelectorAll('[data-apply-advice]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = +btn.dataset.applyAdvice;
        const ex = session.exercises[idx];
        const advice = adviceByExercise.get(ex.exerciseId);
        if (!advice?.suggestion?.weight) return;
        ex.sets.forEach((s) => { if (!s.done && !s.isWarmup) s.weight = advice.suggestion.weight; });
        persist(); draw();
        toast('Gewicht übernommen');
      });
    });
    document.querySelectorAll('[data-ex-comment]').forEach((ta) => {
      ta.addEventListener('input', () => {
        session.exercises[+ta.dataset.exComment].comment = ta.value;
        persist();
      });
    });
    document.getElementById('session-comment')?.addEventListener('input', (e) => {
      session.comment = e.target.value;
      persist();
    });
    document.querySelectorAll('[data-check-all]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = +btn.dataset.checkAll;
        const ex = session.exercises[idx];
        if (ex.sets.every((s) => s.done)) { toast('Schon alles abgehakt'); return; }
        const prevStates = ex.sets.map((s) => s.done);
        ex.sets.forEach((s) => { s.done = true; });
        session.lastActiveExerciseIndex = idx;
        persist(); draw();
        if (ex.mode !== 'cardio') startRestTimer(ex.restSeconds || settings.defaultRest, ex.exerciseName, idx);
        toastWithUndo(`${ex.exerciseName}: alle Sätze abgehakt`, () => {
          ex.sets.forEach((s, i) => { s.done = prevStates[i]; });
          persist(); draw();
        });
      });
    });
    document.getElementById('check-all-session')?.addEventListener('click', async () => {
      if (session.exercises.every((ex) => ex.sets.every((s) => s.done))) { toast('Schon alles abgehakt'); return; }
      const ok = await confirmDialog('Komplettes Workout abhaken?', 'Alle Sätze aller Übungen werden als erledigt markiert.', 'Alle abhaken', false);
      if (!ok) return;
      const snapshot = session.exercises.map((ex) => ex.sets.map((s) => s.done));
      session.exercises.forEach((ex) => ex.sets.forEach((s) => { s.done = true; }));
      persist(); draw();
      toastWithUndo('Ganzes Workout abgehakt', () => {
        session.exercises.forEach((ex, i) => ex.sets.forEach((s, j) => { s.done = snapshot[i][j]; }));
        persist(); draw();
      });
    });
    document.getElementById('form-cue-dismiss')?.addEventListener('click', () => {
      cueDismissed = true;
      document.getElementById('form-cue-banner')?.remove();
    });
    document.getElementById('finish-session')?.addEventListener('click', onFinish);
    document.getElementById('rest-skip')?.addEventListener('click', () => stopRestTimer(true));
    document.getElementById('rest-plus')?.addEventListener('click', () => { restTimer.remaining += 15; updateRestDisplay(); });
    document.getElementById('rest-minus')?.addEventListener('click', () => { restTimer.remaining = Math.max(0, restTimer.remaining - 15); updateRestDisplay(); });
    document.getElementById('manual-rest')?.addEventListener('click', openManualRestPicker);
  }

  /** Separater, manuell startbarer Pausentimer - unabhaengig vom automatischen
   *  Pausentimer nach einem abgehakten Satz. Fuer Pausen, die nicht direkt an
   *  eine bestimmte Uebung gebunden sind (z.B. laenger unterbrechen). */
  function openManualRestPicker() {
    if (restTimer) {
      stopRestTimer(false);
      toast('Laufende Pause gestoppt');
      draw();
      return;
    }
    const presets = [30, 60, 90, 120, 180];
    const handle = openModal(`
      <h3 class="modal-title">Pause starten</h3>
      <div class="chip-row" style="margin-bottom:14px">
        ${presets.map((s) => `<button class="chip" data-rest-preset="${s}">${formatDuration(s)}</button>`).join('')}
      </div>
      <div class="field">
        <label>Oder eigene Dauer (Sekunden)</label>
        <input class="input" type="number" inputmode="numeric" id="rest-custom" value="${settings.defaultRest}" min="1">
      </div>
      <button class="btn btn-primary" id="rest-custom-start" style="margin-top:6px">Starten</button>
    `, { center: true });
    handle.sheet.querySelectorAll('[data-rest-preset]').forEach((b) => b.addEventListener('click', () => {
      startRestTimer(Number(b.dataset.restPreset), '', null);
      handle.close();
      draw();
    }));
    handle.sheet.querySelector('#rest-custom-start').addEventListener('click', () => {
      const seconds = Number(handle.sheet.querySelector('#rest-custom').value) || 0;
      if (seconds <= 0) { toast('Bitte eine Dauer angeben'); return; }
      startRestTimer(seconds, '', null);
      handle.close();
      draw();
    });
  }

  /** Wechselt die aktive Alternative einer Uebung (Swipe oder Punkt-Tap). Der
   *  bisherige Fortschritt jeder Alternative bleibt erhalten – ex.sets zeigt
   *  danach einfach auf die (eigenen, live gefuehrten) Saetze der neuen Wahl. */
  function switchAlternative(exIdx, newIndex) {
    const ex = session.exercises[exIdx];
    if (!ex.alternatives?.[newIndex] || newIndex === ex.activeAlternativeIndex) return;
    ex.activeAlternativeIndex = newIndex;
    const alt = ex.alternatives[newIndex];
    ex.exerciseId = alt.exerciseId;
    ex.exerciseName = alt.exerciseName;
    ex.mode = alt.mode;
    ex.cardioFields = alt.cardioFields;
    ex.note = alt.note;
    ex.sets = alt.sets;
    session.lastActiveExerciseIndex = exIdx;
    persist();
    draw();
  }

  /** Kleine RPE-Auswahl fuer einen einzelnen Satz. */
  function openRpePicker(exIdx, setIdx) {
    const set = session.exercises[exIdx].sets[setIdx];
    const handle = openModal(`
      <h3 class="modal-title">Wie schwer war Satz ${setIdx + 1}?</h3>
      <p class="faint" style="margin-bottom:14px">RPE = Anstrengung. In Klammern, wie viele Wiederholungen noch drin gewesen wären.</p>
      <div class="stack">
        ${RPE_SCALE.map((r) => `
          <button class="btn ${set.rpe === r.value ? 'btn-primary' : 'btn-ghost'}" data-rpe="${r.value}">
            RPE ${r.label} · ${r.rir}
          </button>
        `).join('')}
        ${set.rpe ? '<button class="btn btn-ghost" data-rpe="">Eintrag entfernen</button>' : ''}
      </div>
    `, { center: true });

    handle.sheet.querySelectorAll('[data-rpe]').forEach((b) => b.addEventListener('click', () => {
      const v = b.dataset.rpe;
      if (v === '') delete set.rpe; else set.rpe = Number(v);
      persist();
      handle.close();
      draw();
    }));
  }

  /** Plattenrechner und Aufwaermsaetze fuer eine Uebung. */
  function openExerciseTools(exIdx) {
    const ex = session.exercises[exIdx];
    const working = ex.sets.find((s) => !s.isWarmup && s.weight > 0) || ex.sets[0];
    let target = Number(working?.weight) || settings.barWeight || 20;

    const handle = openModal(content(), {});
    wireTools();

    function content() {
      const plates = platesForWeight(target, settings);
      const warmups = warmupSets(target, settings);
      return `
        <h3 class="modal-title">${escapeHtml(ex.exerciseName)}</h3>
        <div class="field">
          <label>Arbeitsgewicht (${settings.units})</label>
          <input class="input" type="number" inputmode="decimal" step="0.5" id="tool-weight" value="${target}">
        </div>

        <div class="section-title" style="margin-top:6px">Scheiben je Seite</div>
        ${plates.perSide.length === 0 ? `
          <p class="faint">Nur die Stange (${plates.barWeight} ${settings.units}).</p>
        ` : `
          <div class="plate-row">
            ${plates.perSide.map((p) => `<span class="plate">${formatNum(p, 2)}</span>`).join('')}
          </div>
          <p class="faint" style="margin-top:8px">
            Stange ${formatNum(plates.barWeight, 2)} + 2 × (${plates.perSide.map((p) => formatNum(p, 2)).join(' + ')})
            = <strong>${formatNum(plates.achievable, 2)} ${settings.units}</strong>
            ${plates.rest > 0.01 ? ` · ${formatNum(plates.rest, 2)} ${settings.units} nicht ladbar` : ''}
          </p>
        `}

        <div class="section-title">Aufwärmsätze</div>
        ${warmups.length === 0 ? `<p class="faint">Für dieses Gewicht sind keine Aufwärmsätze mit der Stange sinnvoll.</p>` : `
          <div class="stack">
            ${warmups.map((wu) => `
              <div class="row row--between">
                <span class="muted">${Math.round(wu.percent * 100)} % · ${wu.reps} Wdh.</span>
                <strong>${formatNum(wu.weight)} ${settings.units}</strong>
              </div>
            `).join('')}
          </div>
          <button class="btn btn-ghost btn-sm" id="tool-add-warmups" style="margin-top:12px;width:100%">Als Aufwärmsätze eintragen</button>
        `}
        <button class="btn btn-primary" data-close-modal style="margin-top:16px">Schließen</button>
      `;
    }

    function wireTools() {
      handle.sheet.querySelector('#tool-weight').addEventListener('input', (e) => {
        target = Number(e.target.value) || 0;
        handle.sheet.innerHTML = '<div class="modal-handle"></div>' + content();
        wireTools();
        // Fokus zurueck ins Eingabefeld, damit weitergetippt werden kann
        const input = handle.sheet.querySelector('#tool-weight');
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      });
      handle.sheet.querySelector('#tool-add-warmups')?.addEventListener('click', () => {
        const warmups = warmupSets(target, settings);
        ex.sets.unshift(...warmups.map((wu) => ({
          reps: wu.reps, weight: wu.weight, done: false, isWarmup: true,
        })));
        persist();
        handle.close();
        draw();
        toast(`${warmups.length} Aufwärmsätze eingefügt`);
      });
      handle.sheet.querySelectorAll('[data-close-modal]').forEach((b) => b.addEventListener('click', handle.close));
    }
  }

  /**
   * Stufe 0 der Deload-Eskalation: faellt ein Satz deutlich schwaecher aus als
   * geplant, fragt die App direkt, ob die restlichen Saetze dieser Uebung
   * heute gestrichen werden sollen – statt trotzdem durchzuziehen.
   */
  async function maybeAskCancelRemaining(exIdx, setIdx) {
    if (liveCheckHandled.has(exIdx)) return;
    const ex = session.exercises[exIdx];
    if (ex.mode !== 'reps') return;
    const s = ex.sets[setIdx];
    if (s.isWarmup || !s.targetReps) return;

    const missedReps = Number(s.reps) < s.targetReps - 1;
    const failedRpe = s.rpe === 10;
    if (!missedReps && !failedRpe) return;

    const remaining = ex.sets.filter((x, i) => i > setIdx && !x.isWarmup && !x.done);
    if (!remaining.length) return;

    liveCheckHandled.add(exIdx);
    const reason = missedReps
      ? `Nur ${s.reps} statt ${s.targetReps} Wiederholungen geschafft`
      : 'Satz bei RPE 10 (Muskelversagen)';
    const ok = await confirmDialog(
      `${ex.exerciseName}: Rest streichen?`,
      `${reason}. Israetel/Henselmans empfehlen in so einem Fall, die restlichen ${remaining.length} Sätze für heute einfach zu streichen, statt sich durchzukämpfen.`,
      'Sätze streichen', false,
    );
    if (ok) {
      ex.sets = ex.sets.filter((x, i) => !(i > setIdx && !x.isWarmup && !x.done));
      persist();
      draw();
      toast('Restliche Sätze gestrichen');
    }
  }

  function updateRestDisplay() {
    const el = document.getElementById('rest-time');
    if (el) el.textContent = formatDuration(restTimer.remaining);
  }

  function startRestTimer(seconds, exerciseName, exIdx = null) {
    if (!seconds) return;
    stopRestTimer(false, { silent: true });
    restTimer = { remaining: seconds, total: seconds, exerciseName, exIdx };
    tickHandle = setInterval(() => {
      restTimer.remaining -= 1;
      if (restTimer.remaining <= 0) {
        if (navigator.vibrate) navigator.vibrate([100, 60, 100]);
        toast('Pause vorbei');
        stopRestTimer(true);
        return;
      }
      updateRestDisplay();
    }, 1000);
  }

  function stopRestTimer(redraw, opts = {}) {
    if (tickHandle) clearInterval(tickHandle);
    tickHandle = null;
    restTimer = null;
    if (redraw && !opts.silent) draw();
  }

  async function onFinish() {
    const anyDone = session.exercises.some((ex) => ex.sets.some((s) => s.done));
    if (!anyDone) {
      const ok = await confirmDialog('Workout ohne Sätze beenden?', 'Es wurde noch kein Satz abgehakt.', 'Trotzdem beenden', false);
      if (!ok) return;
    }
    // PRs ermitteln (bestehende Historie VOR dem Speichern der aktuellen Session)
    const prList = [];
    const cardioPrList = [];
    for (const ex of session.exercises) {
      if (ex.mode === 'time') continue; // Zeit-Uebungen (Halten) haben keine Gewichts-PRs

      if (ex.mode === 'cardio') {
        const before = cardioRecords(ex.exerciseId);
        for (const key of ex.cardioFields || ['duration']) {
          const def = cardioFieldDef(key);
          const bestNow = Math.max(...ex.sets.filter((s) => s.done).map((s) => Number(key === 'duration' ? s.seconds : s[key]) || 0), 0);
          if (bestNow > 0 && bestNow > (before[key]?.value || 0)) {
            cardioPrList.push({ name: ex.exerciseName, label: def.prLabel, value: bestNow, unit: def.unit, key });
          }
        }
        continue;
      }

      const doneSets = ex.sets.filter((s) => s.done && !s.isWarmup && s.weight > 0);
      if (!doneSets.length) continue;
      const history = allSetsForExercise(ex.exerciseId);
      const historyBest = history.reduce((m, s) => Math.max(m, estimate1RM(s.weight, s.reps)), 0);
      const sessionBestSet = doneSets.reduce((best, s) => estimate1RM(s.weight, s.reps) > estimate1RM(best.weight, best.reps) ? s : best, doneSets[0]);
      const sessionBestE1rm = estimate1RM(sessionBestSet.weight, sessionBestSet.reps);
      if (sessionBestE1rm > historyBest) {
        prList.push({ name: ex.exerciseName, weight: sessionBestSet.weight, reps: sessionBestSet.reps });
      }
    }

    stopRestTimer(false);

    // Erholungs-Einschaetzung: Grundlage fuer spaetere, gezielte Deload-Empfehlungen
    const recovery = await askRecovery();
    if (recovery) session.recovery = recovery;

    // Bei nachtraeglich erfassten Workouts (retro) waere "jetzt" als Endzeit
    // falsch (Start liegt in der Vergangenheit) - stattdessen aus den erfassten
    // Saetzen eine plausible Dauer schaetzen.
    if (session.retro) {
      const load = estimateRoutineLoad({ exercises: session.exercises }, 75);
      const minutes = load.totalMin > 0 ? load.totalMin : 60;
      session.endedAt = new Date(new Date(session.startedAt).getTime() + minutes * 60000).toISOString();
    } else {
      session.endedAt = nowIso();
    }
    saveFinishedSession(session);
    clearActiveSession();

    // Erfuellte Kalender-Planung fuer diesen Tag/diese Routine automatisch entfernen
    getCalendarEntriesForDate(todayKey(new Date(session.endedAt)))
      .filter((e) => e.type === 'workout' && e.routineId === session.routineId)
      .forEach((e) => deleteCalendarEntry(e.id));

    // Gehoert die Routine zu einer Rotation, ruecke den Zeiger vor und
    // aktualisiere die Kalender-Projektion – das ist die "Verpasst-Kaskade":
    // verpasste Termine bleiben stehen, bis sie tatsaechlich absolviert werden.
    if (advanceRotationIfNeeded(session.routineId)) {
      syncWeeklyPlanToCalendar();
    }
    // Die abgeschlossene Session selbst muss unabhaengig von der Rotation
    // in den geteilten Kalender gespiegelt werden.
    refreshSharedCalendarMirror();

    const durationSec = (new Date(session.endedAt) - new Date(session.startedAt)) / 1000;
    const volume = sessionVolume(session);
    const setsDone = session.exercises.reduce((n, ex) => n + ex.sets.filter((s) => s.done).length, 0);

    showSummary({ durationSec, volume, setsDone, prList, cardioPrList, units: settings.units });
  }

  /** Fragt nach dem Training kurz die Erholung ab. Ueberspringbar. */
  function askRecovery() {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const handle = openModal(`
        <h3 class="modal-title">Wie war die Einheit?</h3>
        <p class="faint" style="margin-bottom:14px">
          Kurze Einschätzung – daraus erkennt die App später, ob bei einzelnen
          Übungen eine Entlastung sinnvoll ist.
        </p>
        <div class="stack">
          ${RECOVERY_LEVELS.map((l) => `
            <button class="btn btn-ghost recovery-btn" data-recovery="${l.key}">
              <span class="col" style="align-items:flex-start;gap:2px">
                <strong>${l.label}</strong>
                <span class="faint">${l.hint}</span>
              </span>
            </button>
          `).join('')}
        </div>
        <button class="btn btn-ghost btn-sm" data-recovery-skip style="margin-top:14px;width:100%">Überspringen</button>
      `, { onClose: () => finish(null) });

      handle.sheet.querySelectorAll('[data-recovery]').forEach((b) => b.addEventListener('click', () => {
        finish({ level: b.dataset.recovery, at: nowIso() });
        handle.close();
      }));
      handle.sheet.querySelector('[data-recovery-skip]').addEventListener('click', () => {
        finish(null);
        handle.close();
      });
    });
  }

  function showSummary({ durationSec, volume, setsDone, prList, cardioPrList, units }) {
    const hasPrs = prList.length || cardioPrList.length;
    const handle = openModal(`
      <h3 class="modal-title">Workout abgeschlossen 💪</h3>
      <div class="grid-3" style="margin-bottom:16px">
        <div class="stat-tile"><div class="stat-tile__value">${formatDuration(durationSec)}</div><div class="stat-tile__label">Dauer</div></div>
        <div class="stat-tile"><div class="stat-tile__value">${formatNum(volume, 0)}</div><div class="stat-tile__label">Volumen (${units})</div></div>
        <div class="stat-tile"><div class="stat-tile__value">${setsDone}</div><div class="stat-tile__label">Sätze</div></div>
      </div>
      ${hasPrs ? `
        <div class="section-title" style="margin-top:0">Neue persönliche Rekorde</div>
        <div class="stack">
          ${prList.map((p) => `<div class="row row--between"><span>${escapeHtml(p.name)}</span><span class="badge badge--pr">🏆 ${formatNum(p.weight)} ${units} × ${p.reps}</span></div>`).join('')}
          ${cardioPrList.map((p) => `<div class="row row--between"><span>${escapeHtml(p.name)} · ${p.label}</span><span class="badge badge--pr">🏆 ${formatCardioValue(p)}</span></div>`).join('')}
        </div>
      ` : ''}
      <button class="btn btn-primary" data-close-modal style="margin-top:20px">Weiter</button>
    `, { onClose: () => { location.hash = '#/'; } });
  }

  document.getElementById('cancel-session')?.addEventListener('click', async () => {
    const ok = await confirmDialog('Workout abbrechen?', 'Der bisherige Fortschritt in dieser Einheit geht verloren.', 'Abbrechen', true);
    if (ok) { stopRestTimer(false); clearActiveSession(); location.hash = '#/'; }
  });

  draw();

  // Bei laengeren Routinen sonst jedes Mal oben anfangen zu suchen, obwohl
  // man schon mitten in der Uebung X war - stattdessen direkt dorthin springen.
  if (session.lastActiveExerciseIndex != null && session.exercises[session.lastActiveExerciseIndex]) {
    document.querySelector(`[data-swipe-area="${session.lastActiveExerciseIndex}"]`)
      ?.scrollIntoView({ block: 'start', behavior: 'auto' });
  }

  return function cleanup() {
    stopRestTimer(false);
  };
}
