// Posición del sol (algoritmo de SunCalc, simplificado) y paleta de luz según su altura.
import * as THREE from 'three';

const rad = Math.PI / 180, e = rad * 23.4397;

export function sunPosition(date, lat, lon) {
  const d = date.valueOf() / 864e5 - 0.5 + 2440588 - 2451545;
  const M = rad * (357.5291 + 0.98560028 * d);
  const L = M + rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) + rad * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const ra = Math.atan2(Math.sin(L) * Math.cos(e), Math.cos(L));
  const phi = rad * lat, H = rad * (280.16 + 360.9856235 * d) - rad * -lon - ra;
  const altitude = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  // SunCalc mide el azimut desde el sur hacia el oeste; lo pasamos a rumbo desde el norte (horario)
  const bearing = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) + Math.PI;
  return { altitude, bearing };
}

// Vector unitario hacia el sol en coordenadas de escena (x este, y arriba, z sur)
export function sunDirection({ altitude, bearing }, out = new THREE.Vector3()) {
  const c = Math.cos(altitude);
  return out.set(Math.sin(bearing) * c, Math.sin(altitude), -Math.cos(bearing) * c);
}

// ---------------------------------------------------------------------------
// Modelo de luz: réplica de Mapbox Standard con lightPreset "dawn" + theme "faded", que es lo que usa el
// estilo de USACH-MAP en Mapbox Studio (mapbox://styles/pittu/cmnknq7ed000401qkb02l4ec0 → imports → basemap → config).
//   ambiente:  hsl(28, 98%, 93%) × 0.75   (uniforme, sin dirección)
//   sol:       hsl(33, 98%, 77%) × 0.5    (Mapbox lo fija a 40° de altura; aquí se mueve con la hora)
// Unidades: irradiancia, donde PI = "luz plena" (en three.js una cara con albedo A e irradiancia PI se ve A).
//
// Los objetos 3D (edificios, modelos, árboles) usan su color como albedo, igual que Mapbox
// (colorBuildings = hsl(40, 15%, 91%)), y después pasan por el filtro "faded" (ver main.js).
// Las capas planas (suelo, calles, áreas) tienen como color el tono FINAL medido en Mapbox: se dividen
// por LIGHT_REF (la luz que recibe un techo) para que, iluminadas, salgan exactas.
const PI = Math.PI;
const MB_AMBIENT = new THREE.Color('hsl(28, 98%, 93%)'), MB_AMBIENT_I = 0.75;
// Mapbox declara intensidad 0.5, pero en su render el sol pesa menos frente al ambiente: 0.3 calza con las
// capturas (muros al sol y a la sombra casi del mismo tono, techos #fbdab8, muros #e5cbaf)
const MB_SUN = new THREE.Color('hsl(33, 98%, 77%)'), MB_SUN_I = 0.3;
const MB_SUN_ALT = 40 * rad;
export const LIGHT_REF = MB_AMBIENT.clone().multiplyScalar(MB_AMBIENT_I).add(MB_SUN.clone().multiplyScalar(MB_SUN_I * Math.sin(MB_SUN_ALT)));

function dayLight(alt) {
  // con el sol alto se atenúa para que un techo reciba lo mismo que con el sol de Mapbox a 40°;
  // con el sol bajo NO se refuerza (si no, los muros de frente al sol se ven demasiado brillantes)
  const sunI = MB_SUN_I * Math.min(Math.sin(MB_SUN_ALT) / Math.sin(alt), 1.0);
  const ambient = MB_AMBIENT.clone().multiplyScalar(MB_AMBIENT_I * PI);
  return {
    sun: MB_SUN.clone().multiplyScalar(sunI * PI),
    hemiSky: ambient, hemiGround: ambient.clone(),
    skyTop: new THREE.Color('#b8d2ee'), skyHorizon: new THREE.Color('#f6efe6'), night: 0, lights: 0, flat: new THREE.Color(1, 1, 1),
  };
}

