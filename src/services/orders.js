/*
 * Órdenes de Servicio — expediente maestro del viaje (ver ORDENES.md). Reutiliza los módulos existentes como fuente de
 * cada dato y guarda en la orden solo lo que no tiene otro dueño:
 *   Control de llenos (fulls)  contenedor, peso, terminal o patio, cita y documentos portuarios      → fullLoadId
 *   Logística                  unidad, operador, remolque, ruta y estado operativo (desde el despacho) → logisticsOperationId
 *   Operadores                 viaje financiero: tarifa, impuestos, gastos y comisión (desde el despacho) → tripId
 *   Control de vacíos          devolución del contenedor vacío (lo crea Logística al pasar a «Vacío») → emptyReturnId
 *   Documentos                 nota de entrega / asignación de unidades emitidas (versiones)          → generated[]
 * Stores propios: serviceOrders, serviceOrderEvents (bitácora/auditoría) y serviceOrderFiles (documentos de la orden cuando
 * no hay carga vinculada y evidencias de entrega y devolución; archivos en «attachments» con owner 'so:<id>').
 * Cada transición verifica el estado, valida, escribe, guarda el vínculo en cuanto existe (para recuperarse si algo falla a
 * la mitad), registra el evento y avisa con 'serviceorders:change'. Despachar dos veces no duplica viaje ni operación.
 */
import * as db from './db.js';
import * as media from './media.js';
import * as fc from './fulls.js';
import * as lg from './logistics.js';
import * as ec from './empties.js';
import * as ops from './operators.js';
import * as unitsSvc from './units.js';
import { loadBilling, billingOf } from './billing.js';
import { listAll } from './catalogs.js';
import { isReadOnly, READ_ONLY_TEXT } from './access.js';
import { availability as shopOf } from './maintenance.js';
import { imeiOf } from './gps.js';
import { getDocument } from './documents.js';
import { processFile, kindOf, ACCEPT, MAX_FILE } from './tripAttachments.js';
import { isActive as unitActive, docType as unitDocType } from '../domain/units/units.js';
import { ruleFromSettings, commissionFor, todayStr } from '../domain/operators/balance.js';
import { taxFields } from '../domain/operators/taxes.js';
import { cleanContainer, isContainer } from '../domain/empties/empties.js';
import { isWorking } from '../config/logistics.js';
import * as D from '../domain/orders/orders.js';

export { ACCEPT, MAX_FILE };
const EVT = 'serviceorders:change';
let cache = null;
let bc = null;
try { bc = new BroadcastChannel('pcs-orders'); bc.onmessage = async () => { await loadOrders(true); window.dispatchEvent(new CustomEvent(EVT)); }; } catch (e) { /* sin BroadcastChannel */ }
function changed() { window.dispatchEvent(new CustomEvent(EVT)); try { bc && bc.postMessage(1); } catch (e) { /* */ } }
export const onOrdersChange = (fn) => { window.addEventListener(EVT, fn); return () => window.removeEventListener(EVT, fn); };

function session() { try { return JSON.parse(sessionStorage.getItem('pcs-session') || 'null'); } catch (e) { return null; } }
const actor = () => (session() || {}).user || 'local';

/* ===== Permisos =====
 * Se verifican aquí (no solo en la pantalla). Hoy todas las cuentas son «admin»; el mapa deja lista la separación por
 * perfil. Un dispositivo de consulta no modifica nada (además la base rechaza escrituras). */
export const ACTIONS = ['create', 'edit', 'attach', 'archive', 'assign', 'reassign', 'dispatch', 'status', 'deliver', 'return', 'cancel', 'reopen', 'finance', 'close', 'waive', 'migrate'];
const ROLE_ACTIONS = { admin: ACTIONS };
export function can(action) {
  if (isReadOnly()) return false;
  const role = (session() || {}).role;
  return !!role && (ROLE_ACTIONS[role] || []).includes(action);
}
function guard(action) { if (!can(action)) throw new Error(isReadOnly() ? READ_ONLY_TEXT : 'Tu usuario no tiene permiso para esta acción.'); }

/* ===== Carga y consultas ===== */
export async function loadOrders(force = false) {
  if (cache && !force) return cache.orders;
  const [orders, events, files] = await Promise.all([db.all(db.S.serviceOrders), db.all(db.S.serviceOrderEvents), db.all(db.S.serviceOrderFiles)]);
  cache = { orders, events, files };
  await Promise.all([fc.loadFulls(), lg.loadLogistics(), ec.loadEmpties(), unitsSvc.loadUnits(), loadBilling()]).catch((e) => console.warn('órdenes: módulos relacionados', e));
  return cache.orders;
}
const C = () => cache || { orders: [], events: [], files: [] };
export const all = () => C().orders.filter((o) => !o.deletedAt);
export const byId = (id) => all().find((o) => o.id === id) || null;
export const byFolio = (folio) => all().find((o) => o.folio === folio) || null;
export const eventsOf = (id) => C().events.filter((e) => e.orderId === id).sort((a, b) => b.at - a.at);
export const filesOf = (id) => C().files.filter((f) => f.orderId === id && !f.deletedAt);
export const fileById = (id) => C().files.find((f) => f.id === id) || null;
/* Búsquedas inversas para los demás módulos (la orden guarda los vínculos) */
export const orderForOp = (opId) => (opId ? all().find((o) => o.logisticsOperationId === opId) || null : null);
export const orderForLoad = (loadId) => (loadId ? all().find((o) => o.fullLoadId === loadId) || null : null);
export const orderForTrip = (tripId) => (tripId ? all().find((o) => o.tripId === tripId) || null : null);
export function orderForEmpty(r) {
  if (!r) return null;
  return all().find((o) => o.emptyReturnId === r.id) || (r.logisticsOperationId ? orderForOp(r.logisticsOperationId) : null);
}

async function writeOrder(o) { await db.put(db.S.serviceOrders, o); const i = C().orders.findIndex((x) => x.id === o.id); if (i >= 0) C().orders[i] = o; else C().orders.push(o); return o; }
async function writeFile(f) { await db.put(db.S.serviceOrderFiles, f); const i = C().files.findIndex((x) => x.id === f.id); if (i >= 0) C().files[i] = f; else C().files.push(f); return f; }
async function addEvent(o, type, text, details = '', refId = null) {
  const e = { id: db.uid('se_'), orderId: o.id, folio: o.folio, type, text, details: String(details || '').slice(0, 600), refId, at: Date.now(), by: actor() };
  await db.put(db.S.serviceOrderEvents, e);
  C().events.push(e);
  return e;
}
/* Guarda un cambio de la orden con su revisión (los 30 cambios anteriores quedan para auditoría) */
async function patchOrder(o, patch) {
  const now = Date.now(), who = actor();
  const { revisions = [], ...before } = o;
  const next = { ...o, ...patch, updatedAt: now, updatedBy: who, revisions: [...revisions, { at: now, by: who, before: { ...before, revisions: undefined } }].slice(-30) };
  return writeOrder(next);
}

/* ===== Folio OS-AAAA-NNNNNN: contador persistente por año dentro de una transacción =====
 * Nunca menor que el folio más alto guardado (respaldo, otro dispositivo) y nunca se reutiliza (tampoco el de una cancelada) */
