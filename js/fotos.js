// Fotos de los lugares: carrusel en la hoja (bajo los botones), visor a pantalla completa y "Agregar foto".
//  - De Wikimedia Commons, con licencia libre: assets/data/fotos.json (ver tools/fotos-lugar.mjs).
//  - De la comunidad: las publicadas del Worker de fotos (fotos-worker/), con licencia CC BY-NC-SA 4.0.
// Subir: la persona entra con su cuenta de Google @usach.cl (Google Identity Services, que se carga recién al tocar
// "Agregar foto"), elige si el crédito lleva su nombre o no y acepta la licencia. La foto se achica aquí (y el
// navegador la vuelve a codificar, sin EXIF: sin ubicación ni datos de la cámara) y queda pendiente hasta que un
// administrador la revise en el panel del Worker (/admin). El token de Google solo se guarda en memoria.
import { h, fill, icon, snackbar } from './ui.js';

// Worker de fotos y cliente OAuth de Google (tipo "Aplicación web"; no es secreto). Sin el ID de cliente, "Agregar
// fotos" solo avisa que viene pronto (ver fotos-worker/README.md).
const FOTOS_WORKER = 'https://usach-fotos.siac-worker.workers.dev';
const GOOGLE_CLIENT_ID = '';
const DOMINIO = 'usach.cl';
const LICENCIA = { nombre: 'CC BY-NC-SA 4.0', url: 'https://creativecommons.org/licenses/by-nc-sa/4.0/deed.es' };
// en el Mac se puede probar contra `wrangler dev` con ?fotos-api=http://127.0.0.1:8787 (solo en localhost)
const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
const API = (LOCAL && new URLSearchParams(location.search).get('fotos-api')) || FOTOS_WORKER;
const PRUEBA = LOCAL && new URLSearchParams(location.search).get('fotos-prueba'); // "correo:nombre" (wrangler dev con PRUEBA_SIN_GOOGLE)
const SUBIR = !!(API && (GOOGLE_CLIENT_ID || PRUEBA));

const $ = (id) => document.getElementById(id);
let current = null, currentName = '';

// --- datos: Commons (estáticas) + comunidad (Worker); se piden la primera vez que se abre un lugar ---
let staticP = null, communityP = null;
const getJSON = (url) => fetch(url).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
async function photosOf(name) {
  staticP ||= getJSON('assets/data/fotos.json');
  communityP ||= API ? getJSON(`${API}/fotos`) : Promise.resolve({});
  const [a, b] = await Promise.all([staticP, communityP]);
  return [...(a[name] || []), ...(b[name] || [])];
}

