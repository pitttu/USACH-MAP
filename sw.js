// Service worker de la app instalable (PWA). Solo atiende pedidos GET del mismo sitio, y siempre va primero a la red:
// así la app nunca queda vieja. Guarda una copia de la página, el código, los estilos, los datos y los íconos para
// poder abrirla sin conexión (con lo último que vio). Los modelos 3D (.glb) no pasan por aquí: los guarda js/cache.js,
// y las fotos tampoco (son pesadas). Lo de otros sitios (Google, Cloudflare, Open-Meteo, fuentes) pasa directo.
const CACHE = 'usach-app-v1';
const GUARDAR = /\.(?:html|js|css|json|webmanifest|png|svg)$|\/$/;

// al instalarse guarda la página y los estilos; el resto (código, datos) queda guardado desde la siguiente visita
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', 'ui.css', 'style.css', 'manifest.webmanifest'])).catch(() => {}).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('usach-app-') && k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || /\/assets\/(?:fotos\/|[^/]+\.glb$)/.test(url.pathname)) return;
  const guardar = req.mode === 'navigate' || GUARDAR.test(url.pathname);
  e.respondWith((async () => {
    try {
      const r = await fetch(req);
      if (guardar && r.ok) { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(req, copia)); }
      return r;
    } catch (err) { // sin conexión: lo último que se guardó (para una página, la app)
      const c = await caches.open(CACHE);
      return (await c.match(req, { ignoreSearch: req.mode === 'navigate' })) || (req.mode === 'navigate' && (await c.match('./'))) || Promise.reject(err);
    }
  })());
});
