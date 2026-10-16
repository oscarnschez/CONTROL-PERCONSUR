/*
 * Rastreo para clientes — enlaces públicos guardados en el Worker gps-proxy (espacio KV «TRACKING»).
 * El permiso vive en el backend: el Worker solo entrega a un enlace la ubicación de SU unidad mientras está activo,
 * con el operador solo por nombre y apellido y sin velocidad. Aquí la app crea, revoca y finaliza enlaces y mantiene la
 * caducidad automática:
 *   - El enlace se comparte en cualquier estado de una operación abierta. Al cambiar Logística (en esta pestaña o en
 *     otra), cada cambio de estado (Cargando, En ruta a destino, Descargando, En ruta vacío, Vacío, Inactiva) se envía
 *     al enlace para que el cliente vea el estado al día; el destino se agrega en cuanto queda ubicado en el mapa y un
 *     cambio de operador también se refleja. Si la operación se cierra o se elimina, el enlace se finaliza.
 *   - Sin conexión, el aviso queda pendiente en este dispositivo (ajuste trackQueue, fuera de los respaldos) y se
 *     envía al recuperar la conexión o en la siguiente consulta.
 *   - Red de seguridad en el Worker: un enlace vence solo a las 72 h y un viaje nuevo de la misma unidad finaliza el
 *     enlace del viaje anterior.
 *   - Un dispositivo de consulta (Información compartida) no envía avisos: los envía el capturista.
 */
import * as gps from './gps.js';
import * as lg from './logistics.js';
import { getSetting, setSetting } from './settings.js';
import { targetOf } from './destinations.js';
import { isReadOnly } from './access.js';
import { reconcile, linkPayload, shareBlock, destPoint } from '../domain/tracking/tracking.js';

const state = { links: new Map(), at: 0, error: '', loading: null, maxHours: 72 };
const subs = new Set();
let snapshot = new Map(), started = false, timer = 0;

function emit() { subs.forEach((fn) => { try { fn(); } catch (e) { console.warn(e); } }); }
export const onTrackingChange = (fn) => { subs.add(fn); return () => subs.delete(fn); };
export const status = () => ({ at: state.at, error: state.error, maxHours: state.maxHours });
export const links = () => [...state.links.values()];
export const linkUrl = (link) => (link ? gps.config().url + link.path : '');
/* Enlace activo de una operación (el más reciente) */
export const activeFor = (opId) => links().filter((l) => l.opId === opId && l.state === 'active' && l.expiresAt > Date.now()).sort((a, b) => b.createdAt - a.createdAt)[0] || null;
export const blockFor = (op) => shareBlock(op, op ? gps.imeiOf(op.vehicleId) : '');

function keep(link) { if (link && link.id) state.links.set(link.id, link); emit(); return link; }
/* Worker anterior a esta versión (sin rutas de enlaces): mensaje claro de qué hacer */
const OLD_WORKER = 'Para compartir el rastreo con clientes, actualiza el intermediario GPS en Cloudflare (pega el nuevo worker.js y vincula el espacio KV «TRACKING»).';
const friendly = (e) => ((e && (e.status === 404 || e.status === 405)) ? Object.assign(new Error(OLD_WORKER), { status: e.status }) : e);

/* Enlaces del Worker (como máximo una consulta por minuto salvo force) */
export function load({ force = false } = {}) {
  if (!gps.configured()) return Promise.resolve();
  if (state.loading) return state.loading;
  if (!force && Date.now() - state.at < 60000) return Promise.resolve();
  state.loading = gps.request('/v1/enlaces')
    .then((b) => { state.links = new Map((b.links || []).map((l) => [l.id, l])); state.at = Date.now(); state.error = ''; state.maxHours = b.maxHours || 72; })
    .catch((e) => { state.error = friendly(e).message; })
    .finally(() => { state.loading = null; emit(); });
  return state.loading;
}

