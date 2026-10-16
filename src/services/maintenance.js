/*
 * Taller — almacenamiento (stores maintenance*, tireReplacements y oilChanges; ver db.js v10).
 * Todo se relaciona por ID persistente: la orden con su equipo (vehicleId o trailerId del catálogo; nunca por texto) y
 * cada trabajo, intervención, llanta, cambio de aceite, foto y evento con su orden (orderId).
 *   maintenanceOrders      { id, folio, equipmentType 'vehicle'|'trailer', vehicleId, trailerId, kind, type, status, inAt, outAt,
 *                            odometer, odometerFix, reason, description, notes, outOfService, snap, createdAt/By, updatedAt/By,
 *                            revisions[], deletedAt? }
 *   maintenanceServices    trabajos de la orden { id, orderId, type, componentId, description, date, severity, action, replaced,
 *                            workStatus, notes, oilChangeId?, tireId? }
 *   maintenanceComponents  intervención por componente = datos del diagrama { id, orderId, componentId, severity, action,
 *                            replaced, date, description, serviceId? | issueId? | tireId? }
 *   maintenanceIssues      fallas reportadas { id, equipmentType, vehicleId, trailerId, kind, date, system, componentId,
 *                            description, severity, notes, orderId (al relacionarla con una orden; no se duplica) }
 *   tireReplacements       { id, orderId, equipmentType, vehicleId, trailerId, date, quantity, positions[], layout, reason, ... }
 *   oilChanges             { id, orderId, vehicleId, date, odometer, oilType, brand, viscosity, liters, oilFilter, otherFilters, notes }
 *   maintenanceAttachments fotos { id, parentType, parentId, orderId, mediaId } (el archivo vive en attachments, owner «mt:<parentId>»)
 *   maintenanceEvents      bitácora de la orden { id, orderId, at, by, type, text }
 *   maintenanceProfiles    por equipo { id 'v:<id>'|'t:<id>', oilKm, oilDays, tireLayout }
 *   maintenanceParts       componentes agregados por el usuario { id, kind, system, name }
 * Lo derivado (tiempo en taller, colores del diagrama, próximo cambio de aceite, disponibilidad) no se guarda: ver
 * domain/maintenance/maintenance.js. Cualquier cambio avisa con el evento «maintenance:change».
 */
import * as db from './db.js';
import * as media from './media.js';
import { listAll } from './catalogs.js';
import * as fuel from './fuel.js';
import * as lg from './logistics.js';
import { isWorking } from '../config/logistics.js';
import { kindLabel, componentsOf, componentOf, tireComponentOf, ORDER_TYPES, ORDER_STATUSES, SEVERITIES, ACTIONS, WORK_STATUSES, WORK_TYPES, TIRE_REASONS, isOpenStatus, orderStatusOf, severityLabel, actionLabel } from '../domain/maintenance/catalog.js';
import {
  validateOrder, equipmentCode, folioOf, ymd, toTs, latestReading, readingAge, oilStatus, availabilityOf, equipmentKey, keyOfOrder,
  validateTires, positionsOf, TIRE_LAYOUTS, isOpenOrder, fmtDT, kmText, nf, durationText,
} from '../domain/maintenance/maintenance.js';

const ST = {
  orders: db.S.maintenanceOrders, services: db.S.maintenanceServices, issues: db.S.maintenanceIssues, components: db.S.maintenanceComponents,
  tires: db.S.tireReplacements, oil: db.S.oilChanges, attachments: db.S.maintenanceAttachments, events: db.S.maintenanceEvents,
  profiles: db.S.maintenanceProfiles, parts: db.S.maintenanceParts,
};
let cache = null;
/* withFuel: también las recargas (odómetro GPS de cada unidad); al abrir la app no hace falta (se cargan al entrar a Operación) */
export async function loadMaintenance(force = false, { withFuel = true } = {}) {
  if (!cache || force) {
    const next = {};
    for (const [k, st] of Object.entries(ST)) next[k] = await db.all(st);
    cache = next;
  }
  if (withFuel) await fuel.loadFuel();
  return cache;
}
export const resetMaintenanceCache = () => { cache = null; };
const C = () => cache || { orders: [], services: [], issues: [], components: [], tires: [], oil: [], attachments: [], events: [], profiles: [], parts: [] };
function actor() { try { const s = JSON.parse(sessionStorage.getItem('pcs-session') || 'null'); return (s && s.user) || 'local'; } catch (e) { return 'local'; } }

