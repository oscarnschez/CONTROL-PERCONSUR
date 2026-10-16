/*
 * Prueba local del Worker contra un servidor que imita la Open API de IOPGPS (no usa credenciales reales).
 * Uso: node gps-proxy/test.mjs
 */
import http from 'node:http';
import { createHash } from 'node:crypto';
import worker, { md5, toMs, normalize, __reset, LIMITS, appUrl, newToken, distanceM, exitDistance, sanitizeAlertConfig, evaluateGeofences, duesToday, duesMessage, geoMessage, dwellText, localParts, encryptPush, vapidHeader, pushEndpointOk, runAlerts, b64u, unb64u } from './worker.js';

const ok = (c, m) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); if (!c) process.exitCode = 1; };
const nodeMd5 = (s) => createHash('md5').update(s, 'utf8').digest('hex');

/* MD5 propio = MD5 de Node */
for (const s of ['', 'a', 'abc', 'secreto-de-prueba-32-caracteres!', 'ñandú ü 漢字', 'x'.repeat(1000)]) ok(md5(s) === nodeMd5(s), `md5(${JSON.stringify(s.slice(0, 20))})`);
ok(toMs(1759900380) === 1759900380000 && toMs(1759900380000) === 1759900380000 && toMs('1759900380') === 1759900380000, 'tiempos en segundos o milisegundos');
ok(normalize({ imei: 865190071363660, latitude: '19.010070', longitude: '-103.832489', accStatus: 1 }).lat === 19.01007, 'normaliza latitude/longitude y acc');
ok(normalize({ lat: 200, lng: 10 }).lat === null, 'descarta coordenadas fuera de rango');
ok(normalize({ imei: '1', lat: 1, lng: 1 }).course === null && normalize({ imei: '1' }).speed === null, 'campos que el proveedor no entrega quedan en null (no se inventa 0)');
{ const n = normalize({ imei: '1', lat: 1, lng: 1, locTime: '2026/10/08 10:00:00', hbTime: 1759900380 }), m = normalize({ imei: '1', lastGpsDateTime: '2026-10-08 09:00:00', heartbeatDate: 1759900400000 });
  ok(n.gpsTime === Date.parse('2026-10-08T10:00:00') && n.signalTime === 1759900380000 && m.gpsTime === Date.parse('2026-10-08T09:00:00') && m.signalTime === 1759900400000, 'horas con otros nombres de campo (locTime, hbTime, …) y fechas con «/»'); }
ok(normalize({ imei: '1', updateTime: 'abc', gpsTime: 5 }).gpsTime === null && normalize({ imei: '1', gpsTime: 99999999999999 }).gpsTime === null, 'horas no creíbles (1970, futuro lejano o texto) se descartan');

