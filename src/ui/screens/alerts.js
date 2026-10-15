/*
 * Avisos (#/avisos): vencimientos de documentos, unidades en un lugar ahora y llegadas y salidas, con la sugerencia de
 * cambio de estado en Logística. Ajustes → Avisos (#/ajustes/avisos): notificaciones de este dispositivo, revisión
 * automática del Worker y qué se vigila. Geocercas (#/ajustes/avisos/geocercas): radio de cada lugar y su punto.
 */
import { screen, on } from '../../core/dom.js';
import { back } from '../../core/router.js';
import * as al from '../../services/alerts.js';
import * as un from '../../services/units.js';
import * as lg from '../../services/logistics.js';
import * as gps from '../../services/gps.js';
import { isReadOnly } from '../../services/access.js';
import { statusLabel } from '../../config/logistics.js';
import { ZONE_KINDS, RADII, radiusFor, dwellText, eventText } from '../../domain/alerts/alerts.js';
import { docType, unitTitle, dateShort, daysText } from '../../domain/units/units.js';
import { esc, agoText } from '../../domain/shared/format.js';
import { icon } from '../components/icons.js';
import { toast } from '../components/toast.js';
import { busy } from '../components/sheet.js';
import { chip, DOC_ICON } from './unitFile.js';
import { adjustTarget } from './destinationEdit.js';
import { locatePlace, failed, onGeoChange } from '../../services/geocode.js';
import { listAll } from '../../services/catalogs.js';

const p2 = (n) => String(n).padStart(2, '0');
const hm = (ms) => { const d = new Date(ms); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const MES3 = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function dayLabel(ms) {
  const d = new Date(ms), n = new Date(), start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(n) - start(d)) / 86400000);
  return diff === 0 ? 'Hoy' : diff === 1 ? 'Ayer' : `${d.getDate()} ${MES3[d.getMonth()]}${d.getFullYear() !== n.getFullYear() ? ' ' + d.getFullYear() : ''}`;
}
const unitOfImei = (imei) => un.units().find((u) => String(u.gpsDeviceId || '') === String(imei)) || null;
const opOfImei = (imei) => { const u = unitOfImei(imei); return u ? lg.openOf(u.id) : null; };

/* Aviso para activar las notificaciones en este dispositivo (si todavía no están) */
async function pushHint(el) {
  if (!gps.configured()) { el.innerHTML = `<a class="al-hint" href="#/ajustes/gps">${icon.info}<span><b>Configura el GPS para recibir avisos</b><small>Los avisos usan el mismo intermediario seguro que el rastreo GPS.</small></span>${icon.chev}</a>`; return; }
  const st = await al.pushStatus();
  if (st.on) { el.innerHTML = ''; return; }
  el.innerHTML = `<a class="al-hint" href="#/ajustes/avisos">${icon.bell}<span><b>${st.reason === 'ios-install' ? 'Instala la app para recibir notificaciones' : 'Recibe estos avisos aunque la app esté cerrada'}</b><small>${st.reason === 'ios-install' ? 'En iPhone las notificaciones funcionan con la app en la pantalla de inicio.' : 'Activa las notificaciones en este dispositivo.'}</small></span>${icon.chev}</a>`;
}