/* ===== Aviso de cambios (misma pestaña y otras pestañas) ===== */
const EVT = 'maintenance:change';
let bc = null;
try { bc = new BroadcastChannel('pcs-maintenance'); bc.onmessage = async () => { await loadMaintenance(true); window.dispatchEvent(new CustomEvent(EVT)); }; } catch (e) { /* sin BroadcastChannel */ }
function changed() { window.dispatchEvent(new CustomEvent(EVT)); try { if (bc) bc.postMessage(Date.now()); } catch (e) { /* */ } }
export function onMaintenanceChange(fn) { window.addEventListener(EVT, fn); return () => window.removeEventListener(EVT, fn); }

/* Guarda un registro en su store y en la caché (con auditoría) */
async function upsert(k, rec, { audit = true } = {}) {
  const arr = C()[k], now = Date.now(), who = actor();
  const i = arr.findIndex((x) => x.id === rec.id);
  let out;
  if (i >= 0) {
    const { revisions = [], ...before } = arr[i];
    out = { ...arr[i], ...rec, updatedAt: now, updatedBy: who, ...(audit ? { revisions: [...revisions, { at: now, by: who, before }].slice(-20) } : {}) };
    arr[i] = out;
  } else { out = { createdAt: now, createdBy: who, ...rec, updatedAt: now, updatedBy: who, ...(audit ? { revisions: [] } : {}) }; arr.push(out); }
  await db.put(ST[k], out);
  return out;
}
async function hardDelete(k, id) {
  await db.del(ST[k], id);
  C()[k] = C()[k].filter((x) => x.id !== id);
}
async function logEvent(orderId, type, text) {
  if (!orderId) return;
  const ev = { id: db.uid('me_'), orderId, at: Date.now(), by: actor(), type, text };
  C().events.push(ev);
  await db.put(ST.events, ev);
}

/* ===== Equipos (del catálogo; nunca se crean ni duplican aquí) ===== */
export function vehicleEquipment(v) {
  if (!v) return null;
  return { type: 'vehicle', id: v.id, key: equipmentKey('vehicle', v.id), kind: 'tractor', eco: v.eco, label: v.label, placas: v.placas || '', sub: [v.placas, v.companyShort, v.desc].filter(Boolean).join(' · '), kindLabel: 'Tractocamión' };
}
export function trailerEquipment(t) {
  if (!t) return null;
  return { type: 'trailer', id: t.id, key: equipmentKey('trailer', t.id), kind: t.type || '', eco: '', label: t.placas || 'Sin placas', placas: t.placas || '', sub: [kindLabel(t.type), t.desc].filter(Boolean).join(' · '), kindLabel: kindLabel(t.type) };
}
export const vehicles = () => fuel.vehicles().map(vehicleEquipment);
export const trailers = () => listAll('trailers').map(trailerEquipment).sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label, 'es', { numeric: true }));
export function equipmentOf(type, id) {
  if (type === 'vehicle') return vehicleEquipment(fuel.vehicleById(id));
  return trailerEquipment(listAll('trailers').find((t) => t.id === id) || null);
}
/* Equipo de una orden; si ya no está en el catálogo, lo último conocido (snap) para que el historial siga legible */
export function equipmentOfOrder(o) {
  const eq = equipmentOf(o.equipmentType, o.equipmentType === 'vehicle' ? o.vehicleId : o.trailerId);
  if (eq) return { ...eq, kind: o.kind || eq.kind };
  const s = o.snap || {};
  return { type: o.equipmentType, id: o.vehicleId || o.trailerId, key: keyOfOrder(o), kind: o.kind, eco: s.eco || '', label: s.label || '—', placas: s.placas || '', sub: s.kindLabel || '', kindLabel: kindLabel(o.kind), missing: true };
}
export const parts = () => C().parts.filter((p) => !p.deletedAt);
export const componentsFor = (kind, opts) => componentsOf(kind, parts(), opts);
export const componentName = (kind, id) => (componentOf(kind, id, parts()) || { name: 'Componente' }).name;

