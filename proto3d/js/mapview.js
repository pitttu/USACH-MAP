// Motor del mapa: escena Three.js, luz, cámara, etiquetas y marcadores.
// La UI (app.js) solo usa la API de `mapView` (abajo), en lon/lat y con zoom/pitch/bearing al estilo Mapbox:
// no sabe nada de Three.js.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { fetchAsset } from './cache.js';
import { LAT0, LON0, BOUNDS, FOV, toLocal, toLonLat, zoomToDistance } from './geo.js';
import { sunPosition, sunDirection, lightingAt, paletteMaterialColor } from './sun.js';
import { MapCamera } from './controls.js';
import { Labels, StreetLabels, CategoryMarkers, Marker } from './labels.js';
import { Weather } from './weather.js';

const params = new URLSearchParams(location.search);
const isMobile = matchMedia('(pointer: coarse)').matches;
const LOW = params.get('q') === 'low';
// Funciones en pausa: el código queda completo y se reactiva aquí, o con ?dev en la URL para seguir trabajándolas.
// Mientras tanto la escena queda fija en cielo despejado a las 9:55.
export const DEV = params.has('dev');
export const FEATURES = { weather: DEV, timeOfDay: DEV };
const FIXED_TIME = [9, 55];

// ---------------------------------------------------------------- renderer
const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: !LOW, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, LOW ? 1 : 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false; // las sombras se recalculan solo cuando hace falta
renderer.toneMapping = THREE.NoToneMapping; // sin tone mapping: los colores de la paleta salen tal cual
stage.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 5000);
scene.fog = new THREE.Fog(0xffffff, 800, 3000);

// ---------------------------------------------------------------- luz
const sun = new THREE.DirectionalLight(0xffffff, 1); // intensidad va en el color (ver sun.js)
const SHADOW_SIZE = LOW ? 1024 : isMobile ? 2048 : 4096;
sun.castShadow = true;
sun.shadow.mapSize.set(SHADOW_SIZE, SHADOW_SIZE);
// bias solo para los objetos que proyectan (evita el "acné" en sus propias caras). El normalBias se ajusta al
// tamaño del texel en fitShadow. El suelo y las capas planas no proyectan, así que usan bias 0 (ver exactShadows):
// si no, la sombra empieza separada de la base del edificio ("peter panning").
sun.shadow.bias = -0.00015;
sun.shadow.normalBias = 0.3;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 1);
scene.add(hemi);
// relleno suave sin sombras para días nublados (ver weather.js); con cielo despejado queda en 0
const fill = new THREE.DirectionalLight(0x000000, 1);
scene.add(fill);
const aoUniform = { value: 0.8 };
const selectedObject = { value: 0 }; // _id del edificio/modelo resaltado (0 = ninguno)
// Marcas de revisión (?dev): color por objeto en una textura de 1 fila indexada por _id (alfa 0 = sin marca)
const marksTex = { value: new THREE.DataTexture(new Uint8Array(4), 1, 1) }, marksW = { value: 1 };
marksTex.value.needsUpdate = true;

// Cielo: domo con degradado + resplandor del sol
const skyUniforms = {
  top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() },
  sunDir: { value: new THREE.Vector3() }, sunColor: { value: new THREE.Color() },
};
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(1, 32, 16),
  new THREE.ShaderMaterial({
    uniforms: skyUniforms, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.); gl_Position = p.xyww; }`,
    fragmentShader: `uniform vec3 top, horizon, sunDir, sunColor; varying vec3 vDir;
      void main(){ vec3 d = normalize(vDir); float h = max(d.y, 0.0);
        vec3 c = mix(horizon, top, pow(h, 0.55));
        float s = max(dot(d, sunDir), 0.0); c += sunColor * (pow(s, 600.0) * 4.0 + pow(s, 12.0) * 0.25);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }),
);
sky.frustumCulled = false;
sky.renderOrder = -1;
scene.add(sky);

// ---------------------------------------------------------------- clima
const weather = new Weather(scene, { drops: LOW ? 0 : isMobile ? 3500 : 7000 });
if (!FEATURES.weather) weather.mode = 'despejado';

