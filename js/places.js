// Lugares del campus: catálogo de categorías, cómo se muestra cada lugar (nombre, ícono, subtítulo), búsqueda,
// edificios con sus salas, guardados, recientes y distancia a pie desde la ubicación del usuario.
import { toLocal } from './geo.js';
import { graphIndex, distancesFrom } from './routing.js';
import { norm, shortBuilding, walkMin } from './ui.js';

// tint / ink: fondo y color del ícono (pasteles, como los de Google Maps). marker: capa de marcadores de mapview
// (solo las que tienen pastilla). single: cómo se llama un lugar de la categoría.
export const CATEGORIES = [
  { id: 'accesos', label: 'Entradas y salidas', single: 'Entrada', icon: 'door_open', marker: 'accesos', tint: '#fef7e0', ink: '#9a5b00', words: ['entrada', 'salida', 'acceso', 'puerta', 'ingreso'] },
  { id: 'agua', label: 'Agua', single: 'Agua', icon: 'water_drop', marker: 'dispensador', tint: '#d3e3fd', ink: '#0b57d0', words: ['agua', 'dispensador', 'bebedero', 'botella'] },
  { id: 'banos', label: 'Baños', single: 'Baño', icon: 'wc', marker: 'banos', tint: '#c4e9ed', ink: '#00626e', words: ['baño', 'bano', 'wc', 'servicio higienico', 'higienico'] },
  { id: 'impresiones', label: 'Impresiones', single: 'Impresiones', icon: 'print', marker: 'impresiones', tint: '#ebe1fb', ink: '#5b3f9a', words: ['impresion', 'imprimir', 'fotocopia', 'copia', 'copiado'] },
  { id: 'cajeros', label: 'Cajeros', single: 'Cajero', icon: 'local_atm', marker: 'cajero', tint: '#cdefd6', ink: '#0d652d', words: ['cajero', 'atm', 'dinero', 'plata', 'banco'] },
  { id: 'comida', label: 'Comida', single: 'Comida', icon: 'restaurant', marker: 'comida', tint: '#fff1ec', ink: '#b3261e', words: ['comida', 'comer', 'casino', 'cafeteria', 'cafe', 'kiosco', 'kiosko', 'almuerzo', 'colacion'] },
  { id: 'bibliotecas', label: 'Bibliotecas', single: 'Biblioteca', icon: 'local_library', tint: '#fde6d5', ink: '#8c4a00', words: ['biblioteca', 'libro', 'estudiar'] },
  { id: 'metro', label: 'Metro', single: 'Metro', icon: 'subway', tint: '#fde3e1', ink: '#c5221f', words: ['metro', 'estacion', 'tren', 'efe', 'transporte'] },
  { id: 'facultades', label: 'Facultades', single: 'Facultad', icon: 'school', tint: '#e1e5fb', ink: '#3949ab', words: ['facultad', 'departamento', 'escuela', 'carrera'] },
  { id: 'deportes', label: 'Deportes', single: 'Deporte', icon: 'sports_soccer', tint: '#dcf0d5', ink: '#2e6b1f', words: ['deporte', 'cancha', 'gimnasio', 'estadio', 'tenis', 'futbol'] },
  { id: 'salud', label: 'Salud', single: 'Salud', icon: 'medical_services', tint: '#fce4ec', ink: '#b0003a', words: ['salud', 'farmacia', 'medico', 'enfermeria', 'doctor'] },
  { id: 'cultura', label: 'Cultura', single: 'Cultura', icon: 'museum', tint: '#efe6d8', ink: '#6d4c1f', words: ['cultura', 'planetario', 'aula magna', 'monumento', 'museo', 'memorial'] },
];
export const CAT = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));
const CAT_OF = { 'baño': 'banos', dispensador: 'agua', cajero: 'cajeros', acceso: 'accesos', comida: 'comida', biblioteca: 'bibliotecas', transporte: 'metro', educacion: 'facultades', deporte: 'deportes', salud: 'salud', cultura: 'cultura', monumento: 'cultura' };
const ICON_OF = { institucional: 'account_balance', pastos: 'park', radio: 'radio', tienda: 'storefront', servicios: 'storefront' };
// nombres repetidos en los datos: se muestra el nombre corto y, como subtítulo, el lugar con nombre más cercano
const GENERIC = { 'baño público': 'Baño', 'dispensador de agua': 'Dispensador de agua', 'impresiones y fotocopias': 'Impresiones y fotocopias' };

