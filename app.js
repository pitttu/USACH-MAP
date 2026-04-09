mapboxgl.accessToken = 'pk.eyJ1IjoicGl0dHUiLCJhIjoiY21ua25kNnNvMHp1ZDJ2cHBmbzd3a2h5NCJ9._6fjrDTEvm2Ryw5LzzTTKg';

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/pittu/cmnknq7ed000401qkb02l4ec0',
  center: [-70.6844, -33.4503], // USACH center
  zoom: 15.5,
  pitch: 45, // give it a slightly 3D look
  bearing: -17.6,
  maxBounds: [
    [-70.691987, -33.454381], // Posición Sur-Oeste
    [-70.677701, -33.444594]  // Posición Nor-Este
  ]
});

function updateDate() {
  if (!sheetDate) return;
  const now = new Date();
  const options = { weekday: 'long', day: 'numeric', month: 'long' };
  let dateStr = now.toLocaleDateString('es-ES', options);
  // Capitalize first letter
  dateStr = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
  sheetDate.textContent = dateStr;
}

// Configure atmosphere/fog for horizontal camera panning
map.on('style.load', () => {
  map.setFog({
    'color': 'rgb(255, 255, 255)', // Atmospheric fog color
    'high-color': 'rgb(215, 235, 255)', // Sky blue on the horizon
    'horizon-blend': 0.1, // Thickness of the fog
    'space-color': 'rgb(170, 210, 250)', // Above horizon
    'star-intensity': 0.0
  });
});

// UI Elements
const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
const bottomSheet = document.getElementById('bottom-sheet');
const sheetTitle = document.getElementById('sheet-title');
const sheetEdificio = document.getElementById('sheet-edificio');
const sheetPiso = document.getElementById('sheet-piso');
const sheetCapacidad = document.getElementById('sheet-capacidad');
const btnNavigate = document.getElementById('btn-navigate');
const gpsButton = document.getElementById('gps-button');
const defaultSheetContent = document.getElementById('default-sheet-content');
const poiSheetContent = document.getElementById('poi-sheet-content');
const sheetDate = document.getElementById('sheet-date');
const routeSheetContent = document.getElementById('route-sheet-content');
const routeInfo = document.getElementById('route-info');
const btnEndRoute = document.getElementById('btn-end-route');
updateDate();

// Data State
let salasData = null;
let accesosData = null;
let banosData = null;
let impresionesData = null;
let graph = null;
let currentMarker = null;
let userLocation = null;
let pendingRouteCoords = null;

// Loader Logic
let isLoadingFinished = false;
const loaderOverlay = document.getElementById('loader-overlay');

function finishLoading() {
  if (isLoadingFinished) return;
  isLoadingFinished = true;
  loaderOverlay.classList.add('hidden-loader');
}

// Global Timeout: 10s max (good for mobile tiles to render)
setTimeout(finishLoading, 10000);

// Data loading tracker
let resourcesToLoad = 4; // salas, accesos, banos, impresiones
function resourceLoaded() {
  resourcesToLoad--;
  checkIfReady();
}

let isMapReady = false;
function checkIfReady() {
  if (resourcesToLoad === 0 && isMapReady) {
    // Small extra delay for smoother entry
    setTimeout(finishLoading, 500);
  }
}

// ==========================================
// BOTTOM SHEET & GPS BUTTON DYNAMIC LOGIC
// ==========================================
const REST_OFFSET = 100;
const MID_OFFSET = 380; // Increased to ensure action buttons are fully visible
const FULL_OFFSET = 20;

let currentSheetState = 'REST'; // New state tracking
let sheetY = window.innerHeight - REST_OFFSET; 
let startY = 0;
let isDragging = false;


// Graph MinHeap Priority Queue for instantaneous pathfinding
class MinHeap {
  constructor() { this.data = []; }
  push(val, priority) {
    this.data.push({ val, priority });
    this.bubbleUp(this.data.length - 1);
  }
  pop() {
    if (this.data.length === 0) return null;
    const min = this.data[0];
    const end = this.data.pop();
    if (this.data.length > 0) {
      this.data[0] = end;
      this.sinkDown(0);
    }
    return min.val;
  }
  bubbleUp(idx) {
    const element = this.data[idx];
    while (idx > 0) {
      const pIdx = Math.floor((idx - 1) / 2);
      const parent = this.data[pIdx];
      if (element.priority >= parent.priority) break;
      this.data[pIdx] = element;
      this.data[idx] = parent;
      idx = pIdx;
    }
  }
  sinkDown(idx) {
    const length = this.data.length;
    const element = this.data[idx];
    while (true) {
      let leftIdx = 2 * idx + 1;
      let rightIdx = 2 * idx + 2;
      let left, right, swap = null;
      if (leftIdx < length) {
        left = this.data[leftIdx];
        if (left.priority < element.priority) swap = leftIdx;
      }
      if (rightIdx < length) {
        right = this.data[rightIdx];
        if ((swap === null && right.priority < element.priority) ||
          (swap !== null && right.priority < left.priority)) swap = rightIdx;
      }
      if (swap === null) break;
      this.data[idx] = this.data[swap];
      this.data[swap] = element;
      idx = swap;
    }
  }
}

