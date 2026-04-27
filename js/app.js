mapboxgl.accessToken = 'pk.eyJ1IjoicGl0dHUiLCJhIjoiY21ua25kNnNvMHp1ZDJ2cHBmbzd3a2h5NCJ9._6fjrDTEvm2Ryw5LzzTTKg';

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/pittu/cmnknq7ed000401qkb02l4ec0',
  center: [-70.685117, -33.449467],
  zoom: 15.5,
  pitch: 45,
  bearing: -20,
  antialias: true,
  maxBounds: [
    [-70.691592, -33.452748], // Sudoeste
    [-70.679338, -33.443767]  // Noreste
  ]
});

// UI Elements
const bottomSheet = document.getElementById('bottom-sheet');
const sheetHandle = document.querySelector('.sheet-handle');
const defaultSheetContent = document.getElementById('default-sheet-content');
const poiSheetContent = document.getElementById('poi-sheet-content');
const routeSheetContent = document.getElementById('route-sheet-content');
const sheetTitle = document.getElementById('sheet-title');
const btnNavigate = document.getElementById('btn-navigate');
const btnCloseRoute = document.getElementById('btn-end-route');
const routeInfo = document.getElementById('route-info');
const searchInput = document.getElementById('search-input');
const resultsContainer = document.getElementById('search-results');
const categoryChips = document.querySelectorAll('.chip');
const gpsButton = document.getElementById('gps-button');
const btnClosePoi = document.getElementById('btn-close-poi');
const searchSheetContent = document.getElementById('search-sheet-content');
const originInput = document.getElementById('origin-input');
const destinationInput = document.getElementById('destination-input');
const historyListContainer = document.getElementById('search-history-list');
const btnBackSearch = document.getElementById('btn-back-search');
const btnUseLocation = document.getElementById('btn-use-location');
const sheetSearchResults = document.getElementById('sheet-search-results');
const dualSearchInputs = document.getElementById('dual-search-inputs');
const simpleSearchInputs = document.getElementById('simple-search-inputs');
const sheetMainInput = document.getElementById('sheet-main-input');
const sheetDate = document.getElementById('sheet-date');


// ESTADOS DE LA BARRA
const REST_OFFSET = 120; // Default peek height
const MID_OFFSET = 350;  // Category height
let FULL_OFFSET = 60;    // Will dynamically match top-ui
let sheetY = window.innerHeight - REST_OFFSET;
let isDragging = false;
let startY, startSheetY;
let currentSheetState = 'REST';
let isMapReady = false;
let resourcesToLoad = 10;

let salasData, accesosData, banosData, impresionesData, metroData, miscData, miscFixedData, dispensadoresData, cajerosData;
let selectedId = null;
let lastHiddenSprite = null;
let destinationPOI = null;
let originPOI = null;
let lastFocusedSearchInput = null;

const HistoryManager = {
  KEY: 'usach_map_history',
  get() {
    try {
      return JSON.parse(localStorage.getItem(this.KEY)) || [];
    } catch { return []; }
  },
  add(poi) {
    let history = this.get();
    // Use unique ID or name+coords to identify
    const poiId = poi.properties.id || (poi.properties.nombre + poi.geometry.coordinates.join(','));
    history = history.filter(item => {
      const itemId = item.properties.id || (item.properties.nombre + item.geometry.coordinates.join(','));
      return itemId !== poiId;
    });
    history.unshift(poi);
    if (history.length > 15) history.pop();
    localStorage.setItem(this.KEY, JSON.stringify(history));
  },
  render() {
    const history = this.get();
    historyListContainer.innerHTML = '';
    if (history.length === 0) {
      historyListContainer.innerHTML = '<li style="padding: 20px; text-align: center; color: #888; font-size: 14px;">No hay búsquedas recientes</li>';
      return;
    }
    history.forEach(poi => {
      const li = document.createElement('li');
      li.className = 'history-item';
      li.innerHTML = `
        <div class="history-icon">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
        </div>
        <div class="history-info">
          <div class="history-name">${poi.properties.nombre || poi.properties.name}</div>
          <div class="history-details">${poi.properties.edificio || 'Campus'}</div>
        </div>
      `;
      li.onclick = () => {
        if (lastFocusedSearchInput === destinationInput) {
          setDestinationPOI(poi);
        } else if (lastFocusedSearchInput === originInput) {
          setOriginPOI(poi);
        } else {
          selectSala(poi, poi.geometry.coordinates);
        }
      };

      historyListContainer.appendChild(li);
    });
  }
};


function updateMapHighlights() {
  const labelIds = ['misc-labels', 'misc-fixed-labels', 'metro-labels'];

  labelIds.forEach(layerId => {
    if (map.getLayer(layerId)) {
      map.setPaintProperty(layerId, 'text-halo-color', 'rgba(255,255,255,1.0)');
      map.setPaintProperty(layerId, 'text-halo-width', 2.5);
      map.setPaintProperty(layerId, 'text-color', [
        'case',
        ['==', ['get', 'id'], selectedId || -1], '#b72522',
        ['==', ['get', 'category'], 'deporte'], '#0894ff',
        ['==', ['get', 'category'], 'tienda'], '#0894ff',
        ['==', ['get', 'category'], 'dispensador'], '#0894ff',
        ['==', ['get', 'category'], 'cajero'], '#0894ff',
        ['==', ['get', 'category'], 'comida'], '#fe8029',
        ['==', ['get', 'category'], 'radio'], '#fe8029',
        ['==', ['get', 'category'], 'biblioteca'], '#56707c',
        ['==', ['get', 'category'], 'monumento'], '#b965ff',
        ['==', ['get', 'category'], 'pastos'], '#15a972',
        ['==', ['get', 'category'], 'salud'], '#f74855',
        '#56707c'
      ]);

      const isFixed = layerId.includes('fixed') || layerId === 'metro-labels';
      if (isFixed) {
        map.setPaintProperty(layerId, 'text-opacity', 1);
      } else {
        map.setPaintProperty(layerId, 'text-opacity', [
          'case',
          ['==', ['get', 'id'], selectedId || -1], 1,
          ['coalesce', ['feature-state', 'opacity'], 0]
        ]);
      }
    }
  });

  const circleIds = ['misc-icons', 'misc-fixed-icons', 'metro-icons'];
  circleIds.forEach(layerId => {
    if (map.getLayer(layerId)) {
      const isFixed = layerId.includes('fixed') || layerId === 'metro-icons';

      if (isFixed) {
        map.setPaintProperty(layerId, 'icon-opacity', ['case', ['==', ['get', 'id'], selectedId || -1], 0, 1]);
      } else {
        const combinedOp = [
          'case', ['==', ['get', 'id'], selectedId || -1], 0,
          ['coalesce', ['feature-state', 'opacity'], 0]
        ];
        map.setPaintProperty(layerId, 'icon-opacity', combinedOp);
      }
    }
  });

  if (map.getLayer('metro-efe-icons')) {
    map.setPaintProperty('metro-efe-icons', 'icon-opacity', [
      'case',
      ['==', ['get', 'id'], selectedId || -1], 0,
      1
    ]);
  }
}