export async function reserveFolio(date = new Date()) {
  const year = date.getFullYear(), id = `os:${year}`, folios = C().orders.map((o) => o.folio);
  const n = await db.tx([db.S.counters], async ({ store, req }) => {
    const st = store(db.S.counters);
    const cur = await req(st.get(id));
    const next = D.nextFolioNumber(cur && cur.n, folios, year);
    st.put({ id, kind: 'serviceOrder', year, n: next });
    return next;
  });
  return D.formatFolio(year, n);
}

/* ===== Vista resuelta: cada dato desde su fuente ===== */
const vehicle = (id) => (id ? lg.unitById(id) : null);
const trailer = (id) => (id ? lg.trailerById(id) : null);
const catalogName = (kind, id) => { if (!id) return ''; const r = listAll(kind).find((x) => x.id === id); return r ? r.name : ''; };
export const placeById = (id) => (id ? listAll('places').find((x) => x.id === id) || null : null);
export const tripOf = (o) => (o && o.tripId ? ops.allTrips().find((t) => t.id === o.tripId) || null : null);
export const opOf = (o) => (o && o.logisticsOperationId ? lg.opById(o.logisticsOperationId) || null : null);
export const loadOf = (o) => (o && o.fullLoadId ? fc.byId(o.fullLoadId) || null : null);
/* Vacío de la orden: el vinculado o el que Logística creó para su operación (el más reciente) */
export function emptyOf(o) {
  if (!o) return null;
  if (o.emptyReturnId) { const r = ec.byId(o.emptyReturnId); if (r) return r; }
  if (!o.logisticsOperationId) return null;
  return ec.all().filter((r) => r.logisticsOperationId === o.logisticsOperationId).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] || null;
}
/* Documentos de la orden: los de la carga de Control de llenos (si está vinculada) o los propios; evidencias aparte */
export function docsOf(o) {
  const load = loadOf(o), own = filesOf(o.id);
  const docs = load ? fc.docsOf(load.id) : own.filter((f) => !D.isEvidence(f));
  return D.sortDocs(docs);
}
export const evidenceOf = (o, type = null) => filesOf(o.id).filter((f) => D.isEvidence(f) && (!type || f.docType === type));
export const generatedOf = (o) => [...(o.generated || [])].sort((a, b) => (b.at || 0) - (a.at || 0));
export const latestGenerated = (o) => generatedOf(o)[0] || null;

export function resolved(o) {
  const load = loadOf(o), op = opOf(o), trip = tripOf(o), empty = emptyOf(o);
  const src = {
    vehicleId: op ? op.vehicleId : o.vehicleId || null, operatorId: op ? op.operatorId || null : o.operatorId || null, trailerId: op ? op.trailerId || null : o.trailerId || null,
    origin: op ? op.origin || '' : o.origin || '', destination: op ? op.destination || '' : o.destination || '', deliveryPlace: op ? op.deliveryPlace || '' : o.deliveryPlace || '',
    containerNumber: load ? load.containerNumber : o.containerNumber || '', weightKg: load ? load.weightKg : o.weightKg ?? null,
    locationType: load ? load.locationType : o.locationType || 'port', terminalId: load ? load.terminalId : o.terminalId || null, yardId: load ? load.yardId : o.yardId || null,
    scheduledDate: load ? load.scheduledDate : o.scheduledDate || '', scheduledTime: load ? load.scheduledTime : o.scheduledTime || '',
    customerId: o.customerId || null, loadLinked: !!load,
  };
  const u = vehicle(src.vehicleId), t = trailer(src.trailerId), opr = src.operatorId ? ops.operatorById(src.operatorId) : null, cust = placeById(o.customerId);
  return {
    order: o, load, op, trip, empty, ...src,
    unit: u ? u.label : (op && op.snap && op.snap.unit) || '', placas: u ? u.placas : '', eco: u ? u.eco : '',
    operator: opr ? opr.name : (op && op.snap && op.snap.operator) || '', trailer: t ? t.placas : '', trailerType: t ? t.type || '' : '',
    customer: cust ? cust.name : o.customerName || '', customerRec: cust,
    place: src.locationType === 'port' ? catalogName('terminals', src.terminalId) : catalogName('loadingYards', src.yardId),
    returnYard: o.returnYardId ? (ec.yardById(o.returnYardId) || {}).name || '' : '',
    plant: catalogName('plants', o.plantId),
    date: src.scheduledDate || o.serviceDate || '',
  };
}
/* Estado compuesto de la orden (ver domain/orders/orders.js deriveState) */
export function stateOf(o, r = resolved(o)) {
  const bill = r.trip ? billingOf(r.trip.id) : null;
  return D.deriveState({ order: o, op: r.op, docs: o.division === 'puerto' ? docsOf(o) : [], empty: r.empty, trip: r.trip, paid: !!(bill && bill.paid), resolved: r });
}
/* Filas para el listado (vista y estado calculados una vez por dibujo) */
export function rows() {
  return all().map((o) => {
    const r = resolved(o), state = stateOf(o, r);
    return { order: o, state, r, view: { customer: r.customer, origin: r.origin, destination: r.destination, container: r.containerNumber, reference: o.reference || o.commercialRef || '', unit: r.unit, operator: r.operator, date: r.date, vehicleId: r.vehicleId, operatorId: r.operatorId } };
  });
}