export async function alertsScreen() {
  await Promise.all([al.loadAlerts(), un.loadUnits(), lg.loadLogistics()]);
  const seenBefore = al.seenAt();
  let filter = 'all';
  const s = screen(`<div class="page wide al-page">
    <header class="nav-top"><button type="button" class="nav-back" data-back>${icon.back}<span>Inicio</span></button>
      <a class="nav-act" href="#/ajustes/avisos" aria-label="Ajustes de avisos">${icon.gear}</a></header>
    <h1 class="title">Avisos</h1>
    <p class="page-lead">Vencimientos de documentos y llegadas y salidas de las unidades.</p>
    <div data-hint></div>
    <section class="grp al-due" data-due></section>
    <section class="grp" data-inside hidden></section>
    <div class="sec-hrow"><h2 class="sec-h">Llegadas y salidas</h2><button type="button" class="btn-ghost sm" data-refresh>${icon.refresh}<span>Actualizar</span></button></div>
    <p class="grp-note al-chk" data-chk></p>
    <div class="chips filters" role="group" aria-label="Mostrar">${[['all', 'Todas'], ['enter', 'Llegadas'], ['exit', 'Salidas']].map(([k, l]) => `<button type="button" class="chip" data-f="${k}">${l}</button>`).join('')}</div>
    <div data-events></div>
  </div>`);
  const root = s.el;

  function drawDue() {
    const d = al.dueSummary();
    const tile = (n, l, tone) => `<div class="al-tile t-${tone}${n ? '' : ' zero'}"><b>${n}</b><span>${l}</span></div>`;
    root.querySelector('[data-due]').innerHTML = `<div class="grp-h"><h3>Vencimientos de documentos</h3><a class="link" href="#/unidades/vencimientos">Ver todos</a></div>
      <div class="al-tiles">${tile(d.expired, 'Vencidos', 'danger')}${tile(d.today, 'Vencen hoy', 'alert')}${tile(d.week, 'En 7 días', 'warn')}${tile(d.month, 'En 30 días', 'info')}</div>
      ${d.rows.length ? `<div class="list al-dlist">${d.rows.slice(0, 6).map((a) => `<a class="row" href="#/unidades/${encodeURIComponent(a.unit.id)}?sec=vigencias">
        <span class="row-ic un-dic t-${a.v.tone}">${icon[DOC_ICON[a.type]]}</span>
        <span class="row-tx"><span class="row-l1"><b>${esc(unitTitle(a.unit))}</b></span><span class="row-l2">${esc(docType(a.type).label)} · vence ${esc(dateShort(a.v.until))}</span>
          <span class="row-l3">${chip(a.v)}${a.v.days === 0 ? '' : ` <span class="un-days">${esc(daysText(a.v.days))}</span>`}</span></span><span class="chev">${icon.chev}</span></a>`).join('')}</div>`
    : '<p class="grp-note">Ningún documento vence en los próximos 30 días.</p>'}
      ${d.rows.length > 6 ? `<p class="grp-note">y ${d.rows.length - 6} más en <a class="link" href="#/unidades/vencimientos">Vencimientos próximos</a></p>` : ''}`;
  }
  function drawInside() {
    const box = root.querySelector('[data-inside]'), rows = [];
    for (const [imei, zones] of Object.entries(al.insideAll())) {
      const u = unitOfImei(imei);
      const last = (zid) => al.events().find((e) => e.imei === imei && e.zone === zid) || al.events().find((e) => e.zone === zid);
      const unitTxt = (al.events().find((e) => e.imei === imei) || {}).unit;
      for (const [zid, since] of Object.entries(zones)) rows.push({ u, imei, zid, since, unitTxt, name: al.zoneName(zid) || (last(zid) || {}).name || 'Lugar vigilado' });
    }
    box.hidden = !rows.length;
    rows.sort((a, b) => a.since - b.since);
    box.innerHTML = `<div class="grp-h"><h3>En un lugar ahora</h3><span class="count">${rows.length}</span></div>
      <div class="list">${rows.map((r) => `<a class="row al-in" ${r.u ? `href="#/operacion/logistica/u/${esc(r.u.id)}"` : ''}><span class="row-ic al-ic in">${icon.pin}</span>
        <span class="row-tx"><span class="row-l1"><b>${esc(r.u ? unitTitle(r.u) : r.unitTxt || 'GPS ' + r.imei.slice(-4))}</b></span><span class="row-l2">${esc(r.name)}</span>
        <span class="row-l3">Desde ${esc(dayLabel(r.since).toLowerCase())} ${hm(r.since)} · ${esc(dwellText(Date.now() - r.since))}</span></span>${r.u ? `<span class="chev">${icon.chev}</span>` : ''}</a>`).join('')}</div>`;
  }
  function drawEvents() {
    root.querySelectorAll('[data-f]').forEach((b) => { const o = b.dataset.f === filter; b.classList.toggle('on', o); b.setAttribute('aria-pressed', String(o)); });
    const st = al.status();
    root.querySelector('[data-chk]').innerHTML = !gps.configured() ? '' : st.error ? `${icon.alert} ${esc(st.error)}` : st.checkedAt ? `Revisado ${esc(agoText(st.checkedAt))}${st.cronAt ? ' · revisión automática activa' : ''}` : 'Consultando…';
    const list = al.events().filter((e) => filter === 'all' || e.t === filter).slice(0, 300);
    const box = root.querySelector('[data-events]');
    if (!list.length) {
      box.innerHTML = `<div class="empty"><p><b class="empty-t">${al.events().length ? 'Sin avisos de este tipo' : 'Aún no hay llegadas ni salidas'}</b>${gps.configured() ? 'Se registran cuando una unidad con GPS entra o sale de un patio, terminal, planta o destino con ubicación.' : 'Configura el GPS en Ajustes para empezar.'}</p>${gps.configured() ? '<a class="btn-secondary sm" href="#/ajustes/avisos/geocercas">Ver lugares vigilados</a>' : ''}</div>`;
      return;
    }
    const groups = new Map();
    for (const e of list) { const k = dayLabel(e.at); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
    const ro = isReadOnly();
    box.innerHTML = [...groups].map(([day, evs]) => `<h3 class="al-day">${esc(day)}</h3><div class="list">${evs.map((e) => {
      const u = unitOfImei(e.imei), op = opOfImei(e.imei), sug = op ? al.suggestionForOp(op) : null, mine = sug && sug.event.id === e.id;
      return `<div class="row al-ev${(e.rec || e.at) > seenBefore ? ' new' : ''}" data-ev="${esc(e.id)}"><span class="row-ic al-ic ${e.t === 'enter' ? 'in' : 'out'}">${e.t === 'enter' ? icon.flag : icon.route}</span>
        <span class="row-tx"><span class="row-l1"><b>${esc(u ? unitTitle(u) : e.unit)}</b><span class="al-t">${hm(e.at)}</span></span><span class="row-l2">${esc(eventText(e))}</span>
          ${e.t === 'exit' && e.dwell != null ? `<span class="row-l3">Estuvo ${esc(dwellText(e.dwell))} en el lugar</span>` : ''}
          ${e.applied ? `<span class="row-l3 al-ok">${icon.check} Estado cambiado a ${esc(statusLabel(e.applied))}</span>` : ''}
          ${mine && !ro ? `<span class="al-sug"><button type="button" class="btn-primary sm" data-apply="${esc(op.id)}">Cambiar a ${esc(statusLabel(sug.status))}</button><button type="button" class="btn-ghost sm" data-dismiss="${esc(e.id)}">Ahora no</button></span>` : ''}
        </span>${u ? `<a class="al-go" href="#/operacion/logistica/u/${esc(u.id)}" aria-label="Ver ${esc(unitTitle(u))} en Logística">${icon.chev}</a>` : ''}</div>`;
    }).join('')}</div>`).join('');
  }
  const draw = () => { drawDue(); drawInside(); drawEvents(); };
  draw();
  pushHint(root.querySelector('[data-hint]'));
  on(root, 'click', '[data-back]', () => back('/'));
  on(root, 'click', '[data-f]', (e, b) => { filter = b.dataset.f; drawEvents(); });
  on(root, 'click', '[data-refresh]', async (e, b) => { b.disabled = true; await al.refreshEvents(); b.disabled = false; });
  on(root, 'click', '[data-dismiss]', (e, b) => al.dismiss(b.dataset.dismiss));
  on(root, 'click', '[data-apply]', async (e, b) => {
    const op = lg.opById(b.dataset.apply), sug = op && al.suggestionForOp(op);
    if (!sug) return;
    try { await al.applySuggestion(op, sug); toast(`${lg.view(op).label}: ${statusLabel(sug.status)}`); } catch (err) { toast(err.message || 'No se pudo cambiar el estado.', { type: 'warn' }); }
  });
  const offs = [al.onAlertsChange(draw), un.onUnitsChange(drawDue), lg.onLogisticsChange(drawEvents)];
  s.mounted = () => { al.markSeen(); al.refreshEvents(); };
  s.cleanup = () => offs.forEach((f) => f());
  return s;
}

/* ===== Ajustes → Avisos ===== */
export async function alertsSettingsScreen() {
  await Promise.all([al.loadAlerts(), un.loadUnits(), lg.loadLogistics()]);
  const ro = isReadOnly(), cfgd = gps.configured(), p = al.prefs();
  const s = screen(`<div class="page al-set">
    <header class="nav-top"><button type="button" class="nav-back" data-back>${icon.back}<span>Ajustes</span></button></header>
    <h1 class="title">Avisos</h1>
    <p class="page-lead">Vencimientos de documentos y llegadas y salidas de las unidades, aunque la app esté cerrada.</p>
    ${cfgd ? '' : `<div class="empty"><p><b class="empty-t">Primero configura el GPS</b>Los avisos usan el mismo intermediario seguro (Cloudflare Worker) que el rastreo GPS.</p><a class="btn-primary sm" href="#/ajustes/gps">Configurar GPS</a></div>`}
    <section class="grp"><div class="grp-h"><h3>Notificaciones en este dispositivo</h3></div><div class="grp-b" data-push><p class="grp-note">Revisando…</p></div>
      <p class="grp-note">Resumen de vencimientos a las 8:00: documentos que vencen en 30, 15, 7, 3 y 1 días, el mismo día, y los vencidos (al día siguiente y luego cada semana). Llegadas y salidas: al momento (la revisión es cada 5 minutos).</p></section>
    ${cfgd ? `<section class="grp"><div class="grp-h"><h3>Revisión automática</h3></div><div class="grp-b" data-cron><p class="grp-note">Consultando el intermediario…</p></div></section>
    <section class="grp"><div class="grp-h"><h3>Qué se vigila</h3></div><div class="grp-b list-actions">
      <a class="row-btn" href="#/ajustes/avisos/geocercas">${icon.pin}<span>Geocercas (lugares vigilados)</span><small data-zn></small>${icon.chev}</a>
      <div class="row-info" data-pub>${icon.info}<span>…</span></div>
      ${ro ? '' : `<button type="button" class="row-btn" data-publish>${icon.upload}<span>Publicar ahora</span>${icon.chev}</button>`}
    </div><p class="grp-note">${ro ? 'Este dispositivo es de consulta: lo que se vigila lo publica el dispositivo capturista.' : 'Se publican al intermediario las unidades con GPS, los lugares con ubicación exacta, el destino de cada viaje activo y las fechas de fin de los documentos. Se actualiza solo cuando algo cambia.'}</p></section>
    ${ro ? '' : `<section class="grp"><div class="grp-h"><h3>Logística</h3></div><div class="grp-b">
      <label class="sw-row"><span class="sw-tx">Cambiar el estado automáticamente<small>Llegó al destino → Descargando · salió → En ruta vacío · llegó al patio de vacíos → Vacío. Apagado: se sugiere el cambio en Avisos y en Logística.</small></span><input type="checkbox" switch class="sw" data-auto${p.auto ? ' checked' : ''}></label>
    </div></section>`}` : ''}
  </div>`);
  const root = s.el;
  async function drawPush() {
    const box = root.querySelector('[data-push]');
    if (!cfgd) { box.innerHTML = '<p class="grp-note">Disponible al configurar el GPS.</p>'; return; }
    const st = await al.pushStatus();
    if (st.reason === 'ios-install') { box.innerHTML = `<div class="al-state warn">${icon.phone}<span><b>Instala la app en la pantalla de inicio</b><small>En iPhone y iPad (iOS 16.4 o posterior) las notificaciones solo funcionan con la app instalada.</small></span></div>
      <ol class="steps-list"><li>Abre esta página en <b>Safari</b>.</li><li>Toca <b>Compartir</b> ${icon.share} y elige <b>Añadir a pantalla de inicio</b>.</li><li>Abre PERCONSUR desde el ícono y vuelve a Ajustes → Avisos.</li></ol>`; return; }
    if (!st.ok) { box.innerHTML = `<div class="al-state">${icon.info}<span><b>Este navegador no permite notificaciones</b><small>Usa Chrome, Edge, Firefox o Safari actualizados.</small></span></div>`; return; }
    const sw = (k, l, sub) => `<label class="sw-row"><span class="sw-tx">${l}<small>${sub}</small></span><input type="checkbox" switch class="sw" data-pref="${k}"${st.prefs[k] ? ' checked' : ''}></label>`;
    const prefsHTML = sw('due', 'Vencimientos de documentos', 'Resumen diario a las 8:00') + sw('geo', 'Llegadas y salidas', 'Patios, terminales, plantas y destinos de los viajes');
    if (st.on) box.innerHTML = `<div class="al-state ok">${icon.check}<span><b>Activas en este dispositivo</b><small>Llegan aunque la app esté cerrada.</small></span></div>${prefsHTML}
      <div class="sheet-acts"><button type="button" class="btn-secondary" data-test>${icon.bell}<span>Enviar aviso de prueba</span></button><button type="button" class="btn-ghost danger" data-off>Desactivar</button></div>`;
    else box.innerHTML = `${st.permission === 'denied' ? `<div class="al-state warn">${icon.alert}<span><b>Notificaciones bloqueadas</b><small>Permítelas para esta app en los ajustes del teléfono o del navegador y vuelve a intentar.</small></span></div>` : ''}
      ${prefsHTML}<button type="button" class="btn-primary block" data-on>${icon.bell}<span>Activar notificaciones</span></button>`;
  }
  async function drawCron() {
    const box = root.querySelector('[data-cron]');
    if (!box) return;
    try {
      const w = await al.workerStatus();
      const live = w.cronAt && Date.now() - w.cronAt < 2 * 3600 * 1000;
      box.innerHTML = `<div class="al-state ${live ? 'ok' : 'warn'}">${live ? icon.check : icon.alert}<span><b>${live ? 'Activa · el intermediario revisa cada 5 minutos' : 'Sin revisión programada'}</b>
        <small>${live ? `Última señal ${esc(agoText(w.cronAt))}. Funciona aunque nadie tenga la app abierta.` : 'Por ahora solo se revisa mientras alguien tiene la app abierta. Para que funcione siempre: Cloudflare → tu Worker → Settings → Triggers → Cron Triggers → Add Cron Trigger → cada 5 minutos («*/5 * * * *»).'}</small></span></div>
        <div class="row-info">${icon.people}<span>${w.subscriptions} dispositivo${w.subscriptions === 1 ? '' : 's'} con notificaciones</span></div>`;
    } catch (e) {
      box.innerHTML = `<div class="al-state warn">${icon.alert}<span><b>${e.status === 404 ? 'Actualiza el intermediario' : 'No se pudo consultar el intermediario'}</b><small>${e.status === 404 ? 'El Worker de Cloudflare todavía no tiene avisos: pega el nuevo worker.js (ver README del intermediario).' : esc(e.message)}</small></span></div>`;
    }
  }
  function drawWatch() {
    const zn = root.querySelector('[data-zn]'), pub = root.querySelector('[data-pub]');
    if (!zn) return;
    const pl = al.zonePlan(), st = al.status(), pb = st.published;
    zn.textContent = `${pl.zones.length} vigilado${pl.zones.length === 1 ? '' : 's'}${pl.missing.length ? ` · ${pl.missing.length} sin ubicación` : ''}`;
    pub.innerHTML = `${st.pubError ? icon.alert : icon.info}<span>${st.pubError ? esc(st.pubError) : pb ? `Publicado ${esc(agoText(pb.at))}: ${pb.units} unidad${pb.units === 1 ? '' : 'es'} con GPS, ${pb.zones} geocerca${pb.zones === 1 ? '' : 's'}, ${pb.dues} documento${pb.dues === 1 ? '' : 's'} con vencimiento` : ro ? 'Lo publica el dispositivo capturista' : 'Todavía no se ha publicado'}</span>`;
  }
  drawPush(); drawCron(); drawWatch();
  on(root, 'click', '[data-back]', () => back('/ajustes'));
  on(root, 'click', '[data-on]', async (e, b) => {
    const prefs = { due: !!root.querySelector('[data-pref="due"]').checked, geo: !!root.querySelector('[data-pref="geo"]').checked };
    b.disabled = true;
    try { await al.enablePush(prefs); toast('Notificaciones activadas en este dispositivo'); } catch (err) { toast(err.message || 'No se pudieron activar las notificaciones.', { type: 'warn', ms: 5000 }); }
    b.disabled = false; drawPush(); drawCron();
  });
  on(root, 'change', '[data-pref]', async () => {
    const st = await al.pushStatus();
    if (!st.on) return;
    const prefs = { due: !!root.querySelector('[data-pref="due"]').checked, geo: !!root.querySelector('[data-pref="geo"]').checked };
    try { await al.updatePushPrefs(prefs); toast('Preferencias guardadas'); } catch (err) { toast(err.message, { type: 'warn' }); drawPush(); }
  });
  on(root, 'click', '[data-test]', async (e, b) => {
    b.disabled = true;
    try { await al.testPush(); toast('Aviso de prueba enviado: debe llegar en unos segundos'); } catch (err) { toast(err.message, { type: 'warn', ms: 5000 }); }
    b.disabled = false;
  });
  on(root, 'click', '[data-off]', async () => {
    try { await al.disablePush(); toast('Notificaciones desactivadas en este dispositivo'); } catch (err) { toast(err.message, { type: 'warn' }); }
    drawPush(); drawCron();
  });
  on(root, 'click', '[data-publish]', async (e, b) => {
    b.disabled = true; busy(true, 'Publicando…');
    const r = await al.publish({ force: true });
    busy(false); b.disabled = false;
    toast(r ? 'Publicado' : al.status().pubError || 'No se pudo publicar', { type: r ? 'ok' : 'warn' });
    drawWatch();
  });
  on(root, 'change', '[data-auto]', async (e, c) => { await al.setPrefs({ auto: c.checked }); toast(c.checked ? 'El estado cambiará solo al llegar y salir' : 'Se sugerirá el cambio de estado'); });
  const off = al.onAlertsChange(drawWatch);
  s.cleanup = () => off();
  return s;
}

/* ===== Geocercas ===== */
export async function geofencesScreen() {
  await Promise.all([un.loadUnits(), lg.loadLogistics()]);
  const ro = isReadOnly();
  const s = screen(`<div class="page al-geo">
    <header class="nav-top"><button type="button" class="nav-back" data-back>${icon.back}<span>Avisos</span></button></header>
    <h1 class="title">Geocercas</h1>
    <p class="page-lead">Lugares de los catálogos donde se registran llegadas y salidas. El radio se mide desde el punto del lugar; la salida se marca un poco más lejos para evitar avisos falsos por el margen del GPS.</p>
    <div data-list></div>
  </div>`);
  const root = s.el;
  const rsel = (id, kind, cur, attr) => `<span class="sel-w al-rsel"><select class="in" ${attr}="${esc(id)}" data-kind="${esc(kind)}" aria-label="Radio"${ro ? ' disabled' : ''}>${RADII.map((r) => `<option value="${r}"${r === cur ? ' selected' : ''}>${r >= 1000 ? r / 1000 + ' km' : r + ' m'}</option>`).join('')}</select><span class="sel-ic">${icon.down}</span></span>`;
  function draw() {
    const pl = al.zonePlan(), p = al.prefs(), all = [...pl.zones, ...pl.off];
    const groups = Object.entries(ZONE_KINDS).filter(([, k]) => k.catalog).map(([kind, k]) => ({ kind, k, list: all.filter((z) => z.kind === kind).sort((a, b) => a.name.localeCompare(b.name, 'es')) }));
    root.querySelector('[data-list]').innerHTML = `${groups.filter((g) => g.list.length).map((g) => `<section class="grp"><div class="grp-h"><h3>${esc(g.k.label)}</h3><span class="al-def">Radio${rsel(g.kind, g.kind, radiusFor(g.kind, '', { radius: p.radius }), 'data-kdef')}</span></div>
      <div class="list">${g.list.map((z) => { const on = !(p.off || {})[z.id]; return `<div class="row al-zone${on ? '' : ' off'}">
        <span class="row-ic al-ic in">${icon.pin}</span><span class="row-tx"><span class="row-l1"><b>${esc(z.name)}</b></span><span class="row-l2">${z.precision === 'manual' ? 'Punto fijado en el mapa' : z.precision === 'link' ? 'Punto del link de Google Maps' : 'Según la dirección'}</span>
        <span class="al-zacts">${rsel(z.id, z.kind, radiusFor(z.kind, z.id, p), 'data-zr')}${ro ? '' : `<button type="button" class="btn-ghost sm" data-pin="${esc(z.catalog)}|${esc(z.recId)}">${icon.pin}<span>Ajustar punto</span></button>`}</span></span>
        <input type="checkbox" switch class="sw" data-zon="${esc(z.id)}" aria-label="Vigilar ${esc(z.name)}"${on ? ' checked' : ''}${ro ? ' disabled' : ''}></div>`; }).join('')}</div></section>`).join('')}
      ${pl.missing.length ? `<section class="grp"><div class="grp-h"><h3>Sin ubicación exacta</h3><span class="count">${pl.missing.length}</span></div>
        <div class="list">${pl.missing.map((z) => `<div class="row al-zone off"><span class="row-ic al-ic">${icon.alert}</span><span class="row-tx"><span class="row-l1"><b>${esc(z.name)}</b></span>
          <span class="row-l2">${esc(ZONE_KINDS[z.kind].one)} · ${z.reason === 'approx' ? 'solo se conoce la colonia o el municipio' : !z.address ? 'sin dirección ni punto' : failed(z.address) ? 'no se encontró la dirección en el mapa' : 'buscando la dirección en el mapa…'}</span>
          ${ro ? '' : `<span class="al-zacts"><button type="button" class="btn-ghost sm" data-pin="${esc(z.catalog)}|${esc(z.recId)}">${icon.pin}<span>Fijar en el mapa</span></button></span>`}</span></div>`).join('')}</div>
        <p class="grp-note">Para registrar llegadas y salidas se necesita el punto exacto del lugar.</p></section>` : ''}
      <section class="grp"><div class="grp-h"><h3>Destinos de viajes activos</h3><span class="count">${pl.trips.length}</span></div>
        ${pl.trips.length ? `<div class="list">${pl.trips.map((t) => `<a class="row" href="#/operacion/logistica/u/${esc(t.op.vehicleId)}"><span class="row-ic al-ic ${t.zoneId ? 'in' : ''}">${t.zoneId ? icon.flag : icon.alert}</span>
          <span class="row-tx"><span class="row-l1"><b>${esc(lg.view(t.op).label)}</b><span class="al-t">${esc(statusLabel(t.op.status))}</span></span><span class="row-l2">${esc(t.zoneName || t.target.name || 'Destino')}</span>
          <span class="row-l3">${t.zoneId ? (t.zone ? 'Geocerca propia del viaje' : 'Usa la geocerca del catálogo') : 'Sin ubicación exacta: no se puede vigilar la llegada'}</span></span><span class="chev">${icon.chev}</span></a>`).join('')}</div>`
    : '<p class="grp-note">Ninguna unidad con GPS tiene un viaje activo con destino.</p>'}
        <p class="grp-note">Mientras un viaje está activo, su destino se vigila solo para esa unidad. Al terminar el viaje deja de vigilarse.</p></section>`;
  }
  draw();
  /* Lugares con dirección que todavía no se han ubicado: se buscan (una consulta por segundo, ver services/geocode.js) */
  for (const z of al.zonePlan().missing) {
    if (z.reason !== 'noloc' || !z.address || failed(z.address)) continue;
    const rec = listAll(z.catalog).find((x) => x.id === z.recId);
    if (rec) locatePlace(rec).catch(() => {});
  }
  on(root, 'click', '[data-back]', () => back('/ajustes/avisos'));
  on(root, 'change', '[data-zr]', async (e, sel) => { const p = al.prefs(); await al.setPrefs({ r: { ...p.r, [sel.dataset.zr]: +sel.value } }); draw(); });
  on(root, 'change', '[data-kdef]', async (e, sel) => { const p = al.prefs(); await al.setPrefs({ radius: { ...p.radius, [sel.dataset.kdef]: +sel.value } }); draw(); });
  on(root, 'change', '[data-zon]', async (e, c) => { const p = al.prefs(), off = { ...p.off }; if (c.checked) delete off[c.dataset.zon]; else off[c.dataset.zon] = true; await al.setPrefs({ off }); draw(); });
  on(root, 'click', '[data-pin]', async (e, b) => {
    const [catalog, id] = b.dataset.pin.split('|');
    const kind = Object.keys(ZONE_KINDS).find((k) => ZONE_KINDS[k].catalog === catalog);
    const z = [...al.zonePlan().zones, ...al.zonePlan().off].find((x) => x.catalog === catalog && x.recId === id);
    if (await adjustTarget({ edit: { type: 'catalog', kind: catalog, id }, title: ZONE_KINDS[kind].one, loc: z ? { lat: z.lat, lng: z.lng } : null })) { al.schedulePublish(); draw(); }
  });
  const offs = [al.onAlertsChange(draw), onGeoChange(() => { al.schedulePublish(); draw(); })];
  s.cleanup = () => offs.forEach((f) => f());
  return s;
}
