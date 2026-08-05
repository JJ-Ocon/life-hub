import { setTitle, setActions, setBack } from '../router.js';
import { getSettings, saveSettings, exportAllData, importAllData, resetAllData } from '../db.js';
import { applyTheme } from '../theme.js';
import { confirmDialog, toast, promptDialog } from '../ui.js';
import { download, readFileAsText, todayKey } from '../utils.js';

const THEMES = [
  { key: 'light', label: 'Light', dot: '#f5f6f8' },
  { key: 'grey', label: 'Grey', dot: '#3a3d42' },
  { key: 'dark', label: 'Dark', dot: '#11151c' },
  { key: 'colored', label: 'Colored', dot: 'accent' },
];

export function render() {
  setTitle('Mehr');
  setActions('');
  setBack(null);

  const settings = getSettings();

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
      <div class="field" style="margin-bottom:0">
        <label>Tagesziel (kcal, optional)</label>
        <input class="input" type="number" min="0" step="10" id="target-kcal" value="${settings.targetKcal ?? ''}" placeholder="leer = kein Ziel angezeigt">
      </div>
      <p class="faint" style="margin-top:10px">Noch kein automatischer Abgleich mit den Körperdaten aus der Fitness-App - das Ziel wird hier manuell eingetragen.</p>
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
