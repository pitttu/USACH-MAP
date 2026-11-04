// Cámara con gestos estilo Mapbox:
//  1 dedo / click izq: arrastrar (el punto del suelo queda "pegado" al dedo)
//  2 dedos: pellizco = zoom, giro = rotar, arrastre vertical paralelo = inclinar
//  mouse: rueda = zoom al cursor, click der / ctrl+arrastre = rotar e inclinar, doble click = acercar
import * as THREE from 'three';

const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class MapCamera extends THREE.EventDispatcher {
  constructor(camera, dom, opts) {
    super();
    this.camera = camera;
    this.dom = dom;
    this.bounds = opts.bounds;
    this.minDist = opts.minDist ?? 30;
    this.maxDist = opts.maxDist ?? 2500;
    this.maxPitch = THREE.MathUtils.degToRad(opts.maxPitch ?? 60);
    // "Dolly zoom" hacia la vista cenital: al acercarse a mirar en vertical, la cámara se aleja y cierra su campo
    // de visión en la misma proporción. El suelo se ve igual de grande, pero la perspectiva casi desaparece
    // (no se ven los muros de los edificios de la periferia): vista "2D" como la de Mapbox.
    this.baseFov = camera.fov;                                   // campo de visión con la cámara inclinada
    this.flatFov = opts.flatFov ?? 10;                           // campo de visión mirando en vertical
    this.flatUntil = THREE.MathUtils.degToRad(opts.flatUntil ?? 30); // inclinación desde la que ya no se aplana
    this.camDist = 800; // distancia real de la cámara (dist es la equivalente con baseFov: define el zoom)
    this.target = new THREE.Vector3();
    this.dist = 800;
    this.pitch = 0;   // 0 = vista cenital
    this.bearing = 0; // 0 = norte arriba, positivo = horario (como Mapbox)

    this._ray = new THREE.Raycaster();
    this._pointers = new Map();
    this._velocity = new THREE.Vector2();
    this._anim = null;
    this._gesture = null;
    this._bind();
    this.apply();
  }

  // --- geometría -------------------------------------------------------
  apply() {
    const b = this.bounds;
    this.target.x = THREE.MathUtils.clamp(this.target.x, b.x0, b.x1);
    this.target.z = THREE.MathUtils.clamp(this.target.z, b.z0, b.z1);
    this.dist = THREE.MathUtils.clamp(this.dist, this.minDist, this.maxDist);
    this.pitch = THREE.MathUtils.clamp(this.pitch, 0, this.maxPitch);

    const t = THREE.MathUtils.smoothstep(this.pitch, 0, this.flatUntil);
    const fov = this.flatFov + (this.baseFov - this.flatFov) * t;
    const tanHalf = (f) => Math.tan(THREE.MathUtils.degToRad(f) / 2);
    this.camDist = this.dist * tanHalf(this.baseFov) / tanHalf(fov); // misma escala del suelo con otro fov

    const fx = Math.sin(this.bearing), fz = -Math.cos(this.bearing);
    const h = this.camDist * Math.sin(this.pitch);
    const cam = this.camera;
    cam.fov = fov;
    cam.position.set(this.target.x - fx * h, this.camDist * Math.cos(this.pitch), this.target.z - fz * h);
    cam.up.set(fx, 0, fz);
    if (this.pitch > 0.01) cam.up.set(0, 1, 0);
    cam.lookAt(this.target);
    // plano cercano lo más lejos posible (precisión de profundidad) sin cortar edificios de hasta ~200 m
    cam.near = Math.max(1, Math.min(this.camDist - this.dist * 0.95, this.camDist - 200));
    cam.far = this.camDist + this.dist * 6 + 4000;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    this.dispatchEvent({ type: 'change' });
  }

  groundAt(clientX, clientY, out = new THREE.Vector3()) {
    const r = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this._ray.setFromCamera(ndc, this.camera);
    // si el rayo apunta al cielo, usamos un punto lejano en el horizonte
    if (this._ray.ray.direction.y > -0.02) this._ray.ray.direction.y = -0.02;
    return this._ray.ray.intersectPlane(ground, out);
  }

  // Ejecuta una modificación manteniendo fijo el punto del suelo bajo (x, y) de pantalla
  _around(x, y, fn) {
    const before = this.groundAt(x, y);
    fn();
    this.apply();
    const after = this.groundAt(x, y);
    if (before && after) { this.target.add(before.sub(after)); this.apply(); }
  }

  // --- animación -------------------------------------------------------
  flyTo({ center, dist, pitch, bearing, duration = 1500 }) {
    const from = { x: this.target.x, z: this.target.z, d: this.dist, p: this.pitch, b: this.bearing };
    const to = {
      x: center ? center[0] : from.x, z: center ? center[1] : from.z,
      d: dist ?? from.d, p: pitch !== undefined ? THREE.MathUtils.degToRad(pitch) : from.p,
      b: bearing !== undefined ? from.b + wrapAngle(THREE.MathUtils.degToRad(bearing) - from.b) : from.b,
    };
    // si el viaje es largo respecto al zoom, alejarse a mitad de camino (efecto "vuelo")
    const travel = Math.hypot(to.x - from.x, to.z - from.z);
    const lift = Math.max(0, travel / Math.min(from.d, to.d) - 0.6) * 0.35;
    this._velocity.set(0, 0);
    this._anim = { from, to, lift, start: performance.now(), duration };
  }

  stop() { this._anim = null; this._velocity.set(0, 0); }

  // Llamar en cada frame. Devuelve true si la cámara se movió.
  tick(now) {
    if (this._anim) {
      const { from, to, lift, start, duration } = this._anim;
      const t = Math.min(1, (now - start) / duration), k = easeInOut(t);
      this.target.set(from.x + (to.x - from.x) * k, 0, from.z + (to.z - from.z) * k);
      this.dist = Math.exp(Math.log(from.d) + (Math.log(to.d) - Math.log(from.d)) * k) * (1 + lift * Math.sin(Math.PI * t));
      this.pitch = from.p + (to.p - from.p) * k;
      this.bearing = from.b + (to.b - from.b) * k;
      if (t >= 1) { this._anim = null; this.bearing = wrapAngle(this.bearing); }
      this.apply();
      return true;
    }
    if (this._pointers.size === 0 && this._velocity.lengthSq() > 0.0001) {
      this.target.x += this._velocity.x;
      this.target.z += this._velocity.y;
      this._velocity.multiplyScalar(0.92);
      this.apply();
      return true;
    }
    return false;
  }

  // --- entrada -----------------------------------------------------------
  _bind() {
    const el = this.dom;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', (e) => this._down(e));
    el.addEventListener('pointermove', (e) => this._move(e));
    el.addEventListener('pointerup', (e) => this._up(e));
    el.addEventListener('pointercancel', (e) => this._up(e));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.stop();
      const f = Math.exp(e.deltaY * (e.deltaMode ? 0.05 : 0.0015));
      this._around(e.clientX, e.clientY, () => { this.dist *= f; });
    }, { passive: false });
    el.addEventListener('dblclick', (e) => {
      const p = this.groundAt(e.clientX, e.clientY);
      if (p) this.flyTo({ center: [this.target.x + (p.x - this.target.x) * 0.5, this.target.z + (p.z - this.target.z) * 0.5], dist: this.dist / 2, duration: 500 });
    });
  }

  _down(e) {
    if (e.target.closest('.no-map')) return;
    this.dom.setPointerCapture?.(e.pointerId);
    if (this._pointers.size === 0) this._downEl = e.target; // con pointer capture, el pointerup llega al canvas
    this.stop();
    this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now() });
    this._lastMoves = [];
    const rotate = e.pointerType === 'mouse' && (e.button === 2 || e.ctrlKey || e.metaKey);
    this._gesture = this._pointers.size === 1 ? (rotate ? 'rotate' : 'pan') : 'multi';
    if (this._gesture === 'pan') this._grab = this.groundAt(e.clientX, e.clientY);
    if (this._gesture === 'multi') this._startMulti();
    clearTimeout(this._pressTimer);
    if (this._pointers.size === 1) {
      this._pressTimer = setTimeout(() => {
        const p = this._pointers.get(e.pointerId);
        if (p && Math.hypot(p.x - p.x0, p.y - p.y0) < 8) {
          this._longPressed = true;
          this.dispatchEvent({ type: 'longpress', clientX: p.x, clientY: p.y, el: this._downEl });
        }
      }, 600);
    }
    this._longPressed = false;
  }

  // Al poner el segundo dedo el modo queda sin decidir; se decide tras unos px de movimiento y queda fijo
  // hasta soltar (como Mapbox): 'pitch' = ambos dedos arrastran en vertical juntos; 'zoomrotate' = el resto
  _startMulti() {
    this._multiStart = this._multiPrev = { ...this._multiState(), t: performance.now() };
    this._multiMode = null;
  }

  _multiState() {
    const [a, b] = [...this._pointers.values()];
    return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, span: Math.hypot(b.x - a.x, b.y - a.y), angle: Math.atan2(b.y - a.y, b.x - a.x), ax: a.x, ay: a.y, bx: b.x, by: b.y };
  }

  _move(e) {
    const p = this._pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (Math.hypot(p.x - p.x0, p.y - p.y0) > 8) clearTimeout(this._pressTimer);

    if (this._gesture === 'pan' && this._grab) {
      const now = this.groundAt(e.clientX, e.clientY);
      if (!now) return;
      const d = this._grab.clone().sub(now);
      this.target.add(d);
      this.apply();
      this._lastMoves.push({ t: performance.now(), x: d.x, z: d.z });
      if (this._lastMoves.length > 6) this._lastMoves.shift();
    } else if (this._gesture === 'rotate') {
      this.bearing -= dx * 0.006;
      this.pitch -= dy * 0.006;
      this.apply();
    } else if (this._gesture === 'multi' && this._pointers.size >= 2) {
      const s = this._multiState();
      if (!this._multiMode) {
        // Regla tipo Mapbox: 'inclinar' solo si AMBOS dedos se movieron en vertical y en la misma dirección.
        // Giro/pellizco exigen un umbral mayor, porque en un celular real un dedo suele partir antes que el otro
        // y, mientras tanto, eso parece un giro con pivote. Hasta decidir, la cámara no se mueve.
        const st = this._multiStart, [pa, pb] = [...this._pointers.values()];
        const va = [pa.x - st.ax, pa.y - st.ay], vb = [pb.x - st.bx, pb.y - st.by];
        const vertical = (v) => Math.abs(v[1]) >= 5 && Math.abs(v[1]) > 1.5 * Math.abs(v[0]);
        const dCx = s.cx - st.cx, dCy = s.cy - st.cy;
        const spread = Math.abs(s.span - st.span);                        // pellizco
        const twist = Math.abs(wrapAngle(s.angle - st.angle)) * s.span / 2; // giro, en px de recorrido
        let mode = null;
        if (vertical(va) && vertical(vb) && Math.sign(va[1]) === Math.sign(vb[1]) && Math.abs(Math.sin(st.angle)) < 0.85) mode = 'pitch';
        else {
          // primeros 250 ms: umbral alto (se espera al dedo atrasado); después, bajo (el giro arranca rápido)
          const th = performance.now() - st.t < 250 ? 30 : 14;
          if (spread > th || twist > th) mode = 'zoomrotate';
          else if (Math.hypot(dCx, dCy) > th + 6 && Math.abs(dCy) < 1.5 * Math.abs(dCx)) mode = 'zoomrotate'; // desplazar
        }
        if (!mode) return;
        this._multiMode = mode;
        this.dispatchEvent({ type: 'gesturemode', mode });
        this._multiPrev = s; // se descarta la zona muerta para no dar un salto
        return;
      }
      const prev = this._multiPrev;
      this._multiPrev = s;
      if (this._multiMode === 'pitch') {
        // arrastrar hacia arriba inclina hacia el horizonte (como Mapbox)
        this.pitch -= (s.cy - prev.cy) * 0.008;
        this.apply();
      } else {
        // pan con el centroide + zoom y giro alrededor del centroide
        const before = this.groundAt(prev.cx, prev.cy);
        const after = this.groundAt(s.cx, s.cy);
        if (before && after) { this.target.add(before.sub(after)); this.apply(); }
        this._around(s.cx, s.cy, () => {
          if (s.span > 10) this.dist *= prev.span / s.span;
          // girar los dedos en sentido horario gira el mapa en sentido horario (el rumbo de la cámara disminuye)
          this.bearing -= wrapAngle(s.angle - prev.angle);
        });
      }
    }
  }

  _up(e) {
    const p = this._pointers.get(e.pointerId);
    clearTimeout(this._pressTimer);
    if (!p) return;
    this._pointers.delete(e.pointerId);
    const moved = Math.hypot(p.x - p.x0, p.y - p.y0);
    // clic derecho sin arrastrar = elegir punto (como el contextmenu de app.js); arrastrando, rota
    if (this._gesture === 'rotate' && moved < 8 && !this._longPressed) {
      this.dispatchEvent({ type: 'longpress', clientX: e.clientX, clientY: e.clientY, el: this._downEl });
    } else if (this._gesture !== 'multi' && moved < 8 && performance.now() - p.t0 < 400 && !this._longPressed) {
      this.dispatchEvent({ type: 'tap', clientX: e.clientX, clientY: e.clientY, el: this._downEl });
    }
    if (this._gesture === 'pan' && this._pointers.size === 0) {
      // inercia: promedio de los últimos movimientos recientes
      const now = performance.now(), recent = this._lastMoves.filter((m) => now - m.t < 80);
      if (recent.length) {
        const sx = recent.reduce((a, m) => a + m.x, 0) / recent.length, sz = recent.reduce((a, m) => a + m.z, 0) / recent.length;
        this._velocity.set(sx, sz);
      }
    }
    if (this._pointers.size >= 2) this._startMulti();
    else if (this._pointers.size === 1) {
      // de 2 dedos a 1: retomar pan con el dedo restante
      const [rest] = this._pointers.values();
      this._gesture = 'pan';
      this._grab = this.groundAt(rest.x, rest.y);
      this._lastMoves = [];
    } else if (this._pointers.size === 0) this._gesture = null;
  }
}
