// Fotos de la comunidad para el carrusel de los lugares de la app. Cloudflare Worker con R2 (los archivos) y D1 (los
// envíos y el registro de decisiones).
//   GET  /fotos                      fotos publicadas, por lugar (mismo formato que assets/data/fotos.json)
//   GET  /estado                     { subidas }: si ya se pueden subir fotos (falso mientras no haya almacén R2)
//   GET  /img/<id>.webp, <id>-m.webp una foto publicada (grande o miniatura; .jpg si llegó en JPEG)
//   POST /subir                      sube una foto: queda pendiente hasta que la revise un administrador
//   GET  /mias                       las fotos que subió quien llama, con su estado
//   GET  /admin                      panel de revisión (página)
//   GET  /admin/lista?estado=…       envíos y registro (solo administradores)
//   GET  /admin/img/<id>.webp        cualquier foto, también pendiente (solo administradores)
//   POST /admin/decidir              { id, accion: publicar | rechazar | retirar, motivo } (solo administradores)
// Quien sube entra con su cuenta de Google @usach.cl (Google Identity Services en la app) y manda el token en
// "Authorization: Bearer …". El Worker lo verifica con las llaves públicas de Google: firma, audiencia
// (GOOGLE_CLIENT_ID), vigencia, correo verificado y dominio (DOMINIO). Los administradores (ADMINS) entran igual, con
// cualquier cuenta de Google de la lista. Las fotos rechazadas se borran (queda su fila y el registro).
// Las fotos llegan ya achicadas y comprimidas por la app (WebP, o JPEG si el navegador no sabe hacer WebP); aquí se
// revisan (formato, medidas, peso) y se les quitan los metadatos (EXIF con la ubicación y la cámara, XMP, comentarios).
// Tope de espacio: lo que ocupan en R2 las fotos guardadas (pendientes, publicadas y retiradas) no pasa de
// TOPE_BYTES, bajo los 10 GB gratis de R2; al llegar, no se aceptan más.
import { panel } from './admin.js';

const LICENCIA = 'CC BY-NC-SA 4.0', LICENCIA_URL = 'https://creativecommons.org/licenses/by-nc-sa/4.0/deed.es';
const MAX = { foto: 1600, fotoBytes: 1.2e6, miniAlto: 520, miniBytes: 2.5e5 };
const TOPE_BYTES = 9.9e9;
const TIPO = { jpg: 'image/jpeg', webp: 'image/webp' };
const POR_DIA = 10, PENDIENTES = 30; // por persona

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const almacen = (env) => { if (!env.FOTOS) throw new HttpError(503, 'Subir fotos aún no está disponible'); return env.FOTOS; };

export default {
  async fetch(request, env) {
    const url = new URL(request.url), path = url.pathname;
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const cors = allowed.includes(origin)
      ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '86400', Vary: 'Origin' }
      : {};
    const json = (status, body, cache = 'no-store') => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache, ...cors } });
    if (request.method === 'OPTIONS') return new Response(null, { status: cors['Access-Control-Allow-Origin'] ? 204 : 403, headers: cors });
    try {
      if (path === '/estado' && request.method === 'GET') return json(200, { subidas: !!env.FOTOS && !!env.GOOGLE_CLIENT_ID }, 'public, max-age=60');
      if (path === '/fotos' && request.method === 'GET') return json(200, await publicadas(env, url.origin), 'public, max-age=300');
      let m = path.match(/^\/img\/([0-9a-f-]{36})(-m)?\.(?:jpg|webp)$/);
      if (m && request.method === 'GET') return await imagen(env, m[1], !!m[2], false);
      if (path === '/subir' && request.method === 'POST') {
        if (!cors['Access-Control-Allow-Origin']) throw new HttpError(403, 'Origen no permitido');
        return json(200, await subir(request, env, await usuario(request, env, url)));
      }
      if (path === '/mias' && request.method === 'GET') {
        const u = await usuario(request, env, url);
        const { results } = await env.DB.prepare('SELECT id, lugar, estado, motivo, creada FROM fotos WHERE email = ? ORDER BY creada DESC LIMIT 50').bind(u.email).all();
        return json(200, results);
      }
      if (path === '/admin' && request.method === 'GET') {
        return new Response(panel(env.GOOGLE_CLIENT_ID), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' } });
      }
      if (path.startsWith('/admin/')) {
        const a = await admin(request, env, url);
        if (path === '/admin/lista' && request.method === 'GET') return json(200, await lista(env, url.searchParams.get('estado') || 'pendiente'));
        m = path.match(/^\/admin\/img\/([0-9a-f-]{36})(-m)?\.(?:jpg|webp)$/);
        if (m && request.method === 'GET') return await imagen(env, m[1], !!m[2], true);
        if (path === '/admin/decidir' && request.method === 'POST') return json(200, await decidir(request, env, a));
      }
      throw new HttpError(404, 'No encontrado');
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { error: e.message });
      return json(500, { error: 'Error del servidor' });
    }
  },
};

