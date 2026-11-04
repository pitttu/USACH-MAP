// Vista "Tú" (beta): el horario de clases del alumno sobre el mapa, los traslados entre sus salas y sus lugares
// (guardados y recientes).
//  - Es una vista de la hoja deslizable (#view-tu): su título (Tú + perfil) asoma en reposo; la barra inferior y el
//    cambio de vista son de app.js.
//  - Importar: el RUT y la clave van una sola vez al servicio que inicia sesión en SIAC y devuelve el horario: en la
//    app publicada (GitHub Pages), el Worker de Cloudflare (siac-worker/); en el servidor local, POST
//    /api/siac/horario (tools/serve-https.py + siac.py). La clave no se guarda; el horario queda solo en este navegador.
//  - Traslados: entre dos clases seguidas en salas distintas calcula la caminata (grafo de paths.json) y la compara
//    con la ventana (tiempo libre) que hay entre ellas.
//  - La tarjeta de la próxima clase también va en el título de Explorar (#next-class).
// Todo lo que viene de SIAC se pone con textContent (h()), nunca como HTML.
import { h, fill, icon, fmtDist, fmtDur, walkMin, shortBuilding } from './ui.js';
import { describe, saved, recents } from './places.js';

// Dirección del Worker (la imprime `npx wrangler deploy` en siac-worker/). Vacía: la importación web no está activa.
const SIAC_WORKER = '';
const PUBLISHED = location.hostname.endsWith('github.io');
const SIAC_API = PUBLISHED ? SIAC_WORKER && `${SIAC_WORKER.replace(/\/$/, '')}/horario` : '/api/siac/horario';
const KEY = 'usach-map.horario';
// bloques de SIAC, por si la página no trae la hora de alguno
const BLOCKS = [['08:15', '09:35'], ['09:50', '11:10'], ['11:25', '12:45'], ['13:45', '15:05'], ['15:20', '16:40'],
  ['16:55', '18:15'], ['18:45', '20:05'], ['20:05', '21:25'], ['21:25', '22:45']];
const DAY = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const DAY_SHORT = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const TYPE = { T: 'Teoría', E: 'Ejercicios', L: 'Laboratorio', TA: 'Taller', A: 'Ayudantía' };
const COLORS = ['#3b5bdb', '#d6336c', '#2b8a3e', '#e8590c', '#7048e8', '#0c8599', '#5c940d', '#c92a2a', '#1098ad'];
const TIGHT_MIN = 5; // con menos ventana que esto (descontada la caminata) el traslado es "justo"

// Horario ficticio con salas reales, para probar sin cuenta SIAC
const DEMO = {
  alumno: 'Estudiante de Prueba', carrera: 'Horario de ejemplo', periodo: '2/2026',
  cursos: [
    { codigo: '10101', nombre: 'Cálculo II', docentes: ['Docente de ejemplo'] },
    { codigo: '10102', nombre: 'Álgebra Lineal', docentes: ['Docente de ejemplo'] },
    { codigo: '10103', nombre: 'Física II', docentes: ['Docente de ejemplo'] },
    { codigo: '10104', nombre: 'Programación', docentes: ['Docente de ejemplo'] },
    { codigo: '10105', nombre: 'Inglés II', docentes: ['Docente de ejemplo'] },
    { codigo: '10106', nombre: 'Química General', docentes: ['Docente de ejemplo'] },
  ],
  clases: [
    [1, 1, '10101', 'T', 'EAO507'], [1, 2, '10101', 'T', 'EAO507'], [1, 4, '10103', 'T', 'FAE703'],
    [2, 2, '10102', 'T', 'EPF762'], [2, 3, '10104', 'T', 'INF201'], [2, 6, '10105', 'T', 'BCH102'],
    [3, 1, '10101', 'T', 'EAO507'], [3, 2, '10106', 'T', 'EF402'], [3, 4, '10103', 'T', 'FAE703'],
    [4, 2, '10102', 'T', 'EPF762'], [4, 3, '10101', 'E', 'EAO509'], [4, 4, '10104', 'L', 'INF202'], [4, 6, '10105', 'T', 'BCH102'],
    [5, 2, '10103', 'L', 'IND203'], [5, 3, '10106', 'E', 'EF402'],
  ].map(([dia, bloque, curso, tipo, sala]) => ({ dia, bloque, curso, tipo, sala })),
};

