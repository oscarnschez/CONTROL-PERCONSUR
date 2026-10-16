/*
 * Operación → Logística → Monitoreo GPS   (#/operacion/logistica/monitoreo[?u=<id de la unidad>])
 * Centro de monitoreo propio de PERCONSUR: toda la flota vinculada a IOPGPS en un mapa MapLibre (FleetMap), con los
 * datos de Logística, sin entrar al portal del proveedor.
 *   Computadora: mapa amplio + panel lateral con las unidades (al elegir una, el panel muestra su detalle y el mapa la
 *                centra; el marcador abre una tarjeta resumida).
 *   iPhone:      mapa como elemento principal + panel inferior deslizable (resumen → mitad → completo).
 * Indicadores: monitoreadas y en operación (Logística) separados de en movimiento, detenidas y sin señal (GPS): el
 * movimiento NUNCA cambia el estado de Logística. Una posición sin señal reciente no se presenta como actual.
 * Datos: Logística + catálogos + la misma consulta compartida del GPS (services/gps.js, cada 30 s con la pantalla
 * visible; el Worker llama a IOPGPS como máximo cada 30 s). Rastreo para clientes: services/tracking.js.
 */
import { screen, on } from '../../core/dom.js';
import { go, back, query } from '../../core/router.js';
import * as lg from '../../services/logistics.js';
import * as gps from '../../services/gps.js';
import * as tracking from '../../services/tracking.js';
import { targetOf, onTargetsChange } from '../../services/destinations.js';
import { TRAILER_TYPES } from '../../services/catalogs.js';
import { STATUS_ORDER, LOGISTICS_DIVISIONS, statusOf, divisionLabel, showOnHome } from '../../config/logistics.js';
import { motionOf, fleetKpis, filterRows, sortRows, MOTIONS } from '../../domain/gps/fleet.js';
import { freshness, hasFix, isHiddenImei, ageText, dayHm, speedText, coordText } from '../../domain/gps/gps.js';
import { isApprox, precisionLabel } from '../../domain/gps/geo.js';
import { linkStateText, shortName } from '../../domain/tracking/tracking.js';
import { esc } from '../../domain/shared/format.js';
import { icon, trailerIcon } from '../components/icons.js';
import { openSheet, confirmDestructive } from '../components/sheet.js';
import { toast } from '../components/toast.js';
import { statusChip, trailerType, openStatusSheet, openOperationForm } from './logistics.js';
import { avatar, hydrateAvatars } from './operators.js';
import { createFleetMap } from '../maps/FleetMap.js';

const DESK = '(min-width: 900px)';
const PAGE = 60;
const MOTION_IC = { moving: icon.moving, stopped: icon.pause, nosignal: icon.signalOff };
const dt = (ts) => (ts ? new Date(ts).toLocaleString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '');
const routeTxt = (r) => (r.origin || r.destination ? `${r.origin || '—'} → ${r.destination || '—'}` : '');

/* ===== Filas del monitor: unidades con GPS vinculado + equipos de IOPGPS sin vincular ===== */
export function monitorRows() {
  const rows = [], linked = new Set();
  for (const e of lg.fleetBoard()) {
    const imei = gps.imeiOf(e.unit.id);
    if (!imei || isHiddenImei(imei)) continue;
    linked.add(imei);
    const v = lg.entryView(e), op = e.op, p = gps.bestOf(imei);
    rows.push({ id: e.unit.id, vehicleId: e.unit.id, imei, unit: e.unit, label: v.label, placas: v.placas, companyShort: v.companyShort, operator: v.operator, operatorRec: v.operatorRec,
      trailer: v.trailer, trailerType: v.trailerType, division: op ? op.division || '' : '', status: e.status, op, operating: !!op && showOnHome(e.status),
      origin: op ? op.origin : '', destination: op ? op.destination : '', reference: op ? op.reference : '', deliveryPlace: op ? op.deliveryPlace : '',
      deviceName: p ? p.name || '' : '', pos: p, motion: motionOf(p, gps.previousOf(imei)), linked: true });
  }
  for (const d of gps.devices()) {
    const imei = String(d.imei);
    if (linked.has(imei)) continue;
    const p = gps.bestOf(imei);
    rows.push({ id: 'dev:' + imei, vehicleId: null, imei, unit: null, label: d.name || `Equipo …${imei.slice(-4)}`, placas: '', operator: '', trailer: '', trailerType: '', division: '',
      status: 'inactive', op: null, operating: false, origin: '', destination: '', reference: '', deliveryPlace: '', deviceName: d.name || '', pos: p, motion: motionOf(p, gps.previousOf(imei)), linked: false });
  }
  return sortRows(rows, (k) => statusOf(k).rank);
}
const unitsWithoutGps = () => lg.units().filter((u) => !gps.imeiOf(u.id)).length;