// ---------------------------------------------------------------- materiales
// Sombras sin bias para lo que no proyecta (suelo, calles, áreas): no pueden sombrearse a sí mismas, y con bias
// la sombra de un muro arranca unos decímetros afuera de su base
const SHADOW_VS = THREE.ShaderChunk.shadowmap_vertex.replaceAll('directionalLightShadows[ i ].shadowNormalBias', '0.0');
const SHADOW_FS = THREE.ShaderChunk.lights_fragment_begin.replaceAll('directionalLightShadow.shadowBias', '0.0');
function exactShadows(m) {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <shadowmap_vertex>', SHADOW_VS);
    sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_begin>', SHADOW_FS);
  };
  m.customProgramCacheKey = () => 'exactShadows';
  return m;
}
// Capas planas: el color de la paleta es el tono final (compensado por la luz)
const lambert = (opts = {}) => exactShadows(new THREE.MeshLambertMaterial({ vertexColors: true, color: paletteMaterialColor(), ...opts }));
// Objetos 3D: el color es albedo bajo la luz cálida, como en Mapbox, más:
//  - filtro "faded" (theme de Mapbox Standard): baja saturación y sube un poco el brillo
//  - oclusión ambiental falsa: oscurece la base de los muros (solo caras verticales) para "asentarlos"
const FADED_SAT = 0.2, FADED_GAIN = 1.28; // calibrado contra Mapbox de cerca: techos #fbdab8, muros #e5cbaf
// Tinte cálido global (todo lo que tiene luz: suelo, sectores, edificios...). En Mapbox, a zoom de calle, la luz
// "dawn" también entibia el suelo: crema #fef1e1 -> #f9e1cb, y el sector azul se ve verdoso.
const WARM = [1.0, 0.89, 0.77];
// Los vidrios (color azulado: azul muy sobre el rojo) esquivan parte del tinte cálido -> celeste más vivo, como Mapbox
const GLASS_UNWARM = 0.7;
const FADED = `outgoingLight = mix(outgoingLight, vec3(dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722))), ${FADED_SAT.toFixed(3)}) * ${FADED_GAIN.toFixed(3)};`;
THREE.ShaderChunk.opaque_fragment = `outgoingLight *= vec3(${WARM.map((v) => v.toFixed(3)).join(', ')});\n` + THREE.ShaderChunk.opaque_fragment;
function mapboxLook(opts = {}) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, ...opts });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uAO = aoUniform;
    sh.uniforms.uSel = selectedObject;
    sh.uniforms.uMarks = marksTex; sh.uniforms.uMarksW = marksW;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vWorldY;\nattribute float _id;\nvarying float vObjId;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWorldY = (modelMatrix * vec4(transformed, 1.0)).y;\nvObjId = _id;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vWorldY;\nuniform float uAO;\nfloat glassMask;\nvarying float vObjId;\nuniform float uSel;\nuniform sampler2D uMarks;\nuniform float uMarksW;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        glassMask = smoothstep(0.25, 0.45, diffuseColor.b - diffuseColor.r);
        vec4 mark = texture2D(uMarks, vec2((vObjId + 0.5) / uMarksW, 0.5));
        if (mark.a > 0.5) diffuseColor.rgb = mix(diffuseColor.rgb, mark.rgb, 0.75); // marca de revisión (?dev)
        if (uSel > 0.5 && abs(vObjId - uSel) < 0.5) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.42, 0.33), 0.5); // resaltado
        vec3 aoN = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
        float aoWall = 1.0 - smoothstep(0.5, 0.8, abs(dot(aoN, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz))));
        diffuseColor.rgb *= mix(1.0, mix(uAO, 1.0, smoothstep(0.0, 3.5, vWorldY)), aoWall);`)
      .replace('#include <opaque_fragment>', `${FADED}
        outgoingLight *= mix(vec3(1.0), 1.0 / vec3(${WARM.map((v) => v.toFixed(3)).join(', ')}), glassMask * ${GLASS_UNWARM.toFixed(2)});
        #include <opaque_fragment>`);
  };
  return m;
}
const CREASE = THREE.MathUtils.degToRad(35); // aristas más agudas que esto quedan marcadas; el resto, suave
// Superficies del suelo que se oscurecen cuando llueve (suelo mojado)
const wetMaterials = [];
const wettable = (m) => { wetMaterials.push({ m, base: m.color.clone() }); return m; };
// Capas planas del suelo: no escriben profundidad y se pintan en orden -> sin z-fighting
const flat = () => wettable(lambert({ depthWrite: false, side: THREE.DoubleSide, flatShading: true })); // algunas capas vienen con las caras hacia abajo
// Luces del modelo (conos de luz en las puertas, vanos y ampolletas de postes, ver build-glb.mjs): blanco puro sin
// iluminar ni tinte cálido, con la intensidad del color por vértice como opacidad -> el vano se ve blanco y el cono
// se desvanece de la esquina del marco hacia la hipotenusa, como luz a través de humo
function lightMaterial() {
  const m = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 color;\nvarying float vLight;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLight = color.r;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vLight;')
      .replace('#include <color_fragment>', 'diffuseColor.a *= vLight;')
      .replace('#include <opaque_fragment>', 'gl_FragColor = vec4(outgoingLight, diffuseColor.a);'); // sin WARM
  };
  return m;
}
const LAYERS = {
  base: { order: 1, mat: flat },
  areas: { order: 2, mat: flat },
  roads: { order: 4, mat: flat },
  buildings: { order: 10, mat: () => mapboxLook({ flatShading: true }), cast: true },
  // modelos con normales suavizadas (el cono del planetario no se ve facetado)
  models: { order: 10, mat: () => mapboxLook(), cast: true, smooth: true },
  trees: { order: 10, mat: () => mapboxLook({ flatShading: true }), cast: true },
  lights: { order: 11, mat: lightMaterial },
};

const groundPlane = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000).rotateX(-Math.PI / 2),
  wettable(exactShadows(new THREE.MeshLambertMaterial({ color: new THREE.Color('#fef1e1').multiply(paletteMaterialColor()), depthWrite: false }))));
groundPlane.renderOrder = 0;
groundPlane.receiveShadow = true;
scene.add(groundPlane);

// ---------------------------------------------------------------- cámara
const controls = new MapCamera(camera, stage, { bounds: BOUNDS, minDist: 40, maxDist: 2600, maxPitch: 62 });
let viewW = 1, viewH = 1;
const distForZoom = (z) => zoomToDistance(z, viewH);
const zoomForDist = (d) => 15.5 + Math.log2(distForZoom(15.5) / d);

