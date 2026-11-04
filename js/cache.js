// Archivos grandes (el mapa y la fotogrametría) guardados en el navegador (Cache Storage), con versión.
// Al abrir la app se lee assets/versiones.json (chico, siempre desde la red; lo escriben los scripts de build con un
// hash de cada archivo). Si la copia guardada de un archivo tiene esa misma versión, se usa sin descargar nada; si es
// otra (o no hay), se descarga, se guarda y se borra la anterior.
// Sin Cache Storage (sitio sin https, navegación privada, sin espacio) o sin versión, simplemente se descarga.
const CACHE = 'usach-map-archivos';
let versionsP = null;
const versions = () => (versionsP ||= fetch('assets/versiones.json', { cache: 'no-store' })
  .then((r) => (r.ok ? r.json() : {})).catch(() => ({})));

// path: 'assets/campus.glb'. onProgress(0..1). Devuelve un ArrayBuffer.
export async function fetchAsset(path, onProgress) {
  const v = (await versions())[path.split('/').pop()];
  const url = v ? `${path}?v=${v}` : path; // con ?v= tampoco lo sirve viejo un caché de por medio
  const key = new URL(url, location.href).href;
  const store = v && typeof caches !== 'undefined' ? await caches.open(CACHE).catch(() => null) : null;
  if (store) {
    const hit = await store.match(key).catch(() => null);
    if (hit) {
      try { const buf = await hit.arrayBuffer(); onProgress?.(1); return buf; } catch { /* copia dañada: se descarga */ }
    }
  }
  const buf = await download(url, onProgress);
  if (store) {
    try {
      const base = key.split('?')[0];
      for (const req of await store.keys()) if (req.url.split('?')[0] === base && req.url !== key) await store.delete(req);
      await store.put(key, new Response(buf.slice(0), { headers: { 'Content-Type': 'application/octet-stream' } }));
    } catch (e) { console.warn('No se pudo guardar en el navegador', path, e); }
  }
  return buf;
}

async function download(url, onProgress) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  const total = +r.headers.get('Content-Length') || 0;
  if (!r.body || !total) { const b = await r.arrayBuffer(); onProgress?.(1); return b; }
  const reader = r.body.getReader(), chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length;
    onProgress?.(Math.min(1, got / total)); // con compresión del servidor el total no calza: se topa en 1
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out.buffer;
}
