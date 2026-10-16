/*
 * GPS (IOPGPS a través del intermediario gps-proxy). Es un complemento: si no está configurado o falla,
 * Logística e Inicio siguen funcionando igual y solo se muestra «Ubicación GPS no disponible».
 *
 * Configuración (Ajustes → GPS, guardada en este dispositivo; la clave no se incluye en los respaldos):
 *   gpsUrl  dirección del Worker (https://perconsur-gps.<subdominio>.workers.dev)
 *   gpsKey  clave PCS_KEY del Worker
 * Relación con las unidades: vehicles.gpsDeviceId (IMEI del equipo) — nunca por el número económico escrito.
 *
 * Consultas: una sola petición para toda la flota; cada pantalla pide su intervalo (detalle 30 s, Inicio 60 s) y se usa
 * el menor. Con la app en segundo plano no se consulta (iOS además suspende la PWA); al volver se actualiza al momento.
 */
import { getSetting, setSetting } from './settings.js';
import { listAll } from './catalogs.js';
import { ageText, mergePositions, isHiddenImei } from '../domain/gps/gps.js';

const DETAIL_TTL = 3 * 60 * 1000;
const state = { devices: new Map(), fetchedAt: 0, error: '', stale: false, loading: null };
const details = new Map();   /* imei → { at, device } */
const previous = new Map();  /* imei → lectura anterior (para saber si se movió cuando IOPGPS no entrega velocidad) */
const pendingDetail = new Map();
const subs = new Set();
let timer = null, curInterval = 0;

export const config = () => ({ url: String(getSetting('gpsUrl', '') || '').replace(/\/+$/, ''), key: String(getSetting('gpsKey', '') || '') });
export const configured = () => { const c = config(); return !!(c.url && c.key); };
export async function saveConfig({ url, key }) {
  await setSetting('gpsUrl', String(url || '').trim().replace(/\/+$/, ''));
  await setSetting('gpsKey', String(key || '').trim());
  state.devices = new Map(); state.fetchedAt = 0; state.error = ''; details.clear();
  emit();
}
export const status = () => ({ fetchedAt: state.fetchedAt, error: state.error, stale: state.stale, count: state.devices.size });

/* IMEI vinculado a una unidad del catálogo */
export const imeiOf = (vehicleId) => { const v = listAll('vehicles').find((x) => x.id === vehicleId); return v && v.gpsDeviceId ? String(v.gpsDeviceId) : ''; };
export const trackingUrlOf = (vehicleId) => { const v = listAll('vehicles').find((x) => x.id === vehicleId); return (v && v.trackingUrl) || ''; };
export const positionOfImei = (imei) => (imei ? state.devices.get(String(imei)) || null : null);
export const positionOf = (vehicleId) => positionOfImei(imeiOf(vehicleId));
export const devices = () => [...state.devices.values()];
export const previousOf = (imei) => previous.get(String(imei)) || null;

/* Error de la petición: offline = no hubo respuesta (sin conexión o tiempo agotado); status = código HTTP */
export class GpsError extends Error { constructor(message, { status = 0, offline = false } = {}) { super(message); this.status = status; this.offline = offline; } }
async function call(path, cfg = config(), timeout = 12000, { method = 'GET', body } = {}) {
  if (!cfg.url || !cfg.key) throw new GpsError('GPS sin configurar');
  /* La clave solo viaja cifrada (https) */
  if (!/^https:\/\/[^\s/]+/i.test(cfg.url)) throw new GpsError('La dirección del servicio GPS debe empezar con https://');
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeout);
  let r;
  try {
    const headers = { 'X-PCS-Key': cfg.key };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    r = await fetch(cfg.url + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', signal: ctl.signal });
  } catch (e) {
    throw new GpsError(e.name === 'AbortError' ? 'El servicio GPS no respondió a tiempo' : 'Sin conexión con el servicio GPS', { offline: true });
  } finally { clearTimeout(t); }
  let out = null; try { out = await r.json(); } catch (e) { /* */ }
  if (!r.ok || !out || out.ok === false) throw new GpsError((out && out.error) || `El servicio GPS respondió ${r.status}`, { status: r.status });
  return out;
}
/* Otras rutas del Worker con la misma clave (enlaces de rastreo para clientes) */
export const request = (path, { method = 'GET', body, timeout = 12000 } = {}) => call(path, config(), timeout, { method, body });