/* ===== Consultas ===== */
const live = (arr) => arr.filter((x) => !x.deletedAt);
export const orders = () => live(C().orders).sort((a, b) => b.inAt - a.inAt);
export const orderById = (id) => C().orders.find((o) => o.id === id) || null;
export const ordersOf = (key) => orders().filter((o) => keyOfOrder(o) === key);
export const servicesOf = (orderId) => C().services.filter((s) => s.orderId === orderId).sort((a, b) => (a.date || 0) - (b.date || 0) || a.createdAt - b.createdAt);
export const componentsOfOrder = (orderId) => C().components.filter((c) => c.orderId === orderId);
export const componentsOfOrders = (ids) => { const set = new Set(ids); return C().components.filter((c) => set.has(c.orderId)); };
export const issues = () => live(C().issues).sort((a, b) => b.date - a.date);
export const issueById = (id) => C().issues.find((i) => i.id === id) || null;
export const issuesOf = (key) => issues().filter((i) => equipmentKey(i.equipmentType, i.equipmentType === 'vehicle' ? i.vehicleId : i.trailerId) === key);
export const issuesOfOrder = (orderId) => issues().filter((i) => i.orderId === orderId);
export const openIssues = () => issues().filter((i) => !i.orderId);
export const tiresOf = (orderId) => C().tires.filter((t) => t.orderId === orderId).sort((a, b) => a.date - b.date);
export const tiresOfEquipment = (key) => { const ids = new Set(ordersOf(key).map((o) => o.id)); return C().tires.filter((t) => ids.has(t.orderId)).sort((a, b) => b.date - a.date); };
export const oilOf = (orderId) => C().oil.filter((x) => x.orderId === orderId);
export const oilOfVehicle = (vehicleId) => { const ids = new Set(orders().map((o) => o.id)); return C().oil.filter((x) => x.vehicleId === vehicleId && ids.has(x.orderId)).sort((a, b) => b.date - a.date); };
export const eventsOf = (orderId) => C().events.filter((e) => e.orderId === orderId).sort((a, b) => a.at - b.at);
export const photosOf = (parentId) => C().attachments.filter((a) => a.parentId === parentId).sort((a, b) => a.createdAt - b.createdAt);
export const photosOfOrder = (orderId) => C().attachments.filter((a) => a.orderId === orderId).sort((a, b) => a.createdAt - b.createdAt);
export const profileOf = (key) => C().profiles.find((p) => p.id === key) || { id: key };

/* Para proteger el catálogo: ¿el equipo tiene órdenes de taller? (consulta por índice) */
export async function equipmentHasMaintenance(field, id) { return (await db.byIndex(ST.orders, field, id)).some((o) => !o.deletedAt); }
/* Disponibilidad del equipo (independiente del estado del viaje en Logística) */
export const availability = (key) => availabilityOf(C().orders, key);
/* Operación activa de Logística del equipo (para advertir antes de marcarlo como no disponible) */
export function activeTripOf(type, id) {
  const open = lg.all().filter((o) => !o.closedAt && (type === 'vehicle' ? o.vehicleId === id : o.trailerId === id));
  return open.find((o) => isWorking(o.status)) || open[0] || null;
}

/* ===== Odómetro ===== */
/* Lecturas conocidas de una unidad: recargas (odómetro GPS), órdenes de taller y cambios de aceite */
export function readingsOf(vehicleId, { excludeOrder = null } = {}) {
  const out = [];
  for (const r of fuel.recordsOf(vehicleId)) if (!r.deletedAt && Number.isFinite(r.odometer)) out.push({ ts: toTs(r.date, r.time), km: r.odometer, source: 'combustible', ref: r.id });
  for (const o of orders()) if (o.vehicleId === vehicleId && o.id !== excludeOrder && Number.isFinite(o.odometer)) out.push({ ts: o.inAt, km: o.odometer, source: 'taller', ref: o.id, folio: o.folio });
  for (const x of C().oil) if (x.vehicleId === vehicleId && x.orderId !== excludeOrder && Number.isFinite(x.odometer) && orderById(x.orderId) && !orderById(x.orderId).deletedAt) out.push({ ts: x.date, km: x.odometer, source: 'aceite', ref: x.id });
  return out;
}
export const SOURCE_TEXT = { combustible: 'Combustible (odómetro GPS)', taller: 'Taller', aceite: 'Cambio de aceite' };
export function lastOdometer(vehicleId, { beforeTs = Infinity, excludeOrder = null } = {}) {
  const r = latestReading(readingsOf(vehicleId, { excludeOrder }), beforeTs);
  return r ? { ...r, age: readingAge(r) } : null;
}
export function oilStatusOf(vehicleId) {
  const changes = oilOfVehicle(vehicleId).map((x) => ({ ...x, ts: x.date }));
  return oilStatus({ changes, plan: profileOf(equipmentKey('vehicle', vehicleId)), current: latestReading(readingsOf(vehicleId)) });
}

/* ===== Validaciones comunes ===== */
const inList = (list, k) => list.some((x) => (Array.isArray(x) ? x[0] : x.key) === k);
function checkComponent(kind, componentId) {
  if (!componentId) return;
  if (!componentOf(kind, componentId, parts())) throw new Error('Ese componente no existe para este tipo de equipo.');
}
function requireOrder(orderId) {
  const o = orderById(orderId);
  if (!o || o.deletedAt) throw new Error('La orden de mantenimiento ya no existe.');
  return o;
}

/* ===== Folio: MTTO-U21-20261008-001 (consecutivo diario por equipo) ===== */
async function nextFolio(eq, inAt) {
  const code = equipmentCode(eq), day = ymd(inAt), id = `mtto:${code}:${day}`;
  const n = await db.tx([db.S.counters], async ({ store, req }) => {
    const st = store(db.S.counters), cur = await req(st.get(id)), next = ((cur && cur.n) || 0) + 1;
    st.put({ id, n: next, day, code });
    return next;
  });
  return folioOf(code, day, n);
}

