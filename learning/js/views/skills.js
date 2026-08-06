import { setTitle, setActions, setBack } from '../router.js';
import {
  getSkills, getSkillById, createSkill, saveSkill, deleteSkill, categoryLabel, CATEGORIES,
  getSessions, logSession, deleteSession, weeklyMinutes, totalMinutes, currentStreak,
} from '../db.js';
import { openModal, confirmDialog, toast } from '../ui.js';
import { todayKey, formatDateKey, escapeHtml } from '../utils.js';

export function render() {
  setTitle('Skills');
  setBack(null);
  setActions('');
  draw();
}

function draw() {
  const view = document.getElementById('view');
  const skills = getSkills();
  view.innerHTML = `
    ${skills.length === 0 ? `
      <div class="empty">
        <h3>Noch keine Skills</h3>
        <p class="faint">Lege eine Sprache, ein Instrument oder eine andere Fähigkeit an, die du üben willst.</p>
      </div>
    ` : `
      <div class="card">
        ${skills.map((s) => `
          <div class="due-row" data-open="${s.id}" style="cursor:pointer">
            <div class="col grow" style="min-width:0">
              <p class="due-row__title truncate">${escapeHtml(s.name)}</p>
              <p class="due-row__meta">${escapeHtml(categoryLabel(s.category))} · ${Math.round(totalMinutes(s.id) / 60)} Std. gesamt</p>
            </div>
          </div>
        `).join('')}
      </div>
    `}
    <button class="btn btn-primary" id="skill-add" style="margin-top:16px">+ Skill</button>
  `;
  view.querySelectorAll('[data-open]').forEach((el) => {
    el.addEventListener('click', () => openSkillDetail(getSkillById(el.dataset.open)));
  });
  document.getElementById('skill-add').addEventListener('click', () => openSkillModal(null, draw));
}

export function openSkillModal(existing, onSaved) {
  const isNew = !existing;
  const handle = openModal(`
    <h3 class="modal-title">${isNew ? 'Skill anlegen' : 'Skill bearbeiten'}</h3>
    <div class="field">
      <label>Name</label>
      <input class="input" id="s-name" value="${escapeHtml(existing?.name || '')}" placeholder="z.B. Spanisch">
    </div>
    <div class="field">
      <label>Kategorie</label>
      <select class="input" id="s-category">
        ${CATEGORIES.map((c) => `<option value="${c.key}" ${existing?.category === c.key ? 'selected' : ''}>${c.label}</option>`).join('')}
      </select>
    </div>
    <div class="field">
      <label>Wochenziel in Minuten (optional)</label>
      <input class="input" type="number" min="0" id="s-target" value="${existing?.targetMinutesPerWeek ?? ''}" placeholder="z.B. 120">
    </div>
    <div class="field">
      <label>Notiz (optional)</label>
      <textarea class="input" id="s-note">${escapeHtml(existing?.note || '')}</textarea>
    </div>
    <div class="stack">
      <button class="btn btn-primary" id="s-save">Speichern</button>
      ${!isNew ? '<button class="btn btn-danger" id="s-delete">Löschen</button>' : ''}
    </div>
  `, { center: true });

  handle.sheet.querySelector('#s-save').addEventListener('click', () => {
    const name = handle.sheet.querySelector('#s-name').value.trim();
    if (!name) { toast('Bitte einen Namen eingeben'); return; }
    const category = handle.sheet.querySelector('#s-category').value;
    const targetMinutesPerWeek = handle.sheet.querySelector('#s-target').value ? Number(handle.sheet.querySelector('#s-target').value) : null;
    const note = handle.sheet.querySelector('#s-note').value.trim();
    if (isNew) createSkill({ name, category, targetMinutesPerWeek, note });
    else saveSkill({ ...existing, name, category, targetMinutesPerWeek, note });
    toast('Gespeichert');
    handle.close();
    onSaved?.();
  });
  handle.sheet.querySelector('#s-delete')?.addEventListener('click', async () => {
    const ok = await confirmDialog('Skill löschen?', 'Der Skill und alle geloggten Übungszeiten werden unwiderruflich gelöscht.');
    if (!ok) return;
    deleteSkill(existing.id);
    toast('Gelöscht');
    handle.close();
    onSaved?.();
  });
}

