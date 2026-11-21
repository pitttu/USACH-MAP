// Interfaz de USACH-MAP 3D (estilo Google Maps 2025) sobre el motor propio (mapView).
//  - Hoja deslizable (sheet.js) con vistas: Explorar (inicio, lugar, ruta, categoría, edificio, elegir en el mapa) y
//    Tú (tu.js). La barra inferior elige Explorar o Tú; la X de cada vista vuelve a la anterior (pila `stack`).
//  - Búsqueda y planificador de rutas: página aparte (search.js). Lugares, categorías, guardados, recientes y
//    distancias a pie: places.js.
//  - Lo que muestra el mapa (pin, ruta, marcadores de categoría) sale de la vista actual (syncMap).
import { appHeight, isPanel } from './viewport.js'; // primero: su aviso de cambio de tamaño va antes que los demás
import { mapView, DEV } from './mapview.js';
import { toLocal, toLonLat } from './geo.js';
import { buildGraph, shortestPath, pathLength } from './routing.js';
import { createSheet } from './sheet.js';
import { h, fill, icon, snackbar, fmtDist, walkMin } from './ui.js';
import * as places from './places.js';
import { initSearch, openSearch, closeSearch, isSearchOpen, voiceSupported } from './search.js';
import { initTu, refreshTu, profileInfo, classesIn, nextClass } from './tu.js';
import { initFotos, renderPhotos } from './fotos.js';
import { barraCarga } from './carga.js';
import { initSugerir, sugerirLugar, lugaresComunidad } from './sugerir.js';
import { initEditar, editarLugar } from './editar.js';

// Parte superior clásica (buscador, pastillas, brújula y capas de vidrio esmerilado) o la nueva, estilo Google Maps.
// Para comparar: ?top=nuevo o ?top=clasico en la URL; para dejar una fija, cambia este valor.
const TOP_CLASICO = (new URLSearchParams(location.search).get('top') || 'clasico') !== 'nuevo';
document.documentElement.classList.toggle('top-clasico', TOP_CLASICO);
// íconos (assets/svg) y nombres de las pastillas en la versión clásica
const CLASSIC_CHIPS = {
  accesos: ['Salida', 'Entradas y Salidas'], agua: ['Agua', 'Agua'], banos: ['Wc', 'Baños'],
  impresiones: ['Impresora', 'Impresiones'], cajeros: ['atm', 'Cajeros'], comida: ['Comida', 'Comida'],
};

const CAMPUS_CENTER = [-70.685117, -33.449467];
const OVERVIEW = { center: CAMPUS_CENTER, zoom: 15.5, pitch: 0, bearing: 0, duration: 1600 };
const NEARBY = ['banos', 'agua', 'comida', 'impresiones', 'cajeros', 'accesos']; // tarjetas de "Cerca de ti"
const BUILDINGS_SHOWN = 6; // edificios en el inicio antes de "Ver todos"
const $ = (id) => document.getElementById(id);

const nav = $('bottom-nav');
const gpsButton = $('gps-button');
const layersButton = $('layers-button');
const compassButton = $('compass-button');

let graph = null;
let userLocation = null; // [lon, lat] dentro del campus (GPS o elegida en el mapa)
let manualLocation = false; // la eligió el usuario tocando el mapa: el GPS no la pisa
let gpsWatch = null;
let locateWaiters = []; // quienes esperan la ubicación (planificador, "Cerca de ti")
let currentPlace = null; // feature de la vista Lugar
let currentRoute = null; // { origin, destination, coords, meters }
let currentCategory = null;
let currentBuilding = null;
let pick = null; // { onPick } mientras se elige un punto tocando el mapa
let buildingsExpanded = false;

// --- hoja y navegación entre vistas ---
let sheet = null;
// Barra de estado del celular (app instalada, y Chrome en Android): del color de lo que hay arriba, para que se vea
// continua con la app. Una página no puede dibujar debajo de ella; lo más parecido es pintarla del color del suelo del
// mapa (medido en pantalla), blanca con la hoja arriba o la búsqueda abierta, negra en el visor de fotos y oscurecida
// con el velo de "Agregar foto".
const statusBar = document.querySelector('meta[name="theme-color"]');
const BAR = { mapa: '#fee5c8', blanco: '#ffffff', fotos: '#000000', velo: '#8f8376' };
function syncStatusBar() {
  const c = !$('photo-viewer').hidden ? BAR.fotos : !$('photo-upload').hidden || !$('poi-suggest').hidden || !$('place-edit-dialog').hidden ? BAR.velo
    : !$('search-page').hidden || sheet?.state === 'FULL' ? BAR.blanco : BAR.mapa;
  if (statusBar.content !== c) statusBar.content = c;
}
// (antes de crear la hoja: la hoja avisa su estado apenas se crea)
new MutationObserver(syncStatusBar).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
sheet = createSheet($('bottom-sheet'), { navEl: nav, onChange: (state, view) => { syncNav(view); syncStatusBar(); }, onMove: (y) => syncPadding(y) });


// Con un lugar, un edificio o una categoría abiertos, el mapa mantiene lo enfocado al medio de lo que se ve: con la
// hoja en reposo, al centro de la pantalla; a media altura, al medio del espacio entre el borde de arriba y la hoja;
// entre ambas se interpola, así el mapa baja o sube suave junto con la hoja. Más arriba se queda como a media altura.
// En el resto (inicio, Tú, rutas) mover la hoja no mueve el mapa. Al abrir o cerrar una de esas vistas el ajuste entra
// o sale con una transición, sin saltos.
const PADDED_VIEWS = new Set(['place', 'building', 'category']);
// En iPad y computador (panel a la izquierda) el ajuste es hacia el lado: lo enfocado queda al medio del mapa que se
// ve a la derecha del panel (padNow es entonces el ancho tapado a la izquierda; con el panel plegado, nada).
let padNow = 0, padActive = false, padTween = null;
function setPad(v) { padNow = v; if (isPanel()) mapView.setPadding(0, v); else mapView.setPadding(v); }
const panelRight = () => $('bottom-sheet').getBoundingClientRect().right;
function syncPadding(y) {
  if (!sheet) return; // primer aviso, mientras se crea la hoja
  const active = PADDED_VIEWS.has(sheet.view);
  if (isPanel()) {
    const rest = sheet.snapY('REST'), full = sheet.snapY('MID');
    const t = rest - full > 1 ? Math.min(1, Math.max(0, (rest - y) / (rest - full))) : 1;
    const target = panelRight() * t; // en el panel, en todas las vistas: el mapa se centra en lo que queda a la derecha
    if (!padActive) { padActive = true; tweenPad(target); return; }
    if (padTween) padTween.to = target; else setPad(target);
    return;
  }
  const rest = sheet.snapY('REST'), mid = sheet.snapY('MID');
  const t = rest - mid > 1 ? Math.min(1, Math.max(0, (rest - y) / (rest - mid))) : 0;
  const target = active ? (appHeight() - mid) * t : 0;
  if (active !== padActive) { padActive = active; tweenPad(target); return; }
  if (padTween) padTween.to = target; // la transición sigue a la hoja mientras dura
  else setPad(target);
}
function tweenPad(to) {
  if (padTween) cancelAnimationFrame(padTween.raf);
  const from = padNow, t0 = performance.now();
  padTween = { to, raf: 0 };
  const step = (now) => {
    const k = Math.min(1, (now - t0) / 380), e = 1 - (1 - k) ** 3;
    setPad(from + (padTween.to - from) * e);
    if (k < 1) padTween.raf = requestAnimationFrame(step);
    else padTween = null;
  };
  padTween.raf = requestAnimationFrame(step);
}
let stack = []; // [{ view, state }]: adónde vuelve la X
let exploreSaved = null; // Explorar tal como estaba al pasar a Tú

