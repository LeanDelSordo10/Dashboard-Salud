# Atlas anatómico — créditos

Las figuras `muscle_layer_front.svg` y `muscle_layer_back.svg` son obra de **Ryan Graves**.

- Original: https://www.figma.com/community/file/1320468164820924031
- Licencia: Creative Commons Attribution 4.0 International (CC BY 4.0) — https://creativecommons.org/licenses/by/4.0/
- Copias tomadas de https://github.com/kit-g/flutter-body-atlas (assets/svg), que reestructuró los IDs de los elementos.

## Cambios hechos para Dashboard Salud (`scripts/build_body_svg.py`)
- Se unieron las vistas frontal y dorsal en un solo SVG (`web/assets/body-muscles.svg`).
- Se quitaron los músculos de la cara (cabeza lisa) y los detalles internos de la cabeza dorsal.
- Se reemplazaron los colores por los del tema oscuro de la app.
- Cada músculo se asignó a un grupo (`data-muscle`) y a una zona (`data-area`) del dashboard.
