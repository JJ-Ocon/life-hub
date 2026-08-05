// Client-seitige Beleg-OCR (kein Cloud-Dienst) - nutzt eine lokal vendorte
// Kopie von Tesseract.js (siehe shared/vendor/tesseract/NOTICE.md), damit
// keine Foto-Daten das Geraet verlassen. Wiederverwendbar von jeder App,
// die Fotos per OCR auswerten will (Budget, Haushalt, Besitz-Katalog, ...).

const VENDOR_BASE = new URL('./vendor/tesseract/', import.meta.url).href;

let tesseractLoadPromise = null;
let workerPromise = null;

function loadTesseractScript() {
  if (tesseractLoadPromise) return tesseractLoadPromise;
  tesseractLoadPromise = new Promise((resolve, reject) => {
    if (window.Tesseract) { resolve(window.Tesseract); return; }
    const script = document.createElement('script');
    script.src = VENDOR_BASE + 'tesseract.min.js';
    script.onload = () => resolve(window.Tesseract);
    script.onerror = () => reject(new Error('Tesseract.js konnte nicht geladen werden'));
    document.head.appendChild(script);
  });
  return tesseractLoadPromise;
}

function getWorker(onProgress) {
  if (workerPromise) return workerPromise;
  workerPromise = (async () => {
    const Tesseract = await loadTesseractScript();
    return Tesseract.createWorker('deu', 1, {
      workerPath: VENDOR_BASE + 'worker.min.js',
      corePath: VENDOR_BASE + 'tesseract-core-lstm.wasm.js',
      langPath: VENDOR_BASE + 'lang-data',
      logger: onProgress,
    });
  })();
  return workerPromise;
}

/**
 * Fuehrt OCR auf einem Bild aus und gibt den erkannten Rohtext zurueck.
 * @param {File|Blob|string} image
 * @param {(info:{status:string, progress:number}) => void} [onProgress]
 */
export async function recognizeText(image, onProgress) {
  const worker = await getWorker(onProgress);
  const { data } = await worker.recognize(image);
  return data.text;
}

/**
 * @typedef {Object} ParsedReceipt
 * @property {number|null} amount    wahrscheinlichste Endsumme
 * @property {string|null} date      YYYY-MM-DD, falls ein Datum erkannt wurde
 * @property {string|null} merchant  vermuteter Haendlername (erste sinnvolle Kopfzeile)
 * @property {string} rawText
 */

/**
 * Heuristische Extraktion von Betrag/Datum/Haendler aus deutschem
 * Kassenbon-Text. Bewusst simpel gehalten - das Ergebnis ist immer nur ein
 * Vorschlag, den der Nutzer im Formular noch pruefen/korrigieren muss.
 * @param {string} text
 * @returns {ParsedReceipt}
 */
export function parseReceiptText(text) {
  return {
    amount: extractAmount(text),
    date: extractDate(text),
    merchant: extractMerchant(text),
    rawText: text,
  };
}

const AMOUNT_LINE = /(summe|gesamt|total|zu\s*zahlen|betrag)/i;
const AMOUNT_NUM = /(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})\s*(?:€|eur)?/i;

function extractAmount(text) {
  const lines = text.split('\n');
  // 1. Bevorzugt: Zeile mit "Summe"/"Gesamt"/... UND einer Zahl darin
  for (const line of lines) {
    if (AMOUNT_LINE.test(line)) {
      const m = line.match(AMOUNT_NUM);
      if (m) return parseGermanNumber(m[1]);
    }
  }
  // 2. Fallback: groesster im ganzen Text gefundener Geldbetrag (meist die Endsumme)
  const all = [...text.matchAll(new RegExp(AMOUNT_NUM, 'gi'))]
    .map((m) => parseGermanNumber(m[1]))
    .filter((n) => n !== null);
  if (!all.length) return null;
  return Math.max(...all);
}

function parseGermanNumber(s) {
  // "1.234,56" oder "12,34" -> 1234.56 bzw. 12.34
  const normalized = s.replace(/\./g, '').replace(',', '.');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

const DATE_PATTERNS = [
  /\b(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})\b/, // 05.08.2026
  /\b(\d{1,2})[.\/](\d{1,2})[.\/](\d{2})\b/, // 05.08.26
];

function extractDate(text) {
  for (const pattern of DATE_PATTERNS) {
    const m = text.match(pattern);
    if (!m) continue;
    let [, d, mo, y] = m;
    if (y.length === 2) y = (Number(y) > 70 ? '19' : '20') + y;
    const day = Number(d);
    const month = Number(mo);
    const year = Number(y);
    if (day < 1 || day > 31 || month < 1 || month > 12) continue;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return null;
}

function extractMerchant(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  // Die erste nicht-triviale Zeile ist auf Kassenbons meist der Haendlername.
  for (const line of lines.slice(0, 5)) {
    if (line.length >= 3 && !/^\d+$/.test(line)) return line;
  }
  return null;
}
