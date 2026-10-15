/*
 * Unidades PERCONSUR — reglas (puras: sin almacenamiento ni DOM).
 *
 * Catálogo único: cada unidad es un registro del store «vehicles» con id inmutable (el mismo que ya usan Logística,
 * GPS, Taller, Combustible, Control de llenos y de vacíos). La empresa del registro antiguo (company) se conserva solo
 * como dato de origen: ya no separa catálogos.
 *
 * Documentos (unitDocuments): cinco categorías fijas. Cada registro guarda su archivo y, si aplica, su periodo:
 *   { id, unitId, docType, storageKey, name, mimeType, kind:'pdf'|'img', size, pages, uploadedAt, uploadedBy,
 *     issueDate?, validFrom?, validUntil?, noExpiry?, verificationStatus:'confirmed'|'manual'|'pending',
 *     dateSource:'extracted'|'manual'|'pending', insurer?, policyNumber?, folio?, notes?, extraction?,
 *     status:'current'|'archived', archivedAt?, selected?, revisions[] }
 * El estado de vigencia NUNCA se guarda: se calcula con las fechas y el día de hoy en la zona horaria operativa.
 */
export const OPS_TZ = 'America/Mexico_City';
export const SOON_DAYS = 15;

export const DOC_TYPES = [
  { key: 'registration', label: 'Tarjeta de circulación', upload: 'Subir tarjeta de circulación', fields: ['issueDate', 'validUntil', 'folio'], validity: 'optional' },
  { key: 'insurance', label: 'Póliza de seguro', upload: 'Subir póliza de seguro', fields: ['insurer', 'policyNumber', 'issueDate', 'validFrom', 'validUntil'], validity: 'expected' },
  { key: 'payment_complement', label: 'Complemento de pago', upload: 'Subir complemento de pago', fields: ['issueDate', 'validFrom', 'validUntil'], validity: 'required', multi: true },
  { key: 'mechanical_inspection', label: 'Verificación físico-mecánica', upload: 'Subir verificación físico-mecánica', fields: ['issueDate', 'validFrom', 'validUntil', 'folio'], validity: 'expected' },
  { key: 'low_emissions_certificate', label: 'Certificado de Bajas Emisiones Contaminantes', upload: 'Subir Certificado de Bajas Emisiones Contaminantes', fields: ['issueDate', 'validFrom', 'validUntil', 'folio'], validity: 'expected' },
];
export const DOC_KEYS = DOC_TYPES.map((d) => d.key);
export const docType = (k) => DOC_TYPES.find((d) => d.key === k) || null;
export const FIELD_LABELS = { issueDate: 'Fecha de emisión', validFrom: 'Inicio de vigencia', validUntil: 'Fin de vigencia', folio: 'Folio o referencia', insurer: 'Aseguradora', policyNumber: 'Número de póliza' };

export const VEHICLE_TYPES = [['tractocamion', 'Tractocamión'], ['torton', 'Camión torton'], ['rabon', 'Camión rabón'], ['camioneta', 'Camioneta'], ['otro', 'Otro']];
export const vehicleTypeLabel = (k) => (VEHICLE_TYPES.find(([v]) => v === k) || [null, 'Sin tipo'])[1];
/* Documentos requeridos por tipo de unidad (configurable en Unidades → Requisitos). Las cinco categorías siempre se
   muestran; «no requerido» solo cambia si cuenta para el expediente completo. */
export const DEFAULT_REQUIREMENTS = {
  '': DOC_KEYS, tractocamion: DOC_KEYS, torton: DOC_KEYS, rabon: DOC_KEYS,
  camioneta: ['registration', 'insurance', 'payment_complement'], otro: ['registration', 'insurance'],
};
export function requiredFor(unit, config = null) {
  const t = (unit && unit.vehicleType) || '';
  const c = config && Array.isArray(config[t]) ? config[t] : DEFAULT_REQUIREMENTS[t] || DEFAULT_REQUIREMENTS[''];
  return DOC_KEYS.filter((k) => c.includes(k));
}

