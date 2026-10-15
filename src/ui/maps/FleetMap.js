/*
 * FleetMap — mapa de toda la flota (Centro de Monitoreo GPS), sobre MapLibre.
 *   setVehicles(lista)   coloca o mueve los marcadores (solo unidades con coordenadas: nunca se inventa una posición);
 *                        no reconstruye el mapa ni los marcadores existentes, solo cambia lo que llegó distinto.
 *   select(id) / focus(id)  marca la unidad, acerca y centra suavemente; mientras no se mueva el mapa a mano la sigue.
 *   fitFleet()           encuadra todas las unidades con coordenadas (vista general).
 *   setDestination(d)    bandera del destino de la unidad elegida (sin dibujar recorridos).
 * Rendimiento (muchas unidades, iPhone): los marcadores nuevos se agregan por tandas; con más de 25 unidades las
 * cercanas se agrupan al alejar (burbuja con el número; al tocarla se acerca) y con más de 60 los marcadores fuera de la
 * vista se retiran del mapa hasta que vuelven a quedar visibles.
 */
import { createBaseMap } from './engine.js';
import { VehicleMarker, destinationMarker } from './VehicleMarker.js';
import { MapControls } from './MapControls.js';
import { MEXICO } from './mapStyle.js';

const CLUSTER_MIN = 25, CLUSTER_PX = 54, CLUSTER_MAX_ZOOM = 11.5, CULL_MIN = 60, CHUNK = 40;

/*
 * opts: { onSelect(id|null), onFit(), popupHTML(id) → html (tarjeta al tocar el marcador; null = sin tarjeta),
 *         padding() → {top,right,bottom,left} (espacio que tapan los paneles), onMapClick() }
 */
