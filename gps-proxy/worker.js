/*
 * PERCONSUR · Intermediario GPS (Cloudflare Worker) para la Open API de IOPGPS (Wanway).
 *
 * Por qué existe: la API de IOPGPS exige firmar con un secreto que no puede ir en el navegador, y no permite
 * llamadas directas desde otro sitio web. Este Worker guarda las credenciales como secretos de Cloudflare,
 * renueva el permiso (accessToken, 2 h), consulta las posiciones de toda la flota en una sola llamada,
 * guarda el resultado unos segundos y entrega a PERCONSUR solo lo necesario.
 *
 * Secretos / variables (Cloudflare → Worker → Settings → Variables and Secrets):
 *   IOP_APPID       Secret  appid de la Open API (p. ej. LOG_PERCONSUR)
 *   IOP_SECRET      Secret  clave de la Open API (32 caracteres)
 *   PCS_KEY         Secret  clave propia que usa la app PERCONSUR para consultar este Worker
 *   ALLOWED_ORIGIN  Texto   sitio autorizado, p. ej. https://oscarnschez.github.io (varios separados por coma)
 *   IOP_BASE        Texto   opcional; por defecto https://open.iopgps.com
 *   LIMITS          KV      opcional; espacio KV para compartir los bloqueos por intentos entre instancias (ver README)
 *   TRACKING        KV      espacio KV para los enlaces de rastreo para clientes (si falta, se usa LIMITS)
 *   APP_URL         Texto   opcional; dirección de la app (por defecto ALLOWED_ORIGIN + /PERCONSUR/). El portal del cliente
 *                           carga de ahí el mapa y su diseño.
 *   TRACK_MAX_HOURS Texto   opcional; vigencia máxima de un enlace de rastreo en horas (por defecto 72)
 *   DATA            KV      información compartida entre dispositivos (Ajustes → Sincronización de la app)
 *   DATA_WRITE_KEY  Secret  clave del dispositivo capturista (publica la información)
 *   DATA_READ_KEY   Secret  clave de los dispositivos de consulta (solo reciben)
 *
 * Endpoints:
 *   GET /salud                 ¿se pudo autenticar con IOPGPS? (sin credenciales ni ubicaciones; con ?key= añade nombres de campos)
 *   GET /v1/posiciones         posiciones de la flota (header X-PCS-Key o ?key=). Opcional: ?imeis=865…,867…
 *   GET /v1/ubicacion?imei=…   posición de una unidad con dirección y estado (header X-PCS-Key o ?key=)
 *   Rastreo para clientes (X-PCS-Key):
 *   GET  /v1/enlaces                       enlaces de rastreo (activos y recientes)
 *   POST /v1/enlaces                       crea (o reutiliza) el enlace de una operación de Logística
 *   POST /v1/enlaces/:id                   actualiza estado, origen y destino; un estado sin rastreo lo finaliza
 *   POST /v1/enlaces/:id/finalizar         la entrega terminó: el enlace deja de dar la ubicación
 *   POST /v1/enlaces/:id/revocar           revocación manual
 *   Información compartida (header X-PCS-Data con DATA_WRITE_KEY o DATA_READ_KEY):
 *   GET  /v1/datos/estado                  versión publicada (quién, cuándo, tamaño) y el papel de la clave
 *   GET  /v1/datos                         la «foto» comprimida de los registros (catálogos, documentos, Logística…)
 *   PUT  /v1/datos                         publica una foto nueva (solo capturista; 409 si otra la publicó)
 *   GET|PUT|DELETE /v1/archivos/:id        archivos (PDF, fotos, documentos adicionales); PUT y DELETE solo capturista
 *   Públicos (sin clave; solo con el enlace):
 *   GET /r/:token              página del portal de rastreo (identidad PERCONSUR; el mapa y el diseño vienen de APP_URL)
 *   GET /v1/publico/:token     datos del portal: origen, destino, estado y ubicación actual de ESA unidad mientras el
 *                              enlace está activo, y el operador solo por nombre y apellido. Nunca velocidad, IMEI,
 *                              placas ni otras unidades.
 *
 * API de IOPGPS utilizada (documentación pública de terceros; confirmar con el proveedor):
 *   POST /api/auth  { appid, time, signature = md5(md5(secreto) + time) } → { accessToken, expiresIn }
 *   Header accessToken en las demás llamadas.
 *   GET /api/device/locations/search-by-organization?isTakeSub=1   → [{ imei, lat, lng, speed, gpsTime, … }]
 *   GET /api/device/location?imei=…                                 → { lat, lng, address, gpsTime, … }
 *   GET /api/device/status?imei=…                                   → { signalTime, gpsTime, accStatus, speed, … }
 * La respuesta se normaliza con tolerancia (lat/latitude, lng/lon/longitude, tiempos en segundos, ms o texto).
 *
 * Límite de intentos (rate limit): la clave PCS_KEY es la «contraseña» de este Worker. Para que no se pueda adivinar
 * probando muchas claves:
 *   - Por IP: 5 claves incorrectas en 15 min → esa IP queda bloqueada 15 min (el bloqueo se duplica si reincide, hasta 24 h).
 *     Mientras dura el bloqueo no se revisa ninguna clave, ni la correcta: responde 429 con Retry-After.
 *   - General: con más de 30 claves incorrectas en 15 min (de cualquier IP), basta 1 fallo para bloquear una IP.
 *   - Peticiones por IP: máximo 120 por minuto en cualquier ruta (protege también /salud, que consulta a IOPGPS).
 *   - Si IOPGPS falla, no se le vuelve a llamar durante 30 s (FAIL_BACKOFF): visitas anónimas a /salud no multiplican
 *     llamadas firmadas con las credenciales mientras el proveedor está caído.
 * El estado vive en la memoria de la instancia; con el espacio KV opcional LIMITS los bloqueos se comparten entre
 * instancias y sobreviven a reinicios. Las IP se guardan como huella (no en texto).
 *
 * Rastreo para clientes: el permiso se decide AQUÍ, no en el navegador. Cada enlace es un código al azar de 192 bits
 * ligado a una unidad (IMEI) y a una operación; la ruta pública solo entrega la posición de esa unidad mientras el
 * enlace está activo. Termina al finalizar la entrega (la app lo avisa al pasar la operación a En ruta vacío, Vacío o
 * Inactiva), al revocarlo, al crear un enlace de otra operación para la misma unidad o al cumplirse TRACK_MAX_HOURS.
 * Códigos inexistentes cuentan como intentos fallidos (20 en 15 min bloquean la IP).
 */