// Margen inferior que tapa la interfaz (la hoja): el centro del mapa (lo que enfocan flyTo/jumpTo) sube a la mitad
// de lo que queda visible, como el padding de Mapbox. Corre el centro óptico (setViewOffset), no la cámara: picking,
// etiquetas y ruta siguen calzando.
let padBottom = 0;
function applyPadding() {
  if (padBottom > 0.5) camera.setViewOffset(viewW, viewH, 0, padBottom / 2, viewW, viewH);
  else camera.clearViewOffset();
}

function resize() {
  viewW = stage.clientWidth; viewH = stage.clientHeight;
  renderer.setSize(viewW, viewH);
  routeRes.value.set(viewW, viewH);
  camera.aspect = viewW / viewH;
  applyPadding();
  controls.apply();
  needsRender = true;
}

// ---------------------------------------------------------------- tiempo y sol
let simDate = new Date();
const sunVec = new THREE.Vector3();
let baseLight = null, fogScale = 1;
const timeListeners = [];
function setTime(d) {
  simDate = d;
  const pos = sunPosition(simDate, LAT0, LON0);
  sunDirection(pos, sunVec);
  baseLight = lightingAt(pos.altitude);
  sun.castShadow = pos.altitude > -0.01;
  skyUniforms.sunDir.value.copy(sunVec);
  applyLighting();
  document.body.classList.toggle('night', baseLight.night > 0.5);
  timeListeners.forEach((fn) => fn(simDate, pos));
  shadowDirty = true; needsRender = true;
}
// Luz del sol/hora + efecto del clima -> escena. Barato: se llama en cada frame mientras el clima está animado.
function applyLighting() {
  if (!baseLight) return;
  const L = {};
  for (const [k, v] of Object.entries(baseLight)) L[k] = v.clone ? v.clone() : v;
  const fx = weather.apply(L);
  sun.color.copy(L.sun);
  hemi.color.copy(L.hemiSky); hemi.groundColor.copy(L.hemiGround);
  skyUniforms.top.value.copy(L.skyTop); skyUniforms.horizon.value.copy(L.skyHorizon);
  skyUniforms.sunColor.value.copy(L.sun).multiplyScalar(sunVec.y > -0.05 ? 0.3 : 0);
  scene.fog.color.copy(L.skyHorizon);
  fogScale = fx.fogScale;
  // relleno: desde donde está el sol, pero alto (≥ 55°), como la zona clara de un cielo cubierto
  fill.color.copy(L.fill || new THREE.Color(0));
  const fd = new THREE.Vector3(sunVec.x, 0, sunVec.z);
  if (fd.lengthSq() < 1e-6) fd.set(0, 0, -1);
  fd.normalize().multiplyScalar(Math.cos(Math.PI * 0.3)).setY(Math.sin(Math.PI * 0.3));
  fill.position.copy(fd);
  aoUniform.value = L.ao ?? 0.8;
  // suelo mojado: más oscuro y apenas más frío
  for (const { m, base } of wetMaterials) m.color.copy(base).multiply(new THREE.Color(1 - 0.2 * fx.wet, 1 - 0.18 * fx.wet, 1 - 0.13 * fx.wet));
  needsRender = true;
}

// Encaja la cámara de sombras a lo que se ve (más nítido de cerca), alineada a texels para que no "tiemble"
let shadowDirty = true, shadowFit = { x: Infinity, z: Infinity, half: 0 };
function fitShadow() {
  const half = THREE.MathUtils.clamp(controls.dist * (0.55 + Math.sin(controls.pitch) * 0.9), 90, 1100);
  const t = controls.target;
  const moved = Math.hypot(t.x - shadowFit.x, t.z - shadowFit.z) > half * 0.2;
  const rescale = half > shadowFit.half * 1.25 || half < shadowFit.half * 0.75;
  if (!moved && !rescale && !shadowDirty) return;
  if (moved || rescale) shadowFit = { x: t.x, z: t.z, half: rescale ? half : shadowFit.half };
  const h = shadowFit.half, cam = sun.shadow.camera;
  cam.left = -h; cam.right = h; cam.top = h; cam.bottom = -h;
  cam.near = 1; cam.far = 3000;
  const texel = (2 * h) / SHADOW_SIZE;
  sun.shadow.normalBias = texel * 1.5;
  const cx = Math.round(shadowFit.x / texel) * texel, cz = Math.round(shadowFit.z / texel) * texel;
  sun.target.position.set(cx, 0, cz);
  sun.position.set(cx, 0, cz).addScaledVector(sunVec, 1500);
  sun.target.updateMatrixWorld();
  cam.updateProjectionMatrix();
  renderer.shadowMap.needsUpdate = true;
  shadowDirty = false;
}

// ---------------------------------------------------------------- capas DOM
const labelsLayer = document.getElementById('labels');
const labels = new Labels(labelsLayer);
const streetLabels = new StreetLabels(labelsLayer); // su capa va debajo de las de POIs
const catMarkers = new CategoryMarkers(labelsLayer);
const pin = new Marker(labelsLayer, 'pin', '<div class="active-pointer"></div>');
const userMarker = new Marker(labelsLayer, 'user', '<div class="user-location-marker"></div>');