// --- elementos ---
const $ = (id) => document.getElementById(id);
const body = $('view-tu').querySelector('.sheet-body');
const connect = $('tu-connect');
const form = $('tu-form');
const rutInput = $('tu-rut');
const claveInput = $('tu-clave');
const submit = $('tu-submit');
const errorBox = $('tu-error');
const schedule = $('tu-schedule');
const nextCard = $('next-class');

// ctx (app.js): salas, findPath(a, b) -> { meters }, showRoom(f), routeTo(f), routeBetween(fa, fb), showPlace(f),
//   toast(msg, error), expand() (subir la hoja entera), onProfile() (cambió el alumno: avatar y saludo)
let ctx = null;
let data = load();
let editing = false; // con horario cargado, mostrando el formulario para actualizarlo
let day = null; // día que muestra la línea de tiempo
const rooms = new Map();
const transfers = new Map();

const mins = (t) => { const [a, b] = t.split(':').map(Number); return a * 60 + b; };
// window.__tuNow = { dia, min } fija la hora (pruebas con Playwright)
function now() {
  if (window.__tuNow) return window.__tuNow;
  const d = new Date();
  return { dia: d.getDay() || 7, min: d.getHours() * 60 + d.getMinutes() };
}

const cleanRut = (s) => String(s).replace(/[^0-9kK]/g, '').toUpperCase();
function validRut(s) {
  const c = cleanRut(s);
  if (c.length < 7) return false;
  let sum = 0, k = 2;
  for (let i = c.length - 2; i >= 0; i--) { sum += +c[i] * k; k = k === 7 ? 2 : k + 1; }
  const r = 11 - (sum % 11);
  return c.at(-1) === (r === 11 ? '0' : r === 10 ? 'K' : String(r));
}
function formatRut(s) {
  const c = cleanRut(s);
  return c.length < 2 ? c : `${c.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${c.at(-1)}`;
}

// --- datos ---
function load() {
  try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
}
function save(d) {
  data = d;
  transfers.clear();
  try {
    if (d) localStorage.setItem(KEY, JSON.stringify(d));
    else localStorage.removeItem(KEY);
  } catch { /* modo privado: dura hasta cerrar la pestaña */ }
  ctx?.onProfile();
}

const course = (code) => {
  const i = data.cursos.findIndex((c) => c.codigo === code);
  return { ...(data.cursos[i] || { codigo: code, nombre: `Curso ${code}`, docentes: [] }), color: COLORS[Math.max(i, 0) % COLORS.length] };
};
const room = (sala) => (sala ? rooms.get(sala.trim().toUpperCase()) || null : null);

// Clases de la semana ordenadas, uniendo bloques seguidos del mismo curso en la misma sala (09:50–12:45)
function sessions() {
  const out = [];
  const list = [...data.clases].sort((a, b) => a.dia - b.dia || a.bloque - b.bloque);
  for (const c of list) {
    const inicio = c.inicio || BLOCKS[c.bloque - 1]?.[0], fin = c.fin || BLOCKS[c.bloque - 1]?.[1];
    if (!inicio) continue;
    const p = out.at(-1);
    if (p && p.dia === c.dia && p.curso === c.curso && p.tipo === c.tipo && p.sala === c.sala && p.hasta === c.bloque - 1) {
      p.fin = fin;
      p.hasta = c.bloque;
      continue;
    }
    out.push({ ...c, inicio, fin, hasta: c.bloque });
  }
  return out;
}

// Caminata entre las salas de dos clases seguidas: { same } si es la misma sala, null si alguna no está en el mapa
function transfer(a, b) {
  if (!a.sala || !b.sala) return null;
  if (a.sala === b.sala) return { same: true };
  const key = `${a.sala}>${b.sala}`;
  if (!transfers.has(key)) {
    const fa = room(a.sala), fb = room(b.sala);
    const path = fa && fb && ctx?.findPath(fa.geometry.coordinates, fb.geometry.coordinates);
    transfers.set(key, path ? { from: fa, to: fb, meters: path.meters, min: walkMin(path.meters) } : null);
  }
  return transfers.get(key);
}

