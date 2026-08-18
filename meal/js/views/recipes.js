import { setTitle, setActions, setBack } from '../router.js';
import {
  getRecipes, getRecipeById, saveRecipe, createRecipe, deleteRecipe, recipeNutrition, searchFoods, createCustomFood,
  getIngredientPrice, setIngredientPrice, recipeCost, MEALS,
  getRecurringRulesForRecipe, createRecurringRule, deleteRecurringRule,
  getRecipeCategories, createRecipeCategory,
} from '../db.js';
import { openModal, confirmDialog, toast, promptDialog } from '../ui.js';
import { escapeHtml, formatNum, formatMoney, uid, weekdayLabel } from '../utils.js';

let activeCategoryFilter = null; // null = alle
let searchOpen = false;
let searchQuery = '';

export async function render() {
  setTitle('Rezepte');
  setBack(null);
  setActions(`
    <button class="icon-btn" id="recipe-search" aria-label="Suchen">
      <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
    </button>
    <button class="icon-btn" id="recipe-add" aria-label="Rezept anlegen">
      <svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
    </button>
  `);
  await draw();
  document.getElementById('recipe-search').addEventListener('click', () => {
    searchOpen = !searchOpen;
    if (!searchOpen) searchQuery = '';
    draw();
  });
  document.getElementById('recipe-add').addEventListener('click', () => openRecipeModal(null, draw));
}

function matchesSearch(r) {
  if (!searchQuery.trim()) return true;
  const needle = searchQuery.trim().toLowerCase();
  const haystack = [r.name, ...(r.ingredients || []).map((i) => i.foodName)].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(needle);
}

