// Sugerir un lugar que falta en el mapa (Más → Sugerir un lugar). Se elige el punto tocando el mapa, se le pone
// nombre, categoría y detalles, y se envía con la cuenta @usach.cl al Worker de la comunidad (fotos-worker/), donde
// queda pendiente hasta que un administrador lo revise en /admin (puede corregir el nombre y la categoría). Los
// publicados vuelven con GET /lugares y app.js los suma a los lugares del mapa al abrir la app.
import { snackbar } from './ui.js';
import { API, sesion, salir, botonGoogle } from './cuenta.js';

// categorías que se pueden sugerir: el valor es la "category" de los datos del mapa (ver places.js)
export const CATEGORIAS_SUGERIDAS = [
  ['comida', 'Comida o cafetería'], ['baño', 'Baño'], ['dispensador', 'Agua (dispensador)'], ['impresiones', 'Impresiones y fotocopias'],
  ['cajero', 'Cajero automático'], ['biblioteca', 'Biblioteca o sala de estudio'], ['educacion', 'Facultad, departamento o escuela'],
  ['deporte', 'Deporte'], ['salud', 'Salud'], ['cultura', 'Cultura o monumento'], ['tienda', 'Tienda'], ['servicios', 'Servicio'],
  ['institucional', 'Oficina o institucional'], ['otro', 'Otro'],
];

const $ = (id) => document.getElementById(id);
const dialog = $('poi-suggest');
let punto = null, elegir = null;

// Lugares publicados de la comunidad (GeoJSON). No retrasa la carga del mapa: si no responde pronto, sin ellos.
export async function lugaresComunidad(ms = 2500) {
  if (!API) return [];
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(`${API}/lugares`, { signal: ctl.signal });
    return r.ok ? (await r.json()).features || [] : [];
  } catch { return []; } finally { clearTimeout(t); }
}

// elegirPunto(onPick): pide un punto tocando el mapa (startPick de app.js)
export function initSugerir({ elegirPunto }) {
  elegir = elegirPunto;
  $('ps-cat').replaceChildren(new Option('Elige una categoría', ''), ...CATEGORIAS_SUGERIDAS.map(([v, t]) => new Option(t, v)));
  $('ps-cat').options[0].disabled = true;
  $('ps-close').addEventListener('click', cerrar);
  $('ps-cancel').addEventListener('click', cerrar);
  $('ps-send').addEventListener('click', enviar);
  $('ps-other').addEventListener('click', () => { salir(); paso(); });
  $('ps-move').addEventListener('click', () => { dialog.hidden = true; elegir((c) => mostrar(c)); });
  document.addEventListener('keydown', (e) => { if (!dialog.hidden && e.key === 'Escape') { e.stopImmediatePropagation(); cerrar(); } }, true);
}

// empieza: primero el punto en el mapa, luego el formulario
export function sugerirLugar() {
  $('ps-name').value = ''; $('ps-desc').value = ''; $('ps-cat').value = '';
  elegir((c) => mostrar(c));
}
function mostrar(coords) {
  punto = coords;
  $('ps-coords').textContent = `${coords[1].toFixed(6)}, ${coords[0].toFixed(6)}`;
  $('ps-error').textContent = '';
  dialog.hidden = false;
  paso();
  if (!$('ps-name').value) setTimeout(() => $('ps-name').focus(), 50);
}
function paso() {
  const s = sesion();
  $('ps-login').hidden = !!s;
  $('ps-form').hidden = !s;
  if (s) $('ps-email').textContent = s.email;
  else botonGoogle($('ps-google'), () => { $('ps-error').textContent = ''; paso(); }, (msg) => { $('ps-error').textContent = msg; });
}
function cerrar() { dialog.hidden = true; punto = null; }

async function enviar() {
  const s = sesion(), nombre = $('ps-name').value.trim(), categoria = $('ps-cat').value;
  if (!s) { paso(); return; }
  if (nombre.length < 2) { $('ps-error').textContent = 'Escribe el nombre del lugar.'; $('ps-name').focus(); return; }
  if (!categoria) { $('ps-error').textContent = 'Elige una categoría.'; $('ps-cat').focus(); return; }
  const btn = $('ps-send');
  btn.disabled = true; btn.textContent = 'Enviando…';
  try {
    const r = await fetch(`${API}/lugares/sugerir`, {
      method: 'POST', headers: { Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre, categoria, descripcion: $('ps-desc').value.trim(), lon: punto[0], lat: punto[1] }),
    });
    const body = await r.json().catch(() => ({}));
    if (r.status === 401) { salir(); paso(); throw new Error(body.error || 'Vuelve a entrar'); }
    if (r.status === 404) throw new Error('Sugerir lugares aún no está disponible. Vuelve a intentarlo pronto.');
    if (!r.ok) throw new Error(body.error || 'No se pudo enviar');
    cerrar();
    snackbar('¡Gracias! Tu sugerencia quedó en revisión');
  } catch (e) {
    $('ps-error').textContent = e.message === 'Failed to fetch' ? 'No se pudo conectar. Revisa tu conexión.' : e.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Enviar a revisión';
  }
}
