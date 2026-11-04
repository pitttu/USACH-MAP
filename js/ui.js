// Utilidades de la interfaz: crear elementos, íconos Material Symbols, avisos (snackbar) y formatos.
// Todo texto que viene de datos (SIAC, GeoJSON) entra con textContent a través de h(), nunca como HTML.

export function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  fill(e, ...kids);
  return e;
}

// reemplaza el contenido; los hijos vacíos (null, false, '') se saltan
export function fill(e, ...kids) {
  e.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false && k !== '').map((k) => (k instanceof Node ? k : String(k))));
  return e;
}

// Ícono de la fuente Material Symbols Rounded. Cada nombre usado debe estar en el <link> de index.html (icon_names).
export function icon(name, { filled = false, cls = '' } = {}) {
  return h('span', { class: `ms${filled ? ' fill' : ''}${cls ? ` ${cls}` : ''}`, 'aria-hidden': 'true' }, name);
}

// Aviso abajo, sobre la barra (como los de Google Maps). action: { label, fn }
export function snackbar(msg, { error = false, action = null, duration = 3500 } = {}) {
  const box = document.getElementById('snackbars');
  for (const old of box.children) old.remove(); // uno a la vez
  const el = h('div', { class: `snackbar${error ? ' error' : ''}`, role: error ? 'alert' : 'status' }, h('span', {}, msg),
    action && h('button', { class: 'snackbar-action', onclick: () => { action.fn(); dismiss(); } }, action.label));
  const dismiss = () => { el.classList.add('out'); setTimeout(() => el.remove(), 220); };
  box.append(el);
  setTimeout(dismiss, duration);
  return dismiss;
}

export const WALK_MIN_PER_KM = 15; // 4 km/h: lo usan la ficha de ruta, los traslados y "cerca de ti"
export const walkMin = (meters) => Math.max(1, Math.round((meters / 1000) * WALK_MIN_PER_KM));
export const fmtDist = (m) => (m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`);
export const fmtDur = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`);
// "S2 Escuela de Artes y Oficios (EAO)" -> "Escuela de Artes y Oficios (EAO)"; "Sin definir" -> ''
export const shortBuilding = (s) => String(s || '').replace(/^S\d+\s+/, '').replace(/^Sin definir$/i, '');
// minúsculas y sin tildes (búsqueda); conserva el largo de cada letra, así sirve para resaltar
export const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