function updateMiscDistances() {
  if (!miscData || !map.getSource('misc')) return;

  const center = map.getCenter();
  const targetCoord = [center.lng, center.lat];

  const currentZoom = map.getZoom();
  let baseOp = 1;
  if (currentZoom < 16.5) baseOp = 0;
  else if (currentZoom < 17.5) baseOp = (currentZoom - 16.5) / 1.0;

  miscData.features.forEach(f => {
    const dist = turf.distance(targetCoord, f.geometry.coordinates, { units: 'kilometers' }) * 1000;
    let distOp = 1;
    if (dist > 200) distOp = 0;
    else if (dist > 100) distOp = 1 - ((dist - 100) / 100);

    // Combine zoom and distance
    const finalOp = baseOp * distOp;
    map.setFeatureState({ source: 'misc', id: f.id }, { opacity: finalOp });
  });
}

let graph = null;
let currentMarker = null;
let userLocation = null;
let pendingRouteCoords = null;
let preventClick = false;
let manualLocationMode = false;
let userLocationLocked = false;
let customUserMarker = null;
const CAMPUS_BOUNDS = [
  [-70.691592, -33.452748], // SW
  [-70.679338, -33.443767]  // NE
];

// --- Priority Queue for Dijkstra ---
class PriorityQueue {
  constructor() { this.data = []; }
  push(node, priority) {
    this.data.push({ node, priority });
    this.bubbleUp(this.data.length - 1);
  }
  pop() {
    if (this.size() === 0) return null;
    const top = this.data[0];
    const bottom = this.data.pop();
    if (this.size() > 0) {
      this.data[0] = bottom;
      this.sinkDown(0);
    }
    return top;
  }
  size() { return this.data.length; }
  bubbleUp(idx) {
    const element = this.data[idx];
    while (idx > 0) {
      let pIdx = Math.floor((idx - 1) / 2);
      let parent = this.data[pIdx];
      if (element.priority >= parent.priority) break;
      this.data[idx] = parent;
      this.data[pIdx] = element;
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

const compassControl = new mapboxgl.NavigationControl({
  showZoom: false,
  visualizePitch: true
});
map.addControl(compassControl, 'top-right');

gpsButton.addEventListener('click', () => {
  if (manualLocationMode && userLocationLocked) {
    userLocationLocked = false;
    userLocation = null;
    if (customUserMarker) {
      customUserMarker.remove();
      customUserMarker = null;
    }
    showToast("📍 Toca el mapa para fijar tu ubicación.");
    return;
  }
  geolocateControl.trigger();
});

geolocateControl.on('geolocate', (e) => {
  const lng = e.coords.longitude;
  const lat = e.coords.latitude;

  // Validate if position is within campus maxBounds
  if (
    lng >= CAMPUS_BOUNDS[0][0] && lng <= CAMPUS_BOUNDS[1][0] &&
    lat >= CAMPUS_BOUNDS[0][1] && lat <= CAMPUS_BOUNDS[1][1]
  ) {
    userLocation = [lng, lat];
    manualLocationMode = false;
    
    // Mostrar el marcador azul personalizado
    if (customUserMarker) customUserMarker.remove();
    const el = document.createElement('div');
    el.className = 'user-location-marker';
    customUserMarker = new mapboxgl.Marker(el).setLngLat(userLocation).addTo(map);
    
    if (pendingRouteCoords) {
      drawDualRoute(userLocation, pendingRouteCoords);
      pendingRouteCoords = null;
    }
  } else {
    showToast("Ubicación fuera del campus. Toca el mapa para indicar tu origen.", true);
    activarModoManual();
  }
});

geolocateControl.on('error', () => {
  showToast("No se pudo obtener el GPS. Toca el mapa para indicar tu origen.", true);
  activarModoManual();
});

function activarModoManual() {
  manualLocationMode = true;
  userLocationLocked = false;
  userLocation = null;
  sheetTitle.textContent = "Seleccionar origen";
  document.getElementById('sheet-edificio').textContent = "Usa el dedo y toca el mapa donde te encuentras parado actualmente.";
  document.getElementById('sheet-piso').textContent = "";
  document.getElementById('sheet-capacidad').textContent = "";

  defaultSheetContent.classList.add('hidden');
  routeSheetContent.classList.add('hidden');
  poiSheetContent.classList.remove('hidden');

  if (btnNavigate) btnNavigate.style.display = 'none';
  openSheet('REST');

  // Fly to campus center for better overview
  map.flyTo({
    center: [-70.685117, -33.449467],
    zoom: 15.5,
    pitch: 0,
    bearing: 0,
    duration: 1500
  });
}

// Resources setup
function resourceLoaded() {
  resourcesToLoad--;
  if (resourcesToLoad <= 0 && isMapReady) {
    const loader = document.getElementById('loader-overlay');
    if (loader) loader.style.display = 'none';
  }
}

// Load data and setup map layers
map.on('load', async () => {
  isMapReady = true;
  resourceLoaded();

  // Fog and Performance Optimization
  map.setFog({
    'color': 'rgb(255, 255, 255)',
    'high-color': '#e0f2f1',
    'horizon-blend': 0.3,
    'range': [0.6, 3]
  });

  // Optimize 3D Layers (fill-extrusion)
  const layers = map.getStyle().layers;
  layers.forEach(l => {
    if (l.type === 'fill-extrusion') {
      map.setPaintProperty(l.id, 'fill-extrusion-opacity', 0.6);
      // Reduce complexity by limiting zoom if needed
    }
  });

  try {
    const [salasRes, sectoresRes, pathsRes, accesosRes, banosRes, metroRes, impresionesRes, miscRes, miscFixedRes, dispensadoresRes, cajerosRes] = await Promise.all([
      fetch('assets/data/salas.json'),
      fetch('assets/data/SectoresColores.json'),
      fetch('assets/data/paths.json'),
      fetch('assets/data/Accesos.json'),
      fetch('assets/data/banos.json'),
      fetch('assets/data/metro.json'),
      fetch('assets/data/impresiones.json'),
      fetch('assets/data/Sep-misc.json'),
      fetch('assets/data/FixedMisc.json'),
      fetch('assets/data/dispensadores.json'),
      fetch('assets/data/cajeros.json')
    ]);

    salasData = await salasRes.json();
    const sectoresData = await sectoresRes.json();
    const pathsData = await pathsRes.json();
    accesosData = await accesosRes.json();
    banosData = await banosRes.json();
    metroData = await metroRes.json();
    impresionesData = await impresionesRes.json();
    miscData = await miscRes.json();
    miscFixedData = await miscFixedRes.json();
    dispensadoresData = await dispensadoresRes.json();
    cajerosData = await cajerosRes.json();

    await new Promise((resolve) => {
      map.loadImage('assets/icons/spritesheet-rm.png', (error, image) => {
        if (error) { console.error('Image load error', error); resolve(); return; }
        const canvas = document.createElement('canvas');
        canvas.width = 166;
        canvas.height = 166;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(image, 1328, 0, 166, 166, 0, 0, 166, 166);
        map.addImage('misc-poi-icon', ctx.getImageData(0, 0, 166, 166));

        ctx.clearRect(0, 0, 166, 166);
        ctx.drawImage(image, 664, 0, 166, 166, 0, 0, 166, 166);
        map.addImage('comida-poi-icon', ctx.getImageData(0, 0, 166, 166));

        // Sport Icon (index 5)
        ctx.clearRect(0, 0, 166, 166);
        ctx.drawImage(image, 830, 0, 166, 166, 0, 0, 166, 166);
        map.addImage('deporte-poi-icon', ctx.getImageData(0, 0, 166, 166));

        // Pastos Icon (index 7)
        ctx.clearRect(0, 0, 166, 166);
        ctx.drawImage(image, 1162, 0, 166, 166, 0, 0, 166, 166);
        map.addImage('pasto-poi-icon', ctx.getImageData(0, 0, 166, 166));

        // Tienda Icon (index 2)
        ctx.clearRect(0, 0, 166, 166);
        ctx.drawImage(image, 332, 0, 166, 166, 0, 0, 166, 166);
        map.addImage('tienda-poi-icon', ctx.getImageData(0, 0, 166, 166));

        resolve();
      });
    });

    await new Promise((resolve) => {
      map.loadImage('assets/icons/spritesheet2-rm.png', (error, image) => {
        if (error) { console.error('Image load error', error); resolve(); return; }
        const canvas = document.createElement('canvas');
        canvas.width = 204;
        canvas.height = 204;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        // Extract 6th icon (index 5)
        ctx.drawImage(image, 1020, 0, 204, 204, 0, 0, 204, 204);
        map.addImage('salud-poi-icon', ctx.getImageData(0, 0, 204, 204));

        // Extract 5th icon (index 4) for Radio
        ctx.clearRect(0, 0, 204, 204);
        ctx.drawImage(image, 816, 0, 204, 204, 0, 0, 204, 204);
        map.addImage('radio-poi-icon', ctx.getImageData(0, 0, 204, 204));

        // Extract 3rd icon (index 2) for Biblioteca
        ctx.clearRect(0, 0, 204, 204);
        ctx.drawImage(image, 408, 0, 204, 204, 0, 0, 204, 204);
        map.addImage('biblioteca-poi-icon', ctx.getImageData(0, 0, 204, 204));

        // Extract 1st icon (index 0) for Monumento
        ctx.clearRect(0, 0, 204, 204);
        ctx.drawImage(image, 0, 0, 204, 204, 0, 0, 204, 204);
        map.addImage('monumento-poi-icon', ctx.getImageData(0, 0, 204, 204));

        // Extract 4th icon (index 3) for Dispensador
        ctx.clearRect(0, 0, 204, 204);
        ctx.drawImage(image, 612, 0, 204, 204, 0, 0, 204, 204);
        map.addImage('dispensador-poi-icon', ctx.getImageData(0, 0, 204, 204));

        // Extract 2nd icon (index 1) for Cajero
        ctx.clearRect(0, 0, 204, 204);
        ctx.drawImage(image, 204, 0, 204, 204, 0, 0, 204, 204);
        map.addImage('cajero-poi-icon', ctx.getImageData(0, 0, 204, 204));
        resolve();
      });
    });

    for (let i = 0; i < 9; i++) resourceLoaded();

    graph = buildGraph(pathsData);

    // Add Sectores
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

    // Add Routes
    map.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      'id': 'route-line',
      'type': 'line',
      'source': 'route',
      'layout': { 'line-join': 'round', 'line-cap': 'round' },
      'paint': { 'line-color': '#4285F4', 'line-width': 6, 'line-opacity': 0.9 }
    });

    // Metro Stations (always visible, white circle + logo)
    map.addSource('metro', { type: 'geojson', data: metroData });

    await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 44; canvas.height = 44;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        // Soft shadow
        ctx.shadowColor = 'rgba(0,0,0,0.25)';
        ctx.shadowBlur = 5;
        ctx.shadowOffsetY = 2;
        // White circle, no border
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(22, 22, 20, 0, Math.PI * 2);
        ctx.fill();
        // Reset shadow before drawing logo
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
        // Draw SVG logo centered inside
        ctx.drawImage(img, 11, 11, 22, 22);
        map.addImage('metro-icon', ctx.getImageData(0, 0, 44, 44));
        resolve();
      };
      img.onerror = () => resolve();
      img.src = 'assets/svg/MetroLogo.svg';
    });

