/*
 * Operación → Logística: estado operativo y asignación actual de cada unidad.
 *   #/operacion/logistica            tablero de la flota: buscador, filtros y tarjetas agrupadas por estado
 *   #/operacion/logistica/u/:id      detalle de la unidad: operación activa, cambio rápido de estado e historial
 * Inicio → «Unidades en operación» (mountHomeOps) muestra las unidades con estado ≠ Inactiva y ≠ Vacío en fichas deslizables,
 *   cada una con su mapa GPS (solo vista) y su destino (services/destinations.js) cuando la unidad tiene GPS vinculado.
 * Unidades, operadores y remolques salen de los catálogos (por ID); aquí no se capturan como texto libre.
 * Toda pantalla se suscribe a onLogisticsChange: un cambio se refleja al momento sin recargar.
 */
import { screen, on } from '../../core/dom.js';
import { go, back } from '../../core/router.js';
import * as lg from '../../services/logistics.js';
import { listDocuments } from '../../services/documents.js';
import { operatorList } from '../../services/operators.js';
import { listAll, TRAILER_TYPES, trailerTypeLabel, trailerScope } from '../../services/catalogs.js';
import { LOGISTICS_STATUSES, STATUS_ORDER, LOGISTICS_DIVISIONS, NEW_STATUS, TYPE_DIVISION, statusOf, statusLabel, divisionLabel, isWorking } from '../../config/logistics.js';
import { filterEntries, groupByStatus, countByStatus, homeEntries } from '../../domain/logistics/logistics.js';
import { isOverdue, emptyStatus as emptyStatusOf } from '../../domain/empties/empties.js';
import { esc, agoText, relDay } from '../../domain/shared/format.js';
import { fmtDate } from '../../domain/operators/balance.js';
import { icon, trailerIcon } from '../components/icons.js';
import { openSheet, actionSheet } from '../components/sheet.js';
import { openPicker } from '../components/picker.js';
import { toast } from '../components/toast.js';
import { enterAdvances } from '../components/fields.js';
import { avatar, hydrateAvatars } from './operators.js';
import { dossierRef } from '../../services/dossier.js';
import { generate as generateDossier } from './tripDocs.js';
import * as ec from '../../services/empties.js';
import * as fc from '../../services/fulls.js';
import { summary as fullsSummary } from '../../domain/fulls/fulls.js';
import { notifyEmptyResult } from './empties.js';
import * as gps from '../../services/gps.js';
import { freshness, ageText, hasFix } from '../../domain/gps/gps.js';
import { createGpsPanel } from './gpsPanel.js';
import { mountMap } from '../components/gpsMap.js';
import { targetOf, onTargetsChange } from '../../services/destinations.js';
import { distanceKm, distanceText, isApprox } from '../../domain/gps/geo.js';
import * as mt from '../../services/maintenance.js';
import * as al from '../../services/alerts.js';
import { isReadOnly } from '../../services/access.js';
import { dwellText } from '../../domain/alerts/alerts.js';
import { TIPOS, tipoDesc } from '../../config/reference.js';

