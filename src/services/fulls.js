/*
 * Control de llenos — almacenamiento (stores fullContainerLoads, fullContainerDocuments y fullContainerEvents).
 * No crea terminales, patios, unidades, operadores ni remolques: guarda sus IDs y resuelve los nombres al mostrar.
 * Carga: { id, containerNumber, weightKg, reference, notes, locationType:'port'|'offport', terminalId, yardId, scheduledDate,
 *   scheduledTime, vehicleId, operatorId, trailerId, status, tripId, logisticsOperationId, dossierOrder[], dossierSkip[],
 *   createdAt, createdBy, updatedAt, updatedBy, loadedAt, deletedAt }
 * Documento: { id, loadId, docType:'pedimento'|'doda'|'cita'|'dec'|'otro', label, required, manual, order, name, mimeType, kind,
 *   size, pages, w, h, storageKey, fileStatus:'none'|'ok'|'error', attachedAt, createdAt, createdBy, updatedAt, updatedBy }
 *   Cada archivo se guarda por separado en el store binario «attachments» (owner 'fcl:<loadId>'), nunca en localStorage.
 *   PDF tal cual; JPG y PNG normalizados a JPEG (orientación y proporción correctas) con processFile de tripAttachments.
 * Evento: { id, loadId, containerNumber, eventType, docType, details, previousStatus, newStatus, date, time, createdAt, createdBy }
 * Un cambio avisa a la app («fulls:change») para que la pizarra y el detalle se actualicen al momento.
 */
import * as db from './db.js';
import * as media from './media.js';
import { listAll } from './catalogs.js';
import { vehicles as fleetUnits } from './fuel.js';
import { operatorById, operatorList, allTrips } from './operators.js';
import { processFile, kindOf, MAX_FILE } from './tripAttachments.js';
import {
  checkLoad, isOpenLoad, isStatus, loadStatus, reconcileDocs, defaultRequired, docSummary, sortDocs, hasFile, docLabel, docType, isTime,
  cleanContainer, dayStr, hmStr, locationLabel, weightText,
} from '../domain/fulls/fulls.js';
import { isDate, fmtDate } from '../domain/operators/balance.js';

export { ACCEPT, MAX_FILE } from './tripAttachments.js';

let loads = null, docs = null, events = null;
export async function loadFulls(force = false) {
  if (!loads || force) { loads = await db.all(db.S.fullContainerLoads); docs = await db.all(db.S.fullContainerDocuments); events = await db.all(db.S.fullContainerEvents); }
  return loads;
}
function actor() { try { const s = JSON.parse(sessionStorage.getItem('pcs-session') || 'null'); return (s && s.user) || 'local'; } catch (e) { return 'local'; } }

/* ===== Aviso de cambios (pantallas abiertas y otras pestañas) ===== */
const EVT = 'fulls:change';
let bc = null;
try { bc = new BroadcastChannel('pcs-fulls'); bc.onmessage = async () => { await loadFulls(true); window.dispatchEvent(new CustomEvent(EVT)); }; } catch (e) { /* sin BroadcastChannel */ }
function changed() { window.dispatchEvent(new CustomEvent(EVT)); try { if (bc) bc.postMessage(Date.now()); } catch (e) { /* */ } }
export function onFullsChange(fn) { window.addEventListener(EVT, fn); return () => window.removeEventListener(EVT, fn); }

/* ===== Consultas ===== */
export const all = () => (loads || []).filter((r) => !r.deletedAt);
export const byId = (id) => all().find((r) => r.id === id) || null;
export const openList = () => all().filter(isOpenLoad);
export const docsOf = (loadId) => sortDocs((docs || []).filter((d) => d.loadId === loadId));
export const docById = (id) => (docs || []).find((d) => d.id === id) || null;
export const eventsOf = (loadId) => (events || []).filter((e) => e.loadId === loadId).sort((a, b) => b.createdAt - a.createdAt);
export const summaryOf = (r) => docSummary(docsOf(r.id));
export const duplicateOf = (containerNumber, selfId = null) => { const c = cleanContainer(containerNumber); return c ? openList().find((r) => r.id !== selfId && r.containerNumber === c) || null : null; };
export const terminalById = (id) => (id ? listAll('terminals').find((t) => t.id === id) || null : null);
export const loadingYardById = (id) => (id ? listAll('loadingYards').find((y) => y.id === id) || null : null);
export const unitById = (id) => (id ? fleetUnits().find((u) => u.id === id) || null : null);
export const trailerById = (id) => (id ? listAll('trailers').find((t) => t.id === id) || null : null);