let searchable = [], landmarks = [], everything = [];
const labelIds = new Set(); // lugares con etiqueta en el mapa (se resaltan al elegirlos)
export const buildings = [];

export function indexPlaces(d) {
  const misc = d.misc.features, fixed = d.fixed.features, both = [...misc, ...fixed], byCat = (c) => both.filter((f) => f.properties.category === c);
  CAT.accesos.features = d.accesos.features;
  CAT.agua.features = d.dispensadores.features;
  CAT.banos.features = d.banos.features;
  CAT.impresiones.features = d.impresiones.features;
  CAT.cajeros.features = d.cajeros.features;
  CAT.comida.features = byCat('comida');
  CAT.bibliotecas.features = byCat('biblioteca');
  CAT.metro.features = d.metro.features;
  CAT.facultades.features = byCat('educacion');
  CAT.deportes.features = byCat('deporte');
  CAT.salud.features = byCat('salud');
  CAT.cultura.features = [...byCat('cultura'), ...byCat('monumento')];
  landmarks = both.filter((f) => !/^pastos$/i.test(f.properties.name || ''));
  searchable = [...d.salas.features, ...misc, ...fixed, ...d.metro.features];
  everything = [...searchable, ...d.accesos.features, ...d.banos.features, ...d.dispensadores.features, ...d.impresiones.features, ...d.cajeros.features];
  for (const f of [...misc, ...fixed, ...d.metro.features]) labelIds.add(placeId(f));
  indexBuildings(d.salas.features);
}

// --- cómo se muestra un lugar ---
const described = new WeakMap();
export function describe(f) {
  if (described.has(f)) return described.get(f);
  const p = f.properties || {};
  let d;
  if (p.custom) {
    d = { name: p.nombre || 'Ubicación seleccionada', sub: 'Punto en el mapa', icon: 'location_on', kind: 'Punto', tint: '#fce8e6', ink: '#c5221f' };
  } else if (p.nombre && ('capacidad' in p || 'piso' in p)) { // sala
    const building = shortBuilding(p.edificio), floor = Number(p.piso) || null;
    d = {
      name: p.nombre, kind: 'Sala', icon: 'meeting_room', tint: '#d3f7ff', ink: '#014f5a', building, floor, capacity: p.capacidad || null,
      sub: ['Sala', building, floor > 1 ? `Piso ${floor}` : floor < 0 ? 'Subterráneo' : ''].filter(Boolean).join(' · '),
    };
  } else {
    const catId = p.category === 'servicios' && /impres|fotocop|copiado/i.test(`${p.type} ${p.name}`) ? 'impresiones' : CAT_OF[p.category];
    const cat = CAT[catId], raw = p.name || p.nombre || 'Lugar', generic = GENERIC[raw.toLowerCase()];
    const near = generic ? landmarkNear(f) : null;
    const kind = p.etiqueta && p.etiqueta !== raw ? p.etiqueta : cat?.single || '';
    d = {
      name: generic || raw, kind: kind || 'Lugar', cat: catId, tint: cat?.tint || '#e8eaed', ink: cat?.ink || '#3c4043',
      icon: /bicicletero/i.test(raw) ? 'pedal_bike' : cat?.icon || ICON_OF[p.category] || 'location_on',
      sub: generic ? (near ? `Cerca de ${near}` : cat?.label || '') : [kind, p.edificio].filter(Boolean).join(' · ') || p.descripcion || '',
      desc: p.descripcion && norm(p.descripcion) !== norm(raw) && norm(p.descripcion) !== norm(kind) ? p.descripcion : null,
      building: p.edificio || null, generic: !!generic,
    };
  }
  described.set(f, d);
  return d;
}

