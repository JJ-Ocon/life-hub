// Minimalistische SVG-Diagramme ohne externe Bibliotheken.
import { formatDateShort, formatAxisLabel, formatNum } from './utils.js';

/**
 * Liniendiagramm mit Flaechenfuellung und Punkten.
 * @param {{date:string, value:number}[]} points
 * @param {{width?:number, height?:number, unit?:string, granularity?:string,
 *          decimals?:number, large?:boolean, showValues?:boolean}} opts
 */
export function lineChart(points, opts = {}) {
  const {
    unit = '', granularity = 'day', decimals = 1,
    large = false, showValues = false,
  } = opts;
  if (!points.length) return `<div class="empty"><p>Noch keine Daten</p></div>`;

  // Grosse Variante: mehr Platz fuer Achsen und Beschriftungen
  const width = opts.width ?? (large ? 680 : 320);
  const height = opts.height ?? (large ? 380 : 160);
  const padL = large ? 56 : 38;
  const padR = large ? 18 : 12;
  const padT = large ? 20 : 14;
  const padB = large ? 44 : 24;
  const w = width - padL - padR;
  const h = height - padT - padB;

  const values = points.map((p) => p.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  min -= span * 0.1;
  max += span * 0.1;

  const x = (i) => padL + (points.length === 1 ? w / 2 : (i / (points.length - 1)) * w);
  const y = (v) => padT + h - ((v - min) / (max - min)) * h;

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  const areaD = `${pathD} L ${x(points.length - 1).toFixed(1)} ${(padT + h).toFixed(1)} L ${x(0).toFixed(1)} ${(padT + h).toFixed(1)} Z`;

  const gridLines = large ? 6 : 3;
  let grid = '';
  for (let i = 0; i <= gridLines; i++) {
    const gy = padT + (h / gridLines) * i;
    const val = max - ((max - min) / gridLines) * i;
    grid += `<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${width - padR}" y2="${gy.toFixed(1)}" />`;
    grid += `<text class="axis-label" x="${padL - 6}" y="${(gy + 3).toFixed(1)}" text-anchor="end">${formatNum(val, decimals)}</text>`;
  }

  // Achsenlinien
  const axes = `
    <line class="chart-axis" x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + h}" />
    <line class="chart-axis" x1="${padL}" y1="${padT + h}" x2="${width - padR}" y2="${padT + h}" />
  `;

  const maxLabels = large ? 8 : 5;
  const step = Math.max(1, Math.ceil(points.length / maxLabels));
  let labels = '';
  points.forEach((p, i) => {
    if (i % step !== 0 && i !== points.length - 1) return;
    const text = granularity ? formatAxisLabel(p.date, granularity) : formatDateShort(p.date);
    labels += `<text class="axis-label" x="${x(i).toFixed(1)}" y="${padT + h + (large ? 20 : 16)}" text-anchor="middle">${text}</text>`;
  });

  // Einheit an der Y-Achse
  const unitLabel = unit && large
    ? `<text class="axis-unit" x="${padL - 6}" y="${padT - 6}" text-anchor="end">${unit}</text>`
    : (unit ? `<text class="axis-unit" x="${padL - 4}" y="${padT - 4}" text-anchor="end">${unit}</text>` : '');

  const dotR = large ? 4 : 3;
  const dots = points.map((p, i) => `<circle class="chart-dot" cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="${dotR}"></circle>`).join('');

  let valueLabels = '';
  if (showValues && large) {
    points.forEach((p, i) => {
      if (i % step !== 0 && i !== points.length - 1) return;
      valueLabels += `<text class="chart-value" x="${x(i).toFixed(1)}" y="${(y(p.value) - 10).toFixed(1)}" text-anchor="middle">${formatNum(p.value, decimals)}</text>`;
    });
  }

  return `
    <div class="chart-wrap">
      <svg class="chart-svg${large ? ' chart-svg--large' : ''}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" role="img">
        <g class="chart-grid">${grid}</g>
        ${axes}
        <path class="chart-area" d="${areaD}"></path>
        <path class="chart-line" d="${pathD}"></path>
        ${dots}
        ${labels}
        ${valueLabels}
        ${unitLabel}
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
