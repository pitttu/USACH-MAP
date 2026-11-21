// Barra de carga de la pantalla de nubes. Muestra el avance real (la descarga del mapa, los datos y el armado de la
// escena), pero lo dibuja como recomiendan los estudios de percepción de la espera:
//  - Harrison, Amento, Kuznetsov y Bell, "Rethinking the Progress Bar" (UIST 2007): una barra que acelera hacia el
//    final se siente más rápida; las que frenan o se detienen al final, más lentas. Por eso lo que se ve es el avance
//    real con una curva que va de lento a rápido (AVANCE ** CURVA) y nunca retrocede ni se detiene en seco.
// De un solo color (gris claro, acorde a las nubes): sin las franjas hacia atrás de "Faster Progress Bars" (CHI 2010).
// Uso: const barra = barraCarga(elemento); barra.parte('mapa', 0..1) ...; await barra.completar();
// cuánto pesa cada parte del avance real. Armar la escena congela la página un par de segundos (no se puede animar
// nada): con más peso para ella, esa pausa cae hacia la mitad de la barra y no al final, donde más se nota
const PESOS = { mapa: 0.5, datos: 0.15, escena: 0.35 };
const INICIO = { hasta: 0.1, ms: 6000 }; // antes de que cargue el código, el CSS la avanza sola hasta acá (ui.css)
const CURVA = 1.6; // > 1: lo que se ve empieza más lento y termina más rápido que el avance real
const SEGUIR = 7; // 1/s: qué tan rápido lo que se ve alcanza al avance (suave, sin saltos)
const MINIMO = 0.012, ADELANTO = 0.06; // avance mínimo (por segundo) y cuánto puede ir por delante del real

export function barraCarga(el) {
  const relleno = el.querySelector('.carga-barra');
  const partes = { mapa: 0, datos: 0, escena: 0 };
  // parte desde donde la dejó la animación del CSS, que se apaga (nunca retrocede)
  let visto = Math.min(1, performance.now() / INICIO.ms) * INICIO.hasta, ultimo = performance.now(), raf = 0, alTerminar = null, fin = 0;
  el.classList.add('con-js');
  const real = () => Object.entries(PESOS).reduce((s, [k, w]) => s + w * partes[k], 0);
  function cuadro(now) {
    const dt = Math.min(0.1, (now - ultimo) / 1000); ultimo = now;
    if (fin) { // listo: termina acelerando (nunca frenando al final)
      const t = (now - fin) / 1000;
      visto = Math.min(1, visto + (0.8 + 6 * t) * dt);
    } else {
      // sigue al avance real (con la curva) sin retroceder; si el real se demora, igual avanza despacio (sin pasarlo
      // por más de ADELANTO), para que no parezca trabada
      const meta = real() ** CURVA;
      visto = Math.max(visto, visto + (meta - visto) * (1 - Math.exp(-SEGUIR * dt)), Math.min(visto + MINIMO * dt, meta + ADELANTO, 0.95));
    }
    relleno.style.clipPath = `inset(0 ${((1 - visto) * 100).toFixed(2)}% 0 0 round 999px)`;
    el.setAttribute('aria-valuenow', String(Math.round(visto * 100)));
    if (visto >= 1 && alTerminar) { const f = alTerminar; alTerminar = null; f(); }
    raf = requestAnimationFrame(cuadro);
  }
  raf = requestAnimationFrame(cuadro);
  return {
    parte(nombre, v) { partes[nombre] = Math.max(partes[nombre], Math.min(1, v)); },
    // todo listo: espera a que la barra llegue al final (un instante si ya iba cerca) y la apaga con la llegada
    completar() {
      for (const k of Object.keys(partes)) partes[k] = 1;
      fin = performance.now();
      return new Promise((ok) => { alTerminar = () => { setTimeout(() => cancelAnimationFrame(raf), 600); ok(); }; });
    },
  };
}
