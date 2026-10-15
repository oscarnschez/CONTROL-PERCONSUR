/*
 * Unidades PERCONSUR — almacenamiento.
 *
 * Catálogo único: store «vehicles» (el mismo de siempre, con los mismos IDs que usan Logística, GPS, Taller,
 * Combustible, Control de llenos y de vacíos). Campos de la ficha:
 *   { id, eco, placas, vin, brand, model, year, vehicleType, color, active:''|'no', notes, desc, gpsDeviceId,
 *     trackingUrl, gpsProvider, company (empresa de origen del registro antiguo; ya no separa catálogos),
 *     mergedInto?, mergedAt?, notDuplicateOf?[], createdAt, updatedAt, updatedBy, revisions[] }
 * Expediente:
 *   unitDocuments  documentos (ver domain/units/units.js); el archivo original vive en «attachments» (storageKey) y,
 *                  si es imagen, también una copia para mostrar (displayKey)
 *   unitPhotos     { id, unitId, photoType:'front'|'license_plate', storageKey (original sin tocar), displayKey, thumbKey,
 *                    name, mimeType, size, w, h, capturedAt, capturedOffset, captureDateSource:'exif'|'app_capture'|'manual'|'unknown',
 *                    exifField, exifMake, exifModel, uploadedAt, uploadedBy, status:'current'|'archived', archivedAt }
 *   unitEvents     historial { id, unitId, at, by, type, details, refId }
 * Archivos: owner «unit:<unitId>» (viajan en Información compartida y en el respaldo completo).
 * Una versión reemplazada no se borra: queda archivada y se consulta en el historial.
 * Cualquier cambio avisa con el evento «units:change».
 */
import * as db from './db.js';
import * as media from './media.js';
import * as cat from './catalogs.js';
import { getSetting, setSetting } from './settings.js';
import { isReadOnly } from './access.js';
import { loadLib } from './libs.js';
import { normImage } from './camera.js';
import { readExif } from '../domain/units/exif.js';
import {
  DOC_KEYS, docType, checkUnit, unitStatus, todayIn, OPS_TZ, SOON_DAYS, duplicateGroups, mergedData, normEco, isActive, unitTitle, byEco,
} from '../domain/units/units.js';

const EVT = 'units:change';
const changed = () => window.dispatchEvent(new CustomEvent(EVT));
export const onUnitsChange = (fn) => { window.addEventListener(EVT, fn); return () => window.removeEventListener(EVT, fn); };
function actor() { try { const s = JSON.parse(sessionStorage.getItem('pcs-session') || 'null'); return (s && s.user) || 'local'; } catch (e) { return 'local'; } }
const guardRO = () => { if (isReadOnly()) throw new Error('Modo consulta: no se pueden hacer cambios.'); };

let docs = null, photos = null, events = null;
export async function loadUnits(force = false) {
  if (!docs || force) {
    [docs, photos, events] = await Promise.all([db.all(db.S.unitDocuments), db.all(db.S.unitPhotos), db.all(db.S.unitEvents)]);
  }
  return true;
}

/* ===== Configuración ===== */
export const tz = () => getSetting('opsTimeZone', OPS_TZ);
export const today = () => todayIn(tz());
export const soonDays = () => Number(getSetting('unitSoonDays', SOON_DAYS)) || SOON_DAYS;
export const requirements = () => getSetting('unitDocRequirements', null);
export async function setRequirements(cfg) { guardRO(); await setSetting('unitDocRequirements', cfg); changed(); }
export async function setSoonDays(n) { guardRO(); await setSetting('unitSoonDays', Math.max(1, Math.min(90, Math.round(+n) || SOON_DAYS))); changed(); }

