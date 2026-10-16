/*
 * Operación → Logística → Control de vacíos
 *   #/operacion/logistica/vacios        indicadores, filtros, buscador, pendientes por prioridad y movimientos recientes
 *   #/operacion/logistica/vacios/:id    detalle: entrega (operador o transportista, patio, fecha y hora), marcar en traslado,
 *                                       marcar como entregado, código para Excel (Scan-IT to Office) e historial
 * Los registros se crean solos cuando una operación de Logística pasa a «Vacío» (services/logistics.js).
 */
import { screen, on } from '../../core/dom.js';
import { go, back } from '../../core/router.js';
import * as ec from '../../services/empties.js';
import { listAll, activeYards, save as saveCatalog } from '../../services/catalogs.js';
import { operatorList, allTrips } from '../../services/operators.js';
import { vehicles as fleetUnits } from '../../services/fuel.js';
import { tryLibs } from '../../services/libs.js';
import { excelCode, bcError } from '../../services/codes.js';
import { shareFile, downloadBlob, isIOS } from '../../services/share.js';
import {
  EMPTY_STATUSES, emptyStatus, isOpenEmpty, isOverdue, sortPending, containersIn, cleanContainer, isContainer, missingForCode,
  EXCEL_COLUMNS, excelValues, excelRowEmpty, matches, dayStr, hmStr,
} from '../../domain/empties/empties.js';
import { esc, fmtFecha, xlCell } from '../../domain/shared/format.js';
import { divisionLabel } from '../../config/logistics.js';
import { trailerTypeLabel } from '../../services/catalogs.js';
import { icon, trailerIcon } from '../components/icons.js';
import { openSheet, actionSheet, busy } from '../components/sheet.js';
import { openPicker } from '../components/picker.js';
import { toast } from '../components/toast.js';
import { enterAdvances } from '../components/fields.js';
import { orderForEmpty } from '../../services/orders.js';
import { folioChip, folioTag } from './orderKit.js';

const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
/* «Hoy · 16:30», «Mañana · 09:00», «08 oct · 16:30» */
export function whenText(date, time, { year = false } = {}) {
  if (!date) return '';
  const today = dayStr(), t = new Date(); t.setDate(t.getDate() + 1);
  const [y, m, d] = date.split('-');
  const day = date === today ? 'Hoy' : date === dayStr(t) ? 'Mañana' : `${d} ${MES[+m - 1]}${year ? ' ' + y : ''}`;
  return time ? `${day} · ${time}` : day;
}
const href = (id) => `#/operacion/logistica/vacios/${encodeURIComponent(id)}`;
export const emptyChip = (k) => { const s = emptyStatus(k); return `<span class="lg-st lg-t-${s.tone}"><i aria-hidden="true"></i>${esc(s.label)}</span>`; };
const lateChip = () => `<span class="ec-late">${icon.alert}Entrega vencida</span>`;
const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;

/* Tarjeta: 1) contenedor 2) estado 3) patio 4) operador 5) fecha de entrega */
function card(r) {
  const v = ec.view(r), late = isOverdue(r), s = emptyStatus(r.status), done = r.status === 'delivered';
  const who = r.externalCarrier ? `<span class="ec-ext">Externo</span> ${esc(r.externalCarrierName || 'Sin transportista')}` : v.deliveryOperator ? esc(v.deliveryOperator) : '<i>Sin asignar</i>';
  return `<a class="ec-card lg-t-${s.tone}${late ? ' late' : ''}" href="${href(r.id)}">
    <div class="ec-c1"><b class="ec-num">${esc(r.containerNumber)}</b><span class="chev">${icon.chev}</span></div>
    <div class="ec-st">${emptyChip(r.status)}${late ? lateChip() : ''}${folioTag(orderForEmpty(r))}</div>
    <dl class="ec-grid">
      <div class="wide"><dt>Patio</dt><dd>${v.yard ? esc(v.yard) : '<i>Sin asignar</i>'}</dd></div>
      <div><dt>${r.externalCarrier ? 'Transportista' : 'Operador'}</dt><dd>${who}</dd></div>
      <div><dt>${done ? 'Entregado' : 'Entrega programada'}</dt><dd>${done ? esc(whenText(r.actualDeliveryDate, r.actualDeliveryTime)) : r.scheduledDeliveryDate ? esc(whenText(r.scheduledDeliveryDate, r.scheduledDeliveryTime)) : '<i>Sin fecha</i>'}</dd></div>
      ${v.unit || r.externalVehicle ? `<div><dt>Unidad</dt><dd>${esc(r.externalCarrier ? r.externalVehicle || '—' : v.unit)}</dd></div>` : ''}
    </dl></a>`;
}
const EV_ICON = { created: icon.plus, redetected: icon.refresh, operator: icon.person, carrier: icon.truck, yard: icon.yard, schedule: icon.clock, status: icon.swap, in_transit: icon.truck, delivered: icon.check, vehicle: icon.truck, notes: icon.edit, reopened: icon.refresh, delivery_fix: icon.clock };
function moveRow(e, withNum = true) {
  const r = ec.byId(e.emptyContainerId), v = r ? ec.view(r) : {};
  const sub = e.eventType === 'delivered' || e.eventType === 'in_transit' ? [v.yard, v.deliverer].filter(Boolean).join(' · ') : e.details;
  return `<a class="row ec-mv${e.eventType === 'delivered' ? ' done' : ''}" href="${href(e.emptyContainerId)}"><span class="row-ic">${EV_ICON[e.eventType] || icon.info}</span>
    <span class="row-tx"><span class="row-l1">${withNum ? `<b class="mono">${esc(e.containerNumber)}</b>` : ''}<span class="ec-act">${esc(ec.eventLabel(e))}</span></span>
      ${sub ? `<span class="row-l2">${esc(sub)}</span>` : ''}<span class="row-l3">${esc(whenText(e.date, e.time, { year: true }))}${e.createdBy ? ' · ' + esc(e.createdBy) : ''}</span></span></a>`;
}

