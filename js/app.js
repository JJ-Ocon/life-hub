import { addRoute, startRouter } from './router.js';
import { getActiveSession, getSettings } from './db.js';
import { applyTheme } from './theme.js';
import { formatDuration } from './utils.js';

import * as home from './views/home.js';
import * as routines from './views/routines.js';
import * as routineEdit from './views/routine-edit.js';
import * as session from './views/workout-session.js';
import * as history from './views/history.js';
import * as stats from './views/stats.js';
import * as body from './views/body.js';
import * as calendar from './views/calendar.js';
import * as more from './views/more.js';

applyTheme(getSettings());

addRoute('/', 'home', () => home.render());
addRoute('/routines', 'routines', () => routines.render());
addRoute('/routines/:id/edit', 'routines', (p) => routineEdit.render(p));
addRoute('/session', 'home', () => session.render());
addRoute('/stats', 'stats', () => stats.render());
addRoute('/history', 'stats', () => history.renderList());
addRoute('/history/:id', 'stats', (p) => history.renderDetail(p));
addRoute('/body', 'body', () => body.render());
addRoute('/calendar', 'calendar', () => calendar.render());
addRoute('/more', 'more', () => more.render());

startRouter();

/* ---------- Leiste fuer laufendes Training (ueber alle Views hinweg) ---------- */

const sessionBar = document.getElementById('session-bar');
const sessionBarTime = document.getElementById('session-bar-time');
document.getElementById('session-bar-open').addEventListener('click', () => { location.hash = '#/session'; });

function tickSessionBar() {
  const active = getActiveSession();
  const onSessionView = location.hash.replace(/^#/, '') === '/session';
  if (active && !onSessionView) {
    sessionBar.hidden = false;
    const elapsed = (Date.now() - new Date(active.startedAt)) / 1000;
    sessionBarTime.textContent = formatDuration(elapsed);
  } else {
    sessionBar.hidden = true;
  }
}
setInterval(tickSessionBar, 1000);
window.addEventListener('hashchange', tickSessionBar);
tickSessionBar();

/* ---------- Service Worker (Offline-Faehigkeit) ---------- */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* Offline-Support optional */ });
  });
}
