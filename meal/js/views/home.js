import { setTitle, setActions, setBack } from '../router.js';
import {
  getRecipes, getRecipeById, getMealPlanForDate, addMealSlotEntry, setMealSlotEntryServings, removeMealSlotEntry,
  dayNutrition, MEALS, getSettings,
  targetKcalForDate, getActiveDiet, dietStatusForDate, costForRange, applyRecurringRules, getSharedGroceryComparison,
} from '../db.js';
import { openModal, toast } from '../ui.js';
import { todayKey, addDaysToDateKey, mondayOfWeekKey, formatDateKey, formatNum, formatMoney, escapeHtml } from '../utils.js';

let cursor = mondayOfWeekKey(todayKey());

export function render() {
  setTitle('Wochenplan');
  setBack(null);
  setActions('');
  draw();
}

async function draw() {
  const view = document.getElementById('view');
  const days = Array.from({ length: 7 }, (_, i) => addDaysToDateKey(cursor, i));
  const today = todayKey();
  const activeDiet = getActiveDiet();

  const dayCards = await Promise.all(days.map(async (date) => {
    const entries = getMealPlanForDate(date);
    const totals = await dayNutrition(date);
    const target = targetKcalForDate(date);
    const targetLine = target
      ? ` <span class="faint">/ ${formatNum(target)} kcal Ziel</span>`
      : '';

    const slots = MEALS.map((m) => {
      const slotEntries = entries.filter((e) => e.meal === m.key);
      const names = slotEntries.map((e) => {
        const recipe = getRecipeById(e.recipeId);
        const name = recipe ? escapeHtml(recipe.name) : 'Gelöschtes Rezept';
        return e.servings > 1 ? `${name} ×${e.servings}` : name;
      });
      return `
        <div class="meal-slot" data-day="${date}" data-meal="${m.key}">
          <span class="meal-slot__label">${m.label}</span>
          <span class="meal-slot__content">
            ${names.length ? names.join(', ') : '<span class="meal-slot__empty">+ Rezept wählen</span>'}
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

  const weekEnd = addDaysToDateKey(cursor, 6);
  const { total: weekCostTotal, missingCount } = costForRange(cursor, weekEnd);
  const grocery = getSharedGroceryComparison();
  const groceryIsThisMonth = grocery && grocery.month === todayKey().slice(0, 7);

  view.innerHTML = `
    <div class="row row--between week-nav">
      <button class="icon-btn" id="week-prev" aria-label="Vorige Woche"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
      <button class="chip" id="week-today">Diese Woche</button>
      <button class="icon-btn" id="week-next" aria-label="Nächste Woche"><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>
    </div>
    ${activeDiet ? dietBannerHtml(activeDiet) : ''}
    <div class="card row row--between" style="margin-bottom:14px">
      <div class="col">
        <span>Kosten diese Woche</span>
        <span class="faint">${weekCostTotal > 0 ? formatMoney(weekCostTotal) : '–'}${missingCount ? ` · ${missingCount} Zutat${missingCount === 1 ? '' : 'en'} ohne Preis` : ''}</span>
      </div>
      <button class="btn btn-ghost btn-sm" id="auto-plan">🔁 Automatisch planen</button>
    </div>
    ${groceryIsThisMonth ? `
      <p class="faint" style="margin:-6px 0 14px">Budget Lebensmittel diesen Monat: ${formatMoney(grocery.amount)}</p>
    ` : ''}
    ${dayCards.join('')}
  `;

  document.getElementById('week-prev').addEventListener('click', () => { cursor = addDaysToDateKey(cursor, -7); draw(); });
  document.getElementById('week-next').addEventListener('click', () => { cursor = addDaysToDateKey(cursor, 7); draw(); });
  document.getElementById('week-today').addEventListener('click', () => { cursor = mondayOfWeekKey(todayKey()); draw(); });
  document.getElementById('auto-plan').addEventListener('click', () => {
    const filled = applyRecurringRules(cursor);
    toast(filled > 0 ? `${filled} Slot${filled === 1 ? '' : 's'} automatisch geplant` : 'Keine leeren Slots mit passender Regel gefunden');
    draw();
  });
  view.querySelectorAll('[data-day]').forEach((el) => {
    el.addEventListener('click', () => openSlotModal(el.dataset.day, el.dataset.meal));
  });
}

function dietBannerHtml(diet) {
  const status = dietStatusForDate(diet, todayKey());
  return `
    <div class="card" style="margin-bottom:14px">
      <div class="row row--between">
        <span>${escapeHtml(diet.name)}</span>
        <span class="faint">Woche ${status.week}/${status.totalWeeks}${status.finished ? ' · beendet' : ''}</span>
      </div>
      <p class="faint" style="margin-top:4px">Aktuelles Ziel: ${formatNum(status.targetKcal)} kcal/Tag</p>
    </div>
  `;
}

/** Ein Slot kann mehrere Rezepte tragen (E68+-Nachtrag) - bestehende Eintraege
 *  lassen sich per Mengen-Stepper anpassen (0 entfernt den Eintrag) oder
 *  einzeln entfernen, darunter eine Liste aller Rezepte zum Hinzufuegen
 *  (fuegt dasselbe Rezept erneut hinzu -> erhoeht nur dessen Menge, siehe
 *  addMealSlotEntry). */
function openSlotModal(date, meal) {
  const recipes = getRecipes();
  const mealLabel = MEALS.find((m) => m.key === meal)?.label || meal;

  if (!recipes.length) {
    toast('Noch keine Rezepte vorhanden - lege zuerst eins an.');
    return;
  }

  const handle = openModal(`
    <h3 class="modal-title">${mealLabel} · ${formatDateKey(date, { withWeekday: true })}</h3>
    <div class="stack" id="slot-entries" style="margin-bottom:14px"></div>
    <div class="section-title" style="margin-top:0">Rezept hinzufügen</div>
    <div class="stack">
      ${recipes.map((r) => `<button class="btn btn-ghost" data-pick="${r.id}">${escapeHtml(r.name)}</button>`).join('')}
    </div>
  `, { center: true });

  function drawEntries() {
    const entries = getMealPlanForDate(date).filter((e) => e.meal === meal);
    const wrap = handle.sheet.querySelector('#slot-entries');
    wrap.innerHTML = entries.length ? entries.map((e) => {
      const recipe = getRecipeById(e.recipeId);
      return `
        <div class="row row--between">
          <span class="grow truncate">${escapeHtml(recipe?.name || 'Gelöschtes Rezept')}</span>
          <div class="row" style="gap:0">
            <button type="button" class="icon-btn" data-qty="${e.id}:-1" aria-label="Weniger"><svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg></button>
            <span style="min-width:22px;text-align:center">${e.servings}</span>
            <button type="button" class="icon-btn" data-qty="${e.id}:1" aria-label="Mehr"><svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M5 12h14"/></svg></button>
            <button type="button" class="icon-btn" data-remove="${e.id}" aria-label="Entfernen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
          </div>
        </div>
      `;
    }).join('') : '<p class="faint">Noch nichts geplant.</p>';

    wrap.querySelectorAll('[data-qty]').forEach((b) => b.addEventListener('click', () => {
      const [entryId, delta] = b.dataset.qty.split(':');
      const entry = getMealPlanForDate(date).find((e) => e.id === entryId);
      if (!entry) return;
      setMealSlotEntryServings(entryId, entry.servings + Number(delta));
      drawEntries();
      draw();
    }));
    wrap.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => {
      removeMealSlotEntry(b.dataset.remove);
      drawEntries();
      draw();
    }));
  }
  drawEntries();

  handle.sheet.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
    addMealSlotEntry(date, meal, b.dataset.pick, 1);
    drawEntries();
    draw();
  }));
}