/* Información compartida: una orden que llega del teléfono de Taller con un folio que ya usa otra orden (ambos crearon una
   orden del mismo equipo el mismo día antes de sincronizar) recibe el siguiente folio libre; el anterior queda anotado */
export async function folioForIncoming(rec) {
  const all = await db.all(ST.orders);
  if (!rec.folio || !all.some((o) => o.id !== rec.id && o.folio === rec.folio && !o.deletedAt)) return rec;
  const prev = all.find((o) => o.id === rec.id);
  if (prev && prev.folio && prev.folio !== rec.folio) return { ...rec, folio: prev.folio };
  const eq = equipmentOf(rec.equipmentType, rec.equipmentType === 'vehicle' ? rec.vehicleId : rec.trailerId);
  if (!eq) return rec;
  const folio = await nextFolio(eq, rec.inAt);
  const ev = { id: db.uid('me_'), orderId: rec.id, at: Date.now(), by: actor(), type: 'folio', text: `Folio ${rec.folio} ya estaba en uso: la orden de Taller queda como ${folio}` };
  await db.put(ST.events, ev);
  return { ...rec, folio, folioFrom: rec.folio };
}

/* ===== Órdenes ===== */
export async function createOrder(data) {
  await loadMaintenance();
  const eq = equipmentOf(data.equipmentType, data.equipmentType === 'vehicle' ? data.vehicleId : data.trailerId);
  if (!eq) throw new Error('Elige un equipo del catálogo.');
  if (data.equipmentType === 'trailer' && !eq.kind) throw new Error('Clasifica el remolque (Chasis, Jaula o Tolva) antes de registrar su mantenimiento.');
  const rec = normalizeOrder({ ...data, kind: eq.kind });
  const err = validateOrder(rec);
  if (Object.keys(err).length) throw Object.assign(new Error(Object.values(err)[0]), { fields: err });
  rec.id = db.uid('mo_');
  rec.folio = await nextFolio(eq, rec.inAt);
  rec.snap = { label: eq.label, placas: eq.placas, eco: eq.eco, kindLabel: eq.kindLabel };
  const out = await upsert('orders', rec);
  await logEvent(out.id, 'creada', `Orden ${out.folio} registrada · ${orderStatusOf(out.status).label}`);
  if (out.odometerFix) await logEvent(out.id, 'odometro', `Kilometraje menor que el último conocido (${kmText(out.odometerFix.prevKm)}): ${out.odometerFix.reasonText}`);
  changed();
  return out;
}
function normalizeOrder(d) {
  const o = {
    equipmentType: d.equipmentType, vehicleId: d.equipmentType === 'vehicle' ? d.vehicleId : null, trailerId: d.equipmentType === 'trailer' ? d.trailerId : null,
    kind: d.kind, type: inList(ORDER_TYPES, d.type) ? d.type : 'general', status: inList(ORDER_STATUSES, d.status) ? d.status : 'reportado',
    inAt: d.inAt, outAt: Number.isFinite(d.outAt) ? d.outAt : null, odometer: d.equipmentType === 'vehicle' && d.odometer != null ? d.odometer : null,
    odometerFix: d.odometerFix || null, reason: String(d.reason || '').trim(), description: String(d.description || '').trim(), notes: String(d.notes || '').trim(),
    outOfService: d.outOfService !== false,
  };
  return o;
}
export async function updateOrder(id, patch) {
  await loadMaintenance();
  const cur = requireOrder(id);
  const next = { ...cur, ...normalizeOrder({ ...cur, ...patch, kind: cur.kind }), id: cur.id, folio: cur.folio, snap: cur.snap };
  const err = validateOrder(next);
  if (Object.keys(err).length) throw Object.assign(new Error(Object.values(err)[0]), { fields: err });
  const out = await upsert('orders', next);
  if (cur.status !== out.status) await logEvent(id, 'estado', `Estado: ${orderStatusOf(cur.status).label} → ${orderStatusOf(out.status).label}${out.status === 'finalizado' ? ` · salida ${fmtDT(out.outAt)} · tiempo en taller ${durationText(out.outAt - out.inAt)}` : ''}`);
  else if (cur.outAt !== out.outAt && Number.isFinite(out.outAt)) await logEvent(id, 'salida', `Salida registrada: ${fmtDT(out.outAt)}`);
  if (cur.odometer !== out.odometer) await logEvent(id, 'odometro', `Kilometraje: ${kmText(cur.odometer)} → ${kmText(out.odometer)}${out.odometerFix && out.odometerFix !== cur.odometerFix ? ` (corrección: ${out.odometerFix.reasonText})` : ''}`);
  if (cur.outOfService !== out.outOfService) await logEvent(id, 'disponibilidad', out.outOfService ? 'El equipo queda fuera de servicio (En taller)' : 'El equipo puede operar durante la orden');
  if (['reason', 'description', 'notes', 'type', 'inAt'].some((k) => cur[k] !== out[k])) await logEvent(id, 'editada', 'Datos de la orden actualizados');
  changed();
  return out;
}
export async function deleteOrder(id) {
  await loadMaintenance();
  const o = requireOrder(id);
  for (const i of issuesOfOrder(id)) await unlinkIssue(i.id, { silent: true });
  await upsert('orders', { ...o, deletedAt: Date.now(), deletedBy: actor() });
  await logEvent(id, 'eliminada', 'Orden eliminada');
  changed();
}

