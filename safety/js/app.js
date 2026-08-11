import { addRoute, startRouter } from './router.js';
import { getSettings, isUnlocked } from './db.js';
import { applyTheme } from './theme.js';
import { renderUnlock } from './views/unlock.js';

import * as home from './views/home.js';
import * as documents from './views/documents.js';
import * as more from './views/more.js';

applyTheme(getSettings());

function boot() {
  if (!isUnlocked()) {
    renderUnlock({ onSuccess: startApp });
    return;
  }
  startApp();
}

function startApp() {
  const tabbar = document.getElementById('tabbar');
  if (tabbar) tabbar.style.display = '';

  addRoute('/', 'home', () => home.render());
  addRoute('/documents', 'documents', () => documents.render());
  addRoute('/more', 'more', () => more.render());

  // history.replaceState statt location.hash= (E66): letzteres wuerde einen
  // zusaetzlichen History-Eintrag erzeugen, wodurch "Zurueck" auf der
  // Startseite nicht direkt zum Hub fuehrt, sondern erst zu diesem
  // Zwischenzustand mit leerem Hash.
  if (!location.hash || location.hash === '#') history.replaceState(null, '', location.pathname + '#/');
  startRouter();
}

boot();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* Offline-Support optional */ });
  });
}
