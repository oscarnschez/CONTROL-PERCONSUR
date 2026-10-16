/*
 * Rastreo para clientes — reglas puras (sin red ni DOM).
 * Un enlace público pertenece a UNA operación de Logística y a la unidad (IMEI) de esa operación. Se puede compartir
 * con la operación abierta en cualquier estado (Cargando, En ruta a destino, Descargando, En ruta vacío, Vacío, Inactiva);
 * cada cambio de estado se envía al enlace para que el cliente lo vea al día. El enlace se finaliza (deja de dar la
 * ubicación) cuando la operación se cierra o se elimina.
 */
import { isStatus } from '../../config/logistics.js';
import { isApprox } from '../gps/geo.js';
import { containersIn } from '../empties/empties.js';
import { tipoDesc } from '../../config/reference.js';

export const isTrackable = (status) => isStatus(status);

/* Por qué no se puede compartir ('' = sí se puede) */
export function shareBlock(op, imei) {
  if (!op || op.closedAt || op.deletedAt) return 'La unidad no tiene una operación activa.';
  if (!isTrackable(op.status)) return 'La operación tiene un estado no válido.';
  if (!imei) return 'La unidad no tiene un GPS vinculado (Ajustes → GPS).';
  return '';
}

/* Destino para el mapa del cliente (solo si ya está ubicado) */
export const destPoint = (target) => (target && target.loc && Number.isFinite(target.loc.lat) && Number.isFinite(target.loc.lng)
  ? { lat: target.loc.lat, lng: target.loc.lng, approx: isApprox(target.loc.precision) } : null);

/*
 * Nombre del operador que ve el cliente: un nombre y un apellido (el paterno), como se acostumbra en México:
 *   «Daniel Antonio Rivera Bautista» → «Daniel Rivera»   «José Castañeda Villalobos» → «José Castañeda»
 *   «Juan de la Cruz Pérez» → «Juan de la Cruz»            «Juan García» → «Juan García»
 * Con cuatro palabras o más el apellido paterno es la penúltima (con sus partículas «de», «la», «del»…); con tres, la segunda.
 */
const PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'da', 'das', 'do', 'dos', 'van', 'von', 'san', 'santa']);
export function shortName(full) {
  const w = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (w.length <= 2) return w.join(' ');
  if (w.length === 3) return PARTICLES.has(w[1].toLowerCase()) ? w.join(' ') : `${w[0]} ${w[1]}`;
  let i = w.length - 2;
  const sur = [w[i]];
  while (i - 1 > 0 && PARTICLES.has(w[i - 1].toLowerCase())) { i -= 1; sur.unshift(w[i]); }
  return `${w[0]} ${sur.join(' ')}`;
}

/* Contenedor que ve el cliente: los números válidos de la referencia (máximo 2) y el tipo ISO capturado en la operación */
export const containerOf = (op) => containersIn(op && op.reference).slice(0, 2).join(' / ');
export const containerTypeOf = (op) => (op && tipoDesc(op.containerType) ? op.containerType : '');

/* Datos que se envían al Worker al compartir: el operador solo con nombre y apellido (y solo si lo autorizó: view.operatorShared), las placas de la unidad y del
   remolque asignado y el contenedor; sin velocidad */
export function linkPayload(op, view, imei, target) {
  return {
    opId: op.id, imei: String(imei || ''), unit: view.label || '', plates: view.placas || '', operator: shortName(view.operatorShared ?? view.operator), trailerType: view.trailerType || '', trailer: view.trailer || '', status: op.status,
    container: containerOf(op), containerType: containerTypeOf(op),
    origin: op.origin || '', destination: op.destination || '', place: op.deliveryPlace || '', dest: destPoint(target),
  };
}

/*
 * Caducidad automática. links: enlaces del Worker; opOf(opId) → operación | null (borrada) | undefined (no está en este
 * dispositivo: no se toca); destOf(op) → punto de destino ya ubicado o null; operatorOf(op) → nombre completo del operador;
 * trailerOf(op) → { placas, type } del remolque asignado (un cambio de remolque se refleja en el portal); platesOf(op) → placas
 * de la unidad. El contenedor (número y tipo) se toma de la operación.
 * Devuelve [{ link, action: 'finish' | 'update', body }].
 */
export function reconcile(links, opOf, destOf = () => null, operatorOf = null, trailerOf = null, platesOf = null) {
  const out = [];
  for (const link of links) {
    if (link.state !== 'active') continue;
    const op = opOf(link.opId);
    if (op === undefined) continue;
    if (!op || op.closedAt || op.deletedAt) { out.push({ link, action: 'finish', body: { reason: 'closed' } }); continue; }
    const body = {};
    if (op.status !== link.status) body.status = op.status;
    if (!link.hasDest) { const d = destOf(op); if (d) body.dest = d; }
    if (operatorOf) { const n = shortName(operatorOf(op)); if (n !== (link.operator || '')) body.operator = n; }
    /* Remolque: solo con un Worker que ya guarda las placas (el enlace trae «trailer»), así no se reenvía en cada revisión */
    if (trailerOf && link.trailer !== undefined) { const t = trailerOf(op) || {}; if ((t.placas || '').toUpperCase() !== (link.trailer || '')) { body.trailer = t.placas || ''; body.trailerType = t.type || ''; } }
    /* Placas de la unidad y contenedor: igual, solo con un Worker que ya los guarda (el enlace trae «container») */
    if (link.container !== undefined) {
      if (platesOf) { const p = String(platesOf(op) || '').toUpperCase(); if (p !== (link.plates || '')) body.plates = p; }
      const c = containerOf(op), ct = containerTypeOf(op);
      if (c !== (link.container || '')) body.container = c;
      if (ct !== (link.containerType || '')) body.containerType = ct;
    }
    if (Object.keys(body).length) out.push({ link, action: 'update', body });
  }
  return out;
}

/* Texto del estado de un enlace para la app */
export function linkStateText(link, now = Date.now()) {
  if (!link) return '';
  if (link.state === 'active') { const h = Math.max(0, Math.round((link.expiresAt - now) / 3600000)); return `Activo · vence en ${h < 1 ? 'menos de 1 h' : `${h} h`} o al cerrar la operación`; }
  return { finished: 'Finalizado: la operación terminó', revoked: 'Revocado', expired: 'Vencido' }[link.state] || '';
}
