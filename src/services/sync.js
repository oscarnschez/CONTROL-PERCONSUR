/*
 * Información compartida entre dispositivos (Ajustes → Información compartida, #/ajustes/compartir).
 * Un solo dispositivo CAPTURISTA registra la información; los demás la CONSULTAN, sin importar respaldos.
 *
 *   Capturista (clave DATA_WRITE_KEY del Worker): cada cambio en los registros deja la información «pendiente» y, tras
 *     unos segundos sin cambios (a lo más 3 min), se publica: primero los archivos nuevos (PDF, fotos, documentos
 *     adicionales), uno por uno, y después la «foto» comprimida de los registros. Sin conexión queda pendiente (aunque
 *     se cierre la app) y se publica al volver.
 *   Consulta (clave DATA_READ_KEY): con la app abierta revisa cada minuto si hay una versión nueva; si la hay, sus
 *     registros se reemplazan por los del capturista y luego descarga los archivos que le falten. El dispositivo queda
 *     en modo solo consulta (services/access.js): la base local rechaza capturas y el Worker no le permite publicar.
 *
 * Las claves y el papel se guardan solo en este dispositivo (nunca en los respaldos, en la foto ni en el código).
 * Nunca se comparten los ajustes del dispositivo ni los borradores. Si otro dispositivo publicó con la clave de
 * capturista, el Worker rechaza la publicación (409) y aquí se decide: recibir la de la nube o reemplazarla.
 * Plan gratuito de Cloudflare KV: 1000 escrituras al día; cada publicación usa 2 y cada archivo nuevo 1, por eso los
 * cambios se agrupan.
 */
import * as db from './db.js';
import { getSetting, setSetting } from './settings.js';
import { sanitizeImport, reloadAll } from './backup.js';
import { setReadOnly } from './access.js';
import { play } from './sounds.js';
import { refresh as refreshRoute } from '../core/router.js';
import { APP_VERSION } from '../config/reference.js';
import { SYNC_STORES, fileShared, fileMeta, fileSig, newVer, newDevice, uploadPlan, downloadPlan, buildSnapshot, readSnapshot, rowsWithKey } from '../domain/sync/sync.js';

const DEBOUNCE = 20 * 1000, MAX_WAIT = 3 * 60 * 1000, RETRY = 2 * 60 * 1000, FILE_RETRY = 15 * 60 * 1000, POLL = 60 * 1000;
const LS = { dirty: 'pcs-sync-dirty', touched: 'pcs-sync-touched', files: 'pcs-sync-files', skip: 'pcs-sync-skip', have: 'pcs-sync-have', want: 'pcs-sync-want', gone: 'pcs-sync-gone' };
const OLD_WORKER = 'El intermediario en Cloudflare todavía no tiene Información compartida: pega el nuevo worker.js y vincula el espacio KV «DATA» (ver README).';

/* ===== Estado guardado en este dispositivo (localStorage: no viaja en respaldos) ===== */
function lsGet(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin espacio: se recalcula */ } }
function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* */ } }
const uploadedMap = () => lsGet(LS.files, {}) || {};
const touchedSet = () => new Set(lsGet(LS.touched, []) || []);
const skipSet = () => new Set(lsGet(LS.skip, []) || []);
function resetLocalState() { Object.values(LS).forEach(lsDel); }

/* ===== Configuración ===== */
const clean = (url) => String(url || '').trim().replace(/\/+$/, '');
export const config = () => ({ url: clean(getSetting('syncUrl', '')), key: String(getSetting('syncKey', '') || ''), name: String(getSetting('syncName', '') || '') });
export const role = () => { const c = config(); return c.url && c.key ? String(getSetting('syncRole', '') || '') : ''; };
export const configured = () => !!role();
export const deviceId = () => String(getSetting('syncDevice', '') || '');

const state = { phase: '', progress: null, error: '', fileError: '', conflict: null, remote: null, checkedAt: 0, pendingFiles: 0, keyRejected: false, pauseUntil: 0 };
const subs = new Set();
export const onSyncChange = (fn) => { subs.add(fn); return () => subs.delete(fn); };
function emit() { subs.forEach((fn) => { try { fn(); } catch (e) { console.warn(e); } }); }
function setPhase(phase, progress = null) { state.phase = phase; state.progress = progress; emit(); }
export const status = () => ({ ...state, role: role(), ver: String(getSetting('syncVer', '') || ''), at: Number(getSetting('syncAt', 0)) || 0, dirty: !!lsGet(LS.dirty), device: deviceId() });

