import { setTitle, setActions, setBack } from '../router.js';
import { getStyleRules, createStyleRule, deleteStyleRule, getPalette, addToPalette, removeFromPalette } from '../db.js';
import { escapeHtml, hslToHex } from '../utils.js';
import { toast, confirmDialog } from '../ui.js';

const WHEEL_SIZE = 220;
const WHEEL_R = WHEEL_SIZE / 2;

let current = { h: 265, s: 70, l: 50 };
let wheelImage = null; // Offscreen-Canvas mit dem einmal berechneten Farbrad

export function render() {
  setTitle('Style');
  setActions('');
  setBack(null);

  const rules = getStyleRules();
  const palette = getPalette();

  document.getElementById('view').innerHTML = `
    <div class="section-title" style="margin-top:0">Style-Regeln</div>
    <div class="card">
      ${rules.length === 0 ? `<p class="faint" style="margin-bottom:12px">Noch keine eigenen Regeln notiert – z.B. "Nie mehr als zwei Muster kombinieren" oder "Immer ein Statement-Piece pro Outfit".</p>` : `
        <div class="stack" id="style-rules-list" style="margin-bottom:12px">
          ${rules.map((r) => `
            <div class="row row--between">
              <span class="grow">${escapeHtml(r.text)}</span>
              <button class="icon-btn" data-rule-del="${r.id}" aria-label="Löschen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg></button>
            </div>
          `).join('')}
        </div>
      `}
      <div class="row" style="gap:8px">
        <input class="input" id="style-rule-input" placeholder="Neue Regel …">
        <button class="btn btn-primary btn-sm" id="style-rule-add">+</button>
      </div>
    </div>

    <div class="section-title">Farbrad</div>
    <div class="card">
      <div class="row" style="gap:18px;align-items:flex-start;flex-wrap:wrap">
        <canvas id="wheel" width="${WHEEL_SIZE}" height="${WHEEL_SIZE}" style="border-radius:50%;touch-action:none;cursor:crosshair"></canvas>
        <div class="col grow" style="min-width:140px;gap:10px">
          <div class="row" style="gap:10px">
            <div id="wheel-preview" style="width:44px;height:44px;border-radius:10px;border:1px solid var(--border);flex-shrink:0"></div>
            <span class="muted" id="wheel-hex" style="font-family:ui-monospace,monospace"></span>
          </div>
          <div class="field" style="margin-bottom:0">
            <label>Helligkeit</label>
            <input type="range" min="10" max="90" id="wheel-lightness" value="${current.l}">
          </div>
          <button class="btn btn-ghost btn-sm" id="wheel-save">+ Zur Palette</button>
        </div>
      </div>
      <p class="faint" style="margin:14px 0 8px">Harmonien</p>
      <div class="grid-3" id="wheel-harmony"></div>
    </div>

    <div class="section-title">Meine Palette</div>
    <div class="card">
      ${palette.length === 0 ? `<p class="faint">Noch keine Farben gespeichert. Über das Farbrad oben ausprobieren und merken.</p>` : `
        <div class="row" style="gap:10px;flex-wrap:wrap" id="palette-grid">
          ${palette.map((hex) => `
            <button class="row" data-palette-del="${hex}" style="width:40px;height:40px;border-radius:10px;background:${hex};border:1px solid var(--border);padding:0" aria-label="${hex} entfernen" title="${hex} – antippen zum Entfernen"></button>
          `).join('')}
        </div>
      `}
    </div>
  `;

  wireStyleRules();
  wireWheel();
  wirePalette();
}

function wireStyleRules() {
  document.getElementById('style-rule-add').addEventListener('click', addRule);
  document.getElementById('style-rule-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') addRule(); });
  document.querySelectorAll('[data-rule-del]').forEach((el) => {
    el.addEventListener('click', () => {
      deleteStyleRule(el.dataset.ruleDel);
      render();
    });
  });
}

function addRule() {
  const input = document.getElementById('style-rule-input');
  const text = input.value.trim();
  if (!text) return;
  createStyleRule(text);
  render();
}

function wirePalette() {
  document.querySelectorAll('[data-palette-del]').forEach((el) => {
    el.addEventListener('click', async () => {
      const hex = el.dataset.paletteDel;
      const ok = await confirmDialog('Farbe entfernen?', `${hex} aus der Palette löschen.`);
      if (!ok) return;
      removeFromPalette(hex);
      render();
    });
  });
}

