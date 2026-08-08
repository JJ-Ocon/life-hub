// Buendelt Export/Import aller Sub-Apps in einer Datei - fuer den
// Geraetewechsel. Jede App bleibt weiterhin einzeln ueber ihren eigenen
// "Mehr"-Bereich sicherbar; das hier ruft pro App lediglich die gleichen
// exportAllData()/importAllData()-Funktionen (dynamischer Import von
// ./<app>/js/db.js, alle Sub-Apps liegen ja auf dem selben Origin) auf,
// die die einzelnen Apps schon fuer ihr eigenes Backup nutzen.

const APPS = [
  { id: 'fitness', label: 'Trainingslog' },
  { id: 'budget', label: 'Budget' },
  { id: 'meal', label: 'Meal Planning' },
  { id: 'notes', label: 'Notizen' },
  { id: 'goals', label: 'Ziele & Todo' },
  { id: 'social', label: 'Social' },
  { id: 'job', label: 'Job' },
  { id: 'household', label: 'Haushalt' },
  { id: 'safety', label: 'Digitaler Safe' },
  { id: 'possessions', label: 'Inventar' },
  { id: 'learning', label: 'Lernen' },
  { id: 'travel', label: 'Reisen' },
  { id: 'cosmetics', label: 'Kosmetik' },
  { id: 'diary', label: 'Tagebuch' },
  { id: 'music', label: 'Musik' },
  { id: 'vehicle', label: 'Fahrzeug' },
];

const logCard = document.getElementById('backup-log-card');
const logEl = document.getElementById('backup-log');

function resetLog() {
  logCard.hidden = false;
  logEl.innerHTML = '';
}

function log(text, kind = '') {
  const row = document.createElement('div');
  row.className = 'backup-log__row' + (kind ? ` backup-log__row--${kind}` : '');
  row.textContent = text;
  logEl.appendChild(row);
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsText(file);
  });
}

async function exportAll() {
  resetLog();
  const bundle = { app: 'life-hub-backup', version: 1, exportedAt: new Date().toISOString(), apps: {} };
  for (const { id, label } of APPS) {
    try {
      const mod = await import(`./${id}/js/db.js`);
      if (typeof mod.exportEncryptedBackup === 'function') {
        bundle.apps[id] = { encrypted: true, payload: mod.exportEncryptedBackup() };
        log(`${label}: ok (bleibt verschlüsselt)`, 'ok');
      } else if (typeof mod.exportAllData === 'function') {
        bundle.apps[id] = await mod.exportAllData();
        log(`${label}: ok`, 'ok');
      } else {
        log(`${label}: übersprungen (kein Export vorhanden)`, 'warn');
      }
    } catch (err) {
      log(`${label}: übersprungen (${err.message})`, 'warn');
    }
  }
  const filename = `life-hub-backup-${todayKey()}.json`;
  downloadJson(filename, bundle);
  log(`Fertig – ${filename} heruntergeladen.`, 'done');
}

async function importAll(bundle) {
  resetLog();
  if (!bundle || typeof bundle.apps !== 'object') {
    log('Ungültige Backup-Datei – kein Life-Hub-Bundle erkannt.', 'error');
    return;
  }
  for (const { id, label } of APPS) {
    const payload = bundle.apps[id];
    if (payload === undefined) { log(`${label}: nicht im Backup enthalten`, 'warn'); continue; }
    try {
      const mod = await import(`./${id}/js/db.js`);
      if (payload?.encrypted && typeof mod.importEncryptedBackup === 'function') {
        mod.importEncryptedBackup(payload.payload);
        log(`${label}: importiert (weiterhin mit Passphrase entsperren)`, 'ok');
      } else if (typeof mod.importAllData === 'function') {
        await mod.importAllData(payload);
        log(`${label}: importiert`, 'ok');
      } else {
        log(`${label}: übersprungen (kein Import vorhanden)`, 'warn');
      }
    } catch (err) {
      log(`${label}: Fehler – ${err.message}`, 'error');
    }
  }
  log('Fertig. Apps neu laden, um alle Änderungen zu sehen.', 'done');
}

document.getElementById('export-all').addEventListener('click', () => {
  exportAll();
});

document.getElementById('import-all-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const ok = window.confirm(
    'Alles importieren? Bestehende Daten in allen Apps mit gleichen IDs werden überschrieben. ' +
    'Nur fortfahren, wenn du dem Ursprung dieser Datei vertraust.'
  );
  if (!ok) return;
  try {
    const bundle = JSON.parse(await readFileAsText(file));
    await importAll(bundle);
  } catch {
    resetLog();
    log('Import fehlgeschlagen: ungültige Datei.', 'error');
  }
});