/* Chip del GPS (separado del estado de Logística) */
function motionChip(r, cls = '') {
  const m = MOTIONS[r.motion], f = freshness(r.pos);
  let sub = '';
  if (r.motion === 'moving' && speedText(r.pos)) sub = speedText(r.pos);
  else if (r.motion === 'stopped' && f.state === 'parked' && r.pos.gpsTime) sub = `desde ${dayHm(r.pos.gpsTime)}`;
  else if (r.motion === 'nosignal') sub = hasFix(r.pos) ? (f.since ? ageText(f.since) : '') : r.pos ? 'sin coordenadas' : 'sin datos';
  return `<span class="mon-gps m-${r.motion} ${cls}">${MOTION_IC[r.motion]}<span>${esc(m.short)}${sub ? ` · ${esc(sub)}` : ''}</span></span>`;
}
/* Antigüedad de la última posición («hace 24 s»), al día sin volver a consultar */
function ageSpan(r, prefix = '') {
  const f = freshness(r.pos);
  if (f.state === 'none') return '<span class="muted">Sin posición GPS</span>';
  return f.state === 'live' ? `<span data-gps-ts="${Number(f.since) || 0}" data-gps-prefix="${esc(prefix)}">${esc(prefix + ageText(f.since))}</span>` : `<span class="warn-t">${esc(f.state === 'stale' ? 'Sin señal reciente' : 'Detenida')} · ${esc(f.since ? dayHm(f.since) : '')}</span>`;
}
const toneOf = (r) => (r.linked ? statusOf(r.status).tone : 'gray');

