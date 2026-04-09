mapboxgl.accessToken = 'pk.eyJ1IjoicGl0dHUiLCJhIjoiY21ua25kNnNvMHp1ZDJ2cHBmbzd3a2h5NCJ9._6fjrDTEvm2Ryw5LzzTTKg';

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/pittu/cmnknq7ed000401qkb02l4ec0',
  center: [-70.6844, -33.4503], // USACH center
  zoom: 15.5,
  pitch: 45, // give it a slightly 3D look
  bearing: -17.6
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

// Data State
let salasData = null;
let accesosData = null;
let graph = null;
let currentMarker = null;
let userLocation = null;
let pendingRouteCoords = null;

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
  geolocateControl.trigger();
});

geolocateControl.on('geolocate', (e) => {
  userLocation = [e.coords.longitude, e.coords.latitude];
  if (pendingRouteCoords) {
    drawDualRoute(userLocation, pendingRouteCoords);
    pendingRouteCoords = null;
  }
});

function enableManualMode() {
  manualLocationMode = true; // Enable clicking map

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
}

// Handle GPS errors (Permission denied, unavailable, timeout)
geolocateControl.on('error', (e) => {
  pendingRouteCoords = null;
  console.warn("GPS Error", e);
  enableManualMode();
});

// Allow manual location setting by clicking the map only after GPS error
let customUserMarker = null;
let manualLocationMode = false;

map.on('click', (e) => {
  if (!manualLocationMode) return; // Only do this if GPS failed/denied

  userLocation = [e.lngLat.lng, e.lngLat.lat];

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
  try {
    btnNavigate.innerText = "Cargando rutas...";
    btnNavigate.disabled = true;

    // Fetch JSON data
    const [salasRes, sectoresRes, pathsRes, accesosRes] = await Promise.all([
      fetch('salas.json'),
      fetch('SectoresColores.json'),
      fetch('paths.json'),
      fetch('Accesos.json')
    ]);

    salasData = await salasRes.json();
    const sectoresData = await sectoresRes.json();
    const pathsData = await pathsRes.json();
    accesosData = await accesosRes.json();

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
        li.addEventListener('click', () => selectSala(f));
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

btnAccesos.addEventListener('click', () => {
  accesosVisible = !accesosVisible;
  if (accesosVisible) {
    // Show
    map.setLayoutProperty('accesos-point', 'visibility', 'visible');
    btnAccesos.classList.add('active');
    // Fly to USACH from top down
    map.flyTo({
      center: [-70.686453, -33.449353],
      zoom: 15,
      pitch: 0,
      bearing: 0,
      essential: true,
      speed: 1.2
    });
  } else {
    // Hide
    map.setLayoutProperty('accesos-point', 'visibility', 'none');
    btnAccesos.classList.remove('active');
  }
});

function selectSala(feature) {
  searchInput.value = feature.properties.nombre;
  searchResults.classList.remove('active');

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

  map.getSource('route').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] } });
  bottomSheet.classList.remove('hidden');

  btnNavigate.onclick = () => {
    if (!userLocation) {
      if (!navigator.geolocation || window.isSecureContext === false) {
         alert("Tu navegador bloqueó el sensor GPS por conectarte sin HTTPS. Activando modo manual de inmediato.");
         enableManualMode();
         return;
      }
      
      alert("Intentaremos obtener tu GPS primero. De lograrlo, el camino se dibujará solo. Si falla, podrás fijar tu inicio en el mapa manualmente.");
      pendingRouteCoords = coords;
      geolocateControl.trigger();
      
      // Fallback in case Mapbox silently stalls on mobile devices without throwing an error
      setTimeout(() => {
        if (!userLocation && pendingRouteCoords) {
           pendingRouteCoords = null;
           enableManualMode();
        }
      }, 5000);
      
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
    } else {
      alert("No logramos conectar tu ubicación con el destino de manera peatonal.");
    }
    bottomSheet.classList.add('hidden');
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
    }
  } catch (e) {
    console.error("Error en Ruteo Dual:", e);
    alert("Hubo un error contactando a los servidores de calles externa.");
  }
  bottomSheet.classList.add('hidden');
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

let touchStartY = 0;
bottomSheet.addEventListener('touchstart', e => touchStartY = e.changedTouches[0].screenY, { passive: true });
bottomSheet.addEventListener('touchend', e => {
  if (e.changedTouches[0].screenY - touchStartY > 50) bottomSheet.classList.add('hidden');
}, { passive: true });