// La clase en curso o la siguiente (dando la vuelta a la semana), con la anterior y la siguiente del mismo día
function upcoming(list) {
  if (!list.length) return null;
  const { dia, min } = now(), t = dia * 1440 + min, at = (s) => s.dia * 1440 + mins(s.inicio);
  let i = list.findIndex((s) => s.dia === dia && mins(s.inicio) <= min && min < mins(s.fin));
  const state = i >= 0 ? 'now' : 'next';
  if (i < 0) i = Math.max(0, list.findIndex((s) => at(s) > t));
  const s = list[i], prev = list[i - 1]?.dia === s.dia ? list[i - 1] : null, next = list[i + 1]?.dia === s.dia ? list[i + 1] : null;
  return { s, prev, next, state, inMin: (at(s) - t + 7 * 1440) % (7 * 1440) };
}

function whenLabel(u) {
  const { s, state, inMin } = u, today = now().dia;
  if (state === 'now') return `Hasta las ${s.fin}`;
  if (s.dia === today && inMin < 1440) return inMin <= 60 ? `En ${inMin} min` : `Hoy a las ${s.inicio}`;
  if (s.dia === (today % 7) + 1) return `Mañana a las ${s.inicio}`;
  return `${DAY[s.dia]} a las ${s.inicio}`;
}

function metaLine(s) {
  const f = room(s.sala), piso = +f?.properties.piso;
  const where = !s.sala ? 'Sin sala asignada' : f ? `${s.sala}${piso > 1 ? ` · piso ${piso}` : ''}` : `${s.sala} · no está en el mapa`;
  return `${TYPE[s.tipo] || s.tipo} · ${where}`;
}

// --- acciones sobre el mapa ---
function showRoom(s) {
  const f = room(s.sala);
  if (!f) { ctx?.toast(s.sala ? `${s.sala} aún no está en el mapa.` : 'Esta clase no tiene sala asignada.', true); return; }
  ctx.showRoom(f);
}
function routeTo(s) {
  const f = room(s.sala);
  if (!f) { showRoom(s); return; }
  ctx.routeTo(f);
}
const routeBetween = (t) => ctx.routeBetween(t.from, t.to);

// --- pantalla ---
function render() {
  renderNextCard();
  renderProfile();
  const has = !!data;
  connect.hidden = has && !editing;
  schedule.hidden = !has;
  $('tu-cancel').hidden = !(has && editing);
  $('tu-refresh-top').hidden = !has;
  $('tu-footer').hidden = !has;
  $('tu-connect-title').textContent = has ? 'Actualizar horario' : 'Tu horario en el mapa';
  if (has) renderSchedule();
  renderPlaces();
}