/* ===== Trabajos (líneas de servicio) e intervenciones por componente ===== */
function cleanWork(kind, d) {
  const severity = inList(SEVERITIES, d.severity) ? d.severity : '';
  const action = inList(ACTIONS, d.action) ? d.action : '';
  checkComponent(kind, d.componentId || null);
  if (d.componentId && !action) throw new Error('Elige la acción realizada sobre el componente.');
  if (d.componentId && action !== 'reemplazado' && action !== 'revisado' && !severity) throw new Error('Elige la gravedad del daño (o marca el componente como reemplazado).');
  return {
    type: inList(WORK_TYPES, d.type) ? d.type : 'otro', componentId: d.componentId || null, description: String(d.description || '').trim(),
    date: Number.isFinite(d.date) ? d.date : Date.now(), severity, action, replaced: action === 'reemplazado',
    workStatus: inList(WORK_STATUSES, d.workStatus) ? d.workStatus : action === 'pendiente' ? 'pendiente' : 'terminado', notes: String(d.notes || '').trim(),
  };
}
/* La intervención del diagrama que corresponde a un trabajo (1 a 1, por serviceId) */
async function syncComponentFor(o, svc) {
  const cur = C().components.find((c) => c.serviceId === svc.id);
  if (!svc.componentId) { if (cur) await hardDelete('components', cur.id); return; }
  await upsert('components', { ...(cur || { id: db.uid('mc_') }), orderId: o.id, serviceId: svc.id, componentId: svc.componentId, severity: svc.severity, action: svc.action, replaced: svc.replaced, date: svc.date, description: svc.description }, { audit: false });
}
export async function saveService(orderId, data) {
  await loadMaintenance();
  const o = requireOrder(orderId);
  const rec = { ...(data.id ? { id: data.id } : { id: db.uid('ms_') }), orderId, ...cleanWork(o.kind, data), oilChangeId: data.oilChangeId || null, tireId: data.tireId || null };
  const before = C().services.find((s) => s.id === rec.id);
  const out = await upsert('services', rec);
  await syncComponentFor(o, out);
  const comp = out.componentId ? ` · ${componentName(o.kind, out.componentId)}` : '';
  await logEvent(orderId, before ? 'trabajo' : 'trabajo', `${before ? 'Trabajo actualizado' : 'Trabajo agregado'}: ${(WORK_TYPES.find(([k]) => k === out.type) || [0, 'Trabajo'])[1]}${comp}${out.severity ? ` · ${severityLabel(out.severity)}` : ''}${out.action ? ` · ${actionLabel(out.action)}` : ''}`);
  changed();
  return out;
}
export async function deleteService(id) {
  await loadMaintenance();
  const s = C().services.find((x) => x.id === id);
  if (!s) return;
  const comp = C().components.find((c) => c.serviceId === id);
  if (comp) await hardDelete('components', comp.id);
  for (const p of photosOf(id)) await removePhoto(p.id, { silent: true });
  await hardDelete('services', id);
  await logEvent(s.orderId, 'trabajo', `Trabajo eliminado: ${(WORK_TYPES.find(([k]) => k === s.type) || [0, 'Trabajo'])[1]}`);
  changed();
}

