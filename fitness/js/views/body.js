import { setTitle, setActions, setBack } from '../router.js';
import {
  getBodyEntries, saveBodyEntry, deleteBodyEntry, getSettings, listPhotos, putPhoto, deletePhoto,
  BODY_METRICS, calcBmi, bodySeries, getLatestBodyEntry,
} from '../db.js';
import { calcCalorieNeeds, missingProfileFields } from '../nutrition.js';
import {
  todayKey, formatDate, formatDateShort, formatDateKey, formatNum, uid, resizeImage,
  aggregateSeries, GRANULARITIES, escapeHtml,
} from '../utils.js';
import { lineChart } from '../charts.js';
import { openModal, confirmDialog, toast } from '../ui.js';

// Metriken inkl. berechnetem BMI (nicht eingebbar, wird aus Gewicht + Groesse abgeleitet)
const CHART_METRICS = [
  BODY_METRICS[0],
  { key: 'bmi', label: 'BMI', unit: '', decimals: 1, computed: true },
  ...BODY_METRICS.slice(1),
];

// Merkt sich pro Metrik die gewaehlte Zeitraum-Ansicht und ob die Karte offen ist
const granularityByMetric = new Map();
const expandedMetrics = new Set();

export async function render() {
  setTitle('Körperdaten');
  setActions(`<button class="icon-btn" id="body-add" aria-label="Eintrag hinzufügen"><svg viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M5 12h14"/></svg></button>`);
  setBack(null);

  const settings = getSettings();
  const entries = getBodyEntries();
  const photos = await listPhotos();
  const latest = getLatestBodyEntry();
  const bmi = calcBmi(latest?.weight, settings.heightCm);

  const firstWeight = entries.find((e) => e.weight != null);
  const lastWeight = [...entries].reverse().find((e) => e.weight != null);
  const diff = firstWeight && lastWeight && firstWeight !== lastWeight
    ? lastWeight.weight - firstWeight.weight : null;

  document.getElementById('view').innerHTML = `
    <div class="grid-3">
      <div class="stat-tile">
        <div class="stat-tile__value">${latest?.weight != null ? formatNum(latest.weight) : '–'}</div>
        <div class="stat-tile__label">Gewicht (${settings.units})</div>
      </div>
      <div class="stat-tile">
        <div class="stat-tile__value">${bmi != null ? formatNum(bmi, 1) : '–'}</div>
        <div class="stat-tile__label">BMI${bmi == null && !settings.heightCm ? ' (Größe fehlt)' : ''}</div>
      </div>
      <div class="stat-tile">
        <div class="stat-tile__value">${diff != null ? (diff > 0 ? '+' : '') + formatNum(diff) : '–'}</div>
        <div class="stat-tile__label">Veränderung</div>
      </div>
    </div>

    <div class="section-title">Aktuelle Werte</div>
    ${overviewTableHtml(settings)}

    <button class="btn btn-primary" id="add-entry" style="margin-top:12px">+ Messung eintragen</button>

    <div class="section-title">Verläufe</div>
    <div class="stack" id="metric-cards">
      ${CHART_METRICS.map((m) => metricCardHtml(m, settings)).join('')}
    </div>

    <div class="section-title">Kalorienbedarf</div>
    ${calorieSectionHtml()}

    <div class="section-title">Letzte Messungen</div>
    ${entries.length === 0 ? `<p class="faint" style="padding:0 2px">Noch keine Einträge.</p>` : `
      <div class="stack">
        ${entries.slice().reverse().slice(0, 8).map((e) => `
          <div class="card row row--between">
            <div class="col grow">
              <h3>${formatDate(e.date, { withWeekday: true })}</h3>
              <p class="faint">${summarizeEntry(e, settings) || '–'}</p>
            </div>
            <button class="icon-btn" data-del-entry="${e.id}" aria-label="Löschen"><svg viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/></svg></button>
          </div>
        `).join('')}
      </div>
    `}

    <div class="section-title row row--between">
      <span>Fortschrittsfotos</span>
      <label class="btn btn-ghost btn-sm" style="width:auto" for="photo-input">+ Foto</label>
    </div>
    <input type="file" id="photo-input" accept="image/*" hidden>
    ${photos.length === 0 ? `<p class="faint" style="padding:0 2px">Noch keine Fotos. Fotos werden nur lokal auf deinem Gerät gespeichert.</p>` : `
      <div class="photo-grid">
        ${photos.slice().reverse().map((p) => `
          <div class="photo-item" data-photo="${p.id}">
            <img src="${p.dataUrl}" alt="Fortschrittsfoto ${formatDateShort(p.date)}">
            <div class="photo-item__date">${formatDateShort(p.date)}</div>
          </div>
        `).join('')}
      </div>
    `}
  `;

  wire(settings, photos);
}