const FLEET_TTL = 30 * 1000;      /* posiciones de la flota: una llamada al proveedor cada 30 s como máximo */
const DETAIL_TTL = 120 * 1000;    /* dirección/estado por unidad: cada 2 min como máximo */
const TOKEN_MARGIN = 5 * 60 * 1000;
const FAIL_BACKOFF = 30 * 1000;   /* si IOPGPS falla, no se le vuelve a llamar durante 30 s (aunque lleguen muchas peticiones) */

/* ===== Estado por instancia (Cloudflare reutiliza la instancia entre peticiones) ===== */
let token = null, tokenExp = 0, tokenPending = null, authFail = null;
const failures = new Map();   /* clave de caché → { at, err } del último fallo del proveedor */
const cache = new Map();   /* clave → { at, value } */
const inflight = new Map();

/* ===== Límite de intentos ===== */
export const LIMITS = { FAIL_WINDOW: 15 * 60 * 1000, FAIL_MAX: 5, LOCK_BASE: 15 * 60 * 1000, LOCK_MAX: 24 * 3600 * 1000, GLOBAL_FAIL_MAX: 30, REQ_WINDOW: 60 * 1000, REQ_MAX: 120, TOKEN_FAIL_MAX: 20 };
const fails = new Map();    /* ip → { list: [ts], until, strikes } */
const reqs = new Map();     /* ip → [ts] */
let globalFails = [];

/* ===== MD5 (implementación propia: no depende de extensiones de Web Crypto) ===== */
export function md5(str) {
  const bytes = new TextEncoder().encode(str);
  const n = (((bytes.length + 8) >>> 6) + 1) * 16, w = new Uint32Array(n);
  for (let i = 0; i < bytes.length; i++) w[i >> 2] |= bytes[i] << ((i % 4) * 8);
  w[bytes.length >> 2] |= 0x80 << ((bytes.length % 4) * 8);
  w[n - 2] = bytes.length * 8;
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const K = new Uint32Array(64);
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let o = 0; o < n; o += 16) {
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      const s = S[(i >> 4) * 4 + (i % 4)];
      F = (F + A + K[i] + w[o + g]) >>> 0;
      A = D; D = C; C = B;
      B = (B + ((F << s) | (F >>> (32 - s)))) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  return [a0, b0, c0, d0].map((v) => [0, 8, 16, 24].map((sh) => ((v >>> sh) & 0xff).toString(16).padStart(2, '0')).join('')).join('');
}

/* ===== Utilidades ===== */
const base = (env) => String(env.IOP_BASE || 'https://open.iopgps.com').replace(/\/+$/, '');
const origins = (env) => String(env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);

function corsHeaders(req, env) {
  const o = req.headers.get('Origin'), allow = origins(env);
  const h = { 'Vary': 'Origin' };
  if (o && allow.includes(o)) {
    h['Access-Control-Allow-Origin'] = o;
    h['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'X-PCS-Key, X-PCS-Data, X-PCS-Ver, X-PCS-Base, X-PCS-Device, X-PCS-Force, X-PCS-Enc, X-PCS-Files, X-PCS-By, Content-Type';
    h['Access-Control-Max-Age'] = '86400';
    h['Access-Control-Expose-Headers'] = 'Retry-After, X-PCS-Ver, X-PCS-Enc';
  }
  return h;
}
function json(req, env, status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders(req, env) } });
}
/* Comparación en tiempo constante de la clave de la app */
function sameKey(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !b) return false;
  let r = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) r |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return r === 0;
}
const appKey = (req, url) => req.headers.get('X-PCS-Key') || url.searchParams.get('key') || '';

/* IP del cliente (Cloudflare la entrega en CF-Connecting-IP) */
const clientIp = (req) => req.headers.get('CF-Connecting-IP') || req.headers.get('X-Real-IP') || 'sin-ip';
const recent = (list, win, now) => list.filter((t) => now - t < win);
function prune(map, now) {
  if (map.size < 2000) return;
  for (const [k, v] of map) { const last = Array.isArray(v) ? v[v.length - 1] : Math.max(v.until || 0, v.list[v.list.length - 1] || 0); if (!last || now - last > LIMITS.LOCK_MAX) map.delete(k); }
}
/* Peticiones por minuto por IP (cualquier ruta) */
function tooManyRequests(ip, now = Date.now()) {
  prune(reqs, now);
  const list = recent(reqs.get(ip) || [], LIMITS.REQ_WINDOW, now);
  list.push(now); reqs.set(ip, list);
  return list.length > LIMITS.REQ_MAX ? Math.ceil((LIMITS.REQ_WINDOW - (now - list[list.length - LIMITS.REQ_MAX - 1])) / 1000) : 0;
}
const kvKey = (ip) => 'lim:' + md5('pcs|' + ip);
async function failState(ip, env) {
  let st = fails.get(ip);
  if (!st && env.LIMITS) { try { const v = await env.LIMITS.get(kvKey(ip), 'json'); if (v) { st = { list: v.list || [], until: v.until || 0, strikes: v.strikes || 0 }; fails.set(ip, st); } } catch (e) { /* KV no disponible: solo memoria */ } }
  return st || { list: [], until: 0, strikes: 0 };
}
async function saveFail(ip, st, env) {
  fails.set(ip, st);
  if (env.LIMITS) { try { await env.LIMITS.put(kvKey(ip), JSON.stringify(st), { expirationTtl: Math.max(60, Math.ceil((Math.max(st.until, Date.now() + LIMITS.FAIL_WINDOW) - Date.now()) / 1000) + 60) }); } catch (e) { /* */ } }
}
/* Segundos de bloqueo que le quedan a una IP (0 = puede intentar) */
async function lockedFor(ip, env, now = Date.now()) { const st = await failState(ip, env); return st.until > now ? Math.ceil((st.until - now) / 1000) : 0; }
/* Registra una clave incorrecta (o un código de rastreo inexistente: global=false, máximo propio); devuelve los segundos de
   bloqueo si con este fallo se bloquea la IP */
