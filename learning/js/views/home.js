import { setTitle, setActions, setBack } from '../router.js';
import { getSkills, categoryLabel, weeklyMinutes, currentStreak } from '../db.js';
import { escapeHtml } from '../utils.js';
import { openLogSessionModal } from './skills.js';

export function render() {
  setTitle('Diese Woche');
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
        <p class="faint">Lege unter "Skills" eine Fähigkeit an, die du üben willst.</p>
      </div>
    ` : skills.map((s) => {
      const week = weeklyMinutes(s.id);
      const target = s.targetMinutesPerWeek;
      const pct = target ? Math.min(100, Math.round((week / target) * 100)) : null;
      const streak = currentStreak(s.id);
      return `
        <div class="card">
          <div class="row row--between">
            <div class="col grow" style="min-width:0">
              <p class="due-row__title truncate">${escapeHtml(s.name)}</p>
              <p class="due-row__meta">${escapeHtml(categoryLabel(s.category))}${streak > 0 ? ` · 🔥 ${streak} Tage` : ''}</p>
            </div>
            <button class="btn btn-sm btn-primary" data-log="${s.id}">+ Loggen</button>
          </div>
          ${target ? `
            <div style="margin-top:10px">
              <p class="faint" style="margin-bottom:6px">${week} / ${target} Min. diese Woche</p>
              <div class="pbar"><div class="pbar__fill" style="width:${pct}%"></div></div>
            </div>
          ` : `<p class="faint" style="margin-top:10px">${week} Min. diese Woche</p>`}
        </div>
      `;
    }).join('')}
  `;

  view.querySelectorAll('[data-log]').forEach((el) => {
    el.addEventListener('click', () => openLogSessionModal(el.dataset.log, draw));
  });
}
