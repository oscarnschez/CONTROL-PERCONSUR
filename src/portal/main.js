/*
 * Portal público de rastreo para clientes.
 * El Worker gps-proxy sirve la página en /r/:token (otro sitio, separado de la app y de sus datos) y este código, el
 * mapa (MapLibre) y el diseño se cargan desde la app. Los datos llegan de /v1/publico/:token: el backend decide qué
 * ve el cliente (ubicación de SU unidad, número y placas de la unidad, remolque, contenedor, origen, destino, estado y el
 * operador solo por nombre y apellido; nunca velocidad ni otras unidades).
 * Se actualiza solo cada 30 s con la página visible (el estado cambia en cuanto PERCONSUR lo actualiza en Logística:
 * Cargando, En camino al destino, En el lugar de entrega, En ruta vacío, Vacío…); al cerrar la operación, al revocar o al vencer el enlace deja de
 * mostrar la ubicación. Una posición sin señal reciente se indica como «última ubicación reportada», no como actual.
 */
import { createCustomerTrackingMap } from '../ui/maps/CustomerTrackingMap.js';
import { esc } from '../domain/shared/format.js';
import { ageText } from '../domain/gps/gps.js';
import { icon, trailerIcon } from '../ui/components/icons.js';
import { copyrightText } from '../config/legal.js';
import { tipoDesc } from '../config/reference.js';

const root = document.getElementById('portal');
const API = root ? root.dataset.api : '';
const TRAILER = { chasis: 'Chasis portacontenedor', jaula: 'Jaula', tolva: 'Tolva' };
const TONE = { loading: 'violet', to_destination: 'blue', unloading: 'amber', empty_transit: 'teal', empty: 'gray', inactive: 'gray', delivered: 'ok' };
let map = null, mapState = 'none', timer = 0, failures = 0, lastAt = 0, data = null;

/* «Rastreo de transporte» (también con un Worker que todavía diga «Rastreo de envío») */
const head = () => { const h = root.querySelector('.pt-head'); if (!h) return ''; const tg = h.querySelector('.pt-tag'); if (tg) tg.textContent = 'Rastreo de transporte'; return h.outerHTML + '<div class="pt-band" aria-hidden="true"></div>'; };
document.title = 'Rastreo de transporte · PERCONSUR';
const fmtDate = (ts) => new Date(ts).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

function frame() {
  if (root.querySelector('[data-pt-card]')) return;
  root.innerHTML = `${head()}
    <section class="pt-card" data-pt-card aria-live="polite"></section>
    <div class="pt-mapwrap" data-pt-mapwrap hidden><div class="pt-map" data-pt-map aria-label="Mapa con la ubicación del transporte" role="region"></div><div class="pt-mapmsg" data-pt-mapmsg hidden></div></div>
    <section class="pt-route" data-pt-route hidden></section>
    <section class="pt-load" data-pt-load aria-label="Unidad y carga" hidden></section>
    <footer class="pt-foot"><p>${icon.info}<span>Este enlace es personal. Muestra la ubicación y el estado del transporte mientras el servicio está activo.</span></p><p class="pt-copy">PERCONSUR · División Campo</p><p class="pt-web"><a href="https://www.perconsur.mx" target="_blank" rel="noopener">www.perconsur.mx</a></p><p class="pt-legal">${esc(copyrightText())}</p></footer>`;
}
function routeHTML(t) {
  return `<div class="pt-rt"><span class="pt-rt-dot a" aria-hidden="true"></span><div><small>Origen</small><b>${esc(t.origin || '—')}</b></div></div>
    <div class="pt-rt"><span class="pt-rt-dot b" aria-hidden="true"></span><div><small>Destino</small><b>${esc(t.destination || '—')}</b>${t.place && t.place !== t.destination ? `<span>${esc(t.place)}</span>` : ''}</div></div>
    ${t.operator ? `<div class="pt-meta"><p class="pt-op">${icon.person}<span><small>Operador</small><b>${esc(t.operator)}</b></span></p></div>` : ''}`;
}
/* Unidad y carga: la unidad con sus placas, después el remolque y el contenedor (cada renglón solo si hay dato) */
function loadHTML(t) {
  const row = (ic, k, v, sub, mono = true) => `<div class="pt-li"><span class="pt-li-ic">${ic}</span><span class="pt-li-tx"><small>${k}</small><b${mono ? ' class="mono"' : ''}>${esc(v)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</span></div>`;
  const out = [], trailer = TRAILER[t.trailerType] || '';
  if (t.plates) out.push(row(icon.truck, 'Placas de la unidad', t.plates, t.unit ? `Unidad ${t.unit}` : ''));
  else if (t.unit) out.push(row(icon.truck, 'Unidad', t.unit, '', false));
  if (t.trailer) out.push(row(trailerIcon(t.trailerType), 'Placas del remolque', t.trailer, trailer));
  else if (trailer) out.push(row(trailerIcon(t.trailerType), 'Remolque', trailer, '', false));
  if (t.container || t.containerType) {
    const desc = tipoDesc(t.containerType), type = desc ? `${desc} · ${t.containerType}` : t.containerType || '';
    if (t.container) out.push(row(icon.container, t.container.includes('/') ? 'Contenedores' : 'Contenedor', t.container, type));
    else out.push(row(icon.container, 'Tipo de contenedor', type, '', false));
  }
  return out.join('');
}
function ageLine(p) {
  if (!p) return '';
  if (p.live) return `<span class="pt-age live"><i aria-hidden="true"></i><span data-pt-ts="${Number(p.at) || 0}">Ubicación actualizada ${esc(ageText(p.at))}</span></span>`;
  return `<span class="pt-age stale">${icon.alert}<span>Sin señal reciente del GPS. ${p.at ? `Última ubicación reportada: ${esc(fmtDate(p.at))}` : 'El mapa muestra la última ubicación reportada.'}</span></span>`;
}

