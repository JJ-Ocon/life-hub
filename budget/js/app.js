import { addRoute, startRouter } from './router.js';
import { getSettings, accrueEnvelopes } from './db.js';
import { applyTheme } from './theme.js';

import * as home from './views/home.js';
import * as expenses from './views/expenses.js';
import * as categories from './views/categories.js';
import * as savings from './views/savings.js';
import * as stats from './views/stats.js';
import * as more from './views/more.js';

applyTheme(getSettings());
accrueEnvelopes(); // monatliche Sparumschlag-Zufuehrung, idempotent

addRoute('/', 'home', () => home.render());
addRoute('/expenses', 'expenses', () => expenses.render());
addRoute('/categories', 'categories', () => categories.render());
addRoute('/savings', 'savings', () => savings.render());
addRoute('/stats', 'stats', () => stats.render());
addRoute('/more', 'more', () => more.render());

startRouter();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* Offline-Support optional */ });
  });
}