function renderSchedule() {
  const list = sessions();
  renderNow(list);
  renderDays(list);
  renderDay(list);
  renderCourses(list);
  const when = data.actualizado ? new Date(data.actualizado).toLocaleString('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : '';
  $('tu-updated').textContent = data.demo ? 'Horario de ejemplo: no son tus clases.' : `Importado desde SIAC${when ? ` el ${when}` : ''}.`;
}

const initialsOf = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

function renderProfile() {
  const box = $('tu-profile');
  if (!data) {
    fill(box, h('span', { class: 'avatar lg', 'aria-hidden': 'true' }, icon('person')),
      h('div', { class: 'grow' }, h('div', { class: 'profile-name' }, 'Tu horario'), h('div', { class: 'profile-sub' }, 'Conéctalo con SIAC para verlo en el mapa')));
    return;
  }
  fill(box, h('span', { class: 'avatar lg initials', 'aria-hidden': 'true' }, initialsOf(data.alumno || '?')),
    h('div', { class: 'grow' },
      h('div', { class: 'profile-name' }, data.alumno || 'Estudiante'),
      h('div', { class: 'profile-sub' }, [data.carrera, data.periodo && `Semestre ${data.periodo}`].filter(Boolean).join(' · '))));
}

// En clase: cuánto toma ir a la siguiente. Antes de una clase: cuánto toma llegar desde la anterior.
function transferLine(u) {
  if (u.state === 'now' && u.next) {
    const t = transfer(u.s, u.next), c = course(u.next.curso);
    const walk = t && !t.same ? ` · ${t.min} min a pie hasta ${u.next.sala}` : t?.same ? ' · misma sala' : '';
    return h('div', { class: 'tu-now-transfer' }, icon('directions_walk'), `Luego: ${c.nombre} a las ${u.next.inicio}${walk}`);
  }
  const t = u.state === 'next' && u.prev && transfer(u.prev, u.s);
  if (!t || t.same) return null;
  return h('div', { class: 'tu-now-transfer' }, icon('directions_walk'), `Desde ${u.prev.sala}: ${t.min} min a pie (${fmtDist(t.meters)})`);
}

function renderNow(list) {
  const box = $('tu-now');
  const u = upcoming(list);
  if (!u) { fill(box, h('p', { class: 'empty' }, 'Tu horario no tiene clases este semestre.')); return; }
  const c = course(u.s.curso), f = room(u.s.sala), toNext = u.state === 'now' && u.next && transfer(u.s, u.next);
  box.style.setProperty('--c', c.color);
  fill(box,
    h('div', { class: `tu-now-when ${u.state}` }, u.state === 'now' ? 'Ahora en clase' : 'Próxima clase', h('span', {}, whenLabel(u))),
    h('div', { class: 'tu-now-head' },
      h('span', { class: 'dot', style: `--c:${c.color}`, 'aria-hidden': 'true' }),
      h('div', { class: 'grow' },
        h('div', { class: 'tu-now-name' }, c.nombre),
        h('div', { class: 'tu-now-meta' }, `${u.s.inicio}–${u.s.fin} · ${metaLine(u.s)}`),
        shortBuilding(f?.properties.edificio) && h('div', { class: 'tu-now-meta' }, shortBuilding(f.properties.edificio)))),
    transferLine(u),
    h('div', { class: 'tu-now-actions' },
      // en clase lo útil es ir a la siguiente sala; si no, llegar a esta
      toNext && !toNext.same
        ? h('button', { class: 'btn btn-filled', onclick: () => routeBetween(toNext) }, icon('directions', { filled: true }), `Ir a ${u.next.sala}`)
        : h('button', { class: 'btn btn-filled', disabled: !f, onclick: () => routeTo(u.s) }, icon('directions', { filled: true }), 'Cómo llegar'),
      h('button', { class: 'btn btn-gray', disabled: !f, onclick: () => showRoom(u.s) }, icon('location_on'), 'Ver sala')),
  );
}

function renderDays(list) {
  const today = now().dia, last = list.some((s) => s.dia === 6) ? 6 : 5;
  if (!day || day > last) day = today <= last ? today : 1;
  fill($('tu-days'), Array.from({ length: last }, (_, i) => {
    const d = i + 1, count = list.filter((s) => s.dia === d).length;
    return h('button', {
      class: `tu-day${d === day ? ' active' : ''}${d === today ? ' today' : ''}`, role: 'tab', 'aria-selected': String(d === day),
      'aria-label': `${DAY[d]}, ${count} ${count === 1 ? 'clase' : 'clases'}`, onclick: () => { day = d; renderSchedule(); },
    }, h('span', {}, DAY_SHORT[d]), h('small', {}, count ? '•'.repeat(Math.min(count, 4)) : '–'));
  }));
}

function renderDay(list) {
  const box = $('tu-day');
  const items = list.filter((s) => s.dia === day);
  $('tu-day-title').textContent = day === now().dia ? `Hoy, ${DAY[day].toLowerCase()}` : DAY[day];
  if (!items.length) { fill(box, h('li', { class: 'empty' }, 'Sin clases este día.')); return; }
  const { dia, min } = now(), isToday = day === dia;
  const rows = [];
  items.forEach((s, i) => {
    if (i) rows.push(transferRow(items[i - 1], s));
    const c = course(s.curso), past = isToday && mins(s.fin) <= min, live = isToday && mins(s.inicio) <= min && min < mins(s.fin);
    rows.push(h('li', { class: `tu-class${past ? ' past' : ''}${live ? ' live' : ''}`, style: `--c:${c.color}` },
      h('button', { class: 'tu-class-btn', onclick: () => showRoom(s), 'aria-label': `${c.nombre}, ${s.inicio} a ${s.fin}, ${metaLine(s)}. Ver en el mapa` },
        h('span', { class: 'tu-time' }, h('b', {}, s.inicio), h('span', {}, s.fin)),
        h('span', { class: 'dot', 'aria-hidden': 'true' }),
        h('span', { class: 'tu-class-body' },
          h('span', { class: 'tu-class-name' }, c.nombre, live && h('em', { class: 'tu-live' }, 'Ahora')),
          h('span', { class: 'tu-class-meta' }, metaLine(s))),
        h('span', { class: 'tu-chevron' }, icon('chevron_right')))));
  });
  fill(box, rows);
}

// Fila entre dos clases: la ventana y, si cambian de sala, la caminata (tocar dibuja la ruta entre ambas salas)
function transferRow(a, b) {
  const gap = mins(b.inicio) - mins(a.fin), t = transfer(a, b);
  if (t?.same || !t) {
    const why = t?.same ? 'Misma sala' : (!a.sala || !b.sala) ? 'Sin sala asignada' : 'Sala fuera del mapa';
    return h('li', { class: 'tu-transfer quiet' }, h('span', {}, why), h('span', { class: 'tu-gap' }, `Ventana ${fmtDur(gap)}`));
  }
  const slack = gap - t.min;
  const level = slack < 0 ? 'late' : slack < TIGHT_MIN ? 'tight' : 'ok';
  const chip = level === 'late' ? `Faltan ${-slack} min` : level === 'tight' ? 'Justo' : `Ventana ${fmtDur(gap)}`;
  const hint = level === 'ok' ? '' : level === 'tight' ? ` · ventana de ${fmtDur(gap)}: sal apenas termine` : ` · ventana de ${fmtDur(gap)}`;
  return h('li', { class: `tu-transfer ${level}` },
    h('button', { class: 'tu-transfer-btn', onclick: () => routeBetween(t), 'aria-label': `Ruta de ${a.sala} a ${b.sala}: ${t.min} minutos a pie, ventana de ${fmtDur(gap)}` },
      icon('directions_walk'),
      h('span', { class: 'tu-transfer-title' }, `${t.min} min a pie · ${fmtDist(t.meters)}`),
      h('small', { class: 'tu-transfer-sub' }, `${a.sala} → ${b.sala}${hint}`),
      h('span', { class: 'tu-gap' }, chip)));
}

function renderCourses(list) {
  fill($('tu-courses'), data.cursos.map((cu) => {
    const c = course(cu.codigo), n = list.filter((s) => s.curso === cu.codigo).length;
    return h('li', { class: 'tu-course', style: `--c:${c.color}` },
      h('i', { 'aria-hidden': 'true' }),
      h('div', {}, h('b', {}, c.nombre), h('small', {}, [c.docentes.join(', '), `${n} ${n === 1 ? 'clase' : 'clases'} por semana`].filter(Boolean).join(' · '))));
  }));
}

// Guardados y recientes (como "Tus lugares" de Google Maps)
function placeRows(list, { removable, emptyText, store }) {
  if (!list.length) return h('p', { class: 'empty' }, emptyText);
  return list.map((f) => {
    const d = describe(f);
    return h('div', { class: 'row-wrap' },
      h('button', { class: 'list-row', onclick: () => ctx?.showPlace(f) },
        h('span', { class: 'row-icon', style: `--tint:${d.tint};--ink:${d.ink}` }, icon(store === saved ? d.icon : 'history')),
        h('span', { class: 'row-text' }, h('span', { class: 'row-title' }, d.name), h('span', { class: 'row-sub' }, d.sub))),
      removable && h('button', {
        class: `row-action${store === saved ? ' saved' : ''}`, 'aria-label': store === saved ? `Quitar ${d.name} de guardados` : `Quitar ${d.name} de recientes`,
        onclick: () => store.remove(f),
      }, icon(store === saved ? 'bookmark' : 'close', { filled: store === saved })));
  });
}
function renderPlaces() {
  const sv = saved.list(), rc = recents.list();
  fill($('tu-saved'), placeRows(sv, { removable: true, store: saved, emptyText: 'Guarda salas y lugares con el botón Guardar de su ficha: quedan aquí para volver a ellos.' }));
  fill($('tu-recent'), placeRows(rc, { removable: true, store: recents, emptyText: 'Los lugares que abras aparecerán aquí.' }));
  $('tu-clear').hidden = !rc.length;
}
saved.subscribe(renderPlaces);
recents.subscribe(renderPlaces);

// Tarjeta de la próxima clase en el título de Explorar
function renderNextCard() {
  const u = data && ctx && upcoming(sessions());
  nextCard.hidden = !u;
  if (!u) return;
  const c = course(u.s.curso), f = room(u.s.sala);
  // en clase, el botón lleva a la sala de la clase siguiente (si cambia); si no, a la sala de esta
  const toNext = u.state === 'now' && u.next && transfer(u.s, u.next), goNext = toNext && !toNext.same;
  const t = u.state === 'next' && u.prev && transfer(u.prev, u.s);
  const extra = goNext ? ` · luego ${u.next.sala} (${toNext.min} min)` : t && !t.same ? ` · ${t.min} min desde ${u.prev.sala}` : '';
  nextCard.style.setProperty('--c', c.color);
  nextCard.setAttribute('aria-label', `${u.state === 'now' ? 'Clase en curso' : 'Próxima clase'}: ${c.nombre}, ${whenLabel(u)}. Ver sala en el mapa`);
  fill(nextCard,
    h('span', { class: 'dot', 'aria-hidden': 'true' }),
    h('span', { class: 'nc-text' },
      h('span', { class: `nc-when ${u.state}` }, `${u.state === 'now' ? 'Ahora' : 'Próxima clase'} · ${whenLabel(u)}`),
      h('span', { class: 'nc-name' }, c.nombre),
      h('span', { class: 'nc-meta' }, `${u.s.sala || 'Sin sala'} · ${u.s.inicio}–${u.s.fin}${extra}`)),
    (goNext || f) && h('button', {
      class: 'nc-go', 'aria-label': goNext ? `Ruta a ${u.next.sala}` : `Cómo llegar a ${u.s.sala}`,
      onclick: (e) => { e.stopPropagation(); if (goNext) routeBetween(toNext); else routeTo(u.s); },
    }, icon('directions', { filled: true })),
  );
  nextCard.onclick = () => showRoom(u.s);
}
nextCard.addEventListener('keydown', (e) => {
  if (e.target === nextCard && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); nextCard.click(); }
});