// Geolocation control
const geolocateControl = new mapboxgl.GeolocateControl({
  positionOptions: { enableHighAccuracy: true },
  trackUserLocation: true,
  showUserHeading: true
});
map.addControl(geolocateControl, 'bottom-right');

// Compass control (shows and resets bearing to north)
const compassControl = new mapboxgl.NavigationControl({
  showZoom: false,
  visualizePitch: true
});
map.addControl(compassControl, 'top-right');

gpsButton.addEventListener('click', () => {
  if (manualLocationMode && userLocationLocked) {
    // Unlock for a new pick
    userLocationLocked = false;
    userLocation = null;
    if (customUserMarker) {
      customUserMarker.remove();
      customUserMarker = null;
    }
    
    // Notifications
    const toast = document.createElement('div');
    toast.innerText = "📍 Toca el mapa para establecer tu nuevo punto.";
    toast.style.position = 'absolute';
    toast.style.top = '90px';
    toast.style.left = '50%';
    toast.style.transform = 'translateX(-50%)';
    toast.style.background = 'rgba(0,0,0,0.8)';
    toast.style.color = 'white';
    toast.style.padding = '8px 16px';
    toast.style.borderRadius = '20px';
    toast.style.zIndex = '1000';
    toast.style.transition = 'opacity 0.5s';
    toast.style.fontWeight = '500';
    toast.style.fontFamily = 'Inter, sans-serif';
    toast.style.fontSize = '14px';
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 500);
    }, 2000);
    
    return; // Stop here, don't ping real GPS
  }

  geolocateControl.trigger();
});

geolocateControl.on('geolocate', (e) => {
  userLocation = [e.coords.longitude, e.coords.latitude];
  if (pendingRouteCoords) {
    drawDualRoute(userLocation, pendingRouteCoords);
    pendingRouteCoords = null;
  }
});

// Handle GPS errors (Permission denied, unavailable, timeout)
geolocateControl.on('error', (e) => {
  // pendingRouteCoords = null; // REMOVED: Keep destination even if GPS fails
  console.warn("GPS Error", e);
  manualLocationMode = true; // Enable clicking map
  userLocationLocked = false; // Fresh start for manual selection

  // Smooth fly to requested location top-down
  map.flyTo({
    center: [-70.686453, -33.449353],
    zoom: 15,
    pitch: 0, // Mirando hacia abajo
    bearing: 0, // Norte hacia arriba
    essential: true,
    speed: 1.2
  });

  const toast = document.createElement('div');
  toast.innerText = "GPS no disponible. Toca el mapa para fijar tu ubicación manualmente.";
  toast.style.position = 'absolute';
  toast.style.top = '90px';
  toast.style.left = '50%';
  toast.style.transform = 'translateX(-50%)';
  toast.style.background = 'rgba(200, 50, 50, 0.9)';
  toast.style.color = 'white';
  toast.style.padding = '12px 20px';
  toast.style.borderRadius = '20px';
  toast.style.zIndex = '1000';
  toast.style.transition = 'opacity 0.5s';
  toast.style.fontWeight = '500';
  toast.style.fontFamily = 'Inter, sans-serif';
  toast.style.fontSize = '14px';
  toast.style.textAlign = 'center';
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 500);
  }, 4000);
});

// Allow manual location setting by clicking the map only after GPS error
let customUserMarker = null;
let manualLocationMode = false;
let userLocationLocked = false;

map.on('click', (e) => {
  if (!manualLocationMode || userLocationLocked) return; // Only do this if GPS failed/denied and unset

  // Stop propagation so the map reset listener doesn't see this click
  if (e.originalEvent) e.originalEvent.stopPropagation();

  userLocation = [e.lngLat.lng, e.lngLat.lat];
  userLocationLocked = true; // Lock location


  if (customUserMarker) {
    customUserMarker.setLngLat(userLocation);
  } else {
    // Create a dot marker
    const el = document.createElement('div');
    el.style.width = '18px';
    el.style.height = '18px';
    el.style.backgroundColor = '#2196F3';
    el.style.border = '3px solid white';
    el.style.borderRadius = '50%';
    el.style.boxShadow = '0 0 5px rgba(0,0,0,0.5)';
    customUserMarker = new mapboxgl.Marker(el)
      .setLngLat(userLocation)
      .addTo(map);
  }

  // Show a quick visual notification
  const toast = document.createElement('div');
  toast.innerText = "📍 Ubicación manual fijada";
  toast.style.position = 'absolute';
  toast.style.top = '90px';
  toast.style.left = '50%';
  toast.style.transform = 'translateX(-50%)';
  toast.style.background = 'rgba(0,0,0,0.7)';
  toast.style.color = 'white';
  toast.style.padding = '8px 16px';
  toast.style.borderRadius = '20px';
  toast.style.zIndex = '1000';
  toast.style.transition = 'opacity 0.5s';
  toast.style.fontWeight = '500';
  toast.style.fontFamily = 'Inter, sans-serif';
  toast.style.fontSize = '14px';
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 500);
  }, 2000);
});

