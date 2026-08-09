import { addRoute, startRouter } from './router.js';
import { getSettings, isUnlocked } from './db.js';
import { applyTheme } from './theme.js';
import { renderUnlock } from './views/unlock.js';

import * as home from './views/home.js';
import * as history from './views/history.js';
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
  addRoute('/history', 'history', () => history.render());
  addRoute('/more', 'more', () => more.render());

  if (!location.hash || location.hash === '#') location.hash = '#/';
  startRouter();
}

boot();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* Offline-Support optional */ });
  });
}
