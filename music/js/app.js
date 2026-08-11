import { addRoute, startRouter } from './router.js';
import { getSettings, isConnected } from './db.js';
import { applyTheme } from './theme.js';
import { initPlayer } from './player.js';
import { renderConnect } from './views/connect.js';

import * as home from './views/home.js';
import * as library from './views/library.js';
import * as artist from './views/artist.js';
import * as album from './views/album.js';
import * as playlist from './views/playlist.js';
import * as downloads from './views/downloads.js';
import * as local from './views/local.js';
import * as more from './views/more.js';

applyTheme(getSettings());

function boot() {
  if (!isConnected()) {
    renderConnect({ onSuccess: startApp });
    return;
  }
  startApp();
}

function startApp() {
  const tabbar = document.getElementById('tabbar');
  if (tabbar) tabbar.style.display = '';

  addRoute('/', 'home', () => home.render());
  addRoute('/library', 'library', () => library.render());
  addRoute('/artist/:id', 'library', (p) => artist.render(p));
  addRoute('/album/:id', 'library', (p) => album.render(p));
  addRoute('/playlist/:id', 'library', (p) => playlist.render(p));
  addRoute('/downloads', 'downloads', () => downloads.render());
  addRoute('/local', 'more', () => local.render());
  addRoute('/more', 'more', () => more.render());

  initPlayer();

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
