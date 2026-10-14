/*
 * Control de llenos — reglas puras (sin almacenamiento ni DOM), para poder probarlas por separado.
 * Una CARGA es la programación para recoger un contenedor lleno: contenedor, peso, dónde (dentro de puerto = terminal
 * portuaria; fuera de puerto = patio o instalación de carga), cuándo (fecha y hora) y, cuando ya se sabe, con qué
 * transporte (unidad, operador, remolque del catálogo). Cada carga tiene sus DOCUMENTOS, uno por uno:
 *   Pedimento · DODA · Cita de recinto portuario · DEC (solo dentro de puerto) · Documentos adicionales
 * Cada documento es requerido o no requerido, y su estado se calcula: Adjuntado, Pendiente o No requerido.
 * El estado documental de la carga (completa / incompleta) es independiente del estado operativo (Programada, Lista…),
 * que solo cambia el usuario: pasar la hora de la cita nunca marca la carga como Cargada.
 */
import { isDate } from '../operators/balance.js';
import { cleanContainer, isContainer, dayStr, hmStr } from '../empties/empties.js';

export { cleanContainer, isContainer, dayStr, hmStr };

/* ===== Estado operativo de la carga ===== */
export const LOAD_STATUSES = [
  { key: 'scheduled', label: 'Programada', short: 'Programada', tone: 'blue', open: true, hint: 'Cita registrada; falta confirmar documentación o transporte' },
  { key: 'docs_pending', label: 'Pendiente de documentación', short: 'Pend. documentación', tone: 'amber', open: true, hint: 'Se recoge en cuanto esté la documentación' },
  { key: 'ready', label: 'Lista para cargar', short: 'Lista', tone: 'teal', open: true, hint: 'Documentación y transporte confirmados' },
  { key: 'loading', label: 'En proceso de carga', short: 'En carga', tone: 'violet', open: true, hint: 'La unidad está recogiendo el contenedor' },
  { key: 'loaded', label: 'Cargada', short: 'Cargada', tone: 'ok', open: false, hint: 'Contenedor recogido' },
  { key: 'cancelled', label: 'Cancelada', short: 'Cancelada', tone: 'gray', open: false, hint: 'La carga no se realizará' },
];
const ST = new Map(LOAD_STATUSES.map((s) => [s.key, s]));
export const loadStatus = (k) => ST.get(k) || ST.get('scheduled');
export const isStatus = (k) => ST.has(k);
export const isOpenLoad = (r) => !!r && !r.deletedAt && loadStatus(r.status).open;

/* ===== Ubicación de la carga ===== */
export const LOCATIONS = [['port', 'Dentro de puerto', 'Terminal portuaria'], ['offport', 'Fuera de puerto', 'Patio / instalación de carga']];
export const locationLabel = (k) => (LOCATIONS.find(([x]) => x === k) || LOCATIONS[0])[1];
export const placeLabel = (k) => (LOCATIONS.find(([x]) => x === k) || LOCATIONS[0])[2];
export const isLocation = (k) => k === 'port' || k === 'offport';

/* ===== Documentos ===== */
export const DOC_TYPES = [
  { key: 'pedimento', label: 'Pedimento', short: 'Pedimento', order: 1, slot: true, fem: false },
  { key: 'doda', label: 'DODA', short: 'DODA', order: 2, slot: true, fem: false },
  { key: 'cita', label: 'Cita de recinto portuario', short: 'Cita', order: 3, slot: true, fem: true },
  { key: 'dec', label: 'DEC', short: 'DEC', order: 4, slot: true, fem: false, portOnly: true },
  { key: 'otro', label: 'Documento adicional', short: 'Adicional', order: 5, slot: false, fem: false },
];
const DT = new Map(DOC_TYPES.map((d) => [d.key, d]));
export const docType = (k) => DT.get(k) || DT.get('otro');
export const isDocType = (k) => DT.has(k);
/* Nombre visible de un documento: el tipo (Pedimento, DODA…) o, en los adicionales, su etiqueta o el nombre del archivo */
export const docLabel = (d) => (d.docType === 'otro' ? String(d.label || d.name || 'Documento adicional') : docType(d.docType).label);
/* Documentos que debe tener cada carga según su ubicación (el DEC solo dentro de puerto) */
export const slotTypes = (locationType) => DOC_TYPES.filter((d) => d.slot && (!d.portOnly || locationType === 'port')).map((d) => d.key);
/* Requerido inicial según la ubicación: pedimento y DODA siempre; la cita y el DEC dentro de puerto; fuera, la cita «cuando aplique» */
export function defaultRequired(type, locationType) {
  if (type === 'pedimento' || type === 'doda') return true;
  if (type === 'cita' || type === 'dec') return locationType === 'port';
  return false;
}
/* ¿Tiene archivo utilizable? */
export const hasFile = (d) => !!(d && d.storageKey && d.fileStatus === 'ok');
/* Estado de un documento: Adjuntado · Pendiente · No requerido */
export const docState = (d) => (hasFile(d) ? 'attached' : d.required ? 'pending' : 'not_required');
export const DOC_STATE_LABELS = { attached: 'Adjuntado', pending: 'Pendiente', not_required: 'No requerido' };