/* ===== Pantalla principal ===== */
const DATE_F = [['all', 'Todas las fechas'], ['late', 'Vencidas'], ['today', 'Hoy'], ['tomorrow', 'Mañana'], ['week', 'Próximos 7 días'], ['none', 'Sin fecha']];
export async function emptiesScreen() {
  await ec.loadEmpties();
  const f = { status: 'all', operator: '', yard: '', carrier: '', date: 'all', text: '' };
  let shownDone = 10;
  const s = screen(`<div class="page lg-page ec-page">
    <header class="nav-top"><button type="button" class="nav-back" data-back>${icon.back}<span>Logística</span></button>
      <button type="button" class="nav-act" data-new aria-label="Registrar vacío">${icon.plus}</button></header>
    <h1 class="title">Control de vacíos</h1>
    <p class="page-lead">Seguimiento y entrega de contenedores vacíos.</p>
    <div class="tiles ec-tiles" data-tiles></div>
    <label class="search"><span class="search-ic">${icon.search}</span><input type="search" class="search-in" placeholder="Contenedor, operador, patio, unidad…" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search" aria-label="Buscar contenedores vacíos"></label>
    <div class="chips filters" data-stf role="group" aria-label="Filtrar por estado"></div>
    <div class="chips filters" data-f2 role="group" aria-label="Más filtros"></div>
    <div data-list aria-live="polite"></div>
    <div class="sec-hrow ec-mvh"><h2 class="sec-h">Movimientos recientes</h2></div>
    <div data-moves></div>
  </div>`);
  const root = s.el;
  const fDate = (r) => (r.status === 'delivered' ? r.actualDeliveryDate : r.scheduledDeliveryDate);
  function passDate(r) {
    if (f.date === 'all') return true;
    const d = fDate(r), today = dayStr(), t = new Date();
    if (f.date === 'none') return !d;
    if (f.date === 'late') return isOverdue(r);
    if (!d) return false;
    if (f.date === 'today') return d === today;
    t.setDate(t.getDate() + 1); if (f.date === 'tomorrow') return d === dayStr(t);
    t.setDate(t.getDate() + 6); return d >= today && d <= dayStr(t);
  }
  function filtered() {
    return ec.all().filter((r) => (f.status === 'all' || (f.status === 'open' ? isOpenEmpty(r) : r.status === f.status))
      && (!f.operator || (!r.externalCarrier && r.deliveryOperatorId === f.operator))
      && (!f.yard || r.yardId === f.yard) && (!f.carrier || (r.externalCarrier && r.externalCarrierName === f.carrier))
      && passDate(r) && matches(r, ec.view(r), f.text));
  }
  function draw() {
    const all = ec.all(), today = dayStr(), n = (k) => all.filter((r) => r.status === k).length;
    const tiles = [['pending', 'Pendientes', n('pending')], ['scheduled', 'Programados', n('scheduled')], ['in_transit', 'En traslado', n('in_transit')], ['today', 'Entregados hoy', all.filter((r) => r.status === 'delivered' && r.actualDeliveryDate === today).length]];
    root.querySelector('[data-tiles]').innerHTML = tiles.map(([k, l, c]) => `<button type="button" class="tile ec-tile${(k === 'today' ? f.status === 'delivered' && f.date === 'today' : f.status === k) ? ' on' : ''}" data-tile="${k}"><small>${l}</small><b>${c}</b></button>`).join('');
    root.querySelector('[data-stf]').innerHTML = [['all', 'Todos'], ...EMPTY_STATUSES.map((x) => [x.key, x.key === 'pending' ? 'Pendientes' : x.key === 'scheduled' ? 'Programados' : x.key === 'delivered' ? 'Entregados' : x.label])]
      .map(([k, l]) => `<button type="button" class="chip${f.status === k ? ' on' : ''}" data-st="${k}" aria-pressed="${f.status === k}">${esc(l)}</button>`).join('');
    const opName = f.operator ? (operatorList().find((o) => o.id === f.operator) || {}).name : '', yName = f.yard ? (ec.yardById(f.yard) || {}).name : '';
    const dl = (DATE_F.find(([k]) => k === f.date) || [])[1];
    root.querySelector('[data-f2]').innerHTML = [['operator', opName || 'Operador', !!f.operator], ['yard', yName || 'Patio', !!f.yard], ['carrier', f.carrier || 'Transportista', !!f.carrier], ['date', f.date === 'all' ? 'Fecha' : dl, f.date !== 'all']]
      .map(([k, l, onf]) => `<button type="button" class="chip${onf ? ' on' : ''}" data-f="${k}">${esc(l)}${onf ? icon.close : icon.down}</button>`).join('');
    const list = filtered(), open = sortPending(list.filter(isOpenEmpty)), done = list.filter((r) => r.status === 'delivered').sort((a, b) => (b.deliveredAt || 0) - (a.deliveredAt || 0));
    const late = open.filter((r) => isOverdue(r)).length;
    root.querySelector('[data-list]').innerHTML = !ec.all().length
      ? `<div class="empty"><p>Aún no hay contenedores vacíos. Se registran solos cuando una operación de Logística pasa a «Vacío»; también puedes registrar uno manualmente.</p><button type="button" class="btn-primary sm" data-new>${icon.plus}<span>Registrar vacío</span></button></div>`
      : `${f.status !== 'delivered' ? `<div class="sec-hrow"><h2 class="sec-h">Pendientes de entrega</h2><span class="count">${open.length}</span></div>
        ${late ? `<p class="op-warn">${icon.alert}<span>${plural(late, 'entrega vencida', 'entregas vencidas')}.</span></p>` : ''}
        ${open.length ? `<div class="ec-cards">${open.map(card).join('')}</div>` : `<div class="empty"><p>${f.text || f.operator || f.yard || f.carrier || f.date !== 'all' ? 'Sin coincidencias.' : 'No hay contenedores pendientes de entrega.'}</p></div>`}` : ''}
        ${done.length && (f.status === 'all' || f.status === 'delivered') ? `<div class="sec-hrow"><h2 class="sec-h">Entregados</h2><span class="count">${done.length}</span></div>
          <div class="ec-cards">${done.slice(0, shownDone).map(card).join('')}</div>${done.length > shownDone ? `<button type="button" class="btn-ghost block" data-more>Mostrar más (${done.length - shownDone})</button>` : ''}` : f.status === 'delivered' ? '<div class="empty"><p>Sin entregados con estos filtros.</p></div>' : ''}`;
    const mv = ec.recentEvents(12);
    root.querySelector('[data-moves]').innerHTML = mv.length ? `<div class="list">${mv.map((e) => moveRow(e)).join('')}</div>` : '<div class="empty"><p>Sin movimientos todavía.</p></div>';
  }
  on(root, 'click', '[data-back]', () => back('/operacion/logistica'));
  on(root, 'click', '[data-new]', () => openNewEmpty());
  on(root, 'click', '[data-more]', () => { shownDone += 20; draw(); });
  on(root, 'click', '[data-st]', (e, b) => { f.status = b.dataset.st; draw(); });
  on(root, 'click', '[data-tile]', (e, b) => {
    const k = b.dataset.tile;
    if (k === 'today') { const onT = f.status === 'delivered' && f.date === 'today'; f.status = onT ? 'all' : 'delivered'; f.date = onT ? 'all' : 'today'; } else f.status = f.status === k ? 'all' : k;
    draw();
  });
  on(root, 'click', '[data-f]', async (e, b) => {
    const k = b.dataset.f;
    if (k === 'date') {
      const v = await actionSheet({ title: 'Fecha de entrega', actions: DATE_F.map(([key, l]) => ({ label: l, value: key, style: key === f.date ? 'primary' : '' })) });
      if (v) { f.date = v; draw(); } return;
    }
    if (f[k]) { f[k] = ''; draw(); return; }
    let items = [];
    if (k === 'operator') { const used = new Set(ec.all().map((r) => r.deliveryOperatorId).filter(Boolean)); items = operatorList().filter((o) => used.has(o.id)).map((o) => ({ value: o.id, label: o.name })); }
    if (k === 'yard') { const used = new Set(ec.all().map((r) => r.yardId).filter(Boolean)); items = listAll('yards').filter((y) => used.has(y.id)).map((y) => ({ value: y.id, label: y.name })); }
    if (k === 'carrier') items = [...new Set(ec.all().filter((r) => r.externalCarrier && r.externalCarrierName).map((r) => r.externalCarrierName))].sort().map((n) => ({ value: n, label: n }));
    if (!items.length) { toast(k === 'carrier' ? 'Aún no hay entregas con otro transportista.' : 'Aún no hay registros con este dato.', { type: 'info' }); return; }
    const r = await openPicker({ title: { operator: 'Operador que entrega', yard: 'Patio de entrega', carrier: 'Transportista' }[k], allowNew: false, items });
    if (r) { f[k] = r.value; draw(); }
  });
  root.querySelector('.search-in').addEventListener('input', (e) => { f.text = e.target.value; draw(); });
  draw();
  const un = ec.onEmptiesChange(draw), t = setInterval(draw, 60000);   /* «Entrega vencida» se actualiza con el reloj */
  s.cleanup = () => { un(); clearInterval(t); };
  return s;
}