// --- importar ---
function showError(msg) {
  errorBox.textContent = msg;
  errorBox.hidden = !msg;
}
function setBusy(busy) {
  submit.disabled = busy;
  submit.classList.toggle('busy', busy);
  submit.querySelector('span').textContent = busy ? 'Conectando con SIAC…' : 'Importar desde SIAC';
  rutInput.disabled = claveInput.disabled = busy;
}

rutInput.addEventListener('blur', () => { if (rutInput.value) rutInput.value = formatRut(rutInput.value); });
// al escribir, la hoja sube entera: el teclado tapa la mitad de abajo
for (const input of [rutInput, claveInput]) input.addEventListener('focus', () => ctx?.expand());
$('tu-show').addEventListener('click', (e) => {
  const show = claveInput.type === 'password', btn = e.currentTarget;
  claveInput.type = show ? 'text' : 'password';
  btn.querySelector('.ms').textContent = show ? 'visibility_off' : 'visibility';
  btn.setAttribute('aria-label', show ? 'Ocultar clave' : 'Mostrar clave');
  btn.setAttribute('aria-pressed', String(show));
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const rut = formatRut(rutInput.value), clave = claveInput.value;
  if (!validRut(rut)) { showError('Revisa el RUT: el dígito verificador no calza.'); rutInput.focus(); return; }
  if (clave.length < 4) { showError('Ingresa tu clave de SIAC.'); claveInput.focus(); return; }
  if (!SIAC_API) { showError('La importación desde SIAC aún no está activada en la web. Prueba con el horario de ejemplo.'); return; }
  showError('');
  setBusy(true);
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 45000);
  try {
    const r = await fetch(SIAC_API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rut, clave }), signal: abort.signal,
    });
    const res = await r.json().catch(() => null);
    if (!r.ok || !res) {
      throw new Error(res?.error || ([404, 405, 501].includes(r.status)
        ? 'La importación necesita el servidor de pruebas (tools/serve-https.py).' : `Error ${r.status} del servidor.`));
    }
    claveInput.value = '';
    editing = false;
    day = null;
    save({ ...res, rut, actualizado: new Date().toISOString() });
    render();
    body.scrollTop = 0;
    const missing = new Set(res.clases.filter((c) => c.sala && !room(c.sala)).map((c) => c.sala));
    ctx?.toast(`Horario importado: ${res.cursos.length} ramos${missing.size ? ` (${missing.size} salas aún no están en el mapa)` : ''}.`);
  } catch (err) {
    showError(err.name === 'AbortError' ? 'SIAC no respondió a tiempo. Intenta de nuevo.'
      : err instanceof TypeError ? 'No hay conexión con el servidor.' : err.message);
  } finally {
    clearTimeout(timer);
    setBusy(false);
  }
});

