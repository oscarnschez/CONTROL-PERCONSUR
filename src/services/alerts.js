/*
 * Avisos automáticos (Ajustes → Avisos, #/avisos): vencimientos de documentos y llegadas y salidas de las unidades.
 *
 * Quién hace qué:
 *   Worker gps-proxy (Cloudflare, cada 5 min aunque nadie tenga la app abierta): compara las posiciones GPS con las
 *     geocercas, registra llegadas y salidas, y una vez al día (8:00) revisa los vencimientos; envía las notificaciones
 *     push a los dispositivos suscritos.
 *   Esta app: publica al Worker lo que hay que vigilar (POST /v1/avisos/config, solo desde un dispositivo que captura):
 *     unidades con GPS, geocercas (lugares de los catálogos con ubicación exacta + el destino de cada viaje activo) y
 *     documentos con fecha de fin confirmada. Solo se publica si algo cambió (y como recordatorio cada 12 h).
 *   Cada dispositivo consulta las llegadas y salidas (GET /v1/avisos/eventos) y las guarda en su store geoEvents
 *     (no viaja en la información compartida: cada dispositivo las pide al Worker).
 * Logística: una llegada o salida del destino del viaje sugiere el siguiente estado (llegó → Descargando; salió → En
 * ruta vacío; llegó al patio de vacíos → Vacío). Con «Cambiar el estado automáticamente» se aplica sola (queda en la
 * bitácora como «Geocerca»), solo en un dispositivo que captura.
 * Notificaciones push: cada dispositivo decide si las recibe (Ajustes → Avisos); en iPhone requieren la app instalada
 * en la pantalla de inicio (iOS 16.4 o posterior). Usa la misma dirección y clave del Worker que el GPS.
 */
import * as db from './db.js';
import * as gps from './gps.js';
import { getSetting, setSetting } from './settings.js';
import { listAll } from './catalogs.js';
import { placeLoc, onGeoChange } from './geocode.js';
import * as un from './units.js';
import * as lg from './logistics.js';
import { targetOf } from './destinations.js';
import { isReadOnly } from './access.js';
import { isStandalone } from './pwa.js';
import { statusLabel } from '../config/logistics.js';
import { catalogZones, opZone, suggestionFor, staysOf, sanitizeGeoEvent, duesFrom, ZONE_KINDS } from '../domain/alerts/alerts.js';
import { alertRows, unitTitle, docType, isActive } from '../domain/units/units.js';

const LS = { pub: 'pcs-alerts-pub', cursor: 'pcs-alerts-cursor', seen: 'pcs-alerts-seen', seenDay: 'pcs-alerts-seenday', dismissed: 'pcs-alerts-dismissed', push: 'pcs-push' };
const POLL = 2 * 60 * 1000, REPUBLISH = 12 * 3600 * 1000, DEBOUNCE = 8000;
const TRACKED = ['to_destination', 'unloading', 'empty_transit', 'empty'];
function lsGet(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin espacio */ } }
function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* */ } }

const state = { events: [], ids: new Set(), inside: {}, cronAt: null, checkedAt: null, error: '', workerOld: false, pubError: '', loaded: false, memCursor: 0 };
const EVT = 'alerts:change';
const emit = () => window.dispatchEvent(new CustomEvent(EVT));
export const onAlertsChange = (fn) => { window.addEventListener(EVT, fn); return () => window.removeEventListener(EVT, fn); };
export const status = () => ({ cronAt: state.cronAt, checkedAt: state.checkedAt, error: state.error, workerOld: state.workerOld, pubError: state.pubError, published: lsGet(LS.pub, null), configured: gps.configured() });
/* ¿Este dispositivo publica lo que hay que vigilar? (captura; los de consulta solo reciben) */
export const canPublish = () => gps.configured() && !isReadOnly();

/* ===== Preferencias de este dispositivo (radios, lugares sin vigilar, cambio automático) ===== */
export const prefs = () => ({ radius: {}, r: {}, off: {}, auto: false, ...(getSetting('alertsPrefs', null) || {}) });
export async function setPrefs(patch) { await setSetting('alertsPrefs', { ...prefs(), ...patch }); plan = null; emit(); schedulePublish(); }

/* ===== Llegadas y salidas ===== */
export async function loadAlerts(force = false) {
  if (state.loaded && !force) return state.events;
  const rows = (await db.all(db.S.geoEvents)).map(sanitizeGeoEvent).filter(Boolean);
  state.events = rows.sort((a, b) => b.at - a.at); state.ids = new Set(rows.map((e) => e.id)); state.loaded = true;
  return state.events;
}
export const events = () => state.events;
export const eventsOfImei = (imei) => state.events.filter((e) => e.imei === String(imei || ''));
export const insideOf = (imei) => state.inside[String(imei || '')] || {};
export const insideAll = () => state.inside;

