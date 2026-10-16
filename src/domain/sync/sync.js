/*
 * Información compartida — reglas puras (sin navegador; ver services/sync.js).
 * Un dispositivo CAPTURISTA publica una «foto» de sus registros en el Worker; los de CONSULTA la reciben tal cual
 * (espejo) y no pueden modificarla. Los archivos (PDF, fotos, documentos adicionales) viajan aparte, uno por uno.
 * Nunca se comparten: ajustes del dispositivo (tema, claves, últimos valores usados), borradores ni sus fotos.
 */
export const FORMAT = 1;
/* Registros que se publican (todos los de los respaldos menos borradores y ajustes) */
export const SYNC_STORES = ['companies', 'counters', 'operators', 'vehicles', 'trailers', 'places', 'plants', 'terminals', 'documents',
  'operatorSettings', 'operatorTrips', 'operatorLoans', 'operatorAdjustments', 'operatorStatements', 'fuelRecords', 'tripBilling',
  'logisticsOperations', 'tripAttachments', 'yards', 'emptyContainers', 'emptyContainerEvents', 'geocodes',
  'maintenanceOrders', 'maintenanceServices', 'maintenanceIssues', 'maintenanceComponents', 'tireReplacements', 'oilChanges',
  'maintenanceAttachments', 'maintenanceEvents', 'maintenanceProfiles', 'maintenanceParts', 'tariffSheets',
  'loadingYards', 'fullContainerLoads', 'fullContainerDocuments', 'fullContainerEvents', 'destStates',
  'unitDocuments', 'unitPhotos', 'unitEvents', 'serviceOrders', 'serviceOrderEvents', 'serviceOrderFiles'];
const KEY_PATH = { companies: 'key', geocodes: 'key', destStates: 'key', tripBilling: 'tripId', operatorSettings: 'operatorId' };
export const keyPathOf = (store) => KEY_PATH[store] || 'id';
/* En un dispositivo de consulta solo se escribe en lo que es del propio dispositivo: sus ajustes, la ubicación de
   direcciones buscadas en el mapa (caché; la siguiente foto la reemplaza) y las llegadas y salidas que cada dispositivo
   consulta directamente al Worker (geoEvents no viaja en la foto: así no gasta escrituras del plan gratuito de KV) */
export const READER_WRITABLE = new Set(['settings', 'geocodes', 'geoEvents']);
/* Ajustes propios de la sincronización: nunca viajan en respaldos ni en la foto */
export const SYNC_SETTINGS = ['syncUrl', 'syncKey', 'syncRole', 'syncDevice', 'syncVer', 'syncAt', 'syncName'];

export const FILE_ID_RE = /^[A-Za-z0-9_.:-]{1,120}$/;
export const VER_RE = /^[A-Za-z0-9_.-]{1,64}$/;
/* Archivos que se comparten: todos menos los de borradores (fotos de una nota sin terminar) */
export const fileShared = (att) => !!att && FILE_ID_RE.test(String(att.id || '')) && !/^draft:/.test(String(att.owner || ''));
/* Metadatos de un archivo (sin el contenido) */
export function fileMeta(att) {
  const { buf, b64, ...rest } = att || {};
  return { ...rest, size: Number(rest.size) || (buf && buf.byteLength) || 0 };
}
export const fileSig = (m) => [m.owner || '', m.size || 0, m.type || '', m.name || '', m.kind || ''].join('|');

export const newVer = (now = Date.now()) => 'v' + now.toString(36) + Math.random().toString(36).slice(2, 8);
export const newDevice = () => 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

/* Capturista: qué archivos subir y cuáles borrar de la nube.
   localIds  claves de los archivos compartibles de este dispositivo
   uploaded  { id → meta } ya subidos;  touched  ids modificados desde la última publicación;  skip  ids que no se pueden subir */
export function uploadPlan(localIds, uploaded, touched = new Set(), skip = new Set()) {
  const have = new Set(localIds);
  const upload = localIds.filter((id) => FILE_ID_RE.test(String(id)) && !skip.has(id) && (!uploaded[id] || touched.has(id)));
  const remove = Object.keys(uploaded).filter((id) => !have.has(id));
  return { upload, remove };
}
/* Consulta: qué archivos descargar, cuáles actualizar (mismo archivo, otros datos) y cuáles quitar.
   localIds  claves de los archivos de este dispositivo;  have  { id → firma } de lo ya recibido;  want  lista de la foto */
export function downloadPlan(localIds, have, want) {
  const local = new Set(localIds), wanted = new Map(want.filter((f) => f && FILE_ID_RE.test(String(f.id))).map((f) => [f.id, f]));
  const download = [], update = [];
  for (const [id, f] of wanted) {
    if (!local.has(id)) download.push(f);
    else if (have[id] !== fileSig(f)) update.push(f);
  }
  const remove = [...local].filter((id) => !wanted.has(id));
  return { download, update, remove };
}

