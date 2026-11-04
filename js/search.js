// Página de búsqueda (a pantalla completa, como la de Google Maps) y planificador de rutas origen → destino.
//  - Lugares: atajos, recientes (se pueden quitar) y, al escribir, categorías sugeridas y lugares con lo escrito
//    resaltado. Enter elige el primero. Búsqueda por voz donde el navegador la permite.
//  - Ruta: dos campos (partida y destino) con "Tu ubicación" y "Elegir en el mapa"; con ambos listos traza la ruta.
//  - El botón atrás del teléfono cierra la página (queda una entrada en el historial mientras está abierta).
import { h, fill, icon, norm, fmtDist } from './ui.js';
import { describe, search, matchCategories, recents } from './places.js';

const page = document.getElementById('search-page');
const simpleHead = document.getElementById('sp-simple');
const routeHead = document.getElementById('sp-route');
const input = document.getElementById('sp-input');
const clearBtn = document.getElementById('sp-clear');
const voiceBtn = document.getElementById('sp-voice');
const body = document.getElementById('sp-body');
const fields = { origin: document.getElementById('rp-origin'), destination: document.getElementById('rp-destination') };

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const voiceSupported = !!SR;

// ctx (app.js): pickPlace(f), pickCategory(cat), route(origin, destination), userLocation(), locate() -> Promise,
//   pickOnMap(field, stops), shortcuts() -> [{ icon, title, sub, run }], walk(f) -> { meters } | null
let ctx = null;
let mode = 'place';
let field = 'destination'; // campo activo del planificador
let stops = { origin: null, destination: null }; // { name, coords, feature?, gps? }
let typed = ''; // lo escrito en el campo activo del planificador (vacío: muestra sugerencias)
let pushed = false;
let rec = null;
let locating = false;

export function initSearch(context) {
  ctx = context;
  voiceBtn.hidden = !voiceSupported;
  document.getElementById('sp-back').addEventListener('click', () => closeSearch());
  document.getElementById('rp-back').addEventListener('click', () => closeSearch());
  document.getElementById('rp-swap').addEventListener('click', swap);
  clearBtn.addEventListener('click', () => { input.value = ''; render(); input.focus(); });
  voiceBtn.addEventListener('click', () => (rec ? stopVoice() : startVoice()));
  input.addEventListener('input', render);
  for (const [k, el] of Object.entries(fields)) {
    el.addEventListener('focus', () => { field = k; typed = stops[k] ? '' : el.value; markField(); render(); el.select(); });
    el.addEventListener('input', () => { field = k; stops[k] = null; typed = el.value; render(); });
  }
  for (const el of [input, ...Object.values(fields)]) {
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); body.querySelector('[data-first]')?.click(); }
    });
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !page.hidden) closeSearch(); });
  window.addEventListener('popstate', () => { if (!page.hidden) closeSearch({ fromHistory: true }); });
}

export const isSearchOpen = () => !page.hidden;

export function openSearch({ mode: m = 'place', origin = null, destination = null, focus = null, voice = false } = {}) {
  mode = m;
  stops = { origin, destination };
  typed = '';
  field = focus || (origin ? 'destination' : 'origin');
  simpleHead.hidden = mode !== 'place';
  routeHead.hidden = mode !== 'route';
  input.value = '';
  fields.origin.value = origin?.name || '';
  fields.destination.value = destination?.name || '';
  page.hidden = false;
  if (!pushed) { history.pushState({ usachOverlay: 'search' }, ''); pushed = true; }
  markField();
  render();
  requestAnimationFrame(() => (mode === 'place' ? input : fields[field]).focus({ preventScroll: true }));
  if (voice && voiceSupported) startVoice();
}

export function closeSearch({ fromHistory = false } = {}) {
  if (page.hidden) return;
  stopVoice();
  page.hidden = true;
  document.activeElement?.blur?.();
  if (pushed) {
    pushed = false;
    if (!fromHistory) history.back();
  }
}

function markField() {
  for (const [k, el] of Object.entries(fields)) el.closest('.rp-row').classList.toggle('active', mode === 'route' && k === field);
}