let polling = null;
export async function refreshEvents() {
  if (!gps.configured()) return status();
  if (polling) return polling;
  polling = (async () => {
    await loadAlerts();
    /* Dispositivo de consulta: no guarda el avance (si su store se reinicia vuelve a pedir los 30 días) */
    const cursor = isReadOnly() ? state.memCursor : Number(lsGet(LS.cursor, 0)) || 0;
    try {
      const b = await gps.request('/v1/avisos/eventos?desde=' + cursor, { timeout: 25000 });
      state.inside = b.inside || {}; state.cronAt = b.cronAt || null; state.checkedAt = b.checkedAt || Date.now(); state.error = ''; state.workerOld = false;
      const fresh = (b.events || []).map(sanitizeGeoEvent).filter((e) => e && !state.ids.has(e.id));
      if (fresh.length) {
        await db.putMany(db.S.geoEvents, fresh, { silent: true });
        fresh.forEach((e) => state.ids.add(e.id));
        state.events = [...fresh, ...state.events].sort((a, b) => b.at - a.at);
      }
      const max = Math.max(cursor, ...(b.events || []).map((e) => e.rec || e.at || 0));
      if (isReadOnly()) state.memCursor = max; else lsSet(LS.cursor, max);
      if (fresh.length && canPublish() && prefs().auto) await autoApply(fresh);
    } catch (e) { state.workerOld = e.status === 404; state.error = e.status === 404 ? 'El Worker todavía no tiene avisos: pega el nuevo worker.js (ver README).' : e.message; }
    emit();
    return status();
  })().finally(() => { polling = null; });
  return polling;
}

/* ===== Geocercas ===== */
let plan = null, planAt = 0;
/* Lugares vigilados (de los catálogos) y destino de cada viaje activo. Se recalcula a lo más cada 5 s */
export function zonePlan() {
  if (plan && Date.now() - planAt < 5000) return plan;
  const p = prefs();
  const cats = Object.fromEntries(Object.values(ZONE_KINDS).filter((k) => k.catalog).map((k) => [k.catalog, listAll(k.catalog)]));
  const cz = catalogZones(cats, placeLoc, p);
  const ids = new Set(cz.zones.map((z) => z.id)), trips = [];
  for (const op of lg.all().filter((o) => !o.closedAt && TRACKED.includes(o.status))) {
    const imei = gps.imeiOf(op.vehicleId);
    if (!imei) continue;
    const t = targetOf(op);
    if (!t) continue;
    const oz = opZone(op, t, ids, p);
    trips.push({ op, imei, target: t, zoneId: oz ? oz.id : null, zone: oz && oz.zone && !(p.off || {})[oz.id] ? { ...oz.zone, imei } : null, zoneName: oz ? oz.name : '' });
  }
  plan = { ...cz, trips }; planAt = Date.now();
  return plan;
}
const opZoneId = (op) => { const t = zonePlan().trips.find((x) => x.op.id === op.id); return t ? t.zoneId : null; };

/* Lo que se publica al Worker */
export function buildConfig() {
  const pl = zonePlan(), day = un.today();
  const units = un.units().filter((u) => isActive(u) && /^\d{8,20}$/.test(String(u.gpsDeviceId || ''))).map((u) => ({ imei: String(u.gpsDeviceId), unit: unitTitle(u) }));
  const zones = [...pl.zones.map(({ id, name, kind, lat, lng, r }) => ({ id, name, kind, lat, lng, r })), ...pl.trips.filter((t) => t.zone).map((t) => ({ ...t.zone }))];
  const rows = alertRows(un.rows(day).filter((r) => isActive(r.unit)), day, { window: 'all', soon: un.soonDays() });
  return { tz: un.tz(), units, zones, dues: duesFrom(rows, unitTitle, (t) => docType(t).label) };
}
const hashOf = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36) + s.length.toString(36); };
export async function publish({ force = false } = {}) {
  if (!canPublish()) return null;
  await un.loadUnits(); await lg.loadLogistics();
  plan = null;
  const cfg = buildConfig(), hash = hashOf(JSON.stringify(cfg)), last = lsGet(LS.pub, {}) || {};
  if (!force && last.hash === hash && Date.now() - (last.at || 0) < REPUBLISH) return last;
  try {
    await gps.request('/v1/avisos/config', { method: 'POST', body: cfg, timeout: 25000 });
    const rec = { hash, at: Date.now(), units: cfg.units.length, zones: cfg.zones.length, dues: cfg.dues.length };
    lsSet(LS.pub, rec); state.pubError = ''; state.workerOld = false; emit();
    return rec;
  } catch (e) {
    state.workerOld = e.status === 404; state.pubError = e.status === 404 ? 'El Worker todavía no tiene avisos: pega el nuevo worker.js (ver README).' : e.message; emit();
    return null;
  }
}
let pubT = null;
export function schedulePublish() { plan = null; clearTimeout(pubT); pubT = setTimeout(() => { publish().catch(() => {}); }, DEBOUNCE); }

