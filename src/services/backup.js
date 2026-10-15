/*
 * Respaldo local en JSON. Formato:
 *   { app:'perconsur', format:1, version, exportedAt, includeMedia, data:{ <store>: [...] } }
 * Documentos adicionales de viajes: los metadatos (tripAttachments, con su tripId) siempre; sus archivos (owner trip:)
 * viajan con los PDF en el respaldo completo. Sin archivo, el adjunto se muestra como no procesable (reintentar o eliminar).
 * Los archivos (fotos, PDF, adjuntos) viajan en base64 dentro de data.attachments.
 * Los borradores siempre incluyen sus fotos; las de documentos generados solo si includeMedia.
 * La importación valida el archivo y COMBINA (no borra nada existente).
 * También acepta el volcado del sistema anterior (claves ner-*) generado con tools/exportar-datos-anteriores.html.
 */
import * as db from './db.js';
import { APP_VERSION } from '../config/reference.js';
import { migrateLegacy } from './migration.js';
import { loadSettings } from './settings.js';
import { loadCatalogs } from './catalogs.js';
import { loadCompanies } from './companies.js';
import { loadOperatorData } from './operators.js';
import { resetBillingCache } from './billing.js';
import { loadLogistics } from './logistics.js';
import { loadTripAttachments } from './tripAttachments.js';
import { loadEmpties } from './empties.js';
import { loadGeocodes } from './geocode.js';
import { loadFuel } from './fuel.js';
import { loadMaintenance } from './maintenance.js';
import { loadTariffs } from './tariffs.js';
import { loadUnits } from './units.js';
import { loadFulls } from './fulls.js';
import { sanitizeSheet } from '../domain/tariffs/tariffs.js';
import { sanitizeLoad, sanitizeDoc, sanitizeEvent } from '../domain/fulls/fulls.js';
import { sanitizeDestState } from '../domain/geo/mexico.js';
import { sanitizeUnitDoc, sanitizeUnitPhoto, sanitizeUnitEvent } from '../domain/units/units.js';
import { ORDER_TYPES, ORDER_STATUSES, SEVERITIES, ACTIONS, WORK_STATUSES, WORK_TYPES, TIRE_REASONS } from '../domain/maintenance/catalog.js';
import { TIRE_LAYOUTS } from '../domain/maintenance/maintenance.js';
import { SYNC_SETTINGS } from '../domain/sync/sync.js';
import { COMPANY_DEFAULTS, EDITABLE_FIELDS, PUERTO_COMPANIES } from '../config/companies.js';

const DATA_STORES = ['settings', 'companies', 'counters', 'operators', 'vehicles', 'trailers', 'places', 'plants', 'terminals', 'drafts', 'documents',
  'operatorSettings', 'operatorTrips', 'operatorLoans', 'operatorAdjustments', 'operatorStatements'];
const OP_STORES = ['operatorSettings', 'operatorTrips', 'operatorLoans', 'operatorAdjustments', 'operatorStatements'];
DATA_STORES.push('fuelRecords', 'tripBilling', 'logisticsOperations', 'tripAttachments', 'yards', 'emptyContainers', 'emptyContainerEvents', 'geocodes');
/* Taller (v10): órdenes, trabajos, fallas, intervenciones del diagrama, llantas, aceite, fotos, bitácora y configuración */
const MT_STORES = ['maintenanceOrders', 'maintenanceServices', 'maintenanceIssues', 'maintenanceComponents', 'tireReplacements', 'oilChanges',
  'maintenanceAttachments', 'maintenanceEvents', 'maintenanceProfiles', 'maintenanceParts'];
DATA_STORES.push(...MT_STORES);
/* Tarifas (v11): un registro por apartado con sus rutas */
DATA_STORES.push('tariffSheets');
/* Control de llenos (v12): patios de carga, cargas programadas, sus documentos (el archivo viaja con los PDF en el respaldo
   completo; sin él, el documento se muestra como no disponible) y su historial */
DATA_STORES.push('loadingYards', 'fullContainerLoads', 'fullContainerDocuments', 'fullContainerEvents');
/* Mapa de viajes (v13): entidad asignada a mano a textos de destino */
DATA_STORES.push('destStates');
/* Unidades (v14): documentos, fotografías e historial del expediente (los archivos van en el respaldo completo) */
DATA_STORES.push('unitDocuments', 'unitPhotos', 'unitEvents');
/* Ajustes que nunca se importan: control interno, la clave del GPS y la dirección del GPS (un respaldo no puede
   cambiar a dónde se envía la clave de este dispositivo), los avisos pendientes de rastreo de este dispositivo y la
   configuración de Información compartida (clave, papel e identificador de este dispositivo) */