/* ===== Fallas reportadas ===== */
export async function saveIssue(data) {
  await loadMaintenance();
  const eq = equipmentOf(data.equipmentType, data.equipmentType === 'vehicle' ? data.vehicleId : data.trailerId);
  const prev = data.id ? issueById(data.id) : null;
  if (!eq && !prev) throw new Error('Elige el equipo de la falla.');
  const kind = prev ? prev.kind : eq.kind;
  if (!kind) throw new Error('Clasifica el remolque (Chasis, Jaula o Tolva) antes de reportar una falla.');
  if (!Number.isFinite(data.date)) throw new Error('Escribe la fecha del reporte.');
  if (!inList(SEVERITIES, data.severity)) throw new Error('Elige el nivel de gravedad.');
  checkComponent(kind, data.componentId || null);
  if (!String(data.description || '').trim()) throw new Error('Describe la falla.');
  const rec = {
    id: prev ? prev.id : db.uid('mi_'), equipmentType: prev ? prev.equipmentType : data.equipmentType,
    vehicleId: prev ? prev.vehicleId : data.equipmentType === 'vehicle' ? data.vehicleId : null, trailerId: prev ? prev.trailerId : data.equipmentType === 'trailer' ? data.trailerId : null,
    kind, date: data.date, system: data.system || '', componentId: data.componentId || null, description: String(data.description).trim(), severity: data.severity,
    notes: String(data.notes || '').trim(), orderId: prev ? prev.orderId || null : null, snap: prev ? prev.snap : { label: eq.label, placas: eq.placas },
  };
  const out = await upsert('issues', rec);
  /* Si ya está relacionada con una orden, su intervención en el diagrama se mantiene al día */
  if (out.orderId) await syncIssueComponent(out);
  changed();
  return out;
}
async function syncIssueComponent(issue) {
  const cur = C().components.find((c) => c.issueId === issue.id);
  if (!issue.orderId || !issue.componentId) { if (cur) await hardDelete('components', cur.id); return; }
  await upsert('components', { ...(cur || { id: db.uid('mc_'), action: 'pendiente', replaced: false }), orderId: issue.orderId, issueId: issue.id, componentId: issue.componentId, severity: issue.severity, date: issue.date, description: issue.description }, { audit: false });
}
/* Relaciona una falla con una orden del mismo equipo (la falla no se duplica: queda una sola, con su orden) */
export async function linkIssue(issueId, orderId) {
  await loadMaintenance();
  const i = issueById(issueId), o = requireOrder(orderId);
  if (!i || i.deletedAt) throw new Error('La falla ya no existe.');
  if (equipmentKey(i.equipmentType, i.vehicleId || i.trailerId) !== keyOfOrder(o)) throw new Error('La falla es de otro equipo: no se puede relacionar con esta orden.');
  const out = await upsert('issues', { ...i, orderId });
  for (const p of photosOf(i.id)) await upsert('attachments', { ...p, orderId }, { audit: false });
  await syncIssueComponent(out);
  await logEvent(orderId, 'falla', `Falla relacionada: ${i.componentId ? componentName(i.kind, i.componentId) : 'sin componente'} · ${severityLabel(i.severity)}`);
  changed();
  return out;
}
export async function unlinkIssue(issueId, { silent = false } = {}) {
  await loadMaintenance();
  const i = issueById(issueId);
  if (!i || !i.orderId) return;
  const orderId = i.orderId;
  const out = await upsert('issues', { ...i, orderId: null });
  for (const p of photosOf(i.id)) await upsert('attachments', { ...p, orderId: null }, { audit: false });
  await syncIssueComponent(out);
  await logEvent(orderId, 'falla', 'Falla desvinculada de la orden (vuelve a fallas reportadas)');
  if (!silent) changed();
}
export async function deleteIssue(id) {
  await loadMaintenance();
  const i = issueById(id);
  if (!i) return;
  if (i.orderId) await unlinkIssue(id, { silent: true });
  for (const p of photosOf(id)) await removePhoto(p.id, { silent: true });
  await upsert('issues', { ...issueById(id), deletedAt: Date.now(), deletedBy: actor() });
  changed();
}

/* ===== Cambio de aceite (unidades) ===== */
export async function saveOil(orderId, data) {
  await loadMaintenance();
  const o = requireOrder(orderId);
  if (o.equipmentType !== 'vehicle') throw new Error('El cambio de aceite se registra en tractocamiones.');
  if (!Number.isFinite(data.date)) throw new Error('Escribe la fecha del cambio de aceite.');
  if (data.odometer == null || !Number.isFinite(data.odometer) || data.odometer < 0) throw new Error('Escribe el odómetro al momento del cambio (km, sin negativos).');
  if (data.liters != null && (!Number.isFinite(data.liters) || data.liters <= 0)) throw new Error('Los litros deben ser mayores a cero.');
  const prev = data.id ? C().oil.find((x) => x.id === data.id) : null;
  const rec = {
    id: prev ? prev.id : db.uid('mx_'), orderId, vehicleId: o.vehicleId, date: data.date, odometer: data.odometer,
    oilType: String(data.oilType || '').trim(), brand: String(data.brand || '').trim(), viscosity: String(data.viscosity || '').trim().toUpperCase(),
    liters: data.liters ?? null, oilFilter: !!data.oilFilter, otherFilters: String(data.otherFilters || '').trim(), notes: String(data.notes || '').trim(),
  };
  const out = await upsert('oil', rec);
  /* Línea de trabajo correspondiente (sin componente: no colorea el diagrama) */
  const svc = C().services.find((s) => s.oilChangeId === out.id);
  const desc = [`Odómetro ${kmText(out.odometer)}`, [out.brand, out.viscosity, out.oilType].filter(Boolean).join(' '), out.liters ? `${nf(out.liters, 1)} L` : '', out.oilFilter ? 'filtro de aceite reemplazado' : '', out.otherFilters ? `otros filtros: ${out.otherFilters}` : ''].filter(Boolean).join(' · ');
  await upsert('services', { ...(svc || { id: db.uid('ms_') }), orderId, type: 'aceite', componentId: null, description: desc, date: out.date, severity: '', action: 'reemplazado', replaced: false, workStatus: 'terminado', notes: out.notes, oilChangeId: out.id, tireId: null });
  await logEvent(orderId, 'aceite', `${prev ? 'Cambio de aceite actualizado' : 'Cambio de aceite registrado'} · ${kmText(out.odometer)}`);
  changed();
  return out;
}
export async function deleteOil(id) {
  await loadMaintenance();
  const x = C().oil.find((r) => r.id === id);
  if (!x) return;
  const svc = C().services.find((s) => s.oilChangeId === id);
  if (svc) await hardDelete('services', svc.id);
  for (const p of photosOf(id)) await removePhoto(p.id, { silent: true });
  await hardDelete('oil', id);
  await logEvent(x.orderId, 'aceite', 'Cambio de aceite eliminado');
  changed();
}

