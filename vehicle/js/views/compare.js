import { setTitle, setActions, setBack } from '../router.js';
import { getVehicles, estimatedMonthlyCost, getSettings, saveSettings } from '../db.js';
import { formatMoney, escapeHtml } from '../utils.js';

let selectedVehicleId = null;

export function render() {
  setTitle('Vergleich');
  setBack(null);
  setActions('');
  const vehicles = getVehicles();
  if (!selectedVehicleId && vehicles.length) selectedVehicleId = vehicles[0].id;
  draw();
}

function draw() {
  const view = document.getElementById('view');
  const vehicles = getVehicles();
  const settings = getSettings();

  if (vehicles.length === 0) {
    view.innerHTML = `
      <div class="empty">
        <h3>Noch kein Fahrzeug</h3>
        <p class="faint">Lege zuerst ein Fahrzeug mit Tankfüllungen und Wartungskosten an, um es mit einem ÖPNV-Abo zu vergleichen.</p>
      </div>
    `;
    return;
  }

  const carCost = selectedVehicleId ? estimatedMonthlyCost(selectedVehicleId) : 0;

  view.innerHTML = `
    <p class="faint" style="margin-bottom:14px">Vergleicht die geschätzten monatlichen Kosten eines Fahrzeugs (Ø Tanken + umgelegte Wartung) mit einem ÖPNV-Abo. Reine Orientierung, ohne Anschaffungskosten oder Versicherung.</p>
    ${vehicles.length > 1 ? `
      <div class="field">
        <label>Fahrzeug</label>
        <div class="chip-row" id="vehicle-row">
          ${vehicles.map((v) => `<button type="button" class="chip ${selectedVehicleId === v.id ? 'active' : ''}" data-vehicle="${v.id}">${escapeHtml(v.name)}</button>`).join('')}
        </div>
      </div>
    ` : ''}
    <div class="field">
      <label>ÖPNV-Abo (€/Monat)</label>
      <input class="input" type="number" min="0" step="0.01" id="c-transit" value="${settings.lastTransitPrice ?? ''}" placeholder="z.B. 49">
    </div>
    <div class="grid-2" style="margin-top:14px">
      <div class="stat-tile">
        <div class="stat-tile__value">${carCost > 0 ? formatMoney(carCost) : '–'}</div>
        <div class="stat-tile__label">Fahrzeug/Monat</div>
      </div>
      <div class="stat-tile">
        <div class="stat-tile__value" id="c-transit-value">${settings.lastTransitPrice ? formatMoney(settings.lastTransitPrice) : '–'}</div>
        <div class="stat-tile__label">ÖPNV-Abo/Monat</div>
      </div>
    </div>
    <div class="card" id="c-result" style="margin-top:14px"></div>
  `;

  view.querySelectorAll('[data-vehicle]').forEach((el) => {
    el.addEventListener('click', () => { selectedVehicleId = el.dataset.vehicle; draw(); });
  });

  const transitInput = view.querySelector('#c-transit');
  const updateResult = () => {
    const transitPrice = Number(transitInput.value) || 0;
    saveSettings({ lastTransitPrice: transitInput.value ? transitPrice : null });
    view.querySelector('#c-transit-value').textContent = transitInput.value ? formatMoney(transitPrice) : '–';
    const resultEl = view.querySelector('#c-result');
    if (!transitInput.value || carCost <= 0) {
      resultEl.innerHTML = '<p class="faint">Trage Tankfüllungen/Wartungskosten und einen ÖPNV-Preis ein, um den Vergleich zu sehen.</p>';
      return;
    }
    const diff = carCost - transitPrice;
    resultEl.innerHTML = diff > 0
      ? `<p>🚌 ÖPNV wäre günstiger — <b>${formatMoney(diff)}</b>/Monat weniger.</p>`
      : diff < 0
        ? `<p>🚗 Das Fahrzeug wäre günstiger — <b>${formatMoney(-diff)}</b>/Monat weniger als das ÖPNV-Abo.</p>`
        : `<p>Beide Optionen kosten etwa gleich viel.</p>`;
  };
  transitInput.addEventListener('input', updateResult);
  updateResult();
}
