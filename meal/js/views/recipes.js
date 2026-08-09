import { setTitle, setActions, setBack } from '../router.js';
import {
  getRecipes, getRecipeById, saveRecipe, createRecipe, deleteRecipe, recipeNutrition, searchFoods, createCustomFood,
} from '../db.js';
import { openModal, confirmDialog, toast } from '../ui.js';
import { escapeHtml, formatNum, uid } from '../utils.js';

export async function render() {
  setTitle('Rezepte');
  setBack(null);
  setActions(`
    <button class="icon-btn" id="recipe-add" aria-label="Rezept anlegen">
      <svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
    </button>
  `);
  await draw();
  document.getElementById('recipe-add').addEventListener('click', () => openRecipeModal(null, draw));
}

async function draw() {
  const recipes = getRecipes();
  const view = document.getElementById('view');

  if (!recipes.length) {
    view.innerHTML = `
      <div class="empty">
        <h3>Noch keine Rezepte</h3>
        <p class="faint">Lege dein erstes Rezept über das Plus oben rechts an.</p>
      </div>
    `;
    return;
  }

  const cards = await Promise.all(recipes.map(async (r) => {
    const { perServing } = await recipeNutrition(r);
    return `
      <div class="card card--tap" data-open="${r.id}" style="margin-bottom:0">
        <div class="row row--between">
          <div class="col grow" style="min-width:0">
            <p class="truncate">${escapeHtml(r.name)}</p>
            <p class="faint">${r.servings} ${r.servings === 1 ? 'Portion' : 'Portionen'} · ${r.ingredients.length} Zutaten</p>
          </div>
          <div class="badge">${formatNum(perServing.kcal)} kcal</div>
        </div>
        <div class="recipe-card__macros">
          <span>P ${formatNum(perServing.protein)} g</span>
          <span>KH ${formatNum(perServing.carbs)} g</span>
          <span>F ${formatNum(perServing.fat)} g</span>
        </div>
      </div>
    `;
  }));

  view.innerHTML = `<div class="stack">${cards.join('')}</div>`;
  view.querySelectorAll('[data-open]').forEach((el) => {
    el.addEventListener('click', () => openRecipeModal(getRecipeById(el.dataset.open), draw));
  });
}

