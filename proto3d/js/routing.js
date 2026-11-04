// Dijkstra sobre paths.json (misma lógica que app.js, sin turf: todo en metros locales)
import { toLocal } from './geo.js';

class PriorityQueue {
  constructor() { this.data = []; }
  push(node, priority) {
    const d = this.data; d.push({ node, priority });
    let i = d.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (d[i].priority >= d[p].priority) break; [d[i], d[p]] = [d[p], d[i]]; i = p; }
  }
  pop() {
    const d = this.data, top = d[0], last = d.pop();
    if (d.length) {
      d[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < d.length && d[l].priority < d[m].priority) m = l;
        if (r < d.length && d[r].priority < d[m].priority) m = r;
        if (m === i) break;
        [d[i], d[m]] = [d[m], d[i]]; i = m;
      }
    }
    return top;
  }
  get size() { return this.data.length; }
}

export function buildGraph(geojson) {
  const g = new Map();
  const key = (c) => Number(c[0]).toFixed(5) + ',' + Number(c[1]).toFixed(5);
  for (const f of geojson.features) {
    const oneway = f.properties?.oneway === true, cs = f.geometry.coordinates;
    for (let i = 0; i < cs.length - 1; i++) {
      const u = key(cs[i]), w = key(cs[i + 1]);
      if (u === w) continue;
      const a = toLocal(...cs[i]), b = toLocal(...cs[i + 1]);
      const dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (!g.has(u)) g.set(u, { p: a, edges: [] });
      if (!g.has(w)) g.set(w, { p: b, edges: [] });
      g.get(u).edges.push({ to: w, dist });
      if (!oneway) g.get(w).edges.push({ to: u, dist });
    }
  }
  return g;
}

// start / end en metros locales [x, z]. Devuelve lista de puntos [x, z] o null.
export function shortestPath(g, start, end) {
  let s = null, e = null, ds = Infinity, de = Infinity;
  for (const [k, n] of g) {
    const a = Math.hypot(n.p[0] - start[0], n.p[1] - start[1]), b = Math.hypot(n.p[0] - end[0], n.p[1] - end[1]);
    if (a < ds) { ds = a; s = k; }
    if (b < de) { de = b; e = k; }
  }
  if (!s || !e) return null;
  const dist = new Map([[s, 0]]), prev = new Map(), pq = new PriorityQueue();
  pq.push(s, 0);
  while (pq.size) {
    const { node: u, priority } = pq.pop();
    if (u === e) break;
    if (priority > (dist.get(u) ?? Infinity)) continue;
    for (const { to, dist: w } of g.get(u).edges) {
      const alt = dist.get(u) + w;
      if (alt < (dist.get(to) ?? Infinity)) { dist.set(to, alt); prev.set(to, u); pq.push(to, alt); }
    }
  }
  if (!prev.has(e) && s !== e) return null;
  const path = [];
  for (let c = e; c; c = prev.get(c)) path.unshift(g.get(c).p);
  path.unshift(start);
  path.push(end);
  return path;
}

export const pathLength = (pts) => pts.reduce((acc, p, i) => (i ? acc + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);

// Índice de nodos por celdas: el nodo más cercano a un punto sin recorrer todo el grafo (lo usa places.js)
export function graphIndex(g, cell = 25) {
  const cells = new Map(), at = (x, z) => `${x},${z}`;
  for (const [key, n] of g) {
    const c = at(Math.floor(n.p[0] / cell), Math.floor(n.p[1] / cell));
    if (!cells.has(c)) cells.set(c, []);
    cells.get(c).push({ key, p: n.p });
  }
  return {
    nearest(p) {
      const cx = Math.floor(p[0] / cell), cz = Math.floor(p[1] / cell);
      let best = null, bd = Infinity;
      // anillos de celdas hacia afuera; cualquier nodo del anillo r+1 está a más de r·cell
      for (let r = 0; r < 80; r++) {
        for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
          if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
          for (const n of cells.get(at(cx + i, cz + j)) || []) {
            const d = Math.hypot(n.p[0] - p[0], n.p[1] - p[1]);
            if (d < bd) { bd = d; best = n; }
          }
        }
        if (best && bd <= r * cell) break;
      }
      return best;
    },
  };
}

// Distancia por el grafo desde un nodo a todos los demás (Dijkstra completo): Map clave -> metros
export function distancesFrom(g, start) {
  const dist = new Map([[start, 0]]), pq = new PriorityQueue();
  pq.push(start, 0);
  while (pq.size) {
    const { node: u, priority } = pq.pop();
    if (priority > dist.get(u)) continue;
    for (const { to, dist: w } of g.get(u).edges) {
      const alt = priority + w;
      if (alt < (dist.get(to) ?? Infinity)) { dist.set(to, alt); pq.push(to, alt); }
    }
  }
  return dist;
}
