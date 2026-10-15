/*
 * Prueba local del Worker contra un servidor que imita la Open API de IOPGPS (no usa credenciales reales).
 * Uso: node gps-proxy/test.mjs
 */
import http from 'node:http';
import { createHash } from 'node:crypto';
import worker, { md5, toMs, normalize, __reset, LIMITS, appUrl, newToken } from './worker.js';

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
let tokens = new Set(), failNextWithToken = false, down = false, fleetNoTimes = false;
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
    return send(200, { code: 0, data: list });
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
  const op1 = { opId: 'lg_op1', imei: '865190071363660', unit: 'U12', operator: 'Daniel Rivera', trailerType: 'chasis', status: 'to_destination', origin: 'Manzanillo', destination: 'Guadalajara', place: 'CEDIS Guadalajara', dest: { lat: 20.6597, lng: -103.3496, approx: false } };
  __reset();
  r = await call('/v1/enlaces', { method: 'POST', body: op1 });
  ok(r.status === 503 && /KV «TRACKING»/.test(r.body.error), 'enlaces sin espacio KV: aviso claro (503)');
  r = await call('/v1/enlaces', { e: envT, method: 'POST', body: op1, key: null });
  ok(r.status === 401, 'crear enlace sin clave → 401');
  r = await call('/v1/enlaces', { e: envT, method: 'OPTIONS', key: null });
  ok(r.status === 204 && /POST/.test(r.headers.get('Access-Control-Allow-Methods')) && /Content-Type/.test(r.headers.get('Access-Control-Allow-Headers')), 'preflight CORS permite POST con JSON');
  r = await call('/v1/posiciones', { e: envT, method: 'POST', body: {} }); ok(r.status === 405, 'POST fuera de /v1/enlaces → 405');
  r = await call('/v1/enlaces', { e: envT, method: 'POST', body: { ...op1, status: 'empty' } });
  ok(r.status === 409 && /En ruta a destino o Descargando/.test(r.body.error), 'solo se comparte en En ruta a destino o Descargando');
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
  ok(!/speed|imei|865190071363660|U12|opId|placas|Antonio|Bautista/i.test(pubTxt), 'portal: sin velocidad, IMEI, número económico ni datos internos');
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
  r = await call('/v1/enlaces/' + L1.id, { e: envT, method: 'POST', body: { status: 'empty_transit' } });
  ok(r.body.link.state === 'finished', 'al pasar a En ruta vacío el enlace se finaliza');
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
} finally { srv.close(); }
function PCS_KEY_FOR_TEST() { return 'clave-app-PERCONSUR-123'; }

/* KV en memoria (get/put/list con metadatos) */
function memKV() {
  const m = new Map();
  return { m,
    async get(k, t) { const v = m.get(k); return v == null ? null : t === 'json' ? JSON.parse(v.v) : v.v; },
    async put(k, v, o = {}) { m.set(k, { v, meta: o.metadata, ttl: o.expirationTtl }); },
    async delete(k) { m.delete(k); },
    async list({ prefix = '' } = {}) { return { keys: [...m].filter(([k]) => k.startsWith(prefix)).map(([name, x]) => ({ name, metadata: x.meta })), list_complete: true }; } };
}

/* Hace que la caché parezca vencida sin borrar su contenido */
function cacheExpire() { const realNow = Date.now; Date.now = () => realNow() + 31 * 1000; setTimeout(() => { Date.now = realNow; }, 0); }
