import { setTitle, setActions, setBack } from '../router.js';
import {
  getActiveSession, setActiveSession, clearActiveSession, saveFinishedSession, allSetsForExercise,
  sessionVolume, getSettings, getCalendarEntriesForDate, deleteCalendarEntry,
  RPE_SCALE, RECOVERY_LEVELS,
} from '../db.js';
import { analyzeExercise, platesForWeight, warmupSets } from '../coach.js';
import { openModal, confirmDialog, toast } from '../ui.js';
import { formatDuration, estimate1RM, formatNum, nowIso, escapeHtml, todayKey } from '../utils.js';

let restTimer = null; // { remaining, total, intervalId, exerciseName }
let tickHandle = null;
let openNotes = new Set(); // Indizes der Uebungen mit sichtbarem Notizfeld
let cueDismissed = false; // Atmung/Bracing-Banner fuer diesen Besuch ausgeblendet?
// Empfehlungen werden einmal beim Oeffnen berechnet, nicht bei jedem Neuzeichnen
let adviceByExercise = new Map();

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

  // Empfehlungen aus der Historie – nur fuer Uebungen mit Vorgeschichte
  adviceByExercise = new Map();
  for (const ex of session.exercises) {
    if (adviceByExercise.has(ex.exerciseId)) continue;
    const analysis = analyzeExercise(ex.exerciseId);
    if (analysis.suggestion) adviceByExercise.set(ex.exerciseId, analysis);
  }

  setBack(async () => {
    const ok = await confirmDialog('Training verlassen?', 'Dein Fortschritt bleibt gespeichert – du kannst später hier weitermachen.', 'Verlassen', false);
    if (ok) location.hash = '#/';
  });
  setTitle(session.routineName);
  setActions(`<button class="icon-btn" id="cancel-session" aria-label="Abbrechen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg></button>`);

  function persist() { setActiveSession(session); }

  function draw() {
    const view = document.getElementById('view');
    view.innerHTML = `
      ${!cueDismissed ? formCueBannerHtml() : ''}
      ${restTimer ? restBannerHtml() : ''}
      <div class="stack" id="ex-blocks">
        ${session.exercises.map((ex, i) => exerciseBlockHtml(ex, i, session)).join('')}
      </div>
      <div class="field" style="margin-top:6px">
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
          <span class="faint">Pause · ${escapeHtml(restTimer.exerciseName)}</span>
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
    const showRpe = settings.trackRpe && ex.mode !== 'time';

    return `
      <div class="card" style="${sameAsPrev ? 'margin-top:-6px' : ''}">
        ${grouped ? `<div class="badge badge--accent" style="margin-bottom:8px">🔁 Zirkel/Supersatz</div>` : ''}
        <div class="row row--between">
          <h3 style="margin-bottom:2px">${escapeHtml(ex.exerciseName)}</h3>
          <div class="row" style="gap:0">
            ${ex.mode !== 'time' ? `<button class="icon-btn" data-tools="${i}" aria-label="Scheiben & Aufwärmen">
              <svg viewBox="0 0 24 24"><path d="M4 9v6"/><path d="M8 6v12"/><path d="M12 8v8"/><path d="M16 6v12"/><path d="M20 9v6"/></svg>
            </button>` : ''}
            <button class="icon-btn" data-toggle-note="${i}" aria-label="Notiz zur Übung" style="${ex.comment ? 'color:var(--accent)' : ''}">
              <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            </button>
          </div>
        </div>
        ${ex.note ? `<p class="exercise-note">${escapeHtml(ex.note)}</p>` : ''}
        ${advice ? adviceHtml(advice, i) : ''}
        ${noteOpen ? `<textarea class="input" data-ex-comment="${i}" placeholder="Notiz zu dieser Übung (z.B. Ausführung, Gefühl)" style="margin:8px 0">${escapeHtml(ex.comment)}</textarea>` : ''}
        <table class="set-table" style="margin-top:8px">
          <thead><tr>
            <th>Satz</th>
            <th>${ex.mode === 'time' ? 'Min.' : 'Wdh.'}</th>
            <th>${settings.units}</th>
            ${showRpe ? '<th>RPE</th>' : ''}
            <th>✓</th><th></th>
          </tr></thead>
          <tbody>
            ${ex.sets.map((s, si) => `
              <tr class="set-row ${s.done ? 'done' : ''}" data-ex="${i}" data-set="${si}">
                <td class="set-num">${si + 1}${s.isWarmup ? ' <span class=\"faint\">W</span>' : ''}</td>
                <td>${ex.mode === 'time'
                  ? `<input class="mini-input" type="number" inputmode="decimal" step="0.5" min="0" value="${(s.seconds || 0) / 60}" data-field="minutes">`
                  : `<input class="mini-input" type="number" inputmode="numeric" value="${s.reps}" data-field="reps">`}</td>
                <td><input class="mini-input" type="number" inputmode="decimal" value="${s.weight}" data-field="weight"></td>
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
          <button class="btn btn-ghost btn-sm" data-add-warmup="${i}">+ Aufwärmsatz</button>
        </div>
      </div>
    `;
  }

  /** Hinweis-Box mit Progressions- bzw. Deload-Empfehlung. */
  function adviceHtml(advice, i) {
    if (!advice.suggestion) return '';
    const kind = advice.suggestion.type; // 'increase' | 'hold' | 'deload'
    const icon = kind === 'increase' ? '📈' : kind === 'deload' ? '🔄' : '⏸️';
    return `
      <div class="advice advice--${kind}">
        <div class="row row--between">
          <span class="advice__title">${icon} ${escapeHtml(advice.headline)}</span>
          <button class="icon-btn" data-advice-why="${i}" aria-label="Begründung">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/></svg>
          </button>
        </div>
        <p class="advice__text">${escapeHtml(advice.suggestion.text)}</p>
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
        } else {
          set[inp.dataset.field] = Number(inp.value) || 0;
        }
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
        persist();
        if (s.done) {
          startRestTimer(ex.restSeconds || settings.defaultRest, ex.exerciseName);
          if (navigator.vibrate) navigator.vibrate(15);
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
        const fresh = ex.mode === 'time'
          ? { seconds: last?.seconds ?? 60, weight: last?.weight ?? 0, done: false, isWarmup: false }
          : { reps: last?.reps ?? 10, weight: last?.weight ?? 0, done: false, isWarmup: false };
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
    document.getElementById('form-cue-dismiss')?.addEventListener('click', () => {
      cueDismissed = true;
      document.getElementById('form-cue-banner')?.remove();
    });
    document.getElementById('finish-session')?.addEventListener('click', onFinish);
    document.getElementById('rest-skip')?.addEventListener('click', () => stopRestTimer(true));
    document.getElementById('rest-plus')?.addEventListener('click', () => { restTimer.remaining += 15; updateRestDisplay(); });
    document.getElementById('rest-minus')?.addEventListener('click', () => { restTimer.remaining = Math.max(0, restTimer.remaining - 15); updateRestDisplay(); });
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

  function updateRestDisplay() {
    const el = document.getElementById('rest-time');
    if (el) el.textContent = formatDuration(restTimer.remaining);
  }

  function startRestTimer(seconds, exerciseName) {
    if (!seconds) return;
    stopRestTimer(false, { silent: true });
    restTimer = { remaining: seconds, total: seconds, exerciseName };
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
    for (const ex of session.exercises) {
      if (ex.mode === 'time') continue; // Zeit-Uebungen haben keine Gewichts-PRs
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

    session.endedAt = nowIso();
    saveFinishedSession(session);
    clearActiveSession();

    // Erfuellte Kalender-Planung fuer diesen Tag/diese Routine automatisch entfernen
    getCalendarEntriesForDate(todayKey(new Date(session.endedAt)))
      .filter((e) => e.type === 'workout' && e.routineId === session.routineId)
      .forEach((e) => deleteCalendarEntry(e.id));

    const durationSec = (new Date(session.endedAt) - new Date(session.startedAt)) / 1000;
    const volume = sessionVolume(session);
    const setsDone = session.exercises.reduce((n, ex) => n + ex.sets.filter((s) => s.done).length, 0);

    showSummary({ durationSec, volume, setsDone, prList, units: settings.units });
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

  function showSummary({ durationSec, volume, setsDone, prList, units }) {
    const handle = openModal(`
      <h3 class="modal-title">Workout abgeschlossen 💪</h3>
      <div class="grid-3" style="margin-bottom:16px">
        <div class="stat-tile"><div class="stat-tile__value">${formatDuration(durationSec)}</div><div class="stat-tile__label">Dauer</div></div>
        <div class="stat-tile"><div class="stat-tile__value">${formatNum(volume, 0)}</div><div class="stat-tile__label">Volumen (${units})</div></div>
        <div class="stat-tile"><div class="stat-tile__value">${setsDone}</div><div class="stat-tile__label">Sätze</div></div>
      </div>
      ${prList.length ? `
        <div class="section-title" style="margin-top:0">Neue persönliche Rekorde</div>
        <div class="stack">
          ${prList.map((p) => `<div class="row row--between"><span>${escapeHtml(p.name)}</span><span class="badge badge--pr">🏆 ${formatNum(p.weight)} ${units} × ${p.reps}</span></div>`).join('')}
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

  return function cleanup() {
    stopRestTimer(false);
  };
}
