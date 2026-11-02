"""Genera web/assets/body-muscles.svg: figura humana frontal y dorsal con grupos musculares.

Cada figura se dibuja en un lienzo de 200 x 470 con el eje en x = 100. Solo se
define la mitad izquierda (x <= 100); la derecha se obtiene espejando, así la
figura queda perfectamente simétrica. Cada región muscular lleva
data-muscle="<id>" con los ids de web/assets/muscle-map.json.

Uso: python scripts/build_body_svg.py
"""
import pathlib

MIRROR = 'matrix(-1 0 0 1 200 0)'

# ---------------------------------------------------------------- silueta
SILHOUETTE = (
    'M100 60 L91 60 C90 68 88 72 83 75 C73 79 60 81 52 87 C42 94 38 106 38 120 '
    'C37 136 35 152 33 168 C31 184 29 198 27 214 C25 232 23 248 21 262 '
    'C19 272 18 282 21 290 C24 299 31 300 34 291 C36 283 35 273 37 264 '
    'C41 246 45 228 48 210 C51 194 53 178 56 162 L59 142 '
    'C61 162 63 180 64 196 C65 210 63 222 62 234 '
    'C59 254 59 274 61 294 C63 322 65 346 66 370 '
    'C65 390 63 408 65 428 C66 438 64 446 60 452 C58 458 64 462 74 461 '
    'C82 460 86 454 86 444 C86 430 87 412 88 394 '
    'C89 374 90 352 91 330 C93 312 96 300 100 296 Z'
)

# ---------------------------------------------------------------- vista frontal
FRONT = {
    'neck': ['M92 60 C91 68 89 72 85 75 L100 79 L100 60 Z'],
    'Hombros': ['M84 80 C72 80 58 84 50 92 C42 100 40 112 42 124 C47 118 53 112 58 108 C62 100 70 92 84 86 Z'],
    'Pecho': ['M98 90 C88 86 72 88 62 96 C56 104 56 116 60 124 C68 130 84 132 98 128 Z'],
    'Bíceps': ['M44 128 C40 140 38 154 39 168 C41 176 47 178 51 172 C55 160 57 146 57 132 C54 126 48 124 44 128 Z'],
    'forearm': ['M37 182 C33 198 30 214 28 230 C27 240 28 250 30 256 C34 250 37 240 40 228 C44 212 47 196 49 182 C46 178 40 178 37 182 Z'],
    'Abdominales': [
        'M99 136 L86 138 C84 144 84 150 86 156 L99 155 Z',
        'M99 160 L86 161 C85 167 85 173 87 179 L99 178 Z',
        'M99 183 L87 184 C86 191 87 198 89 204 L99 204 Z',
        'M99 209 L89 209 C89 220 92 232 99 244 Z',
    ],
    'Abdominales ': ['M83 138 C76 142 70 150 68 160 C67 176 69 192 72 206 C76 214 82 222 86 230 C86 210 84 186 83 166 C82 156 82 146 83 138 Z'],
    'Cuádriceps': [
        'M64 246 C60 268 60 292 63 316 C65 336 68 352 72 362 C76 356 80 340 82 322 C84 300 82 278 77 258 C73 250 68 246 64 246 Z',
        'M80 270 C84 290 86 314 84 338 C83 350 80 360 76 368 C82 366 88 358 90 346 C92 326 90 302 86 284 Z',
    ],
    'Aductores': ['M88 256 C92 266 95 280 97 296 C94 306 92 318 91 328 C89 314 88 300 87 286 C86 274 86 262 88 256 Z'],
    'knee': ['M68 368 C70 376 76 382 82 382 C86 378 88 372 88 366 C82 372 74 372 68 368 Z'],
    'Gemelos': ['M66 392 C63 404 63 418 65 430 C68 424 70 412 71 400 C70 394 68 390 66 392 Z'],
    'shin': ['M74 392 C74 408 76 424 78 440 C82 432 85 418 86 402 C84 394 78 390 74 392 Z'],
}