/* Datos visibles de la carga, con los nombres actuales del catálogo. get resuelve cada ID (ver viewer) */
function viewWith(r, get) {
  const u = get.unit(r.vehicleId), t = get.trailer(r.trailerId), o = get.operator(r.operatorId);
  const term = r.locationType === 'port' ? get.terminal(r.terminalId) : null, yard = r.locationType === 'offport' ? get.yard(r.yardId) : null;
  const placeRec = term || yard;
  return {
    unit: u ? u.label : '', placas: u ? u.placas : '', unitRec: u, trailer: t ? t.placas : '', trailerType: t ? t.type || '' : '', trailerRec: t,
    operator: o ? o.name : '', operatorRec: o, place: placeRec ? placeRec.name : '', placeRec, placeAddress: placeRec ? placeRec.address || '' : '',
    location: locationLabel(r.locationType), docs: docSummary(get.docs(r.id)), weight: weightText(r.weightKg), trip: get.trip(r.tripId),
  };
}
const DIRECT = {
  unit: unitById, trailer: trailerById, operator: (id) => (id ? operatorById(id) : null), terminal: terminalById, yard: loadingYardById,
  docs: (id) => docsOf(id), trip: (id) => (id ? allTrips().find((x) => x.id === id) || null : null),
};
export const view = (r) => viewWith(r, DIRECT);
/*
 * Lo mismo para muchas cargas a la vez (pizarra, listas y filtros de un mismo dibujo): los catálogos y los documentos se
 * indexan una sola vez y cada carga se resuelve una sola vez. Se crea uno nuevo en cada dibujo para no mostrar datos viejos.
 * viewer().docsOf(loadId) da los documentos ya agrupados (para summary).
 */
export function viewer() {
  const idx = (list) => { const m = new Map(list.map((x) => [x.id, x])); return (id) => (id ? m.get(id) || null : null); };
  const byLoad = new Map();
  for (const d of docs || []) { const l = byLoad.get(d.loadId); if (l) l.push(d); else byLoad.set(d.loadId, [d]); }
  for (const [k, l] of byLoad) byLoad.set(k, sortDocs(l));
  const get = {
    unit: idx(fleetUnits()), trailer: idx(listAll('trailers')), operator: idx(operatorList()), terminal: idx(listAll('terminals')), yard: idx(listAll('loadingYards')),
    docs: (id) => byLoad.get(id) || [], trip: idx(allTrips()),
  };
  const memo = new Map();
  const fn = (r) => { let v = memo.get(r.id); if (!v) memo.set(r.id, (v = viewWith(r, get))); return v; };
  fn.docsOf = get.docs;
  return fn;
}

/* ===== Escritura con historial ===== */
async function addEvent(load, eventType, { details = '', docType: dt = '', previousStatus = null } = {}) {
  const now = new Date(), e = {
    id: db.uid('fe_'), loadId: load.id, containerNumber: load.containerNumber, eventType, docType: dt, details, previousStatus, newStatus: load.status,
    date: dayStr(now), time: hmStr(now), createdAt: now.getTime(), createdBy: actor(),
  };
  await db.put(db.S.fullContainerEvents, e);
  events.push(e);
  return e;
}
/* Primero la base y después el caché: si la base rechaza la escritura (modo consulta, sin espacio) la pantalla no muestra un cambio que no se guardó */
async function writeLoad(rec) {
  await db.put(db.S.fullContainerLoads, rec);
  const i = loads.findIndex((x) => x.id === rec.id);
  if (i >= 0) loads[i] = rec; else loads.push(rec);
  return rec;
}
async function writeDoc(rec) {
  await db.put(db.S.fullContainerDocuments, rec);
  const i = docs.findIndex((x) => x.id === rec.id);
  if (i >= 0) docs[i] = rec; else docs.push(rec);
  return rec;
}
async function deleteDoc(id) {
  const d = docById(id); if (!d) return;
  await db.del(db.S.fullContainerDocuments, id);
  docs = docs.filter((x) => x.id !== id);
  if (d.storageKey) { try { await media.remove(d.storageKey); } catch (e) { /* */ } }
}
const need = (id) => { const r = byId(id); if (!r) throw new Error('La carga ya no existe.'); return r; };
const newDoc = (loadId, docType, required, extra = {}) => {
  const now = Date.now(), who = actor();
  return { id: db.uid('fd_'), loadId, docType, label: '', required: !!required, manual: false, order: 0, name: '', mimeType: '', kind: null, size: 0, pages: 0, w: null, h: null, storageKey: null, fileStatus: 'none', attachedAt: null, createdAt: now, createdBy: who, updatedAt: now, updatedBy: who, ...extra };
};
/* Documentos de la carga según su ubicación: crea los que faltan y ajusta el requerido (sin perder archivos ni decisiones manuales) */
async function reconcile(load) {
  const plan = reconcileDocs(docsOf(load.id), load.locationType);
  for (const c of plan.create) await writeDoc(newDoc(load.id, c.docType, c.required));
  for (const u of plan.update) { const d = docById(u.id); if (d) await writeDoc({ ...d, ...u.patch, updatedAt: Date.now(), updatedBy: actor() }); }
  for (const id of plan.remove) await deleteDoc(id);
  return plan;
}
/*
 * Validación de los IDs del transporte y del lugar contra los catálogos. Al editar (prev) solo se revisan los que cambian:
 * una carga cerrada cuya terminal o patio se borró del catálogo después se puede seguir corrigiendo.
 */