/* Orden de los documentos de una carga: pedimento, DODA, cita, DEC y después los adicionales en su orden */
export const sortDocs = (docs) => [...docs].sort((a, b) => docType(a.docType).order - docType(b.docType).order || (a.order || 0) - (b.order || 0) || (a.createdAt || 0) - (b.createdAt || 0));

/*
 * Estado documental de la carga. Completa cuando todos los documentos requeridos están adjuntados; los opcionales o
 * marcados como «No requerido» no la detienen.
 *   { complete, required, attached, missing:[docs requeridos sin archivo], optional:n adjuntados no requeridos, files:n }
 */
export function docSummary(docs) {
  const req = docs.filter((d) => d.required), missing = req.filter((d) => !hasFile(d));
  return { complete: !missing.length, required: req.length, attached: req.length - missing.length, missing, optional: docs.filter((d) => !d.required && hasFile(d)).length, files: docs.filter(hasFile).length };
}
export const docSummaryText = (s) => (s.complete ? (s.required ? `Documentación completa (${s.attached} de ${s.required})` : 'Documentación completa') : `Documentación incompleta (${s.attached} de ${s.required})`);

/*
 * Qué hacer con los documentos cuando se crea la carga o cambia su ubicación, sin perder archivos ni decisiones manuales:
 *   create  tipos que faltan (con su requerido inicial)
 *   update  [{ id, patch }] requerido que cambia por la regla de ubicación (respeta lo fijado a mano, salvo un DEC fuera de puerto)
 *   remove  ids de un DEC vacío que deja de aplicar (fuera de puerto); un DEC con archivo se conserva como no requerido
 */
export function reconcileDocs(docs, locationType) {
  const out = { create: [], update: [], remove: [] };
  const have = new Set(docs.map((d) => d.docType));
  for (const t of slotTypes(locationType)) if (!have.has(t)) out.create.push({ docType: t, required: defaultRequired(t, locationType) });
  for (const d of docs) {
    if (d.docType === 'otro') continue;
    if (d.docType === 'dec' && locationType !== 'port') { /* fuera de puerto el DEC no aplica, aunque se haya marcado a mano */
      if (!hasFile(d)) out.remove.push(d.id);
      else if (d.required) out.update.push({ id: d.id, patch: { required: false, manual: false } });
      continue;
    }
    if (d.manual) continue;
    const want = defaultRequired(d.docType, locationType);
    if (!!d.required !== want) out.update.push({ id: d.id, patch: { required: want } });
  }
  return out;
}

/* ===== Validación de la carga ===== */
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
export const isTime = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(t || ''));
/* Peso en kg: número entero no negativo (admite «28,500» o «28 500») */
export function parseWeight(v) {
  const s = String(v ?? '').replace(/[,\s]/g, '').trim();
  if (!s) return null;
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  return Math.round(Number(s));
}
/*
 * input = { containerNumber, weightKg, reference, notes, locationType, terminalId, yardId, scheduledDate, scheduledTime,
 *   vehicleId, operatorId, trailerId }
 * Devuelve { load, duplicate } (duplicate = carga abierta del mismo contenedor, para advertir) o { errors: { campo: mensaje } }.
 */
