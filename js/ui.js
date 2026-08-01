// Toast-Nachrichten, Bottom-Sheet-Modals und Bestaetigungsdialoge.

const toastRoot = document.getElementById('toast-root');
const modalRoot = document.getElementById('modal-root');

export function toast(msg, ms = 2200) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  toastRoot.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

/** Toast mit einer "Rueckgaengig"-Aktion – fuer riskantere Bulk-Aktionen. */
export function toastWithUndo(msg, onUndo, ms = 5000) {
  const el = document.createElement('div');
  el.className = 'toast toast--action';
  const text = document.createElement('span');
  text.textContent = msg;
  const btn = document.createElement('button');
  btn.className = 'toast__undo';
  btn.textContent = 'Rückgängig';
  let settled = false;
  btn.addEventListener('click', () => {
    if (settled) return;
    settled = true;
    onUndo();
    el.remove();
  });
  el.append(text, btn);
  toastRoot.appendChild(el);
  setTimeout(() => { settled = true; el.remove(); }, ms);
}

let modalStack = [];

/**
 * Oeffnet ein Bottom-Sheet-Modal.
 * @param {string} innerHtml Inhalt des Sheets (ohne Overlay/Handle)
 * @param {{center?: boolean, onClose?: Function}} opts
 * @returns {{close: Function, el: HTMLElement}}
 */
export function openModal(innerHtml, opts = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const sheet = document.createElement('div');
  sheet.className = 'modal-sheet' + (opts.center ? ' modal-sheet--center' : '');
  sheet.innerHTML = (opts.center ? '' : '<div class="modal-handle"></div>') + innerHtml;
  overlay.appendChild(sheet);
  modalRoot.appendChild(overlay);

  function close() {
    overlay.remove();
    modalStack = modalStack.filter((m) => m.overlay !== overlay);
    opts.onClose?.();
  }
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  sheet.querySelectorAll('[data-close-modal]').forEach((b) => b.addEventListener('click', close));

  const handle = { overlay, sheet, close };
  modalStack.push(handle);
  return handle;
}

export function closeAllModals() {
  modalStack.slice().forEach((m) => m.close());
}

/** Einfacher Bestaetigungsdialog. Gibt ein Promise<boolean> zurueck. */
export function confirmDialog(title, text, confirmLabel = 'Löschen', danger = true) {
  return new Promise((resolve) => {
    const handle = openModal(`
      <h3 class="modal-title">${title}</h3>
      <p class="muted" style="margin-bottom:18px">${text}</p>
      <div class="row" style="gap:10px">
        <button class="btn btn-ghost" data-act="cancel">Abbrechen</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok">${confirmLabel}</button>
      </div>
    `, { center: true, onClose: () => resolve(false) });
    handle.sheet.querySelector('[data-act="cancel"]').addEventListener('click', () => { resolve(false); handle.close(); });
    handle.sheet.querySelector('[data-act="ok"]').addEventListener('click', () => { resolve(true); handle.close(); });
  });
}

/** Einfacher Prompt-Dialog (Text-Eingabe). Gibt Promise<string|null> zurueck. */
export function promptDialog(title, { placeholder = '', value = '', confirmLabel = 'Speichern' } = {}) {
  return new Promise((resolve) => {
    const handle = openModal(`
      <h3 class="modal-title">${title}</h3>
      <input class="input" id="prompt-input" placeholder="${placeholder}" value="${value}" style="margin-bottom:16px" />
      <div class="row" style="gap:10px">
        <button class="btn btn-ghost" data-act="cancel">Abbrechen</button>
        <button class="btn btn-primary" data-act="ok">${confirmLabel}</button>
      </div>
    `, { center: true, onClose: () => resolve(null) });
    const input = handle.sheet.querySelector('#prompt-input');
    input.focus();
    input.select();
    const submit = () => { const v = input.value.trim(); resolve(v || null); handle.close(); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    handle.sheet.querySelector('[data-act="cancel"]').addEventListener('click', () => { resolve(null); handle.close(); });
    handle.sheet.querySelector('[data-act="ok"]').addEventListener('click', submit);
  });
}