// ---------------------------------------------------------------- sectores y ruta
let sectorsGroup = null, sectorsOn = true; // sectorsOn: el usuario los puede apagar (menú de capas)
function addSectors(geo) {
  const group = sectorsGroup = new THREE.Group();
  group.visible = baseLayer === 'mapa' && sectorsOn;
  for (const f of geo.features) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const rings of polys) {
      const toV = (r) => r.map(([lon, lat]) => { const [x, z] = toLocal(lon, lat); return new THREE.Vector2(x, -z); });
      const shape = new THREE.Shape(toV(rings[0]));
      shape.holes = rings.slice(1).map((r) => new THREE.Path(toV(r)));
      const g = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
      // color del sector al 25% sobre el suelo (calibrado contra el mapa de Mapbox), compensado para la luz cálida
      const color = new THREE.Color(f.properties.color).multiply(paletteMaterialColor());
      const m = new THREE.Mesh(g, wettable(new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false })));
      m.renderOrder = 3;
      m.receiveShadow = true;
      group.add(m);
    }
  }
  scene.add(group);
}

// ---------------------------------------------------------------- ruta
// Como la ruta de Mapbox (line-width en px, line-join/line-cap round): la línea se arma en ESPACIO DE PANTALLA
// en el shader, así mide siempre lo mismo en pixeles (con zoom e inclinación), con uniones y puntas redondas
// y borde suavizado. Tramos = rectángulos expandidos en pantalla; vértices = discos.
const ROUTE_FILL_PX = 6, ROUTE_CASING_PX = 1.6; // relleno 6 px (como app.js) + borde a cada lado
const routeRes = { value: new THREE.Vector2(1, 1) };
const ROUTE_VS = `
  attribute vec3 aA; attribute vec3 aB; attribute vec2 aCorner; // aCorner.x: 0 = A, 1 = B ; aCorner.y: lado (-1/1)
  uniform vec2 uRes; uniform float uWidth;
  varying vec2 vUV; // x: a lo largo (solo discos), y: a través, en unidades de radio
  void main() {
    vec4 ca = projectionMatrix * viewMatrix * vec4(aA, 1.0);
    vec4 cb = projectionMatrix * viewMatrix * vec4(aB, 1.0);
    vec2 sa = ca.xy / ca.w * uRes * 0.5, sb = cb.xy / cb.w * uRes * 0.5;
    float r = uWidth * 0.5 + 1.0; // +1 px para el antialias
    vec4 c; vec2 off;
    if (aA == aB) {            // disco: cuadrado centrado en el vértice
      c = ca; off = aCorner * r; vUV = aCorner;
    } else {                   // tramo: rectángulo de A a B
      vec2 dir = normalize(sb - sa), n = vec2(-dir.y, dir.x);
      c = aCorner.x < 0.5 ? ca : cb; off = n * aCorner.y * r; vUV = vec2(0.0, aCorner.y);
    }
    gl_Position = c + vec4(off / (uRes * 0.5) * c.w, 0.0, 0.0);
  }`;
const ROUTE_FS = `
  uniform vec3 uColor; uniform float uWidth; varying vec2 vUV;
  void main() {
    float d = length(vUV) * (uWidth * 0.5 + 1.0);              // distancia al eje en px
    float a = clamp(uWidth * 0.5 + 0.5 - d, 0.0, 1.0);         // borde suavizado de 1 px
    if (a <= 0.0) discard;
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }`;
function routeMaterial(color, width) {
  return new THREE.ShaderMaterial({
    uniforms: { uRes: routeRes, uWidth: { value: width }, uColor: { value: new THREE.Color(color) } },
    vertexShader: ROUTE_VS, fragmentShader: ROUTE_FS, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
  });
}
function routeGeometry(pts) {
  const A = [], B = [], C = [], idx = [];
  const quad = (a, b, corners) => { const k = A.length / 3; for (const c of corners) { A.push(...a); B.push(...b); C.push(...c); } idx.push(k, k + 1, k + 2, k, k + 2, k + 3); };
  const P = pts.map(([x, z]) => [x, 0.05, z]);
  for (let i = 1; i < P.length; i++) quad(P[i - 1], P[i], [[0, -1], [1, -1], [1, 1], [0, 1]]);
  for (const p of P) quad(p, p, [[-1, -1], [1, -1], [1, 1], [-1, 1]]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(A, 3)); // requerido por three (bounding)
  g.setAttribute('aA', new THREE.Float32BufferAttribute(A, 3));
  g.setAttribute('aB', new THREE.Float32BufferAttribute(B, 3));
  g.setAttribute('aCorner', new THREE.Float32BufferAttribute(C, 2));
  g.setIndex(idx);
  return g;
}
// limpia el recorrido: sin puntos repetidos ni zigzags de menos de 0.8 m (Douglas-Peucker)
function cleanPath(pts, tol = 0.8) {
  pts = pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 0.3);
  const dp = (a) => {
    if (a.length < 3) return a;
    const [p, q] = [a[0], a.at(-1)], dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz) || 1;
    let md = 0, mi = 0;
    for (let i = 1; i < a.length - 1; i++) { const d = Math.abs(dz * a[i][0] - dx * a[i][1] + q[0] * p[1] - q[1] * p[0]) / L; if (d > md) { md = d; mi = i; } }
    return md <= tol ? [p, q] : dp(a.slice(0, mi + 1)).slice(0, -1).concat(dp(a.slice(mi)));
  };
  return dp(pts);
}
const routeCasingMat = routeMaterial(0x2a6fd6, ROUTE_FILL_PX + 2 * ROUTE_CASING_PX);
const routeFillMat = routeMaterial(0x4285f4, ROUTE_FILL_PX);
let routeMesh = null;

