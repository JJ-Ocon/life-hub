import { setTitle, setActions, setBack } from '../router.js';
import {
  getSkills, getSkillById, createSkill, saveSkill, deleteSkill, categoryLabel, getCategories,
  SKILL_TYPES, skillTypeLabel, bookProgress, bookCurrentPage,
  getSessions, logSession, deleteSession, weeklyMinutes, totalMinutes, currentStreak,
} from '../db.js';
import { openModal, confirmDialog, promptDialog, toast } from '../ui.js';
import { todayKey, formatDateKey, formatNum, escapeHtml } from '../utils.js';

let activeCategory = null;

export function render() {
  setTitle('Skills');
  setBack(null);
  setActions('');
  draw();
}

function draw() {
  const view = document.getElementById('view');
  const allSkills = getSkills();
  const categories = getCategories();
  const skills = activeCategory ? allSkills.filter((s) => categoryLabel(s.category) === activeCategory) : allSkills;
  view.innerHTML = `
    ${categories.length > 1 ? `
      <div class="filter-row" style="margin-bottom:14px">
        <button class="chip ${!activeCategory ? 'active' : ''}" data-cat="">Alle</button>
        ${categories.map((c) => `<button class="chip ${activeCategory === c ? 'active' : ''}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('')}
      </div>
    ` : ''}
    ${skills.length === 0 ? `
      <div class="empty">
        <h3>${activeCategory ? 'Keine Skills in dieser Kategorie' : 'Noch keine Skills'}</h3>
        <p class="faint">Lege eine Sprache, ein Instrument, ein Buch, einen Kurs oder eine andere Fähigkeit an, die du übst.</p>
      </div>
    ` : `
      <div class="card">
        ${skills.map((s) => `
          <div class="due-row" data-open="${s.id}" style="cursor:pointer">
            <div class="col grow" style="min-width:0">
              <p class="due-row__title truncate">${escapeHtml(s.name)}</p>
              <p class="due-row__meta">${escapeHtml(categoryLabel(s.category))}${s.type !== 'generic' ? ' · ' + skillTypeLabel(s.type) : ''} · ${Math.round(totalMinutes(s.id) / 60)} Std. gesamt</p>
            </div>
          </div>
        `).join('')}
      </div>
    `}
    <button class="btn btn-primary" id="skill-add" style="margin-top:16px">+ Skill</button>
  `;
  view.querySelectorAll('[data-cat]').forEach((el) => {
    el.addEventListener('click', () => { activeCategory = el.dataset.cat || null; draw(); });
  });
  view.querySelectorAll('[data-open]').forEach((el) => {
    el.addEventListener('click', () => openSkillDetail(getSkillById(el.dataset.open)));
  });
  document.getElementById('skill-add').addEventListener('click', () => openSkillModal(null, draw));
}

export function openSkillModal(existing, onSaved) {
  const isNew = !existing;
  let type = existing?.type || 'generic';
  let category = existing ? categoryLabel(existing.category) : '';
  const categories = getCategories();
  if (category && !categories.includes(category)) categories.push(category);

  const handle = openModal(`
    <h3 class="modal-title">${isNew ? 'Skill anlegen' : 'Skill bearbeiten'}</h3>
    <div class="field">
      <label>Name</label>
      <input class="input" id="s-name" value="${escapeHtml(existing?.name || '')}" placeholder="z.B. Spanisch">
    </div>
    <div class="field">
      <label>Art</label>
      <div class="chip-row" id="type-row">
        ${SKILL_TYPES.map((t) => `<button type="button" class="chip ${type === t.key ? 'active' : ''}" data-type="${t.key}">${t.label}</button>`).join('')}
      </div>
    </div>
    <div class="field">
      <label>Kategorie</label>
      <div class="chip-row" id="category-row">
        ${categories.map((c) => `<button type="button" class="chip ${category === c ? 'active' : ''}" data-category="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('')}
        <button type="button" class="chip" id="category-new">+ Neu</button>
      </div>
    </div>
    <div class="field">
      <label>Wochenziel in Minuten (optional)</label>
      <input class="input" type="number" min="0" id="s-target" value="${existing?.targetMinutesPerWeek ?? ''}" placeholder="z.B. 120">
    </div>
    <div class="field" id="s-book-field" ${type === 'book' ? '' : 'hidden'}>
      <label>Gesamtseitenzahl (optional)</label>
      <input class="input" type="number" min="1" id="s-pages" value="${existing?.totalPages ?? ''}" placeholder="z.B. 320">
    </div>
    <div class="field" id="s-course-field" ${type === 'course' ? '' : 'hidden'}>
      <label>Fortschritt (%)</label>
      <input class="input" type="number" min="0" max="100" id="s-progress" value="${existing?.progressPercent ?? 0}">
    </div>
    <div class="field" id="s-deadline-field" ${type === 'course' ? '' : 'hidden'}>
      <label>Deadline (optional)</label>
      <input class="input" type="date" id="s-deadline" value="${existing?.deadlineDate || ''}">
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

  handle.sheet.querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => {
    type = b.dataset.type;
    handle.sheet.querySelectorAll('[data-type]').forEach((x) => x.classList.toggle('active', x.dataset.type === type));
    handle.sheet.querySelector('#s-book-field').hidden = type !== 'book';
    handle.sheet.querySelector('#s-course-field').hidden = type !== 'course';
    handle.sheet.querySelector('#s-deadline-field').hidden = type !== 'course';
  }));

  function wireCategoryChips() {
    handle.sheet.querySelectorAll('[data-category]').forEach((b) => b.addEventListener('click', () => {
      category = b.dataset.category;
      handle.sheet.querySelectorAll('[data-category]').forEach((x) => x.classList.toggle('active', x.dataset.category === category));
    }));
    handle.sheet.querySelector('#category-new').addEventListener('click', async () => {
      const name = await promptDialog('Neue Kategorie', { placeholder: 'z.B. Backen' });
      if (!name) return;
      category = name;
      if (!categories.includes(name)) categories.push(name);
      handle.sheet.querySelector('#category-row').innerHTML = `
        ${categories.map((c) => `<button type="button" class="chip ${category === c ? 'active' : ''}" data-category="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('')}
        <button type="button" class="chip" id="category-new">+ Neu</button>
      `;
      wireCategoryChips();
    });
  }
  wireCategoryChips();

  handle.sheet.querySelector('#s-save').addEventListener('click', () => {
    const name = handle.sheet.querySelector('#s-name').value.trim();
    if (!name) { toast('Bitte einen Namen eingeben'); return; }
    if (!category) { toast('Bitte eine Kategorie wählen'); return; }
    const targetMinutesPerWeek = handle.sheet.querySelector('#s-target').value ? Number(handle.sheet.querySelector('#s-target').value) : null;
    const totalPages = handle.sheet.querySelector('#s-pages').value ? Number(handle.sheet.querySelector('#s-pages').value) : null;
    const progressPercent = type === 'course' ? Number(handle.sheet.querySelector('#s-progress').value) || 0 : null;
    const deadlineDate = type === 'course' ? (handle.sheet.querySelector('#s-deadline').value || null) : null;
    const note = handle.sheet.querySelector('#s-note').value.trim();
    const fields = { name, category, type, targetMinutesPerWeek, totalPages, progressPercent, deadlineDate, note };
    if (isNew) createSkill(fields);
    else saveSkill({ ...existing, ...fields });
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
    const bProgress = sk.type === 'book' ? bookProgress(sk) : null;
    const bPage = sk.type === 'book' ? bookCurrentPage(sk) : null;

    const handle = openModal(`
      <h3 class="modal-title">${escapeHtml(sk.name)}</h3>
      <p class="faint" style="margin:-10px 0 14px">${escapeHtml(categoryLabel(sk.category))}${sk.type !== 'generic' ? ' · ' + skillTypeLabel(sk.type) : ''}${sk.note ? ' · ' + escapeHtml(sk.note) : ''}</p>
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
      ${sk.type === 'book' ? `
        <div class="field">
          <label>Lesefortschritt${sk.totalPages ? `: ${bPage ?? 0} / ${sk.totalPages} Seiten` : (bPage != null ? `: Seite ${bPage}` : '')}</label>
          ${bProgress !== null ? `<div class="pbar"><div class="pbar__fill" style="width:${Math.round(bProgress * 100)}%"></div></div><p class="faint" style="margin-top:4px">${formatNum(bProgress * 100)}%</p>` : '<p class="faint">Noch keine Seite geloggt.</p>'}
        </div>
      ` : ''}
      ${sk.type === 'course' ? `
        <div class="field">
          <label>Kurs-Fortschritt: ${sk.progressPercent ?? 0}%${sk.deadlineDate ? ` · Deadline ${formatDateKey(sk.deadlineDate)}` : ''}</label>
          <div class="pbar"><div class="pbar__fill" style="width:${sk.progressPercent ?? 0}%"></div></div>
        </div>
      ` : ''}
      ${target ? `
        <div class="field">
          <label>Diese Woche: ${week} / ${target} Min.</label>
          <div class="pbar"><div class="pbar__fill" style="width:${pct}%"></div></div>
        </div>
      ` : ''}
      <div class="stack" style="margin-bottom:14px">
        <button class="btn btn-primary" id="d-log">+ Zeit loggen</button>
        <button class="btn btn-ghost" id="d-edit">Skill bearbeiten</button>
        <button class="btn btn-ghost" id="d-goal">🎯 Als Ziel in Ziele-App anlegen</button>
      </div>
      <div class="section-title" style="margin-top:6px">Verlauf</div>
      ${sessions.length === 0 ? '<p class="faint">Noch keine Übungszeit geloggt.</p>' : `
        <div class="card">
          ${sessions.map((s) => `
            <div class="due-row">
              <div class="col grow" style="min-width:0">
                <p class="due-row__title">${formatDateKey(s.date)} · ${s.durationMinutes} Min.${s.pageAt != null ? ` · Seite ${s.pageAt}` : ''}</p>
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
    handle.sheet.querySelector('#d-goal').addEventListener('click', () => {
      const params = new URLSearchParams({ goalQuickAdd: sk.name });
      location.href = `../goals/#/goals?${params.toString()}`;
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
    <div class="field" id="l-page-field" ${skill?.type === 'book' ? '' : 'hidden'}>
      <label>Seite erreicht (optional)</label>
      <input class="input" type="number" min="1" id="l-page">
    </div>
    <div class="field">
      <label>Notiz (optional)</label>
      <textarea class="input" id="l-note"></textarea>
    </div>
    <button class="btn btn-primary" id="l-save">Speichern</button>
  `, { center: true });

  handle.sheet.querySelector('#l-skill')?.addEventListener('change', (e) => {
    const chosen = getSkillById(e.target.value);
    handle.sheet.querySelector('#l-page-field').hidden = chosen?.type !== 'book';
  });

  handle.sheet.querySelector('#l-save').addEventListener('click', () => {
    const chosenSkillId = skillId || handle.sheet.querySelector('#l-skill').value;
    if (!chosenSkillId) { toast('Bitte einen Skill wählen'); return; }
    const date = handle.sheet.querySelector('#l-date').value || todayKey();
    const durationMinutes = Number(handle.sheet.querySelector('#l-duration').value) || 0;
    if (durationMinutes <= 0) { toast('Bitte eine Dauer angeben'); return; }
    const pageRaw = handle.sheet.querySelector('#l-page').value;
    const pageAt = pageRaw ? Number(pageRaw) : null;
    const note = handle.sheet.querySelector('#l-note').value.trim();
    logSession({ skillId: chosenSkillId, date, durationMinutes, pageAt, note });
    toast('Geloggt');
    handle.close();
    onLogged?.();
  });
}
