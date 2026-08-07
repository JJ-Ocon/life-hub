import { setTitle, setActions, setBack } from '../router.js';
import {
  getEnvelopes, createEnvelope, updateEnvelope, deleteEnvelope,
  depositToEnvelope, withdrawFromEnvelope, totalEnvelopeBalance,
  subscriptionSummary, getSettings,
} from '../db.js';
import { getExternalSubscriptions } from '../../../shared/subscriptions.js';
import { openModal, confirmDialog, toast, promptDialog } from '../ui.js';
import { formatMoney, formatDateKey, escapeHtml, clamp } from '../utils.js';

let section = 'envelopes'; // 'envelopes' | 'subscriptions'

export function render() {
  setTitle('Sparen');
  setBack(null);
  setActions('');
  draw();
  handleQuickAddParam();
}

/** Deep-Link von anderen Apps (aktuell Inventar's Ersatz-Ruecklage) zum
 *  Anlegen eines vorausgefuellten Sparumschlags - gleiches Muster wie
 *  Notes' "Als Todo anlegen" -> Goals' quickAdd aus E7. */
function handleQuickAddParam() {
  const query = new URLSearchParams(location.hash.split('?')[1] || '');
  const name = query.get('envName');
  if (!name) return;
  const amount = Number(query.get('envAmount')) || 0;
  history.replaceState(null, '', location.pathname + '#/savings');
  section = 'envelopes';
  openEnvelopeModal({ name, icon: '📦', monthlyAmount: amount, targetAmount: null }, draw);
}

function draw() {
  const view = document.getElementById('view');
  view.innerHTML = `
    <div class="section-tabs">
      <button class="chip ${section === 'envelopes' ? 'active' : ''}" data-section="envelopes">Sparumschläge</button>
      <button class="chip ${section === 'subscriptions' ? 'active' : ''}" data-section="subscriptions">Abo-Radar</button>
    </div>
    <div id="savings-content"></div>
  `;
  view.querySelectorAll('[data-section]').forEach((b) => b.addEventListener('click', () => {
    section = b.dataset.section;
    draw();
  }));
  if (section === 'envelopes') drawEnvelopes(); else drawSubscriptions();
}