function openRecipeModal(existing, onSaved) {
  const ingredients = existing ? existing.ingredients.map((i) => ({ ...i, _id: uid() })) : [{ _id: uid(), foodName: '', grams: 100 }];

  function content() {
    return `
      <h3 class="modal-title">${existing ? 'Rezept bearbeiten' : 'Rezept anlegen'}</h3>
      <div class="field">
        <label>Name</label>
        <input class="input" id="recipe-name" value="${escapeHtml(existing?.name || '')}" placeholder="z.B. Linsen-Curry">
      </div>
      <div class="field">
        <label>Portionen</label>
        <input class="input" type="number" min="1" step="1" id="recipe-servings" value="${existing?.servings || 2}">
      </div>
      <div class="field">
        <label>Zutaten</label>
        <div id="ingredient-list"></div>
        <button class="btn btn-ghost btn-sm" id="ingredient-add" type="button" style="margin-top:4px">+ Zutat</button>
      </div>
      <div class="field">
        <label>Notiz (optional)</label>
        <textarea class="input" id="recipe-note">${escapeHtml(existing?.note || '')}</textarea>
      </div>
      <p class="faint" id="recipe-summary" style="margin-bottom:14px"></p>
      <div class="stack">
        <button class="btn btn-primary" id="recipe-save">Speichern</button>
        ${existing ? '<button class="btn btn-danger" id="recipe-delete">Löschen</button>' : ''}
      </div>
    `;
  }

  const handle = openModal(content(), { center: true });
  renderIngredients();
  updateSummary();
  wireStatic();

  function wireStatic() {
    handle.sheet.querySelector('#ingredient-add').addEventListener('click', () => {
      ingredients.push({ _id: uid(), foodName: '', grams: 100 });
      renderIngredients();
    });
    handle.sheet.querySelector('#recipe-servings').addEventListener('input', updateSummary);
    handle.sheet.querySelector('#recipe-save').addEventListener('click', onSave);
    handle.sheet.querySelector('#recipe-delete')?.addEventListener('click', onDelete);
  }

  function renderIngredients() {
    const list = handle.sheet.querySelector('#ingredient-list');
    list.innerHTML = ingredients.map((ing) => `
      <div class="ingredient-row" data-row="${ing._id}">
        <div class="food-suggest">
          <input class="input" data-food-input value="${escapeHtml(ing.foodName)}" placeholder="Zutat suchen …" autocomplete="off">
          <div class="food-suggest__list" hidden></div>
        </div>
        <input class="input input-grams" type="number" min="0" step="1" data-grams value="${ing.grams}" placeholder="g">
        <button class="icon-btn" data-remove aria-label="Entfernen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg></button>
      </div>
    `).join('');
    list.querySelectorAll('[data-row]').forEach((row) => wireRow(row));
  }

  function wireRow(row) {
    const id = row.dataset.row;
    const ing = ingredients.find((i) => i._id === id);
    const foodInput = row.querySelector('[data-food-input]');
    const suggestList = row.querySelector('.food-suggest__list');
    const gramsInput = row.querySelector('[data-grams]');

    let debounceTimer;
    foodInput.addEventListener('input', () => {
      ing.foodName = foodInput.value;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        const query = foodInput.value.trim();
        if (!query) { suggestList.hidden = true; return; }
        const matches = await searchFoods(query);
        suggestList.innerHTML =
          matches.map((f) => `<div class="food-suggest__item" data-pick="${escapeHtml(f.name)}">${escapeHtml(f.name)}</div>`).join('')
          + `<div class="food-suggest__item food-suggest__item--custom" data-create-custom>+ „${escapeHtml(query)}" als eigene Zutat anlegen</div>`;
        suggestList.hidden = false;
        suggestList.querySelectorAll('[data-pick]').forEach((item) => item.addEventListener('click', () => {
          ing.foodName = item.dataset.pick;
          foodInput.value = ing.foodName;
          suggestList.hidden = true;
          updateSummary();
        }));
        suggestList.querySelector('[data-create-custom]').addEventListener('click', () => {
          suggestList.hidden = true;
          openCustomFoodModal(query, (food) => {
            ing.foodName = food.name;
            foodInput.value = food.name;
            updateSummary();
          });
        });
      }, 200);
    });
    foodInput.addEventListener('blur', () => setTimeout(() => { suggestList.hidden = true; }, 150));

    gramsInput.addEventListener('input', () => {
      ing.grams = Number(gramsInput.value) || 0;
      updateSummary();
    });

    row.querySelector('[data-remove]').addEventListener('click', () => {
      const idx = ingredients.findIndex((i) => i._id === id);
      if (idx >= 0) ingredients.splice(idx, 1);
      renderIngredients();
      updateSummary();
    });
  }

  async function updateSummary() {
    const servings = Number(handle.sheet.querySelector('#recipe-servings')?.value) || 1;
    const draftRecipe = { ingredients: ingredients.filter((i) => i.foodName && i.grams > 0), servings };
    const { perServing } = await recipeNutrition(draftRecipe);
    const summary = handle.sheet.querySelector('#recipe-summary');
    if (summary) {
      summary.textContent = `Pro Portion: ${formatNum(perServing.kcal)} kcal · P ${formatNum(perServing.protein)} g · KH ${formatNum(perServing.carbs)} g · F ${formatNum(perServing.fat)} g`;
    }
  }

  function onSave() {
    const name = handle.sheet.querySelector('#recipe-name').value.trim();
    if (!name) { toast('Bitte einen Namen eingeben'); return; }
    const servings = Number(handle.sheet.querySelector('#recipe-servings').value) || 1;
    const note = handle.sheet.querySelector('#recipe-note').value.trim();
    const cleanIngredients = ingredients
      .filter((i) => i.foodName && i.grams > 0)
      .map((i) => ({ foodName: i.foodName, grams: i.grams }));
    if (!cleanIngredients.length) { toast('Bitte mindestens eine Zutat angeben'); return; }
    if (existing) {
      saveRecipe({ ...existing, name, servings, note, ingredients: cleanIngredients });
    } else {
      createRecipe({ name, servings, note, ingredients: cleanIngredients });
    }
    toast('Gespeichert');
    handle.close();
    onSaved?.();
  }

  async function onDelete() {
    const ok = await confirmDialog('Rezept löschen?', 'Geplante Mahlzeiten mit diesem Rezept werden aus dem Wochenplan entfernt.');
    if (!ok) return;
    deleteRecipe(existing.id);
    toast('Gelöscht');
    handle.close();
    onSaved?.();
  }
}

/** Legt eine eigene Zutat mit Naehrwerten pro 100g an - fuer Faelle, in
 *  denen die (englischsprachige) USDA-Datenbank nichts Passendes liefert,
 *  z.B. bei auf Deutsch gesuchten rohen Zutaten. */
function openCustomFoodModal(prefillName, onCreated) {
  const handle = openModal(`
    <h3 class="modal-title">Eigene Zutat anlegen</h3>
    <div class="field">
      <label>Name</label>
      <input class="input" id="cf-name" value="${escapeHtml(prefillName)}" placeholder="z.B. Honig">
    </div>
    <p class="faint" style="margin-bottom:10px">Nährwerte pro 100g/ml:</p>
    <div class="grid-2">
      <div class="field">
        <label>Kalorien (kcal)</label>
        <input class="input" type="number" min="0" step="0.1" id="cf-kcal">
      </div>
      <div class="field">
        <label>Eiweiß (g)</label>
        <input class="input" type="number" min="0" step="0.1" id="cf-protein">
      </div>
      <div class="field">
        <label>Kohlenhydrate (g)</label>
        <input class="input" type="number" min="0" step="0.1" id="cf-carbs">
      </div>
      <div class="field">
        <label>Fett (g)</label>
        <input class="input" type="number" min="0" step="0.1" id="cf-fat">
      </div>
    </div>
    <button class="btn btn-primary" id="cf-save" style="margin-top:10px">Anlegen</button>
  `, { center: true });

  handle.sheet.querySelector('#cf-save').addEventListener('click', () => {
    const name = handle.sheet.querySelector('#cf-name').value.trim();
    if (!name) { toast('Bitte einen Namen eingeben'); return; }
    const food = createCustomFood({
      name,
      kcal_100g: handle.sheet.querySelector('#cf-kcal').value,
      protein_100g: handle.sheet.querySelector('#cf-protein').value,
      carbs_100g: handle.sheet.querySelector('#cf-carbs').value,
      fat_100g: handle.sheet.querySelector('#cf-fat').value,
    });
    toast('Zutat angelegt');
    handle.close();
    onCreated(food);
  });
}
