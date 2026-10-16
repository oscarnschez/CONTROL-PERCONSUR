/*
 * Órdenes de Servicio — reglas puras (sin base de datos ni pantalla). Ver ORDENES.md.
 * La orden es el expediente maestro del viaje; los datos que ya tienen dueño (Control de llenos, Logística, viaje del
 * operador, Control de vacíos) se leen de su fuente y aquí solo se combinan:
 *   deriveState(ctx)    estados por separado (orden, logístico, documental, entrega, devolución, financiero), el estado
 *                       global, el siguiente paso real y el avance por etapas
 *   dispatchCheck(ctx)  bloqueos obligatorios y advertencias autorizables antes de despachar
 *   closeCheck(ctx)     condiciones del cierre operativo (Puerto con devolución del vacío, Puerto sin devolución, Campo)
 */
import { DOC_TYPES, docSummary, docState, hasFile, sortDocs, defaultRequired } from '../fulls/fulls.js';
import { cleanContainer, isContainer } from '../empties/empties.js';
import { computeTaxes, defaultTaxFlags } from '../operators/taxes.js';
import { commissionFor, isDate } from '../operators/balance.js';
import { statusOf as lgStatusOf, isWorking } from '../../config/logistics.js';

/* ===== Folio ===== */
export const FOLIO_RE = /^OS-(\d{4})-(\d{6,})$/;
export const formatFolio = (year, n) => `OS-${year}-${String(n).padStart(6, '0')}`;
export const folioNumber = (folio, year) => { const m = FOLIO_RE.exec(String(folio || '')); return m && (!year || +m[1] === +year) ? +m[2] : 0; };
/* Siguiente número del año: nunca menor que el contador ni que el folio más alto ya guardado (respaldos, otro equipo) */
export function nextFolioNumber(counter, folios, year) {
  const top = (folios || []).reduce((m, f) => Math.max(m, folioNumber(f, year)), 0);
  return Math.max(Number(counter) || 0, top) + 1;
}

/* ===== Divisiones y tipos de operación ===== */
export const DIVISIONS = [['puerto', 'División Puerto', 'Puerto'], ['campo', 'División Campo', 'Campo']];
export const divisionLabel = (k, short = false) => { const d = DIVISIONS.find(([x]) => x === k); return d ? d[short ? 2 : 1] : ''; };
/*
 * fullLoad    la operación recoge un contenedor lleno: se vincula con Control de llenos (cita, documentos portuarios)
 * emptyReturn al vaciarse, el contenedor se devuelve a un patio (Control de vacíos)
 * container   pide número de contenedor marítimo
 * trailer     el despacho normal pide remolque
 * modal       modalidad de la nota de entrega (config/reference.js MODALES)
 */
export const OP_TYPES = [
  { key: 'full_pickup', division: 'puerto', label: 'Recolección de contenedor lleno', hint: 'Importación: se recoge en terminal o patio y se devuelve vacío', fullLoad: true, emptyReturn: true, container: true, trailer: true, modal: 'imp' },
  { key: 'export', division: 'puerto', label: 'Exportación / entrega en puerto', hint: 'El contenedor se lleva al puerto; no hay devolución de vacío', fullLoad: false, emptyReturn: false, container: true, trailer: true, modal: 'exp' },
  { key: 'empty_move', division: 'puerto', label: 'Movimiento de contenedor vacío', hint: 'Traslado de un vacío entre patios o hacia un cliente', fullLoad: false, emptyReturn: false, container: true, trailer: true, modal: 'vac' },
  { key: 'transfer', division: 'puerto', label: 'Transferencia / otro movimiento', hint: 'Movimiento local o especial; documentos según se configure', fullLoad: false, emptyReturn: false, container: false, trailer: true, modal: 'tra' },
  { key: 'campo_load', division: 'campo', label: 'Carga de campo', hint: 'Jaula o tolva; sin documentación portuaria', fullLoad: false, emptyReturn: false, container: false, trailer: true, modal: '' },
];
export const opTypeOf = (k, division) => OP_TYPES.find((t) => t.key === k) || OP_TYPES.find((t) => t.division === (division || 'puerto'));
export const opTypesFor = (division) => OP_TYPES.filter((t) => t.division === division);
export const defaultOpType = (division) => opTypesFor(division)[0].key;
export const needsEmptyReturn = (o) => !!o && o.division === 'puerto' && opTypeOf(o.opType, o.division).emptyReturn && !o.noEmptyReturn;