/* ===== Detalle ===== */
export async function emptyDetailScreen({ id }) {
  await ec.loadEmpties();
  if (!ec.byId(id)) { toast('Ese registro ya no existe.', { type: 'info' }); go('/operacion/logistica/vacios', { replace: true }); return null; }
  const s = screen('<div class="page lg-page ec-page ec-detail"></div>');
  const root = s.el;
  function draw() {
    const r = ec.byId(id); if (!r) return;
    const v = ec.view(r), open = isOpenEmpty(r), late = isOverdue(r), y = window.scrollY, ev = ec.eventsOf(id);
    const row = (k, x) => `<div><dt>${k}</dt><dd>${x || '<i>—</i>'}</dd></div>`;
    root.innerHTML = `
      <header class="nav-top"><button type="button" class="nav-back" data-back>${icon.back}<span>Control de vacíos</span></button>
        <button type="button" class="nav-act" data-more aria-label="Más acciones">${icon.more}</button></header>
      <section class="lg-hero ec-hero lg-t-${emptyStatus(r.status).tone}">
        <small>Contenedor</small><h1 class="ec-num big">${esc(r.containerNumber)}</h1>
        <div class="ec-st">${emptyChip(r.status)}${late ? lateChip() : ''}${folioChip(orderForEmpty(r))}</div>
        ${open ? `<div class="ec-acts">
          <button type="button" class="btn-primary block lg" data-a="deliver">${icon.check}<span>Marcar como entregado</span></button>
          <div class="sheet-acts"><button type="button" class="btn-secondary" data-a="edit">${icon.edit}<span>${r.status === 'pending' ? 'Programar entrega' : 'Editar entrega'}</span></button>
            ${r.status !== 'in_transit' ? `<button type="button" class="btn-secondary" data-a="transit">${icon.truck}<span>En traslado</span></button>` : `<button type="button" class="btn-secondary" data-a="code">${icon.qr}<span>Generar código</span></button>`}</div>
          ${r.status !== 'in_transit' ? `<button type="button" class="btn-ghost block" data-a="code">${icon.qr}<span>Generar código para Excel</span></button>` : ''}</div>`
    : `<p class="lg-hero-sub">Entregado ${esc(whenText(r.actualDeliveryDate, r.actualDeliveryTime, { year: true }))}${v.yard ? ' en ' + esc(v.yard) : ''}.</p>
          <div class="sheet-acts"><button type="button" class="btn-secondary" data-a="code">${icon.qr}<span>Generar código</span></button><button type="button" class="btn-secondary" data-a="edit">${icon.edit}<span>Corregir datos</span></button></div>`}
      </section>
      <section class="grp"><div class="grp-h"><h3>Entrega del vacío</h3></div><dl class="sumlist lg-sum">
        ${row('Entrega', r.externalCarrier ? 'Otro transportista' : 'PERCONSUR')}
        ${r.externalCarrier ? row('Transportista', esc(r.externalCarrierName)) + row('Operador externo', esc(r.externalDriverName)) + row('Unidad / placas', esc(r.externalVehicle))
    : row('Operador que entrega', v.deliveryOperator ? esc(v.deliveryOperator) + (r.originalOperatorId && r.deliveryOperatorId !== r.originalOperatorId ? '<small>Distinto del operador del viaje</small>' : '') : '<i>Sin asignar</i>')}
        ${row('Patio de entrega', v.yard ? esc(v.yard) + (v.yardRec && v.yardRec.address ? `<small>${esc(v.yardRec.address)}</small>` : '') : '<i>Sin asignar</i>')}
        ${row('Entrega programada', esc(whenText(r.scheduledDeliveryDate, r.scheduledDeliveryTime, { year: true })))}
        ${r.status === 'delivered' ? row('Entrega real', `<b>${esc(whenText(r.actualDeliveryDate, r.actualDeliveryTime, { year: true }))}</b>`) : ''}
        ${r.notes ? row('Observaciones', esc(r.notes)) : ''}
      </dl></section>
      <section class="grp"><div class="grp-h"><h3>Origen</h3></div><dl class="sumlist lg-sum">
        ${row('Viaje relacionado', v.trip ? `<a href="#/operadores/${esc(v.trip.operatorId)}?viaje=${esc(v.trip.id)}">${esc(fmtFecha(v.trip.date))} · ${esc(v.trip.origin)} → ${esc(v.trip.destination)}</a>${v.trip.reference ? `<small>Ref. ${esc(v.trip.reference)}</small>` : ''}` : '')}
        ${r.logisticsOperationId && r.vehicleId ? row('Logística', `<a href="#/operacion/logistica/u/${esc(r.vehicleId)}">Ver unidad en Logística</a>`) : ''}
        ${row('División', esc(divisionLabel(r.division)))}
        ${row('Unidad', v.unit ? `${esc(v.unit)}${v.placas ? `<small>${esc(v.placas)}</small>` : ''}` : '')}
        ${row('Remolque / chasis', v.trailer ? `<span class="lg-tt">${trailerIcon(v.trailerType)}<span>${esc(v.trailer)} · ${esc(trailerTypeLabel(v.trailerType))}</span></span>` : '')}
        ${row('Operador del viaje', esc(v.originalOperator))}
        ${r.origin || r.destination ? row('Ruta', `${esc(r.origin || '—')} → ${esc(r.destination || '—')}`) : ''}
        ${row('Quedó vacío', esc(whenText(dayStr(new Date(r.emptiedAt)), hmStr(new Date(r.emptiedAt)), { year: true })))}
      </dl></section>
      <div class="sec-hrow"><h2 class="sec-h">Historial</h2><span class="count">${ev.length}</span></div>
      <div class="list">${ev.map((e) => moveRow(e, false)).join('')}</div>`;
    window.scrollTo(0, y);
  }
  on(root, 'click', '[data-back]', () => back('/operacion/logistica/vacios'));
  on(root, 'click', '[data-a]', async (e, b) => {
    const r = ec.byId(id); if (!r) return;
    const a = b.dataset.a;
    try {
      if (a === 'edit') openDeliveryForm(r);
      if (a === 'deliver') openDeliverSheet(r);
      if (a === 'code') openCodeSheet(r);
      if (a === 'transit') {
        if (!r.yardId) { toast('Falta seleccionar el patio de entrega.', { type: 'warn' }); openDeliveryForm(r); return; }
        await ec.markInTransit(id); toast(`${r.containerNumber}: En traslado`);
      }
    } catch (err) { toast(err.message || 'No se pudo completar la acción.', { type: 'warn' }); }
  });
  on(root, 'click', '[data-more]', async () => {
    const r = ec.byId(id); if (!r) return;
    const v = await actionSheet({ title: r.containerNumber, actions: [{ label: 'Generar código para Excel', value: 'code', icon: icon.qr }, { label: r.status === 'delivered' ? 'Corregir datos' : 'Editar entrega', value: 'edit', icon: icon.edit },
      ...(r.status === 'delivered' ? [{ label: 'Reabrir (no se entregó)', value: 'reopen', icon: icon.refresh }] : [])] });
    try {
      if (v === 'code') openCodeSheet(r);
      if (v === 'edit') openDeliveryForm(r);
      if (v === 'reopen') { await ec.reopen(id); toast('Registro reabierto'); }
    } catch (err) { toast(err.message || 'No se pudo completar la acción.', { type: 'warn' }); }
  });
  draw();
  const un = ec.onEmptiesChange(draw), t = setInterval(draw, 60000);
  s.cleanup = () => { un(); clearInterval(t); };
  return s;
}