// ---------------------------------------------------------------------------
// Atardecer y noche: en vez de colores de luz a ojo, cada clave dice de qué color deben verse los TECHOS, los MUROS y
// el SUELO (tono final en pantalla, como en las referencias) y de ahí sale la luz: la proporción (lineal) entre ese
// color y el mismo objeto de día, por la luz de referencia.
//  - Edificios, modelos y árboles: los techos reciben el cielo del hemisferio; los muros, el promedio del cielo y del
//    suelo (hemiGround = 2·muro − techo). El sol, bajo y cálido, agrega el tono a los muros que le dan la cara.
//  - Suelo, calles y áreas (capas planas): un tono propio, como en Mapbox, donde el suelo se oscurece hacia azul pizarra
//    y los edificios quedan café cálido, más claros: "flat" es lo que se les multiplica encima de la luz del cielo.
//   atardecer y amanecer (golden hour): edificios café rosado, suelo dorado que pasa a rosa apagado con el sol en el
//   horizonte (no azul: con el sol aún cerca se veía fuera de lugar), cielo lila con el horizonte rosado
//   hora azul: morado
//   noche: azul violeta (como Apple / Google Maps, más oscuro y menos saturado, a lo Mapbox)
// lights: cuánto se prenden las ventanas (0 de día, 1 de noche; ver mapview.js: cada piso se prende a su hora).
const DAY_GROUND = new THREE.Color('#fee5c8'), DAY_ROOF = new THREE.Color('#fbdab8'), DAY_WALL = new THREE.Color('#e5cbaf'); // de día, en pantalla
const ratio = (hex, day) => { const t = new THREE.Color(hex); return new THREE.Color(t.r / day.r, t.g / day.g, t.b / day.b); };
const toward = (hex, day) => ratio(hex, day).multiply(LIGHT_REF).multiplyScalar(PI);
function key(alt, { techo, muro, suelo, sol = '#000000', solI = 0, cielo, horizonte, noche, luces }) {
  const hemiSky = toward(techo, DAY_ROOF), wall = toward(muro, DAY_WALL);
  const hemiGround = wall.multiplyScalar(2).sub(hemiSky);
  hemiGround.setRGB(Math.max(hemiGround.r, 0), Math.max(hemiGround.g, 0), Math.max(hemiGround.b, 0));
  const g = ratio(suelo, DAY_GROUND), r = ratio(techo, DAY_ROOF), flat = new THREE.Color(g.r / r.r, g.g / r.g, g.b / r.b);
  return { alt, sun: new THREE.Color(sol).multiplyScalar(PI * solI), hemiSky, hemiGround, skyTop: new THREE.Color(cielo), skyHorizon: new THREE.Color(horizonte), night: noche, lights: luces, flat };
}
const KEYS = [ // de la noche al día; entre una y otra se mezcla, y desde DAY_FROM es luz de día
  key(-14, { techo: '#525a80', muro: '#454b72', suelo: '#1e233b', cielo: '#070b1e', horizonte: '#1a1f3c', noche: 1, luces: 1 }),
  key(-6, { techo: '#685c7c', muro: '#5a4f6e', suelo: '#3c3d5c', cielo: '#151d45', horizonte: '#3f3d5f', noche: 0.85, luces: 0.92 }),
  key(0, { techo: '#8c6e6a', muro: '#765b5c', suelo: '#6c5660', sol: '#ff8050', solI: 0.2, cielo: '#36447a', horizonte: '#8f7488', noche: 0.3, luces: 0.6 }),
  key(5, { techo: '#b8968f', muro: '#9c7b74', suelo: '#b08b78', sol: '#ffa070', solI: 0.24, cielo: '#5d74ad', horizonte: '#cfa69a', noche: 0.05, luces: 0.15 }),
];
const DAY_FROM = 12 * rad;