/* ---------- Uebersichtstabelle aller aktuellen Werte ---------- */

function overviewTableHtml(settings) {
  const rows = CHART_METRICS.map((m) => {
    const unit = m.key === 'weight' ? settings.units : m.unit;
    const raw = bodySeries(m.key);
    if (!raw.length) return { metric: m, value: null };
    return { metric: m, value: raw[raw.length - 1].value, date: raw[raw.length - 1].date, unit };
  });
  if (rows.every((r) => r.value == null)) {
    return `<p class="faint" style="padding:0 2px">Noch keine Messwerte erfasst.</p>`;
  }
  return `
    <div class="card">
      <table class="overview-table">
        <tbody>
          ${rows.map((r) => `
            <tr>
              <td class="faint">${r.metric.label}</td>
              <td class="overview-table__value">${r.value != null ? `${formatNum(r.value, r.metric.decimals)} ${r.unit}` : '–'}</td>
              <td class="faint overview-table__date">${r.date ? formatDateShort(r.date) : ''}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

/* ---------- Metrik-Karte mit Zeitraum-Umschalter ---------- */

function metricCardHtml(metric, settings) {
  const unit = metric.key === 'weight' ? settings.units : metric.unit;
  const raw = bodySeries(metric.key);
  const gran = granularityByMetric.get(metric.key) || 'day';
  const series = aggregateSeries(raw, gran);
  const open = expandedMetrics.has(metric.key);

  const last = raw.length ? raw[raw.length - 1].value : null;
  const prev = raw.length > 1 ? raw[raw.length - 2].value : null;
  const delta = last != null && prev != null ? last - prev : null;

  return `
    <div class="card metric-card" data-metric="${metric.key}">
      <div class="row row--between metric-card__head" data-toggle-metric="${metric.key}">
        <div class="col grow">
          <h3>${metric.label}</h3>
          <p class="faint">
            ${last != null ? `${formatNum(last, metric.decimals)} ${unit}` : 'keine Daten'}
            ${delta != null && delta !== 0 ? ` · ${delta > 0 ? '▲' : '▼'} ${formatNum(Math.abs(delta), metric.decimals)}` : ''}
          </p>
        </div>
        <button class="icon-btn" aria-label="${open ? 'Zuklappen' : 'Aufklappen'}">
          <svg viewBox="0 0 24 24" style="transform:rotate(${open ? 180 : 0}deg)"><path d="M6 9l6 6 6-6"/></svg>
        </button>
      </div>

      ${!raw.length ? '' : `
        <div class="chip-row metric-card__gran">
          ${GRANULARITIES.map((g) => `
            <button class="chip ${g.key === gran ? 'active' : ''}" data-gran="${g.key}" data-for="${metric.key}">${g.label}</button>
          `).join('')}
          <button class="chip" data-fullscreen="${metric.key}" aria-label="Vergrößern">⛶</button>
        </div>
        ${open ? `
          <div class="metric-card__chart">
            ${lineChart(series, { unit, granularity: gran, decimals: metric.decimals, large: true, showValues: series.length <= 12 })}
          </div>
          ${gran !== 'day' ? `<p class="faint" style="margin-top:6px">Mittelwerte je ${GRANULARITIES.find((g) => g.key === gran).label} · ${series.length} Zeiträume</p>` : ''}
        ` : `
          <div class="metric-card__chart metric-card__chart--mini">
            ${lineChart(series, { unit, granularity: gran, decimals: metric.decimals })}
          </div>
        `}
      `}
    </div>
  `;
}

/* ---------- Kalorienbedarf ---------- */

function calorieSectionHtml() {
  const needs = calcCalorieNeeds();
  if (!needs) {
    const missing = missingProfileFields();
    return `
      <div class="card">
        <p class="muted">Für die Berechnung fehlen noch: <strong>${missing.join(', ')}</strong></p>
        <button class="btn btn-ghost btn-sm" id="go-profile" style="margin-top:12px;width:100%">Profil vervollständigen</button>
      </div>
    `;
  }

  const { targets, bmr, baseWithoutTraining, trainingDaily, training, activityLabel } = needs;
  return `
    <div class="card">
      <div class="stack">
        ${targets.map((t) => `
          <div class="row row--between kcal-row ${t.key === 'maintain' ? 'kcal-row--main' : ''}">
            <div class="col grow">
              <p>${t.label}</p>
              <p class="faint">${t.hint}${t.belowBmr ? ' · unter Grundumsatz' : ''}</p>
            </div>
            <div class="kcal-value ${t.belowBmr ? 'kcal-value--warn' : ''}">${t.kcal} kcal</div>
          </div>
        `).join('')}
      </div>
      ${targets.some((t) => t.belowBmr) ? `
        <p class="faint" style="margin-top:12px">⚠️ Markierte Werte liegen unter deinem Grundumsatz (${bmr} kcal). Solche Defizite sind auf Dauer meist nicht sinnvoll.</p>
      ` : ''}
      <button class="btn btn-ghost btn-sm" id="kcal-details" style="margin-top:14px;width:100%">Wie wird das berechnet?</button>
    </div>
    <p class="faint" style="padding:0 2px">Grundumsatz ${bmr} kcal · Alltag (${activityLabel}) ${baseWithoutTraining} kcal · Training Ø ${trainingDaily} kcal/Tag aus ${training.sessions} geplanten Einheiten.</p>
  `;
}

function openCalorieDetails() {
  const needs = calcCalorieNeeds();
  if (!needs) return;
  const { bmr, activityLabel, activityFactor, baseWithoutTraining, trainingDaily, maintenance, training, weightKg, age } = needs;

  openModal(`
    <h3 class="modal-title">Berechnungsgrundlage</h3>
    <div class="stack">
      <div class="row row--between"><span class="muted">Gewicht / Alter</span><span>${formatNum(weightKg)} kg · ${age} J.</span></div>
      <div class="row row--between"><span class="muted">Grundumsatz (Mifflin-St-Jeor)</span><span>${bmr} kcal</span></div>
      <div class="row row--between"><span class="muted">Alltagsaktivität (${activityLabel})</span><span>× ${activityFactor}</span></div>
      <div class="row row--between"><span class="muted">= ohne Training</span><span>${baseWithoutTraining} kcal</span></div>
    </div>

    <div class="section-title">Geplanter Trainingszyklus</div>
    ${training.sessions === 0 ? `<p class="faint">Noch kein Wochenplan hinterlegt – ohne Plan wird kein Trainingsverbrauch eingerechnet.</p>` : `
      <div class="stack">
        ${training.days.map((d) => `
          <div class="row row--between">
            <span class="muted">${formatDateKey(d.date, { withWeekday: true })} · ${escapeHtml(d.routineName)}</span>
            <span>${Math.round(d.minutes)} min · ${Math.round(d.kcal)} kcal</span>
          </div>
        `).join('')}
        <div class="row row--between" style="border-top:1px solid var(--border); padding-top:10px">
          <span class="muted">Woche gesamt</span>
          <span>${Math.round(training.weeklyMinutes)} min · ${Math.round(training.weeklyKcal)} kcal</span>
        </div>
        <div class="row row--between">
          <span class="muted">Ø pro Tag</span><span>${trainingDaily} kcal</span>
        </div>
      </div>
    `}

    <div class="row row--between" style="margin-top:16px;font-weight:700">
      <span>Erhaltungsbedarf</span><span>${maintenance} kcal</span>
    </div>

    <p class="faint" style="margin-top:16px">
      Alle Werte sind Schätzungen auf Basis gängiger Formeln (Mifflin-St-Jeor, MET-Werte) und können
      individuell deutlich abweichen. Sie ersetzen keine ärztliche oder ernährungsberaterische Beratung.
      Beobachte deine tatsächliche Gewichtsentwicklung über 2–3 Wochen und passe die Zufuhr entsprechend an.
    </p>
    <button class="btn btn-primary" data-close-modal style="margin-top:16px">Schließen</button>
  `, {});
}

/* ---------- Vollbild-Diagramm ---------- */

function openFullscreenChart(metricKey, settings) {
  const metric = CHART_METRICS.find((m) => m.key === metricKey);
  if (!metric) return;
  const unit = metric.key === 'weight' ? settings.units : metric.unit;
  let gran = granularityByMetric.get(metricKey) || 'day';

  const handle = openModal(content(), {});
  wireModal();

  function content() {
    const series = aggregateSeries(bodySeries(metricKey), gran);
    return `
      <h3 class="modal-title">${metric.label}</h3>
      <div class="chip-row" style="margin-bottom:14px">
        ${GRANULARITIES.map((g) => `<button class="chip ${g.key === gran ? 'active' : ''}" data-fs-gran="${g.key}">${g.label}</button>`).join('')}
      </div>
      <div class="chart-fullscreen">
        ${lineChart(series, { unit, granularity: gran, decimals: metric.decimals, large: true, showValues: series.length <= 14 })}
      </div>
      ${series.length ? `
        <div class="grid-3" style="margin-top:14px">
          <div class="stat-tile"><div class="stat-tile__value">${formatNum(Math.min(...series.map((s) => s.value)), metric.decimals)}</div><div class="stat-tile__label">Minimum</div></div>
          <div class="stat-tile"><div class="stat-tile__value">${formatNum(series.reduce((a, s) => a + s.value, 0) / series.length, metric.decimals)}</div><div class="stat-tile__label">Durchschnitt</div></div>
          <div class="stat-tile"><div class="stat-tile__value">${formatNum(Math.max(...series.map((s) => s.value)), metric.decimals)}</div><div class="stat-tile__label">Maximum</div></div>
        </div>
      ` : ''}
      <button class="btn btn-primary" data-close-modal style="margin-top:16px">Schließen</button>
    `;
  }

  function wireModal() {
    handle.sheet.querySelectorAll('[data-fs-gran]').forEach((b) => b.addEventListener('click', () => {
      gran = b.dataset.fsGran;
      granularityByMetric.set(metricKey, gran);
      handle.sheet.innerHTML = '<div class="modal-handle"></div>' + content();
      wireModal();
      handle.sheet.querySelectorAll('[data-close-modal]').forEach((c) => c.addEventListener('click', handle.close));
    }));
  }
}

/* ---------- Events ---------- */

function wire(settings, photos) {
  document.getElementById('add-entry').addEventListener('click', () => openEntryForm(settings));
  document.getElementById('body-add').addEventListener('click', () => openEntryForm(settings));
  document.getElementById('go-profile')?.addEventListener('click', () => { location.hash = '#/more'; });
  document.getElementById('kcal-details')?.addEventListener('click', openCalorieDetails);

  document.querySelectorAll('[data-toggle-metric]').forEach((el) => el.addEventListener('click', () => {
    const key = el.dataset.toggleMetric;
    if (expandedMetrics.has(key)) expandedMetrics.delete(key); else expandedMetrics.add(key);
    render();
  }));

  document.querySelectorAll('[data-gran]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    granularityByMetric.set(b.dataset.for, b.dataset.gran);
    render();
  }));

  document.querySelectorAll('[data-fullscreen]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    openFullscreenChart(b.dataset.fullscreen, settings);
  }));

  document.querySelectorAll('[data-del-entry]').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    const ok = await confirmDialog('Eintrag löschen?', 'Dieser Körperdaten-Eintrag wird entfernt.');
    if (ok) { deleteBodyEntry(b.dataset.delEntry); render(); }
  }));

  document.getElementById('photo-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    toast('Foto wird gespeichert…');
    const reader = new FileReader();
    reader.onload = async () => {
      const resized = await resizeImage(reader.result);
      await putPhoto({ id: uid(), date: todayKey(), dataUrl: resized });
      toast('Foto gespeichert');
      render();
    };
    reader.readAsDataURL(file);
  });

  document.querySelectorAll('[data-photo]').forEach((el) => {
    el.addEventListener('click', () => openPhotoViewer(el.dataset.photo, photos));
  });
}