const TYPE_SHORT = { chasis: 'Chasis', jaula: 'Jaula', tolva: 'Tolva' };
const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;
const dt = (ts) => (ts ? new Date(ts).toLocaleString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

/* ===== Piezas visuales compartidas (Logística, Inicio y detalle) ===== */
export const statusChip = (key, cls = '') => { const s = statusOf(key); return `<span class="lg-st lg-t-${s.tone} ${cls}"><i aria-hidden="true"></i>${esc(s.label)}</span>`; };
/* Tipo de remolque con su ícono (full = nombre completo «Chasis portacontenedor») */
export function trailerType(type, { full = false, cls = '' } = {}) {
  if (!type) return `<span class="lg-tt none ${cls}">${icon.trailer}<span>Sin clasificar</span></span>`;
  return `<span class="lg-tt ${cls}">${trailerIcon(type)}<span>${esc(full ? trailerTypeLabel(type) : TYPE_SHORT[type] || trailerTypeLabel(type))}</span></span>`;
}
const routeTxt = (o) => (o && (o.origin || o.destination) ? `${o.origin || '—'} → ${o.destination || '—'}` : '');
const unitHref = (vehicleId) => `#/operacion/logistica/u/${encodeURIComponent(vehicleId)}`;
/* Disponibilidad del equipo (Taller): independiente del estado del viaje */
const inShop = (type, id) => !!id && mt.availability((type === 'vehicle' ? 'v:' : 't:') + id).inShop;
const shopTag = (type, id) => (inShop(type, id) ? `<span class="mt-av">${icon.wrench}En taller</span>` : '');

/* Tarjeta compacta del tablero: 1) qué unidad, 2) qué hace, 3) quién la opera, 4) a dónde va */
function boardCard(e) {
  const v = lg.entryView(e), o = e.op, s = statusOf(e.status);
  const ref = [o.reference ? `Ref. ${esc(o.reference)}` : '', o.deliveryPlace ? esc(o.deliveryPlace) : ''].filter(Boolean).join('<span class="dot">·</span>');
  return `<a class="lg-card lg-t-${s.tone}" href="${unitHref(e.unit.id)}">
    <div class="lg-c1"><span class="unit-badge">${esc(v.label)}</span>${statusChip(e.status)}${shopTag('vehicle', e.unit.id)}<span class="chev">${icon.chev}</span></div>
    <div class="lg-op">${v.operator ? esc(v.operator) : '<span class="muted">Sin operador</span>'}</div>
    <div class="lg-meta">${o.division ? `<span>${esc(divisionLabel(o.division, true))}</span><span class="dot">·</span>` : ''}${v.trailer ? `${trailerType(v.trailerType)}<span class="dot">·</span><span>${esc(v.trailer)}</span>${shopTag('trailer', o.trailerId)}` : '<span class="muted">Sin remolque</span>'}</div>
    ${routeTxt(o) ? `<div class="lg-route">${esc(o.origin || '—')}<span class="arr" aria-label="a">→</span>${esc(o.destination || '—')}</div>` : ''}
    ${ref ? `<div class="lg-ref">${ref}</div>` : ''}
  </a>`;
}

/* Unidad sin operación abierta: mosaico compacto (número económico y placas) */
const idleTile = (e) => { const v = lg.entryView(e), sh = inShop('vehicle', e.unit.id); return `<a class="lg-idle" href="${unitHref(e.unit.id)}" aria-label="${esc(`${v.label}, sin operación activa${sh ? ', en taller' : ''}`)}"><b>${esc(v.label)}</b><small>${esc(sh ? 'En taller' : v.placas || 'Sin placas')}</small></a>`; };

/* ===== Tablero ===== */
export async function logisticsScreen() {
  await lg.loadLogistics();
  await mt.loadMaintenance();
  const f = { status: 'all', division: 'all', type: 'all', text: '' };
  let showIdle = 12;
  const s = screen(`<div class="page wide lg-page">
    <header class="nav-top"><button type="button" class="nav-back" data-back>${icon.back}<span>Operación</span></button>
      <a class="btn-ghost sm" href="#/operacion/logistica/historial">${icon.clock}<span>Historial</span></a></header>
    <h1 class="title">Logística</h1>
    <p class="page-lead">Estado y asignación actual de las unidades.</p>
    <button type="button" class="btn-primary block lg lg-new" data-new>${icon.plus}<span>Nueva asignación</span></button>
    <div class="lg-entries"><a class="mon-entry" href="#/operacion/logistica/monitoreo"><span class="mod-ic">${icon.map}</span><span class="mon-entry-tx"><b>Monitoreo GPS</b><small>Mapa de la flota en tiempo real y rastreo para clientes</small><span class="mon-entry-n" data-monn></span></span><span class="chev">${icon.chev}</span></a>
    <a class="ec-entry" href="#/operacion/logistica/vacios"><span class="mod-ic">${icon.yard}</span><span class="ec-entry-tx"><b>Control de vacíos</b><small>Seguimiento y entrega de contenedores vacíos</small><span class="ec-entry-n" data-ecn></span></span><span class="chev">${icon.chev}</span></a>
    <a class="fc-entry" href="#/operacion/logistica/llenos"><span class="mod-ic">${icon.calendar}</span><span class="ec-entry-tx"><b>Control de llenos</b><small>Programación de cargas y gestión documental de contenedores</small><span class="ec-entry-n" data-fcn></span></span><span class="chev">${icon.chev}</span></a></div>
    <label class="search"><span class="search-ic">${icon.search}</span><input type="search" class="search-in" placeholder="Unidad, placas, operador, referencia, lugar…" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search" aria-label="Buscar en Logística"></label>
    <div class="chips filters lg-stf" data-stf role="group" aria-label="Filtrar por estado"></div>
    <div class="chips filters lg-f2" role="group" aria-label="Filtrar por división y tipo de remolque">
      ${[['all', 'Todas'], ...LOGISTICS_DIVISIONS.map(([k, , sh]) => [k, sh])].map(([k, l]) => `<button type="button" class="chip" data-div="${k}">${esc(l)}</button>`).join('')}
      <span class="lg-sep" aria-hidden="true"></span>
      ${[['all', 'Todos'], ...TRAILER_TYPES].map(([k, l]) => `<button type="button" class="chip" data-tt="${k}">${k === 'all' ? '' : trailerIcon(k)}${esc(k === 'all' ? 'Todos los remolques' : l)}</button>`).join('')}
    </div>
    <div data-list aria-live="polite"></div>
  </div>`);
  const root = s.el, listEl = root.querySelector('[data-list]'), stf = root.querySelector('[data-stf]');
  await ec.loadEmpties();
  await fc.loadFulls();
  function drawEc() {
    const open = ec.openList(), late = open.filter((r) => isOverdue(r)).length;
    root.querySelector('[data-ecn]').innerHTML = `<span class="ec-pend${open.length ? ' on' : ''}">Vacíos pendientes: <b>${open.length}</b></span>${late ? `<span class="ec-late">${icon.alert}${late} vencida${late === 1 ? '' : 's'}</span>` : ''}`;
    const fs = fullsSummary(fc.all(), fc.docsOf);
    root.querySelector('[data-fcn]').innerHTML = `<span class="ec-pend${fs.today ? ' on' : ''}">Cargas hoy: <b>${fs.today}</b></span><span>Esta semana: <b>${fs.week}</b></span>${fs.docsPending ? `<span class="ec-late">${icon.alert}${fs.docsPending} sin documentación</span>` : ''}`;
  }
  function drawMon() {
    const n = gps.configured() ? lg.units().filter((u) => gps.imeiOf(u.id)).length : 0;
    root.querySelector('[data-monn]').innerHTML = gps.configured() ? `<span>Unidades con GPS: <b>${n}</b></span>` : '<span>GPS sin configurar</span>';
  }
  function draw() {
    drawEc(); drawMon();
    const entries = lg.fleetBoard(), counts = countByStatus(entries);
    /* Celular: división y tipo de remolque van en la hoja «Filtros» (primer chip, siempre visible); en computadora se
       muestran como segunda fila */
    const extra = (f.division !== 'all') + (f.type !== 'all');
    stf.innerHTML = `<button type="button" class="chip lg-moref${extra ? ' on' : ''}" data-moref aria-haspopup="dialog">${icon.filter}<span>Filtros${extra ? ` · ${extra}` : ''}</span></button>`
      + [['all', 'Todos', null], ...STATUS_ORDER.map((x) => [x.key, x.label, x.tone])].map(([k, l, tone]) =>
      `<button type="button" class="chip lg-fchip${f.status === k ? ' on' : ''}" data-st="${k}" aria-pressed="${f.status === k}">${tone ? `<i class="lg-dot lg-t-${tone}" aria-hidden="true"></i>` : ''}${esc(l)}<b>${counts[k] || 0}</b></button>`).join('');
    root.querySelectorAll('[data-div]').forEach((b) => { b.classList.toggle('on', b.dataset.div === f.division); b.setAttribute('aria-pressed', b.dataset.div === f.division); });
    root.querySelectorAll('[data-tt]').forEach((b) => { b.classList.toggle('on', b.dataset.tt === f.type); b.setAttribute('aria-pressed', b.dataset.tt === f.type); });
    if (!entries.length) { listEl.innerHTML = '<div class="empty"><p>No hay unidades en el catálogo. Agrégalas en Administración → Catálogos → Unidades.</p></div>'; return; }
    const res = filterEntries(entries, f, lg.entryView), groups = groupByStatus(res);
    listEl.innerHTML = groups.length ? groups.map((g) => {
      const withOp = g.items.filter((e) => e.op), idle = g.items.filter((e) => !e.op), tiles = idle.slice(0, showIdle);
      return `<section class="lg-group"><div class="sec-hrow"><h2 class="sec-h">${statusChip(g.status.key, 'plain')}</h2><span class="count">${g.items.length}</span></div>
        ${withOp.length ? `<div class="lg-cards">${withOp.map(boardCard).join('')}</div>` : ''}
        ${idle.length ? `<p class="lg-idle-h">Sin operación activa</p><div class="lg-idles">${tiles.map(idleTile).join('')}</div>` : ''}
        ${idle.length > tiles.length ? `<button type="button" class="btn-ghost block" data-more>Mostrar todas (${idle.length - tiles.length} más)</button>` : ''}</section>`;
    }).join('') : `<div class="empty"><p>${f.text ? 'Sin coincidencias.' : 'No hay unidades con estos filtros.'}</p></div>`;
  }
  on(root, 'click', '[data-back]', () => back('/operacion'));
  on(root, 'click', '[data-new]', () => openOperationForm({}));
  on(root, 'click', '[data-st]', (e, b) => { f.status = b.dataset.st; draw(); });
  on(root, 'click', '[data-div]', (e, b) => { f.division = b.dataset.div; draw(); });
  on(root, 'click', '[data-tt]', (e, b) => { f.type = b.dataset.tt; draw(); });
  on(root, 'click', '[data-moref]', () => openMoreFilters());
  on(root, 'click', '[data-more]', () => { showIdle = Infinity; draw(); });
  /* Hoja «Filtros» (celular): los mismos chips de división y tipo de remolque; cada toque filtra al momento */
  function openMoreFilters() {
    const body = document.createElement('div');
    body.className = 'lg-fsheet';
    const paint = () => {
      body.innerHTML = `<p class="fl">División</p><div class="chips">${[['all', 'Todas'], ...LOGISTICS_DIVISIONS.map(([k, , sh]) => [k, sh])].map(([k, l]) => `<button type="button" class="chip${f.division === k ? ' on' : ''}" data-fdiv="${k}" aria-pressed="${f.division === k}">${esc(l)}</button>`).join('')}</div>
        <p class="fl">Tipo de remolque</p><div class="chips">${[['all', 'Todos'], ...TRAILER_TYPES].map(([k, l]) => `<button type="button" class="chip${f.type === k ? ' on' : ''}" data-ftt="${k}" aria-pressed="${f.type === k}">${k === 'all' ? '' : trailerIcon(k)}${esc(k === 'all' ? 'Todos los remolques' : l)}</button>`).join('')}</div>
        <div class="form-foot"><button type="button" class="btn-secondary" data-freset${f.division === 'all' && f.type === 'all' ? ' disabled' : ''}>Quitar filtros</button><button type="button" class="btn-primary" data-fdone>Ver unidades</button></div>`;
    };
    paint();
    const sh = openSheet({ title: 'Filtros', body });
    body.addEventListener('click', (e) => {
      const d = e.target.closest('[data-fdiv]'), t = e.target.closest('[data-ftt]');
      if (d) f.division = d.dataset.fdiv;
      else if (t) f.type = t.dataset.ftt;
      else if (e.target.closest('[data-freset]')) { f.division = 'all'; f.type = 'all'; }
      else if (e.target.closest('[data-fdone]')) { sh.close(); return; }
      else return;
      paint(); draw();
    });
  }
  root.querySelector('.search-in').addEventListener('input', (e) => { f.text = e.target.value; draw(); });
  draw();
  const u1 = lg.onLogisticsChange(draw), u2 = ec.onEmptiesChange(drawEc), u3 = fc.onFullsChange(drawEc);
  s.cleanup = () => { u1(); u2(); u3(); };
  return s;
}

/* ===== Historial general ===== */
export async function logisticsHistoryScreen() {
  await lg.loadLogistics();
  let text = '', shown = 30;
  const s = screen(`<div class="page lg-page">
    <header class="nav-top"><button type="button" class="nav-back" data-back>${icon.back}<span>Logística</span></button></header>
    <h1 class="title">Historial de operaciones</h1>
    <p class="page-lead">Operaciones cerradas de todas las unidades, de la más reciente a la más antigua.</p>
    <label class="search"><span class="search-ic">${icon.search}</span><input type="search" class="search-in" placeholder="Unidad, operador, referencia, lugar…" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search"></label>
    <div data-list></div></div>`);
  const root = s.el, listEl = root.querySelector('[data-list]');
  function draw() {
    const rows = lg.all().filter((o) => o.closedAt).sort((a, b) => b.closedAt - a.closedAt)
      .filter((o) => !text || filterEntries([{ op: o, status: o.status }], { text }, (e) => lg.view(e.op)).length);
    listEl.innerHTML = rows.length ? `<div class="list">${rows.slice(0, shown).map((o) => histRow(o, true)).join('')}</div>${rows.length > shown ? `<button type="button" class="btn-ghost block" data-more>Mostrar más (${rows.length - shown})</button>` : ''}`
      : `<div class="empty"><p>${text ? 'Sin coincidencias.' : 'Aún no hay operaciones cerradas. Al cerrar una operación queda registrada aquí.'}</p></div>`;
  }
  on(root, 'click', '[data-back]', () => back('/operacion/logistica'));
  on(root, 'click', '[data-more]', () => { shown += 30; draw(); });
  on(root, 'click', '[data-hist]', (e, b) => openHistoryDetail(b.dataset.hist));
  root.querySelector('.search-in').addEventListener('input', (e) => { text = e.target.value; draw(); });
  draw();
  s.cleanup = lg.onLogisticsChange(draw);
  return s;
}
function histRow(o, withUnit = false) {
  const v = lg.view(o);
  return `<button type="button" class="row lg-hrow" data-hist="${esc(o.id)}">
    ${withUnit ? `<span class="unit-badge">${esc(v.label)}</span>` : ''}
    <span class="row-tx"><span class="row-l1"><b>${esc(routeTxt(o) || 'Sin ruta registrada')}</b></span>
      <span class="row-l2">${[v.operator, v.trailer ? `${TYPE_SHORT[v.trailerType] || 'Remolque'} ${v.trailer}` : '', o.division ? divisionLabel(o.division, true) : ''].filter(Boolean).map(esc).join(' · ') || '—'}</span>
      <span class="row-l3">${esc(fmtDate(isoDay(o.startedAt)))} → ${esc(fmtDate(isoDay(o.closedAt)))}${o.reference ? ` · Ref. ${esc(o.reference)}` : ''}</span></span>
    <span class="chev">${icon.chev}</span></button>`;
}
const isoDay = (ts) => { const d = new Date(ts), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

/* ===== Detalle de la unidad ===== */
export async function logisticsUnitScreen({ id }) {
  await lg.loadLogistics();
  await mt.loadMaintenance();
  if (!lg.unitById(id)) { toast('Esa unidad ya no está en el catálogo.', { type: 'info' }); go('/operacion/logistica', { replace: true }); return null; }
  const s = screen('<div class="page lg-page lg-detail"></div>');
  const root = s.el;
  const gpsPanel = createGpsPanel({ vehicleId: id, label: (lg.unitById(id) || {}).label || '', status: () => { const op = lg.openOf(id), st2 = statusOf(op ? op.status : 'inactive'); return { key: st2.key, tone: st2.tone, chip: statusChip(st2.key, 'lg-big') }; },
    target: () => targetOf(lg.openOf(id)) });
  function draw() {
    const u = lg.unitById(id);
    if (!u) { go('/operacion/logistica', { replace: true }); return; }
    const op = lg.openOf(id), v = lg.view(op, u), hist = lg.historyOfUnit(id), st = statusOf(op ? op.status : 'inactive'), y = window.scrollY;
    const trip = op ? lg.tripById(op.tripId) : null, xref = op ? dossierRef(op) : {};
    const empties = [...new Map([...ec.openForVehicle(id), ...(op ? ec.openForOperation(op.id) : [])].map((r) => [r.id, r])).values()];
    root.innerHTML = `
      <header class="nav-top"><button type="button" class="nav-back" data-back>${icon.back}<span>Logística</span></button>
        ${op ? `<button type="button" class="nav-act" data-edit aria-label="Editar operación">${icon.edit}</button>` : ''}</header>
      <div class="unit-head"><span class="unit-badge lg">${esc(v.label)}</span><div><h1>${esc(u.placas || 'Sin placas')}</h1><p>${[u.companyShort, u.desc].filter(Boolean).map(esc).join(' · ') || 'Unidad'}</p></div></div>
      <section class="lg-hero lg-t-${st.tone}">
        <div class="lg-hero-top"><small>Estado de viaje</small>${statusChip(st.key, 'lg-big')}</div>
        ${(() => { const av = mt.availability('v:' + id); return `<p class="lg-hero-sub">Disponibilidad: ${av.inShop ? `<b>En taller</b> · <a class="link" href="#/operacion/taller/orden/${esc(av.order.id)}">${esc(av.order.folio)}</a>` : 'Disponible'} · <a class="link" href="#/operacion/taller/equipo/u/${esc(id)}">Historial de mantenimiento</a></p>`; })()}
        <p class="lg-hero-sub">${op ? `${esc(st.hint)} · actualizado ${esc(agoText(op.updatedAt))}` : 'Sin operación activa. La unidad se considera Inactiva hasta que se le asigne una operación.'}</p>
        ${op ? `<button type="button" class="btn-primary block lg" data-status>${icon.refresh}<span>Actualizar estado</span></button>`
    : `<button type="button" class="btn-primary block lg" data-new>${icon.plus}<span>Nueva asignación</span></button>`}
        ${empties.map((r) => `<a class="btn-secondary block ec-link" href="#/operacion/logistica/vacios/${esc(r.id)}">${icon.yard}<span>Ver control de vacío<small>${esc(r.containerNumber)} · ${esc(emptyLabel(r))}</small></span></a>`).join('')}
      </section>
      ${op ? `
      <section class="grp"><div class="grp-h"><h3>Operador</h3></div>
        <div class="lg-opr">${v.operatorRec ? avatar(v.operatorRec, 'lg') : `<span class="av lg">${icon.person}</span>`}
          <div><b>${v.operator ? esc(v.operator) : '<span class="muted">Sin operador asignado</span>'}</b>${v.operatorRec ? `<small>${esc(v.operatorRec.companyShort || '')}</small>` : ''}</div>
          ${v.operatorRec ? `<a class="btn-ghost sm" href="#/operadores/${esc(v.operatorRec.id)}">Ver ficha</a>` : ''}</div></section>
      <section class="grp"><div class="grp-h"><h3>Operación</h3></div>
        <dl class="sumlist lg-sum">
          <div><dt>División</dt><dd>${o2(divisionLabel(op.division))}</dd></div>
          <div><dt>Remolque</dt><dd>${v.trailer ? `<b>${esc(v.trailer)}</b>${v.trailerDesc ? `<small>${esc(v.trailerDesc)}</small>` : ''}` : '<i>Sin remolque</i>'}</dd></div>
          <div><dt>Tipo</dt><dd>${v.trailer ? trailerType(v.trailerType, { full: true }) : '<i>—</i>'}</dd></div>
        </dl></section>
      <section class="grp"><div class="grp-h"><h3>Ruta</h3></div>
        <dl class="sumlist lg-sum">
          <div><dt>Origen</dt><dd>${o2(op.origin)}</dd></div>
          <div><dt>Destino</dt><dd>${o2(op.destination)}</dd></div>
          <div><dt>Lugar de entrega</dt><dd>${o2(op.deliveryPlace)}</dd></div>
          <div><dt>Referencia</dt><dd>${op.reference ? `<span class="mono">${esc(op.reference)}</span>${op.referenceSource ? `<small>Tomada ${op.referenceSource === 'trip' ? 'del viaje relacionado' : 'del documento relacionado'}</small>` : ''}` : '<i>—</i>'}</dd></div>
          ${op.containerType ? `<div><dt>Tipo de contenedor</dt><dd>${esc(tipoDesc(op.containerType) || op.containerType)}<small class="mono">${esc(op.containerType)}</small></dd></div>` : ''}
          ${trip ? `<div><dt>Viaje</dt><dd>${esc(fmtDate(trip.date))} · ${esc(routeTxt(trip))}</dd></div>` : ''}
          ${xref.docId ? `<div><dt>Documento</dt><dd><a href="#/doc/${esc(xref.docId)}${xref.trip && xref.extra ? `?expediente=${esc(xref.trip.id)}` : ''}">Ver documento relacionado</a>${xref.extra ? `<small>Expediente consolidado: documento + ${xref.extra} adicional${xref.extra === 1 ? '' : 'es'}</small>` : ''}</dd></div>`
    : xref.trip && xref.extra ? `<div><dt>Expediente</dt><dd><button type="button" class="lg-linkbtn" data-xp>Ver expediente del viaje</button><small>${xref.extra} documento${xref.extra === 1 ? '' : 's'} adicional${xref.extra === 1 ? '' : 'es'}; sin documento principal</small></dd></div>` : ''}
        </dl></section>
      ${geoHTML(op)}
      <div data-gps-slot></div>
      <div class="sheet-acts lg-acts"><button type="button" class="btn-secondary" data-edit>${icon.edit}<span>Editar operación</span></button><button type="button" class="btn-secondary" data-finish>${icon.check}<span>Terminar operación</span></button></div>
      ${(op.statusLog || []).length > 1 ? `<section class="grp"><div class="grp-h"><h3>Bitácora de estados</h3></div><ol class="lg-log">${[...op.statusLog].reverse().slice(0, 8).map((x) => `<li>${statusChip(x.status, 'plain')}<small>${esc(dt(x.at))}${x.by === 'Geocerca' ? ' · automático por geocerca' : ''}</small></li>`).join('')}</ol></section>` : ''}
      <p class="grp-note">Inicio de la operación: ${esc(dt(op.startedAt))}${op.createdBy ? ' por ' + esc(op.createdBy) : ''} · Última actualización: ${esc(dt(op.updatedAt))}${op.updatedBy ? ' por ' + esc(op.updatedBy) : ''}</p>` : ''}
      <div class="sec-hrow lg-hh"><h2 class="sec-h">Historial de la unidad</h2>${hist.length ? `<span class="count">${hist.length}</span>` : ''}</div>
      ${hist.length ? `<div class="list">${hist.slice(0, 20).map((o) => histRow(o)).join('')}</div>` : '<div class="empty"><p>Sin operaciones anteriores. Al cerrar una operación queda registrada aquí.</p></div>'}`;
    hydrateAvatars(root);
    /* Ubicación GPS: el panel (con su mapa) se conserva entre redibujos; para unidades sin operación va al final */
    const slot = root.querySelector('[data-gps-slot]') || root.appendChild(document.createElement('div'));
    slot.replaceWith(gpsPanel.el); gpsPanel.refresh(); gpsPanel.resize();
    window.scrollTo(0, y);
  }
  const o2 = (x) => (x ? esc(x) : '<i>—</i>');
  on(root, 'click', '[data-back]', () => back('/operacion/logistica'));
  on(root, 'click', '[data-new]', () => openOperationForm({ vehicleId: id }));
  on(root, 'click', '[data-edit]', () => { const op = lg.openOf(id); if (op) openOperationForm({ op }); });
  on(root, 'click', '[data-status]', () => { const op = lg.openOf(id); if (op) openStatusSheet(op); });
  on(root, 'click', '[data-finish]', () => { const op = lg.openOf(id); if (op) finishOperation(op); });
  on(root, 'click', '[data-hist]', (e, b) => openHistoryDetail(b.dataset.hist));
  on(root, 'click', '[data-xp]', () => { const op = lg.openOf(id), r = op && dossierRef(op); if (r && r.trip) generateDossier(r.trip); });
  on(root, 'click', '[data-geoapply]', async () => {
    const op = lg.openOf(id), sug = op && al.suggestionForOp(op);
    if (!sug) return;
    try { await al.applySuggestion(op, sug); toast(`${lg.view(op).label}: ${statusLabel(sug.status)}`); } catch (err) { toast(err.message || 'No se pudo cambiar el estado.', { type: 'warn' }); }
  });
  on(root, 'click', '[data-geodismiss]', (e, b) => al.dismiss(b.dataset.geodismiss));
  await ec.loadEmpties();
  await al.loadAlerts();
  draw();
  const u1 = lg.onLogisticsChange(draw), u2 = ec.onEmptiesChange(draw), u3 = al.onAlertsChange(draw);
  s.cleanup = () => { u1(); u2(); u3(); gpsPanel.destroy(); };
  return s;
}
const emptyLabel = (r) => (isOverdue(r) ? 'Entrega vencida' : emptyStatusOf(r.status).label);

/* Llegadas y salidas del viaje (geocercas) con el tiempo en cada lugar, y la sugerencia de cambio de estado */
function geoHTML(op) {
  if (!op || !gps.configured() || !gps.imeiOf(op.vehicleId)) return '';
  const sug = al.suggestionForOp(op), stays = al.staysForOp(op), p2 = (n) => String(n).padStart(2, '0');
  const hm = (ms) => { const d = new Date(ms); return `${relDay(ms).startsWith('Hoy') ? '' : `${d.getDate()}/${p2(d.getMonth() + 1)} `}${p2(d.getHours())}:${p2(d.getMinutes())}`; };
  if (!sug && !stays.length) return '';
  return `${sug ? `<div class="al-sugbox" role="status">${icon.flag}<div><b>${esc(sug.text)}</b><small>${esc(sug.event.name)} · ${esc(hm(sug.event.at))}. ¿Cambiar el estado a ${esc(statusLabel(sug.status))}?</small>
      ${isReadOnly() ? '' : `<span class="al-sug"><button type="button" class="btn-primary sm" data-geoapply>Cambiar a ${esc(statusLabel(sug.status))}</button><button type="button" class="btn-ghost sm" data-geodismiss="${esc(sug.event.id)}">Ahora no</button></span>`}</div></div>` : ''}
    ${stays.length ? `<section class="grp"><div class="grp-h"><h3>Llegadas y salidas</h3><a class="link" href="#/avisos">Avisos</a></div>
      <ol class="al-stays">${stays.slice(0, 8).map((x) => `<li class="${x.open ? 'open' : ''}"><b>${esc(x.name)}</b><span>Llegó ${esc(hm(x.from))}${x.to ? ` · salió ${esc(hm(x.to))}` : ' · sigue en el lugar'}</span><small>${x.open ? 'Lleva ' : ''}${esc(dwellText(x.dwell))} en el lugar</small></li>`).join('')}</ol></section>` : ''}`;
}

/* ===== Cambio rápido de estado (hoja inferior) ===== */
export function openStatusSheet(op) {
  const v = lg.view(op);
  const body = `<p class="sheet-lead">${esc(v.label)}${v.operator ? ' · ' + esc(v.operator) : ''}${routeTxt(op) ? ' · ' + esc(routeTxt(op)) : ''}</p>
    <div class="lg-stlist" role="radiogroup" aria-label="Estado">${LOGISTICS_STATUSES.map((x) => `<button type="button" class="lg-stopt lg-t-${x.tone}${x.key === op.status ? ' on' : ''}" role="radio" aria-checked="${x.key === op.status}" data-set="${x.key}">
      <i class="lg-dot" aria-hidden="true"></i><span class="lg-stx"><b>${esc(x.label)}</b><small>${esc(x.hint)}</small></span>${x.key === op.status ? `<span class="pk-check">${icon.check}</span>` : ''}</button>`).join('')}</div>`;
  const sh = openSheet({ title: 'Actualizar estado', body, className: 'lg-stsheet' });
  sh.body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-set]'); if (!b) return;
    const k = b.dataset.set;
    if (k === op.status) { sh.close(); return; }
    try {
      if (statusOf(k).closable) {
        const r = await actionSheet({ title: `¿Cerrar la operación de ${v.label}?`, message: 'Al cerrarla queda en el historial y la unidad se queda sin asignación.',
          actions: [{ label: 'Cerrar operación', value: 'close', style: 'primary', sub: 'Pasa al historial' }, { label: 'Solo marcar Inactiva', value: 'mark', sub: 'Conserva operador, remolque y ruta' }] });
        if (!r) return;
        sh.close();
        if (r === 'close') { await lg.closeOperation(op.id); toast(`${v.label}: operación cerrada y guardada en el historial`); return; }
      } else sh.close();
      await lg.setStatus(op.id, k);
      const er = lg.takeEmptyResult();
      if (er) notifyEmptyResult(er, { vehicleId: op.vehicleId, operationId: op.id }); else toast(`${v.label}: ${statusLabel(k)}`);
    } catch (err) { toast(err.message || 'No se pudo actualizar el estado.', { type: 'warn' }); }
  });
}

