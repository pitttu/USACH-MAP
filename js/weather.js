// Clima: estado real desde Open-Meteo (gratis, sin API key) o forzado desde la UI, con transiciones suaves.
// Efectos: nubes (clouds.js), lluvia (gotas gruesas en GPU), suelo mojado con charcos, salpicaduras al acercarse,
// relámpagos y bruma.
// Nublado no apaga el sol: se ve con la luz de despejado, colores vivos y sombras definidas, más una bruma leve en
// altura ("haze", ver HAZE en mapview.js) y los cúmulos con sus sombras. Con llovizna, lluvia y tormenta es lo mismo:
// las nubes (más y más grises según la lluvia) en vez de la luz difusa gris de antes; el sol solo se atenúa un poco.
import * as THREE from 'three';
import { LAT0, LON0 } from './geo.js';

const API = `https://api.open-meteo.com/v1/forecast?latitude=${LAT0}&longitude=${LON0}`
  + '&current=temperature_2m,precipitation,weather_code,cloud_cover,is_day&timezone=America%2FSantiago';
const REFRESH_MS = 15 * 60 * 1000; // Open-Meteo actualiza cada 15 min

// cloud: 0 despejado .. 1 cubierto (luz gris, sin sol) · rain: intensidad 0..1 · drizzle: gota fina · storm: relámpagos
// fog: niebla (acerca la niebla de distancia) · haze: bruma leve en altura, sin tocar la luz (nublado)
// nubes: cúmulos a la deriva sobre la ciudad con sus sombras (clouds.js); el sol sigue (nublado)
export const PRESETS = {
  despejado: { label: 'Despejado', cloud: 0, rain: 0, drizzle: 0, storm: 0, fog: 0, haze: 0, nubes: 0 },
  nublado: { label: 'Nublado', cloud: 0, rain: 0, drizzle: 0, storm: 0, fog: 0, haze: 0.5, nubes: 1 },
  llovizna: { label: 'Llovizna', cloud: 0.25, rain: 0.35, drizzle: 1, storm: 0, fog: 0.12, haze: 0.55, nubes: 1 },
  lluvia: { label: 'Lluvia', cloud: 0.4, rain: 0.75, drizzle: 0, storm: 0, fog: 0.2, haze: 0.6, nubes: 1 },
  tormenta: { label: 'Tormenta', cloud: 0.55, rain: 1, drizzle: 0, storm: 1, fog: 0.3, haze: 0.65, nubes: 1 },
};

// Códigos WMO (https://open-meteo.com/en/docs) -> estado
function fromWMO(code, cover) {
  const cloud = THREE.MathUtils.clamp((cover - 40) / 50, 0, 1);
  const s = (label, o) => ({ label, cloud, rain: 0, drizzle: 0, storm: 0, fog: 0, haze: 0, nubes: 0, ...o });
  // sin lluvia, las nubes no cambian la luz: solo la bruma
  if (code <= 1) return s(code === 0 ? 'Despejado' : 'Mayormente despejado', { cloud: 0, haze: cloud * 0.5, nubes: cloud * 0.4 });
  if (code === 2) return s('Parcialmente nublado', { cloud: 0, haze: cloud * 0.5, nubes: 0.35 + 0.4 * cloud });
  if (code === 3) return s('Nublado', { cloud: 0, haze: 0.5, nubes: 1 });
  if (code === 45 || code === 48) return s('Niebla', { cloud: 1, fog: 1 });
  // con lluvia: nubes (clouds.js) y el sol apenas atenuado (cloud bajo), como nublado
  const lluvia = (label, rain, o = {}) => s(label, { cloud: 0.2 + 0.35 * rain, rain, fog: 0.1 + 0.2 * rain, haze: 0.5 + 0.15 * rain, nubes: 1, ...o });
  if (code >= 51 && code <= 57) return lluvia('Llovizna', [0.25, 0.35, 0.45][Math.min(2, Math.floor((code - 51) / 2))], { drizzle: 1 });
  if (code >= 61 && code <= 67) return lluvia('Lluvia', [0.5, 0.75, 1][Math.min(2, Math.floor((code - 61) / 2))]);
  if (code >= 80 && code <= 82) return lluvia('Chubascos', [0.5, 0.75, 1][code - 80]);
  if (code >= 71 && code <= 86) return s('Nieve', { cloud: 1, fog: 0.4 }); // en Santiago casi no pasa: solo cubierto
  if (code >= 95) return lluvia('Tormenta', 1, { storm: 1 });
  return s('—');
}

// Salpicaduras: solo con la cámara a menos de SALPICA.desde m del suelo (se funden entre 70% y 100% de esa distancia)
export const SALPICA = { desde: 140 };

