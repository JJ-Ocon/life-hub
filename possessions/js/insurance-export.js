// Versicherungsfall-Export: druckfertige HTML-Liste aller Gegenstaende fuer
// den Hausrat-Schadensfall. Kein PDF-Generator noetig (keine Bibliothek in
// diesem Oekosystem vorhanden) - die Seite oeffnet in einem neuen Tab mit
// Druck-Stylesheet, "Als PDF speichern" ist der native Browser-Druckdialog.

import { getItems, categoryLabel, estimatedCurrentValue, totalValue } from './db.js';
import { formatDateKey, formatMoney, escapeHtml, todayKey } from './utils.js';

export function openInsuranceReport() {
  const items = getItems();
  const win = window.open('', '_blank');
  if (!win) return false;

  const rows = items.map((i) => {
    const value = i.currentValue ?? estimatedCurrentValue(i) ?? i.purchasePrice ?? null;
    const attachmentsLine = (i.attachments || []).length
      ? `<p class="meta">Belege: ${i.attachments.map((a) => escapeHtml(a.name)).join(', ')}</p>`
      : '';
    return `
      <div class="item">
        ${i.photo ? `<img src="${i.photo}" alt="">` : '<div class="no-photo">Kein Foto</div>'}
        <div class="item-info">
          <h3>${escapeHtml(i.name)}</h3>
          <p class="meta">${escapeHtml(categoryLabel(i.category))}${i.subcategory ? ' · ' + escapeHtml(i.subcategory) : ''}${i.serialNumber ? ' · Seriennr. ' + escapeHtml(i.serialNumber) : ''}</p>
          <p class="meta">${i.purchaseDate ? 'Kauf am ' + formatDateKey(i.purchaseDate) : 'Kaufdatum unbekannt'}${i.retailer ? ' bei ' + escapeHtml(i.retailer) : ''}</p>
          ${attachmentsLine}
          ${i.note ? `<p class="meta">${escapeHtml(i.note)}</p>` : ''}
        </div>
        <div class="item-value">${value != null ? formatMoney(value) : '–'}</div>
      </div>
    `;
  }).join('');

  win.document.write(`
    <!doctype html>
    <html lang="de">
    <head>
    <meta charset="utf-8">
    <title>Versicherungsfall-Export</title>
    <style>
      body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; color: #14181f; margin: 32px; }
      h1 { font-size: 1.4rem; margin-bottom: 4px; }
      .sub { color: #5b6472; font-size: .9rem; margin-bottom: 24px; }
      .total { font-size: 1.1rem; font-weight: 700; margin-bottom: 24px; }
      .item { display: flex; gap: 14px; padding: 14px 0; border-bottom: 1px solid #dde1e7; break-inside: avoid; }
      .item img { width: 72px; height: 72px; object-fit: cover; border-radius: 8px; flex-shrink: 0; }
      .no-photo { width: 72px; height: 72px; border-radius: 8px; background: #eef0f3; flex-shrink: 0; }
      .item-info { flex: 1; min-width: 0; }
      .item-info h3 { margin: 0 0 4px; font-size: 1rem; }
      .meta { margin: 2px 0; font-size: .82rem; color: #5b6472; }
      .item-value { font-weight: 700; white-space: nowrap; }
      @media print { body { margin: 12mm; } }
    </style>
    </head>
    <body>
      <h1>Versicherungsfall-Export — Hausrat-Inventar</h1>
      <p class="sub">Erstellt am ${formatDateKey(todayKey())} · ${items.length} Gegenstände</p>
      <p class="total">Gesamtwert (aktuell bzw. geschätzt): ${formatMoney(totalValue())}</p>
      ${rows || '<p>Keine Gegenstände erfasst.</p>'}
      <script>window.onload = () => setTimeout(() => window.print(), 300);<\/script>
    </body>
    </html>
  `);
  win.document.close();
  return true;
}
