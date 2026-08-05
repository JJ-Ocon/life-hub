#!/usr/bin/env node
// Baut shared/foods.json aus dem USDA FoodData Central "SR Legacy"-Datensatz
// (generische Grundzutaten wie Reis, Hühnerbrust, Zwiebel - keine
// Markenprodukte, passt am besten zu selbstgekochten Rezepten).
//
// Quelle: public domain (US-Regierung), keine Attribution noetig.
// Turnus: laut Oekosystem-Dokument alle 6-12 Monate neu ausfuehren, wenn
// USDA eine neue SR-Legacy-Version veroeffentlicht.
//
// Ablauf zum Aktualisieren:
//   1. ZIP herunterladen:
//      https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_json_<version>.zip
//   2. entpacken (enthaelt eine einzelne grosse JSON-Datei, ~200MB - wird
//      NICHT committet, nur das Ergebnis unten)
//   3. node tools/build-foods.js <pfad-zur-entpackten-json> > shared/foods.json
//
// Open Food Facts (Barcode-Produkte) ist bewusst NICHT Teil dieser Pipeline:
// der Vollexport ist mehrere GB gross, ein lokaler Snapshot dafuer ist ein
// separater, spaeterer Schritt (z.B. auf DACH-Produkte gefiltert).

const fs = require('fs');

const NUTRIENT_NUMBERS = { kcal: '208', protein: '203', fat: '204', carbs: '205' };

function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('Nutzung: node build-foods.js <pfad-zur-sr-legacy-json>');
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  const sourceFoods = raw.SRLegacyFoods || raw;

  const out = [];
  for (const food of sourceFoods) {
    const byNumber = {};
    for (const fn of food.foodNutrients || []) {
      const num = fn.nutrient?.number;
      if (num && fn.amount != null) byNumber[num] = fn.amount;
    }
    const kcal = byNumber[NUTRIENT_NUMBERS.kcal];
    if (kcal == null || !food.description) continue; // ohne Kalorienwert nutzlos

    out.push({
      name: food.description,
      kcal_100g: round1(kcal),
      protein_100g: round1(byNumber[NUTRIENT_NUMBERS.protein] || 0),
      carbs_100g: round1(byNumber[NUTRIENT_NUMBERS.carbs] || 0),
      fat_100g: round1(byNumber[NUTRIENT_NUMBERS.fat] || 0),
    });
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  process.stdout.write(JSON.stringify(out));
  console.error(`${out.length} Lebensmittel geschrieben (von ${sourceFoods.length} in der Quelle).`);
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

main();
