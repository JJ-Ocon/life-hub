import { addRoute, startRouter } from './router.js';
import { getSettings } from './db.js';
import { applyTheme } from './theme.js';

import * as trips from './views/trips.js';
import * as tripDetail from './views/trip-detail.js';
import * as more from './views/more.js';

applyTheme(getSettings());

addRoute('/', 'trips', () => trips.render());
addRoute('/trip/:id', 'trips', (params) => tripDetail.render(params.id));
addRoute('/more', 'more', () => more.render());

startRouter();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* Offline-Support optional */ });
  });
}