/* ===== Disponibilidad de recursos (para elegir y para el despacho) ===== */
const folioOfOp = (op) => { const o = op ? orderForOp(op.id) : null; return o ? o.folio : op ? lg.view(op).label + (op.reference ? ' · ' + op.reference : '') : ''; };
export function unitAvailability(vehicleId, selfOpId = null) {
  const u = unitsSvc.unitById(vehicleId);
  if (!u) return { key: 'missing', label: 'No está en el catálogo', tone: 'gray', block: true };
  if (!unitActive(u)) return { key: 'inactive', label: 'Inactiva en el catálogo', tone: 'gray', block: true };
  const open = lg.openOf(vehicleId);
  if (open && open.id !== selfOpId && isWorking(open.status)) return { key: 'busy', label: `Asignada a otra operación (${folioOfOp(open)})`, tone: 'amber', block: true };
  if (shopOf('v:' + vehicleId).inShop) return { key: 'shop', label: 'En taller', tone: 'amber', warn: true };
  const st = unitsSvc.statusOf(u);
  if (st.expired && st.expired.length) return { key: 'docs_expired', label: 'Documentos vencidos', tone: 'amber', warn: true, expired: st.expired };
  if ((st.missing && st.missing.length) || (st.pending && st.pending.length)) return { key: 'docs_pending', label: 'Documentación pendiente', tone: 'light', warn: true };
  return { key: 'available', label: 'Disponible', tone: 'ok' };
}
export function operatorAvailability(operatorId, selfOpId = null) {
  const op = ops.operatorById(operatorId);
  if (!op) return { key: 'missing', label: 'No está en el catálogo', tone: 'gray', block: true };
  const busy = lg.all().find((x) => !x.closedAt && x.operatorId === operatorId && x.id !== selfOpId && isWorking(x.status));
  if (busy) return { key: 'busy', label: `En otra operación (${folioOfOp(busy)})`, tone: 'amber', warn: true };
  const exp = op.license && op.license.expires;
  if (exp && exp < todayStr()) return { key: 'license', label: 'Licencia vencida', tone: 'amber', warn: true };
  return { key: 'available', label: 'Disponible', tone: 'ok' };
}
export function trailerAvailability(trailerId, selfOpId = null) {
  const t = lg.trailerById(trailerId);
  if (!t) return { key: 'missing', label: 'No está en el catálogo', tone: 'gray', block: true };
  const busy = lg.all().find((x) => !x.closedAt && x.trailerId === trailerId && x.id !== selfOpId);
  if (busy) return { key: 'busy', label: `En otra operación (${folioOfOp(busy)})`, tone: 'amber', warn: true };
  if (shopOf('t:' + trailerId).inShop) return { key: 'shop', label: 'En taller', tone: 'amber', warn: true };
  return { key: 'available', label: 'Disponible', tone: 'ok' };
}
/* Contexto completo para validar el despacho (domain dispatchCheck) */
export function dispatchContext(o) {
  const r = resolved(o), selfId = r.op ? r.op.id : null;
  const c = r.vehicleId ? lg.conflictsFor({ vehicleId: r.vehicleId, operatorId: r.operatorId, trailerId: r.trailerId }, selfId) : {};
  const u = r.vehicleId ? unitsSvc.unitById(r.vehicleId) : null, st = u ? unitsSvc.statusOf(u) : null;
  const opr = r.operatorId ? ops.operatorById(r.operatorId) : null;
  return {
    order: o, resolved: r, docs: o.division === 'puerto' ? docsOf(o) : [],
    conflicts: { unit: !!c.unit, unitText: c.unit ? folioOfOp(c.unit) : '', operator: !!c.operator, operatorText: c.operator ? folioOfOp(c.operator) : '', trailer: !!c.trailer, trailerText: c.trailer ? folioOfOp(c.trailer) : '' },
    unit: u ? { inactive: !unitActive(u), inShop: shopOf('v:' + u.id).inShop, expired: (st.expired || []).map((k) => (unitDocType(k) || { label: k }).label), missing: (st.missing || []).map((k) => (unitDocType(k) || { label: k }).label), noGps: !imeiOf(u.id) } : {},
    trailer: r.trailerId ? { inShop: shopOf('t:' + r.trailerId).inShop, type: r.trailerType } : {},
    operatorLicenseExpired: !!(opr && opr.license && opr.license.expires && opr.license.expires < todayStr()),
    generatedCount: (o.generated || []).length, today: todayStr(), canDispatch: can('dispatch'),
  };
}
export const dispatchCheck = (o) => D.dispatchCheck(dispatchContext(o));
export const closeCheck = (o) => { const r = resolved(o); return D.closeCheck({ order: o, op: r.op, docs: docsOf(o), empty: r.empty, trip: r.trip, resolved: r }); };

/* ===== Crear y editar =====
 * input: campos de la orden. Con carga de Control de llenos vinculada, contenedor/peso/ubicación/terminal/patio/fecha/hora
 * se escriben en la carga (única fuente); después del despacho, unidad/operador/remolque/ruta se escriben en Logística. */
const ORDER_FIELDS = ['division', 'opType', 'companyId', 'customerId', 'customerName', 'requester', 'contactName', 'contactPhone', 'serviceDate', 'commercialRef', 'instructions',
  'origin', 'destination', 'deliveryPlace', 'cargoType', 'reference', 'notes', 'scheduledDate', 'scheduledTime', 'containerNumber', 'containerType', 'weightKg', 'locationType',
  'terminalId', 'yardId', 'bl', 'pedimento', 'cartaPorte', 'returnYardId', 'plantId', 'vehicleId', 'operatorId', 'trailerId', 'finance'];
const LOAD_FIELDS = ['containerNumber', 'weightKg', 'locationType', 'terminalId', 'yardId', 'scheduledDate', 'scheduledTime'];
const OP_FIELDS = ['origin', 'destination', 'deliveryPlace'];
const clean = (v, max = 160) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
function normalize(input) {
  const out = {};
  for (const k of ORDER_FIELDS) {
    if (!(k in input)) continue;
    const v = input[k];
    if (['customerId', 'terminalId', 'yardId', 'returnYardId', 'plantId', 'vehicleId', 'operatorId', 'trailerId'].includes(k)) out[k] = v || null;
    else if (k === 'containerNumber') out[k] = cleanContainer(v || '');
    else if (k === 'weightKg') out[k] = v === '' || v == null ? null : Math.max(0, Math.round(Number(v) || 0));
    else if (k === 'finance') out[k] = { ...D.defaultFinance(input.division || 'puerto'), ...(v || {}) };
    else if (k === 'instructions' || k === 'notes') out[k] = String(v ?? '').trim().slice(0, 1000);
    else out[k] = typeof v === 'string' ? clean(v, k === 'reference' || k === 'commercialRef' ? 60 : 160) : v;
  }
  if (out.division && !['puerto', 'campo'].includes(out.division)) throw new Error('Elige la división.');
  return out;
}
export async function createOrder(input, { source = 'manual', pending = [] } = {}) {
  await loadOrders(); guard('create');
  const data = normalize(input);
  if (!data.division) throw new Error('Elige la división (Puerto o Campo).');
  const now = Date.now(), who = actor(), folio = await reserveFolio();
  const o = {
    id: db.uid('so_'), folio, year: +folio.slice(3, 7), phase: 'draft', source, pending,
    division: data.division, opType: D.opTypeOf(data.opType, data.division).division === data.division ? D.opTypeOf(data.opType, data.division).key : D.defaultOpType(data.division),
    companyId: data.division === 'campo' ? 'campo' : data.companyId || 'perconsur',
    customerId: null, customerName: '', requester: '', contactName: '', contactPhone: '', serviceDate: todayStr(), commercialRef: '', instructions: '',
    origin: '', destination: '', deliveryPlace: '', cargoType: '', reference: '', notes: '', scheduledDate: '', scheduledTime: '',
    containerNumber: '', containerType: '', weightKg: null, locationType: 'port', terminalId: null, yardId: null, bl: '', pedimento: '', cartaPorte: '', returnYardId: null, plantId: null,
    vehicleId: null, operatorId: null, trailerId: null, assignments: [], finance: D.defaultFinance(data.division),
    fullLoadId: null, logisticsOperationId: null, tripId: null, emptyReturnId: null,
    generated: [], docChecks: {}, dossierOrder: [], dossierSkip: [], delivery: null, noEmptyReturn: null, incidents: [],
    closedAt: null, cancelledAt: null, dispatchedAt: null,
    createdAt: now, createdBy: who, updatedAt: now, updatedBy: who, revisions: [],
  };
  Object.assign(o, data, { phase: 'draft' });
  if (D.opTypeOf(o.opType, o.division).division !== o.division || !D.OP_TYPES.some((t) => t.key === o.opType)) o.opType = D.defaultOpType(o.division);
  if (o.division === 'campo') o.companyId = 'campo';
  await writeOrder(o);
  if (o.vehicleId || o.operatorId || o.trailerId) o.assignments = [{ at: now, by: who, vehicleId: o.vehicleId, operatorId: o.operatorId, trailerId: o.trailerId, reason: 'Asignación inicial', afterDispatch: false }];
  await writeOrder(o);
  await addEvent(o, 'created', `Orden creada (${D.divisionLabel(o.division)})`, source === 'migrated' ? 'Vinculada a registros existentes' : '');
  await reconcileSlots(o);
  changed();
  return o;
}
/*
 * Cambios de captura. Devuelve { order, loadErrors } — loadErrors cuando Control de llenos rechaza los datos de la carga
 * (contenedor, peso, terminal o patio, fecha u hora), para marcarlos en el formulario.
 */