// ---------------------------------------------------------------- carga
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
// Normales suaves con pliegue (lo mismo que toCreasedNormals de three: promedia las normales de los triángulos que
// comparten un vértice y no forman más de creaseAngle), pero agrupando los vértices por su posición REAL, al centímetro.
// El glb trae las posiciones cuantizadas (enteros normalizados a -1..1, con la malla escalada ×~400) y toCreasedNormals
// redondea a 0,01 de ese rango, o sea en celdas de ~4 m: promediaba vértices que no se tocan y su costo crece con el
// cuadrado de los vértices de cada celda (con el escudo de la Casa Central, ~9000 en una celda: el celular se pegaba).
function creasedNormals(geometry, creaseAngle, scale) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = g.attributes.position, count = pos.count, tris = count / 3;
  const fn = new Float32Array(tris * 3), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t < tris; t++) { // normal de cada triángulo
    a.fromBufferAttribute(pos, 3 * t); b.fromBufferAttribute(pos, 3 * t + 1); c.fromBufferAttribute(pos, 3 * t + 2);
    c.sub(b).cross(a.sub(b)).normalize();
    fn[3 * t] = c.x; fn[3 * t + 1] = c.y; fn[3 * t + 2] = c.z;
  }
  const kx = scale.x * 100, ky = scale.y * 100, kz = scale.z * 100; // celdas de 1 cm en metros
  const keys = new Array(count), groups = new Map();
  for (let i = 0; i < count; i++) {
    const h = keys[i] = `${Math.round(pos.getX(i) * kx)},${Math.round(pos.getY(i) * ky)},${Math.round(pos.getZ(i) * kz)}`;
    let l = groups.get(h); if (!l) groups.set(h, l = []); l.push((i / 3) | 0);
  }
  const out = new Float32Array(count * 3), creaseDot = Math.cos(creaseAngle);
  for (let i = 0; i < count; i++) {
    const t = (i / 3) | 0, nx = fn[3 * t], ny = fn[3 * t + 1], nz = fn[3 * t + 2];
    let sx = 0, sy = 0, sz = 0;
    for (const o of groups.get(keys[i])) {
      const ox = fn[3 * o], oy = fn[3 * o + 1], oz = fn[3 * o + 2];
      if (nx * ox + ny * oy + nz * oz > creaseDot) { sx += ox; sy += oy; sz += oz; }
    }
    const L = Math.hypot(sx, sy, sz) || 1;
    out[3 * i] = sx / L; out[3 * i + 1] = sy / L; out[3 * i + 2] = sz / L;
  }
  g.setAttribute('normal', new THREE.BufferAttribute(out, 3));
  return g;
}
async function loadModel(onProgress) {
  const t0 = performance.now();
  const streetsP = fetch('assets/streets.json').then((r) => r.json()).then((st) => streetLabels.setData(st)).catch((e) => console.warn('Sin nombres de calles', e));
  const gltf = await loader.parseAsync(await fetchAsset('assets/campus.glb', onProgress), 'assets/'); // guardado en el navegador (cache.js)
  await streetsP;
  let tris = 0;
  objectNames = gltf.scene.userData.ids || [];
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const layer = LAYERS[o.name] ? o.name : LAYERS[o.parent?.name] ? o.parent.name : 'models';
    const cfg = LAYERS[layer];
    if (['buildings', 'models', 'trees'].includes(layer)) pickable.push(o); // los árboles solo tapan
    o.userData.layer = layer;
    o.material = cfg.mat();
    o.renderOrder = cfg.order;
    o.receiveShadow = true;
    o.castShadow = !!cfg.cast;
    o.matrixAutoUpdate = false;
    // el glb no trae normales (el sombreado es plano), pero las sombras las usan para el normalBias: sin ellas da NaN
    if (cfg.smooth) { o.updateWorldMatrix(true, false); o.geometry = creasedNormals(o.geometry, CREASE, o.getWorldScale(new THREE.Vector3())); }
    else if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
    tris += o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3;
  });
  campusRoot = gltf.scene;
  applyMarks();
  campusRoot.visible = baseLayer === 'mapa';
  scene.add(gltf.scene);
  applyFlat();
  stats.load = `${Math.round(performance.now() - t0)} ms · ${(tris / 1000).toFixed(0)}k tris`;
  needsRender = true;
}