// --- sesión con Google ---
let llaves = null, llavesHasta = 0;
async function llavesGoogle() {
  if (llaves && Date.now() < llavesHasta) return llaves;
  const r = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  const edad = Number(/max-age=(\d+)/.exec(r.headers.get('Cache-Control') || '')?.[1]) || 3600;
  llaves = (await r.json()).keys; llavesHasta = Date.now() + edad * 1000;
  return llaves;
}
const b64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
async function cuenta(request, env, url) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'Entra con tu cuenta de Google');
  // solo para probar en el Mac (wrangler dev con PRUEBA_SIN_GOOGLE=1 en .dev.vars): "prueba:<correo>:<nombre>"
  if (env.PRUEBA_SIN_GOOGLE === '1' && ['localhost', '127.0.0.1'].includes(url.hostname) && token.startsWith('prueba:')) {
    const [, email, nombre] = token.split(':');
    return { email: email.toLowerCase(), nombre, hd: email.split('@')[1] };
  }
  const malo = () => new HttpError(401, 'La sesión no es válida o venció: vuelve a entrar');
  let cab, dat;
  const [h, p, s] = token.split('.');
  try { cab = JSON.parse(new TextDecoder().decode(b64url(h))); dat = JSON.parse(new TextDecoder().decode(b64url(p))); } catch { throw malo(); }
  const jwk = cab.alg === 'RS256' && (await llavesGoogle()).find((k) => k.kid === cab.kid);
  if (!jwk || !s) throw malo();
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(s), new TextEncoder().encode(`${h}.${p}`)))) throw malo();
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(dat.iss) || dat.aud !== env.GOOGLE_CLIENT_ID || !(dat.exp * 1000 > Date.now()) || !dat.email_verified) throw malo();
  return { email: String(dat.email).toLowerCase(), nombre: dat.name || null, hd: dat.hd || null };
}
async function usuario(request, env, url) {
  const u = await cuenta(request, env, url), dom = (env.DOMINIO || '').toLowerCase();
  if (!dom || u.hd !== dom || !u.email.endsWith(`@${dom}`)) throw new HttpError(403, `Solo pueden subir fotos las cuentas @${dom}`);
  return u;
}
async function admin(request, env, url) {
  const u = await cuenta(request, env, url);
  if (!(env.ADMINS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean).includes(u.email)) throw new HttpError(403, 'Esta cuenta no es de un administrador');
  return u;
}