async function registerFail(ip, env, now = Date.now(), { global = true, maxFails = LIMITS.FAIL_MAX } = {}) {
  prune(fails, now);
  if (global) { globalFails = recent(globalFails, LIMITS.FAIL_WINDOW, now); globalFails.push(now); }
  const st = await failState(ip, env);
  st.list = recent(st.list, LIMITS.FAIL_WINDOW, now); st.list.push(now);
  const max = global && globalFails.length > LIMITS.GLOBAL_FAIL_MAX ? 1 : maxFails;
  let lock = 0;
  if (st.list.length >= max) {
    st.strikes = (st.strikes || 0) + 1;
    const ms = Math.min(LIMITS.LOCK_MAX, LIMITS.LOCK_BASE * 2 ** (st.strikes - 1));
    st.until = now + ms; st.list = []; lock = Math.ceil(ms / 1000);
  }
  await saveFail(ip, st, env);
  return lock;
}
async function clearFails(ip, env) {
  const st = fails.get(ip);
  if (!st || (!st.list.length && !st.strikes)) return;
  fails.delete(ip);
  if (env.LIMITS) { try { await env.LIMITS.delete(kvKey(ip)); } catch (e) { /* */ } }
}
const waitText = (s) => (s < 90 ? `${s} s` : s < 5400 ? `${Math.ceil(s / 60)} min` : `${Math.ceil(s / 3600)} h`);
function limited(req, env, seconds, error) {
  const r = json(req, env, 429, { ok: false, error, retryAfter: seconds });
  r.headers.set('Retry-After', String(seconds));
  return r;
}

