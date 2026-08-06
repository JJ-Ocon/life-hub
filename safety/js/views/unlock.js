import { setTitle, setActions, setBack, render } from '../router.js';
import { hasVault, setupVault, unlockVault } from '../db.js';
import { toast } from '../ui.js';

function lockIcon() {
  return `<svg viewBox="0 0 24 24" class="unlock-icon"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>`;
}

export function renderUnlock({ onSuccess }) {
  const tabbar = document.getElementById('tabbar');
  if (tabbar) tabbar.style.display = 'none';
  setBack(null);
  setActions('');

  if (hasVault()) drawUnlock(onSuccess);
  else drawSetup(onSuccess);
}

function drawSetup(onSuccess) {
  setTitle('Digitaler Safe einrichten');
  render(`
    <div class="unlock-screen">
      ${lockIcon()}
      <h2>Passphrase festlegen</h2>
      <p class="faint" style="text-align:center;margin-bottom:20px">
        Deine Dokumente werden ausschließlich auf diesem Gerät verschlüsselt gespeichert.
        Es gibt <strong>keine Wiederherstellung</strong> bei vergessener Passphrase — merke sie dir gut
        oder notiere sie an einem sicheren Ort außerhalb dieser App.
      </p>
      <div class="field">
        <label>Passphrase (mind. 8 Zeichen)</label>
        <input class="input" type="password" id="pass1" autocomplete="new-password">
      </div>
      <div class="field">
        <label>Passphrase wiederholen</label>
        <input class="input" type="password" id="pass2" autocomplete="new-password">
      </div>
      <button class="btn btn-primary" id="setup-go">Vault erstellen</button>
    </div>
  `);
  const p1 = document.getElementById('pass1');
  const p2 = document.getElementById('pass2');
  p1.focus();
  const submit = async () => {
    if (p1.value.length < 8) { toast('Mindestens 8 Zeichen'); return; }
    if (p1.value !== p2.value) { toast('Passphrasen stimmen nicht überein'); return; }
    await setupVault(p1.value);
    onSuccess();
  };
  p2.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  document.getElementById('setup-go').addEventListener('click', submit);
}

function drawUnlock(onSuccess) {
  setTitle('Entsperren');
  render(`
    <div class="unlock-screen">
      ${lockIcon()}
      <h2>Digitaler Safe</h2>
      <div class="field">
        <label>Passphrase</label>
        <input class="input" type="password" id="pass" autocomplete="current-password">
      </div>
      <p class="faint" id="unlock-error" style="color:var(--danger);min-height:1.2em"></p>
      <button class="btn btn-primary" id="unlock-go">Entsperren</button>
    </div>
  `);
  const input = document.getElementById('pass');
  input.focus();
  const submit = async () => {
    if (!input.value) return;
    try {
      await unlockVault(input.value);
      onSuccess();
    } catch {
      document.getElementById('unlock-error').textContent = 'Falsche Passphrase.';
      input.select();
    }
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  document.getElementById('unlock-go').addEventListener('click', submit);
}