export async function updateOrder(id, input) {
  await loadOrders(); guard('edit');
  const o = byId(id); if (!o) throw new Error('La orden ya no existe.');
  if (o.phase === 'cancelled' || o.closedAt) throw new Error('La orden está cerrada: reábrela para corregirla.');
  const data = normalize(input);
  delete data.vehicleId; delete data.operatorId; delete data.trailerId;   /* las asignaciones van por assign() (historial) */
  if (data.division && data.division !== o.division) {
    if (o.logisticsOperationId || o.fullLoadId) throw new Error('La división no se puede cambiar después de vincular la carga o despachar.');
    if (data.division === 'campo') data.companyId = 'campo'; else if (o.companyId === 'campo') data.companyId = 'perconsur';
    if (!data.opType || D.opTypeOf(data.opType).division !== data.division) data.opType = D.defaultOpType(data.division);
    data.finance = D.financeForDivision(data.finance || o.finance, data.division);
  }
  if (data.opType && D.opTypeOf(data.opType).division !== (data.division || o.division)) data.opType = D.defaultOpType(data.division || o.division);
  const load = loadOf(o), op = opOf(o);
  let loadErrors = null;
  /* Datos de la carga → Control de llenos (fuente única) */
  if (load) {
    const lp = {}; for (const k of LOAD_FIELDS) if (k in data && String(data[k] ?? '') !== String(load[k] ?? '')) lp[k] = data[k];
    if (Object.keys(lp).length) {
      const res = await fc.update(load.id, { ...lp, notes: load.notes, reference: load.reference });
      if (res.errors) loadErrors = res.errors;
      else await addEvent(o, 'load_sync', 'Datos de la carga actualizados en Control de llenos', Object.keys(lp).join(', '));
    }
    for (const k of LOAD_FIELDS) delete data[k];
  }
  /* Ruta después del despacho → Logística (y viaje financiero) */
  if (op) {
    const pp = {}; for (const k of OP_FIELDS) if (k in data && data[k] !== (op[k] || '')) pp[k] = data[k];
    if (Object.keys(pp).length) {
      await lg.saveOperation({ id: op.id, vehicleId: op.vehicleId, status: op.status, ...pp }, { by: actor() });
      const trip = tripOf(o);
      if (trip && (pp.origin || pp.destination)) await ops.saveTrip({ id: trip.id, documentId: trip.documentId ?? null, source: trip.source || 'manual', ...(pp.origin ? { origin: pp.origin } : {}), ...(pp.destination ? { destination: pp.destination } : {}) });
      await addEvent(o, 'route', 'Ruta actualizada en Logística', Object.entries(pp).map(([k, v]) => `${k}: ${v}`).join(' · '));
    }
  }
  /* Finanzas: con viaje registrado la fuente es el viaje (se edita con el formulario de Operadores) */
  if (data.finance && tripOf(o)) delete data.finance;
  const routeChanged = ['customerId', 'origin', 'destination'].some((k) => k in data && data[k] !== o[k]);
  const next = await patchOrder(o, data);
  if (routeChanged) await addEvent(next, 'edit', 'Cliente o ruta modificados', ['customerId', 'origin', 'destination'].filter((k) => k in data && data[k] !== o[k]).join(', '));
  await reconcileSlots(next);
  changed();
  return { order: next, loadErrors };
}
/* Confirmar (Borrador → Confirmada): la orden ya cuenta para documentos y despacho */
export async function confirmOrder(id) {
  await loadOrders(); guard('edit');
  const o = byId(id); if (!o) throw new Error('La orden ya no existe.');
  if (o.phase !== 'draft') return o;
  const next = await patchOrder(o, { phase: 'scheduled', confirmedAt: Date.now() });
  await addEvent(next, 'confirmed', 'Orden confirmada');
  changed();
  return next;
}

/* ===== Control de llenos: crear o vincular la carga ===== */
export function loadInput(o) {
  return { containerNumber: o.containerNumber, weightKg: o.weightKg, reference: (o.reference || o.commercialRef || o.folio).slice(0, 60), notes: `Orden ${o.folio}`,
    locationType: o.locationType || 'port', terminalId: o.locationType === 'offport' ? null : o.terminalId, yardId: o.locationType === 'offport' ? o.yardId : null,
    scheduledDate: o.scheduledDate, scheduledTime: o.scheduledTime, vehicleId: o.vehicleId, operatorId: o.operatorId, trailerId: o.trailerId };
}
export const loadReady = (o) => isContainer(o.containerNumber) && Number(o.weightKg) > 0 && (o.locationType === 'offport' ? !!o.yardId : !!o.terminalId) && !!o.scheduledDate && !!o.scheduledTime;
/* Carga abierta del mismo contenedor que aún no pertenece a otra orden */
export function freeLoadFor(container) {
  const c = cleanContainer(container);
  if (!isContainer(c)) return null;
  return fc.openList().find((l) => l.containerNumber === c && !orderForLoad(l.id)) || null;
}
export async function createLoadFor(id) {
  await loadOrders(); guard('edit');
  const o = byId(id); if (!o) throw new Error('La orden ya no existe.');
  if (o.fullLoadId && loadOf(o)) return { load: loadOf(o) };
  const res = await fc.create({ ...loadInput(o), tripId: o.tripId || null, logisticsOperationId: o.logisticsOperationId || null });
  if (res.errors) return res;
  const next = await patchOrder(o, { fullLoadId: res.load.id });
  await addEvent(next, 'load_created', 'Carga programada en Control de llenos', `${res.load.containerNumber} · ${res.load.scheduledDate} ${res.load.scheduledTime}`, res.load.id);
  await reconcileSlots(next);
  changed();
  return res;
}
/* Vincula una carga existente: sus datos y documentos pasan a ser los de la orden (no se suben dos veces) */
export async function linkLoad(id, loadId) {
  await loadOrders(); guard('edit');
  const o = byId(id), load = fc.byId(loadId);
  if (!o || !load) throw new Error('La orden o la carga ya no existen.');
  const other = orderForLoad(loadId);
  if (other && other.id !== id) throw new Error(`Esa carga ya pertenece a la orden ${other.folio}.`);
  const patch = { fullLoadId: loadId, containerNumber: load.containerNumber, weightKg: load.weightKg, locationType: load.locationType, terminalId: load.terminalId, yardId: load.yardId, scheduledDate: load.scheduledDate, scheduledTime: load.scheduledTime };
  if (!o.vehicleId && load.vehicleId) patch.vehicleId = load.vehicleId;
  if (!o.operatorId && load.operatorId) patch.operatorId = load.operatorId;
  if (!o.trailerId && load.trailerId) patch.trailerId = load.trailerId;
  const next = await patchOrder(o, patch);
  if (o.vehicleId || o.operatorId || o.trailerId) await fc.assign(loadId, { vehicleId: next.vehicleId, operatorId: next.operatorId, trailerId: next.trailerId });
  if (o.tripId || o.logisticsOperationId) await fc.link(loadId, { tripId: o.tripId || load.tripId || null, logisticsOperationId: o.logisticsOperationId || load.logisticsOperationId || null });
  await addEvent(next, 'load_linked', 'Vinculada con Control de llenos', `${load.containerNumber} · ${load.scheduledDate} ${load.scheduledTime}`, loadId);
  await reconcileSlots(next);
  changed();
  return next;
}