/* Tiempo → milisegundos (acepta segundos, milisegundos o texto «2026-10-08 03:13:00» / «2026/10/08 03:13:00») */
export function toMs(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' || /^\d+(\.\d+)?$/.test(String(v))) { const n = Number(v); return n < 1e12 ? Math.round(n * 1000) : Math.round(n); }
  const s = String(v).trim();
  for (const x of [s.replace(' ', 'T'), s.replace(/\//g, '-').replace(' ', 'T'), s]) { const t = Date.parse(x); if (Number.isFinite(t)) return t; }
  return null;
}
/*
 * Horas del proveedor: la consulta de la flota y la de cada unidad no siempre usan los mismos nombres de campo. Se
 * prueban los conocidos y, si no aparecen, cualquier campo de hora («…Time», «…Date») con un valor creíble (desde 2015
 * y no más de un día en el futuro): de posición si el nombre habla de gps/loc/pos; de señal si habla de heart/hb/
 * signal/online/update/last.
 */
const GPS_TIME_KEYS = ['gpsTime', 'gpsTimeStamp', 'positionTime', 'gpsDateTime', 'locTime', 'locationTime', 'gpsTimeStr', 'gpsDate', 'time'];
const SIGNAL_TIME_KEYS = ['signalTime', 'heartTime', 'hbTime', 'heartbeatTime', 'lastSignalTime', 'lastHeartTime', 'lastHbTime', 'onlineTime', 'updateTime', 'lastUpdateTime', 'lastTime'];
const credible = (ms) => (ms && ms > 1420070400000 && ms < Date.now() + 86400000 ? ms : null);
function timeOf(d, keys, hint, not) {
  if (!d || typeof d !== 'object') return null;
  for (const k of keys) { const t = credible(toMs(d[k])); if (t) return t; }
  for (const [k, v] of Object.entries(d)) if (/time|date/i.test(k) && hint.test(k) && !not.test(k)) { const t = credible(toMs(v)); if (t) return t; }
  return null;
}
const num = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };   /* sin dato → null (nunca 0 inventado) */
const pick = (o, ...ks) => { for (const k of ks) if (o && o[k] != null && o[k] !== '') return o[k]; return null; };
const listOf = (r) => (Array.isArray(r) ? r : Array.isArray(r && r.data) ? r.data : Array.isArray(r && r.data && r.data.list) ? r.data.list : Array.isArray(r && r.list) ? r.list : []);
const objOf = (r) => (r && r.data && !Array.isArray(r.data) && typeof r.data === 'object' ? r.data : Array.isArray(r && r.data) ? r.data[0] || {} : r || {});

/* Normaliza un registro del proveedor al formato de PERCONSUR */
export function normalize(d) {
  const lat = num(pick(d, 'lat', 'latitude', 'gpsLat')), lng = num(pick(d, 'lng', 'lon', 'longitude', 'gpsLng'));
  const acc = pick(d, 'accStatus', 'acc');
  return {
    imei: String(pick(d, 'imei', 'deviceImei') || ''),
    name: pick(d, 'deviceName', 'name') || '',
    lat: lat != null && Math.abs(lat) <= 90 ? lat : null,
    lng: lng != null && Math.abs(lng) <= 180 ? lng : null,
    gpsTime: timeOf(d, GPS_TIME_KEYS, /gps|loc|pos/i, /heart|hb|signal|online/i),
    signalTime: timeOf(d, SIGNAL_TIME_KEYS, /heart|hb|signal|online|update|last/i, /gps|loc|pos/i),
    speed: num(pick(d, 'speed')),
    course: num(pick(d, 'course', 'direction')),
    acc: acc == null ? null : String(acc) === '1' || acc === true || String(acc).toLowerCase() === 'on',
    positionType: pick(d, 'positionType', 'posType') || null,
    address: pick(d, 'address', 'addr') || null,
  };
}

/* ===== IOPGPS ===== */
class UpstreamError extends Error {
  constructor(message, { status = 502, tokenProblem = false } = {}) { super(message); this.status = status; this.tokenProblem = tokenProblem; }
}
const isOkCode = (r) => r && (r.code === undefined || r.code === 0 || r.code === '0' || r.code === 200 || r.code === '200');

async function auth(env) {
  if (!env.IOP_APPID || !env.IOP_SECRET) throw new UpstreamError('Faltan los secretos IOP_APPID / IOP_SECRET en el Worker.', { status: 500 });
  const time = Math.floor(Date.now() / 1000);
  const signature = md5(md5(env.IOP_SECRET) + time);
  const res = await fetch(base(env) + '/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appid: env.IOP_APPID, time, signature }) });
  let body = null; try { body = await res.json(); } catch (e) { /* respuesta no JSON */ }
  const tk = body && (body.accessToken || (body.data && body.data.accessToken));
  if (!res.ok || !tk || !isOkCode(body)) throw new UpstreamError(`IOPGPS rechazó la autenticación${body && (body.msg || body.message) ? ': ' + (body.msg || body.message) : ` (HTTP ${res.status})`}`);
  const exp = Number(body.expiresIn || (body.data && body.data.expiresIn) || 7200);
  token = tk;
  tokenExp = Date.now() + (exp < 1e6 ? exp * 1000 : exp);   /* expiresIn en segundos (o ms) */
  return token;
}
async function ensureToken(env) {
  if (token && Date.now() < tokenExp - TOKEN_MARGIN) return token;
  if (!tokenPending) {
    if (authFail && Date.now() - authFail.at < FAIL_BACKOFF) throw authFail.err;
    tokenPending = auth(env).then((t) => { authFail = null; return t; }, (e) => { authFail = { at: Date.now(), err: e }; throw e; })
      .finally(() => { tokenPending = null; });
  }
  return tokenPending;
}
async function iop(env, path, retried = false) {
  const tk = await ensureToken(env);
  const res = await fetch(base(env) + path, { headers: { accessToken: tk, Accept: 'application/json' } });
  let body = null; try { body = await res.json(); } catch (e) { /* */ }
  const msg = body && (body.msg || body.message) ? String(body.msg || body.message) : '';
  const tokenProblem = res.status === 401 || (body && String(body.code) === '401') || /token/i.test(msg);
  if (tokenProblem && !retried) { token = null; tokenExp = 0; return iop(env, path, true); }
  if (!res.ok || !isOkCode(body)) throw new UpstreamError(`IOPGPS respondió con error${msg ? ': ' + msg : ` (HTTP ${res.status})`}`, { tokenProblem });
  return body;
}
/* Caché con «una sola petición en vuelo» para no repetir llamadas simultáneas al proveedor */
async function cached(key, ttl, fn) {
  const c = cache.get(key);
  if (c && Date.now() - c.at < ttl) return { value: c.value, at: c.at, cached: true };
  if (inflight.has(key)) return inflight.get(key);
  /* Fallo reciente del proveedor: no se repite la llamada hasta que pase FAIL_BACKOFF */
  const f = failures.get(key);
  if (f && Date.now() - f.at < FAIL_BACKOFF) { if (c) return { value: c.value, at: c.at, cached: true, stale: true, error: f.err.message }; throw f.err; }
  const p = (async () => { const value = await fn(); const at = Date.now(); cache.set(key, { at, value }); failures.delete(key); return { value, at, cached: false }; })()
    .catch((e) => { failures.set(key, { at: Date.now(), err: e }); throw e; })
    .catch((e) => { if (c) return { value: c.value, at: c.at, cached: true, stale: true, error: e.message }; throw e; })   /* si falla, entrega lo último conocido marcado como antiguo */
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
const fleet = (env) => cached('fleet', FLEET_TTL, async () => listOf(await iop(env, '/api/device/locations/search-by-organization?isTakeSub=1')).map(normalize).filter((d) => d.imei));

async function detail(env, imei) {
  return cached('d:' + imei, DETAIL_TTL, async () => {
    const q = encodeURIComponent(imei);
    const [loc, st] = await Promise.allSettled([iop(env, `/api/device/location?imei=${q}`), iop(env, `/api/device/status?imei=${q}`)]);
    if (loc.status === 'rejected' && st.status === 'rejected') throw loc.reason;
    const a = loc.status === 'fulfilled' ? normalize({ imei, ...objOf(loc.value) }) : {};
    const b = st.status === 'fulfilled' ? normalize({ imei, ...objOf(st.value) }) : {};
    const out = { ...b };
    for (const [k, v] of Object.entries(a)) if (v != null && v !== '') out[k] = v;
    out.imei = imei;
    return out;
  });
}

/* ===== Rastreo para clientes ===== */
/* Estados de Logística con rastreo y el texto que ve el cliente (el resto de estados finaliza el enlace) */
export const TRACK_STATUS_TEXT = { to_destination: 'En camino al destino', unloading: 'En el lugar de entrega' };
const TRACK_DONE_TEXT = 'Entrega finalizada';
const TRACK_KEEP = 30 * 24 * 3600;   /* un enlace cerrado se conserva 30 días (para mostrar «Entrega finalizada»), después se borra */
const LINK_MEM_TTL = 15 * 1000;      /* lectura del enlace guardada 15 s por instancia (menos lecturas de KV) */
const POS_STALE_MS = 10 * 60 * 1000; /* sin señal del equipo durante más de esto: la posición no se presenta como actual */
const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;
const TRAILERS = ['chasis', 'jaula', 'tolva'];
const linkMem = new Map();   /* id → { at, rec } */
let listMem = null;          /* { at, items } */

const kvOf = (env) => env.TRACKING || env.LIMITS || null;
const maxHours = (env) => { const h = Number(env.TRACK_MAX_HOURS); return Number.isFinite(h) && h >= 1 ? Math.min(h, 720) : 72; };
/* Dirección de la app (de ahí el portal carga el mapa y el diseño). Solo https y terminada en / */
export function appUrl(env) {
  let u = String(env.APP_URL || '').trim();
  if (!u) { const o = origins(env)[0]; u = o ? o + '/PERCONSUR/' : ''; }
  if (u && !u.endsWith('/')) u += '/';
  return /^https:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~%-]+)*\/$/.test(u) ? u : '';
}
export function newToken() {
  const b = new Uint8Array(24); crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const txt = (v, max = 120) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const point = (p) => (p && Number.isFinite(+p.lat) && Number.isFinite(+p.lng) && Math.abs(+p.lat) <= 90 && Math.abs(+p.lng) <= 180
  ? { lat: Math.round(+p.lat * 1e6) / 1e6, lng: Math.round(+p.lng * 1e6) / 1e6, approx: !!p.approx } : null);
/* active | finished | revoked | expired (vencido por tiempo) */
const stateOf = (rec, now = Date.now()) => (rec.state === 'active' && now > rec.expiresAt ? 'expired' : rec.state);
const metaOf = (rec) => ({ opId: rec.opId, imei: rec.imei, unit: rec.unit, operator: rec.operator || '', state: rec.state, status: rec.status, hasDest: !!rec.dest, createdAt: rec.createdAt, expiresAt: rec.expiresAt, closedAt: rec.closedAt || null });
/* Vista interna (solo con PCS_KEY) */
const internal = (id, m, now = Date.now()) => ({ id, opId: m.opId, imei: m.imei, unit: m.unit || '', operator: m.operator || '', state: stateOf(m, now), status: m.status, hasDest: m.hasDest !== undefined ? !!m.hasDest : !!m.dest, createdAt: m.createdAt, expiresAt: m.expiresAt, closedAt: m.closedAt || null, closeReason: m.closeReason || null, path: '/r/' + id });

class TrackError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
function needKv(env) {
  const kv = kvOf(env);
  if (!kv) throw new TrackError('Falta vincular el espacio KV «TRACKING» en el Worker (ver README → Rastreo para clientes).', 503);
  return kv;
}
async function getLink(env, id, fresh = false) {
  const m = linkMem.get(id);
  if (!fresh && m && Date.now() - m.at < LINK_MEM_TTL) return m.rec;
  const rec = await needKv(env).get('lnk:' + id, 'json');
  linkMem.set(id, { at: Date.now(), rec: rec || null });
  if (linkMem.size > 2000) linkMem.delete(linkMem.keys().next().value);
  return rec || null;
}
async function putLink(env, rec) {
  const end = rec.state === 'active' ? rec.expiresAt : rec.closedAt || Date.now();
  const ttl = Math.max(60, Math.ceil((end - Date.now()) / 1000) + TRACK_KEEP);
  await needKv(env).put('lnk:' + rec.id, JSON.stringify(rec), { expirationTtl: ttl, metadata: metaOf(rec) });
  linkMem.set(rec.id, { at: Date.now(), rec }); listMem = null;
  return rec;
}
async function listLinks(env) {
  if (listMem && Date.now() - listMem.at < 20000) return listMem.items;
  const kv = needKv(env), items = [];
  let cursor;
  for (let i = 0; i < 5; i++) {
    const r = await kv.list({ prefix: 'lnk:', cursor });
    for (const k of r.keys || []) if (k.metadata) items.push({ id: k.name.slice(4), ...k.metadata });
    if (r.list_complete || !r.cursor) break;
    cursor = r.cursor;
  }
  listMem = { at: Date.now(), items };
  return items;
}
async function readBody(req) {
  const t = await req.text();
  if (t.length > 8192) throw new TrackError('Datos demasiado grandes', 413);
  try { const b = t ? JSON.parse(t) : {}; return b && typeof b === 'object' && !Array.isArray(b) ? b : {}; } catch (e) { throw new TrackError('Datos inválidos'); }
}
/* Campos que la app puede fijar (todo se limpia y se acota) */
function applyFields(rec, b) {
  if (b.imei !== undefined) { if (!/^\d{8,20}$/.test(String(b.imei))) throw new TrackError('IMEI inválido'); rec.imei = String(b.imei); }
  if (b.unit !== undefined) rec.unit = txt(b.unit, 40);
  if (b.trailerType !== undefined) rec.trailerType = TRAILERS.includes(b.trailerType) ? b.trailerType : '';
  if (b.origin !== undefined) rec.origin = txt(b.origin);
  if (b.destination !== undefined) rec.destination = txt(b.destination);
  if (b.place !== undefined) rec.place = txt(b.place);
  if (b.operator !== undefined) rec.operator = txt(b.operator, 60);
  if (b.dest !== undefined) rec.dest = point(b.dest);
  return rec;
}
function close(rec, state, reason, now = Date.now()) {
  if (rec.state !== 'active') return rec;
  rec.state = state; rec.closedAt = now; rec.closeReason = reason; rec.updatedAt = now;
  return rec;
}

/* POST /v1/enlaces — una operación tiene un solo enlace activo; otro enlace activo de la misma unidad (otro viaje) se finaliza */
async function createLink(env, b) {
  const opId = String(b.opId || '');
  if (!/^[\w-]{1,64}$/.test(opId)) throw new TrackError('Operación inválida');
  if (!/^\d{8,20}$/.test(String(b.imei || ''))) throw new TrackError('Esta unidad no tiene un GPS vinculado.');
  if (!TRACK_STATUS_TEXT[b.status]) throw new TrackError('El rastreo para clientes solo está disponible con la unidad En ruta a destino o Descargando.', 409);
  const now = Date.now(), list = await listLinks(env);
  const mine = list.filter((l) => l.opId === opId && stateOf(l, now) === 'active');
  for (const l of mine) {
    const rec = await getLink(env, l.id, true);
    if (rec && stateOf(rec, now) === 'active') { applyFields(rec, b); rec.status = b.status; rec.updatedAt = now; await putLink(env, rec); return { rec, reused: true }; }
  }
  for (const l of list.filter((x) => x.imei === String(b.imei) && x.opId !== opId && stateOf(x, now) === 'active')) {
    const rec = await getLink(env, l.id, true);
    if (rec && rec.state === 'active') await putLink(env, close(rec, 'finished', 'replaced', now));
  }
  const rec = applyFields({ v: 1, id: newToken(), opId, imei: '', unit: '', operator: '', trailerType: '', origin: '', destination: '', place: '', dest: null,
    status: b.status, state: 'active', createdAt: now, updatedAt: now, expiresAt: now + maxHours(env) * 3600 * 1000, closedAt: null, closeReason: null }, b);
  await putLink(env, rec);
  return { rec, reused: false };
}
async function updateLink(env, id, b, action) {
  const rec = await getLink(env, id, true);
  if (!rec) throw new TrackError('El enlace no existe', 404);
  const now = Date.now();
  if (stateOf(rec, now) !== 'active') return rec;   /* ya cerrado: sin cambios (idempotente) */
  if (action === 'revocar') return putLink(env, close(rec, 'revoked', 'revoked', now));
  if (action === 'finalizar') return putLink(env, close(rec, 'finished', ['delivered', 'closed', 'manual'].includes(b.reason) ? b.reason : 'delivered', now));
  applyFields(rec, b);
  if (b.status !== undefined) {
    if (!TRACK_STATUS_TEXT[b.status]) return putLink(env, close(rec, 'finished', 'delivered', now));
    rec.status = b.status;
  }
  rec.updatedAt = now;
  return putLink(env, rec);
}

/* GET /v1/publico/:token — lo único que ve el cliente */
async function publicView(env, rec) {
  const now = Date.now(), st = stateOf(rec, now);
  const out = { ok: true, state: st, refreshIn: 30 };
  if (st === 'revoked' || st === 'expired') return out;
  out.trip = { origin: rec.origin || '', destination: rec.destination || '', place: rec.place || '', trailerType: rec.trailerType || '', operator: rec.operator || '',
    status: st === 'finished' ? 'delivered' : rec.status, statusText: st === 'finished' ? TRACK_DONE_TEXT : TRACK_STATUS_TEXT[rec.status] || TRACK_STATUS_TEXT.to_destination };
  if (st === 'finished') { out.closedAt = rec.closedAt; return out; }
  out.destination = rec.dest || null;
  out.expiresAt = rec.expiresAt;
  out.position = null;
  try {
    const f = await fleet(env);
    let d = f.value.find((x) => x.imei === rec.imei) || null;
    out.fetchedAt = f.at;
    /* La consulta de la flota puede llegar sin la hora de la posición o sin la última señal del equipo: se completan
       con la consulta por unidad (ubicación + estado, guardada 2 min), la misma que usa el Centro de Monitoreo */
    if (!d || d.lat == null || d.lng == null || !d.gpsTime || !d.signalTime) {
      try { d = mergeBest(d, (await detail(env, rec.imei)).value); } catch (e) { /* se usa lo de la flota */ }
    }
    if (d && d.lat != null && d.lng != null) {
      const sig = Math.max(d.signalTime || 0, d.gpsTime || 0), live = !!sig && now - sig < POS_STALE_MS;
      /* «Ubicación actualizada hace…»: si el equipo reporta, la posición está confirmada a la hora de su última señal */
      out.position = { lat: d.lat, lng: d.lng, at: (live ? sig : d.gpsTime || d.signalTime) || null, live, heading: d.course };
    }
  } catch (e) { out.warning = 'La ubicación no está disponible en este momento.'; }
  return out;
}
/* Mejor dato: posición de la flota (más reciente) completada con la consulta por unidad */
export function mergeBest(p, x) {
  if (!x) return p;
  if (!p) return x;
  const out = { ...p };
  for (const [k, v] of Object.entries(x)) if (out[k] == null && v != null) out[k] = v;
  if (x.signalTime && (!out.signalTime || x.signalTime > out.signalTime)) out.signalTime = x.signalTime;
  if (x.lat != null && x.lng != null) {
    /* Sin coordenadas en la flota, o la consulta por unidad trae una posición más nueva: se usa la suya (con su hora) */
    if (p.lat == null || p.lng == null || (x.gpsTime && p.gpsTime && x.gpsTime > p.gpsTime)) { out.lat = x.lat; out.lng = x.lng; out.gpsTime = x.gpsTime || out.gpsTime; }
    /* La flota no trae la hora: se toma la de la consulta por unidad solo si es el mismo lugar (≈ 50 m) */
    else if (!p.gpsTime && x.gpsTime && Math.abs(x.lat - p.lat) < 0.0005 && Math.abs(x.lng - p.lng) < 0.0005) out.gpsTime = x.gpsTime;
    else if (!p.gpsTime) out.gpsTime = null;
  }
  return out;
}

/* Página del portal: solo el armazón con la marca; el mapa y los datos los carga src/portal/main.js desde APP_URL */
const htmlEsc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function portalHTML(app, token) {
  const a = htmlEsc(app), t = htmlEsc(token);
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Rastreo de tu envío · PERCONSUR</title>
<meta name="description" content="Ubicación y estado de tu envío con PERCONSUR.">
<meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer">
<meta property="og:title" content="Rastreo de tu envío · PERCONSUR"><meta property="og:description" content="Consulta la ubicación y el estado de tu envío.">
<meta property="og:image" content="${a}assets/icons/icon-512.png">
<meta name="color-scheme" content="light dark"><meta name="theme-color" content="#354FA3">
<link rel="icon" href="${a}assets/icons/favicon.ico" sizes="16x16 24x24 32x32 48x48 64x64 128x128 256x256"><link rel="apple-touch-icon" href="${a}assets/icons/apple-touch-icon.png">
<link rel="preconnect" href="https://tiles.openfreemap.org" crossorigin>
<link rel="stylesheet" href="${a}vendor/fonts/archivo.css"><link rel="stylesheet" href="${a}vendor/maplibre/maplibre-gl.css"><link rel="stylesheet" href="${a}styles/tokens.css"><link rel="stylesheet" href="${a}styles/maps.css"><link rel="stylesheet" href="${a}styles/portal.css">
</head><body class="pt-body">
<main id="portal" class="pt nomap" data-api="/v1/publico/${t}" data-app="${a}" data-sat="1">
<header class="pt-head"><img class="pt-mark" src="${a}assets/brand/perconsur-mark.png" alt=""><span class="pt-word">PERCONSUR</span><span class="pt-tag">Rastreo de envío</span></header>
<div class="pt-band" aria-hidden="true"></div>
<p class="pt-loading" role="status">Cargando la ubicación de tu envío…</p>
</main>
<script type="module" src="${a}src/portal/main.js"></script>
</body></html>`;
}
/* Imágenes de la vista satelital del mapa (Esri World Imagery, sin clave); data-sat="1" avisa al portal que puede ofrecerla */
const SAT_TILES = 'https://server.arcgisonline.com';
function portalResponse(env, token, status = 200) {
  const app = appUrl(env);
  const html = app ? portalHTML(app, token) : '<!DOCTYPE html><meta charset="utf-8"><title>PERCONSUR</title><p style="font-family:Arial;padding:24px">El portal de rastreo no está configurado (APP_URL).</p>';
  const src = app || "'none'";
  const csp = `default-src 'none'; script-src ${src}; style-src ${src} 'unsafe-inline'; img-src ${src} data: blob: ${SAT_TILES}; font-src ${src} data:; connect-src 'self' https://tiles.openfreemap.org ${SAT_TILES} ${src}; worker-src blob: ${src}; child-src blob:; manifest-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': csp,
    'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow', 'Permissions-Policy': 'geolocation=(), camera=(), microphone=()' } });
}

