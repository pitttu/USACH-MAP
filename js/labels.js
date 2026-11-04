// Etiquetas e íconos como capa DOM sobre el canvas, con colisión simple en pantalla.
// Reproduce el comportamiento de app.js: fijas siempre visibles, el resto aparece con zoom y cerca del centro.
import * as THREE from 'three';
import { toLocal } from './geo.js';

const SHEET1 = { url: 'assets/icons/spritesheet-rm.png', n: 9 };
const SHEET2 = { url: 'assets/icons/spritesheet2-rm.png', n: 6 };
const ICONS = {
  misc: [SHEET1, 8], comida: [SHEET1, 4], deporte: [SHEET1, 5], pastos: [SHEET1, 7], tienda: [SHEET1, 2],
  accesos: [SHEET1, 0], banos: [SHEET1, 1], impresiones: [SHEET1, 6],
  salud: [SHEET2, 5], radio: [SHEET2, 4], biblioteca: [SHEET2, 2], monumento: [SHEET2, 0], dispensador: [SHEET2, 3], cajero: [SHEET2, 1],
};
const COLORS = {
  deporte: '#0894ff', tienda: '#0894ff', dispensador: '#0894ff', cajero: '#0894ff',
  comida: '#fe8029', radio: '#fe8029', biblioteca: '#56707c', monumento: '#b965ff', pastos: '#15a972', salud: '#f74855',
};
const LEFT = new Set(['deporte', 'pastos']);
const TEXT_OFFSET = 16; // px desde el centro del ícono hasta el texto (1.2 em de 13.5 px, como el text-offset de Mapbox)

const v = new THREE.Vector3();
// Posición en pantalla redondeada a pixeles FÍSICOS (no a pixeles CSS): si se redondea a enteros CSS, durante el
// movimiento cada etiqueta salta de a 1 px (3 px físicos en un celular) a destiempo con el mapa y se ve "tiritona".
const px = (n) => Math.round(n * devicePixelRatio) / devicePixelRatio;

export class Labels {
  constructor(container) {
    // Dos capas (íconos debajo, textos encima): el texto de una etiqueta
    // pasa por ENCIMA del ícono de otra, aunque ese ícono no desaparezca.
    this.iconLayer = Object.assign(document.createElement('div'), { className: 'label-layer' });
    this.textLayer = Object.assign(document.createElement('div'), { className: 'label-layer' });
    container.append(this.iconLayer, this.textLayer);
    this.items = [];
    this.byEl = new WeakMap();
    this.selectedId = null;
    this.enabled = true; // apagadas desde el menú de capas: solo se ve la seleccionada
    this.emphasized = null; // lugares de la categoría abierta: su ícono se ve desde lejos, su nombre como siempre
  }

  emphasize(features) { this.emphasized = features ? new Set(features) : null; }

  add(features, { kind }) {
    for (const f of features) {
      const p = f.properties, cat = p.category || 'misc';
      const [x, z] = toLocal(...f.geometry.coordinates);
      const icon = document.createElement('div');
      icon.className = `label-icon kind-${kind}`;
      if (kind === 'metro') {
        icon.classList.add('metro');
        // como en app.js: Estación Central también es estación de EFE (logo a la izquierda del metro)
        if (p.name === 'Metro Estación Central') icon.append(Object.assign(document.createElement('div'), { className: 'label-efe' }));
      } else {
        const [sheet, idx] = ICONS[cat] || ICONS.misc;
        icon.style.backgroundImage = `url('${sheet.url}')`;
        icon.style.backgroundSize = `${sheet.n * 100}% auto`;
        icon.style.backgroundPosition = `${(idx / (sheet.n - 1)) * 100}% 0`;
      }
      const text = document.createElement('div');
      text.className = `label-text${LEFT.has(cat) ? ' left' : ''}`;
      text.textContent = p.name || p.nombre || '';
      text.style.color = COLORS[cat] || '#56707c';
      this.iconLayer.appendChild(icon);
      this.textLayer.appendChild(text);
      const item = { f, x, z, icon, text, kind, cat, tw: 0, th: 0, shown: null, textShown: null, tx: null, ty: null };
      this.byEl.set(icon, item).set(text, item);
      this.items.push(item);
    }
    requestAnimationFrame(() => this.items.forEach((it) => { it.tw = it.text.offsetWidth; it.th = it.text.offsetHeight; }));
  }

