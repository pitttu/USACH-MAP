// Nubes del modo nublado: el mismo concepto que las de la pantalla de carga (ui.css, .nube): cúmulos hechos de
// bocanadas blancas, más grises en su base, que van a la deriva. Aquí flotan sobre la ciudad (NUBES.alto) y el sol
// sigue: las sombras de los edificios siguen nítidas y además pasan las sombras suaves de las nubes por el suelo.
//  - Cada nube es un grupo de bocanadas (billboards instanciados, un solo draw call), en un dominio de NUBES.dominio m
//    alrededor del campus que se repite: el viento las corre y al salir por un lado entran por el otro (con fundido).
//  - Las cercanas a la cámara se desvanecen (no tapan el mapa al acercarse), las lejanas llegan al horizonte.
//  - Sombras: un mapa de cobertura (canvas) con las mismas bocanadas, que los materiales leen en el fog_fragment
//    (mapview.js) proyectando cada punto hacia el sol hasta la altura de las nubes.
import * as THREE from 'three';

export const NUBES = { alto: 430, dominio: 3600, cantidad: 44, viento: [5.5, 1.8] /* m/s */, sombra: 0.14 };

function texturaBocanada() { // como .nube i: núcleo blanco, borde suave; el canal G lleva el sombreado (base más gris)
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (x + 0.5) / S * 2 - 1, dy = (y + 0.5) / S * 2 - 1, r = Math.hypot(dx, dy * 1.05);
    const a = THREE.MathUtils.smoothstep(1 - r, 0, 0.45) * 0.97; // núcleo lleno, borde suave (como .nube i)
    const luz = 1 - 0.5 * THREE.MathUtils.smoothstep(dy, -0.1, 1.0) - 0.15 * THREE.MathUtils.smoothstep(r, 0.5, 1.0); // arriba blanco, abajo y en el borde gris
    const i = (y * S + x) * 4;
    img.data[i] = 255; img.data[i + 1] = Math.round(luz * 255); img.data[i + 2] = 255; img.data[i + 3] = Math.round(a * 255);
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; return t;
}

let semilla = 7;
const azar = () => { semilla = (semilla * 16807) % 2147483647; return (semilla - 1) / 2147483646; };

