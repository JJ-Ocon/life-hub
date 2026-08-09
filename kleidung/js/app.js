import { addRoute, startRouter } from './router.js';
import { getSettings } from './db.js';
import { applyTheme } from './theme.js';
import * as wardrobe from './views/wardrobe.js';
import * as more from './views/more.js';

applyTheme(getSettings());
addRoute('/', 'wardrobe', () => wardrobe.render());
addRoute('/more', 'more', () => more.render());
startRouter();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
