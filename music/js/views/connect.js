import { setTitle, setActions, setBack, render } from '../router.js';
import { saveConfig } from '../db.js';
import { testConnection } from '../api.js';
import { toast } from '../ui.js';

function musicIcon() {
  return `<svg viewBox="0 0 24 24" class="connect-icon"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
}

function normalizeUrl(raw) {
  let s = raw.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  return s;
}

export function renderConnect({ onSuccess }) {
  const tabbar = document.getElementById('tabbar');
  if (tabbar) tabbar.style.display = 'none';
  const bar = document.getElementById('player-bar');
  if (bar) bar.hidden = true;
  setBack(null);
  setActions('');
  setTitle('Verbinden');

  render(`
    <div class="connect-screen">
      ${musicIcon()}
      <h2>Mit Navidrome verbinden</h2>
      <p class="faint" style="text-align:center;margin-bottom:20px">
        Server-Adresse und Zugangsdaten deines Heim-Servers. Nur über das Tailscale-Netz erreichbar,
        nicht über das offene Internet.
      </p>
      <div class="field">
        <label>Server-URL</label>
        <input class="input" id="c-url" placeholder="http://100.x.x.x:4533" autocapitalize="off" autocorrect="off">
      </div>
      <div class="field">
        <label>Benutzername</label>
        <input class="input" id="c-user" autocapitalize="off" autocorrect="off">
      </div>
      <div class="field">
        <label>Passwort</label>
        <input class="input" type="password" id="c-pass" autocomplete="current-password">
      </div>
      <p class="faint" id="c-error" style="color:var(--danger);min-height:1.2em"></p>
      <button class="btn btn-primary" id="c-go">Verbinden</button>
    </div>
  `);

  const urlInput = document.getElementById('c-url');
  const userInput = document.getElementById('c-user');
  const passInput = document.getElementById('c-pass');
  const errorEl = document.getElementById('c-error');
  const goBtn = document.getElementById('c-go');
  urlInput.focus();

  const submit = async () => {
    const serverUrl = normalizeUrl(urlInput.value);
    const username = userInput.value.trim();
    const password = passInput.value;
    if (!urlInput.value.trim() || !username || !password) {
      errorEl.textContent = 'Bitte alle Felder ausfüllen.';
      return;
    }
    errorEl.textContent = '';
    goBtn.disabled = true;
    goBtn.textContent = 'Verbinde…';
    try {
      await testConnection({ serverUrl, username, password });
      saveConfig({ serverUrl, username, password });
      toast('Verbunden');
      onSuccess();
    } catch (err) {
      errorEl.textContent = err.message || 'Verbindung fehlgeschlagen.';
    } finally {
      goBtn.disabled = false;
      goBtn.textContent = 'Verbinden';
    }
  };

  [urlInput, userInput, passInput].forEach((el) => {
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  });
  goBtn.addEventListener('click', submit);
}
