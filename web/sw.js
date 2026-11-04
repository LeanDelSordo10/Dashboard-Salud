// Service worker: permite instalar la app y abrirla rápido.
// Estrategia "red primero" para la interfaz (siempre la última versión publicada,
// con copia de respaldo si no hay conexión). Los datos de la API NUNCA se guardan
// en caché: solo se cachean archivos propios de la app (mismo origen).
const CACHE = 'ds-shell-v5';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // API y CDNs: sin caché propia
  event.respondWith((async () => {
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
      return res;
    } catch {
      const cached = await caches.match(req, { ignoreSearch: true });
      return cached ?? Response.error();
    }
  })());
});
