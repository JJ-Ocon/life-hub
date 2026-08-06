import { setTitle, setActions, setBack } from '../router.js';
import { getEntries, saveEntry, deleteEntry, SUGGESTED_TAGS } from '../db.js';
import { openModal, confirmDialog, toast } from '../ui.js';
import { formatDateKey, addDaysToDateKey, todayKey, escapeHtml } from '../utils.js';

export function render() {
  setTitle('Verlauf');
  setBack(null);
  setActions('');
  draw();
}

function moodColor(mood) {
  if (mood >= 7) return 'var(--ok)';
  if (mood >= 4) return 'var(--warn)';
  return 'var(--danger)';
}

function draw() {
  const view = document.getElementById('view');
  const entries = getEntries();
  const byDate = new Map(entries.map((e) => [e.date, e]));
  const today = todayKey();
  const last14 = Array.from({ length: 14 }, (_, i) => addDaysToDateKey(today, -(13 - i)));

  view.innerHTML = `
    <div class="card">
      <div class="section-title" style="margin-top:0">Letzte 14 Tage</div>
      <div style="display:flex;align-items:flex-end;gap:4px;height:90px">
        ${last14.map((d) => {
          const e = byDate.get(d);
          const h = e ? Math.max(6, Math.round((e.mood / 10) * 100)) : 0;
          return `<div style="flex:1;height:100%;display:flex;align-items:flex-end" title="${d}">
            <div style="width:100%;height:${h}%;border-radius:3px;background:${e ? moodColor(e.mood) : 'var(--bg-input)'}"></div>
          </div>`;
        }).join('')}
      </div>
    </div>

    ${entries.length === 0 ? `
      <div class="empty">
        <h3>Noch keine Einträge</h3>
        <p class="faint">Dein erster Check-in wartet unter "Heute".</p>
      </div>
    ` : `
      <div class="section-title">Alle Einträge</div>
      <div class="card">
        ${entries.map((e) => `
          <div class="due-row" data-open="${e.date}" style="cursor:pointer">
            <div class="col grow" style="min-width:0">
              <p class="due-row__title truncate">${formatDateKey(e.date, { withYear: true })}${e.tags.length ? ' · ' + e.tags.map(escapeHtml).join(', ') : ''}</p>
              ${e.note ? `<p class="due-row__meta truncate">${escapeHtml(e.note)}</p>` : ''}
            </div>
            <span class="badge" style="background:${moodColor(e.mood)};color:#06131f;font-weight:800">${e.mood}</span>
          </div>
        `).join('')}
      </div>
    `}
  `;

  view.querySelectorAll('[data-open]').forEach((el) => {
    el.addEventListener('click', () => openEntryModal(byDate.get(el.dataset.open), draw));
  });
}

function openEntryModal(entry, onSaved) {
  let mood = entry.mood;
  let tags = [...entry.tags];

  const handle = openModal(`
    <h3 class="modal-title">${formatDateKey(entry.date, { withYear: true })}</h3>
    <div class="field">
      <label>Stimmung</label>
      <div class="chip-row" id="mood-row">
        ${Array.from({ length: 10 }, (_, i) => i + 1).map((n) => `<button type="button" class="chip ${mood === n ? 'active' : ''}" data-mood="${n}">${n}</button>`).join('')}
      </div>
    </div>
    <div class="field">
      <label>Kontext</label>
      <div class="chip-row" id="tag-row">
        ${SUGGESTED_TAGS.map((t) => `<button type="button" class="chip ${tags.includes(t) ? 'active' : ''}" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join('')}
      </div>
    </div>
    <div class="field">
      <label>${escapeHtml(entry.reflectionQuestion || 'Reflexion')}</label>
      <textarea class="input" id="reflection-answer">${escapeHtml(entry.reflectionAnswer || '')}</textarea>
    </div>
    <div class="field">
      <label>Notiz</label>
      <textarea class="input" id="note">${escapeHtml(entry.note || '')}</textarea>
    </div>
    <div class="stack">
      <button class="btn btn-primary" id="save">Speichern</button>
      <button class="btn btn-danger" id="delete">Löschen</button>
    </div>
  `, { center: true });

  handle.sheet.querySelectorAll('[data-mood]').forEach((el) => el.addEventListener('click', () => {
    mood = Number(el.dataset.mood);
    handle.sheet.querySelectorAll('[data-mood]').forEach((x) => x.classList.toggle('active', Number(x.dataset.mood) === mood));
  }));
  handle.sheet.querySelectorAll('[data-tag]').forEach((el) => el.addEventListener('click', () => {
    const tag = el.dataset.tag;
    if (tags.includes(tag)) tags = tags.filter((t) => t !== tag);
    else tags.push(tag);
    el.classList.toggle('active', tags.includes(tag));
  }));

  handle.sheet.querySelector('#save').addEventListener('click', () => {
    saveEntry({
      date: entry.date, mood, tags,
      note: handle.sheet.querySelector('#note').value.trim(),
      reflectionQuestion: entry.reflectionQuestion,
      reflectionAnswer: handle.sheet.querySelector('#reflection-answer').value.trim(),
    });
    toast('Gespeichert');
    handle.close();
    onSaved?.();
  });
  handle.sheet.querySelector('#delete').addEventListener('click', async () => {
    const ok = await confirmDialog('Eintrag löschen?', 'Wird unwiderruflich gelöscht.');
    if (!ok) return;
    deleteEntry(entry.id);
    toast('Gelöscht');
    handle.close();
    onSaved?.();
  });
}