/* ===== Información compartida entre dispositivos ===== */
/*
 * Un dispositivo CAPTURISTA publica; los de CONSULTA solo reciben. Se guarda en el espacio KV «DATA»:
 *   snap        la «foto» de los registros (JSON comprimido por la app; el Worker no la abre)
 *   snap:meta   { ver, device, at, size, files, enc, by } — se lee en cada consulta de estado (lectura pequeña)
 *   f:<id>      cada archivo (PDF, foto, documento adicional), tal como lo guarda la app
 * Para que un dispositivo vacío o desactualizado no reemplace la información por error, una foto nueva solo se acepta
 * si viene del mismo dispositivo que publicó la anterior, si parte de la versión vigente (X-PCS-Base) o si se pide
 * expresamente (X-PCS-Force). Los archivos se entregan siempre como descarga binaria (nunca se muestran en este sitio).
 */
const DATA_MAX = 24 * 1024 * 1024;   /* KV admite hasta 25 MiB por valor */
const DATA_REQ_MAX = 600;            /* consultas por minuto por IP en las rutas de datos (sincronizar muchos archivos) */
const FILE_ID_RE = /^[A-Za-z0-9_.:-]{1,120}$/;
const VER_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const dataReqs = new Map();
const isDataPath = (p) => /^\/v1\/(datos|archivos)(\/|$)/.test(p);
function dataRole(req, env) {
  const k = req.headers.get('X-PCS-Data') || '';
  if (!k) return { given: false, role: '' };
  if (sameKey(k, env.DATA_WRITE_KEY)) return { given: true, role: 'write' };
  if (sameKey(k, env.DATA_READ_KEY)) return { given: true, role: 'read' };
  return { given: true, role: '' };
}
function dataTooMany(ip, now = Date.now()) {
  prune(dataReqs, now);
  const list = recent(dataReqs.get(ip) || [], LIMITS.REQ_WINDOW, now);
  list.push(now); dataReqs.set(ip, list);
  return list.length > DATA_REQ_MAX ? Math.ceil((LIMITS.REQ_WINDOW - (now - list[list.length - DATA_REQ_MAX - 1])) / 1000) : 0;
}
async function readBinary(req, max) {
  const len = Number(req.headers.get('Content-Length') || 0);
  if (len > max) return null;
  const buf = await req.arrayBuffer();
  return buf.byteLength > max ? null : buf;
}
async function dataRoute(req, env, ip, url) {
  const { given, role } = dataRole(req, env);
  if (given && !role && (env.DATA_WRITE_KEY || env.DATA_READ_KEY)) {
    const lock = await registerFail(ip, env);
    if (lock) return limited(req, env, lock, `Demasiados intentos con una clave incorrecta. Intenta de nuevo en ${waitText(lock)}.`);
  } else if (role) await clearFails(ip, env);
  if (!role) return json(req, env, 401, { ok: false, error: 'Clave de datos inválida o ausente' });
  const kv = env.DATA;
  if (!kv) return json(req, env, 503, { ok: false, error: 'Falta vincular el espacio KV «DATA» en el Worker (ver README → Información compartida).' });
  const p = url.pathname, m = req.method;
  const getMeta = async () => kv.get('snap:meta', 'json');
  if (p === '/v1/datos/estado' && m === 'GET') return json(req, env, 200, { ok: true, role, published: await getMeta() });
  if (p === '/v1/datos' && m === 'GET') {
    const [value, meta] = await Promise.all([kv.get('snap', 'arrayBuffer'), getMeta()]);
    if (!value || !meta) return json(req, env, 404, { ok: false, error: 'Todavía no se ha publicado información.' });
    return new Response(value, { status: 200, headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store', 'X-PCS-Ver': meta.ver, 'X-PCS-Enc': meta.enc || 'json', 'X-Content-Type-Options': 'nosniff', ...corsHeaders(req, env) } });
  }
  if (p === '/v1/datos' && m === 'PUT') {
    if (role !== 'write') return json(req, env, 403, { ok: false, error: 'Este dispositivo es de consulta: solo el capturista publica la información.' });
    const ver = req.headers.get('X-PCS-Ver') || '', device = req.headers.get('X-PCS-Device') || '', base = req.headers.get('X-PCS-Base') || '';
    if (!VER_RE.test(ver) || !VER_RE.test(device)) return json(req, env, 400, { ok: false, error: 'Versión o dispositivo inválidos' });
    const cur = await getMeta();
    if (cur && cur.device !== device && cur.ver !== base && req.headers.get('X-PCS-Force') !== '1') {
      return json(req, env, 409, { ok: false, error: 'La información de la nube la publicó otro dispositivo.', published: cur });
    }
    const buf = await readBinary(req, DATA_MAX);
    if (!buf) return json(req, env, 413, { ok: false, error: 'La información es demasiado grande para publicarse.' });
    const meta = { ver, device, at: Date.now(), size: buf.byteLength, files: Math.max(0, Math.floor(Number(req.headers.get('X-PCS-Files')) || 0)),
      enc: req.headers.get('X-PCS-Enc') === 'gzip' ? 'gzip' : 'json', by: txt(req.headers.get('X-PCS-By'), 240) };
    await kv.put('snap', buf);
    await kv.put('snap:meta', JSON.stringify(meta));
    return json(req, env, 200, { ok: true, published: meta });
  }
  const fm = /^\/v1\/archivos\/([^/]+)$/.exec(p);
  if (fm) {
    let id = '';
    try { id = decodeURIComponent(fm[1]); } catch (e) { id = ''; }
    if (!FILE_ID_RE.test(id)) return json(req, env, 400, { ok: false, error: 'Archivo inválido' });
    if (m === 'GET') {
      const value = await kv.get('f:' + id, 'arrayBuffer');
      if (!value) return json(req, env, 404, { ok: false, error: 'El archivo no está en la nube.' });
      return new Response(value, { status: 200, headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment', 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", ...corsHeaders(req, env) } });
    }
    if (role !== 'write') return json(req, env, 403, { ok: false, error: 'Este dispositivo es de consulta: solo el capturista publica la información.' });
    if (m === 'PUT') {
      const buf = await readBinary(req, DATA_MAX);
      if (!buf) return json(req, env, 413, { ok: false, error: 'El archivo es demasiado grande (máximo 24 MB).' });
      await kv.put('f:' + id, buf);
      return json(req, env, 200, { ok: true, id, size: buf.byteLength });
    }
    if (m === 'DELETE') { await kv.delete('f:' + id); return json(req, env, 200, { ok: true, id }); }
  }
  return json(req, env, 404, { ok: false, error: 'Ruta no encontrada' });
}

/* ===== Router ===== */
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req, env) });
    const isPost = req.method === 'POST', isData = isDataPath(url.pathname);
    if (req.method !== 'GET' && !(isPost && url.pathname.startsWith('/v1/enlaces')) && !(isData && ['PUT', 'DELETE'].includes(req.method))) return json(req, env, 405, { ok: false, error: 'Método no permitido' });
    const o = req.headers.get('Origin');
    /* El portal del cliente se sirve desde este mismo Worker: su propio origen siempre está permitido */
    if (o && o !== url.origin && !origins(env).includes(o)) return json(req, env, 403, { ok: false, error: 'Origen no autorizado' });
    /* Límite de intentos: antes de revisar cualquier clave */
    const ip = clientIp(req);
    /* Las rutas de datos tienen su propio límite (más alto: sincronizar muchos archivos); las claves se revisan igual */
    const busy = isData ? dataTooMany(ip) : tooManyRequests(ip);
    if (busy) return limited(req, env, busy, `Demasiadas consultas desde esta conexión. Intenta de nuevo en ${waitText(busy)}.`);
    const lockS = await lockedFor(ip, env);
    if (lockS) return limited(req, env, lockS, `Demasiados intentos con una clave incorrecta. Intenta de nuevo en ${waitText(lockS)}.`);
    /* Rastreo para clientes: rutas públicas, sin clave (el código del enlace es el permiso) */
    const pub = req.method === 'GET' && /^\/(r|v1\/publico)\/([^/]*)\/?$/.exec(url.pathname);
    if (pub) return publicRoute(req, env, ip, pub[1], pub[2]);
    if (isData) { try { return await dataRoute(req, env, ip, url); } catch (e) { return json(req, env, 502, { ok: false, error: 'No se pudo guardar o leer la información compartida.' }); } }
    const given = appKey(req, url);
    const authorized = sameKey(given, env.PCS_KEY);
    if (given && !authorized && env.PCS_KEY) {
      const lock = await registerFail(ip, env);
      if (lock) return limited(req, env, lock, `Demasiados intentos con una clave incorrecta. Intenta de nuevo en ${waitText(lock)}.`);
    } else if (authorized) await clearFails(ip, env);
    try {
      if (url.pathname === '/' || url.pathname === '/salud') {
        const out = { ok: false, servicio: 'PERCONSUR GPS', proveedor: 'IOPGPS', secretos: { IOP_APPID: !!env.IOP_APPID, IOP_SECRET: !!env.IOP_SECRET, PCS_KEY: !!env.PCS_KEY, ALLOWED_ORIGIN: origins(env).length > 0 } };
        try {
          await ensureToken(env); out.autenticacion = 'correcta';
          const f = await fleet(env); out.ok = true; out.dispositivos = f.value.length; out.conCoordenadas = f.value.filter((d) => d.lat != null && d.lng != null).length;
          if (authorized) {
            const raw = listOf(await iop(env, '/api/device/locations/search-by-organization?isTakeSub=1'));
            out.camposDelProveedor = raw[0] ? Object.keys(raw[0]) : [];
          }
        } catch (e) { out.autenticacion = out.autenticacion || 'fallida'; out.error = e.message; }
        out.rastreoClientes = { kv: !!kvOf(env), portal: !!appUrl(env) };
        out.informacionCompartida = { kv: !!env.DATA, claves: !!(env.DATA_WRITE_KEY && env.DATA_READ_KEY) };
        return json(req, env, out.ok ? 200 : 502, out);
      }
      if (!authorized) return json(req, env, 401, { ok: false, error: 'Clave de PERCONSUR inválida o ausente' });
      if (url.pathname === '/v1/posiciones') {
        const want = new Set((url.searchParams.get('imeis') || '').split(',').map((s) => s.trim()).filter(Boolean));
        const f = await fleet(env);
        const devices = want.size ? f.value.filter((d) => want.has(d.imei)) : f.value;
        return json(req, env, 200, { ok: true, fetchedAt: f.at, stale: !!f.stale, ...(f.error ? { warning: f.error } : {}), devices });
      }
      if (url.pathname === '/v1/ubicacion') {
        const imei = (url.searchParams.get('imei') || '').trim();
        if (!/^\d{8,20}$/.test(imei)) return json(req, env, 400, { ok: false, error: 'IMEI inválido' });
        const d = await detail(env, imei);
        return json(req, env, 200, { ok: true, fetchedAt: d.at, stale: !!d.stale, ...(d.error ? { warning: d.error } : {}), device: d.value });
      }
      if (url.pathname === '/v1/enlaces') {
        if (!isPost) {
          const now = Date.now();
          const links = (await listLinks(env)).filter((l) => now - (l.closedAt || l.createdAt || 0) < TRACK_KEEP * 1000).map((l) => internal(l.id, l, now)).sort((a, b) => b.createdAt - a.createdAt);
          return json(req, env, 200, { ok: true, links, maxHours: maxHours(env) });
        }
        const { rec, reused } = await createLink(env, await readBody(req));
        return json(req, env, reused ? 200 : 201, { ok: true, reused, link: internal(rec.id, rec) });
      }
      const lm = /^\/v1\/enlaces\/([A-Za-z0-9_-]{32})(?:\/(finalizar|revocar))?$/.exec(url.pathname);
      if (lm && isPost) {
        const rec = await updateLink(env, lm[1], await readBody(req), lm[2] || '');
        return json(req, env, 200, { ok: true, link: internal(rec.id, rec) });
      }
      return json(req, env, 404, { ok: false, error: 'Ruta no encontrada' });
    } catch (e) {
      return json(req, env, e.status || 502, { ok: false, error: e.message || 'Error al consultar IOPGPS' });
    }
  },
};