function checkTransport(load, prev = null) {
  const changedRef = (k) => !prev || prev[k] !== load[k] || (k !== 'vehicleId' && k !== 'operatorId' && k !== 'trailerId' && prev.locationType !== load.locationType);
  if (load.vehicleId && changedRef('vehicleId') && !unitById(load.vehicleId)) return 'La unidad ya no está en el catálogo.';
  if (load.operatorId && changedRef('operatorId') && !operatorById(load.operatorId)) return 'El operador ya no está en el catálogo.';
  if (load.trailerId && changedRef('trailerId') && !trailerById(load.trailerId)) return 'El remolque ya no está en el catálogo.';
  if (load.locationType === 'port' && changedRef('terminalId') && !terminalById(load.terminalId)) return 'La terminal ya no está en el catálogo.';
  if (load.locationType === 'offport' && changedRef('yardId') && !loadingYardById(load.yardId)) return 'El patio o instalación ya no está en el catálogo.';
  return '';
}
const whenText = (r) => `${fmtDate(r.scheduledDate)} ${r.scheduledTime}`;

/* Programar una carga. Devuelve { load } o { errors }. La advertencia de duplicado la hace la pantalla antes (duplicateOf). */
export async function create(input) {
  await loadFulls();
  const c = checkLoad(input, { existing: all() });
  if (c.errors) return c;
  const bad = checkTransport(c.load); if (bad) return { errors: { transport: bad } };
  const now = Date.now(), who = actor();
  const load = { ...c.load, id: db.uid('fl_'), status: 'scheduled', tripId: input.tripId || null, logisticsOperationId: input.logisticsOperationId || null, dossierOrder: [], dossierSkip: [], createdAt: now, createdBy: who, updatedAt: now, updatedBy: who, loadedAt: null, deletedAt: null };
  await writeLoad(load);
  await reconcile(load);
  const v = view(load);
  await addEvent(load, 'created', { details: `${whenText(load)} · ${v.location}${v.place ? ' · ' + v.place : ''}` });
  if (load.vehicleId) await addEvent(load, 'vehicle', { details: v.unit });
  if (load.operatorId) await addEvent(load, 'operator', { details: v.operator });
  if (load.trailerId) await addEvent(load, 'trailer', { details: v.trailer });
  changed();
  return { load };
}