function openSkillDetail(skill) {
  if (!skill) return;
  draw2(skill);

  function draw2(sk) {
    const sessions = getSessions(sk.id);
    const week = weeklyMinutes(sk.id);
    const target = sk.targetMinutesPerWeek;
    const pct = target ? Math.min(100, Math.round((week / target) * 100)) : null;
    const streak = currentStreak(sk.id);

    const handle = openModal(`
      <h3 class="modal-title">${escapeHtml(sk.name)}</h3>
      <p class="faint" style="margin:-10px 0 14px">${escapeHtml(categoryLabel(sk.category))}${sk.note ? ' · ' + escapeHtml(sk.note) : ''}</p>
      <div class="grid-2" style="margin-bottom:14px">
        <div class="stat-tile">
          <div class="stat-tile__value">${Math.round(totalMinutes(sk.id) / 60)} Std.</div>
          <div class="stat-tile__label">Gesamt geübt</div>
        </div>
        <div class="stat-tile">
          <div class="stat-tile__value">${streak}</div>
          <div class="stat-tile__label">Tage-Streak</div>
        </div>
      </div>
      ${target ? `
        <div class="field">
          <label>Diese Woche: ${week} / ${target} Min.</label>
          <div class="pbar"><div class="pbar__fill" style="width:${pct}%"></div></div>
        </div>
      ` : ''}
      <div class="stack" style="margin-bottom:14px">
        <button class="btn btn-primary" id="d-log">+ Zeit loggen</button>
        <button class="btn btn-ghost" id="d-edit">Skill bearbeiten</button>
      </div>
      <div class="section-title" style="margin-top:6px">Verlauf</div>
      ${sessions.length === 0 ? '<p class="faint">Noch keine Übungszeit geloggt.</p>' : `
        <div class="card">
          ${sessions.map((s) => `
            <div class="due-row">
              <div class="col grow" style="min-width:0">
                <p class="due-row__title">${formatDateKey(s.date)} · ${s.durationMinutes} Min.</p>
                ${s.note ? `<p class="due-row__meta">${escapeHtml(s.note)}</p>` : ''}
              </div>
              <button class="icon-btn" data-del-session="${s.id}" aria-label="Löschen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg></button>
            </div>
          `).join('')}
        </div>
      `}
    `, { center: true });

    handle.sheet.querySelector('#d-log').addEventListener('click', () => {
      openLogSessionModal(sk.id, () => { handle.close(); draw2(sk); refreshBackground(); });
    });
    handle.sheet.querySelector('#d-edit').addEventListener('click', () => {
      handle.close();
      openSkillModal(sk, () => { refreshBackground(); });
    });
    handle.sheet.querySelectorAll('[data-del-session]').forEach((el) => {
      el.addEventListener('click', async () => {
        const ok = await confirmDialog('Eintrag löschen?', 'Wird unwiderruflich gelöscht.');
        if (!ok) return;
        deleteSession(el.dataset.delSession);
        handle.close();
        draw2(sk);
        refreshBackground();
      });
    });
  }

  function refreshBackground() {
    if (document.getElementById('topbar-title')?.textContent === 'Skills') draw();
  }
}

export function openLogSessionModal(skillId, onLogged) {
  const skill = getSkillById(skillId);
  const skills = getSkills();
  const handle = openModal(`
    <h3 class="modal-title">Zeit loggen</h3>
    ${!skillId ? `
      <div class="field">
        <label>Skill</label>
        <select class="input" id="l-skill">
          ${skills.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('')}
        </select>
      </div>
    ` : `<p class="faint" style="margin:-10px 0 14px">${escapeHtml(skill?.name || '')}</p>`}
    <div class="field">
      <label>Datum</label>
      <input class="input" type="date" id="l-date" value="${todayKey()}">
    </div>
    <div class="field">
      <label>Dauer (Minuten)</label>
      <input class="input" type="number" min="1" id="l-duration" value="30">
    </div>
    <div class="field">
      <label>Notiz (optional)</label>
      <textarea class="input" id="l-note"></textarea>
    </div>
    <button class="btn btn-primary" id="l-save">Speichern</button>
  `, { center: true });

  handle.sheet.querySelector('#l-save').addEventListener('click', () => {
    const chosenSkillId = skillId || handle.sheet.querySelector('#l-skill').value;
    if (!chosenSkillId) { toast('Bitte einen Skill wählen'); return; }
    const date = handle.sheet.querySelector('#l-date').value || todayKey();
    const durationMinutes = Number(handle.sheet.querySelector('#l-duration').value) || 0;
    if (durationMinutes <= 0) { toast('Bitte eine Dauer angeben'); return; }
    const note = handle.sheet.querySelector('#l-note').value.trim();
    logSession({ skillId: chosenSkillId, date, durationMinutes, note });
    toast('Geloggt');
    handle.close();
    onLogged?.();
  });
}