function swap() {
  stops = { origin: stops.destination, destination: stops.origin };
  fields.origin.value = stops.origin?.name || '';
  fields.destination.value = stops.destination?.name || '';
  typed = '';
  maybeRoute() || render();
}

// --- elegir ---
const stopOf = (f) => ({ name: describe(f).name, coords: f.geometry.coordinates, feature: f });
function choosePlace(f) {
  recents.add(f);
  if (mode === 'place') { closeSearch(); ctx.pickPlace(f); return; }
  setStop(field, stopOf(f));
}
function setStop(k, stop) {
  stops[k] = stop;
  fields[k].value = stop?.name || '';
  typed = '';
  if (maybeRoute()) return;
  field = k === 'origin' ? 'destination' : 'origin';
  markField();
  fields[field].focus({ preventScroll: true });
  render();
}
function maybeRoute() {
  if (mode !== 'route' || !stops.origin || !stops.destination) return false;
  const { origin, destination } = stops;
  closeSearch();
  ctx.route(origin, destination);
  return true;
}
// Si no hay GPS, la app cierra esta página para elegir el punto en el mapa; con él, se vuelve a abrir
async function useMyLocation() {
  const k = field, before = { ...stops };
  locating = true;
  render();
  const loc = await ctx.locate();
  locating = false;
  if (!loc) { if (!page.hidden) render(); return; }
  if (page.hidden) openSearch({ mode: 'route', origin: before.origin, destination: before.destination, focus: k });
  setStop(k, { name: 'Tu ubicación', coords: loc, gps: true });
}

// --- pantalla ---
function render() {
  const q = mode === 'place' ? input.value.trim() : typed.trim();
  clearBtn.hidden = !input.value;
  voiceBtn.hidden = !voiceSupported || !!input.value;
  if (mode === 'route') fill(body, routeOptions(q));
  else fill(body, q ? results(q) : home());
  body.scrollTop = 0;
  const first = body.querySelector('.list-row, .sp-shortcut');
  if (first && q) first.dataset.first = '';
}

function home() {
  const sc = ctx.shortcuts();
  return [
    sc.length && h('div', { class: 'sp-shortcuts', role: 'list' }, sc.map((s) => h('button', { class: 'sp-shortcut', role: 'listitem', onclick: () => { closeSearch(); s.run(); } },
      h('span', { class: 'sc-icon' }, icon(s.icon)),
      h('span', { class: 'sc-text' }, h('span', { class: 'sc-title' }, s.title), h('span', { class: 'sc-sub' }, s.sub))))),
    h('div', { class: 'band' }),
    recentList(),
  ];
}

function recentList() {
  const list = recents.list();
  return [
    h('div', { class: 'sp-section-head' }, h('h3', {}, 'Recientes'), list.length > 0 && h('button', { class: 'text-btn', onclick: () => { recents.clear(); render(); } }, 'Borrar')),
    list.length
      ? h('div', { class: 'sp-list list divided' }, list.map((f) => h('div', { class: 'row-wrap' },
        h('button', { class: 'list-row', onclick: () => choosePlace(f) },
          h('span', { class: 'row-icon' }, icon('history')),
          h('span', { class: 'row-text' }, h('span', { class: 'row-title' }, describe(f).name), h('span', { class: 'row-sub' }, describe(f).sub))),
        h('button', { class: 'row-action', 'aria-label': `Quitar ${describe(f).name} de recientes`, onclick: () => { recents.remove(f); render(); } }, icon('close')))))
      : h('p', { class: 'sp-empty' }, 'Lo que busques aparecerá aquí.'),
  ];
}