    await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 44; canvas.height = 44;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        // Soft shadow
        ctx.shadowColor = 'rgba(0,0,0,0.25)';
        ctx.shadowBlur = 5;
        ctx.shadowOffsetY = 2;
        // White circle, no border
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(22, 22, 20, 0, Math.PI * 2);
        ctx.fill();
        // Reset shadow before drawing logo
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
        // Draw SVG logo centered inside
        ctx.drawImage(img, 11, 11, 22, 22);
        map.addImage('efe-icon', ctx.getImageData(0, 0, 44, 44));
        resolve();
      };
      img.onerror = () => resolve();
      img.src = 'assets/svg/efe.svg';
    });

    map.addLayer({
      'id': 'metro-icons',
      'type': 'symbol',
      'source': 'metro',
      'layout': {
        'icon-image': 'metro-icon',
        'icon-size': 0.6,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true
      },
      'paint': { 'icon-opacity': 1 }
    });

    map.addLayer({
      'id': 'metro-efe-icons',
      'type': 'symbol',
      'source': 'metro',
      'filter': ['==', ['get', 'name'], 'Metro Estación Central'],
      'layout': {
        'icon-image': 'efe-icon',
        'icon-size': 0.6,
        'icon-offset': [-45, 0],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true
      },
      'paint': { 'icon-opacity': 1 }
    });

    map.addLayer({
      'id': 'metro-labels',
      'type': 'symbol',
      'source': 'metro',
      'layout': {
        'text-field': ['get', 'name'],
        'text-font': ['DIN Pro Regular', 'Arial Unicode MS Regular'],
        'text-size': 13.5,
        'text-offset': [1.2, 0],
        'text-anchor': 'left',
        'text-justify': 'left',
        'text-max-width': 10,
        'text-allow-overlap': false,
        'text-ignore-placement': false
      },
      'paint': {
        'text-color': '#56707c',
        'text-halo-color': 'white',
        'text-halo-width': 2.5
      }
    });

    // Fixed POI Labels
    map.addSource('misc-fixed', { type: 'geojson', data: miscFixedData });
    map.addLayer({
      'id': 'misc-fixed-icons',
      'type': 'symbol',
      'source': 'misc-fixed',
      'layout': {
        'icon-image': [
          'case',
          ['==', ['get', 'category'], 'deporte'], 'deporte-poi-icon',
          ['==', ['get', 'category'], 'tienda'], 'tienda-poi-icon',
          ['==', ['get', 'category'], 'biblioteca'], 'biblioteca-poi-icon',
          ['==', ['get', 'category'], 'monumento'], 'monumento-poi-icon',
          ['==', ['get', 'category'], 'dispensador'], 'dispensador-poi-icon',
          ['==', ['get', 'category'], 'comida'], 'comida-poi-icon',
          ['==', ['get', 'category'], 'pastos'], 'pasto-poi-icon',
          ['==', ['get', 'category'], 'salud'], 'salud-poi-icon',
          ['==', ['get', 'category'], 'radio'], 'radio-poi-icon',
          'misc-poi-icon'
        ],
        'icon-size': [
          'case',
          ['in', ['get', 'category'], ['literal', ['salud', 'radio', 'biblioteca', 'monumento', 'dispensador']]], 0.203,
          0.25
        ],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true
      },
      'paint': {
        'icon-opacity': 1
      }
    });

    map.addLayer({
      'id': 'misc-fixed-labels',
      'type': 'symbol',
      'source': 'misc-fixed',
      'layout': {
        'text-field': ['get', 'name'],
        'text-font': ['DIN Pro Regular', 'Arial Unicode MS Regular'],
        'text-size': 13.5,
        'text-offset': ['case', ['in', ['get', 'category'], ['literal', ['deporte', 'pastos']]], ['literal', [-1.2, 0]], ['literal', [1.2, 0]]],
        'text-anchor': ['case', ['in', ['get', 'category'], ['literal', ['deporte', 'pastos']]], 'right', 'left'],
        'text-justify': ['case', ['in', ['get', 'category'], ['literal', ['deporte', 'pastos']]], 'right', 'left'],
        'text-max-width': 10,
        'text-allow-overlap': false,
        'text-ignore-placement': false
      },
      'paint': {
        'text-color': [
          'case',
          ['==', ['get', 'id'], selectedId || -1], '#b72522',
          ['==', ['get', 'category'], 'deporte'], '#0894ff',
          ['==', ['get', 'category'], 'tienda'], '#0894ff',
          ['==', ['get', 'category'], 'dispensador'], '#0894ff',
          ['==', ['get', 'category'], 'biblioteca'], '#56707c',
          ['==', ['get', 'category'], 'monumento'], '#b965ff',
          ['==', ['get', 'category'], 'comida'], '#fe8029',
          ['==', ['get', 'category'], 'radio'], '#fe8029',
          ['==', ['get', 'category'], 'pastos'], '#15a972',
          ['==', ['get', 'category'], 'salud'], '#f74855',
          '#56707c'
        ],
        'text-halo-color': 'white',
        'text-halo-width': 2.5
      }
    });

    // Dynamic POI Labels
    map.addSource('misc', { type: 'geojson', data: miscData, promoteId: 'id' });
    map.addLayer({
      'id': 'misc-icons',
      'type': 'symbol',
      'source': 'misc',
      'layout': {
        'icon-image': [
          'case',
          ['==', ['get', 'category'], 'deporte'], 'deporte-poi-icon',
          ['==', ['get', 'category'], 'tienda'], 'tienda-poi-icon',
          ['==', ['get', 'category'], 'biblioteca'], 'biblioteca-poi-icon',
          ['==', ['get', 'category'], 'monumento'], 'monumento-poi-icon',
          ['==', ['get', 'category'], 'dispensador'], 'dispensador-poi-icon',
          ['==', ['get', 'category'], 'comida'], 'comida-poi-icon',
          ['==', ['get', 'category'], 'pastos'], 'pasto-poi-icon',
          ['==', ['get', 'category'], 'salud'], 'salud-poi-icon',
          ['==', ['get', 'category'], 'radio'], 'radio-poi-icon',
          'misc-poi-icon'
        ],
        'icon-size': [
          'case',
          ['in', ['get', 'category'], ['literal', ['salud', 'radio', 'biblioteca', 'monumento', 'dispensador']]], 0.203,
          0.25
        ],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true
      },
      'paint': {
        'icon-opacity': ['coalesce', ['feature-state', 'opacity'], 0]
      }
    });
    map.addLayer({
      'id': 'misc-labels',
      'type': 'symbol',
      'source': 'misc',
      'layout': {
        'text-field': ['get', 'name'],
        'text-font': ['DIN Pro Regular', 'Arial Unicode MS Regular'],
        'text-size': 13.5,
        'text-offset': ['case', ['in', ['get', 'category'], ['literal', ['deporte', 'pastos']]], ['literal', [-1.2, 0]], ['literal', [1.2, 0]]],
        'text-anchor': ['case', ['in', ['get', 'category'], ['literal', ['deporte', 'pastos']]], 'right', 'left'],
        'text-justify': ['case', ['in', ['get', 'category'], ['literal', ['deporte', 'pastos']]], 'right', 'left'],
        'text-max-width': 10,
        'text-allow-overlap': false,
        'text-ignore-placement': false
      },
      'paint': {
        'text-color': [
          'case',
          ['==', ['get', 'category'], 'deporte'], '#0894ff',
          ['==', ['get', 'category'], 'tienda'], '#0894ff',
          ['==', ['get', 'category'], 'dispensador'], '#0894ff',
          ['==', ['get', 'category'], 'cajero'], '#0894ff',
          ['==', ['get', 'category'], 'biblioteca'], '#56707c',
          ['==', ['get', 'category'], 'monumento'], '#b965ff',
          ['==', ['get', 'category'], 'comida'], '#fe8029',
          ['==', ['get', 'category'], 'radio'], '#fe8029',
          ['==', ['get', 'category'], 'pastos'], '#15a972',
          ['==', ['get', 'category'], 'salud'], '#f74855',
          '#56707c'
        ],
        'text-halo-color': 'white',
        'text-halo-width': 2.5,
        'text-opacity': ['coalesce', ['feature-state', 'opacity'], 0]
      }
    });


    // Sprite Marker Helpers
    window._spriteMarkers = { accesos: [], banos: [], impresiones: [], comida: [], dispensador: [], cajero: [] };
    function createSpriteMarker(spriteIndex, coords, onClickData, category, spritesheetUrl = 'assets/icons/spritesheet-rm.png', totalSprites = 9) {
      const el = document.createElement('div');
      el.style.width = '42px';
      el.style.height = '42px';
      el.style.backgroundImage = `url('${spritesheetUrl}')`;
      el.style.backgroundSize = `${totalSprites * 100}% auto`;
      const positionPercentage = totalSprites > 1 ? (spriteIndex / (totalSprites - 1) * 100) : 0;
      el.style.backgroundPosition = `${positionPercentage}% 0`;
      el.style.backgroundRepeat = 'no-repeat';
      el.style.cursor = 'pointer';
      el.style.filter = 'drop-shadow(0px 2px 4px rgba(0,0,0,0.25))';
      el.style.display = 'none'; // Hidden by default

      const m = new mapboxgl.Marker(el).setLngLat(coords).addTo(map);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (manualLocationMode && !userLocationLocked) {
          setManualOrigin(coords, onClickData.properties.nombre || onClickData.properties.name);
          return;
        }
        selectSala(onClickData, coords);
      });
      window._spriteMarkers[category].push(m);
      return m;
    }

    // Initialize Sprite Markers
    accesosData.features.forEach(f => createSpriteMarker(0, f.geometry.coordinates, f, 'accesos'));
    banosData.features.forEach(f => createSpriteMarker(1, f.geometry.coordinates, f, 'banos'));
    impresionesData.features.forEach(f => createSpriteMarker(6, f.geometry.coordinates, f, 'impresiones'));

    // Food Markers (now inside miscData)
    miscData.features.forEach(f => {
      if (f.properties.category === 'comida') {
        createSpriteMarker(4, f.geometry.coordinates, f, 'comida');
      }
    });

    dispensadoresData.features.forEach(f => createSpriteMarker(3, f.geometry.coordinates, f, 'dispensador', 'assets/icons/spritesheet2-rm.png', 6));
    cajerosData.features.forEach(f => createSpriteMarker(1, f.geometry.coordinates, f, 'cajero', 'assets/icons/spritesheet2-rm.png', 6));

    // Map Interaction
    const interactivePoilayers = [
      'misc-labels', 'misc-fixed-labels', 'metro-labels',
      'misc-icons', 'misc-fixed-icons', 'metro-icons'
    ];

    interactivePoilayers.forEach(layerId => {
      map.on('click', layerId, handleMiscClick);
    });

    // Long Press Implementation
    let longPressTimer;
    const LONG_PRESS_DELAY = 600;

    const startLongPress = (e) => {
      if (e.originalEvent.touches && e.originalEvent.touches.length > 1) return;
      clearTimeout(longPressTimer);
      longPressTimer = setTimeout(() => {
        selectCustomPoint([e.lngLat.lng, e.lngLat.lat]);
      }, LONG_PRESS_DELAY);
    };

    const cancelLongPress = () => clearTimeout(longPressTimer);

    map.on('mousedown', startLongPress);
    map.on('touchstart', startLongPress);
    
    map.on('mousemove', cancelLongPress);
    map.on('touchmove', cancelLongPress);
    map.on('mouseup', cancelLongPress);
    map.on('touchend', cancelLongPress);
    map.on('dragstart', cancelLongPress);
    map.on('contextmenu', (e) => {
      e.preventDefault();
      selectCustomPoint([e.lngLat.lng, e.lngLat.lat]);
    });

    map.on('move', updateMiscDistances);
    updateMiscDistances(); // Initialize opacities

  } catch (err) { console.error("Data load failed", err); }
});