// Load data and setup map layers
map.on('load', async () => {
  isMapReady = true;
  checkIfReady();

  try {
    btnNavigate.innerText = "Cargando rutas...";
    btnNavigate.disabled = true;

    // Fetch JSON data
    const [salasRes, sectoresRes, pathsRes, accesosRes, banosRes, metroRes, impresionesRes] = await Promise.all([
      fetch('salas.json'),
      fetch('SectoresColores.json'),
      fetch('paths.json'),
      fetch('Accesos.json'),
      fetch('baños.json'),
      fetch('metro.json'),
      fetch('impresiones.json')
    ]);

    salasData = await salasRes.json();
    const sectoresData = await sectoresRes.json();
    const pathsData = await pathsRes.json();
    accesosData = await accesosRes.json();
    banosData = await banosRes.json();
    const metroData = await metroRes.json();
    impresionesData = await impresionesRes.json();

    // Mark resources as loaded
    resourcesToLoad = 0;
    checkIfReady();

    // Prepare Graph from paths in the background
    graph = buildGraph(pathsData);
    console.log("USACH Routing Graph ready with", graph.size, "nodes.");

    // Add Sectores Layer
    map.addSource('sectores', { type: 'geojson', data: sectoresData });
    map.addLayer({
      'id': 'sectores-fill',
      'type': 'fill',
      'source': 'sectores',
      'paint': {
        'fill-color': ['get', 'color'],
        'fill-opacity': 0.3
      }
    }, 'building');
    map.addLayer({
      'id': 'sectores-outline',
      'type': 'line',
      'source': 'sectores',
      'paint': {
        'line-color': ['get', 'color'],
        'line-width': 2
      }
    });

    // Add Paths Layer (Hidden layout, used mathematically only)
    map.addSource('paths', { type: 'geojson', data: pathsData });
    map.addLayer({
      'id': 'paths-line',
      'type': 'line',
      'source': 'paths',
      'layout': {
        'line-join': 'round',
        'line-cap': 'round',
        'visibility': 'none'
      },
      'paint': {
        'line-color': '#ffffff',
        'line-width': 3,
        'line-dasharray': [1, 2]
      }
    });

    // Add Accesos visual hints (hidden by default until chip is toggled)
    map.addSource('accesos', { type: 'geojson', data: accesosData });
    map.addLayer({
      'id': 'accesos-point',
      'type': 'circle',
      'source': 'accesos',
      'layout': {
        'visibility': 'none'
      },
      'paint': {
        'circle-radius': 5,
        'circle-color': '#dbf1ff',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#00aeef'
      }
    });

    // Make Accesos clickable and zoomable
    map.on('click', 'accesos-point', (e) => {
      const feature = e.features[0];
      const coords = feature.geometry.coordinates;
      const synthetic = {
        geometry: { coordinates: coords },
        properties: {
          nombre: feature.properties.nombre || "Acceso",
          edificio: "Entrada/Salida",
          piso: "-",
          capacidad: "-"
        }
      };
      selectSala(synthetic);
    });

    // Change cursor on hover
    map.on('mouseenter', 'accesos-point', () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'accesos-point', () => {
      map.getCanvas().style.cursor = '';
    });

    // Add Baños visual hints
    map.addSource('banos', { type: 'geojson', data: banosData });
    map.addLayer({
      'id': 'banos-point',
      'type': 'circle',
      'source': 'banos',
      'layout': {
        'visibility': 'none'
      },
      'paint': {
        'circle-radius': 5,
        'circle-color': '#e8aa31',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff'
      }
    });

    // Spawn Metro HTML Markers
    metroData.features.forEach(feature => {
      const el = document.createElement('div');
      el.className = 'metro-marker';

      new mapboxgl.Marker(el)
        .setLngLat(feature.geometry.coordinates)
        .addTo(map);
    });

    // Make Baños clickable and zoomable
    map.on('click', 'banos-point', (e) => {
      const feature = e.features[0];
      const coords = feature.geometry.coordinates;
      const synthetic = {
        geometry: { coordinates: coords },
        properties: {
          nombre: "Baños",
          edificio: feature.properties.edificio || "Campus",
          piso: feature.properties.piso || "-",
          capacidad: "-"
        }
      };
      selectSala(synthetic);
    });

    map.on('mouseenter', 'banos-point', () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'banos-point', () => {
      map.getCanvas().style.cursor = '';
    });

    // Add Impresiones visual hints
    map.addSource('impresiones', { type: 'geojson', data: impresionesData });
    map.addLayer({
      'id': 'impresiones-point',
      'type': 'circle',
      'source': 'impresiones',
      'layout': {
        'visibility': 'none'
      },
      'paint': {
        'circle-radius': 5,
        'circle-color': '#AC21F3',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff'
      }
    });

    // Make Impresiones clickable and zoomable
    map.on('click', 'impresiones-point', (e) => {
      const feature = e.features[0];
      const coords = feature.geometry.coordinates;
      const synthetic = {
        geometry: { coordinates: coords },
        properties: {
          nombre: feature.properties.name || "Impresiones",
          edificio: feature.properties.edificio || "Servicios",
          piso: feature.properties.piso || "-",
          capacidad: "-"
        }
      };
      selectSala(synthetic);
    });

    map.on('mouseenter', 'impresiones-point', () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'impresiones-point', () => {
      map.getCanvas().style.cursor = '';
    });

    // Route line source
    map.addSource('route', {
      type: 'geojson',
      data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } }
    });

    // Exterior Route styling (Solid line)
    map.addLayer({
      'id': 'route-line',
      'type': 'line',
      'source': 'route',
      'layout': { 'line-join': 'round', 'line-cap': 'round' },
      'paint': {
        'line-color': '#2196F3',
        'line-width': 6,
        'line-opacity': 0.9
      }
    });

    // ----------------------------------------------------
    // ADD 3D GLB MODEL USING THREE.JS
    // ----------------------------------------------------
    const modelOrigin = [-70.686453, -33.449353];
    const modelAltitude = 0;
    const modelRotate = [Math.PI / 2, 0, 0];

    const modelAsMercatorCoordinate = mapboxgl.MercatorCoordinate.fromLngLat(
      modelOrigin,
      modelAltitude
    );

    const modelTransform = {
      translateX: modelAsMercatorCoordinate.x,
      translateY: modelAsMercatorCoordinate.y,
      translateZ: modelAsMercatorCoordinate.z,
      rotateX: modelRotate[0],
      rotateY: modelRotate[1],
      rotateZ: modelRotate[2],
      scale: modelAsMercatorCoordinate.meterInMercatorCoordinateUnits()
    };

    const customLayer = {
      id: '3d-model',
      type: 'custom',
      renderingMode: '3d',
      onAdd: function (map, gl) {
        this.camera = new THREE.Camera();
        this.scene = new THREE.Scene();

        const directionalLight = new THREE.DirectionalLight(0xffffff, 2);
        directionalLight.position.set(0, -70, 100).normalize();
        this.scene.add(directionalLight);

        const directionalLight2 = new THREE.DirectionalLight(0xffffff, 2);
        directionalLight2.position.set(0, 70, 100).normalize();
        this.scene.add(directionalLight2);

        const loader = new THREE.GLTFLoader();
        loader.load('FAE_USACH.glb', (gltf) => {
          this.scene.add(gltf.scene);
        });
        this.map = map;

        this.renderer = new THREE.WebGLRenderer({
          canvas: map.getCanvas(),
          context: gl,
          antialias: true
        });

        this.renderer.autoClear = false;
      },
      render: function (gl, matrix) {
        const rotationX = new THREE.Matrix4().makeRotationAxis(
          new THREE.Vector3(1, 0, 0),
          modelTransform.rotateX
        );
        const rotationY = new THREE.Matrix4().makeRotationAxis(
          new THREE.Vector3(0, 1, 0),
          modelTransform.rotateY
        );
        const rotationZ = new THREE.Matrix4().makeRotationAxis(
          new THREE.Vector3(0, 0, 1),
          modelTransform.rotateZ
        );

        const m = new THREE.Matrix4().fromArray(matrix);
        const l = new THREE.Matrix4()
          .makeTranslation(
            modelTransform.translateX,
            modelTransform.translateY,
            modelTransform.translateZ
          )
          .scale(
            new THREE.Vector3(
              modelTransform.scale * 50,
              -modelTransform.scale * 50,
              modelTransform.scale * 50
            )
          )
          .multiply(rotationX)
          .multiply(rotationY)
          .multiply(rotationZ);

        this.camera.projectionMatrix = m.multiply(l);
        this.renderer.resetState();
        this.renderer.render(this.scene, this.camera);
        this.map.triggerRepaint();
      }
    };

    map.addLayer(customLayer);
    // ----------------------------------------------------

    setupSearch();
    btnNavigate.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;margin-right:8px;vertical-align:middle;">
        <path d="M9 18l6-6-6-6" />
      </svg>
      <span style="vertical-align:middle;">Cómo llegar</span>
    `;
    btnNavigate.disabled = false;

  } catch (err) {
    console.error("Error loading JSON data", err);
    alert("Error cargando los datos. Asegúrate de ejecutar el servidor local (ej. python -m http.server)");
  }
});

function buildGraph(pathsData) {
  const g = new Map();
  const roundCoord = (coord) => `${coord[0].toFixed(5)},${coord[1].toFixed(5)}`;

  function addEdge(n1, n2, weight, c1, c2) {
    if (!g.has(n1)) g.set(n1, { edges: [], coord: c1 });
    if (!g.has(n2)) g.set(n2, { edges: [], coord: c2 });
    g.get(n1).edges.push({ node: n2, weight, coord: c2 });
    g.get(n2).edges.push({ node: n1, weight, coord: c1 });
  }

  pathsData.features.forEach(feature => {
    if (feature.geometry.type === 'LineString') {
      const coords = feature.geometry.coordinates;
      for (let i = 0; i < coords.length - 1; i++) {
        const c1 = coords[i];
        const c2 = coords[i + 1];
        const n1 = roundCoord(c1);
        const n2 = roundCoord(c2);
        // We use Turf to get realistic distances between points
        const weight = turf.distance(c1, c2, { units: 'meters' });
        if (n1 !== n2) {
          addEdge(n1, n2, weight, c1, c2);
        }
      }
    }
  });
  return g;
}

function nearestNodeInGraph(targetCoord) {
  let minKey = null;
  let minDist = Infinity;
  for (const [key, nodeObj] of graph.entries()) {
    const d = turf.distance(targetCoord, nodeObj.coord, { units: 'meters' });
    if (d < minDist) {
      minDist = d;
      minKey = key;
    }
  }
  return minKey;
}

function dijkstra(startCoord, endCoord) {
  const startNode = nearestNodeInGraph(startCoord);
  const endNode = nearestNodeInGraph(endCoord);

  if (!startNode || !endNode) return null;

  const dist = new Map();
  const prev = new Map();
  const pq = new MinHeap(); // Using MinHeap for instantaneous speed

  for (const key of graph.keys()) {
    dist.set(key, Infinity);
    prev.set(key, null);
  }
  dist.set(startNode, 0);
  pq.push(startNode, 0);

  const bestVisited = new Set();

  while (pq.data.length > 0) {
    const minNode = pq.pop();

    if (bestVisited.has(minNode)) continue;
    bestVisited.add(minNode);

    if (minNode === endNode) break;

    const d = dist.get(minNode);
    if (d === Infinity) break;

    const neighbors = graph.get(minNode).edges;
    for (const neighbor of neighbors) {
      if (!bestVisited.has(neighbor.node)) {
        const alt = d + neighbor.weight;
        if (alt < dist.get(neighbor.node)) {
          dist.set(neighbor.node, alt);
          prev.set(neighbor.node, minNode);
          pq.push(neighbor.node, alt);
        }
      }
    }
  }

  const pathCoords = [];
  let curr = endNode;
  if (prev.get(curr) !== null || curr === startNode) {
    while (curr !== null) {
      pathCoords.push(graph.get(curr).coord);
      curr = prev.get(curr);
    }
    pathCoords.reverse();
    // Prepend and append the exact real coordinates to link nicely
    pathCoords.unshift(startCoord);
    pathCoords.push(endCoord);
    return pathCoords;
  }

  return null;
}

// Search Logic
function setupSearch() {
  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    searchResults.innerHTML = '';
    if (!query) {
      searchResults.classList.remove('active');
      return;
    }
    const results = salasData.features.filter(f =>
      f.properties.nombre.toLowerCase().includes(query)
    ).slice(0, 5);

    if (results.length > 0) {
      searchResults.classList.add('active');
      results.forEach(f => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${f.properties.nombre}</span> <span class="result-badge">${f.properties.edificio || 'Campus'}</span>`;
        li.addEventListener('click', (e) => {
          e.stopPropagation(); // Stop click from hitting the map/document
          selectSala(f);
        });
        li.addEventListener('touchstart', (e) => {
          e.stopPropagation(); // Explicit touch isolation for mobile
        }, { passive: true });
        searchResults.appendChild(li);
      });
    } else {
      searchResults.classList.remove('active');
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-container')) {
      searchResults.classList.remove('active');
    }
  });
}