/* ===== Peticiones al Worker (header X-PCS-Data; solo https) ===== */
export class SyncError extends Error { constructor(message, { status = 0, offline = false, body = null } = {}) { super(message); this.status = status; this.offline = offline; this.body = body; } }
async function call(path, { method = 'GET', body, headers = {}, raw = false, timeout = 30000, cfg = config() } = {}) {
  if (!cfg.url || !cfg.key) throw new SyncError('Información compartida sin configurar');
  if (!/^https:\/\/[^\s/]+/i.test(cfg.url)) throw new SyncError('La dirección debe empezar con https://');
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeout);
  let r;
  try { r = await fetch(cfg.url + path, { method, headers: { 'X-PCS-Data': cfg.key, ...headers }, body, cache: 'no-store', signal: ctl.signal }); }
  catch (e) { throw new SyncError(e.name === 'AbortError' ? 'El servicio no respondió a tiempo' : 'Sin conexión con el servicio', { offline: true }); }
  finally { clearTimeout(t); }
  if (raw && r.ok) return r;
  let out = null; try { out = await r.json(); } catch (e) { /* */ }
  /* Worker anterior: no conoce las rutas de datos y pide la clave del GPS */
  if (r.status === 401 && !(out && /datos/i.test(out.error || ''))) throw new SyncError(OLD_WORKER, { status: 401 });
  if (!r.ok || !out || out.ok === false) throw new SyncError((out && out.error) || `El servicio respondió ${r.status}`, { status: r.status, body: out });
  return out;
}
const fileUrl = (id) => '/v1/archivos/' + encodeURIComponent(id);