// --- JPEG: medidas y limpieza de metadatos ---
function segmentos(b) { // [{ marca, ini, fin }] hasta el comienzo de los datos de la imagen (SOS)
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  const r = []; let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const marca = b[i + 1];
    if (marca === 0xff) { i++; continue; }
    const largo = (b[i + 2] << 8) | b[i + 3];
    r.push({ marca, ini: i, fin: i + 2 + largo });
    if (marca === 0xda) return r; // SOS: sigue la imagen comprimida
    i += 2 + largo;
  }
  return null;
}
function unir(partes) {
  const out = new Uint8Array(partes.reduce((n, p) => n + p.length, 0)); let k = 0;
  for (const p of partes) { out.set(p, k); k += p.length; }
  return out;
}
function jpeg(b) { // { datos sin APP1–APP15 (EXIF, XMP, ICC…) ni comentarios, ancho, alto } | null
  const segs = segmentos(b); if (!segs) return null;
  const sof = segs.find((s) => s.marca >= 0xc0 && s.marca <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(s.marca)); if (!sof) return null;
  const partes = []; let i = 0;
  for (const s of segs.filter((s) => (s.marca >= 0xe1 && s.marca <= 0xef) || s.marca === 0xfe)) { partes.push(b.subarray(i, s.ini)); i = s.fin; }
  partes.push(b.subarray(i));
  return { datos: unir(partes), alto: (b[sof.ini + 5] << 8) | b[sof.ini + 6], ancho: (b[sof.ini + 7] << 8) | b[sof.ini + 8] };
}
// --- WebP: medidas y limpieza (sin los trozos EXIF, XMP ni ICCP, y sus marcas en VP8X) ---
const ascii = (b, i) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
function webp(b) {
  if (b.length < 30 || ascii(b, 0) !== 'RIFF' || ascii(b, 8) !== 'WEBP') return null;
  const quedan = []; let ancho = 0, alto = 0, i = 12;
  while (i + 8 <= b.length) {
    const id = ascii(b, i), n = u32(b, i + 4), d = i + 8, fin = d + n + (n & 1);
    if (fin > b.length) return null;
    if (id === 'VP8 ') { ancho ||= (b[d + 6] | (b[d + 7] << 8)) & 0x3fff; alto ||= (b[d + 8] | (b[d + 9] << 8)) & 0x3fff; }
    else if (id === 'VP8L') { const v = u32(b, d + 1); ancho ||= (v & 0x3fff) + 1; alto ||= ((v >>> 14) & 0x3fff) + 1; }
    else if (id === 'VP8X') { ancho = (b[d + 4] | (b[d + 5] << 8) | (b[d + 6] << 16)) + 1; alto = (b[d + 7] | (b[d + 8] << 8) | (b[d + 9] << 16)) + 1; }
    if (!['EXIF', 'XMP ', 'ICCP'].includes(id)) {
      const trozo = b.slice(i, fin);
      if (id === 'VP8X') trozo[8] &= ~(0x20 | 0x08 | 0x04); // sin marcas de ICC, EXIF y XMP
      quedan.push(trozo);
    }
    i = fin;
  }
  if (!ancho || !alto) return null;
  const cuerpo = unir(quedan), cab = new Uint8Array(12);
  cab.set(b.subarray(0, 12)); new DataView(cab.buffer).setUint32(4, cuerpo.length + 4, true);
  return { datos: unir([cab, cuerpo]), ancho, alto };
}
async function imagenSubida(file, maxBytes, ok) { // { formato, datos, ancho, alto }
  if (!(file instanceof File) || !file.size || file.size > maxBytes) throw new HttpError(400, 'La foto pesa demasiado o no llegó');
  const b = new Uint8Array(await file.arrayBuffer());
  const r = b[0] === 0xff ? { formato: 'jpg', ...jpeg(b) } : { formato: 'webp', ...webp(b) };
  if (!r.datos || !ok(r)) throw new HttpError(400, 'La foto no es un JPEG o WebP válido, o no tiene el tamaño esperado');
  return r;
}

// --- subir ---
async function subir(request, env, u) {
  if (env.LIMITER) {
    const { success } = await env.LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') || 'desconocida' });
    if (!success) throw new HttpError(429, 'Demasiados intentos. Espera un minuto');
  }
  almacen(env);
  if (Number(request.headers.get('Content-Length') || 0) > 3e6) throw new HttpError(413, 'La foto pesa demasiado');
  let form;
  try { form = await request.formData(); } catch { throw new HttpError(400, 'Solicitud inválida'); }
  const lugar = String(form.get('lugar') || '').trim(), lugarTexto = String(form.get('lugarTexto') || '').trim().slice(0, 200) || null;
  if (!lugar || lugar.length > 160) throw new HttpError(400, 'Falta el lugar');
  if (form.get('acepto') !== 'si') throw new HttpError(400, 'Debes aceptar la licencia');
  const hace24 = new Date(Date.now() - 864e5).toISOString();
  const cuenta = await env.DB.prepare("SELECT SUM(creada > ?) AS dia, SUM(estado = 'pendiente') AS pend FROM fotos WHERE email = ?").bind(hace24, u.email).first();
  if ((cuenta?.dia || 0) >= POR_DIA) throw new HttpError(429, `Puedes subir hasta ${POR_DIA} fotos al día`);
  if ((cuenta?.pend || 0) >= PENDIENTES) throw new HttpError(429, 'Tienes muchas fotos esperando revisión: espera a que las revisen');
  const foto = await imagenSubida(form.get('foto'), MAX.fotoBytes, (m) => Math.max(m.ancho, m.alto) <= MAX.foto && Math.min(m.ancho, m.alto) >= 300);
  const mini = await imagenSubida(form.get('mini'), MAX.miniBytes, (m) => m.alto <= MAX.miniAlto && m.ancho <= 2000 && m.formato === foto.formato);
  const bytes = foto.datos.length + mini.datos.length;
  if ((await usado(env)) + bytes > tope(env)) throw new HttpError(507, 'Se llenó el espacio para fotos. Por ahora no se pueden subir más');
  const id = crypto.randomUUID(), ahora = new Date().toISOString(), ext = foto.formato, meta = { httpMetadata: { contentType: TIPO[ext] } };
  await almacen(env).put(`${id}.${ext}`, foto.datos, meta);
  await almacen(env).put(`${id}-m.${ext}`, mini.datos, meta);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO fotos (id, lugar, lugar_texto, email, nombre, mostrar_nombre, formato, ancho, alto, bytes, creada) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, lugar, lugarTexto, u.email, u.nombre, form.get('nombre') === 'si' && u.nombre ? 1 : 0, ext, foto.ancho, foto.alto, bytes, ahora),
    env.DB.prepare('INSERT INTO registro (foto, accion, quien, cuando, detalle) VALUES (?, ?, ?, ?, ?)').bind(id, 'subida', u.email, ahora, lugar),
  ]);
  return { id, estado: 'pendiente' };
}

