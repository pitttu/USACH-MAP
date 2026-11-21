// Cuenta de Google @usach.cl (Google Identity Services) y el Worker de la comunidad (fotos-worker/), compartidos por
// "Agregar foto" (fotos.js) y "Sugerir un lugar" (sugerir.js). La biblioteca de Google se carga recién al pedir el
// botón de entrar. El token de Google solo se guarda en memoria (dura una hora).

// Worker de la comunidad y cliente OAuth de Google (tipo "Aplicación web"; no es secreto)
export const FOTOS_WORKER = 'https://usach-fotos.siac-worker.workers.dev';
export const GOOGLE_CLIENT_ID = '781404416776-8o58a4sb4fbpsk5rhvnkk451dgig9jtl.apps.googleusercontent.com';
export const DOMINIO = 'usach.cl';
// en el Mac se puede probar contra `wrangler dev` con ?fotos-api=http://127.0.0.1:8787 (solo en localhost)
const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
export const API = (LOCAL && new URLSearchParams(location.search).get('fotos-api')) || FOTOS_WORKER;
export const PRUEBA = LOCAL && new URLSearchParams(location.search).get('fotos-prueba'); // "correo:nombre" (wrangler dev con PRUEBA_SIN_GOOGLE)

let session = null; // { token, email, name, exp }
const payload = (t) => JSON.parse(decodeURIComponent(escape(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))));

// la sesión, si le queda más de un minuto
export function sesion() {
  if (!session && PRUEBA) {
    const [email, name] = PRUEBA.split(':');
    session = { token: `prueba:${email}:${name || ''}`, email, name, exp: Date.now() / 1000 + 3600 };
  }
  return session && session.exp * 1000 > Date.now() + 60e3 ? session : null;
}
export function salir() { session = null; }

// Dibuja el botón "Acceder con Google" en el elemento. alEntrar() cuando entra con una cuenta @usach.cl;
// alError(texto) si es de otro dominio o no carga la biblioteca.
let gisP = null, avisar = null;
export function botonGoogle(el, alEntrar, alError) {
  avisar = ({ credential }) => {
    let p;
    try { p = payload(credential); } catch { alError('No se pudo leer tu sesión'); return; }
    if (p.hd !== DOMINIO) { alError(`Usa tu cuenta @${DOMINIO}: ${p.email} no es de la Universidad`); return; }
    session = { token: credential, email: p.email, name: p.name, exp: p.exp };
    alEntrar();
  };
  gisP ||= new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = ok; s.onerror = fail;
    document.head.append(s);
  }).then(() => google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, hd: DOMINIO, callback: (r) => avisar?.(r), context: 'signin', ux_mode: 'popup' }));
  gisP.then(() => google.accounts.id.renderButton(el, { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', locale: 'es', width: 280 }))
    .catch(() => { gisP = null; alError('No se pudo cargar el inicio de sesión de Google. Revisa tu conexión.'); });
}
