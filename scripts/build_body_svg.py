"""Genera web/assets/body-muscles.svg a partir del atlas anatómico de Ryan Graves (CC BY 4.0).

Fuentes: assets-src/body-atlas/muscle_layer_front.svg y muscle_layer_back.svg
(ver assets-src/body-atlas/CREDITS.md).

Qué hace:
- Une la vista frontal y la dorsal en un solo SVG, con sus títulos.
- Quita los rasgos de la cara (cabeza lisa).
- Asigna cada músculo del atlas a un grupo de la app (data-muscle, ids de
  web/assets/muscle-map.json) y a una zona de web/assets/synoptic-area-ids.json
  (data-area, p. ej. Cuadricep_Izquierdo). El resto queda como detalle sin pintar.
- Recolorea con clases para el tema oscuro.

En el atlas, el sufijo _l / _r es el lado anatómico de la persona (en la vista
frontal el lado izquierdo de la persona aparece a la derecha de la pantalla).

Uso: python scripts/build_body_svg.py
"""
import json
import pathlib
import re
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / 'assets-src' / 'body-atlas'
OUT = ROOT / 'web' / 'assets' / 'body-muscles.svg'
AREAS_FILE = ROOT / 'web' / 'assets' / 'synoptic-area-ids.json'
NS = '{http://www.w3.org/2000/svg}'

# prefijo del id en el atlas -> (grupo de la app, zona synoptic sin lado)
GROUPS = [
    ('pectoralis_major', 'Pecho', 'Pecho'),
    ('anterior_deltoid', 'Hombros', 'Hombro'),
    ('lateral_deltoid', 'Hombros', 'Hombro'),
    ('posterior_deltoid', 'Hombros', 'Hombro'),
    ('trapezius', 'Espalda', 'Trapecio'),
    ('latissimus_dorsi', 'Espalda', 'Dorsal'),
    ('infraspinatus', 'Espalda', 'Dorsal'),
    ('biceps_brachii', 'Bíceps', 'Bicep'),
    ('triceps_brachii', 'Tríceps', 'Tricep'),
    ('anconeus', 'Tríceps', 'Tricep'),
    ('rectus_abdominis', 'Abdominales', 'Abdomen'),
    ('external_oblique', 'Abdominales', 'Abdomen'),
    ('gluteus_maximus', 'Glúteos', 'Gluteo'),
    ('gluteus_medius', 'Glúteos', 'Gluteo'),
    ('rectus_femoris', 'Cuádriceps', 'Cuadricep'),
    ('vastus_lateralis', 'Cuádriceps', 'Cuadricep'),
    ('vastus_medialis', 'Cuádriceps', 'Cuadricep'),
    ('biceps_femoris', 'Isquiotibiales', 'Isquiotibial'),
    ('semitendinosus', 'Isquiotibiales', 'Isquiotibial'),
    ('semimembranosus', 'Isquiotibiales', 'Isquiotibial'),
    ('adductor', 'Aductores', 'Aductor'),
    ('pectineus', 'Aductores', 'Aductor'),
    ('gracilis', 'Aductores', 'Aductor'),
    ('gastrocnemius', 'Gemelos', 'Gemelo'),
]
SIDES = {'l': 'Izquierdo', 'r': 'Derecho'}
DROP_GROUPS = {'face', 'head'}  # rasgos de cara y nuca -> cabeza lisa
# Cabeza lisa dibujada sobre la silueta (coordenadas de cada vista del atlas).
HEADS = {
    'front': (293, 66, 46, 62, 15),
    'back': (297, 55, 46, 53, 14),
}


def smooth_head(view_name):
    cx, cy, rx, ry, ear = HEADS[view_name]
    jaw = cy + ry
    head = (f'M{cx} {cy - ry} C{cx + rx * 0.62} {cy - ry} {cx + rx} {cy - ry * 0.6} {cx + rx} {cy - ry * 0.05} '
            f'C{cx + rx} {cy + ry * 0.45} {cx + rx * 0.62} {jaw - 4} {cx} {jaw} '
            f'C{cx - rx * 0.62} {jaw - 4} {cx - rx} {cy + ry * 0.45} {cx - rx} {cy - ry * 0.05} '
            f'C{cx - rx} {cy - ry * 0.6} {cx - rx * 0.62} {cy - ry} {cx} {cy - ry} Z')
    return f'<path class="detail head" d="{head}"/>'  # las orejas son las del atlas