// abre una vista; si push, la X vuelve a la actual
function go(view, state, { push = true } = {}) {
  if (push && sheet.view !== view) stack.push({ view: sheet.view, state: sheet.state });
  sheet.show(view, state);
  syncMap();
}
function back() {
  const prev = stack.pop() || { view: 'home', state: 'REST' };
  sheet.show(prev.view, prev.state === 'FULL' ? 'MID' : prev.state);
  if (prev.view === 'home') renderHome();
  if (prev.view === 'tu') refreshTu();
  syncMap();
}
function goHome() {
  stack = [];
  exploreSaved = null;
  sheet.show('home', 'REST');
  renderHome();
  syncMap();
}

// pestaña de la barra a la que pertenece cada vista (Créditos se abre desde Más)
// (al elegir un punto en el mapa, la de la vista desde donde se pidió)
function tabOf(view) { return view === 'pick' && stack.length ? tabOf(stack.at(-1).view) : view === 'tu' ? 'tu' : ['mas', 'creditos'].includes(view) ? 'mas' : 'explorar'; }
function showTab(tab) {
  if (sheet.view === 'pick') back(); // la elección se cancela: lo que se guarda es lo que había debajo
  const now = tabOf(sheet.view);
  if (tab === now) { // ya en esa pestaña: la abre (o vuelve a su inicio, p. ej. de Créditos a Más)
    if (tab === 'explorar') return;
    if (sheet.view !== tab) { stack = []; sheet.show(tab, 'MID'); } else if (sheet.state === 'REST') sheet.open('MID');
    syncMap();
    return;
  }
  if (now === 'explorar') exploreSaved = { view: sheet.view, state: sheet.state, stack };
  stack = [];
  if (tab === 'explorar') {
    const r = exploreSaved || { view: 'home', state: 'REST', stack: [] };
    exploreSaved = null;
    stack = r.stack;
    sheet.show(r.view, r.state);
    if (r.view === 'home') renderHome();
    if (r.view === 'category') renderCategory(); // pudo cambiar la ubicación mientras estaba guardada
  } else {
    if (tab === 'tu') refreshTu();
    if (tab === 'mas') renderMas();
    sheet.show(tab, 'MID');
  }
  syncMap();
}
for (const b of nav.querySelectorAll('.nav-item')) b.addEventListener('click', () => showTab(b.dataset.tab));

function syncNav(view) {
  const tab = tabOf(view);
  for (const b of nav.querySelectorAll('.nav-item')) {
    b.classList.toggle('active', b.dataset.tab === tab);
    b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  }
}

// El mapa sigue a la vista: pin en el lugar abierto o en el destino de la ruta, la línea de la ruta, y los
// marcadores de la categoría mientras su lista (o un lugar abierto desde ella) está en pantalla.
let shownPin = null;
function syncMap() {
  const v = sheet.view;
  // se elige un punto solo con su vista en pantalla; salir por donde sea cancela la elección (el toque en el mapa la
  // retira antes de volver, así que no pasa por aquí) y, si se pedía la ubicación, quien la espera recibe null
  if (pick && v !== 'pick') {
    const { asksLocation } = pick;
    pick = null;
    if (asksLocation) resolveLocation(null);
  }
  const pinAt = v === 'place' ? currentPlace?.geometry.coordinates : v === 'route' ? currentRoute?.destination.coords : null;
  const key = pinAt ? pinAt.join(',') : null;
  if (key !== shownPin) { mapView.setPin(pinAt || null); shownPin = key; }
  mapView.setSelected(v === 'place' && currentPlace && places.isLabel(currentPlace) ? currentPlace.properties.id ?? null : null);
  mapView.setRoute(v === 'route' && currentRoute ? currentRoute.coords : null);
  // la categoría sigue viva mientras su lista esté en pantalla, detrás de un lugar o guardada al pasar a Tú (aunque
  // desde Tú se abra un lugar); sus marcadores y su pastilla solo se ven si no está guardada
  const inCat = (s) => s.view === 'category';
  const shown = v === 'category' || stack.some(inCat);
  if (!shown && !(exploreSaved && (inCat(exploreSaved) || exploreSaved.stack.some(inCat)))) currentCategory = null;
  mapView.showCategory(shown && currentCategory?.marker || null);
  // las categorías sin pastilla no tienen marcadores propios: se destacan sus etiquetas (ícono desde lejos)
  mapView.emphasizePOIs(shown && currentCategory && !currentCategory.marker ? currentCategory.features : null);
  for (const c of $('chips').children) c.classList.toggle('active', shown && !!currentCategory && c.dataset.cat === currentCategory.id);
}

// --- carga ---
const DATA_FILES = {
  salas: 'salas', sectores: 'SectoresColores', paths: 'paths', accesos: 'Accesos', banos: 'banos', metro: 'metro',
  impresiones: 'impresiones', misc: 'Sep-misc', fixed: 'FixedMisc', dispensadores: 'dispensadores', cajeros: 'cajeros',
};

// cada lugar de la comunidad va con los de su tipo (baños, agua, cajeros e impresiones tienen sus propios datos)
function sumarComunidad(data, features) {
  const DESTINO = { 'baño': 'banos', dispensador: 'dispensadores', cajero: 'cajeros', impresiones: 'impresiones' };
  for (const f of features) {
    const p = f.properties || {}, destino = DESTINO[p.category] || 'misc';
    if (p.category === 'impresiones') Object.assign(p, { category: 'servicios', type: 'impresiones' });
    if (p.category === 'otro') delete p.category;
    data[destino].features.push(f);
  }
}

async function init() {
  const data = {}, barra = barraCarga($('carga')), archivos = Object.keys(DATA_FILES).length;
  let leidos = 0;
  const dataP = Promise.all(Object.entries(DATA_FILES).map(async ([k, f]) => {
    data[k] = await (await fetch(`assets/data/${f}.json`)).json();
    barra.parte('datos', ++leidos / archivos);
  }));
  const comunidadP = lugaresComunidad(); // lugares sugeridos y publicados (fotos-worker); sin ellos si no responde
  await Promise.all([mapView.load((v) => barra.parte('mapa', v)).then(() => barra.parte('escena', 1)), dataP]);
  sumarComunidad(data, await comunidadP);

  graph = buildGraph(data.paths);
  places.indexPlaces(data);
  places.setGraph(graph);

  mapView.setSectors(data.sectores);
  mapView.addPOIs(data.metro.features, 'metro');
  mapView.addPOIs(data.fixed.features, 'fixed');
  mapView.addPOIs(data.misc.features.filter((f) => !f.properties.sinEtiqueta), 'misc'); // sin rótulo: kioscos, contenedores, interior de la FAE
  // marcadores por categoría (ocultos hasta abrir su lista)
  for (const c of places.CATEGORIES) if (c.marker) mapView.addCategoryMarkers(c.marker, c.features, c.marker);

  initTu({
    salas: data.salas.features,
    metros: data.metro.features,
    findPath: (a, b) => findShortestPath(a, b),
    showRoom: (f) => openPlace(f),
    showPlace: (f) => openPlace(f),
    routeTo: (f) => routeToPlace(f),
    routeBetween: (a, b) => drawRoute(stopOf(a), stopOf(b)),
    toast: (msg, error) => snackbar(msg, { error }),
    expand: () => { if (sheet.view === 'tu' && sheet.state !== 'FULL') sheet.open('FULL'); },
    onProfile: () => { renderAvatar(); if (sheet.view === 'home') renderHome(); },
  });
  initSearch({
    pickPlace: (f) => openPlace(f),
    pickCategory: (c) => openCategory(c),
    route: (o, d) => drawRoute(o, d),
    userLocation: () => userLocation,
    locate,
    pickOnMap: (field, stops) => pickRouteStop(field, stops),
    shortcuts: searchShortcuts,
    walk: (f) => userLocation && places.walk(userLocation, f),
  });

  renderChips();
  renderAvatar();
  renderHome();
  refreshWeather();
  await barra.completar(); // la barra termina de llenarse (acelerando) y recién ahí se abren las nubes
  llegada();
  openSharedLink();
}

