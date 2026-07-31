import { setTitle, setActions, setBack } from '../router.js';
import { getSessions, getSessionById, deleteSession, saveFinishedSession, sessionVolume, getSettings, RECOVERY_LEVELS } from '../db.js';
import { formatDate, formatDuration, formatNum, escapeHtml } from '../utils.js';
import { confirmDialog, openModal, promptDialog, toast } from '../ui.js';

export function renderList() {
  setTitle('Trainingsverlauf');
  setActions('');
  setBack(null);
  const sessions = getSessions().filter((s) => s.endedAt);
  const settings = getSettings();

  document.getElementById('view').innerHTML = sessions.length === 0 ? `
    <div class="empty">
      <svg viewBox="0 0 24 24"><path d="M5 19V10"/><path d="M12 19V5"/><path d="M19 19v-6"/></svg>
      <h3>Noch keine Workouts</h3>
      <p>Abgeschlossene Trainings erscheinen hier.</p>
    </div>
  ` : `
    <div class="stack">
      ${sessions.map((s) => `
        <div class="card card--tap row row--between" data-open="${s.id}">
          <div class="col grow">
            <h3 class="truncate">${escapeHtml(s.routineName)}</h3>
            <p class="faint">${formatDate(s.startedAt, { withWeekday: true, withYear: true })} · ${formatDuration((new Date(s.endedAt) - new Date(s.startedAt)) / 1000)}</p>
          </div>
          <div class="badge">${formatNum(sessionVolume(s), 0)} ${settings.units}</div>
        </div>
      `).join('')}
    </div>
  `;

  document.querySelectorAll('[data-open]').forEach((c) => c.addEventListener('click', () => location.hash = `#/history/${c.dataset.open}`));
}

