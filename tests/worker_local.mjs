/*
 * Worker gps-proxy corriendo en Node para las pruebas de punta a punta (monitor.py): el mismo código que va a
 * Cloudflare, con un IOPGPS simulado y un espacio KV en memoria. No usa credenciales reales.
 *   node tests/worker_local.mjs <puerto> <APP_URL> [origen de la app, por defecto http://127.0.0.1:8806]
 * Control de la simulación (solo pruebas): POST /__mock  { devices: [...] }  → posiciones que entrega el «proveedor»
 *   (vacía la caché de 30 s del Worker para que la prueba no tenga que esperar; los enlaces siguen en el KV)
 *   GET /__data → claves guardadas en el espacio DATA (información compartida) con su tamaño
 *   GET /__pushes → avisos push enviados (a los servicios de push simulados: no salen a internet)
 *   POST /__tick?now=ms → revisión de avisos como la del Cron Trigger (now opcional, para probar el resumen de las 8:00)
 * Claves de información compartida de prueba: capturista «datos-captura», consulta «datos-consulta».
 */
import http from 'node:http';
import { createHash } from 'node:crypto';
import worker, { __reset, runAlerts } from '../gps-proxy/worker.js';

const PORT = +process.argv[2] || 8795, APP_URL = process.argv[3] || 'https://app.test/', ORIGIN = process.argv[4] || 'http://127.0.0.1:8806';
const APPID = 'APP_PRUEBA', SECRET = 'secreto-de-prueba-0123456789abcdef';
const md5 = (s) => createHash('md5').update(s, 'utf8').digest('hex');
let devices = [];
/* Servicios de push de los navegadores simulados: se guardan los avisos (cifrados) que manda el Worker */
const pushes = [], realFetch = globalThis.fetch;
globalThis.fetch = async (u, o = {}) => {
  const url = String(u.url || u);
  if (/^https:\/\/(fcm\.googleapis\.com|web\.push\.apple\.com|updates\.push\.services\.mozilla\.com)\//.test(url)) {
    pushes.push({ url, at: Date.now(), headers: o.headers, body: Buffer.from(o.body).toString('base64') });
    return new Response('', { status: 201 });
  }
  return realFetch(u, o);
};

/* IOPGPS simulado */
const iop = http.createServer((req, res) => {
  const send = (b) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/auth') {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => { const { time, signature } = JSON.parse(b); send(signature === md5(md5(SECRET) + time) ? { code: 0, accessToken: 'tk', expiresIn: 7200 } : { code: 1001, msg: 'signature error' }); });
    return;
  }
  /* _hideInFleet: campos que la consulta de la flota no trae (como pasa con IOPGPS) pero la consulta por unidad sí */
  if (u.pathname === '/api/device/locations/search-by-organization') return send({ code: 0, data: devices.map((d) => { const o = { ...d }; (d._hideInFleet || []).forEach((k) => delete o[k]); delete o._hideInFleet; return o; }) });
  const d = devices.find((x) => x.imei === u.searchParams.get('imei')) || {};
  if (u.pathname === '/api/device/location') return send({ code: 0, data: d });
  if (u.pathname === '/api/device/status') return send({ code: 0, data: d });
  send({ code: 404, msg: 'no' });
});
await new Promise((r) => iop.listen(0, '127.0.0.1', r));

/* KV en memoria (get/put/list con metadatos y caducidad; valores de texto o binarios como en Cloudflare) */
function mkKV() {
  const store = new Map();
  const KV = {
    store,
    async get(k, t) {
      const x = store.get(k); if (!x || (x.exp && Date.now() > x.exp)) return null;
      const v = x.v;
      if (t === 'json') return JSON.parse(typeof v === 'string' ? v : new TextDecoder().decode(v));
      if (t === 'arrayBuffer') return typeof v === 'string' ? new TextEncoder().encode(v).buffer : v;
      return typeof v === 'string' ? v : new TextDecoder().decode(v);
    },
    async put(k, v, o = {}) { store.set(k, { v: typeof v === 'string' ? v : v instanceof ArrayBuffer ? v.slice(0) : new Uint8Array(v).slice().buffer, meta: o.metadata, exp: o.expirationTtl ? Date.now() + o.expirationTtl * 1000 : 0 }); },
    async delete(k) { store.delete(k); },
    async list({ prefix = '' } = {}) { return { keys: [...store].filter(([k]) => k.startsWith(prefix)).map(([name, x]) => ({ name, metadata: x.meta })), list_complete: true }; },
  };
  return KV;
}
const KV = mkKV(), DATA = mkKV();
const env = { IOP_APPID: APPID, IOP_SECRET: SECRET, PCS_KEY: 'clave-app', ALLOWED_ORIGIN: ORIGIN, IOP_BASE: `http://127.0.0.1:${iop.address().port}`, TRACKING: KV, APP_URL,
  DATA, DATA_WRITE_KEY: 'datos-captura', DATA_READ_KEY: 'datos-consulta' };

http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  if (req.url === '/__mock' && req.method === 'POST') { devices = JSON.parse(body.toString() || '{}').devices || []; __reset(); res.writeHead(204); return res.end(); }
  if (req.url === '/__pushes' && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(pushes)); }
  if (req.url.startsWith('/__tick') && req.method === 'POST') {
    const now = Number(new URL(req.url, 'http://x').searchParams.get('now')) || Date.now();
    const out = await runAlerts(env, { now, cron: true }); res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(out));
  }
  if (req.url === '/__data' && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify([...DATA.store].map(([k, x]) => ({ k, size: typeof x.v === 'string' ? x.v.length : x.v.byteLength })))); }
  /* La prueba entra como https://gps.test (el navegador la reenvía aquí) */
  const host = req.headers['x-forwarded-host'] || 'gps.test';
  const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  const r = await worker.fetch(new Request(`https://${host}${req.url}`, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }), env);
  const out = {}; r.headers.forEach((v, k) => { out[k] = v; });
  res.writeHead(r.status, out); res.end(Buffer.from(await r.arrayBuffer()));
}).listen(PORT, '127.0.0.1', () => console.log('worker local en', PORT));