# ---------------------------------------------------------------- vista dorsal
BACK = {
    'Espalda': [
        # trapecio
        'M100 62 L92 62 C90 70 86 76 78 80 C70 84 62 86 56 90 C68 92 80 96 90 108 C94 118 97 128 100 136 Z',
        # dorsal ancho
        'M60 118 C60 140 62 160 66 180 C72 196 82 208 94 214 C96 196 98 176 99 156 C92 144 84 132 74 124 C70 120 64 118 60 118 Z',
        # lumbares
        'M99 162 C98 182 96 202 94 218 C96 226 98 232 100 236 L100 160 Z',
    ],
    'Hombros': ['M54 92 C46 98 40 108 40 122 C46 118 52 114 58 112 C62 106 66 100 72 96 C66 92 60 90 54 92 Z'],
    'Tríceps': ['M42 128 C38 142 37 156 38 170 C41 178 47 178 51 172 C55 160 56 146 56 132 C52 124 46 122 42 128 Z'],
    'forearm': ['M37 182 C33 198 30 214 28 230 C27 240 28 250 30 256 C34 250 37 240 40 228 C44 212 47 196 49 182 C46 178 40 178 37 182 Z'],
    'Glúteos': ['M99 240 C88 236 74 238 66 248 C60 258 60 272 66 282 C74 292 88 294 99 288 Z'],
    'Isquiotibiales': [
        'M64 292 C62 312 63 332 66 350 C68 362 72 370 76 374 C78 356 79 336 79 316 C78 304 74 296 64 292 Z',
        'M82 300 C84 318 86 338 85 356 C84 364 82 370 80 374 C86 370 90 360 91 348 C92 330 91 312 88 298 Z',
    ],
    'Gemelos': [
        'M67 388 C63 400 63 414 66 426 C69 432 74 432 76 424 C77 412 76 398 74 388 C72 382 69 382 67 388 Z',
        'M78 388 C78 400 79 414 80 424 C82 430 86 428 87 420 C88 408 87 396 84 388 C82 382 79 382 78 388 Z',
    ],
}

NEUTRAL = {'neck', 'forearm', 'knee', 'shin'}


def region(name, d):
    name = name.strip()  # 'Abdominales ' = oblicuos, mismo grupo que el recto abdominal
    if name in NEUTRAL:
        return f'<path class="detail" d="{d}"/>'
    return f'<path class="muscle" data-muscle="{name}" d="{d}"><title>{name}</title></path>'


def figure(parts, label, dx):
    left = ''.join(region(n, d) for n, ds in parts.items() for d in ds)
    return (
        f'<g transform="translate({dx} 0)" aria-label="{label}">'
        f'<ellipse class="silhouette" cx="100" cy="34" rx="19" ry="24"/>'
        f'<path class="silhouette" d="{SILHOUETTE}"/>'
        f'<path class="silhouette" d="{SILHOUETTE}" transform="{MIRROR}"/>'
        f'<g>{left}</g><g transform="{MIRROR}">{left}</g>'
        f'<text class="caption" x="100" y="468" text-anchor="middle">{label}</text>'
        '</g>'
    )


def build():
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 440 476" role="img" '
        'aria-label="Mapa muscular: vista frontal y dorsal">'
        '<style>.silhouette{fill:#1e252e}'
        '.detail{fill:#222a34;stroke:#3a4553;stroke-width:.8}'
        '.muscle{fill:#2a333f;stroke:#46525f;stroke-width:.8;transition:fill .3s}'
        '.caption{fill:#8592a3;font:600 13px Inter,system-ui,sans-serif;letter-spacing:.12em}</style>'
        + figure(FRONT, 'FRENTE', 0)
        + figure(BACK, 'ESPALDA', 240)
        + '</svg>'
    )
    out = pathlib.Path(__file__).resolve().parents[1] / 'web' / 'assets' / 'body-muscles.svg'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(svg, encoding='utf-8')
    print(out, len(svg), 'bytes')


if __name__ == '__main__':
    build()