/* Terminar operación: la unidad queda Vacía (sigue asignada) o Inactiva (se cierra y pasa al historial) */
async function finishOperation(op) {
  const v = lg.view(op);
  const r = await actionSheet({ title: `Terminar la operación de ${v.label}`, message: '¿Cómo queda la unidad?',
    actions: [{ label: 'Vacío', value: 'empty', sub: 'Sigue asignada, sin carga. No aparece en Inicio.' }, { label: 'Inactiva', value: 'close', style: 'primary', sub: 'Se cierra la operación y pasa al historial' }] });
  try {
    if (r === 'empty') { await lg.setStatus(op.id, 'empty'); const er = lg.takeEmptyResult(); if (er) notifyEmptyResult(er, { vehicleId: op.vehicleId, operationId: op.id }); else toast(`${v.label}: Vacío`); }
    if (r === 'close') { await lg.closeOperation(op.id); toast(`${v.label}: operación cerrada y guardada en el historial`); }
  } catch (err) { toast(err.message || 'No se pudo terminar la operación.', { type: 'warn' }); }
}

/* Detalle de una operación del historial (consulta; permite corregir datos) */
function openHistoryDetail(id) {
  const op = lg.opById(id); if (!op) return;
  const v = lg.view(op), row = (l, x) => `<div><dt>${l}</dt><dd>${x}</dd></div>`, t = (x) => (x ? esc(x) : '<i>—</i>');
  const sh = openSheet({ title: `${v.label} · Operación cerrada`, full: true, body: `<dl class="sumlist lg-sum">
      ${row('Unidad', `<b>${esc(v.label)}</b>${v.placas ? `<small>${esc(v.placas)}</small>` : ''}`)}
      ${row('Operador', t(v.operator))}${row('División', t(divisionLabel(op.division)))}
      ${row('Remolque', v.trailer ? `${esc(v.trailer)}` : '<i>—</i>')}${row('Tipo', v.trailer ? trailerType(v.trailerType, { full: true }) : '<i>—</i>')}
      ${row('Último estado', statusChip(op.lastStatus || op.status, 'plain'))}
      ${row('Origen', t(op.origin))}${row('Destino', t(op.destination))}${row('Lugar de entrega', t(op.deliveryPlace))}${row('Referencia', op.reference ? `<span class="mono">${esc(op.reference)}</span>` : '<i>—</i>')}${op.containerType ? row('Tipo de contenedor', esc(tipoDesc(op.containerType) || op.containerType)) : ''}
      ${row('Inicio', esc(dt(op.startedAt)))}${row('Última actualización', esc(dt(op.updatedAt)))}${row('Cierre', esc(dt(op.closedAt)))}
    </dl>
    <div class="sheet-acts col"><button type="button" class="btn-secondary" data-hedit>${icon.edit}<span>Corregir datos</span></button></div>` });
  sh.body.querySelector('[data-hedit]').addEventListener('click', () => { sh.close(); openOperationForm({ op }); });
}