export async function gpsMonitorScreen() {
  await lg.loadLogistics();
  const q = query();
  const f = { gps: 'all', operating: false, division: 'all', status: 'all', type: 'all', text: '' };
  let sel = q.get('u') || null, shown = PAGE, rows = [], fleet = null, mapErr = null, gone = false, sheet = 'peek', desk = matchMedia(DESK).matches;
  const s = screen(`<div class="mon" data-sheet="peek">
    <header class="mon-top">
      <div class="mon-bar">
        <button type="button" class="nav-back" data-back>${icon.back}<span>Logística</span></button>
        <div class="mon-tt"><h1 class="mon-title">Monitoreo GPS</h1><span class="mon-upd" data-upd aria-live="polite"></span></div>
        <button type="button" class="icon-btn mon-ref" data-refresh aria-label="Actualizar ubicaciones ahora">${icon.refresh}</button>
      </div>
      <div class="mon-kpis" data-kpis role="group" aria-label="Resumen de la flota"></div>
    </header>
    <div class="mon-main" data-main>
      <section class="mon-mapbox" aria-label="Mapa de la flota">
        <div class="mon-map" data-map></div>
        <div class="mon-mapmsg" data-mapmsg hidden></div>
      </section>
      <aside class="mon-panel" data-panel aria-label="Unidades">
        <div class="mon-grab" data-grab><button type="button" class="mon-grab-b" data-grabbtn aria-label="Mostrar más o menos del panel"><i></i></button></div>
        <div class="mon-pv" data-pv-list>
          <div class="mon-phead">
            <label class="search mon-search"><span class="search-ic">${icon.search}</span><input type="search" class="search-in" data-q placeholder="Número económico, placas, operador o referencia" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search" aria-label="Buscar unidad"></label>
            <div class="mon-filters" role="group" aria-label="Filtros">
              <button type="button" class="chip" data-fg="all">Todas</button>
              ${['moving', 'stopped', 'nosignal'].map((k) => `<button type="button" class="chip" data-fg="${k}">${MOTION_IC[k]}${esc(MOTIONS[k].label)}</button>`).join('')}
              <span class="mon-sep" aria-hidden="true"></span>
              ${LOGISTICS_DIVISIONS.map(([k, , sh]) => `<button type="button" class="chip" data-fd="${k}">${esc(sh)}</button>`).join('')}
              <span class="mon-sep" aria-hidden="true"></span>
              ${TRAILER_TYPES.map(([k, l]) => `<button type="button" class="chip" data-ft="${k}">${trailerIcon(k)}${esc(k === 'chasis' ? 'Chasis' : l)}</button>`).join('')}
              <select class="chip mon-sel" data-fs aria-label="Estado del viaje"><option value="all">Estado del viaje</option>${STATUS_ORDER.map((x) => `<option value="${x.key}">${esc(x.label)}</option>`).join('')}</select>
            </div>
            <p class="mon-count" data-count></p>
          </div>
          <div class="mon-list" data-list aria-live="polite"></div>
        </div>
        <div class="mon-pv mon-detail" data-pv-detail hidden></div>
      </aside>
    </div>
  </div>`);
  const root = s.el, $ = (x) => root.querySelector(x);
  const mainEl = $('[data-main]'), panel = $('[data-panel]'), listEl = $('[data-list]'), detailEl = $('[data-pv-detail]'), listPv = $('[data-pv-list]');
  const mapEl = $('[data-map]'), msgEl = $('[data-mapmsg]');

  /* ===== Panel inferior (iPhone): resumen / mitad / completo ===== */
  const heights = () => { const H = mainEl.clientHeight || 600; return { peek: Math.min(176, Math.round(H * 0.42)), half: Math.round(H * 0.55), full: H - 4 }; };
  function setSheet(k, { animate = true } = {}) {
    sheet = k; root.dataset.sheet = k;
    if (desk) { panel.style.removeProperty('--sheet-h'); return; }
    panel.style.transition = animate ? '' : 'none';
    panel.style.setProperty('--sheet-h', heights()[k] + 'px');
    mainEl.style.setProperty('--sheet-vis', heights()[k] + 'px');
    if (!animate) requestAnimationFrame(() => { panel.style.transition = ''; });
  }
  const padding = () => (desk ? {} : { bottom: heights()[sheet] + 26 });
  (() => {
    let y0 = null, h0 = 0, last = 0, lastT = 0, v = 0, moved = false;
    const H = () => heights();
    const down = (e) => {
      if (desk || e.target.closest('input,select,.chip,.search')) return;
      y0 = e.clientY; h0 = H()[sheet]; last = y0; lastT = performance.now(); v = 0; moved = false;
      panel.style.transition = 'none';
    };
    let cap = null;
    const move = (e) => {
      if (y0 == null) return;
      const dy = e.clientY - y0;
      if (!moved && Math.abs(dy) > 6) { moved = true; try { e.currentTarget.setPointerCapture(e.pointerId); cap = e.currentTarget; } catch (x) { /* */ } }
      if (!moved) return;
      const hh = Math.max(H().peek - 40, Math.min(H().full, h0 - dy));
      panel.style.setProperty('--sheet-h', hh + 'px');
      const t = performance.now(); v = (e.clientY - last) / Math.max(1, t - lastT); last = e.clientY; lastT = t;
    };
    const up = (e) => {
      if (cap) { try { cap.releasePointerCapture(e.pointerId); } catch (x) { /* */ } cap = null; }
      if (y0 == null) return;
      panel.style.transition = '';
      const cur = parseFloat(panel.style.getPropertyValue('--sheet-h')) || H()[sheet];
      y0 = null;
      if (!moved) return;
      const hs = H();
      let k = Object.entries(hs).sort((a, b) => Math.abs(a[1] - cur) - Math.abs(b[1] - cur))[0][0];
      if (v < -0.6) k = cur < hs.half ? 'half' : 'full';
      if (v > 0.6) k = cur > hs.half ? 'half' : 'peek';
      setSheet(k);
    };
    const grab = $('[data-grab]'), head = root.querySelector('.mon-phead');
    [grab, head, detailEl].forEach((el) => el.addEventListener('pointerdown', (e) => { if (el === detailEl && !e.target.closest('.mon-dhead')) return; down(e); }));
    [grab, head, detailEl].forEach((el) => { el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); });
    /* Toque en la barra: resumen → mitad → completo → resumen */
    grab.addEventListener('click', () => { if (!moved) setSheet(sheet === 'peek' ? 'half' : sheet === 'half' ? 'full' : 'peek'); });
  })();

  /* ===== Dibujo ===== */
  const visible = () => filterRows(rows, f);
  const rowById = (id) => rows.find((r) => r.id === id) || null;
  function drawKpis() {
    const k = fleetKpis(rows);
    const tile = (key, label, on) => `<button type="button" class="mon-k k-${key}${on ? ' on' : ''}" data-kpi="${key}" aria-pressed="${on}"><b>${k[key]}</b><span>${esc(label)}</span></button>`;
    $('[data-kpis]').innerHTML = `<div class="mon-kg"><span class="mon-kh">Logística</span><div class="mon-kt">${tile('monitored', 'Unidades monitoreadas', f.gps === 'all' && !f.operating)}${tile('operating', 'En operación', f.operating)}</div></div>
      <div class="mon-kg"><span class="mon-kh">GPS</span><div class="mon-kt">${tile('moving', 'En movimiento', f.gps === 'moving')}${tile('stopped', 'Detenidas', f.gps === 'stopped')}${tile('nosignal', 'Sin señal reciente', f.gps === 'nosignal')}</div></div>`;
  }
  function drawFilters() {
    root.querySelectorAll('[data-fg]').forEach((b) => { const onn = b.dataset.fg === 'all' ? !filtersOn() : f.gps === b.dataset.fg; b.classList.toggle('on', onn); b.setAttribute('aria-pressed', onn); });
    root.querySelectorAll('[data-fd]').forEach((b) => { const onn = f.division === b.dataset.fd; b.classList.toggle('on', onn); b.setAttribute('aria-pressed', onn); });
    root.querySelectorAll('[data-ft]').forEach((b) => { const onn = f.type === b.dataset.ft; b.classList.toggle('on', onn); b.setAttribute('aria-pressed', onn); });
    const fs = $('[data-fs]'); fs.value = f.status; fs.classList.toggle('on', f.status !== 'all');
  }
  const filtersOn = () => f.gps !== 'all' || f.operating || f.division !== 'all' || f.status !== 'all' || f.type !== 'all' || !!f.text.trim();
  function rowHTML(r) {
    const link = r.op ? tracking.activeFor(r.op.id) : null;
    return `<button type="button" class="mon-row lg-t-${toneOf(r)}${r.id === sel ? ' is-sel' : ''}" data-u="${esc(r.id)}" aria-pressed="${r.id === sel}">
      <span class="mon-r1"><span class="unit-badge${r.linked ? '' : ' dev'}">${esc(r.label)}</span>${r.linked ? statusChip(r.status) : '<span class="lg-st lg-t-gray"><i aria-hidden="true"></i>Sin vincular</span>'}${motionChip(r)}</span>
      <span class="mon-r2">${r.linked ? `${r.operator ? esc(r.operator) : '<span class="muted">Sin operador</span>'}${r.division ? `<span class="dot">·</span>${esc(divisionLabel(r.division, true))}` : ''}${r.trailerType ? `<span class="dot">·</span>${trailerType(r.trailerType)}` : ''}` : `<span class="muted">Equipo de IOPGPS sin unidad del catálogo</span>`}</span>
      ${routeTxt(r) ? `<span class="mon-r3">${esc(r.origin || '—')}<span class="arr" aria-label="a">→</span>${esc(r.destination || '—')}</span>` : ''}
      <span class="mon-r4">${r.reference ? `<span class="mono">Ref. ${esc(r.reference)}</span><span class="dot">·</span>` : ''}${ageSpan(r, 'GPS ')}${link ? `<span class="mon-lnk" title="Rastreo compartido con el cliente">${icon.link}<span>Rastreo activo</span></span>` : ''}</span>
    </button>`;
  }
  function drawList() {
    const res = visible(), total = rows.length, nog = unitsWithoutGps();
    drawFilters();
    $('[data-count]').innerHTML = !gps.configured() ? '' : `${res.length === total ? `${total} unidad${total === 1 ? '' : 'es'} con GPS` : `${res.length} de ${total} unidades`}${filtersOn() ? ' · <button type="button" class="lg-linkbtn" data-clear>Quitar filtros</button>' : ''}`;
    if (!gps.configured()) {
      listEl.innerHTML = `<div class="empty mon-empty"><p>${icon.info}<span>El GPS no está configurado en este dispositivo.</span></p><a class="btn-secondary block" href="#/ajustes/gps">${icon.gear}<span>Configurar en Ajustes → GPS</span></a></div>`;
      return;
    }
    if (!total) { listEl.innerHTML = `<div class="empty mon-empty"><p>${gps.status().fetchedAt ? 'IOPGPS no reportó equipos y ninguna unidad tiene GPS vinculado.' : 'Consultando la flota…'}</p>${nog ? '<a class="btn-secondary block" href="#/ajustes/gps">Vincular unidades en Ajustes → GPS</a>' : ''}</div>`; return; }
    const y = listEl.scrollTop;
    listEl.innerHTML = res.length ? res.slice(0, shown).map(rowHTML).join('') + (res.length > shown ? `<button type="button" class="btn-ghost block" data-more>Mostrar más (${res.length - shown})</button>` : '')
      + (nog ? `<p class="grp-note mon-nog">${nog} unidad${nog === 1 ? '' : 'es'} del catálogo sin GPS vinculado · <a href="#/ajustes/gps">Vincular</a></p>` : '')
      : `<div class="empty mon-empty"><p>Sin unidades con estos filtros.</p><button type="button" class="btn-secondary block" data-clear>Quitar filtros</button></div>`;
    listEl.scrollTop = y;
  }
  /* Tarjeta resumida (marcador en computadora) */
  function popHTML(id) {
    const r = rowById(id); if (!r) return '';
    const t = r.op ? targetOf(r.op) : null;
    return `<div class="mon-pop"><div class="mon-pop-h"><span class="unit-badge">${esc(r.label)}</span>${r.linked ? statusChip(r.status) : ''}</div>
      <div class="mon-pop-gps">${motionChip(r)}</div>
      ${r.operator ? `<p>${icon.person}<span>${esc(r.operator)}</span></p>` : ''}
      ${routeTxt(r) ? `<p>${icon.route}<span>${esc(routeTxt(r))}</span></p>` : ''}
      ${t && t.name ? `<p>${icon.flag}<span>${esc(t.name)}</span></p>` : ''}
      <p class="mon-pop-age">${icon.clock}${ageSpan(r, 'Actualizado ')}</p>
      <div class="mon-pop-acts"><button type="button" class="btn-secondary sm" data-pop="detail">Ver detalle</button>${r.linked && r.vehicleId ? `<button type="button" class="btn-ghost sm" data-pop="logistics">Logística</button>` : ''}</div></div>`;
  }
  /* Panel de detalle de la unidad elegida */
  function drawDetail() {
    const r = sel && rowById(sel);
    if (!r) { detailEl.hidden = true; listPv.hidden = false; detailEl.innerHTML = ''; return; }
    const p = r.pos, fr = freshness(p), op = r.op, t = op ? targetOf(op) : null;
    const link = op ? tracking.activeFor(op.id) : null, block = r.linked ? tracking.blockFor(op) : 'Este equipo no está vinculado a una unidad del catálogo.';
    const row = (k, v) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`, tx = (v) => (v ? esc(v) : '<i>—</i>');
    const gpsRows = [];
    if (hasFix(p)) gpsRows.push(row('Ubicación', p.address ? esc(p.address) : '<i>Dirección no disponible</i>'), row('Latitud', esc(coordText(p.lat))), row('Longitud', esc(coordText(p.lng))));
    gpsRows.push(row('Última posición', p && p.gpsTime ? `${esc(dt(p.gpsTime))}<small>${ageSpan(r)}</small>` : '<i>Sin dato</i>'));
    if (p && p.signalTime && (!p.gpsTime || Math.abs(p.signalTime - p.gpsTime) > 60000)) gpsRows.push(row('Última señal del equipo', `${esc(dt(p.signalTime))}<small>${esc(ageText(p.signalTime))}</small>`));
    if (speedText(p)) gpsRows.push(row('Velocidad', esc(speedText(p)) + (fr.state === 'live' ? '' : '<small>Dato de la última posición</small>')));
    if (p && typeof p.acc === 'boolean') gpsRows.push(row('Motor', p.acc ? 'Encendido' : 'Apagado'));
    gpsRows.push(row('Equipo GPS', `${esc(r.deviceName || '—')}<small class="mono">IMEI ${esc(r.imei)}</small>`));
    detailEl.innerHTML = `
      <div class="mon-dhead">
        <button type="button" class="nav-back" data-close>${icon.back}<span>Unidades</span></button>
        ${hasFix(p) ? `<button type="button" class="btn-ghost sm" data-center>${icon.crosshair}<span>Centrar</span></button>` : ''}
      </div>
      <div class="mon-dcard lg-t-${toneOf(r)}">
        <div class="mon-dc1"><span class="unit-badge lg${r.linked ? '' : ' dev'}">${esc(r.label)}</span><div><b>${esc(r.placas || (r.linked ? 'Sin placas' : 'Equipo sin vincular'))}</b><small>${esc([r.companyShort, r.unit && r.unit.desc].filter(Boolean).join(' · ') || (r.linked ? 'Unidad' : r.deviceName))}</small></div></div>
        <div class="mon-dst"><span class="mon-lbl">Logística</span>${r.linked ? statusChip(r.status, 'lg-big') : '<span class="muted">Sin unidad del catálogo</span>'}</div>
        <div class="mon-dst"><span class="mon-lbl">GPS</span>${motionChip(r, 'big')}</div>
        ${!hasFix(p) ? `<p class="mon-warn">${icon.cloudOff}<span>${p ? 'IOPGPS no reportó coordenadas: la unidad no se muestra en el mapa.' : 'Sin datos de este equipo en IOPGPS: la unidad no se muestra en el mapa.'}</span></p>` : fr.state === 'stale' ? `<p class="mon-warn">${icon.alert}<span>Sin señal reciente: el mapa muestra la última posición reportada (${esc(dt(fr.since))}), no la posición actual.</span></p>` : ''}
      </div>
      ${r.linked ? `<section class="grp"><div class="grp-h"><h3>Unidad y operador</h3></div><div class="grp-b mon-gb">
        <div class="lg-opr">${r.operatorRec ? avatar(r.operatorRec, 'lg') : `<span class="av lg">${icon.person}</span>`}<div><b>${r.operator ? esc(r.operator) : '<span class="muted">Sin operador asignado</span>'}</b>${r.operatorRec && r.operatorRec.companyShort ? `<small>${esc(r.operatorRec.companyShort)}</small>` : ''}</div></div>
        <dl class="sumlist">${row('Número económico', tx(r.label))}${row('Placas', tx(r.placas))}${row('Remolque', r.trailer ? `${trailerType(r.trailerType, { full: true })}<small>${esc(r.trailer)}</small>` : '<i>Sin remolque</i>')}</dl></div></section>
      <section class="grp"><div class="grp-h"><h3>Viaje</h3></div><div class="grp-b mon-gb"><dl class="sumlist">
        ${row('División', tx(divisionLabel(r.division)))}${row('Estado', statusChip(r.status, 'plain'))}${row('Origen', tx(r.origin))}${row('Destino', tx(r.destination))}
        ${row('Referencia', r.reference ? `<span class="mono">${esc(r.reference)}</span>` : '<i>—</i>')}${row('Lugar de entrega', tx(r.deliveryPlace))}
        ${t && t.loc ? row(t.title, `${esc(t.name)}<small>${esc(precisionLabel(t.loc.precision))}</small>`) : ''}
      </dl></div></section>` : ''}
      <section class="grp"><div class="grp-h"><h3>GPS</h3><span class="mon-src">IOPGPS</span></div><div class="grp-b mon-gb"><dl class="sumlist">${gpsRows.join('')}</dl></div></section>
      <section class="grp"><div class="grp-h"><h3>Mapa</h3></div><div class="mon-acts2">
        ${hasFix(p) ? `<button type="button" class="btn-secondary" data-center>${icon.crosshair}<span>Centrar en el mapa</span></button>` : ''}
        <button type="button" class="btn-secondary" data-fitall>${icon.fit}<span>Ver toda la flota</span></button></div></section>
      ${r.linked ? `<section class="grp"><div class="grp-h"><h3>Rastreo para el cliente</h3></div><div class="grp-b mon-gb mon-trk">
        <p class="mon-trk-st${link ? ' on' : ''}">${link ? icon.link : icon.linkOff}<span>${link ? esc(linkStateText(link)) : esc(block || 'Sin enlace activo.')}</span></p>
        ${tracking.status().error && !link ? `<p class="grp-note warn-t">${esc(tracking.status().error)}</p>` : ''}
        <div class="mon-acts2">
          <button type="button" class="btn-primary" data-share${block ? ' disabled' : ''}>${icon.share}<span>${link ? 'Compartir rastreo' : 'Compartir rastreo con cliente'}</span></button>
          ${link ? `<a class="btn-secondary" href="${esc(tracking.linkUrl(link))}" target="_blank" rel="noopener" data-open>${icon.eye}<span>Abrir enlace público</span></a>
          <button type="button" class="btn-ghost danger" data-revoke>${icon.linkOff}<span>Revocar enlace activo</span></button>` : ''}
        </div>
        <p class="grp-note">El cliente ve solo el número y las placas de la unidad, la ubicación, el origen, el destino, el estado del viaje, las placas del remolque, el contenedor (número y tipo) y el operador por nombre y apellido${r.operator ? ` (${esc(shortName(r.operator))})` : ''}; nunca la velocidad. Cada cambio de estado se ve en el enlace al momento. Deja de dar la ubicación al cerrar la operación o al revocarlo.</p>
      </div></section>
      <section class="grp"><div class="grp-h"><h3>Acciones</h3></div><div class="mon-acts2">
        <a class="btn-secondary" href="#/operacion/logistica/u/${encodeURIComponent(r.vehicleId)}">${icon.truck}<span>Ver detalle logístico</span></a>
        ${op ? `<button type="button" class="btn-secondary" data-status>${icon.refresh}<span>Actualizar estado</span></button>` : `<button type="button" class="btn-secondary" data-newop>${icon.plus}<span>Nueva asignación</span></button>`}
      </div></section>` : ''}`;
    hydrateAvatars(detailEl);
    listPv.hidden = true; detailEl.hidden = false;
  }
  function drawUpd() {
    const st = gps.status();
    $('[data-upd]').innerHTML = !gps.configured() ? '' : st.error ? `<span class="warn-t" title="${esc(st.error)}">${icon.alert}<span>${esc(st.error)}</span></span>`
      : st.fetchedAt ? `<span data-gps-ts="${st.fetchedAt}" data-gps-prefix="Consulta ">Consulta ${esc(ageText(st.fetchedAt))}</span>${st.stale ? ' · <span class="warn-t">datos antiguos</span>' : ''}` : 'Consultando…';
  }
  function drawMap() {
    if (!fleet) return;
    const vis = visible();
    fleet.setVehicles(vis.filter((r) => hasFix(r.pos)).map((r) => ({ id: r.id, lat: r.pos.lat, lng: r.pos.lng, label: r.label, tone: toneOf(r), trailerType: r.trailerType, motion: r.motion, heading: r.pos.course,
      title: `${r.label}: ${r.linked ? statusOf(r.status).label : 'sin vincular'}, ${MOTIONS[r.motion].label.toLowerCase()}` })));
    if (fleet.selected() !== sel) fleet.select(sel && fleet.hasMarker(sel) ? sel : null, { fly: false });
    const r = sel && rowById(sel), t = r && r.op ? targetOf(r.op) : null;
    fleet.setDestination(t && t.loc ? { lat: t.loc.lat, lng: t.loc.lng, label: `${t.title}: ${t.name}`, approx: isApprox(t.loc.precision) } : null);
  }
  /* La consulta de la flota de IOPGPS puede llegar sin horas (posición y señal del equipo): para esas unidades se pide la
     consulta por unidad (guardada unos minutos), así ninguna se marca «sin señal» por falta de hora */
  const asked = new Map();
  function completeTimes() {
    const now = Date.now();
    rows.filter((r) => r.pos && hasFix(r.pos) && !r.pos.gpsTime && !r.pos.signalTime && now - (asked.get(r.imei) || 0) > 180000).slice(0, 30)
      .forEach((r) => { asked.set(r.imei, now); gps.detail(r.imei); });
  }
  function draw() {
    if (gone) return;
    rows = monitorRows();
    if (sel && !rowById(sel)) sel = null;
    drawUpd(); drawKpis(); drawList(); drawDetail(); drawMap();
    completeTimes();
  }

  /* ===== Selección ===== */
  function select(id, { fly = true, open = true } = {}) {
    sel = id || null;
    mainEl.scrollTop = 0;   /* el marco del mapa nunca se desplaza (un enfoque o «scrollIntoView» no lo mueve) */
    drawList(); drawDetail(); drawMap();
    if (fleet) fleet.select(sel && fleet.hasMarker(sel) ? sel : null, { fly });
    const r = sel && rowById(sel);
    if (r && r.imei) gps.detail(r.imei).then(() => { if (!gone && sel === r.id) { rows = monitorRows(); drawDetail(); if (fleet) fleet.refreshPopup(); } });
    if (!desk && open) setSheet(sel ? (sheet === 'full' ? 'full' : 'half') : 'peek');
    if (!desk && sel && fleet && fly) setTimeout(() => fleet.focus(sel), 30);
    try { history.replaceState(null, '', `#/operacion/logistica/monitoreo${sel ? `?u=${encodeURIComponent(sel)}` : ''}`); } catch (e) { /* */ }
  }
  function fitAll() { select(null, { fly: false, open: false }); if (fleet) fleet.fitFleet(); if (!desk) setSheet('peek'); }

  /* ===== Eventos ===== */
  on(root, 'click', '[data-back]', () => back('/operacion/logistica'));
  on(root, 'click', '[data-refresh]', async (e, b) => { b.classList.add('spin'); await gps.refresh({ force: true }); b.classList.remove('spin'); });
  on(root, 'click', '[data-kpi]', (e, b) => {
    const k = b.dataset.kpi;
    if (k === 'monitored') { f.gps = 'all'; f.operating = false; }
    else if (k === 'operating') f.operating = !f.operating;
    else f.gps = f.gps === k ? 'all' : k;
    shown = PAGE; draw();
  });
  on(root, 'click', '[data-fg]', (e, b) => { const k = b.dataset.fg; if (k === 'all') clearFilters(); else f.gps = f.gps === k ? 'all' : k; shown = PAGE; draw(); });
  on(root, 'click', '[data-fd]', (e, b) => { f.division = f.division === b.dataset.fd ? 'all' : b.dataset.fd; shown = PAGE; draw(); });
  on(root, 'click', '[data-ft]', (e, b) => { f.type = f.type === b.dataset.ft ? 'all' : b.dataset.ft; shown = PAGE; draw(); });
  $('[data-fs]').addEventListener('change', (e) => { f.status = e.target.value; shown = PAGE; draw(); });
  $('[data-q]').addEventListener('input', (e) => { f.text = e.target.value; shown = PAGE; drawList(); drawMap(); });
  $('[data-q]').addEventListener('focus', () => { if (!desk && sheet === 'peek') setSheet('half'); });
  function clearFilters() { Object.assign(f, { gps: 'all', operating: false, division: 'all', status: 'all', type: 'all', text: '' }); $('[data-q]').value = ''; }
  on(root, 'click', '[data-clear]', () => { clearFilters(); shown = PAGE; draw(); });
  on(root, 'click', '[data-more]', () => { shown += PAGE; drawList(); });
  on(root, 'click', '[data-u]', (e, b) => select(b.dataset.u));
  on(root, 'click', '[data-close]', () => { select(null, { fly: false }); });
  on(root, 'click', '[data-center]', () => { if (fleet && sel) { fleet.focus(sel); if (!desk && sheet === 'full') setSheet('half'); } });
  on(root, 'click', '[data-fitall]', fitAll);
  on(root, 'click', '[data-pop]', (e, b) => {
    const r = sel && rowById(sel); if (!r) return;
    if (b.dataset.pop === 'logistics' && r.vehicleId) go(`/operacion/logistica/u/${encodeURIComponent(r.vehicleId)}`);
    if (b.dataset.pop === 'detail') { listPv.hidden = true; detailEl.hidden = false; detailEl.scrollTop = 0; panel.querySelector('[data-close]')?.focus({ preventScroll: true }); }
  });
  on(root, 'click', '[data-status]', () => { const r = rowById(sel); if (r && r.op) openStatusSheet(r.op); });
  on(root, 'click', '[data-newop]', () => { const r = rowById(sel); if (r && r.vehicleId) openOperationForm({ vehicleId: r.vehicleId }); });
  on(root, 'click', '[data-share]', async (e, b) => {
    const r = rowById(sel); if (!r || !r.op || b.disabled) return;
    b.disabled = true; b.classList.add('busy');
    try { const link = await tracking.share(r.op); openLinkSheet(r, link); }
    catch (err) { toast(err.message || 'No se pudo crear el enlace.', { type: 'warn', ms: 4500 }); }
    finally { b.disabled = false; b.classList.remove('busy'); }
  });
  on(root, 'click', '[data-revoke]', async () => {
    const r = rowById(sel), link = r && r.op ? tracking.activeFor(r.op.id) : null; if (!link) return;
    if (!(await confirmDestructive('¿Revocar el enlace de rastreo?', `${r.label}: el cliente dejará de ver la ubicación de inmediato. Si lo necesitas, puedes compartir un enlace nuevo.`, 'Revocar enlace'))) return;
    try { await tracking.revoke(link); toast(`${r.label}: enlace revocado`); } catch (err) { toast(err.message || 'No se pudo revocar el enlace.', { type: 'warn', ms: 4500 }); }
  });

  /* ===== Mapa ===== */
  async function mountMap() {
    msgEl.hidden = true; mapErr = null;
    try {
      fleet = await createFleetMap(mapEl, { onSelect: (id) => select(id), onFit: fitAll, popupHTML: popHTML, padding, onMapClick: () => { if (sel) select(null, { fly: false }); } });
      if (gone) { fleet.destroy(); fleet = null; return; }
      fleet.setPopups(desk);
      drawMap();
      if (sel && fleet.hasMarker(sel)) fleet.focus(sel);
    } catch (e) {
      mapErr = e; fleet = null;
      msgEl.hidden = false;
      msgEl.innerHTML = `${icon.cloudOff}<b>No se pudo mostrar el mapa</b><small>${esc(e.message || '')} La lista de unidades sigue funcionando.</small><button type="button" class="btn-secondary sm" data-remap>${icon.refresh}<span>Reintentar</span></button>`;
    }
  }
  on(root, 'click', '[data-remap]', () => mountMap());

  /* Computadora ↔ iPhone (girar la tablet, cambiar el tamaño de la ventana) */
  const mq = matchMedia(DESK);
  const onLayout = () => { desk = mq.matches; root.dataset.layout = desk ? 'desk' : 'mobile'; setSheet(sheet, { animate: false }); if (fleet) { fleet.setPopups(desk); fleet.resize(); } };
  mq.addEventListener ? mq.addEventListener('change', onLayout) : mq.addListener(onLayout);
  const onResize = () => { if (!desk) setSheet(sheet, { animate: false }); };
  window.addEventListener('resize', onResize);

  draw();
  root.dataset.layout = desk ? 'desk' : 'mobile';
  if (sel) select(sel, { fly: false, open: true });
  const u1 = gps.watch(draw, 30000), u2 = lg.onLogisticsChange(draw), u3 = onTargetsChange(() => { drawDetail(); drawMap(); }), u4 = tracking.onTrackingChange(() => { drawList(); drawDetail(); }), u5 = gps.tickAges(root);
  tracking.syncAll().catch(() => {});
  s.mounted = () => { setSheet(sel ? 'half' : 'peek', { animate: false }); requestAnimationFrame(() => { if (!gone) mountMap(); }); };
  s.cleanup = () => {
    gone = true; u1(); u2(); u3(); u4(); u5();
    mq.removeEventListener ? mq.removeEventListener('change', onLayout) : mq.removeListener(onLayout);
    window.removeEventListener('resize', onResize);
    if (fleet) fleet.destroy(); fleet = null;
  };
  return s;
}