/* ===== Logística: sugerencias de estado y estancias ===== */
const dismissedSet = () => new Set(lsGet(LS.dismissed, []) || []);
export function suggestionForOp(op) {
  if (!op || op.closedAt) return null;
  const imei = gps.imeiOf(op.vehicleId);
  if (!imei) return null;
  return suggestionFor(op, eventsOfImei(imei), opZoneId(op), dismissedSet());
}
export function dismiss(eventId) { const d = [...dismissedSet(), eventId].slice(-300); lsSet(LS.dismissed, d); emit(); }
async function markApplied(ev, statusKey) {
  const e = state.events.find((x) => x.id === ev.id);
  if (!e) return;
  e.applied = statusKey;
  try { await db.put(db.S.geoEvents, { ...e }, { silent: true }); } catch (err) { /* solo consulta */ }
}
export async function applySuggestion(op, s, { by = '' } = {}) {
  await lg.setStatus(op.id, s.status, { by });
  await markApplied(s.event, s.status);
  emit();
}
/* Cambio automático (si está activado): solo con eventos recién recibidos */
async function autoApply(fresh) {
  const ids = new Set(fresh.map((e) => e.id)), done = [];
  for (const op of lg.all().filter((o) => !o.closedAt)) {
    const s = suggestionForOp(op);
    if (!s || !ids.has(s.event.id)) continue;
    try { await applySuggestion(op, s, { by: 'Geocerca' }); done.push({ op, s }); } catch (e) { console.warn('cambio automático', e); }
  }
  if (done.length) window.dispatchEvent(new CustomEvent('alerts:applied', { detail: done.map(({ op, s }) => `${lg.view(op).label} ${s.text.toLowerCase()} → ${statusLabel(s.status)}`) }));
}
/* Llegadas y salidas durante una operación (más reciente primero) y estancia en curso */
export function staysForOp(op) {
  const imei = op ? gps.imeiOf(op.vehicleId) : '';
  if (!imei) return [];
  const names = Object.fromEntries([...zonePlan().zones, ...zonePlan().trips.filter((t) => t.zoneId).map((t) => ({ id: t.zoneId, name: t.zoneName }))].map((z) => [z.id, z.name]));
  return staysOf(eventsOfImei(imei), { from: op.startedAt || 0, to: op.closedAt || Infinity, inside: insideOf(imei), names });
}
export const zoneName = (id) => { const pl = zonePlan(); const z = pl.zones.find((x) => x.id === id) || pl.off.find((x) => x.id === id); if (z) return z.name; const t = pl.trips.find((x) => x.zoneId === id); return t ? t.zoneName : ''; };

/* ===== Vencimientos y avisos sin ver ===== */
export function dueSummary(day = un.today()) {
  const rows = alertRows(un.rows(day).filter((r) => isActive(r.unit)), day, { window: 'all', soon: un.soonDays() }).sort((a, b) => a.v.days - b.v.days);
  const c = { expired: 0, today: 0, week: 0, month: 0 };
  for (const a of rows) { const d = a.v.days; if (d < 0) c.expired++; else if (d === 0) c.today++; else if (d <= 7) c.week++; else if (d <= 30) c.month++; }
  return { ...c, urgent: c.expired + c.today + c.week, rows: rows.filter((a) => a.v.days <= 30) };
}
export function unseenCount() {
  const seen = Number(lsGet(LS.seen, 0)) || 0;
  const ev = state.events.filter((e) => (e.rec || e.at) > seen).length;
  return ev + (lsGet(LS.seenDay, '') === un.today() ? 0 : dueSummary().urgent);
}
export const seenAt = () => Number(lsGet(LS.seen, 0)) || 0;
export function markSeen() { lsSet(LS.seen, Date.now()); lsSet(LS.seenDay, un.today()); emit(); }

