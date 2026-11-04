// Hoja deslizable inferior (como la de Google Maps). Es una sola: cambia de contenido (vistas) y se arrastra entre
// tres alturas: reposo (asoma solo el título de la vista), media y arriba.
//  - Cada vista (<section class="sheet-view" data-view>) tiene un título fijo (.sheet-header) y un cuerpo
//    (.sheet-body). El cuerpo se desplaza solo con la hoja arriba y vuelve al inicio al bajarla: en reposo se ve
//    siempre el título limpio.
//  - Se toma desde cualquier parte, también desde un botón: si el dedo se mueve es arrastre y el botón no se toca.
//  - Con la hoja arriba el dedo desplaza el cuerpo; si llega al inicio y sigue bajando, el mismo gesto baja la hoja.
//    Un gesto horizontal (carruseles) no la mueve.
//  - Al soltar va a la altura más cercana; un gesto rápido salta a la siguiente en esa dirección.
//  - Tocar el título con la hoja en reposo la sube a media altura. Con mouse se arrastra desde la manija o el título.
// Fija en <html> las variables --vh, --sheet-y y --full-y (ui.css las usa para la hoja y los botones del mapa).
const HANDLE = 22; // = --handle-h
const MID_FRACTION = 0.44; // alto visible a media altura, como en Google Maps
const FLICK = 0.45; // px/ms: más rápido que esto es un gesto rápido
const ORDER = ['FULL', 'MID', 'REST']; // de arriba hacia abajo

