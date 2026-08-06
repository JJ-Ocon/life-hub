// Kleine, abhaengigkeitsfreie Helferfunktionen.

export function nowIso() {
  return new Date().toISOString();
}

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function formatDuration(sec) {
  if (!sec && sec !== 0) return '–:––';
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

export function formatBytes(bytes) {
  if (!bytes) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1000) return `${mb.toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`;
  return `${(mb / 1024).toLocaleString('de-DE', { maximumFractionDigits: 2 })} GB`;
}

export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