const KEYS = ['cloud', 'rain', 'drizzle', 'storm', 'fog', 'haze', 'nubes'];
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
    // salpicaduras en el suelo (solo de cerca, ver SALPICA): corona de gotitas y anillo en el agua
    this.splash = drops > 0 ? this._makeSplash(Math.round(drops * 0.35)) : null;
    if (this.splash) scene.add(this.splash);
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

  // tamaño del lienzo en px (el ancho de las gotas va en px)
  setResolution(w, h) { if (this.rain) this.rain.material.uniforms.uRes.value.set(w, h); }

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
        const size = THREE.MathUtils.clamp(dist * 0.7, 18, 450);
        u.uCenter.value.copy(camera.position).lerp(target, 0.35);
        u.uSize.value = size;
        u.uLen.value = size * (this.cur.drizzle > 0.5 ? 0.02 : 0.045);
        u.uSpeed.value = this.cur.drizzle > 0.5 ? 0.55 : 1.0;
        u.uWind.value.set(0.12 + 0.3 * this.cur.storm, 0.05);
        u.uTime.value = this._time;
        u.uWidth.value = this.cur.drizzle > 0.5 ? 1.6 : 2.6; // px: gotas gruesas
        u.uOpacity.value = (0.3 + 0.3 * r) * Math.min(1, r * 4);
        this.rain.count = Math.round(this._drops * THREE.MathUtils.clamp(r, 0.2, 1));
      }
    }
    if (this.splash) { // de cerca: las gotas revientan en el suelo
      const r = this.cur.rain, u = this.splash.material.uniforms;
      const cerca = 1 - THREE.MathUtils.smoothstep(dist, SALPICA.desde * 0.7, SALPICA.desde);
      this.splash.visible = r > 0.05 && cerca > 0.01;
      if (this.splash.visible) {
        u.uCenter.value.set(target.x, 0, target.z);
        u.uSize.value = THREE.MathUtils.clamp(dist * 1.6, 16, 150);
        u.uScale.value = 0.35 + dist * 0.006; // un poco más grandes de lejos, para que se alcancen a ver
        u.uTime.value = this._time;
        u.uOpacity.value = cerca * Math.min(1, r * 2.5) * (this.cur.drizzle > 0.5 ? 0.55 : 0.85);
        this.splash.count = Math.round(this._splashes * THREE.MathUtils.clamp(r, 0.25, 1));
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
    if (this.splash) this.splash.material.uniforms.uColor.value.copy(this.rain.material.uniforms.uColor.value);
    return { fogScale: 1 - 0.6 * fog, wet: Math.min(1, r * 1.6), shadows: c < 0.9, haze: this.cur.haze };
  }

  _makeRain(count) {
    // cada gota = un trazo en pantalla (cuadrilátero instanciado): de la punta a la cola, con un ancho en px, así se
    // ven gruesas a cualquier distancia. position.x: 0 punta / 1 cola ; position.y: lado (-1 / 1)
    this._drops = count;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const seeds = new Float32Array(count * 3);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 3));
    g.instanceCount = count;
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide, // el trazo puede quedar con cualquier orientación en pantalla
      uniforms: {
        uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uSize: { value: 100 }, uLen: { value: 2 }, uWidth: { value: 2.5 }, uRes: { value: new THREE.Vector2(1000, 1000) },
        uSpeed: { value: 1 }, uWind: { value: new THREE.Vector2() }, uOpacity: { value: 0 }, uColor: { value: new THREE.Color() },
      },
      vertexShader: `
        attribute vec3 aSeed;
        uniform float uTime, uSize, uLen, uSpeed, uWidth; uniform vec3 uCenter; uniform vec2 uWind, uRes;
        varying float vFade, vAcross;
        void main() {
          vec3 dir = normalize(vec3(uWind.x, -1.0, uWind.y));
          // cae a ~1 caja/segundo (velocidad aparente constante con el zoom) y se envuelve dentro de la caja
          vec3 p = fract(aSeed + dir * uTime * uSpeed * 0.9 + vec3(0.0, aSeed.x * 7.0, 0.0));
          vec3 rel = p - 0.5;
          vec3 head = uCenter + rel * uSize, tail = head - dir * uLen * (0.75 + 0.5 * aSeed.z);
          vec4 ch = projectionMatrix * viewMatrix * vec4(head, 1.0), ct = projectionMatrix * viewMatrix * vec4(tail, 1.0);
          vec4 c = position.x < 0.5 ? ch : ct;
          vec2 sh = ch.xy / max(ch.w, 0.01) * uRes * 0.5, st = ct.xy / max(ct.w, 0.01) * uRes * 0.5, d = sh - st; // en px
          vec2 n = normalize(vec2(-d.y, d.x) + 1e-6);
          c.xy += n * position.y * uWidth * 0.5 / (uRes * 0.5) * c.w;
          // se desvanecen hacia los bordes de la caja (sin cortes bruscos); la cola es más tenue
          vFade = (1.0 - smoothstep(0.3, 0.5, max(abs(rel.x), max(abs(rel.y), abs(rel.z))))) * (1.0 - position.x * 0.8);
          vAcross = position.y;
          gl_Position = c;
        }`,
      fragmentShader: `
        uniform float uOpacity; uniform vec3 uColor; varying float vFade, vAcross;
        void main() { gl_FragColor = vec4(uColor, uOpacity * vFade * (1.0 - vAcross * vAcross * 0.6)); }`,
    });
    const mesh = new THREE.Mesh(g, m);
    Object.defineProperty(mesh, 'count', { set: (n) => { g.instanceCount = n; } });
    mesh.frustumCulled = false;
    mesh.renderOrder = 50;
    mesh.visible = false;
    return mesh;
  }

  _makeSplash(count) {
    // Cada instancia es una gota que llega al suelo en un lugar al azar (cerca del centro de la vista), revienta en una
    // corona de gotitas que saltan y caen (billboard) y deja un anillo que se abre (plano en el suelo). Cada ciclo
    // (~0,6–1 s) cambia de lugar. position.xy: esquina del cuadrado (-1..1)
    this._splashes = count;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    g.instanceCount = count;
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uSize: { value: 40 }, uScale: { value: 0.4 },
        uOpacity: { value: 0 }, uColor: { value: new THREE.Color(1, 1, 1) } },
      vertexShader: `
        attribute vec4 aSeed;
        uniform float uTime, uSize, uScale; uniform vec3 uCenter;
        varying vec2 vUv; varying float vT, vCorona, vBorde;
        float hash(float n) { return fract(sin(n) * 43758.5453); }
        void main() {
          float periodo = 0.6 + 0.4 * aSeed.z, u = uTime / periodo + aSeed.w, ciclo = floor(u);
          vT = fract(u) * periodo / 0.6;                                       // 0..1 en ~0,6 s
          vec2 q = vec2(hash(ciclo * 12.9 + aSeed.x * 78.2), hash(ciclo * 39.3 + aSeed.y * 11.1)) - 0.5;
          vec3 base = vec3(uCenter.x + q.x * uSize, 0.03, uCenter.z + q.y * uSize);
          vBorde = 1.0 - smoothstep(0.3, 0.5, max(abs(q.x), abs(q.y)));
          vUv = position.xy;
          // mitad de las instancias: corona (de frente a la cámara, apoyada en el suelo); la otra: anillo en el suelo
          vCorona = step(0.5, aSeed.x);
          vec4 mv;
          if (vCorona > 0.5) {
            mv = viewMatrix * vec4(base, 1.0);
            mv.xy += vec2(position.x, position.y + 1.0) * uScale * 0.6;
          } else {
            mv = viewMatrix * vec4(base + vec3(position.x, 0.0, position.y) * uScale * 1.4, 1.0);
          }
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform float uOpacity; uniform vec3 uColor;
        varying vec2 vUv; varying float vT, vCorona, vBorde;
        void main() {
          float a = 0.0;
          if (vCorona > 0.5) {
            // corona: 6 gotitas que salen en abanico, suben y caen (parábola); al inicio, la gota que llega
            float t = vT;
            if (t < 0.12) { vec2 g = vUv - vec2(0.0, -1.0 + (0.12 - t) / 0.12 * 2.0); a = 1.0 - smoothstep(0.05, 0.11, length(g * vec2(1.6, 0.6))); }
            else {
              float s = (t - 0.12) / 0.6;
              if (s < 1.0) for (int k = 0; k < 6; k++) {
                float ang = (float(k) + 0.5) / 6.0 * 3.14159;
                vec2 v = vec2(cos(ang) * 0.9, 1.0 + sin(ang) * 0.9);
                vec2 p = vec2(0.0, -1.0) + vec2(v.x * s, (v.y * s - 2.2 * s * s));
                a = max(a, (1.0 - smoothstep(0.035, 0.07, length(vUv - p))) * (1.0 - s));
              }
            }
          } else {
            // anillo que se abre y se desvanece
            float t = vT, r = length(vUv), R = 0.15 + t * 0.85;
            a = (1.0 - smoothstep(0.0, 0.09, abs(r - R))) * (1.0 - t) * step(0.1, t) * 0.7;
          }
          a *= uOpacity * vBorde;
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor, a);
        }`,
    });
    const mesh = new THREE.Mesh(g, m);
    Object.defineProperty(mesh, 'count', { set: (n) => { g.instanceCount = n; } });
    mesh.frustumCulled = false;
    mesh.renderOrder = 49;
    mesh.visible = false;
    return mesh;
  }
}
