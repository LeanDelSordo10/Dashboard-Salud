"""Genera web/assets/body-muscles.svg: figura humana frontal y dorsal con grupos musculares.

Dibujo original (no calcado de ninguna ilustración). Cada figura vive en un
lienzo de 200 x 470 con el eje de simetría en x = 100: solo se define la mitad
izquierda y la derecha se obtiene espejando, así la figura es perfectamente
simétrica. Las regiones con data-muscle="<id>" usan los ids de
web/assets/muscle-map.json y data-area="<zona>" con los nombres de
web/assets/synoptic-area-ids.json (p. ej. Hombro_Izquierdo); las regiones "detail" (antebrazo, tibia, rodilla,
serrato...) completan la anatomía pero no se pintan.

Uso: python scripts/build_body_svg.py
"""
import pathlib

MIRROR = 'matrix(-1 0 0 1 200 0)'

# ------------------------------------------------------------- silueta (mitad)
SILHOUETTE = (
    'M100 56 L90 56 C89 64 88 69 86 72 C80 75 70 77 60 79 '
    'C46 81 36 88 32 100 C28 110 28 122 30 132 '
    'C28 146 27 160 28 172 C27 184 24 198 22 212 C20 226 19 238 20 248 '
    # mano
    'C17 254 13 261 12 270 C11 279 13 288 17 293 C20 296 24 294 25 288 '
    'C27 281 28 273 29 266 C30 260 31 256 32 252 '
    'C34 240 38 226 41 212 C43 200 45 190 47 180 C49 166 51 152 52 140 '
    # torso
    'C55 152 58 168 60 184 C62 198 63 210 62 222 C61 232 60 242 59 252 '
    # pierna
    'C57 272 57 292 59 312 C61 332 63 346 64 358 C63 372 61 386 62 400 '
    'C63 414 65 426 66 436 C66 444 62 450 59 455 C58 461 68 464 79 462 '
    'C86 461 88 456 87 450 C86 440 85 430 85 420 C86 404 88 390 89 376 '
    'C90 364 90 356 91 348 C93 322 95 296 97 278 C98 272 99 268 100 266 Z'
)

HEAD = ('<ellipse class="silhouette" cx="100" cy="31" rx="17" ry="22"/>'
        '<ellipse class="silhouette" cx="83" cy="33" rx="3" ry="6"/>'
        '<ellipse class="silhouette" cx="117" cy="33" rx="3" ry="6"/>')

# Detalles de manos y pies (solo líneas).
LINES = [
    'M15 280 L14 289', 'M19 283 L19 292', 'M23 282 L23 289',      # dedos
    'M68 454 L67 460', 'M74 455 L74 461', 'M80 454 L80 460',       # dedos del pie
]

