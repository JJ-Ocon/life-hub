import { setTitle, setActions, setBack, navigate } from '../router.js';
import { getPeople, getLinks, confirmedByOf, isMutualLink } from '../../../shared/contacts.js';
import { escapeHtml } from '../utils.js';

const WIDTH = 340;
const HEIGHT = 420;

export function render() {
  setTitle('Netzwerk');
  setBack(null);
  setActions('');
  draw();
}

function draw() {
  const view = document.getElementById('view');
  const people = getPeople();
  const links = getLinks().filter((l) => people.some((p) => p.id === l.personIdA) && people.some((p) => p.id === l.personIdB));

  if (!people.length) {
    view.innerHTML = `<div class="empty"><h3>Noch keine Kontakte</h3><p class="faint">Lege Kontakte an und verknüpfe sie, um das Netzwerk zu sehen.</p></div>`;
    return;
  }

  const positions = layout(people, links);
  const nodeById = new Map(people.map((p, i) => [p.id, positions[i]]));

  const edgesSvg = links.map((l) => {
    const mutual = isMutualLink(l);
    // Bei einseitigem Kennen zeigt der Pfeil von der bestaetigenden Person
    // zur (noch) nicht-bestaetigenden - bei beidseitigem eine schlichte
    // Linie ohne Pfeilspitze, da die Richtung dann keine Information mehr traegt.
    const fromId = mutual ? l.personIdA : confirmedByOf(l)[0];
    const toId = fromId === l.personIdA ? l.personIdB : l.personIdA;
    const from = nodeById.get(fromId);
    const to = nodeById.get(toId);
    if (!from || !to) return '';
    return `<line class="network-link ${mutual ? '' : 'network-link--one-way'}" x1="${from.x.toFixed(1)}" y1="${from.y.toFixed(1)}" x2="${to.x.toFixed(1)}" y2="${to.y.toFixed(1)}" ${mutual ? '' : 'marker-end="url(#network-arrow)"'}/>`;
  }).join('');

  const nodesSvg = people.map((p, i) => {
    const pos = positions[i];
    return `
      <g data-person="${p.id}">
        <circle class="network-node" cx="${pos.x.toFixed(1)}" cy="${pos.y.toFixed(1)}" r="16"></circle>
        <text x="${pos.x.toFixed(1)}" y="${(pos.y + 30).toFixed(1)}" text-anchor="middle">${escapeHtml(p.name.split(' ')[0])}</text>
      </g>
    `;
  }).join('');

  view.innerHTML = `
    <p class="faint" style="margin-bottom:12px">Manuell gepflegte Verknüpfungen aus den Kontakt-Details. Ein Pfeil zeigt einseitiges Kennen (von der bestätigenden zur anderen Person), eine schlichte Linie beidseitig bestätigtes. Antippen öffnet die Person.</p>
    <svg class="network-svg" viewBox="0 0 ${WIDTH} ${HEIGHT}">
      <defs>
        <marker id="network-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0L10 5L0 10z" class="network-arrowhead"></path>
        </marker>
      </defs>
      ${edgesSvg}
      ${nodesSvg}
    </svg>
  `;

  view.querySelectorAll('[data-person]').forEach((el) => {
    el.addEventListener('click', () => navigate(`#/person/${el.dataset.person}`));
  });
}

/**
 * Minimalistischer Force-Directed-Layout (vereinfachtes Fruchterman-Reingold,
 * keine externe Bibliothek). Feste Anzahl Iterationen, dann statisch
 * gerendert - reicht fuer die ueberschaubare Anzahl an Kontakten hier.
 */
function layout(people, links) {
  const n = people.length;
  const idxById = new Map(people.map((p, i) => [p.id, i]));
  const pos = people.map(() => ({
    x: WIDTH / 2 + (Math.random() - 0.5) * WIDTH * 0.6,
    y: HEIGHT / 2 + (Math.random() - 0.5) * HEIGHT * 0.6,
  }));
  const area = WIDTH * HEIGHT;
  const k = Math.sqrt(area / Math.max(1, n)) * 0.8; // idealer Abstand

  const edges = links
    .map((l) => [idxById.get(l.personIdA), idxById.get(l.personIdB)])
    .filter(([a, b]) => a !== undefined && b !== undefined);

  let temp = WIDTH / 10;
  const iterations = 150;

  for (let iter = 0; iter < iterations; iter++) {
    const disp = pos.map(() => ({ x: 0, y: 0 }));

    // Abstossung zwischen allen Knotenpaaren
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = pos[i].x - pos[j].x;
        let dy = pos[i].y - pos[j].y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const force = (k * k) / dist;
        dx = (dx / dist) * force;
        dy = (dy / dist) * force;
        disp[i].x += dx; disp[i].y += dy;
        disp[j].x -= dx; disp[j].y -= dy;
      }
    }

    // Anziehung entlang der Kanten
    for (const [a, b] of edges) {
      let dx = pos[a].x - pos[b].x;
      let dy = pos[a].y - pos[b].y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const force = (dist * dist) / k;
      dx = (dx / dist) * force;
      dy = (dy / dist) * force;
      disp[a].x -= dx; disp[a].y -= dy;
      disp[b].x += dx; disp[b].y += dy;
    }

    // Leichte Kraft zur Mitte, damit nichts wegdriftet
    for (let i = 0; i < n; i++) {
      disp[i].x += (WIDTH / 2 - pos[i].x) * 0.01;
      disp[i].y += (HEIGHT / 2 - pos[i].y) * 0.01;
    }

    // Verschiebung anwenden, begrenzt durch Temperatur
    for (let i = 0; i < n; i++) {
      const dist = Math.sqrt(disp[i].x ** 2 + disp[i].y ** 2) || 0.01;
      pos[i].x += (disp[i].x / dist) * Math.min(dist, temp);
      pos[i].y += (disp[i].y / dist) * Math.min(dist, temp);
      pos[i].x = Math.max(30, Math.min(WIDTH - 30, pos[i].x));
      pos[i].y = Math.max(30, Math.min(HEIGHT - 40, pos[i].y));
    }

    temp *= 0.96; // Abkuehlung
  }

  return pos;
}