/* Foto que publica el capturista */
export function buildSnapshot({ data, files, ver, device, by = '', appVersion = '', at = Date.now() }) {
  const out = {};
  for (const s of SYNC_STORES) out[s] = Array.isArray(data[s]) ? data[s] : [];
  return { app: 'perconsur', kind: 'sync', format: FORMAT, ver, device, by, appVersion, at, data: out, files: files.map(fileMeta) };
}
/* Valida una foto recibida (viene de la nube: se revisa la forma antes de guardar nada) */
export function readSnapshot(obj) {
  if (!obj || obj.app !== 'perconsur' || obj.kind !== 'sync') throw new Error('La información de la nube no corresponde a PERCONSUR.');
  if (obj.format !== FORMAT) throw new Error('La información de la nube es de otra versión de la app. Actualiza la app en este dispositivo.');
  if (!obj.data || typeof obj.data !== 'object' || !VER_RE.test(String(obj.ver || ''))) throw new Error('La información de la nube está incompleta.');
  const data = {};
  for (const s of SYNC_STORES) {
    const rows = obj.data[s];
    if (rows != null && !Array.isArray(rows)) throw new Error(`La información de la nube está dañada (sección «${s}»).`);
    data[s] = (rows || []).filter((r) => r && typeof r === 'object' && !Array.isArray(r));
  }
  const files = (Array.isArray(obj.files) ? obj.files : []).filter((f) => f && typeof f === 'object' && FILE_ID_RE.test(String(f.id || ''))).map(fileMeta);
  return { ver: obj.ver, at: Number(obj.at) || 0, by: String(obj.by || ''), device: String(obj.device || ''), appVersion: String(obj.appVersion || ''), data, files };
}
/* Filas con su clave (una fila sin clave haría fallar toda la transacción) */
export function rowsWithKey(store, rows) {
  const k = keyPathOf(store);
  return (rows || []).filter((r) => r && (typeof r[k] === 'string' ? r[k] !== '' : Number.isFinite(r[k])));
}

/* ¿El capturista puede publicar sin pisar información de otro dispositivo? (misma regla que el Worker) */
export function canPublish(remote, { device, base }) {
  return !remote || remote.device === device || remote.ver === base;
}