// Chips Logic
const btnAccesos = document.getElementById('btn-accesos');
let accesosVisible = false;

const btnBanos = document.getElementById('btn-banos');
let banosVisible = false;

const btnImpresiones = document.getElementById('btn-impresiones');
let impresionesVisible = false;

function disableAllChips() {
  accesosVisible = false;
  map.setLayoutProperty('accesos-point', 'visibility', 'none');
  btnAccesos.classList.remove('active');

  banosVisible = false;
  map.setLayoutProperty('banos-point', 'visibility', 'none');
  btnBanos.classList.remove('active');

  impresionesVisible = false;
  map.setLayoutProperty('impresiones-point', 'visibility', 'none');
  btnImpresiones.classList.remove('active');
}

btnAccesos.addEventListener('click', () => {
  const willBeActive = !accesosVisible;
  disableAllChips();

  if (willBeActive) {
    accesosVisible = true;
    map.setLayoutProperty('accesos-point', 'visibility', 'visible');
    btnAccesos.classList.add('active');
    map.flyTo({
      center: [-70.686453, -33.449353],
      zoom: 15,
      pitch: 0,
      bearing: 0,
      essential: true,
      speed: 1.2
    });
  }
});

btnBanos.addEventListener('click', () => {
  const willBeActive = !banosVisible;
  disableAllChips();

  if (willBeActive) {
    banosVisible = true;
    map.setLayoutProperty('banos-point', 'visibility', 'visible');
    btnBanos.classList.add('active');
    map.flyTo({
      center: [-70.686453, -33.449353],
      zoom: 15,
      pitch: 0,
      bearing: 0,
      essential: true,
      speed: 1.2
    });
  }
});