const SKIP_SETTINGS = new Set(['seeded', 'legacyMigrated', 'gpsKey', 'gpsUrl', 'trackQueue', ...SYNC_SETTINGS]);
/* Ajustes que nunca salen del dispositivo en un respaldo */
const NO_EXPORT = new Set(['gpsKey', 'trackQueue', ...SYNC_SETTINGS]);

/*
 * Un respaldo es un archivo externo (llega por WhatsApp, correo…): antes de guardarlo se validan los campos que la app
 * usa como valores fijos (tipos, estados, números) y se descartan los que no corresponden. Las pantallas además escapan
 * todo lo que muestran; esto evita que un archivo manipulado deje datos con forma inesperada en el dispositivo.
 */
const MIME_OK = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const numOr = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
export function sanitizeImport(data) {
  const rowsOf = (k) => (Array.isArray(data[k]) ? data[k] : []).filter((r) => r && typeof r === 'object' && !Array.isArray(r));
  for (const k of Object.keys(data)) if (Array.isArray(data[k])) data[k] = rowsOf(k);
  /* Empresas: solo los textos editables (logotipo, colores y serie de folio son fijos) */
  data.companies = rowsOf('companies').filter((r) => typeof r.key === 'string' && own(COMPANY_DEFAULTS, r.key)).map((r) => {
    const o = r.overrides && typeof r.overrides === 'object' ? r.overrides : {}, overrides = {};
    for (const [k] of EDITABLE_FIELDS) if (typeof o[k] === 'string') overrides[k] = o[k];
    return { key: r.key, overrides, updatedAt: numOr(r.updatedAt, Date.now()) };
  });
  data.settings = rowsOf('settings').filter((r) => typeof r.key === 'string' && !SKIP_SETTINGS.has(r.key)
    && (r.key !== 'lastCompany' || PUERTO_COMPANIES.includes(r.value)));
  /* Archivos: solo tipos inertes (PDF e imágenes) */
  for (const a of rowsOf('attachments')) if (!MIME_OK.has(a.type)) a.type = 'application/octet-stream';
  data.tripAttachments = rowsOf('tripAttachments').filter((a) => a.kind === 'pdf' || a.kind === 'img').map((a) => ({
    ...a, mimeType: a.kind === 'pdf' ? 'application/pdf' : MIME_OK.has(a.mimeType) && a.mimeType !== 'application/pdf' ? a.mimeType : 'image/jpeg', size: numOr(a.size), pages: numOr(a.pages),
  }));
  data.documents = rowsOf('documents').filter((d) => d.type === 'puerto' || d.type === 'campo').map((d) => ({
    ...d, status: d.status === 'compartido' ? 'compartido' : 'generado', pages: numOr(d.pages), size: numOr(d.size),
    company: d.type === 'puerto' && !PUERTO_COMPANIES.includes(d.company) ? 'perconsur' : d.company,
  }));
  data.drafts = rowsOf('drafts').filter((d) => d.type === 'campo' || (d.type === 'puerto' && PUERTO_COMPANIES.includes(d.company))).map((d) => {
    const out = { ...d, step: Number.isInteger(d.step) && d.step >= 0 && d.step < 20 ? d.step : 0 };
    if (out.data && Array.isArray(out.data.attachments)) {
      out.data = { ...out.data, attachments: out.data.attachments.filter((x) => x && (x.kind === 'pdf' || x.kind === 'img')).map((x) => ({ ...x, pages: numOr(x.pages), size: numOr(x.size) })) };
    }
    return out;
  });
  for (const t of rowsOf('operatorTrips')) if (t.division !== 'puerto' && t.division !== 'campo') t.division = 'puerto';
  for (const st of rowsOf('operatorStatements')) st.pages = numOr(st.pages);
  for (const st of rowsOf('operatorSettings')) if (st.satManual != null && !Number.isInteger(Number(st.satManual))) st.satManual = null; else if (st.satManual != null) st.satManual = Number(st.satManual);
  for (const f of rowsOf('fuelRecords')) f.liters = numOr(f.liters);
  /* Taller: valores fijos (tipos, estados, gravedad, acciones) y números; lo que no corresponde se descarta */
  const keys = (list) => new Set(list.map((x) => (Array.isArray(x) ? x[0] : x.key)));
  const OT = keys(ORDER_TYPES), OS = keys(ORDER_STATUSES), SV = keys(SEVERITIES), AC = keys(ACTIONS), WS = keys(WORK_STATUSES), WT = keys(WORK_TYPES), TR = keys(TIRE_REASONS);
  const okKind = (k) => ['tractor', 'chasis', 'jaula', 'tolva'].includes(k);
  const ts = (v) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  data.maintenanceOrders = rowsOf('maintenanceOrders').filter((o) => typeof o.id === 'string' && (o.equipmentType === 'vehicle' || o.equipmentType === 'trailer') && okKind(o.kind) && Number.isFinite(Number(o.inAt))).map((o) => ({
    ...o, type: OT.has(o.type) ? o.type : 'general', status: OS.has(o.status) ? o.status : 'reportado', inAt: Number(o.inAt), outAt: ts(o.outAt),
    odometer: o.equipmentType === 'vehicle' && ts(o.odometer) != null && ts(o.odometer) >= 0 ? ts(o.odometer) : null, folio: String(o.folio || ''),
  })).filter((o) => o.outAt == null || o.outAt >= o.inAt);
  const work = (r) => ({ ...r, severity: SV.has(r.severity) ? r.severity : '', action: AC.has(r.action) ? r.action : '', replaced: r.action === 'reemplazado' || !!r.replaced, date: ts(r.date) });
  data.maintenanceServices = rowsOf('maintenanceServices').filter((r) => typeof r.orderId === 'string').map((r) => ({ ...work(r), type: WT.has(r.type) ? r.type : 'otro', workStatus: WS.has(r.workStatus) ? r.workStatus : 'terminado' }));
  data.maintenanceComponents = rowsOf('maintenanceComponents').filter((r) => typeof r.orderId === 'string' && typeof r.componentId === 'string').map(work);
  data.maintenanceIssues = rowsOf('maintenanceIssues').filter((r) => okKind(r.kind) && Number.isFinite(Number(r.date))).map((r) => ({ ...r, date: Number(r.date), severity: SV.has(r.severity) ? r.severity : 'leve' }));
  data.tireReplacements = rowsOf('tireReplacements').filter((r) => typeof r.orderId === 'string').map((r) => ({
    ...r, quantity: Math.max(1, Math.min(24, Math.round(numOr(r.quantity, 1)))), positions: Array.isArray(r.positions) ? r.positions.filter((x) => typeof x === 'string').slice(0, 24) : [],
    layout: TIRE_LAYOUTS[r.layout] ? r.layout : null, reason: TR.has(r.reason) ? r.reason : 'otro', date: ts(r.date),
  }));
  data.oilChanges = rowsOf('oilChanges').filter((r) => typeof r.orderId === 'string').map((r) => ({ ...r, odometer: Math.max(0, numOr(r.odometer)), liters: r.liters == null ? null : Math.max(0, numOr(r.liters)), date: ts(r.date) }));
  data.maintenanceProfiles = rowsOf('maintenanceProfiles').filter((r) => typeof r.id === 'string').map((r) => ({ ...r, oilKm: r.oilKm == null ? null : Math.max(0, numOr(r.oilKm)), oilDays: r.oilDays == null ? null : Math.max(0, numOr(r.oilDays)), tireLayout: TIRE_LAYOUTS[r.tireLayout] ? r.tireLayout : null }));
  data.maintenanceParts = rowsOf('maintenanceParts').filter((r) => typeof r.id === 'string' && okKind(r.kind) && typeof r.name === 'string');
  data.tariffSheets = rowsOf('tariffSheets').map(sanitizeSheet).filter(Boolean);
  /* Control de llenos: solo cargas, documentos y movimientos con la forma esperada (ubicación, estados, tipos de documento) */
  data.loadingYards = rowsOf('loadingYards').filter((y) => typeof y.id === 'string' && typeof y.name === 'string' && y.name.trim());
  data.fullContainerLoads = rowsOf('fullContainerLoads').map(sanitizeLoad).filter(Boolean);
  data.fullContainerDocuments = rowsOf('fullContainerDocuments').map(sanitizeDoc).filter(Boolean);
  data.fullContainerEvents = rowsOf('fullContainerEvents').map(sanitizeEvent).filter(Boolean);
  /* Mapa de viajes: solo claves de entidad válidas ('01'–'32' o 'EXT') */
  data.destStates = rowsOf('destStates').map(sanitizeDestState).filter(Boolean);
  /* Unidades: solo tipos de documento, fotografías y fuentes de fecha conocidas */
  data.unitDocuments = rowsOf('unitDocuments').map(sanitizeUnitDoc).filter(Boolean);
  data.unitPhotos = rowsOf('unitPhotos').map(sanitizeUnitPhoto).filter(Boolean);
  data.unitEvents = rowsOf('unitEvents').map(sanitizeUnitEvent).filter(Boolean);
  return data;
}