/* ===== Documentos propios de la orden (sin carga vinculada) y evidencias ===== */
async function reconcileSlots(o) {
  const want = loadOf(o) ? [] : D.orderSlots(o), own = filesOf(o.id), now = Date.now(), who = actor();
  for (const [t, req] of want) {
    if (own.some((f) => f.docType === t)) continue;
    await writeFile({ id: db.uid('sf_'), orderId: o.id, docType: t, label: '', required: req, manual: false, order: 0, name: '', mimeType: '', kind: null, size: 0, pages: 0, storageKey: null, fileStatus: 'none', attachedAt: null, createdAt: now, createdBy: who, updatedAt: now, updatedBy: who });
  }
  /* Espacios vacíos que ya no aplican (Campo, o carga vinculada): se quitan; los que tienen archivo se conservan */
  for (const f of own) if (D.ORDER_SLOT_TYPES.includes(f.docType) && !want.some(([t]) => t === f.docType) && !f.storageKey) { await db.del(db.S.serviceOrderFiles, f.id); C().files = C().files.filter((x) => x.id !== f.id); }
}
/* Mismo archivo ya adjuntado (nombre y tamaño) en la orden o en su carga */
export function duplicateFile(o, file) {
  const list = [...docsOf(o), ...evidenceOf(o)];
  return list.find((d) => D.hasFile(d) && d.name === file.name && Math.abs((d.originalSize || d.size || 0) - file.size) < 2) || null;
}
/*
 * Adjunta un archivo. opts = { docId (reemplazar o llenar ese espacio), docType ('pedimento'|'doda'|'dec'|'cita'|'otro'|
 * 'entrega'|'devolucion'), label }. Con carga vinculada, los documentos portuarios y adicionales van a Control de llenos.
 */
export async function attachFile(id, file, { docId = null, docType = 'otro', label = '' } = {}) {
  await loadOrders(); guard('attach');
  const o = byId(id); if (!o) throw new Error('La orden ya no existe.');
  const load = loadOf(o), evidence = !!D.EVIDENCE_TYPES[docType] || (docId && fileById(docId) && D.isEvidence(fileById(docId)));
  if (load && !evidence) {
    const slot = !docId && docType !== 'otro' ? fc.docsOf(load.id).find((d) => d.docType === docType && !D.hasFile(d)) : null;
    const d = await fc.attachFile(load.id, file, { docId: docId || (slot ? slot.id : null), docType, label });
    await addEvent(o, 'doc_added', `${D.docKindLabel(d)} adjuntado`, `${file.name} (en Control de llenos)`, d.id);
    changed();
    return d;
  }
  const kind = kindOf(file);
  if (!kind) throw new Error('Solo se admiten archivos PDF, JPG y PNG.');
  if (file.size > MAX_FILE) throw new Error('El archivo es demasiado grande.');
  let prev = docId ? fileById(docId) : null;
  if (!prev && D.ORDER_SLOT_TYPES.includes(docType)) prev = filesOf(id).find((f) => f.docType === docType && !f.storageKey) || null;
  const p = await processFile(file, file.name, kind);
  const storageKey = await media.saveBlob(p.blob, { owner: 'so:' + id, kind: 'so-doc', name: file.name, type: p.type });
  const now = Date.now(), who = actor();
  const rec = {
    ...(prev || { id: db.uid('sf_'), orderId: id, docType, label: String(label || '').slice(0, 80), required: false, manual: false, order: filesOf(id).filter((f) => f.docType === docType).length, createdAt: now, createdBy: who }),
    name: file.name, mimeType: p.type, kind, size: p.blob.size, originalSize: file.size, pages: p.pages || 1, w: p.w || null, h: p.h || null,
    storageKey, fileStatus: 'ok', attachedAt: now, updatedAt: now, updatedBy: who,
  };
  if (prev && prev.storageKey) await media.remove(prev.storageKey);
  await writeFile(rec);
  if (prev && o.docChecks && o.docChecks[rec.id]) { const dc = { ...o.docChecks }; delete dc[rec.id]; await patchOrder(o, { docChecks: dc }); }
  await addEvent(byId(id), prev && prev.storageKey ? 'doc_replaced' : 'doc_added', `${D.docKindLabel(rec)} ${prev && prev.storageKey ? 'reemplazado' : 'adjuntado'}`, file.name, rec.id);
  changed();
  return rec;
}
const isLoadDoc = (docId) => !!fc.docById(docId);
export async function setDocRequired(id, docId, required) {
  await loadOrders(); guard('attach');
  const o = byId(id); if (!o) return;
  if (isLoadDoc(docId)) await fc.setRequired(docId, required);
  else { const f = fileById(docId); if (!f) return; await writeFile({ ...f, required: !!required, manual: true, updatedAt: Date.now(), updatedBy: actor() }); }
  const d = fc.docById(docId) || fileById(docId);
  await addEvent(o, 'doc_rule', `${D.docKindLabel(d)}: ${required ? 'requerido' : 'no requerido'}`, '', docId);
  changed();
}
export async function verifyDoc(id, docId, ok = true) {
  await loadOrders(); guard('attach');
  const o = byId(id); if (!o) return;
  const d = fc.docById(docId) || fileById(docId);
  const dc = { ...(o.docChecks || {}) };
  if (ok) dc[docId] = { at: Date.now(), by: actor(), key: d ? d.storageKey : null }; else delete dc[docId];
  const next = await patchOrder(o, { docChecks: dc });
  await addEvent(next, 'doc_verified', `${d ? D.docKindLabel(d) : 'Documento'}: ${ok ? 'verificado' : 'verificación retirada'}`, '', docId);
  changed();
}
/* Archivar (quitar) un documento: el archivo original se elimina del expediente; el evento queda en la bitácora */
export async function removeDoc(id, docId) {
  await loadOrders(); guard('archive');
  const o = byId(id); if (!o) return;
  if (isLoadDoc(docId)) { const d = fc.docById(docId); await fc.removeFile(docId); await addEvent(o, 'doc_removed', `${D.docKindLabel(d)} eliminado`, `${d.name || ''} (Control de llenos)`, docId); changed(); return; }
  const f = fileById(docId); if (!f) return;
  if (f.storageKey) await media.remove(f.storageKey);
  if (D.ORDER_SLOT_TYPES.includes(f.docType)) await writeFile({ ...f, name: '', mimeType: '', kind: null, size: 0, pages: 0, storageKey: null, fileStatus: 'none', attachedAt: null, updatedAt: Date.now(), updatedBy: actor() });
  else { await db.del(db.S.serviceOrderFiles, f.id); C().files = C().files.filter((x) => x.id !== f.id); }
  await addEvent(o, 'doc_removed', `${D.docKindLabel(f)} eliminado`, f.name || '', docId);
  changed();
}
export async function blobOfDoc(d) { return d && d.storageKey ? media.getBlob(d.storageKey) : null; }
export async function setDossier(id, { order, skip }) {
  const o = byId(id); if (!o || isReadOnly()) return;
  await patchOrder(o, { dossierOrder: order || [], dossierSkip: skip || [] });
}