export function renderDetail({ id }) {
  const session = getSessionById(id);
  if (!session) { location.hash = '#/stats'; return; }
  const settings = getSettings();

  setBack(() => { location.hash = '#/history'; });
  setTitle(session.routineName);
  setActions(`<button class="icon-btn" id="del-session" aria-label="Löschen"><svg viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/></svg></button>`);

  function draw() {
    const volume = sessionVolume(session);
    const durationSec = (new Date(session.endedAt) - new Date(session.startedAt)) / 1000;

    document.getElementById('view').innerHTML = `
      <div class="row row--between" style="margin-bottom:14px">
        <p class="faint">${formatDate(session.startedAt, { withWeekday: true, withYear: true })}</p>
        <button class="icon-btn" id="edit-date" aria-label="Datum ändern"><svg viewBox="0 0 24 24"><path d="M4 20h4L18 10l-4-4L4 16v4z"/></svg></button>
      </div>
      <div class="grid-3" style="margin-bottom:18px">
        <div class="stat-tile"><div class="stat-tile__value">${formatDuration(durationSec)}</div><div class="stat-tile__label">Dauer</div></div>
        <div class="stat-tile"><div class="stat-tile__value">${formatNum(volume, 0)}</div><div class="stat-tile__label">Volumen (${settings.units})</div></div>
        <div class="stat-tile"><div class="stat-tile__value">${session.exercises.reduce((n, e) => n + e.sets.filter((s) => s.done).length, 0)}</div><div class="stat-tile__label">Sätze</div></div>
      </div>

      ${session.recovery ? `
        <div class="card row row--between">
          <div class="col grow">
            <h3>Erholung</h3>
            <p class="faint">${recoveryLabel(session.recovery.level)}</p>
          </div>
        </div>
      ` : ''}

      <div class="card" id="session-comment-card">
        <div class="row row--between">
          <h3>Notiz zum Workout</h3>
          <button class="icon-btn" id="edit-session-comment" aria-label="Notiz bearbeiten"><svg viewBox="0 0 24 24"><path d="M4 20h4L18 10l-4-4L4 16v4z"/></svg></button>
        </div>
        <p class="${session.comment ? '' : 'faint'}" style="margin-top:6px; white-space:pre-wrap">${session.comment ? escapeHtml(session.comment) : 'Noch keine Notiz – tippe auf den Stift, um eine hinzuzufügen.'}</p>
      </div>

      <div class="stack">
        ${session.exercises.map((ex, i) => `
          <div class="card">
            <div class="row row--between">
              <h3 style="margin-bottom:8px">${escapeHtml(ex.exerciseName)}</h3>
              <button class="icon-btn" data-edit-ex-comment="${i}" aria-label="Notiz zur Übung" style="${ex.comment ? 'color:var(--accent)' : ''}">
                <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              </button>
            </div>
            ${ex.note ? `<p class="exercise-note" style="margin-bottom:8px">${escapeHtml(ex.note)}</p>` : ''}
            <table class="set-table">
              <thead><tr>
                <th>Satz</th>
                <th>${ex.mode === 'time' ? 'Zeit' : 'Wdh.'}</th>
                <th>${settings.units}</th>
                ${hasRpe(ex) ? '<th>RPE</th>' : ''}
                <th>✓</th>
              </tr></thead>
              <tbody>
                ${ex.sets.map((s, si) => `
                  <tr class="set-row ${s.done ? 'done' : ''}">
                    <td class="set-num">${si + 1}${s.isWarmup ? ' <span class="faint">W</span>' : ''}</td>
                    <td>${ex.mode === 'time' ? formatDuration(s.seconds || 0) : s.reps}</td>
                    <td>${formatNum(s.weight)}</td>
                    ${hasRpe(ex) ? `<td>${s.rpe || '–'}</td>` : ''}
                    <td>${s.done ? '✓' : '–'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
            ${ex.comment ? `<p class="faint" style="margin-top:8px; white-space:pre-wrap">${escapeHtml(ex.comment)}</p>` : ''}
          </div>
        `).join('')}
      </div>
    `;
    wire();
  }

  function wire() {
    document.getElementById('edit-session-comment').addEventListener('click', () => {
      openCommentEditor('Notiz zum Workout', session.comment, (val) => {
        session.comment = val;
        saveFinishedSession(session);
        draw();
      });
    });
    document.querySelectorAll('[data-edit-ex-comment]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ex = session.exercises[+btn.dataset.editExComment];
        openCommentEditor(`Notiz · ${ex.exerciseName}`, ex.comment, (val) => {
          ex.comment = val;
          saveFinishedSession(session);
          draw();
        });
      });
    });
    document.getElementById('edit-date').addEventListener('click', async () => {
      const currentKey = session.startedAt.slice(0, 10);
      const input = await promptDialog('Datum ändern (JJJJ-MM-TT)', { value: currentKey, placeholder: '2026-07-25' });
      if (!input) return;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) { toast('Ungültiges Datum'); return; }
      const delta = new Date(input) - new Date(currentKey);
      if (Number.isNaN(delta)) { toast('Ungültiges Datum'); return; }
      session.startedAt = new Date(new Date(session.startedAt).getTime() + delta).toISOString();
      session.endedAt = new Date(new Date(session.endedAt).getTime() + delta).toISOString();
      saveFinishedSession(session);
      toast('Datum aktualisiert');
      draw();
    });
  }

  document.getElementById('del-session').addEventListener('click', async () => {
    const ok = await confirmDialog('Workout löschen?', 'Dieses Training wird dauerhaft aus dem Verlauf entfernt.');
    if (ok) { deleteSession(id); location.hash = '#/history'; }
  });

  draw();
}

function hasRpe(ex) {
  return ex.mode !== 'time' && ex.sets.some((s) => s.rpe);
}

function recoveryLabel(level) {
  const entry = RECOVERY_LEVELS.find((l) => l.key === level);
  return entry ? `${entry.label} – ${entry.hint}` : level;
}

function openCommentEditor(title, value, onSave) {
  const handle = openModal(`
    <h3 class="modal-title">${escapeHtml(title)}</h3>
    <textarea class="input" id="comment-editor-input" style="min-height:100px; margin-bottom:16px">${escapeHtml(value || '')}</textarea>
    <div class="row" style="gap:10px">
      <button class="btn btn-ghost" data-close-modal>Abbrechen</button>
      <button class="btn btn-primary" id="comment-editor-save">Speichern</button>
    </div>
  `, { center: true });
  handle.sheet.querySelector('#comment-editor-save').addEventListener('click', () => {
    onSave(handle.sheet.querySelector('#comment-editor-input').value.trim());
    handle.close();
  });
}
