// Panel de revisión de lo que aporta la comunidad (GET /admin): fotos y lugares sugeridos. Primero, una pantalla de entrada con Google (solo eso);
// el Worker solo responde a los correos de ADMINS. Dentro: los envíos por estado con quién los subió, los botones para
// publicar, rechazar (borra los archivos) o retirar una publicada, el espacio usado y el registro de todo lo que pasó.
// Ediciones: cambios sugeridos a lugares que ya existen; se corrigen a mano en los datos del repositorio y aquí se
// marcan como aplicados (o se rechazan).
// Lugares: nombre, categoría y descripción se pueden corregir antes de publicar; "Ver en el mapa" abre la app en el punto.
// Si la sesión vence (Google la da por una hora) o la cuenta no es de un administrador, vuelve a la pantalla de entrada.
export const panel = (clientId) => `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Panel de revisión · USACH Map</title>
<meta name="robots" content="noindex">
<style>
  :root { --p: #007b8b; --pc: #c0eaf4; --o: #dadce0; --t2: #5e5e5e; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #1f1f1f; }
  body { margin: 0; background: #f1f3f4; }
  [hidden] { display: none !important; }
  /* entrada */
  .entrar { min-height: 100vh; display: grid; place-items: center; padding: 24px 16px; box-sizing: border-box; }
  .tarjeta { width: 100%; max-width: 380px; text-align: center; }
  .marca { width: 64px; height: 64px; border-radius: 20px; background: var(--pc); display: grid; place-items: center; margin: 0 auto 20px; }
  .tarjeta h1 { font-size: 24px; line-height: 32px; font-weight: 500; margin: 0; }
  .tarjeta .sub { color: var(--t2); margin: 4px 0 24px; font-size: 15px; }
  .tarjeta .nota { color: var(--t2); font-size: 14px; line-height: 20px; margin: 0 0 20px; }
  #g { display: flex; justify-content: center; min-height: 44px; }
  .error { color: #b3261e; font-size: 14px; line-height: 20px; margin: 16px 0 0; }
  .error:empty { display: none; }
  .pie { margin-top: 28px; font-size: 12px; color: var(--t2); }
  .pie a { color: var(--p); }
  /* panel */
  header { background: #fff; border-bottom: 1px solid var(--o); padding: 12px 16px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; position: sticky; top: 0; z-index: 1; }
  header .marca { width: 36px; height: 36px; border-radius: 12px; margin: 0; }
  header h1 { font-size: 18px; font-weight: 500; margin: 0; flex: 1; }
  .quien { font-size: 13px; color: var(--t2); text-align: right; }
  .salir { border: 1px solid var(--o); background: #fff; border-radius: 18px; padding: 6px 14px; font: inherit; font-size: 14px; cursor: pointer; }
  main { max-width: 1100px; margin: 0 auto; padding: 16px; }
  nav { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
  nav button { border: 1px solid var(--o); background: #fff; border-radius: 16px; padding: 6px 14px; font: inherit; cursor: pointer; }
  nav button.on { background: var(--pc); border-color: var(--pc); }
  .modo { margin-bottom: 18px; } .modo button { font-weight: 600; padding: 8px 18px; }
  .card .campos { padding: 0 12px 10px; display: grid; gap: 6px; }
  .card .campos input, .card .campos select, .card .campos textarea { font: inherit; font-size: 14px; border: 1px solid var(--o); border-radius: 8px; padding: 6px 8px; width: 100%; box-sizing: border-box; }
  .card .campos textarea { min-height: 56px; resize: vertical; }
  .card .mapa { display: block; padding: 0 12px 10px; color: var(--p); font-size: 14px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
  .card { background: #fff; border-radius: 12px; overflow: hidden; border: 1px solid var(--o); }
  .card img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; display: block; background: #e8eaed; cursor: zoom-in; }
  .card .d { padding: 10px 12px; font-size: 14px; line-height: 20px; }
  .card .d small { color: var(--t2); display: block; }
  .acc { display: flex; gap: 8px; padding: 0 12px 12px; flex-wrap: wrap; }
  .acc button { border: 0; border-radius: 18px; padding: 8px 14px; font: inherit; cursor: pointer; }
  .pub { background: var(--p); color: #fff; } .rec { background: #fce8e6; color: #b3261e; } .ret { background: #e8eaed; }
  table { width: 100%; border-collapse: collapse; background: #fff; font-size: 13px; margin-top: 12px; }
  td, th { border-bottom: 1px solid var(--o); padding: 6px 8px; text-align: left; }
  #msg { color: #b3261e; }
  #msg:empty { display: none; }
  .vacio { color: var(--t2); }
  dialog { padding: 0; border: 0; background: #000; } dialog img { max-width: 95vw; max-height: 90vh; display: block; }
</style></head><body>
<svg width="0" height="0" style="position:absolute"><symbol id="pin" viewBox="0 0 24 24"><path fill="#014f5a" d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z"/></symbol></svg>

<section id="entrar" class="entrar">
  <div class="tarjeta">
    <div class="marca"><svg width="34" height="34"><use href="#pin"/></svg></div>
    <h1>Panel de revisión</h1>
    <p class="sub">Aportes de la comunidad · USACH Map</p>
    <p class="nota">Solo para administradores. Entra con tu cuenta de Google.</p>
    <div id="g"></div>
    <p id="err" class="error" role="alert"></p>
    <p class="pie"><a href="https://pitttu.github.io/USACH-MAP/">Volver al mapa</a></p>
  </div>
</section>

<div id="panel" hidden>
  <header>
    <div class="marca"><svg width="20" height="20"><use href="#pin"/></svg></div>
    <h1>Panel de revisión</h1>
    <div class="quien"><div id="quien"></div><div id="espacio"></div></div>
    <button id="salir" class="salir" type="button">Salir</button>
  </header>
  <main>
    <p id="msg"></p>
    <nav id="modo" class="modo"><button data-m="fotos" class="on">Fotos</button><button data-m="lugares">Lugares</button><button data-m="ediciones">Ediciones</button></nav>
    <nav id="tabs"></nav>
    <div id="lista" class="grid"></div>
    <h2 style="font-size:16px;margin-top:28px">Registro</h2>
    <table><thead><tr><th>Cuándo</th><th>Acción</th><th>Quién</th><th id="col">Foto</th><th>Detalle</th></tr></thead><tbody id="reg"></tbody></table>
  </main>
</div>
<dialog id="ver" onclick="this.close()"><img alt=""></dialog>
<script>
const CLIENT_ID = ${JSON.stringify(clientId)};
let token = null, estado = 'pendiente', modo = 'fotos';
const APP = 'https://pitttu.github.io/USACH-MAP/';
const CATS = { comida: 'Comida', 'baño': 'Baño', dispensador: 'Agua (dispensador)', impresiones: 'Impresiones', cajero: 'Cajero', biblioteca: 'Biblioteca', educacion: 'Facultad o departamento', deporte: 'Deporte', salud: 'Salud', cultura: 'Cultura', tienda: 'Tienda', servicios: 'Servicio', institucional: 'Oficina o institucional', otro: 'Otro' };
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fecha = (s) => s ? new Date(s).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }) : '';
class Fallo extends Error { constructor(status, msg) { super(msg); this.status = status; } }
async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Fallo(r.status, (await r.json().catch(() => ({}))).error || r.statusText);
  return r;
}
// vuelve a la pantalla de entrada (sesión vencida, cuenta sin permiso o "Salir")
function aEntrada(error = '') {
  token = null;
  $('panel').hidden = true; $('entrar').hidden = false;
  $('err').textContent = error;
  google.accounts.id.disableAutoSelect();
}
async function img(el, f, mini) {
  try { el.src = URL.createObjectURL(await (await api('/admin/img/' + f.id + (mini ? '-m' : '') + '.' + f.formato)).blob()); } catch { el.alt = 'sin archivo'; }
}
const TABS = { pendiente: 'Pendientes', publicada: 'Publicadas', retirada: 'Retiradas', rechazada: 'Rechazadas', todas: 'Todas' };
const TABS_EDICIONES = { pendiente: 'Pendientes', aplicada: 'Aplicadas', rechazada: 'Rechazadas', todas: 'Todas' };
function tabs() { $('tabs').innerHTML = Object.entries(modo === 'ediciones' ? TABS_EDICIONES : TABS).map(([k, v]) => '<button data-e="' + k + '"' + (k === estado ? ' class="on"' : '') + '>' + v + '</button>').join(''); }
$('tabs').onclick = (e) => { const k = e.target.dataset?.e; if (k) { estado = k; cargar(); } };
$('modo').onclick = (e) => {
  const m = e.target.dataset?.m; if (!m) return;
  modo = m; estado = 'pendiente';
  for (const b of $('modo').children) b.classList.toggle('on', b.dataset.m === m);
  cargar();
};
$('salir').onclick = () => aEntrada();
async function cargar() {
  if (modo === 'lugares') return cargarLugares();
  if (modo === 'ediciones') return cargarEdiciones();
  $('col').textContent = 'Foto';
  $('msg').textContent = '';
  let datos;
  try { datos = await (await api('/admin/lista?estado=' + estado)).json(); }
  catch (err) {
    if (err.status === 401 || err.status === 403) return aEntrada(err.message);
    $('msg').textContent = err.message; return;
  }
  const { fotos, registro, espacio } = datos;
  $('entrar').hidden = true; $('panel').hidden = false;
  tabs();
  $('espacio').textContent = 'Espacio usado: ' + (espacio.usado / 1e9).toFixed(2) + ' de ' + (espacio.tope / 1e9).toFixed(1) + ' GB';
  $('lista').innerHTML = fotos.length ? '' : '<p class="vacio">No hay fotos aquí.</p>';
  for (const f of fotos) {
    const c = document.createElement('div'); c.className = 'card';
    c.innerHTML = '<img alt="">' + '<div class="d"><b>' + esc(f.lugar_texto || f.lugar) + '</b>'
      + '<small>' + esc(f.email) + (f.nombre ? ' · ' + esc(f.nombre) : '') + '</small>'
      + '<small>Crédito: ' + (f.mostrar_nombre ? esc(f.nombre) : 'Comunidad USACH (sin nombre)') + '</small>'
      + '<small>' + f.ancho + '×' + f.alto + ' ' + esc(f.formato) + ' · ' + Math.round(f.bytes / 1024) + ' KB · subida ' + fecha(f.creada) + '</small>'
      + '<small>Estado: ' + esc(f.estado) + (f.revisor ? ' por ' + esc(f.revisor) + ' ' + fecha(f.revisada) : '') + (f.motivo ? ' · ' + esc(f.motivo) : '') + '</small></div>'
      + '<div class="acc">'
      + (f.estado === 'pendiente' || f.estado === 'retirada' ? '<button class="pub" data-a="publicar">Publicar</button>' : '')
      + (f.estado === 'pendiente' ? '<button class="rec" data-a="rechazar">Rechazar (borra la foto)</button>' : '')
      + (f.estado === 'publicada' ? '<button class="ret" data-a="retirar">Retirar</button>' : '') + '</div>';
    const im = c.querySelector('img');
    if (f.estado !== 'rechazada') { img(im, f, true); im.onclick = async () => { const d = $('ver'); await img(d.querySelector('img'), f, false); d.showModal(); }; }
    c.querySelector('.acc').onclick = async (e) => {
      const accion = e.target.dataset?.a; if (!accion) return;
      const motivo = accion === 'publicar' ? '' : prompt('Motivo (opcional; lo verá quien la subió):') ?? null;
      if (motivo === null) return;
      try { await api('/admin/decidir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: f.id, accion, motivo }) }); cargar(); }
      catch (err) { if (err.status === 401 || err.status === 403) aEntrada(err.message); else $('msg').textContent = err.message; }
    };
    $('lista').append(c);
  }
  $('reg').innerHTML = registro.length ? registro.map((r) => '<tr><td>' + fecha(r.cuando) + '</td><td>' + esc(r.accion) + '</td><td>' + esc(r.quien) + '</td><td>' + esc(r.foto.slice(0, 8)) + '</td><td>' + esc(r.detalle) + '</td></tr>').join('')
    : '<tr><td colspan="5" class="vacio">Todavía no hay nada registrado.</td></tr>';
}
function registroEn(registro) {
  $('reg').innerHTML = registro.length ? registro.map((r) => '<tr><td>' + fecha(r.cuando) + '</td><td>' + esc(r.accion) + '</td><td>' + esc(r.quien) + '</td><td>' + esc(r.foto.slice(0, 8)) + '</td><td>' + esc(r.detalle) + '</td></tr>').join('')
    : '<tr><td colspan="5" class="vacio">Todavía no hay nada registrado.</td></tr>';
}
async function cargarLugares() {
  $('msg').textContent = '';
  $('col').textContent = 'Lugar';
  let datos;
  try { datos = await (await api('/admin/lugares?estado=' + estado)).json(); }
  catch (err) {
    if (err.status === 401 || err.status === 403) return aEntrada(err.message);
    $('msg').textContent = err.message; return;
  }
  const { lugares, registro } = datos;
  $('entrar').hidden = true; $('panel').hidden = false;
  tabs();
  $('lista').innerHTML = lugares.length ? '' : '<p class="vacio">No hay lugares aquí.</p>';
  for (const l of lugares) {
    const editable = l.estado === 'pendiente' || l.estado === 'retirada';
    const c = document.createElement('div'); c.className = 'card';
    const opciones = Object.entries(CATS).map(([k, v]) => '<option value="' + esc(k) + '"' + (k === l.categoria ? ' selected' : '') + '>' + esc(v) + '</option>').join('');
    c.innerHTML = '<div class="d"><b>' + esc(l.nombre) + '</b>'
      + '<small>' + esc(CATS[l.categoria] || l.categoria) + (l.descripcion ? ' · ' + esc(l.descripcion) : '') + '</small>'
      + '<small>' + esc(l.email) + (l.cuenta ? ' · ' + esc(l.cuenta) : '') + ' · sugerido ' + fecha(l.creada) + '</small>'
      + '<small>' + l.lat.toFixed(6) + ', ' + l.lon.toFixed(6) + '</small>'
      + '<small>Estado: ' + esc(l.estado) + (l.revisor ? ' por ' + esc(l.revisor) + ' ' + fecha(l.revisada) : '') + (l.motivo ? ' · ' + esc(l.motivo) : '') + '</small></div>'
      + '<a class="mapa" target="_blank" rel="noopener" href="' + APP + '?punto=' + l.lon.toFixed(6) + ',' + l.lat.toFixed(6) + '">Ver en el mapa ↗</a>'
      + (editable ? '<div class="campos"><input name="nombre" maxlength="80" value="' + esc(l.nombre) + '" aria-label="Nombre">'
        + '<select name="categoria" aria-label="Categoría">' + opciones + '</select>'
        + '<textarea name="descripcion" maxlength="300" aria-label="Descripción" placeholder="Descripción (opcional)">' + esc(l.descripcion) + '</textarea></div>' : '')
      + '<div class="acc">'
      + (editable ? '<button class="pub" data-a="publicar">Publicar</button>' : '')
      + (l.estado === 'pendiente' ? '<button class="rec" data-a="rechazar">Rechazar</button>' : '')
      + (l.estado === 'publicada' ? '<button class="ret" data-a="retirar">Retirar del mapa</button>' : '') + '</div>';
    c.querySelector('.acc').onclick = async (e) => {
      const accion = e.target.dataset?.a; if (!accion) return;
      const motivo = accion === 'publicar' ? '' : prompt('Motivo (opcional):') ?? null;
      if (motivo === null) return;
      const cuerpo = { id: l.id, accion, motivo };
      if (accion === 'publicar') for (const k of ['nombre', 'categoria', 'descripcion']) cuerpo[k] = c.querySelector('[name="' + k + '"]').value;
      try { await api('/admin/decidir-lugar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) }); cargar(); }
      catch (err) { if (err.status === 401 || err.status === 403) aEntrada(err.message); else $('msg').textContent = err.message; }
    };
    $('lista').append(c);
  }
  registroEn(registro);
}
const CAMPOS = { nombre: 'Nombre', categoria: 'Categoría', ubicacion: 'Ubicación', detalles: 'Detalles', cerrado: 'Cerró o no está aquí' };
const CIERRES = { cerro: 'Cerró definitivamente', no_esta: 'No está en este lugar', no_existe: 'No existe o está repetido' };
const enMapa = (lon, lat, texto) => '<a target="_blank" rel="noopener" href="' + APP + '?punto=' + Number(lon).toFixed(6) + ',' + Number(lat).toFixed(6) + '">' + texto + ' ↗</a>';
async function cargarEdiciones() {
  $('msg').textContent = '';
  $('col').textContent = 'Edición';
  let datos;
  try { datos = await (await api('/admin/ediciones?estado=' + estado)).json(); }
  catch (err) {
    if (err.status === 401 || err.status === 403) return aEntrada(err.message);
    $('msg').textContent = err.message; return;
  }
  const { ediciones, registro } = datos;
  $('entrar').hidden = true; $('panel').hidden = false;
  tabs();
  $('lista').innerHTML = ediciones.length ? '' : '<p class="vacio">No hay cambios aquí.</p>';
  for (const e of ediciones) {
    let propuesta = esc(e.valor);
    if (e.campo === 'categoria') propuesta = esc(CATS[e.valor] || e.valor);
    if (e.campo === 'cerrado') propuesta = esc(CIERRES[e.valor] || e.valor);
    if (e.campo === 'ubicacion') { const [x, y] = String(e.valor).split(','); propuesta = enMapa(x, y, 'Nueva ubicación'); }
    const c = document.createElement('div'); c.className = 'card';
    c.innerHTML = '<div class="d"><b>' + esc(e.lugar_texto || e.lugar) + '</b>'
      + '<small>' + enMapa(e.lon, e.lat, 'Dónde está ahora') + '</small>'
      + '<p style="margin:8px 0 4px"><b>' + esc(CAMPOS[e.campo] || e.campo) + '</b></p>'
      + (e.actual && e.campo !== 'ubicacion' ? '<small>Ahora: ' + esc(e.actual) + '</small>' : '')
      + (propuesta ? '<div>Propuesta: ' + propuesta + '</div>' : '')
      + (e.comentario ? '<small>Comentario: ' + esc(e.comentario) + '</small>' : '')
      + '<small>' + esc(e.email) + (e.cuenta ? ' · ' + esc(e.cuenta) : '') + ' · ' + fecha(e.creada) + '</small>'
      + '<small>Estado: ' + esc(e.estado) + (e.revisor ? ' por ' + esc(e.revisor) + ' ' + fecha(e.revisada) : '') + (e.motivo ? ' · ' + esc(e.motivo) : '') + '</small></div>'
      + (e.estado === 'pendiente' ? '<div class="acc"><button class="pub" data-a="aplicar">Ya lo corregí</button><button class="rec" data-a="rechazar">Rechazar</button></div>' : '');
    c.querySelector('.acc')?.addEventListener('click', async (ev) => {
      const accion = ev.target.dataset?.a; if (!accion) return;
      const motivo = accion === 'aplicar' ? '' : prompt('Motivo (opcional):') ?? null;
      if (motivo === null) return;
      try { await api('/admin/decidir-edicion', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: e.id, accion, motivo }) }); cargar(); }
      catch (err) { if (err.status === 401 || err.status === 403) aEntrada(err.message); else $('msg').textContent = err.message; }
    });
    $('lista').append(c);
  }
  registroEn(registro);
}
function iniciar() {
  if (!CLIENT_ID) { $('err').textContent = 'Falta GOOGLE_CLIENT_ID en wrangler.toml'; return; }
  google.accounts.id.initialize({ client_id: CLIENT_ID, callback: (r) => {
    token = r.credential;
    try { $('quien').textContent = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email; } catch {}
    $('err').textContent = '';
    cargar();
  } });
  google.accounts.id.renderButton($('g'), { theme: 'filled_blue', size: 'large', shape: 'pill', text: 'signin_with', logo_alignment: 'left', locale: 'es', width: 280 });
}
</script>
<script src="https://accounts.google.com/gsi/client" async onload="iniciar()"></script>
</body></html>`;
