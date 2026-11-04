// Panel de desarrollo (?dev): hora del día, clima y FPS. Las funciones de clima/hora están en pausa
// (ver FEATURES en mapview.js); este panel permite seguir trabajándolas sin mostrarlas a los usuarios.
import { mapView, FEATURES } from './mapview.js';

const panel = document.querySelector('.time-panel');
const timeSlider = document.getElementById('time-slider');
const timeLabel = document.getElementById('time-label');
const dateSelect = document.getElementById('date-select');
const btnPlay = document.getElementById('btn-play');
const weatherSelect = document.getElementById('weather-select');
const weatherInfo = document.getElementById('weather-info');
const statsEl = document.getElementById('stats');
const weather = mapView.weather;

panel.hidden = false;
let followNow = FEATURES.timeOfDay, playing = false;

const cardinal = (deg) => ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(((deg % 360) + 360) % 360 / 45) % 8];
mapView.onTime((d, pos) => {
  timeSlider.value = d.getHours() * 60 + d.getMinutes();
  timeLabel.textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const alt = Math.round(pos.altitude * 180 / Math.PI), az = Math.round(pos.bearing * 180 / Math.PI);
  document.getElementById('sun-info').textContent = alt > 0 ? `Sol ${alt}° · ${cardinal(az)}` : 'Sol bajo el horizonte';
});
mapView.setTime(mapView.time); // pinta el estado actual

function dateForSlider() {
  const base = new Date();
  if (dateSelect.value === 'jun') base.setMonth(5, 21);
  if (dateSelect.value === 'dic') base.setMonth(11, 21);
  base.setHours(0, 0, 0, 0);
  return new Date(base.getTime() + Number(timeSlider.value) * 60000);
}
const syncPlay = () => { btnPlay.textContent = playing ? '❚❚' : '▶'; };
timeSlider.addEventListener('input', () => { followNow = false; playing = false; syncPlay(); mapView.setTime(dateForSlider()); });
dateSelect.addEventListener('change', () => { followNow = dateSelect.value === 'hoy' && followNow; mapView.setTime(dateForSlider()); });
document.getElementById('btn-now').addEventListener('click', () => { followNow = true; playing = false; syncPlay(); dateSelect.value = 'hoy'; mapView.setTime(new Date()); });
btnPlay.addEventListener('click', () => { playing = !playing; followNow = false; syncPlay(); });
setInterval(() => { if (followNow) mapView.setTime(new Date()); }, 60000);
mapView.onFrame((dt) => { if (playing) mapView.setTime(new Date(mapView.time.getTime() + dt * 60)); }); // 1 hora por segundo

// clima
const WEATHER_ICONS = { Despejado: '☀️', 'Mayormente despejado': '🌤️', 'Parcialmente nublado': '⛅', Nublado: '☁️', Niebla: '🌫️', Llovizna: '🌦️', Lluvia: '🌧️', Chubascos: '🌧️', Nieve: '🌨️', Tormenta: '⛈️' };
function renderWeatherInfo() {
  const a = weather.api;
  const real = a ? `${WEATHER_ICONS[a.state.label] || ''} ${a.state.label} · ${a.temp}°` : 'Clima no disponible';
  weatherSelect.options[0].textContent = a ? `Auto (${a.state.label.toLowerCase()})` : 'Auto';
  weatherInfo.textContent = weather.mode === 'auto' ? real : `${WEATHER_ICONS[weather.target.label] || ''} ${weather.target.label} (forzado) · real: ${a ? a.temp + '°' : '—'}`;
}
weatherSelect.addEventListener('change', () => { weather.mode = weatherSelect.value; renderWeatherInfo(); });
if (FEATURES.weather) {
  weather.startAutoRefresh(renderWeatherInfo);
  const forced = new URLSearchParams(location.search).get('clima'); // ?dev&clima=lluvia para probar
  if (forced && forced in { despejado: 1, nublado: 1, llovizna: 1, lluvia: 1, tormenta: 1 }) { weather.mode = forced; weatherSelect.value = forced; }
}

mapView.on('stats', (s) => { statsEl.textContent = `${s.fps} fps · ${s.calls} draw calls · ${s.load}${s.gesture ? ' · gesto: ' + s.gesture : ''}`; });

// Identificador del edificio/modelo tocado (el nombre del objeto en Blender): se resalta y se muestra abajo del
// buscador. Sirve para pedir cambios de geometría ("agrégale ventanas a Edificio 213").
const objectToast = document.createElement('div');
objectToast.className = 'object-toast';
objectToast.hidden = true;
document.body.append(objectToast);
let toastTimer = 0;
mapView.on('tap', ({ object }) => {
  mapView.highlightObject(object?.id);
  objectToast.hidden = !object;
  if (!object) return;
  const why = reviewReason[object.name];
  objectToast.textContent = `${object.name} · ${object.layer === 'buildings' ? 'edificio' : 'modelo'}${why ? ' · ' + why : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { objectToast.hidden = true; mapView.highlightObject(0); }, 6000);
});

// Edificios a revisar tras ajustar alturas con la fotogrametría (tools/fotogrametria/alturas.mjs):
//  magenta = la foto no muestra nada ahí (canchas, sitios): no se tocaron
//  ámbar   = la foto muestra partes de distinta altura: se ajustaron a la altura típica, mirar si se perdió una torre
const REVIEW_COLORS = { noExiste: ['#e91e63', 'no existe en la foto'], variasAlturas: ['#ffb300', 'varias alturas en la foto'] };
const reviewReason = {};
fetch('assets/revisar-alturas.json').then((r) => (r.ok ? r.json() : null)).then((review) => {
  if (!review) return;
  const byName = {};
  for (const [key, [color, why]] of Object.entries(REVIEW_COLORS)) for (const name of review[key] || []) { byName[name] = color; reviewReason[name] = why; }
  mapView.markObjects(byName);
  const legend = document.createElement('div');
  legend.className = 'review-legend';
  legend.innerHTML = Object.entries(REVIEW_COLORS).map(([key, [color, why]]) => `<span><i style="background:${color}"></i>${why} (${(review[key] || []).length})</span>`).join('');
  panel.append(legend);
}).catch(() => {});
