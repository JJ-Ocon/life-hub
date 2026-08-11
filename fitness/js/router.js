// Minimaler Hash-Router mit Topbar-/Tabbar-Steuerung.

const viewEl = document.getElementById('view');
const titleEl = document.getElementById('topbar-title');
const backBtn = document.getElementById('topbar-back');
const actionsEl = document.getElementById('topbar-actions');
const tabbar = document.getElementById('tabbar');

const routes = []; // { regex, keys, tab, load }
let currentCleanup = null;
let backOverride = null;
let lastResolvedHash = location.hash;
// Markiert einen Hash-Wechsel als von unserem eigenen Code ausgeloest (E66) -
// noetig, weil manche Browser-Umgebungen (u.a. die hier genutzte Vorschau-
// Sandbox) auch fuer eine simple location.hash=-Zuweisung ein popstate
// synthetisieren, nicht nur fuer echtes Browser-Zurueck/Vorwaerts. Ohne
// dieses Flag wuerde der eigene Zurueck-Handler unten faelschlich auch auf
// Hash-Wechsel reagieren, die backOverride() selbst gerade ausgeloest hat -
// das wuerde die eigene Navigation sofort wieder rueckgaengig machen und
// backOverride() erneut aufrufen (bei einem Bestaetigungsdialog: der Dialog
// erscheint nach "Bestaetigen" scheinbar erneut, statt die Seite zu verlassen).
let programmaticNav = false;

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
  programmaticNav = true;
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
    lastResolvedHash = location.hash;
    return;
  }
  viewEl.innerHTML = `<div class="empty"><h3>Seite nicht gefunden</h3></div>`;
}

window.addEventListener('hashchange', resolve);

/** Hardware-/Geste-Zurueck (E66) soll sich exakt wie der eingebaute
 *  Zurueck-Pfeil verhalten - insbesondere fuer Views mit eigener
 *  Zurueck-Logik (z.B. Autosave vor dem Verlassen, oder eine Bestaetigung
 *  bei ungesicherten Daten), die sonst beim nativen Zurueck-Sprung komplett
 *  uebersprungen wuerde. Der Browser hat den Hash zum Zeitpunkt von
 *  popstate schon geaendert; hier wird das per pushState rueckgaengig
 *  gemacht und stattdessen backOverride() aufgerufen. Ist kein backOverride
 *  gesetzt (z.B. auf einer Top-Level-Ansicht), greift ganz normal die
 *  native Browser-Navigation - das fuehrt dort bereits korrekt zurueck zum
 *  Hub, da keine ueberzaehligen History-Eintraege im Weg stehen. */
window.addEventListener('popstate', () => {
  if (programmaticNav) { programmaticNav = false; return; }
  if (!backOverride) return;
  programmaticNav = true;
  history.pushState(null, '', location.pathname + lastResolvedHash);
  backOverride();
});

export function startRouter() {
  resolve();
}

export function render(html) {
  viewEl.innerHTML = html;
}

export { viewEl };