/* Rutas públicas del rastreo. Un código inexistente cuenta como intento fallido (sin sumar al contador general) */
async function publicRoute(req, env, ip, kind, token) {
  const valid = TOKEN_RE.test(token);
  if (kind === 'r') return portalResponse(env, valid ? token : 'no-valido', valid ? 200 : 404);
  const miss = async () => {
    const lock = await registerFail(ip, env, Date.now(), { global: false, maxFails: LIMITS.TOKEN_FAIL_MAX });
    if (lock) return limited(req, env, lock, `Demasiados intentos. Intenta de nuevo en ${waitText(lock)}.`);
    return json(req, env, 404, { ok: false, state: 'unknown' });
  };
  if (!valid) return miss();
  try {
    const rec = await getLink(env, token);
    if (!rec) return miss();
    return json(req, env, 200, await publicView(env, rec));
  } catch (e) {
    return json(req, env, e.status === 503 ? 503 : 502, { ok: false, state: 'error', error: 'El rastreo no está disponible en este momento.' });
  }
}

/* Solo para pruebas locales: reinicia el estado en memoria */
export function __reset() { token = null; tokenExp = 0; tokenPending = null; authFail = null; cache.clear(); inflight.clear(); failures.clear(); fails.clear(); reqs.clear(); globalFails = []; linkMem.clear(); listMem = null; dataReqs.clear(); }