async function draw() {
  const allRecipes = getRecipes();
  const categories = getRecipeCategories();
  const searching = !!searchQuery.trim();
  let recipes = activeCategoryFilter ? allRecipes.filter((r) => r.categoryIds.includes(activeCategoryFilter)) : allRecipes;
  if (searching) recipes = recipes.filter(matchesSearch);
  const view = document.getElementById('view');

  const searchFieldHtml = searchOpen ? `
    <div class="field" style="margin-bottom:14px">
      <input class="input" id="recipe-search-input" type="search" placeholder="Rezepte oder Zutaten suchen …" value="${escapeHtml(searchQuery)}">
    </div>
  ` : '';

  function wireSearchInput() {
    const input = document.getElementById('recipe-search-input');
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    input.addEventListener('input', (e) => { searchQuery = e.target.value; draw(); });
  }

  const filterRowHtml = categories.length ? `
    <div class="chip-row" style="margin-bottom:14px">
      <button type="button" class="chip ${!activeCategoryFilter ? 'active' : ''}" data-filter="">Alle</button>
      ${categories.map((c) => `<button type="button" class="chip ${activeCategoryFilter === c.id ? 'active' : ''}" data-filter="${c.id}">${escapeHtml(c.name)}</button>`).join('')}
    </div>
  ` : '';

  if (!allRecipes.length) {
    view.innerHTML = `
      <div class="empty">
        <h3>Noch keine Rezepte</h3>
        <p class="faint">Lege dein erstes Rezept über das Plus oben rechts an.</p>
      </div>
    `;
    return;
  }
  if (!recipes.length) {
    view.innerHTML = `${searchFieldHtml}${filterRowHtml}<p class="faint">${searching ? 'Keine Treffer.' : 'Keine Rezepte in dieser Kategorie.'}</p>`;
    wireSearchInput();
    view.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => { activeCategoryFilter = b.dataset.filter || null; draw(); }));
    return;
  }

  const cards = await Promise.all(recipes.map(async (r) => {
    const { perServing } = await recipeNutrition(r);
    const cost = recipeCost(r);
    return `
      <div class="card card--tap" data-open="${r.id}" style="margin-bottom:0">
        <div class="row row--between">
          <div class="col grow" style="min-width:0">
            <p class="truncate">${escapeHtml(r.name)}</p>
            <p class="faint">${r.servings} ${r.servings === 1 ? 'Portion' : 'Portionen'} · ${r.ingredients.length} Zutaten${cost.total > 0 ? ` · ${formatMoney(cost.perServing)}/Portion` : ''}</p>
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

  view.innerHTML = `${searchFieldHtml}${filterRowHtml}<div class="stack">${cards.join('')}</div>`;
  wireSearchInput();
  view.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => { activeCategoryFilter = b.dataset.filter || null; draw(); }));
  view.querySelectorAll('[data-open]').forEach((el) => {
    el.addEventListener('click', () => openRecipeModal(getRecipeById(el.dataset.open), draw));
  });
}

/** Zutaten-Mengen koennen in g, ml oder Stück angegeben werden (E63) - g/ml
 *  gelten fuer die Naehrwert-/Kostenrechnung als 1:1-aequivalent (grobe, aber
 *  fuer Kochzutaten uebliche Naeherung: 1ml Wasser/Milch/Bruehe ≈ 1g; bei
 *  z.B. Oel weicht das leicht ab, wird bewusst nicht mit einer Dichtetabelle
 *  ueberkonstruiert). Bei Stück gibt es keinen allgemeinguelten Umrechnungs-
 *  faktor (ein Ei wiegt anders als eine Zwiebel) - dafuer fragt die Zeile ein
 *  editierbares "≈g/Stück" ab, Default 50g. `grams` bleibt in JEDEM Fall das
 *  fuer Naehrwerte/Kosten/Vorrats-Abgleich massgebliche gerechnete Feld -
 *  alle bestehenden Verbraucher (recipeNutrition, recipeCost, ...) bleiben
 *  dadurch unveraendert.
 */
function normalizeIngredient(i) {
  return {
    _id: uid(),
    foodName: i.foodName || '',
    grams: i.grams ?? 100,
    unit: i.unit || 'g',
    displayAmount: i.displayAmount ?? i.grams ?? 100,
    gramsPerPiece: i.gramsPerPiece ?? 50,
  };
}

function recomputeGrams(ing) {
  ing.grams = ing.unit === 'stueck' ? (ing.displayAmount || 0) * (ing.gramsPerPiece || 0) : (ing.displayAmount || 0);
}

function openRecipeModal(existing, onSaved) {
  const ingredients = existing ? existing.ingredients.map(normalizeIngredient) : [normalizeIngredient({ foodName: '', grams: 100 })];
  let categoryIds = existing?.categoryIds ? [...existing.categoryIds] : [];

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
        <label>Kategorien (optional)</label>
        <div class="chip-row" id="category-row"></div>
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
      ${existing ? `<div class="field" id="recurring-section"></div>` : ''}
      <div class="stack">
        <button class="btn btn-primary" id="recipe-save">Speichern</button>
        ${existing ? '<button class="btn btn-danger" id="recipe-delete">Löschen</button>' : ''}
      </div>
    `;
  }

  let ruleWeekday = 0;
  let ruleMeal = MEALS[0].key;

  function renderRecurringSection() {
    const section = handle.sheet.querySelector('#recurring-section');
    if (!section) return;
    const rules = getRecurringRulesForRecipe(existing.id);
    section.innerHTML = `
      <label>Automatisch wiederkehrend einplanen</label>
      ${rules.length ? `
        <div class="stack" style="margin-bottom:10px">
          ${rules.map((r) => `
            <div class="row row--between">
              <span class="faint">${weekdayLabel(r.weekday)} · ${MEALS.find((m) => m.key === r.meal)?.label || r.meal}</span>
              <button class="icon-btn" data-rule-del="${r.id}" aria-label="Löschen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg></button>
            </div>
          `).join('')}
        </div>
      ` : `<p class="faint" style="margin-bottom:10px">Noch keine Regel - füge eine hinzu, damit dieses Rezept automatisch in leere Wochentage einsortiert wird.</p>`}
      <div class="chip-row" id="rule-weekday-row" style="margin-bottom:8px">
        ${[0, 1, 2, 3, 4, 5, 6].map((d) => `<button type="button" class="chip ${d === ruleWeekday ? 'active' : ''}" data-weekday="${d}">${weekdayLabel(d)}</button>`).join('')}
      </div>
      <div class="chip-row" id="rule-meal-row" style="margin-bottom:10px">
        ${MEALS.map((m) => `<button type="button" class="chip ${m.key === ruleMeal ? 'active' : ''}" data-meal="${m.key}">${m.label}</button>`).join('')}
      </div>
      <button class="btn btn-ghost btn-sm" id="rule-add" type="button">+ Regel hinzufügen</button>
    `;
    section.querySelectorAll('[data-weekday]').forEach((b) => b.addEventListener('click', () => {
      ruleWeekday = Number(b.dataset.weekday);
      section.querySelectorAll('[data-weekday]').forEach((x) => x.classList.toggle('active', Number(x.dataset.weekday) === ruleWeekday));
    }));
    section.querySelectorAll('[data-meal]').forEach((b) => b.addEventListener('click', () => {
      ruleMeal = b.dataset.meal;
      section.querySelectorAll('[data-meal]').forEach((x) => x.classList.toggle('active', x.dataset.meal === ruleMeal));
    }));
    section.querySelector('#rule-add').addEventListener('click', () => {
      createRecurringRule({ recipeId: existing.id, weekday: ruleWeekday, meal: ruleMeal, servings: existing.servings || 1 });
      toast('Regel hinzugefügt');
      renderRecurringSection();
    });
    section.querySelectorAll('[data-rule-del]').forEach((b) => b.addEventListener('click', () => {
      deleteRecurringRule(b.dataset.ruleDel);
      renderRecurringSection();
    }));
  }

  // Ausgangszustand fuer den Dirty-Check beim automatischen Speichern beim
  // Schliessen (E63) - ein unveraendert wieder geschlossenes bestehendes
  // Rezept soll keinen unnoetigen Autosave/Toast ausloesen.
  const initialSnapshot = existing ? JSON.stringify({
    name: existing.name, servings: existing.servings, note: existing.note,
    ingredients: ingredients.map(({ _id, ...rest }) => rest),
  }) : null;
  let finalized = false; // true nach explizitem Speichern oder Loeschen - Autosave beim Schliessen dann ueberfluessig

  const handle = openModal(content(), { center: true, onClose: autosaveDraftIfNeeded });
  renderIngredients();
  updateSummary();
  renderRecurringSection();
  renderCategorySection();
  wireStatic();

  /** Frei erstellbare Kategorien, mehrfach zuordbar (E68+-Nachtrag) - gleiches
   *  "+ Neu"-Inline-Muster wie Notizens Ordner-Chips. */
  function renderCategorySection() {
    const row = handle.sheet.querySelector('#category-row');
    const categories = getRecipeCategories();
    row.innerHTML = `
      ${categories.map((c) => `<button type="button" class="chip ${categoryIds.includes(c.id) ? 'active' : ''}" data-category="${c.id}">${escapeHtml(c.name)}</button>`).join('')}
      <button type="button" class="chip" id="category-new">+ Neu</button>
    `;
    row.querySelectorAll('[data-category]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.category;
      if (categoryIds.includes(id)) categoryIds = categoryIds.filter((c) => c !== id);
      else categoryIds.push(id);
      b.classList.toggle('active', categoryIds.includes(id));
    }));
    row.querySelector('#category-new').addEventListener('click', async () => {
      const name = await promptDialog('Neue Kategorie', { placeholder: 'z.B. Frühstück' });
      if (!name) return;
      const category = createRecipeCategory(name);
      if (category) categoryIds.push(category.id);
      renderCategorySection();
    });
  }

  /** Rettet ein unfertiges Rezept (z.B. Name getippt, aber noch keine
   *  Zutaten) beim Schliessen ueber X/Overlay-Klick statt es stillschweigend
   *  zu verwerfen - anders als der explizite Speichern-Button verlangt das
   *  KEINEN Namen und KEINE Zutaten, reine "nichts verlieren"-Absicherung. */
  function autosaveDraftIfNeeded() {
    if (finalized) return;
    const name = handle.sheet.querySelector('#recipe-name')?.value.trim() || '';
    const servings = Number(handle.sheet.querySelector('#recipe-servings')?.value) || existing?.servings || 1;
    const note = handle.sheet.querySelector('#recipe-note')?.value.trim() || '';
    const cleanIngredients = ingredients
      .filter((i) => i.foodName && i.grams > 0)
      .map((i) => ({ foodName: i.foodName, grams: i.grams }));
    const hasContent = name || note || cleanIngredients.length > 0;
    if (!hasContent) return;
    if (existing) {
      const snapshot = JSON.stringify({ name: name || existing.name, servings, note, ingredients: cleanIngredients.length ? cleanIngredients : existing.ingredients });
      if (snapshot === initialSnapshot) return; // nichts geaendert
      saveRecipe({ ...existing, name: name || existing.name, servings, note, ingredients: cleanIngredients.length ? cleanIngredients : existing.ingredients, categoryIds });
    } else {
      createRecipe({ name: name || 'Unbenanntes Rezept', servings, note, ingredients: cleanIngredients, categoryIds });
    }
    toast('Entwurf gespeichert');
    onSaved?.();
  }

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
        <input class="input input-grams" type="number" min="0" step="0.1" data-amount value="${ing.displayAmount}" placeholder="Menge">
        <button class="icon-btn" data-remove aria-label="Entfernen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg></button>
      </div>
      <div class="row" style="margin:-6px 0 6px;padding-left:2px;gap:8px;align-items:center">
        <div class="chip-row" data-unit-row style="gap:4px">
          <button type="button" class="chip ${ing.unit === 'g' ? 'active' : ''}" data-unit="g">g</button>
          <button type="button" class="chip ${ing.unit === 'ml' ? 'active' : ''}" data-unit="ml">ml</button>
          <button type="button" class="chip ${ing.unit === 'stueck' ? 'active' : ''}" data-unit="stueck">Stück</button>
        </div>
        ${ing.unit === 'stueck' ? `<input class="input" type="number" min="1" step="1" data-grams-per-piece value="${ing.gramsPerPiece}" placeholder="≈g/Stück" style="width:100px">` : ''}
      </div>
      <div class="row" style="margin:-6px 0 10px;padding-left:2px">
        <span class="faint" style="flex-shrink:0">Preis/100g</span>
        <input class="input input-grams" type="number" min="0" step="0.01" data-price value="${ing.foodName ? (getIngredientPrice(ing.foodName) ?? '') : ''}" placeholder="optional">
      </div>
    `).join('');
    list.querySelectorAll('[data-row]').forEach((row) => wireRow(row));
  }

  function wireRow(row) {
    const id = row.dataset.row;
    const ing = ingredients.find((i) => i._id === id);
    const foodInput = row.querySelector('[data-food-input]');
    const suggestList = row.querySelector('.food-suggest__list');
    const amountInput = row.querySelector('[data-amount]');
    const unitRow = row.nextElementSibling;
    const priceInput = unitRow?.nextElementSibling?.querySelector('[data-price]');
    priceInput?.addEventListener('change', () => {
      if (!ing.foodName) { toast('Bitte zuerst eine Zutat wählen'); priceInput.value = ''; return; }
      setIngredientPrice(ing.foodName, priceInput.value);
      updateSummary();
    });
    unitRow?.querySelectorAll('[data-unit]').forEach((b) => b.addEventListener('click', () => {
      ing.unit = b.dataset.unit;
      recomputeGrams(ing);
      renderIngredients();
      updateSummary();
    }));
    unitRow?.querySelector('[data-grams-per-piece]')?.addEventListener('input', (e) => {
      ing.gramsPerPiece = Number(e.target.value) || 0;
      recomputeGrams(ing);
      updateSummary();
    });

    let debounceTimer;
    foodInput.addEventListener('input', () => {
      ing.foodName = foodInput.value;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        const query = foodInput.value.trim();
        if (!query) { suggestList.hidden = true; return; }
        const matches = await searchFoods(query);
        suggestList.innerHTML =
          matches.map((f) => `
            <div class="food-suggest__item" data-pick="${escapeHtml(f.name)}">
              <span>${escapeHtml(f.name)}</span>
              <span class="faint food-suggest__nutrition">${Math.round(f.kcal_100g)} kcal · ${formatNum(f.protein_100g, 1)}g E · ${formatNum(f.carbs_100g, 1)}g K · ${formatNum(f.fat_100g, 1)}g F <span class="faint">/100g</span></span>
            </div>
          `).join('')
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

    amountInput.addEventListener('input', () => {
      ing.displayAmount = Number(amountInput.value) || 0;
      recomputeGrams(ing);
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
    const cost = recipeCost(draftRecipe);
    const summary = handle.sheet.querySelector('#recipe-summary');
    if (summary) {
      const costLine = cost.total > 0
        ? ` · ${formatMoney(cost.perServing)}/Portion${cost.missingCount ? ` (${cost.missingCount} ohne Preis)` : ''}`
        : '';
      summary.textContent = `Pro Portion: ${formatNum(perServing.kcal)} kcal · P ${formatNum(perServing.protein)} g · KH ${formatNum(perServing.carbs)} g · F ${formatNum(perServing.fat)} g${costLine}`;
    }
  }

  function onSave() {
    const name = handle.sheet.querySelector('#recipe-name').value.trim();
    if (!name) { toast('Bitte einen Namen eingeben'); return; }
    const servings = Number(handle.sheet.querySelector('#recipe-servings').value) || 1;
    const note = handle.sheet.querySelector('#recipe-note').value.trim();
    const cleanIngredients = ingredients
      .filter((i) => i.foodName && i.grams > 0)
      .map((i) => ({ foodName: i.foodName, grams: i.grams, unit: i.unit, displayAmount: i.displayAmount, gramsPerPiece: i.gramsPerPiece }));
    if (!cleanIngredients.length) { toast('Bitte mindestens eine Zutat angeben'); return; }
    finalized = true;
    if (existing) {
      saveRecipe({ ...existing, name, servings, note, ingredients: cleanIngredients, categoryIds });
    } else {
      createRecipe({ name, servings, note, ingredients: cleanIngredients, categoryIds });
    }
    toast('Gespeichert');
    handle.close();
    onSaved?.();
  }

  async function onDelete() {
    const ok = await confirmDialog('Rezept löschen?', 'Geplante Mahlzeiten mit diesem Rezept werden aus dem Wochenplan entfernt.');
    if (!ok) return;
    finalized = true;
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