/* ===== Documentación =====
 * Con carga de Control de llenos los documentos portuarios son los de la carga (misma regla: DEC solo dentro de puerto).
 * Sin carga (otros movimientos de Puerto) la orden tiene los mismos espacios, no requeridos salvo que el usuario lo marque.
 * Campo no tiene documentación portuaria: solo documentos adicionales. «entrega» y «devolucion» son evidencias, no cuentan. */
export const ORDER_SLOT_TYPES = ['pedimento', 'doda', 'dec', 'cita'];
export const EVIDENCE_TYPES = { entrega: 'Evidencia de entrega', devolucion: 'Evidencia de devolución del vacío' };
export const DOSSIER_ORDER = { pedimento: 1, doda: 2, dec: 3, cita: 4, otro: 5 };
export const isEvidence = (d) => !!EVIDENCE_TYPES[d && d.docType];
export const docKindLabel = (d) => (isEvidence(d) ? EVIDENCE_TYPES[d.docType] : d && d.docType === 'otro' ? (d.label || d.name || 'Documento adicional') : (DOC_TYPES.find((t) => t.key === d.docType) || { label: 'Documento' }).label);
/* Espacios que debe tener una orden sin carga vinculada: [docType, required] */
export function orderSlots(o) {
  if (!o || o.division !== 'puerto' || opTypeOf(o.opType, o.division).fullLoad) return [];
  return ORDER_SLOT_TYPES.map((t) => [t, false]);
}
/* Estado documental: required/attached de las reglas de Control de llenos + verificación de la orden */
export function docStatus(docs, checks = {}, { applies = true } = {}) {
  const list = (docs || []).filter((d) => !isEvidence(d));
  if (!applies) return { key: 'not_applicable', label: 'Sin documentación portuaria', tone: 'light', complete: true, missing: [], toVerify: [], attached: list.filter(hasFile).length, required: 0, files: list.filter(hasFile).length };
  const s = docSummary(list);
  /* Verificado solo si se confirmó el archivo actual (reemplazarlo pide verificarlo otra vez) */
  const verified = (d) => { const c = (checks || {})[d.id]; return !!c && (!c.key || c.key === d.storageKey); };
  const toVerify = list.filter((d) => hasFile(d) && d.required && !verified(d));
  const key = !s.required ? 'not_required' : !s.complete ? 'incomplete' : toVerify.length ? 'to_verify' : 'complete';
  const label = { not_required: 'Documentos no requeridos', incomplete: 'Documentación incompleta', to_verify: 'Pendiente de verificar', complete: 'Documentación completa' }[key];
  const tone = { not_required: 'light', incomplete: 'amber', to_verify: 'blue', complete: 'ok' }[key];
  return { key, label, tone, complete: s.complete, missing: s.missing, toVerify, attached: s.attached, required: s.required, files: s.files };
}
/* Orden del expediente PDF: Pedimento, DODA, DEC, Cita, adicionales (o el orden guardado; los nuevos al final) */
export function dossierList(docs, { order = [], skip = [] } = {}) {
  const withFile = (docs || []).filter(hasFile);
  const base = [...withFile].sort((a, b) => (DOSSIER_ORDER[a.docType] || 9) - (DOSSIER_ORDER[b.docType] || 9) || (a.order || 0) - (b.order || 0) || (a.createdAt || 0) - (b.createdAt || 0));
  const pos = new Map((order || []).map((id, i) => [id, i]));
  const all = base.map((d, i) => ({ d, k: pos.has(d.id) ? pos.get(d.id) : 1e6 + i })).sort((a, b) => a.k - b.k).map((x) => x.d);
  const sk = new Set(skip || []);
  return { all, included: all.filter((d) => !sk.has(d.id)), skipped: all.filter((d) => sk.has(d.id)) };
}
export { sortDocs, docState, hasFile, defaultRequired };

/* ===== Finanzas (mismas reglas que Operadores: impuestos sobre la tarifa base, comisión sobre la tarifa sin IVA) ===== */
export function defaultFinance(division) { return { fare: 0, travelExpenses: 0, ...defaultTaxFlags(division), notes: '', touchedTaxes: false }; }
export function financePreview(fin, rule) {
  const f = fin || {};
  const taxes = computeTaxes(f.fare || 0, f);
  const commission = rule ? commissionFor(f.fare || 0, rule) : null;
  return { taxes, commission, expenses: f.travelExpenses || 0 };
}
/* Al cambiar de división en una orden nueva, los impuestos siguen la regla de la división si el usuario no los tocó */
export function financeForDivision(fin, division) {
  if (fin && fin.touchedTaxes) return fin;
  return { ...(fin || defaultFinance(division)), ...defaultTaxFlags(division) };
}

