// Clima: estado real desde Open-Meteo (gratis, sin API key) o forzado desde la UI, con transiciones suaves.
// Efectos: cielo cubierto (sin sol, luz gris), lluvia (partículas en GPU), suelo mojado y relámpagos.
import * as THREE from 'three';
import { LAT0, LON0 } from './geo.js';

const API = `https://api.open-meteo.com/v1/forecast?latitude=${LAT0}&longitude=${LON0}`
  + '&current=temperature_2m,precipitation,weather_code,cloud_cover,is_day&timezone=America%2FSantiago';
const REFRESH_MS = 15 * 60 * 1000; // Open-Meteo actualiza cada 15 min

// cloud: 0 despejado .. 1 cubierto · rain: intensidad 0..1 · drizzle: gota fina · storm: relámpagos · fog: niebla
export const PRESETS = {
  despejado: { label: 'Despejado', cloud: 0, rain: 0, drizzle: 0, storm: 0, fog: 0 },
  nublado: { label: 'Nublado', cloud: 1, rain: 0, drizzle: 0, storm: 0, fog: 0 },
  llovizna: { label: 'Llovizna', cloud: 1, rain: 0.35, drizzle: 1, storm: 0, fog: 0.2 },
  lluvia: { label: 'Lluvia', cloud: 1, rain: 0.75, drizzle: 0, storm: 0, fog: 0.35 },
  tormenta: { label: 'Tormenta', cloud: 1, rain: 1, drizzle: 0, storm: 1, fog: 0.5 },
};

// Códigos WMO (https://open-meteo.com/en/docs) -> estado
function fromWMO(code, cover) {
  const cloud = THREE.MathUtils.clamp((cover - 40) / 50, 0, 1);
  const s = (label, o) => ({ label, cloud, rain: 0, drizzle: 0, storm: 0, fog: 0, ...o });
  if (code <= 1) return s(code === 0 ? 'Despejado' : 'Mayormente despejado');
  if (code === 2) return s('Parcialmente nublado');
  if (code === 3) return s('Nublado', { cloud: 1 });
  if (code === 45 || code === 48) return s('Niebla', { cloud: 1, fog: 1 });
  if (code >= 51 && code <= 57) return s('Llovizna', { cloud: 1, rain: [0.25, 0.35, 0.45][Math.min(2, Math.floor((code - 51) / 2))], drizzle: 1, fog: 0.2 });
  if (code >= 61 && code <= 67) return s('Lluvia', { cloud: 1, rain: [0.5, 0.75, 1][Math.min(2, Math.floor((code - 61) / 2))], fog: 0.35 });
  if (code >= 80 && code <= 82) return s('Chubascos', { cloud: 1, rain: [0.5, 0.75, 1][code - 80], fog: 0.3 });
  if (code >= 71 && code <= 86) return s('Nieve', { cloud: 1, fog: 0.4 }); // en Santiago casi no pasa: solo cubierto
  if (code >= 95) return s('Tormenta', { cloud: 1, rain: 1, storm: 1, fog: 0.5 });
  return s('—');
}

const KEYS = ['cloud', 'rain', 'drizzle', 'storm', 'fog'];
const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
// contrarresta el tinte cálido global (WARM en main.js) para que el día nublado se vea gris, no beige
// (parcialmente: un día nublado en Santiago es gris tibio, no azul)
const NEUTRAL = new THREE.Color(1.0, 1 / 0.92, 1 / 0.84);

export class Weather {
  constructor(scene, { drops = 6000 } = {}) {
    this.mode = 'auto';
    this.api = null; // { state, temp, code }
    this.fetchedAt = 0; // cuándo llegó this.api (ms)
    this._pending = null; // llamada en curso: no se repite
    this.cur = { ...PRESETS.despejado };
    this.flash = 0;
    this._nextFlash = 0;
    this._time = 0;
    this.rain = drops > 0 ? this._makeRain(drops) : null;
    if (this.rain) scene.add(this.rain);
  }

  get target() {
    if (this.mode !== 'auto') return PRESETS[this.mode];
    return this.api?.state || PRESETS.despejado;
  }

  fetch() {
    this._pending ||= (async () => {
      try {
        const r = await fetch(API);
        const { current: c } = await r.json();
        this.api = { state: fromWMO(c.weather_code, c.cloud_cover), temp: Math.round(c.temperature_2m), code: c.weather_code };
        this.fetchedAt = Date.now();
      } catch (e) {
        console.warn('Clima no disponible', e);
      } finally {
        this._pending = null;
      }
      return this.api;
    })();
    return this._pending;
  }

  // Pide el clima solo si no hay uno de hace menos de maxAge (Open-Meteo actualiza cada 15 min): prender, apagar y
  // volver a prender "Hora y clima" no repite la llamada.
  refreshIfStale(maxAge = REFRESH_MS) {
    if (this.api && Date.now() - this.fetchedAt < maxAge) return Promise.resolve(this.api);
    return this.fetch();
  }

  startAutoRefresh(onUpdate) {
    const run = () => this.fetch().then(onUpdate);
    run();
    setInterval(run, REFRESH_MS);
  }