/* ===== Formulario de entrega ===== */
export function openDeliveryForm(r0) {
  const r = ec.byId(r0.id) || r0, v0 = ec.view(r), delivered = r.status === 'delivered';
  const st = { ext: !!r.externalCarrier, operatorId: r.deliveryOperatorId || null, yardId: r.yardId || null, vehicleId: r.vehicleId || null };
  const carriers = [...new Set(ec.all().filter((x) => x.externalCarrier && x.externalCarrierName).map((x) => x.externalCarrierName))];
  const form = document.createElement('form');
  form.className = 'op-form ec-form'; form.noValidate = true;
  const pick = (k, label) => `<div class="fld" data-f="${k}"><span class="fl">${label}</span><button type="button" class="in pick" data-pk="${k}"><span class="pv"></span><span class="pick-ic">${icon.chev}</span></button><span class="fhint" data-h="${k}"></span><span class="ferr" data-err="${k}"></span></div>`;
  form.innerHTML = `<div class="op-who"><span class="row-ic">${icon.container}</span><div><small>Contenedor</small><b class="mono">${esc(r.containerNumber)}</b></div></div>
    <label class="sw-row"><span class="sw-tx">Se entrega con otro transportista<small>Empresa externa; no se agrega a los catálogos</small></span><input type="checkbox" switch class="sw" name="ext"${st.ext ? ' checked' : ''}></label>
    <div data-own>${pick('operator', 'Operador que entregará el vacío')}${pick('vehicle', 'Unidad que lo transporta')}</div>
    <div data-ext>
      <div class="fld" data-f="carrier"><span class="fl">Transportista</span><input class="in" name="carrier" value="${esc(r.externalCarrierName || '')}" autocomplete="off" autocapitalize="characters" placeholder="Nombre de la empresa o transportista" enterkeyhint="next"><span class="sugg" data-sugg="carrier"></span><span class="ferr" data-err="carrier"></span></div>
      <label class="fld"><span class="fl">Operador externo (opcional)</span><input class="in" name="driver" value="${esc(r.externalDriverName || '')}" autocomplete="off" autocapitalize="words" enterkeyhint="next"></label>
      <label class="fld"><span class="fl">Unidad / placas externas (opcional)</span><input class="in" name="xveh" value="${esc(r.externalVehicle || '')}" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="next"></label>
    </div>
    ${pick('yard', 'Patio de entrega')}
    <div class="row2"><label class="fld" data-f="date"><span class="fl">Fecha de entrega</span><input class="in" type="date" name="date" value="${esc(r.scheduledDeliveryDate || '')}"></label>
      <label class="fld" data-f="time"><span class="fl">Hora de entrega</span><input class="in" type="time" name="time" value="${esc(r.scheduledDeliveryTime || '')}"></label></div>
    ${delivered ? `<div class="row2"><label class="fld"><span class="fl">Fecha real de entrega</span><input class="in" type="date" name="adate" value="${esc(r.actualDeliveryDate || '')}"></label>
      <label class="fld"><span class="fl">Hora real de entrega</span><input class="in" type="time" name="atime" value="${esc(r.actualDeliveryTime || '')}"></label></div>` : '<p class="grp-note">Fecha y hora programadas. Al marcarlo como entregado se registran la fecha y hora reales.</p>'}
    <label class="fld"><span class="fl">Observaciones (opcional)</span><textarea class="in" name="notes" rows="2">${esc(r.notes || '')}</textarea></label>
    <div class="form-foot"><button type="submit" class="btn-primary block lg">Guardar</button></div>`;
  const sh = openSheet({ title: delivered ? 'Corregir datos' : 'Entrega del vacío', body: form, full: true, className: 'form-sheet' });
  enterAdvances(form);
  function sync() {
    form.querySelector('[data-own]').hidden = st.ext; form.querySelector('[data-ext]').hidden = !st.ext;
    const op = st.operatorId ? operatorList().find((o) => o.id === st.operatorId) : null, y = ec.yardById(st.yardId), u = st.vehicleId ? fleetUnits().find((x) => x.id === st.vehicleId) : null;
    const set = (k, val, sub, ph) => { const b = form.querySelector(`[data-pk="${k}"]`); b.classList.toggle('empty', !val); b.querySelector('.pv').innerHTML = `<span class="pv-v">${esc(val || ph)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}`; };
    set('operator', op && op.name, op && op.companyShort, 'Elegir operador del catálogo');
    set('vehicle', u && u.label, u && u.placas, 'Opcional');
    set('yard', y && y.name, y && y.address, 'Elegir patio');
    form.querySelector('[data-h="operator"]').innerHTML = r.originalOperatorId && st.operatorId !== r.originalOperatorId && v0.originalOperator ? `Operador del viaje: <button type="button" class="linkish" data-useorig>${esc(v0.originalOperator)}</button>` : '';
  }
  form.elements.ext.addEventListener('change', () => { st.ext = form.elements.ext.checked; sync(); });
  function suggest() {
    const box = form.querySelector('[data-sugg="carrier"]'), q = form.elements.carrier.value.trim().toLowerCase();
    box.innerHTML = carriers.filter((x) => (!q || x.toLowerCase().includes(q)) && x.toLowerCase() !== q).slice(0, 5).map((x) => `<button type="button" class="chip sm-chip" data-pick-sugg="${esc(x)}">${esc(x)}</button>`).join('');
  }
  form.elements.carrier.addEventListener('focus', suggest); form.elements.carrier.addEventListener('input', suggest);
  form.addEventListener('click', async (e) => {
    const sg = e.target.closest('[data-pick-sugg]'); if (sg) { form.elements.carrier.value = sg.dataset.pickSugg; sg.parentElement.innerHTML = ''; return; }
    if (e.target.closest('[data-useorig]')) { st.operatorId = r.originalOperatorId; sync(); return; }
    const b = e.target.closest('[data-pk]'); if (!b) return;
    const k = b.dataset.pk;
    if (k === 'operator') {
      const list = operatorList(); if (!list.length) { toast('No hay operadores en el catálogo.', { type: 'info' }); return; }
      const x = await openPicker({ title: 'Operador que entregará', allowNew: false, placeholder: 'Buscar operador', current: st.operatorId || '', recents: r.originalOperatorId ? [r.originalOperatorId] : [],
        items: list.map((o) => ({ value: o.id, label: o.name, sub: o.id === r.originalOperatorId ? 'Operador del viaje' : o.companyShort })) });
      if (x) { st.operatorId = x.value; sync(); }
    }
    if (k === 'vehicle') {
      const x = await openPicker({ title: 'Unidad que lo transporta', allowNew: false, placeholder: 'Buscar unidad o placas', current: st.vehicleId || '',
        items: [{ value: '__none', label: 'Sin unidad' }, ...fleetUnits().map((u) => ({ value: u.id, label: u.label, sub: u.placas }))] });
      if (x) { st.vehicleId = x.value === '__none' ? null : x.value; sync(); }
    }
    if (k === 'yard') {
      const x = await openPicker({ title: 'Patio de entrega', placeholder: 'Buscar o escribir un patio', current: st.yardId || '', newLabel: 'Agregar patio', autocap: 'characters', transform: (t) => t.toUpperCase(),
        recents: [...new Set(ec.all().sort((a, b2) => (b2.updatedAt || 0) - (a.updatedAt || 0)).map((x2) => x2.yardId).filter(Boolean))].slice(0, 3),
        items: activeYards().map((y) => ({ value: y.id, label: y.name, sub: y.address || y.notes || '' })) });
      if (!x) return;
      if (x.isNew) { const y = await saveCatalog('yards', { name: x.value, address: '', notes: '', active: '', source: 'auto' }); st.yardId = y.id; toast(`Patio «${y.name}» agregado al catálogo`); }
      else st.yardId = x.value;
      sync();
    }
  });
  sync();
  let saving = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); if (saving) return;
    const carrier = form.elements.carrier.value.trim().toUpperCase().replace(/\s+/g, ' ');
    if (st.ext && !carrier) { form.querySelector('[data-f="carrier"]').classList.add('has-err'); toast('Escribe el transportista que entrega.', { type: 'warn' }); return; }
    const patch = {
      externalCarrier: st.ext, externalCarrierName: st.ext ? carrier : '', externalDriverName: st.ext ? form.elements.driver.value.trim() : '', externalVehicle: st.ext ? form.elements.xveh.value.trim().toUpperCase() : '',
      deliveryOperatorId: st.operatorId, vehicleId: st.vehicleId, yardId: st.yardId,
      scheduledDeliveryDate: form.elements.date.value, scheduledDeliveryTime: form.elements.time.value, notes: form.elements.notes.value.trim(),
      ...(delivered ? { actualDeliveryDate: form.elements.adate.value, actualDeliveryTime: form.elements.atime.value } : {}),
    };
    saving = true;
    try { const n = await ec.update(r.id, patch); sh.close(); toast(n.status === 'scheduled' && r.status === 'pending' ? 'Entrega programada' : 'Cambios guardados'); }
    catch (err) { toast(err.message || 'No se pudo guardar.', { type: 'warn' }); } finally { saving = false; }
  });
}

