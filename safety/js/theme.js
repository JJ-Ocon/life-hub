import { getSettings } from './db.js';

export function applyTheme(settings = getSettings()) {
  document.documentElement.setAttribute('data-theme', settings.theme);
  document.documentElement.style.setProperty('--accent-h', settings.accentHue);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    if (bg) meta.setAttribute('content', bg);
  }
}