function handleMiscClick(e) {
  if (preventClick) return;

  if (e.features.length > 0) {
    const f = e.features[0];

    if (f.source === 'misc') {
      const state = map.getFeatureState({ source: 'misc', id: f.id });
      if (!state || state.opacity < 0.1) return;
    }

    if (manualLocationMode && !userLocationLocked) {
      setManualOrigin(f.geometry.coordinates, f.properties.nombre || f.properties.name);
      preventClick = true;
      setTimeout(() => preventClick = false, 50);
      return;
    }

    selectSala(f, f.geometry.coordinates);
    preventClick = true;
    setTimeout(() => preventClick = false, 50);
  }
}

// --- Selection Logic ---
function selectSala(feature, coords) {
  resetSheet(false);

  const container = document.createElement('div');
  container.className = 'active-pointer-container';
  const img = document.createElement('img');
  img.src = 'assets/icons/pointer.png';
  img.className = 'active-pointer';
  container.appendChild(img);

  selectedId = feature.properties.id || null;
  updateMapHighlights();



  // Hide original HTML sprite marker if it matches current coordinates
  if (lastHiddenSprite) lastHiddenSprite.style.display = 'block';
  lastHiddenSprite = null;

  for (let cat in window._spriteMarkers) {
    const match = window._spriteMarkers[cat].find(m => {
      const pos = m.getLngLat();
      return Math.abs(pos.lng - coords[0]) < 0.00001 && Math.abs(pos.lat - coords[1]) < 0.00001;
    });
    if (match) {
      lastHiddenSprite = match.getElement();
      lastHiddenSprite.style.display = 'none';
      break;
    }
  }

  currentMarker = new mapboxgl.Marker({ element: container, anchor: 'bottom', offset: [0, 25] }).setLngLat(coords).addTo(map);

  sheetTitle.textContent = feature.properties.nombre || feature.properties.name || "Ubicación";
  document.getElementById('sheet-edificio').textContent = `Edificio: ${feature.properties.edificio || 'Campus'}`;
  document.getElementById('sheet-piso').textContent = `Piso: ${feature.properties.piso || 'N/A'}`;
  document.getElementById('sheet-capacidad').textContent = `Capacidad: ${feature.properties.capacidad || 'N/A'}`;

  defaultSheetContent.classList.add('hidden');
  poiSheetContent.classList.remove('hidden');
  routeSheetContent.classList.add('hidden');
  searchSheetContent.classList.add('hidden');
  openSheet('MID');


  map.flyTo({ center: coords, zoom: 19, pitch: 45, duration: 2000 });

  if (btnNavigate) btnNavigate.style.display = 'flex'; // Ensure button is restored

  btnNavigate.onclick = () => {
    destinationPOI = feature;
    destinationInput.value = feature.properties.nombre || feature.properties.name || '';

    if (userLocation) {
      drawDualRoute(userLocation, coords);
    } else if (manualLocationMode && userLocationLocked) {
      drawDualRoute(userLocation, coords);
    } else {
      openSearchSheet('route');
    }
  };
}

