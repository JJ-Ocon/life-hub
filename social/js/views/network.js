import { setTitle, setActions, setBack, navigate } from '../router.js';
import {
  getPeople, getLinks, confirmedByOf, isMutualLink, getMe, CLOSENESS_LEVELS, closenessRank,
} from '../../../shared/contacts.js';
import { escapeHtml } from '../utils.js';

const WIDTH = 340;
const HEIGHT = 420;
const CENTER = { x: WIDTH / 2, y: HEIGHT / 2 };
const INNER_RADIUS = 34;
const MAX_RADIUS = Math.min(WIDTH, HEIGHT) / 2 - 26;
// 6 feste Naehe-Stufen (E59) + ein 7. aeusserster Ring fuer unklassifizierte
// Kontakte, statt sie auszublenden.
const RING_COUNT = CLOSENESS_LEVELS.length + 1;
const RING_GAP = (MAX_RADIUS - INNER_RADIUS) / RING_COUNT;

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
  const me = getMe();

  if (!people.length) {
    view.innerHTML = `<div class="empty"><h3>Noch keine Kontakte</h3><p class="faint">Lege Kontakte an und verknüpfe sie, um das Netzwerk zu sehen.</p></div>`;
    return;
  }

  const positions = ringLayout(people);
  const nodeById = new Map(people.map((p, i) => [p.id, positions[i]]));

  const ringsSvg = Array.from({ length: RING_COUNT }, (_, i) => {
    const r = INNER_RADIUS + (i + 1) * RING_GAP;
    const level = CLOSENESS_LEVELS[i];
    return `
      <circle class="network-ring" cx="${CENTER.x}" cy="${CENTER.y}" r="${r.toFixed(1)}"></circle>
      <text class="network-ring-label" x="${CENTER.x}" y="${(CENTER.y - r + 11).toFixed(1)}" text-anchor="middle">${level ? escapeHtml(level.label) : 'Unklassifiziert'}</text>
    `;
  }).join('');

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
    <p class="faint" style="margin-bottom:12px">${escapeHtml(me.name)} steht im Mittelpunkt, Ringe zeigen die Nähe-Einstufung. Manuell gepflegte Verknüpfungen ("Kennt auch") aus den Kontakt-Details verbinden Personen untereinander - ein Pfeil zeigt einseitiges Kennen, eine schlichte Linie beidseitig bestätigtes. Antippen öffnet die Person, die Mitte öffnet "Mehr".</p>
    <svg class="network-svg" viewBox="0 0 ${WIDTH} ${HEIGHT}">
      <defs>
        <marker id="network-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0L10 5L0 10z" class="network-arrowhead"></path>
        </marker>
      </defs>
      ${ringsSvg}
      ${edgesSvg}
      ${nodesSvg}
      <g data-me="1">
        <circle class="network-node network-node--me" cx="${CENTER.x}" cy="${CENTER.y}" r="20"></circle>
        <text x="${CENTER.x}" y="${(CENTER.y + 4).toFixed(1)}" text-anchor="middle" class="network-me-label">${escapeHtml(me.name.split(' ')[0])}</text>
      </g>
    </svg>
  `;

  view.querySelectorAll('[data-person]').forEach((el) => {
    el.addEventListener('click', () => navigate(`#/person/${el.dataset.person}`));
  });
  view.querySelector('[data-me]').addEventListener('click', () => navigate('#/more'));
}

/**
 * Platziert jede Person auf dem Ring ihrer Naehe-Stufe (INNER_RADIUS + Rang *
 * RING_GAP) statt eines freien Force-Layouts - der Abstand zu "Ich" in der
 * Mitte soll die tatsaechliche Naehe-Einstufung direkt sichtbar machen, nicht
 * nur eine optisch huebsche, aber bedeutungslose Anordnung. Innerhalb eines
 * Rings werden die Personen gleichmaessig ueber den Kreis verteilt, mit einem
 * kleinen ring-abhaengigen Rotations-Offset, damit sich mehrere Ringe nicht
 * alle an derselben Stelle (12 Uhr) optisch "stapeln".
 */
function ringLayout(people) {
  const byRank = new Map();
  for (const p of people) {
    const rank = closenessRank(p.closeness);
    if (!byRank.has(rank)) byRank.set(rank, []);
    byRank.get(rank).push(p);
  }

  const posById = new Map();
  for (const [rank, group] of byRank) {
    const radius = INNER_RADIUS + rank * RING_GAP;
    const offset = (rank * 0.35) - Math.PI / 2; // erste Person nicht immer bei 12 Uhr
    group.forEach((p, i) => {
      const angle = offset + (2 * Math.PI * i) / group.length;
      posById.set(p.id, {
        x: CENTER.x + radius * Math.cos(angle),
        y: CENTER.y + radius * Math.sin(angle),
      });
    });
  }

  return people.map((p) => posById.get(p.id));
}
