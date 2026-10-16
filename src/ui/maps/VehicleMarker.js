/*
 * Marcador de unidad para los mapas MapLibre (Centro de Monitoreo y portal del cliente) y, con unitMarkHTML(), para los
 * mapas pequeños de Logística e Inicio. Diseño sobrio, igual para todas las unidades:
 *   Círculo  = color del estado operativo de Logística (mismos tonos que los chips: Cargando violeta, En ruta a destino
 *              azul, En ruta vacío verde azulado, Descargando ámbar, Vacío gris claro, Inactiva gris).
 *   Silueta  = tractocamión en blanco (el tipo de remolque se ve en la tarjeta y en la lista, no en el mapa).
 *   Rumbo    = flecha pegada al círculo hacia donde avanza la unidad (si IOPGPS entrega el rumbo); sin rumbo, un halo
 *              suave indica movimiento. Detenida: solo el círculo.
 *   Sin señal reciente: círculo gris con borde punteado e insignia de señal apagada (no se presenta como posición actual).
 *   Debajo, el número económico.
 * El marcador es un botón HTML (accesible con teclado y lector de pantalla). Al actualizar la posición se desliza de forma
 * breve y discreta del punto anterior al nuevo; si el salto es largo (> 3 km), la app está en segundo plano o el sistema
 * pide reducir el movimiento, cambia de lugar sin animación: nunca se dibuja un recorrido que no se conoce.
 */
import { esc } from '../../domain/shared/format.js';