/* ===== Estados ===== */
export const ORDER_PHASES = [['draft', 'Borrador'], ['scheduled', 'Confirmada'], ['cancelled', 'Cancelada']];
export const GLOBAL_STATES = [
  { key: 'draft', label: 'Borrador', tone: 'light', active: true },
  { key: 'docs_pending', label: 'Pendiente de documentación', tone: 'amber', active: true },
  { key: 'assign_pending', label: 'Pendiente de asignación', tone: 'amber', active: true },
  { key: 'ready', label: 'Lista para despacho', tone: 'violet', active: true },
  { key: 'dispatched', label: 'Despachada', tone: 'indigo', active: true },
  { key: 'in_operation', label: 'En operación', tone: 'blue', active: true },
  { key: 'delivered', label: 'Entrega realizada', tone: 'teal', active: true },
  { key: 'return_pending', label: 'Pendiente de devolución', tone: 'amber', active: true },
  { key: 'return_transit', label: 'Vacío en devolución', tone: 'teal', active: true },
  { key: 'closing', label: 'Lista para cierre', tone: 'ok', active: true },
  { key: 'closed', label: 'Operativamente finalizada', tone: 'ok', active: false },
  { key: 'cancelled', label: 'Cancelada', tone: 'gray', active: false },
];
const GS = new Map(GLOBAL_STATES.map((s) => [s.key, s]));
export const globalState = (k) => GS.get(k) || GS.get('draft');
export const RETURN_LABELS = { not_applicable: 'No aplica', waived: 'No requiere devolución (excepción)', waiting: 'Al vaciarse el contenedor', pending: 'Pendiente de programar', scheduled: 'Programado', in_transit: 'En traslado', delivered: 'Vacío entregado' };

/* Recursos que faltan para un despacho normal */
export function missingResources(o, r = {}) {
  const t = opTypeOf(o.opType, o.division), out = [];
  if (!(r.vehicleId ?? o.vehicleId)) out.push('unidad');
  if (!(r.operatorId ?? o.operatorId)) out.push('operador');
  if (t.trailer && !(r.trailerId ?? o.trailerId)) out.push('remolque');
  return out;
}
/* Datos mínimos del viaje (además de recursos y documentos) */
export function missingTripData(o, r = {}) {
  const t = opTypeOf(o.opType, o.division), out = [];
  if (!String(r.origin ?? o.origin ?? '').trim()) out.push('origen');
  if (!String(r.destination ?? o.destination ?? '').trim()) out.push('destino');
  if (t.container && !isContainer(cleanContainer(r.containerNumber ?? o.containerNumber))) out.push('número de contenedor');
  if (t.fullLoad && !r.loadLinked) out.push('programación en Control de llenos (peso, terminal o patio, fecha y hora)');
  return out;
}

/*
 * ctx = { order, op (operación de Logística o null), docs (documentos de la carga o de la orden), empty (control de vacíos
 *         o null), trip (viaje financiero o null), paid (bool), resolved (datos de las fuentes: vehicleId…, origin…, loadLinked) }
 */