/* ===== Marcar como entregado (con resumen y fecha/hora reales corregibles) ===== */
export function openDeliverSheet(r0) {
  const r = ec.byId(r0.id) || r0, v = ec.view(r);
  const missing = [!v.yard && 'Falta seleccionar el patio de entrega.', !(r.externalCarrier ? r.externalCarrierName : v.deliveryOperator) && (r.externalCarrier ? 'Falta escribir el transportista que entrega.' : 'Falta seleccionar el operador que entrega.')].filter(Boolean);
  if (missing.length) {
    const sh = openSheet({ title: 'Faltan datos', body: `<ul class="ec-miss">${missing.map((m) => `<li>${icon.alert}<span>${esc(m)}</span></li>`).join('')}</ul>
      <div class="sheet-acts col"><button type="button" class="btn-primary block" data-fix>${icon.edit}<span>Completar datos</span></button></div>` });
    sh.body.querySelector('[data-fix]').addEventListener('click', () => { sh.close(); openDeliveryForm(r); });
    return;
  }
  const form = document.createElement('form'); form.className = 'op-form'; form.noValidate = true;
  form.innerHTML = `<dl class="sumlist lg-sum ec-sum">
      <div><dt>Contenedor</dt><dd><b class="mono">${esc(r.containerNumber)}</b></dd></div>
      <div><dt>Patio</dt><dd>${esc(v.yard)}</dd></div>
      <div><dt>${r.externalCarrier ? 'Transportista' : 'Operador'}</dt><dd>${esc(v.deliverer)}</dd></div>
      ${r.scheduledDeliveryDate ? `<div><dt>Programado</dt><dd>${esc(whenText(r.scheduledDeliveryDate, r.scheduledDeliveryTime, { year: true }))}</dd></div>` : ''}
    </dl>
    <div class="row2"><label class="fld"><span class="fl">Fecha real</span><input class="in" type="date" name="date" value="${dayStr()}"></label>
      <label class="fld"><span class="fl">Hora real</span><input class="in" type="time" name="time" value="${hmStr()}"></label></div>
    <div class="sheet-acts"><button type="button" class="btn-secondary" data-cancel>Cancelar</button><button type="submit" class="btn-primary">${icon.check}<span>Confirmar entrega</span></button></div>`;
  const sh = openSheet({ title: 'Marcar como entregado', body: form });
  form.querySelector('[data-cancel]').addEventListener('click', () => sh.close());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const date = form.elements.date.value, time = form.elements.time.value;
    if (!date || !time) { toast('Indica la fecha y la hora reales de entrega.', { type: 'warn' }); return; }
    try { await ec.markDelivered(r.id, { date, time }); sh.close(); toast(`${r.containerNumber}: Entregado`); }
    catch (err) { toast(err.message || 'No se pudo registrar la entrega.', { type: 'warn' }); }
  });
}