  itemFor(el) { const node = el?.closest?.('.label-icon, .label-text'); return node ? this.byEl.get(node) || null : null; }

  // zoom: equivalente al de Mapbox, center: punto del suelo al centro de la vista
  update(camera, width, height, zoom, center) {
    const baseOp = zoom < 16.5 ? 0 : Math.min(1, zoom - 16.5);
    const visible = [];
    for (const it of this.items) {
      v.set(it.x, 0, it.z).project(camera);
      const sx = (v.x * 0.5 + 0.5) * width, sy = (-v.y * 0.5 + 0.5) * height;
      let op = 1;
      if (it.kind === 'misc') {
        const d = Math.hypot(it.x - center.x, it.z - center.z);
        op = baseOp * (d > 200 ? 0 : d > 100 ? 1 - (d - 100) / 100 : 1);
      }
      // seleccionada (como updateMapHighlights en app.js): texto rojo, sin ícono (lo reemplaza el pin), siempre visible
      const selected = this.selectedId != null && it.f.properties.id === this.selectedId;
      if (selected) op = 1;
      if (selected !== !!it.selected) { it.icon.classList.toggle('selected', selected); it.text.classList.toggle('selected', selected); it.selected = selected; }
      const emphasized = !!this.emphasized?.has(it.f);
      if (!this.enabled && !selected && !emphasized) { this._set(it, false); continue; }
      const textOp = this.enabled || selected ? op : 0;
      if (emphasized) op = 1;
      if (v.z > 1 || op <= 0.02 || sx < -100 || sx > width + 100 || sy < -50 || sy > height + 50) { this._set(it, false); continue; }
      const prio = it.selected ? -1 : it.kind === 'misc' ? 2 : it.kind === 'metro' ? 0 : 1;
      visible.push({ it, sx, sy, op, textOp, prio });
    }
    // Colisión al estilo de Mapbox: los íconos nunca se ocultan (icon-allow-overlap / icon-ignore-placement);
    // solo compiten los TEXTOS: el que queda tapado se desvanece y reaparece cuando nada lo tapa.
    // Primero las prioritarias, luego las más cercanas al centro de pantalla.
    visible.sort((a, b) => a.prio - b.prio || Math.hypot(a.sx - width / 2, a.sy - height / 2) - Math.hypot(b.sx - width / 2, b.sy - height / 2));
    const placed = [];
    this.occupied = []; // íconos + textos visibles (los usa StreetLabels para no pisarlos)
    for (const c of visible) {
      const { it } = c;
      this._set(it, true, c.sx, c.sy, c.op, c.textOp);
      const ih = it.kind === 'metro' ? 13 : 21;
      this.occupied.push([c.sx - ih, c.sy - ih, c.sx + ih, c.sy + ih]);
      // caja del texto: parte a TEXT_OFFSET px del centro del ícono (text-offset 1.2em de Mapbox)
      const w = it.tw || 100, h = it.th || 16;
      const x0 = LEFT.has(it.cat) ? c.sx - TEXT_OFFSET - w : c.sx + TEXT_OFFSET;
      const r = [x0, c.sy - h / 2, x0 + w, c.sy + h / 2];
      const free = c.textOp > 0.02 && !placed.some((p) => r[0] < p[2] && r[2] > p[0] && r[1] < p[3] && r[3] > p[1]);
      if (free) { placed.push(r); this.occupied.push(r); }
      this._setText(it, free);
    }
  }

  _setText(it, show) {
    if (it.textShown === show) return;
    it.text.classList.toggle('hidden-by-collision', !show);
    it.textShown = show;
  }

  _set(it, show, x, y, op, textOp) {
    if (!show) {
      if (it.shown !== false) { it.icon.style.visibility = it.text.style.visibility = 'hidden'; it.shown = false; }
      return;
    }
    if (it.shown !== true) { it.icon.style.visibility = it.text.style.visibility = 'visible'; it.shown = true; }
    const tx = px(x), ty = px(y);
    if (tx !== it.tx || ty !== it.ty) {
      it.icon.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
      // el texto parte a TEXT_OFFSET px del centro del ícono, a la derecha (o a la izquierda en deporte/pastos)
      it.text.style.transform = `translate3d(${LEFT.has(it.cat) ? tx - TEXT_OFFSET : tx + TEXT_OFFSET}px, ${ty}px, 0)`;
      it.tx = tx; it.ty = ty;
    }
    const o = op.toFixed(2), t = textOp.toFixed(2);
    if (o !== it.op) { it.icon.style.opacity = o; it.op = o; }
    if (t !== it.textOp) { it.text.style.opacity = t; it.textOp = t; }
  }
}