/* ===== Reemplazo de llantas ===== */
/* Cada posición marca la llanta de su lado (E2-IE → izquierda) y de su eje (direccional o tracción en el tractocamión) */
const tireComponent = (o, p) => tireComponentOf(o.kind, p.id.split('-')[1][0], p.axleKind);
export async function saveTires(orderId, data) {
  await loadMaintenance();
  const o = requireOrder(orderId);
  const layout = data.layout && TIRE_LAYOUTS[data.layout] ? data.layout : null;
  const positions = [...new Set(data.positions || [])];
  const err = validateTires({ quantity: data.quantity, positions, layout });
  if (Object.keys(err).length) throw Object.assign(new Error(Object.values(err)[0]), { fields: err });
  if (!Number.isFinite(data.date)) throw new Error('Escribe la fecha del reemplazo.');
  const prev = data.id ? C().tires.find((x) => x.id === data.id) : null;
  const rec = {
    id: prev ? prev.id : db.uid('mt_'), orderId, equipmentType: o.equipmentType, vehicleId: o.vehicleId, trailerId: o.trailerId, date: data.date,
    quantity: data.quantity, positions, layout, reason: inList(TIRE_REASONS, data.reason) ? data.reason : 'otro', reasonText: String(data.reasonText || '').trim(),
    brand: String(data.brand || '').trim(), size: String(data.size || '').trim(), notes: String(data.notes || '').trim(), odometer: o.odometer ?? null,
  };
  const out = await upsert('tires', rec);
  /* Diagrama: las llantas de las posiciones conocidas quedan como componente reemplazado (sin posiciones no se supone cuáles) */
  const pos = positionsOf(layout || '').filter((p) => positions.includes(p.id));
  const comps = [...new Set(pos.map((p) => tireComponent(o, p)))];
  for (const c of C().components.filter((x) => x.tireId === out.id && !comps.includes(x.componentId))) await hardDelete('components', c.id);
  for (const comp of comps) {
    const cur = C().components.find((x) => x.tireId === out.id && x.componentId === comp);
    await upsert('components', { ...(cur || { id: db.uid('mc_') }), orderId, tireId: out.id, componentId: comp, severity: '', action: 'reemplazado', replaced: true, date: out.date, description: `Reemplazo de llantas (${pos.filter((p) => tireComponent(o, p) === comp).length})` }, { audit: false });
  }
  const svc = C().services.find((s) => s.tireId === out.id);
  const desc = `${out.quantity} llanta${out.quantity === 1 ? '' : 's'}${positions.length ? ` · ${positions.length} posición${positions.length === 1 ? '' : 'es'} identificada${positions.length === 1 ? '' : 's'}` : ' · posiciones pendientes de especificar'}${out.brand ? ` · ${out.brand}` : ''}${out.size ? ` ${out.size}` : ''}`;
  await upsert('services', { ...(svc || { id: db.uid('ms_') }), orderId, type: 'llantas', componentId: null, description: desc, date: out.date, severity: '', action: 'reemplazado', replaced: false, workStatus: 'terminado', notes: out.notes, oilChangeId: null, tireId: out.id });
  await logEvent(orderId, 'llantas', `${prev ? 'Reemplazo de llantas actualizado' : 'Reemplazo de llantas registrado'}: ${desc}`);
  changed();
  return out;
}
export async function deleteTires(id) {
  await loadMaintenance();
  const t = C().tires.find((x) => x.id === id);
  if (!t) return;
  for (const c of C().components.filter((x) => x.tireId === id)) await hardDelete('components', c.id);
  const svc = C().services.find((s) => s.tireId === id);
  if (svc) await hardDelete('services', svc.id);
  for (const p of photosOf(id)) await removePhoto(p.id, { silent: true });
  await hardDelete('tires', id);
  await logEvent(t.orderId, 'llantas', 'Reemplazo de llantas eliminado');
  changed();
}

