/*
 * Logística — almacenamiento (store logisticsOperations).
 * No crea unidades, operadores ni remolques: todo se relaciona con los catálogos existentes por ID persistente.
 * Registro:
 *   { id, vehicleId, operatorId, trailerId, division, status, origin, destination, reference, deliveryPlace, containerType (ISO, opcional),
 *     tripId, documentId, referenceSource, startedAt, closedAt, lastStatus, closeReason,
 *     statusLog[{ status, at, by }], snap{ unit, placas, operator, trailer, trailerType },
 *     createdAt, createdBy, updatedAt, updatedBy, revisions[] }
 * Abierta (closedAt null) = asignación actual de la unidad. Cerrada = historial. snap guarda los textos visibles al
 * momento de guardar solo para que el historial siga legible si después se edita o elimina un registro del catálogo.
 * Cualquier cambio avisa a la app (evento «logistics:change») para que Inicio y Logística se actualicen al momento.
 */
import * as db from './db.js';
import { listAll } from './catalogs.js';
import { vehicles as fleetUnits } from './fuel.js';
import { operatorById } from './operators.js';
import { allTrips } from './operators.js';
import { isStatus, isWorking, DEFAULT_STATUS } from '../config/logistics.js';
import { board, openOpOf, historyOf, isOpen, conflicts, suggestions } from '../domain/logistics/logistics.js';
import { fromOperation } from './empties.js';

/* Resultado del último paso a «Vacío» (controles de vacío creados o reutilizados) para avisar en pantalla */
let lastEmpty = null;
export const takeEmptyResult = () => { const r = lastEmpty; lastEmpty = null; return r; };

let cache = null;
export async function loadLogistics(force = false) { if (!cache || force) cache = await db.all(db.S.logisticsOperations); return cache; }
const live = () => (cache || []).filter((o) => !o.deletedAt);
function actor() { try { const s = JSON.parse(sessionStorage.getItem('pcs-session') || 'null'); return (s && s.user) || 'local'; } catch (e) { return 'local'; } }

/* ===== Aviso de cambios (misma pestaña y otras pestañas abiertas de la app) ===== */
const EVT = 'logistics:change';
let bc = null;
try { bc = new BroadcastChannel('pcs-logistics'); bc.onmessage = async () => { await loadLogistics(true); window.dispatchEvent(new CustomEvent(EVT)); }; } catch (e) { /* sin BroadcastChannel */ }
function changed() { window.dispatchEvent(new CustomEvent(EVT)); try { if (bc) bc.postMessage(Date.now()); } catch (e) { /* */ } }
export function onLogisticsChange(fn) { window.addEventListener(EVT, fn); return () => window.removeEventListener(EVT, fn); }

/* ===== Datos del catálogo ===== */
export const units = () => fleetUnits();
export const unitById = (id) => units().find((u) => u.id === id) || null;
export const trailerById = (id) => (id ? listAll('trailers').find((t) => t.id === id) || null : null);
export { operatorById };

/* Vista de una operación con los datos actuales del catálogo (o lo último conocido si el registro ya no existe) */
export function view(op, unit = null) {
  const u = unit || (op ? unitById(op.vehicleId) : null), o = op && op.operatorId ? operatorById(op.operatorId) : null, t = op ? trailerById(op.trailerId) : null;
  const s = (op && op.snap) || {};
  return {
    unit: u, operatorRec: o, trailerRec: t,
    eco: u ? u.eco : '', label: u ? u.label : s.unit || '—', placas: u ? u.placas : s.placas || '', companyShort: u ? u.companyShort : '',
    operator: o ? o.name : s.operator || '',
    /* Nombre que puede ver el cliente en el rastreo: vacío si el operador no lo autorizó (ficha del operador) */
    operatorShared: o ? (o.trackHide ? '' : o.name) : s.operator || '', trailer: t ? t.placas : s.trailer || '', trailerType: t ? t.type || '' : s.trailerType || '', trailerDesc: t ? t.desc || '' : '',
  };
}
export const entryView = (e) => view(e.op, e.unit);

/* ===== Consultas ===== */
export const all = () => live();
/* Incluye las eliminadas (rastreo para clientes: una operación eliminada también finaliza su enlace) */
export const allRecords = () => cache || [];
export const fleetBoard = () => board(units(), live());
export const openOf = (vehicleId) => openOpOf(live(), vehicleId);
export const historyOfUnit = (vehicleId) => historyOf(live(), vehicleId);
export const opById = (id) => live().find((o) => o.id === id) || null;
export const conflictsFor = (sel, selfId) => conflicts(live(), sel, selfId);
/* Operación abierta en la que aparece un operador o un remolque (para mostrarlo en los selectores) */
export const openWithOperator = (operatorId) => live().find((o) => isOpen(o) && o.operatorId === operatorId) || null;
export const openWithTrailer = (trailerId) => live().find((o) => isOpen(o) && o.trailerId === trailerId) || null;
/* Para proteger los catálogos: ¿el registro está en una operación abierta? */
export async function inOpenOperation(field, id) { await loadLogistics(); return live().some((o) => isOpen(o) && o[field] === id); }