/* ===== Notificaciones push de este dispositivo ===== */
const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export function pushSupport() {
  if (isIOS() && !isStandalone()) return { ok: false, reason: 'ios-install' };
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return { ok: false, reason: 'unsupported' };
  return { ok: true, permission: Notification.permission };
}
const unb64u = (s) => { s = String(s || '').replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); };
const sameBytes = (a, b) => { if (!a || !b) return false; const x = new Uint8Array(a), y = new Uint8Array(b); return x.length === y.length && x.every((v, i) => v === y[i]); };
async function registration() {
  if (!(await navigator.serviceWorker.getRegistration())) throw new Error('Abre la app una vez con conexión para activar los avisos.');
  return navigator.serviceWorker.ready;
}
function deviceLabel() {
  let who = ''; try { who = (JSON.parse(sessionStorage.getItem('pcs-session') || 'null') || {}).user || ''; } catch (e) { /* */ }
  const ua = navigator.userAgent, dev = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || isIOS() ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Navegador';
  return [dev, who].filter(Boolean).join(' · ');
}
export async function pushStatus() {
  const sup = pushSupport(), local = lsGet(LS.push, null);
  const base = { ...sup, on: false, prefs: (local && local.prefs) || { due: true, geo: true } };
  if (!sup.ok) return base;
  let sub = null;
  try { const reg = await navigator.serviceWorker.getRegistration(); sub = reg ? await reg.pushManager.getSubscription() : null; } catch (e) { /* */ }
  return { ...base, permission: Notification.permission, on: !!(sub && local && local.endpoint === sub.endpoint && Notification.permission === 'granted'), endpoint: sub ? sub.endpoint : '' };
}
/* Debe llamarse desde un toque (Safari solo pide permiso así) */
export async function enablePush(p = { due: true, geo: true }) {
  const sup = pushSupport();
  if (!sup.ok) throw new Error(sup.reason === 'ios-install' ? 'En iPhone, primero instala la app en la pantalla de inicio y ábrela desde ahí.' : 'Este navegador no permite notificaciones.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Las notificaciones están bloqueadas para esta app. Actívalas en los ajustes del teléfono o del navegador.' : 'No se dio permiso para mostrar notificaciones.');
  const st = await gps.request('/v1/avisos');
  const key = unb64u(st.vapidKey), reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  if (sub && sub.options && sub.options.applicationServerKey && !sameBytes(sub.options.applicationServerKey, key)) { try { await sub.unsubscribe(); } catch (e) { /* */ } sub = null; }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await gps.request('/v1/avisos/suscripcion', { method: 'POST', body: { subscription: sub.toJSON(), label: deviceLabel(), prefs: p } });
  lsSet(LS.push, { endpoint: sub.endpoint, prefs: p, at: Date.now() });
  emit();
}
export async function updatePushPrefs(p) {
  const reg = await registration(), sub = await reg.pushManager.getSubscription();
  if (!sub) throw new Error('Los avisos no están activos en este dispositivo.');
  await gps.request('/v1/avisos/suscripcion', { method: 'POST', body: { subscription: sub.toJSON(), label: deviceLabel(), prefs: p } });
  lsSet(LS.push, { ...(lsGet(LS.push, {}) || {}), endpoint: sub.endpoint, prefs: p });
  emit();
}
export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration(), sub = reg ? await reg.pushManager.getSubscription() : null;
  if (sub) { try { await gps.request('/v1/avisos/baja', { method: 'POST', body: { endpoint: sub.endpoint } }); } finally { try { await sub.unsubscribe(); } catch (e) { /* */ } } }
  lsDel(LS.push); emit();
}
export async function testPush() {
  const reg = await registration(), sub = await reg.pushManager.getSubscription();
  if (!sub) throw new Error('Los avisos no están activos en este dispositivo.');
  await gps.request('/v1/avisos/prueba', { method: 'POST', body: { endpoint: sub.endpoint } });
}
export const workerStatus = () => gps.request('/v1/avisos', { timeout: 15000 });

/* ===== Arranque ===== */
let started = false;
export async function startAlerts() {
  if (started) return;
  started = true;
  await Promise.all([loadAlerts(), un.loadUnits()]);
  [un.onUnitsChange, lg.onLogisticsChange, onGeoChange].forEach((f) => f(schedulePublish));
  setInterval(() => { if (document.visibilityState === 'visible') refreshEvents(); }, POLL);
  setInterval(() => { publish().catch(() => {}); }, 30 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - (state.checkedAt || 0) > 60000) refreshEvents(); });
  setTimeout(() => { publish().catch(() => {}); refreshEvents(); }, 2500);
}
