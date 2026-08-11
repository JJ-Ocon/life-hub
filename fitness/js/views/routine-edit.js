import { setTitle, setActions, setBack, navigate } from '../router.js';
import {
  getRoutineById, saveRoutine, deleteRoutine, getExerciseById, getSettings, CARDIO_FIELDS, cardioFieldDef,
  rotationsContainingRoutine,
  ensureSlotAlternatives, syncSlotMirror, addSlotAlternative, removeSlotAlternative,
} from '../db.js';
import { openExercisePicker } from './exercise-picker.js';
import { openModal, toast, confirmDialog, promptDialog } from '../ui.js';
import { uid, escapeHtml } from '../utils.js';

export function render({ id }) {
  const routine = getRoutineById(id);
  if (!routine) { navigate('#/routines'); return; }
  const settings = getSettings();

  setBack(() => { navigate('#/routines'); });
  setTitle(routine.name);
  setActions(`<button class="icon-btn" id="rename-routine" aria-label="Umbenennen"><svg viewBox="0 0 24 24"><path d="M4 20h4L18 10l-4-4L4 16v4z"/></svg></button>`);

  function persist() { saveRoutine(routine); }

  function draw() {
    setTitle(routine.name);
    const view = document.getElementById('view');
    view.innerHTML = `
      ${rotationCardHtml()}
      <div class="stack" id="exercise-list">
        ${routine.exercises.length === 0 ? `
          <div class="empty">
            <h3>Noch keine Übungen</h3>
            <p>Füge Übungen hinzu, um deine Routine aufzubauen.</p>
          </div>
        ` : routine.exercises.map((re, i) => exerciseRowHtml(re, i)).join('')}
      </div>
      <button class="btn btn-primary" id="add-exercise" style="margin-top:6px">+ Übung hinzufügen</button>
      ${routine.exercises.length > 0 ? `<button class="btn btn-danger" id="delete-routine" style="margin-top:24px">Routine löschen</button>` : ''}
    `;
    wire();
  }

  function exerciseRowHtml(re, i) {
    const ex = getExerciseById(re.exerciseId);
    const grouped = !!re.groupId;
    const prevGrouped = i > 0 && routine.exercises[i - 1].groupId === re.groupId && grouped;
    return `
      <div class="card exercise-row" data-idx="${i}" style="${prevGrouped ? 'margin-top:-6px;border-top-left-radius:4px;border-top-right-radius:4px;' : ''}">
        ${grouped ? `<div class="badge badge--accent" style="margin-bottom:8px">🔁 Zirkel/Supersatz</div>` : ''}
        <div class="row row--between">
          <div class="col grow">
            <h3 class="truncate">${escapeHtml(ex?.name || 'Unbekannte Übung')}</h3>
            <p class="faint">${re.sets.length} Sätze · Pause ${re.restSeconds}s${modeBadge(re)}${re.alternatives?.length > 1 ? ` · 🔀 ${re.alternatives.length} Alternativen` : ''}</p>
            ${re.note ? `<p class="exercise-note">${escapeHtml(re.note)}</p>` : ''}
          </div>
        </div>
        <div class="row" style="gap:6px; margin-top:10px">
          <button class="btn btn-ghost btn-sm grow" data-configure="${i}">Sätze/Pause</button>
          ${i > 0 ? `<button class="btn btn-ghost btn-sm" data-group="${i}">${grouped ? 'Trennen' : 'Gruppieren'}</button>` : ''}
          <button class="icon-btn" data-up="${i}" aria-label="Nach oben" ${i === 0 ? 'disabled' : ''}><svg viewBox="0 0 24 24"><path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></svg></button>
          <button class="icon-btn" data-down="${i}" aria-label="Nach unten" ${i === routine.exercises.length - 1 ? 'disabled' : ''}><svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M18 13l-6 6-6-6"/></svg></button>
          <button class="icon-btn" data-remove="${i}" aria-label="Entfernen"><svg viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/></svg></button>
        </div>
      </div>
    `;
  }

  /** Nur noch schreibgeschuetzte Anzeige - Zugehoerigkeit (auch mehrfach
   *  innerhalb derselben Rotation moeglich seit E68) wird ausschliesslich in
   *  der Rotation selbst (Trainingsplan-Ansicht) bearbeitet. */
  function rotationCardHtml() {
    const memberships = rotationsContainingRoutine(routine.id);
    if (!memberships.length) return '';
    return `
      <div class="card">
        <h3>Rotation</h3>
        <p class="faint">${memberships.map(({ rotation, count }) =>
          `Teil von "${escapeHtml(rotation.name)}"${count > 1 ? ` (${count}×)` : ''}`
        ).join(' · ')}</p>
      </div>
    `;
  }

  function modeBadge(re) {
    if (re.mode === 'time') return ' · ⏱ Zeit';
    if (re.mode !== 'cardio') return '';
    const fields = (re.cardioFields || ['duration'])
      .map((k) => cardioFieldDef(k)?.short)
      .filter(Boolean)
      .join('/');
    return ` · 🚴 Cardio (${fields})`;
  }

  function wire() {
    document.getElementById('add-exercise').addEventListener('click', () => {
      openExercisePicker((exerciseId) => {
        routine.exercises.push({
          id: uid(), exerciseId, groupId: null, restSeconds: settings.defaultRest, mode: 'reps', note: '',
          sets: [{ reps: 10, weight: 0 }, { reps: 10, weight: 0 }, { reps: 10, weight: 0 }],
        });
        persist(); draw();
      });
    });
    document.getElementById('delete-routine')?.addEventListener('click', async () => {
      const ok = await confirmDialog('Routine löschen?', 'Diese Routine wird dauerhaft entfernt.');
      if (ok) { deleteRoutine(routine.id); navigate('#/routines'); }
    });
    document.querySelectorAll('[data-configure]').forEach((b) => b.addEventListener('click', () => openConfigure(+b.dataset.configure)));
    document.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => {
      routine.exercises.splice(+b.dataset.remove, 1);
      persist(); draw();
    }));
    document.querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', () => {
      const i = +b.dataset.up;
      if (i === 0) return;
      [routine.exercises[i - 1], routine.exercises[i]] = [routine.exercises[i], routine.exercises[i - 1]];
      persist(); draw();
    }));
    document.querySelectorAll('[data-down]').forEach((b) => b.addEventListener('click', () => {
      const i = +b.dataset.down;
      if (i >= routine.exercises.length - 1) return;
      [routine.exercises[i + 1], routine.exercises[i]] = [routine.exercises[i], routine.exercises[i + 1]];
      persist(); draw();
    }));
    document.querySelectorAll('[data-group]').forEach((b) => b.addEventListener('click', () => {
      const i = +b.dataset.group;
      toggleGroup(i);
      persist(); draw();
    }));
  }

  function toggleGroup(i) {
    const cur = routine.exercises[i];
    const prev = routine.exercises[i - 1];
    if (cur.groupId && cur.groupId === prev.groupId) {
      // trennen: eigene neue (leere) Gruppen-Kennung entfernen
      cur.groupId = null;
      // falls die vorherige Gruppe dadurch nur noch aus "prev" besteht, ebenfalls aufloesen
      const stillGrouped = routine.exercises.some((e, idx) => idx !== i - 1 && e.groupId === prev.groupId);
      if (!stillGrouped) prev.groupId = null;
    } else {
      if (!prev.groupId) prev.groupId = uid();
      cur.groupId = prev.groupId;
    }
  }

  function openConfigure(i) {
    const re = routine.exercises[i];
    re.mode = re.mode || 'reps';
    ensureSlotAlternatives(re);
    let activeIdx = 0;
    let alt = re.alternatives[activeIdx];

    const handle = openModal(headerHtml() + bodyHtml(), {});
    wireAll();

    function headerHtml() {
      const ex = getExerciseById(alt.exerciseId);
      return `<h3 class="modal-title">${escapeHtml(ex?.name || 'Übung')}</h3>`;
    }

    function altTabsHtml() {
      return `
        <div class="field">
          <label>Alternative Übungen <span class="faint">(im Training seitlich wechselbar, ganz links = Standard)</span></label>
          <div class="chip-row" id="cfg-alt-row">
            ${re.alternatives.map((a, ai) => `
              <button class="chip ${ai === activeIdx ? 'active' : ''}" data-alt-tab="${ai}">${escapeHtml(getExerciseById(a.exerciseId)?.name || 'Übung')}</button>
            `).join('')}
            <button class="chip" id="cfg-alt-add">+ Alternative</button>
          </div>
          ${re.alternatives.length > 1 ? `<button class="btn btn-ghost btn-sm" id="cfg-alt-remove" style="margin-top:8px">"${escapeHtml(getExerciseById(alt.exerciseId)?.name || '')}" als Alternative entfernen</button>` : ''}
        </div>
      `;
    }

    function bodyHtml() {
      return `
        ${altTabsHtml()}
        <div class="field">
          <label>Art der Erfassung</label>
          <div class="chip-row" id="cfg-mode-row">
            <button class="chip ${alt.mode === 'reps' ? 'active' : ''}" data-mode="reps">Gewicht × Wdh.</button>
            <button class="chip ${alt.mode === 'time' ? 'active' : ''}" data-mode="time">Zeit</button>
            <button class="chip ${alt.mode === 'cardio' ? 'active' : ''}" data-mode="cardio">Cardio</button>
          </div>
        </div>
        <div class="field" id="cfg-cardio-fields" style="${alt.mode === 'cardio' ? '' : 'display:none'}">
          <label>Welche Werte willst du erfassen?</label>
          <div class="chip-row" id="cfg-cardio-row"></div>
        </div>
        <div class="field">
          <label>Pause zwischen Sätzen (Sekunden) <span class="faint">(gilt für den Slot, alle Alternativen)</span></label>
          <input class="input" type="number" inputmode="numeric" id="cfg-rest" value="${re.restSeconds}" min="0" step="5">
        </div>
        <div class="field">
          <label>Hinweis (optional, z.B. "pro Seite", Zielbereich, bpm)</label>
          <textarea class="input" id="cfg-note" placeholder="z.B. ca. 140 bpm">${escapeHtml(alt.note || '')}</textarea>
        </div>
        <label id="cfg-sets-label" style="font-size:.8rem;font-weight:600;color:var(--text-dim)"></label>
        <div class="stack" id="cfg-sets" style="margin:8px 0 14px"></div>
        <button class="btn btn-ghost btn-sm" id="cfg-add-set">+ Satz</button>
        <button class="btn btn-primary" id="cfg-save" style="margin-top:16px">Fertig</button>
      `;
    }

    function rerenderBody() {
      handle.sheet.innerHTML = '<div class="modal-handle"></div>' + headerHtml() + bodyHtml();
      wireAll();
    }

    function activeCardioFields() {
      return (alt.cardioFields || ['duration']);
    }

    function setsLabel() {
      if (alt.mode === 'cardio') {
        return `Zielwerte je Satz (${activeCardioFields().map((k) => cardioFieldDef(k).label).join(', ')})`;
      }
      return alt.mode === 'time'
        ? `Sätze (Dauer in Minuten × Gewicht in ${settings.units}, optional)`
        : `Sätze (Ziel-Wdh. × Gewicht in ${settings.units})`;
    }

    /** Ein Eingabefeld je aktivierter Cardio-Kennzahl. */
    function cardioInputsHtml(s, si) {
      return activeCardioFields().map((key) => {
        const def = cardioFieldDef(key);
        const value = key === 'duration' ? (s.seconds || 0) / 60 : (s[key] ?? '');
        return `<input class="input input-num" type="number" inputmode="decimal"
                  step="${key === 'duration' ? '0.5' : def.decimals === 0 ? '1' : '0.1'}" min="0"
                  value="${value}" data-field="${key === 'duration' ? 'minutes' : key}"
                  data-set="${si}" placeholder="${def.short}" title="${def.label} (${def.unit})">`;
      }).join('');
    }

    function drawSets() {
      handle.sheet.querySelector('#cfg-sets-label').textContent = setsLabel();
      const wrap = handle.sheet.querySelector('#cfg-sets');
      const removeBtn = (si) => `<button class="icon-btn" data-remove-set="${si}" aria-label="Satz entfernen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg></button>`;

      wrap.innerHTML = alt.sets.map((s, si) => {
        if (alt.mode === 'cardio') {
          return `
            <div class="col" style="gap:6px" data-set="${si}">
              <span class="faint">Satz ${si + 1}</span>
              <div class="row" style="gap:8px; flex-wrap:wrap">
                ${cardioInputsHtml(s, si)}
                ${removeBtn(si)}
              </div>
            </div>
          `;
        }
        if (alt.mode === 'time') {
          return `
            <div class="row" style="gap:8px" data-set="${si}">
              <span class="faint" style="width:44px">Satz ${si + 1}</span>
              <input class="input input-num" type="number" inputmode="decimal" step="0.5" min="0" value="${(s.seconds || 0) / 60}" data-field="minutes" data-set="${si}" placeholder="Min.">
              <input class="input input-num" type="number" inputmode="decimal" value="${s.weight || 0}" data-field="weight" data-set="${si}" placeholder="${settings.units}">
              ${removeBtn(si)}
            </div>
          `;
        }
        return `
          <div class="row" style="gap:8px" data-set="${si}">
            <span class="faint" style="width:44px">Satz ${si + 1}</span>
            <input class="input input-num" type="number" inputmode="numeric" value="${s.reps}" data-field="reps" data-set="${si}" placeholder="Wdh.">
            <input class="input input-num" type="number" inputmode="decimal" value="${s.weight}" data-field="weight" data-set="${si}" placeholder="${settings.units}">
            ${removeBtn(si)}
          </div>
        `;
      }).join('');

      wrap.querySelectorAll('input').forEach((inp) => inp.addEventListener('input', () => {
        const si = +inp.dataset.set;
        if (inp.dataset.field === 'minutes') {
          alt.sets[si].seconds = Math.round((Number(inp.value) || 0) * 60);
        } else if (inp.value === '') {
          delete alt.sets[si][inp.dataset.field];
        } else {
          alt.sets[si][inp.dataset.field] = Number(inp.value) || 0;
        }
      }));
      wrap.querySelectorAll('[data-remove-set]').forEach((b) => b.addEventListener('click', () => {
        if (alt.sets.length <= 1) { toast('Mindestens ein Satz nötig'); return; }
        alt.sets.splice(+b.dataset.removeSet, 1);
        drawSets();
      }));
    }

    function drawCardioFieldPicker() {
      const row = handle.sheet.querySelector('#cfg-cardio-row');
      const active = activeCardioFields();
      row.innerHTML = CARDIO_FIELDS.map((f) => `
        <button class="chip ${active.includes(f.key) ? 'active' : ''} ${f.always ? 'chip--locked' : ''}"
                data-cardio-field="${f.key}" ${f.always ? 'disabled' : ''}>${f.label}</button>
      `).join('');
      row.querySelectorAll('[data-cardio-field]').forEach((b) => b.addEventListener('click', () => {
        const key = b.dataset.cardioField;
        const list = activeCardioFields();
        alt.cardioFields = list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
        // Reihenfolge stabil halten, damit die Spalten nicht springen
        alt.cardioFields = CARDIO_FIELDS.filter((f) => alt.cardioFields.includes(f.key)).map((f) => f.key);
        drawCardioFieldPicker();
        drawSets();
      }));
    }

    function wireAll() {
      drawCardioFieldPicker();
      drawSets();

      handle.sheet.querySelectorAll('[data-alt-tab]').forEach((b) => b.addEventListener('click', () => {
        activeIdx = +b.dataset.altTab;
        alt = re.alternatives[activeIdx];
        rerenderBody();
      }));
      handle.sheet.querySelector('#cfg-alt-add').addEventListener('click', () => {
        openExercisePicker((exerciseId) => {
          addSlotAlternative(re, exerciseId, 'reps');
          activeIdx = re.alternatives.length - 1;
          alt = re.alternatives[activeIdx];
          rerenderBody();
        });
      });
      handle.sheet.querySelector('#cfg-alt-remove')?.addEventListener('click', async () => {
        const ok = await confirmDialog('Alternative entfernen?', 'Diese Alternative wird aus dem Slot entfernt.', 'Entfernen', true);
        if (!ok) return;
        removeSlotAlternative(re, activeIdx);
        activeIdx = Math.min(activeIdx, re.alternatives.length - 1);
        alt = re.alternatives[activeIdx];
        rerenderBody();
      });

      handle.sheet.querySelectorAll('[data-mode]').forEach((btn) => btn.addEventListener('click', () => {
        if (alt.mode === btn.dataset.mode) return;
        alt.mode = btn.dataset.mode;
        if (alt.mode === 'cardio') {
          alt.cardioFields = alt.cardioFields || ['duration'];
          alt.sets = alt.sets.map((s) => ({ seconds: s.seconds ?? 600 }));
        } else if (alt.mode === 'time') {
          alt.sets = alt.sets.map((s) => ({ seconds: s.seconds ?? 60, weight: s.weight ?? 0 }));
        } else {
          alt.sets = alt.sets.map((s) => ({ reps: s.reps ?? 10, weight: s.weight ?? 0 }));
        }
        handle.sheet.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === alt.mode));
        handle.sheet.querySelector('#cfg-cardio-fields').style.display = alt.mode === 'cardio' ? '' : 'none';
        drawCardioFieldPicker();
        drawSets();
      }));

      handle.sheet.querySelector('#cfg-add-set').addEventListener('click', () => {
        const last = alt.sets[alt.sets.length - 1];
        let fresh;
        if (alt.mode === 'cardio') fresh = { ...(last || { seconds: 600 }) };
        else if (alt.mode === 'time') fresh = { seconds: last?.seconds ?? 60, weight: last?.weight ?? 0 };
        else fresh = { reps: last?.reps ?? 10, weight: last?.weight ?? 0 };
        alt.sets.push(fresh);
        drawSets();
      });
      handle.sheet.querySelector('#cfg-rest').addEventListener('input', (e) => { re.restSeconds = Number(e.target.value) || 0; });
      handle.sheet.querySelector('#cfg-note').addEventListener('input', (e) => { alt.note = e.target.value; });
      handle.sheet.querySelector('#cfg-save').addEventListener('click', () => {
        syncSlotMirror(re, 0); // Routine zeigt immer die ganz linke (erste) Alternative als Standard
        persist(); draw(); handle.close();
      });
    }
  }

  document.getElementById('rename-routine').addEventListener('click', async () => {
    const name = await promptDialog('Routine umbenennen', { value: routine.name, confirmLabel: 'Speichern' });
    if (name) { routine.name = name; persist(); draw(); }
  });

  draw();
}