function selectCustomPoint(coords) {
  resetSheet(false);

  const container = document.createElement('div');
  container.className = 'active-pointer-container';
  const img = document.createElement('img');
  img.src = 'assets/icons/pointer.png';
  img.className = 'active-pointer';
  container.appendChild(img);

  selectedId = null;
  updateMapHighlights();

  if (lastHiddenSprite) lastHiddenSprite.style.display = 'block';
  lastHiddenSprite = null;

  currentMarker = new mapboxgl.Marker({ element: container, anchor: 'bottom', offset: [0, 25] }).setLngLat(coords).addTo(map);

  sheetTitle.textContent = "Ubicación seleccionada";
  document.getElementById('sheet-edificio').textContent = "Punto en el mapa";
  document.getElementById('sheet-piso').textContent = "";
  document.getElementById('sheet-capacidad').textContent = "";

  defaultSheetContent.classList.add('hidden');
  poiSheetContent.classList.remove('hidden');
  routeSheetContent.classList.add('hidden');
  searchSheetContent.classList.add('hidden');
  openSheet('MID');

  map.flyTo({ center: coords, zoom: 19, pitch: 45, duration: 2000 });

  if (btnNavigate) {
    btnNavigate.style.display = 'flex';
    btnNavigate.onclick = () => {
      destinationPOI = {
        properties: { nombre: 'Ubicación seleccionada', name: 'Ubicación seleccionada', edificio: 'Punto en el mapa' },
        geometry: { coordinates: coords }
      };
      destinationInput.value = 'Ubicación seleccionada';

      if (userLocation || (manualLocationMode && userLocationLocked)) {
        drawDualRoute(userLocation, coords);
      } else {
        openSearchSheet('route');
      }
    };
  }
}

