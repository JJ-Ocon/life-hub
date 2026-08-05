// Minimaler Hash-Router mit Topbar-/Tabbar-Steuerung.

const viewEl = document.getElementById('view');
const titleEl = document.getElementById('topbar-title');
const backBtn = document.getElementById('topbar-back');
const actionsEl = document.getElementById('topbar-actions');
const tabbar = document.getElementById('tabbar');

const routes = []; // { regex, keys, tab, load }
let currentCleanup = null;
let backOverride = null;

export function addRoute(pattern, tab, load) {
  const keys = [];
  const regex = new RegExp('^' + pattern.replace(/:[^/]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; }) + '$');
  routes.push({ regex, keys, tab, load });
}

export function setTitle(text) {
  titleEl.textContent = text;
}

export function setActions(html) {
  actionsEl.innerHTML = html;
  return actionsEl;
}

export function setBack(onClick) {
  backOverride = onClick;
  backBtn.hidden = !onClick;
}

export function navigate(hash) {
  location.hash = hash;
}

export function goBack(fallback = '#/') {
  if (backOverride) { backOverride(); return; }
  if (history.length > 1) history.back(); else navigate(fallback);
}

backBtn.addEventListener('click', () => goBack());

function setActiveTab(tab) {
  tabbar.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
}

async function resolve() {
  const hash = location.hash.replace(/^#/, '') || '/';
  const path = hash.split('?')[0];

  for (const r of routes) {
    const m = path.match(r.regex);
    if (!m) continue;
    const params = {};
    r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });

    if (typeof currentCleanup === 'function') {
      try { currentCleanup(); } catch { /* ignore */ }
    }
    currentCleanup = null;
    setActions('');
    setBack(null);
    setActiveTab(r.tab);
    viewEl.scrollTop = 0;
    viewEl.focus({ preventScroll: true });

    const result = await r.load(params);
    if (typeof result === 'function') currentCleanup = result;
    return;
  }
  viewEl.innerHTML = `<div class="empty"><h3>Seite nicht gefunden</h3></div>`;
}

window.addEventListener('hashchange', resolve);

export function startRouter() {
  resolve();
}

export function render(html) {
  viewEl.innerHTML = html;
}

export { viewEl };