/* ===== Fechas ===== */
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
export { isDate };
/* Día de hoy (AAAA-MM-DD) en la zona horaria operativa */
export function todayIn(tz = OPS_TZ, now = new Date()) {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}`;
  } catch (e) { const d = now; return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
}
/* Días calendario de a hasta b (b − a) */
export const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MES3 = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const dateLong = (s) => (isDate(s) ? `${+s.slice(8, 10)} de ${MES[+s.slice(5, 7) - 1]} de ${s.slice(0, 4)}` : '');
export const dateShort = (s) => (isDate(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '');
export const dateMed = (s) => (isDate(s) ? `${+s.slice(8, 10)} ${MES3[+s.slice(5, 7) - 1]} ${s.slice(0, 4)}` : '');
/* «11 días restantes», «1 día restante», «Vence hoy», «Vencido hace 1 día» (nunca números negativos) */
export function daysText(days) {
  if (days == null) return '';
  if (days === 0) return 'Vence hoy';
  if (days > 0) return days === 1 ? '1 día restante' : `${days} días restantes`;
  const n = -days;
  return n === 1 ? 'Vencido hace 1 día' : `Vencido hace ${n} días`;
}

/* ===== Vigencia de un documento ===== */
export const VALIDITY = {
  valid: { label: 'Vigente', tone: 'ok' },
  soon: { label: 'Próximo a vencer', tone: 'warn' },
  today: { label: 'Vence hoy', tone: 'alert' },
  expired: { label: 'Vencido', tone: 'danger' },
  future: { label: 'Vigencia futura', tone: 'info' },
  pending: { label: 'Vigencia por verificar', tone: 'muted' },
  attached: { label: 'Adjuntado', tone: 'ok' },
  missing: { label: 'Pendiente', tone: 'muted' },
  none: { label: 'Sin documento', tone: 'muted' },
  notRequired: { label: 'No requerido', tone: 'muted' },
};
/*
 * Estado de vigencia de un documento: { key, label, tone, days, until, note }
 *   days = días que faltan para que termine (negativo si ya terminó); en vigencia futura, días para que empiece.
 * Un archivo sin fechas confirmadas nunca se da por vigente: queda «Vigencia por verificar» salvo que el tipo no
 * maneje vigencia (tarjeta de circulación) o el usuario haya confirmado que el documento no indica vencimiento.
 */
export function validityOf(doc, today, { soon = SOON_DAYS } = {}) {
  const mk = (key, extra = {}) => ({ key, ...VALIDITY[key], days: null, until: null, note: '', ...extra });
  if (!doc || !doc.storageKey) return mk('none');
  const t = docType(doc.docType) || { validity: 'optional' };
  const verified = doc.verificationStatus === 'confirmed' || doc.verificationStatus === 'manual';
  const until = verified && isDate(doc.validUntil) ? doc.validUntil : null;
  const from = verified && isDate(doc.validFrom) ? doc.validFrom : null;
  if (!until) {
    if (doc.noExpiry && verified) return mk('attached', { note: 'El documento no indica vencimiento' });
    if (t.validity === 'optional' && !(doc.verificationStatus === 'pending' && (doc.validUntil || doc.validFrom))) return mk('attached');
    return mk('pending', { note: doc.validUntil || doc.validFrom ? 'Fechas sin confirmar' : 'Sin fechas registradas' });
  }
  if (from && from > today) return mk('future', { days: daysBetween(today, from), until, from, note: `Inicia en ${daysBetween(today, from)} día${daysBetween(today, from) === 1 ? '' : 's'}` });
  const days = daysBetween(today, until);
  if (days < 0) return mk('expired', { days, until, from, note: daysText(days) });
  if (days === 0) return mk('today', { days, until, from, note: 'Vence hoy' });
  if (days <= soon) return mk('soon', { days, until, from, note: daysText(days) });
  return mk('valid', { days, until, from, note: daysText(days) });
}

/* ===== Complementos de pago (varios por unidad) ===== */
const periodOf = (d) => (d && (d.verificationStatus === 'confirmed' || d.verificationStatus === 'manual') && isDate(d.validFrom) && isDate(d.validUntil) ? { from: d.validFrom, to: d.validUntil } : null);
/*
 * Cuál cubre hoy, cuál es la próxima cobertura y qué periodos se enciman.
 * → { active, upcoming, last, pending: [sin confirmar], overlaps: [[a,b]], ambiguous }
 *   active: el que cubre hoy (si varios lo cubren y el usuario eligió uno con «selected», ese; si no, ambiguous=true)
 *   last: el último periodo confirmado ya terminado (para mostrar «Vencido» cuando no hay cobertura)
 * Nunca se elige un complemento solo por ser el último que se subió.
 */
export function complementState(docs, today) {
  const list = (docs || []).filter((d) => d.docType === 'payment_complement' && d.status !== 'archived' && d.storageKey);
  const withP = list.map((d) => ({ d, p: periodOf(d) })).filter((x) => x.p);
  const pending = list.filter((d) => !periodOf(d));
  const covering = withP.filter((x) => x.p.from <= today && x.p.to >= today);
  let active = null, ambiguous = false;
  if (covering.length === 1) active = covering[0].d;
  else if (covering.length > 1) {
    const sel = covering.filter((x) => x.d.selected);
    if (sel.length === 1) active = sel[0].d;
    else { ambiguous = true; active = covering.sort((a, b) => (b.p.to.localeCompare(a.p.to)))[0].d; }
  }
  const upcoming = withP.filter((x) => x.p.from > today).sort((a, b) => a.p.from.localeCompare(b.p.from))[0];
  const last = withP.filter((x) => x.p.to < today).sort((a, b) => b.p.to.localeCompare(a.p.to))[0];
  const overlaps = [];
  for (let i = 0; i < withP.length; i++) for (let j = i + 1; j < withP.length; j++) {
    const a = withP[i].p, b = withP[j].p;
    /* Se enciman si comparten más de un día (un día de corte compartido es normal: «11/10 al 11/11» y «11/11 al 11/12») */
    const start = a.from > b.from ? a.from : b.from, end = a.to < b.to ? a.to : b.to;
    if (daysBetween(start, end) >= 1) overlaps.push([withP[i].d.id, withP[j].d.id]);
  }
  return { active, upcoming: upcoming ? upcoming.d : null, last: last ? last.d : null, pending, overlaps, ambiguous };
}

/* Documento vigente (versión actual) de cada tipo; para el complemento, el que cubre hoy (o el más relevante) */
export function currentDocs(docs, today) {
  const out = {};
  for (const t of DOC_KEYS) {
    if (t === 'payment_complement') {
      const c = complementState(docs, today);
      out[t] = c.active || (c.pending.length ? c.pending.sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0))[0] : null) || c.upcoming || c.last || null;
      continue;
    }
    out[t] = (docs || []).filter((d) => d.docType === t && d.status !== 'archived' && d.storageKey).sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0))[0] || null;
  }
  return out;
}

/*
 * Estado documental de una unidad.
 * → { required, total, complete, isComplete, items: { type: { doc, v, required } }, missing, expired, today, soon, pending,
 *     next: { type, until, days } (próximo vencimiento entre los documentos vigentes) , alerts }
 * «Completo» = archivo presente y, si maneja vigencia, confirmada y no vencida. Un documento no requerido no cuenta.
 */
export function unitStatus(unit, docs, today, { config = null, soon = SOON_DAYS } = {}) {
  const required = requiredFor(unit, config);
  const cur = currentDocs((docs || []).filter((d) => d.unitId === unit.id), today);
  const items = {};
  const out = { required, total: required.length, complete: 0, missing: [], expired: [], today: [], soon: [], pending: [], future: [] };
  for (const t of DOC_KEYS) {
    const req = required.includes(t), v = validityOf(cur[t], today, { soon });
    items[t] = { doc: cur[t], v, required: req };
    if (v.key === 'none') { if (req) out.missing.push(t); continue; }
    if (v.key === 'expired') out.expired.push(t);
    else if (v.key === 'today') out.today.push(t);
    else if (v.key === 'soon') out.soon.push(t);
    else if (v.key === 'pending') out.pending.push(t);
    else if (v.key === 'future') out.future.push(t);
    if (req && ['valid', 'soon', 'today', 'attached'].includes(v.key)) out.complete++;
  }
  out.items = items;
  out.isComplete = out.complete === out.total;
  const nexts = DOC_KEYS.map((t) => ({ type: t, v: items[t].v })).filter((x) => x.v.until && x.v.days != null && ['valid', 'soon', 'today'].includes(x.v.key)).sort((a, b) => a.v.days - b.v.days);
  out.next = nexts[0] ? { type: nexts[0].type, until: nexts[0].v.until, days: nexts[0].v.days } : null;
  out.label = out.isComplete ? 'Expediente completo' : 'Expediente incompleto';
  return out;
}

/* ===== Listado: búsqueda, filtros e indicadores ===== */
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const plateKey = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const normEco = (v) => String(v || '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
export const ecoText = (eco) => { const e = normEco(eco); return e ? e.padStart(3, '0') : '—'; };
export const unitTitle = (u) => `UNIDAD ${ecoText(u && u.eco)}`;
export const isActive = (u) => !!u && u.active !== 'no' && !u.mergedInto;
/* Búsqueda por número económico, placas, marca, modelo o VIN/NIV («21» encuentra la 021; «JN-12» las placas JN12…) */
export function matchUnit(u, q) {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const eco = normEco(u.eco), hay = fold([u.brand, u.model, u.year, u.vin, u.placas, u.desc, vehicleTypeLabel(u.vehicleType)].join(' '));
  const plates = plateKey(u.placas), vin = plateKey(u.vin);
  return words.every((w) => {
    const d = normEco(w);
    if (/^\d+$/.test(w) && d && eco === d) return true;
    const pk = plateKey(w);
    return hay.includes(w) || (pk.length >= 2 && (plates.includes(pk) || vin.includes(pk))) || (/^u?\d+$/.test(w) && eco === normEco(w));
  });
}
export const FILTERS = [
  ['all', 'Todas'], ['complete', 'Documentación completa'], ['incomplete', 'Documentación incompleta'], ['soon', 'Próximos vencimientos'],
  ['expired', 'Documentos vencidos'], ['active', 'Unidades activas'], ['inactive', 'Unidades inactivas'],
];
export function passFilter(u, st, f) {
  switch (f) {
    case 'complete': return st.isComplete;
    case 'incomplete': return !st.isComplete;
    case 'soon': return st.soon.length + st.today.length > 0;
    case 'expired': return st.expired.length > 0;
    case 'active': return isActive(u);
    case 'inactive': return !isActive(u);
    default: return true;
  }
}
/* Indicadores del listado (solo unidades del catálogo, sin las unidas a otra) */
export function fleetSummary(rows) {
  const s = { total: rows.length, complete: 0, soonDocs: 0, expiredDocs: 0, incomplete: 0, soonUnits: 0, expiredUnits: 0 };
  for (const { st } of rows) {
    if (st.isComplete) s.complete++; else s.incomplete++;
    s.soonDocs += st.soon.length + st.today.length; s.expiredDocs += st.expired.length;
    if (st.soon.length + st.today.length) s.soonUnits++;
    if (st.expired.length) s.expiredUnits++;
  }
  return s;
}
/* Orden del listado: número económico (las inactivas al final) */
export const byEco = (a, b) => (isActive(a) === isActive(b) ? 0 : isActive(a) ? -1 : 1) || (+normEco(a.eco) || 1e9) - (+normEco(b.eco) || 1e9) || String(a.placas || '').localeCompare(String(b.placas || ''));

/* ===== Vencimientos (tablero de alertas) ===== */
export const ALERT_WINDOWS = [['expired', 'Vencidos'], ['today', 'Vencen hoy'], ['7', 'Próximos 7 días'], ['15', 'Próximos 15 días'], ['30', 'Próximos 30 días'], ['all', 'Todos']];
/* Una fila por documento con fecha de fin: { unit, type, doc, v } */
export function alertRows(rows, today, { window = '30', soon = SOON_DAYS } = {}) {
  const out = [];
  for (const { unit, st } of rows) {
    for (const t of DOC_KEYS) {
      const it = st.items[t]; if (!it || !it.v.until || it.v.key === 'future') continue;
      const d = it.v.days;
      const pass = window === 'all' ? true : window === 'expired' ? d < 0 : window === 'today' ? d === 0 : d >= 0 && d <= +window;
      if (pass) out.push({ unit, type: t, doc: it.doc, v: it.v });
    }
  }
  return out;
}
export const ALERT_SORTS = [['days', 'Menos días restantes'], ['type', 'Tipo de documento'], ['unit', 'Unidad'], ['state', 'Estado']];
const STATE_ORDER = ['expired', 'today', 'soon', 'valid'];
export function sortAlerts(list, by = 'days') {
  const cmp = {
    days: (a, b) => a.v.days - b.v.days,
    type: (a, b) => DOC_KEYS.indexOf(a.type) - DOC_KEYS.indexOf(b.type) || a.v.days - b.v.days,
    unit: (a, b) => byEco(a.unit, b.unit) || a.v.days - b.v.days,
    state: (a, b) => STATE_ORDER.indexOf(a.v.key) - STATE_ORDER.indexOf(b.v.key) || a.v.days - b.v.days,
  }[by] || ((a, b) => a.v.days - b.v.days);
  return list.slice().sort(cmp);
}

/* ===== Migración: posibles registros duplicados de una misma unidad ===== */
/*
 * Agrupa registros que parecen la misma unidad: mismo VIN/NIV, mismas placas o mismo número económico.
 * → [{ ids:[...], by:['vin'|'placas'|'eco'], conflicts:[campo], kind:'exact'|'conflict' }]
 * exact: ningún dato no vacío se contradice (VIN, placas, número económico, marca, modelo, año).
 * Nada se une solo: la pantalla de revisión decide (y se puede marcar «no son la misma unidad»).
 */
export function duplicateGroups(vehicles) {
  const live = (vehicles || []).filter((v) => v && v.id && !v.mergedInto);
  const parent = new Map(live.map((v) => [v.id, v.id]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const distinct = (a, b) => (a.notDuplicateOf || []).includes(b.id) || (b.notDuplicateOf || []).includes(a.id);
  const why = new Map();
  const keys = { vin: (v) => plateKey(v.vin), placas: (v) => plateKey(v.placas), eco: (v) => normEco(v.eco) };
  for (const [k, fn] of Object.entries(keys)) {
    const by = new Map();
    for (const v of live) { const key = fn(v); if (!key || (k === 'vin' && key.length < 6)) continue; (by.get(key) || by.set(key, []).get(key)).push(v); }
    for (const arr of by.values()) for (let i = 1; i < arr.length; i++) {
      if (distinct(arr[0], arr[i])) continue;
      const a = find(arr[0].id), b = find(arr[i].id);
      if (a !== b) parent.set(b, a);
      const r = find(arr[0].id); (why.get(r) || why.set(r, new Set()).get(r)).add(k);
    }
  }
  const groups = new Map();
  for (const v of live) { const r = find(v.id); (groups.get(r) || groups.set(r, []).get(r)).push(v); }
  const out = [];
  for (const [r, arr] of groups) {
    if (arr.length < 2) continue;
    const by = new Set(); for (const [root, s] of why) if (find(root) === r) s.forEach((x) => by.add(x));
    const conflicts = [];
    const cmp = { eco: (v) => normEco(v.eco), placas: (v) => plateKey(v.placas), vin: (v) => plateKey(v.vin), brand: (v) => fold(v.brand), model: (v) => fold(v.model), year: (v) => String(v.year || '') };
    for (const [f, fn] of Object.entries(cmp)) { const vals = new Set(arr.map(fn).filter(Boolean)); if (vals.size > 1) conflicts.push(f); }
    out.push({ ids: arr.map((v) => v.id), by: [...by], conflicts, kind: conflicts.length ? 'conflict' : 'exact' });
  }
  return out;
}
/* Datos combinados al unir: el registro que se conserva manda; los vacíos se completan con los del otro */
export const MERGE_FIELDS = ['eco', 'placas', 'vin', 'brand', 'model', 'year', 'vehicleType', 'color', 'desc', 'notes', 'gpsDeviceId', 'gpsProvider', 'trackingUrl'];
export function mergedData(keep, others) {
  const out = { ...keep };
  for (const f of MERGE_FIELDS) if (!out[f]) { const o = others.find((x) => x[f]); if (o) out[f] = o[f]; }
  return out;
}

/* ===== Validación de datos generales ===== */
export function checkUnit(data, all = [], selfId = null) {
  const err = {};
  const eco = normEco(data.eco);
  if (!eco) err.eco = 'Escribe el número económico (solo dígitos).';
  const others = (all || []).filter((v) => v.id !== selfId && !v.mergedInto);
  if (eco && others.some((v) => normEco(v.eco) === eco)) err.eco = `Ya existe la ${unitTitle({ eco })} en el catálogo.`;
  const pk = plateKey(data.placas);
  if (pk && others.some((v) => plateKey(v.placas) === pk)) err.placas = 'Esas placas ya están registradas en otra unidad.';
  const vin = plateKey(data.vin);
  if (vin && !/^[A-HJ-NPR-Z0-9]{11,17}$/.test(vin)) err.vin = 'El VIN/NIV tiene de 11 a 17 caracteres (sin I, O ni Q).';
  else if (vin && others.some((v) => plateKey(v.vin) === vin)) err.vin = 'Ese VIN/NIV ya está registrado en otra unidad.';
  const y = String(data.year || '').trim();
  if (y && !(/^\d{4}$/.test(y) && +y >= 1950 && +y <= new Date().getFullYear() + 2)) err.year = 'Año no válido.';
  return err;
}

/* ===== Respaldo / sincronización: forma esperada ===== */
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const dOrNull = (s) => (isDate(s) ? s : null);
const str = (s, n = 200) => String(s == null ? '' : s).slice(0, n);
export function sanitizeUnitDoc(r) {
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || typeof r.unitId !== 'string' || !DOC_KEYS.includes(r.docType)) return null;
  return {
    ...r, kind: r.kind === 'pdf' || r.kind === 'img' ? r.kind : null, issueDate: dOrNull(r.issueDate), validFrom: dOrNull(r.validFrom), validUntil: dOrNull(r.validUntil),
    verificationStatus: ['confirmed', 'manual', 'pending'].includes(r.verificationStatus) ? r.verificationStatus : 'pending',
    dateSource: ['extracted', 'manual', 'pending'].includes(r.dateSource) ? r.dateSource : 'pending',
    status: r.status === 'archived' ? 'archived' : 'current', noExpiry: !!r.noExpiry, selected: !!r.selected,
    insurer: str(r.insurer), policyNumber: str(r.policyNumber, 80), folio: str(r.folio, 120), notes: str(r.notes, 2000), name: str(r.name, 240),
    uploadedAt: Number(r.uploadedAt) || 0, size: Number(r.size) || 0, pages: Number(r.pages) || 0, revisions: Array.isArray(r.revisions) ? r.revisions.slice(-50) : [],
  };
}
export const CAPTURE_SOURCES = ['exif', 'app_capture', 'manual', 'unknown'];
export function sanitizeUnitPhoto(r) {
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || typeof r.unitId !== 'string' || !['front', 'license_plate'].includes(r.photoType)) return null;
  const src = CAPTURE_SOURCES.includes(r.captureDateSource) ? r.captureDateSource : 'unknown';
  const cap = typeof r.capturedAt === 'string' && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/.test(r.capturedAt) ? r.capturedAt : null;
  return { ...r, capturedAt: src === 'unknown' ? null : cap, captureDateSource: cap ? src : 'unknown', capturedOffset: /^[+-]\d{2}:\d{2}$/.test(r.capturedOffset || '') ? r.capturedOffset : null,
    uploadedAt: Number(r.uploadedAt) || 0, status: r.status === 'archived' ? 'archived' : 'current' };
}
export function sanitizeUnitEvent(r) {
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || typeof r.unitId !== 'string' || !own(r, 'type')) return null;
  return { ...r, type: str(r.type, 40), details: str(r.details, 500), at: Number(r.at) || 0, by: str(r.by, 80) };
}