export function deriveState(ctx) {
  const o = ctx.order, op = ctx.op || null, r = ctx.resolved || {}, t = opTypeOf(o.opType, o.division);
  const docs = docStatus(ctx.docs, o.docChecks, { applies: o.division === 'puerto' });
  const opOpen = !!op && !op.closedAt && !op.deletedAt;
  const lgKey = op ? (op.closedAt ? 'closed' : op.status) : '';
  const logistics = op ? { key: lgKey, label: op.closedAt ? 'Operación cerrada' : lgStatusOf(op.status).label, tone: op.closedAt ? 'gray' : lgStatusOf(op.status).tone } : { key: '', label: 'Sin despachar', tone: 'light' };
  const delivered = !!o.delivery;
  const delivery = delivered ? { key: 'done', label: 'Entrega realizada', tone: 'teal' } : { key: 'pending', label: op ? 'Entrega pendiente' : 'Sin entrega', tone: 'light' };
  const needsRet = needsEmptyReturn(o);
  let retKey = 'not_applicable';
  if (o.division === 'puerto' && t.emptyReturn) {
    if (o.noEmptyReturn) retKey = 'waived';
    else if (ctx.empty) retKey = ctx.empty.status === 'delivered' ? 'delivered' : ctx.empty.status;
    else retKey = 'waiting';
  }
  const ret = { key: retKey, label: RETURN_LABELS[retKey] || retKey, tone: retKey === 'delivered' ? 'ok' : retKey === 'in_transit' ? 'teal' : retKey === 'scheduled' ? 'blue' : retKey === 'pending' ? 'amber' : 'light' };
  const finance = ctx.trip ? (ctx.paid ? { key: 'paid', label: 'Pagado', tone: 'ok' } : { key: 'receivable', label: 'Por cobrar', tone: 'amber' })
    : (o.finance && o.finance.fare > 0 ? { key: 'draft', label: 'Por registrar al despachar', tone: 'light' } : { key: 'none', label: 'Sin tarifa', tone: 'light' });
  const openIncidents = (o.incidents || []).filter((i) => !i.resolvedAt), critical = openIncidents.filter((i) => i.critical);
  const resMissing = missingResources(o, r), dataMissing = missingTripData(o, r);

  let key;
  if (o.phase === 'cancelled') key = 'cancelled';
  else if (o.closedAt) key = 'closed';
  else if (!op) key = o.phase === 'draft' ? 'draft' : !docs.complete ? 'docs_pending' : resMissing.length || dataMissing.length ? 'assign_pending' : 'ready';
  else if (needsRet && delivered && ctx.empty) key = ctx.empty.status === 'delivered' ? 'closing' : ctx.empty.status === 'in_transit' ? 'return_transit' : 'return_pending';
  else if (delivered) key = needsRet ? 'delivered' : 'closing';
  else if (opOpen && op.status === 'assigned') key = 'dispatched';
  else if (opOpen && (op.status === 'empty' || op.status === 'empty_transit') && needsRet) key = ctx.empty ? (ctx.empty.status === 'in_transit' ? 'return_transit' : ctx.empty.status === 'delivered' ? 'closing' : 'return_pending') : 'in_operation';
  else key = 'in_operation';
  const g = globalState(key);

  /* Siguiente paso y acción principal: del estado real, nunca un mensaje genérico */
  let next;
  const firstMissingDoc = docs.missing && docs.missing[0];
  if (key === 'cancelled') next = { key: 'none', text: 'Orden cancelada', action: '' };
  else if (key === 'closed') next = { key: 'none', text: 'Orden finalizada', action: 'summary' };
  else if (key === 'draft') next = { key: 'confirm', text: 'Completa los datos y confirma la orden', action: 'edit' };
  else if (!op && dataMissing.length) next = { key: 'data', text: `Pendiente: ${dataMissing[0]}`, action: 'edit' };
  else if (!op && !docs.complete) next = { key: 'docs', text: `Pendiente de adjuntar ${firstMissingDoc ? labelOf(firstMissingDoc) : 'documentación'}`, action: 'docs' };
  else if (!op && resMissing.length) next = { key: 'assign', text: `Pendiente de asignar ${resMissing.join(', ')}`, action: 'assign' };
  else if (!op) next = { key: 'dispatch', text: 'Lista para despacho', action: 'dispatch' };
  else if (op.closedAt && !delivered) next = { key: 'deliver', text: 'La operación se cerró en Logística: registra la entrega para terminar la orden', action: 'deliver' };
  else if (!delivered && opOpen && op.status === 'assigned') next = { key: 'depart', text: 'Confirmar salida de la unidad', action: 'advance' };
  else if (!delivered && opOpen && op.status === 'unloading') next = { key: 'deliver', text: 'Confirmar entrega', action: 'deliver' };
  else if (!delivered) next = { key: 'track', text: 'En seguimiento', action: 'track' };
  else if (needsRet && !ctx.empty) next = { key: 'empty', text: 'Marcar contenedor vacío', action: 'empty' };
  else if (needsRet && ctx.empty && ctx.empty.status === 'pending') next = { key: 'schedule_return', text: 'Programar devolución del vacío', action: 'return_schedule' };
  else if (needsRet && ctx.empty && ctx.empty.status !== 'delivered') next = { key: 'confirm_return', text: 'Confirmar devolución del vacío', action: 'return_confirm' };
  else if (critical.length) next = { key: 'incidents', text: 'Resolver incidencias críticas antes del cierre', action: 'incidents' };
  else next = { key: 'close', text: 'Lista para cierre operativo', action: 'close' };
  if (!o.closedAt && o.phase !== 'cancelled' && op && (docs.key === 'incomplete') && !delivered && next.key === 'track') next = { key: 'docs', text: `Documentación pendiente: ${firstMissingDoc ? labelOf(firstMissingDoc) : ''}`.trim(), action: 'docs' };

  return { key, label: g.label, tone: g.tone, active: g.active, next, logistics, docs, delivery, ret, finance, incidents: openIncidents, critical, needsReturn: needsRet, missing: { resources: resMissing, data: dataMissing }, progress: progressOf(ctx, { key, docs, delivered, needsRet }) };
}
const labelOf = (d) => docKindLabel(d);

