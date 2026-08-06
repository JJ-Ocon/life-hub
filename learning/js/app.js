import { addRoute, startRouter } from './router.js';
import { getSettings } from './db.js';
import { applyTheme } from './theme.js';

import * as home from './views/home.js';
import * as skills from './views/skills.js';
import * as more from './views/more.js';

applyTheme(getSettings());

addRoute('/', 'home', () => home.render());
addRoute('/skills', 'skills', () => skills.render());
addRoute('/more', 'more', () => more.render());

startRouter();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* Offline-Support optional */ });
  });
}