/* Sugerencias para captura: valores usados antes en Logística y en los viajes de Operadores */
export function placeSuggestions() {
  const ops = live(), trips = allTrips();
  return {
    deliveryPlace: suggestions(ops.map((o) => ({ v: o.deliveryPlace, at: o.updatedAt }))),
    origin: suggestions([...ops.map((o) => ({ v: o.origin, at: o.updatedAt })), ...trips.map((t) => ({ v: t.origin, at: t.updatedAt }))]),
    destination: suggestions([...ops.map((o) => ({ v: o.destination, at: o.updatedAt })), ...trips.map((t) => ({ v: t.destination, at: t.updatedAt }))]),
  };
}

/* ===== Guardado con auditoría ===== */
function snapOf(rec) {
  const v = view(rec);
  return { unit: v.label, placas: v.placas, operator: v.operator, trailer: v.trailer, trailerType: v.trailerType };
}
async function write(out) {
  const i = cache.findIndex((x) => x.id === out.id);
  if (i >= 0) cache[i] = out; else cache.push(out);
  await db.put(db.S.logisticsOperations, out);
}

/*
 * Crea o actualiza una operación. Reglas:
 *  - unidad obligatoria y del catálogo; operador y remolque, si se indican, también del catálogo;
 *  - una unidad no puede tener dos operaciones abiertas: si ya tiene una en estado de trabajo se rechaza;
 *    si la abierta está en Vacío o Inactiva, se cierra y pasa al historial (closeReason 'replaced').
 */
export async function saveOperation(rec, { by = '' } = {}) {
  await loadLogistics();
  if (!rec.vehicleId || !unitById(rec.vehicleId)) throw new Error('Elige una unidad del catálogo.');
  if (rec.operatorId && !operatorById(rec.operatorId)) throw new Error('El operador ya no está en el catálogo.');
  if (rec.trailerId && !trailerById(rec.trailerId)) throw new Error('El remolque ya no está en el catálogo.');
  if (!isStatus(rec.status)) throw new Error('Estado no válido.');
  const now = Date.now(), who = by || actor();
  const prev = rec.id ? cache.find((x) => x.id === rec.id) : null;
  const c = conflicts(live(), rec, prev ? prev.id : null);
  if (c.unit && (!prev || isOpen(prev))) throw new Error('Esta unidad ya tiene una operación activa.');
  if (c.unitOpen && (!prev || isOpen(prev))) await closeOperation(c.unitOpen.id, { reason: 'replaced', silent: true });
  let out;
  if (prev) {
    const { revisions = [], ...before } = prev;
    out = { ...prev, ...rec, updatedAt: now, updatedBy: who, revisions: [...revisions, { at: now, by: who, before }].slice(-30) };
    if (prev.status !== out.status) out.statusLog = [...(prev.statusLog || []), { status: out.status, at: now, by: who }].slice(-100);
  } else {
    out = {
      tripId: null, documentId: null, origin: '', destination: '', reference: '', deliveryPlace: '', containerType: '', operatorId: null, trailerId: null,
      ...rec, id: db.uid('lg_'), startedAt: now, closedAt: null, statusLog: [{ status: rec.status, at: now, by: who }],
      createdAt: now, createdBy: who, updatedAt: now, updatedBy: who, revisions: [],
    };
  }
  out.snap = snapOf(out);
  await write(out);
  /* Control de vacíos: al pasar a «Vacío» se crea (o reutiliza) el control del contenedor del viaje */
  lastEmpty = null;
  if (isOpen(out) && out.status === 'empty' && (!prev || prev.status !== 'empty')) { try { lastEmpty = await fromOperation(out); } catch (e) { console.warn('control de vacíos', e); } }
  changed();
  return out;
}

/* Cambio rápido de estado (desde el detalle o desde Inicio). by: quién lo hizo (p. ej. «Geocerca» si fue automático) */
export async function setStatus(id, status, { by = '' } = {}) {
  const op = opById(id);
  if (!op) throw new Error('La operación ya no existe.');
  if (op.status === status) return op;
  return saveOperation({ id, vehicleId: op.vehicleId, status }, { by });
}

/* Cierra la operación: queda en el historial y la unidad pasa a Inactiva (sin operación abierta) */
export async function closeOperation(id, { reason = 'closed', silent = false } = {}) {
  await loadLogistics();
  const op = cache.find((x) => x.id === id);
  if (!op || op.closedAt) return op || null;
  const now = Date.now(), who = actor(), { revisions = [], ...before } = op;
  const out = {
    ...op, lastStatus: op.status, status: DEFAULT_STATUS, closedAt: now, closeReason: reason, updatedAt: now, updatedBy: who,
    statusLog: [...(op.statusLog || []), { status: DEFAULT_STATUS, at: now, by: who, closed: true }].slice(-100),
    revisions: [...revisions, { at: now, by: who, before }].slice(-30),
  };
  out.snap = snapOf(out);
  await write(out);
  if (!silent) changed();
  return out;
}

/* Viajes de Operadores que se pueden relacionar (más recientes primero) */
export function relatableTrips(operatorId) {
  return allTrips().filter((t) => !operatorId || t.operatorId === operatorId)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 60);
}
export const tripById = (id) => (id ? allTrips().find((t) => t.id === id) || null : null);
export { isWorking };