/* ===== Formulario: nueva asignación / editar operación ===== */
export function openOperationForm({ op = null, vehicleId = null, onSaved = null } = {}) {
  const editing = !!op, closed = editing && !!op.closedAt;
  const st = {
    vehicleId: editing ? op.vehicleId : vehicleId, operatorId: editing ? op.operatorId : null, trailerId: editing ? op.trailerId : null,
    division: editing ? op.division : '', status: editing ? op.status : NEW_STATUS,
    tripId: editing ? op.tripId : null, documentId: editing ? op.documentId : null, referenceSource: editing ? op.referenceSource || '' : '',
  };
  let divTouched = editing && !!op.division;
  const sug = lg.placeSuggestions();
  const form = document.createElement('form');
  form.className = 'op-form lg-form'; form.noValidate = true;
  const pick = (k, label, extra = '') => `<div class="fld" data-f="${k}"><span class="fl">${label}</span><div class="lg-pickrow"><button type="button" class="in pick" data-pk="${k}"><span class="pv"></span><span class="pick-ic">${icon.chev}</span></button>${extra}</div><span class="fhint warn-t" data-warn="${k}"></span><span class="ferr" data-err="${k}"></span></div>`;
  const txt = (k, label, ph, hint = '', cap = 'words') => `<div class="fld" data-f="${k}"><span class="fl">${label}</span><input class="in" name="${k}" value="${esc(editing ? op[k] || '' : '')}" autocomplete="off" autocapitalize="${cap}" ${cap === 'characters' ? 'spellcheck="false" autocorrect="off"' : ''} placeholder="${esc(ph)}" maxlength="80" enterkeyhint="next">${hint ? `<span class="fhint" data-hint="${k}">${hint}</span>` : ''}<span class="sugg" data-sugg="${k}"></span><span class="ferr" data-err="${k}"></span></div>`;
  const routes = suggestedRoutes();
  form.innerHTML = `
    <h3 class="lg-fh">Asignación</h3>
    ${pick('unit', 'Unidad')}
    ${pick('operator', 'Operador', '<button type="button" class="icon-btn" data-clear="operator" aria-label="Quitar operador">' + icon.close + '</button>')}
    ${pick('trailer', 'Remolque', '<button type="button" class="icon-btn" data-clear="trailer" aria-label="Quitar remolque">' + icon.close + '</button>')}
    <div class="lg-typebox" data-typebox></div>
    <div class="fld" data-f="division"><span class="fl">División</span><div class="seg big">${LOGISTICS_DIVISIONS.map(([k, l]) => `<button type="button" class="seg-b" data-dv="${k}">${esc(l)}</button>`).join('')}</div><span class="fhint" data-divhint></span><span class="ferr" data-err="division"></span></div>
    ${closed ? '' : `<div class="fld" data-f="status"><span class="fl">Estado</span><div class="lg-stgrid" role="radiogroup" aria-label="Estado">${LOGISTICS_STATUSES.map((x) => `<button type="button" class="lg-stopt sm lg-t-${x.tone}" role="radio" data-sv="${x.key}"><i class="lg-dot" aria-hidden="true"></i><span class="lg-stx"><b>${esc(x.label)}</b></span></button>`).join('')}</div></div>`}
    <h3 class="lg-fh">Ruta y entrega</h3>
    ${routes.length ? `<div class="fld"><span class="fl">Rutas usadas</span><div class="chips route-chips">${routes.map((r, i) => `<button type="button" class="chip" data-route="${i}">${esc(r.origin)} → ${esc(r.destination)}</button>`).join('')}</div></div>` : ''}
    ${txt('origin', 'Origen', 'Ej. Manzanillo')}
    ${txt('destination', 'Destino', 'Ej. Guadalajara', 'Ciudad o zona.')}
    ${txt('deliveryPlace', 'Lugar de entrega', 'Ej. CEDIS Guadalajara', 'Nombre específico del sitio donde se entrega (planta, CEDIS, terminal, bodega).')}
    ${txt('reference', 'Referencia', 'Ej. MSCU1234567', 'Número de contenedor, referencia del viaje u otra referencia operativa.', 'characters')}
    <label class="fld" data-f="containerType"><span class="fl">Tipo de contenedor</span><span class="sel-w"><select class="in" name="containerType"><option value="">Sin indicar</option>${TIPOS.map(([c, d]) => `<option value="${c}"${editing && op.containerType === c ? ' selected' : ''}>${c} · ${esc(d)}</option>`).join('')}</select><span class="sel-ic">${icon.down}</span></span><span class="fhint">Opcional. Se muestra al cliente en el enlace de rastreo junto con el número de contenedor.</span></label>
    <h3 class="lg-fh">Relacionar (opcional)</h3>
    ${pick('trip', 'Viaje de operador', '<button type="button" class="icon-btn" data-clear="trip" aria-label="Quitar viaje">' + icon.close + '</button>')}
    ${pick('doc', 'Documento generado', '<button type="button" class="icon-btn" data-clear="doc" aria-label="Quitar documento">' + icon.close + '</button>')}
    <p class="grp-note">Al relacionar un viaje o documento se usa su referencia, ruta y lugar de entrega cuando el campo está vacío.</p>
    <div class="form-foot"><button type="submit" class="btn-primary block lg">${editing ? 'Guardar cambios' : 'Guardar asignación'}</button></div>`;
  const sh = openSheet({ title: closed ? 'Corregir operación' : editing ? 'Editar operación' : 'Nueva asignación', body: form, full: true, className: 'form-sheet' });
  enterAdvances(form);
  let docs = null;
  const docLabel = (d) => (d ? `${d.type === 'puerto' ? 'Nota' : 'Asignación Campo'} ${d.folio}` : '');
  const opsByOp = () => operatorList();

  function setPick(k, value, sub, ph) {
    const b = form.querySelector(`[data-pk="${k}"]`);
    b.classList.toggle('empty', !value);
    b.querySelector('.pv').innerHTML = `<span class="pv-v">${value ? value : esc(ph)}</span>${sub ? `<small>${sub}</small>` : ''}`;
    const c = form.querySelector(`[data-clear="${k}"]`); if (c) c.hidden = !value;
  }
  function warn(k, msg) { const w = form.querySelector(`[data-warn="${k}"]`); if (w) w.textContent = msg || ''; }
  function sync() {
    const u = lg.unitById(st.vehicleId), o = st.operatorId ? lg.operatorById(st.operatorId) : null, t = lg.trailerById(st.trailerId);
    setPick('unit', u ? `<b class="lg-pk-u">${esc(u.label)}</b>` : '', u ? esc([u.placas, u.companyShort].filter(Boolean).join(' · ')) : '', 'Elegir unidad del catálogo');
    setPick('operator', o ? esc(o.name) : '', o ? esc(o.companyShort || '') : '', 'Elegir operador del catálogo');
    setPick('trailer', t ? esc(t.placas) : '', t ? esc([trailerTypeLabel(t.type), t.desc].filter(Boolean).join(' · ')) : '', 'Elegir remolque del catálogo');
    form.querySelector('[data-typebox]').innerHTML = t ? `<span class="fl">Tipo de remolque</span><div class="lg-type">${trailerType(t.type, { full: true })}<small>${t.type ? 'Del catálogo de remolques' : 'Clasifícalo en Administración → Catálogos → Remolques'}</small></div>` : '';
    const c = lg.conflictsFor(st, editing ? op.id : null);
    const unitWarn = closed ? '' : c.unit ? `Esta unidad ya tiene una operación activa (${statusLabel(c.unit.status)}).` : c.unitOpen ? `Tiene una operación abierta en «${statusLabel(c.unitOpen.status)}»: se cerrará y pasará al historial.` : '';
    warn('unit', unitWarn);
    warn('operator', !closed && c.operator ? `Este operador ya aparece en otra operación activa (${lg.view(c.operator).label}).` : '');
    warn('trailer', !closed && c.trailer ? `Este remolque ya se encuentra asignado a otra unidad (${lg.view(c.trailer).label}).` : '');
    form.querySelectorAll('[data-dv]').forEach((b) => { const on2 = b.dataset.dv === st.division; b.classList.toggle('on', on2); b.setAttribute('aria-pressed', on2); });
    const usual = t && TYPE_DIVISION[t.type];
    form.querySelector('[data-divhint]').textContent = usual && st.division && usual !== st.division ? `${trailerTypeLabel(t.type)} normalmente se usa en ${divisionLabel(usual)}. La excepción está permitida.` : '';
    form.querySelectorAll('[data-sv]').forEach((b) => { const on2 = b.dataset.sv === st.status; b.classList.toggle('on', on2); b.setAttribute('aria-checked', on2); });
    const trip = lg.tripById(st.tripId);
    setPick('trip', trip ? esc(`${fmtDate(trip.date)} · ${routeTxt(trip)}`) : '', trip ? esc([trip.reference ? 'Ref. ' + trip.reference : '', trip.division === 'campo' ? 'Campo' : 'Puerto'].filter(Boolean).join(' · ')) : '', 'Elegir viaje');
    const d = docs && st.documentId ? docs.find((x) => x.id === st.documentId) : null;
    setPick('doc', st.documentId ? esc(d ? docLabel(d) : 'Documento relacionado') : '', d ? esc(relDay(d.createdAt)) : '', 'Elegir documento');
  }
  /* Rellena solo campos vacíos (o la referencia si se había tomado automáticamente) */
  function fill(name, value, force = false) {
    const el = form.elements[name]; if (!el || !value) return false;
    if (!el.value.trim() || force) { el.value = value; return true; }
    return false;
  }
  function useReference(value, source) {
    if (!value) return;
    const auto = !!st.referenceSource && form.elements.reference.dataset.auto === form.elements.reference.value;
    if (fill('reference', value, auto)) { st.referenceSource = source; form.elements.reference.dataset.auto = value; }
  }

  form.addEventListener('click', async (e) => {
    const pk = e.target.closest('[data-pk]'), cl = e.target.closest('[data-clear]'), dv = e.target.closest('[data-dv]'), sv = e.target.closest('[data-sv]'), rt = e.target.closest('[data-route]'), sg = e.target.closest('[data-pick-sugg]');
    if (cl) {
      const k = cl.dataset.clear;
      if (k === 'operator') st.operatorId = null; if (k === 'trailer') st.trailerId = null; if (k === 'trip') st.tripId = null; if (k === 'doc') st.documentId = null;
      sync(); return;
    }
    if (dv) { st.division = dv.dataset.dv; divTouched = true; sync(); return; }
    if (sv) { st.status = sv.dataset.sv; sync(); return; }
    if (rt) { const r = routes[+rt.dataset.route]; form.elements.origin.value = r.origin; form.elements.destination.value = r.destination; form.querySelectorAll('.sugg').forEach((x) => { x.innerHTML = ''; }); return; }
    if (sg) { const inp = sg.closest('.fld').querySelector('input'); inp.value = sg.dataset.pickSugg; sg.parentElement.innerHTML = ''; return; }
    if (!pk) return;
    const k = pk.dataset.pk;
    if (k === 'unit') {
      const us = lg.units();
      if (!us.length) { toast('No hay unidades en el catálogo. Agrégalas en Administración → Catálogos → Unidades.', { type: 'info', ms: 4000 }); return; }
      const multi = new Set(us.map((u) => u.company)).size > 1;
      const r = await openPicker({ title: 'Unidad', allowNew: false, placeholder: 'Buscar número económico o placas', inputmode: 'text', autocap: 'characters', current: st.vehicleId || '',
        items: us.map((u) => { const o = lg.openOf(u.id); return { value: u.id, label: u.label, sub: [u.placas, multi ? u.companyShort : '', o ? statusLabel(o.status) : 'Inactiva'].filter(Boolean).join(' · ') }; }) });
      if (r) { st.vehicleId = r.value; sync(); }
    } else if (k === 'operator') {
      const list = opsByOp();
      if (!list.length) { toast('No hay operadores en el catálogo. Agrégalos en Administración → Catálogos → Operadores.', { type: 'info', ms: 4000 }); return; }
      const multi = new Set(list.map((o) => o.company)).size > 1;
      const r = await openPicker({ title: 'Operador', allowNew: false, placeholder: 'Buscar operador', current: st.operatorId || '',
        items: list.map((o) => { const w = lg.openWithOperator(o.id); return { value: o.id, label: o.name, sub: [multi ? o.companyShort : '', w && w.vehicleId !== st.vehicleId ? `En operación con ${lg.view(w).label}` : ''].filter(Boolean).join(' · ') }; }) });
      if (r) { st.operatorId = r.value; sync(); }
    } else if (k === 'trailer') {
      const ts = listAll('trailers');
      if (!ts.length) { toast('No hay remolques en el catálogo. Agrégalos en Administración → Catálogos → Remolques.', { type: 'info', ms: 4000 }); return; }
      const co = (lg.unitById(st.vehicleId) || {}).company;
      const items = ts.map((t) => { const w = lg.openWithTrailer(t.id); return { value: t.id, label: t.placas, type: t.type || '', icon: trailerIcon(t.type), sub: [trailerTypeLabel(t.type), t.desc, co && t.company !== co ? 'Otra empresa' : '', w && w.vehicleId !== st.vehicleId ? `Asignado a ${lg.view(w).label}` : ''].filter(Boolean).join(' · ') }; })
        .sort((a, b) => String(a.label).localeCompare(String(b.label), 'es', { numeric: true }));
      const r = await openPicker({ title: 'Remolque', allowNew: false, placeholder: 'Buscar placas o tipo', autocap: 'characters', current: st.trailerId || '', items, scope: st.division ? trailerScope(st.division) : null });
      if (r) {
        st.trailerId = r.value;
        const t = lg.trailerById(r.value);
        if (t && TYPE_DIVISION[t.type] && !divTouched) st.division = TYPE_DIVISION[t.type];
        sync();
      }
    } else if (k === 'trip') {
      const trips = lg.relatableTrips(st.operatorId);
      if (!trips.length) { toast(st.operatorId ? 'Este operador no tiene viajes registrados en Operadores.' : 'No hay viajes registrados en Operadores.', { type: 'info', ms: 3500 }); return; }
      const names = new Map(opsByOp().map((o) => [o.id, o.name]));
      const r = await openPicker({ title: 'Viaje de operador', allowNew: false, placeholder: 'Buscar ruta o referencia', current: st.tripId || '',
        items: trips.map((t) => ({ value: t.id, label: `${fmtDate(t.date)} · ${routeTxt(t)}`, sub: [t.reference ? 'Ref. ' + t.reference : '', st.operatorId ? '' : names.get(t.operatorId) || '', t.division === 'campo' ? 'Campo' : 'Puerto'].filter(Boolean).join(' · ') })) });
      if (!r) return;
      const t = lg.tripById(r.value); st.tripId = r.value;
      if (t) {
        if (!st.operatorId && t.operatorId) st.operatorId = t.operatorId;
        if (t.documentId && !st.documentId) st.documentId = t.documentId;
        if (!divTouched && t.division) { st.division = t.division; divTouched = true; }
        fill('origin', t.origin); fill('destination', t.destination); useReference(t.reference, 'trip');
      }
      sync();
    } else if (k === 'doc') {
      if (!docs) docs = await listDocuments();
      if (!docs.length) { toast('Aún no hay documentos generados.', { type: 'info' }); return; }
      const r = await openPicker({ title: 'Documento generado', allowNew: false, placeholder: 'Buscar folio, contenedor o destino', current: st.documentId || '',
        items: docs.slice(0, 80).map((d) => { const S = d.summary || {}; return { value: d.id, label: docLabel(d), sub: [relDay(d.createdAt), d.type === 'puerto' ? (S.contenedores || []).join(' / ') : S.unidad, S.destino || S.planta].filter(Boolean).join(' · ') }; }) });
      if (!r) return;
      const d = docs.find((x) => x.id === r.value); st.documentId = r.value;
      if (d) {
        const S = d.summary || {};
        if (!divTouched) { st.division = d.type; divTouched = true; }
        if (d.type === 'puerto') {
          useReference((S.contenedores || []).join(' / '), 'document'); fill('deliveryPlace', S.destino); fill('destination', S.municipio);
          const tp = ((d.data && d.data.conts) || []).map((c) => c.tipo).find((x) => tipoDesc(x));
          if (tp && !form.elements.containerType.value) form.elements.containerType.value = tp;
        }
        else { const pl = (d.data && d.data.planta) || (S.planta ? 'Planta ' + S.planta : ''); fill('deliveryPlace', pl); useReference(d.folio, 'document'); }
      }
      sync();
    }
  });
  /* Sugerencias de texto (valores usados antes; nunca obligatorias) */
  function suggest(name) {
    const box = form.querySelector(`[data-sugg="${name}"]`); if (!box) return;
    const q = form.elements[name].value.trim().toLowerCase();
    const src = sug[name] || [];
    box.innerHTML = src.filter((x) => (!q || x.toLowerCase().includes(q)) && x.toLowerCase() !== q).slice(0, 5).map((x) => `<button type="button" class="chip sm-chip" data-pick-sugg="${esc(x)}">${esc(x)}</button>`).join('');
  }
  form.addEventListener('focusin', (e) => { if (sug[e.target.name]) suggest(e.target.name); });
  form.addEventListener('input', (e) => {
    const t = e.target;
    if (t.name === 'reference') { const c = t.value.toUpperCase(); if (c !== t.value) t.value = c; if (t.dataset.auto !== t.value) st.referenceSource = ''; }
    if (sug[t.name]) suggest(t.name);
    const fl = t.closest('.fld'); if (fl) { fl.classList.remove('has-err'); const m = fl.querySelector('.ferr'); if (m) m.textContent = ''; }
  });
  if (editing && op.referenceSource) form.elements.reference.dataset.auto = op.reference || '';
  sync();
  if (!editing && st.vehicleId == null) setTimeout(() => form.querySelector('[data-pk="unit"]').focus({ preventScroll: true }), 300);

  const fail = (k, msg) => { const fl = form.querySelector(`[data-f="${k}"]`); if (fl) { fl.classList.add('has-err'); const m = fl.querySelector('.ferr'); if (m) m.textContent = msg; fl.scrollIntoView({ block: 'center', behavior: 'smooth' }); } toast(msg, { type: 'warn', ms: 3500 }); };
  let saving = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); if (saving) return;
    if (!st.vehicleId) return fail('unit', 'Elige la unidad del catálogo.');
    if (!st.division) return fail('division', 'Elige la división: Puerto o Campo.');
    if (!closed && isWorking(st.status) && !st.operatorId) return fail('operator', 'Elige el operador: la unidad está en operación.');
    const val = (k) => form.elements[k].value.trim().replace(/\s+/g, ' ');
    const rec = { vehicleId: st.vehicleId, operatorId: st.operatorId || null, trailerId: st.trailerId || null, division: st.division, status: closed ? op.status : st.status,
      origin: val('origin'), destination: val('destination'), deliveryPlace: val('deliveryPlace'), reference: val('reference'), containerType: form.elements.containerType.value || '', referenceSource: st.referenceSource || '', tripId: st.tripId || null, documentId: st.documentId || null };
    if (!closed) {
      const c = lg.conflictsFor(rec, editing ? op.id : null);
      if (c.unit) {
        const cv = lg.view(c.unit);
        const r = await actionSheet({ title: 'Esta unidad ya tiene una operación activa.', message: `${cv.label}: ${statusLabel(c.unit.status)}${cv.operator ? ' · ' + cv.operator : ''}${routeTxt(c.unit) ? ' · ' + routeTxt(c.unit) : ''}`, actions: [{ label: 'Ver operación actual', value: 'view', style: 'primary' }], cancel: 'Cancelar' });
        if (r === 'view') { sh.close(); go(`/operacion/logistica/u/${encodeURIComponent(c.unit.vehicleId)}`); }
        return;
      }
      if (c.unitOpen && (!editing || op.vehicleId !== rec.vehicleId)) {
        const ok = await actionSheet({ title: 'La unidad tiene una operación abierta', message: `Está en «${statusLabel(c.unitOpen.status)}». Al guardar, esa operación se cerrará y pasará al historial.`, actions: [{ label: 'Continuar', value: true, style: 'primary' }], cancel: 'Revisar' });
        if (!ok) return;
      }
      if (c.operator && (!editing || op.operatorId !== rec.operatorId)) {
        const cv = lg.view(c.operator);
        const ok = await actionSheet({ title: 'Este operador ya aparece en otra operación activa.', message: `${cv.operator} · ${cv.label} (${statusLabel(c.operator.status)}).`, actions: [{ label: 'Continuar de todos modos', value: true }], cancel: 'Revisar' });
        if (!ok) return;
      }
      if (c.trailer && (!editing || op.trailerId !== rec.trailerId)) {
        const cv = lg.view(c.trailer);
        const ok = await actionSheet({ title: 'Este remolque ya se encuentra asignado a otra unidad.', message: `${cv.trailer} · ${cv.label} (${statusLabel(c.trailer.status)}).`, actions: [{ label: 'Asignar de todos modos', value: true, style: 'destructive' }], cancel: 'Elegir otro' });
        if (!ok) return;
      }
    }
    saving = true;
    try {
      const out = await lg.saveOperation(editing ? { ...rec, id: op.id } : rec);
      sh.close();
      const er = lg.takeEmptyResult();
      if (er) notifyEmptyResult(er, { vehicleId: out.vehicleId, operationId: out.id });
      else toast(editing ? 'Operación actualizada' : `Asignación guardada · ${lg.view(out).label}: ${statusLabel(out.status)}`);
      if (onSaved) onSaved(out);
    } catch (err) { toast(err.message || 'No se pudo guardar la operación.', { type: 'warn' }); } finally { saving = false; }
  });
}
/* Rutas recientes (Logística y viajes de Operadores) para captura rápida */
function suggestedRoutes() {
  const seen = new Set(), out = [];
  const src = [...lg.all().map((o) => ({ origin: o.origin, destination: o.destination, at: o.updatedAt })), ...lg.relatableTrips(null).map((t) => ({ origin: t.origin, destination: t.destination, at: t.updatedAt }))]
    .filter((r) => r.origin && r.destination).sort((a, b) => (b.at || 0) - (a.at || 0));
  for (const r of src) { const k = `${r.origin.toLowerCase()}\u0000${r.destination.toLowerCase()}`; if (!seen.has(k)) { seen.add(k); out.push(r); } if (out.length >= 8) break; }
  return out;
}