function buildWheelImage() {
  const off = document.createElement('canvas');
  off.width = WHEEL_SIZE;
  off.height = WHEEL_SIZE;
  const ctx = off.getContext('2d');
  const img = ctx.createImageData(WHEEL_SIZE, WHEEL_SIZE);
  for (let y = 0; y < WHEEL_SIZE; y++) {
    for (let x = 0; x < WHEEL_SIZE; x++) {
      const dx = x - WHEEL_R;
      const dy = y - WHEEL_R;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const idx = (y * WHEEL_SIZE + x) * 4;
      if (dist > WHEEL_R) { img.data[idx + 3] = 0; continue; }
      let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (angle < 0) angle += 360;
      const sat = Math.min(100, (dist / WHEEL_R) * 100);
      const hex = hslToHex(angle, sat, 50);
      img.data[idx] = parseInt(hex.slice(1, 3), 16);
      img.data[idx + 1] = parseInt(hex.slice(3, 5), 16);
      img.data[idx + 2] = parseInt(hex.slice(5, 7), 16);
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return off;
}

function wireWheel() {
  const canvas = document.getElementById('wheel');
  const ctx = canvas.getContext('2d');
  if (!wheelImage) wheelImage = buildWheelImage();

  function drawWheel() {
    ctx.clearRect(0, 0, WHEEL_SIZE, WHEEL_SIZE);
    ctx.drawImage(wheelImage, 0, 0);
    const angleRad = (current.h * Math.PI) / 180;
    const dist = (current.s / 100) * WHEEL_R;
    const mx = WHEEL_R + Math.cos(angleRad) * dist;
    const my = WHEEL_R + Math.sin(angleRad) * dist;
    ctx.beginPath();
    ctx.arc(mx, my, 7, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(mx, my, 7, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function currentHex() {
    return hslToHex(current.h, current.s, current.l);
  }

  function updateOutputs() {
    const hex = currentHex();
    document.getElementById('wheel-preview').style.background = hex;
    document.getElementById('wheel-hex').textContent = hex;
    const harmonies = [
      { label: 'Komplementär', h: (current.h + 180) % 360 },
      { label: 'Analog +30°', h: (current.h + 30) % 360 },
      { label: 'Analog −30°', h: (current.h + 330) % 360 },
    ];
    document.getElementById('wheel-harmony').innerHTML = harmonies.map((hm) => {
      const hHex = hslToHex(hm.h, current.s, current.l);
      return `
        <button class="col" data-harmony="${hm.h}" style="border:1px solid var(--border);border-radius:var(--radius-s);padding:8px;background:none;gap:6px;align-items:center">
          <div style="width:100%;aspect-ratio:1;border-radius:8px;background:${hHex}"></div>
          <span class="faint" style="font-size:.68rem">${hm.label}</span>
        </button>
      `;
    }).join('');
    document.querySelectorAll('[data-harmony]').forEach((btn) => {
      btn.addEventListener('click', () => {
        current = { ...current, h: Number(btn.dataset.harmony) };
        drawWheel();
        updateOutputs();
      });
    });
  }

  function pickFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = WHEEL_SIZE / rect.width;
    const scaleY = WHEEL_SIZE / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    const dx = x - WHEEL_R;
    const dy = y - WHEEL_R;
    const dist = Math.min(WHEEL_R, Math.sqrt(dx * dx + dy * dy));
    let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (angle < 0) angle += 360;
    current = { ...current, h: angle, s: (dist / WHEEL_R) * 100 };
    drawWheel();
    updateOutputs();
  }

  let dragging = false;
  canvas.addEventListener('pointerdown', (e) => { dragging = true; pickFromEvent(e); });
  window.addEventListener('pointermove', (e) => { if (dragging) pickFromEvent(e); });
  window.addEventListener('pointerup', () => { dragging = false; });

  document.getElementById('wheel-lightness').addEventListener('input', (e) => {
    current = { ...current, l: Number(e.target.value) };
    updateOutputs();
  });

  document.getElementById('wheel-save').addEventListener('click', () => {
    addToPalette(currentHex());
    toast('Zur Palette hinzugefügt');
    render();
  });

  drawWheel();
  updateOutputs();
}