/* Editar los datos de la carga (todo se vuelve a validar). Registra un evento por cada cambio relevante. */
export async function update(id, input) {
  await loadFulls();
  const prev = need(id);
  const c = checkLoad({ ...prev, ...input }, { existing: all(), selfId: id });
  if (c.errors) return c;
  const bad = checkTransport(c.load, prev); if (bad) return { errors: { transport: bad } };
  const next = { ...prev, ...c.load, updatedAt: Date.now(), updatedBy: actor() };
  await writeLoad(next);
  const nv = view(next), ev = [];
  if (prev.locationType !== next.locationType || prev.terminalId !== next.terminalId || prev.yardId !== next.yardId) {
    await reconcile(next);
    ev.push(['location', `${nv.location}${nv.place ? ' · ' + nv.place : ''}`]);
  }
  if (prev.scheduledDate !== next.scheduledDate || prev.scheduledTime !== next.scheduledTime) ev.push(['reschedule', `${whenText(prev)} → ${whenText(next)}`]);
  if (prev.vehicleId !== next.vehicleId) ev.push(['vehicle', nv.unit || 'Sin unidad']);
  if (prev.operatorId !== next.operatorId) ev.push(['operator', nv.operator || 'Sin operador']);
  if (prev.trailerId !== next.trailerId) ev.push(['trailer', nv.trailer || 'Sin remolque']);
  const changedFields = [];
  if (prev.containerNumber !== next.containerNumber) changedFields.push(`Contenedor ${prev.containerNumber} → ${next.containerNumber}`);
  if (prev.weightKg !== next.weightKg) changedFields.push(`Peso ${weightText(prev.weightKg)} → ${weightText(next.weightKg)}`);
  if ((prev.reference || '') !== (next.reference || '')) changedFields.push(`Referencia: ${next.reference || '(sin referencia)'}`);
  if (changedFields.length) ev.push(['edit', changedFields.join(' · ')]);
  if ((prev.notes || '') !== (next.notes || '')) ev.push(['notes', next.notes ? 'Observaciones actualizadas' : 'Observaciones borradas']);
  for (const [t, d] of ev) await addEvent(next, t, { details: d });
  changed();
  return { load: next };
}

/* Reprogramar la cita (conserva el registro de la fecha anterior en el historial) */
export async function reschedule(id, { date, time, reason = '' }) {
  await loadFulls();
  const prev = need(id);
  if (!isDate(date)) throw new Error('La fecha programada no es válida.');
  if (!isTime(time)) throw new Error('La hora programada no es válida.');
  if (prev.scheduledDate === date && prev.scheduledTime === time) return prev;
  const next = { ...prev, scheduledDate: date, scheduledTime: time, updatedAt: Date.now(), updatedBy: actor() };
  await writeLoad(next);
  await addEvent(next, 'reschedule', { details: `${whenText(prev)} → ${whenText(next)}${reason ? ' · ' + reason : ''}` });
  changed();
  return next;
}

/* Asignar o cambiar el transporte (los tres son opcionales) */
export async function assign(id, { vehicleId = null, operatorId = null, trailerId = null }) {
  await loadFulls();
  const prev = need(id);
  const next = { ...prev, vehicleId: vehicleId || null, operatorId: operatorId || null, trailerId: trailerId || null, updatedAt: Date.now(), updatedBy: actor() };
  const bad = checkTransport(next, prev); if (bad) throw new Error(bad);
  await writeLoad(next);
  const v = view(next);
  if (prev.vehicleId !== next.vehicleId) await addEvent(next, 'vehicle', { details: v.unit || 'Sin unidad' });
  if (prev.operatorId !== next.operatorId) await addEvent(next, 'operator', { details: v.operator || 'Sin operador' });
  if (prev.trailerId !== next.trailerId) await addEvent(next, 'trailer', { details: v.trailer || 'Sin remolque' });
  changed();
  return next;
}

/* Estado operativo (siempre lo decide el usuario) */
export async function setStatus(id, status, note = '') {
  await loadFulls();
  const prev = need(id);
  if (!isStatus(status)) throw new Error('Estado no válido.');
  if (prev.status === status) return prev;
  const now = Date.now();
  const next = { ...prev, status, loadedAt: status === 'loaded' ? now : prev.loadedAt, updatedAt: now, updatedBy: actor() };
  await writeLoad(next);
  const type = status === 'loaded' ? 'loaded' : status === 'cancelled' ? 'cancelled' : !isOpenLoad(prev) ? 'reopened' : 'status';
  await addEvent(next, type, { previousStatus: prev.status, details: `${loadStatus(prev.status).label} → ${loadStatus(status).label}${note ? ' · ' + note : ''}` });
  changed();
  return next;
}

/* Vincular después con una operación de Logística o un viaje de Operadores (no crea viajes ni cobros) */
export async function link(id, { tripId = null, logisticsOperationId = null }) {
  await loadFulls();
  const prev = need(id);
  const next = { ...prev, tripId: tripId || null, logisticsOperationId: logisticsOperationId || null, updatedAt: Date.now(), updatedBy: actor() };
  await writeLoad(next);
  await addEvent(next, 'link', { details: [tripId ? 'Viaje' : '', logisticsOperationId ? 'Operación de Logística' : ''].filter(Boolean).join(' · ') || 'Vínculo quitado' });
  changed();
  return next;
}