/* ===== Asignación (con historial; después del despacho actualiza Logística, la carga y el viaje) ===== */
export async function assign(id, { vehicleId = null, operatorId = null, trailerId = null } = {}, { reason = '' } = {}) {
  await loadOrders();
  const o = byId(id); if (!o) throw new Error('La orden ya no existe.');
  if (o.phase === 'cancelled' || o.closedAt) throw new Error('La orden está cerrada.');
  const op = opOf(o), after = !!(op && !op.closedAt);
  guard(after ? 'reassign' : 'assign');
  if (after && !vehicleId) throw new Error('Una orden despachada necesita unidad.');
  if (after && !String(reason || '').trim()) throw new Error('Escribe el motivo del cambio de asignación.');
  if (after) await lg.saveOperation({ id: op.id, vehicleId, operatorId, trailerId, status: op.status }, { by: actor() });
  const load = loadOf(o);
  if (load) await fc.assign(load.id, { vehicleId, operatorId, trailerId });
  const trip = tripOf(o);
  if (trip && operatorId && trip.operatorId !== operatorId) await ops.saveTrip({ id: trip.id, operatorId, documentId: trip.documentId ?? null, source: trip.source || 'manual' });
  const entry = { at: Date.now(), by: actor(), vehicleId, operatorId, trailerId, reason: String(reason || '').slice(0, 300), afterDispatch: after };
  const next = await patchOrder(o, { vehicleId, operatorId, trailerId, assignments: [...(o.assignments || []), entry].slice(-50) });
  const r = resolved(next);
  await addEvent(next, after ? 'reassigned' : 'assigned', after ? 'Asignación modificada después del despacho' : 'Transporte asignado', [r.unit && `Unidad ${r.unit}`, r.operator, r.trailer && `Remolque ${r.trailer}`, entry.reason].filter(Boolean).join(' · '));
  changed();
  return next;
}

/* ===== Despacho idempotente =====
 * opts = { initial: 'assigned' | 'loading' | 'to_destination', authorized: [códigos de advertencias aceptadas] }
 * 1) valida  2) viaje financiero (reutiliza el vinculado o el creado para esta orden; si no, lo crea una vez)
 * 3) operación de Logística (igual)  4) vincula carga  5) registra el despacho. Cada vínculo se guarda en cuanto existe. */
export const INITIAL_STATUSES = [['assigned', 'Asignada, pendiente de salida'], ['loading', 'En carga (la unidad ya está en el lugar de carga)'], ['to_destination', 'En ruta a destino (ya salió cargada)']];
export async function dispatch(id, { initial = 'assigned', authorized = [] } = {}) {
  await loadOrders(); guard('dispatch');
  let o = byId(id); if (!o) throw new Error('La orden ya no existe.');
  if (!INITIAL_STATUSES.some(([k]) => k === initial)) throw new Error('Estado inicial no válido.');
  const existingOp = opOf(o);
  if (existingOp && !existingOp.closedAt) return { order: o, op: existingOp, already: true };
  if (existingOp && existingOp.closedAt) throw new Error('La operación de esta orden ya se cerró en Logística.');
  const chk = dispatchCheck(o);
  if (chk.blocks.length) { const e = new Error(chk.blocks.map((b) => b.msg).join(' ')); e.check = chk; throw e; }
  const pendingAuth = chk.warnings.filter((w) => !authorized.includes(w.code));
  if (pendingAuth.length) { const e = new Error('Hay advertencias por autorizar.'); e.check = chk; e.needsAuth = pendingAuth; throw e; }
  const r = resolved(o), who = actor(), docId = (latestGenerated(o) || {}).documentId || null;
  /* 2) Viaje financiero: nunca un segundo viaje ni otra comisión */
  let trip = tripOf(o) || ops.allTrips().find((t) => t.serviceOrderId === o.id) || null;
  if (!trip && o.finance && o.finance.fare > 0 && r.operatorId) {
    const fin = o.finance, rule = ruleFromSettings(ops.settingsFor(r.operatorId)), c = commissionFor(fin.fare, rule);
    trip = await ops.saveTrip({
      operatorId: r.operatorId, division: o.division, date: o.serviceDate || r.scheduledDate || todayStr(), reference: (r.containerNumber || o.reference || o.commercialRef || o.folio).slice(0, 40),
      origin: r.origin, destination: r.destination, fare: fin.fare, travelExpenses: fin.travelExpenses || 0, ...taxFields(fin.fare, fin),
      commissionRate: c.rate, minEnabled: !!rule.minEnabled, minAmount: rule.minAmount, baseCommission: c.base, expandedCommission: c.adjustment, finalCommission: c.final, isExpanded: c.expanded,
      notes: [`Orden ${o.folio}`, fin.notes].filter(Boolean).join(' · '), documentId: docId, source: 'manual', serviceOrderId: o.id,
    });
    await addEvent(o, 'trip_created', 'Viaje financiero registrado', `Tarifa base y comisión del operador (una sola vez)`, trip.id);
  }
  if (trip && o.tripId !== trip.id) o = await patchOrder(o, { tripId: trip.id });
  /* 3) Operación de Logística: la unidad aparece en Inicio → Unidades en operación */
  let op = lg.all().find((x) => x.serviceOrderId === o.id && !x.closedAt) || null;
  if (!op) {
    const ref = o.division === 'puerto' && r.containerNumber ? r.containerNumber : (o.reference || o.commercialRef || o.folio);
    op = await lg.saveOperation({
      vehicleId: r.vehicleId, operatorId: r.operatorId, trailerId: r.trailerId, division: o.division, status: initial,
      origin: r.origin, destination: r.destination, deliveryPlace: r.deliveryPlace, reference: String(ref).toUpperCase().slice(0, 80), containerType: o.containerType || '',
      tripId: trip ? trip.id : null, documentId: docId, serviceOrderId: o.id,
    }, { by: who });
  }
  o = await patchOrder(o, { logisticsOperationId: op.id, phase: 'scheduled', dispatchedAt: Date.now(), dispatchedBy: who, dispatchAuth: authorized.length ? { codes: authorized, at: Date.now(), by: who } : null });
  /* 4) Carga de Control de llenos: vínculo y estado */
  const load = loadOf(o);
  if (load) {
    await fc.link(load.id, { tripId: trip ? trip.id : null, logisticsOperationId: op.id });
    if (initial === 'loading' && ['scheduled', 'docs_pending', 'ready'].includes(load.status)) await fc.setStatus(load.id, 'loading', `Orden ${o.folio}`);
    if (initial === 'to_destination' && load.status !== 'loaded') await fc.setStatus(load.id, 'loaded', `Orden ${o.folio}`);
  }
  if (trip && docId && !trip.documentId) await ops.setTripDocument(trip.id, docId);
  await addEvent(o, 'dispatched', 'Asignación confirmada y unidad despachada', [`Estado inicial: ${INITIAL_STATUSES.find(([k]) => k === initial)[1]}`, authorized.length ? `Advertencias autorizadas: ${chk.warnings.filter((w) => authorized.includes(w.code)).map((w) => w.msg).join(' ')}` : ''].filter(Boolean).join(' · '), op.id);
  changed();
  return { order: o, op, trip };
}