// --- llegada: la cámara baja desde lo alto atravesando las nubes de la pantalla de carga hasta la vista inicial ---
// (con "reducir movimiento", el acercamiento corto de antes). La vista final no cambia: zoom 15.5, pitch 45, bearing -20.
const VISTA_INICIAL = { center: CAMPUS_CENTER, zoom: 15.5, pitch: 45, bearing: -20 }, ALTO_LLEGADA = 7000, DURACION_LLEGADA = 3400; // m de cámara al partir, ms de bajada
function llegada() {
  const loader = $('loader-overlay');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    loader.classList.add('hidden-loader');
    mapView.jumpTo({ center: CAMPUS_CENTER, zoom: 14.6 });
    mapView.flyTo({ ...VISTA_INICIAL, duration: 2200 });
    return;
  }
  mapView.setMaxDist(ALTO_LLEGADA);
  mapView.jumpTo({ center: CAMPUS_CENTER, zoom: 10, pitch: 0, bearing: 0 }); // sobre las nubes, mirando abajo
  // cada nube sale hacia su borde de la pantalla: más lejos cuanto más cerca está de la cámara
  for (const n of loader.querySelectorAll('.nube')) {
    const x = parseFloat(n.style.getPropertyValue('--x')) - 50, y = parseFloat(n.style.getPropertyValue('--y')) - 50;
    const prof = parseFloat(n.style.getPropertyValue('--prof')), r = Math.hypot(x, y) || 1, k = 0.9 * (0.6 + prof * 0.5);
    n.style.setProperty('--sx', `${(x / r) * k * innerWidth * 0.6}px`);
    n.style.setProperty('--sy', `${(y / r) * k * innerHeight * 0.6}px`);
    n.style.transitionDuration = `${3.2 - prof * 0.45}s, ${2.8 - prof * 0.4}s`;
  }
  // dos cuadros para que el mapa ya esté dibujado detrás del cielo antes de empezar
  requestAnimationFrame(() => requestAnimationFrame(() => {
    loader.classList.add('llegando');
    mapView.flyTo({ ...VISTA_INICIAL, duration: DURACION_LLEGADA });
    // Durante la bajada el mapa se puede tocar (quien ya conoce la app hace zoom apenas carga): un toque corta la
    // bajada y la cámara se queda donde el usuario la deja mientras tenga el dedo encima; al soltar, si quedó más alta
    // que el límite normal (MAX_DIST), sigue bajando suave hasta él, sobre el lugar adonde la movió.
    setTimeout(() => loader.classList.add('hidden-loader'), DURACION_LLEGADA + 50);
    let fin = 0;
    const terminar = () => { if (llegandoActiva && mapView.dist <= mapView.maxDistNormal + 1) { llegandoActiva = false; mapView.setMaxDist(); } }; // si sigue alta, espera a que suelte
    const alSoltar = () => {
      if (!llegandoActiva) return;
      clearTimeout(fin);
      const ms = mapView.bajarAlLimite({ pitch: VISTA_INICIAL.pitch });
      fin = setTimeout(terminar, ms + 50);
    };
    llegandoActiva = true;
    mapView.on('release', alSoltar);
    fin = setTimeout(terminar, DURACION_LLEGADA + 50); // sin tocar: termina con la bajada
  }));
}
let llegandoActiva = false;
// Safari (iPad) ignora user-scalable=no: un pellizco fuera del mapa haría zoom a toda la página y la dejaría descuadrada
for (const ev of ['gesturestart', 'gesturechange']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });

// --- mapa ---
mapView.on('tap', ({ lngLat, poi, marker }) => {
  const hit = poi || marker;
  if (pick) {
    const coords = hit ? hit.feature.geometry.coordinates : lngLat;
    if (!coords) return;
    const p = pick;
    pick = null;
    back();
    p.onPick(coords, hit ? places.describe(hit.feature).name : null);
    return;
  }
  if (hit) { openPlace(hit.feature); return; }
  if (!lngLat) return;
  // tocar el mapa baja la hoja para verlo; un lugar o una ruta abiertos no se cierran (se cierran con la X)
  if (['home', 'tu', 'mas', 'creditos', 'category', 'building'].includes(sheet.view)) { if (sheet.state !== 'REST') sheet.open('REST'); }
  else if (sheet.state === 'FULL') sheet.open('MID');
});

// mantener presionado: un punto cualquiera del mapa
mapView.on('longpress', ({ lngLat }) => {
  openPlace({ type: 'Feature', properties: { custom: true, nombre: 'Ubicación seleccionada' }, geometry: { type: 'Point', coordinates: lngLat } }, { record: false });
});

mapView.on('move', ({ bearing }) => compassButton.style.setProperty('--bearing', `${-bearing}deg`));
compassButton.addEventListener('click', () => mapView.resetNorth());

// --- buscador, avatar, pastillas ---
$('search-open').addEventListener('click', () => openSearch({ mode: 'place' }));
$('search-voice').hidden = !voiceSupported;
$('search-voice').addEventListener('click', () => openSearch({ mode: 'place', voice: true }));
$('avatar-button').addEventListener('click', () => showTab('tu'));

function renderAvatar() {
  const p = profileInfo(), el = $('avatar');
  el.classList.toggle('initials', !!p);
  fill(el, p ? p.initials : icon('person'));
  $('avatar-button').setAttribute('aria-label', p ? `Tú: ${p.name}` : 'Tú: tu horario y tus lugares');
}

function renderChips() {
  const chipIcon = (c) => (TOP_CLASICO
    ? h('span', { class: 'chip-icon', style: `--mask:url('assets/svg/${CLASSIC_CHIPS[c.id][0]}.svg')` })
    : icon(c.icon));
  const dots = () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'chip-dots');
    svg.innerHTML = '<circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>';
    return svg;
  };
  fill($('chips'),
    places.CATEGORIES.filter((c) => c.marker).map((c) => h('button', { class: 'chip', type: 'button', 'data-cat': c.id, onclick: () => openCategory(c) },
      chipIcon(c), TOP_CLASICO ? CLASSIC_CHIPS[c.id][1] : c.label)),
    h('button', { class: 'chip', type: 'button', onclick: openMore }, TOP_CLASICO ? dots() : icon('more_horiz'), 'Más'));
  alignMapButtons();
}

// "Más": el inicio arriba, en las categorías
function openMore() {
  if (sheet.view !== 'home') goHome();
  sheet.open('FULL');
  requestAnimationFrame(() => {
    const body = sheet.body(), t = $('home-cats-title');
    body.scrollTo({ top: t.offsetTop - body.offsetTop - 4, behavior: 'smooth' });
  });
}