/* Eliminar la carga con sus documentos, archivos e historial (solo cargas canceladas) */
export async function remove(id) {
  await loadFulls();
  const r = need(id);
  if (r.status !== 'cancelled') throw new Error('Solo se eliminan cargas canceladas. Cancélala primero.');
  for (const d of docsOf(id)) await db.del(db.S.fullContainerDocuments, d.id);
  docs = docs.filter((d) => d.loadId !== id);
  for (const e of eventsOf(id)) await db.del(db.S.fullContainerEvents, e.id);
  events = events.filter((e) => e.loadId !== id);
  await db.del(db.S.fullContainerLoads, id);
  loads = loads.filter((x) => x.id !== id);
  /* Todos los archivos de la carga, también los que ningún documento referencia (p. ej. un guardado que se interrumpió) */
  try { await media.removeOwned('fcl:' + id); } catch (e) { /* */ }
  changed();
}

/* ===== Documentos (uno por uno) ===== */
/*
 * Adjunta un archivo: a un documento existente (lo reemplaza) o como documento nuevo del tipo indicado ('otro' = adicional).
 * Un archivo nuevo que no se puede procesar se conserva con fileStatus 'error' para reintentar o eliminarlo.
 * Al reemplazar, un archivo que no se puede procesar no sustituye al anterior: se lanza un error y el documento queda igual.
 * Devuelve el documento guardado; lanza un error si el tipo no se admite, si no hay espacio o si el reemplazo falla.
 */
export async function attachFile(loadId, file, { docId = null, docType: type = 'otro', label = '' } = {}) {
  await loadFulls();
  const load = need(loadId), kind = kindOf(file);
  if (!kind) throw new Error('Solo se admiten archivos PDF, JPG y PNG.');
  if (file.size > MAX_FILE) throw new Error(`El archivo es demasiado grande (máximo ${Math.round(MAX_FILE / 1048576)} MB).`);
  const now = Date.now(), who = actor(), name = file.name || `${docType(type).label}.${kind === 'pdf' ? 'pdf' : 'jpg'}`;
  let doc = docId ? docById(docId) : null;
  if (docId && !doc) throw new Error('El documento ya no existe.');
  const replacing = !!(doc && hasFile(doc)), oldKey = doc ? doc.storageKey : null;
  if (!doc) {
    const extras = docsOf(loadId).filter((d) => d.docType === 'otro');
    doc = newDoc(loadId, type, defaultRequired(type, load.locationType), { label: type === 'otro' ? String(label || '').trim() : '', order: extras.reduce((m, d) => Math.max(m, d.order || 0), 0) + 1 });
  }
  let out;
  try {
    const p = await processFile(file, name, kind);
    const storageKey = await media.saveBlob(p.blob, { owner: 'fcl:' + loadId, kind: 'fcl-doc', name, type: p.type });
    out = { ...doc, name, mimeType: p.type, kind, size: p.blob.size, pages: p.pages, w: p.w || null, h: p.h || null, storageKey, fileStatus: 'ok', attachedAt: now, updatedAt: now, updatedBy: who };
  } catch (e) {
    console.warn('documento', name, e);
    if (replacing) throw new Error('No se pudo procesar el archivo nuevo; se conserva el anterior.');
    let storageKey = null;
    try { storageKey = await media.saveBlob(file, { owner: 'fcl:' + loadId, kind: 'fcl-doc', name }); } catch (e2) { /* sin espacio */ }
    if (!storageKey) throw new Error('No se pudo guardar en este dispositivo (sin espacio disponible).');
    out = { ...doc, name, mimeType: file.type || '', kind, size: file.size, pages: 0, w: null, h: null, storageKey, fileStatus: 'error', attachedAt: now, updatedAt: now, updatedBy: who };
  }
  await writeDoc(out);
  if (oldKey && oldKey !== out.storageKey) { try { await media.remove(oldKey); } catch (e) { /* */ } }
  await addEvent(load, replacing ? 'doc_replaced' : 'doc_added', { docType: out.docType, details: out.docType === 'otro' ? name : `${docLabel(out)} · ${name}` });
  await touch(load);
  changed();
  return out;
}
/* Reintenta procesar un archivo que quedó con error */
export async function retryDoc(docId) {
  const d = docById(docId); if (!d || d.fileStatus !== 'error') return d;
  const raw = d.storageKey ? await media.getBlob(d.storageKey) : null;
  if (!raw) throw new Error('El archivo ya no está en este dispositivo.');
  const p = await processFile(raw, d.name, d.kind);
  const storageKey = await media.saveBlob(p.blob, { owner: 'fcl:' + d.loadId, kind: 'fcl-doc', name: d.name, type: p.type });
  if (d.storageKey !== storageKey) await media.remove(d.storageKey);
  const out = await writeDoc({ ...d, storageKey, mimeType: p.type, size: p.blob.size, pages: p.pages, w: p.w || null, h: p.h || null, fileStatus: 'ok', updatedAt: Date.now(), updatedBy: actor() });
  changed();
  return out;
}
/*
 * Quita el archivo: un documento fijo (pedimento, DODA, cita, DEC) queda pendiente; un adicional desaparece.
 * Después se vuelve a aplicar la regla de ubicación: un DEC que se conservaba fuera de puerto solo por su archivo se quita.
 */
