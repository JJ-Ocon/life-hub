import { setTitle, setActions, setBack } from '../router.js';
import {
  getSettings, saveSettings, exportAllData, importAllData, resetAllData,
  getActiveDiet, dietStatusForDate, startDiet, stopDiet,
} from '../db.js';
import { applyTheme } from '../theme.js';
import { confirmDialog, toast, promptDialog } from '../ui.js';
import { download, readFileAsText, todayKey, formatNum, escapeHtml } from '../utils.js';
import { getSharedCalorieNeeds } from '../../../shared/body-data.js';

const THEMES = [
  { key: 'light', label: 'Light', dot: '#f5f6f8' },
  { key: 'grey', label: 'Grey', dot: '#3a3d42' },
  { key: 'dark', label: 'Dark', dot: '#11151c' },
  { key: 'colored', label: 'Colored', dot: 'accent' },
];

function dietSectionHtml() {
  const diet = getActiveDiet();
  if (diet) {
    const status = dietStatusForDate(diet, todayKey());
    return `
      <p>${escapeHtml(diet.name)}</p>
      <p class="faint" style="margin-top:4px">Woche ${status.week}/${status.totalWeeks} · Ziel diese Woche: ${formatNum(status.targetKcal)} kcal/Tag${status.finished ? ' · beendet' : ''}</p>
      <p class="faint" style="margin-top:4px">Start ${diet.startDate} · ${diet.weeklyStepKcal >= 0 ? '+' : ''}${diet.weeklyStepKcal} kcal/Woche</p>
      <button class="btn btn-ghost" id="diet-stop" style="margin-top:12px">Diät beenden</button>
    `;
  }
  return `
    <div class="field">
      <label>Name</label>
      <input class="input" id="diet-name" placeholder="z.B. Sanfte Diät bis zum Urlaub">
    </div>
    <div class="grid-2">
      <div class="field">
        <label>Dauer (Wochen)</label>
        <input class="input" type="number" min="1" id="diet-weeks" value="8">
      </div>
      <div class="field">
        <label>Start-Ziel (kcal)</label>
        <input class="input" type="number" min="0" step="10" id="diet-start-kcal" value="${getSettings().targetKcal || 2000}">
      </div>
    </div>
    <div class="field">
      <label>Wöchentliche Anpassung (kcal, negativ = Abnehmen)</label>
      <input class="input" type="number" step="10" id="diet-step-kcal" value="-50">
    </div>
    <button class="btn btn-primary" id="diet-start">Diät starten</button>
  `;
}