// capas y luego brújula bajo las pastillas, a 12 px de ellas y 10 px entre sí. Miden 40 px; en la parte superior
// clásica, el alto de las pastillas
function alignMapButtons() {
  const chip = $('chips').firstElementChild?.getBoundingClientRect();
  if (!chip) return;
  const size = TOP_CLASICO ? chip.height : 40, top = chip.bottom + 12;
  for (const b of [layersButton, compassButton]) b.style.setProperty('--btn', `${size}px`);
  layersButton.style.top = `${top}px`;
  compassButton.style.top = `${top + size + 10}px`;
}
window.addEventListener('resize', alignMapButtons);
document.fonts?.ready.then(alignMapButtons);

// --- inicio (Explorar) ---
function renderHome() {
  const d = new Date(), date = d.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' });
  const hr = d.getHours(), p = profileInfo();
  $('home-title').textContent = date.charAt(0).toUpperCase() + date.slice(1);
  $('home-sub').textContent = `${hr >= 5 && hr < 12 ? 'Buenos días' : hr >= 12 && hr < 20 ? 'Buenas tardes' : 'Buenas noches'}${p && !p.demo ? `, ${p.first}` : ''}`;
  fill($('home-promo'), !p && h('button', { class: 'promo', type: 'button', onclick: () => showTab('tu') },
    h('span', { class: 'row-icon' }, icon('calendar_month')),
    h('span', { class: 'grow' }, h('b', {}, 'Tu horario en el mapa'), h('span', {}, 'Importa tus clases desde SIAC y mira cómo llegar a cada sala')),
    icon('chevron_right', { cls: 'arrow' })));
  renderNearby();
  fill($('home-cats'), places.CATEGORIES.filter((c) => c.features?.length).map((c) => h('button', { class: 'cat-tile', type: 'button', onclick: () => openCategory(c) },
    h('span', { class: 'cat-circle', style: `--tint:${c.tint};--ink:${c.ink}` }, icon(c.icon)),
    h('span', { class: 'cat-label' }, c.label))));
  renderBuildings();
}

function renderNearby() {
  const box = $('home-nearby');
  if (!userLocation) {
    fill(box, h('div', { class: 'nearby-empty' },
      h('span', { class: 'row-icon', style: '--tint:#d3e3fd;--ink:#1a73e8' }, icon('my_location')),
      h('p', {}, h('b', {}, 'Lo más cercano a ti'), 'Activa tu ubicación para ver el baño, el agua o la comida más cerca.'),
      h('button', { class: 'btn btn-tonal', type: 'button', onclick: () => locate() }, 'Activar')));
    return;
  }
  fill(box, NEARBY.map((id) => {
    const c = places.CAT[id], best = places.byDistance(userLocation, c.features)[0];
    if (!best?.w) return null;
    const d = places.describe(best.f);
    return h('button', { class: 'nearby-card', type: 'button', style: `--tint:${c.tint};--ink:${c.ink}`, onclick: () => openPlace(best.f) },
      h('span', { class: 'nb-icon' }, icon(c.icon)),
      h('span', { class: 'nb-title' }, c.single),
      h('span', { class: 'nb-sub' }, d.generic ? d.sub : d.name),
      h('span', { class: 'nb-walk' }, icon('directions_walk'), `${best.w.min} min · ${fmtDist(best.w.meters)}`));
  }));
}

function renderBuildings() {
  const all = places.buildings, list = buildingsExpanded ? all : all.slice(0, BUILDINGS_SHOWN);
  fill($('home-buildings'), list.map((b) => h('button', { class: 'list-row', type: 'button', onclick: () => openBuilding(b) },
    h('span', { class: 'row-icon', style: '--tint:#d3f7ff;--ink:#014f5a' }, icon('apartment')),
    h('span', { class: 'row-text' }, h('span', { class: 'row-title' }, b.name), h('span', { class: 'row-sub' }, buildingSub(b))),
    icon('chevron_right', { cls: 'row-trail' }))));
  const more = $('home-buildings-more');
  more.hidden = all.length <= BUILDINGS_SHOWN;
  more.textContent = buildingsExpanded ? 'Ver menos' : `Ver todos los edificios (${all.length})`;
}
$('home-buildings-more').addEventListener('click', () => { buildingsExpanded = !buildingsExpanded; renderBuildings(); });
const buildingSub = (b) => [`${b.rooms.length} ${b.rooms.length === 1 ? 'sala' : 'salas'}`, b.sector && `Sector ${b.sector}`].filter(Boolean).join(' · ');

// --- lugar ---
const stopOf = (f) => ({ name: places.describe(f).name, coords: f.geometry.coordinates, feature: f });
const myStop = () => ({ name: 'Tu ubicación', coords: userLocation, gps: true });

function openPlace(f, { fly = true, record = true } = {}) {
  closeSearch();
  currentPlace = f;
  if (record && !f.properties.custom) places.recents.add(f);
  renderPlace();
  renderPhotos(f, places.describe(f));
  // desde otro lugar o una ruta, la X vuelve a lo de antes (la lista, Tú o el inicio), no al lugar anterior
  go('place', 'MID', { push: !['place', 'route', 'pick'].includes(sheet.view) });
  if (fly) mapView.flyTo({ center: f.geometry.coordinates, zoom: 19, pitch: 45, duration: 1600 });
}

function renderPlace() {
  const f = currentPlace, d = places.describe(f), p = f.properties;
  $('place-title').textContent = d.name;
  $('place-sub').textContent = d.sub;
  const w = userLocation && places.walk(userLocation, f);
  const walkEl = $('place-walk');
  walkEl.hidden = !w;
  if (w) fill(walkEl, icon('directions_walk'), h('b', {}, `${w.min} min`), ` a pie · ${fmtDist(w.meters)}`);
  const isSaved = places.saved.has(f), saveBtn = $('place-save');
  saveBtn.hidden = !!p.custom;
  $('place-edit').hidden = !!p.custom; // un punto cualquiera del mapa no es un lugar que corregir
  saveBtn.setAttribute('aria-pressed', String(isSaved));
  fill(saveBtn, icon('bookmark', { filled: isSaved }), isSaved ? 'Guardado' : 'Guardar');

  const rows = [];
  const row = (ic, text, small) => h('div', { class: 'info-row' }, icon(ic), h('span', {}, text, small && h('small', {}, small)));
  if (p.custom) {
    const [lon, lat] = f.geometry.coordinates, txt = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
    rows.push(h('button', { class: 'info-row', type: 'button', onclick: () => copy(txt, 'Coordenadas copiadas') }, icon('location_on'), h('span', {}, txt, h('small', {}, 'Toca para copiar las coordenadas'))));
  }
  if (d.sala) {
    if (d.kind !== 'Sala') rows.push(row(d.icon, d.kind, 'Tipo de sala'));
    if (d.building) rows.push(row('apartment', d.building, p.edificio?.match(/^S(\d+)/) ? `Sector ${p.edificio.match(/^S(\d+)/)[1]}` : null));
    if (d.floor) rows.push(row('stairs', d.floor < 0 ? 'Subterráneo' : `Piso ${d.floor}`));
    if (d.capacity) rows.push(row('groups', `${d.capacity} personas`, 'Capacidad'));
    for (const c of classesIn(d.name)) {
      rows.push(h('div', { class: 'info-row class-row', style: `--c:${c.color}` }, icon('school'), h('span', {}, `Tu clase: ${c.name}`, h('small', {}, `${c.when} · ${c.type}`))));
    }
  } else if (!p.custom) {
    if (d.desc) rows.push(row('info', d.desc));
    if (p.comunidad) rows.push(row('volunteer_activism', 'Sugerido por la comunidad'));
    if (d.building) rows.push(row('apartment', d.building));
  }
  fill($('place-info'), rows);
}

