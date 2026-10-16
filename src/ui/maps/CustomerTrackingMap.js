/*
 * CustomerTrackingMap — mapa del portal público de rastreo. Recibe SOLO lo que entrega el Worker para el enlace
 * (/v1/publico/:token): posición actual de la unidad del viaje (del color de su estado) y el punto de destino. No conoce velocidad,
 * número económico ni otras unidades: el permiso se decide en el backend.
 *   update(data)  data = respuesta del Worker { state, trip, destination, position }
 */
import { createVehicleMap } from './VehicleMap.js';
import { statusOf, isStatus } from '../../config/logistics.js';

/* opts: { views } true = botón Mapa / Satélite (solo si el Worker permite las imágenes satelitales); arranca en satélite */
export async function createCustomerTrackingMap(container, { views = false } = {}) {
  const vmap = await createVehicleMap(container, { centerLabel: 'Centrar transporte', fitLabel: 'Ver transporte y destino', views, defaultView: 'satellite' });
  return {
    update(data) {
      const p = data && data.state === 'active' ? data.position : null;
      const t = (data && data.trip) || {};
      vmap.setVehicle(p ? { lat: p.lat, lng: p.lng, label: 'Transporte', tone: isStatus(t.status) ? statusOf(t.status).tone : 'blue', trailerType: t.trailerType || '', motion: p.live ? 'live' : 'nosignal',
        title: p.live ? 'Transporte: ubicación actual' : 'Transporte: última ubicación reportada (sin señal reciente)' } : null);
      const d = data && data.state === 'active' ? data.destination : null;
      vmap.setDestination(d ? { lat: d.lat, lng: d.lng, label: t.place || t.destination || 'Destino', approx: !!d.approx } : null);
    },
    recenter: () => vmap.recenter(),
    resize: () => vmap.resize(),
    destroy: () => vmap.destroy(),
  };
}
