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
    skyTop: new THREE.Color('#b8d2ee'), skyHorizon: new THREE.Color('#f6efe6'), night: 0,
  };
}

// Claves para sol bajo / noche (grados). Entre 2° y 12° se mezcla con dayLight().
const C = (h) => new THREE.Color(h);
const KEYS = [
  { alt: -18, sun: C('#000000'), hemiSky: C('#33415f').multiplyScalar(PI * 0.9), hemiGround: C('#1d1f2a').multiplyScalar(PI * 0.9), skyTop: C('#0b1226'), skyHorizon: C('#1d2742'), night: 1 },
  { alt: -6, sun: C('#000000'), hemiSky: C('#59608a').multiplyScalar(PI * 0.9), hemiGround: C('#46424f').multiplyScalar(PI * 0.9), skyTop: C('#1b2a55'), skyHorizon: C('#5a5878'), night: 0.8 },
  { alt: 2, sun: C('#ff9a5a').multiplyScalar(PI * 0.75), hemiSky: C('#c8bcd0').multiplyScalar(PI * 0.75), hemiGround: C('#b49a8c').multiplyScalar(PI * 0.75), skyTop: C('#6f8fc4'), skyHorizon: C('#f4b88e'), night: 0.15 },
];
const DAY_FROM = 12 * rad;

export function lightingAt(altitudeRad) {
  if (altitudeRad >= DAY_FROM) return dayLight(altitudeRad);
  const a = altitudeRad / rad;
  if (a >= KEYS[KEYS.length - 1].alt) {
    // atardecer: mezcla entre la clave dorada (2°) y la luz de día a 12°
    const t = (a - 2) / (DAY_FROM / rad - 2);
    return mix(KEYS[KEYS.length - 1], dayLight(DAY_FROM), t);
  }
  let i = 0;
  while (i < KEYS.length - 2 && a > KEYS[i + 1].alt) i++;
  return mix(KEYS[i], KEYS[i + 1], (a - KEYS[i].alt) / (KEYS[i + 1].alt - KEYS[i].alt));
}

function mix(k0, k1, t) {
  t = THREE.MathUtils.clamp(t, 0, 1);
  const out = {};
  for (const key of Object.keys(k0)) out[key] = typeof k0[key] === 'number' ? k0[key] + (k1[key] - k0[key]) * t : k0[key].clone().lerp(k1[key], t);
  return out;
}

// Color de material para las capas planas: compensa la luz para que salga el tono final de la paleta
export const paletteMaterialColor = () => new THREE.Color(1 / LIGHT_REF.r, 1 / LIGHT_REF.g, 1 / LIGHT_REF.b);