/* ===== Hoja para compartir el enlace con el cliente ===== */
function openLinkSheet(r, link) {
  const url = tracking.linkUrl(link), maxH = tracking.status().maxHours || 72;
  const text = `Rastreo de tu transporte con PERCONSUR${routeTxt(r) ? ` (${routeTxt(r)})` : ''}: ${url}`, short = url !== tracking.directUrl(link);
  const sh = openSheet({ title: 'Rastreo para el cliente', className: 'trk-sheet', body: `
    <p class="sheet-lead">${esc(r.label)}${routeTxt(r) ? ' · ' + esc(routeTxt(r)) : ''}</p>
    <div class="trk-url"><span class="mono" data-url>${esc(url)}</span></div>
    ${short ? `<p class="grp-note trk-short">Enlace corto${/^https:\/\/tinyurl\.com\//.test(link.short) ? ' de TinyURL' : ' de PERCONSUR'}${link.container && link.short.includes(link.container.split(' / ')[0]) ? ' con el número de contenedor' : ''}.</p>`
    : link.shortError ? `<p class="grp-note warn-t trk-short-err">${icon.alert}<span>No se pudo crear el enlace corto (${esc(link.shortError)}). Se comparte el enlace normal; se reintenta al volver a compartir.</span></p>` : ''}
    <ul class="trk-what">
      <li>${icon.eye}<span>El cliente ve el número y las placas de la unidad, la ubicación actual, el origen, el destino, el estado del viaje, las placas del remolque y el contenedor (número y tipo).</span></li>
      <li>${icon.person}<span>${r.operator ? `Operador: <b>${esc(shortName(r.operator))}</b> (solo nombre y apellido).` : 'Sin operador asignado.'}</span></li>
      <li>${icon.linkOff}<span>No ve la velocidad ni otras unidades.</span></li>
      <li>${icon.refresh}<span>Cada cambio de estado (Cargando, En ruta a destino, Descargando, En ruta vacío, Vacío…) se ve en el enlace al momento.</span></li>
      <li>${icon.clock}<span>Deja de mostrar la ubicación al cerrar la operación, si lo revocas o a las ${maxH} h.</span></li>
    </ul>
    <div class="sheet-acts col">
      ${navigator.share ? `<button type="button" class="btn-primary" data-sh="share">${icon.share}<span>Compartir enlace</span></button>` : ''}
      <button type="button" class="${navigator.share ? 'btn-secondary' : 'btn-primary'}" data-sh="copy">${icon.copy}<span>Copiar enlace</span></button>
      <a class="btn-secondary" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">${icon.whatsapp}<span>Enviar por WhatsApp</span></a>
      <a class="btn-secondary" href="${esc(url)}" target="_blank" rel="noopener">${icon.eye}<span>Abrir enlace público</span></a>
    </div>` });
  sh.body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-sh]'); if (!b) return;
    if (b.dataset.sh === 'share') { try { await navigator.share({ title: 'Rastreo de tu transporte · PERCONSUR', text: text.replace(`: ${url}`, ''), url }); } catch (err) { /* cancelado */ } }
    if (b.dataset.sh === 'copy') {
      let done = false;
      try { await navigator.clipboard.writeText(url); done = true; } catch (err) { /* sin permiso */ }
      if (!done) { const sel = window.getSelection(), rg = document.createRange(); rg.selectNodeContents(sh.body.querySelector('[data-url]')); sel.removeAllRanges(); sel.addRange(rg); try { done = document.execCommand('copy'); } catch (err) { /* */ } }
      toast(done ? 'Enlace copiado' : 'Selecciona y copia el enlace', { type: done ? 'ok' : 'info' });
    }
  });
  return sh;
}