/* ===== Código para Excel (Scan-IT to Office) ===== */
export async function openCodeSheet(r0) {
  const r = ec.byId(r0.id) || r0, v = ec.view(r), missing = missingForCode(r, v);
  if (missing.length) {
    const sh = openSheet({ title: 'Faltan datos para el código', body: `<p class="sheet-lead">El código debe llevar todas las columnas obligatorias de tu Excel.</p>
      <ul class="ec-miss">${missing.map((m) => `<li>${icon.alert}<span>${esc(m)}</span></li>`).join('')}</ul>
      <div class="sheet-acts col"><button type="button" class="btn-primary block" data-fix>${icon.edit}<span>Completar datos</span></button></div>` });
    sh.body.querySelector('[data-fix]').addEventListener('click', () => { sh.close(); openDeliveryForm(r); });
    return;
  }
  const sh = openSheet({ title: 'Código para Excel', full: true, body: '<p class="sheet-lead">Preparando código…</p>' });
  await tryLibs(['bwipjs', 'qrcode']);
  const text = excelRowEmpty(r, v), b = excelCode(text), vals = excelValues(r, v);
  if (!b) { sh.body.innerHTML = `<p class="op-warn">${icon.alert}<span>No se pudo generar el código: ${esc(bcError || 'se necesita conexión la primera vez')}.</span></p>`; return; }
  let file = null;
  sh.body.innerHTML = `<p class="sheet-lead">Escanéalo con Scan-IT to Office: llena una fila con las 9 columnas de tu hoja «Control de vacíos». Sube el brillo si el lector no lo detecta.</p>
    <figure class="xl-card ec-code"><img src="${b.src}" alt="Código para Excel del contenedor ${esc(r.containerNumber)}" class="${b.kind === 'qr' ? 'xl-qr' : 'xl-pdf'}"><figcaption><b>${esc(r.containerNumber)}</b><span>${b.kind === 'qr' ? 'Código QR' : 'Código PDF417'} · ${esc([vals[4], vals[5], vals[6]].filter(Boolean).join(' · '))}</span></figcaption></figure>
    <h3 class="pk-h">Contenido del código</h3>
    <dl class="sumlist lg-sum ec-cols">${EXCEL_COLUMNS.map((c, i) => `<div><dt>${esc(c)}</dt><dd>${xlCell(vals[i]).trim() ? esc(xlCell(vals[i])) : '<i>(vacío)</i>'}</dd></div>`).join('')}</dl>
    <p class="grp-note">Columnas separadas por tabulador, en el orden de tu Excel. Se codifica sin acentos (por ejemplo «Si», «Mejia») porque Scan-IT to Office descarta los campos con acentos. Si cambias algún dato, vuelve a generar el código.</p>
    <div class="sheet-foot"><div class="sheet-acts"><button type="button" class="btn-secondary" data-x="close">Cerrar</button><button type="button" class="btn-secondary" data-x="share" disabled>${icon.share}<span>Compartir</span></button></div>
      <button type="button" class="btn-primary block" data-x="save" disabled>${icon.download}<span>Guardar imagen</span></button></div>`;
  /* Imagen lista en memoria antes de tocar Compartir (Safari exige compartir dentro del toque) */
  try { file = await codeImage(b, r, vals); sh.body.querySelectorAll('[data-x="share"],[data-x="save"]').forEach((x) => { x.disabled = false; }); } catch (e) { console.warn(e); }
  sh.body.addEventListener('click', async (e) => {
    const x = e.target.closest('[data-x]'); if (!x) return;
    if (x.dataset.x === 'close') { sh.close(); return; }
    if (!file) return;
    const res = await shareFile(file, { title: file.name });
    if (res === 'shared') toast(x.dataset.x === 'save' ? 'Listo' : 'Código compartido');
    else if (res !== 'cancelled') { downloadBlob(file, file.name); toast(isIOS() ? 'Se abrió la imagen. Mantén presionado para guardarla en Fotos.' : 'Imagen descargada: ' + file.name, { ms: 3500 }); }
  });
}
async function codeImage(b, r, vals) {
  const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = b.src; });
  const W = 900, pad = 40, k = Math.min((W - pad * 2) / im.width, 3), ih = Math.round(im.height * k), H = pad + ih + 130;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.imageSmoothingEnabled = false;
  x.drawImage(im, (W - im.width * k) / 2, pad, im.width * k, ih);
  x.fillStyle = '#1A2233'; x.textAlign = 'center'; x.font = '800 44px -apple-system, Arial, sans-serif'; x.fillText(r.containerNumber, W / 2, pad + ih + 60);
  x.fillStyle = '#5D6778'; x.font = '26px -apple-system, Arial, sans-serif'; x.fillText([vals[4], vals[5], vals[6]].filter(Boolean).join(' · '), W / 2, pad + ih + 104);
  const blob = await new Promise((res) => c.toBlob(res, 'image/png')); c.width = c.height = 0;
  return new File([blob], `Vacio-${r.containerNumber}-${(vals[5] || '').replace(/\//g, '-')}.png`, { type: 'image/png' });
}