function openSearchSheet(mode = 'simple') {
  defaultSheetContent.classList.add('hidden');
  poiSheetContent.classList.add('hidden');
  routeSheetContent.classList.add('hidden');
  searchSheetContent.classList.remove('hidden');

  if (mode === 'route') {
    dualSearchInputs.classList.remove('hidden');
    simpleSearchInputs.classList.add('hidden');
    setTimeout(() => originInput.focus(), 300);
  } else {
    dualSearchInputs.classList.add('hidden');
    simpleSearchInputs.classList.remove('hidden');
    setTimeout(() => sheetMainInput.focus(), 300);
  }

  HistoryManager.render();
  openSheet('FULL');
}


function setOriginPOI(poi) {
  originPOI = poi;
  originInput.value = poi.properties.nombre || poi.properties.name;
  sheetSearchResults.classList.add('hidden');
  HistoryManager.add(poi);
  checkAndDrawRoute();
}

function setDestinationPOI(poi) {
  destinationPOI = poi;
  destinationInput.value = poi.properties.nombre || poi.properties.name;
  sheetSearchResults.classList.add('hidden');
  HistoryManager.add(poi);
  checkAndDrawRoute();
}

function checkAndDrawRoute() {
  if (originPOI && destinationPOI) {
    drawDualRoute(originPOI.geometry.coordinates, destinationPOI.geometry.coordinates);
  } else if (userLocation && destinationPOI) {
    drawDualRoute(userLocation, destinationPOI.geometry.coordinates);
  }
}

function performSearch(query, resultsElement, onSelect) {
  if (query.length < 2) {
    resultsElement.classList.add('hidden');
    resultsElement.classList.remove('active');
    if (resultsElement.id === 'search-results') {
      resultsElement.parentElement.classList.remove('active');
    }
    return;
  }

  const cleanQuery = query.toLowerCase().replace(/sala /g, '').replace(/edificio /g, '').replace(/usach/g, '').trim();
  let allFeatures = [];
  if (salasData) allFeatures = allFeatures.concat(salasData.features);
  if (miscData) allFeatures = allFeatures.concat(miscData.features);
  if (miscFixedData) allFeatures = allFeatures.concat(miscFixedData.features);
  if (metroData) allFeatures = allFeatures.concat(metroData.features);

  const filtered = allFeatures.filter(f => {
    const n = String(f.properties.nombre || f.properties.name || '').toLowerCase();
    const ed = String(f.properties.edificio || '').toLowerCase();
    return (n && n.includes(cleanQuery)) || (ed && ed.includes(cleanQuery));
  }).slice(0, 8);

  resultsElement.innerHTML = '';
  filtered.forEach(f => {
    const li = document.createElement('li');
    li.className = 'history-item'; // reusing same style
    const displName = f.properties.nombre || f.properties.name || 'Ubicación';
    const displEdi = f.properties.edificio ? ` <span style="font-size: 11px; color: #666;">(${f.properties.edificio})</span>` : '';
    li.innerHTML = `
      <div class="history-icon">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
      </div>
      <div class="history-info">
        <div class="history-name">${displName}</div>
        <div class="history-details">${f.properties.edificio || 'Campus'}</div>
      </div>
    `;
    li.onclick = () => {
      onSelect(f);
      resultsElement.classList.add('hidden');
      resultsElement.classList.remove('active');
      if (resultsElement.id === 'search-results') {
        resultsElement.parentElement.classList.remove('active');
      }
    };
    resultsElement.appendChild(li);
  });

  if (filtered.length > 0) {
    resultsElement.classList.remove('hidden');
    resultsElement.classList.add('active');
    if (resultsElement.id === 'search-results') {
      resultsElement.parentElement.classList.add('active');
    }
  } else {
    resultsElement.classList.add('hidden');
    resultsElement.classList.remove('active');
    if (resultsElement.id === 'search-results') {
      resultsElement.parentElement.classList.remove('active');
    }
  }
}


