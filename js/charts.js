// Minimalistische SVG-Diagramme ohne externe Bibliotheken.
import { formatDateShort } from './utils.js';

/**
 * Liniendiagramm mit Flaechenfuellung und Punkten.
 * @param {{date:string, value:number}[]} points
 */
export function lineChart(points, { width = 320, height = 160, unit = '' } = {}) {
  if (!points.length) return `<div class="empty"><p>Noch keine Daten</p></div>`;
  const padL = 34, padR = 12, padT = 14, padB = 22;
  const w = width - padL - padR;
  const h = height - padT - padB;

  const values = points.map((p) => p.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  min -= span * 0.08;
  max += span * 0.08;

  const x = (i) => padL + (points.length === 1 ? w / 2 : (i / (points.length - 1)) * w);
  const y = (v) => padT + h - ((v - min) / (max - min)) * h;

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  const areaD = `${pathD} L ${x(points.length - 1).toFixed(1)} ${(padT + h).toFixed(1)} L ${x(0).toFixed(1)} ${(padT + h).toFixed(1)} Z`;

  const gridLines = 3;
  let grid = '';
  for (let i = 0; i <= gridLines; i++) {
    const gy = padT + (h / gridLines) * i;
    const val = max - ((max - min) / gridLines) * i;
    grid += `<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${width - padR}" y2="${gy.toFixed(1)}" />`;
    grid += `<text x="2" y="${(gy + 3).toFixed(1)}">${val.toFixed(1)}${unit}</text>`;
  }

  const step = Math.max(1, Math.ceil(points.length / 5));
  let labels = '';
  points.forEach((p, i) => {
    if (i % step !== 0 && i !== points.length - 1) return;
    labels += `<text x="${x(i).toFixed(1)}" y="${height - 4}" text-anchor="middle">${formatDateShort(p.date)}</text>`;
  });

  const dots = points.map((p, i) => `<circle class="chart-dot" cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3"></circle>`).join('');

  return `
    <div class="chart-wrap">
      <svg class="chart-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <g class="chart-grid">${grid}</g>
        <path class="chart-area" d="${areaD}"></path>
        <path class="chart-line" d="${pathD}"></path>
        ${dots}
        ${labels}
      </svg>
    </div>`;
}

/**
 * Balkendiagramm (z.B. Volumen pro Woche).
 * @param {{label:string, value:number, highlight?:boolean}[]} bars
 */
export function barChart(bars, { width = 320, height = 160, unit = '' } = {}) {
  if (!bars.length) return `<div class="empty"><p>Noch keine Daten</p></div>`;
  const padL = 34, padR = 8, padT = 14, padB = 22;
  const w = width - padL - padR;
  const h = height - padT - padB;
  const max = Math.max(...bars.map((b) => b.value), 1);

  const bw = w / bars.length;
  const barW = Math.min(28, bw * 0.55);

  let rects = '';
  let labels = '';
  bars.forEach((b, i) => {
    const bh = (b.value / max) * h;
    const bx = padL + bw * i + (bw - barW) / 2;
    const by = padT + h - bh;
    rects += `<rect class="chart-bar${b.highlight ? ' today' : ''}" x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(2, bh).toFixed(1)}" rx="4"></rect>`;
    labels += `<text x="${(padL + bw * i + bw / 2).toFixed(1)}" y="${height - 4}" text-anchor="middle">${b.label}</text>`;
  });

  let grid = '';
  const gridLines = 3;
  for (let i = 0; i <= gridLines; i++) {
    const gy = padT + (h / gridLines) * i;
    const val = max - (max / gridLines) * i;
    grid += `<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${width - padR}" y2="${gy.toFixed(1)}" />`;
    grid += `<text x="2" y="${(gy + 3).toFixed(1)}">${Math.round(val)}${unit}</text>`;
  }

  return `
    <div class="chart-wrap">
      <svg class="chart-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <g class="chart-grid">${grid}</g>
        ${rects}
        ${labels}
      </svg>
    </div>`;
}
