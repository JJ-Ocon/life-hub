import { setTitle, setActions, setBack } from '../router.js';
import {
  getRecipes, getRecipeById, getMealPlanForDate, setMealSlot, dayNutrition, MEALS, getSettings,
} from '../db.js';
import { openModal, toast } from '../ui.js';
import { todayKey, addDaysToDateKey, mondayOfWeekKey, formatDateKey, formatNum, escapeHtml } from '../utils.js';

let cursor = mondayOfWeekKey(todayKey());

export function render() {
  setTitle('Wochenplan');
  setBack(null);
  setActions('');
  draw();
}

async function draw() {
  const view = document.getElementById('view');
  const settings = getSettings();
  const days = Array.from({ length: 7 }, (_, i) => addDaysToDateKey(cursor, i));
  const today = todayKey();

  const dayCards = await Promise.all(days.map(async (date) => {
    const entries = getMealPlanForDate(date);
    const totals = await dayNutrition(date);
    const targetLine = settings.targetKcal
      ? ` <span class="faint">/ ${formatNum(settings.targetKcal)} kcal Ziel</span>`
      : '';

    const slots = MEALS.map((m) => {
      const entry = entries.find((e) => e.meal === m.key);
      const recipe = entry ? getRecipeById(entry.recipeId) : null;
      return `
        <div class="meal-slot" data-day="${date}" data-meal="${m.key}">
          <span class="meal-slot__label">${m.label}</span>
          <span class="meal-slot__content">
            ${recipe ? escapeHtml(recipe.name) : '<span class="meal-slot__empty">+ Rezept wählen</span>'}
          </span>
        </div>
      `;
    }).join('');

    return `
      <div class="card day-card">
        <div class="row row--between day-card__head">
          <h3>${formatDateKey(date, { withWeekday: true })}${date === today ? ' · heute' : ''}</h3>
          <span class="faint">${formatNum(totals.kcal)} kcal${targetLine}</span>
        </div>
        ${slots}
      </div>
    `;
  }));

  view.innerHTML = `
    <div class="row row--between week-nav">
      <button class="icon-btn" id="week-prev" aria-label="Vorige Woche"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
      <button class="chip" id="week-today">Diese Woche</button>
      <button class="icon-btn" id="week-next" aria-label="Nächste Woche"><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>
    </div>
    ${dayCards.join('')}
  `;

  document.getElementById('week-prev').addEventListener('click', () => { cursor = addDaysToDateKey(cursor, -7); draw(); });
  document.getElementById('week-next').addEventListener('click', () => { cursor = addDaysToDateKey(cursor, 7); draw(); });
  document.getElementById('week-today').addEventListener('click', () => { cursor = mondayOfWeekKey(todayKey()); draw(); });
  view.querySelectorAll('[data-day]').forEach((el) => {
    el.addEventListener('click', () => openSlotModal(el.dataset.day, el.dataset.meal));
  });
}

function openSlotModal(date, meal) {
  const recipes = getRecipes();
  const mealLabel = MEALS.find((m) => m.key === meal)?.label || meal;

  if (!recipes.length) {
    toast('Noch keine Rezepte vorhanden - lege zuerst eins an.');
    return;
  }

  const handle = openModal(`
    <h3 class="modal-title">${mealLabel} · ${formatDateKey(date, { withWeekday: true })}</h3>
    <div class="stack">
      ${recipes.map((r) => `<button class="btn btn-ghost" data-pick="${r.id}">${escapeHtml(r.name)}</button>`).join('')}
      <button class="btn btn-danger" data-clear>Slot leeren</button>
    </div>
  `, { center: true });

  handle.sheet.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
    setMealSlot(date, meal, b.dataset.pick, 1);
    handle.close();
    draw();
  }));
  handle.sheet.querySelector('[data-clear]').addEventListener('click', () => {
    setMealSlot(date, meal, null);
    handle.close();
    draw();
  });
}