btnImpresiones.addEventListener('click', () => {
  const willBeActive = !impresionesVisible;
  disableAllChips();

  if (willBeActive) {
    impresionesVisible = true;
    map.setLayoutProperty('impresiones-point', 'visibility', 'visible');
    btnImpresiones.classList.add('active');
    map.flyTo({
      center: [-70.686453, -33.449353],
      zoom: 15,
      pitch: 0,
      bearing: 0,
      essential: true,
      speed: 1.2
    });
  }
});

const btnMore = document.getElementById('btn-more');
btnMore.addEventListener('click', () => {
  openSheet('FULL');
});



function selectSala(feature) {
  searchInput.value = feature.properties.nombre;
  // Delay clearing results slightly for mobile to prevent "ghost click" on map
  setTimeout(() => {
    searchResults.classList.remove('active');
  }, 150);

  const coords = feature.geometry.coordinates;

  map.flyTo({ center: coords, zoom: 17.5, essential: true, speed: 1.2 });

  if (currentMarker) currentMarker.remove();

  const el = document.createElement('div');
  el.className = 'custom-marker';
  el.style.width = '24px';
  el.style.height = '24px';
  el.style.backgroundColor = 'var(--primary)';
  el.style.border = '3px solid white';
  el.style.borderRadius = '50%';
  el.style.boxShadow = '0 0 10px rgba(0,0,0,0.5)';

  currentMarker = new mapboxgl.Marker(el).setLngLat(coords).addTo(map);

  sheetTitle.textContent = feature.properties.nombre;
  sheetEdificio.textContent = "Edificio: " + (feature.properties.edificio || "No especificado");
  sheetPiso.textContent = "Piso: " + feature.properties.piso;
  sheetCapacidad.textContent = "Capacidad: " + (feature.properties.capacidad || "-");

  // Switch content view
  defaultSheetContent.classList.add('hidden');
  poiSheetContent.classList.remove('hidden');

  // Open the sheet a bit more if it was in rest mode
  openSheet('MID'); 

  map.getSource('route').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] } });

  btnNavigate.onclick = () => {
    if (!userLocation) {
      alert("Intentaremos obtener tu GPS primero. De lograrlo, el camino se dibujará solo. Si falla, podrás fijar tu inicio en el mapa manualmente.");
      pendingRouteCoords = coords;
      geolocateControl.trigger();
    } else {
      drawDualRoute(userLocation, coords);
    }
  };
}

