/*
 * Mapa de la ubicación GPS (Leaflet, incluido en /vendor/leaflet). Se carga al mostrar una unidad con GPS (detalle o tarjeta de Inicio).
 * Mapa base: OpenStreetMap (uso ligero con atribución). El marcador (el mismo del Centro de Monitoreo) muestra la unidad con el
 * color de su estado de Logística.
 */
import { loadLib } from '../../services/libs.js';
import { esc } from '../../domain/shared/format.js';
import { icon } from './icons.js';
import { unitMarkHTML } from '../maps/VehicleMarker.js';

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIB = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

function ensureCss() {
  if (document.querySelector('link[data-leaflet]')) return;
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = './vendor/leaflet/leaflet.css'; l.dataset.leaflet = '1';
  document.head.appendChild(l);
}
/* Mismo marcador que el Centro de Monitoreo: círculo del color del estado con silueta de tractocamión y número económico */
const pinIcon = (L, label, tone, stale) => L.divIcon({
  className: 'gps-pin-wrap', iconSize: null, iconAnchor: [0, 0],
  html: unitMarkHTML({ label, tone, motion: stale ? 'nosignal' : 'stopped', cls: stale ? 'gps-pin stale' : 'gps-pin' }),
});

const KIND_ICON = { delivery: 'flag', place: 'flag', city: 'flag', plant: 'building', terminal: 'container', yard: 'yard' };
const targetIcon = (L, t) => L.divIcon({
  className: 'gps-pin-wrap', iconSize: null, iconAnchor: [0, 0],
  html: `<div class="gps-tgt${t.approx ? ' approx' : ''}">${icon[KIND_ICON[t.kind] || 'flag']}<b>${esc(t.label)}</b></div>`,
});

/*
 * Crea el mapa dentro de el; devuelve { update(lat, lng, opts), setTarget(t), recenter(), resize(), destroy() }
 * interactive: false → vista fija (sin arrastre, zoom ni botones) para las tarjetas de Inicio: no roba el deslizamiento
 * lateral de las fichas y el toque llega a la tarjeta.
 * setTarget({ lat, lng, label, kind, approx } | null): marca el destino (o patio) con una línea punteada desde la unidad;
 * mientras no se mueva el mapa a mano, la vista encuadra la unidad y el destino.
 */
export async function mountMap(el, { lat, lng, label, tone = 'blue', stale = false, zoom = 13, interactive = true }) {
  ensureCss();
  await loadLib('leaflet');
  const L = window.L;
  const map = L.map(el, interactive ? { zoomControl: true, attributionControl: true, tap: true, scrollWheelZoom: false, zoomSnap: 0.5 }
    : { zoomControl: false, attributionControl: true, dragging: false, touchZoom: false, doubleClickZoom: false, scrollWheelZoom: false, boxZoom: false, keyboard: false, tap: false, inertia: false, zoomSnap: 0.25 })
    .setView([lat, lng], zoom);
  if (!interactive) map.attributionControl.setPrefix(false);
  L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIB, crossOrigin: true }).addTo(map);
  let tMarker = null, line = null, tKey = '', gone = false;
  const marker = L.marker([lat, lng], { icon: pinIcon(L, label, tone, stale), keyboard: false, zIndexOffset: 1000 }).addTo(map);
  let follow = true;
  map.on('dragstart', () => { follow = false; });
  /* Encuadre: la unidad (y el destino si lo hay). Sin tamaño todavía (aún no se muestra) no se calcula: Leaflet quedaría
     con un zoom equivocado; se vuelve a encuadrar en resize(). */
  const frame = (animate = interactive) => {
    const sz = map.getSize();
    if (!sz.x || !sz.y) return;
    const u = marker.getLatLng();
    if (!tMarker) { map.setView(u, Math.max(map.getZoom(), zoom), { animate }); return; }
    const pad = interactive ? [48, 48] : [30, 34];
    map.fitBounds(L.latLngBounds([u, tMarker.getLatLng()]), { paddingTopLeft: [pad[0], pad[1] + 10], paddingBottomRight: [pad[0], pad[1] - 10], maxZoom: 15, animate });
  };
  return {
    update(nlat, nlng, opts = {}) {
      if (gone) return;
      marker.setLatLng([nlat, nlng]);
      if (line) line.setLatLngs([[nlat, nlng], tMarker.getLatLng()]);
      if (opts.label !== undefined || opts.tone !== undefined || opts.stale !== undefined) marker.setIcon(pinIcon(L, opts.label ?? label, opts.tone ?? tone, !!opts.stale));
      if (follow) { if (tMarker) frame(); else map.panTo([nlat, nlng], { animate: interactive }); }
    },
    setTarget(t) {
      if (gone) return;
      const key = t ? `${t.lat},${t.lng},${t.label},${t.kind},${t.approx ? 1 : 0}` : '';
      if (key === tKey) return;
      tKey = key;
      if (tMarker) { tMarker.remove(); tMarker = null; }
      if (line) { line.remove(); line = null; }
      if (t) {
        tMarker = L.marker([t.lat, t.lng], { icon: targetIcon(L, t), keyboard: false }).addTo(map);
        line = L.polyline([marker.getLatLng(), [t.lat, t.lng]], { className: 'gps-line', weight: 3, dashArray: '2 8', lineCap: 'round', interactive: false }).addTo(map);
      }
      if (follow) frame(false);
    },
    recenter() { if (!gone) { follow = true; frame(); } },
    resize() { if (gone) return; map.invalidateSize({ pan: false }); if (follow) frame(false); },
    destroy() { if (!gone) { gone = true; map.remove(); } },
  };
}