export class Clouds {
  constructor(scene, centro = [0, 0]) {
    const D = NUBES.dominio, bocanadas = [];
    for (let n = 0; n < NUBES.cantidad; n++) { // cúmulo: 5–9 bocanadas en una elipse achatada, las del medio más altas
      const cx = (azar() - 0.5) * D, cz = (azar() - 0.5) * D, largo = 220 + azar() * 280, k = 6 + Math.floor(azar() * 5);
      const y0 = NUBES.alto + (azar() - 0.5) * 120;
      for (let i = 0; i < k; i++) {
        const t = (i / (k - 1) - 0.5) * 2, m = 1 - t * t;
        bocanadas.push({ x: cx + t * largo * 0.5 + (azar() - 0.5) * 40, z: cz + (azar() - 0.5) * largo * 0.35,
          y: y0 + m * 60 + azar() * 20, r: 55 + m * 70 + azar() * 35, tono: 0.55 + 0.45 * m });
      }
      // la base: bocanadas chicas y más grises a lo largo de la parte de abajo (no un disco: se veía como una esfera gris)
      for (let i = 0; i < 4; i++) {
        const t = (i / 3 - 0.5) * 1.6;
        bocanadas.push({ x: cx + t * largo * 0.5 + (azar() - 0.5) * 30, z: cz + (azar() - 0.5) * largo * 0.25, y: y0 - 15, r: 45 + azar() * 25, tono: 0.45 });
      }
    }
    this.bocanadas = bocanadas;
    // billboards instanciados
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.setAttribute('aPuff', new THREE.InstancedBufferAttribute(new Float32Array(bocanadas.flatMap((b) => [b.x, b.y, b.z, b.r])), 4));
    geo.setAttribute('aTono', new THREE.InstancedBufferAttribute(new Float32Array(bocanadas.map((b) => b.tono)), 1));
    geo.instanceCount = bocanadas.length;
    this.uniforms = {
      uMap: { value: texturaBocanada() }, uOff: { value: new THREE.Vector2() }, uCentro: { value: new THREE.Vector2(...centro) },
      uD: { value: D }, uLit: { value: new THREE.Color(1, 1, 1) }, uShade: { value: new THREE.Color(0.8, 0.83, 0.88) }, uCielo: { value: new THREE.Color(1, 1, 1) },
      uOpacity: { value: 0 }, uCamDist: { value: 1000 },
    };
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, fog: false,
      vertexShader: `attribute vec4 aPuff; attribute float aTono; uniform vec2 uOff, uCentro; uniform float uD, uCamDist; varying vec2 vUv; varying float vFade, vTono, vLejos;
        void main() {
          vec2 p = mod(aPuff.xz + uOff + uD * 0.5, uD) - uD * 0.5;           // dominio que se repite
          float borde = 1.0 - smoothstep(uD * 0.36, uD * 0.5, max(abs(p.x), abs(p.y)));
          vec3 c = vec3(uCentro.x + p.x, aPuff.y, uCentro.y + p.y);
          vec4 mv = viewMatrix * vec4(c, 1.0);
          // como en la pantalla de carga, las nubes se abren donde uno mira: abiertas al centro de la pantalla y
          // densas hacia los bordes (y las muy cercanas a la cámara no tapan el mapa)
          vec4 cc = projectionMatrix * mv; vec2 ndc = cc.xy / max(cc.w, 1.0);
          float abre = smoothstep(0.35, 0.95, length(ndc * vec2(1.0, 0.8)));
          mv.xy += position.xy * aPuff.w * vec2(1.6, 0.8);                     // de cara a la cámara, achatada (no una pelota)
          float d = -mv.z;
          vFade = borde * abre * smoothstep(uCamDist * 0.12, uCamDist * 0.4, d);
          vLejos = smoothstep(uCamDist * 1.2, uCamDist * 3.5, -mv.z);        // a lo lejos se funden con el cielo
          vUv = uv; vTono = aTono; gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `uniform sampler2D uMap; uniform vec3 uLit, uShade; uniform vec3 uCielo; uniform float uOpacity; varying vec2 vUv; varying float vFade, vTono, vLejos;
        void main() {
          vec4 t = texture2D(uMap, vUv);
          float a = t.a * uOpacity * vFade; if (a < 0.004) discard;
          vec3 col = mix(uShade, uLit, mix(t.g, 1.0, 0.35) * mix(vTono, 1.0, 0.4)); // sombreado suave: nunca gris oscuro
          gl_FragColor = vec4(mix(col, uCielo, vLejos * 0.7), a * (1.0 - 0.5 * vLejos));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.coverage = this._mapaCobertura();
    this.off = new THREE.Vector2();
  }

  _mapaCobertura() { // las mismas bocanadas vistas desde arriba (con su repetición), para las sombras
    const S = 512, D = NUBES.dominio, c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
    let sem = 11; const rnd = () => { sem = (sem * 16807) % 2147483647; return (sem - 1) / 2147483646; };
    const manchas = this.bocanadas.flatMap((b) => Array.from({ length: 4 }, () => ({
      x: b.x + (rnd() - 0.5) * b.r * 0.9, z: b.z + (rnd() - 0.5) * b.r * 0.9, r: b.r * (0.35 + rnd() * 0.3) })));
    for (const b of manchas) for (const ox of [-S, 0, S]) for (const oz of [-S, 0, S]) {
      const x = ((b.x / D + 0.5) * S) + ox, z = ((b.z / D + 0.5) * S) + oz, r = b.r / D * S;
      const gr = g.createRadialGradient(x, z, 0, x, z, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.22)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(x - r, z - r, 2 * r, 2 * r);
    }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace;
    return t;
  }

  // amount 0..1 (clima), dt en ms, color de la luz del día (0 de noche .. 1 de día) y tinte del cielo
  update(amount, dt, camDist, dia, cielo) {
    this.mesh.visible = amount > 0.01;
    if (!this.mesh.visible) return false;
    const s = dt / 1000;
    this.off.x = (this.off.x + NUBES.viento[0] * s) % NUBES.dominio;
    this.off.y = (this.off.y + NUBES.viento[1] * s) % NUBES.dominio;
    const u = this.uniforms;
    u.uOff.value.copy(this.off); u.uCamDist.value = camDist; u.uOpacity.value = 0.8 * amount;
    // de día blancas con la base gris azulada; de noche se apagan hacia el color del cielo (azul oscuro)
    const noche = 1 - dia;
    u.uLit.value.setRGB(1, 1, 1).lerp(cielo, 0.12 + 0.6 * noche).multiplyScalar(0.06 + 0.94 * dia);
    u.uCielo.value.copy(cielo);
    u.uShade.value.setRGB(0.78, 0.81, 0.87).lerp(cielo, 0.1 + 0.6 * noche).multiplyScalar(0.04 + 0.96 * dia);
    return true;
  }
}
