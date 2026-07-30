/*
 * Erzeugt die PWA-Icons als PNG ohne externe Abhaengigkeiten.
 * Aufruf:  node tools/make-icons.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'icons');

/* ---------- minimaler PNG-Encoder ---------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** pixels: Buffer mit size*size*4 Bytes (RGBA) */
function encodePng(size, pixels) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // Filter: None
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- Zeichenhilfen ---------- */

function canvas(size, rgba) {
  const buf = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    buf[i * 4] = rgba[0];
    buf[i * 4 + 1] = rgba[1];
    buf[i * 4 + 2] = rgba[2];
    buf[i * 4 + 3] = rgba[3];
  }
  return buf;
}

function blend(buf, size, x, y, color, alpha) {
  if (x < 0 || y < 0 || x >= size || y >= size || alpha <= 0) return;
  const i = (y * size + x) * 4;
  const a = Math.min(1, alpha);
  buf[i] = Math.round(buf[i] * (1 - a) + color[0] * a);
  buf[i + 1] = Math.round(buf[i + 1] * (1 - a) + color[1] * a);
  buf[i + 2] = Math.round(buf[i + 2] * (1 - a) + color[2] * a);
  buf[i + 3] = Math.max(buf[i + 3], Math.round(255 * a));
}

/** Rechteck mit runden Ecken, 3x3-Supersampling fuer weiche Kanten */
function roundRect(buf, size, x0, y0, w, h, r, color) {
  const x1 = x0 + w;
  const y1 = y0 + h;
  const inside = (px, py) => {
    if (px < x0 || px > x1 || py < y0 || py > y1) return false;
    const cx = Math.min(Math.max(px, x0 + r), x1 - r);
    const cy = Math.min(Math.max(py, y0 + r), y1 - r);
    const dx = px - cx;
    const dy = py - cy;
    return dx * dx + dy * dy <= r * r;
  };
  const minX = Math.max(0, Math.floor(x0) - 1);
  const maxX = Math.min(size - 1, Math.ceil(x1) + 1);
  const minY = Math.max(0, Math.floor(y0) - 1);
  const maxY = Math.min(size - 1, Math.ceil(y1) + 1);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      let hits = 0;
      for (let sy = 0; sy < 3; sy++) {
        for (let sx = 0; sx < 3; sx++) {
          if (inside(x + (sx + 0.5) / 3, y + (sy + 0.5) / 3)) hits++;
        }
      }
      if (hits) blend(buf, size, x, y, color, hits / 9);
    }
  }
}

/* ---------- Icon-Motiv: Hantel ---------- */

const BG = [17, 21, 28, 255];
const BG_ACCENT = [34, 42, 56, 255];
const FG = [110, 231, 183]; // gruener Akzent

/**
 * @param {number} size    Kantenlaenge
 * @param {number} padding Anteil des Randes (0.10 = normal, 0.25 = maskable)
 * @param {boolean} square true = ohne abgerundeten Hintergrund (maskable)
 */
function makeIcon(size, padding, square) {
  const buf = canvas(size, square ? BG : [0, 0, 0, 0]);

  if (!square) {
    roundRect(buf, size, 0, 0, size - 1, size - 1, size * 0.22, BG);
  }
  // dezenter heller Block oben links fuer etwas Tiefe
  roundRect(buf, size, size * 0.08, size * 0.08, size * 0.84, size * 0.42, size * 0.16, BG_ACCENT);

  const cx = size / 2;
  const cy = size / 2;
  const span = size * (1 - 2 * padding); // Gesamtbreite der Hantel
  const barW = span * 0.34;
  const barH = span * 0.115;
  const plateOuterH = span * 0.62;
  const plateInnerH = span * 0.84;
  const plateW = span * 0.115;
  const r = span * 0.05;

  // Stange
  roundRect(buf, size, cx - barW / 2, cy - barH / 2, barW, barH, barH / 2, FG);
  // innere Gewichtsscheiben
  roundRect(buf, size, cx - barW / 2 - plateW * 1.05, cy - plateInnerH / 2, plateW, plateInnerH, r, FG);
  roundRect(buf, size, cx + barW / 2 + plateW * 0.05, cy - plateInnerH / 2, plateW, plateInnerH, r, FG);
  // aeussere Gewichtsscheiben
  roundRect(buf, size, cx - span / 2, cy - plateOuterH / 2, plateW, plateOuterH, r, FG);
  roundRect(buf, size, cx + span / 2 - plateW, cy - plateOuterH / 2, plateW, plateOuterH, r, FG);

  return encodePng(size, buf);
}

const files = [
  ['icon-192.png', makeIcon(192, 0.12, false)],
  ['icon-512.png', makeIcon(512, 0.12, false)],
  ['icon-maskable-512.png', makeIcon(512, 0.26, true)],
  ['apple-touch-icon.png', makeIcon(180, 0.12, false)],
];

fs.mkdirSync(OUT, { recursive: true });
for (const [name, data] of files) {
  fs.writeFileSync(path.join(OUT, name), data);
  console.log('geschrieben:', name, data.length + ' Bytes');
}
