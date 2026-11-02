// Mapa muscular: usa la figura de assets/body-muscles.svg y los grupos de
// assets/muscle-map.json. Pinta cada grupo según la cantidad de series hechas.
import { esc, fmt } from './ui.js';

let SVG = '';
let MAP = { muscles: [] };

/** Carga la figura y el mapa de músculos (una sola vez, al iniciar la app). */
export async function loadMuscleAssets() {
  if (SVG) return;
  try {
    const [svg, map] = await Promise.all([
      fetch('assets/body-muscles.svg').then((r) => (r.ok ? r.text() : '')),
      fetch('assets/muscle-map.json').then((r) => (r.ok ? r.json() : { muscles: [] })),
    ]);
    SVG = svg; MAP = map;
  } catch { /* sin conexión: el mapa se muestra solo con la leyenda */ }
}

export const muscleInfo = (id) => MAP.muscles.find((m) => m.id === id);

const HEAT = (ratio) => `rgba(237, 25, 57, ${(0.3 + 0.7 * ratio).toFixed(2)})`;

/** muscles: [{muscle, sets}] -> HTML con figura frontal y dorsal, más leyenda. */
export function muscleMap(muscles = [], { legend = true, compact = false } = {}) {
  const sets = new Map(muscles.map((m) => [m.muscle, m.sets]));
  const max = Math.max(1, ...sets.values());
  const color = (id) => (sets.get(id) ? HEAT(sets.get(id) / max) : null);

  // Se pinta cada región con un estilo inline (gana sobre el estilo base del SVG).
  const svg = SVG.replace(/<path class="muscle" data-muscle="([^"]+)" data-area="([^"]+)"([^>]*)><title>[^<]*<\/title>/g, (_, id, area, rest) => {
    const c = color(id);
    const zone = MAP.areas?.find((a) => a.id === area)?.label ?? area;
    const title = `${zone} · ${muscleInfo(id)?.label ?? id}: ${fmt(sets.get(id) || 0)} series`;
    return `<path class="muscle" data-muscle="${id}" data-area="${area}"${rest} style="${c ? `fill:${c};stroke:#ff8095` : ''}"><title>${esc(title)}</title>`;
  });

  const order = MAP.muscles.length ? MAP.muscles.map((m) => m.id) : [...sets.keys()];
  const worked = order.filter((id) => sets.get(id)).sort((a, b) => sets.get(b) - sets.get(a));
  const leg = legend && worked.length
    ? `<ul class="muscle-legend">${worked.map((id) => `<li title="${esc(muscleInfo(id)?.scientific ?? '')}"><span class="sw" style="background:${color(id)}"></span>${esc(muscleInfo(id)?.label ?? id)}<b>${fmt(sets.get(id))}</b></li>`).join('')}</ul>`
    : '';
  const scale = worked.length ? '<div class="muscle-scale"><span>Menos series</span><i></i><span>Más series</span></div>' : '';
  return `<div class="muscle-map ${compact ? 'compact' : ''}">${SVG ? `<div class="body-figure">${svg}</div>` : ''}${scale}${leg}</div>`;
}