export async function removeFile(docId) {
  await loadFulls();
  const d = docById(docId); if (!d) return;
  const load = need(d.loadId), lbl = docLabel(d);
  if (d.docType === 'otro') await deleteDoc(docId);
  else {
    await writeDoc({ ...d, name: '', mimeType: '', kind: null, size: 0, pages: 0, w: null, h: null, storageKey: null, fileStatus: 'none', attachedAt: null, updatedAt: Date.now(), updatedBy: actor() });
    if (d.storageKey) { try { await media.remove(d.storageKey); } catch (e) { /* */ } }
    await reconcile(load);
  }
  await addEvent(load, 'doc_removed', { docType: d.docType, details: `${lbl}${d.name ? ' · ' + d.name : ''}` });
  await touch(load);
  changed();
}
/* Requerido / No requerido, decidido por el usuario (la regla de ubicación ya no lo cambia) */
export async function setRequired(docId, required) {
  await loadFulls();
  const d = docById(docId); if (!d) return null;
  if (!!d.required === !!required) return d;
  const load = need(d.loadId);
  const out = await writeDoc({ ...d, required: !!required, manual: true, updatedAt: Date.now(), updatedBy: actor() });
  await addEvent(load, required ? 'doc_required' : 'doc_optional', { docType: d.docType, details: docLabel(d) });
  await touch(load);
  changed();
  return out;
}
export async function renameDoc(docId, label) {
  const d = docById(docId), l = String(label || '').trim().slice(0, 80);
  if (!d || d.docType !== 'otro' || !l || l === d.label) return d;
  const out = await writeDoc({ ...d, label: l, updatedAt: Date.now(), updatedBy: actor() });
  changed();
  return out;
}
/* Orden entre los documentos adicionales (delta −1 sube, +1 baja) */
export async function moveDoc(docId, delta) {
  const d = docById(docId); if (!d || d.docType !== 'otro') return;
  const list = docsOf(d.loadId).filter((x) => x.docType === 'otro'), i = list.findIndex((x) => x.id === docId), j = i + delta;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  for (let k = 0; k < list.length; k++) if (list[k].order !== k + 1) await writeDoc({ ...list[k], order: k + 1, updatedAt: Date.now() });
  changed();
}
/* Orden y selección del expediente (preferencia de la carga; no es un evento) */
export async function setDossier(loadId, { order, skip }) {
  const r = need(loadId);
  await writeLoad({ ...r, dossierOrder: Array.isArray(order) ? order : r.dossierOrder, dossierSkip: Array.isArray(skip) ? skip : r.dossierSkip, updatedAt: Date.now(), updatedBy: actor() });
  changed();
}
async function touch(load) { const r = byId(load.id); if (r) await writeLoad({ ...r, updatedAt: Date.now(), updatedBy: actor() }); }

/* Documentos cuyo archivo no está en este dispositivo (p. ej. importados con un respaldo «Solo datos») */
export async function missingFiles(loadId) {
  const out = new Set();
  for (const d of docsOf(loadId)) if (hasFile(d) && !(await db.has(db.S.attachments, d.storageKey))) out.add(d.id);
  return out;
}
export const blobOf = (d) => (d && d.storageKey ? media.getBlob(d.storageKey) : Promise.resolve(null));

/* Para proteger los catálogos: ¿el registro está en una carga abierta? */
export async function inOpenLoad(field, id) { await loadFulls(); return openList().some((r) => r[field] === id); }
export const terminalInUse = (id) => inOpenLoad('terminalId', id);
export const loadingYardInUse = (id) => inOpenLoad('yardId', id);