function summarizeEntry(entry, settings) {
  return BODY_METRICS
    .filter((m) => entry[m.key] != null)
    .map((m) => `${m.label}: ${formatNum(entry[m.key], m.decimals)}${m.key === 'weight' ? ' ' + settings.units : ' ' + m.unit}`)
    .join(' · ');
}

/* ---------- Eingabeformular ---------- */

function openEntryForm(settings) {
  const groups = [...new Set(BODY_METRICS.map((m) => m.group))];
  const handle = openModal(`
    <h3 class="modal-title">Messung eintragen</h3>
    <div class="field"><label>Datum</label><input class="input" type="date" id="be-date" value="${todayKey()}"></div>
    ${groups.map((g) => `
      <div class="section-title" style="margin-top:14px">${g}</div>
      ${BODY_METRICS.filter((m) => m.group === g).map((m) => `
        <div class="field">
          <label>${m.label} (${m.key === 'weight' ? settings.units : m.unit})</label>
          <input class="input" type="number" inputmode="decimal" step="0.1" id="be-${m.key}" placeholder="optional">
        </div>
      `).join('')}
    `).join('')}
    <div class="field"><label>Notiz</label><textarea class="input" id="be-note" placeholder="optional"></textarea></div>
    <button class="btn btn-primary" id="be-save">Speichern</button>
  `, {});

  // Vorherige Werte als Platzhalter, erleichtert das Eintragen
  const last = getLatestBodyEntry();
  if (last) {
    for (const m of BODY_METRICS) {
      if (last[m.key] != null) {
        handle.sheet.querySelector(`#be-${m.key}`).placeholder = `zuletzt ${formatNum(last[m.key], m.decimals)}`;
      }
    }
  }

  handle.sheet.querySelector('#be-save').addEventListener('click', () => {
    const date = handle.sheet.querySelector('#be-date').value || todayKey();
    const entry = { id: uid(), date };
    let any = false;
    for (const m of BODY_METRICS) {
      const v = handle.sheet.querySelector(`#be-${m.key}`).value;
      if (v !== '') { entry[m.key] = Number(v); any = true; }
    }
    const note = handle.sheet.querySelector('#be-note').value.trim();
    if (note) entry.note = note;
    if (!any) { toast('Bitte mindestens einen Wert eingeben'); return; }
    saveBodyEntry(entry);
    toast('Gespeichert');
    handle.close();
    render();
  });
}

function openPhotoViewer(id, photos) {
  const photo = photos.find((p) => p.id === id);
  if (!photo) return;
  const handle = openModal(`
    <h3 class="modal-title">${formatDate(photo.date, { withWeekday: true, withYear: true })}</h3>
    <img src="${photo.dataUrl}" style="width:100%;border-radius:12px;margin-bottom:14px">
    <button class="btn btn-danger" id="photo-del">Foto löschen</button>
  `, {});
  handle.sheet.querySelector('#photo-del').addEventListener('click', async () => {
    const ok = await confirmDialog('Foto löschen?', 'Dieses Fortschrittsfoto wird dauerhaft entfernt.');
    if (ok) { await deletePhoto(id); handle.close(); render(); }
  });
}