/* ===== Inicio → «Unidades en operación» ===== */
/* Ubicación en la tarjeta de Inicio: dirección o «Ubicación GPS disponible» y su antigüedad (el mapa va encima) */
function gpsLine(vehicleId) {
  const imei = gps.configured() ? gps.imeiOf(vehicleId) : '';
  if (!imei) return '';
  const p = gps.bestOf(imei), f = freshness(p);
  if (f.state === 'none') return `<span class="lgh-loc none">${icon.pin}<span>Ubicación GPS no disponible</span></span>`;
  const place = p.address || 'Ubicación GPS disponible';
  return `<span class="lgh-loc ${f.state}">${icon.pin}<span class="lgh-loc-tx"><b>${esc(place)}</b>${f.state === 'live'
    ? `<small data-gps-ts="${Number(f.since) || 0}" data-gps-prefix="Actualizado ">Actualizado ${esc(ageText(f.since))}</small>` : `<small>${esc(f.label)}</small>`}</span></span>`;
}
/* Lugar del mapa en la tarjeta (solo con GPS vinculado y coordenadas); mountHomeOps coloca ahí el mapa conservado */
function homePos(vehicleId) {
  const imei = gps.configured() ? gps.imeiOf(vehicleId) : '';
  const p = imei ? gps.bestOf(imei) : null;
  return hasFix(p) ? p : null;
}
/* Destino de la ficha: «a 23 km de CEDIS Guadalajara» (solo con posición GPS y destino ubicado) */
function destLine(e) {
  const t = targetOf(e.op), p = homePos(e.unit.id);
  if (!t || !p) return '';
  if (!t.loc) return t.state === 'searching' || t.state === 'missing' ? '' : `<span class="lgh-dest none">${icon.flag}<span>${esc(t.title)}: ${esc(t.name)} · sin ubicar en el mapa</span></span>`;
  const km = distanceKm(p, t.loc);
  return `<span class="lgh-dest${isApprox(t.loc.precision) ? ' approx' : ''}">${icon.flag}<span><b>${esc(distanceText(km))}</b> ${km != null && km < 0.2 ? '' : 'de '}${esc(t.name)}${isApprox(t.loc.precision) ? ' (aprox.)' : ''}</span></span>`;
}
const mapSlot = (vehicleId) => (homePos(vehicleId) ? `<span class="lgh-map-slot" data-lgmap="${esc(vehicleId)}"></span>` : '');
function homeCard(e) {
  const v = lg.entryView(e), o = e.op, s = statusOf(e.status);
  return `<button type="button" class="lgh-card lg-t-${s.tone}" data-lgu="${esc(e.unit.id)}" aria-label="${esc(`${v.label}, ${s.label}${v.operator ? ', ' + v.operator : ''}`)}">
    <span class="lgh-top"><span class="lgh-unit">${esc(v.label)}</span>${statusChip(e.status)}</span>
    <span class="lgh-op">${v.operatorRec ? avatar(v.operatorRec, 'sm') : `<span class="av sm">${icon.person}</span>`}<span>${v.operator ? esc(v.operator) : '<span class="muted">Sin operador</span>'}</span></span>
    ${o.origin || o.destination ? `<span class="lgh-route lgh-at-${e.status}">
      <span class="lgh-rail" aria-hidden="true"><i class="a"></i><i class="ln"></i><i class="b"></i><i class="mk"></i></span>
      <span class="lgh-pts"><span><small>Origen</small><b>${esc(o.origin || '—')}</b></span><span><small>Destino</small><b>${esc(o.destination || '—')}</b></span></span>
    </span>` : `<span class="lgh-route none">${icon.pin}<span>Ruta sin registrar</span></span>`}
    ${mapSlot(e.unit.id)}${gpsLine(e.unit.id)}${destLine(e)}
    <span class="lgh-foot">${v.trailer ? trailerType(v.trailerType) : '<span class="lg-tt none">Sin remolque</span>'}${o.division ? `<span class="lgh-div">${esc(divisionLabel(o.division, true))}</span>` : ''}${o.reference ? `<span class="lgh-ref">Ref. ${esc(o.reference)}</span>` : ''}</span>
  </button>`;
}
export function homeOpsHTML() {
  const items = homeEntries(lg.fleetBoard()), n = items.length;
  /* Acceso discreto al Centro de Monitoreo GPS (solo con el GPS configurado) */
  const mapLink = gps.configured() ? `<a class="lg-maplink" href="#/operacion/logistica/monitoreo">${icon.map}<span>Ver mapa de unidades</span></a>` : '';
  if (!n) return `<div class="sec-hrow"><h2 class="sec-h">Unidades en operación</h2><a class="link" href="#/operacion/logistica">Logística</a></div>
    <a class="lg-none" href="#/operacion/logistica">${icon.truck}<span>Sin unidades en operación en este momento</span>${icon.chev}</a>${mapLink ? `<p class="lg-live lg-live-map">${mapLink}</p>` : ''}`;
  return `<div class="sec-hrow"><h2 class="sec-h">Unidades en operación</h2><a class="link" href="#/operacion/logistica">Ver todas</a></div>
    <p class="lg-live"><i class="lg-pulse" aria-hidden="true"></i>${plural(n, 'unidad activa', 'unidades activas')}<span> · se actualiza al momento</span>${mapLink}</p>
    <div class="lg-rail${n === 1 ? ' one' : ''}">${items.map(homeCard).join('')}</div>
    ${n > 1 ? `<div class="lg-dots" role="group" aria-label="Unidades activas">${items.map((e, i) => `<button type="button" class="lg-dot${i ? '' : ' on'}" data-dot="${i}" aria-label="Unidad ${i + 1} de ${n}: ${esc(lg.entryView(e).label)}"${i ? '' : ' aria-current="true"'}><i></i></button>`).join('')}</div>` : ''}`;
}
/* Monta la sección en Inicio y la mantiene al día; devuelve la función para dejar de escuchar */
export function mountHomeOps(sec) {
  /* Mapas por unidad: se conservan entre redibujos (no recargan el mapa base) y se crean al asomar la ficha */
  const maps = new Map();   /* vehicleId → { el, map, mounting } */
  let io = null, dead = false;
  const entryOf = (id) => homeEntries(lg.fleetBoard()).find((x) => x.unit.id === id);
  const pinOpts = (id) => { const e = entryOf(id), st = statusOf(e ? e.status : 'inactive'), p = homePos(id);
    return { label: e ? lg.entryView(e).label : '', tone: st.tone, stale: freshness(p).state === 'stale' }; };
  const tgtOf = (id) => { const e = entryOf(id), t = e ? targetOf(e.op) : null; return t && t.loc ? { lat: t.loc.lat, lng: t.loc.lng, label: t.title, kind: t.kind, approx: isApprox(t.loc.precision) } : null; };
  function mountOne(id) {
    const m = maps.get(id); if (!m || m.map || m.mounting) return;
    const p = homePos(id); if (!p) return;
    m.mounting = true;
    mountMap(m.el, { lat: p.lat, lng: p.lng, zoom: 12, interactive: false, ...pinOpts(id) })
      .then((mm) => { if (dead || maps.get(id) !== m) { mm.destroy(); return; } m.map = mm; mm.setTarget(tgtOf(id)); setTimeout(() => mm.resize(), 60); })
      .catch(() => { m.el.classList.add('fail'); })
      .finally(() => { m.mounting = false; });
  }
  function placeMaps() {
    if (io) { io.disconnect(); io = null; }
    const rail = sec.querySelector('.lg-rail'), seen = new Set();
    sec.querySelectorAll('[data-lgmap]').forEach((slot) => {
      const id = slot.dataset.lgmap; seen.add(id);
      let m = maps.get(id);
      if (!m) { const el = document.createElement('span'); el.className = 'lgh-map'; el.setAttribute('aria-hidden', 'true'); m = { el, map: null, mounting: false }; maps.set(id, m); }
      slot.replaceWith(m.el);
      if (m.map) { const p = homePos(id); m.map.resize(); m.map.update(p.lat, p.lng, pinOpts(id)); m.map.setTarget(tgtOf(id)); }
    });
    for (const [id, m] of maps) if (!seen.has(id)) { if (m.map) m.map.destroy(); maps.delete(id); }
    const pending = [...maps].filter(([, m]) => !m.map);
    if (!pending.length) return;
    if (!rail || typeof IntersectionObserver !== 'function') { pending.forEach(([id]) => mountOne(id)); return; }
    io = new IntersectionObserver((ents) => ents.forEach((en) => { if (en.isIntersecting) { const id = [...maps].find(([, m]) => m.el === en.target); if (id) { io.unobserve(en.target); mountOne(id[0]); } } }), { root: rail, rootMargin: '0px 50%' });
    pending.forEach(([, m]) => io.observe(m.el));
  }
  /* Indicador de fichas (puntos) al deslizar */
  function syncDots() {
    const rail = sec.querySelector('.lg-rail'), dots = sec.querySelectorAll('[data-dot]');
    if (!rail || !dots.length) return;
    const cards = rail.querySelectorAll('.lgh-card'), max = rail.scrollWidth - rail.clientWidth;
    let idx = 0;
    if (rail.scrollLeft >= max - 4) idx = cards.length - 1;
    else { let best = Infinity; cards.forEach((c, i) => { const d = Math.abs(c.offsetLeft - cards[0].offsetLeft - rail.scrollLeft); if (d < best) { best = d; idx = i; } }); }
    dots.forEach((d, i) => { d.classList.toggle('on', i === idx); if (i === idx) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current'); });
  }
  const draw = () => {
    const rail = sec.querySelector('.lg-rail'), x = rail ? rail.scrollLeft : 0;
    sec.innerHTML = homeOpsHTML();
    const r2 = sec.querySelector('.lg-rail');
    if (r2) { r2.scrollLeft = x; r2.addEventListener('scroll', syncDots, { passive: true }); }
    hydrateAvatars(sec); placeMaps(); syncDots();
  };
  sec.addEventListener('click', (e) => {
    const d = e.target.closest('[data-dot]');
    if (d) { const rail = sec.querySelector('.lg-rail'), c = rail && rail.querySelectorAll('.lgh-card')[+d.dataset.dot]; if (c) rail.scrollTo({ left: c.offsetLeft - rail.querySelector('.lgh-card').offsetLeft, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); return; }
    const b = e.target.closest('[data-lgu]'); if (b) go(`/operacion/logistica/u/${encodeURIComponent(b.dataset.lgu)}`);
  });
  draw();
  /* GPS: posiciones cada 60 s con Inicio visible; dirección por unidad activa como máximo cada 3 min */
  const wantDetails = () => { if (!gps.configured()) return; homeEntries(lg.fleetBoard()).forEach((e) => { const imei = gps.imeiOf(e.unit.id); if (imei) gps.detail(imei); }); };
  const u1 = lg.onLogisticsChange(draw), u2 = gps.watch(() => { draw(); wantDetails(); }, 60000), u3 = gps.tickAges(sec), u4 = onTargetsChange(draw), u5 = ec.onEmptiesChange(draw);
  wantDetails();
  return () => { dead = true; u1(); u2(); u3(); u4(); u5(); if (io) io.disconnect(); for (const m of maps.values()) if (m.map) m.map.destroy(); maps.clear(); };
}