// espacio que ocupan en R2 las fotos guardadas (las rechazadas se borran)
const tope = (env) => Number(env.TOPE_BYTES) || TOPE_BYTES; // TOPE_BYTES en .dev.vars solo para probar
const usado = async (env) => (await env.DB.prepare("SELECT COALESCE(SUM(bytes), 0) AS b FROM fotos WHERE estado != 'rechazada'").first())?.b || 0;

// --- leer ---
async function publicadas(env, base) {
  const { results } = await env.DB.prepare("SELECT id, lugar, nombre, mostrar_nombre, formato, ancho, alto FROM fotos WHERE estado = 'publicada' ORDER BY revisada").all();
  const r = {};
  for (const f of results) (r[f.lugar] ||= []).push({
    foto: `${base}/img/${f.id}.${f.formato}`, mini: `${base}/img/${f.id}-m.${f.formato}`, ancho: f.ancho, alto: f.alto,
    autor: f.mostrar_nombre ? f.nombre : null, licencia: LICENCIA, licenciaUrl: LICENCIA_URL, fuente: null, descripcion: '', comunidad: true,
  });
  return r;
}
async function imagen(env, id, mini, todas) {
  const f = await env.DB.prepare('SELECT estado, formato FROM fotos WHERE id = ?').bind(id).first();
  if (!f || (!todas && f.estado !== 'publicada')) throw new HttpError(404, 'No encontrada');
  const obj = await almacen(env).get(`${id}${mini ? '-m' : ''}.${f.formato}`);
  if (!obj) throw new HttpError(404, 'No encontrada');
  return new Response(obj.body, { headers: { 'Content-Type': TIPO[f.formato], 'Cache-Control': todas ? 'private, no-store' : 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
}
async function lista(env, estado) {
  const q = estado === 'todas' ? env.DB.prepare('SELECT * FROM fotos ORDER BY creada DESC LIMIT 200')
    : env.DB.prepare('SELECT * FROM fotos WHERE estado = ? ORDER BY creada DESC LIMIT 200').bind(estado);
  const [{ results: fotos }, { results: registro }] = await env.DB.batch([q, env.DB.prepare('SELECT * FROM registro ORDER BY n DESC LIMIT 200')]);
  return { fotos, registro, espacio: { usado: await usado(env), tope: tope(env) } };
}

// --- decidir ---
const ESTADO = { publicar: 'publicada', rechazar: 'rechazada', retirar: 'retirada' };
async function decidir(request, env, a) {
  let b;
  try { b = await request.json(); } catch { throw new HttpError(400, 'Solicitud inválida'); }
  const nuevo = ESTADO[b?.accion], motivo = String(b?.motivo || '').slice(0, 300) || null;
  if (!nuevo) throw new HttpError(400, 'Acción inválida');
  const f = await env.DB.prepare('SELECT estado, formato FROM fotos WHERE id = ?').bind(String(b.id)).first();
  if (!f) throw new HttpError(404, 'No encontrada');
  if (f.estado === 'rechazada') throw new HttpError(409, 'Esa foto fue rechazada y ya se borró');
  const ahora = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare('UPDATE fotos SET estado = ?, revisada = ?, revisor = ?, motivo = ? WHERE id = ?').bind(nuevo, ahora, a.email, motivo, b.id),
    env.DB.prepare('INSERT INTO registro (foto, accion, quien, cuando, detalle) VALUES (?, ?, ?, ?, ?)').bind(b.id, b.accion, a.email, ahora, motivo),
  ]);
  if (nuevo === 'rechazada') await almacen(env).delete([`${b.id}.${f.formato}`, `${b.id}-m.${f.formato}`]);
  return { id: b.id, estado: nuevo };
}
