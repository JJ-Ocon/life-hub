// Minimalistische SVG-Diagramme ohne externe Bibliotheken.
import { formatDateShort, formatAxisLabel, formatAxisNum, formatNum, addDaysToDateKey } from './utils.js';

/**
 * Liniendiagramm mit Flaechenfuellung und Punkten.
 * @param {{date:string, value:number}[]} points
 * @param {{width?:number, height?:number, unit?:string, granularity?:string,
 *          decimals?:number, large?:boolean, showValues?:boolean}} opts
 */
export function lineChart(points, opts = {}) {
  const {
    unit = '', granularity = null, decimals = 1,
    large = false, showValues = false,
  } = opts;
  if (!points.length) return `<div class="empty"><p>Noch keine Daten</p></div>`;

  // Grosse Variante: mehr Platz fuer Achsen und Beschriftungen. Die Basisgroesse
  // orientiert sich an der realen Breite auf dem Handy (statt einer Desktop-
  // Groesse) - sonst wird per CSS width:100% stark herunterskaliert, was den
  // SVG-Text (v.a. Achsen-Beschriftung) sichtbar unscharf rendert. 296/340 statt
  // vormals 320/340: die kompakte (nicht-large) Variante liegt in einer .card
  // (2x14px Padding) in .view (2x14px Padding) - auf einem 360px-Handy bleiben
  // damit real nur ~304px, 320px wurde also selbst schon leicht herunterskaliert
  // (E49, Nachzuegler aus dem E18-Feedback "leicht verschwommene Diagramme").
  const width = opts.width ?? (large ? 340 : 296);
  const height = opts.height ?? (large ? 200 : 148);
  const padL = large ? 34 : 38;
  const padR = large ? 10 : 12;
  const padT = large ? 12 : 14;
  const padB = large ? 28 : 24;
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

  const maxLabels = large ? 6 : 5;
  const step = Math.max(1, Math.ceil(points.length / maxLabels));
  let labels = '';
  points.forEach((p, i) => {
    if (i % step !== 0 && i !== points.length - 1) return;
    const text = granularity ? formatAxisLabel(p.date, granularity) : formatDateShort(p.date);
    labels += `<text class="axis-label" x="${x(i).toFixed(1)}" y="${padT + h + (large ? 18 : 16)}" text-anchor="middle">${text}</text>`;
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
 * Trainings-Heatmap ueber die letzten 12 Monate (eine Spalte je Woche).
 * @param {Map<string, number>} valueByDate  Datum (YYYY-MM-DD) -> Intensitaetswert
 * @param {{weeks?:number, todayKey?:string, startKey?:string}} opts
 */
export function heatmap(valueByDate, opts = {}) {
  const weeks = opts.weeks || 53;
  const cell = 11;
  const gap = 3;
  const padL = 26;
  const padT = 16;
  const width = padL + weeks * (cell + gap);
  const height = padT + 7 * (cell + gap) + 14;

  const max = Math.max(...valueByDate.values(), 1);
  const startKey = opts.startKey;
  const today = opts.todayKey;

  let cells = '';
  let monthLabels = '';
  let lastMonth = '';

  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const dateKey = addDaysToDateKey(startKey, w * 7 + d);
      if (today && dateKey > today) continue;
      const value = valueByDate.get(dateKey) || 0;
      const level = value === 0 ? 0 : Math.min(4, Math.ceil((value / max) * 4));
      const x = padL + w * (cell + gap);
      const y = padT + d * (cell + gap);
      cells += `<rect class="hm-cell hm-cell--${level}${dateKey === today ? ' hm-cell--today' : ''}" x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2"><title>${dateKey}${value ? ` · ${Math.round(value)}` : ''}</title></rect>`;

      // Monatsbeschriftung in der obersten Zeile, wenn ein neuer Monat beginnt
      if (d === 0) {
        const month = dateKey.slice(5, 7);
        if (month !== lastMonth) {
          lastMonth = month;
          monthLabels += `<text class="hm-label" x="${x}" y="${padT - 5}">${MONTHS_SHORT[Number(month) - 1]}</text>`;
        }
      }
    }
  }

  const dayLabels = ['Mo', '', 'Mi', '', 'Fr', '', 'So']
    .map((label, i) => label
      ? `<text class="hm-label" x="0" y="${padT + i * (cell + gap) + cell - 1}">${label}</text>`
      : '')
    .join('');

  return `
    <div class="chart-wrap heatmap-wrap">
      <svg class="chart-svg heatmap-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        ${monthLabels}${dayLabels}${cells}
      </svg>
    </div>
  `;
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

/**
 * Waagerechtes Balkendiagramm mit Beschriftung – z.B. Volumen je Muskelgruppe.
 * @param {{label:string, value:number, sub?:string}[]} rows
 */
export function hBarChart(rows, { unit = '', decimals = 0 } = {}) {
  if (!rows.length) return `<div class="empty"><p>Noch keine Daten</p></div>`;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return `
    <div class="hbar-list">
      ${rows.map((r) => `
        <div class="hbar">
          <div class="row row--between hbar__head">
            <span class="hbar__label">${r.label}</span>
            <span class="hbar__value">${formatNum(r.value, decimals)}${unit ? ' ' + unit : ''}${r.sub ? ` <span class="faint">${r.sub}</span>` : ''}</span>
          </div>
          <div class="pbar"><div class="pbar__fill" style="width:${(r.value / max) * 100}%"></div></div>
        </div>
      `).join('')}
    </div>
  `;
}

/**
 * Balkendiagramm (z.B. Volumen pro Woche).
 * @param {{label:string, value:number, highlight?:boolean}[]} bars
 */
export function barChart(bars, { width = 296, height = 148, unit = '' } = {}) {
  if (!bars.length) return `<div class="empty"><p>Noch keine Daten</p></div>`;
  // padL etwas breiter als frueher (28 statt 34 reichte fuer 5-stellige Werte
  // bei 9px SVG-Text kaum, siehe formatAxisNum-Kommentar) - jetzt kombiniert
  // mit kompakter "43,5k"-Formatierung statt roher 5-stelliger Zahlen.
  const padL = 30, padR = 8, padT = 14, padB = 22;
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
    grid += `<text class="chart-axis-num" x="2" y="${(gy + 3).toFixed(1)}">${formatAxisNum(val)}${unit}</text>`;
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
