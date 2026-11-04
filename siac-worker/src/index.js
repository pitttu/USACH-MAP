// Importar el horario de SIAC desde la app publicada (GitHub Pages). Cloudflare Worker: el mismo trabajo que
// tools/siac.py hace en el servidor local, para que funcione sin el Mac.
//   POST /horario  { rut, clave }  ->  { alumno, carrera, periodo, cursos, clases }  |  { error }
// Inicia sesión en SIAC con el RUT y la clave del alumno, lee su horario, cierra la sesión y lo devuelve. La clave
// solo viaja a SIAC: no se guarda ni se registra (este código no escribe logs).
// Solo responde a los orígenes de ALLOWED_ORIGINS (wrangler.toml) y limita los intentos por IP (binding LIMITER).

const BASE = 'https://baker.usach.cl/siacusach2';
const TIMEOUT = 20000;
const DAYS = 'LMWJVS'; // lunes, martes, miércoles (W), jueves, viernes, sábado
const TYPES = { TEORIA: 'T', EJERCICIO: 'E', LABORATORIO: 'L', TALLER: 'TA', AYUDANTIA: 'A' };
const LOWER = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'a', 'en', 'al', 'para', 'por', 'con']);
const ROMAN = /^(I|II|III|IV|V|VI|VII|VIII|IX|X)$/;

class SiacError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const cors = allowed.includes(origin)
      ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' }
      : {};
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors } });

    const url = new URL(request.url);
    if (url.pathname !== '/horario') return json(404, { error: 'No encontrado' });
    if (!cors['Access-Control-Allow-Origin']) return json(403, { error: 'Origen no permitido' });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json(405, { error: 'Método no permitido' });

    try {
      // a lo más 5 intentos por minuto por IP: el endpoint recibe claves, no debe servir para probarlas a la fuerza
      const ip = request.headers.get('CF-Connecting-IP') || 'desconocida';
      if (env.LIMITER) {
        const { success } = await env.LIMITER.limit({ key: ip });
        if (!success) throw new SiacError(429, 'Demasiados intentos. Espera un minuto');
      }
      const raw = await request.text();
      if (!raw || raw.length > 2048) throw new SiacError(400, 'Solicitud inválida');
      let body;
      try { body = JSON.parse(raw); } catch { throw new SiacError(400, 'Solicitud inválida'); }
      return json(200, await horario(String(body?.rut ?? ''), String(body?.clave ?? '')));
    } catch (e) {
      if (e instanceof SiacError) return json(e.status, { error: e.message });
      return json(502, { error: `No se pudo conectar con SIAC (${e?.name || 'Error'})` });
    }
  },
};

// --- SIAC ---
function splitRut(rut) {
  const s = String(rut).replace(/[\s.-]/g, '').toUpperCase().replace(/^0+/, '');
  if (!/^\d{6,8}[\dK]$/.test(s)) throw new SiacError(400, 'RUT inválido');
  const num = s.slice(0, -1), dv = s.slice(-1);
  let total = 0, k = 2;
  for (const d of [...num].reverse()) { total += Number(d) * k; k = k === 7 ? 2 : k + 1; }
  const r = 11 - (total % 11);
  if (dv !== (r === 11 ? '0' : r === 10 ? 'K' : String(r))) throw new SiacError(400, 'El dígito verificador del RUT no calza');
  return [num, dv];
}

// Sesión con cookies y redirecciones a mano (fetch en un Worker no guarda cookies entre llamadas)
function session() {
  const jar = new Map();
  async function go(path, init = {}) {
    let url = new URL(path, BASE + '/').href, method = init.method || 'GET', body = init.body;
    for (let i = 0; i < 6; i++) {
      const headers = { 'User-Agent': 'Mozilla/5.0 (USACH-MAP)', Accept: 'text/html' };
      if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
      if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded';
      const r = await fetch(url, { method, body, headers, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT) });
      for (const c of r.headers.getSetCookie?.() || []) {
        const [pair] = c.split(';');
        const eq = pair.indexOf('=');
        if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
      const loc = r.headers.get('Location');
      if (r.status >= 300 && r.status < 400 && loc) {
        url = new URL(loc, url).href;
        method = 'GET';
        body = undefined;
        continue;
      }
      return { url, text: await r.text() };
    }
    throw new SiacError(502, 'SIAC redirigió demasiadas veces');
  }
  return go;
}