/* Avance: Captura → Documentación → Asignación → Despacho → Entrega → Vacío (si aplica) → Finalización */
export function progressSteps(division, needsReturn) {
  return [['capture', 'Captura'], ['docs', 'Documentación'], ['assign', 'Asignación'], ['dispatch', 'Despacho'], ['delivery', 'Entrega'], ...(needsReturn ? [['empty', 'Vacío']] : []), ['close', 'Finalización']];
}
function progressOf(ctx, { key, docs, delivered, needsRet }) {
  const o = ctx.order, r = ctx.resolved || {};
  const done = {
    capture: o.phase !== 'draft' || !!ctx.op,
    docs: o.division !== 'puerto' || docs.complete,
    assign: !missingResources(o, r).length,
    dispatch: !!ctx.op,
    delivery: delivered,
    empty: !!(ctx.empty && ctx.empty.status === 'delivered') || !!o.noEmptyReturn,
    close: !!o.closedAt,
  };
  const steps = progressSteps(o.division, needsRet || !!o.noEmptyReturn).map(([k, label]) => ({ key: k, label, done: !!done[k] }));
  if (key === 'cancelled') return steps.map((s) => ({ ...s, state: s.done ? 'done' : 'off' }));
  const cur = steps.findIndex((s) => !s.done);
  return steps.map((s, i) => ({ ...s, state: s.done ? 'done' : i === cur ? 'current' : 'pending' }));
}

/* ===== Validación del despacho =====
 * ctx = { order, resolved, docs, conflicts: {unit, operator, trailer}, unit: {inactive, inShop, expired[], missing[], noGps},
 *         trailer: {inShop, type}, operatorLicenseExpired, generatedCount, today, canDispatch }
 * blocks: impiden despachar · warnings: se pueden autorizar (code para registrar la autorización) */
export const TRAILER_FIT = { puerto: ['chasis'], campo: ['jaula', 'tolva'] };
export function dispatchCheck(ctx) {
  const o = ctx.order, r = ctx.resolved || {}, blocks = [], warnings = [];
  const add = (list, code, msg) => list.push({ code, msg });
  if (ctx.canDispatch === false) add(blocks, 'perm', 'Tu usuario no tiene permiso para despachar.');
  if (o.phase === 'cancelled') add(blocks, 'cancelled', 'La orden está cancelada.');
  if (o.closedAt) add(blocks, 'closed', 'La orden ya está finalizada.');
  for (const m of missingResources(o, r)) add(blocks, 'res_' + m, `Falta asignar ${m}.`);
  for (const m of missingTripData(o, r)) add(blocks, 'data', `Falta ${m}.`);
  const docs = docStatus(ctx.docs, o.docChecks, { applies: o.division === 'puerto' });
  if (!docs.complete) add(blocks, 'docs', `Documentación incompleta: falta ${docs.missing.map(labelOf).join(', ')}. Adjúntala o márcala como no requerida.`);
  else if (docs.toVerify.length) add(warnings, 'docs_verify', `${docs.toVerify.length === 1 ? 'Un documento está' : `${docs.toVerify.length} documentos están`} pendiente${docs.toVerify.length === 1 ? '' : 's'} de verificar: ${docs.toVerify.map(labelOf).join(', ')}.`);
  const c = ctx.conflicts || {}, u = ctx.unit || {}, tr = ctx.trailer || {};
  if (c.unit) add(blocks, 'unit_busy', `La unidad ya tiene otra operación activa${c.unitText ? ` (${c.unitText})` : ''}.`);
  if (u.inactive) add(blocks, 'unit_inactive', 'La unidad está marcada como inactiva en el catálogo.');
  if (u.inShop) add(warnings, 'unit_shop', 'La unidad está en taller.');
  if (u.expired && u.expired.length) add(warnings, 'unit_docs_expired', `La unidad tiene documentos vencidos: ${u.expired.join(', ')}.`);
  else if (u.missing && u.missing.length) add(warnings, 'unit_docs_missing', `La unidad tiene documentación pendiente: ${u.missing.join(', ')}.`);
  if (u.noGps) add(warnings, 'unit_no_gps', 'La unidad no tiene GPS vinculado: el seguimiento será manual.');
  if (c.operator) add(warnings, 'operator_busy', `El operador ya está en otra operación activa${c.operatorText ? ` (${c.operatorText})` : ''}.`);
  if (ctx.operatorLicenseExpired) add(warnings, 'operator_license', 'La licencia del operador está vencida.');
  if (c.trailer) add(warnings, 'trailer_busy', `El remolque ya está en otra operación activa${c.trailerText ? ` (${c.trailerText})` : ''}.`);
  if (tr.inShop) add(warnings, 'trailer_shop', 'El remolque está en taller.');
  if (tr.type && TRAILER_FIT[o.division] && !TRAILER_FIT[o.division].includes(tr.type)) add(warnings, 'trailer_type', `El remolque es tipo ${tr.type}: no es el habitual para ${divisionLabel(o.division)}.`);
  if (!ctx.generatedCount) add(warnings, 'no_document', `Aún no se genera la ${o.division === 'campo' ? 'asignación de unidades' : 'nota de entrega'}.`);
  const date = r.scheduledDate || o.scheduledDate;
  if (date && ctx.today && isDate(date) && date < ctx.today) add(warnings, 'past_date', 'La fecha programada ya pasó.');
  return { blocks, warnings, ok: !blocks.length };
}