initFotos(); // carrusel, visor y "Agregar foto" (js/fotos.js)
initEditar({ elegirPunto: (onPick, center) => startPick('Toca dónde está realmente', 'El lugar se mueve a ese punto', (coords) => onPick(coords), false, { center }) });
initSugerir({ elegirPunto: (onPick) => startPick('Toca dónde está el lugar', 'Luego le pones nombre y categoría', (coords) => onPick(coords)) });

// --- Más: enlaces de la Universidad, aportar, la app y créditos ---
const REPO = 'https://github.com/pitttu/USACH-MAP';
const SIAC_URL = 'https://baker.usach.cl/siacusach2';
const instalada = () => matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone === true;
let installPrompt = null; // Chrome y Edge: el aviso de instalar, guardado para mostrarlo al tocar "Instalar la app"
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; if (sheet?.view === 'mas') renderMas(); });
addEventListener('appinstalled', () => { installPrompt = null; if (sheet?.view === 'mas') renderMas(); });
async function instalar() {
  if (installPrompt) { installPrompt.prompt(); await installPrompt.userChoice.catch(() => {}); installPrompt = null; renderMas(); return; }
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  snackbar(ios ? 'En Safari, toca Compartir y luego "Agregar a inicio"' : 'En el menú del navegador, elige "Instalar app" o "Agregar a la pantalla principal"', { duration: 7000 });
}
async function compartirApp() {
  const url = new URL(location.href); url.search = ''; url.hash = '';
  if (navigator.share) { try { await navigator.share({ title: 'Mapa USACH', text: 'El mapa 3D del campus de la USACH: salas, rutas a pie y tu horario.', url: url.href }); } catch { /* lo canceló */ } return; }
  copy(url.href, 'Enlace copiado');
}
let versionMapa = '';
fetch('assets/versiones.json', { cache: 'no-store' }).then((r) => r.json()).then((v) => { versionMapa = v['campus.glb'] || ''; }).catch(() => {});

function renderMas() {
  // fila: ícono, título, subtítulo; abre un enlace (pestaña nueva) o hace algo
  const row = (ic, title, sub, act, tint) => {
    const link = typeof act === 'string', kids = [
      h('span', { class: 'row-icon', style: tint ? `--tint:${tint[0]};--ink:${tint[1]}` : null }, icon(ic)),
      h('span', { class: 'row-text' }, h('span', { class: 'row-title' }, title), sub && h('span', { class: 'row-sub' }, sub)),
      icon(link ? 'open_in_new' : 'chevron_right', { cls: 'row-trail' })];
    return link ? h('a', { class: 'list-row', href: act, target: '_blank', rel: 'noopener' }, ...kids) : h('button', { class: 'list-row', type: 'button', onclick: act }, ...kids);
  };
  const section = (title, ...rows) => [h('h3', { class: 'section-title' }, title), h('div', { class: 'list divided mas-list' }, ...rows)];
  const tieneHorario = !!profileInfo();
  fill($('mas-body'),
    section('Universidad',
      row('school', 'Entrar a SIAC', 'Notas, inscripción de ramos y más', SIAC_URL, ['#e1e5fb', '#3949ab']),
      row('calendar_month', tieneHorario ? 'Tu horario en el mapa' : 'Importar tu horario', tieneHorario ? 'Tus clases y cómo llegar' : 'Trae tus clases desde SIAC', () => showTab('tu'), ['#c4e9ed', '#00626e']),
      row('language', 'Sitio de la USACH', 'usach.cl', 'https://www.usach.cl', ['#fef7e0', '#9a5b00'])),
    h('div', { class: 'band' }),
    section('Aporta',
      row('add_location_alt', 'Sugerir un lugar', 'Algo que falta en el mapa; se revisa antes de publicarlo', () => sugerirLugar(), ['#fce8e6', '#c5221f']),
      row('bug_report', 'Reportar un problema', 'Un error en el mapa o en la app (GitHub)', `${REPO}/issues/new`, ['#ebe1fb', '#5b3f9a'])),
    h('div', { class: 'band' }),
    section('La app',
      !instalada() && row('install_mobile', 'Instalar la app', 'Ábrela desde tu pantalla de inicio, también sin conexión', instalar, ['#cdefd6', '#0d652d']),
      row('share', 'Compartir la app', 'Mándasela a alguien', compartirApp),
      row('code', 'Código en GitHub', 'Proyecto abierto: míralo o colabora', REPO),
      row('volunteer_activism', 'Créditos', 'Datos, fotos y herramientas', () => { renderCreditos(); go('creditos', 'MID'); }),
      row('policy', 'Privacidad', 'Qué datos se usan y dónde quedan', 'privacidad.html'),
      row('photo_library', 'Condiciones de las fotos', 'Al subir fotos de los lugares', 'condiciones-fotos.html')),
    h('p', { class: 'mas-foot' }, 'Mapa USACH', versionMapa && ` · versión del mapa ${versionMapa.slice(0, 7)}`));
}

function renderCreditos() {
  const a = (href, text) => h('a', { href, target: '_blank', rel: 'noopener' }, text);
  const item = (title, ...body) => h('div', { class: 'credito' }, h('b', {}, title), h('span', {}, ...body));
  fill($('creditos-body'), h('div', { class: 'creditos' },
    item('Mapa USACH', 'Hecho por Pitu. Código abierto en ', a(REPO, 'GitHub'), '.'),
    item('Calles, caminos y áreas verdes', '© colaboradores de ', a('https://www.openstreetmap.org/copyright', 'OpenStreetMap'), ', con licencia ODbL.'),
    item('Salas, servicios y edificios en 3D', 'Levantamiento propio; los modelos 3D y la fotogrametría del campus se usan con licencia de su autor.'),
    item('Clima', 'Datos de ', a('https://open-meteo.com/', 'Open-Meteo.com'), ' (CC BY 4.0).'),
    item('Fotos de los lugares', 'De ', a('https://commons.wikimedia.org/', 'Wikimedia Commons'), ' (cada foto muestra su autor y su licencia) y de la comunidad USACH (', a('https://creativecommons.org/licenses/by-nc-sa/4.0/deed.es', 'CC BY-NC-SA 4.0'), ').'),
    item('Motor 3D', a('https://threejs.org/', 'three.js'), ' (licencia MIT).'),
    item('Tipografías e íconos', 'Google Sans Flex e Inter (SIL Open Font License); íconos Material Symbols de Google (Apache 2.0).'),
    item('Logos', 'Los de Metro de Santiago y EFE son marcas de sus dueños.'),
    item('Comunidad', 'Gracias a quienes sugieren lugares, suben fotos y reportan errores.')));
}
$('creditos-close').addEventListener('click', back);
$('place-close').addEventListener('click', back);
$('place-go').addEventListener('click', () => routeToPlace(currentPlace));
$('place-save').addEventListener('click', () => {
  const f = currentPlace, was = places.saved.has(f);
  if (was) places.saved.remove(f); else places.saved.add(f);
  renderPlace();
  snackbar(was ? 'Quitado de guardados' : 'Guardado en Tú', was ? {} : { action: { label: 'Ver', fn: () => showTab('tu') } });
});
$('place-share').addEventListener('click', () => sharePlace(currentPlace));
$('place-edit').addEventListener('click', () => editarLugar(currentPlace, places.describe(currentPlace)));

// Cómo llegar: desde tu ubicación si se conoce; si no, el planificador con el destino puesto
function routeToPlace(f) {
  if (userLocation) drawRoute(myStop(), stopOf(f));
  else openSearch({ mode: 'route', destination: stopOf(f), focus: 'origin' });
}