/* Crea (o reutiliza) el enlace de la operación */
export async function share(op) {
  const block = blockFor(op);
  if (block) throw new Error(block);
  const body = linkPayload(op, lg.view(op), gps.imeiOf(op.vehicleId), targetOf(op));
  const b = await gps.request('/v1/enlaces', { method: 'POST', body }).catch((e) => { throw friendly(e); });
  /* Si se reemplazó el enlace de otro viaje de la misma unidad, la lista se vuelve a leer */
  load({ force: true });
  return keep(b.link);
}
export async function revoke(link) {
  const b = await gps.request(`/v1/enlaces/${encodeURIComponent(link.id)}/revocar`, { method: 'POST', body: {} }).catch((e) => { throw friendly(e); });
  return keep(b.link);
}

/* ===== Avisos al Worker con reintento sin conexión ===== */
const queueOf = () => { const q = getSetting('trackQueue', []); return Array.isArray(q) ? q : []; };
async function send(item) {
  const path = item.action === 'finish' ? `/v1/enlaces/${encodeURIComponent(item.id)}/finalizar` : `/v1/enlaces/${encodeURIComponent(item.id)}`;
  try {
    const b = await gps.request(path, { method: 'POST', body: item.body || {} });
    keep(b.link);
    return true;
  } catch (e) {
    if (e.offline) return false;          /* sin conexión: se reintenta después */
    return true;                          /* el Worker lo rechazó (p. ej. ya no existe): no se reintenta */
  }
}
export async function flushQueue() {
  const q = queueOf();
  if (!q.length || !gps.configured()) return;
  const left = [];
  for (const item of q) if (!(await send(item))) left.push(item);
  await setSetting('trackQueue', left.slice(-50));
}
async function apply(actions) {
  /* Un dispositivo de consulta solo ve los enlaces: la caducidad la avisa el capturista (su Logística es la vigente) */
  if (!actions.length || isReadOnly()) return;
  const left = [];
  for (const a of actions) {
    const item = { id: a.link.id, action: a.action, body: a.body, at: Date.now() };
    if (a.action === 'finish') state.links.set(a.link.id, { ...a.link, state: 'finished', closedAt: Date.now() });
    if (!(await send(item))) left.push(item);
  }
  if (left.length) await setSetting('trackQueue', [...queueOf().filter((x) => !left.some((y) => y.id === x.id)), ...left].slice(-50));
  emit();
}

/* Revisa los enlaces activos contra Logística (finaliza los de entregas terminadas) */
export async function syncAll({ force = false } = {}) {
  if (!gps.configured()) return;
  await flushQueue();
  await load({ force });
  const ops = new Map(lg.allRecords().map((o) => [o.id, o]));
  const opOf = (id) => (ops.has(id) ? ops.get(id) : undefined);
  await apply(reconcile(links(), opOf, (op) => destPoint(targetOf(op)), (op) => lg.view(op).operator, (op) => { const v = lg.view(op); return { placas: v.trailer, type: v.trailerType }; }));
}

/* ¿Algún cambio de Logística toca el rastreo? (estado, cierre o borrado de una operación) */
const sig = (o) => `${o.status}|${o.closedAt ? 1 : 0}|${o.deletedAt ? 1 : 0}|${o.trailerId || ''}|${o.operatorId || ''}`;
function takeSnapshot() { snapshot = new Map(lg.allRecords().map((o) => [o.id, sig(o)])); }
function relevantChange() {
  const prev = snapshot; takeSnapshot();
  for (const [id, s] of snapshot) { const p = prev.get(id); if (p !== undefined && p !== s) return true; }
  for (const id of prev.keys()) if (!snapshot.has(id)) return true;
  return false;
}

/* Arranque (main.js): escucha Logística y la conexión */
export function startTracking() {
  if (started) return;
  started = true;
  takeSnapshot();
  lg.onLogisticsChange(() => {
    if (!relevantChange() || !gps.configured()) return;
    clearTimeout(timer);
    timer = setTimeout(() => { syncAll({ force: true }).catch((e) => console.warn('rastreo', e)); }, 800);
  });
  window.addEventListener('online', () => { flushQueue().catch(() => {}); });
  if (gps.configured() && queueOf().length) flushQueue().catch(() => {});
}