export async function createFleetMap(container, { onSelect = () => {}, onFit = null, popupHTML = null, padding = () => ({}), onMapClick = null } = {}) {
  const base = await createBaseMap(container, { views: true });
  const { ml, map } = base;
  const markers = new Map();
  let sel = null, follow = false, fitted = false, pendingFit = false, gone = false, popups = !!popupHTML;
  let popup = null, closingPopup = false, dest = null, destKey = '', queue = [], qraf = 0, lraf = 0;
  const clusters = [];

  /* Margen para encuadrar: paneles que tapan el mapa + aire; nunca más grande que el propio mapa */
  function pad(extra = 48) {
    const p = padding() || {}, w = container.clientWidth, h = container.clientHeight;
    const out = { top: (p.top || 0) + extra, right: (p.right || 0) + extra + 44, bottom: (p.bottom || 0) + extra, left: (p.left || 0) + extra };
    const sx = Math.min(1, Math.max(0, w - 80) / Math.max(1, out.left + out.right)), sy = Math.min(1, Math.max(0, h - 80) / Math.max(1, out.top + out.bottom));
    return { top: Math.floor(out.top * sy), bottom: Math.floor(out.bottom * sy), left: Math.floor(out.left * sx), right: Math.floor(out.right * sx) };
  }
  const sized = () => container.clientWidth > 40 && container.clientHeight > 40;
  /* Centro visible (descontando paneles) como desplazamiento: no deja un margen fijo en el mapa */
  const offset = () => { const p = pad(0); return [Math.round((p.left - p.right) / 2), Math.round((p.top - p.bottom) / 2)]; };

  const controls = new MapControls({ onFit: () => (onFit ? onFit() : api.fitFleet()), onCenter: () => { if (sel) api.focus(sel); }, fitLabel: 'Ver toda la flota', centerLabel: 'Centrar unidad', base });
  map.addControl(controls, 'top-right');
  controls.setCenterEnabled(false);
  map.on('dragstart', () => { follow = false; });
  map.on('click', (e) => {
    const t = e.originalEvent && e.originalEvent.target;
    if (t && t.closest && t.closest('.vm,.vm-cl,.maplibregl-popup,.mc')) return;
    if (onMapClick) onMapClick();
  });
  map.on('moveend', () => schedule());
  map.on('resize', () => { if (pendingFit && sized()) { pendingFit = false; api.fitFleet({ animate: false }); } });

  const inView = (p) => { try { const b = map.getBounds(); return b.contains([p.lng, p.lat]); } catch (e) { return false; } };

  /* ===== Marcadores ===== */
  function setVehicles(list) {
    if (gone) return;
    const seen = new Set(), selBefore = sel && markers.get(sel) ? markers.get(sel).target() : null;
    for (const v of list) {
      if (!Number.isFinite(v.lat) || !Number.isFinite(v.lng)) continue;
      seen.add(v.id);
      const m = markers.get(v.id);
      if (!m) {
        const id = v.id;
        const nm = new VehicleMarker(ml, v, { onClick: (x) => onSelect(x), onMove: (ll) => { if (sel === id && popup) popup.setLngLat(ll); } });
        markers.set(id, nm); queue.push(nm);
        if (id === sel) nm.setSelected(true);
      } else {
        const animate = m.onMap && (inView(m.lngLat()) || inView(v));
        m.setData(v); m.moveTo(v.lat, v.lng, { animate });
      }
    }
    for (const [id, m] of markers) if (!seen.has(id)) { m.remove(); markers.delete(id); }
    flush();
    if (!fitted && markers.size) { fitted = true; api.fitFleet({ animate: false }); }
    /* La vista acompaña a la unidad elegida solo si se movió (no interrumpe un acercamiento en curso) */
    if (sel && follow) {
      const m = markers.get(sel);
      if (m && sized() && selBefore && (Math.abs(selBefore.lat - m.data.lat) > 1e-6 || Math.abs(selBefore.lng - m.data.lng) > 1e-6)) map.easeTo({ center: [m.data.lng, m.data.lat], offset: offset(), duration: 900, essential: true });
    }
    controls.setCenterEnabled(!!(sel && markers.has(sel)));
    updatePopup();
    schedule();
  }
  /* Carga progresiva: tandas de marcadores por cuadro de animación */
  function flush() {
    if (qraf || !queue.length) return;
    const run = () => {
      qraf = 0;
      queue.splice(0, CHUNK).forEach((m) => { if (markers.get(m.data.id) === m) m.addTo(map); });
      if (queue.length) qraf = requestAnimationFrame(run); else schedule();
    };
    qraf = requestAnimationFrame(run);
  }

  /* ===== Agrupación y retiro de marcadores fuera de la vista ===== */
  function schedule() { if (!lraf && !gone) lraf = requestAnimationFrame(layout); }
  function layout() {
    lraf = 0;
    if (gone || queue.length) return;
    const list = [...markers.values()], many = list.length > CLUSTER_MIN && map.getZoom() < CLUSTER_MAX_ZOOM;
    const groups = new Map(), singles = [];
    for (const m of list) {
      if (!many || m.data.id === sel) { singles.push(m); continue; }
      const p = map.project([m.data.lng, m.data.lat]), k = `${Math.floor(p.x / CLUSTER_PX)}:${Math.floor(p.y / CLUSTER_PX)}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(m);
    }
    const grouped = [];
    for (const g of groups.values()) if (g.length > 1) grouped.push(g); else singles.push(g[0]);
    let b = null;
    if (list.length > CULL_MIN) { try { const bb = map.getBounds(), dx = (bb.getEast() - bb.getWest()) * 0.25, dy = (bb.getNorth() - bb.getSouth()) * 0.25; b = new ml.LngLatBounds([bb.getWest() - dx, bb.getSouth() - dy], [bb.getEast() + dx, bb.getNorth() + dy]); } catch (e) { b = null; } }
    for (const m of singles) { if (!b || m.data.id === sel || b.contains([m.data.lng, m.data.lat])) m.addTo(map); else m.detach(); }
    grouped.forEach((g) => g.forEach((m) => m.detach()));
    while (clusters.length > grouped.length) clusters.pop().marker.remove();
    grouped.forEach((g, i) => {
      let c = clusters[i];
      if (!c) c = clusters[i] = makeCluster();
      const lng = g.reduce((s, m) => s + m.data.lng, 0) / g.length, lat = g.reduce((s, m) => s + m.data.lat, 0) / g.length;
      c.group = g; c.el.querySelector('b').textContent = g.length;
      c.el.setAttribute('aria-label', `${g.length} unidades juntas. Acercar`);
      c.marker.setLngLat([lng, lat]);
      if (!c.on) { c.marker.addTo(map); c.on = true; }
    });
  }
  function makeCluster() {
    const el = document.createElement('button');
    el.type = 'button'; el.className = 'vm-cl'; el.innerHTML = '<b></b>';
    const c = { el, group: [], on: false, marker: new ml.Marker({ element: el, anchor: 'center' }) };
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const bb = new ml.LngLatBounds();
      c.group.forEach((m) => bb.extend([m.data.lng, m.data.lat]));
      map.fitBounds(bb, { padding: pad(70), maxZoom: CLUSTER_MAX_ZOOM + 1.5, duration: 700 });
    });
    return c;
  }

  /* ===== Unidad elegida, tarjeta y destino ===== */
  function updatePopup() {
    const m = sel && markers.get(sel);
    if (!popups || !m || !popupHTML) { closePopup(); return; }
    const box = document.createElement('div');
    box.className = 'vm-pop-in';
    box.innerHTML = popupHTML(sel);
    if (!popup) {
      popup = new ml.Popup({ closeButton: true, closeOnClick: false, closeOnMove: false, offset: 30, maxWidth: '300px', className: 'vm-pop', focusAfterOpen: false });
      popup.on('close', () => { if (!closingPopup) { popup = null; onSelect(null); } });
    }
    popup.setDOMContent(box).setLngLat([m.lngLat().lng, m.lngLat().lat]);
    if (!popup.isOpen()) popup.addTo(map);
  }
  function closePopup() { if (popup) { closingPopup = true; popup.remove(); closingPopup = false; popup = null; } }

  const api = {
    ml, map, el: container,
    /* Vista de mapa o satelital ('map'|'satellite') */
    get view() { return base.view; },
    setView: (v) => base.setView(v),
    setVehicles,
    selected: () => sel,
    count: () => markers.size,
    hasMarker: (id) => markers.has(id),
    /* Marca la unidad; fly → acerca y centra suavemente (id null = ninguna) */
    select(id, { fly = true } = {}) {
      if (sel && markers.get(sel)) markers.get(sel).setSelected(false);
      sel = id || null;
      const m = sel && markers.get(sel);
      if (m) { m.setSelected(true); m.addTo(map); }
      controls.setCenterEnabled(!!m);
      if (!sel) { follow = false; api.setDestination(null); }
      updatePopup(); schedule();
      if (m && fly) api.focus(sel);
    },
    focus(id) {
      const m = markers.get(id); if (!m) return;
      follow = true;
      if (!sized()) return;
      map.easeTo({ center: [m.data.lng, m.data.lat], zoom: Math.max(map.getZoom(), 13.5), offset: offset(), duration: 1000, essential: true });
    },
    /* Vista general: todas las unidades con coordenadas */
    fitFleet({ animate = true } = {}) {
      follow = false;
      if (!sized()) { pendingFit = true; return; }
      const pts = [...markers.values()].map((m) => m.data);
      if (!pts.length) { map.easeTo({ center: MEXICO.center, zoom: MEXICO.zoom, duration: animate ? 700 : 0 }); return; }
      if (pts.length === 1) { map.easeTo({ center: [pts[0].lng, pts[0].lat], zoom: 12.5, offset: offset(), duration: animate ? 800 : 0 }); return; }
      const bb = new ml.LngLatBounds();
      pts.forEach((p) => bb.extend([p.lng, p.lat]));
      map.fitBounds(bb, { padding: pad(), maxZoom: 13, duration: animate ? 900 : 0 });
    },
    setDestination(d) {
      const key = d ? `${d.lat},${d.lng},${d.label},${d.approx ? 1 : 0}` : '';
      if (key === destKey) return;
      destKey = key;
      if (dest) { dest.remove(); dest = null; }
      if (d && Number.isFinite(d.lat) && Number.isFinite(d.lng)) dest = destinationMarker(ml, d).addTo(map);
    },
    /* Tarjeta al tocar un marcador (en iPhone la muestra el panel inferior en su lugar) */
    setPopups(on) { popups = !!on && !!popupHTML; updatePopup(); },
    refreshPopup: () => updatePopup(),
    resize() { if (!gone) map.resize(); },
    destroy() {
      if (gone) return; gone = true;
      if (qraf) cancelAnimationFrame(qraf); if (lraf) cancelAnimationFrame(lraf);
      closePopup();
      markers.forEach((m) => m.remove()); markers.clear();
      clusters.forEach((c) => c.marker.remove()); clusters.length = 0;
      if (dest) dest.remove();
      base.destroy();
      if (container._fleet === api) delete container._fleet;
    },
  };
  container._fleet = api;   /* acceso para pruebas automatizadas */
  return api;
}
