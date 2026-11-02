// Mapa muscular frontal y dorsal en SVG. Pinta cada grupo según las series hechas.
import { esc, fmt } from './ui.js';

const BASE = '#232b36';
const OUT = '#3a4553';

// Formas simples y simétricas (viewBox 120 x 250 por figura).
const sym = (fn) => fn(1) + fn(-1);
const ell = (cx, cy, rx, ry, m, rot = 0) => `<ellipse data-m="${m}" cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" ${rot ? `transform="rotate(${rot} ${cx} ${cy})"` : ''}/>`;
const mirror = (x) => (s) => 60 + s * x;

const FRONT = () => `
  <circle class="neutral" cx="60" cy="20" r="13"/>
  <rect class="neutral" x="54" y="31" width="12" height="9" rx="4"/>
  ${sym((s) => ell(mirror(24)(s), 50, 11, 9, 'Hombros', s * 20))}
  ${sym((s) => `<path data-m="Pecho" d="M60 44 Q${60 + s * 22} 41 ${60 + s * 26} 52 Q${60 + s * 24} 68 ${60 + s * 6} 68 Q60 66 60 60 Z"/>`)}
  ${sym((s) => ell(mirror(31)(s), 76, 6.5, 15, 'Bíceps', s * 8))}
  ${sym((s) => ell(mirror(35)(s), 106, 5.5, 15, 'neutral', s * 6))}
  <rect data-m="Abdominales" x="47" y="70" width="26" height="44" rx="9"/>
  ${sym((s) => `<path class="neutral" d="M${60 + s * 13} 72 Q${60 + s * 19} 92 ${60 + s * 15} 116 L${60 + s * 13} 114 Z"/>`)}
  ${sym((s) => ell(mirror(15)(s), 150, 11, 30, 'Cuádriceps', s * -4))}
  ${sym((s) => ell(mirror(5)(s), 142, 4, 18, 'Aductores', s * -6))}
  ${sym((s) => ell(mirror(15)(s), 203, 7, 22, 'neutral'))}
  ${sym((s) => ell(mirror(15)(s), 232, 6, 5, 'neutral'))}`;

const BACK = () => `
  <circle class="neutral" cx="60" cy="20" r="13"/>
  <rect class="neutral" x="54" y="31" width="12" height="9" rx="4"/>
  ${sym((s) => ell(mirror(24)(s), 50, 11, 9, 'Hombros', s * 20))}
  <path data-m="Espalda" d="M60 40 L82 50 Q84 70 72 96 L60 104 L48 96 Q36 70 38 50 Z"/>
  ${sym((s) => ell(mirror(31)(s), 76, 6.5, 15, 'Tríceps', s * 8))}
  ${sym((s) => ell(mirror(35)(s), 106, 5.5, 15, 'neutral', s * 6))}
  <rect class="neutral" x="49" y="98" width="22" height="14" rx="6"/>
  ${sym((s) => ell(mirror(11)(s), 124, 12, 12, 'Glúteos'))}
  ${sym((s) => ell(mirror(14)(s), 160, 10, 24, 'Isquiotibiales', s * -3))}
  ${sym((s) => ell(mirror(15)(s), 204, 8, 20, 'Gemelos'))}
  ${sym((s) => ell(mirror(15)(s), 232, 6, 5, 'neutral'))}`;

export const MUSCLES = ['Pecho', 'Espalda', 'Hombros', 'Bíceps', 'Tríceps', 'Abdominales', 'Cuádriceps', 'Isquiotibiales', 'Glúteos', 'Aductores', 'Gemelos'];

/** muscles: [{muscle, sets}] -> HTML con figura frontal, dorsal y leyenda. */
export function muscleMap(muscles = [], { legend = true, compact = false } = {}) {
  const sets = new Map(muscles.map((m) => [m.muscle, m.sets]));
  const max = Math.max(1, ...sets.values());
  const color = (m) => {
    const v = sets.get(m) || 0;
    if (!v) return BASE;
    const a = 0.28 + 0.72 * (v / max);
    return `rgba(237, 25, 57, ${a.toFixed(2)})`;
  };
  // Las formas son elementos vacíos (/>): se reescriben para pintarlas e incluir <title>.
  const withTitles = (svg) => svg.replace(/<(ellipse|path|rect)([^>]*?)data-m="([^"]+)"([^>]*?)\/>/g, (_, tag, a, m, b) =>
    m === 'neutral'
      ? `<${tag}${a}class="neutral"${b}/>`
      : `<${tag}${a}data-m="${m}" fill="${color(m)}"${b}><title>${esc(m)}: ${fmt(sets.get(m) || 0)} series</title></${tag}>`);
  const figure = (svg, label) => `<figure><svg viewBox="0 0 120 250" class="body-svg" role="img" aria-label="${label}">
    <g stroke="${OUT}" stroke-width="1" fill="${BASE}">${withTitles(svg())}</g></svg><figcaption>${label}</figcaption></figure>`;
  const worked = MUSCLES.filter((m) => sets.get(m)).sort((a, b) => sets.get(b) - sets.get(a));
  const leg = legend && worked.length
    ? `<ul class="muscle-legend">${worked.map((m) => `<li><span class="sw" style="background:${color(m)}"></span>${esc(m)}<b>${fmt(sets.get(m))}</b></li>`).join('')}</ul>`
    : '';
  return `<div class="muscle-map ${compact ? 'compact' : ''}"><div class="figures">${figure(FRONT, 'Frente')}${figure(BACK, 'Espalda')}</div>${leg}</div>`;
}
