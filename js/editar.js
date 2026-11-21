// Sugerir un cambio a un lugar que ya está en el mapa (botón Editar del lugar, como "Sugerir un cambio" de Google
// Maps). Un menú con lo que se puede corregir (nombre, categoría, ubicación, detalles, o que cerró / no está aquí);
// cada opción abre su formulario y se envía con la cuenta @usach.cl al Worker de la comunidad (POST /lugares/editar).
// No cambia nada solo: queda pendiente y un administrador corrige los datos del mapa y la marca en /admin (Ediciones).
// Es independiente de "Sugerir un lugar" (sugerir.js): solo comparten la sesión (cuenta.js) y la lista de categorías.
import { h, fill, icon, snackbar } from './ui.js';
import { API, sesion, salir, botonGoogle } from './cuenta.js';
import { CATEGORIAS_SUGERIDAS } from './sugerir.js';

const $ = (id) => document.getElementById(id);
const dialog = $('place-edit-dialog'), body = $('pe-body');
const CIERRES = [['cerro', 'Cerró definitivamente'], ['no_esta', 'No está en este lugar'], ['no_existe', 'No existe o está repetido']];
const coordsTxt = ([lon, lat]) => `${lat.toFixed(6)}, ${lon.toFixed(6)}`;

let lugar = null; // { f, d, clave, texto, categoria }
let elegir = null; // (onPick, center) => elige un punto en el mapa (startPick de app.js)
let paso = null; // { campo, valor, nuevo } del formulario abierto

export function initEditar({ elegirPunto }) {
  elegir = elegirPunto;
  $('pe-close').addEventListener('click', cerrar);
  $('pe-back').addEventListener('click', () => (paso ? menu() : cerrar()));
  document.addEventListener('keydown', (e) => { if (!dialog.hidden && e.key === 'Escape') { e.stopImmediatePropagation(); paso ? menu() : cerrar(); } }, true);
}

// f: el lugar (feature) y d: cómo se muestra (places.describe)
export function editarLugar(f, d) {
  const p = f.properties || {};
  const categoria = p.category === 'servicios' && /impres|fotocop/i.test(`${p.type} ${p.name}`) ? 'impresiones'
    : CATEGORIAS_SUGERIDAS.some(([v]) => v === p.category) ? p.category : '';
  lugar = { f, d, clave: d.generic ? `${d.name} @${f.geometry.coordinates.map((v) => v.toFixed(5)).join(',')}` : d.name, texto: d.sub ? `${d.name} · ${d.sub}` : d.name, categoria };
  $('pe-place').textContent = lugar.texto;
  menu();
  dialog.hidden = false;
}

function cerrar() { dialog.hidden = true; lugar = null; paso = null; }

// --- el menú: una fila por cosa que se puede corregir ---
function menu() {
  paso = null;
  $('pe-title').textContent = 'Sugerir un cambio';
  $('pe-back').hidden = true;
  $('pe-error').textContent = '';
  const { d, f } = lugar, sala = d.kind === 'Sala';
  const fila = (ic, texto, campo, cls = '') => h('button', { class: `pe-row ${cls}`, type: 'button', onclick: () => abrir(campo) },
    icon(ic), h('span', { class: 'grow' }, texto), icon('chevron_right'));
  const cat = CATEGORIAS_SUGERIDAS.find(([v]) => v === lugar.categoria)?.[1] || d.kind || 'Agregar una categoría';
  fill(body,
    h('div', { class: 'pe-menu' },
      fila(d.icon || 'location_on', d.name, 'nombre'),
      !sala && fila('category', cat, 'categoria'),
      fila('location_on', `Ubicación: ${coordsTxt(f.geometry.coordinates)}`, 'ubicacion'),
      fila('info', d.desc || 'Agregar detalles (piso, horario, cómo encontrarlo…)', 'detalles'),
      fila('location_off', sala ? 'La sala no existe o no está aquí' : 'Cerró o no está aquí', 'cerrado', 'pe-accent')),
    h('button', { class: 'btn btn-tonal btn-block pe-cancel', type: 'button', onclick: cerrar }, 'Cancelar'));
}

// --- el formulario de cada cambio ---
function abrir(campo) {
  paso = { campo };
  $('pe-error').textContent = '';
  if (campo === 'ubicacion') { // primero el punto en el mapa (cerca del lugar); luego se confirma aquí
    dialog.hidden = true;
    elegir((c) => { dialog.hidden = false; paso.nuevo = c; formulario(); }, lugar.f.geometry.coordinates);
    return;
  }
  formulario();
  setTimeout(() => body.querySelector('input:not([type=radio]), select, textarea')?.focus(), 50);
}

