import { setTitle, setActions, setBack } from '../router.js';
import {
  getEntryByDate, saveEntry, currentStreak, shouldShowSupportHint,
  reflectionQuestionFor, SUGGESTED_TAGS,
} from '../db.js';
import { toast } from '../ui.js';
import { todayKey, escapeHtml } from '../utils.js';

let selectedMood = null;
let selectedTags = [];

export function render() {
  setTitle('Heute');
  setBack(null);
  setActions('');
  draw();
}

function draw() {
  const view = document.getElementById('view');
  const today = todayKey();
  const existing = getEntryByDate(today);
  selectedMood = existing?.mood ?? selectedMood ?? null;
  selectedTags = existing?.tags ? [...existing.tags] : selectedTags;
  const question = reflectionQuestionFor(today);
  const streak = currentStreak();
  const showHint = shouldShowSupportHint();

  view.innerHTML = `
    ${showHint ? `
      <div class="card" style="border-color:var(--accent);background:var(--bg-elevated)">
        <p style="font-weight:700;margin-bottom:6px">Du hattest zuletzt öfter niedrigere Tage.</p>
        <p class="faint">Das ist kein Urteil und keine Diagnose — nur ein sanfter Hinweis: Reden hilft oft, ob mit jemandem, dem du vertraust, oder professionell. Die Telefonseelsorge ist kostenlos, anonym und rund um die Uhr erreichbar: <strong>0800 111 0 111</strong> oder <strong>0800 111 0 222</strong>.</p>
      </div>
    ` : ''}

    ${streak > 0 ? `<p class="faint" style="margin-bottom:14px">🔥 ${streak} Tage in Folge</p>` : ''}

    <div class="card">
      <div class="section-title" style="margin-top:0">Wie geht es dir heute?</div>
      <div class="chip-row" id="mood-row">
        ${Array.from({ length: 10 }, (_, i) => i + 1).map((n) => `
          <button type="button" class="chip ${selectedMood === n ? 'active' : ''}" data-mood="${n}">${n}</button>
        `).join('')}
      </div>
    </div>

    <div class="section-title">Kontext (optional)</div>
    <div class="card">
      <div class="chip-row" id="tag-row">
        ${SUGGESTED_TAGS.map((t) => `<button type="button" class="chip ${selectedTags.includes(t) ? 'active' : ''}" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join('')}
      </div>
      <div class="row" style="gap:8px;margin-top:12px">
        <input class="input" id="custom-tag" placeholder="Eigenes Tag hinzufügen">
        <button class="btn btn-ghost btn-sm" id="add-tag">+</button>
      </div>
    </div>

    <div class="section-title">Reflexion</div>
    <div class="card">
      <p style="margin-bottom:10px">${escapeHtml(question)}</p>
      <textarea class="input" id="reflection-answer" placeholder="Optional">${escapeHtml(existing?.reflectionAnswer || '')}</textarea>
    </div>

    <div class="section-title">Notiz (optional)</div>
    <div class="card">
      <textarea class="input" id="note">${escapeHtml(existing?.note || '')}</textarea>
    </div>

    <button class="btn btn-primary" id="save-entry" style="margin-top:16px">Speichern</button>
  `;

  view.querySelectorAll('[data-mood]').forEach((el) => el.addEventListener('click', () => {
    selectedMood = Number(el.dataset.mood);
    view.querySelectorAll('[data-mood]').forEach((x) => x.classList.toggle('active', Number(x.dataset.mood) === selectedMood));
  }));

  view.querySelectorAll('[data-tag]').forEach((el) => el.addEventListener('click', () => {
    const tag = el.dataset.tag;
    if (selectedTags.includes(tag)) selectedTags = selectedTags.filter((t) => t !== tag);
    else selectedTags.push(tag);
    el.classList.toggle('active', selectedTags.includes(tag));
  }));

  document.getElementById('add-tag').addEventListener('click', () => {
    const input = document.getElementById('custom-tag');
    const tag = input.value.trim();
    if (!tag || selectedTags.includes(tag)) return;
    selectedTags.push(tag);
    input.value = '';
    draw();
  });

  document.getElementById('save-entry').addEventListener('click', () => {
    if (!selectedMood) { toast('Bitte eine Stimmung wählen'); return; }
    saveEntry({
      date: today, mood: selectedMood, tags: selectedTags,
      note: document.getElementById('note').value.trim(),
      reflectionQuestion: question,
      reflectionAnswer: document.getElementById('reflection-answer').value.trim(),
    });
    toast('Gespeichert');
    draw();
  });
}
