// Panel de revisión de las fotos de la comunidad (GET /admin). Primero, una pantalla de entrada con Google (solo eso);
// el Worker solo responde a los correos de ADMINS. Dentro: los envíos por estado con quién los subió, los botones para
// publicar, rechazar (borra los archivos) o retirar una publicada, el espacio usado y el registro de todo lo que pasó.
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
    <p class="sub">Fotos de la comunidad · USACH Map</p>
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
    <nav id="tabs"></nav>
    <div id="lista" class="grid"></div>
    <h2 style="font-size:16px;margin-top:28px">Registro</h2>
    <table><thead><tr><th>Cuándo</th><th>Acción</th><th>Quién</th><th>Foto</th><th>Detalle</th></tr></thead><tbody id="reg"></tbody></table>
  </main>
</div>
<dialog id="ver" onclick="this.close()"><img alt=""></dialog>
<script>
const CLIENT_ID = ${JSON.stringify(clientId)};
let token = null, estado = 'pendiente';
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
function tabs() { $('tabs').innerHTML = Object.entries(TABS).map(([k, v]) => '<button data-e="' + k + '"' + (k === estado ? ' class="on"' : '') + '>' + v + '</button>').join(''); }
$('tabs').onclick = (e) => { const k = e.target.dataset?.e; if (k) { estado = k; cargar(); } };
$('salir').onclick = () => aEntrada();
async function cargar() {
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