// ---------------------------------------------------------------- capa de fotogrametría
// Alternativa al mapa dibujado (botón de capas). Se descarga recién cuando alguien la elige: assets/fotogrametria.glb,
// ~19 MB, generado por tools/fotogrametria/build-fotogrametria.mjs (ya calzado con la escena y recortado).
// Lleva el filtro "faded" del mapa. La foto trae su propia luz y sombras; PHOTO_SUN le agrega además el sol de la
// escena (sombreado y sombras). Para quitarlo: PHOTO_SUN = false (o ?fotosol=0 en la URL para comparar).
const PHOTO_SUN = params.get('fotosol') !== '0';
const KTX2_TRANSCODER = 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/basis/';
let campusRoot = null, photoRoot = null, photoLoading = null, baseLayer = 'mapa', wantedLayer = 'mapa';
function photoMaterial(map) {
  // con sol: el color compensa la luz cálida (como las capas planas), así un techo al sol queda del tono de la foto
  const m = PHOTO_SUN ? new THREE.MeshLambertMaterial({ map, color: paletteMaterialColor() }) : new THREE.MeshBasicMaterial({ map });
  m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `${FADED}\n#include <opaque_fragment>`); };
  m.customProgramCacheKey = () => 'photo';
  return m;
}
function loadPhotoLayer(onProgress) {
  photoLoading ||= (async () => {
    const ktx2 = new KTX2Loader().setTranscoderPath(KTX2_TRANSCODER).detectSupport(renderer);
    const buf = await fetchAsset('assets/fotogrametria.glb', onProgress); // se baja una vez y queda guardada (cache.js)
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2).parseAsync(buf, 'assets/');
    ktx2.dispose();
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.material = photoMaterial(o.material.map);
      if (PHOTO_SUN) o.geometry.computeVertexNormals();
      o.castShadow = o.receiveShadow = PHOTO_SUN;
      o.renderOrder = 10;
      o.matrixAutoUpdate = false;
    });
    photoRoot = gltf.scene;
    photoRoot.visible = baseLayer === 'fotogrametria';
    scene.add(photoRoot);
    applyFlat();
  })();
  photoLoading.catch(() => { photoLoading = null; }); // si falla la descarga, se puede reintentar
  return photoLoading;
}
function showBaseLayer(name) {
  baseLayer = name;
  const photo = name === 'fotogrametria';
  if (campusRoot) campusRoot.visible = !photo; // los edificios ocultos siguen respondiendo al toque (raycast)
  if (sectorsGroup) sectorsGroup.visible = !photo && sectorsOn;
  if (photoRoot) photoRoot.visible = photo;
  // la ruta va pegada al suelo plano; sobre el terreno de la foto quedaría tapada: se dibuja encima
  routeCasingMat.depthTest = routeFillMat.depthTest = !photo;
  applyFlat();
  shadowDirty = true; needsRender = true;
}

// ---------------------------------------------------------------- hora y clima reales
// Interruptor del menú de capas. Apagado (al partir): cielo despejado a las 9:55 (FIXED_TIME). Prendido: la hora
// actual (sigue el reloj) y el clima real de Open-Meteo (weather.js). La hora pasa de una a otra en TIME_MS (el sol
// recorre el día) y el clima tiene su propia transición. El clima se pide al prender solo si el último tiene más de
// 15 min (refreshIfStale), y se renueva cada 15 min solo mientras está prendido; apagado no se llama a la API.
const TIME_MS = 1500;
let live = FEATURES.timeOfDay, liveTimer = 0, timeTween = null; // ?dev: ya en vivo (el panel pide el clima)
function refreshWeather() {
  if (FEATURES.weather) return; // en ?dev lo actualiza el panel
  const before = weather.fetchedAt;
  weather.refreshIfStale().then(() => { if (weather.fetchedAt !== before) emit('weather', weather.api); });
}
const fixedDate = () => { const d = new Date(); d.setHours(FIXED_TIME[0], FIXED_TIME[1], 0, 0); return d; };
function setLive(on) {
  live = !!on;
  clearInterval(liveTimer);
  if (live) {
    weather.mode = 'auto';
    refreshWeather();
    liveTimer = setInterval(() => { if (!timeTween) setTime(new Date()); refreshWeather(); }, 60000);
  } else weather.mode = 'despejado';
  timeTween = { from: simDate.getTime(), to: (live ? new Date() : fixedDate()).getTime(), t: 0 };
  needsRender = true;
}

// ---------------------------------------------------------------- edificios 3D <-> 2D
// Con los edificios 3D apagados, todo lo que sobresale del suelo se achata (escala vertical hasta FLAT) en FLAT_MS:
// edificios, modelos, árboles y conos de luz del mapa, o la fotogrametría (que así queda como una foto aérea plana).
// flatP: 0 = 3D, 1 = plano (animado hacia flatTarget en el loop).
const FLAT = 0.01, FLAT_MS = 900;
let flatP = 0, flatTarget = 0;
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
function applyFlat() {
  const f = 1 + (FLAT - 1) * ease(flatP);
  if (campusRoot) campusRoot.scale.y = f; // las capas planas están en y = 0: no cambian
  if (photoRoot) photoRoot.scale.y = f;
  shadowDirty = true; needsRender = true;
}

// ---------------------------------------------------------------- objeto bajo el dedo
// Edificios y modelos traen el atributo _id: nombre del objeto en Blender = objectNames[_id - 1] (ver build-glb.mjs)
let objectNames = [];
const pickable = [], raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
function objectAt(clientX, clientY) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects(pickable, false)[0];
  const attr = hit?.object.geometry.attributes._id;
  const id = attr && hit.face ? Math.round(attr.getX(hit.face.a)) : 0;
  return id ? { id, name: objectNames[id - 1], layer: hit.object.userData.layer } : null;
}