/* ===== IOPGPS simulado ===== */
const APPID = 'APP_PRUEBA', SECRET = 'secreto-de-prueba-0123456789abcdef';
const stats = { auth: 0, fleet: 0, location: 0, status: 0, all: 0 };
let tokens = new Set(), failNextWithToken = false, down = false, fleetNoTimes = false, fleetList = null;
const srv = http.createServer((req, res) => {
  const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  const u = new URL(req.url, 'http://x');
  stats.all++;
  if (down) return send(503, { code: 503, msg: 'mantenimiento' });
  if (req.method === 'POST' && u.pathname === '/api/auth') {
    let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => {
      stats.auth++;
      const { appid, time, signature } = JSON.parse(b);
      const good = appid === APPID && signature === nodeMd5(nodeMd5(SECRET) + time) && Math.abs(Date.now() / 1000 - time) < 300;
      if (!good) return send(200, { code: 1001, msg: 'signature error' });
      const t = 'tk' + Math.random().toString(36).slice(2); tokens.add(t);
      send(200, { code: 0, accessToken: t, expiresIn: 7200 });
    });
    return;
  }
  const t = req.headers.accesstoken;
  if (!tokens.has(t)) return send(200, { code: 401, msg: 'accessToken invalid' });
  if (failNextWithToken) { failNextWithToken = false; tokens.delete(t); return send(200, { code: 401, msg: 'accessToken expired' }); }
  if (u.pathname === '/api/device/locations/search-by-organization') {
    stats.fleet++;
    const list = [
      { imei: '865190071363660', deviceName: 'U12 60-BN-4J', lat: '19.010070', lng: '-103.832489', speed: 0, gpsTime: 1759900380, accStatus: 1 },
      { imei: '865190071300000', deviceName: 'U21', lat: 20.66, lng: -103.35, speed: 82.5, gpsTime: 1759900500, accStatus: 0 },
    ];
    /* Proveedor cuya consulta de flota no trae horas (la consulta por unidad sí) */
    if (fleetNoTimes) list.forEach((d) => { delete d.gpsTime; });
    return send(200, { code: 0, data: fleetList || list });
  }
  if (u.pathname === '/api/device/location') { stats.location++; return send(200, { code: 0, data: { lat: 19.01007, lng: -103.832489, address: 'Autopista Colima - Manzanillo, Tecolapa, Tecomán, Colima, México', gpsTime: 1759900380 } }); }
  if (u.pathname === '/api/device/status') { stats.status++; return send(200, { code: 0, data: [{ imei: u.searchParams.get('imei'), signalTime: fleetNoTimes ? Math.floor(Date.now() / 1000) - 40 : 1759900560, gpsTime: 1759900380, accStatus: 1, speed: 0 }] }); }
  send(404, { code: 404, msg: 'not found' });
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${srv.address().port}`;
const ORIGIN = 'https://oscarnschez.github.io';
const env = { IOP_APPID: APPID, IOP_SECRET: SECRET, PCS_KEY: 'clave-app-PERCONSUR-123', ALLOWED_ORIGIN: ORIGIN, IOP_BASE: BASE };
const call = async (path, { e = env, origin = ORIGIN, key = env.PCS_KEY, method = 'GET', ip = '', body } = {}) => {
  const h = {}; if (origin) h.Origin = origin; if (key) h['X-PCS-Key'] = key; if (ip) h['CF-Connecting-IP'] = ip;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await worker.fetch(new Request('https://perconsur-gps.ejemplo.workers.dev' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), e);
  let out = null; try { out = await r.clone().json(); } catch (x) { /* */ }
  return { status: r.status, body: out, headers: r.headers };
};

try {
  /* Salud sin secretos */
  __reset();
  let r = await call('/salud', { e: { ALLOWED_ORIGIN: ORIGIN, IOP_BASE: BASE }, origin: null, key: null });
  ok(r.status === 502 && r.body.secretos.IOP_SECRET === false && /Faltan los secretos/.test(r.body.error), 'salud: avisa si faltan los secretos');
  /* Firma incorrecta */
  __reset();
  r = await call('/salud', { e: { ...env, IOP_SECRET: 'otro' }, origin: null, key: null });
  ok(r.status === 502 && /signature error/.test(r.body.error), 'salud: autenticación rechazada con firma incorrecta');
  /* Salud correcta: sin clave no muestra nombres de campos; con clave sí */
  __reset();
  r = await call('/salud', { origin: null, key: null });
  ok(r.status === 200 && r.body.autenticacion === 'correcta' && r.body.dispositivos === 2 && !r.body.camposDelProveedor, 'salud: autenticación correcta y 2 dispositivos (sin exponer datos)');
  ok(!JSON.stringify(r.body).includes(SECRET) && !JSON.stringify(r.body).includes('865190071363660'), 'salud: no muestra secretos ni IMEI');
  r = await call('/salud?key=' + env.PCS_KEY, { origin: null, key: null });
  ok(Array.isArray(r.body.camposDelProveedor) && r.body.camposDelProveedor.includes('gpsTime'), 'salud con clave: nombres de los campos del proveedor');
  /* Autorización y CORS */
  r = await call('/v1/posiciones', { key: 'mala' }); ok(r.status === 401, 'posiciones: clave inválida → 401');
  r = await call('/v1/posiciones', { origin: 'https://otro-sitio.com' }); ok(r.status === 403, 'posiciones: origen no autorizado → 403');
  r = await call('/v1/posiciones', { method: 'OPTIONS', key: null }); ok(r.status === 204 && r.headers.get('Access-Control-Allow-Origin') === ORIGIN && /X-PCS-Key/.test(r.headers.get('Access-Control-Allow-Headers')), 'preflight CORS para el sitio autorizado');
  /* Posiciones normalizadas y caché */
  __reset(); stats.fleet = 0; stats.auth = 0;
  r = await call('/v1/posiciones');
  const u12 = r.body.devices.find((d) => d.imei === '865190071363660');
  ok(r.status === 200 && r.headers.get('Access-Control-Allow-Origin') === ORIGIN && u12 && u12.lat === 19.01007 && u12.lng === -103.832489 && u12.gpsTime === 1759900380000 && u12.acc === true, 'posiciones: U12 con lat, lng, hora GPS (ms) y encendido');
  await Promise.all([call('/v1/posiciones'), call('/v1/posiciones'), call('/v1/posiciones?imeis=865190071300000')]);
  ok(stats.fleet === 1 && stats.auth === 1, `caché 30 s: 4 consultas de la app → ${stats.fleet} llamada al proveedor y ${stats.auth} autenticación`);
  r = await call('/v1/posiciones?imeis=865190071300000'); ok(r.body.devices.length === 1 && r.body.devices[0].speed === 82.5, 'filtro por IMEI');
  /* Token vencido: reautentica y reintenta una vez */
  __reset(); await call('/v1/posiciones'); __reset();   /* fuerza nueva consulta */
  stats.auth = 0; failNextWithToken = true;
  r = await call('/v1/posiciones');
  ok(r.status === 200 && r.body.devices.length === 2 && stats.auth === 2, 'token vencido: se renueva y se reintenta');
  /* Ubicación con dirección y estado */
  r = await call('/v1/ubicacion?imei=865190071363660');
  ok(r.status === 200 && /Autopista Colima/.test(r.body.device.address) && r.body.device.signalTime === 1759900560000 && r.body.device.lat === 19.01007, 'ubicación: dirección, señal y coordenadas');
  r = await call('/v1/ubicacion?imei=abc'); ok(r.status === 400, 'ubicación: IMEI inválido → 400');
  /* Proveedor caído: entrega lo último conocido marcado como antiguo */
  cacheExpire();
  down = true; r = await call('/v1/posiciones'); down = false;
  ok(r.status === 200 && r.body.stale === true && r.body.devices.length === 2 && /mantenimiento|error/i.test(r.body.warning || ''), 'proveedor caído: última posición conocida marcada como antigua');
  __reset(); down = true; r = await call('/v1/posiciones'); down = false;
  ok(r.status === 502 && r.body.ok === false, 'proveedor caído sin datos previos: error claro (502)');
  r = await call('/nada'); ok(r.status === 404, 'ruta desconocida → 404');

  /* IOPGPS caído: /salud (sin clave) no repite llamadas al proveedor durante 30 s, aunque lleguen muchas peticiones */
  __reset(); stats.all = 0; down = true;
  for (let i = 0; i < 6; i++) await call('/salud', { origin: null, key: null, ip: `203.0.113.${50 + i}` });
  ok(stats.all === 1, `proveedor caído: 6 consultas anónimas a /salud → ${stats.all} llamada a IOPGPS (espera de 30 s)`);
  r = await call('/v1/posiciones'); ok(r.status === 502 && stats.all === 1, 'durante la espera la app recibe el error sin nuevas llamadas al proveedor');
  { const realNow = Date.now; Date.now = () => realNow() + 31 * 1000; down = false; r = await call('/v1/posiciones'); Date.now = realNow; ok(r.status === 200 && stats.all >= 2, 'pasados 30 s se vuelve a consultar y se recupera'); }
  down = false;

  /* ===== Límite de intentos (rate limit) ===== */
  __reset(); await call('/v1/posiciones');   /* caché llena: las pruebas siguientes no dependen del proveedor */
  const realNow = Date.now; let shift = 0; Date.now = () => realNow() + shift;
  try {
    const A = '203.0.113.10', B = '198.51.100.7';
    let codes = [];
    for (let i = 0; i < 4; i++) codes.push((await call('/v1/posiciones', { key: 'adivina' + i, ip: A })).status);
    r = await call('/v1/posiciones', { key: 'adivina-5', ip: A });
    ok(codes.every((c) => c === 401) && r.status === 429 && +r.headers.get('Retry-After') === 900 && /Intenta de nuevo en 15 min/.test(r.body.error), `5 claves incorrectas desde una IP → bloqueo 15 min (429, Retry-After 900): ${codes.join(',')},${r.status}`);
    ok(r.headers.get('Access-Control-Allow-Origin') === ORIGIN && /Retry-After/.test(r.headers.get('Access-Control-Expose-Headers') || ''), 'el 429 llega a la app (CORS y Retry-After visibles)');
    r = await call('/v1/posiciones', { ip: A });
    ok(r.status === 429, 'IP bloqueada: tampoco se revisa la clave correcta (no se puede seguir adivinando)');
    r = await call('/salud?key=otra', { origin: null, key: null, ip: A }); ok(r.status === 429, 'IP bloqueada: /salud con clave también');
    r = await call('/v1/posiciones', { ip: B }); ok(r.status === 200, 'otra IP con la clave correcta sigue funcionando');
    shift += 15 * 60 * 1000 + 1000;
    r = await call('/v1/posiciones', { ip: A }); ok(r.status === 200, 'al terminar el bloqueo, la clave correcta funciona');
    for (let i = 0; i < 3; i++) await call('/v1/posiciones', { key: 'x' + i, ip: B });
    await call('/v1/posiciones', { ip: B });
    codes = []; for (let i = 0; i < 4; i++) codes.push((await call('/v1/posiciones', { key: 'y' + i, ip: B })).status);
    ok(codes.every((c) => c === 401), 'una clave correcta reinicia la cuenta de fallos de esa IP');
    __reset(); await call('/v1/posiciones');
    for (let i = 0; i < 5; i++) await call('/v1/posiciones', { key: 'z' + i, ip: A });
    shift += 15 * 60 * 1000 + 1000;
    for (let i = 0; i < 4; i++) await call('/v1/posiciones', { key: 'w' + i, ip: A });
    r = await call('/v1/posiciones', { key: 'w5', ip: A });
    ok(r.status === 429 && +r.headers.get('Retry-After') === 1800, 'si reincide, el bloqueo se duplica (30 min)');
    /* Muchas IP distintas (ataque repartido): después de 30 fallos, 1 fallo basta para bloquear */
    __reset(); await call('/v1/posiciones');
    for (let i = 0; i < 31; i++) await call('/v1/posiciones', { key: 'k' + i, ip: `192.0.2.${i}` });
    r = await call('/v1/posiciones', { key: 'nueva', ip: '192.0.2.200' });
    ok(r.status === 429, 'ataque desde muchas IP: con más de 30 fallos, el primer fallo de una IP la bloquea');
    r = await call('/v1/posiciones', { ip: '192.0.2.201' }); ok(r.status === 200, 'una IP sin fallos con la clave correcta no se afecta');
    /* Peticiones por minuto */
    __reset(); await call('/v1/posiciones', { ip: B });
    codes = []; for (let i = 0; i < LIMITS.REQ_MAX; i++) codes.push((await call('/v1/posiciones', { ip: B })).status);
    ok(codes.filter((c) => c === 429).length === 1 && codes[codes.length - 1] === 429, `más de ${LIMITS.REQ_MAX} consultas por minuto desde una IP → 429`);
    shift += 61 * 1000; r = await call('/v1/posiciones', { ip: B }); ok(r.status === 200, 'al minuto siguiente vuelve a responder');
    /* Clave sin configurar en el Worker: no bloquea a nadie por error */
    __reset();
    codes = []; for (let i = 0; i < 6; i++) codes.push((await call('/v1/posiciones', { e: { ...env, PCS_KEY: '' }, key: 'algo', ip: A })).status);
    ok(codes.every((c) => c === 401), 'sin PCS_KEY configurada no se cuentan fallos (no se bloquea al propio usuario)');
    /* Con el espacio KV opcional (LIMITS) el bloqueo se comparte entre instancias */
    const store = new Map(), puts = [];
    const kv = { async get(k, t) { const v = store.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, async put(k, v, o) { puts.push(o); store.set(k, v); }, async delete(k) { store.delete(k); } };
    const envKV = { ...env, LIMITS: kv };
    __reset(); await call('/v1/posiciones', { e: envKV, ip: B });
    for (let i = 0; i < 5; i++) await call('/v1/posiciones', { e: envKV, key: 'q' + i, ip: A });
    __reset();   /* otra instancia: memoria vacía */
    r = await call('/v1/posiciones', { e: envKV, ip: A });
    ok(r.status === 429 && [...store.keys()].every((k) => k.startsWith('lim:') && !k.includes(A)), 'KV: el bloqueo se respeta en otra instancia y la IP no se guarda en texto');
    ok(puts.every((o) => o && o.expirationTtl >= 60), 'KV: los registros caducan solos');
  } finally { Date.now = realNow; }

  /* ===== Rastreo para clientes ===== */
  const kvT = memKV(), envT = { ...env, TRACKING: kvT };
  const WORKER_ORIGIN = 'https://perconsur-gps.ejemplo.workers.dev';
  const op1 = { opId: 'lg_op1', imei: '865190071363660', unit: 'U12', plates: '60-bn-4j', container: 'MSCU1234567 / nota', containerType: '45G1', operator: 'Daniel Rivera', trailerType: 'chasis', trailer: '788-wr-4', status: 'to_destination', origin: 'Manzanillo', destination: 'Guadalajara', place: 'CEDIS Guadalajara', dest: { lat: 20.6597, lng: -103.3496, approx: false } };
  __reset();
  r = await call('/v1/enlaces', { method: 'POST', body: op1 });
  ok(r.status === 503 && /KV «TRACKING»/.test(r.body.error), 'enlaces sin espacio KV: aviso claro (503)');
  r = await call('/v1/enlaces', { e: envT, method: 'POST', body: op1, key: null });
  ok(r.status === 401, 'crear enlace sin clave → 401');
  r = await call('/v1/enlaces', { e: envT, method: 'OPTIONS', key: null });
  ok(r.status === 204 && /POST/.test(r.headers.get('Access-Control-Allow-Methods')) && /Content-Type/.test(r.headers.get('Access-Control-Allow-Headers')), 'preflight CORS permite POST con JSON');
  r = await call('/v1/posiciones', { e: envT, method: 'POST', body: {} }); ok(r.status === 405, 'POST fuera de /v1/enlaces → 405');
  r = await call('/v1/enlaces', { e: envT, method: 'POST', body: { ...op1, status: 'otro' } });
  ok(r.status === 409 && /no reconocido/.test(r.body.error), 'estado de Logística desconocido: no se crea el enlace');
  r = await call('/v1/enlaces', { e: envT, method: 'POST', body: { ...op1, imei: '' } }); ok(r.status === 400 && /GPS vinculado/.test(r.body.error), 'unidad sin GPS: no se crea enlace');
  r = await call('/v1/enlaces', { e: envT, method: 'POST', body: { ...op1, origin: 'Manzanillo\u0000<b>x</b>' + 'y'.repeat(300) } });
  const L1 = r.body.link;
  ok(r.status === 201 && /^[A-Za-z0-9_-]{32}$/.test(L1.id) && L1.path === '/r/' + L1.id && L1.state === 'active' && L1.expiresAt - L1.createdAt === 72 * 3600 * 1000, 'crea enlace: código al azar de 32 caracteres, activo, vigencia 72 h');
  const rec1 = JSON.parse(kvT.m.get('lnk:' + L1.id).v);
  ok(rec1.origin.length === 120 && !rec1.origin.includes('\u0000'), 'los textos se limpian y se acotan');
  ok(kvT.m.get('lnk:' + L1.id).ttl > 72 * 3600 && kvT.m.get('lnk:' + L1.id).meta.opId === 'lg_op1', 'KV: el registro caduca solo y lleva metadatos para listar');
  ok(new Set(Array.from({ length: 200 }, newToken)).size === 200, 'códigos únicos');
  r = await call('/v1/enlaces', { e: envT, method: 'POST', body: op1 });
  ok(r.status === 200 && r.body.reused && r.body.link.id === L1.id, 'compartir otra vez la misma operación reutiliza el enlace');
  /* Vista pública: sin clave ni origen */
  r = await call('/v1/publico/' + L1.id, { e: envT, origin: null, key: null });
  const pubTxt = JSON.stringify(r.body);
  ok(r.status === 200 && r.body.state === 'active' && r.body.trip.origin === 'Manzanillo' && r.body.trip.destination === 'Guadalajara' && r.body.trip.statusText === 'En camino al destino' && r.body.position && r.body.position.lat === 19.01007, 'portal: origen, destino, estado y ubicación de la unidad');
  ok(r.body.trip.operator === 'Daniel Rivera', 'portal: nombre y apellido del operador');
  ok(r.body.trip.trailer === '788-WR-4' && r.body.trip.trailerType === 'chasis', 'portal: placas del remolque asignado (en mayúsculas) y su tipo');
  ok(r.body.trip.plates === '60-BN-4J' && r.body.trip.container === 'MSCU1234567' && r.body.trip.containerType === '45G1', 'portal: placas de la unidad, número de contenedor (solo números ISO) y tipo de contenedor');
  ok(L1.plates === '60-BN-4J' && L1.container === 'MSCU1234567' && L1.containerType === '45G1' && kvT.m.get('lnk:' + L1.id).meta.container === 'MSCU1234567', 'enlace: la app recibe placas y contenedor (para detectar cambios)');
  ok(!/speed|imei|865190071363660|opId|placas|Antonio|Bautista/i.test(pubTxt) && r.body.trip.unit === 'U12', 'portal: número de unidad (U12) para el marcador; sin velocidad, IMEI ni datos internos');
  ok(r.body.position.live === false && r.body.destination && r.body.destination.lat === 20.6597, 'portal: posición antigua marcada como no actual; destino en el mapa');
  ok(!('865190071300000' in r.body) && !pubTxt.includes('20.66'), 'portal: solo la unidad del enlace (no otras unidades)');
  r = await call('/v1/publico/' + L1.id, { e: envT, origin: WORKER_ORIGIN, key: null }); ok(r.status === 200, 'portal: el propio Worker es un origen permitido');
  r = await call('/v1/publico/' + L1.id, { e: envT, origin: 'https://otro-sitio.com', key: null }); ok(r.status === 403, 'portal: otros sitios no pueden leer los datos');
  /* Proveedor sin horas en la consulta de la flota: el portal las completa con la consulta por unidad (como el monitor) */
  fleetNoTimes = true; __reset();
  r = await call('/v1/publico/' + L1.id, { e: envT, origin: null, key: null });
  fleetNoTimes = false;
  ok(r.body.position && r.body.position.live === true && Math.abs(Date.now() - r.body.position.at) < 120000 && r.body.position.lat === 19.01007, 'flota sin horas: el portal usa la señal del equipo (consulta por unidad) y no marca «sin señal»: ' + JSON.stringify(r.body.position));
  __reset();
  /* Cambios de estado */
  r = await call('/v1/enlaces/' + L1.id, { e: envT, method: 'POST', body: { status: 'unloading' } });
  r = await call('/v1/publico/' + L1.id, { e: envT, origin: null, key: null });
  ok(r.body.trip.statusText === 'En el lugar de entrega', 'estado Descargando → «En el lugar de entrega»');
  /* El enlace sigue activo en cualquier estado y el portal muestra cada cambio */
  for (const [st, text] of [['empty_transit', 'En ruta vacío'], ['empty', 'Vacío'], ['loading', 'Cargando'], ['to_destination', 'En camino al destino'], ['inactive', 'Unidad sin operación activa']]) {
    r = await call('/v1/enlaces/' + L1.id, { e: envT, method: 'POST', body: { status: st } });
    const pv = await call('/v1/publico/' + L1.id, { e: envT, origin: null, key: null });
    ok(r.body.link.state === 'active' && r.body.link.status === st && pv.body.state === 'active' && pv.body.trip.status === st && pv.body.trip.statusText === text && pv.body.position, `estado ${st}: el enlace sigue activo y el portal muestra «${text}» con la ubicación`);
  }
  r = await call('/v1/enlaces/' + L1.id, { e: envT, method: 'POST', body: { trailer: 'JX-55-123', trailerType: 'chasis' } });
  const pvT = await call('/v1/publico/' + L1.id, { e: envT, origin: null, key: null });
  ok(r.body.link.trailer === 'JX-55-123' && pvT.body.trip.trailer === 'JX-55-123', 'cambio de remolque: el portal muestra las placas del nuevo remolque');
  r = await call('/v1/enlaces/' + L1.id, { e: envT, method: 'POST', body: { container: 'tghu7654321 msku1111111 abcu2222222', containerType: '<b>' } });
  const pvC = await call('/v1/publico/' + L1.id, { e: envT, origin: null, key: null });
  ok(pvC.body.trip.container === 'TGHU7654321 / MSKU1111111' && pvC.body.trip.containerType === '' && pvC.body.trip.plates === '60-BN-4J', 'cambio de contenedor: máximo 2 números; un tipo que no es código ISO se descarta');
  r = await call('/v1/enlaces', { e: envT, method: 'POST', body: { ...op1, status: 'empty' } });
  ok(r.status === 200 && r.body.reused && r.body.link.id === L1.id && r.body.link.status === 'empty', 'compartir con la unidad Vacía: se permite (reutiliza el enlace)');
  r = await call('/v1/enlaces/' + L1.id, { e: envT, method: 'POST', body: { status: 'estado-viejo' } });
  ok(r.body.link.state === 'finished', 'estado desconocido (app anterior): el enlace se finaliza como antes');
  r = await call('/v1/publico/' + L1.id, { e: envT, origin: null, key: null });
  ok(r.status === 200 && r.body.state === 'finished' && r.body.trip.statusText === 'Entrega finalizada' && !r.body.position && !r.body.destination, 'entrega finalizada: el enlace deja de dar la ubicación');
  r = await call('/v1/enlaces/' + L1.id, { e: envT, method: 'POST', body: { status: 'to_destination' } });
  ok(r.body.link.state === 'finished', 'un enlace finalizado no se reactiva');
  /* Otra operación de la misma unidad finaliza el enlace anterior */
  r = await call('/v1/enlaces', { e: envT, method: 'POST', body: { ...op1, opId: 'lg_op2' } }); const L2 = r.body.link;
  r = await call('/v1/enlaces', { e: envT, method: 'POST', body: { ...op1, opId: 'lg_op3' } }); const L3 = r.body.link;
  r = await call('/v1/publico/' + L2.id, { e: envT, origin: null, key: null });
  ok(L2.id !== L3.id && r.body.state === 'finished' && !r.body.position, 'nuevo viaje de la misma unidad: el enlace del viaje anterior deja de dar la ubicación');
  /* Revocación manual */
  r = await call('/v1/enlaces/' + L3.id + '/revocar', { e: envT, method: 'POST', body: {} });
  ok(r.status === 200 && r.body.link.state === 'revoked', 'revocar enlace');
  r = await call('/v1/publico/' + L3.id, { e: envT, origin: null, key: null });
  ok(r.body.state === 'revoked' && !r.body.trip && !r.body.position, 'enlace revocado: sin datos del viaje ni ubicación');
  /* Finalizar explícito y vencimiento */
  r = await call('/v1/enlaces', { e: envT, method: 'POST', body: { ...op1, opId: 'lg_op4' } }); const L4 = r.body.link;
  r = await call('/v1/enlaces/' + L4.id + '/finalizar', { e: envT, method: 'POST', body: { reason: 'closed' } }); ok(r.body.link.state === 'finished', 'finalizar (operación cerrada)');
  r = await call('/v1/enlaces', { e: envT, method: 'POST', body: { ...op1, opId: 'lg_op5' } }); const L5 = r.body.link;
  { const realNow2 = Date.now; Date.now = () => realNow2() + 73 * 3600 * 1000; try { r = await call('/v1/publico/' + L5.id, { e: envT, origin: null, key: null }); } finally { Date.now = realNow2; } }
  ok(r.body.state === 'expired' && !r.body.position && !r.body.trip, 'después de 72 h el enlace vence solo');
  r = await call('/v1/enlaces', { e: { ...envT, TRACK_MAX_HOURS: '12' }, method: 'POST', body: { ...op1, opId: 'lg_op6' } });
  ok(r.body.link.expiresAt - r.body.link.createdAt === 12 * 3600 * 1000, 'TRACK_MAX_HOURS ajusta la vigencia');
  /* Listado interno */
  r = await call('/v1/enlaces', { e: envT });
  const states = Object.fromEntries(r.body.links.map((l) => [l.opId, l.state]));
  ok(r.status === 200 && states.lg_op1 === 'finished' && states.lg_op3 === 'revoked' && states.lg_op6 === 'active' && r.body.maxHours === 72, 'listado interno de enlaces con su estado: ' + JSON.stringify(states));
  r = await call('/v1/enlaces', { e: envT, key: null }); ok(r.status === 401, 'listado sin clave → 401');
  /* Códigos inexistentes: 404 y bloqueo tras 20 intentos */
  __reset();
  r = await call('/v1/publico/' + 'A'.repeat(32), { e: envT, origin: null, key: null, ip: '203.0.113.99' }); ok(r.status === 404 && r.body.state === 'unknown', 'código inexistente → 404');
  r = await call('/v1/publico/corto', { e: envT, origin: null, key: null, ip: '203.0.113.99' }); ok(r.status === 404, 'código con formato inválido → 404');
  const codesT = []; for (let i = 0; i < 17; i++) codesT.push((await call('/v1/publico/' + newToken(), { e: envT, origin: null, key: null, ip: '203.0.113.99' })).status);
  r = await call('/v1/publico/' + newToken(), { e: envT, origin: null, key: null, ip: '203.0.113.99' });
  ok(codesT.every((c) => c === 404) && r.status === 429, '20 códigos inexistentes desde una IP → bloqueo (429)');
  r = await call('/v1/publico/' + L5.id, { e: envT, origin: null, key: null, ip: '203.0.113.100' }); ok(r.status === 200, 'otras IP siguen viendo su enlace');
  /* Página del portal */
  r = await call('/r/' + L1.id, { e: envT, origin: null, key: null });
  const html = await (await worker.fetch(new Request(WORKER_ORIGIN + '/r/' + L1.id), envT)).text();
  const csp = r.headers.get('Content-Security-Policy') || '';
  ok(r.status === 200 && /text\/html/.test(r.headers.get('Content-Type')) && html.includes(`data-api="/v1/publico/${L1.id}"`) && html.includes('https://oscarnschez.github.io/PERCONSUR/src/portal/main.js') && html.includes('PERCONSUR'), 'portal: página con identidad PERCONSUR que carga el mapa desde la app');
  ok(/script-src https:\/\/oscarnschez\.github\.io\/PERCONSUR\/;/.test(csp) && /frame-ancestors 'none'/.test(csp) && /connect-src 'self' https:\/\/tiles\.openfreemap\.org https:\/\/server\.arcgisonline\.com /.test(csp) && /img-src [^;]*https:\/\/server\.arcgisonline\.com/.test(csp) && html.includes('data-sat="1"') && r.headers.get('Referrer-Policy') === 'no-referrer' && /noindex/.test(r.headers.get('X-Robots-Tag')), 'portal: CSP estricta, sin referer y sin indexar');
  ok(html.includes('<link rel="icon" href="https://oscarnschez.github.io/PERCONSUR/assets/icons/favicon.ico" sizes="16x16 24x24 32x32 48x48 64x64 128x128 256x256">') && !html.includes('favicon-32.png') && /img-src https:\/\/oscarnschez\.github\.io\/PERCONSUR\/ /.test(csp), 'portal: favicon .ico de la app (la política de contenido permite cargarlo)');
  r = await call('/r/<script>', { e: envT, origin: null, key: null }); ok(r.status === 404, 'portal con código inválido → 404');
  ok(appUrl({ APP_URL: 'https://x.test/a"><script>' }) === '' && appUrl({ APP_URL: 'http://x.test/' }) === '' && appUrl({ APP_URL: 'https://app.test' }) === 'https://app.test/' && appUrl({ ALLOWED_ORIGIN: ORIGIN }) === ORIGIN + '/PERCONSUR/', 'APP_URL: solo https y sin caracteres peligrosos');
  r = await call('/salud', { e: envT, origin: null, key: null }); ok(r.body.rastreoClientes && r.body.rastreoClientes.kv === true && r.body.rastreoClientes.portal === true, '/salud indica si el rastreo para clientes está listo');

  /* ===== Información compartida (capturista / consulta) ===== */
  __reset();
  const kvD = memKV(), WK = 'clave-captura-123456', RK = 'clave-consulta-654321';
  const envD = { ...env, DATA: kvD, DATA_WRITE_KEY: WK, DATA_READ_KEY: RK };
  const dcall = async (path, { key, method = 'GET', body, headers = {}, e = envD, ip = '' } = {}) => {
    const h = { Origin: ORIGIN, ...headers }; if (key) h['X-PCS-Data'] = key; if (ip) h['CF-Connecting-IP'] = ip;
    const res = await worker.fetch(new Request('https://perconsur-gps.ejemplo.workers.dev' + path, { method, headers: h, body }), e);
    return res;
  };
  let res = await dcall('/v1/datos/estado', { key: WK, e: { ...env, DATA_WRITE_KEY: WK, DATA_READ_KEY: RK } });
  ok(res.status === 503 && /KV «DATA»/.test((await res.json()).error), 'datos sin espacio KV: aviso claro (503)');
  res = await dcall('/v1/datos/estado'); ok(res.status === 401, 'datos sin clave → 401');
  res = await dcall('/v1/datos/estado', { key: 'otra' }); ok(res.status === 401, 'clave de datos incorrecta → 401 (y cuenta como intento fallido)');
  res = await dcall('/v1/datos/estado', { key: PCS_KEY_FOR_TEST() }); ok(res.status === 401, 'la clave del GPS no abre la información compartida');
  res = await dcall('/v1/datos/estado', { key: WK }); let jb = await res.json();
  ok(res.status === 200 && jb.role === 'write' && jb.published === null, 'capturista: papel «write» y sin información publicada todavía');
  res = await dcall('/v1/datos/estado', { key: RK }); jb = await res.json(); ok(jb.role === 'read', 'consulta: papel «read»');
  res = await dcall('/v1/datos', { key: RK }); ok(res.status === 404, 'consulta antes de publicar → 404');
  const snap1 = new TextEncoder().encode(JSON.stringify({ app: 'perconsur', data: { vehicles: [{ id: 'v1' }] } }));
  const pub = (key, ver, device, extra = {}) => dcall('/v1/datos', { key, method: 'PUT', body: snap1, headers: { 'X-PCS-Ver': ver, 'X-PCS-Device': device, 'X-PCS-Enc': 'json', 'X-PCS-Files': '2', 'X-PCS-By': 'Administrador', ...extra } });
  res = await pub(RK, 'v1', 'devA'); ok(res.status === 403, 'consulta no puede publicar (403)');
  res = await pub(WK, 'v1', 'devA'); jb = await res.json();
  ok(res.status === 200 && jb.published.ver === 'v1' && jb.published.device === 'devA' && jb.published.files === 2 && jb.published.size === snap1.byteLength, 'capturista publica la foto (versión, dispositivo, archivos y tamaño)');
  res = await dcall('/v1/datos', { key: RK });
  ok(res.status === 200 && res.headers.get('X-PCS-Ver') === 'v1' && res.headers.get('X-PCS-Enc') === 'json' && new TextDecoder().decode(await res.arrayBuffer()).includes('"v1"') && res.headers.get('Access-Control-Allow-Origin') === ORIGIN, 'consulta descarga la foto con su versión (CORS para la app)');
  res = await pub(WK, 'v2', 'devA'); ok(res.status === 200, 'el mismo dispositivo vuelve a publicar');
  res = await pub(WK, 'v3', 'devB'); jb = await res.json();
  ok(res.status === 409 && jb.published.device === 'devA', 'otro dispositivo sin partir de la versión vigente → 409 (no reemplaza por error)');
  res = await pub(WK, 'v3', 'devB', { 'X-PCS-Base': 'v2' }); ok(res.status === 200, 'otro dispositivo que descargó la versión vigente (X-PCS-Base) sí publica');
  res = await pub(WK, 'v4', 'devC', { 'X-PCS-Force': '1' }); ok(res.status === 200, 'reemplazo expreso (X-PCS-Force)');
  res = await pub(WK, 'v<5>', 'devC'); ok(res.status === 400, 'versión con caracteres no válidos → 400');
  /* Archivos */
  const pdf = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55, 1, 2, 3]);
  res = await dcall('/v1/archivos/att_123', { key: RK, method: 'PUT', body: pdf }); ok(res.status === 403, 'consulta no sube archivos');
  res = await dcall('/v1/archivos/att_123', { key: WK, method: 'PUT', body: pdf }); ok(res.status === 200, 'capturista sube un archivo');
  res = await dcall('/v1/archivos/att_123', { key: RK });
  const got = new Uint8Array(await res.arrayBuffer());
  ok(res.status === 200 && got.length === pdf.length && got.every((b, i) => b === pdf[i]), 'consulta descarga el archivo idéntico');
  ok(res.headers.get('Content-Type') === 'application/octet-stream' && res.headers.get('Content-Disposition') === 'attachment' && /sandbox/.test(res.headers.get('Content-Security-Policy')) && res.headers.get('X-Content-Type-Options') === 'nosniff', 'los archivos se entregan como descarga binaria (nunca como página en el sitio del Worker)');
  res = await dcall('/v1/archivos/..%2Fsnap', { key: RK }); ok(res.status === 400, 'nombre de archivo inválido → 400');
  res = await dcall('/v1/archivos/att_123', { key: RK, method: 'DELETE' }); ok(res.status === 403, 'consulta no borra archivos');
  res = await dcall('/v1/archivos/att_123', { key: WK, method: 'DELETE' }); ok(res.status === 200, 'capturista borra un archivo');
  res = await dcall('/v1/archivos/att_123', { key: RK }); ok(res.status === 404, 'archivo borrado → 404');
  res = await dcall('/v1/archivos/grande', { key: WK, method: 'PUT', body: new Uint8Array(24 * 1024 * 1024 + 10) }); ok(res.status === 413, 'archivo de más de 24 MB → 413');
  res = await dcall('/v1/datos', { key: WK, method: 'DELETE' }); ok(res.status === 404 || res.status === 405, 'no se puede borrar la foto completa');
  res = await dcall('/v1/datos/estado', { method: 'OPTIONS' });
  ok(/PUT/.test(res.headers.get('Access-Control-Allow-Methods')) && /X-PCS-Data/.test(res.headers.get('Access-Control-Allow-Headers')) && /X-PCS-Ver/.test(res.headers.get('Access-Control-Expose-Headers')), 'CORS: PUT, DELETE y encabezados de datos para la app');
  /* Límite propio: sincronizar muchos archivos no choca con el de 120 por minuto */
  __reset();
  let codesD = []; for (let i = 0; i < 200; i++) codesD.push((await dcall('/v1/datos/estado', { key: RK, ip: '198.51.100.20' })).status);
  ok(codesD.every((c) => c === 200), '200 consultas de datos en un minuto con clave válida: sin bloqueo');
  codesD = []; for (let i = 0; i < 5; i++) codesD.push((await dcall('/v1/datos/estado', { key: 'mala' + i, ip: '198.51.100.21' })).status);
  ok(codesD[codesD.length - 1] === 429, '5 claves de datos incorrectas → bloqueo (429)');
  r = await call('/salud', { e: envD, origin: null, key: null }); ok(r.body.informacionCompartida && r.body.informacionCompartida.kv === true && r.body.informacionCompartida.claves === true, '/salud indica si la información compartida está lista');

  /* ===== Avisos: geocercas, vencimientos y notificaciones push ===== */
  ok(Math.abs(distanceM({ lat: 19, lng: -104 }, { lat: 20, lng: -104 }) - 111195) < 200 && distanceM({ lat: 19.05, lng: -104.31 }, { lat: 19.05, lng: -104.31 }) === 0, 'distancia: 1° de latitud ≈ 111 km');
  const cfgA = sanitizeAlertConfig({ tz: 'America/Mexico_City',
    units: [{ imei: '865190071363660', unit: 'UNIDAD 012' }, { imei: 'abc', unit: 'X' }, { imei: '865190071363660', unit: 'repetida' }, { imei: '865190071300000', unit: 'UNIDAD 021' }],
    zones: [{ id: 'terminals:ssa', name: 'Terminal SSA', kind: 'terminal', lat: 19.06, lng: -104.30, r: 400 }, { id: 'malo', lat: 999, lng: 1 }, { id: 'yards:p1', name: 'Patio 1', kind: 'yard', lat: 19.10, lng: -104.25, r: 10 },
      { id: 'op:lg_1', name: 'CEDIS Guadalajara', kind: 'delivery', lat: 20.65, lng: -103.40, r: 99999, imei: '865190071363660', opId: 'lg_1' }],
    dues: [{ id: 'd1', unit: 'UNIDAD 012', doc: 'Póliza de seguro', until: '2026-10-27' }, { id: 'd2', unit: 'UNIDAD 021', doc: 'Verificación', until: '27/10/2026' }] });
  ok(cfgA.units.length === 2 && cfgA.zones.length === 3 && cfgA.zones[1].r === 50 && cfgA.zones[2].r === 5000 && cfgA.zones[2].imei === '865190071363660' && cfgA.zones[2].opId === 'lg_1' && cfgA.dues.length === 1,
    'configuración de avisos: IMEI válidos sin repetir, coordenadas válidas, radio entre 50 m y 5 km, fechas AAAA-MM-DD');
  const T0 = Date.parse('2026-10-20T15:00:00Z'), at = (min) => T0 + min * 60000;
  const P = (lat, lng, t) => ({ lat, lng, gpsTime: t, signalTime: t });
  const U12 = '865190071363660', U21 = '865190071300000';
  const cfgG = { ...cfgA, zones: cfgA.zones.slice(0, 1) };
  let g = evaluateGeofences(cfgG, null, new Map([[U12, P(19.0601, -104.3001, at(0))], [U21, P(19.20, -104.10, at(0))]]), at(0));
  ok(g.events.length === 0 && g.geo.in[U12] && g.geo.in[U12]['terminals:ssa'] === at(0) && g.changed, 'primera revisión: la unidad que ya estaba en la terminal se registra sin aviso de «llegada»');
  const edge = 19.06 + (400 + 60) / 111195;   /* 460 m: fuera del radio pero dentro del margen de salida */
  let g2 = evaluateGeofences(cfgG, g.geo, new Map([[U12, P(edge, -104.30, at(5))], [U21, P(19.20, -104.10, at(5))]]), at(5));
  ok(g2.events.length === 0 && g2.geo.in[U12]['terminals:ssa'] && !g2.changed, 'margen de salida: a 460 m (radio 400 m) sigue dentro; sin escrituras si nada cambió');
  g2 = evaluateGeofences(cfgG, g2.geo, new Map([[U12, P(19.06 + 700 / 111195, -104.30, at(95))], [U21, P(19.0602, -104.3002, at(95))]]), at(95));
  const ex = g2.events.find((e) => e.t === 'exit'), en = g2.events.find((e) => e.t === 'enter');
  ok(ex && ex.imei === U12 && ex.dwell === 95 * 60000 && ex.name === 'Terminal SSA' && ex.unit === 'UNIDAD 012' && ex.rec === at(95), 'salida a 700 m: «Salida» con el tiempo en el lugar (1 h 35 min)');
  ok(en && en.imei === U21 && en.at === at(95) && g2.geo.log.length === 2, 'otra unidad entra: «Llegada» con la hora de la posición GPS; ambas quedan en la bitácora');
  let g3 = evaluateGeofences(cfgG, g2.geo, new Map([[U12, P(19.0601, -104.3001, at(100) - 40 * 60000)]]), at(100));
  ok(g3.events.length === 0 && !g3.geo.in[U12], 'posición con más de 30 min de antigüedad: no cuenta');
  const cfgG2 = { ...cfgA, zones: [cfgA.zones[0], cfgA.zones[2]] };
  g3 = evaluateGeofences(cfgG2, g2.geo, new Map([[U12, P(20.6501, -103.4001, at(200))], [U21, P(20.6501, -103.4001, at(200))]]), at(200));
  ok(g3.events.length === 1 && g3.events[0].t === 'exit' && g3.events[0].imei === U21 && !(g3.geo.in[U21] || {})['op:lg_1'] && g3.geo.in[U12]['op:lg_1'] && g3.events.every((e) => e.zone !== 'op:lg_1'),
    'destino de un viaje: solo aplica a su unidad; una geocerca nueva se registra sin «llegada» falsa');
  g3 = evaluateGeofences(cfgG, g3.geo, new Map([[U12, P(20.6501, -103.4001, at(205))]]), at(205));
  ok(!g3.geo.in[U12] && g3.events.length === 0 && !g3.geo.zones.includes('op:lg_1'), 'viaje terminado (geocerca retirada): se olvida en silencio');
  const dl = duesToday([{ unit: 'U1', doc: 'A', until: '2026-10-20' }, { unit: 'U2', doc: 'B', until: '2026-10-27' }, { unit: 'U3', doc: 'C', until: '2026-10-26' }, { unit: 'U4', doc: 'D', until: '2026-10-19' }, { unit: 'U5', doc: 'E', until: '2026-10-12' }, { unit: 'U6', doc: 'F', until: '2026-10-11' }, { unit: 'U7', doc: 'G', until: '2026-11-19' }], '2026-10-20');
  ok(dl.map((d) => d.unit).join(',') === 'U5,U4,U1,U2,U7', 'vencimientos del día: hoy, 7 y 30 días; vencido ayer y cada semana (no todos los días)');
  const dm = duesMessage(dl);
  ok(dm.title === 'Documentos que vencen hoy' && /Vence hoy: A · U1/.test(dm.body) && /Venció ayer: D · U4/.test(dm.body) && /Vencido hace 8 días: E · U5/.test(dm.body) && /y 1 más/.test(dm.body), 'mensaje de vencimientos: claro y breve (máximo 4 renglones)');
  const gm1 = geoMessage([ex], 'America/Mexico_City'), gm2 = geoMessage([ex, en], 'America/Mexico_City');
  ok(gm1.title === 'Salida · UNIDAD 012' && /Terminal SSA · 10:35 · estuvo 1 h 35 min/.test(gm1.body) && gm2.title === '1 llegada y 1 salida' && /Llegó UNIDAD 021 a Terminal SSA · 10:35/.test(gm2.body), 'mensaje de llegadas y salidas con hora local (10:35) y tiempo en el lugar');
  ok(dwellText(5 * 60000) === '5 min' && dwellText(120 * 60000) === '2 h' && localParts('America/Mexico_City', T0).date === '2026-10-20' && localParts('America/Mexico_City', T0).hour === 9, 'textos de tiempo y hora local de la operación');
  /* Web Push: cifrado de punta a punta y firma VAPID */
  const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const uaPub = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey)), authS = crypto.getRandomValues(new Uint8Array(16));
  const sub0 = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123', keys: { p256dh: b64u(uaPub), auth: b64u(authS) } };
  const enc = await encryptPush('{"title":"Hola ñ"}', sub0.keys.p256dh, sub0.keys.auth);
  ok((await decryptPush(enc, ua, authS)) === '{"title":"Hola ñ"}' && enc[20] === 65, 'aviso cifrado (aes128gcm): solo el navegador suscrito lo puede leer');
  const kvA = memKV(), envA = { ...env, TRACKING: kvA, APP_URL: 'https://oscarnschez.github.io/PERCONSUR/' };
  __reset();
  const vh = await vapidHeader(envA, sub0.endpoint, T0);
  const [, jwt, kpub] = /^vapid t=([^,]+), k=(.+)$/.exec(vh) || [];
  const [h64, c64, s64] = jwt.split('.'), claims = JSON.parse(new TextDecoder().decode(unb64u(c64)));
  const vk = await crypto.subtle.importKey('raw', unb64u(kpub), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, vk, unb64u(s64), new TextEncoder().encode(`${h64}.${c64}`)) && claims.aud === 'https://fcm.googleapis.com' && claims.sub === 'https://oscarnschez.github.io/PERCONSUR/' && claims.exp > T0 / 1000,
    'firma VAPID válida (ES256) con destino y contacto');
  __reset();
  ok((await vapidHeader(envA, sub0.endpoint)).endsWith('k=' + kpub) && JSON.parse(kvA.m.get('alr:vapid').v).jwk.d, 'llaves VAPID: se generan una vez y se reutilizan (guardadas en el KV del Worker, no en la app)');
  ok(pushEndpointOk(sub0.endpoint) && pushEndpointOk('https://web.push.apple.com/QK1') && pushEndpointOk('https://updates.push.services.mozilla.com/wpush/v2/x') && !pushEndpointOk('http://fcm.googleapis.com/x')
    && !pushEndpointOk('https://evil.example.com/x') && !pushEndpointOk('https://fcm.googleapis.com:8443/x') && !pushEndpointOk('https://fcm.googleapis.com.evil.com/x'), 'solo se envían avisos a los servicios de push de los navegadores (https, sin puertos ni dominios ajenos)');
  /* Rutas */
  const pushes = []; let pushStatus = 201;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, o = {}) => { const url = String(u.url || u); if (url.startsWith('https://fcm.googleapis.com/')) { pushes.push({ url, headers: o.headers, body: o.body }); return new Response('', { status: pushStatus }); } return realFetch(u, o); };
  const acall = (path, o = {}) => call(path, { e: envA, ...o });
  r = await acall('/v1/avisos', { key: 'mala' }); ok(r.status === 401, 'avisos: sin la clave de la app → 401');
  r = await acall('/v1/avisos', { e: env }); ok(r.status === 503 && /KV «TRACKING»/.test(r.body.error), 'avisos sin espacio KV: aviso claro (503)');
  r = await acall('/v1/avisos'); ok(r.status === 200 && r.body.vapidKey === kpub && r.body.config === null && r.body.subscriptions === 0, 'estado de avisos: llave pública para suscribirse, sin configuración todavía');
  r = await acall('/v1/avisos/config', { method: 'POST', body: { units: cfgA.units, zones: cfgA.zones.slice(0, 1), dues: [{ id: 'd1', unit: 'UNIDAD 012', doc: 'Póliza de seguro', until: '2026-10-27' }] } });
  const puts0 = kvA.puts || 0;
  ok(r.status === 200 && r.body.zones === 1 && r.body.units === 2 && kvA.m.get('alr:cfg'), 'la app publica unidades, geocercas y vencimientos');
  r = await acall('/v1/avisos/config', { method: 'POST', body: { units: cfgA.units, zones: cfgA.zones.slice(0, 1), dues: [{ id: 'd1', unit: 'UNIDAD 012', doc: 'Póliza de seguro', until: '2026-10-27' }] } });
  ok(r.body.unchanged === true && (kvA.puts || 0) === puts0, 'publicar lo mismo no gasta escrituras en KV');
  r = await acall('/v1/avisos/suscripcion', { method: 'POST', body: { subscription: { ...sub0, endpoint: 'https://evil.example.com/x' } } }); ok(r.status === 400, 'suscripción con un destino ajeno → 400');
  r = await acall('/v1/avisos/suscripcion', { method: 'POST', body: { subscription: sub0, label: 'iPhone de prueba', prefs: { due: true, geo: true } } });
  ok(r.status === 200 && r.body.subscriptions === 1, 'el dispositivo se suscribe a los avisos');
  r = await acall('/v1/avisos/prueba', { method: 'POST', body: { endpoint: sub0.endpoint } });
  const tp = pushes[pushes.length - 1];
  ok(r.status === 200 && tp && tp.headers['Content-Encoding'] === 'aes128gcm' && /^vapid t=/.test(tp.headers.Authorization) && JSON.parse(await decryptPush(tp.body, ua, authS)).title === 'Avisos de PERCONSUR activos', 'aviso de prueba: llega cifrado y firmado');
  /* Revisión automática: la unidad sale de la terminal → aviso */
  const nowS = () => Math.floor(Date.now() / 1000);
  fleetList = [{ imei: U12, lat: 19.0601, lng: -104.3001, gpsTime: nowS() }, { imei: U21, lat: 19.5, lng: -104, gpsTime: nowS() }];
  __reset(); let ra = await runAlerts(envA, { now: Date.now() });
  ok(ra.events.length === 0 && JSON.parse(kvA.m.get('alr:geo').v).in[U12], 'revisión: primera vez registra quién está en cada lugar (sin avisos)');
  fleetList = [{ imei: U12, lat: 19.08, lng: -104.30, gpsTime: nowS() }, { imei: U21, lat: 19.5, lng: -104, gpsTime: nowS() }];
  const np = pushes.length; __reset(); ra = await runAlerts(envA, { now: Date.now() });
  const msgs = []; for (const x of pushes.slice(np)) msgs.push(JSON.parse(await decryptPush(x.body, ua, authS)));
  ok(ra.events.length === 1 && ra.events[0].t === 'exit' && msgs.some((m) => m.title === 'Salida · UNIDAD 012' && m.url === '#/avisos'), 'la unidad sale de la terminal: se registra y llega el aviso al dispositivo');
  r = await acall('/v1/avisos/eventos?desde=0');
  ok(r.status === 200 && r.body.events.length === 1 && r.body.events[0].t === 'exit', 'la app consulta las llegadas y salidas registradas');
  r = await acall('/v1/avisos/eventos?desde=' + (r.body.events[0].rec)); ok(r.body.events.length === 0, 'consulta desde la última recibida: sin repetir');
  /* Vencimientos: una vez al día desde las 8:00 */
  const day8 = Date.parse('2026-10-20T14:30:00Z');   /* 8:30 en la Ciudad de México */
  const np2 = pushes.length; __reset(); ra = await runAlerts(envA, { now: day8 });
  const dmsg = pushes.slice(np2).length ? JSON.parse(await decryptPush(pushes[pushes.length - 1].body, ua, authS)) : null;
  ok(ra.dues === 1 && dmsg && dmsg.title === 'Documentos por vencer' && /Vence en 7 días: Póliza de seguro · UNIDAD 012/.test(dmsg.body), 'vencimientos: resumen a las 8:00 (póliza que vence en 7 días)');
  const np3 = pushes.length; __reset(); ra = await runAlerts(envA, { now: day8 + 3600000 });
  ok(pushes.length === np3, 'el resumen de vencimientos se envía una sola vez al día');
  const early = Date.parse('2026-10-21T12:00:00Z');   /* 6:00 */
  __reset(); await runAlerts(envA, { now: early }); ok(pushes.length === np3, 'antes de las 8:00 no se envía el resumen');
  /* El navegador canceló la suscripción: se borra */
  pushStatus = 410; r = await acall('/v1/avisos/prueba', { method: 'POST', body: { endpoint: sub0.endpoint } }); pushStatus = 201;
  r = await acall('/v1/avisos'); ok(r.body.subscriptions === 0, 'suscripción cancelada por el navegador (410): se elimina');
  /* Cron Trigger */
  await acall('/v1/avisos/suscripcion', { method: 'POST', body: { subscription: sub0, prefs: { due: false, geo: false } } });
  const waits = []; __reset();
  await worker.scheduled({ cron: '*/5 * * * *' }, envA, { waitUntil: (p) => waits.push(p) }); await Promise.all(waits);
  r = await acall('/v1/avisos'); ok(r.body.cronAt && Date.now() - r.body.cronAt < 5000, 'Cron Trigger: la revisión automática deja su señal (una vez por hora)');
  const npre = pushes.length; fleetList = [{ imei: U12, lat: 19.0601, lng: -104.3001, gpsTime: nowS() }];
  __reset(); ra = await runAlerts(envA); ok(ra.events.length === 1 && pushes.length === npre, 'dispositivo sin avisos de llegadas: se registra la llegada pero no se le envía');
  r = await acall('/v1/avisos/eventos?desde=0'); const nev = r.body.events.length;
  fleetList = [{ imei: U12, lat: 19.08, lng: -104.30, gpsTime: nowS() }]; __reset();
  r = await acall('/v1/avisos/eventos?desde=0'); const nev2 = r.body.events.length;
  ra = await runAlerts(envA); r = await acall('/v1/avisos/eventos?desde=0');
  ok(nev2 === nev && ra.events.length === 1 && ra.events[0].t === 'exit' && r.body.events.length === nev + 1, 'con el Cron Trigger activo la consulta de la app no hace su propia revisión (sin avisos repetidos)');
  r = await acall('/v1/avisos/baja', { method: 'POST', body: { endpoint: sub0.endpoint } }); ok(r.body.subscriptions === 0, 'dar de baja los avisos de un dispositivo');
  r = await acall('/salud', { origin: null, key: null }); ok(r.body.avisos && r.body.avisos.kv === true, '/salud indica si los avisos tienen espacio KV');
  globalThis.fetch = realFetch; fleetList = null;
} finally { srv.close(); }
function PCS_KEY_FOR_TEST() { return 'clave-app-PERCONSUR-123'; }

/* KV en memoria (get/put/list con metadatos) */
function memKV() {
  const m = new Map();
  return { m,
    async get(k, t) { const v = m.get(k); return v == null ? null : t === 'json' ? JSON.parse(v.v) : v.v; },
    async put(k, v, o = {}) { this.puts = (this.puts || 0) + 1; m.set(k, { v, meta: o.metadata, ttl: o.expirationTtl }); },
    async delete(k) { m.delete(k); },
    async list({ prefix = '' } = {}) { return { keys: [...m].filter(([k]) => k.startsWith(prefix)).map(([name, x]) => ({ name, metadata: x.meta })), list_complete: true }; } };
}

/* Hace que la caché parezca vencida sin borrar su contenido */
function cacheExpire() { const realNow = Date.now; Date.now = () => realNow() + 31 * 1000; setTimeout(() => { Date.now = realNow; }, 0); }

/* Descifra un aviso como lo haría el navegador (RFC 8291) */
async function decryptPush(body, uaKeys, auth) {
  const b = new Uint8Array(body), salt = b.slice(0, 16), idlen = b[20], asPub = b.slice(21, 21 + idlen), ct = b.slice(21 + idlen);
  const uaPub = new Uint8Array(await crypto.subtle.exportKey('raw', uaKeys.publicKey));
  const asKey = await crypto.subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, uaKeys.privateKey, 256));
  const hk = async (salt2, ikm, info, n) => new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: salt2, info }, await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), n * 8));
  const te2 = new TextEncoder(), cat2 = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
  const ikm = await hk(auth, shared, cat2(te2.encode('WebPush: info\0'), uaPub, asPub), 32);
  const cek = await hk(salt, ikm, te2.encode('Content-Encoding: aes128gcm\0'), 16), nonce = await hk(salt, ikm, te2.encode('Content-Encoding: nonce\0'), 12);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), ct));
  let end = plain.length - 1; while (end > 0 && plain[end] === 0) end--;
  return plain[end] === 2 ? new TextDecoder().decode(plain.slice(0, end)) : null;
}