# ---------------------------------------------------------------- vista frontal
FRONT = {
    'Espalda': ['M90 59 C89 66 87 71 84 74 C76 77 67 79 59 81 C70 84 81 85 90 84 Z'],  # trapecio superior
    'Hombros': ['M58 84 C46 84 36 92 33 104 C31 114 32 124 34 132 C38 126 42 120 46 116 C50 106 54 96 60 88 Z'],
    'Pecho': ['M99 90 C88 86 74 86 62 92 C54 100 50 112 52 122 C58 130 72 136 86 136 C92 136 96 134 99 132 Z'],
    'Bíceps': ['M36 136 C33 148 32 162 34 174 C37 180 43 180 46 174 C49 162 50 148 49 138 C46 132 40 132 36 136 Z'],
    'detail': [
        'M33 186 C29 200 26 214 24 230 C23 238 24 246 26 250 C30 242 34 230 37 218 C40 206 43 194 45 184 C41 180 36 181 33 186 Z',  # antebrazo
        'M55 140 C56 146 58 150 61 152 C60 146 58 142 55 140 Z',      # serrato
        'M56 152 C57 158 59 162 62 164 C61 158 59 154 56 152 Z',
        'M68 358 C70 366 76 370 82 370 C86 368 88 362 88 356 C82 362 74 362 68 358 Z',   # rodilla
        'M70 378 C70 396 72 414 74 430 C78 420 81 404 82 388 C80 380 74 376 70 378 Z',   # tibia
    ],
    'Abdominales': [
        'M99 140 L87 142 C86 148 86 154 87 158 L99 157 Z',
        'M99 161 L87 162 C86 168 86 174 87 179 L99 178 Z',
        'M99 182 L88 183 C87 190 87 196 88 201 L99 201 Z',
        'M99 205 L89 205 C89 220 92 236 99 252 Z',
        # oblicuos
        'M84 140 C76 146 68 156 64 168 C63 184 64 200 66 214 C70 224 76 234 84 242 C86 226 86 206 85 186 C84 168 84 152 84 140 Z',
    ],
    'Cuádriceps': [
        'M62 262 C59 284 59 306 61 328 C62 340 64 350 67 356 C71 348 73 334 74 318 C75 298 72 278 66 264 Z',  # vasto lateral
        'M70 258 C76 276 80 298 80 320 C80 334 78 344 75 352 C80 352 84 346 86 336 C88 316 86 292 80 272 Z',  # recto femoral
        'M85 318 C89 326 91 338 89 350 C85 356 80 356 78 352 C82 344 84 332 85 318 Z',                         # vasto medial
    ],
    'Aductores': ['M84 262 C90 268 95 276 97 286 C95 298 92 310 89 320 C88 304 86 290 84 276 Z'],
    'Gemelos': [
        'M64 378 C61 392 61 406 63 418 C66 412 68 400 68 388 C67 382 66 378 64 378 Z',
        'M87 378 C89 390 89 402 87 414 C85 404 84 392 85 382 Z',
    ],
}

# ---------------------------------------------------------------- vista dorsal
BACK = {
    'Espalda': [
        'M100 60 L91 60 C90 67 88 72 84 75 C76 78 66 80 58 84 C70 88 82 96 90 110 C95 120 98 132 100 144 Z',  # trapecio
        'M66 96 C60 104 56 114 56 124 C64 126 74 124 84 118 C84 110 78 102 66 96 Z',                           # infraespinoso
        'M56 128 C56 148 58 168 62 186 C68 202 78 214 92 222 C94 204 96 184 97 166 C90 152 80 140 70 132 C66 130 60 128 56 128 Z',  # dorsal
        'M99 150 C97 172 95 196 94 220 C96 230 98 236 100 240 L100 150 Z',                                     # lumbares
    ],
    'Hombros': ['M58 86 C46 86 36 94 33 106 C31 116 32 126 34 132 C40 124 46 116 52 110 C56 102 62 94 66 90 Z'],
    'Tríceps': ['M36 136 C33 148 32 162 34 174 C37 180 43 180 46 174 C49 162 50 148 49 138 C46 132 40 132 36 136 Z'],
    'detail': [
        'M33 186 C29 200 26 214 24 230 C23 238 24 246 26 250 C30 242 34 230 37 218 C40 206 43 194 45 184 C41 180 36 181 33 186 Z',  # antebrazo
        'M66 214 C64 224 63 234 63 244 C72 236 80 230 88 228 C80 224 72 220 66 214 Z',                        # oblicuo posterior
        'M74 432 C74 440 76 448 79 452 C82 446 83 438 82 430 Z',                                              # tendón de Aquiles
    ],
    'Glúteos': ['M99 246 C88 240 72 242 64 254 C58 264 58 280 64 290 C72 300 88 302 99 296 Z'],
    'Isquiotibiales': [
        'M62 300 C60 320 61 340 64 356 C66 364 70 370 74 372 C76 352 77 330 76 312 C74 304 70 300 62 300 Z',
        'M80 304 C82 322 84 342 83 360 C82 366 80 370 78 374 C85 370 89 360 90 348 C91 330 90 314 88 302 Z',
    ],
    'Gemelos': [
        'M64 380 C60 394 60 410 64 424 C67 430 72 430 74 422 C75 408 74 394 72 382 C70 376 66 376 64 380 Z',
        'M77 382 C77 396 78 410 80 422 C82 428 87 426 88 418 C89 406 88 394 85 384 C83 378 79 378 77 382 Z',
    ],
}