// Marcas de revisión: { nombre de objeto: color } (ver markObjects)
let marks = {};
function applyMarks() {
  if (!objectNames.length) return; // se aplican al cargar el modelo
  const W = objectNames.length + 1, data = new Uint8Array(W * 4);
  objectNames.forEach((name, i) => {
    if (!marks[name]) return;
    const c = new THREE.Color(marks[name]);
    data.set([c.r * 255, c.g * 255, c.b * 255, 255], (i + 1) * 4);
  });
  marksTex.value.dispose();
  marksTex.value = new THREE.DataTexture(data, W, 1); // NearestFilter por defecto: sin mezclar ids vecinos
  marksTex.value.needsUpdate = true;
  marksW.value = W;
  needsRender = true;
}

// ---------------------------------------------------------------- eventos de la cámara -> API
const listeners = {};
const emit = (type, e) => (listeners[type] || []).forEach((fn) => fn(e));
function groundLonLat(clientX, clientY) {
  const p = controls.groundAt(clientX, clientY);
  return p ? toLonLat(p.x, p.z) : null;
}
controls.addEventListener('tap', (e) => {
  const label = labels.itemFor(e.el), marker = catMarkers.itemFor(e.el);
  emit('tap', {
    lngLat: groundLonLat(e.clientX, e.clientY),
    poi: label ? { feature: label.f, kind: label.kind } : null,
    marker: marker ? { feature: marker.f, category: marker.category } : null,
    object: label || marker ? null : objectAt(e.clientX, e.clientY), // { id, name, layer } del edificio/modelo tocado
  });
});
controls.addEventListener('longpress', (e) => {
  if (labels.itemFor(e.el) || catMarkers.itemFor(e.el)) return;
  const lngLat = groundLonLat(e.clientX, e.clientY);
  if (lngLat) emit('longpress', { lngLat });
});

// ---------------------------------------------------------------- loop (render solo cuando algo cambia)
let needsRender = true, cameraChanged = true;
controls.addEventListener('change', () => { needsRender = true; cameraChanged = true; });
const stats = { fps: 0, calls: 0, load: '', gesture: '' };
controls.addEventListener('gesturemode', (e) => { stats.gesture = e.mode === 'pitch' ? 'inclinar' : 'zoom/giro'; });
let frames = 0, lastFps = performance.now(), last = performance.now();
const frameHooks = [];

function frame(now) {
  requestAnimationFrame(frame);
  const dt = now - last; last = now;
  frameHooks.forEach((fn) => fn(dt));
  if (timeTween) { // cambio de hora animado (hora y clima reales)
    timeTween.t = Math.min(1, timeTween.t + dt / TIME_MS);
    setTime(new Date(timeTween.from + (timeTween.to - timeTween.from) * ease(timeTween.t)));
    if (timeTween.t >= 1) timeTween = null;
  }
  if (flatP !== flatTarget) { // achatar / levantar
    flatP = flatTarget > flatP ? Math.min(flatTarget, flatP + dt / FLAT_MS) : Math.max(flatTarget, flatP - dt / FLAT_MS);
    applyFlat();
  }
  controls.tick(now);
  if (weather.tick(dt, now, camera, controls.target, controls.dist)) applyLighting(); // lluvia/transición/relámpago
  if (!needsRender) return;
  needsRender = false;

  fitShadow();
  const d = controls.dist;
  // la niebla se mide desde la cámara: con la cámara alejada (vista cenital) se corre esa distancia extra
  const extra = controls.camDist - d;
  scene.fog.near = extra + (d * 1.2 + 400) * fogScale; scene.fog.far = extra + (d * 3 + 1600) * fogScale;
  sky.scale.setScalar(camera.far * 0.9);
  sky.position.copy(camera.position);
  renderer.render(scene, camera);

  if (cameraChanged) {
    labels.update(camera, viewW, viewH, zoomForDist(d), controls.target);
    streetLabels.update(camera, viewW, viewH, zoomForDist(d), labels.occupied);
    catMarkers.update(camera, viewW, viewH);
    emit('move', { bearing: THREE.MathUtils.radToDeg(controls.bearing), pitch: THREE.MathUtils.radToDeg(controls.pitch), zoom: zoomForDist(d) });
    cameraChanged = false;
  }
  pin.update(camera, viewW, viewH);
  userMarker.update(camera, viewW, viewH);

  frames++;
  if (now - lastFps > 500) {
    stats.fps = Math.round(frames * 1000 / (now - lastFps)); stats.calls = renderer.info.render.calls;
    frames = 0; lastFps = now;
    emit('stats', stats);
  }
}

window.addEventListener('resize', resize);
resize();
{ const d = new Date(); if (!FEATURES.timeOfDay) d.setHours(FIXED_TIME[0], FIXED_TIME[1], 0, 0); setTime(d); }
requestAnimationFrame(frame);

// ---------------------------------------------------------------- API pública
const local = ([lon, lat]) => toLocal(lon, lat);
const deg = THREE.MathUtils.degToRad;