function resetSheet(shouldClose = true) {
  selectedId = null;
  updateMapHighlights();
  if (lastHiddenSprite) {
    lastHiddenSprite.style.display = 'block';
    lastHiddenSprite = null;
  }
  
  if (currentMarker) {
    currentMarker.remove();
    currentMarker = null;
  }

  // Nota: No eliminamos customUserMarker ni userLocation aquí para que la posición 
  // del usuario sea persistente mientras navega.
  
  pendingRouteCoords = null;
  manualLocationMode = false;
  
  if (originInput) originInput.value = '';
  if (destinationInput) destinationInput.value = '';
  
  if (map.getSource('route')) {
    map.getSource('route').setData({ type: 'FeatureCollection', features: [] });
  }

  if (shouldClose) {
    poiSheetContent.classList.add('hidden');
    defaultSheetContent.classList.remove('hidden');
    routeSheetContent.classList.add('hidden');
    searchSheetContent.classList.add('hidden');
    openSheet('REST');
  }
}


// --- Background Clicks and Global Logic ---

function setManualOrigin(coords, name = 'Ubicación seleccionada') {
  userLocation = coords;
  userLocationLocked = true;
  manualLocationMode = false; // Exit manual mode

  if (customUserMarker) customUserMarker.remove();
  const el = document.createElement('div');
  el.className = 'user-location-marker';
  customUserMarker = new mapboxgl.Marker(el).setLngLat(userLocation).addTo(map);

  showToast("Origen fijado manualmente.");

  // Update logic to set originPOI for the new navigation system
  originPOI = {
    properties: { nombre: name, name: name, edificio: 'Mapa' },
    geometry: { coordinates: coords }
  };
  originInput.value = name;

  // Return to the search/route view instead of resetting everything
  if (destinationPOI) {
    checkAndDrawRoute();
  } else if (pendingRouteCoords) {
    drawDualRoute(userLocation, pendingRouteCoords);
    pendingRouteCoords = null;
  } else {
    // If we just clicked map without a destination (unlikely in this flow)
    resetSheet();
  }
}


map.on('click', (e) => {
  if (preventClick) return;

  if (manualLocationMode && !userLocationLocked) {
    setManualOrigin([e.lngLat.lng, e.lngLat.lat]);
    preventClick = true;
    setTimeout(() => preventClick = false, 50);
    return;
  }

  if (currentMarker) return;

  const bbox = [[e.point.x - 15, e.point.y - 15], [e.point.x + 15, e.point.y + 15]];
  const features = map.queryRenderedFeatures(bbox);

  const interactiveLayers = [
    'misc-labels', 'misc-fixed-labels', 'metro-labels',
    'misc-icons', 'misc-fixed-icons', 'metro-icons'
  ];
  
  const clickedInteractive = features.some(f => {
    if (!f.layer) return false;
    const isInteractive = interactiveLayers.includes(f.layer.id) || f.layer.id.includes('point');
    if (!isInteractive) return false;
    
    if (f.source === 'misc') {
      const state = map.getFeatureState({ source: 'misc', id: f.id });
      if (!state || state.opacity < 0.1) return false;
    }
    return true;
  });

  if (clickedInteractive) return;

  resetSheet();
});

// --- UI Sheet Handlers ---
function openSheet(state) {
  const vh = window.innerHeight;
  const topUi = document.querySelector('.top-ui');
  if (topUi) { FULL_OFFSET = topUi.getBoundingClientRect().top; }

  let targetY = vh - REST_OFFSET;
  if (state === 'MID') targetY = vh - MID_OFFSET;
  if (state === 'FULL') targetY = FULL_OFFSET;

  currentSheetState = state;
  sheetY = targetY;
  bottomSheet.style.transition = "transform 0.4s cubic-bezier(0.1, 0.7, 0.1, 1)";
  updateUIPositions(targetY);
}

function updateUIPositions(y) {
  sheetY = y;
  document.documentElement.style.setProperty('--sheet-y', `${y}px`);
}

// Interactivity
bottomSheet.addEventListener('touchstart', (e) => {
  // Ignore if clicking buttons, inputs, or scrolling within results
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || e.target.closest('.search-results') || e.target.closest('.chip')) return;
  if (bottomSheet.scrollTop > 0) return;

  isDragging = true;
  startY = e.touches[0].clientY;
  startSheetY = sheetY;
  bottomSheet.style.transition = 'none';
}, { passive: true });

document.addEventListener('touchmove', (e) => {
  if (!isDragging) return;
  const deltaY = e.touches[0].clientY - startY;
  sheetY = startSheetY + deltaY;
  updateUIPositions(sheetY);
});

document.addEventListener('touchend', () => {
  if (!isDragging) return;
  isDragging = false;
  const vh = window.innerHeight;
  if (sheetY < vh * 0.3) openSheet('FULL');
  else if (sheetY < vh * 0.7) openSheet('MID');
  else openSheet('REST');
});

searchInput.addEventListener('click', () => {
  if (searchInput.value.length === 0) {
    openSearchSheet('simple');
  }
});

searchInput.addEventListener('input', (e) => {
  performSearch(e.target.value, resultsContainer, (f) => {
    selectSala(f, f.geometry.coordinates);
    searchInput.value = '';
  });
});

sheetMainInput.addEventListener('input', (e) => {
  performSearch(e.target.value, sheetSearchResults, (f) => {
    selectSala(f, f.geometry.coordinates);
  });
});
sheetMainInput.addEventListener('focus', () => lastFocusedSearchInput = sheetMainInput);

sheetMainInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const firstResult = sheetSearchResults.querySelector('li');
    if (firstResult) firstResult.click();
  }
});

originInput.addEventListener('input', (e) => {
  performSearch(e.target.value, sheetSearchResults, setOriginPOI);
});
originInput.addEventListener('focus', () => {
  lastFocusedSearchInput = originInput;
});

destinationInput.addEventListener('input', (e) => {
  performSearch(e.target.value, sheetSearchResults, setDestinationPOI);
});
destinationInput.addEventListener('focus', () => lastFocusedSearchInput = destinationInput);

btnBackSearch.onclick = () => {
  if (destinationPOI) {
    // Return to POI view if we came from there
    searchSheetContent.classList.add('hidden');
    poiSheetContent.classList.remove('hidden');
    openSheet('MID');
  } else {
    resetSheet();
  }
};

btnUseLocation.onclick = () => {
  if (userLocation) {
    originPOI = {
      properties: { nombre: 'Tu ubicación', name: 'Tu ubicación', edificio: 'GPS' },
      geometry: { coordinates: userLocation }
    };
    originInput.value = 'Tu ubicación';
    checkAndDrawRoute();
  } else {
    geolocateControl.trigger();
    showToast("Obteniendo ubicación...");
  }
};

