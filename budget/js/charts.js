// Minimalistisches SVG-Balkendiagramm ohne externe Bibliothek. Breite/Hoehe
// orientieren sich an der real verfuegbaren Breite in einer .card auf einem
// Handy (nicht an einer Desktop-Groesse) - sonst wird per CSS width:100%
// leicht herunterskaliert, was den kleinen Achsen-Text sichtbar weicher
// macht (siehe fitness/js/charts.js, gleiche Erkenntnis von dort uebernommen).

export function barChart(bars, { width = 296, height = 148, unit = '' } = {}) {
  if (!bars.length) return `<div class="empty"><p>Noch keine Daten</p></div>`;
  const padL = 40, padR = 8, padT = 14, padB = 22;
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
    rects += `<rect class="chart-bar${b.highlight ? ' chart-bar--highlight' : ''}" x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(2, bh).toFixed(1)}" rx="4"></rect>`;
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