export const mapView = {
  on(type, fn) { (listeners[type] ||= []).push(fn); },

  // Carga el modelo 3D. onProgress(0..1)
  load: loadModel,

  // Resalta un edificio/modelo por su id (el del evento tap: e.object.id); 0 o null lo quita
  highlightObject(id) { selectedObject.value = id || 0; needsRender = true; },
  // Pinta edificios/modelos por nombre de objeto, para revisarlos (?dev): { 'Edificio 241': '#e91e63', ... }
  markObjects(byName) { marks = { ...byName }; applyMarks(); },
  markOf(name) { return marks[name] || null; },

  // Mismos parámetros que map.flyTo de Mapbox: center [lng, lat], zoom, pitch y bearing en grados, duration en ms
  flyTo({ center, zoom, pitch, bearing, duration = 1500 }) {
    controls.flyTo({ center: center && local(center), dist: zoom !== undefined ? distForZoom(zoom) : undefined, pitch, bearing, duration });
  },
  // salta sin animación (para el estado inicial)
  jumpTo({ center, zoom, pitch = 0, bearing = 0 }) {
    const [x, z] = local(center);
    controls.stop(); controls.target.set(x, 0, z);
    controls.dist = distForZoom(zoom); controls.pitch = deg(pitch); controls.bearing = deg(bearing);
    controls.apply();
  },
  resetNorth() { controls.flyTo({ bearing: 0, pitch: 0, duration: 800 }); },
  // px de abajo tapados por la interfaz: el centro del mapa queda al medio del resto
  setPadding(bottom) {
    const v = Math.max(0, Math.min(bottom, viewH * 0.8));
    if (Math.abs(v - padBottom) < 0.5) return;
    padBottom = v;
    applyPadding();
    camera.updateProjectionMatrix();
    needsRender = cameraChanged = true;
  },
  getCenter() { return toLonLat(controls.target.x, controls.target.z); },
  isInside([lon, lat]) { const [x, z] = toLocal(lon, lat); return x >= BOUNDS.x0 && x <= BOUNDS.x1 && z >= BOUNDS.z0 && z <= BOUNDS.z1; },

  // Capa base: 'mapa' (dibujado) o 'fotogrametria' (se descarga la primera vez; onProgress(0..1)).
  // Si mientras descarga se pide otra capa, al terminar queda la última pedida.
  async setBaseLayer(name, onProgress) {
    wantedLayer = name;
    if (name === 'fotogrametria') await loadPhotoLayer(onProgress);
    showBaseLayer(wantedLayer);
  },
  get baseLayer() { return baseLayer; },
  // Hora y clima reales (true) o fijos en despejado a las 9:55 (false)
  setLive,
  get live() { return live; },
  // Edificios 3D (true) o achatados (false; también la fotogrametría), con animación salvo animate: false
  setBuildings3D(on, { animate = true } = {}) {
    flatTarget = on ? 0 : 1;
    if (!animate) flatP = flatTarget;
    applyFlat();
  },
  get buildings3D() { return flatTarget === 0; },
  // Puntos de interés (íconos y nombres) prendidos o apagados; el seleccionado se ve igual
  setPOIsVisible(on) { labels.enabled = !!on; needsRender = cameraChanged = true; },

  // Capas de datos
  setSectors(geojson) { addSectors(geojson); needsRender = true; },
  // colores de los sectores prendidos o apagados (en la fotogrametría no se ven nunca)
  setSectorsVisible(on) { sectorsOn = !!on; if (sectorsGroup) sectorsGroup.visible = baseLayer !== 'fotogrametria' && sectorsOn; needsRender = true; },
  get sectorsVisible() { return sectorsOn; },
  addPOIs(features, kind) { labels.add(features, { kind }); needsRender = cameraChanged = true; }, // kind: fixed | misc | metro
  addCategoryMarkers(category, features, icon) { catMarkers.add(category, features, icon); },
  showCategory(category) { catMarkers.visibleCat = category; needsRender = cameraChanged = true; },

  // Selección: etiqueta en rojo y sin ícono (por id de feature)
  setSelected(id) { labels.selectedId = id ?? null; needsRender = cameraChanged = true; },
  // Pin de selección; oculta el marcador de categoría que quede debajo
  setPin(lngLat) {
    if (lngLat) {
      const p = local(lngLat);
      pin.el.innerHTML = '<div class="active-pointer"></div>'; // recrear = repetir la animación popIn
      pin.set(...p); catMarkers.hideAt(p);
    } else { pin.clear(); catMarkers.hideAt(null); }
    needsRender = cameraChanged = true;
  },
  setUserLocation(lngLat) { if (lngLat) userMarker.set(...local(lngLat)); else userMarker.clear(); needsRender = true; },

  // Ruta como lista de [lng, lat]; null la borra
  setRoute(coords) {
    if (routeMesh) { scene.remove(routeMesh); routeMesh.children[0].geometry.dispose(); routeMesh = null; }
    if (coords?.length > 1) {
      const g = routeGeometry(cleanPath(coords.map(local)));
      // todo el borde primero y todo el relleno encima
      const casing = new THREE.Mesh(g, routeCasingMat), fillM = new THREE.Mesh(g, routeFillMat);
      casing.renderOrder = 5; fillM.renderOrder = 6;
      casing.frustumCulled = fillM.frustumCulled = false;
      routeMesh = new THREE.Group();
      routeMesh.add(casing, fillM);
      scene.add(routeMesh);
    }
    needsRender = true;
  },

  // Herramientas en pausa (panel ?dev)
  weather,
  setTime,
  onTime(fn) { timeListeners.push(fn); },
  onFrame(fn) { frameHooks.push(fn); },
  get time() { return simDate; },
};

// para depurar desde la consola
window.__app = {
  scene, camera, controls, renderer, weather, mapView,
  get flat() { return flatP; }, set flat(p) { flatP = flatTarget = p; applyFlat(); }, // avance 3D (0) -> plano (1)
};
