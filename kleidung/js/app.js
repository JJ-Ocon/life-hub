import { addRoute, startRouter } from './router.js';
import { getSettings } from './db.js';
import { applyTheme } from './theme.js';
import * as wardrobe from './views/wardrobe.js';
import * as style from './views/style.js';
import * as wishlist from './views/wishlist.js';
import * as more from './views/more.js';

applyTheme(getSettings());
addRoute('/', 'wardrobe', () => wardrobe.render());
addRoute('/style', 'style', () => style.render());
addRoute('/wishlist', 'wishlist', () => wishlist.render());
addRoute('/more', 'more', () => more.render());
startRouter();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