// Global History Load
window.addEventListener('DOMContentLoaded', () => {
  HistoryManager.render();
});


// Auto-select first result on Enter key
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const firstResult = resultsContainer.querySelector('li');
    if (firstResult) firstResult.click();
  }
});

// Category Chips
categoryChips.forEach(chip => {
  chip.addEventListener('click', () => {
    if (chip.id === 'btn-more') {
      openSheet('FULL');
      return;
    }

    const wasActive = chip.classList.contains('active');

    // Clear all
    categoryChips.forEach(c => c.classList.remove('active'));
    for (let cat in window._spriteMarkers) {
      window._spriteMarkers[cat].forEach(m => m.getElement().style.display = 'none');
    }

    if (!wasActive) {
      chip.classList.add('active');
      const cat = chip.dataset.category || chip.id.split('-')[1]; // handles data or id

      // Camera movement
      map.flyTo({
        center: [-70.685117, -33.449467],
        zoom: 15.5,
        pitch: 0,
        bearing: 0,
        duration: 2000
      });

      // Show specific markers
      let markerCat = cat;
      if (cat === 'baños' || cat === 'banos') markerCat = 'banos';
      if (cat === 'dispensadores') markerCat = 'dispensador';
      if (cat === 'cajeros') markerCat = 'cajero';

      if (window._spriteMarkers[markerCat]) {
        window._spriteMarkers[markerCat].forEach(m => m.getElement().style.display = 'block');
      }
    } else {
      resetSheet();
    }
  });
});


btnCloseRoute.onclick = () => {
  resetSheet();
};

// Routing
function drawDualRoute(start, end) {
  const path = findShortestPath(start, end);
  if (!path) {
    showToast("No se encontró ruta válida.");
    return;
  }
  const line = { type: 'Feature', geometry: { type: 'LineString', coordinates: path } };
  map.getSource('route').setData({ type: 'FeatureCollection', features: [line] });

  defaultSheetContent.classList.add('hidden');
  poiSheetContent.classList.add('hidden');
  routeSheetContent.classList.remove('hidden');
  searchSheetContent.classList.add('hidden');
  if (routeInfo) {

    routeInfo.textContent = `${Math.round(turf.length(line) * 15)} min (${Math.round(turf.length(line) * 1000)}m)`;
  }
  openSheet('MID');

  // Fly to overview
  map.flyTo({
    center: [-70.685117, -33.449467],
    zoom: 15.5,
    pitch: 0,
    bearing: 0,
    duration: 2000
  });
}

function buildGraph(data) {
  const g = new Map();

  function snap(coord) {
    return Number(coord[0]).toFixed(5) + ',' + Number(coord[1]).toFixed(5);
  }

  data.features.forEach(feature => {
    const isOneway = feature.properties && feature.properties.oneway === true;
    const coords = feature.geometry.coordinates;

    for (let i = 0; i < coords.length - 1; i++) {
      const uStr = snap(coords[i]);
      const vStr = snap(coords[i + 1]);

      if (uStr !== vStr) {
        const dist = turf.distance(coords[i], coords[i + 1], { units: 'kilometers' });

        if (!g.has(uStr)) g.set(uStr, { coord: coords[i], edges: [] });
        if (!g.has(vStr)) g.set(vStr, { coord: coords[i + 1], edges: [] });

        g.get(uStr).edges.push({ to: vStr, dist });
        if (!isOneway) {
          g.get(vStr).edges.push({ to: uStr, dist });
        }
      }
    }
  });

  return g;
}

function findShortestPath(startCoords, endCoords) {
  let startNode = null, endNode = null;
  let minDistS = Infinity, minDistE = Infinity;

  // Find nearest snapped nodes in graph using actual coordinates
  for (let [nodeKey, nodeData] of graph.entries()) {
    const dS = turf.distance(startCoords, nodeData.coord);
    const dE = turf.distance(endCoords, nodeData.coord);
    if (dS < minDistS) { minDistS = dS; startNode = nodeKey; }
    if (dE < minDistE) { minDistE = dE; endNode = nodeKey; }
  }

  if (!startNode || !endNode) {
    return null; // Fallback to basic map logic
  }

  const distances = new Map();
  const prev = new Map();
  const pq = new PriorityQueue();

  distances.set(startNode, 0);
  pq.push(startNode, 0);

  while (pq.size() > 0) {
    const { node: u } = pq.pop();
    if (u === endNode) break;

    const neighbors = graph.get(u).edges || [];
    for (let { to: v, dist } of neighbors) {
      const alt = (distances.get(u) ?? Infinity) + dist;
      if (alt < (distances.get(v) ?? Infinity)) {
        distances.set(v, alt);
        prev.set(v, u);
        pq.push(v, alt);
      }
    }
  }

  if (!prev.has(endNode) && startNode !== endNode) {
    return null;
  }

  const path = [];

  let curr = endNode;
  while (curr) {
    path.unshift(graph.get(curr).coord);
    curr = prev.get(curr);
  }

  // Connect exactly to the destination pin
  if (path.length === 0 || path[path.length - 1].join(',') !== endCoords.join(',')) {
    path.push(endCoords);
  }

  // Connect exactly to the origin pin
  if (path[0].join(',') !== startCoords.join(',')) {
    path.unshift(startCoords);
  }

  return path;
}

function showToast(msg, error = false) {
  const t = document.createElement('div');
  t.className = `toast ${error ? 'error' : ''}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function updateDate() {
  if (!sheetDate) return;
  const options = { weekday: 'long', day: 'numeric', month: 'long' };
  const today = new Date();
  let dateStr = today.toLocaleDateString('es-ES', options);
  // Capitalize first letter
  dateStr = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
  sheetDate.textContent = dateStr;
}

// Initial Position and Resize Handling
function initSheet() {
  sheetY = window.innerHeight - REST_OFFSET;
  updateUIPositions(sheetY);
  updateDate();
}

window.addEventListener('load', initSheet);
window.addEventListener('resize', () => {
  // Mantain state on resize
  if (currentSheetState === 'REST') sheetY = window.innerHeight - REST_OFFSET;
  else if (currentSheetState === 'MID') sheetY = window.innerHeight - MID_OFFSET;
  else if (currentSheetState === 'FULL') {
    const topUi = document.querySelector('.top-ui');
    if (topUi) FULL_OFFSET = topUi.getBoundingClientRect().top;
    sheetY = FULL_OFFSET;
  }
  updateUIPositions(sheetY);
});

initSheet();

btnClosePoi.onclick = () => resetSheet();