// Draw the Advanced Dual Route
async function drawDualRoute(userCoord, salaCoord) {
  btnNavigate.innerHTML = "Calculando ruta...";

  // Checking distance from user to closest internal graph node
  const userGraphNodeKey = nearestNodeInGraph(userCoord);
  const userGraphNodeObj = graph.get(userGraphNodeKey);
  const distUserToCampus = turf.distance(userCoord, userGraphNodeObj.coord, { units: 'meters' });

  // If user is already inside campus (within 150m of a path), just route internally natively
  if (distUserToCampus < 150) {
    const internalPath = dijkstra(userCoord, salaCoord);
    if (internalPath) {
      const line = turf.lineString(internalPath);
      map.getSource('route').setData(line);
      map.fitBounds(turf.bbox(line), { padding: 80, maxZoom: 18 });
      showRouteInfo(line);
    } else {
      alert("No logramos conectar tu ubicación con el destino de manera peatonal.");
      resetSheet();
    }
    resetBtn();
    return;
  }

  // Find Best Acceso
  let bestAcceso = null;
  let minScore = Infinity;

  accesosData.features.forEach(acceso => {
    let c = acceso.geometry.coordinates;
    // Heuristic: Route cost = Straight distance from User to Acceso + Straight distance from Acceso to Sala
    let d1 = turf.distance(userCoord, c);
    let d2 = turf.distance(c, salaCoord);
    if ((d1 + d2) < minScore) {
      minScore = d1 + d2;
      bestAcceso = c;
    }
  });

  if (!bestAcceso) {
    alert("No se encontraron accesos disponibles.");
    resetBtn();
    return;
  }

  try {
    // 1. Exterior Route (Calles)
    const profile = 'mapbox/walking';
    const url = `https://api.mapbox.com/directions/v5/${profile}/${userCoord[0]},${userCoord[1]};${bestAcceso[0]},${bestAcceso[1]}?geometries=geojson&access_token=${mapboxgl.accessToken}`;
    const res = await fetch(url);
    const mData = await res.json();

    let fullCoords = [];
    if (mData.routes && mData.routes.length > 0) {
      fullCoords.push(...mData.routes[0].geometry.coordinates);
    } else {
      // Fallback straight line outside if Mapbox routing fails
      fullCoords.push(userCoord);
    }

    // 2. Interior Route (Pasillos Dijkstra)
    const interiorCoords = dijkstra(bestAcceso, salaCoord);
    if (interiorCoords) {
      fullCoords.push(...interiorCoords);
    } else {
      // Fallback straight line inside if Dijkstra fails
      fullCoords.push(bestAcceso, salaCoord);
    }

    if (fullCoords.length > 1) {
      const combinedLine = turf.lineString(fullCoords);
      map.getSource('route').setData(combinedLine);
      map.fitBounds(turf.bbox(combinedLine), { padding: { top: 100, bottom: 200, left: 80, right: 80 }, maxZoom: 18 });
      
      // Show route summary on the sheet
      showRouteInfo(combinedLine);
    }
  } catch (e) {
    console.error("Error en Ruteo Dual:", e);
    alert("Hubo un error contactando a los servidores de calles externa.");
    resetSheet();
  }
  resetBtn();
}