// Compartir: un enlace que abre la app con el lugar (?lugar=EAO514) o el punto (?punto=lon,lat)
async function sharePlace(f) {
  const d = places.describe(f), url = new URL(location.href);
  url.search = '';
  url.hash = '';
  if (f.properties.custom || d.generic) url.searchParams.set('punto', f.geometry.coordinates.map((v) => v.toFixed(6)).join(','));
  else url.searchParams.set('lugar', d.name);
  const text = `${d.name}${d.sub ? ` · ${d.sub}` : ''}`;
  if (navigator.share) {
    try { await navigator.share({ title: d.name, text, url: url.href }); } catch { /* lo canceló */ }
    return;
  }
  copy(url.href, 'Enlace copiado');
}
// Copiar al portapapeles. navigator.clipboard solo existe en sitios seguros (https): en el servidor local por http
// (p. ej. el iPad en 192.168.x.x) no está, y Safari además lo rechaza si se llama después de un await. Por eso primero
// se intenta el método clásico, sincrónico dentro del toque (un campo de texto oculto + execCommand('copy'), que en
// iOS necesita contentEditable y setSelectionRange); si no resulta, navigator.clipboard; y si tampoco, se muestra el
// texto para copiarlo a mano.
function copiarClasico(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.contentEditable = 'true';
  ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px'; // 16px: iOS no hace zoom
  document.body.append(ta);
  const sel = getSelection(), prev = sel.rangeCount ? sel.getRangeAt(0) : null, r = document.createRange();
  r.selectNodeContents(ta); sel.removeAllRanges(); sel.addRange(r);
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove(); sel.removeAllRanges(); if (prev) sel.addRange(prev);
  return ok;
}
async function copy(text, done) {
  if (copiarClasico(text)) { snackbar(done); return; }
  try { await navigator.clipboard.writeText(text); snackbar(done); } catch { snackbar(text, { duration: 8000 }); }
}

function openSharedLink() {
  const q = new URLSearchParams(location.search), lugar = q.get('lugar'), punto = q.get('punto');
  let f = null;
  if (lugar) f = places.findByName(lugar);
  else if (punto) {
    const c = punto.split(',').map(Number);
    if (c.length === 2 && c.every(Number.isFinite)) f = places.findAt(c) || { type: 'Feature', properties: { custom: true, nombre: 'Ubicación compartida' }, geometry: { type: 'Point', coordinates: c } };
  }
  if (f) setTimeout(() => openPlace(f, { record: false }), 900);
  else if (lugar) snackbar(`No encontramos «${lugar}» en el mapa.`, { error: true });
}

// --- ruta ---
// el grafo trabaja en metros locales; la UI, en [lon, lat]
function findShortestPath(start, end) {
  if (!graph) return null;
  const path = shortestPath(graph, toLocal(...start), toLocal(...end));
  return path && { coords: path.map(([x, z]) => toLonLat(x, z)), meters: pathLength(path) };
}

function drawRoute(origin, destination) {
  const path = findShortestPath(origin.coords, destination.coords);
  if (!path) { snackbar('No encontramos una ruta a pie entre esos puntos.', { error: true }); return false; }
  closeSearch();
  currentRoute = { origin, destination, coords: path.coords, meters: path.meters };
  const min = walkMin(path.meters), eta = new Date(Date.now() + min * 60000);
  $('route-min').textContent = `${min} min`;
  $('route-dist').textContent = `(${fmtDist(path.meters)})`;
  $('route-eta').textContent = `A pie · llegas a las ${eta.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}`;
  $('route-from-name').textContent = origin.name;
  $('route-to-name').textContent = destination.name;
  $('route-pace').textContent = '4 km/h, sin contar escaleras ni ascensores';
  // desde un lugar, la X vuelve a él; otra ruta o elegir en el mapa se reemplazan
  go('route', 'REST', { push: !['route', 'pick'].includes(sheet.view) });
  fitRoute(path.coords);
  return true;
}
$('route-close').addEventListener('click', back);
$('route-swap').addEventListener('click', () => currentRoute && drawRoute(currentRoute.destination, currentRoute.origin));
$('route-from').addEventListener('click', () => openSearch({ mode: 'route', origin: currentRoute.origin, destination: currentRoute.destination, focus: 'origin' }));
$('route-to').addEventListener('click', () => openSearch({ mode: 'route', origin: currentRoute.origin, destination: currentRoute.destination, focus: 'destination' }));

// Encuadra la ruta en vista cenital dentro del mapa que queda libre entre el buscador (y las pastillas) y la hoja
function fitRoute(coords) {
  const pts = coords.map((c) => toLocal(...c));
  const vh = appHeight(), pad = 56; // margen para el pin y el ancho de la línea
  frame(pts, { bottom: isPanel() ? vh - pad : sheet.snapY('REST') - pad / 2, focusY: vh / 2, pad });
}

// Encuadra puntos locales [x, z] en el hueco libre entre las pastillas y `bottom`. focusY: dónde cae en pantalla el
// centro del mapa (si queda fuera del medio del hueco, se corre la cámara para que los puntos caigan en él).
function frame(pts, { bottom, focusY, pad, maxZoom = 19, duration = 1500 }) {
  const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const top = ($('chips').firstElementChild?.getBoundingClientRect().bottom || 120) + pad;
  // en el panel (iPad, computador) el hueco libre queda a la derecha del panel
  const left = isPanel() && sheet.state !== 'REST' ? panelRight() + pad : pad, right = window.innerWidth - pad;
  const mppFit = Math.max((x1 - x0) / Math.max(right - left, 100), (z1 - z0) / Math.max(bottom - top, 100));
  const mppAt = (zoom) => 40075016.686 * Math.cos(CAMPUS_CENTER[1] * Math.PI / 180) / (512 * 2 ** zoom);
  const zoom = Math.min(maxZoom, Math.max(14, Math.log2(mppAt(0) / Math.max(mppFit, 1e-6))));
  const shiftPx = focusY - (top + bottom) / 2, shiftX = (window.innerWidth / 2 + padNow / 2) - (left + right) / 2;
  mapView.flyTo({ center: toLonLat((x0 + x1) / 2 + (isPanel() ? shiftX * mppAt(zoom) : 0), (z0 + z1) / 2 + shiftPx * mppAt(zoom)), zoom, pitch: 0, bearing: 0, duration });
}

// botón "Cómo llegar" del mapa: al lugar abierto, o el planificador desde tu ubicación
$('directions-button').addEventListener('click', () => {
  if (sheet.view === 'place' && currentPlace) { routeToPlace(currentPlace); return; }
  openSearch({ mode: 'route', origin: userLocation ? myStop() : null, focus: userLocation ? 'destination' : 'origin' });
});

// --- categorías ---
function openCategory(c) {
  if (currentCategory?.id === c.id && sheet.view === 'category') { back(); return; } // tocar la pastilla activa la apaga
  closeSearch();
  currentCategory = c;
  exploreSaved = null;
  stack = [{ view: 'home', state: 'REST' }];
  renderCategory();
  sheet.show('category', 'MID');
  syncMap();
  // el campus rodea Villa Portales y es más ancho que la pantalla: se encuadran los lugares de la categoría
  const mid = sheet.snapY('MID'); // a media altura, el centro del mapa queda al medio de lo que está sobre la hoja
  frame(c.features.map((f) => toLocal(...f.geometry.coordinates)), { bottom: mid - 12, focusY: mid / 2, pad: 40, maxZoom: 16.5, duration: OVERVIEW.duration });
}