/* ===== Seguimiento: el estado vive en Logística ===== */
export async function advance(id, status, { note = '' } = {}) {
  await loadOrders(); guard('status');
  const o = byId(id); const op = opOf(o);
  if (!op || op.closedAt) throw new Error('La orden no tiene una operación activa en Logística.');
  if (op.status === status) return o;
  await lg.setStatus(op.id, status, { by: actor() });
  const load = loadOf(o);
  if (load) {
    if (status === 'loading' && ['scheduled', 'docs_pending', 'ready'].includes(load.status)) await fc.setStatus(load.id, 'loading', `Orden ${o.folio}`);
    if (status === 'to_destination' && load.status !== 'loaded' && load.status !== 'cancelled') await fc.setStatus(load.id, 'loaded', `Orden ${o.folio}`);
  }
  let next = byId(id);
  if (status === 'empty') next = await linkEmpty(next, lg.takeEmptyResult());
  if (note) await addEvent(next, 'note', 'Nota de seguimiento', note);
  changed();
  return next;
}
/* Vínculo con el control de vacíos que Logística creó (o reutilizó) y patio previsto precargado */
async function linkEmpty(o, res) {
  const rec = (res && ((res.created || [])[0] || (res.existing || [])[0])) || emptyOf(o);
  const r = rec && rec.id ? ec.byId(rec.id) || rec : null;
  if (!r) { await addEvent(o, 'empty_none', 'Contenedor vacío sin número reconocible', 'Registra el control de vacíos desde Control de vacíos'); return o; }
  if (o.returnYardId && !r.yardId) { try { await ec.update(r.id, { yardId: o.returnYardId }); } catch (e) { /* se completa después */ } }
  const next = o.emptyReturnId === r.id ? o : await patchOrder(o, { emptyReturnId: r.id });
  await addEvent(next, 'empty', 'Contenedor vacío: control de devolución creado', `${r.containerNumber} · Control de vacíos`, r.id);
  return next;
}
/* Registro de entrega (desde la orden o desde Logística); no cierra la orden si falta la devolución del vacío */
export async function registerDelivery(id, { date, time, place = '', receiver = '', notes = '' }) {
  await loadOrders(); guard('deliver');
  const o = byId(id); if (!o) throw new Error('La orden ya no existe.');
  if (!opOf(o)) throw new Error('Despacha la orden antes de registrar la entrega.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^\d{2}:\d{2}$/.test(time || '')) throw new Error('Escribe la fecha y la hora de la entrega.');
  const delivery = { date, time, place: clean(place), receiver: clean(receiver, 120), notes: String(notes || '').trim().slice(0, 600), at: Date.now(), by: actor() };
  const next = await patchOrder(o, { delivery });
  await addEvent(next, o.delivery ? 'delivery_fixed' : 'delivered', o.delivery ? 'Entrega corregida' : 'Entrega realizada', [`${date} ${time}`, delivery.place, delivery.receiver && `Recibió: ${delivery.receiver}`, delivery.notes].filter(Boolean).join(' · '));
  /* La unidad llegó al lugar de entrega: Logística pasa a «Descargando» (si seguía antes) y la carga queda como cargada */
  const op = opOf(next);
  if (op && !op.closedAt && ['assigned', 'loading', 'to_destination'].includes(op.status)) await lg.setStatus(op.id, 'unloading', { by: actor() });
  const load = loadOf(next);
  if (load && !['loaded', 'cancelled'].includes(load.status)) await fc.setStatus(load.id, 'loaded', `Orden ${o.folio}: entregada`);
  changed();
  return next;
}
/* Puerto: «Contenedor vacío» = estado Vacío de Logística (crea o reutiliza el control de vacíos del contenedor) */
export async function markEmpty(id) {
  const o = byId(id);
  if (!o || o.division !== 'puerto') throw new Error('Solo aplica a órdenes de División Puerto.');
  if (!o.delivery) throw new Error('Confirma primero la entrega del contenedor lleno.');
  const op = opOf(o);
  if (op && op.status === 'empty') { const next = await linkEmpty(o, null); changed(); return next; }
  return advance(id, 'empty');
}
/* Excepción autorizada: la operación no requiere devolución del vacío */
export async function waiveEmptyReturn(id, reason) {
  await loadOrders(); guard('waive');
  const o = byId(id); if (!o) return null;
  if (!String(reason || '').trim()) throw new Error('Escribe el motivo de la excepción.');
  const next = await patchOrder(o, { noEmptyReturn: { reason: String(reason).trim().slice(0, 300), at: Date.now(), by: actor() } });
  await addEvent(next, 'waived', 'Sin devolución de vacío (excepción autorizada)', reason);
  changed();
  return next;
}
/* Cierre operativo: verifica condiciones, cierra la operación de Logística y conserva la orden en el historial */
export async function closeOrder(id) {
  await loadOrders(); guard('close');
  const o = byId(id); if (!o) throw new Error('La orden ya no existe.');
  const chk = closeCheck(o);
  if (!chk.ok) throw new Error(chk.missing.join(' '));
  const op = opOf(o);
  if (op && !op.closedAt) await lg.closeOperation(op.id);
  const next = await patchOrder(o, { closedAt: Date.now(), closedBy: actor() });
  await addEvent(next, 'closed', 'Orden operativamente finalizada');
  changed();
  return next;
}
export async function cancelOrder(id, reason) {
  await loadOrders(); guard('cancel');
  const o = byId(id); if (!o) return null;
  if (o.closedAt) throw new Error('Una orden finalizada no se cancela: reábrela si necesitas corregirla.');
  if (!String(reason || '').trim()) throw new Error('Escribe el motivo de la cancelación.');
  const op = opOf(o);
  if (op && !op.closedAt) await lg.closeOperation(op.id);
  const load = loadOf(o);
  if (load && ['scheduled', 'docs_pending', 'ready'].includes(load.status)) await fc.setStatus(load.id, 'cancelled', `Orden ${o.folio} cancelada`);
  const next = await patchOrder(o, { phase: 'cancelled', cancelledAt: Date.now(), cancelledBy: actor(), cancelReason: String(reason).trim().slice(0, 300) });
  await addEvent(next, 'cancelled', 'Orden cancelada', reason);
  changed();
  return next;
}
/* Reapertura autorizada (corregir una orden finalizada o cancelada); la bitácora conserva todo */
export async function reopenOrder(id, reason) {
  await loadOrders(); guard('reopen');
  const o = byId(id); if (!o) return null;
  if (!String(reason || '').trim()) throw new Error('Escribe el motivo de la reapertura.');
  const next = await patchOrder(o, { closedAt: null, phase: o.phase === 'cancelled' ? 'scheduled' : o.phase, cancelledAt: null, reopenedAt: Date.now(), reopenedBy: actor() });
  await addEvent(next, 'reopened', 'Orden reabierta', reason);
  changed();
  return next;
}
/* Incidencias (las críticas abiertas impiden el cierre) */
export async function addIncident(id, { text, critical = false }) {
  await loadOrders(); guard('edit');
  const o = byId(id); if (!o) return null;
  if (!String(text || '').trim()) throw new Error('Describe la incidencia.');
  const inc = { id: db.uid('si_'), text: String(text).trim().slice(0, 500), critical: !!critical, at: Date.now(), by: actor(), resolvedAt: null, resolution: '' };
  const next = await patchOrder(o, { incidents: [...(o.incidents || []), inc] });
  await addEvent(next, 'incident', critical ? 'Incidencia crítica registrada' : 'Incidencia registrada', inc.text);
  changed();
  return next;
}
export async function resolveIncident(id, incId, resolution) {
  await loadOrders(); guard('edit');
  const o = byId(id); if (!o) return null;
  const next = await patchOrder(o, { incidents: (o.incidents || []).map((i) => (i.id === incId ? { ...i, resolvedAt: Date.now(), resolvedBy: actor(), resolution: String(resolution || '').trim().slice(0, 500) } : i)) });
  await addEvent(next, 'incident_resolved', 'Incidencia resuelta', resolution || '');
  changed();
  return next;
}

/* ===== Finanzas ===== */
export async function saveFinance(id, fin) {
  await loadOrders(); guard('finance');
  const o = byId(id); if (!o) return null;
  if (tripOf(o)) throw new Error('El viaje ya está registrado: edita la tarifa e impuestos desde el viaje.');
  const f = { ...D.defaultFinance(o.division), ...o.finance, ...fin };
  f.fare = Math.max(0, Math.round(+f.fare || 0)); f.travelExpenses = Math.max(0, Math.round(+f.travelExpenses || 0));
  const next = await patchOrder(o, { finance: f });
  await addEvent(next, 'finance', 'Información económica actualizada', '');
  changed();
  return next;
}
/* Vincular un viaje financiero ya registrado (por ejemplo, de una operación anterior): nunca crea otro */
export async function linkTrip(id, tripId) {
  await loadOrders(); guard('finance');
  const o = byId(id), trip = ops.allTrips().find((t) => t.id === tripId);
  if (!o || !trip) throw new Error('La orden o el viaje ya no existen.');
  const other = orderForTrip(tripId);
  if (other && other.id !== id) throw new Error(`Ese viaje ya pertenece a la orden ${other.folio}.`);
  const next = await patchOrder(o, { tripId });
  await ops.saveTrip({ id: trip.id, documentId: trip.documentId ?? null, source: trip.source || 'manual', serviceOrderId: id });
  await addEvent(next, 'trip_linked', 'Viaje financiero vinculado', `${trip.date} · ${trip.origin} → ${trip.destination}`, tripId);
  changed();
  return next;
}

/* ===== Documentos generados (nota de entrega / asignación): cada emisión es una versión nueva ===== */
export async function recordGenerated(id, doc) {
  await loadOrders();
  const o = byId(id); if (!o || !doc) return null;
  if ((o.generated || []).some((g) => g.documentId === doc.id)) return o;
  const r = resolved(o), type = doc.type;
  const entry = { documentId: doc.id, type, company: doc.company, folio: doc.folio, version: D.nextVersion(o.generated, type), at: doc.createdAt || Date.now(), by: actor(), snapshot: D.snapshotOf(r) };
  const next = await patchOrder(o, { generated: [...(o.generated || []), entry] });
  /* El documento vigente se relaciona con la operación y el viaje (Logística, expediente consolidado, vacíos) */
  const op = opOf(next); if (op && !op.closedAt && op.documentId !== doc.id) await lg.saveOperation({ id: op.id, vehicleId: op.vehicleId, status: op.status, documentId: doc.id });
  const trip = tripOf(next); if (trip && trip.documentId !== doc.id) await ops.setTripDocument(trip.id, doc.id);
  await addEvent(next, 'document', `${type === 'campo' ? 'Asignación de unidades' : 'Nota de entrega'} generada (versión ${entry.version})`, `Folio ${doc.folio}`, doc.id);
  changed();
  return next;
}
export async function generatedDocs(o) {
  const out = [];
  for (const g of generatedOf(o)) out.push({ ...g, doc: await getDocument(g.documentId) });
  return out;
}

/* ===== Registros existentes (migración segura): operaciones y cargas abiertas sin orden ===== */
export function legacyCandidates() {
  const used = new Set(all().map((o) => o.logisticsOperationId).filter(Boolean)), usedLoads = new Set(all().map((o) => o.fullLoadId).filter(Boolean));
  const opsOpen = lg.all().filter((op) => !op.closedAt && !used.has(op.id) && !op.serviceOrderId);
  const items = opsOpen.map((op) => {
    const v = lg.view(op), conts = String(op.reference || '').toUpperCase().match(/[A-Z]{4}\d{7}/g) || [];
    const loads = conts.flatMap((c) => fc.openList().filter((l) => l.containerNumber === c && !usedLoads.has(l.id)));
    return { kind: 'op', op, label: `${v.label} · ${op.origin || '—'} → ${op.destination || '—'}`, sub: [v.operator, op.reference].filter(Boolean).join(' · '), loads, ambiguous: loads.length > 1 };
  });
  const loadsTaken = new Set(items.filter((i) => i.loads.length === 1).map((i) => i.loads[0].id));
  for (const l of fc.openList()) if (!usedLoads.has(l.id) && !loadsTaken.has(l.id) && !l.logisticsOperationId) items.push({ kind: 'load', load: l, label: `Carga ${l.containerNumber} · ${l.scheduledDate} ${l.scheduledTime}`, sub: (fc.view(l).place || ''), loads: [l], ambiguous: false });
  return items;
}
/* Crea una orden que apunta a los registros existentes (no copia ni recalcula viajes, comisiones, impuestos ni cobros) */
export async function adoptExisting(item) {
  await loadOrders(); guard('migrate');
  const op = item.kind === 'op' ? lg.opById(item.op.id) : null, load = item.loads && item.loads.length === 1 ? item.loads[0] : item.kind === 'load' ? item.load : null;
  if (op && orderForOp(op.id)) throw new Error('Esa operación ya tiene orden.');
  const trip = op && op.tripId ? ops.allTrips().find((t) => t.id === op.tripId) : load && load.tripId ? ops.allTrips().find((t) => t.id === load.tripId) : null;
  const division = (op && op.division) || (load ? 'puerto' : trip ? trip.division : 'puerto');
  const pending = ['cliente'];
  if (!op && !load) pending.push('ruta');
  const o = await createOrder({
    division, opType: division === 'campo' ? 'campo_load' : load ? 'full_pickup' : 'transfer',
    origin: op ? op.origin : trip ? trip.origin : '', destination: op ? op.destination : trip ? trip.destination : '', deliveryPlace: op ? op.deliveryPlace : '',
    reference: op ? op.reference : load ? load.reference : '', containerType: op ? op.containerType : '',
    vehicleId: op ? op.vehicleId : load ? load.vehicleId : null, operatorId: op ? op.operatorId : load ? load.operatorId : null, trailerId: op ? op.trailerId : load ? load.trailerId : null,
    serviceDate: trip ? trip.date : load ? load.scheduledDate : todayStr(),
  }, { source: 'migrated', pending });
  let next = o;
  if (load) next = await linkLoad(o.id, load.id);
  const patch = { phase: 'scheduled' };
  if (op) Object.assign(patch, { logisticsOperationId: op.id, dispatchedAt: op.startedAt || op.createdAt || Date.now(), dispatchedBy: op.createdBy || '' });
  if (trip && !orderForTrip(trip.id)) patch.tripId = trip.id;
  const docId = (op && op.documentId) || (trip && trip.documentId);
  if (docId) { const d = await getDocument(docId); if (d) patch.generated = [{ documentId: d.id, type: d.type, company: d.company, folio: d.folio, version: 1, at: d.createdAt, by: '', snapshot: null, migrated: true }]; }
  next = await patchOrder(byId(o.id), patch);
  if (op) await lg.saveOperation({ id: op.id, vehicleId: op.vehicleId, status: op.status, serviceOrderId: o.id });
  await addEvent(next, 'migrated', 'Vinculada a registros existentes', ['operación de Logística', load && 'carga de Control de llenos', patch.tripId && 'viaje financiero (sin recalcular)', docId && 'documento emitido'].filter(Boolean).join(', ') + `. Datos pendientes: ${pending.join(', ')}.`);
  const empty = emptyOf(byId(o.id));
  if (empty) await patchOrder(byId(o.id), { emptyReturnId: empty.id });
  changed();
  return byId(o.id);
}