function drawEnvelopes() {
  const settings = getSettings();
  const envelopes = getEnvelopes();
  const content = document.getElementById('savings-content');
  content.innerHTML = `
    <div class="stat-tile" style="margin-bottom:16px">
      <div class="stat-tile__value">${formatMoney(totalEnvelopeBalance(), settings.currency)}</div>
      <div class="stat-tile__label">Gespart insgesamt</div>
    </div>
    <button class="btn btn-primary" id="env-add" style="margin-bottom:16px">+ Sparumschlag anlegen</button>
    ${envelopes.length === 0 ? `
      <div class="empty">
        <h3>Noch keine Sparumschläge</h3>
        <p class="faint">Lege einen an, um automatisch jeden Monat für ein Ziel zurückzulegen.</p>
      </div>
    ` : `
      <div class="stack">
        ${envelopes.map((e) => {
          const pct = e.targetAmount ? clamp((e.balance / e.targetAmount) * 100, 0, 100) : null;
          return `
            <div class="card" style="margin-bottom:0">
              <div class="row row--between" style="margin-bottom:8px">
                <div class="row" style="gap:8px">
                  <span style="font-size:1.2rem">${e.icon}</span>
                  <span>${escapeHtml(e.name)}</span>
                </div>
                <span class="badge">${formatMoney(e.balance, settings.currency)}</span>
              </div>
              ${pct !== null ? `
                <div class="pbar" style="margin-bottom:6px"><div class="pbar__fill" style="width:${pct}%"></div></div>
                <p class="faint" style="margin-bottom:10px">${formatMoney(e.balance, settings.currency)} von ${formatMoney(e.targetAmount, settings.currency)} · ${formatMoney(e.monthlyAmount, settings.currency)}/Monat</p>
              ` : `<p class="faint" style="margin-bottom:10px">${formatMoney(e.monthlyAmount, settings.currency)}/Monat · offenes Sparziel</p>`}
              <div class="grid-3">
                <button class="btn btn-ghost btn-sm" data-deposit="${e.id}">+ Einzahlen</button>
                <button class="btn btn-ghost btn-sm" data-withdraw="${e.id}">– Auszahlen</button>
                <button class="btn btn-ghost btn-sm" data-edit="${e.id}">Bearbeiten</button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `}
  `;

  document.getElementById('env-add').addEventListener('click', () => openEnvelopeModal(null, draw));
  content.querySelectorAll('[data-deposit]').forEach((b) => b.addEventListener('click', async () => {
    const v = await promptDialog('Betrag einzahlen', { placeholder: '0.00' });
    const amount = Number(v);
    if (!v || !amount || amount <= 0) return;
    depositToEnvelope(b.dataset.deposit, amount);
    toast('Eingezahlt');
    draw();
  }));
  content.querySelectorAll('[data-withdraw]').forEach((b) => b.addEventListener('click', async () => {
    const v = await promptDialog('Betrag auszahlen', { placeholder: '0.00' });
    const amount = Number(v);
    if (!v || !amount || amount <= 0) return;
    withdrawFromEnvelope(b.dataset.withdraw, amount);
    toast('Ausgezahlt');
    draw();
  }));
  content.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
    openEnvelopeModal(getEnvelopes().find((e) => e.id === b.dataset.edit), draw);
  }));
}

function openEnvelopeModal(existing, onSaved) {
  const isNew = !existing?.id;
  const handle = openModal(`
    <h3 class="modal-title">${isNew ? 'Sparumschlag anlegen' : 'Sparumschlag bearbeiten'}</h3>
    <div class="row" style="gap:12px">
      <div class="field" style="flex:1">
        <label>Name</label>
        <input class="input" id="env-name" value="${escapeHtml(existing?.name || '')}" placeholder="z.B. Neuer Laptop">
      </div>
      <div class="field" style="width:70px">
        <label>Symbol</label>
        <input class="input" id="env-icon" value="${existing?.icon || '💰'}" maxlength="4">
      </div>
    </div>
    <div class="field">
      <label>Monatliche Zuführung</label>
      <input class="input" type="number" inputmode="decimal" id="env-monthly" min="0" step="1" value="${existing?.monthlyAmount ?? ''}" placeholder="0">
    </div>
    <div class="field">
      <label>Sparziel (optional)</label>
      <input class="input" type="number" inputmode="decimal" id="env-target" min="0" step="1" value="${existing?.targetAmount ?? ''}" placeholder="leer = offenes Sparen">
    </div>
    <div class="stack" style="margin-top:16px">
      <button class="btn btn-primary" id="env-save">Speichern</button>
      ${!isNew ? '<button class="btn btn-danger" id="env-delete">Umschlag löschen</button>' : ''}
    </div>
  `, { center: true });

  handle.sheet.querySelector('#env-save').addEventListener('click', () => {
    const name = handle.sheet.querySelector('#env-name').value.trim();
    if (!name) { toast('Bitte einen Namen eingeben'); return; }
    const icon = handle.sheet.querySelector('#env-icon').value.trim() || '💰';
    const monthlyAmount = Number(handle.sheet.querySelector('#env-monthly').value) || 0;
    const targetRaw = handle.sheet.querySelector('#env-target').value;
    const targetAmount = targetRaw ? Number(targetRaw) : null;
    if (isNew) {
      createEnvelope({ name, icon, monthlyAmount, targetAmount });
    } else {
      updateEnvelope(existing.id, { name, icon, monthlyAmount, targetAmount });
    }
    toast('Gespeichert');
    handle.close();
    onSaved?.();
  });

  handle.sheet.querySelector('#env-delete')?.addEventListener('click', async () => {
    const ok = await confirmDialog('Sparumschlag löschen?', 'Der gesparte Betrag geht dabei verloren.', 'Löschen', true);
    if (!ok) return;
    deleteEnvelope(existing.id);
    toast('Gelöscht');
    handle.close();
    onSaved?.();
  });
}

const EXTERNAL_SOURCE_LABELS = { household: 'Haushalt' };

function drawSubscriptions() {
  const settings = getSettings();
  const { items, totalMonthly } = subscriptionSummary();
  const external = getExternalSubscriptions();
  const combinedTotal = totalMonthly + external.reduce((sum, e) => sum + e.monthlyEquivalent, 0);
  const content = document.getElementById('savings-content');
  content.innerHTML = `
    <div class="stat-tile" style="margin-bottom:16px">
      <div class="stat-tile__value">${formatMoney(combinedTotal, settings.currency)}</div>
      <div class="stat-tile__label">Abos gesamt / Monat</div>
    </div>
    ${items.length === 0 && external.length === 0 ? `
      <div class="empty">
        <h3>Keine Abos erkannt</h3>
        <p class="faint">Markiere Ausgaben beim Erfassen als "wiederkehrend", damit sie hier auftauchen. Verträge mit Kosten aus der Haushalt-App erscheinen automatisch mit.</p>
      </div>
    ` : `
      <div class="card">
        ${items.map((i) => `
          <div class="list-row">
            <div class="col grow">
              <p>${escapeHtml(i.merchant)}</p>
              <p class="faint">${i.interval === 'yearly' ? 'jährlich' : 'monatlich'} · nächste Fälligkeit ca. ${formatDateKey(i.nextDueEstimate)}</p>
            </div>
            <div class="col" style="text-align:right">
              <p>${formatMoney(i.amount, settings.currency)}</p>
              <p class="faint">≈ ${formatMoney(i.monthlyEquivalent, settings.currency)}/Monat</p>
            </div>
          </div>
        `).join('')}
        ${external.map((e) => `
          <div class="list-row">
            <div class="col grow">
              <p>${escapeHtml(e.label)}</p>
              <p class="faint">${escapeHtml(e.note || '')}${e.note ? ' · ' : ''}aus ${EXTERNAL_SOURCE_LABELS[e.source] || e.source}</p>
            </div>
            <div class="col" style="text-align:right">
              <p>${formatMoney(e.monthlyEquivalent, settings.currency)}/Monat</p>
            </div>
          </div>
        `).join('')}
      </div>
    `}
  `;
}