export function checkLoad(input, { existing = [], selfId = null } = {}) {
  const errors = {};
  const containerNumber = cleanContainer(input.containerNumber);
  if (!containerNumber) errors.containerNumber = 'Escribe el número de contenedor.';
  else if (!isContainer(containerNumber)) errors.containerNumber = 'El número de contenedor debe tener 4 letras y 7 números.';
  const w = parseWeight(input.weightKg);
  if (w == null) errors.weightKg = 'Escribe el peso en kilogramos.';
  else if (Number.isNaN(w) || /^\s*-/.test(String(input.weightKg))) errors.weightKg = 'El peso debe ser un número en kilogramos, sin signo negativo.';
  else if (w <= 0) errors.weightKg = 'El peso debe ser mayor a cero.';
  else if (w > 60000) errors.weightKg = 'El peso parece incorrecto (más de 60,000 kg).';
  const locationType = input.locationType;
  if (!isLocation(locationType)) errors.locationType = 'Elige si la carga es dentro o fuera de puerto.';
  const terminalId = locationType === 'port' ? input.terminalId || null : null, yardId = locationType === 'offport' ? input.yardId || null : null;
  if (locationType === 'port' && !terminalId) errors.terminalId = 'Elige la terminal portuaria.';
  if (locationType === 'offport' && !yardId) errors.yardId = 'Elige el patio o la instalación de carga.';
  if (!isDate(input.scheduledDate)) errors.scheduledDate = 'La fecha programada no es válida.';
  if (!isTime(input.scheduledTime)) errors.scheduledTime = 'La hora programada no es válida.';
  const reference = clean(input.reference).slice(0, 60), notes = String(input.notes ?? '').trim().slice(0, 500);
  if (Object.keys(errors).length) return { errors };
  const load = {
    containerNumber, weightKg: w, reference, notes, locationType, terminalId, yardId, scheduledDate: input.scheduledDate, scheduledTime: input.scheduledTime,
    vehicleId: input.vehicleId || null, operatorId: input.operatorId || null, trailerId: input.trailerId || null,
  };
  const duplicate = existing.find((r) => r.id !== selfId && isOpenLoad(r) && r.containerNumber === containerNumber) || null;
  return { load, duplicate };
}

/* ===== Fechas y pizarra ===== */
const p2 = (n) => String(n).padStart(2, '0');
export function addDays(date, n) {
  const [y, m, d] = String(date).split('-').map(Number);
  const t = new Date(y, m - 1, d + n);
  return `${t.getFullYear()}-${p2(t.getMonth() + 1)}-${p2(t.getDate())}`;
}
/* Lunes de la semana de una fecha */
export function weekStart(date) {
  const [y, m, d] = String(date).split('-').map(Number);
  const t = new Date(y, m - 1, d), dow = (t.getDay() + 6) % 7;
  return addDays(date, -dow);
}
export const weekDays = (date) => { const s = weekStart(date); return Array.from({ length: 7 }, (_, i) => addDays(s, i)); };
/* Cuadrícula del mes (semanas de lunes a domingo, con los días de relleno de los meses vecinos) */
export function monthGrid(date) {
  const [y, m] = String(date).split('-').map(Number);
  const first = `${y}-${p2(m)}-01`, start = weekStart(first), last = new Date(y, m, 0).getDate();
  const end = weekStart(addDays(`${y}-${p2(m)}-${p2(last)}`, 7));
  const weeks = [];
  for (let d = start; d < end; d = addDays(d, 7)) weeks.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)));
  return weeks;
}
export const monthOf = (date) => String(date).slice(0, 7);
/* Rango de fechas de los filtros rápidos; ambos extremos se incluyen («Este mes» termina el último día del mes) */
export function rangeDates(range, today) {
  if (range === 'today') return { from: today, to: today };
  if (range === 'tomorrow') { const d = addDays(today, 1); return { from: d, to: d }; }
  if (range === 'week') return { from: today, to: addDays(today, 6) };
  if (range === 'month') { const first = monthOf(today) + '-01'; return { from: first, to: addDays(monthOf(addDays(first, 31)) + '-01', -1) }; }
  return {};
}
export const whenKey = (r) => `${r.scheduledDate || '9999-99-99'} ${r.scheduledTime || '99:99'}`;
export const sortByWhen = (list) => [...list].sort((a, b) => whenKey(a).localeCompare(whenKey(b)) || (a.createdAt || 0) - (b.createdAt || 0));
/* Cargas por día: Map('AAAA-MM-DD' → [cargas ordenadas por hora]) */
export function byDay(loads) {
  const m = new Map();
  for (const r of sortByWhen(loads)) { if (!m.has(r.scheduledDate)) m.set(r.scheduledDate, []); m.get(r.scheduledDate).push(r); }
  return m;
}
/* La cita ya pasó y la carga sigue abierta (aviso; no cambia el estado) */
export function isLate(r, now = new Date()) {
  if (!isOpenLoad(r) || !r.scheduledDate) return false;
  const today = dayStr(now);
  if (r.scheduledDate < today) return true;
  if (r.scheduledDate > today) return false;
  return !!r.scheduledTime && r.scheduledTime < hmStr(now);
}