export function render() {
  setTitle('Mehr');
  setActions('');
  setBack(null);

  const settings = getSettings();
  const shared = getSharedCalorieNeeds();

  document.getElementById('view').innerHTML = `
    <div class="section-title" style="margin-top:0">Erscheinungsbild</div>
    <div class="card">
      <div class="theme-grid" id="theme-grid">
        ${THEMES.map((t) => `
          <div class="theme-swatch ${settings.theme === t.key ? 'active' : ''}" data-theme-pick="${t.key}">
            <div class="theme-swatch__dot" style="background:${t.dot === 'accent' ? `hsl(${settings.accentHue} 70% 55%)` : t.dot}; border:1px solid var(--border)"></div>
            ${t.label}
          </div>
        `).join('')}
      </div>
      <div id="hue-wrap" style="margin-top:16px; ${settings.theme === 'colored' ? '' : 'display:none'}">
        <label class="faint" style="display:block;margin-bottom:8px">Akzentfarbe</label>
        <input type="range" min="0" max="360" class="hue-slider" id="hue-slider" value="${settings.accentHue}">
      </div>
    </div>

    <div class="section-title">Kalorienziel</div>
    <div class="card">
      <div class="field" style="margin-bottom:${shared ? '14px' : '0'}">
        <label>Tagesziel (kcal, optional)</label>
        <input class="input" type="number" min="0" step="10" id="target-kcal" value="${settings.targetKcal ?? ''}" placeholder="leer = kein Ziel angezeigt">
      </div>
      ${shared ? `
        <p class="faint" style="margin-bottom:8px">Aus der Fitness-App übernehmen (${formatNum(shared.weightKg, 1)} kg, ${shared.age} Jahre, inkl. Trainingsverbrauch):</p>
        <div class="chip-row">
          ${shared.targets.map((t) => `<button type="button" class="chip ${settings.targetKcal === t.kcal ? 'active' : ''}" data-take-kcal="${t.kcal}">${t.label} · ${formatNum(t.kcal)} kcal</button>`).join('')}
        </div>
      ` : `
        <p class="faint" style="margin-top:10px">Noch keine Körperdaten aus der Fitness-App verfügbar. Öffne die Fitness-App und vervollständige dort dein Profil (Größe, Geburtsdatum, Geschlecht) sowie einen Gewichtseintrag, damit hier automatische Zielvorschläge erscheinen.</p>
      `}
    </div>

    <div class="section-title">Diät-Planung</div>
    <div class="card">
      ${dietSectionHtml()}
    </div>

    <div class="section-title">Daten</div>
    <div class="card stack">
      <button class="btn btn-ghost" id="export-json">Backup exportieren (JSON)</button>
      <label class="btn btn-ghost" for="import-json">Backup importieren (JSON)</label>
      <input type="file" id="import-json" accept="application/json" hidden>
      <button class="btn btn-danger" id="reset-all">Alle Daten löschen</button>
    </div>

    <div class="section-title">Über die App</div>
    <div class="card">
      <p class="faint">Meal Planning · Version 1.0</p>
      <p class="faint" style="margin-top:6px">Alle Daten bleiben ausschließlich lokal auf diesem Gerät gespeichert. Die Lebensmittel-Datenbank stammt aus USDA FoodData Central (SR Legacy, public domain) - Namen sind auf Englisch.</p>
    </div>
  `;

  document.querySelectorAll('[data-theme-pick]').forEach((el) => {
    el.addEventListener('click', () => {
      const theme = el.dataset.themePick;
      const s = saveSettings({ theme });
      applyTheme(s);
      render();
    });
  });
  document.getElementById('hue-slider')?.addEventListener('input', (e) => {
    const s = saveSettings({ accentHue: Number(e.target.value) });
    applyTheme(s);
  });
  document.getElementById('target-kcal').addEventListener('change', (e) => {
    const v = Number(e.target.value);
    saveSettings({ targetKcal: v > 0 ? v : null });
    toast('Gespeichert');
  });
  document.querySelectorAll('[data-take-kcal]').forEach((b) => b.addEventListener('click', () => {
    saveSettings({ targetKcal: Number(b.dataset.takeKcal) });
    toast('Übernommen');
    render();
  }));

  document.getElementById('diet-start')?.addEventListener('click', () => {
    const name = document.getElementById('diet-name').value.trim() || 'Diät';
    startDiet({
      name,
      startDate: todayKey(),
      durationWeeks: document.getElementById('diet-weeks').value,
      startTargetKcal: document.getElementById('diet-start-kcal').value,
      weeklyStepKcal: document.getElementById('diet-step-kcal').value,
    });
    toast('Diät gestartet');
    render();
  });
  document.getElementById('diet-stop')?.addEventListener('click', async () => {
    const diet = getActiveDiet();
    const ok = await confirmDialog('Diät beenden?', 'Das Kalorienziel fällt danach auf das statische Tagesziel zurück.', 'Beenden', false);
    if (!ok) return;
    stopDiet(diet.id);
    toast('Diät beendet');
    render();
  });

  document.getElementById('export-json').addEventListener('click', () => {
    const data = exportAllData();
    download(`meal-planning-backup-${todayKey()}.json`, JSON.stringify(data, null, 2));
    saveSettings({ lastBackupAt: todayKey() });
    toast('Backup exportiert');
  });

  document.getElementById('import-json').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const ok = await confirmDialog('Backup importieren?', 'Vorhandene Daten werden überschrieben. Fahre nur fort, wenn du dem Ursprung dieser Datei vertraust.', 'Importieren', false);
    if (!ok) return;
    try {
      const text = await readFileAsText(file);
      const data = JSON.parse(text);
      importAllData(data);
      toast('Import erfolgreich');
      render();
    } catch {
      toast('Import fehlgeschlagen: ungültige Datei');
    }
  });

  document.getElementById('reset-all').addEventListener('click', async () => {
    const ok = await confirmDialog('Wirklich alle Daten löschen?', 'Rezepte und Wochenplan werden unwiderruflich gelöscht.', 'Alles löschen', true);
    if (!ok) return;
    const typed = await promptDialog('Zur Bestätigung "LÖSCHEN" eingeben', { placeholder: 'LÖSCHEN' });
    if (typed !== 'LÖSCHEN') { toast('Abgebrochen'); return; }
    resetAllData();
    toast('Alle Daten wurden gelöscht');
    location.hash = '#/';
    setTimeout(() => location.reload(), 400);
  });
}