function results(q) {
  const cats = mode === 'place' ? matchCategories(q).slice(0, 2) : [];
  const found = search(q);
  if (!cats.length && !found.length) {
    return h('div', { class: 'sp-empty' }, h('b', {}, `No encontramos «${q}»`), 'Prueba con el código de una sala (como EAO514), un edificio o algo como "baño" o "comida".');
  }
  const catRows = cats.map((c) => h('button', { class: 'list-row', onclick: () => { closeSearch(); ctx.pickCategory(c); } },
    h('span', { class: 'row-icon', style: `--tint:${c.tint};--ink:${c.ink}` }, icon(c.icon)),
    h('span', { class: 'row-text' }, h('span', { class: 'row-title' }, c.label), h('span', { class: 'row-sub' }, `${c.features.length} ${c.features.length === 1 ? 'lugar' : 'lugares'} · ver en el mapa`)),
    icon('chevron_right', { cls: 'row-trail' })));
  // un lugar cuyo nombre empieza con lo escrito va antes que las categorías (Enter lo elige)
  const placeFirst = found.length && norm(describe(found[0]).name).startsWith(norm(q));
  const placeRows = found.map((f) => placeRow(f, q));
  return h('div', { class: 'sp-list list divided' }, placeFirst ? [placeRows, catRows] : [catRows, placeRows]);
}

function placeRow(f, q) {
  const d = describe(f), w = ctx.walk(f);
  return h('button', { class: 'list-row', onclick: () => choosePlace(f) },
    h('span', { class: 'row-icon', style: `--tint:${d.tint};--ink:${d.ink}` }, icon(d.icon)),
    h('span', { class: 'row-text' }, h('span', { class: 'row-title' }, highlight(d.name, q)), h('span', { class: 'row-sub' }, d.sub)),
    w && h('span', { class: 'row-trail' }, fmtDist(w.meters)));
}

// resalta en el nombre la primera aparición de cada palabra escrita
function highlight(text, q) {
  const n = norm(text), marks = new Array(text.length).fill(false);
  for (const t of norm(q).split(/\s+/).filter((x) => x.length > 0)) {
    const i = n.indexOf(t);
    if (i >= 0) for (let k = i; k < i + t.length; k++) marks[k] = true;
  }
  const out = [];
  let i = 0;
  while (i < text.length) {
    let j = i;
    while (j < text.length && marks[j] === marks[i]) j++;
    out.push(marks[i] ? h('span', { class: 'hl' }, text.slice(i, j)) : text.slice(i, j));
    i = j;
  }
  return out;
}

function routeOptions(q) {
  const k = field;
  const opts = h('div', { class: 'sp-list list divided' },
    h('button', { class: 'list-row', onclick: useMyLocation },
      h('span', { class: 'row-icon', style: '--tint:#d3e3fd;--ink:#1a73e8' }, icon('my_location')),
      h('span', { class: 'row-text' }, h('span', { class: 'row-title' }, 'Tu ubicación'), h('span', { class: 'row-sub' }, locating ? 'Buscando tu ubicación…' : ctx.userLocation() ? 'Usar el GPS' : 'Activar el GPS'))),
    h('button', { class: 'list-row', onclick: () => { const s = { ...stops }; closeSearch(); ctx.pickOnMap(k, s); } },
      h('span', { class: 'row-icon' }, icon('pin_drop')),
      h('span', { class: 'row-text' }, h('span', { class: 'row-title' }, 'Elegir en el mapa'), h('span', { class: 'row-sub' }, k === 'origin' ? 'Toca el punto de partida' : 'Toca el destino'))));
  if (q) {
    const found = search(q);
    return [h('div', { class: 'sp-list list divided' }, found.map((f) => placeRow(f, q))), !found.length && h('p', { class: 'sp-empty' }, `No encontramos «${q}».`)];
  }
  return [opts, h('div', { class: 'band' }), recentList()];
}

// --- voz ---
function startVoice() {
  if (!SR || rec) return;
  rec = new SR();
  rec.lang = 'es-CL';
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  simpleHead.classList.add('listening');
  input.placeholder = 'Habla ahora…';
  rec.onresult = (e) => {
    input.value = [...e.results].map((r) => r[0].transcript).join(' ').trim();
    render();
  };
  rec.onerror = () => stopVoice();
  rec.onend = () => stopVoice();
  try { rec.start(); } catch { stopVoice(); }
}
function stopVoice() {
  if (!rec) return;
  const r = rec;
  rec = null;
  try { r.abort(); } catch { /* ya terminó */ }
  simpleHead.classList.remove('listening');
  input.placeholder = 'Buscar en la USACH';
}