export function createSheet(el, { navEl, onChange, onMove } = {}) {
  const root = document.documentElement;
  const views = new Map([...el.querySelectorAll('.sheet-view')].map((v) => [v.dataset.view, v]));
  let view = [...views].find(([, v]) => !v.hidden)?.[0] || [...views.keys()][0];
  let state = 'REST', y = innerHeight, drag = null, suppressClick = false;
  const probe = Object.assign(document.createElement('div'), { ariaHidden: 'true' });
  probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:env(safe-area-inset-top);visibility:hidden;pointer-events:none';
  document.body.append(probe);
  const navH = () => navEl?.offsetHeight || 0;
  const part = (sel) => views.get(view)?.querySelector(sel);

  function snaps() {
    const H = innerHeight, full = probe.offsetHeight + 10;
    const rest = Math.max(full, H - navH() - HANDLE - (part('.sheet-header')?.offsetHeight || 0));
    const mid = Math.min(rest, Math.max(full + 120, H - navH() - Math.round(H * MID_FRACTION)));
    return { FULL: full, MID: mid, REST: rest };
  }
  function layout() {
    root.style.setProperty('--vh', `${innerHeight}px`);
    root.style.setProperty('--full-y', `${snaps().FULL}px`);
  }
  // onMove(y) recibe el borde superior de la hoja en cada cuadro: al arrastrar y durante la animación (que es de CSS:
  // se lee la posición real mientras dura)
  let follow = 0;
  function setY(v, animate) {
    y = v;
    el.style.transition = animate ? 'transform 0.36s cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none';
    root.style.setProperty('--sheet-y', `${v}px`);
    if (!onMove) return;
    cancelAnimationFrame(follow);
    if (!animate) { onMove(v); return; }
    const until = performance.now() + 420;
    const tick = () => {
      onMove(el.getBoundingClientRect().top);
      if (performance.now() < until) follow = requestAnimationFrame(tick);
      else onMove(y);
    };
    follow = requestAnimationFrame(tick);
  }
  function open(s, { animate = true } = {}) {
    state = s;
    el.classList.toggle('full', s === 'FULL');
    if (s !== 'FULL') { const b = part('.sheet-body'); if (b) b.scrollTop = 0; }
    setY(snaps()[s], animate);
    onChange?.(state, view);
  }
  function show(name, s = state, opts) {
    if (!views.has(name)) throw new Error(`Vista desconocida: ${name}`);
    if (name !== view) {
      views.get(view).hidden = true;
      views.get(name).hidden = false;
      view = name;
      const b = part('.sheet-body');
      if (b) b.scrollTop = 0;
      watch();
    }
    open(s, opts);
  }

  // con el cuerpo desplazado, una línea separa el título fijo de lo que corre por debajo (como Google Maps)
  for (const v of views.values()) {
    const b = v.querySelector('.sheet-body');
    b?.addEventListener('scroll', () => v.classList.toggle('scrolled', b.scrollTop > 2), { passive: true });
  }

  // si el título cambia de alto (p. ej. aparece la tarjeta de la próxima clase), la hoja se acomoda
  const ro = new ResizeObserver(() => { if (!drag && state !== 'FULL') setY(snaps()[state], true); });
  function watch() {
    ro.disconnect();
    const hd = part('.sheet-header');
    if (hd) ro.observe(hd);
  }

  // --- arrastre ---
  function begin() { root.classList.add('sheet-dragging'); }
  function moveTo(clientY, t) {
    drag.moved = true;
    const s = snaps();
    let ny = drag.from + clientY - drag.y0;
    if (ny < s.FULL) ny = s.FULL - Math.sqrt(s.FULL - ny) * 2; // resistencia pasado los extremos
    if (ny > s.REST) ny = s.REST + Math.sqrt(ny - s.REST) * 2;
    setY(ny, false);
    drag.samples.push([clientY, t]);
    if (drag.samples.length > 6) drag.samples.shift();
  }
  function end() {
    if (!drag) return;
    const d = drag;
    drag = null;
    root.classList.remove('sheet-dragging');
    if (!d.moved) return; // fue un toque, o solo se desplazó el cuerpo
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 350);
    const s = snaps(), a = d.samples[0], b = d.samples.at(-1);
    const v = a && b && b[1] > a[1] ? (b[0] - a[0]) / (b[1] - a[1]) : 0;
    let target = ORDER.reduce((best, k) => (Math.abs(s[k] - y) < Math.abs(s[best] - y) ? k : best), 'REST');
    if (v < -FLICK) target = [...ORDER].reverse().find((k) => s[k] < y - 4) || 'FULL';
    else if (v > FLICK) target = ORDER.find((k) => s[k] > y + 4) || 'REST';
    open(target);
  }

  el.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || e.target.closest('input, textarea, select')) { drag = null; return; }
    const t = e.touches[0];
    drag = { x0: t.clientX, y0: t.clientY, from: y, lastY: t.clientY, decided: false, moved: false, scrolling: false, body: e.target.closest('.sheet-body'), samples: [] };
  }, { passive: true });

  // no pasivo: mientras se arrastra la hoja se cancela el scroll nativo (si no, el impulso desplaza el cuerpo al soltar)
  document.addEventListener('touchmove', (e) => {
    if (!drag || drag.mouse) return;
    const t = e.touches[0];
    if (!drag.decided) {
      const dx = t.clientX - drag.x0, dy = t.clientY - drag.y0;
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      drag.decided = true;
      if (Math.abs(dx) > Math.abs(dy)) { drag = null; return; } // gesto horizontal: carrusel
      drag.scrolling = !!drag.body && state === 'FULL' && (dy < 0 || drag.body.scrollTop > 0);
      if (!drag.scrolling) begin();
    }
    if (drag.scrolling) {
      const down = t.clientY > drag.lastY;
      drag.lastY = t.clientY;
      if (!(down && drag.body.scrollTop <= 0)) return; // sigue desplazando el cuerpo
      drag.scrolling = false; // el cuerpo llegó arriba: desde aquí el dedo baja la hoja
      drag.y0 = t.clientY;
      drag.from = y;
      begin();
      return;
    }
    if (e.cancelable) e.preventDefault();
    moveTo(t.clientY, e.timeStamp);
  }, { passive: false });
  document.addEventListener('touchend', end);
  document.addEventListener('touchcancel', end);

  el.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !e.target.closest('.sheet-handle, .sheet-header') || e.target.closest('button, input, a, [role="button"]')) return;
    e.preventDefault();
    drag = { y0: e.clientY, from: y, decided: true, moved: false, scrolling: false, mouse: true, samples: [] };
    begin();
  });
  window.addEventListener('mousemove', (e) => { if (drag?.mouse) moveTo(e.clientY, e.timeStamp); });
  window.addEventListener('mouseup', () => { if (drag?.mouse) end(); });

  // un arrastre que termina sobre un botón no lo toca; tocar el título en reposo sube la hoja
  el.addEventListener('click', (e) => {
    if (!suppressClick) return;
    suppressClick = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);
  el.addEventListener('click', (e) => {
    if (state !== 'REST' || !e.target.closest('.sheet-header, .sheet-handle') || e.target.closest('button, a, input, [role="button"]')) return;
    open('MID');
  });

  window.addEventListener('resize', () => { layout(); if (!drag) setY(snaps()[state], false); });
  // la página nunca se desplaza (el mapa y la hoja ocupan la pantalla): el foco de un campo o un scrollIntoView del
  // navegador la correría y todo quedaría descuadrado
  window.addEventListener('scroll', () => { if (window.scrollY || window.scrollX) window.scrollTo(0, 0); }, { passive: true });
  views.forEach((v, k) => { v.hidden = k !== view; });
  layout();
  watch();
  open('REST', { animate: false });

  return {
    show,
    open,
    snapY: (s) => snaps()[s],
    body: () => part('.sheet-body'),
    get state() { return state; },
    get view() { return view; },
    get dragging() { return !!drag; },
  };
}