function renderCategory() {
  const c = currentCategory, n = c.features.length;
  $('cat-badge').style.cssText = `--tint:${c.tint};--ink:${c.ink}`;
  $('cat-icon').textContent = c.icon;
  $('cat-title').textContent = c.label;
  $('cat-sub').textContent = `${n} ${n === 1 ? 'lugar' : 'lugares'}${userLocation ? ' · los más cercanos primero' : ''}`;
  const items = userLocation ? places.byDistance(userLocation, c.features)
    : c.features.map((f) => ({ f, w: null })).sort((a, b) => places.describe(a.f).name.localeCompare(places.describe(b.f).name, 'es') || places.describe(a.f).sub.localeCompare(places.describe(b.f).sub, 'es'));
  fill($('cat-list'),
    !userLocation && h('div', { class: 'nearby-empty', style: 'margin-bottom:6px' },
      h('span', { class: 'row-icon', style: '--tint:#d3e3fd;--ink:#1a73e8' }, icon('near_me')),
      h('p', {}, 'Activa tu ubicación para ordenarlos por cercanía.'),
      h('button', { class: 'btn btn-tonal', type: 'button', onclick: () => locate() }, 'Activar')),
    items.map(({ f, w }) => {
      const d = places.describe(f);
      return h('button', { class: 'list-row', type: 'button', onclick: () => openPlace(f) },
        h('span', { class: 'row-icon', style: `--tint:${c.tint};--ink:${c.ink}` }, icon(d.icon)),
        h('span', { class: 'row-text' }, h('span', { class: 'row-title' }, d.name), h('span', { class: 'row-sub' }, d.generic ? d.sub : d.sub || c.single)),
        w && h('span', { class: 'row-trail' }, h('b', {}, `${w.min} min`), fmtDist(w.meters)));
    }));
}
$('cat-close').addEventListener('click', back);

// --- edificios ---
function openBuilding(b) {
  currentBuilding = b;
  $('building-title').textContent = b.name;
  $('building-sub').textContent = buildingSub(b);
  const floors = new Map();
  for (const r of b.rooms) {
    const fl = Number(r.properties.piso) || 0;
    if (!floors.has(fl)) floors.set(fl, []);
    floors.get(fl).push(r);
  }
  fill($('building-list'), [...floors].map(([fl, rooms]) => [
    floors.size > 1 && h('h3', { class: 'section-title' }, fl < 0 ? 'Subterráneo' : fl ? `Piso ${fl}` : 'Sin piso'),
    h('div', { class: 'list divided' }, rooms.map((r) => {
      const d = places.describe(r);
      return h('button', { class: 'list-row', type: 'button', onclick: () => openPlace(r) },
        h('span', { class: 'row-icon', style: `--tint:${d.tint};--ink:${d.ink}` }, icon(d.icon)),
        h('span', { class: 'row-text' }, h('span', { class: 'row-title' }, d.name), h('span', { class: 'row-sub' }, [d.kind !== 'Sala' && d.kind, d.capacity && `${d.capacity} personas`].filter(Boolean).join(' · ') || 'Sala')),
        icon('chevron_right', { cls: 'row-trail' }));
    })),
  ]));
  go('building', 'MID');
  mapView.flyTo({ center: b.center, zoom: 18.2, pitch: 45, duration: 1600 });
}
$('building-close').addEventListener('click', back);

// --- elegir un punto en el mapa ---
// center: dónde mirar mientras se elige (si no, todo el campus)
function startPick(title, sub, onPick, asksLocation = false, { center } = {}) {
  pick = { onPick, asksLocation };
  $('pick-title').textContent = title;
  $('pick-sub').textContent = sub;
  go('pick', 'REST', { push: sheet.view !== 'pick' });
  mapView.flyTo(center ? { center, zoom: 18, pitch: 0, bearing: 0, duration: 1200 } : { ...OVERVIEW, duration: 1200 });
}
$('pick-close').addEventListener('click', back);

// un extremo de la ruta tocando el mapa (desde el planificador)
function pickRouteStop(field, stops) {
  startPick(field === 'origin' ? 'Elige el punto de partida' : 'Elige el destino', 'Toca el mapa o un lugar', (coords, name) => {
    const s = { ...stops, [field]: { name: name || 'Punto en el mapa', coords } };
    if (s.origin && s.destination) drawRoute(s.origin, s.destination);
    else openSearch({ mode: 'route', origin: s.origin, destination: s.destination, focus: field === 'origin' ? 'destination' : 'origin' });
  });
}

// --- ubicación ---
// GPS (dentro del campus) o, si no hay, un punto que el usuario toca en el mapa. locate() la entrega cuando la hay.
function locate() {
  if (userLocation) return Promise.resolve(userLocation);
  return new Promise((resolve) => {
    locateWaiters.push(resolve);
    if (locateWaiters.length === 1) triggerGeolocation();
  });
}
function resolveLocation(loc) {
  const w = locateWaiters;
  locateWaiters = [];
  w.forEach((fn) => fn(loc));
}

gpsButton.addEventListener('click', () => {
  if (manualLocation) { askManualLocation('Toca el mapa donde estás ahora.'); return; } // cambiar el punto elegido
  if (userLocation) { mapView.flyTo({ center: userLocation, zoom: 18, duration: 1000 }); return; }
  triggerGeolocation(true);
});

// sigue la posición; la primera vez vuela a ella (salvo que alguien la esté esperando para otra cosa)
const GPS_TIMEOUT_MS = 20000; // sin respuesta, se pide el punto a mano. Temporizador propio: el `timeout` de la API no
let gpsTimer = null;          // corre mientras el aviso de permiso sigue abierto, y ese aviso se puede ignorar
function triggerGeolocation(fly = false) {
  if (!navigator.geolocation) { onGeolocateError(); return; }
  if (gpsWatch !== null) navigator.geolocation.clearWatch(gpsWatch);
  let first = true;
  gpsButton.classList.add('searching');
  clearTimeout(gpsTimer);
  gpsTimer = setTimeout(onGeolocateError, GPS_TIMEOUT_MS);
  gpsWatch = navigator.geolocation.watchPosition((pos) => {
    onGeolocate([pos.coords.longitude, pos.coords.latitude], first && (fly || !locateWaiters.length));
    first = false;
  }, onGeolocateError, { enableHighAccuracy: true });
}

function onGeolocate(lngLat, fly) {
  clearTimeout(gpsTimer);
  gpsButton.classList.remove('searching');
  if (mapView.isInside(lngLat)) {
    if (manualLocation) return; // el usuario fijó su ubicación a mano
    const firstFix = !userLocation;
    setUserLocation(lngLat);
    if (fly && firstFix) mapView.flyTo({ center: lngLat, zoom: 18, duration: 1200 });
  } else if (!userLocation) {
    if (gpsWatch !== null) { navigator.geolocation.clearWatch(gpsWatch); gpsWatch = null; }
    askManualLocation('Estás fuera del campus. Toca el mapa donde estás (o desde donde quieres partir).');
  }
}

function onGeolocateError() {
  clearTimeout(gpsTimer);
  gpsButton.classList.remove('searching');
  if (userLocation) return; // ya hay ubicación: un error pasajero no interrumpe, y el seguimiento sigue andando
  if (gpsWatch !== null) { navigator.geolocation.clearWatch(gpsWatch); gpsWatch = null; }
  askManualLocation('No pudimos usar tu GPS. Toca el mapa donde estás.');
}

function askManualLocation(sub) {
  closeSearch(); // si la pidió el planificador, el mapa tiene que quedar a la vista
  startPick('Elige tu ubicación', sub, (coords) => {
    manualLocation = true;
    renderedAt = null;
    setUserLocation(coords);
    snackbar('Ubicación fijada. Tócala de nuevo en el botón de ubicación para cambiarla.');
  }, true);
}