KEEP_ATTRS = ('d', 'fill-rule', 'clip-rule', 'transform')


def classify(pid):
    for prefix, group, area in GROUPS:
        if pid.startswith(prefix):
            if area == 'Abdomen':
                return group, area
            side = pid.rsplit('_', 1)[-1]
            return group, f'{area}_{SIDES[side]}' if side in SIDES else None
    return None, None


def compact(value):
    # Redondea coordenadas a 1 decimal (el archivo pesa ~40 % menos, sin cambio visible).
    return re.sub(r'-?\d+\.\d+', lambda m: f'{float(m.group()):.1f}'.rstrip('0').rstrip('.'), value)


def attrs(el):
    return ' '.join(f'{k}="{compact(el.get(k)) if k == "d" else el.get(k)}"' for k in KEEP_ATTRS if el.get(k))


def render(el, out, used, view_name=''):
    tag = el.tag.replace(NS, '')
    if tag == 'g':
        if el.get('id') in DROP_GROUPS:
            return
        out.append('<g>')
        for child in el:
            render(child, out, used, view_name)
        out.append('</g>')
        return
    if tag != 'path':
        return
    pid = el.get('id') or ''
    fill = (el.get('fill') or '').strip().upper()
    if fill in ('', 'NONE'):
        if el.get('stroke'):
            out.append(f'<path class="line" {attrs(el)}/>')
        return
    group, area = classify(pid)
    if group and area:
        used.add(area)
        out.append(f'<path class="muscle" data-muscle="{group}" data-area="{area}" {attrs(el)}>'
                   f'<title>{group}</title></path>')
    elif fill == '#E0E0E0':
        out.append(f'<path class="skin" {attrs(el)}/>')

    else:
        out.append(f'<path class="detail" {attrs(el)}/>')


def view(name):
    root = ET.parse(SRC / f'muscle_layer_{name}.svg').getroot()
    w, h = (float(v) for v in root.get('viewBox').split()[2:])
    parts, used = [], set()
    for child in root:
        render(child, parts, used, name)
    parts.append(smooth_head(name))  # encima de todo: tapa rasgos de cara y nuca
    return w, h, ''.join(parts), used


def build():
    (fw, fh, front, used_f), (bw, bh, back, used_b) = view('front'), view('back')
    gap, top, caption = 40, 0, 40
    width, height = fw + gap + bw, max(fh, bh) + caption
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:g} {height:g}" role="img" '
        'aria-label="Mapa muscular: vista frontal y dorsal">'
        '<style>'
        '.skin{fill:#2a323d}'
        '.detail{fill:#36404c;stroke:#151a21;stroke-width:1.1;stroke-linejoin:round}'
        '.muscle{fill:#3b4653;stroke:#151a21;stroke-width:1.1;stroke-linejoin:round;transition:fill .3s}'
        '.line{fill:none;stroke:#151a21;stroke-width:1}'
        '.caption{fill:#8592a3;font:600 26px Inter,system-ui,sans-serif;letter-spacing:.12em}'
        '</style>'
        f'<g aria-label="Frente">{front}'
        f'<text class="caption" x="{fw / 2:g}" y="{fh + 32:g}" text-anchor="middle">FRENTE</text></g>'
        f'<g aria-label="Espalda" transform="translate({fw + gap:g} {top})">{back}'
        f'<text class="caption" x="{bw / 2:g}" y="{bh + 32:g}" text-anchor="middle">ESPALDA</text></g>'
        '<text x="0" y="0" opacity="0">Ilustración: Ryan Graves, CC BY 4.0</text>'
        '</svg>'
    )
    svg = re.sub(r'\s+', ' ', svg)
    OUT.write_text(svg, encoding='utf-8')
    expected = set(json.loads(AREAS_FILE.read_text(encoding='utf-8')))
    used = used_f | used_b
    print(f'{OUT} {len(svg)} bytes · zonas: {len(used)}/{len(expected)}')
    if used != expected:
        print('  faltan:', sorted(expected - used), '| extra:', sorted(used - expected))


if __name__ == '__main__':
    build()