// --- carrusel: columnas de una foto grande o dos chicas apiladas, mezcladas al azar (como en Google Maps), y al
// final "Ver todo" y "Agregar fotos". El azar es fijo por lugar: cada lugar se ve siempre igual ---
function semilla(texto) { // número pseudoaleatorio en [0, 1) que depende solo del texto (mulberry32)
  let a = [...texto].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function columnas(n, azar) { // 'grande' (1 foto) o 'par' (2): empieza con una grande, nunca dos grandes seguidas ni
  const r = [];                // más de dos pares seguidos; tras un par, grande con probabilidad 0,6
  for (let i = 0; i < n;) {
    const pares = r.length - 1 - r.findLastIndex((t) => t === 'grande');
    let t = !r.length ? 'grande' : r.at(-1) === 'grande' ? 'par' : pares >= 2 || azar() < 0.6 ? 'grande' : 'par';
    if (n - i === 1) t = 'grande';
    r.push(t); i += t === 'grande' ? 1 : 2;
  }
  return r;
}
export async function renderPhotos(f, name) {
  current = f; currentName = name;
  const strip = $('place-photos'), src = $('place-photos-src');
  strip.hidden = src.hidden = true;
  fill(strip);
  if (f.properties.custom) return;
  const fotos = await photosOf(name);
  if (current !== f) return;
  const tile = (p, i) => h('button', { class: 'photo-tile', type: 'button', 'aria-label': `Ver foto ${i + 1} de ${fotos.length}`, onclick: () => openViewer(name, fotos, i) },
    h('img', { src: p.mini, alt: p.descripcion || name, loading: i < 5 ? 'eager' : 'lazy', decoding: 'async' }));
  const add = h('button', { class: 'photo-tile add', type: 'button', onclick: addPhoto },
    icon('add_a_photo'), h('span', {}, fotos.length ? 'Agregar fotos' : 'Sé el primero en agregar una foto de este lugar'));
  const cols = [];
  let i = 0;
  for (const t of columnas(fotos.length, semilla(name))) {
    cols.push(h('div', { class: `pcol ${t}` }, fotos.slice(i, i + (t === 'grande' ? 1 : 2)).map((p, k) => tile(p, i + k))));
    i += t === 'grande' ? 1 : 2;
  }
  // "Ver todo" (con la primera foto de fondo, oscurecida) y "Agregar fotos", apiladas en la última columna
  const all = fotos.length > 3 && h('button', { class: 'photo-tile all', type: 'button', onclick: () => openViewer(name, fotos, 0) },
    h('img', { src: fotos[0].mini, alt: '', loading: 'lazy', decoding: 'async' }), h('span', {}, icon('photo_library'), 'Ver todo'));
  cols.push(h('div', { class: `pcol ${fotos.length ? 'par' : 'sola'}` }, all, add));
  fill(strip, cols);
  strip.classList.toggle('only-add', !fotos.length);
  const commons = fotos.some((p) => !p.comunidad), comunidad = fotos.some((p) => p.comunidad);
  src.textContent = `Fotos de ${commons && comunidad ? 'Wikimedia Commons y de la comunidad' : commons ? 'Wikimedia Commons' : 'la comunidad'} · toca una para ver su autor`;
  strip.hidden = false;
  src.hidden = !fotos.length;
  strip.scrollLeft = 0;
}
// mientras el Worker de fotos no esté publicado, el botón avisa que viene pronto
function addPhoto() {
  if (SUBIR) $('pu-file').click();
  else snackbar('Muy pronto vas a poder agregar fotos de los lugares');
}

// --- visor ---
const viewer = $('photo-viewer'), track = $('pv-track');
let shown = [], pushed = false;
function openViewer(name, fotos, i) {
  shown = fotos;
  $('pv-place').textContent = name;
  fill(track, fotos.map((p) => h('div', { class: 'pv-slide' }, h('img', { src: p.foto, alt: p.descripcion || name, decoding: 'async' }))));
  viewer.hidden = false;
  // el botón atrás del celular cierra el visor (como la búsqueda)
  if (!pushed) { history.pushState({ usachOverlay: 'fotos' }, ''); pushed = true; }
  track.scrollLeft = i * track.clientWidth;
  credit(i);
}
function credit(i) {
  const p = shown[i]; if (!p) return;
  const link = (href, text) => (href ? h('a', { href, target: '_blank', rel: 'noopener' }, text) : text);
  $('pv-count').textContent = `${i + 1} de ${shown.length}`;
  fill($('pv-credit'), 'Foto: ', link(p.fuente, p.autor || 'Comunidad USACH'), ' · ', link(p.licenciaUrl, p.licencia), ' · ', p.comunidad ? 'aporte de la comunidad' : 'Wikimedia Commons');
}
function closeViewer({ fromHistory = false } = {}) {
  if (viewer.hidden) return;
  viewer.hidden = true;
  fill(track);
  if (pushed) { pushed = false; if (!fromHistory) history.back(); }
}

// --- agregar foto ---
const dialog = $('photo-upload');
let draft = null, session = null; // draft: { foto, mini, url }; session: { token, email, name, exp }
const payload = (t) => JSON.parse(decodeURIComponent(escape(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))));
const blob = (canvas, q) => new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', q));
async function resize(file) { // dos tamaños, re-codificados (sin metadatos): 1600 px de lado mayor y 520 px de alto
  const img = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const draw = (w, hgt) => { const c = document.createElement('canvas'); c.width = w; c.height = hgt; c.getContext('2d').drawImage(img, 0, 0, w, hgt); return c; };
  const k = Math.min(1, 1600 / Math.max(img.width, img.height)), km = Math.min(1, 520 / img.height);
  const out = { foto: await blob(draw(Math.round(img.width * k), Math.round(img.height * k)), 0.82), mini: await blob(draw(Math.round(img.width * km), Math.round(img.height * km)), 0.76) };
  img.close?.();
  return out;
}
async function pick(file) {
  if (!file) return;
  if (!/^image\//.test(file.type) || file.size > 30e6) { snackbar('Elige una foto (JPG, PNG o HEIC) de menos de 30 MB'); return; }
  try { draft = await resize(file); } catch { snackbar('No se pudo leer esa foto'); return; }
  if (Math.min(...[draft.foto, draft.mini].map((b) => b.size)) === 0) { snackbar('No se pudo leer esa foto'); return; }
  draft.url = URL.createObjectURL(draft.mini);
  $('pu-preview').src = draft.url;
  $('pu-place').textContent = currentName;
  $('pu-error').textContent = '';
  $('pu-accept').checked = false;
  dialog.hidden = false;
  showStep();
}
function showStep() {
  const ok = session && session.exp * 1000 > Date.now() + 60e3;
  $('pu-login').hidden = !!ok;
  $('pu-form').hidden = !ok;
  if (ok) {
    $('pu-email').textContent = session.email;
    $('pu-name').textContent = session.name || session.email;
    $('pu-send').disabled = !$('pu-accept').checked;
  } else if (PRUEBA) {
    const [email, name] = PRUEBA.split(':');
    session = { token: `prueba:${email}:${name || ''}`, email, name, exp: Date.now() / 1000 + 3600 };
    showStep();
  } else googleButton();
}
let gisP = null;
function googleButton() {
  gisP ||= new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = ok; s.onerror = fail;
    document.head.append(s);
  }).then(() => google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, hd: DOMINIO, callback: signedIn, context: 'signin', ux_mode: 'popup' }));
  gisP.then(() => google.accounts.id.renderButton($('pu-google'), { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', locale: 'es', width: 280 }))
    .catch(() => { gisP = null; $('pu-error').textContent = 'No se pudo cargar el inicio de sesión de Google. Revisa tu conexión.'; });
}
function signedIn({ credential }) {
  let p;
  try { p = payload(credential); } catch { $('pu-error').textContent = 'No se pudo leer tu sesión'; return; }
  if (p.hd !== DOMINIO) { $('pu-error').textContent = `Usa tu cuenta @${DOMINIO}: ${p.email} no es de la Universidad`; return; }
  session = { token: credential, email: p.email, name: p.name, exp: p.exp };
  $('pu-error').textContent = '';
  showStep();
}
function closeUpload() {
  dialog.hidden = true;
  if (draft?.url) URL.revokeObjectURL(draft.url);
  draft = null;
  $('pu-file').value = '';
}
async function send() {
  if (!draft || !session) return;
  if (session.exp * 1000 < Date.now() + 30e3) { session = null; showStep(); return; }
  const btn = $('pu-send'), form = new FormData();
  form.append('lugar', currentName);
  form.append('nombre', document.querySelector('input[name="pu-name"]:checked')?.value === 'si' ? 'si' : 'no');
  form.append('acepto', $('pu-accept').checked ? 'si' : 'no');
  form.append('foto', draft.foto, 'foto.jpg');
  form.append('mini', draft.mini, 'mini.jpg');
  btn.disabled = true; btn.textContent = 'Enviando…';
  try {
    const r = await fetch(`${API}/subir`, { method: 'POST', headers: { Authorization: `Bearer ${session.token}` }, body: form });
    const body = await r.json().catch(() => ({}));
    if (r.status === 401) { session = null; showStep(); throw new Error(body.error || 'Vuelve a entrar'); }
    if (!r.ok) throw new Error(body.error || 'No se pudo enviar');
    closeUpload();
    snackbar('¡Gracias! Tu foto quedó en revisión');
  } catch (e) {
    $('pu-error').textContent = e.message === 'Failed to fetch' ? 'No se pudo conectar. Revisa tu conexión.' : e.message;
  } finally {
    btn.textContent = 'Enviar a revisión';
    btn.disabled = !$('pu-accept').checked;
  }
}

export function initFotos() {
  track.addEventListener('scroll', () => credit(Math.round(track.scrollLeft / track.clientWidth)), { passive: true });
  $('pv-close').addEventListener('click', () => closeViewer());
  window.addEventListener('popstate', () => closeViewer({ fromHistory: true }));
  document.addEventListener('keydown', (e) => { // antes que el Escape de la hoja
    if (!dialog.hidden && e.key === 'Escape') { e.stopImmediatePropagation(); closeUpload(); return; }
    if (viewer.hidden) return;
    if (e.key === 'Escape') { e.stopImmediatePropagation(); closeViewer(); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') track.scrollBy({ left: (e.key === 'ArrowRight' ? 1 : -1) * track.clientWidth, behavior: 'smooth' });
  }, true);
  $('pu-file').addEventListener('change', (e) => pick(e.target.files[0]));
  $('pu-close').addEventListener('click', closeUpload);
  $('pu-cancel').addEventListener('click', closeUpload);
  $('pu-accept').addEventListener('change', () => { $('pu-send').disabled = !$('pu-accept').checked; });
  $('pu-send').addEventListener('click', send);
  $('pu-other').addEventListener('click', () => { session = null; showStep(); });
  $('pu-licence').href = LICENCIA.url;
}