/* ===== Cierre operativo ===== */
export function closeCheck(ctx, state = deriveState(ctx)) {
  const o = ctx.order, missing = [];
  if (o.phase === 'cancelled') missing.push('La orden está cancelada.');
  if (o.closedAt) missing.push('La orden ya está finalizada.');
  if (!ctx.op) missing.push('La orden no se ha despachado.');
  if (!o.delivery) missing.push('Falta confirmar la entrega.');
  if (state.needsReturn) {
    if (!ctx.empty) missing.push('Falta registrar el contenedor vacío.');
    else if (ctx.empty.status !== 'delivered') missing.push('Falta confirmar la devolución del vacío.');
  }
  if (state.critical.length) missing.push(`Hay ${state.critical.length === 1 ? 'una incidencia crítica abierta' : `${state.critical.length} incidencias críticas abiertas`}.`);
  return { ok: !missing.length, missing };
}

/* ===== Listado: indicadores y filtros ===== */
export const TILES = [
  ['pending', 'Pendientes', (s) => ['draft', 'docs_pending', 'assign_pending'].includes(s.key)],
  ['ready', 'Listas para despacho', (s) => s.key === 'ready'],
  ['operating', 'En operación', (s) => s.key === 'dispatched' || s.key === 'in_operation'],
  ['delivered', 'Entregas realizadas', (s, o) => !!o.delivery && s.key !== 'cancelled'],
  ['returns', 'Pendientes de devolución', (s) => s.key === 'return_pending' || s.key === 'return_transit' || (s.key === 'delivered' && s.needsReturn)],
  ['closed', 'Finalizadas', (s) => s.key === 'closed'],
  ['incidents', 'Con incidencias', (s) => s.incidents.length > 0 && s.key !== 'cancelled'],
];
export function tileCounts(rows) {
  const out = {};
  for (const [k, , fn] of TILES) out[k] = rows.filter(({ order, state }) => fn(state, order)).length;
  return out;
}
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
/*
 * rows = [{ order, state, view }] (view: textos ya resueltos: customer, origin, destination, container, reference, unit,
 * operator, date, vehicleId, operatorId). f = { text, division, customerId, status, from, to, vehicleId, operatorId,
 * docs: 'complete'|'pending', scope: 'active'|'finished'|'all', tile }
 */