/* Posiciones de la flota (una sola petición; no repite si se pidió hace menos de 10 s) */
export async function refresh({ force = false } = {}) {
  if (!configured()) return status();
  if (state.loading) return state.loading;
  if (!force && Date.now() - state.fetchedAt < 10000) return status();
  state.loading = (async () => {
    try {
      const b = await call('/v1/posiciones');
      const next = new Map((b.devices || []).filter((d) => d && d.imei && !isHiddenImei(d.imei)).map((d) => [String(d.imei), d]));
      next.forEach((d, imei) => { const o = state.devices.get(imei); if (o && o.gpsTime && d.gpsTime && o.gpsTime !== d.gpsTime) previous.set(imei, o); });
      state.devices = next;
      state.fetchedAt = b.fetchedAt || Date.now(); state.stale = !!b.stale; state.error = b.warning || '';
    } catch (e) { state.error = e.message; }
    finally { state.loading = null; emit(); }
    return status();
  })();
  return state.loading;
}

/* Dirección y estado de una unidad (bajo demanda; guardado 3 min) */
export function cachedDetail(imei) { const d = details.get(String(imei)); return d ? d.device : null; }
export async function detail(imei, { force = false } = {}) {
  imei = String(imei || ''); if (!imei || isHiddenImei(imei) || !configured()) return null;
  const c = details.get(imei);
  if (!force && c && Date.now() - c.at < DETAIL_TTL) return c.device;
  if (pendingDetail.has(imei)) return pendingDetail.get(imei);
  const p = call('/v1/ubicacion?imei=' + encodeURIComponent(imei)).then((b) => { details.set(imei, { at: Date.now(), device: b.device || null }); emit(); return b.device || null; })
    .catch(() => (c ? c.device : null)).finally(() => pendingDetail.delete(imei));
  pendingDetail.set(imei, p);
  return p;
}
/* Mejor dato disponible: posición de la flota + dirección del detalle si existe */
export const bestOf = (imei) => mergePositions(positionOfImei(imei), cachedDetail(imei));

/* Prueba la conexión con datos sin guardar (Ajustes → GPS) */
export async function test(url, key) {
  const b = await call('/v1/posiciones', { url: String(url || '').trim().replace(/\/+$/, ''), key: String(key || '').trim() });
  return { count: (b.devices || []).length, withFix: (b.devices || []).filter((d) => Number.isFinite(d.lat) && Number.isFinite(d.lng)).length, devices: b.devices || [] };
}

/* ===== Suscripción con intervalo; se pausa con la app en segundo plano ===== */
function emit() { subs.forEach((s) => { try { s.fn(); } catch (e) { console.warn(e); } }); }
function schedule() {
  const iv = subs.size ? Math.min(...[...subs].map((s) => s.interval)) : 0;
  if (iv === curInterval) return;
  clearInterval(timer); timer = null; curInterval = iv;
  if (iv) timer = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, iv);
}
export function watch(fn, interval = 60000) {
  const s = { fn, interval }; subs.add(s); schedule();
  if (configured() && Date.now() - state.fetchedAt > Math.min(interval, 30000)) refresh();
  return () => { subs.delete(s); schedule(); };
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && subs.size && Date.now() - state.fetchedAt > curInterval) refresh({ force: true });
});

/* «hace 24 s» se mantiene al día sin volver a consultar: elementos con data-gps-ts */
export function tickAges(root) {
  const upd = () => root.querySelectorAll('[data-gps-ts]').forEach((el) => { const ts = +el.dataset.gpsTs; if (ts) el.textContent = (el.dataset.gpsPrefix || '') + ageText(ts); });
  const t = setInterval(upd, 10000);
  return () => clearInterval(t);
}
