import { setTitle, setActions, setBack, navigate } from '../router.js';
import { getDueItems, markMaintenanceDone, markPlantWatered, markPetVetDone } from '../db.js';
import { todayKey, formatDateKey, escapeHtml } from '../utils.js';

export function render() {
  setTitle('Fällig');
  setBack(null);
  setActions('');
  draw();
}

function draw() {
  const view = document.getElementById('view');
  const items = getDueItems();
  const today = todayKey();

  view.innerHTML = `
    ${items.length === 0 ? `
      <div class="empty">
        <h3>Nichts angelegt</h3>
        <p class="faint">Lege unter "Verwaltung" Wartungsaufgaben/Verträge oder unter "Pflanzen &amp; Tiere" deine Pflanzen/Haustiere an.</p>
      </div>
    ` : `
      <div class="card">
        ${items.map((item) => {
          const overdue = item.dueDate <= today;
          return `
            <div class="due-row">
              <div class="col grow" style="min-width:0">
                <p class="due-row__title truncate">${escapeHtml(item.title)}</p>
                <p class="due-row__meta"><span class="badge kind-badge">${item.meta}</span></p>
              </div>
              <span class="due-row__date ${overdue ? 'due-row__date--overdue' : ''}">${formatDateKey(item.dueDate)}</span>
              ${item.kind !== 'contract' ? `<button class="icon-btn" data-done="${item.kind}:${item.id}" aria-label="Erledigt"><svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg></button>` : ''}
            </div>
          `;
        }).join('')}
      </div>
      ${items.some((i) => i.kind === 'contract') ? '<p class="faint" style="margin-top:10px">Vertrags-Fristen bitte unter "Verwaltung" bearbeiten.</p>' : ''}
    `}
  `;

  view.querySelectorAll('[data-done]').forEach((el) => {
    el.addEventListener('click', () => {
      const [kind, id] = el.dataset.done.split(':');
      if (kind === 'maintenance') markMaintenanceDone(id);
      else if (kind === 'plant') markPlantWatered(id);
      else if (kind === 'pet') markPetVetDone(id);
      draw();
    });
  });
}
