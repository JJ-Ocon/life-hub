import { setTitle, setActions, setBack } from '../router.js';
import { getSettings, saveSettings, exportAllData, importAllData, resetAllData, getSessions, getSettings as getSet } from '../db.js';
import { applyTheme } from '../theme.js';
import { confirmDialog, toast, promptDialog } from '../ui.js';
import { download, readFileAsText, formatNum, todayKey } from '../utils.js';

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

    <div class="section-title">Training</div>
    <div class="card">
      <div class="field" style="margin-bottom:14px">
        <label>Einheit</label>
        <div class="chip-row">
          <button class="chip ${settings.units === 'kg' ? 'active' : ''}" data-unit="kg">kg</button>
          <button class="chip ${settings.units === 'lb' ? 'active' : ''}" data-unit="lb">lb</button>
        </div>
      </div>
      <div class="field" style="margin-bottom:0">
        <label>Standard-Pausenzeit (Sekunden)</label>
        <input class="input" type="number" id="default-rest" value="${settings.defaultRest}" min="0" step="5">
      </div>
    </div>

    <div class="section-title">Daten</div>
    <div class="card stack">
      <button class="btn btn-ghost" id="export-json">Backup exportieren (JSON)</button>
      <label class="btn btn-ghost" for="import-json">Backup importieren (JSON)</label>
      <input type="file" id="import-json" accept="application/json" hidden>
      <button class="btn btn-ghost" id="export-csv">Trainingsdaten als CSV exportieren</button>
      <button class="btn btn-danger" id="reset-all">Alle Daten löschen</button>
    </div>

    <div class="section-title">Über die App</div>
    <div class="card">
      <p class="faint">Trainingslog · Version 1.0</p>
      <p class="faint" style="margin-top:6px">Alle Daten (inkl. Fotos) bleiben ausschließlich lokal auf diesem Gerät gespeichert. Es findet keine Cloud-Synchronisation statt.</p>
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
  document.querySelectorAll('[data-unit]').forEach((el) => {
    el.addEventListener('click', () => { saveSettings({ units: el.dataset.unit }); render(); });
  });
  document.getElementById('default-rest').addEventListener('change', (e) => {
    saveSettings({ defaultRest: Number(e.target.value) || 0 });
    toast('Gespeichert');
  });

  document.getElementById('export-json').addEventListener('click', async () => {
    const data = await exportAllData();
    download(`trainingslog-backup-${todayKey()}.json`, JSON.stringify(data, null, 2));
    toast('Backup exportiert');
  });

  document.getElementById('import-json').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const ok = await confirmDialog('Backup importieren?', 'Vorhandene Daten mit gleichen IDs werden überschrieben. Fahre nur fort, wenn du dem Ursprung dieser Datei vertraust.', 'Importieren', false);
    if (!ok) return;
    try {
      const text = await readFileAsText(file);
      const data = JSON.parse(text);
      await importAllData(data);
      toast('Import erfolgreich');
      render();
    } catch (err) {
      toast('Import fehlgeschlagen: ungültige Datei');
    }
  });

  document.getElementById('export-csv').addEventListener('click', () => {
    const sessions = getSessions().filter((s) => s.endedAt);
    const rows = [['Datum', 'Routine', 'Übung', 'Satz', 'Modus', 'Wiederholungen', 'Dauer (Sek.)', 'Gewicht', 'Aufwärmsatz', 'Erledigt']];
    for (const s of sessions) {
      for (const ex of s.exercises) {
        const isTime = ex.mode === 'time';
        ex.sets.forEach((set, i) => {
          rows.push([
            s.startedAt.slice(0, 10), s.routineName, ex.exerciseName, i + 1,
            isTime ? 'Zeit' : 'Wiederholungen',
            isTime ? '' : set.reps,
            isTime ? set.seconds : '',
            set.weight, set.isWarmup ? 'ja' : 'nein', set.done ? 'ja' : 'nein',
          ]);
        });
      }
    }
    const csv = rows.map((r) => r.map(csvEscape).join(';')).join('\n');
    download(`trainingslog-export-${todayKey()}.csv`, csv, 'text/csv');
    toast('CSV exportiert');
  });

  document.getElementById('reset-all').addEventListener('click', async () => {
    const ok = await confirmDialog('Wirklich alle Daten löschen?', 'Routinen, Workouts, Körperdaten und Fotos werden unwiderruflich gelöscht.', 'Alles löschen', true);
    if (!ok) return;
    const typed = await promptDialog('Zur Bestätigung "LÖSCHEN" eingeben', { placeholder: 'LÖSCHEN' });
    if (typed !== 'LÖSCHEN') { toast('Abgebrochen'); return; }
    await resetAllData();
    toast('Alle Daten wurden gelöscht');
    location.hash = '#/';
    setTimeout(() => location.reload(), 400);
  });
}

function csvEscape(v) {
  const s = String(v ?? '');
  return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