/* ===== Consultas ===== */
export const allVehicles = () => cat.listAll('vehicles');
/* Unidades del catálogo (sin los registros unidos a otra) */
export const units = () => allVehicles().filter((v) => !v.mergedInto).sort(byEco);
export const unitById = (id) => allVehicles().find((v) => v.id === id) || null;
/* Si el id es de un registro que se unió a otro, el que quedó */
export function resolveUnit(id) { let u = unitById(id), n = 0; while (u && u.mergedInto && n++ < 5) u = unitById(u.mergedInto); return u; }
export const docsOf = (unitId) => (docs || []).filter((d) => d.unitId === unitId);
export const docById = (id) => (docs || []).find((d) => d.id === id) || null;
export const photosOf = (unitId) => (photos || []).filter((p) => p.unitId === unitId).sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
export const photoById = (id) => (photos || []).find((p) => p.id === id) || null;
export const currentPhoto = (unitId, type) => photosOf(unitId).find((p) => p.photoType === type && p.status !== 'archived') || null;
export const eventsOf = (unitId) => (events || []).filter((e) => e.unitId === unitId).sort((a, b) => b.at - a.at);
export const statusOf = (u, day = today()) => unitStatus(u, docs || [], day, { config: requirements(), soon: soonDays() });
/* Filas para el listado y el tablero: [{ unit, st, photo }] */
export function rows(day = today()) { return units().map((unit) => ({ unit, st: statusOf(unit, day), photo: currentPhoto(unit.id, 'front') })); }

/* ===== Datos generales ===== */
const UNIT_FIELDS = ['eco', 'placas', 'vin', 'brand', 'model', 'year', 'vehicleType', 'color', 'active', 'notes', 'desc'];
const FIELD_NAMES = { eco: 'número económico', placas: 'placas', vin: 'VIN/NIV', brand: 'marca', model: 'modelo', year: 'año', vehicleType: 'tipo', color: 'color', active: 'estado', notes: 'observaciones', desc: 'descripción' };
/* Crea o actualiza una unidad. Lanza un error con .fields si hay datos inválidos o duplicados. */
export async function saveUnit(input, id = null) {
  guardRO();
  const cur = id ? unitById(id) : null;
  if (id && !cur) throw new Error('La unidad ya no existe.');
  const data = {};
  for (const f of UNIT_FIELDS) if (input[f] !== undefined) data[f] = String(input[f] == null ? '' : input[f]).trim();
  if (data.eco !== undefined) data.eco = normEco(data.eco);
  if (data.placas !== undefined) data.placas = data.placas.toUpperCase();
  if (data.vin !== undefined) data.vin = data.vin.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (data.active !== undefined) data.active = data.active === 'no' ? 'no' : '';
  const next = { ...(cur || {}), ...data };
  const err = checkUnit(next, allVehicles(), id);
  if (Object.keys(err).length) { const e = new Error(Object.values(err)[0]); e.fields = err; throw e; }
  const now = Date.now(), who = actor();
  let rec;
  if (cur) {
    const diff = UNIT_FIELDS.filter((f) => data[f] !== undefined && String(cur[f] || '') !== String(data[f] || ''));
    if (!diff.length) return cur;
    const before = Object.fromEntries(diff.map((f) => [f, cur[f] || '']));
    rec = await cat.save('vehicles', { ...next, updatedAt: now, updatedBy: who, revisions: [...(cur.revisions || []), { at: now, by: who, before }].slice(-50) });
    await addEvent(rec.id, data.active !== undefined && diff.length === 1 && diff[0] === 'active' ? (data.active === 'no' ? 'unit_inactive' : 'unit_active') : 'unit_updated',
      diff.map((f) => `${FIELD_NAMES[f]}: ${before[f] || '—'} → ${data[f] || '—'}`).join(' · '));
  } else {
    rec = await cat.save('vehicles', { company: 'perconsur', desc: '', ...next, source: 'usuario', createdAt: now, createdBy: who, updatedAt: now, updatedBy: who, revisions: [] });
    await addEvent(rec.id, 'unit_created', `${unitTitle(rec)}${rec.placas ? ' · ' + rec.placas : ''}`);
  }
  changed();
  return rec;
}

