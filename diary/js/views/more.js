import { setTitle, setActions, setBack } from '../router.js';
import {
  getSettings, saveSettings, lockVault, changePassphrase,
  exportEncryptedBackup, importEncryptedBackup, resetVault,
} from '../db.js';
import { applyTheme } from '../theme.js';
import { confirmDialog, toast, promptDialog, openModal } from '../ui.js';
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

    <div class="section-title">Sicherheit</div>
    <div class="card stack">
      <button class="btn btn-ghost" id="lock-now">🔒 Jetzt sperren</button>
      <button class="btn btn-ghost" id="change-pass">Passphrase ändern</button>
    </div>

    <div class="section-title">Daten</div>
    <div class="card stack">
      <button class="btn btn-ghost" id="export-json">Verschlüsseltes Backup exportieren</button>
      <label class="btn btn-ghost" for="import-json">Verschlüsseltes Backup importieren</label>
      <input type="file" id="import-json" accept="application/json" hidden>
      <button class="btn btn-danger" id="reset-all">Vault vollständig löschen</button>
    </div>

    <div class="section-title">Über die App</div>
    <div class="card">
      <p class="faint">Tagebuch · Version 1.1</p>
      <p class="faint" style="margin-top:6px">Deine Stimmungsdaten und Reflexionen werden clientseitig verschlüsselt (AES-GCM) und bleiben ausschließlich auf diesem Gerät. Ohne Passphrase gibt es keine Wiederherstellung.</p>
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

  document.getElementById('lock-now').addEventListener('click', () => {
    lockVault();
    location.reload();
  });

  document.getElementById('change-pass').addEventListener('click', () => {
    const handle = openModal(`
      <h3 class="modal-title">Passphrase ändern</h3>
      <div class="field"><label>Aktuelle Passphrase</label><input class="input" type="password" id="cp-old"></div>
      <div class="field"><label>Neue Passphrase (mind. 8 Zeichen)</label><input class="input" type="password" id="cp-new"></div>
      <div class="field"><label>Neue Passphrase wiederholen</label><input class="input" type="password" id="cp-new2"></div>
      <button class="btn btn-primary" id="cp-go">Ändern</button>
    `, { center: true });
    handle.sheet.querySelector('#cp-go').addEventListener('click', async () => {
      const oldP = handle.sheet.querySelector('#cp-old').value;
      const newP = handle.sheet.querySelector('#cp-new').value;
      const newP2 = handle.sheet.querySelector('#cp-new2').value;
      if (newP.length < 8) { toast('Mindestens 8 Zeichen'); return; }
      if (newP !== newP2) { toast('Neue Passphrasen stimmen nicht überein'); return; }
      try {
        await changePassphrase(oldP, newP);
        toast('Passphrase geändert');
        handle.close();
      } catch (err) {
        toast(err.message || 'Fehlgeschlagen');
      }
    });
  });

  document.getElementById('export-json').addEventListener('click', () => {
    const data = exportEncryptedBackup();
    download(`tagebuch-backup-${todayKey()}.json`, JSON.stringify(data, null, 2));
    toast('Verschlüsseltes Backup exportiert');
  });

  document.getElementById('import-json').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const ok = await confirmDialog(
      'Backup importieren?',
      'Der aktuelle Vault wird durch die Datei ersetzt. Du musst dich danach mit der Passphrase entsperren, die beim Erstellen dieses Backups galt.',
      'Importieren', false
    );
    if (!ok) return;
    try {
      const text = await readFileAsText(file);
      const data = JSON.parse(text);
      importEncryptedBackup(data);
      toast('Import erfolgreich, bitte entsperren');
      location.reload();
    } catch {
      toast('Import fehlgeschlagen: ungültige Datei');
    }
  });

  document.getElementById('reset-all').addEventListener('click', async () => {
    const ok = await confirmDialog('Vault wirklich vollständig löschen?', 'Alle Tagebuch-Einträge werden unwiderruflich gelöscht. Dies kann nicht rückgängig gemacht werden.', 'Alles löschen', true);
    if (!ok) return;
    const typed = await promptDialog('Zur Bestätigung "LÖSCHEN" eingeben', { placeholder: 'LÖSCHEN' });
    if (typed !== 'LÖSCHEN') { toast('Abgebrochen'); return; }
    resetVault();
    toast('Vault gelöscht');
    location.reload();
  });
}