// Con el GPS andando llegan posiciones a cada rato: las listas se rehacen solo si se movió más de 15 m
let renderedAt = null;
function setUserLocation(c) {
  userLocation = c;
  mapView.setUserLocation(c);
  gpsButton.classList.toggle('tracking', !manualLocation);
  fill(gpsButton, icon('my_location', { filled: !manualLocation }));
  resolveLocation(c);
  const [x, z] = toLocal(...c);
  if (renderedAt && Math.hypot(x - renderedAt[0], z - renderedAt[1]) < 15) return;
  renderedAt = [x, z];
  if (sheet.view === 'home') renderNearby();
  if (sheet.view === 'category') renderCategory();
  if (sheet.view === 'place') renderPlace();
}

// --- atajos de la búsqueda ---
function searchShortcuts() {
  const out = [], nc = nextClass();
  if (nc?.feature) out.push({ icon: 'school', title: nc.now ? 'Tu clase ahora' : 'Próxima clase', sub: `${nc.sala} · ${nc.when}`, run: () => openPlace(nc.feature) });
  else out.push({ icon: 'calendar_month', title: 'Tu horario', sub: 'Importar desde SIAC', run: () => showTab('tu') });
  const named = (n) => places.findByName(n);
  for (const [ic, title, sub, name] of [['subway', 'Metro', 'Universidad de Santiago', 'Metro Universidad de Santiago'], ['local_library', 'Biblioteca', 'Central', 'Biblioteca Central'], ['restaurant', 'Casino', 'Central', 'Casino Central']]) {
    const f = named(name);
    if (f) out.push({ icon: ic, title, sub, run: () => openPlace(f) });
  }
  return out;
}

// --- clima del título de Explorar (Open-Meteo, el de ahora). No cambia la escena: sigue fija en despejado. ---
const SHORT_WEATHER = { 'Mayormente despejado': 'Despejado', 'Parcialmente nublado': 'Nubes' };
function weatherIcon(code, night) {
  if (code <= 1) return night ? ['clear_night', 'night'] : ['sunny', 'sun'];
  if (code === 2) return night ? ['partly_cloudy_night', 'night'] : ['partly_cloudy_day', 'sun'];
  if (code === 45 || code === 48) return ['foggy', 'cloud'];
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return ['rainy', 'rain'];
  if (code >= 71 && code <= 86) return ['weather_snowy', 'cloud'];
  if (code >= 95) return ['thunderstorm', 'storm'];
  return ['cloud', 'cloud'];
}
function showWeather(a) {
  if (!a) return;
  const hr = new Date().getHours(), [ic, cls] = weatherIcon(a.code, hr < 7 || hr >= 21);
  $('weather-icon').textContent = ic;
  $('weather-icon').className = `ms fill weather-icon ${cls}`;
  $('weather-temp').textContent = `${a.temp}°`;
  $('weather-label').textContent = SHORT_WEATHER[a.state.label] || a.state.label;
  $('weather').title = `${a.state.label}, ${a.temp} °C en el campus`;
  $('weather').hidden = false;
}
function refreshWeather() { mapView.weather.refreshIfStale().then(showWeather).catch(() => {}); }
mapView.on('weather', showWeather);
setInterval(refreshWeather, 15 * 60 * 1000);

// --- capas (hoja que sube desde abajo, como la de Google Maps) ---
const layersSheet = $('layers-sheet');
const layersScrim = $('layers-scrim');
function toggleLayersSheet(open = !layersSheet.classList.contains('open')) {
  layersSheet.classList.toggle('open', open);
  layersScrim.classList.toggle('open', open);
  layersSheet.setAttribute('aria-hidden', String(!open));
  layersButton.setAttribute('aria-expanded', String(open));
}
layersButton.addEventListener('click', (e) => { e.stopPropagation(); toggleLayersSheet(); });
layersScrim.addEventListener('click', () => toggleLayersSheet(false));
$('layers-close').addEventListener('click', () => toggleLayersSheet(false));
let layerRequest = 0;
const typeOptions = layersSheet.querySelectorAll('.layers-types .layer-option');
for (const opt of typeOptions) {
  opt.addEventListener('click', async () => {
    const req = ++layerRequest, status = opt.querySelector('.layer-status');
    layersSheet.querySelectorAll('.layer-status').forEach((s) => { s.textContent = ''; });
    // "Descargando N%" solo mientras baja de verdad; guardada en el navegador o ya bajada, falta prepararla: "Cargando…"
    if (status) status.textContent = 'Cargando…';
    try {
      await mapView.setBaseLayer(opt.dataset.layer, (p) => { if (status) status.textContent = p < 1 ? `Descargando ${Math.round(p * 100)}%` : 'Cargando…'; });
    } catch (err) {
      console.error('No se pudo cargar la capa', opt.dataset.layer, err);
      if (status && req === layerRequest) status.textContent = 'Error, reintenta';
      return;
    }
    if (status) status.textContent = '';
    if (req !== layerRequest) return; // eligió otra mientras descargaba: esa manda
    for (const o of typeOptions) {
      o.classList.toggle('active', o === opt);
      o.setAttribute('aria-checked', String(o === opt));
    }
    layersButton.classList.toggle('tinted', opt.dataset.layer !== 'mapa'); // como Google Maps con satélite
  });
}
// Detalles del mapa: interruptores. El mapa siempre parte igual (sectores, puntos de interés, edificios 3D y hora y
// clima reales prendidos): no se recuerdan entre visitas. apply(on, inicial) los lleva al mapa.
function detailToggle(id, initial, apply) {
  const button = $(id);
  let on = initial;
  const show = () => { button.classList.toggle('active', on); button.setAttribute('aria-checked', String(on)); };
  button.addEventListener('click', () => { on = !on; show(); apply(on, false); });
  show();
  apply(on, true);
}
try { ['usach-map.sectores', 'usach-map.pois', 'usach-map.edificios3d'].forEach((k) => localStorage.removeItem(k)); } catch { /* sin almacenamiento */ }
detailToggle('toggle-sectores', true, (on) => mapView.setSectorsVisible(on));
detailToggle('toggle-pois', true, (on) => mapView.setPOIsVisible(on));
// Edificios 3D: se achatan (no desaparecen); la fotogrametría también, y queda como una foto aérea plana
detailToggle('toggle-3d', true, (on, initial) => mapView.setBuildings3D(on, { animate: !initial }));
// Hora y clima reales: luz de la hora actual (con noche) y el clima de ahora. Parte prendido: al abrir la app ya se
// ve la hora y el clima de este momento (el sol y el clima pasan a los reales mientras se llega desde las nubes)
detailToggle('toggle-vivo', true, (on, initial) => { if (!initial || !mapView.live) mapView.setLive(on); });

// Escape: cierra la hoja de capas, o vuelve atrás en la hoja (la búsqueda se cierra sola)
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || isSearchOpen()) return;
  if (layersSheet.classList.contains('open')) toggleLayersSheet(false);
  else if (!['home', 'tu', 'mas'].includes(sheet.view)) back();
});

// la fecha y el saludo cambian con la hora
setInterval(() => { if (sheet.view === 'home') { const t = $('home-title').textContent; renderHome(); if (t !== $('home-title').textContent) refreshWeather(); } }, 60000);

// App instalable: el service worker permite instalarla (Agregar a la pantalla principal) y abrirla sin conexión
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));

if (DEV) import('./devpanel.js');
init().catch((err) => {
  console.error(err);
  fill($('loader-overlay'), h('p', { style: 'padding:24px;text-align:center;color:#5e5e5e' }, `Error cargando el mapa: ${err.message}`));
});