function resetBtn() {
  btnNavigate.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;margin-right:8px;vertical-align:middle;">
      <path d="M9 18l6-6-6-6" />
    </svg>
    <span style="vertical-align:middle;">Cómo llegar</span>
  `;
}

// ==========================================
// BOTTOM SHEET & GPS BUTTON DYNAMIC LOGIC
// ==========================================
// (Constants moved to top)


function updateUIPositions(y) {
  const vh = window.innerHeight;
  bottomSheet.style.transform = `translateY(${y}px)`;
  
  const sheetVisibleHeight = vh - y;
  
  // GPS Button: sube con la barra, pero frena al 50% de la pantalla
  const btnBottom = Math.min(sheetVisibleHeight + 16, vh / 2);
  gpsButton.style.bottom = `${btnBottom}px`;
  
  // Transitions for aesthetics
  if (y < 60) {
    bottomSheet.classList.add('expanded');
  } else {
    bottomSheet.classList.remove('expanded');
  }
}

function openSheet(state) {
  const vh = window.innerHeight;
  let targetY = vh - REST_OFFSET;
  if (state === 'MID') targetY = vh - MID_OFFSET;
  if (state === 'FULL') targetY = FULL_OFFSET;
  
  currentSheetState = state; // Persist state for resize handling
  sheetY = targetY;
  bottomSheet.style.transition = "transform 0.4s cubic-bezier(0.1, 0.7, 0.1, 1)";
  updateUIPositions(targetY);
}

function resetSheet() {
  poiSheetContent.classList.add('hidden');
  defaultSheetContent.classList.remove('hidden');
  routeSheetContent.classList.add('hidden'); // Ensure route info is hidden
  openSheet('REST');
  if (currentMarker) currentMarker.remove();
}

function showRouteInfo(lineFeature) {
  const distanceKm = turf.length(lineFeature, { units: 'kilometers' });
  const distanceM = Math.round(distanceKm * 1000);
  
  // Estimate time: 5km/h = 83.3 meters per minute
  const durationMin = Math.ceil(distanceM / 83.3);
  
  routeInfo.textContent = `${durationMin} min (${distanceM} m)`;
  
  // Switch to route view
  poiSheetContent.classList.add('hidden');
  defaultSheetContent.classList.add('hidden');
  routeSheetContent.classList.remove('hidden');
  
  openSheet('REST'); // Stay in rest mode but with route info
}

function endRoute() {
  // Clear map
  map.getSource('route').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] } });
  
  // Clear any marker that might be showing
  if (currentMarker) currentMarker.remove();
  
  // Reset sheet to default
  resetSheet();
  resetBtn();
}

btnEndRoute.addEventListener('click', endRoute);

// Dragging Events
bottomSheet.addEventListener('touchstart', e => {
  startY = e.touches[0].clientY;
  isDragging = true;
  bottomSheet.style.transition = "none";
}, { passive: true });

document.addEventListener('touchmove', e => {
  if (!isDragging) return;
  const deltaY = e.touches[0].clientY - startY;
  let newY = sheetY + deltaY;
  
  if (newY < FULL_OFFSET) newY = FULL_OFFSET;
  if (newY > window.innerHeight - REST_OFFSET) newY = window.innerHeight - REST_OFFSET;
  
  updateUIPositions(newY);
}, { passive: false });

document.addEventListener('touchend', e => {
  if (!isDragging) return;
  isDragging = false;
  
  const vh = window.innerHeight;
  // Get current translation from style
  const matrix = new WebKitCSSMatrix(window.getComputedStyle(bottomSheet).transform);
  const currentPos = matrix.m42;
  
  if (currentPos < vh * 0.4) {
    openSheet('FULL');
  } else if (currentPos < vh - 200) {
    openSheet('MID');
  } else {
    openSheet('REST');
  }
});

// Initialize rest position
window.addEventListener('resize', () => {
  // Respect current state on resize (solves keyboard close issue)
  openSheet(currentSheetState);
});
// Use setTimeout to ensure window.innerHeight is accurate on mobile load
setTimeout(() => openSheet('REST'), 100);



// ==========================================
// ADVANCED INTERACTIONS: POI & LONG CLICK
// ==========================================
let longPressTimer;
let isPressing = false;
let preventClick = false;

const startPress = (e) => {
    // Only trigger if we aren't waiting for a manual GPS drop
    if (manualLocationMode && !userLocationLocked) return;
    
    isPressing = true;
    preventClick = false;
    const lngLat = e.lngLat;
    const point = e.point;
    
    longPressTimer = setTimeout(() => {
        if (isPressing) {
            preventClick = true;
            handleLongClick(lngLat, point);
        }
    }, 500); // 500ms long press
};

const cancelPress = () => {
    isPressing = false;
    clearTimeout(longPressTimer);
};

map.on('mousedown', startPress);
map.on('touchstart', startPress);
map.on('mouseup', cancelPress);
map.on('touchend', cancelPress);
map.on('touchcancel', cancelPress);
map.on('dragstart', cancelPress);
map.on('movestart', cancelPress);
map.on('pitchstart', cancelPress);

function handleLongClick(lngLat, point) {
    const bbox = [
      [point.x - 15, point.y - 15],
      [point.x + 15, point.y + 15]
    ];
    const features = map.queryRenderedFeatures(bbox);
    
    // Look for any standard map text/icon symbol that has a name
    const hitPoi = features.some(f => 
       f.layer && 
       f.layer.type === 'symbol' && 
       f.properties && 
       f.properties.name
    );
    
    if (hitPoi) return; // Discard long click if they actually pressed a POI

    const coords = [lngLat.lng, lngLat.lat];
    const syntheticFeature = {
       geometry: { coordinates: coords },
       properties: {
          nombre: 'Punto Seleccionado',
          edificio: 'Ubicación Libre',
          piso: '-',
          capacidad: '-'
       }
    };
    selectSala(syntheticFeature);
}

// Intercept clicks for regular base map POIs
map.on('click', (e) => {
    if (preventClick) {
        preventClick = false;
        return;
    }
    
    // DONT reset sheet if we are in manual location mode or picking a point.
    // In these states, the destination is sacred.
    if (manualLocationMode) return;
    
    // Protection: If we have an active destination, clicking the map background 
    // should NOT reset the selection.
    if (currentMarker) return; 

    // Create a touch box for mobile-friendly hit detection

    const bbox = [
      [e.point.x - 15, e.point.y - 15],
      [e.point.x + 15, e.point.y + 15]
    ];
    const features = map.queryRenderedFeatures(bbox);
    
    // Exclude our own clickable layers to prevent background clicks from winning
    const interactiveLayers = ['accesos-point', 'banos-point', 'impresiones-point'];
    if (features.some(f => f.layer && interactiveLayers.includes(f.layer.id))) {
        return;
    }

    // Capture any Mapbox background feature that is a symbol (Icon/Text) and has a name
    const poi = features.find(f => 
        f.layer && 
        f.layer.type === 'symbol' && 
        f.properties && 
        f.properties.name
    );

    if (poi) {
        // ALWAYS use the click coordinate for custom rendering to avoid vector tile geometry cutoffs
        const coords = [e.lngLat.lng, e.lngLat.lat];

        const syntheticFeature = {
           geometry: { coordinates: coords },
           properties: {
              nombre: poi.properties.name || poi.properties.name_en || 'Punto de Interés',
              edificio: poi.properties.category_en || poi.properties.type || poi.properties.maki || 'Lugar Público',
              piso: '-',
              capacidad: '-'
           }
        };
        selectSala(syntheticFeature);
        return; // Important: stop here if we hit a POI
    }

    // If we reached here, the user clicked on empty map area
    resetSheet();
});