export function lightingAt(altitudeRad) {
  if (altitudeRad >= DAY_FROM) return dayLight(altitudeRad);
  const a = altitudeRad / rad, last = KEYS[KEYS.length - 1];
  if (a >= last.alt) return mix(last, dayLight(DAY_FROM), (a - last.alt) / (DAY_FROM / rad - last.alt));
  if (a <= KEYS[0].alt) return mix(KEYS[0], KEYS[0], 0);
  let i = 0;
  while (a > KEYS[i + 1].alt) i++;
  return mix(KEYS[i], KEYS[i + 1], (a - KEYS[i].alt) / (KEYS[i + 1].alt - KEYS[i].alt));
}

function mix(k0, k1, t) {
  t = THREE.MathUtils.clamp(t, 0, 1);
  const out = {};
  for (const key of Object.keys(k0)) if (key !== 'alt') out[key] = typeof k0[key] === 'number' ? k0[key] + (k1[key] - k0[key]) * t : k0[key].clone().lerp(k1[key], t);
  return out;
}

// Color de material para las capas planas: compensa la luz para que salga el tono final de la paleta
export const paletteMaterialColor = () => new THREE.Color(1 / LIGHT_REF.r, 1 / LIGHT_REF.g, 1 / LIGHT_REF.b);

// ---------------------------------------------------------------------------
// Paleta de noche de las construcciones (edificios y modelos; no los árboles ni el vidrio). De noche no basta con
// iluminar de azul el crema de día: se ve raro. A medida que la escena se oscurece (por luminosidad, no por hora: un
// atardecer nublado o con lluvia la activa antes) los colores pasan a esta paleta, con un tono para los techos, otro
// para los muros que le dan la cara a la luna y otro para los que no (marca los volúmenes, como Apple Maps). "matiz":
// cuánto conserva cada material su propio color (0: todos iguales; los acentos, como el rojo de la FAE, se notan un
// poco con más matiz). Colores finales en pantalla. Para probar otras, agrégalas aquí y elígelas con ?noche=<letra>.
export const NIGHT_STYLES = { // elegida con el usuario tras varias generaciones de variantes: azul cobalto (I), luego
  // con los techos claramente más oscuros que los muros y todo un poco más oscuro, en balance con el suelo (J)
  J: { nombre: 'azul cobalto', techo: '#1a2a53', muro: '#2e4477', sombra: '#223260', matiz: 0.12 },
};
export const NIGHT_DEFAULT = 'J';
// De noche, el suelo también tiene su paleta por tipo (como Apple Maps: pasto verde azulado, caminos visibles sobre el
// suelo): se reconoce cada capa por su color de día. Colores finales en pantalla. El suelo va más oscuro que los techos
// (si no, los edificios se pierden) y los caminos apenas más claros que el suelo, bajo los techos.
export const NIGHT_GROUND_BASE = '#1e233b'; // el suelo de noche cerrada (clave −14°), para los sectores (mapview.js)
export const NIGHT_GROUND = { pasto: '#133435', agua: '#15234d', camino: '#2a314f' };
// luna: desde el noroeste, a 40° (de dónde viene la luz que distingue muros de sombras)
export const MOON_DIR = sunDirection({ altitude: 40 * rad, bearing: 300 * rad });
// cuánto de "noche" hay según la oscuridad de la escena (1 − luz / luz de día): empieza cerca de las 20:40 de un día
// despejado de noviembre y está completa cerca de las 21:30
export const NIGHT_FROM = 0.83, NIGHT_TO = 0.875; // medido: 20:40 → 0,837; noche cerrada → 0,878; mediodía nublado 0,13, con lluvia 0,23
export const darkness = (L, sunUp) => {
  const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const luz = (lum(L.hemiSky) + lum(L.hemiGround)) / 2 + lum(L.sun) * Math.max(sunUp, 0) + (L.fill ? lum(L.fill) : 0);
  return 1 - luz / (lum(LIGHT_REF) * PI);
};