/* Textos */
const two = (n) => String(n).padStart(2, '0');
export function whenText(ms, now = Date.now()) {
  if (!ms) return 'nunca';
  const d = new Date(ms), t = `${two(d.getHours())}:${two(d.getMinutes())}`;
  const day = (x) => new Date(x).toDateString();
  if (day(ms) === day(now)) return `hoy ${t}`;
  if (day(ms) === day(now - 86400000)) return `ayer ${t}`;
  return `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()} ${t}`;
}
export const roleText = (role) => (role === 'write' ? 'Capturista' : role === 'read' ? 'Consulta' : role === 'taller' ? 'Taller' : 'Sin configurar');
export function sizeText(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
/* Nombre de quien publicó: viaja codificado en el encabezado (los encabezados HTTP no admiten acentos) */
export function byText(by) {
  try { return decodeURIComponent(String(by || '')); } catch (e) { return String(by || ''); }
}

/* ===== Sección Taller (clave DATA_TALLER_KEY del Worker) =====
 * Un teléfono de Taller captura solo mantenimiento. Recibe una foto REDUCIDA que publica el capturista (Taller, unidades,
 * remolques y lo mínimo para el taller: sin viajes, cobros, tarifas, operadores ni documentos) y envía sus cambios por
 * separado (bandeja). El capturista los aplica, los incluye en su información y devuelve el acuse (acks) en la siguiente
 * foto de Taller; hasta entonces el teléfono conserva sus cambios pendientes encima de lo recibido. */
export const TALLER_STORES = ['maintenanceOrders', 'maintenanceServices', 'maintenanceIssues', 'maintenanceComponents', 'tireReplacements', 'oilChanges',
  'maintenanceAttachments', 'maintenanceEvents', 'maintenanceProfiles', 'maintenanceParts'];
/* Lo que el teléfono de Taller envía (los remolques: el taller clasifica chasis, jaula o tolva) */
export const TALLER_OPS = [...TALLER_STORES, 'trailers'];
/* Lo que el teléfono de Taller recibe y guarda (reemplaza en cada foto) */
export const TALLER_MIRROR = [...TALLER_STORES, 'companies', 'vehicles', 'trailers', 'counters', 'logisticsOperations', 'fuelRecords'];
/* Donde el teléfono de Taller puede escribir (el resto de la base rechaza escrituras, como en Consulta) */
export const TALLER_WRITABLE = new Set([...TALLER_OPS, 'counters', 'attachments', ...READER_WRITABLE]);
export const isTallerFile = (att) => fileShared(att) && /^mt:/.test(String(att.owner || ''));
const LG_KEEP = ['id', 'vehicleId', 'trailerId', 'status', 'closedAt', 'deletedAt', 'startedAt', 'updatedAt'];
const FUEL_KEEP = ['id', 'vehicleId', 'date', 'time', 'odometer', 'deletedAt', 'updatedAt'];
const pick = (r, ks) => Object.fromEntries(ks.filter((k) => k in r).map((k) => [k, r[k]]));
const arr = (x) => (Array.isArray(x) ? x : []);
/* Foto de Taller: solo lo necesario (operaciones sin ruta ni operador; recargas solo con su odómetro, sin litros ni importes) */
export function buildTallerSnapshot({ data, files, ver, acks = {}, by = '', appVersion = '', at = Date.now() }) {
  const out = {};
  for (const s of TALLER_STORES) out[s] = arr(data[s]);
  out.companies = arr(data.companies);
  out.vehicles = arr(data.vehicles);
  out.trailers = arr(data.trailers);
  out.counters = arr(data.counters).filter((c) => /^mtto:/.test(String(c.id || '')));
  out.logisticsOperations = arr(data.logisticsOperations).map((r) => pick(r, LG_KEEP));
  out.fuelRecords = arr(data.fuelRecords).filter((r) => Number.isFinite(r.odometer)).map((r) => pick(r, FUEL_KEEP));
  return { app: 'perconsur', kind: 'taller', format: FORMAT, ver, by, appVersion, at, acks, data: out, files: arr(files).filter(isTallerFile).map(fileMeta) };
}
export function readTallerSnapshot(obj) {
  if (!obj || obj.app !== 'perconsur' || obj.kind !== 'taller') throw new Error('La información de Taller de la nube no corresponde a PERCONSUR.');
  if (obj.format !== FORMAT) throw new Error('La información de la nube es de otra versión de la app. Actualiza la app en este dispositivo.');
  if (!obj.data || typeof obj.data !== 'object' || !VER_RE.test(String(obj.ver || ''))) throw new Error('La información de Taller de la nube está incompleta.');
  const data = {};
  for (const s of TALLER_MIRROR) {
    const rows = obj.data[s];
    if (rows != null && !Array.isArray(rows)) throw new Error(`La información de Taller está dañada (sección «${s}»).`);
    data[s] = (rows || []).filter((r) => r && typeof r === 'object' && !Array.isArray(r));
  }
  const acks = {};
  if (obj.acks && typeof obj.acks === 'object') for (const [d, q] of Object.entries(obj.acks)) if (VER_RE.test(d) && Number.isInteger(q) && q >= 0) acks[d] = q;
  const files = arr(obj.files).filter((f) => f && typeof f === 'object' && FILE_ID_RE.test(String(f.id || ''))).map(fileMeta);
  return { ver: obj.ver, at: Number(obj.at) || 0, by: String(obj.by || ''), acks, data, files };
}
/* Huella del contenido (sin versión ni hora): no se vuelve a publicar una foto de Taller idéntica (ahorra escrituras de KV) */
export function contentSig(obj) {
  const t = JSON.stringify(obj);
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return t.length.toString(36) + '-' + h.toString(36);
}
/* Bandeja del teléfono de Taller: { 'store|clave': número } — el número crece con cada cambio; el acuse los retira */
export const outboxKey = (store, key) => `${store}|${key}`;
export function splitOutboxKey(k) { const i = k.indexOf('|'); return [k.slice(0, i), k.slice(i + 1)]; }
export const pendingOf = (outbox, ack = 0) => Object.entries(outbox || {}).filter(([, q]) => q > ack).map(([k, q]) => { const [s, key] = splitOutboxKey(k); return { s, k: key, q }; }).sort((a, b) => a.q - b.q);
export function pruneOutbox(outbox, ack) { const out = {}; for (const [k, q] of Object.entries(outbox || {})) if (q > ack) out[k] = q; return out; }
/* Capturista: ¿el cambio que llega de Taller reemplaza al registro local? (el más reciente gana; una baja gana si el registro
   local no cambió después) */
export function shouldApply(local, op) {
  if (!local) return op.v !== null;
  if (op.v === null) return (local.updatedAt || local.createdAt || 0) <= (op.at || 0);
  return (op.v.updatedAt || op.v.createdAt || op.v.at || 0) >= (local.updatedAt || local.createdAt || local.at || 0);
}
