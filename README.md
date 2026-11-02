# Dashboard Salud

App personal para registrar entrenamientos de fuerza y peso corporal, y ver la evolución de fuerza, peso, pasos, sueño y recuperación.

**App:** https://leandelsordo10.github.io/Dashboard-Salud/

Se puede instalar en el celular: abrí el enlace y elegí "Agregar a pantalla de inicio".

## Cómo funciona

```
Navegador (web/)  ──login──▶  Supabase Auth
      │
      └──token──▶  API (supabase/functions/api)  ──service role──▶  Base de datos (cerrada)
```

- **`web/`**: interfaz estática (HTML, CSS y JS, sin compilación), publicada con GitHub Pages en cada push a `main`. Solo dibuja pantallas: no contiene datos, claves secretas ni lógica de negocio.
- **`web/assets/body-muscles.svg`** y **`web/assets/muscle-map.json`**: figura humana (frente y espalda) y catálogo de grupos musculares con nombre científico, región y alias. El `id` de cada músculo coincide con `exercises.primary_muscle` y con `data-muscle` en el SVG. Cada región del SVG también tiene `data-area` con las zonas de `web/assets/synoptic-area-ids.json` (p. ej. `Hombro_Izquierdo`), asignadas a su grupo en `muscle-map.json → areas`. El SVG se genera con `scripts/build_body_svg.py`.
- **`supabase/functions/api`**: API en una Edge Function. Valida la sesión y que el email esté autorizado, valida los datos y hace todos los cálculos (volumen, 1RM estimado, progreso, tendencias).
- **`supabase/migrations`**: esquema de la base. Todas las tablas tienen RLS activado **sin políticas**, y sin permisos para `anon` ni `authenticated`, así que solo la API puede leerlas o escribirlas.
- **`.github/workflows/keepalive.yml`**: consulta la API cada 3 días para que el proyecto gratuito de Supabase no se pause.
- **`legacy/`**: código de la versión anterior (Flask + Vercel). Se conserva como referencia para la futura conexión con Garmin (`garmin_parser.py`, `garmin_wellness_v2.py`).
- **`scripts/build_import_sql.py`**: genera el SQL de importación desde la exportación de la base anterior. El SQL generado contiene datos personales y no se versiona.

## Seguridad

- Ningún dato personal vive en el repo ni en el navegador; todo se pide a la API después del login.
- La clave de `web/js/config.js` es la *publishable key* de Supabase: es pública por diseño y solo sirve para iniciar sesión.
- La clave secreta (service role) solo existe dentro de Supabase.
- El acceso está limitado a los emails de la tabla `app_allowed_users`, que también es privada. La cuenta además tiene que tener el email confirmado.

## Desarrollo local

```bash
cd web && python3 -m http.server 8080
# abrir http://localhost:8080 (la API acepta localhost por CORS)
```

## Próximos pasos

- Conexión directa con Garmin Connect (pasos, sueño, HRV y sesiones de fuerza automáticas).
