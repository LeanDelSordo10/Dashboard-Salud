# Créditos de la ilustración anatómica

La figura del mapa muscular (`web/assets/body-muscles.svg`) se basa en el atlas
muscular de **Ryan Graves**.

- Original: https://www.figma.com/community/file/1320468164820924031
- Licencia: Creative Commons Atribución 4.0 Internacional (CC BY 4.0)
  https://creativecommons.org/licenses/by/4.0/
- Versión SVG con identificadores por músculo tomada de
  [flutter-body-atlas](https://github.com/kit-g/flutter-body-atlas) (que también la atribuye a Ryan Graves).

## Cambios realizados

- Se quitaron los rasgos de la cara (cabeza lisa).
- Se unieron la vista frontal y la dorsal en un solo SVG.
- Se recolorearon las capas para el tema oscuro de la app.
- Cada músculo se agrupó en los 11 grupos de la app (`data-muscle`) y en las 23
  zonas de `synoptic-area-ids.json` (`data-area`).

Los archivos originales están en esta carpeta. El SVG final se genera con
`python scripts/build_body_svg.py`.