/* ===== Indicadores ===== */
export function summary(loads, docsOf, now = new Date()) {
  const today = dayStr(now), tomorrow = addDays(today, 1), weekEnd = addDays(today, 6);
  const open = loads.filter(isOpenLoad);
  return {
    today: open.filter((r) => r.scheduledDate === today).length,
    tomorrow: open.filter((r) => r.scheduledDate === tomorrow).length,
    week: open.filter((r) => r.scheduledDate >= today && r.scheduledDate <= weekEnd).length,
    docsPending: open.filter((r) => !docSummary(docsOf(r.id)).complete).length,
    ready: open.filter((r) => r.status === 'ready').length,
    done: loads.filter((r) => !r.deletedAt && r.status === 'loaded').length,
    late: open.filter((r) => isLate(r, now)).length,
  };
}

/* ===== Filtros y búsqueda ===== */
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/*
 * f = { text, status:'all'|'open'|'done'|<estado>, docs:'all'|'complete'|'incomplete', location:'all'|'port'|'offport',
 *       terminalId, yardId, vehicleId, operatorId, from, to (AAAA-MM-DD) }
 * view(r) → { place, unit, placas, operator, trailer, docs:{complete} }
 */
export function filterLoads(loads, f, view) {
  const q = fold(f.text).trim();
  return loads.filter((r) => {
    if (f.status && f.status !== 'all') {
      if (f.status === 'open' && !isOpenLoad(r)) return false;
      if (f.status === 'done' && isOpenLoad(r)) return false;
      if (f.status !== 'open' && f.status !== 'done' && r.status !== f.status) return false;
    }
    if (f.location && f.location !== 'all' && r.locationType !== f.location) return false;
    if (f.terminalId && r.terminalId !== f.terminalId) return false;
    if (f.yardId && r.yardId !== f.yardId) return false;
    if (f.vehicleId && r.vehicleId !== f.vehicleId) return false;
    if (f.operatorId && r.operatorId !== f.operatorId) return false;
    if (f.from && r.scheduledDate < f.from) return false;
    if (f.to && r.scheduledDate > f.to) return false;
    /* La vista (catálogos y documentos) solo se resuelve si el filtro documental o la búsqueda la necesitan */
    const byDocs = f.docs && f.docs !== 'all';
    if (!byDocs && !q) return true;
    const v = view(r);
    if (byDocs && (f.docs === 'complete') !== !!v.docs.complete) return false;
    if (!q) return true;
    const hay = [r.containerNumber, r.reference, v.place, v.unit, v.placas, v.operator, v.trailer, r.notes].map(fold).join('\u0001');
    return q.split(/\s+/).every((w) => hay.includes(w));
  });
}

/* ===== Historial ===== */
export const EVENT_LABELS = {
  created: 'Carga programada', reschedule: 'Reprogramación', vehicle: 'Unidad asignada', operator: 'Operador asignado', trailer: 'Remolque asignado',
  edit: 'Datos modificados', location: 'Ubicación cambiada', doc_added: 'Documento añadido', doc_replaced: 'Documento reemplazado', doc_removed: 'Documento eliminado',
  doc_required: 'Documento requerido', doc_optional: 'Documento no requerido', status: 'Estado modificado', loaded: 'Carga finalizada', cancelled: 'Carga cancelada',
  reopened: 'Carga reabierta', link: 'Vinculada con Logística', notes: 'Observaciones',
};
/* «Pedimento añadido», «Cita añadida», «DEC añadido»… */
export function eventLabel(e) {
  if (e.eventType === 'doc_added' && e.docType && e.docType !== 'otro') { const t = docType(e.docType); return `${t.label} ${t.fem ? 'añadida' : 'añadido'}`; }
  return EVENT_LABELS[e.eventType] || e.eventType;
}

/* ===== Expediente PDF (archivo derivado) ===== */
/*
 * Documentos con archivo en el orden del expediente: pedimento, DODA, cita, DEC y adicionales. El usuario puede guardar
 * otro orden (load.dossierOrder: ids) y excluir algunos (load.dossierSkip: ids); los documentos nuevos van al final.
 */
export function dossierDocs(docs, load = {}) {
  const files = sortDocs(docs).filter(hasFile), skip = new Set(load.dossierSkip || []);
  const order = Array.isArray(load.dossierOrder) ? load.dossierOrder : [];
  const byId = new Map(files.map((d) => [d.id, d]));
  const out = order.map((id) => byId.get(id)).filter(Boolean);
  for (const d of files) if (!out.includes(d)) out.push(d);
  return { all: out, included: out.filter((d) => !skip.has(d.id)), skipped: out.filter((d) => skip.has(d.id)) };
}
export const dossierFilename = (load) => `PERCONSUR-Lleno-${cleanContainer(load.containerNumber) || 'contenedor'}-${load.scheduledDate || dayStr()}.pdf`;

