import { addRoute, startRouter } from './router.js';
import { getSettings } from './db.js';
import { applyTheme } from './theme.js';

import * as home from './views/home.js';
import * as history from './views/history.js';
import * as more from './views/more.js';

applyTheme(getSettings());

addRoute('/', 'home', () => home.render());
addRoute('/history', 'history', () => history.render());
addRoute('/more', 'more', () => more.render());

startRouter();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* Offline-Support optional */ });
  });
}