export function filterRows(rows, f = {}) {
  const q = norm(f.text), qc = cleanContainer(f.text || '');
  const tile = f.tile ? (TILES.find(([k]) => k === f.tile) || [])[2] : null;
  return rows.filter(({ order: o, state: s, view: v = {} }) => {
    if (f.division && f.division !== 'all' && o.division !== f.division) return false;
    if (f.customerId && o.customerId !== f.customerId) return false;
    if (f.status && f.status !== 'all' && s.key !== f.status) return false;
    if (f.vehicleId && v.vehicleId !== f.vehicleId) return false;
    if (f.operatorId && v.operatorId !== f.operatorId) return false;
    if (f.docs === 'complete' && !(o.division === 'puerto' && s.docs.complete)) return false;
    if (f.docs === 'pending' && !(o.division === 'puerto' && !s.docs.complete)) return false;
    if (f.scope === 'active' && !s.active) return false;
    if (f.scope === 'finished' && s.active) return false;
    if (tile && !tile(s, o)) return false;
    const day = v.date || '';
    if (f.from && (!day || day < f.from)) return false;
    if (f.to && (!day || day > f.to)) return false;
    if (q) {
      const hay = norm([o.folio, v.customer, v.origin, v.destination, v.container, v.reference, o.commercialRef, v.unit, v.operator, o.requester].join(' '));
      if (!hay.includes(q) && !(qc.length >= 4 && cleanContainer(v.container || '').includes(qc))) return false;
    }
    return true;
  });
}
/* Orden del listado: activas primero por fecha programada, luego finalizadas por actualización */
export function sortRows(rows) {
  return [...rows].sort((a, b) => (b.state.active - a.state.active)
    || (a.state.active ? String(a.view.date || '9999').localeCompare(String(b.view.date || '9999')) || (b.order.updatedAt || 0) - (a.order.updatedAt || 0)
      : (b.order.updatedAt || 0) - (a.order.updatedAt || 0)));
}

/* ===== Documentos generados: instantánea y vigencia ===== */
export const SNAPSHOT_KEYS = ['vehicleId', 'operatorId', 'trailerId', 'origin', 'destination', 'deliveryPlace', 'containerNumber', 'customerId'];
export const snapshotOf = (r) => Object.fromEntries(SNAPSHOT_KEYS.map((k) => [k, r[k] ?? '']));
/* Qué cambió desde que se emitió el documento (lista vacía = vigente) */
export function outdatedFields(snapshot, r) {
  if (!snapshot) return [];
  const NAMES = { vehicleId: 'unidad', operatorId: 'operador', trailerId: 'remolque', origin: 'origen', destination: 'destino', deliveryPlace: 'lugar de entrega', containerNumber: 'contenedor', customerId: 'cliente' };
  return SNAPSHOT_KEYS.filter((k) => String(snapshot[k] ?? '') !== String(r[k] ?? '')).map((k) => NAMES[k]);
}
export const nextVersion = (generated, type) => 1 + (generated || []).filter((g) => g.type === type).reduce((m, g) => Math.max(m, g.version || 0), 0);

/* ===== Historial unificado: eventos de la orden + estados de Logística + carga + vacío, del más nuevo al más viejo ===== */
export function timeline({ events = [], op = null, loadEvents = [], emptyEvents = [] } = {}) {
  const out = events.map((e) => ({ at: e.at, by: e.by, text: e.text, details: e.details || '', kind: e.type, source: 'orden' }));
  if (op) for (const l of op.statusLog || []) out.push({ at: l.at, by: l.by, text: l.closed ? 'Operación cerrada en Logística' : `Logística: ${lgStatusOf(l.status).label}`, details: '', kind: 'lg_' + l.status, source: 'logistica' });
  for (const e of loadEvents) out.push({ at: e.createdAt, by: e.createdBy, text: `Control de llenos: ${e.label || e.eventType}`, details: e.details || '', kind: 'fl_' + e.eventType, source: 'llenos' });
  for (const e of emptyEvents) out.push({ at: e.createdAt, by: e.createdBy, text: `Control de vacíos: ${e.label || e.eventType}`, details: e.details || '', kind: 'ec_' + e.eventType, source: 'vacios' });
  return out.filter((x) => Number.isFinite(x.at)).sort((a, b) => b.at - a.at);
}
export { isWorking };

