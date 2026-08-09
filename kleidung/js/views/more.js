import { setTitle, setActions, setBack } from '../router.js';
import {
  getSettings, saveSettings, exportAllData, importAllData, resetAllData,
  SKIN_TONES, UNDERTONES, getBodyProportions,
} from '../db.js';
import { applyTheme } from '../theme.js';
import { confirmDialog, toast, promptDialog } from '../ui.js';
import { download, readFileAsText, todayKey } from '../utils.js';

const THEMES = [
  { key: 'light', label: 'Light', dot: '#f5f6f8' },
  { key: 'grey', label: 'Grey', dot: '#3a3d42' },
  { key: 'dark', label: 'Dark', dot: '#11151c' },
  { key: 'colored', label: 'Colored', dot: 'accent' },
];

const PROPORTION_LABELS = {
  legLength: 'Beinlänge', torsoLength: 'Torsolänge', shoulderWidth: 'Schulterbreite', waistWidth: 'Taillenbreite',
};

export function render() {
  setTitle('Mehr');
  setActions('');
  setBack(null);

  const settings = getSettings();
  const proportions = getBodyProportions();
  const hasProportions = proportions && Object.keys(PROPORTION_LABELS).some((k) => proportions[k] != null);

  document.getElementById('view').innerHTML = `
    <div class="section-title" style="margin-top:0">Farbprofil</div>
    <div class="card">
      <p class="faint" style="margin-bottom:10px">Hautton</p>
      <div class="chip-row" id="skin-tone-row" style="margin-bottom:16px">
        ${SKIN_TONES.map((t) => `<div class="chip ${settings.skinTone === t.key ? 'active' : ''}" data-skin="${t.key}">${t.label}</div>`).join('')}
      </div>
      <p class="faint" style="margin-bottom:10px">Unterton</p>
      <div class="chip-row" id="undertone-row">
        ${UNDERTONES.map((t) => `<div class="chip ${settings.undertone === t.key ? 'active' : ''}" data-undertone="${t.key}">${t.label}</div>`).join('')}
      </div>
    </div>

    <div class="section-title">Körperproportionen</div>
    <div class="card">
      ${hasProportions ? `
        <div class="stack">
          ${Object.entries(PROPORTION_LABELS).map(([key, label]) => proportions[key] != null ? `
            <div class="row row--between"><span class="faint">${label}</span><span>${proportions[key]} cm</span></div>
          ` : '').join('')}
        </div>
        <p class="faint" style="margin-top:12px">Aus der Fitness-App übernommen, dort unter Körperdaten erfassbar.</p>
      ` : `
        <p class="faint">Noch keine Werte vorhanden. In der Fitness-App unter Körperdaten → Maße eintragen (Beinlänge, Torsolänge, Schulterbreite, Taillenbreite), sie erscheinen dann automatisch hier.</p>
      `}
    </div>

    <div class="section-title">Erscheinungsbild</div>
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

    <div class="section-title">Daten</div>
    <div class="card stack">
      <button class="btn btn-ghost" id="export-json">Backup exportieren (JSON)</button>
      <label class="btn btn-ghost" for="import-json">Backup importieren (JSON)</label>
      <input type="file" id="import-json" accept="application/json" hidden>
      <button class="btn btn-danger" id="reset-all">Alle Daten löschen</button>
    </div>

    <div class="section-title">Über die App</div>
    <div class="card">
      <p class="faint">Kleidung · Version 1.0</p>
      <p class="faint" style="margin-top:6px">Alle Daten bleiben ausschließlich lokal auf diesem Gerät gespeichert.</p>
    </div>
  `;

  document.querySelectorAll('[data-skin]').forEach((el) => {
    el.addEventListener('click', () => { saveSettings({ skinTone: el.dataset.skin }); render(); });
  });
  document.querySelectorAll('[data-undertone]').forEach((el) => {
    el.addEventListener('click', () => { saveSettings({ undertone: el.dataset.undertone }); render(); });
  });

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

  document.getElementById('export-json').addEventListener('click', () => {
    const data = exportAllData();
    download(`kleidung-backup-${todayKey()}.json`, JSON.stringify(data, null, 2));
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
    const ok = await confirmDialog('Wirklich alle Daten löschen?', 'Alle Kleidungsstücke werden unwiderruflich gelöscht.', 'Alles löschen', true);
    if (!ok) return;
    const typed = await promptDialog('Zur Bestätigung "LÖSCHEN" eingeben', { placeholder: 'LÖSCHEN' });
    if (typed !== 'LÖSCHEN') { toast('Abgebrochen'); return; }
    resetAllData();
    toast('Alle Daten wurden gelöscht');
    location.hash = '#/';
    setTimeout(() => location.reload(), 400);
  });
}