// Nombres de calles al estilo Mapbox: mayúsculas espaciadas, alineados con la calle (nunca de cabeza),
// solo donde el nombre cabe en un tramo recto, repetidos cada ~250 px y sin pisar íconos ni textos de POIs.
const STREET_MIN_ZOOM = [15, 16, 16.8];  // por rango: avenidas, calles, pasajes
const STREET_SPACING = 90;               // m entre candidatos a lo largo de la calle
const STREET_REPEAT_PX = 250;            // distancia mínima en pantalla entre dos rótulos de la misma calle
const STREET_MAX_BEND = 0.2;             // rad: curvatura máxima del tramo donde va el texto

export class StreetLabels {
  constructor(container) {
    this.layer = Object.assign(document.createElement('div'), { className: 'label-layer street-layer' });
    container.prepend(this.layer); // debajo de íconos y textos de POIs
    this.anchors = [];
  }

  setData(streets) {
    for (const st of streets) {
      for (const line of st.l) {
        const pts = line.map(([lon, lat]) => toLocal(lon, lat));
        const cum = [0];
        for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
        const L = cum.at(-1);
        const geom = { pts, cum, L };
        const n = Math.max(1, Math.floor(L / STREET_SPACING));
        for (let k = 0; k < n; k++) {
          const el = document.createElement('div');
          el.className = 'street-label';
          el.textContent = st.n;
          this.layer.appendChild(el);
          this.anchors.push({ name: st.n, rank: st.r, geom, s: (k + 0.5) * (L / n), el, w: 0, h: 0, on: null });
        }
      }
    }
    requestAnimationFrame(() => this.anchors.forEach((a) => { a.w = a.el.offsetWidth; a.h = a.el.offsetHeight; }));
  }

  _at({ pts, cum }, s) {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const t = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
  }

  _screen(p, camera, width, height) {
    v.set(p[0], 0, p[1]).project(camera);
    return v.z > 1 ? null : [(v.x * 0.5 + 0.5) * width, (-v.y * 0.5 + 0.5) * height];
  }

  update(camera, width, height, zoom, occupied = []) {
    const cands = [];
    for (const a of this.anchors) {
      if (zoom < STREET_MIN_ZOOM[a.rank] || !a.w) { this._show(a, false); continue; }
      const c = this._screen(this._at(a.geom, a.s), camera, width, height);
      if (!c || c[0] < -50 || c[0] > width + 50 || c[1] < -20 || c[1] > height + 20) { this._show(a, false); continue; }
      // cuántos metros de calle ocupa el texto a esta escala
      const c2 = this._screen(this._at(a.geom, Math.min(a.geom.L, a.s + 5)), camera, width, height);
      const pxPerM = c2 ? Math.hypot(c2[0] - c[0], c2[1] - c[1]) / Math.min(5, a.geom.L - a.s || 5) : 0;
      if (pxPerM < 0.05) { this._show(a, false); continue; }
      const half = (a.w / 2 + 8) / pxPerM;
      if (a.s - half < 0 || a.s + half > a.geom.L) { this._show(a, false); continue; } // no cabe en la calle
      const A = this._at(a.geom, a.s - half), M = this._at(a.geom, a.s), B = this._at(a.geom, a.s + half);
      const bend = Math.abs(Math.atan2(Math.sin(Math.atan2(B[1] - M[1], B[0] - M[0]) - Math.atan2(M[1] - A[1], M[0] - A[0])), Math.cos(Math.atan2(B[1] - M[1], B[0] - M[0]) - Math.atan2(M[1] - A[1], M[0] - A[0]))));
      if (bend > STREET_MAX_BEND) { this._show(a, false); continue; } // tramo muy curvo
      const sa = this._screen(A, camera, width, height), sb = this._screen(B, camera, width, height);
      if (!sa || !sb) { this._show(a, false); continue; }
      let ang = Math.atan2(sb[1] - sa[1], sb[0] - sa[0]);
      if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI; // siempre legible
      cands.push({ a, c, ang, d: Math.hypot(c[0] - width / 2, c[1] - height / 2) });
    }
    // avenidas primero, luego lo más cercano al centro
    cands.sort((x, y) => x.a.rank - y.a.rank || x.d - y.d);
    const circles = [], placedByName = new Map();
    for (const { a, c, ang } of cands) {
      const same = placedByName.get(a.name) || [];
      if (same.some((p) => Math.hypot(p[0] - c[0], p[1] - c[1]) < STREET_REPEAT_PX)) { this._show(a, false); continue; }
      // el texto rotado se aproxima con círculos a lo largo de su eje
      const r = a.h / 2 + 2, n = Math.max(1, Math.ceil(a.w / (2 * r))), mine = [];
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n - 0.5;
        mine.push([c[0] + Math.cos(ang) * t * a.w, c[1] + Math.sin(ang) * t * a.w]);
      }
      const hitRect = mine.some(([x, y]) => occupied.some((q) => x + r > q[0] && x - r < q[2] && y + r > q[1] && y - r < q[3]));
      const hitText = mine.some(([x, y]) => circles.some(([u, w]) => Math.hypot(x - u, y - w) < 2 * r));
      if (hitRect || hitText) { this._show(a, false); continue; }
      circles.push(...mine);
      same.push(c); placedByName.set(a.name, same);
      this._show(a, true, c, ang);
    }
  }

  _show(a, on, c, ang) {
    if (on) a.el.style.transform = `translate3d(${px(c[0])}px, ${px(c[1])}px, 0) rotate(${ang.toFixed(4)}rad)`;
    if (a.on === on) return;
    a.el.classList.toggle('on', on);
    a.on = on;
  }
}