const SVG = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${d}</svg>`;
/* Insignia solo cuando el GPS no tiene señal reciente */
const NOSIGNAL = SVG('<path d="M5 9.5a10 10 0 0 1 14 0M8 13a5.6 5.6 0 0 1 8 0"/><path d="M12 17h.01"/><path d="m4 4 16 16" stroke-width="2.2"/>');
/*
 * Figura del marcador (40×40): flecha de rumbo (se gira con --vm-rot), círculo del color del estado con aro blanco y la
 * silueta de un tractocamión (caja, cabina con ventana y dos ruedas) en blanco.
 */
export const MARK = `<svg class="vm-svg" viewBox="0 0 40 40" aria-hidden="true">
  <path class="vm-dir" d="M20 -1.4 25.4 5.4H14.6Z"/>
  <circle class="vm-body" cx="20" cy="20" r="12.8"/>
  <g class="vm-truck" transform="translate(11.2 10.8) scale(.72)">
    <rect x="1" y="5" width="13.4" height="10" rx="1.3"/><path d="M15.6 8h4.6l3.3 3.7V15h-7.9z"/><path class="vm-win" d="M17.1 9.6h2.6l1.8 2h-4.4z"/>
    <rect x="1" y="15" width="22.5" height="1.8" rx=".6"/><circle class="vm-wheel" cx="6" cy="18.2" r="2.3"/><circle class="vm-wheel" cx="18.6" cy="18.2" r="2.3"/>
  </g></svg>`;
/* Marcador estático (mapas Leaflet de Logística e Inicio): mismo diseño, sin botón ni animación */
export const unitMarkHTML = ({ label = '', tone = 'blue', motion = 'stopped', cls = '' } = {}) =>
  `<div class="vm vm-static${cls ? ' ' + esc(cls) : ''}" data-tone="${esc(tone)}" data-motion="${esc(motion)}"><span class="vm-pin">${MARK}</span>${motion === 'nosignal' ? `<span class="vm-badge">${NOSIGNAL}</span>` : ''}${label ? `<span class="vm-lbl">${esc(label)}</span>` : ''}</div>`;
export const MOTION_TEXT = { moving: 'en movimiento', stopped: 'detenida', nosignal: 'sin señal reciente', live: 'ubicación actual' };
const JUMP_M = 3000;

function meters(a, b) {
  const R = 6371000, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
const reduceMotion = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

/*
 * data: { id, lat, lng, label, tone, trailerType, motion: moving|stopped|nosignal, heading, title }
 * opts: { onClick(id), onMove(lngLat) }
 */
export class VehicleMarker {
  constructor(ml, data, { onClick = null, onMove = null } = {}) {
    this.ml = ml; this.data = {}; this.onMove = onMove; this.raf = 0; this.map = null; this.selected = false;
    const el = document.createElement('button');
    el.type = 'button'; el.className = 'vm';
    el.innerHTML = `<span class="vm-pin">${MARK}</span><span class="vm-badge">${NOSIGNAL}</span><span class="vm-lbl"></span>`;
    if (onClick) el.addEventListener('click', (e) => { e.stopPropagation(); onClick(this.data.id); });
    this.el = el;
    this.marker = new ml.Marker({ element: el, anchor: 'center' }).setLngLat([data.lng, data.lat]);
    this.setData(data);
  }
  addTo(map) { if (!this.map) { this.map = map; this.marker.addTo(map); } return this; }
  /* Quita el marcador del mapa sin perderlo (para agrupar o para unidades fuera de la vista) */
  detach() { if (this.map) { this.marker.remove(); this.map = null; } return this; }
  get onMap() { return !!this.map; }
  lngLat() { const ll = this.marker.getLngLat(); return { lng: ll.lng, lat: ll.lat }; }
  /* Coordenadas reales (sin la animación en curso) */
  target() { return { lng: this.data.lng, lat: this.data.lat }; }

  setData(d) {
    const p = this.data, el = this.el;
    if (d.tone !== p.tone) el.dataset.tone = d.tone || 'blue';
    if (d.motion !== p.motion) el.dataset.motion = d.motion || 'stopped';
    if (d.trailerType !== p.trailerType) el.dataset.trailer = d.trailerType || '';
    if (d.label !== p.label) { el.querySelector('.vm-lbl').textContent = d.label || ''; el.classList.toggle('no-lbl', !d.label); }
    const rot = d.motion === 'moving' && Number.isFinite(d.heading) ? `${Math.round(d.heading)}deg` : '';
    if (rot !== (p.motion === 'moving' && Number.isFinite(p.heading) ? `${Math.round(p.heading)}deg` : '')) el.style.setProperty('--vm-rot', rot || '0deg');
    el.classList.toggle('has-heading', !!rot);
    const title = d.title || [d.label, MOTION_TEXT[d.motion]].filter(Boolean).join(', ');
    if (title !== el.getAttribute('aria-label')) { el.setAttribute('aria-label', title); el.title = title; }
    el.dataset.id = d.id;
    this.data = { ...d };
  }
  setSelected(on) { this.selected = !!on; this.el.classList.toggle('is-sel', this.selected); this.el.setAttribute('aria-pressed', this.selected ? 'true' : 'false'); }

  /* Nueva posición. animate=false (fuera de la vista) → cambio directo */
  moveTo(lat, lng, { animate = true } = {}) {
    const from = this.lngLat(), to = { lat, lng };
    this.data.lat = lat; this.data.lng = lng;
    if (Math.abs(from.lat - lat) < 1e-7 && Math.abs(from.lng - lng) < 1e-7) return false;
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
    const dist = meters(from, to);
    if (!animate || !this.map || dist > JUMP_M || document.visibilityState !== 'visible' || reduceMotion()) {
      this.marker.setLngLat([lng, lat]); if (this.onMove) this.onMove([lng, lat]);
      this.el.classList.remove('vm-upd'); void this.el.offsetWidth; this.el.classList.add('vm-upd');
      return true;
    }
    const dur = Math.min(1100, 450 + dist * 0.5), t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - (1 - k) ** 3;
      const ll = [from.lng + (lng - from.lng) * e, from.lat + (lat - from.lat) * e];
      this.marker.setLngLat(ll); if (this.onMove) this.onMove(ll);
      this.raf = k < 1 ? requestAnimationFrame(step) : 0;
    };
    this.raf = requestAnimationFrame(step);
    return true;
  }
  remove() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; this.detach(); }
}

/* Destino (lugar de entrega, terminal, planta o patio): bandera discreta; aproximado → borde punteado */
export function destinationMarker(ml, { lat, lng, label = 'Destino', approx = false }) {
  const el = document.createElement('div');
  el.className = 'vm-dest' + (approx ? ' approx' : '');
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', `${label}${approx ? ' (ubicación aproximada)' : ''}`);
  el.innerHTML = `<span class="vm-dest-ic">${SVG('<path d="M6 21V4"/><path d="M6 4.5h11l-2.4 3.7L17 12H6"/>', ' stroke-width="2.2"')}</span><span class="vm-dest-lbl">${esc(label)}</span>`;
  return new ml.Marker({ element: el, anchor: 'bottom', offset: [0, -4] }).setLngLat([lng, lat]);
}