$('tu-demo').addEventListener('click', () => {
  editing = false;
  day = null;
  showError('');
  save({ ...DEMO, demo: true, actualizado: new Date().toISOString() });
  render();
  body.scrollTop = 0;
});
$('tu-refresh-top').addEventListener('click', () => {
  editing = true;
  rutInput.value = data?.demo ? '' : data?.rut || '';
  showError('');
  render();
  ctx?.expand();
  body.scrollTop = 0;
  (rutInput.value ? claveInput : rutInput).focus({ preventScroll: true });
});
$('tu-cancel').addEventListener('click', () => { editing = false; showError(''); render(); });
$('tu-remove').addEventListener('click', () => {
  if (!confirm('¿Quitar el horario de este dispositivo?')) return;
  editing = false;
  save(null);
  render();
});
$('tu-clear').addEventListener('click', () => recents.clear());

// la próxima clase cambia con la hora
setInterval(() => { if (data) { renderNextCard(); if (!$('view-tu').hidden) renderSchedule(); } }, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && data) render(); });

export function initTu(context) {
  ctx = context;
  for (const f of ctx.salas) rooms.set(String(f.properties.nombre).trim().toUpperCase(), f);
  transfers.clear();
  render();
}

// al mostrar la vista (la hora pudo avanzar)
export function refreshTu() {
  render();
}

// Para la app: el alumno (avatar y saludo), sus clases en una sala (ficha del lugar) y la próxima (atajo del buscador)
export function profileInfo() {
  if (!data) return null;
  const name = data.alumno || 'Estudiante';
  return { name, first: name.split(/\s+/)[0], initials: initialsOf(name), demo: !!data.demo };
}
export function classesIn(sala) {
  if (!data || !sala) return [];
  const key = sala.trim().toUpperCase();
  return sessions().filter((s) => s.sala?.trim().toUpperCase() === key)
    .map((s) => ({ name: course(s.curso).nombre, color: course(s.curso).color, when: `${DAY[s.dia]} ${s.inicio}–${s.fin}`, type: TYPE[s.tipo] || s.tipo }));
}
export function nextClass() {
  const u = data && upcoming(sessions());
  if (!u) return null;
  return { name: course(u.s.curso).nombre, sala: u.s.sala, when: whenLabel(u), now: u.state === 'now', feature: room(u.s.sala) };
}
