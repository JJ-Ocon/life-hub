import { addRoute, startRouter } from './router.js';
import { getSettings } from './db.js';
import { applyTheme } from './theme.js';

import * as home from './views/home.js';
import * as vehicles from './views/vehicles.js';
import * as compare from './views/compare.js';
import * as more from './views/more.js';

applyTheme(getSettings());

addRoute('/', 'home', () => home.render());
addRoute('/vehicles', 'vehicles', () => vehicles.render());
addRoute('/vehicle/:id', 'vehicles', (p) => vehicles.renderDetail(p));
addRoute('/compare', 'compare', () => compare.render());
addRoute('/more', 'more', () => more.render());

startRouter();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* Offline-Support optional */ });
  });
}
