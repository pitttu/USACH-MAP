// Alto estable de la app. Instalada a pantalla completa (manifest: display fullscreen), Android achica la ventana un
// momento cada vez que se muestra la barra de estado (deslizando desde arriba) y la agranda al esconderse. Si la app se
// rearmara con cada cambio (el lienzo del mapa se borra al cambiar de tamaño, la hoja y la barra de abajo se mueven), se
// verían franjas negras mientras redibuja. Por eso, a pantalla completa el alto solo crece: un achique pasajero se
// ignora y la barra de estado queda encima hasta que se va. Se vuelve a medir al cambiar el ancho (giro de pantalla) y,
// fuera de pantalla completa (navegador), sigue a la ventana como siempre.
const pantallaCompleta = matchMedia('(display-mode: fullscreen)');
// para probarlo en el Mac (Chrome no deja simular el modo de pantalla completa): ?pantalla-completa en localhost
const forzada = ['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).has('pantalla-completa');
let ancho = 0, alto = 0;
function medir() {
  if (!(pantallaCompleta.matches || forzada) || innerWidth !== ancho || !alto) { ancho = innerWidth; alto = innerHeight; }
  else alto = Math.max(alto, innerHeight);
  // el alto de la app (body) se fija aquí, antes que los demás avisos de cambio de tamaño (el mapa lee el suyo de él)
  document.documentElement.style.setProperty('--vh', `${alto}px`);
}
medir();
addEventListener('resize', medir); // se registra primero (este módulo se carga antes que los demás)
pantallaCompleta.addEventListener?.('change', () => { alto = 0; medir(); });
export const appHeight = () => alto;