function formulario() {
  const { campo } = paso, { d, f } = lugar;
  $('pe-back').hidden = false;
  const TITULOS = { nombre: 'Cambiar el nombre', categoria: 'Cambiar la categoría', ubicacion: 'Mover el lugar', detalles: 'Corregir los detalles', cerrado: d.kind === 'Sala' ? 'La sala no existe o no está aquí' : 'Cerró o no está aquí' };
  $('pe-title').textContent = TITULOS[campo];
  let campoEl = null;
  if (campo === 'nombre') campoEl = h('label', { class: 'tu-field' }, h('span', {}, 'Nombre correcto'), h('input', { id: 'pe-valor', type: 'text', maxlength: 80, autocomplete: 'off', value: d.name }));
  if (campo === 'categoria') {
    const sel = h('select', { id: 'pe-valor' }, h('option', { value: '', disabled: true }, 'Elige una categoría'), CATEGORIAS_SUGERIDAS.map(([v, t]) => h('option', { value: v }, t)));
    sel.value = lugar.categoria;
    campoEl = h('label', { class: 'tu-field' }, h('span', {}, 'Categoría correcta'), sel);
  }
  if (campo === 'ubicacion') campoEl = h('div', { class: 'pe-mover' },
    h('div', { class: 'ps-where' }, icon('location_on', { filled: true }), h('span', { class: 'grow' }, h('b', {}, 'Ahora'), h('small', {}, coordsTxt(f.geometry.coordinates)))),
    h('div', { class: 'ps-where nuevo' }, icon('location_on', { filled: true }), h('span', { class: 'grow' }, h('b', {}, 'Debería estar en'), h('small', {}, coordsTxt(paso.nuevo))),
      h('button', { class: 'text-btn', type: 'button', onclick: () => abrir('ubicacion') }, 'Cambiar')));
  if (campo === 'detalles') campoEl = h('label', { class: 'tu-field' }, h('span', {}, 'Detalles correctos'),
    h('textarea', { id: 'pe-valor', maxlength: 300, rows: 3, placeholder: 'Piso, horario, cómo encontrarlo…' }, d.desc || ''));
  if (campo === 'cerrado') campoEl = h('fieldset', { class: 'pu-credit pe-cierre' }, h('legend', {}, '¿Qué pasa con este lugar?'),
    CIERRES.map(([v, t], i) => h('label', {}, h('input', { type: 'radio', name: 'pe-cierre', value: v, checked: i === 0 }), h('span', {}, t))));
  const s = sesion();
  fill(body,
    campoEl,
    h('label', { class: 'tu-field' }, h('span', {}, 'Comentario para quien revisa (opcional)'), h('textarea', { id: 'pe-comentario', maxlength: 300, rows: 2 })),
    s ? h('div', {},
      h('p', { class: 'pu-who' }, 'Entraste como ', h('b', {}, s.email), ' · ', h('button', { class: 'link-btn', type: 'button', onclick: () => { salir(); formulario(); } }, 'usar otra cuenta')),
      h('p', { class: 'pu-note' }, 'Un administrador lo revisa antes de cambiar el mapa. Tu correo no se muestra.'),
      h('div', { class: 'pu-actions' },
        h('button', { class: 'btn btn-gray', type: 'button', onclick: menu }, 'Atrás'),
        h('button', { id: 'pe-send', class: 'btn btn-filled', type: 'button', onclick: enviar }, 'Enviar a revisión')))
      : h('div', { class: 'pu-login' }, h('p', {}, 'Para enviarlo, entra con tu cuenta ', h('b', {}, '@usach.cl'), '.'), h('div', { id: 'pe-google' })));
  if (!s) botonGoogle($('pe-google'), () => { $('pe-error').textContent = ''; conservar(formulario); }, (msg) => { $('pe-error').textContent = msg; });
}
// vuelve a dibujar el formulario sin perder lo escrito
function conservar(fn) {
  const v = $('pe-valor')?.value, c = $('pe-comentario')?.value, r = body.querySelector('input[name="pe-cierre"]:checked')?.value;
  fn();
  if (v != null && $('pe-valor')) $('pe-valor').value = v;
  if (c != null) $('pe-comentario').value = c;
  if (r) body.querySelector(`input[name="pe-cierre"][value="${r}"]`).checked = true;
}

async function enviar() {
  const s = sesion(), { campo } = paso, { d, f } = lugar;
  if (!s) { conservar(formulario); return; }
  let valor = '', actual = '';
  if (campo === 'nombre') { valor = $('pe-valor').value.trim(); actual = d.name; if (valor.length < 2) return error('Escribe el nombre correcto.'); if (valor === d.name) return error('Es el mismo nombre que ya tiene.'); }
  if (campo === 'categoria') { valor = $('pe-valor').value; actual = lugar.categoria || d.kind || ''; if (!valor) return error('Elige una categoría.'); if (valor === lugar.categoria) return error('Es la misma categoría que ya tiene.'); }
  if (campo === 'ubicacion') { valor = paso.nuevo.map((v) => v.toFixed(7)).join(','); actual = f.geometry.coordinates.join(','); }
  if (campo === 'detalles') { valor = $('pe-valor').value.trim(); actual = d.desc || ''; }
  if (campo === 'cerrado') valor = body.querySelector('input[name="pe-cierre"]:checked')?.value || '';
  const comentario = $('pe-comentario').value.trim();
  if (campo === 'detalles' && !valor && !comentario) return error('Escribe qué hay que corregir.');
  const btn = $('pe-send');
  btn.disabled = true; btn.textContent = 'Enviando…';
  try {
    const [lon, lat] = f.geometry.coordinates;
    const r = await fetch(`${API}/lugares/editar`, {
      method: 'POST', headers: { Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ lugar: lugar.clave, lugarTexto: lugar.texto, lon, lat, campo, actual, valor, comentario }),
    });
    const res = await r.json().catch(() => ({}));
    if (r.status === 401) { salir(); conservar(formulario); throw new Error(res.error || 'Vuelve a entrar'); }
    if (r.status === 404) throw new Error('Sugerir cambios aún no está disponible. Vuelve a intentarlo pronto.');
    if (!r.ok) throw new Error(res.error || 'No se pudo enviar');
    cerrar();
    snackbar('¡Gracias! Tu sugerencia quedó en revisión');
  } catch (e) {
    error(e.message === 'Failed to fetch' ? 'No se pudo conectar. Revisa tu conexión.' : e.message);
  } finally {
    if (document.body.contains(btn)) { btn.disabled = false; btn.textContent = 'Enviar a revisión'; }
  }
}
function error(msg) { $('pe-error').textContent = msg; }