function render(b) {
  data = b;
  frame();
  const card = root.querySelector('[data-pt-card]'), mapwrap = root.querySelector('[data-pt-mapwrap]'), route = root.querySelector('[data-pt-route]'), loadEl = root.querySelector('[data-pt-load]');
  root.classList.toggle('nomap', !(b && b.ok && b.state === 'active'));
  if (!b || !b.ok || b.state === 'unknown' || b.state === 'revoked' || b.state === 'expired') {
    card.className = 'pt-card gone';
    card.innerHTML = `<span class="pt-ic">${icon.linkOff}</span><h1>Este enlace ya no está disponible</h1><p>${b && b.state === 'expired' ? 'El enlace de rastreo venció.' : 'El enlace no existe o fue desactivado.'} Si necesitas información del transporte, comunícate con PERCONSUR.</p>`;
    mapwrap.hidden = true; route.hidden = true; loadEl.hidden = true; destroyMap(); return;
  }
  const t = b.trip || {}, tone = TONE[t.status] || 'blue';
  route.hidden = false; route.innerHTML = routeHTML(t);
  const lh = loadHTML(t); loadEl.hidden = !lh; loadEl.innerHTML = lh ? `<h2 class="pt-k">Unidad y carga</h2>${lh}` : '';
  if (b.state === 'finished') {
    card.className = 'pt-card done';
    card.innerHTML = `<span class="pt-ic">${icon.check}</span><small class="pt-k">Estado del transporte</small><h1>${esc(t.statusText || 'Entrega finalizada')}</h1><p>${b.closedAt ? `La entrega terminó el ${esc(fmtDate(b.closedAt).replace(/\.$/, ''))}. ` : ''}La ubicación ya no está disponible en este enlace.</p>`;
    mapwrap.hidden = true; destroyMap(); return;
  }
  const p = b.position;
  card.className = `pt-card on t-${tone}`;
  card.innerHTML = `<small class="pt-k">Estado del transporte</small><h1><i class="pt-dot" aria-hidden="true"></i>${esc(t.statusText || 'En camino')}</h1>
    ${p ? ageLine(p) : `<span class="pt-age stale">${icon.alert}<span>${esc(b.warning || 'La ubicación todavía no está disponible. Reintentamos en unos segundos.')}</span></span>`}`;
  mapwrap.hidden = false;
  ensureMap().then(() => { if (map && data === b) map.update(b); });
}

/* ===== Mapa (se crea una sola vez; las actualizaciones solo mueven el marcador) ===== */
async function ensureMap() {
  if (map || mapState === 'loading' || mapState === 'failed') return;
  mapState = 'loading';
  try {
    /* Vista satelital solo si el Worker ya permite sus imágenes (data-sat); con un Worker anterior no se ofrece */
    map = await createCustomerTrackingMap(root.querySelector('[data-pt-map]'), { views: root.dataset.sat === '1' });
    mapState = 'ready';
    if (data) map.update(data);
  } catch (e) {
    mapState = 'failed';
    const m = root.querySelector('[data-pt-mapmsg]');
    m.hidden = false;
    m.innerHTML = `${icon.cloudOff}<b>No se pudo mostrar el mapa</b><small>${esc(e.message || 'Revisa la conexión.')}</small>`;
  }
}
function destroyMap() { if (map) { map.destroy(); map = null; } if (mapState === 'ready') mapState = 'none'; }

/* ===== Consulta periódica (solo con la página visible) ===== */
async function load() {
  clearTimeout(timer);
  if (!API) return;
  try {
    const r = await fetch(API, { cache: 'no-store', credentials: 'omit', headers: { Accept: 'application/json' } });
    let b = null; try { b = await r.json(); } catch (e) { /* */ }
    if (r.status === 404) { render({ ok: false, state: 'unknown' }); return; }
    if (!r.ok || !b) throw new Error(b && b.error ? b.error : 'sin respuesta');
    failures = 0; lastAt = Date.now();
    render(b);
    if (b.state === 'active') schedule((b.refreshIn || 30) * 1000);
  } catch (e) {
    failures += 1;
    if (!data) { frame(); const card = root.querySelector('[data-pt-card]'); card.className = 'pt-card'; card.innerHTML = `<span class="pt-ic">${icon.cloudOff}</span><h1>No pudimos consultar el transporte</h1><p>Revisa tu conexión. Volveremos a intentarlo en unos segundos.</p>`; }
    schedule(Math.min(120000, 10000 * 2 ** Math.min(failures - 1, 4)));
  }
}
function schedule(ms) { clearTimeout(timer); timer = setTimeout(() => { if (document.visibilityState === 'visible') load(); }, ms); }
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (!data || data.state === 'active') { if (Date.now() - lastAt > 15000) load(); else schedule(Math.max(1000, 30000 - (Date.now() - lastAt))); }
  if (map) map.resize();
});
window.addEventListener('pageshow', (e) => { if (e.persisted) load(); });
window.addEventListener('online', () => load());
/* «hace 24 s» al día sin volver a consultar */
setInterval(() => { root.querySelectorAll('[data-pt-ts]').forEach((el) => { const ts = +el.dataset.ptTs; if (ts) el.textContent = `Ubicación actualizada ${ageText(ts)}`; }); }, 10000);
window.__pcsPortal = { reload: () => load() };   /* para pruebas automatizadas */

load();
