import { setTitle, setActions, setBack } from '../router.js';
import {
  getSettings, saveSettings, exportAllData, importAllData, resetAllData, getSessions,
  DAILY_ACTIVITY_LEVELS, CALENDAR_ENTRY_TYPES, getCalendarColor, saveCalendarColor, resetCalendarColors,
} from '../db.js';
import { ageFromBirthDate } from '../utils.js';
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

    <div class="section-title">Profil</div>
    <div class="card">
      <p class="faint" style="margin-bottom:14px">Basis für BMI und Kalorienbedarf. Bleibt wie alles andere nur auf diesem Gerät.</p>
      <div class="field">
        <label>Körpergröße (cm)</label>
        <input class="input" type="number" inputmode="numeric" id="p-height" min="100" max="250" value="${settings.heightCm ?? ''}" placeholder="z.B. 180">
      </div>
      <div class="field">
        <label>Geburtsdatum${settings.birthDate ? ` · ${ageFromBirthDate(settings.birthDate)} Jahre` : ''}</label>
        <input class="input" type="date" id="p-birth" value="${settings.birthDate || ''}">
      </div>
      <div class="field">
        <label>Geschlecht <span class="faint">(für die Grundumsatz-Formel)</span></label>
        <div class="chip-row">
          <button class="chip ${settings.sex === 'male' ? 'active' : ''}" data-sex="male">männlich</button>
          <button class="chip ${settings.sex === 'female' ? 'active' : ''}" data-sex="female">weiblich</button>
        </div>
      </div>
      <div class="field" style="margin-bottom:0">
        <label>Alltagsaktivität <span class="faint">(ohne Training)</span></label>
        <select class="input" id="p-activity">
          ${DAILY_ACTIVITY_LEVELS.map((l) => `
            <option value="${l.key}" ${settings.dailyActivity === l.key ? 'selected' : ''}>${l.label} – ${l.hint}</option>
          `).join('')}
        </select>
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
      <div class="field">
        <label>Standard-Pausenzeit (Sekunden)</label>
        <input class="input" type="number" id="default-rest" value="${settings.defaultRest}" min="0" step="5">
      </div>
      <div class="field">
        <label>Standard-Steigerung (${settings.units})</label>
        <input class="input" type="number" id="progression-step" value="${settings.progressionStep}" min="0.5" step="0.5">
      </div>
      <div class="switch-row" style="padding-bottom:0">
        <div class="col grow">
          <p>RPE je Satz erfassen</p>
          <p class="faint">Anstrengung pro Satz – verbessert die Deload-Erkennung</p>
        </div>
        <label class="switch">
          <input type="checkbox" id="track-rpe" ${settings.trackRpe ? 'checked' : ''}>
          <span class="switch__track"></span><span class="switch__thumb"></span>
        </label>
      </div>
    </div>

    <div class="section-title">Hantel & Scheiben</div>
    <div class="card">
      <p class="faint" style="margin-bottom:12px">Basis für Plattenrechner und Aufwärmsätze.</p>
      <div class="field">
        <label>Stangengewicht (${settings.units})</label>
        <input class="input" type="number" id="bar-weight" value="${settings.barWeight}" min="0" step="0.5">
      </div>
      <div class="field" style="margin-bottom:0">
        <label>Verfügbare Scheiben je Seite (kommagetrennt)</label>
        <input class="input" id="plate-inventory" value="${settings.plateInventory.join(', ')}" placeholder="25, 20, 15, 10, 5, 2.5, 1.25">
      </div>
    </div>

    <div class="section-title">Kalenderfarben</div>
    <div class="card">
      <p class="faint" style="margin-bottom:12px">Farben der Fitness-App im Hauptkalender. Sobald weitere Apps im Ökosystem dazukommen, bekommt jede hier ihre eigenen, frei änderbaren Farben.</p>
      <div class="stack">
        ${CALENDAR_ENTRY_TYPES.map((t) => `
          <div class="row row--between">
            <p>${t.label}</p>
            <input type="color" class="color-input" id="cal-color-${t.key}" value="${getCalendarColor(t.key)}">
          </div>
        `).join('')}
      </div>
      <button class="btn btn-ghost btn-sm" id="cal-colors-reset" style="margin-top:12px">Auf Standard zurücksetzen</button>
    </div>

    <div class="section-title">Daten</div>
    ${backupReminderHtml(settings.lastBackupAt)}
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
  document.getElementById('p-height').addEventListener('change', (e) => {
    const v = Number(e.target.value);
    saveSettings({ heightCm: v > 0 ? v : null });
    toast('Gespeichert');
  });
  document.getElementById('p-birth').addEventListener('change', (e) => {
    saveSettings({ birthDate: e.target.value || '' });
    render();
  });
  document.querySelectorAll('[data-sex]').forEach((el) => el.addEventListener('click', () => {
    const settings = getSettings();
    // erneutes Tippen auf die aktive Auswahl hebt sie wieder auf
    saveSettings({ sex: settings.sex === el.dataset.sex ? '' : el.dataset.sex });
    render();
  }));
  document.getElementById('p-activity').addEventListener('change', (e) => {
    saveSettings({ dailyActivity: e.target.value });
    toast('Gespeichert');
  });

  document.querySelectorAll('[data-unit]').forEach((el) => {
    el.addEventListener('click', () => { saveSettings({ units: el.dataset.unit }); render(); });
  });
  document.getElementById('default-rest').addEventListener('change', (e) => {
    saveSettings({ defaultRest: Number(e.target.value) || 0 });
    toast('Gespeichert');
  });
  document.getElementById('progression-step').addEventListener('change', (e) => {
    saveSettings({ progressionStep: Number(e.target.value) || 2.5 });
    toast('Gespeichert');
  });
  document.getElementById('track-rpe').addEventListener('change', (e) => {
    saveSettings({ trackRpe: e.target.checked });
    toast(e.target.checked ? 'RPE-Erfassung aktiv' : 'RPE-Erfassung aus');
  });
  document.getElementById('bar-weight').addEventListener('change', (e) => {
    saveSettings({ barWeight: Number(e.target.value) || 20 });
    toast('Gespeichert');
  });
  document.getElementById('plate-inventory').addEventListener('change', (e) => {
    const plates = e.target.value
      .split(',')
      .map((v) => Number(v.trim().replace(',', '.')))
      .filter((v) => v > 0)
      .sort((a, b) => b - a);
    if (!plates.length) { toast('Mindestens eine Scheibe angeben'); render(); return; }
    saveSettings({ plateInventory: plates });
    toast('Gespeichert');
    render();
  });

  CALENDAR_ENTRY_TYPES.forEach((t) => {
    document.getElementById(`cal-color-${t.key}`).addEventListener('input', (e) => {
      saveCalendarColor(t.key, e.target.value);
    });
  });
  document.getElementById('cal-colors-reset').addEventListener('click', () => {
    resetCalendarColors();
    toast('Kalenderfarben zurückgesetzt');
    render();
  });

  document.getElementById('export-json').addEventListener('click', async () => {
    const data = await exportAllData();
    download(`trainingslog-backup-${todayKey()}.json`, JSON.stringify(data, null, 2));
    saveSettings({ lastBackupAt: todayKey() });
    toast('Backup exportiert');
    render();
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
    const rows = [['Datum', 'Routine', 'Übung', 'Satz', 'Modus', 'Wiederholungen', 'Dauer (Sek.)', 'Gewicht', 'Distanz (km)', 'Watt', 'km/h', 'RPM', 'Aufwärmsatz', 'Erledigt']];
    for (const s of sessions) {
      for (const ex of s.exercises) {
        const isTime = ex.mode === 'time';
        const isCardio = ex.mode === 'cardio';
        ex.sets.forEach((set, i) => {
          rows.push([
            s.startedAt.slice(0, 10), s.routineName, ex.exerciseName, i + 1,
            isCardio ? 'Cardio' : isTime ? 'Zeit' : 'Wiederholungen',
            isCardio || isTime ? '' : set.reps,
            isCardio || isTime ? set.seconds : '',
            isCardio ? '' : set.weight,
            isCardio ? (set.distance ?? '') : '',
            isCardio ? (set.watt ?? '') : '',
            isCardio ? (set.speed ?? '') : '',
            isCardio ? (set.rpm ?? '') : '',
            set.isWarmup ? 'ja' : 'nein', set.done ? 'ja' : 'nein',
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

/** Dezenter Hinweis, wenn das letzte Backup lange her ist (oder nie gemacht wurde). */
function backupReminderHtml(lastBackupAt) {
  const days = lastBackupAt ? daysSince(lastBackupAt) : null;
  if (days !== null && days < 30) return '';
  return `
    <div class="card" style="border-color:var(--warn); margin-bottom:12px">
      <p class="faint">
        ${lastBackupAt
          ? `Letztes Backup vor ${days} Tagen.`
          : 'Noch kein Backup erstellt.'}
        Da alle Daten nur lokal gespeichert sind, gehen sie bei Geräteverlust/-reset sonst verloren.
      </p>
    </div>
  `;
}

function daysSince(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const then = new Date(Date.UTC(y, m - 1, d));
  const now = new Date();
  const nowUtc = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  return Math.round((nowUtc - then) / 86400000);
}

function csvEscape(v) {
  const s = String(v ?? '');
  return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