/* ===== Historial ===== */
export async function addEvent(unitId, type, details = '', refId = null) {
  await loadUnits();
  const e = { id: db.uid('ue_'), unitId, type, details: String(details || '').slice(0, 500), refId, at: Date.now(), by: actor() };
  await db.put(db.S.unitEvents, e); events.push(e);
  return e;
}
export const EVENT_LABELS = {
  unit_created: 'Unidad registrada', unit_updated: 'Datos de la unidad modificados', unit_active: 'Unidad activada', unit_inactive: 'Unidad marcada como inactiva',
  doc_added: 'Documento agregado', doc_replaced: 'Documento reemplazado', doc_archived: 'Documento archivado', doc_deleted: 'Documento eliminado',
  dates_changed: 'Vigencia modificada', dates_confirmed: 'Periodo confirmado', complement_added: 'Complemento de pago nuevo', complement_selected: 'Cobertura elegida',
  photo_added: 'Fotografía agregada', photo_replaced: 'Fotografía actualizada', photo_date: 'Fecha de captura corregida a mano', photo_archived: 'Fotografía archivada',
  merged: 'Registros unidos', merged_into: 'Registro unido a otra unidad', not_duplicate: 'Marcadas como unidades distintas',
};

/* ===== Fotografías ===== */
export const PHOTO_TYPES = { front: 'Fotografía frontal', license_plate: 'Fotografía de las placas' };
export const IMG_ACCEPT = 'image/*,.heic,.heif';
export const isImageFile = (f) => /^image\//i.test(f.type || '') || /\.(jpe?g|png|heic|heif|webp)$/i.test(f.name || '');
const isHeic = (f) => /heic|heif/i.test(f.type || '') || /\.(heic|heif)$/i.test(f.name || '');
async function thumbOf(blob) {
  const u = URL.createObjectURL(blob);
  try {
    const im = await new Promise((res, rej) => { const x = new Image(); x.onload = () => res(x); x.onerror = rej; x.src = u; });
    const k = Math.min(1, 640 / Math.max(im.naturalWidth, im.naturalHeight)), c = document.createElement('canvas');
    c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    const b = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.8)); c.width = c.height = 0;
    return b;
  } finally { URL.revokeObjectURL(u); }
}
/*
 * Prepara una fotografía para la vista previa (nada se guarda todavía).
 * source: 'camera' (tomada desde la app) | 'library' (elegida de Fotos o Archivos)
 * Fecha de captura: EXIF (DateTimeOriginal) del archivo ORIGINAL; si se tomó desde la app y no trae EXIF, la hora en que
 * la app la recibió («registrada por PERCONSUR»); si no, desconocida. Nunca se usa file.lastModified ni la fecha de carga.
 */