/* ===== Fotografías (comprimidas antes de llegar aquí; viven en attachments, no en localStorage) ===== */
export async function addPhoto(parentType, parentId, orderId, blob) {
  await loadMaintenance();
  const mediaId = await media.saveBlob(blob, { owner: 'mt:' + parentId, kind: 'photo', name: `evidencia-${parentType}.jpg` });
  const rec = await upsert('attachments', { id: db.uid('ma_'), parentType, parentId, orderId: orderId || null, mediaId }, { audit: false });
  if (orderId) await logEvent(orderId, 'foto', 'Fotografía agregada');
  changed();
  return rec;
}
export async function replacePhoto(attId, blob) {
  await loadMaintenance();
  const a = C().attachments.find((x) => x.id === attId);
  if (!a) throw new Error('La fotografía ya no existe.');
  const old = a.mediaId;
  const mediaId = await media.saveBlob(blob, { owner: 'mt:' + a.parentId, kind: 'photo', name: `evidencia-${a.parentType}.jpg` });
  const out = await upsert('attachments', { ...a, mediaId }, { audit: false });
  await media.remove(old);
  if (a.orderId) await logEvent(a.orderId, 'foto', 'Fotografía reemplazada');
  changed();
  return out;
}
export async function removePhoto(attId, { silent = false } = {}) {
  const a = C().attachments.find((x) => x.id === attId);
  if (!a) return;
  await media.remove(a.mediaId);
  await hardDelete('attachments', attId);
  if (!silent) { if (a.orderId) await logEvent(a.orderId, 'foto', 'Fotografía eliminada'); changed(); }
}

/* ===== Configuración por equipo (intervalos de aceite y ejes) ===== */
export async function saveProfile(key, patch) {
  await loadMaintenance();
  const cur = profileOf(key);
  if (patch.oilKm != null && (!Number.isFinite(patch.oilKm) || patch.oilKm < 0)) throw new Error('El intervalo en km no puede ser negativo.');
  if (patch.oilDays != null && (!Number.isFinite(patch.oilDays) || patch.oilDays < 0)) throw new Error('El intervalo en días no puede ser negativo.');
  if (patch.tireLayout && !TIRE_LAYOUTS[patch.tireLayout]) throw new Error('Configuración de ejes no válida.');
  const out = await upsert('profiles', { ...cur, ...patch, id: key }, { audit: false });
  changed();
  return out;
}

/* ===== Componentes agregados por el usuario ===== */
export async function addPart(kind, system, name) {
  await loadMaintenance();
  const n = String(name || '').trim().replace(/\s+/g, ' ');
  if (!n) throw new Error('Escribe el nombre del componente.');
  if (componentsFor(kind).some((c) => c.name.toLowerCase() === n.toLowerCase())) throw new Error('Ese componente ya existe en la lista.');
  const out = await upsert('parts', { id: db.uid('x_'), kind, system: system || 'otros', name: n }, { audit: false });
  changed();
  return out;
}

/* ===== Tablero ===== */
export function dashboard(now = Date.now()) {
  const all = orders(), open = all.filter(isOpenOrder);
  const inShopV = new Map(), inShopT = new Map();
  for (const o of open) if (o.outOfService !== false) (o.equipmentType === 'vehicle' ? inShopV : inShopT).set(keyOfOrder(o), o);
  const oil = vehicles().map((v) => ({ eq: v, st: oilStatusOf(v.id) }));
  return {
    open, inShopVehicles: [...inShopV.values()], inShopTrailers: [...inShopT.values()],
    pendingWork: C().services.filter((s) => s.workStatus !== 'terminado' && open.some((o) => o.id === s.orderId)).length,
    recent: all.filter((o) => o.status === 'finalizado').sort((a, b) => (b.outAt || 0) - (a.outAt || 0)).slice(0, 8),
    oil, oilAlerts: oil.filter((x) => x.st.state === 'proximo' || x.st.state === 'vencido').sort((a, b) => (a.st.state === b.st.state ? (a.st.remainingKm ?? 0) - (b.st.remainingKm ?? 0) : a.st.state === 'vencido' ? -1 : 1)),
    openIssues: openIssues(), recentTires: C().tires.filter((t) => orderById(t.orderId) && !orderById(t.orderId).deletedAt).sort((a, b) => b.date - a.date).slice(0, 6),
    now,
  };
}
export { isOpenStatus };
