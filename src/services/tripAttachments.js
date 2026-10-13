/*
 * Documentos adicionales de un viaje (store tripAttachments). Se relacionan SOLO por tripId.
 * Registro: { id, tripId, name, mimeType, kind:'pdf'|'img', size, originalSize, pages, w, h, order, storageKey,
 *   status:'ok'|'error', error, createdAt, createdBy, updatedAt, updatedBy }
 * El archivo vive en el store binario «attachments» (storageKey, owner 'trip:<tripId>'), nunca dentro del viaje
 * ni en localStorage. PDF: se guarda tal cual. Imagen: se normaliza con normImage (orientación correcta, proporción,
 * lado mayor 2200 px, JPEG 86 %) para que el expediente no pese de más y se lea bien.
 * Un archivo que no se puede procesar se conserva con status 'error' para poder reintentar o eliminarlo.
 * El documento relacionado original (trip.documentId) nunca se toca aquí.
 */
import * as db from './db.js';
import * as media from './media.js';
import { loadLib } from './libs.js';
import { normImage } from './camera.js';

export const ACCEPT = 'application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png';
export const MAX_FILE = 150 * 1024 * 1024;   /* por archivo: por encima de esto Safari en iPhone suele quedarse sin memoria */

let cache = null;
export async function loadTripAttachments(force = false) { if (!cache || force) cache = await db.all(db.S.tripAttachments); return cache; }
function actor() { try { const s = JSON.parse(sessionStorage.getItem('pcs-session') || 'null'); return (s && s.user) || 'local'; } catch (e) { return 'local'; } }

export const listFor = (tripId) => (cache || []).filter((a) => a.tripId === tripId).sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
export const countFor = (tripId) => (cache || []).reduce((n, a) => n + (a.tripId === tripId ? 1 : 0), 0);
export const byId = (id) => (cache || []).find((a) => a.id === id) || null;

export const kindOf = (file) => {
  const n = String(file.name || '').toLowerCase(), t = String(file.type || '').toLowerCase();
  if (t === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
  if (/^image\/(jpeg|jpg|png)$/.test(t) || /\.(jpe?g|png)$/.test(n)) return 'img';
  return null;
};

/* Convierte un archivo en lo que se guarda: PDF tal cual (con su número de páginas), imagen normalizada a JPEG.
   También lo usa Control de llenos (services/fulls.js) para sus documentos. */
export async function processFile(blob, name, kind) {
  if (kind === 'pdf') {
    await loadLib('pdflib');
    const d = await window.PDFLib.PDFDocument.load(new Uint8Array(await blob.arrayBuffer()), { ignoreEncryption: true });
    return { blob, pages: d.getPageCount(), type: 'application/pdf' };
  }
  const im = await normImage(blob);
  return { blob: im.blob, pages: 1, w: im.w, h: im.h, type: 'image/jpeg' };
}

async function put(rec) {
  const i = cache.findIndex((x) => x.id === rec.id);
  if (i >= 0) cache[i] = rec; else cache.push(rec);
  await db.put(db.S.tripAttachments, rec);
  return rec;
}

/*
 * Agrega varios archivos en una sola acción, uno por uno (poca memoria a la vez) y en el orden recibido.
 * Nunca cancela todo por un archivo: los dañados quedan con status 'error'; los de formato no permitido se omiten.
 * onProgress(i, total, name). Devuelve { added:[], failed:[nombres], rejected:[nombres] }.
 */
export async function addFiles(tripId, files, onProgress) {
  await loadTripAttachments();
  const out = { added: [], failed: [], rejected: [] };
  let order = listFor(tripId).reduce((m, a) => Math.max(m, a.order), 0);
  for (let i = 0; i < files.length; i++) {
    const f = files[i], kind = kindOf(f), name = f.name || `Archivo ${i + 1}`;
    onProgress && onProgress(i + 1, files.length, name);
    if (!kind) { out.rejected.push(name); continue; }
    if (f.size > MAX_FILE) { out.rejected.push(name); continue; }
    const now = Date.now(), who = actor(), id = db.uid('ta_');
    const base = { id, tripId, name, mimeType: f.type || (kind === 'pdf' ? 'application/pdf' : 'image/jpeg'), kind, originalSize: f.size, order: ++order, createdAt: now, createdBy: who, updatedAt: now, updatedBy: who };
    let rec;
    try {
      const p = await processFile(f, name, kind);
      const storageKey = await media.saveBlob(p.blob, { owner: 'trip:' + tripId, kind: 'trip-file', name, type: p.type });
      rec = { ...base, storageKey, size: p.blob.size, pages: p.pages, w: p.w || null, h: p.h || null, status: 'ok', error: '' };
    } catch (e) {
      console.warn('adjunto', name, e);
      /* Se conserva el archivo original para poder reintentar */
      let storageKey = null;
      try { storageKey = await media.saveBlob(f, { owner: 'trip:' + tripId, kind: 'trip-file', name }); } catch (e2) { /* sin espacio */ }
      rec = { ...base, storageKey, size: f.size, pages: null, w: null, h: null, status: 'error', error: 'No se pudo procesar este archivo' };
      out.failed.push(name);
    }
    await put(rec);
    if (rec.status === 'ok') out.added.push(rec);
    await new Promise((r) => setTimeout(r, 0));   /* deja respirar a la interfaz entre archivos */
  }
  return out;
}

/* Reintenta procesar un archivo que quedó con error */
export async function retry(id) {
  const a = byId(id);
  if (!a || a.status === 'ok') return a;
  const raw = a.storageKey ? await media.getBlob(a.storageKey) : null;
  if (!raw) throw new Error('El archivo ya no está en este dispositivo.');
  const p = await processFile(raw, a.name, a.kind);
  const storageKey = await media.saveBlob(p.blob, { owner: 'trip:' + a.tripId, kind: 'trip-file', name: a.name, type: p.type });
  if (a.storageKey !== storageKey) await media.remove(a.storageKey);
  return put({ ...a, storageKey, size: p.blob.size, pages: p.pages, w: p.w || null, h: p.h || null, status: 'ok', error: '', updatedAt: Date.now(), updatedBy: actor() });
}

export async function rename(id, name) {
  const a = byId(id), n = String(name || '').trim();
  if (!a || !n || n === a.name) return a;
  return put({ ...a, name: n, updatedAt: Date.now(), updatedBy: actor() });
}

/* Mueve un adjunto una posición (delta −1 sube, +1 baja). El orden mostrado es el orden del expediente. */
export async function move(id, delta) {
  const a = byId(id); if (!a) return;
  const list = listFor(a.tripId), i = list.findIndex((x) => x.id === id), j = i + delta;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  const now = Date.now();
  for (let k = 0; k < list.length; k++) if (list[k].order !== k + 1) await put({ ...list[k], order: k + 1, updatedAt: now });
}

/* Elimina el adjunto y su archivo. No afecta al documento relacionado original del viaje. */
export async function remove(id) {
  const a = byId(id); if (!a) return;
  if (a.storageKey) await media.remove(a.storageKey);
  await db.del(db.S.tripAttachments, id);
  cache = cache.filter((x) => x.id !== id);
}

/* Adjuntos cuyo archivo no está en este dispositivo (p. ej. importados con un respaldo «Solo datos») */
export async function missingFiles(tripId) {
  const out = new Set();
  for (const a of listFor(tripId)) if (a.status === 'ok' && !(await db.has(db.S.attachments, a.storageKey))) out.add(a.id);
  return out;
}
export async function blobOf(a) { return a && a.storageKey ? media.getBlob(a.storageKey) : null; }