# Nombres de zona de synoptic-area-ids.json (base sin lado) para cada grupo.
AREA = {
    'Hombros': 'Hombro', 'Pecho': 'Pecho', 'Abdominales': 'Abdomen', 'Bíceps': 'Bicep', 'Tríceps': 'Tricep',
    'Glúteos': 'Gluteo', 'Gemelos': 'Gemelo', 'Cuádriceps': 'Cuadricep', 'Aductores': 'Aductor',
    'Isquiotibiales': 'Isquiotibial', 'Espalda': 'Dorsal',
}


def area_name(group, index, view):
    """Zona anatómica: en la espalda, la 1.ª región es el trapecio; en el frente, el trapecio superior."""
    if group == 'Espalda' and (view == 'front' or index == 0):
        return 'Trapecio'
    return AREA[group]


def region(name, d, area=None):
    if name == 'detail':
        return f'<path class="detail" d="{d}"/>'
    return (f'<path class="muscle" data-muscle="{name}" data-area="{area}" d="{d}">'
            f'<title>{name}</title></path>')


def half_body(parts, view, side):
    """Mitad del cuerpo. side = lado anatómico de esa mitad ('Derecho' o 'Izquierdo')."""
    out = []
    for group, paths in parts.items():
        for i, d in enumerate(paths):
            if group == 'detail':
                out.append(region(group, d))
                continue
            base = area_name(group, i, view)
            area = base if base == 'Abdomen' else f'{base}_{side}'
            out.append(region(group, d, area))
    out += [f'<path class="line" d="{d}"/>' for d in LINES]
    return ''.join(out)


def figure(parts, label, dx, view):
    # Vista frontal: la mitad dibujada (izquierda de la pantalla) es el lado DERECHO
    # de la persona. Vista dorsal: es el lado IZQUIERDO.
    drawn, mirrored = ('Derecho', 'Izquierdo') if view == 'front' else ('Izquierdo', 'Derecho')
    return (
        f'<g transform="translate({dx} 0)" aria-label="{label}">'
        f'<g filter="url(#outline)">{HEAD}'
        f'<path class="silhouette" d="{SILHOUETTE}"/>'
        f'<path class="silhouette" d="{SILHOUETTE}" transform="{MIRROR}"/></g>'
        f'<g>{half_body(parts, view, drawn)}</g>'
        f'<g transform="{MIRROR}">{half_body(parts, view, mirrored)}</g>'
        f'<text class="caption" x="100" y="476" text-anchor="middle">{label}</text>'
        '</g>'
    )


def build():
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 440 484" role="img" '
        'aria-label="Mapa muscular: vista frontal y dorsal">'
        '<defs><filter id="outline" x="-5%" y="-5%" width="110%" height="110%">'
        '<feMorphology in="SourceAlpha" operator="dilate" radius="1.1" result="d"/>'
        '<feFlood flood-color="#6f7c8c"/><feComposite in2="d" operator="in" result="o"/>'
        '<feMerge><feMergeNode in="o"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>'
        '<style>'
        '.silhouette{fill:#38424f}'
        '.detail{fill:#38424f;stroke:#5d6a79;stroke-width:.7;stroke-linejoin:round}'
        '.muscle{fill:#3b4653;stroke:#6b7888;stroke-width:.8;stroke-linejoin:round;transition:fill .3s}'
        '.line{fill:none;stroke:#55616f;stroke-width:.7;stroke-linecap:round}'
        '.caption{fill:#8592a3;font:600 13px Inter,system-ui,sans-serif;letter-spacing:.12em}'
        '</style>'
        + figure(FRONT, 'FRENTE', 0, 'front')
        + figure(BACK, 'ESPALDA', 240, 'back')
        + '</svg>'
    )
    out = pathlib.Path(__file__).resolve().parents[1] / 'web' / 'assets' / 'body-muscles.svg'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(svg, encoding='utf-8')
    print(out, len(svg), 'bytes')


if __name__ == '__main__':
    build()