/* ===== Respaldo / información compartida: solo registros con la forma esperada ===== */
const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
const idOr = (v) => (typeof v === 'string' && v ? v : null);
const numOr = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const tsOr = (v) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const day = (v) => (isDate(v) ? v : '');
const hm = (v) => (/^\d{2}:\d{2}$/.test(String(v || '')) ? v : '');
export function sanitizeOrder(r) {
  if (!r || typeof r.id !== 'string' || !FOLIO_RE.test(String(r.folio || ''))) return null;
  const division = r.division === 'campo' ? 'campo' : 'puerto';
  const t = OP_TYPES.find((x) => x.key === r.opType && x.division === division) ? r.opType : defaultOpType(division);
  const fin = r.finance && typeof r.finance === 'object' ? r.finance : {};
  const list = (a) => (Array.isArray(a) ? a.filter((x) => x && typeof x === 'object' && !Array.isArray(x)) : []);
  return {
    ...r, division, opType: t, phase: ['draft', 'scheduled', 'cancelled'].includes(r.phase) ? r.phase : 'draft',
    folio: r.folio, companyId: ['perconsur', 'oasc', 'osc', 'campo'].includes(r.companyId) ? r.companyId : division === 'campo' ? 'campo' : 'perconsur',
    customerId: idOr(r.customerId), vehicleId: idOr(r.vehicleId), operatorId: idOr(r.operatorId), trailerId: idOr(r.trailerId),
    fullLoadId: idOr(r.fullLoadId), logisticsOperationId: idOr(r.logisticsOperationId), tripId: idOr(r.tripId), emptyReturnId: idOr(r.emptyReturnId),
    terminalId: idOr(r.terminalId), yardId: idOr(r.yardId), returnYardId: idOr(r.returnYardId), plantId: idOr(r.plantId),
    locationType: r.locationType === 'offport' ? 'offport' : 'port',
    containerNumber: cleanContainer(r.containerNumber || ''), weightKg: r.weightKg == null ? null : Math.max(0, Math.min(60000, Math.round(numOr(r.weightKg)))),
    serviceDate: day(r.serviceDate), scheduledDate: day(r.scheduledDate), scheduledTime: hm(r.scheduledTime),
    finance: { fare: Math.max(0, Math.round(numOr(fin.fare))), travelExpenses: Math.max(0, Math.round(numOr(fin.travelExpenses))), applyVat: !!fin.applyVat, applyIsr: !!fin.applyIsr, applyVatWithholding: !!fin.applyVatWithholding, notes: str(fin.notes, 500), touchedTaxes: !!fin.touchedTaxes },
    assignments: list(r.assignments).slice(-50), generated: list(r.generated).filter((g) => typeof g.documentId === 'string').slice(-50).map((g) => ({ ...g, version: Math.max(1, Math.round(numOr(g.version, 1))) })),
    incidents: list(r.incidents).slice(-100).map((i) => ({ ...i, text: str(i.text, 500), critical: !!i.critical })),
    delivery: r.delivery && typeof r.delivery === 'object' ? { ...r.delivery, date: day(r.delivery.date), time: hm(r.delivery.time) } : null,
    noEmptyReturn: r.noEmptyReturn && typeof r.noEmptyReturn === 'object' ? { ...r.noEmptyReturn, reason: str(r.noEmptyReturn.reason, 300) } : null,
    docChecks: r.docChecks && typeof r.docChecks === 'object' && !Array.isArray(r.docChecks) ? r.docChecks : {},
    dossierOrder: Array.isArray(r.dossierOrder) ? r.dossierOrder.filter((x) => typeof x === 'string') : [], dossierSkip: Array.isArray(r.dossierSkip) ? r.dossierSkip.filter((x) => typeof x === 'string') : [],
    pending: Array.isArray(r.pending) ? r.pending.filter((x) => typeof x === 'string') : [],
    closedAt: tsOr(r.closedAt), cancelledAt: tsOr(r.cancelledAt), dispatchedAt: tsOr(r.dispatchedAt),
    createdAt: numOr(r.createdAt, Date.now()), updatedAt: numOr(r.updatedAt, Date.now()), revisions: list(r.revisions).slice(-30),
  };
}
export function sanitizeOrderEvent(e) {
  if (!e || typeof e.id !== 'string' || typeof e.orderId !== 'string' || !Number.isFinite(Number(e.at))) return null;
  return { ...e, at: Number(e.at), type: str(e.type, 40), text: str(e.text, 300), details: str(e.details, 600) };
}
export function sanitizeOrderFile(d) {
  if (!d || typeof d.id !== 'string' || typeof d.orderId !== 'string') return null;
  const ok = ['pedimento', 'doda', 'cita', 'dec', 'otro', 'entrega', 'devolucion'];
  if (!ok.includes(d.docType)) return null;
  return { ...d, kind: d.kind === 'pdf' || d.kind === 'img' ? d.kind : null, fileStatus: ['none', 'ok', 'error'].includes(d.fileStatus) ? d.fileStatus : 'none', required: !!d.required, manual: !!d.manual, size: numOr(d.size), pages: numOr(d.pages), label: str(d.label, 80), name: str(d.name, 160) };
}
