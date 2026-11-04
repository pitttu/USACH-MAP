// Sistema de coordenadas de la escena:
// origen = centro del campus, 1 unidad = 1 metro, x = este, y = arriba, z = sur (-z = norte)
export const LON0 = -70.685117, LAT0 = -33.449467;
const MX = Math.cos(LAT0 * Math.PI / 180) * 111320;
const MY = 110574;

export const toLocal = (lon, lat) => [(lon - LON0) * MX, -(lat - LAT0) * MY];
export const toLonLat = (x, z) => [x / MX + LON0, -z / MY + LAT0];

// Mismos límites que maxBounds en app.js
const sw = toLocal(-70.691592, -33.452748), ne = toLocal(-70.679338, -33.443767);
export const BOUNDS = { x0: sw[0], x1: ne[0], z0: ne[1], z1: sw[1] };

// Equivalencia zoom de Mapbox <-> distancia de cámara (mismo fov que Mapbox GL)
export const FOV = 36.87;
export function zoomToDistance(zoom, viewportH) {
  const mpp = 40075016.686 * Math.cos(LAT0 * Math.PI / 180) / (512 * 2 ** zoom);
  return viewportH * mpp / (2 * Math.tan(FOV * Math.PI / 360));
}
