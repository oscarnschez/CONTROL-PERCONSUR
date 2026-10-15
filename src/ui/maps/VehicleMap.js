/*
 * VehicleMap — vista individual de una unidad sobre MapLibre: su marcador, la bandera del destino (si se conoce) y
 * los controles para acercar, alejar, centrar la unidad y ver unidad y destino juntos.
 * Mientras no se mueva el mapa a mano, la vista acompaña a la unidad en cada actualización. No dibuja recorridos.
 * La usa el portal del cliente (CustomerTrackingMap) y sirve para cualquier vista de una sola unidad.
 */
import { createBaseMap } from './engine.js';
import { VehicleMarker, destinationMarker } from './VehicleMarker.js';
import { MapControls } from './MapControls.js';

/*
 * opts: { centerLabel, fitLabel, views } → { setVehicle(v|null), setDestination(d|null), recenter(), showAll(), view, setView(v), destroy() }
 *   views  true = botón para cambiar entre vista de mapa y satelital
 */
export async function createVehicleMap(container, { centerLabel = 'Centrar unidad', fitLabel = 'Ver unidad y destino', views = false } = {}) {
  const base = await createBaseMap(container, { views });
  const { ml, map } = base;
  let vm = null, dest = null, destPt = null, destKey = '', follow = true, mode = 'both', framed = false, gone = false;
  const controls = new MapControls({ onCenter: () => api.recenter(), onFit: () => api.showAll(), centerLabel, fitLabel, base: views ? base : null });
  map.addControl(controls, 'top-right');
  controls.setCenterEnabled(false);
  map.on('dragstart', () => { follow = false; });
  const sized = () => container.clientWidth > 40 && container.clientHeight > 40;
  map.on('resize', () => { if (follow) frame(false); });

  function frame(animate = true) {
    if (gone || !sized()) return;
    const u = vm ? vm.target() : null;
    const duration = animate ? 800 : 0;
    if (u && (!destPt || mode === 'vehicle')) { map.easeTo({ center: [u.lng, u.lat], zoom: mode === 'vehicle' ? Math.max(map.getZoom(), 13.5) : 13, duration, essential: true }); return; }
    if (u && destPt) {
      const bb = new ml.LngLatBounds([u.lng, u.lat], [u.lng, u.lat]); bb.extend([destPt.lng, destPt.lat]);
      /* Margen para la etiqueta del destino (arriba), el nombre de la unidad y la atribución (abajo) y los controles */
      const p = Math.min(56, Math.floor(Math.min(container.clientWidth, container.clientHeight) / 6));
      map.fitBounds(bb, { padding: { top: p + 40, bottom: p + 48, left: p + 40, right: p + 64 }, maxZoom: 14, duration });
      return;
    }
    if (destPt) map.easeTo({ center: [destPt.lng, destPt.lat], zoom: 11, duration });
  }
  const api = {
    ml, map,
    /* v: { lat, lng, label, tone, trailerType, motion, heading, title } | null */
    setVehicle(v) {
      if (gone) return;
      if (!v || !Number.isFinite(v.lat) || !Number.isFinite(v.lng)) { if (vm) { vm.remove(); vm = null; } controls.setCenterEnabled(false); return; }
      if (!vm) { vm = new VehicleMarker(ml, { id: 'u', ...v }).addTo(map); vm.el.tabIndex = -1; }
      else { vm.setData({ id: 'u', ...v }); vm.moveTo(v.lat, v.lng, { animate: framed }); }
      controls.setCenterEnabled(true);
      if (follow) frame(framed);
      framed = true;
    },
    setDestination(d) {
      const key = d ? `${d.lat},${d.lng},${d.label},${d.approx ? 1 : 0}` : '';
      if (key === destKey || gone) return;
      destKey = key;
      if (dest) { dest.remove(); dest = null; }
      destPt = d && Number.isFinite(d.lat) && Number.isFinite(d.lng) ? d : null;
      if (destPt) dest = destinationMarker(ml, d).addTo(map);
      if (follow) frame(framed);
    },
    /* Posición actual del marcador de la unidad (o null) */
    vehicle: () => (vm ? vm.target() : null),
    recenter() { follow = true; mode = 'vehicle'; frame(true); },
    showAll() { follow = true; mode = 'both'; frame(true); },
    resize() { if (!gone) map.resize(); },
    get view() { return base.view; },
    setView: (v) => base.setView(v),
    destroy() { if (gone) return; gone = true; if (vm) vm.remove(); if (dest) dest.remove(); base.destroy(); },
  };
  container._vmap = api;   /* acceso para pruebas automatizadas */
  return api;
}
