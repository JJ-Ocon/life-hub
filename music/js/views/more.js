import { setTitle, setActions, setBack } from '../router.js';
import { getSettings, saveSettings, getConfig, disconnect, resetAllData } from '../db.js';
import { applyTheme } from '../theme.js';
import { confirmDialog, toast, promptDialog } from '../ui.js';
import { escapeHtml } from '../utils.js';

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
  const cfg = getConfig();

  document.getElementById('view').innerHTML = `
    <div class="section-title" style="margin-top:0">Server-Verbindung</div>
    <div class="card">
      <div class="row row--between">
        <div class="col">
          <div class="faint">Server</div>
          <div>${escapeHtml(cfg.serverUrl)}</div>
        </div>
      </div>
      <div class="row row--between" style="margin-top:10px">
        <div class="col">
          <div class="faint">Benutzer</div>
          <div>${escapeHtml(cfg.username)}</div>
        </div>
      </div>
      <button class="btn btn-danger" id="disconnect" style="margin-top:14px">Verbindung trennen</button>
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
      <button class="btn btn-danger" id="reset-all">Alle App-Daten löschen</button>
      <p class="faint">Löscht gespeicherte Zugangsdaten, Einstellungen und alle Offline-Downloads. Deine Musik auf dem Server bleibt unangetastet.</p>
    </div>

    <div class="section-title">Über die App</div>
    <div class="card">
      <p class="faint">Musik · Version 1.0</p>
      <p class="faint" style="margin-top:6px">Streamt von deinem eigenen Navidrome-Server über Tailscale. Downloads werden lokal auf diesem Gerät gespeichert.</p>
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

  document.getElementById('disconnect').addEventListener('click', async () => {
    const ok = await confirmDialog('Verbindung trennen?', 'Zugangsdaten werden von diesem Gerät entfernt. Offline-Downloads bleiben erhalten.', 'Trennen', true);
    if (!ok) return;
    disconnect();
    location.reload();
  });

  document.getElementById('reset-all').addEventListener('click', async () => {
    const ok = await confirmDialog('Wirklich alle App-Daten löschen?', 'Zugangsdaten, Einstellungen und alle Offline-Downloads werden entfernt.', 'Alles löschen', true);
    if (!ok) return;
    const typed = await promptDialog('Zur Bestätigung "LÖSCHEN" eingeben', { placeholder: 'LÖSCHEN' });
    if (typed !== 'LÖSCHEN') { toast('Abgebrochen'); return; }
    await resetAllData();
    toast('Alle Daten wurden gelöscht');
    setTimeout(() => location.reload(), 400);
  });
}