function landmarkNear(f) {
  const [x, z] = toLocal(...f.geometry.coordinates);
  let best = null, bd = 160; // m
  for (const l of landmarks) {
    const [lx, lz] = toLocal(...l.geometry.coordinates), dd = Math.hypot(lx - x, lz - z);
    if (dd < bd && l !== f) { bd = dd; best = l; }
  }
  return best?.properties.name || null;
}

export const isLabel = (f) => labelIds.has(placeId(f));

// --- búsqueda ---
// Cada palabra escrita debe aparecer en el nombre, el subtítulo o la descripción. Primero los nombres exactos, los
// que empiezan con lo escrito y los que tienen todas las palabras en el nombre.
export function search(q, limit = 12) {
  const tokens = norm(q).replace(/\b(sala|edificio|usach)\b/g, ' ').split(/[\s,.;:/-]+/).filter(Boolean);
  if (!tokens.length) return [];
  const full = tokens.join(' '), wordStart = tokens.map((t) => new RegExp(`(^|[\\s(])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  const out = [];
  for (const f of searchable) {
    const d = describe(f), name = norm(d.name);
    const hay = `${name} ${norm(d.sub)} ${norm(f.properties.descripcion)}`;
    if (!tokens.every((t) => hay.includes(t))) continue;
    let score = -name.length / 100;
    if (name === full || name.replace(/\s/g, '') === full.replace(/\s/g, '')) score += 100;
    if (name.startsWith(full)) score += 50;
    if (tokens.every((t) => name.includes(t))) score += 20;
    if (wordStart.every((r) => r.test(name))) score += 10;
    out.push({ f, score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit).map((o) => o.f);
}

// Categorías que calzan con lo escrito: el comienzo de una palabra clave ("ba", "comi") o la palabra entera, también
// en plural ("baños"). "biblioteca central" no sugiere la categoría: es un lugar.
export function matchCategories(q) {
  const s = norm(q).trim();
  if (s.length < 2) return [];
  const fits = (w) => { const nw = norm(w); return nw.startsWith(s) || s === `${nw}s` || s === `${nw}es`; };
  return CATEGORIES.filter((c) => c.features?.length && (fits(c.label) || c.words.some(fits)));
}

// Lugar por nombre (enlaces compartidos ?lugar=EAO514) o por coordenadas (?punto=lon,lat)
export function findByName(name) {
  const s = norm(name).trim();
  return searchable.find((f) => norm(describe(f).name) === s || norm(f.properties.nombre || f.properties.name) === s) || null;
}
export function findAt([lon, lat]) {
  return everything.find((f) => Math.abs(f.geometry.coordinates[0] - lon) < 1e-6 && Math.abs(f.geometry.coordinates[1] - lat) < 1e-6) || null;
}

// --- edificios ---
// Las salas se agrupan por edificio; las que en los datos no tienen edificio ("Sin definir"), por el prefijo de su
// código (FDE, MIN...), con el nombre del edificio de ese prefijo si alguna sala lo tiene.
function indexBuildings(salas) {
  const prefixOf = (f) => (f.properties.nombre.match(/^[A-Z]+/) || [''])[0];
  const named = new Map(); // prefijo -> { edificio: veces }
  for (const f of salas) {
    const b = shortBuilding(f.properties.edificio);
    if (!b) continue;
    const m = named.get(prefixOf(f)) || new Map();
    m.set(f.properties.edificio, (m.get(f.properties.edificio) || 0) + 1);
    named.set(prefixOf(f), m);
  }
  const groups = new Map();
  for (const f of salas) {
    const pre = prefixOf(f);
    let full = shortBuilding(f.properties.edificio) ? f.properties.edificio : null;
    if (!full && named.has(pre)) full = [...named.get(pre)].sort((a, b) => b[1] - a[1])[0][0];
    const key = full || (pre.length && pre.length <= 4 ? pre : 'otras');
    if (!groups.has(key)) {
      groups.set(key, {
        id: key, rooms: [], named: !!full, sector: full?.match(/^S(\d+)/)?.[1] || null,
        name: full ? shortBuilding(full) : key === 'otras' ? 'Otras salas' : `Salas ${key}`,
      });
    }
    groups.get(key).rooms.push(f);
  }
  buildings.length = 0;
  for (const g of groups.values()) {
    g.rooms.sort((a, b) => (Number(a.properties.piso) || 0) - (Number(b.properties.piso) || 0) || a.properties.nombre.localeCompare(b.properties.nombre, 'es', { numeric: true }));
    const cs = g.rooms.map((r) => r.geometry.coordinates);
    g.center = [cs.reduce((s, c) => s + c[0], 0) / cs.length, cs.reduce((s, c) => s + c[1], 0) / cs.length];
    buildings.push(g);
  }
  buildings.sort((a, b) => b.named - a.named || b.rooms.length - a.rooms.length || a.name.localeCompare(b.name, 'es'));
}

// --- guardados y recientes (en este navegador) ---
export const placeId = (f) => {
  const p = f.properties || {}, c = f.geometry?.coordinates || [0, 0];
  return `${p.category || (p.nombre ? 'sala' : 'lugar')}:${p.nombre || p.name || ''}@${Number(c[0]).toFixed(6)},${Number(c[1]).toFixed(6)}`;
};
const snapshot = (f) => ({ type: 'Feature', properties: { ...f.properties }, geometry: { type: 'Point', coordinates: [...f.geometry.coordinates] } });
function createStore(key, max) {
  const subs = new Set();
  const read = () => { try { return (JSON.parse(localStorage.getItem(key)) || []).filter((f) => f?.geometry?.coordinates); } catch { return []; } };
  const write = (list) => {
    try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* modo privado */ }
    subs.forEach((fn) => fn());
  };
  const without = (f) => read().filter((x) => placeId(x) !== placeId(f));
  return {
    list: read,
    has: (f) => read().some((x) => placeId(x) === placeId(f)),
    add: (f) => write([snapshot(f), ...without(f)].slice(0, max)),
    remove: (f) => write(without(f)),
    clear: () => write([]),
    subscribe: (fn) => subs.add(fn),
  };
}
export const saved = createStore('usach-map.guardados', 100);
export const recents = createStore('usach_map_history', 15); // la misma clave que el historial de antes

// --- a pie desde la ubicación del usuario ---
// Una sola pasada de Dijkstra desde el nodo más cercano al usuario sirve para todas las distancias de la pantalla.
let graph = null, gIndex = null, field = null;
const nodeOf = new WeakMap();
export function setGraph(g) { graph = g; gIndex = graphIndex(g); field = null; }

export function walk(origin, f) {
  if (!graph || !origin || !f?.geometry) return null;
  const p = toLocal(...origin), key = `${Math.round(p[0])},${Math.round(p[1])}`;
  if (field?.key !== key) {
    const n = gIndex.nearest(p);
    field = { key, p, n, dist: n ? distancesFrom(graph, n.key) : new Map() };
  }
  if (!field.n) return null;
  const q = toLocal(...f.geometry.coordinates);
  let m = nodeOf.get(f);
  if (!m) { m = gIndex.nearest(q); nodeOf.set(f, m); }
  const d = m && field.dist.get(m.key);
  if (d == null) return null;
  const meters = Math.hypot(field.n.p[0] - field.p[0], field.n.p[1] - field.p[1]) + d + Math.hypot(m.p[0] - q[0], m.p[1] - q[1]);
  return { meters, min: walkMin(meters) };
}

export function byDistance(origin, features) {
  return features.map((f) => ({ f, w: walk(origin, f) })).sort((a, b) => (a.w?.meters ?? Infinity) - (b.w?.meters ?? Infinity));
}