/* Foto comprimida (gzip con CompressionStream; si el navegador no lo tiene, JSON simple) */
async function encode(text) {
  const bytes = new TextEncoder().encode(text);
  if (typeof CompressionStream === 'function') {
    try { return { bytes: await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer(), enc: 'gzip' }; } catch (e) { /* sin compresión */ }
  }
  return { bytes, enc: 'json' };
}
async function decode(buf, enc) {
  if (enc === 'gzip') {
    if (typeof DecompressionStream !== 'function') throw new SyncError('Este navegador no puede abrir la información compartida. Actualiza iOS o el navegador.');
    buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  try { return JSON.parse(new TextDecoder().decode(buf)); } catch (e) { throw new SyncError('La información de la nube está dañada.'); }
}

/* Archivos de borradores: nunca se publican ni se quitan al recibir */
const draftFileIds = async () => new Set((await db.indexKeys(db.S.attachments, 'owner', IDBKeyRange.bound('draft:', 'draft:￿'))).map(String));

/* ===== Capturista: publicar ===== */
let dirtySeq = 0, timer = 0, retryTimer = 0, firstDirtyAt = 0, publishing = null;
function markDirty() {
  dirtySeq++;
  if (!lsGet(LS.dirty)) lsSet(LS.dirty, Date.now());
  schedule(DEBOUNCE); emit();
}
function onDbWrite(store, keys, values) {
  if (role() !== 'write') return;
  if (store === db.S.attachments) {
    const up = uploadedMap(), touched = touchedSet(); let relevant = false;
    (keys || []).forEach((k, i) => {
      const v = values && values[i];
      if (k != null && (v ? fileShared(v) : up[k])) { touched.add(String(k)); relevant = true; }
    });
    if (!relevant) return;
    lsSet(LS.touched, [...touched]);
  } else if (!SYNC_STORES.includes(store)) return;
  markDirty();
}
function schedule(delay) {
  if (role() !== 'write' || state.conflict || state.keyRejected) return;
  const now = Date.now();
  if (!firstDirtyAt) firstDirtyAt = now;
  clearTimeout(timer);
  timer = setTimeout(() => { publish(); }, Math.max(500, Math.min(delay, firstDirtyAt + MAX_WAIT - now)));
}
function retryLater(ms = RETRY) { clearTimeout(retryTimer); retryTimer = setTimeout(() => { if (lsGet(LS.dirty) || state.pendingFiles) publish(); }, ms); }

/* Sube los archivos nuevos o modificados y borra de la nube los que ya no existen */
async function pushFiles() {
  const drafts = await draftFileIds();
  const local = (await db.keys(db.S.attachments)).map(String).filter((id) => !drafts.has(id));
  const up = uploadedMap(), touched = touchedSet(), skip = skipSet();
  const plan = uploadPlan(local, up, touched, skip);
  const total = plan.upload.length + plan.remove.length;
  let n = 0; state.fileError = '';
  if (total) setPhase('archivos', { done: 0, total });
  for (const id of plan.remove) {
    try { await call(fileUrl(id), { method: 'DELETE' }); }
    catch (e) { if (e.offline) throw e; if (e.status !== 404 && e.status !== 400) { state.fileError = e.message; break; } }
    delete up[id]; lsSet(LS.files, up); setPhase('archivos', { done: ++n, total });
  }
  if (!state.fileError) {
    for (const id of plan.upload) {
      const r = await db.get(db.S.attachments, id);
      if (r && fileShared(r) && r.buf) {
        try { await call(fileUrl(id), { method: 'PUT', body: r.buf, timeout: 120000, headers: { 'Content-Type': 'application/octet-stream' } }); }
        catch (e) {
          if (e.offline) throw e;
          if (e.status === 413 || e.status === 400) { skip.add(id); lsSet(LS.skip, [...skip]); continue; }
          state.fileError = e.message; break;
        }
        up[id] = fileMeta(r); lsSet(LS.files, up);
      }
      touched.delete(id); lsSet(LS.touched, [...touched]);
      setPhase('archivos', { done: ++n, total });
    }
  }
  /* Modificados que ya no existen (se borraron): fuera de la lista */
  const localSet = new Set(local);
  for (const id of touched) if (!localSet.has(id)) touched.delete(id);
  lsSet(LS.touched, [...touched]);
  state.pendingFiles = uploadPlan(local, up, touched, skip).upload.length;
}

export function publish({ force = false, manual = false } = {}) {
  if (publishing) return publishing;
  if (manual) state.keyRejected = false;
  if (role() !== 'write' || (state.conflict && !force) || state.keyRejected) return Promise.resolve(false);
  clearTimeout(timer); clearTimeout(retryTimer); firstDirtyAt = 0;
  publishing = (async () => {
    const seq = dirtySeq;
    try {
      await pushFiles();
      setPhase('publicando');
      const data = {};
      for (const s of SYNC_STORES) data[s] = await db.all(s);
      const files = Object.values(uploadedMap()), ver = newVer();
      const snap = buildSnapshot({ data, files, ver, device: deviceId(), by: config().name, appVersion: APP_VERSION });
      const { bytes, enc } = await encode(JSON.stringify(snap));
      const headers = { 'Content-Type': 'application/octet-stream', 'X-PCS-Ver': ver, 'X-PCS-Device': deviceId(), 'X-PCS-Base': String(getSetting('syncVer', '') || ''),
        'X-PCS-Enc': enc, 'X-PCS-Files': String(files.length), 'X-PCS-By': encodeURIComponent(config().name).slice(0, 240) };
      if (force) headers['X-PCS-Force'] = '1';
      const r = await call('/v1/datos', { method: 'PUT', body: bytes, headers, timeout: 120000 });
      await setSetting('syncVer', ver);
      await setSetting('syncAt', (r.published && r.published.at) || Date.now());
      state.remote = r.published || null; state.conflict = null; state.error = '';
      if (dirtySeq === seq) lsDel(LS.dirty); else schedule(DEBOUNCE);
      if (state.fileError || state.pendingFiles) retryLater(FILE_RETRY);
      play('cloud');
      return true;
    } catch (e) {
      if (e.status === 409) { state.conflict = (e.body && e.body.published) || { ver: '' }; state.remote = e.body && e.body.published ? e.body.published : state.remote; state.error = ''; }
      else {
        state.error = e.message;
        if (e.offline || e.status >= 500) retryLater();
        if (e.status === 429) retryLater(10 * 60 * 1000);
        if (e.status === 401 || e.status === 403) state.keyRejected = true;   /* no se insiste con una clave rechazada */
      }
      return false;
    } finally { publishing = null; setPhase(''); }
  })();
  return publishing;
}

/* ===== Recibir (consulta; o el capturista que adopta la información de la nube) ===== */
let receiving = null, refreshTimer = 0;

/* Reemplaza los registros compartidos por los de la foto, en una sola transacción */
async function applySnapshot(snap) {
  const data = sanitizeImport({ ...snap.data, attachments: snap.files });
  await db.tx(SYNC_STORES, ({ store }) => {
    for (const s of SYNC_STORES) { const st = store(s); st.clear(); for (const r of rowsWithKey(s, data[s])) st.put(r); }
  }, { silent: true });
  return data.attachments;
}
/* Descarga los archivos que faltan (3 a la vez); quita los que el capturista borró */
async function pullFiles(want) {
  const drafts = await draftFileIds();
  const local = (await db.keys(db.S.attachments)).map(String).filter((id) => !drafts.has(id));
  const have = lsGet(LS.have, {}) || {}, gone = new Set(lsGet(LS.gone, []) || []);
  const plan = downloadPlan(local, have, want);
  for (const id of plan.remove) { await db.del(db.S.attachments, id, { silent: true }); delete have[id]; }
  for (const f of plan.update) {
    const r = await db.get(db.S.attachments, f.id);
    if (r) await db.put(db.S.attachments, { ...f, buf: r.buf }, { silent: true });
    have[f.id] = fileSig(f);
  }
  lsSet(LS.have, have);
  const queue = plan.download.filter((f) => !gone.has(f.id)), total = queue.length;
  let done = 0, failed = 0, got = 0, offline = false;
  if (total) setPhase('archivos', { done: 0, total });
  const worker = async () => {
    while (queue.length && !offline) {
      const f = queue.shift();
      try {
        const r = await call(fileUrl(f.id), { raw: true, timeout: 120000 });
        const buf = await r.arrayBuffer();
        await db.put(db.S.attachments, { ...f, buf }, { silent: true });
        have[f.id] = fileSig(f); got++;
      } catch (e) {
        if (e.offline) offline = true;
        else if (e.status === 404) gone.add(f.id);   /* el capturista no lo pudo subir: no se reintenta en esta versión */
        else failed++;
      }
      setPhase('archivos', { done: ++done, total });
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  lsSet(LS.have, have); lsSet(LS.gone, [...gone]);
  state.pendingFiles = queue.length + failed;
  if (!state.pendingFiles) lsDel(LS.want);
  return got + plan.remove.length + plan.update.length > 0;
}

/* Después de cambiar la base: cachés, avisos a las pantallas y redibujo (sin cerrar hojas ni mover el desplazamiento) */
async function afterChange() {
  await reloadAll();
  ['logistics:change', 'empties:change', 'fulls:change', 'geo:change', 'maintenance:change', 'units:change', 'serviceorders:change', 'pcs:sync'].forEach((n) => window.dispatchEvent(new CustomEvent(n)));
  safeRefresh();
}
function safeRefresh() {
  clearTimeout(refreshTimer);
  /* El Centro de Monitoreo se actualiza solo con logistics:change (redibujarlo reiniciaría el mapa) */
  if (document.body.dataset.screen === 'monitor') return;
  const a = document.activeElement;
  if (document.documentElement.classList.contains('sheet-open') || (a && a.matches && a.matches('input,textarea,select'))) { refreshTimer = setTimeout(safeRefresh, 4000); return; }
  const y = window.scrollY, root = document.documentElement;
  root.classList.add('sync-refresh');
  Promise.resolve(refreshRoute()).finally(() => { window.scrollTo(0, y); setTimeout(() => root.classList.remove('sync-refresh'), 400); });
}

/* Consulta: revisa la versión publicada y, si cambió, la recibe. asWriter: el capturista adopta la información de la nube */
export function receive({ force = false, asWriter = false, auto = false } = {}) {
  if (receiving) return receiving;
  if (auto && (state.keyRejected || Date.now() < state.pauseUntil)) return Promise.resolve(false);
  if (!auto) { state.keyRejected = false; state.pauseUntil = 0; }
  const r0 = role();
  if (!(r0 === 'read' || (asWriter && r0 === 'write'))) return Promise.resolve(false);
  receiving = (async () => {
    try {
      const st = await call('/v1/datos/estado');
      state.checkedAt = Date.now(); state.remote = st.published || null; state.error = '';
      if (st.role && st.role !== r0) { await setSetting('syncRole', st.role); applyRole(); if (!asWriter) return false; }
      if (!st.published) { emit(); return false; }
      let changed = false;
      if (force || asWriter || st.published.ver !== getSetting('syncVer', '')) {
        setPhase('recibiendo');
        const res = await call('/v1/datos', { raw: true, timeout: 120000 });
        const snap = readSnapshot(await decode(await res.arrayBuffer(), res.headers.get('X-PCS-Enc') || 'json'));
        const files = await applySnapshot(snap);
        await setSetting('syncVer', snap.ver);
        await setSetting('syncAt', Date.now());
        lsSet(LS.want, files); lsDel(LS.gone);
        if (asWriter) {
          /* Lo que ya está en la nube no se vuelve a subir */
          lsSet(LS.files, Object.fromEntries(files.map((f) => [f.id, f]))); lsDel(LS.touched); lsDel(LS.dirty); lsDel(LS.skip);
          state.conflict = null; state.remote = st.published;
        }
        changed = true;
        await afterChange();
        play('cloud');
      }
      const want = lsGet(LS.want);
      if (Array.isArray(want) && await pullFiles(want)) await afterChange();
      return changed;
    } catch (e) {
      state.error = e.message;
      /* Clave rechazada o conexión bloqueada: no se insiste solo (cada intento fallido acerca el bloqueo de la IP,
         que también detendría el GPS); se reintenta al guardar la clave o con «Revisar ahora» */
      if (e.status === 401 || e.status === 403) state.keyRejected = true;
      if (e.status === 429) state.pauseUntil = Date.now() + 10 * 60 * 1000;
      return false;
    } finally { receiving = null; setPhase(''); }
  })();
  return receiving;
}

/* ===== Alta, cambio y baja de este dispositivo ===== */
/* Prueba una dirección y clave sin guardarlas: { role, published } */
export async function test(url, key) {
  const st = await call('/v1/datos/estado', { cfg: { url: clean(url), key: String(key || '').trim() } });
  return { role: st.role, published: st.published || null };
}
export async function connect({ url, key, name = '' }) {
  const t = await test(url, key);
  const prev = getSetting('syncRole', '');
  if (!deviceId()) await setSetting('syncDevice', newDevice());
  await setSetting('syncUrl', clean(url));
  await setSetting('syncKey', String(key || '').trim());
  await setSetting('syncName', String(name || '').trim().slice(0, 40));
  if (prev !== t.role) { resetLocalState(); await setSetting('syncVer', ''); await setSetting('syncAt', 0); }
  await setSetting('syncRole', t.role);
  Object.assign(state, { remote: t.published, error: '', conflict: null, fileError: '', pendingFiles: 0, keyRejected: false, pauseUntil: 0 });
  applyRole();
  emit();
  return t;
}
/* Capturista: la nube tiene información de otro dispositivo (o de una instalación anterior de este) */
export function needsDecision() {
  const s = status();
  return s.role === 'write' && !!s.remote && s.remote.device !== s.device && s.remote.ver !== s.ver;
}
/* Capturista: publicar todo lo de este dispositivo (la primera vez o para reemplazar la de la nube) */
export function publishAll({ force = false } = {}) {
  if (force) { lsDel(LS.files); lsDel(LS.touched); lsDel(LS.skip); state.conflict = null; }
  dirtySeq++; lsSet(LS.dirty, Date.now());
  return publish({ force, manual: true });
}
export async function disconnect() {
  for (const k of ['syncKey', 'syncRole', 'syncVer', 'syncAt']) await setSetting(k, '');
  resetLocalState();
  Object.assign(state, { phase: '', progress: null, error: '', fileError: '', conflict: null, remote: null, checkedAt: 0, pendingFiles: 0, keyRejected: false, pauseUntil: 0 });
  applyRole(); emit();
}

/* ===== Arranque ===== */
let pollTimer = 0, started = false;
function applyRole() {
  const r = role();
  setReadOnly(r === 'read');
  clearInterval(pollTimer); pollTimer = 0;
  if (r === 'read' && started) pollTimer = setInterval(() => { if (document.visibilityState === 'visible') receive({ auto: true }); }, POLL);
}
/* Antes de cualquier escritura del arranque: activa el modo consulta si corresponde */
export function initSync() { setReadOnly(role() === 'read'); }
/* Con la interfaz montada: escucha cambios, publica lo pendiente o recibe lo nuevo */
export function startSync() {
  if (started) return;
  started = true;
  db.onWrite(onDbWrite);
  applyRole();
  document.addEventListener('visibilitychange', () => {
    const r = role();
    if (document.visibilityState === 'visible') {
      if (r === 'read' && Date.now() - state.checkedAt > 15000) receive({ auto: true });
      if (r === 'write' && lsGet(LS.dirty)) schedule(3000);
    } else if (r === 'write' && lsGet(LS.dirty)) publish();   /* al salir de la app: se intenta publicar ya */
  });
  window.addEventListener('online', () => { const r = role(); if (r === 'read') receive({ auto: true }); if (r === 'write' && (lsGet(LS.dirty) || state.pendingFiles)) schedule(3000); });
  const r = role();
  if (r === 'read') receive({ auto: true });
  if (r === 'write' && lsGet(LS.dirty)) schedule(5000);
  if (r === 'write' && !lsGet(LS.dirty)) call('/v1/datos/estado').then((st) => { state.remote = st.published || null; emit(); }).catch(() => {});
}
