// Panel de revisión de las fotos de la comunidad (GET /admin). Se entra con Google; el Worker solo responde a los
// correos de ADMINS. Muestra los envíos por estado con quién los subió, y los botones para publicar, rechazar (borra
// los archivos) o retirar una publicada; abajo, el registro de todo lo que pasó.
export const panel = (clientId) => `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fotos de la comunidad · revisión</title>
<meta name="robots" content="noindex">
<style>
  :root { --p: #007b8b; --o: #dadce0; --t2: #5e5e5e; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #1f1f1f; }
  body { margin: 0; background: #f1f3f4; }
  header { background: #fff; border-bottom: 1px solid var(--o); padding: 14px 16px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
  h1 { font-size: 18px; margin: 0; flex: 1; }
  main { max-width: 1100px; margin: 0 auto; padding: 16px; }
  nav { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
  nav button { border: 1px solid var(--o); background: #fff; border-radius: 16px; padding: 6px 14px; font: inherit; cursor: pointer; }
  nav button.on { background: #c0eaf4; border-color: #c0eaf4; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
  .card { background: #fff; border-radius: 12px; overflow: hidden; border: 1px solid var(--o); }
  .card img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; display: block; background: #e8eaed; cursor: zoom-in; }
  .card .d { padding: 10px 12px; font-size: 14px; line-height: 20px; }
  .card .d small { color: var(--t2); display: block; }
  .acc { display: flex; gap: 8px; padding: 0 12px 12px; flex-wrap: wrap; }
  .acc button { border: 0; border-radius: 18px; padding: 8px 14px; font: inherit; cursor: pointer; }
  .pub { background: var(--p); color: #fff; } .rec { background: #fce8e6; color: #b3261e; } .ret { background: #e8eaed; }
  table { width: 100%; border-collapse: collapse; background: #fff; font-size: 13px; margin-top: 24px; }
  td, th { border-bottom: 1px solid var(--o); padding: 6px 8px; text-align: left; }
  #msg { color: #b3261e; }
  .vacio { color: var(--t2); }
  dialog { padding: 0; border: 0; background: #000; } dialog img { max-width: 95vw; max-height: 90vh; display: block; }
</style></head><body>
<header><h1>Fotos de la comunidad · revisión</h1><small id="espacio"></small><div id="g"></div><span id="quien"></span></header>
<main>
  <p id="msg"></p>
  <nav id="tabs"></nav>
  <div id="lista" class="grid"></div>
  <h2 style="font-size:16px;margin-top:28px">Registro</h2>
  <table><thead><tr><th>Cuándo</th><th>Acción</th><th>Quién</th><th>Foto</th><th>Detalle</th></tr></thead><tbody id="reg"></tbody></table>
</main>
<dialog id="ver" onclick="this.close()"><img alt=""></dialog>
<script>
const CLIENT_ID = ${JSON.stringify(clientId)};
let token = null, estado = 'pendiente';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fecha = (s) => s ? new Date(s).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }) : '';
async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r;
}
async function img(el, f, mini) {
  try { el.src = URL.createObjectURL(await (await api('/admin/img/' + f.id + (mini ? '-m' : '') + '.' + f.formato)).blob()); } catch { el.alt = 'sin archivo'; }
}
const TABS = { pendiente: 'Pendientes', publicada: 'Publicadas', retirada: 'Retiradas', rechazada: 'Rechazadas', todas: 'Todas' };
function tabs() { $('tabs').innerHTML = Object.entries(TABS).map(([k, v]) => '<button data-e="' + k + '"' + (k === estado ? ' class="on"' : '') + '>' + v + '</button>').join(''); }
$('tabs').onclick = (e) => { const k = e.target.dataset?.e; if (k) { estado = k; cargar(); } };
async function cargar() {
  tabs(); $('msg').textContent = '';
  try {
    const { fotos, registro, espacio } = await (await api('/admin/lista?estado=' + estado)).json();
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
        catch (err) { $('msg').textContent = err.message; }
      };
      $('lista').append(c);
    }
    $('reg').innerHTML = registro.map((r) => '<tr><td>' + fecha(r.cuando) + '</td><td>' + esc(r.accion) + '</td><td>' + esc(r.quien) + '</td><td>' + esc(r.foto.slice(0, 8)) + '</td><td>' + esc(r.detalle) + '</td></tr>').join('');
  } catch (err) { $('msg').textContent = err.message; }
}
function iniciar() {
  if (!CLIENT_ID) { $('msg').textContent = 'Falta GOOGLE_CLIENT_ID en wrangler.toml'; return; }
  google.accounts.id.initialize({ client_id: CLIENT_ID, callback: (r) => {
    token = r.credential;
    try { $('quien').textContent = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email; } catch {}
    cargar();
  } });
  google.accounts.id.renderButton($('g'), { theme: 'outline', size: 'medium', text: 'signin_with', locale: 'es' });
  $('lista').innerHTML = '<p class="vacio">Entra con tu cuenta de Google de administrador (arriba a la derecha) para revisar las fotos.</p>';
}
</script>
<script src="https://accounts.google.com/gsi/client" async onload="iniciar()"></script>
</body></html>`;