async function horario(rut, clave) {
  const [num, dv] = splitRut(rut);
  if (!clave || clave.length < 4) throw new SiacError(400, 'Clave inválida');
  clave = clave.slice(0, 9); // SIAC corta la clave a 9 caracteres en su formulario
  const go = session();
  try {
    const login = stripComments((await go('')).text);
    const cu = login.match(/name="cu" value="([^"]*)"/)?.[1] || '';
    const form = new URLSearchParams({ rut_aux: '', clv: '', passwd: clave, tipoLogin: 'AL', rut: num, dig: dv, ua: 'login', cu });
    const r = await go('login/estudiante/login.action', { method: 'POST', body: form.toString() });
    if (!r.url.includes('inicio.action')) {
      const t = r.text.toLowerCase();
      if (t.includes('bloque')) throw new SiacError(423, 'SIAC bloqueó el usuario. Desbloquéalo en SIAC y reintenta');
      throw new SiacError(401, 'RUT o clave incorrectos');
    }
    const page = (await go('app/estudiante/horario-clases.action')).text;
    return parseHorario(page, r.text);
  } finally {
    try { await go('app/logout.action'); } catch { /* la sesión vence sola */ }
  }
}

// --- lectura de la página (igual que parse_horario de tools/siac.py) ---
const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '');
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', ntilde: 'ñ', Ntilde: 'Ñ', uuml: 'ü', Uuml: 'Ü' };
const unescape = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e] ?? m));
const text = (f) => unescape(f.replace(/<[^>]+>/g, ' ')).trim();

function nice(s) {
  const words = s.replace(/\s+/g, ' ').trim().toLowerCase().split(' ');
  return words.map((w, i) => (ROMAN.test(w.toUpperCase()) ? w.toUpperCase() : i && LOWER.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
}

function parseHorario(page, inicio = '') {
  page = stripComments(page);
  const per = page.match(/Horario de clases\s*([\d/]+)/);
  if (!per) throw new SiacError(502, 'SIAC respondió una página inesperada');
  const periodo = per[1];
  const car = page.match(/<small>\s*\d+\s*-\s*([\s\S]*?)\s*(?:\(|<\/small>)/);
  const carrera = car ? nice(text(car[1])) : '';
  const al = inicio.match(/datos-personales\.action"[^>]*>([\s\S]*?)<\/a>/);
  const alumno = al ? nice(text(al[1])) : '';

  // la página trae la grilla y la lista dos veces (escritorio y celular): basta la de escritorio
  const desktop = page.split('visible-xs')[0];
  const bloques = [...desktop.matchAll(/<td[^>]*>\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*<\/td>/g)].map((m) => [m[1], m[2]]);

  const cursos = new Map(), clases = [];
  for (const [, item] of desktop.matchAll(/<div class="content"[^>]*>([\s\S]*?)<\/div>/g)) {
    const head = item.match(/\[(\w+)\]\s*([^<]+)/);
    if (!head) continue;
    const code = head[1], name = nice(text(head[2]));
    const doc = item.match(/Docente\(s\):\s*([^<]*)/);
    const docentes = doc ? text(doc[1]).split(/\s*[,/]\s*/).filter((d) => d.trim()).map(nice) : [];
    if (!cursos.has(code)) cursos.set(code, { codigo: code, nombre: name, docentes: [] });
    const curso = cursos.get(code);
    for (const [, t, horas] of item.matchAll(/is-subtitle-horario">\s*([A-ZÁÉÍÓÚÑ]+)\s*:\s*([^<]*)/g)) {
      const tipo = TYPES[t.normalize('NFD').replace(/[̀-ͯ]/g, '')] || t.slice(0, 2);
      for (const d of docentes) if (!curso.docentes.includes(d)) curso.docentes.push(d);
      for (const [, dia, bloque, sala] of horas.matchAll(/([LMWJVS])(\d{1,2})\s*(?:\(([^)]*)\))?/g)) {
        const b = Number(bloque);
        const clase = { curso: code, tipo, dia: DAYS.indexOf(dia) + 1, bloque: b, sala: (sala || '').trim() || null, docentes };
        if (b >= 1 && b <= bloques.length) [clase.inicio, clase.fin] = bloques[b - 1];
        clases.push(clase);
      }
    }
  }
  clases.sort((a, b) => a.dia - b.dia || a.bloque - b.bloque);
  return { periodo, carrera, alumno, cursos: [...cursos.values()], clases };
}