/* ===== Registro manual (cuando no hubo número de contenedor en el viaje) ===== */
export function openNewEmpty({ tripId = null, vehicleId = null, operationId = null } = {}) {
  let trip = tripId ? allTrips().find((t) => t.id === tripId) || null : null;
  const form = document.createElement('form'); form.className = 'op-form'; form.noValidate = true;
  form.innerHTML = `<div class="fld"><span class="fl">Viaje relacionado (opcional)</span><button type="button" class="in pick" data-pk="trip"><span class="pv"></span><span class="pick-ic">${icon.chev}</span></button><span class="fhint">Si el viaje tiene el contenedor en su referencia, se toma de ahí.</span></div>
    <label class="fld" data-f="num"><span class="fl">Contenedor</span><input class="in mono" name="num" autocomplete="off" autocapitalize="characters" spellcheck="false" autocorrect="off" maxlength="11" placeholder="Ej. MSCU1234567" enterkeyhint="done"><span class="fhint" data-chk></span></label>
    <div class="form-foot"><button type="submit" class="btn-primary block lg">Registrar vacío</button></div>`;
  const sh = openSheet({ title: 'Registrar vacío', body: form });
  const inp = form.elements.num;
  const setTrip = () => {
    const b = form.querySelector('[data-pk="trip"]'); b.classList.toggle('empty', !trip);
    b.querySelector('.pv').innerHTML = `<span class="pv-v">${esc(trip ? `${fmtFecha(trip.date)} · ${trip.origin} → ${trip.destination}` : 'Elegir viaje')}</span>${trip && trip.reference ? `<small>Ref. ${esc(trip.reference)}</small>` : ''}`;
    const n = trip && containersIn(trip.reference)[0]; if (n && !inp.value) inp.value = n;
    check();
  };
  const check = () => { const n = cleanContainer(inp.value), h = form.querySelector('[data-chk]'); h.className = 'fhint' + (n && !isContainer(n) ? ' warn-t' : ''); h.textContent = !n ? '' : isContainer(n) ? (ec.activeByContainer(n) ? 'Este contenedor ya tiene un control abierto.' : '') : 'Formato: 4 letras y 7 números.'; };
  inp.addEventListener('input', () => { const c = cleanContainer(inp.value); if (c !== inp.value) inp.value = c; check(); });
  form.querySelector('[data-pk="trip"]').addEventListener('click', async () => {
    const trips = allTrips().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 80);
    if (!trips.length) { toast('No hay viajes registrados.', { type: 'info' }); return; }
    const names = new Map(operatorList().map((o) => [o.id, o.name]));
    const x = await openPicker({ title: 'Viaje relacionado', allowNew: false, placeholder: 'Buscar ruta, referencia u operador', current: trip ? trip.id : '',
      items: trips.map((t) => ({ value: t.id, label: `${fmtFecha(t.date)} · ${t.origin} → ${t.destination}`, sub: [t.reference ? 'Ref. ' + t.reference : '', names.get(t.operatorId)].filter(Boolean).join(' · ') })) });
    if (x) { trip = allTrips().find((t) => t.id === x.value) || null; inp.value = ''; setTrip(); }
  });
  setTrip();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const n = cleanContainer(inp.value);
    if (!isContainer(n)) { toast('Escribe el número de contenedor: 4 letras y 7 números.', { type: 'warn' }); inp.focus(); return; }
    const ex = ec.activeByContainer(n);
    if (ex) { const v = await actionSheet({ title: 'Este contenedor ya tiene un control abierto.', message: `${n} · ${emptyStatus(ex.status).label}`, actions: [{ label: 'Ver registro', value: true, style: 'primary' }] }); if (v) { sh.close(); go(`/operacion/logistica/vacios/${ex.id}`); } return; }
    try {
      const { record } = await ec.create({ containerNumber: n, tripId: trip ? trip.id : null, originalOperatorId: trip ? trip.operatorId : null, division: trip ? trip.division : '', origin: trip ? trip.origin : '', destination: trip ? trip.destination : '', reference: trip ? trip.reference || '' : '', vehicleId, logisticsOperationId: operationId, documentId: trip ? trip.documentId || null : null });
      sh.close(); toast('Vacío registrado'); go(`/operacion/logistica/vacios/${record.id}`);
    } catch (err) { toast(err.message || 'No se pudo registrar.', { type: 'warn' }); }
  });
}

/* Aviso tras pasar una operación de Logística a «Vacío» */
export function notifyEmptyResult(res, { vehicleId = null, operationId = null } = {}) {
  if (!res) return;
  if (res.created.length) { const r = res.created[0]; toast(res.created.length === 1 ? `Control de vacío creado: ${r.containerNumber}` : `Controles de vacío creados: ${res.created.map((x) => x.containerNumber).join(', ')}`, { action: { label: 'Ver', fn: () => go(`/operacion/logistica/vacios/${r.id}`) } }); return; }
  if (res.existing.length) { const r = res.existing[0]; toast(`${r.containerNumber} ya tenía un control de vacío abierto`, { type: 'info', action: { label: 'Ver', fn: () => go(`/operacion/logistica/vacios/${r.id}`) } }); return; }
  if (res.none) toast('El viaje no tiene número de contenedor: no se creó control de vacío.', { type: 'info', ms: 6000, action: { label: 'Registrar', fn: () => openNewEmpty({ vehicleId, operationId }) } });
}
