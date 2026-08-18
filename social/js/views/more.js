import { setTitle, setActions, setBack } from '../router.js';
import { getSettings, saveSettings, exportAllData, importAllData, resetAllData } from '../db.js';
import { getMe, saveMe, getPeople, createPerson } from '../../../shared/contacts.js';
import { generateVcf, parseVcf } from '../../../shared/vcard.js';
import { applyTheme } from '../theme.js';
import { openModal, confirmDialog, toast, promptDialog } from '../ui.js';
import { download, readFileAsText, todayKey, escapeHtml } from '../utils.js';

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
  const me = getMe();

  document.getElementById('view').innerHTML = `
    <div class="section-title" style="margin-top:0">Ich</div>
    <div class="card">
      <div class="field" style="margin:0">
        <label>Name im Netzwerk-Graphen (Mittelpunkt)</label>
        <input class="input" id="me-name" value="${escapeHtml(me.name)}" placeholder="Ich">
      </div>
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
      <button class="btn btn-ghost" id="export-vcf">Kontakte exportieren (.vcf)</button>
      <label class="btn btn-ghost" for="import-vcf">Kontakte importieren (.vcf)</label>
      <input type="file" id="import-vcf" accept=".vcf,text/vcard" hidden>
      <button class="btn btn-danger" id="reset-all">Alle Daten löschen</button>
    </div>

    <div class="section-title">Über die App</div>
    <div class="card">
      <p class="faint">Social · Version 1.0</p>
      <p class="faint" style="margin-top:6px">Alle Daten bleiben ausschließlich lokal auf diesem Gerät gespeichert - diese Kontaktdatenbank läuft über dich selbst, nicht über einen Drittanbieter.</p>
    </div>
  `;

  document.getElementById('me-name').addEventListener('blur', (e) => {
    const name = e.target.value.trim() || 'Ich';
    saveMe({ name });
    e.target.value = name;
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
    download(`social-backup-${todayKey()}.json`, JSON.stringify(data, null, 2));
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

  document.getElementById('export-vcf').addEventListener('click', () => {
    const people = getPeople();
    if (!people.length) { toast('Noch keine Kontakte zum Exportieren'); return; }
    download(`social-kontakte-${todayKey()}.vcf`, generateVcf(people), 'text/vcard');
    toast(`${people.length} Kontakt${people.length === 1 ? '' : 'e'} exportiert`);
  });

  document.getElementById('import-vcf').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let cards;
    try {
      cards = parseVcf(await readFileAsText(file));
    } catch {
      toast('Import fehlgeschlagen: ungültige Datei');
      return;
    }
    if (!cards.length) { toast('Keine Kontakte in dieser Datei gefunden'); return; }
    openVcfImportModal(cards);
  });

  document.getElementById('reset-all').addEventListener('click', async () => {
    const ok = await confirmDialog('Wirklich alle Daten löschen?', 'Alle Kontakte, das Beziehungs-Log und Verknüpfungen werden unwiderruflich gelöscht.', 'Alles löschen', true);
    if (!ok) return;
    const typed = await promptDialog('Zur Bestätigung "LÖSCHEN" eingeben', { placeholder: 'LÖSCHEN' });
    if (typed !== 'LÖSCHEN') { toast('Abgebrochen'); return; }
    resetAllData();
    toast('Alle Daten wurden gelöscht');
    location.hash = '#/';
    setTimeout(() => location.reload(), 400);
  });
}

/** Bestaetigungsliste vor dem Anlegen (gleiches Muster wie Meals/Budgets
 *  Kassenbon-Kandidatenliste, E63/E-Meal-Budget-Mapping) - ein .vcf-Export
 *  vom Handy landet sonst ungeprueft als Bulk-Import, was bei bereits
 *  vorhandenen Kontakten leicht zu Dubletten fuehren wuerde. Namen, die exakt
 *  mit einem bestehenden Kontakt uebereinstimmen, sind vorab abgewaehlt. */
function openVcfImportModal(cards) {
  const existingNames = new Set(getPeople().map((p) => p.name.trim().toLowerCase()));
  const handle = openModal(`
    <h3 class="modal-title">${cards.length} Kontakt${cards.length === 1 ? '' : 'e'} gefunden</h3>
    <div class="stack" style="max-height:50vh;overflow-y:auto">
      ${cards.map((c, i) => {
        const isDupe = existingNames.has(c.name.trim().toLowerCase());
        return `
          <label class="row" style="gap:8px;align-items:center">
            <input type="checkbox" id="vc-check-${i}" ${isDupe ? '' : 'checked'}>
            <span class="col grow">
              <span>${escapeHtml(c.name)}</span>
              ${isDupe ? '<span class="faint"> · vermutlich schon vorhanden</span>' : ''}
            </span>
          </label>
        `;
      }).join('')}
    </div>
    <button class="btn btn-primary" id="vc-import-selected" style="margin-top:14px">Ausgewählte importieren</button>
  `, { center: true });

  handle.sheet.querySelector('#vc-import-selected').addEventListener('click', () => {
    let added = 0;
    cards.forEach((c, i) => {
      if (!handle.sheet.querySelector(`#vc-check-${i}`).checked) return;
      createPerson({ name: c.name, phone: c.phone || '', email: c.email || '', birthday: c.birthday || null, role: c.role || '' });
      added++;
    });
    toast(`${added} Kontakt${added === 1 ? '' : 'e'} importiert`);
    handle.close();
    render();
  });
}