  // Avanza transiciones, gotas y relámpagos. Devuelve true si hay que seguir renderizando (animación activa).
  tick(dt, now, camera, target, dist) {
    const t = this.target, k = 1 - Math.exp(-dt / 1200); // transición de ~3 s
    let moving = false;
    for (const key of KEYS) {
      const d = t[key] - this.cur[key];
      if (Math.abs(d) > 0.002) { this.cur[key] += d * k; moving = true; } else this.cur[key] = t[key];
    }
    this._time += dt / 1000;

    // relámpagos: destello doble cada 5–14 s durante tormenta
    this.flash = 0;
    if (this.cur.storm > 0.5) {
      if (now > this._nextFlash + 400) this._nextFlash = now + 5000 + Math.random() * 9000;
      const e = now - this._nextFlash;
      if (e >= 0 && e < 400) this.flash = Math.exp(-e / 60) + (e > 160 ? 0.6 * Math.exp(-(e - 160) / 80) : 0);
    }

    if (this.rain) {
      const r = this.cur.rain, u = this.rain.material.uniforms;
      this.rain.visible = r > 0.01;
      if (this.rain.visible) {
        // caja de gotas delante de la cámara; escala con el zoom para que se vean de cerca y de lejos
        const size = THREE.MathUtils.clamp(dist * 0.7, 25, 450);
        u.uCenter.value.copy(camera.position).lerp(target, 0.35);
        u.uSize.value = size;
        u.uLen.value = size * (this.cur.drizzle > 0.5 ? 0.018 : 0.04);
        u.uSpeed.value = this.cur.drizzle > 0.5 ? 0.55 : 1.0;
        u.uWind.value.set(0.12 + 0.3 * this.cur.storm, 0.05);
        u.uTime.value = this._time;
        u.uOpacity.value = (0.22 + 0.3 * r) * Math.min(1, r * 4);
        const count = this.rain.geometry.getAttribute('aSeed').count / 2;
        this.rain.geometry.setDrawRange(0, Math.round(count * THREE.MathUtils.clamp(r, 0.15, 1)) * 2);
      }
    }
    return moving || this.cur.rain > 0.01 || this.flash > 0.001 || this.cur.storm > 0.01;
  }

  // Modifica (en el lugar) la luz calculada por sun.js según el clima actual
  apply(L) {
    const { cloud: c, rain: r, fog } = this.cur;
    L.sun.multiplyScalar(1 - 0.92 * c);
    const dim = 1 - 0.1 * c - 0.14 * r;
    // Cielo cubierto: la luz difusa igual viene sobre todo de ARRIBA. Techos más iluminados que muros
    // (si no, sin sol todo queda del mismo tono y los edificios juntos se funden en una mancha)
    const vertical = { hemiSky: 1 + 0.1 * c, hemiGround: 1 - 0.6 * c };
    for (const key of ['hemiSky', 'hemiGround']) {
      const col = L[key], l = lum(col);
      col.lerp(new THREE.Color(l, l, l).multiply(NEUTRAL), 0.6 * c).multiplyScalar(dim * vertical[key]);
      if (this.flash) col.addScalar(this.flash * 2.2);
    }
    // Luz de relleno sin sombras (la zona del cielo donde está el sol detrás de las nubes es más clara):
    // distingue los muros según hacia dónde miran
    L.fill = L.hemiSky.clone().multiplyScalar(0.3 * c);
    L.ao = 0.8 - 0.15 * c; // base de los muros más oscura con luz difusa
    for (const key of ['skyTop', 'skyHorizon']) {
      const col = L[key], l = lum(col);
      col.lerp(new THREE.Color(l, l, l * 1.03), 0.8 * c).multiplyScalar(1 - 0.25 * r);
      if (this.flash) col.addScalar(this.flash * 0.35);
    }
    // luz para las gotas (de noche se ven menos) y cuánto se acerca la niebla
    if (this.rain) this.rain.material.uniforms.uColor.value.setRGB(0.93, 0.95, 1.0).multiplyScalar(THREE.MathUtils.clamp(lum(L.hemiSky) / Math.PI * 1.8 + this.flash, 0.2, 1));
    return { fogScale: 1 - 0.6 * fog, wet: Math.min(1, r * 1.6), shadows: c < 0.9 };
  }

  _makeRain(count) {
    // cada gota = un segmento (2 vértices) con la misma semilla; aEnd = 0 punta inferior, 1 cola
    const seeds = new Float32Array(count * 6), ends = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const x = Math.random(), y = Math.random(), z = Math.random();
      seeds.set([x, y, z, x, y, z], i * 6);
      ends.set([0, 1], i * 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(seeds, 3)); // requerido por three; no se usa
    g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
    g.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false,
      uniforms: {
        uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uSize: { value: 100 }, uLen: { value: 2 },
        uSpeed: { value: 1 }, uWind: { value: new THREE.Vector2() }, uOpacity: { value: 0 }, uColor: { value: new THREE.Color() },
      },
      vertexShader: `
        attribute vec3 aSeed; attribute float aEnd;
        uniform float uTime, uSize, uLen, uSpeed; uniform vec3 uCenter; uniform vec2 uWind;
        varying float vFade;
        void main() {
          vec3 dir = normalize(vec3(uWind.x, -1.0, uWind.y));
          // cae a ~1 caja/segundo (velocidad aparente constante con el zoom) y se envuelve dentro de la caja
          vec3 p = fract(aSeed + dir * uTime * uSpeed * 0.9 + vec3(0.0, aSeed.x * 7.0, 0.0));
          vec3 rel = p - 0.5;
          vec3 world = uCenter + rel * uSize - dir * aEnd * uLen;
          // se desvanecen hacia los bordes de la caja (sin cortes bruscos)
          vFade = (1.0 - smoothstep(0.3, 0.5, max(abs(rel.x), max(abs(rel.y), abs(rel.z))))) * (1.0 - aEnd * 0.85);
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }`,
      fragmentShader: `
        uniform float uOpacity; uniform vec3 uColor; varying float vFade;
        void main() { gl_FragColor = vec4(uColor, uOpacity * vFade); }`,
    });
    const lines = new THREE.LineSegments(g, m);
    lines.frustumCulled = false;
    lines.renderOrder = 50;
    lines.visible = false;
    return lines;
  }
}