/* ===== Textos ===== */
export const weightText = (kg) => (Number.isFinite(Number(kg)) ? `${Number(kg).toLocaleString('en-US')} kg` : '');

/* ===== Respaldo e información compartida: solo registros con la forma esperada ===== */
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const str = (v, max = 200) => String(v ?? '').slice(0, max);
const idOr = (v) => (typeof v === 'string' && v ? v : null);
export function sanitizeLoad(r) {
  if (!r || typeof r !== 'object' || typeof r.id !== 'string') return null;
  const containerNumber = cleanContainer(r.containerNumber);
  if (!containerNumber || !isDate(r.scheduledDate) || !isLocation(r.locationType)) return null;
  const w = parseWeight(r.weightKg);
  return {
    id: r.id, containerNumber, weightKg: Number.isNaN(w) || w == null ? 0 : Math.max(0, w), reference: str(r.reference, 60), notes: str(r.notes, 500),
    locationType: r.locationType, terminalId: r.locationType === 'port' ? idOr(r.terminalId) : null, yardId: r.locationType === 'offport' ? idOr(r.yardId) : null,
    scheduledDate: r.scheduledDate, scheduledTime: isTime(r.scheduledTime) ? r.scheduledTime : '', vehicleId: idOr(r.vehicleId), operatorId: idOr(r.operatorId), trailerId: idOr(r.trailerId),
    status: isStatus(r.status) ? r.status : 'scheduled', tripId: idOr(r.tripId), logisticsOperationId: idOr(r.logisticsOperationId),
    dossierOrder: Array.isArray(r.dossierOrder) ? r.dossierOrder.filter((x) => typeof x === 'string').slice(0, 100) : [],
    dossierSkip: Array.isArray(r.dossierSkip) ? r.dossierSkip.filter((x) => typeof x === 'string').slice(0, 100) : [],
    createdAt: num(r.createdAt, Date.now()), createdBy: str(r.createdBy, 60), updatedAt: num(r.updatedAt, 0), updatedBy: str(r.updatedBy, 60), loadedAt: r.loadedAt == null ? null : num(r.loadedAt, null), deletedAt: r.deletedAt == null ? null : num(r.deletedAt, null),
  };
}
export function sanitizeDoc(d) {
  if (!d || typeof d !== 'object' || typeof d.id !== 'string' || typeof d.loadId !== 'string' || !isDocType(d.docType)) return null;
  const kind = d.kind === 'pdf' || d.kind === 'img' ? d.kind : null, storageKey = idOr(d.storageKey);
  return {
    id: d.id, loadId: d.loadId, docType: d.docType, label: str(d.label, 80), required: !!d.required, manual: !!d.manual, order: num(d.order, 0),
    name: str(d.name, 120), mimeType: kind === 'pdf' ? 'application/pdf' : kind === 'img' ? (/^image\/(jpeg|png)$/.test(d.mimeType) ? d.mimeType : 'image/jpeg') : '', kind, size: num(d.size), pages: num(d.pages), w: d.w == null ? null : num(d.w), h: d.h == null ? null : num(d.h),
    storageKey: kind ? storageKey : null, fileStatus: kind && storageKey ? (d.fileStatus === 'error' ? 'error' : 'ok') : 'none', attachedAt: d.attachedAt == null ? null : num(d.attachedAt, null),
    createdAt: num(d.createdAt, Date.now()), createdBy: str(d.createdBy, 60), updatedAt: num(d.updatedAt, 0), updatedBy: str(d.updatedBy, 60),
  };
}
export function sanitizeEvent(e) {
  if (!e || typeof e !== 'object' || typeof e.id !== 'string' || typeof e.loadId !== 'string' || typeof e.eventType !== 'string') return null;
  return { id: e.id, loadId: e.loadId, containerNumber: cleanContainer(e.containerNumber), eventType: str(e.eventType, 30), docType: isDocType(e.docType) ? e.docType : '', details: str(e.details, 300), previousStatus: isStatus(e.previousStatus) ? e.previousStatus : null, newStatus: isStatus(e.newStatus) ? e.newStatus : null, date: isDate(e.date) ? e.date : '', time: isTime(e.time) ? e.time : '', createdAt: num(e.createdAt, Date.now()), createdBy: str(e.createdBy, 60) };
}