const b64 = {
  from(buf) { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); },
  to(str) { const bin = atob(str); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; },
};

export async function exportBackup({ includeMedia = false } = {}) {
  const data = {};
  for (const s of DATA_STORES) data[s] = await db.all(s);
  /* Las claves del intermediario GPS y de Información compartida no viajan en los respaldos (se vuelven a capturar en Ajustes) */
  data.settings = (data.settings || []).filter((r) => !NO_EXPORT.has(r.key));
  const atts = await db.all(db.S.attachments);
  data.attachments = atts
    /* Borradores, fotografías de operadores y evidencias del Taller siempre; PDF y fotos de documentos solo en el respaldo completo */
    .filter((a) => includeMedia || /^(draft|op|mt):/.test(String(a.owner || '')))
    .map(({ buf, ...rest }) => ({ ...rest, b64: b64.from(buf) }));
  const json = JSON.stringify({ app: 'perconsur', format: 1, version: APP_VERSION, exportedAt: new Date().toISOString(), includeMedia, data });
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  const name = `PERCONSUR-respaldo-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
  return new File([json], name, { type: 'application/json' });
}

/* Valida y describe un archivo antes de importarlo */
export async function inspectBackup(file) {
  if (!file) throw new Error('No se eligió ningún archivo.');
  if (file.size > 400 * 1024 * 1024) throw new Error('El archivo es demasiado grande para importarse en este dispositivo.');
  let obj;
  try { obj = JSON.parse(await file.text()); } catch (e) { throw new Error('El archivo no es un respaldo válido (no es JSON).'); }
  if (obj && obj.app === 'perconsur') {
    if (obj.format !== 1 || !obj.data || typeof obj.data !== 'object') throw new Error('El respaldo es de una versión no compatible.');
    for (const [k, v] of Object.entries(obj.data)) if (!Array.isArray(v)) throw new Error(`El respaldo está dañado (sección «${k}»).`);
    const n = (k) => (obj.data[k] || []).length;
    return {
      kind: 'backup', obj,
      lines: [
        `Documentos: ${n('documents')}`, `Borradores: ${n('drafts')}`,
        `Catálogos: ${n('operators')} operadores, ${n('vehicles')} unidades, ${n('trailers')} remolques, ${n('places')} destinos`,
        `Combustible: ${n('fuelRecords')} recargas`,
        `Control de operadores: ${n('operatorTrips')} viajes, ${n('operatorLoans')} préstamos, ${n('operatorAdjustments')} ajustes, ${n('operatorSettings')} configuraciones`,
        `Cobranza: ${n('tripBilling')} viajes con registro de cobro`,
        `Logística: ${n('logisticsOperations')} operaciones (activas e historial)`,
        `Documentos adicionales de viajes: ${n('tripAttachments')}`,
        `Control de vacíos: ${n('emptyContainers')} contenedores, ${n('emptyContainerEvents')} movimientos, ${n('yards')} patios`,
        `Ubicaciones de destinos en el mapa: ${(obj.data.geocodes || []).filter((g) => g && g.precision !== 'none').length}`,
        `Taller: ${n('maintenanceOrders')} órdenes, ${n('maintenanceIssues')} fallas, ${n('oilChanges')} cambios de aceite, ${n('tireReplacements')} reemplazos de llantas`,
        `Tarifas: ${n('tariffSheets')} apartado${n('tariffSheets') === 1 ? '' : 's'}, ${(obj.data.tariffSheets || []).reduce((t, x) => t + (x && Array.isArray(x.routes) ? x.routes.length : 0), 0)} rutas`,
        `Control de llenos: ${n('fullContainerLoads')} carga${n('fullContainerLoads') === 1 ? '' : 's'}, ${n('fullContainerDocuments')} documentos, ${n('loadingYards')} patio${n('loadingYards') === 1 ? '' : 's'} de carga`,
        `Archivos: ${n('attachments')}`, `Creado: ${obj.exportedAt ? new Date(obj.exportedAt).toLocaleString('es-MX') : 'sin fecha'}`,
      ],
    };
  }
  const kv = obj && obj.format === 'ner-legacy' ? obj.keys : obj;
  if (kv && typeof kv === 'object' && Object.keys(kv).some((k) => k.startsWith('ner-'))) {
    return { kind: 'legacy', obj: kv, lines: [`Datos del sistema anterior: ${Object.keys(kv).filter((k) => k.startsWith('ner-')).length} claves`] };
  }
  throw new Error('El archivo no corresponde a un respaldo de PERCONSUR.');
}

export async function importBackup(info) {
  if (info.kind === 'legacy') {
    const r = await migrateLegacy(info.obj, { source: 'archivo' });
    await reload();
    return r;
  }
  const data = sanitizeImport(info.obj.data);
  /* Operadores: no duplicar. Si ya existe uno con la misma empresa y nombre (IDs distintos por venir de otro
     dispositivo), se usa el existente y se reasignan a él los registros importados. */
  const fold = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  const existing = await db.all(db.S.operators);
  const remap = new Map();
  data.operators = (data.operators || []).filter((o) => {
    if (existing.some((e) => e.id === o.id)) return true;
    const twin = existing.find((e) => e.company === o.company && fold(e.name) === fold(o.name));
    if (twin) { remap.set(o.id, twin.id); return false; }
    return true;
  });
  for (const st of OP_STORES) for (const r of data[st] || []) if (remap.has(r.operatorId)) r.operatorId = remap.get(r.operatorId);
  for (const a of data.attachments || []) { const m = /^op:(.+)$/.exec(a.owner || ''); if (m && remap.has(m[1])) a.owner = 'op:' + remap.get(m[1]); }
  /* Unidades: misma regla (empresa + número económico); las recargas se reasignan a la unidad existente */
  const normEco = (x) => String(x || '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  const exVeh = await db.all(db.S.vehicles), vmap = new Map();
  data.vehicles = (data.vehicles || []).filter((v) => {
    if (exVeh.some((e) => e.id === v.id)) return true;
    let twin = exVeh.find((e) => e.company === v.company && normEco(e.eco) === normEco(v.eco));
    /* Si ese registro ya se unió a otra unidad del catálogo único, todo pasa a la unidad que se conservó */
    for (let k = 0; twin && twin.mergedInto && k < 5; k++) twin = exVeh.find((e) => e.id === twin.mergedInto) || twin;
    if (twin) { vmap.set(v.id, twin.id); return false; }
    return true;
  });
  for (const r of data.fuelRecords || []) if (vmap.has(r.vehicleId)) r.vehicleId = vmap.get(r.vehicleId);
  /* Expediente de unidades: documentos, fotos, historial y sus archivos a la unidad existente */
  for (const s of ['unitDocuments', 'unitPhotos', 'unitEvents']) for (const r of data[s] || []) if (vmap.has(r.unitId)) r.unitId = vmap.get(r.unitId);
  for (const a of data.attachments || []) { const m = /^unit:(.+)$/.exec(a.owner || ''); if (m && vmap.has(m[1])) a.owner = 'unit:' + vmap.get(m[1]); }
  /* Taller: las órdenes, fallas, aceite y configuración se reasignan a la unidad existente (remolques, abajo) */
  for (const s of ['maintenanceOrders', 'maintenanceIssues', 'oilChanges', 'tireReplacements']) for (const r of data[s] || []) if (vmap.has(r.vehicleId)) r.vehicleId = vmap.get(r.vehicleId);
  for (const r of data.maintenanceProfiles || []) { const m = /^v:(.+)$/.exec(r.id); if (m && vmap.has(m[1])) r.id = 'v:' + vmap.get(m[1]); }
  /* Logística: las operaciones se reasignan a la unidad y al operador existentes (remolques, abajo) */
  for (const r of data.logisticsOperations || []) { if (vmap.has(r.vehicleId)) r.vehicleId = vmap.get(r.vehicleId); if (remap.has(r.operatorId)) r.operatorId = remap.get(r.operatorId); }
  /* Remolques: no duplicar por empresa + placas (se conserva el tipo si el existente no lo tiene) */
  const exTr = await db.all(db.S.trailers), trUpdates = [], tmap = new Map();
  data.trailers = (data.trailers || []).filter((t) => {
    if (exTr.some((e) => e.id === t.id)) return true;
    const twin = exTr.find((e) => e.company === t.company && fold(e.placas) === fold(t.placas));
    if (twin && t.type && !twin.type) { twin.type = t.type; trUpdates.push(twin); }
    if (twin) tmap.set(t.id, twin.id);
    return !twin;
  });
  for (const r of data.logisticsOperations || []) if (tmap.has(r.trailerId)) r.trailerId = tmap.get(r.trailerId);
  for (const s of ['maintenanceOrders', 'maintenanceIssues', 'tireReplacements']) for (const r of data[s] || []) if (tmap.has(r.trailerId)) r.trailerId = tmap.get(r.trailerId);
  for (const r of data.maintenanceProfiles || []) { const m = /^t:(.+)$/.exec(r.id); if (m && tmap.has(m[1])) r.id = 't:' + tmap.get(m[1]); }
  /* Control de vacíos: unidad, operadores y remolque al registro existente; patios sin duplicar por nombre */
  for (const r of data.emptyContainers || []) {
    if (vmap.has(r.vehicleId)) r.vehicleId = vmap.get(r.vehicleId); if (tmap.has(r.trailerId)) r.trailerId = tmap.get(r.trailerId);
    if (remap.has(r.originalOperatorId)) r.originalOperatorId = remap.get(r.originalOperatorId); if (remap.has(r.deliveryOperatorId)) r.deliveryOperatorId = remap.get(r.deliveryOperatorId);
  }
  const exYards = await db.all(db.S.yards), ymap = new Map();
  data.yards = (data.yards || []).filter((y) => {
    if (exYards.some((e) => e.id === y.id)) return true;
    const twin = exYards.find((e) => fold(e.name) === fold(y.name));
    if (twin) ymap.set(y.id, twin.id);
    return !twin;
  });
  for (const r of data.emptyContainers || []) if (ymap.has(r.yardId)) r.yardId = ymap.get(r.yardId);
  /* Control de llenos: unidad, operador y remolque al registro existente; patios de carga sin duplicar por nombre */
  const exLy = await db.all(db.S.loadingYards), lymap = new Map();
  data.loadingYards = (data.loadingYards || []).filter((y) => {
    if (exLy.some((e) => e.id === y.id)) return true;
    const twin = exLy.find((e) => fold(e.name) === fold(y.name));
    if (twin) lymap.set(y.id, twin.id);
    return !twin;
  });
  for (const r of data.fullContainerLoads || []) {
    if (vmap.has(r.vehicleId)) r.vehicleId = vmap.get(r.vehicleId); if (tmap.has(r.trailerId)) r.trailerId = tmap.get(r.trailerId);
    if (remap.has(r.operatorId)) r.operatorId = remap.get(r.operatorId); if (lymap.has(r.yardId)) r.yardId = lymap.get(r.yardId);
  }
  for (const t of trUpdates) await db.put(db.S.trailers, t);
  if (data.operatorSettings) {
    for (const r of data.operatorSettings) { const cur = await db.get(db.S.operatorSettings, r.operatorId); if (cur && (cur.updatedAt || 0) >= (r.updatedAt || 0)) r._skip = true; }
    data.operatorSettings = data.operatorSettings.filter((r) => !r._skip);
  }
  for (const s of DATA_STORES) {
    const rows = data[s] || [];
    if (s === 'counters') { for (const r of rows) { const cur = await db.get(s, r.id); if (!cur || cur.n < r.n) await db.put(s, r); } continue; }
    if (s === 'settings') { for (const r of rows) if (!SKIP_SETTINGS.has(r.key)) await db.put(s, r); continue; }
    /* Cobranza: un registro por viaje; se conserva el más reciente */
    if (s === 'tripBilling') { for (const r of rows) { const cur = await db.get(s, r.tripId); if (!cur || (r.updatedAt || 0) > (cur.updatedAt || 0)) await db.put(s, r); } continue; }
    /* Logística: se conserva la versión más reciente de cada operación */
    if (s === 'emptyContainers') { for (const r of rows) { const cur = await db.get(s, r.id); if (!cur || (r.updatedAt || 0) > (cur.updatedAt || 0)) await db.put(s, r); } continue; }
    if (s === 'tripAttachments') { for (const r of rows) { const cur = await db.get(s, r.id); if (!cur || (r.updatedAt || 0) > (cur.updatedAt || 0)) await db.put(s, r); } continue; }
    if (s === 'logisticsOperations') { for (const r of rows) { const cur = await db.get(s, r.id); if (!cur || (r.updatedAt || 0) > (cur.updatedAt || 0)) await db.put(s, r); } continue; }
    /* Control de llenos: la versión más reciente de cada carga y de cada documento (los movimientos solo se agregan) */
    if (s === 'fullContainerLoads' || s === 'fullContainerDocuments') { for (const r of rows) { const cur = await db.get(s, r.id); if (!cur || (r.updatedAt || 0) > (cur.updatedAt || 0)) await db.put(s, r); } continue; }
    /* Tarifas: la versión más reciente de cada apartado; la copia sembrada sin cambios siempre cede ante la del respaldo */
    if (s === 'tariffSheets') { for (const r of rows) { const cur = await db.get(s, r.id); if (!cur || cur.source === 'seed' || (r.updatedAt || 0) > (cur.updatedAt || 0)) await db.put(s, r); } continue; }
    /* Ubicaciones de direcciones: un punto fijado a mano nunca se reemplaza por uno buscado automáticamente */
    if (s === 'geocodes') {
      for (const r of rows) {
        if (!r || !r.key) continue;
        const cur = await db.get(s, r.key), man = (x) => x && x.precision === 'manual';
        if (!cur || (man(r) && (!man(cur) || (r.at || 0) > (cur.at || 0))) || (!man(cur) && r.precision !== 'none' && (cur.precision === 'none' || (r.at || 0) > (cur.at || 0)))) await db.put(s, r);
      }
      continue;
    }
    /* Mapa de viajes: la asignación más reciente de cada texto de destino */
    /* Unidades: la versión más reciente de cada documento o fotografía; el historial solo se agrega */
    if (s === 'unitDocuments' || s === 'unitPhotos') { for (const r of rows) { const cur = await db.get(s, r.id); if (!cur || (r.updatedAt || r.archivedAt || r.uploadedAt || 0) >= (cur.updatedAt || cur.archivedAt || cur.uploadedAt || 0)) await db.put(s, r); } continue; }
    if (s === 'unitEvents') { for (const r of rows) if (!(await db.get(s, r.id))) await db.put(s, r); continue; }
    if (s === 'destStates') { for (const r of rows) { const cur = await db.get(s, r.key); if (!cur || (r.at || 0) > (cur.at || 0)) await db.put(s, r); } continue; }
    if (s === 'drafts') { for (const r of rows) { const cur = await db.get(s, r.id); if (!cur || (r.updatedAt || 0) > (cur.updatedAt || 0)) await db.put(s, r); } continue; }
    /* Taller: se conserva la versión más reciente de cada registro (la bitácora y las fotos solo se agregan) */
    if (MT_STORES.includes(s)) { for (const r of rows) { if (!r || !r.id) continue; const cur = await db.get(s, r.id); if (!cur || (r.updatedAt || r.at || 0) > (cur.updatedAt || cur.at || 0)) await db.put(s, r); } continue; }
    if (rows.length) await db.putMany(s, rows);
  }
  for (const a of data.attachments || []) {
    const { b64: str, ...rest } = a;
    if (typeof str === 'string') await db.put(db.S.attachments, { ...rest, buf: b64.to(str) });
  }
  await reload();
  return { documents: (data.documents || []).length };
}
/* Vuelve a leer de la base local todo lo que las pantallas guardan en memoria (después de importar o de recibir la
   información compartida) */
export async function reloadAll() { await loadSettings(); await loadCatalogs(); await loadCompanies(); await loadOperatorData(); resetBillingCache(); await loadLogistics(true); await loadTripAttachments(true); await loadEmpties(true); await loadGeocodes(true); await loadFuel(true); await loadMaintenance(true); await loadTariffs(true); await loadFulls(true); await loadUnits(true); }
const reload = reloadAll;