// Marcadores por categoría (entradas, baños, agua...): ícono de 42 px sin texto, ocultos hasta que se activa
// su chip. Igual que createSpriteMarker en app.js.
export class CategoryMarkers {
  constructor(container) {
    this.root = container;
    this.items = [];
    this.visibleCat = null;
    this.hidden = null; // marcador oculto porque el pin de selección está encima
  }

  add(category, features, iconKey) {
    const [sheet, idx] = ICONS[iconKey];
    for (const f of features) {
      const [x, z] = toLocal(...f.geometry.coordinates);
      const el = document.createElement('div');
      el.className = 'cat-marker';
      el.style.backgroundImage = `url('${sheet.url}')`;
      el.style.backgroundSize = `${sheet.n * 100}% auto`;
      el.style.backgroundPosition = `${(idx / (sheet.n - 1)) * 100}% 0`;
      this.root.appendChild(el);
      this.items.push({ f, x, z, el, category });
    }
  }

  itemFor(el) { const node = el?.closest?.('.cat-marker'); return node ? this.items.find((it) => it.el === node) : null; }

  // oculta el marcador que está en (x, z), si hay (lo tapa el pin); null = volver a mostrarlo
  hideAt(pos) {
    this.hidden = pos ? this.items.find((it) => Math.abs(it.x - pos[0]) < 0.5 && Math.abs(it.z - pos[1]) < 0.5) || null : null;
  }

  update(camera, width, height) {
    for (const it of this.items) {
      const on = it.category === this.visibleCat && it !== this.hidden;
      if (on) {
        v.set(it.x, 0, it.z).project(camera);
        const sx = (v.x * 0.5 + 0.5) * width, sy = (-v.y * 0.5 + 0.5) * height;
        if (v.z <= 1) { it.el.style.display = 'block'; it.el.style.transform = `translate3d(${px(sx)}px, ${px(sy)}px, 0)`; continue; }
      }
      it.el.style.display = 'none';
    }
  }
}

// Marcadores DOM sueltos (pin de selección, ubicación del usuario)
export class Marker {
  constructor(container, className, html = '') {
    this.el = document.createElement('div');
    this.el.className = `marker ${className}`;
    this.el.innerHTML = html;
    this.el.style.visibility = 'hidden';
    container.appendChild(this.el);
    this.pos = null;
  }
  set(x, z) { this.pos = [x, z]; }
  clear() { this.pos = null; this.el.style.visibility = 'hidden'; }
  update(camera, width, height) {
    if (!this.pos) return;
    v.set(this.pos[0], 0, this.pos[1]).project(camera);
    if (v.z > 1) { this.el.style.visibility = 'hidden'; return; }
    this.el.style.visibility = 'visible';
    this.el.style.transform = `translate3d(${px((v.x * 0.5 + 0.5) * width)}px, ${px((-v.y * 0.5 + 0.5) * height)}px, 0)`;
  }
}
