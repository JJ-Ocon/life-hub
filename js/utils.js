// Kleine, abhaengigkeitsfreie Helferfunktionen.

export function uid() {
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
}

export function nowIso() {
  return new Date().toISOString();
}

export function todayKey(date = new Date()) {
  // lokales Datum YYYY-MM-DD (kein UTC-Versatz)
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

export function formatDate(iso, { withWeekday = false, withYear = false } = {}) {
  const d = new Date(iso);
  const s = `${d.getDate()}. ${MONTHS[d.getMonth()]}${withYear ? ' ' + d.getFullYear() : ''}`;
  return withWeekday ? `${WEEKDAYS[d.getDay()]}, ${s}` : s;
}

export function formatDateShort(iso) {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getFullYear()).slice(2)}`;
}

export function formatTime(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function formatNum(n, digits = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return '–';
  const r = Math.round(n * 10 ** digits) / 10 ** digits;
  return r % 1 === 0 ? String(r) : r.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '');
}

export function startOfWeek(date) {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7; // Montag = 0
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d;
}

export function isoWeekKey(date) {
  return todayKey(startOfWeek(date));
}

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

/* ---------- Reine Datums-Schluessel (YYYY-MM-DD), timezone-sicher ---------- */
/* Rechnet nur mit Y/M/D-Zahlen ueber Date.UTC, damit lokale Zeitzonen-Verschiebungen
   den Kalendertag nie kippen lassen (wichtig fuer den Kalender-View). */

export function addDaysToDateKey(dateKey, n) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export function mondayOfWeekKey(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = (dt.getUTCDay() + 6) % 7; // Montag = 0
  dt.setUTCDate(dt.getUTCDate() - day);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export function weekdayOfDateKey(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sonntag
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

export function formatDateKey(dateKey, { withWeekday = false, withYear = false } = {}) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const s = `${d}. ${MONTHS[m - 1]}${withYear ? ' ' + y : ''}`;
  if (!withWeekday) return s;
  return `${WEEKDAYS[weekdayOfDateKey(dateKey)]}, ${s}`;
}

export function monthLabel(year, month) {
  return `${MONTHS[month]} ${year}`;
}

export function daysBetween(a, b) {
  const MS = 86400000;
  return Math.round((new Date(b).setHours(0, 0, 0, 0) - new Date(a).setHours(0, 0, 0, 0)) / MS);
}

export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Geschaetzte 1-Wiederholungs-Maximalkraft (Epley-Formel) */
export function estimate1RM(weight, reps) {
  if (!weight || !reps) return 0;
  if (reps === 1) return weight;
  return weight * (1 + reps / 30);
}

export function download(filename, content, mime = 'application/json') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsText(file);
  });
}

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/** Skaliert ein Bild auf max. Kantenlaenge und gibt ein komprimiertes JPEG-DataURL zurueck. */
export function resizeImage(dataUrl, maxSize = 1280, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > height && width > maxSize) {
        height = Math.round((height * maxSize) / width);
        width = maxSize;
      } else if (height > maxSize) {
        width = Math.round((width * maxSize) / height);
        height = maxSize;
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}