export async function preparePhoto(file, source = 'library') {
  if (!file) throw new Error('No se eligió ninguna imagen.');
  if (!isImageFile(file)) throw new Error('El archivo no es una imagen (JPG, PNG o HEIC).');
  if (file.size > 40 * 1024 * 1024) throw new Error('La imagen es demasiado grande (máximo 40 MB).');
  const receivedAt = Date.now();
  const buf = await file.arrayBuffer();
  const exif = readExif(buf);
  let display = null, thumb = null, w = null, h = null, previewError = '';
  try { const n = await normImage(file); display = n.blob; w = n.w; h = n.h; thumb = await thumbOf(display); }
  catch (e) { previewError = isHeic(file) ? 'Este navegador no puede mostrar fotos HEIC; se guardará el original.' : 'No se pudo generar la vista previa de esta imagen.'; }
  let capturedAt = null, captureDateSource = 'unknown', capturedOffset = null;
  if (exif.capturedAt) { capturedAt = exif.capturedAt; capturedOffset = exif.offset; captureDateSource = 'exif'; }
  else if (source === 'camera') { capturedAt = localIso(receivedAt); capturedOffset = offsetOf(receivedAt); captureDateSource = 'app_capture'; }
  return { file, source, exif, display, thumb, w, h, previewError, capturedAt, capturedOffset, captureDateSource, receivedAt };
}
const p2 = (n) => String(n).padStart(2, '0');
function localIso(ms) { const d = new Date(ms); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`; }
function offsetOf(ms) { const m = -new Date(ms).getTimezoneOffset(), s = m < 0 ? '-' : '+', a = Math.abs(m); return `${s}${p2(Math.floor(a / 60))}:${p2(a % 60)}`; }

/* Guarda la fotografía preparada; la anterior del mismo tipo queda archivada (historial). manualDate: 'AAAA-MM-DD' opcional. */
export async function savePhoto(unitId, photoType, prep, { manualDate = '' } = {}) {
  guardRO(); await loadUnits();
  if (!unitById(unitId)) throw new Error('La unidad ya no existe.');
  if (!PHOTO_TYPES[photoType]) throw new Error('Tipo de fotografía no válido.');
  const owner = 'unit:' + unitId, name = prep.file.name || `${photoType}.jpg`;
  const keys = [];
  try {
    const storageKey = await media.saveBlob(prep.file, { owner, kind: 'unit-photo', name, type: prep.file.type || 'image/jpeg' }); keys.push(storageKey);
    const displayKey = prep.display ? await media.saveBlob(prep.display, { owner, kind: 'unit-photo', name: 'vista-' + name, type: 'image/jpeg' }) : null; if (displayKey) keys.push(displayKey);
    const thumbKey = prep.thumb ? await media.saveBlob(prep.thumb, { owner, kind: 'unit-photo', name: 'miniatura-' + name, type: 'image/jpeg' }) : null; if (thumbKey) keys.push(thumbKey);
    const now = Date.now(), who = actor();
    let capturedAt = prep.capturedAt, src = prep.captureDateSource, off = prep.capturedOffset;
    if (src === 'unknown' && /^\d{4}-\d{2}-\d{2}$/.test(manualDate)) { capturedAt = manualDate; src = 'manual'; off = null; }
    const prev = currentPhoto(unitId, photoType);
    const rec = { id: db.uid('up_'), unitId, photoType, storageKey, displayKey, thumbKey, name, mimeType: prep.file.type || '', size: prep.file.size, w: prep.w, h: prep.h,
      capturedAt, capturedOffset: off, captureDateSource: src, exifField: prep.exif.field || null, exifMake: prep.exif.make || '', exifModel: prep.exif.model || '',
      uploadedAt: now, uploadedBy: who, status: 'current' };
    await db.put(db.S.unitPhotos, rec); photos.push(rec);
    if (prev) { const a = { ...prev, status: 'archived', archivedAt: now, replacedBy: rec.id }; await db.put(db.S.unitPhotos, a); photos[photos.indexOf(prev)] = a; }
    await addEvent(unitId, prev ? 'photo_replaced' : 'photo_added', `${PHOTO_TYPES[photoType]} · ${captureText(rec)}`, rec.id);
    changed();
    return rec;
  } catch (e) {
    for (const k of keys) { try { await media.remove(k); } catch (e2) { /* */ } }
    throw new Error(/quota|space/i.test(String(e && e.name) + e.message) ? 'No hay espacio disponible en este dispositivo.' : e.message || 'No se pudo guardar la fotografía.');
  }
}
/* Fecha de captura escrita a mano (solo cuando no se conoce); null la quita */
export async function setPhotoDate(photoId, date) {
  guardRO(); await loadUnits();
  const p = photoById(photoId); if (!p) throw new Error('La fotografía ya no existe.');
  if (p.captureDateSource === 'exif' || p.captureDateSource === 'app_capture') throw new Error('La fecha de esta fotografía viene de sus metadatos o de la cámara de la app; no se modifica.');
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(date || '');
  const rec = { ...p, capturedAt: ok ? date : null, captureDateSource: ok ? 'manual' : 'unknown', capturedOffset: null, dateSetAt: Date.now(), dateSetBy: actor() };
  await db.put(db.S.unitPhotos, rec); photos[photos.indexOf(p)] = rec;
  await addEvent(p.unitId, 'photo_date', `${PHOTO_TYPES[p.photoType]} · ${ok ? date : 'sin fecha'}`, p.id);
  changed();
  return rec;
}
export const CAPTURE_LABEL = { exif: 'Según los metadatos de la foto (EXIF)', app_capture: 'Fecha de captura registrada por PERCONSUR', manual: 'Fecha proporcionada manualmente', unknown: 'Fecha de captura no disponible' };
export function captureText(p) {
  if (!p || !p.capturedAt || p.captureDateSource === 'unknown') return 'Fecha de captura no disponible';
  return `Tomada: ${fmtStamp(p.capturedAt, p.capturedOffset)}`;
}
const MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
/* «12 de octubre de 2026, 14:32» (+ «UTC−06:00» si la cámara guardó la zona); solo fecha si no hay hora */
export function fmtStamp(s, offset = null) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(s || ''));
  if (!m) return '';
  const d = `${+m[3]} de ${MES[+m[2] - 1]} de ${m[1]}`;
  return m[4] ? `${d}, ${m[4]}:${m[5]}${offset ? ` (UTC${offset.replace('-', '−')})` : ''}` : d;
}
export function fmtMs(ms) { if (!ms) return ''; const d = new Date(ms); return `${d.getDate()} de ${MES[d.getMonth()]} de ${d.getFullYear()}, ${p2(d.getHours())}:${p2(d.getMinutes())}`; }

/* ===== Documentos ===== */
export const DOC_ACCEPT = 'application/pdf,image/jpeg,image/png,image/heic,image/heif,.pdf,.jpg,.jpeg,.png,.heic,.heif';
export const DOC_MAX = 60 * 1024 * 1024;
export function kindOfDoc(f) {
  const n = String(f.name || '').toLowerCase(), t = String(f.type || '').toLowerCase();
  if (t === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
  if (/^image\/(jpeg|jpg|png|heic|heif)$/.test(t) || /\.(jpe?g|png|heic|heif)$/.test(n)) return 'img';
  return null;
}
/* Revisa el archivo antes de mostrar la vista previa: { kind, pages, display (imagen para ver), error } */
export async function inspectDoc(file) {
  const kind = kindOfDoc(file);
  if (!kind) throw new Error('Formato no admitido: usa PDF, JPG, PNG o HEIC.');
  if (file.size > DOC_MAX) throw new Error(`El archivo es demasiado grande (máximo ${DOC_MAX / 1048576} MB).`);
  if (!file.size) throw new Error('El archivo está vacío.');
  if (kind === 'pdf') {
    try {
      await loadLib('pdflib');
      const d = await window.PDFLib.PDFDocument.load(new Uint8Array(await file.arrayBuffer()), { ignoreEncryption: true });
      return { kind, pages: d.getPageCount(), display: null };
    } catch (e) { throw new Error('El PDF está dañado o no se puede abrir.'); }
  }
  try { const n = await normImage(file); return { kind, pages: 1, display: n.blob, w: n.w, h: n.h }; }
  catch (e) {
    if (isHeic(file)) return { kind, pages: 1, display: null, note: 'Este navegador no puede mostrar HEIC; se guardará el original.' };
    throw new Error('La imagen está dañada o no se puede abrir.');
  }
}
/*
 * Agrega un documento. Tipos de una sola versión: la versión anterior queda archivada (historial).
 * Complemento de pago: se agrega al historial sin archivar los anteriores (cada uno cubre su periodo).
 * fields: { issueDate, validFrom, validUntil, noExpiry, insurer, policyNumber, folio, notes, verificationStatus, dateSource, extraction }
 */
export async function addDocument(unitId, type, file, insp, fields = {}) {
  guardRO(); await loadUnits();
  const t = docType(type); if (!t) throw new Error('Tipo de documento no válido.');
  if (!unitById(unitId)) throw new Error('La unidad ya no existe.');
  const owner = 'unit:' + unitId, name = file.name || `${t.label}.${insp.kind === 'pdf' ? 'pdf' : 'jpg'}`, keys = [];
  try {
    const storageKey = await media.saveBlob(file, { owner, kind: 'unit-doc', name, type: file.type || (insp.kind === 'pdf' ? 'application/pdf' : 'image/jpeg') }); keys.push(storageKey);
    const displayKey = insp.display ? await media.saveBlob(insp.display, { owner, kind: 'unit-doc', name: 'vista-' + name, type: 'image/jpeg' }) : null; if (displayKey) keys.push(displayKey);
    const now = Date.now(), who = actor();
    const rec = cleanFields({ id: db.uid('ud_'), unitId, docType: type, storageKey, displayKey, name, mimeType: file.type || '', kind: insp.kind, size: file.size, pages: insp.pages || 1,
      uploadedAt: now, uploadedBy: who, status: 'current', revisions: [], ...fields });
    await db.put(db.S.unitDocuments, rec); docs.push(rec);
    let replaced = null;
    if (!t.multi) {
      for (const d of docs.filter((x) => x.unitId === unitId && x.docType === type && x.status !== 'archived' && x.id !== rec.id)) {
        const a = { ...d, status: 'archived', archivedAt: now, replacedBy: rec.id }; await db.put(db.S.unitDocuments, a); docs[docs.indexOf(d)] = a; replaced = d;
      }
    }
    await addEvent(unitId, type === 'payment_complement' ? 'complement_added' : replaced ? 'doc_replaced' : 'doc_added', `${t.label} · ${name}${periodText(rec)}`, rec.id);
    changed();
    return rec;
  } catch (e) {
    for (const k of keys) { try { await media.remove(k); } catch (e2) { /* */ } }
    throw new Error(/quota|space/i.test(String(e && e.name) + e.message) ? 'No hay espacio disponible en este dispositivo.' : e.message || 'No se pudo guardar el documento.');
  }
}
const isD = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
function cleanFields(r) {
  const out = { ...r };
  for (const f of ['issueDate', 'validFrom', 'validUntil']) out[f] = isD(out[f]) ? out[f] : null;
  for (const f of ['insurer', 'policyNumber', 'folio', 'notes']) out[f] = String(out[f] || '').trim();
  out.noExpiry = !!out.noExpiry;
  if (!['confirmed', 'manual', 'pending'].includes(out.verificationStatus)) out.verificationStatus = out.validFrom || out.validUntil ? 'pending' : 'pending';
  if (!['extracted', 'manual', 'pending'].includes(out.dateSource)) out.dateSource = out.verificationStatus === 'confirmed' ? 'extracted' : out.verificationStatus === 'manual' ? 'manual' : 'pending';
  if (out.validFrom && out.validUntil && out.validFrom > out.validUntil) throw new Error('El inicio de vigencia es posterior al fin.');
  return out;
}
const periodText = (d) => (d.validFrom || d.validUntil ? ` · ${d.validFrom || '…'} al ${d.validUntil || '…'}` : '');
/* Corrige fechas y datos (con historial de cambios) */
export async function updateDocument(docId, patch) {
  guardRO(); await loadUnits();
  const d = docById(docId); if (!d) throw new Error('El documento ya no existe.');
  const keysP = ['issueDate', 'validFrom', 'validUntil', 'noExpiry', 'insurer', 'policyNumber', 'folio', 'notes', 'verificationStatus', 'dateSource'];
  const before = {}, after = {};
  for (const k of keysP) if (patch[k] !== undefined && String(patch[k] ?? '') !== String(d[k] ?? '')) { before[k] = d[k] ?? null; after[k] = patch[k]; }
  if (!Object.keys(after).length) return d;
  const now = Date.now(), who = actor();
  const rec = cleanFields({ ...d, ...after, updatedAt: now, updatedBy: who, revisions: [...(d.revisions || []), { at: now, by: who, before }].slice(-50) });
  await db.put(db.S.unitDocuments, rec); docs[docs.indexOf(d)] = rec;
  const datesChanged = ['issueDate', 'validFrom', 'validUntil', 'noExpiry'].some((k) => k in after);
  const confirmedNow = after.verificationStatus === 'confirmed' && d.verificationStatus !== 'confirmed';
  await addEvent(d.unitId, confirmedNow ? 'dates_confirmed' : datesChanged ? 'dates_changed' : 'unit_updated', `${docType(d.docType).label}${periodText(rec)}${rec.noExpiry ? ' · sin vencimiento' : ''}`, d.id);
  changed();
  return rec;
}
/* Pasa un documento al historial (no se borra el archivo) */
export async function archiveDocument(docId) {
  guardRO(); await loadUnits();
  const d = docById(docId); if (!d || d.status === 'archived') return d;
  const rec = { ...d, status: 'archived', archivedAt: Date.now(), archivedBy: actor() };
  await db.put(db.S.unitDocuments, rec); docs[docs.indexOf(d)] = rec;
  await addEvent(d.unitId, 'doc_archived', `${docType(d.docType).label} · ${d.name}`, d.id);
  changed();
  return rec;
}
/* Elimina definitivamente un documento ya archivado (el historial conserva el evento) */
export async function deleteArchivedDocument(docId) {
  guardRO(); await loadUnits();
  const d = docById(docId); if (!d) return;
  if (d.status !== 'archived') throw new Error('Primero archiva el documento.');
  for (const k of [d.storageKey, d.displayKey]) if (k) { try { await media.remove(k); } catch (e) { /* */ } }
  await db.del(db.S.unitDocuments, d.id); docs = docs.filter((x) => x.id !== d.id);
  await addEvent(d.unitId, 'doc_deleted', `${docType(d.docType).label} · ${d.name}`, d.id);
  changed();
}
/* Varios complementos cubren hoy: la persona elige cuál es el correcto */
export async function selectComplement(docId) {
  guardRO(); await loadUnits();
  const d = docById(docId); if (!d) return;
  for (const x of docs.filter((y) => y.unitId === d.unitId && y.docType === 'payment_complement')) {
    const sel = x.id === docId;
    if (!!x.selected !== sel) { const r = { ...x, selected: sel }; await db.put(db.S.unitDocuments, r); docs[docs.indexOf(x)] = r; }
  }
  await addEvent(d.unitId, 'complement_selected', `${d.name}${periodText(d)}`, d.id);
  changed();
}
export const docsByType = (unitId, type) => docsOf(unitId).filter((d) => d.docType === type).sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
export const blobOf = (key) => (key ? media.getBlob(key) : Promise.resolve(null));

/* ===== Migración: catálogo único y registros duplicados ===== */
export const duplicates = () => duplicateGroups(allVehicles());
/* Stores con vehicleId que pasan a la unidad que se conserva al unir */
const REF_STORES = ['fuelRecords', 'logisticsOperations', 'emptyContainers', 'fullContainerLoads', 'maintenanceOrders', 'maintenanceIssues', 'oilChanges', 'tireReplacements'];
/*
 * Une registros de la misma unidad: keepId se conserva (sus datos mandan; los vacíos se completan con los otros) y
 * todas las relaciones (combustible, logística, vacíos, llenos, taller, GPS, borradores, expediente) pasan a keepId.
 * Los otros registros NO se borran: quedan marcados «unido a» (mergedInto) e inactivos, fuera del listado.
 * Devuelve { moved: { store: n } }.
 */
export async function mergeUnits(keepId, otherIds, overrides = {}) {
  guardRO(); await loadUnits();
  const keep = unitById(keepId), others = otherIds.map(unitById).filter(Boolean).filter((o) => o.id !== keepId);
  if (!keep || !others.length) throw new Error('Elige los registros que se van a unir.');
  const ids = new Set(others.map((o) => o.id)), moved = {}, now = Date.now(), who = actor();
  for (const st of REF_STORES) {
    const list = (await db.all(st)).filter((r) => ids.has(r.vehicleId));
    if (list.length) { await db.putMany(st, list.map((r) => ({ ...r, vehicleId: keepId }))); moved[st] = list.length; }
  }
  /* Configuración de Taller por equipo (id «v:<vehicleId>») */
  for (const p of await db.all(db.S.maintenanceProfiles)) {
    const m = /^v:(.+)$/.exec(p.id);
    if (m && ids.has(m[1])) { if (!(await db.get(db.S.maintenanceProfiles, 'v:' + keepId))) await db.put(db.S.maintenanceProfiles, { ...p, id: 'v:' + keepId }); await db.del(db.S.maintenanceProfiles, p.id); moved.maintenanceProfiles = (moved.maintenanceProfiles || 0) + 1; }
  }
  for (const [st, arr] of [[db.S.unitDocuments, docs], [db.S.unitPhotos, photos], [db.S.unitEvents, events]]) {
    const list = arr.filter((r) => ids.has(r.unitId));
    if (list.length) { await db.putMany(st, list.map((r) => ({ ...r, unitId: keepId }))); moved[st] = list.length; }
  }
  for (const a of await db.all(db.S.attachments)) {
    const m = /^unit:(.+)$/.exec(a.owner || '');
    if (m && ids.has(m[1])) { await db.put(db.S.attachments, { ...a, owner: 'unit:' + keepId }); moved.attachments = (moved.attachments || 0) + 1; }
  }
  for (const d of await db.all(db.S.drafts)) {
    let ch = false; const data = d.data ? JSON.parse(JSON.stringify(d.data)) : null;
    if (data && ids.has(data.unitId)) { data.unitId = keepId; ch = true; }
    if (data && Array.isArray(data.units)) for (const u of data.units) if (ids.has(u.unitId)) { u.unitId = keepId; ch = true; }
    if (ch) { await db.put(db.S.drafts, { ...d, data }); moved.drafts = (moved.drafts || 0) + 1; }
  }
  const merged = { ...mergedData(keep, others), ...overrides };
  const gpsOwner = others.find((o) => o.gpsDeviceId && !keep.gpsDeviceId);
  await cat.save('vehicles', { ...merged, id: keepId, updatedAt: now, updatedBy: who, revisions: [...(keep.revisions || []), { at: now, by: who, before: Object.fromEntries(['eco', 'placas', 'vin', 'brand', 'model', 'year'].map((f) => [f, keep[f] || ''])) }].slice(-50) });
  for (const o of others) await cat.save('vehicles', { ...o, mergedInto: keepId, mergedAt: now, mergedBy: who, active: 'no', gpsDeviceId: gpsOwner && gpsOwner.id === o.id ? '' : o.gpsDeviceId || '' });
  await loadUnits(true);
  await addEvent(keepId, 'merged', `Se unieron ${others.map((o) => `${unitTitle(o)}${o.placas ? ' (' + o.placas + ')' : ''}${o.company && o.company !== 'perconsur' ? ' de ' + o.company.toUpperCase() : ''}`).join(', ')} · ${Object.entries(moved).map(([k, n]) => `${k}: ${n}`).join(', ') || 'sin registros relacionados'}`);
  for (const o of others) await addEvent(o.id, 'merged_into', `Unido a ${unitTitle(keep)} (${keepId})`);
  try { const { reloadAll } = await import('./backup.js'); await reloadAll(); } catch (e) { /* */ }
  changed();
  return { moved };
}
/* «No son la misma unidad»: el par deja de proponerse */
export async function markDistinct(ids) {
  guardRO();
  for (const id of ids) {
    const v = unitById(id); if (!v) continue;
    const set = new Set([...(v.notDuplicateOf || []), ...ids.filter((x) => x !== id)]);
    await cat.save('vehicles', { ...v, notDuplicateOf: [...set] });
  }
  await addEvent(ids[0], 'not_duplicate', ids.map((i) => unitTitle(unitById(i) || {})).join(' y '));
  changed();
}

/* ===== Cambio de día (vigencias al día sin temporizadores con la app cerrada) ===== */
/* Llama fn cuando cambia la fecha operativa: al volver a la app, al enfocar y cada minuto mientras está abierta */
export function onDayChange(fn) {
  let last = today();
  const check = () => { const t = today(); if (t !== last) { last = t; fn(t); } };
  const vis = () => { if (document.visibilityState === 'visible') check(); };
  document.addEventListener('visibilitychange', vis); window.addEventListener('focus', check); window.addEventListener('pageshow', check);
  const iv = setInterval(() => { if (document.visibilityState === 'visible') check(); }, 60000);
  return () => { document.removeEventListener('visibilitychange', vis); window.removeEventListener('focus', check); window.removeEventListener('pageshow', check); clearInterval(iv); };
}

/* Unidad por número económico (catálogo único; primero las activas) */
export function unitByEco(eco) { const e = normEco(eco); const c = units().filter((u) => normEco(u.eco) === e); return c.find(isActive) || c[0] || null; }
/* Unidades para los selectores de los formularios: catálogo único; avisa documentos vencidos sin ocultar la unidad */
export function pickerItems(day = today()) {
  return units().filter(isActive).concat(units().filter((u) => !isActive(u))).map((u) => {
    const st = statusOf(u, day);
    return { value: u.id, label: unitTitle(u), data: u,
      sub: [u.placas, [u.brand, u.model].filter(Boolean).join(' '), isActive(u) ? '' : 'Inactiva', st.expired.length ? `Documentos vencidos: ${st.expired.length}` : ''].filter(Boolean).join(' · ') };
  });
}
export { DOC_KEYS };
