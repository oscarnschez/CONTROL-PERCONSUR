/*
 * Operación → Órdenes de Servicio (expediente maestro del viaje; ver ORDENES.md)
 *   #/operacion/ordenes              indicadores, buscador, filtros y tarjetas («Abrir orden»)
 *   #/operacion/ordenes/:id          expediente: siguiente paso, avance por etapas y pestañas (Resumen, Documentos,
 *                                    Asignación, Seguimiento, Entrega, Control de vacíos, Finanzas, Historial)
 *                                    ?s=<pestaña> abre esa pestaña · ?a=doc|dispatch|deliver ejecuta esa acción al abrir
 *   #/operacion/ordenes/vincular     registros existentes sin orden (migración segura: respaldo primero, nada se recalcula)
 * Inicio → «Órdenes de servicio» (mountHomeOrders).
 * Cada dato se lee de su fuente (Control de llenos, Logística, viaje del operador, Control de vacíos); las acciones pasan por
 * services/orders.js, que valida, registra el historial y avisa a las pantallas abiertas.
 */
import { screen, on } from '../../core/dom.js';
import { go, back } from '../../core/router.js';
import * as so from '../../services/orders.js';
import * as lg from '../../services/logistics.js';
import * as fc from '../../services/fulls.js';
import * as ec from '../../services/empties.js';
import * as ops from '../../services/operators.js';
import * as al from '../../services/alerts.js';
import * as drafts from '../../services/drafts.js';
import { loadBilling, billingOf } from '../../services/billing.js';
import { exportBackup } from '../../services/backup.js';
import { downloadBlob } from '../../services/share.js';
import { listAll, trailerTypeLabel } from '../../services/catalogs.js';
import { isReadOnly } from '../../services/access.js';
import { getCompany } from '../../services/companies.js';
import { setSetting } from '../../services/settings.js';
import { targetOf } from '../../services/destinations.js';
import { LOGISTICS_STATUSES, statusOf as lgStatus } from '../../config/logistics.js';
import { PUERTO_COMPANIES } from '../../config/companies.js';
import * as D from '../../domain/orders/orders.js';
import { eventLabel as fullEventLabel, weightText, addDays, rangeDates } from '../../domain/fulls/fulls.js';
import { blankCont, puertoHasData, PUERTO_STEPS } from '../../domain/puerto/model.js';
import { cpBlank, cpUnit, campoHasData, CAMPO_STEPS } from '../../domain/campo/model.js';
import { money, centsInput } from '../../domain/operators/money.js';
import { tripTaxes } from '../../domain/operators/taxes.js';
import { fmtDate, todayStr, ruleFromSettings } from '../../domain/operators/balance.js';
import { esc, agoText, nowParts } from '../../domain/shared/format.js';
import { icon } from '../components/icons.js';
import { openSheet, actionSheet, confirmDestructive, busy } from '../components/sheet.js';
import { openPicker } from '../components/picker.js';
import { toast } from '../components/toast.js';
import { createPuertoDraft, discardDraft, draftRoute } from '../flows.js';
import { createGpsPanel } from './gpsPanel.js';
import { openDeliveryForm, openDeliverSheet, emptyChip, whenText } from './empties.js';
import { openTripForm } from './operatorForms.js';
import { openBillingDetail } from './billing.js';
import { mountOrderDocs, openOrderDossier, uploadTo } from './orderDocs.js';
import { orderHref, orderPath, editPath, toneChip, askText } from './orderKit.js';

const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;
const dt = (ts) => (ts ? new Date(ts).toLocaleString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const o2 = (x) => (x ? esc(x) : '<i>—</i>');
const row = (k, v) => `<div><dt>${k}</dt><dd>${v || '<i>—</i>'}</dd></div>`;
const docName = (o) => (o.division === 'campo' ? 'asignación de unidades' : 'nota de entrega');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const err = (e) => toast(e && e.message ? e.message : 'No se pudo completar la acción.', { type: 'warn', ms: 4500 });
/* Última actividad de la orden o de sus fuentes */
const lastAt = (o, r) => Math.max(o.updatedAt || 0, (r.op && r.op.updatedAt) || 0, (r.load && r.load.updatedAt) || 0, (r.empty && r.empty.updatedAt) || 0);

/* ===== Listado ===== */
const SCOPES = [['active', 'Activas'], ['finished', 'Finalizadas'], ['all', 'Todas']];
const RANGES = [['all', 'Todas las fechas'], ['today', 'Hoy'], ['week', 'Próximos 7 días'], ['month', 'Este mes'], ['past', 'Fecha ya pasada'], ['custom', 'Rango de fechas…']];
const TILE_TONE = { pending: 'amber', ready: 'violet', operating: 'blue', delivered: 'teal', returns: 'amber', closed: 'ok', incidents: 'orange' };

function card(x) {
  const o = x.order, s = x.state, v = x.view, ref = v.container || v.reference;
  return `<a class="so-card lg-t-${s.tone}" href="${orderHref(o.id)}">
    <div class="so-c1"><b class="so-folio mono">${esc(o.folio)}</b><span class="so-div">${esc(D.divisionLabel(o.division, true))}</span>${toneChip(s)}</div>
    <div class="so-cust">${v.customer ? esc(v.customer) : '<span class="muted">Cliente sin indicar</span>'}</div>
    ${v.origin || v.destination ? `<div class="lg-route">${esc(v.origin || '—')}<span class="arr" aria-label="a">→</span>${esc(v.destination || '—')}</div>` : ''}
    <div class="so-meta">${[v.date ? esc(fmtDate(v.date)) : '', ref ? `<span class="mono">${esc(ref)}</span>` : '', v.unit ? `Unidad <b>${esc(v.unit)}</b>` : '<span class="muted">Sin unidad</span>', v.operator ? esc(v.operator) : ''].filter(Boolean).join('<span class="dot">·</span>')}</div>
    <div class="so-nextl">${icon.flag}<span>${esc(s.next.text)}</span></div>
    <div class="so-foot"><small>Actualizada ${esc(agoText(lastAt(o, x.r)))}</small><span class="btn-secondary sm so-open">Abrir orden${icon.chev}</span></div>
  </a>`;
}

export async function ordersScreen(params, q) {
  await so.loadOrders();
  const f = { scope: 'active', text: '', division: 'all', customerId: '', status: 'all', range: 'all', from: '', to: '', vehicleId: '', operatorId: '', docs: 'all', tile: '' };
  if (q && q.get('t')) { f.tile = q.get('t'); f.scope = 'all'; }
  let shown = 30;
  const s = screen(`<div class="page wide so-page">
    <header class="nav-top"><button type="button" class="nav-back" data-back>${icon.back}<span>Operación</span></button>
      <button type="button" class="nav-act" data-new data-w aria-label="Nueva orden">${icon.plus}</button></header>
    <h1 class="title so-title">Órdenes de Servicio</h1>
    <p class="page-lead">Administración integral de operaciones de transporte.</p>
    <button type="button" class="btn-primary block lg so-new" data-new data-w>${icon.plus}<span>Nueva orden</span></button>
    <div class="tiles so-tiles" data-tiles></div>
    <label class="search"><span class="search-ic">${icon.search}</span><input type="search" class="search-in" placeholder="Folio, referencia, contenedor, cliente…" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search" aria-label="Buscar órdenes"></label>
    <div class="chips filters" data-f1 role="group" aria-label="Órdenes"></div>
    <div class="chips filters" data-f2 role="group" aria-label="Filtros"></div>
    <div data-list aria-live="polite"></div>
    <div data-legacy></div>
  </div>`);
  const root = s.el;
  function draw() {
    const rows = so.rows(), counts = D.tileCounts(rows);
    root.querySelector('[data-tiles]').innerHTML = D.TILES.map(([k, l]) => `<button type="button" class="tile so-tile lg-t-${TILE_TONE[k]}${f.tile === k ? ' on' : ''}" data-tile="${k}" aria-pressed="${f.tile === k}" aria-label="${esc(l)}: ${counts[k]}"><small>${esc(l)}</small><b>${counts[k]}</b></button>`).join('');
    root.querySelector('[data-f1]').innerHTML = SCOPES.map(([k, l]) => `<button type="button" class="chip${f.scope === k && !f.tile ? ' on' : ''}" data-scope="${k}" aria-pressed="${f.scope === k && !f.tile}">${esc(l)}</button>`).join('')
      + (f.tile ? `<button type="button" class="chip on" data-tile="${f.tile}">${esc((D.TILES.find(([k]) => k === f.tile) || [])[1] || '')}${icon.close}</button>` : '');
    const cust = f.customerId ? so.placeById(f.customerId) : null, u = f.vehicleId ? lg.unitById(f.vehicleId) : null, op = f.operatorId ? ops.operatorById(f.operatorId) : null;
    const rl = f.range === 'custom' ? `${f.from ? fmtDate(f.from) : '…'} – ${f.to ? fmtDate(f.to) : '…'}` : (RANGES.find(([k]) => k === f.range) || [])[1];
    root.querySelector('[data-f2]').innerHTML = [
      ['division', f.division === 'all' ? 'División' : D.divisionLabel(f.division, true), f.division !== 'all'], ['customer', cust ? cust.name : 'Cliente', !!f.customerId],
      ['status', f.status === 'all' ? 'Estado' : D.globalState(f.status).label, f.status !== 'all'], ['range', f.range === 'all' ? 'Fecha' : rl, f.range !== 'all'],
      ['vehicle', u ? u.label : 'Unidad', !!f.vehicleId], ['operator', op ? op.name.split(' ').slice(0, 2).join(' ') : 'Operador', !!f.operatorId],
      ['docs', f.docs === 'all' ? 'Documentación' : f.docs === 'complete' ? 'Doc. completa' : 'Doc. pendiente', f.docs !== 'all'],
    ].map(([k, l, onf]) => `<button type="button" class="chip${onf ? ' on' : ''}" data-f="${k}">${esc(l)}${onf ? icon.close : icon.down}</button>`).join('');
    const today = todayStr();
    const range = f.range === 'custom' ? { from: f.from, to: f.to } : f.range === 'past' ? { from: '', to: addDays(today, -1) } : f.range === 'all' ? {} : rangeDates(f.range, today);
    const list = D.sortRows(D.filterRows(rows, { text: f.text, division: f.division, customerId: f.customerId, status: f.status, vehicleId: f.vehicleId, operatorId: f.operatorId, docs: f.docs, scope: f.tile ? 'all' : f.scope, tile: f.tile, from: range.from || '', to: range.to || '' }));
    const any = f.text || f.division !== 'all' || f.customerId || f.status !== 'all' || f.range !== 'all' || f.vehicleId || f.operatorId || f.docs !== 'all' || f.tile;
    const title = f.tile ? (D.TILES.find(([k]) => k === f.tile) || [])[1] : (SCOPES.find(([k]) => k === f.scope) || [])[1];
    root.querySelector('[data-list]').innerHTML = !so.all().length
      ? `<div class="empty"><p><b class="empty-t">Aún no hay órdenes de servicio</b>Crea la primera: cliente, ruta y, cuando los tengas, contenedor, documentos y transporte. Cada orden recibe un folio OS-${new Date().getFullYear()}-000001 en adelante.</p>${isReadOnly() ? '' : `<button type="button" class="btn-primary sm" data-new>${icon.plus}<span>Nueva orden</span></button>`}</div>`
      : `<div class="sec-hrow"><h2 class="sec-h">${esc(title || 'Órdenes')}</h2><span class="count">${list.length}</span></div>
        ${list.length ? `<div class="so-cards">${list.slice(0, shown).map(card).join('')}</div>${list.length > shown ? `<button type="button" class="btn-ghost block" data-more>Mostrar más (${list.length - shown})</button>` : ''}`
    : `<div class="empty"><p>${any ? 'Sin órdenes con estos filtros.' : f.scope === 'finished' ? 'Aún no hay órdenes finalizadas.' : 'No hay órdenes activas.'}</p></div>`}`;
    const legacy = isReadOnly() ? [] : so.legacyCandidates();
    root.querySelector('[data-legacy]').innerHTML = legacy.length ? `<a class="so-legacy" href="#/operacion/ordenes/vincular">${icon.link}<span><b>Registros existentes sin orden</b><small>${plural(legacy.length, 'operación o carga abierta', 'operaciones o cargas abiertas')} de antes de las órdenes. Vincúlalas para verlas aquí.</small></span>${icon.chev}</a>` : '';
  }
  on(root, 'click', '[data-back]', () => back('/operacion'));
  on(root, 'click', '[data-new]', () => go('/operacion/ordenes/nueva'));
  on(root, 'click', '[data-more]', () => { shown += 30; draw(); });
  on(root, 'click', '[data-scope]', (e, b) => { f.scope = b.dataset.scope; f.tile = ''; shown = 30; draw(); });
  on(root, 'click', '[data-tile]', (e, b) => { f.tile = f.tile === b.dataset.tile ? '' : b.dataset.tile; shown = 30; draw(); if (f.tile) root.querySelector('[data-f1]').scrollIntoView({ block: 'start', behavior: 'smooth' }); });
  on(root, 'click', '[data-f]', async (e, b) => {
    const k = b.dataset.f, rows = so.rows();
    if (k === 'division') { f.division = f.division === 'all' ? 'puerto' : f.division === 'puerto' ? 'campo' : 'all'; draw(); return; }
    if (k === 'docs') { f.docs = f.docs === 'all' ? 'pending' : f.docs === 'pending' ? 'complete' : 'all'; draw(); return; }
    if (k === 'status') { if (f.status !== 'all') { f.status = 'all'; draw(); return; } const v = await actionSheet({ title: 'Estado de la orden', actions: D.GLOBAL_STATES.map((x) => ({ label: x.label, value: x.key })) }); if (v) { f.status = v; if (!D.globalState(v).active) f.scope = 'all'; draw(); } return; }
    if (k === 'range') {
      if (f.range !== 'all') { f.range = 'all'; f.from = ''; f.to = ''; draw(); return; }
      const v = await actionSheet({ title: 'Fecha del servicio', actions: RANGES.filter(([x]) => x !== 'all').map(([key, l]) => ({ label: l, value: key })) });
      if (!v) return;
      if (v === 'custom') { const r = await askRange(f); if (!r) return; f.from = r.from; f.to = r.to; }
      f.range = v; draw(); return;
    }
    const key = { customer: 'customerId', vehicle: 'vehicleId', operator: 'operatorId' }[k];
    if (f[key]) { f[key] = ''; draw(); return; }
    let items = [];
    if (k === 'customer') { const used = new Set(rows.map((x) => x.order.customerId).filter(Boolean)); items = listAll('places').filter((p) => used.has(p.id)).map((p) => ({ value: p.id, label: p.name })); }
    if (k === 'vehicle') { const used = new Set(rows.map((x) => x.view.vehicleId).filter(Boolean)); items = lg.units().filter((x) => used.has(x.id)).map((x) => ({ value: x.id, label: x.label, sub: x.placas })); }
    if (k === 'operator') { const used = new Set(rows.map((x) => x.view.operatorId).filter(Boolean)); items = ops.operatorList().filter((x) => used.has(x.id)).map((x) => ({ value: x.id, label: x.name })); }
    if (!items.length) { toast('Aún no hay órdenes con este dato.', { type: 'info' }); return; }
    const r = await openPicker({ title: { customer: 'Cliente', vehicle: 'Unidad', operator: 'Operador' }[k], allowNew: false, items });
    if (r) { f[key] = r.value; draw(); }
  });
  root.querySelector('.search-in').addEventListener('input', (e) => { f.text = e.target.value; shown = 30; draw(); });
  draw();
  const unsub = [so.onOrdersChange(draw), lg.onLogisticsChange(draw), fc.onFullsChange(draw), ec.onEmptiesChange(draw)];
  s.cleanup = () => unsub.forEach((u) => u());
  return s;
}
function askRange(f) {
  return new Promise((resolve) => {
    const form = document.createElement('form'); form.className = 'op-form'; form.noValidate = true;
    form.innerHTML = `<div class="row2"><label class="fld"><span class="fl">Desde</span><input class="in" type="date" name="from" value="${esc(f.from || todayStr())}"></label><label class="fld"><span class="fl">Hasta</span><input class="in" type="date" name="to" value="${esc(f.to || addDays(todayStr(), 30))}"></label></div>
      <div class="sheet-acts"><button type="button" class="btn-secondary" data-cancel>Cancelar</button><button type="submit" class="btn-primary">Aplicar</button></div>`;
    let done = false;
    const sh = openSheet({ title: 'Rango de fechas', body: form, onClose: () => { if (!done) resolve(null); } });
    form.querySelector('[data-cancel]').addEventListener('click', () => sh.close());
    form.addEventListener('submit', (e) => { e.preventDefault(); const from = form.elements.from.value, to = form.elements.to.value; if (from && to && from > to) { toast('La fecha inicial es posterior a la final.', { type: 'warn' }); return; } done = true; resolve({ from, to }); sh.close(); });
  });
}

/* ===== Expediente ===== */
const TABS = [['resumen', 'Resumen'], ['docs', 'Documentos'], ['asignacion', 'Asignación'], ['seguimiento', 'Seguimiento'], ['entrega', 'Entrega'], ['vacio', 'Control de vacíos'], ['finanzas', 'Finanzas'], ['historial', 'Historial']];
const STEP_TAB = { capture: 'resumen', docs: 'docs', assign: 'asignacion', dispatch: 'seguimiento', delivery: 'entrega', empty: 'vacio', close: 'resumen' };
const NEXT_LABEL = { edit: 'Completar la orden', docs: 'Ir a la documentación', assign: 'Asignar transporte', dispatch: 'Confirmar asignación y despachar', advance: 'Confirmar salida', deliver: 'Registrar entrega', track: 'Ver seguimiento', empty: 'Marcar contenedor vacío', return_schedule: 'Programar devolución', return_confirm: 'Confirmar devolución', incidents: 'Ver incidencias', close: 'Cerrar orden', summary: 'Ver expediente completo' };
const NEXT_ICON = { edit: 'edit', docs: 'paperclip', assign: 'truck', dispatch: 'truck', advance: 'route', deliver: 'check', track: 'map', empty: 'container', return_schedule: 'calendar', return_confirm: 'check', incidents: 'alert', close: 'check', summary: 'file' };

export async function orderDetailScreen({ id }, q) {
  await so.loadOrders();
  await Promise.all([loadBilling(), al.loadAlerts().catch(() => {})]);
  if (!so.byId(id)) { toast('Esa orden ya no existe.', { type: 'info' }); go('/operacion/ordenes', { replace: true }); return null; }
  const s = screen('<div class="page lg-page so-detail"></div>');
  const root = s.el;
  const tabs = () => TABS.filter(([k]) => k !== 'vacio' || so.byId(id).division === 'puerto');
  let tab = q && tabs().some(([k]) => k === q.get('s')) ? q.get('s') : 'resumen';
  let gpsPanel = null, gpsFor = null, mounts = [];
  const ro = isReadOnly();

  function ensureGps(op) {
    const vid = op && !op.closedAt ? op.vehicleId : null;
    if (gpsFor === vid) return gpsPanel;
    if (gpsPanel) { gpsPanel.destroy(); gpsPanel = null; }
    gpsFor = vid;
    if (!vid) return null;
    gpsPanel = createGpsPanel({ vehicleId: vid, label: (lg.unitById(vid) || {}).label || '',
      status: () => { const cur = so.opOf(so.byId(id)), st = lgStatus(cur ? cur.status : 'inactive'); return { key: st.key, tone: st.tone, chip: `<span class="lg-st lg-t-${st.tone} lg-big"><i aria-hidden="true"></i>${esc(st.label)}</span>` }; },
      target: () => targetOf(so.opOf(so.byId(id))) });
    return gpsPanel;
  }

  async function draw() {
    const o = so.byId(id);
    if (!o) { go('/operacion/ordenes', { replace: true }); return; }
    const r = so.resolved(o), st = so.stateOf(o, r), t = D.opTypeOf(o.opType, o.division), y = window.scrollY;
    const closed = st.key === 'closed', cancelled = st.key === 'cancelled', op = r.op, opOpen = !!(op && !op.closedAt);
    if (!tabs().some(([k]) => k === tab)) tab = 'resumen';
    const act = st.next.action;
    const primary = act && act !== 'summary' && !closed && !cancelled ? `<button type="button" class="btn-primary block lg" data-act="${act}" data-w>${icon[NEXT_ICON[act]] || icon.chev}<span>${esc(NEXT_LABEL[act] || st.next.text)}</span></button>` : '';
    const sec = [];
    if (!closed && !cancelled) {
      if (!op) sec.push(['edit', 'Editar', 'edit']);
      if (opOpen && !o.delivery && act !== 'advance') sec.push(['status', 'Actualizar estado', 'refresh']);
      if (opOpen && !o.delivery && act !== 'deliver') sec.push(['deliver', 'Registrar entrega', 'check']);
      sec.push(['doc', (o.generated || []).length ? 'Nueva versión' : o.division === 'campo' ? 'Generar asignación' : 'Generar nota', 'file']);
      if (op) sec.push(['incident', 'Incidencia', 'alert']);
    }
    const genLatest = so.latestGenerated(o), outdated = genLatest ? D.outdatedFields(genLatest.snapshot, r) : [];
    root.innerHTML = `
      <header class="nav-top"><button type="button" class="nav-back" data-back>${icon.back}<span>Órdenes</span></button>
        <button type="button" class="nav-act" data-moreacts aria-label="Más acciones">${icon.more}</button></header>
      <section class="lg-hero so-hero lg-t-${st.tone}">
        <div class="so-hero-top"><small>${esc(D.divisionLabel(o.division))} · ${esc(t.label)}</small>${toneChip(st, 'lg-big')}</div>
        <h1 class="so-folio big mono">${esc(o.folio)}</h1>
        <p class="lg-hero-sub"><b>${r.customer ? esc(r.customer) : 'Cliente sin indicar'}</b>${r.origin || r.destination ? `<br>${esc(r.origin || '—')} → ${esc(r.destination || '—')}` : ''}${r.date ? `<span class="so-when">${icon.calendar}<span>${esc(fmtDate(r.date))}${r.scheduledTime ? ' · ' + esc(r.scheduledTime) : ''}</span></span>` : ''}</p>
        ${closed ? `<div class="so-final">${icon.check}<div><b>ORDEN FINALIZADA</b><small>Cerrada ${esc(dt(o.closedAt))}${o.closedBy ? ' por ' + esc(o.closedBy) : ''}</small></div></div>
          <button type="button" class="btn-primary block lg" data-act="summary">${icon.file}<span>Ver expediente completo</span></button>`
    : cancelled ? `<div class="so-final off">${icon.close}<div><b>ORDEN CANCELADA</b><small>${esc(o.cancelReason || '')}</small></div></div>`
      : `<div class="so-nextbox" role="status"><small>Siguiente paso</small><b>${esc(st.next.text)}</b></div>${primary}
        ${sec.length ? `<div class="so-acts" data-w>${sec.map(([a, l, ic]) => `<button type="button" class="btn-secondary" data-act="${a}">${icon[ic]}<span>${esc(l)}</span></button>`).join('')}</div>` : ''}`}
        ${o.pending && o.pending.length && !closed ? `<p class="so-pend">${icon.info}<span>Registro vinculado desde datos anteriores. Datos pendientes: ${esc(o.pending.join(', '))}.</span></p>` : ''}
      </section>
      <ol class="so-prog" aria-label="Avance de la orden">${st.progress.map((p, i) => `<li class="st-${p.state}"><button type="button" data-step="${p.key}" aria-current="${p.state === 'current' ? 'step' : 'false'}"><i aria-hidden="true">${p.state === 'done' ? icon.check : i + 1}</i><span>${esc(p.label)}</span></button></li>`).join('')}</ol>
      <nav class="so-tabs" role="tablist" aria-label="Secciones de la orden">${tabs().map(([k, l]) => `<button type="button" role="tab" class="so-tab${k === tab ? ' on' : ''}" aria-selected="${k === tab}" data-tab="${k}">${esc(l)}${tabBadge(k, o, st, r)}</button>`).join('')}</nav>
      <div class="so-panel" role="tabpanel" data-panel>${panel(tab, o, r, st, { outdated, genLatest })}</div>`;
    mounts = [];
    root.querySelectorAll('[data-docbox]').forEach((box) => mounts.push(mountOrderDocs(box, id, { kind: box.dataset.docbox })));
    /* Avance: la etapa actual a la vista */
    const prog = root.querySelector('.so-prog'), cur = prog && prog.querySelector('.st-current');
    if (cur) prog.scrollLeft = Math.max(0, cur.offsetLeft - prog.clientWidth / 2 + cur.clientWidth / 2);
    const slot = root.querySelector('[data-gps-slot]');
    if (slot) { const p = ensureGps(op); if (p) { slot.replaceWith(p.el); p.refresh(); p.resize(); } else slot.remove(); }
    window.scrollTo(0, y);
  }

  /* ===== Pestañas ===== */
  function tabBadge(k, o, st, r) {
    if (k === 'docs' && o.division === 'puerto' && !st.docs.complete) return '<i class="so-dot amber" aria-label="pendiente"></i>';
    if (k === 'seguimiento' && st.incidents.length) return `<i class="so-n">${st.incidents.length}</i>`;
    if (k === 'vacio' && ['pending', 'scheduled', 'in_transit'].includes(st.ret.key)) return '<i class="so-dot amber" aria-label="pendiente"></i>';
    if (k === 'asignacion' && st.missing.resources.length && !r.op) return '<i class="so-dot amber" aria-label="pendiente"></i>';
    return '';
  }
  function panel(k, o, r, st, x) {
    switch (k) {
      case 'docs': return docsTab(o, st, x);
      case 'asignacion': return assignTab(o, r, st);
      case 'seguimiento': return trackTab(o, r, st);
      case 'entrega': return deliveryTab(o, r, st);
      case 'vacio': return emptyTab(o, r, st);
      case 'finanzas': return financeTab(o, r, st);
      case 'historial': return historyTab(o, r);
      default: return summaryTab(o, r, st, x);
    }
  }
  function summaryTab(o, r, st, x) {
    const t = D.opTypeOf(o.opType, o.division), cust = r.customerRec, trip = r.trip, bill = trip ? billingOf(trip.id) : null;
    const links = [
      r.load ? row('Control de llenos', `<a href="#/operacion/logistica/llenos/${esc(r.load.id)}">Carga ${esc(r.load.containerNumber)}</a><small>${esc(fmtDate(r.load.scheduledDate))} · ${esc(r.load.scheduledTime)}</small>`) : t.fullLoad ? row('Control de llenos', '<i>Se programa al completar contenedor, peso, terminal o patio, fecha y hora</i>') : '',
      r.op ? row('Logística', `<a href="#/operacion/logistica/u/${esc(r.op.vehicleId)}">${esc(lg.view(r.op).label)} · ${esc(r.op.closedAt ? 'Operación cerrada' : lgStatus(r.op.status).label)}</a>`) : row('Logística', '<i>Se crea al despachar</i>'),
      trip ? row('Viaje del operador', `<a href="#/operadores/${esc(trip.operatorId)}?viaje=${esc(trip.id)}">${esc(fmtDate(trip.date))} · ${esc(money(trip.fare))}</a><small>${bill && bill.paid ? 'Pagado' : 'Por cobrar'}</small>`) : row('Viaje del operador', o.finance && o.finance.fare ? '<i>Se registra una sola vez al despachar</i>' : '<i>Sin tarifa capturada</i>'),
      o.division === 'puerto' && t.emptyReturn ? row('Control de vacíos', r.empty ? `<a href="#/operacion/logistica/vacios/${esc(r.empty.id)}">${esc(r.empty.containerNumber)}</a><small>${esc(st.ret.label)}</small>` : `<i>${esc(st.ret.label)}</i>`) : '',
      x.genLatest ? row(cap(docName(o)), `<a href="#/doc/${esc(x.genLatest.documentId)}">Folio ${esc(x.genLatest.folio)} · versión ${x.genLatest.version}</a>${x.outdated.length ? `<small class="warn-t">Cambió: ${esc(x.outdated.join(', '))}. Genera una versión nueva.</small>` : ''}`) : row(cap(docName(o)), '<i>Sin generar</i>'),
    ].join('');
    return `<section class="grp"><div class="grp-h"><h3>Estados</h3></div><dl class="sumlist lg-sum so-states">
        ${row('Orden', toneChip(st))}${row('Logístico', toneChip(st.logistics))}${o.division === 'puerto' ? row('Documental', toneChip(st.docs)) : ''}
        ${row('Entrega', toneChip(st.delivery))}${o.division === 'puerto' ? row('Devolución del vacío', toneChip(st.ret)) : ''}${row('Financiero', toneChip(st.finance))}
        ${row('Cierre operativo', o.closedAt ? toneChip({ label: 'Finalizada', tone: 'ok' }) : toneChip({ label: 'Pendiente', tone: 'light' }))}
        ${row('Cierre administrativo', bill && bill.paid ? toneChip({ label: 'Cobrado', tone: 'ok' }) : trip ? toneChip({ label: 'Pendiente de cobro', tone: 'amber' }) : toneChip({ label: 'Sin viaje registrado', tone: 'light' }))}
      </dl></section>
      <section class="grp"><div class="grp-h"><h3>Información general</h3>${editBtn(o, 0)}</div><dl class="sumlist lg-sum">
        ${row('Folio', `<b class="mono">${esc(o.folio)}</b>`)}${row('División', esc(D.divisionLabel(o.division)))}${row('Operación', esc(t.label))}
        ${o.division === 'puerto' ? row('Empresa', esc(getCompany(o.companyId).short)) : ''}
        ${row('Cliente', r.customer ? `${esc(r.customer)}${cust && cust.address ? `<small>${esc(cust.address)}</small>` : ''}` : '')}${o.requester ? row('Solicitante', esc(o.requester)) : ''}
        ${o.contactName || o.contactPhone ? row('Contacto', `${esc(o.contactName || '')}${o.contactPhone ? `<small><a href="tel:${esc(o.contactPhone.replace(/[^\d+]/g, ''))}">${esc(o.contactPhone)}</a></small>` : ''}`) : ''}
        ${row('Fecha del servicio', o.serviceDate ? esc(fmtDate(o.serviceDate)) : '')}${o.commercialRef ? row('Referencia comercial', esc(o.commercialRef)) : ''}
        ${o.instructions ? row('Instrucciones', esc(o.instructions)) : ''}
      </dl></section>
      <section class="grp"><div class="grp-h"><h3>Transporte</h3>${editBtn(o, 1)}</div><dl class="sumlist lg-sum">
        ${row('Origen', o2(r.origin))}${row('Destino', o2(r.destination))}${row('Lugar de entrega', o2(r.deliveryPlace))}
        ${o.division === 'campo' && r.plant ? row('Planta', esc(r.plant)) : ''}
        ${t.container ? row('Contenedor', r.containerNumber ? `<b class="mono">${esc(r.containerNumber)}</b>${o.containerType ? `<small>${esc(o.containerType)}</small>` : ''}` : '') : ''}
        ${t.container && r.weightKg ? row('Peso', esc(weightText(r.weightKg))) : ''}
        ${t.fullLoad ? row(r.locationType === 'offport' ? 'Patio de carga' : 'Terminal', o2(r.place)) : ''}
        ${row(t.fullLoad ? 'Cita' : 'Programada', r.scheduledDate ? `${esc(fmtDate(r.scheduledDate))} · ${esc(r.scheduledTime || '')}` : '')}
        ${o.cargoType ? row('Tipo de carga', esc(o.cargoType)) : ''}${o.reference ? row('Referencia', `<span class="mono">${esc(o.reference)}</span>`) : ''}
        ${o.bl ? row('BL', esc(o.bl)) : ''}${o.pedimento ? row('Pedimento', esc(o.pedimento)) : ''}${o.cartaPorte ? row('Carta porte', esc(o.cartaPorte)) : ''}
        ${r.returnYard ? row('Patio para el vacío', esc(r.returnYard)) : ''}${o.notes ? row('Observaciones', esc(o.notes)) : ''}
      </dl></section>
      <section class="grp"><div class="grp-h"><h3>Registros vinculados</h3></div><dl class="sumlist lg-sum so-links">${links}</dl>
        <p class="grp-note">Cada dato vive en su módulo: un cambio allá se ve aquí al momento (y al revés), sin capturarlo dos veces.</p></section>
      <p class="grp-note">Creada ${esc(dt(o.createdAt))}${o.createdBy ? ' por ' + esc(o.createdBy) : ''} · Última actualización ${esc(dt(lastAt(o, r)))}${o.updatedBy ? ' por ' + esc(o.updatedBy) : ''}</p>`;
  }
  const editBtn = (o, step) => (o.closedAt || o.phase === 'cancelled' ? '' : `<button type="button" class="btn-ghost sm" data-edit="${step}" data-w>${icon.edit}<span>Editar</span></button>`);
  function docsTab(o, st, x) {
    const gen = so.generatedOf(o);
    return `<section class="grp"><div class="grp-h"><h3>${o.division === 'puerto' ? 'Documentación portuaria' : 'Documentos'}</h3>${o.division === 'puerto' ? toneChip(st.docs) : ''}</div><div class="grp-b" data-docbox="docs"></div></section>
      <section class="grp"><div class="grp-h"><h3>${cap(docName(o))}</h3></div><div class="grp-b">
        ${gen.length ? `<ul class="att-list so-gen">${gen.map((g, i) => { const out = i === 0 ? x.outdated : []; return `<li class="att"><span class="att-ic pdf">PDF</span><span class="att-tx"><b>Folio ${esc(g.folio)} · versión ${g.version}${i === 0 ? ' <small class="so-cur">vigente</small>' : ''}</b><small>${esc(dt(g.at))}${g.by ? ' · ' + esc(g.by) : ''}${g.migrated ? ' · documento anterior' : ''}${out.length ? `<span class="warn-t"> · Cambió: ${esc(out.join(', '))}</span>` : ''}</small></span><span class="att-b"><a class="btn-ghost sm" href="#/doc/${esc(g.documentId)}">Ver</a></span></li>`; }).join('')}</ul>` : `<p class="grp-note">Aún no se genera. Se llena con los datos de la orden (cliente, unidad, operador, remolque, contenedor y cita) y puedes revisarla antes del PDF.</p>`}
        ${o.closedAt || o.phase === 'cancelled' ? '' : `<button type="button" class="btn-secondary block" data-act="doc" data-w>${icon.file}<span>${gen.length ? 'Generar versión nueva' : `Generar ${docName(o)}`}</span></button>`}
        ${x.outdated.length ? `<p class="so-src warn">${icon.alert}<span>La versión vigente ya no coincide con la orden (${esc(x.outdated.join(', '))}). Las versiones anteriores se conservan.</span></p>` : ''}
      </div></section>`;
  }
  function assignTab(o, r, st) {
    const selfId = r.op ? r.op.id : null;
    const res = (label, id, name, sub, av, href) => row(label, id ? `${href ? `<a href="${href}">${esc(name || '—')}</a>` : `<b>${esc(name || '—')}</b>`}${sub ? `<small>${esc(sub)}</small>` : ''}${av ? `<small>${toneChip(av)}</small>` : ''}` : '<i>Pendiente de asignar</i>');
    const hist = [...(o.assignments || [])].reverse();
    const nm = (kind, id) => { if (!id) return '—'; if (kind === 'u') { const u = lg.unitById(id); return u ? u.label : '(sin catálogo)'; } if (kind === 'o') { const p = ops.operatorById(id); return p ? p.name : '(sin catálogo)'; } const tt = lg.trailerById(id); return tt ? tt.placas : '(sin catálogo)'; };
    const can = !o.closedAt && o.phase !== 'cancelled';
    return `<section class="grp"><div class="grp-h"><h3>Transporte asignado</h3>${can ? `<button type="button" class="btn-ghost sm" data-edit="2" data-w>${icon.edit}<span>${r.vehicleId || r.operatorId ? 'Cambiar' : 'Asignar'}</span></button>` : ''}</div><dl class="sumlist lg-sum">
        ${res('Unidad', r.vehicleId, r.unit, r.placas, r.vehicleId && !r.op ? so.unitAvailability(r.vehicleId, selfId) : null, r.vehicleId ? `#/unidades/${encodeURIComponent(r.vehicleId)}` : '')}
        ${res('Operador', r.operatorId, r.operator, '', r.operatorId && !r.op ? so.operatorAvailability(r.operatorId, selfId) : null, r.operatorId ? `#/operadores/${encodeURIComponent(r.operatorId)}` : '')}
        ${res('Remolque / chasis', r.trailerId, r.trailer, r.trailerType ? trailerTypeLabel(r.trailerType) : '', r.trailerId && !r.op ? so.trailerAvailability(r.trailerId, selfId) : null, '')}
      </dl>${r.op ? `<p class="grp-note">Desde el despacho la asignación vive en Logística; cambiarla pide el motivo y queda en el historial.</p>` : `<p class="grp-note">Puedes dejar «Pendiente de asignar» y decidir después. Para despachar se piden unidad, operador${D.opTypeOf(o.opType, o.division).trailer ? ' y remolque' : ''}.</p>`}</section>
      <section class="grp"><div class="grp-h"><h3>Historial de asignación</h3><span class="count">${hist.length}</span></div>
        ${hist.length ? `<ol class="so-asg">${hist.map((a) => `<li><b>${esc(nm('u', a.vehicleId))} · ${esc(nm('o', a.operatorId))} · ${esc(nm('t', a.trailerId))}</b><small>${esc(dt(a.at))}${a.by ? ' · ' + esc(a.by) : ''}${a.afterDispatch ? ' · después del despacho' : ''}</small>${a.reason ? `<span>${esc(a.reason)}</span>` : ''}</li>`).join('')}</ol>` : '<p class="grp-note">Sin asignaciones registradas.</p>'}</section>`;
  }
  function trackTab(o, r, st) {
    const op = r.op, sug = op && !op.closedAt ? al.suggestionForOp(op) : null, inc = [...(o.incidents || [])].reverse();
    const ops2 = op ? `<section class="grp"><div class="grp-h"><h3>Estado en Logística</h3>${toneChip(st.logistics)}</div><dl class="sumlist lg-sum">
        ${row('Unidad', `<a href="#/operacion/logistica/u/${esc(op.vehicleId)}">${esc(lg.view(op).label)}</a>`)}${row('Despacho', esc(dt(o.dispatchedAt)) + (o.dispatchedBy ? `<small>${esc(o.dispatchedBy)}</small>` : ''))}
        ${row('Última actualización', esc(agoText(op.updatedAt)))}
      </dl>${!op.closedAt && !o.closedAt ? `<div class="sheet-acts" data-w><button type="button" class="btn-secondary" data-act="status">${icon.refresh}<span>Actualizar estado</span></button>${o.delivery ? '' : `<button type="button" class="btn-secondary" data-act="deliver">${icon.check}<span>Registrar entrega</span></button>`}</div>` : ''}
      ${op.status === 'assigned' && !op.closedAt ? '<p class="grp-note">«Asignada»: la unidad aún no sale. El rastreo para el cliente se comparte cuando confirmes la salida.</p>' : ''}</section>`
      : `<section class="grp"><div class="grp-h"><h3>Seguimiento</h3></div><p class="grp-note">El seguimiento empieza al confirmar la asignación y despachar. La unidad aparece entonces en Inicio → Unidades en operación.</p></section>`;
    const sugBox = sug ? `<div class="al-sugbox" role="status">${icon.flag}<div><b>${esc(sug.text)}</b><small>${esc(sug.event.name)} · ${esc(dt(sug.event.at))}. Sugerencia del GPS: ¿cambiar el estado a ${esc(lgStatus(sug.status).label)}?</small>
        ${ro ? '' : `<span class="al-sug"><button type="button" class="btn-primary sm" data-sugok="${esc(sug.status)}" data-ev="${esc(sug.event.id)}">Cambiar a ${esc(lgStatus(sug.status).label)}</button><button type="button" class="btn-ghost sm" data-sugno="${esc(sug.event.id)}">Ahora no</button></span>`}</div></div>` : '';
    const log = op && (op.statusLog || []).length ? `<section class="grp"><div class="grp-h"><h3>Bitácora de estados</h3></div><ol class="lg-log">${[...op.statusLog].reverse().slice(0, 12).map((l) => `<li><span class="lg-st lg-t-${lgStatus(l.status).tone} plain"><i aria-hidden="true"></i>${esc(l.closed ? 'Operación cerrada' : lgStatus(l.status).label)}</span><small>${esc(dt(l.at))}${l.by === 'Geocerca' ? ' · automático por geocerca' : l.by ? ' · ' + esc(l.by) : ''}</small></li>`).join('')}</ol></section>` : '';
    const incs = `<section class="grp"><div class="grp-h"><h3>Incidencias</h3>${o.closedAt || o.phase === 'cancelled' ? '' : `<button type="button" class="btn-ghost sm" data-act="incident" data-w>${icon.plus}<span>Registrar</span></button>`}</div>
      ${inc.length ? `<ul class="so-incs">${inc.map((i) => `<li class="${i.resolvedAt ? 'is-done' : i.critical ? 'crit' : ''}"><b>${i.critical ? 'Crítica · ' : ''}${esc(i.text)}</b><small>${esc(dt(i.at))}${i.by ? ' · ' + esc(i.by) : ''}${i.resolvedAt ? ` · Resuelta ${esc(dt(i.resolvedAt))}${i.resolution ? ': ' + esc(i.resolution) : ''}` : ''}</small>${!i.resolvedAt && !ro ? `<button type="button" class="btn-ghost sm" data-resolve="${esc(i.id)}">${icon.check}<span>Resolver</span></button>` : ''}</li>`).join('')}</ul>` : '<p class="grp-note">Sin incidencias. Las críticas abiertas impiden cerrar la orden.</p>'}</section>`;
    return `${sugBox}${ops2}${op && !op.closedAt ? '<div data-gps-slot></div>' : ''}${incs}${log}`;
  }
  function deliveryTab(o, r, st) {
    const d = o.delivery;
    return `<section class="grp"><div class="grp-h"><h3>Entrega</h3>${toneChip(st.delivery)}</div>
      ${d ? `<dl class="sumlist lg-sum">${row('Fecha y hora', `${esc(fmtDate(d.date))} · ${esc(d.time)}`)}${row('Lugar', o2(d.place))}${row('Recibió', o2(d.receiver))}${d.notes ? row('Observaciones', esc(d.notes)) : ''}${row('Registró', `${esc(d.by || '')}<small>${esc(dt(d.at))}</small>`)}</dl>
        ${o.closedAt || ro ? '' : `<button type="button" class="btn-ghost sm" data-act="deliver">${icon.edit}<span>Corregir entrega</span></button>`}`
    : `<p class="grp-note">${r.op ? 'Registra la fecha, la hora, el lugar, quién recibe y la evidencia.' : 'La entrega se registra después del despacho.'}${o.division === 'puerto' && st.needsReturn ? ' En Puerto, entregar el contenedor no cierra la orden: falta la devolución del vacío.' : ''}</p>
        ${r.op && !o.closedAt && !ro ? `<button type="button" class="btn-primary block" data-act="deliver">${icon.check}<span>Registrar entrega</span></button>` : ''}`}</section>
      <section class="grp"><div class="grp-h"><h3>Evidencia de entrega</h3></div><div class="grp-b" data-docbox="entrega"></div></section>`;
  }
  function emptyTab(o, r, st) {
    const t = D.opTypeOf(o.opType, o.division), e = r.empty;
    if (!t.emptyReturn) return `<section class="grp"><div class="grp-h"><h3>Control de vacíos</h3>${toneChip(st.ret)}</div><p class="grp-note">Este tipo de operación (${esc(t.label)}) no lleva devolución de contenedor vacío.</p></section>`;
    if (o.noEmptyReturn) return `<section class="grp"><div class="grp-h"><h3>Control de vacíos</h3>${toneChip(st.ret)}</div><dl class="sumlist lg-sum">${row('Excepción', esc(o.noEmptyReturn.reason))}${row('Autorizó', `${esc(o.noEmptyReturn.by || '')}<small>${esc(dt(o.noEmptyReturn.at))}</small>`)}</dl></section>`;
    if (!e) {
      return `<section class="grp"><div class="grp-h"><h3>Control de vacíos</h3>${toneChip(st.ret)}</div>
        <p class="grp-note">${o.delivery ? 'Cuando el cliente descargue, marca el contenedor como vacío: se crea (una sola vez) su registro en Control de vacíos con el contenedor, la unidad, el operador y el patio previsto.' : 'Primero se confirma la entrega del contenedor lleno; después se marca vacío y se programa su devolución al patio.'}</p>
        ${r.returnYard ? `<dl class="sumlist lg-sum">${row('Patio previsto', esc(r.returnYard))}</dl>` : ''}
        ${o.closedAt || ro ? '' : `<div class="sheet-acts" data-w><button type="button" class="btn-primary" data-act="empty"${o.delivery && r.op ? '' : ' disabled'}>${icon.container}<span>Marcar contenedor vacío</span></button><button type="button" class="btn-secondary" data-act="waive">${icon.minus}<span>No requiere devolución</span></button></div>`}</section>`;
    }
    const v = ec.view(e);
    return `<section class="grp"><div class="grp-h"><h3>Control de vacíos</h3>${emptyChip(e.status)}</div><dl class="sumlist lg-sum">
        ${row('Contenedor', `<a href="#/operacion/logistica/vacios/${esc(e.id)}" class="mono">${esc(e.containerNumber)}</a>`)}${row('Patio de entrega', o2(v.yard))}
        ${row(e.externalCarrier ? 'Transportista' : 'Entrega', o2(v.deliverer))}${e.scheduledDeliveryDate ? row('Programado', esc(whenText(e.scheduledDeliveryDate, e.scheduledDeliveryTime, { year: true }))) : ''}
        ${e.status === 'delivered' ? row('Entregado', esc(e.actualDeliveryDate ? whenText(e.actualDeliveryDate, e.actualDeliveryTime, { year: true }) : dt(e.deliveredAt))) : ''}
      </dl>
      ${o.closedAt || ro || e.status === 'delivered' ? '' : `<div class="sheet-acts" data-w><button type="button" class="btn-secondary" data-act="return_schedule">${icon.calendar}<span>${e.status === 'pending' ? 'Programar devolución' : 'Cambiar datos de entrega'}</span></button><button type="button" class="btn-primary" data-act="return_confirm">${icon.check}<span>Confirmar devolución</span></button></div>`}
      <p class="grp-note">El registro vive en Control de vacíos (otro transportista, patio y fecha se capturan ahí); la orden solo lo consulta.</p></section>
      <section class="grp"><div class="grp-h"><h3>Evidencia de devolución</h3></div><div class="grp-b" data-docbox="devolucion"></div></section>`;
  }
  function financeTab(o, r, st) {
    const trip = r.trip;
    if (trip) {
      const x = tripTaxes(trip), bill = billingOf(trip.id), opr = ops.operatorById(trip.operatorId);
      return `<section class="grp"><div class="grp-h"><h3>Viaje financiero</h3>${toneChip(st.finance)}</div><dl class="sumlist lg-sum so-fin">
          ${row('Operador', opr ? `<a href="#/operadores/${esc(opr.id)}?viaje=${esc(trip.id)}">${esc(opr.name)}</a>` : '')}${row('Fecha', esc(fmtDate(trip.date)))}
          ${row('Tarifa base', `<b>${esc(money(x.fareBase))}</b>`)}${x.applyVat ? row(`IVA ${x.vatRate}%`, esc(money(x.vatAmount))) : ''}${x.applyIsr ? row(`Retención ISR ${x.isrRate}%`, '−' + esc(money(x.isrAmount))) : ''}${x.applyVatWithholding ? row(`Retención IVA ${x.vatWithholdingRate}%`, '−' + esc(money(x.vatWithholdingAmount))) : ''}
          ${row('Total del servicio', `<b>${esc(money(x.totalAfterTaxes))}</b>`)}${row('Comisión del operador', `${esc(money(trip.finalCommission || 0))}${trip.isExpanded ? '<small>Comisión ampliada</small>' : ''}`)}${row('Gastos del viaje', esc(money(trip.travelExpenses || 0)))}
          ${row('Cobranza', bill && bill.paid ? `Pagado${bill.paidDate ? `<small>${esc(fmtDate(bill.paidDate))}</small>` : ''}` : 'Por cobrar')}
        </dl>${ro ? '' : `<div class="sheet-acts" data-w><button type="button" class="btn-secondary" data-act="trip">${icon.edit}<span>Editar viaje</span></button><button type="button" class="btn-secondary" data-act="billing">${icon.cash}<span>Cobranza</span></button></div>`}
        <p class="grp-note">El viaje es uno solo (no se duplica): la tarifa, los impuestos, los gastos, la comisión y el balance del operador se editan con las reglas de Operadores.</p></section>`;
    }
    const f = o.finance || D.defaultFinance(o.division), opr = r.operatorId ? ops.operatorById(r.operatorId) : null;
    const pv = D.financePreview(f, opr ? ruleFromOperator(opr.id) : null);
    return `<section class="grp"><div class="grp-h"><h3>Información económica</h3>${toneChip(st.finance)}</div><dl class="sumlist lg-sum so-fin">
        ${row('Tarifa base', f.fare ? `<b>${esc(money(f.fare))}</b>` : '<i>Sin capturar</i>')}${row('IVA 16%', f.applyVat ? esc(money(pv.taxes.vatAmount)) : '<i>No aplica</i>')}${row('Retención ISR 4%', f.applyIsr ? '−' + esc(money(pv.taxes.isrAmount)) : '<i>No aplica</i>')}${row('Retención IVA 4%', f.applyVatWithholding ? '−' + esc(money(pv.taxes.vatWithholdingAmount)) : '<i>No aplica</i>')}
        ${row('Total del servicio', `<b>${esc(money(pv.taxes.totalAfterTaxes))}</b>`)}${row('Comisión estimada', pv.commission ? `${esc(money(pv.commission.final))}${pv.commission.expanded ? '<small>Comisión ampliada</small>' : ''}` : '<i>Al asignar operador</i>')}${row('Gastos del viaje', esc(money(f.travelExpenses || 0)))}
      </dl>${o.closedAt || o.phase === 'cancelled' || ro ? '' : `<div class="sheet-acts" data-w><button type="button" class="btn-secondary" data-edit="4">${icon.edit}<span>Editar información económica</span></button>${r.op || !r.operatorId ? '' : `<button type="button" class="btn-ghost" data-act="linktrip">${icon.link}<span>Vincular viaje existente</span></button>`}</div>`}
      <p class="grp-note">Al despachar se registra el viaje del operador una sola vez, con estos importes y la comisión (15% de la tarifa sin IVA, o la mínima ampliada del operador). Sin tarifa no se crea viaje.</p></section>`;
  }
  function historyTab(o, r) {
    const tl = D.timeline({ events: so.eventsOf(o.id), op: r.op, loadEvents: r.load ? fc.eventsOf(r.load.id).map((e) => ({ ...e, label: fullEventLabel(e) })) : [], emptyEvents: r.empty ? ec.eventsOf(r.empty.id).map((e) => ({ ...e, label: ec.eventLabel(e) })) : [] });
    const SRC = { orden: 'Orden', logistica: 'Logística', llenos: 'Control de llenos', vacios: 'Control de vacíos' };
    return `<div class="sec-hrow"><h2 class="sec-h">Historial</h2><span class="count">${tl.length}</span></div>
      ${tl.length ? `<ol class="so-tl">${tl.slice(0, 200).map((e) => `<li class="src-${e.source}"><b>${esc(e.text)}</b>${e.details ? `<span>${esc(e.details)}</span>` : ''}<small>${esc(dt(e.at))}${e.by ? ' · ' + esc(e.by) : ''} · ${SRC[e.source]}</small></li>`).join('')}</ol>` : '<div class="empty"><p>Sin movimientos.</p></div>'}
      <p class="grp-note">Auditoría: cada cambio guarda quién y cuándo; la orden conserva sus 30 versiones anteriores.</p>`;
  }

  /* ===== Acciones ===== */
  async function run(a, b) {
    const o = so.byId(id); if (!o) return;
    const r = so.resolved(o), st = so.stateOf(o, r);
    try {
      if (a === 'edit') go(editPath(id, st.next.key === 'data' ? 1 : o.phase === 'draft' ? 5 : 0));
      if (a === 'docs') setTab('docs');
      if (a === 'assign') go(editPath(id, 2));
      if (a === 'dispatch') openDispatchSheet(id);
      if (a === 'advance') await confirmDeparture(id);
      if (a === 'status') openOrderStatusSheet(id);
      if (a === 'deliver') openDeliverySheet(id);
      if (a === 'track') setTab('seguimiento');
      if (a === 'incidents') setTab('seguimiento');
      if (a === 'empty') {
        if (!(await confirmDestructive('¿Marcar el contenedor como vacío?', `${r.containerNumber || 'Contenedor'}: la unidad pasa a «Vacío» en Logística y se crea su control de devolución en Control de vacíos (si ya existe, se reutiliza).`, 'Marcar vacío'))) return;
        await so.markEmpty(id); toast('Contenedor vacío: control de devolución listo'); setTab('vacio');
      }
      if (a === 'waive') { const why = await askText({ title: 'Sin devolución de vacío', message: 'Excepción autorizada: la orden podrá cerrarse sin devolver el contenedor vacío.', label: 'Motivo', confirm: 'Autorizar excepción' }); if (why) { await so.waiveEmptyReturn(id, why); toast('Excepción registrada'); } }
      if (a === 'return_schedule' && r.empty) openDeliveryForm(r.empty);
      if (a === 'return_confirm' && r.empty) openDeliverSheet(r.empty);
      if (a === 'close') await closeFlow(id);
      if (a === 'summary') await openOrderDossier(id);
      if (a === 'doc') await startOrderDocument(id);
      if (a === 'incident') await incidentFlow(id);
      if (a === 'trip' && r.trip) { const opr = ops.operatorById(r.trip.operatorId); if (opr) openTripForm(opr, r.trip, () => draw()); }
      if (a === 'billing' && r.trip) openBillingDetail(r.trip.id, () => draw());
      if (a === 'linktrip') await linkTripFlow(id);
    } catch (e) { err(e); }
  }
  function setTab(k) { tab = k; draw().then(() => { const p = root.querySelector('.so-tabs'); if (p) p.scrollIntoView({ block: 'start', behavior: 'smooth' }); }); }
  on(root, 'click', '[data-back]', () => back('/operacion/ordenes'));
  on(root, 'click', '[data-act]', (e, b) => { if (!b.disabled) run(b.dataset.act, b); });
  on(root, 'click', '[data-edit]', (e, b) => go(editPath(id, +b.dataset.edit)));
  on(root, 'click', '[data-tab]', (e, b) => { tab = b.dataset.tab; draw(); });
  on(root, 'click', '[data-step]', (e, b) => setTab(STEP_TAB[b.dataset.step] || 'resumen'));
  on(root, 'click', '[data-resolve]', async (e, b) => { const t = await askText({ title: 'Resolver incidencia', label: 'Cómo se resolvió', confirm: 'Marcar resuelta', required: false }); if (t == null) return; try { await so.resolveIncident(id, b.dataset.resolve, t); toast('Incidencia resuelta'); } catch (x) { err(x); } });
  on(root, 'click', '[data-sugok]', async (e, b) => { try { await so.advance(id, b.dataset.sugok, { note: 'Cambio sugerido por el GPS (confirmado)' }); al.dismiss(b.dataset.ev); toast(`Estado: ${lgStatus(b.dataset.sugok).label}`); } catch (x) { err(x); } });
  on(root, 'click', '[data-sugno]', (e, b) => al.dismiss(b.dataset.sugno));
  on(root, 'click', '[data-moreacts]', () => moreActions(id));
  let pend = null;
  const redraw = () => { clearTimeout(pend); pend = setTimeout(() => { if (root.isConnected) draw(); }, 60); };
  await draw();
  const unsub = [so.onOrdersChange(redraw), lg.onLogisticsChange(redraw), fc.onFullsChange(redraw), ec.onEmptiesChange(redraw), al.onAlertsChange(redraw)];
  s.cleanup = () => { unsub.forEach((u) => u()); clearTimeout(pend); if (gpsPanel) gpsPanel.destroy(); };
  const a0 = q && q.get('a');
  if (a0 && !ro) s.mounted = () => setTimeout(() => run(a0 === 'doc' ? 'doc' : a0 === 'dispatch' ? 'dispatch' : a0 === 'deliver' ? 'deliver' : '', null), 300);
  return s;
}
const ruleFromOperator = (opId) => { try { return ruleFromSettings(ops.settingsFor(opId)); } catch (e) { return null; } };

/* ===== Más acciones ===== */
async function moreActions(id) {
  const o = so.byId(id); if (!o) return;
  const r = so.resolved(o), closed = !!o.closedAt, cancelled = o.phase === 'cancelled', ro = isReadOnly();
  const acts = [
    ...(!closed && !cancelled && !ro ? [{ label: 'Editar orden', value: 'edit', icon: icon.edit }, { label: `Generar ${docName(o)}`, value: 'doc', icon: icon.file }] : []),
    { label: 'Expediente documental (PDF)', value: 'dossier', icon: icon.docs },
    ...(r.op ? [{ label: 'Ver en Logística', value: 'lg', icon: icon.truck }] : []),
    ...(r.load ? [{ label: 'Ver carga en Control de llenos', value: 'fl', icon: icon.containers }] : []),
    ...(r.empty ? [{ label: 'Ver en Control de vacíos', value: 'ec', icon: icon.yard }] : []),
    ...(!closed && !cancelled && !ro && r.op ? [{ label: 'Registrar incidencia', value: 'incident', icon: icon.alert }] : []),
    ...(!closed && !cancelled && !ro && so.stateOf(o, r).next.action === 'close' ? [{ label: 'Cerrar orden', value: 'close', icon: icon.check }] : []),
    ...((closed || cancelled) && !ro ? [{ label: 'Reabrir orden', value: 'reopen', icon: icon.refresh }] : []),
    ...(!closed && !cancelled && !ro ? [{ label: 'Cancelar orden', value: 'cancel', icon: icon.close, style: 'destructive' }] : []),
  ];
  const v = await actionSheet({ title: o.folio, actions: acts });
  try {
    if (v === 'edit') go(editPath(id, 0));
    if (v === 'doc') await startOrderDocument(id);
    if (v === 'dossier') await openOrderDossier(id);
    if (v === 'lg') go(`/operacion/logistica/u/${encodeURIComponent(r.op.vehicleId)}`);
    if (v === 'fl') go(`/operacion/logistica/llenos/${encodeURIComponent(r.load.id)}`);
    if (v === 'ec') go(`/operacion/logistica/vacios/${encodeURIComponent(r.empty.id)}`);
    if (v === 'incident') await incidentFlow(id);
    if (v === 'close') await closeFlow(id);
    if (v === 'reopen') { const why = await askText({ title: `Reabrir ${o.folio}`, message: 'La orden vuelve a estar activa para corregirla; el historial conserva el cierre anterior.', label: 'Motivo de la reapertura', confirm: 'Reabrir' }); if (why) { await so.reopenOrder(id, why); toast('Orden reabierta'); } }
    if (v === 'cancel') {
      const why = await askText({ title: `Cancelar ${o.folio}`, message: `${r.op ? 'La operación de Logística se cierra. ' : ''}${r.load ? 'La carga de Control de llenos se cancela si aún no se recoge. ' : ''}El folio no se reutiliza y el viaje financiero (si existe) no se borra.`, label: 'Motivo de la cancelación', confirm: 'Cancelar orden', destructive: true });
      if (why) { await so.cancelOrder(id, why); toast('Orden cancelada', { type: 'info' }); }
    }
  } catch (e) { err(e); }
}
async function incidentFlow(id) {
  const form = document.createElement('form'); form.className = 'op-form'; form.noValidate = true;
  form.innerHTML = `<label class="fld" data-f="t"><span class="fl">Qué pasó</span><textarea class="in" name="t" rows="3" maxlength="500" placeholder="Retraso, daño, revisión, cambio de ruta…"></textarea><span class="ferr"></span></label>
    <label class="sw-row"><span class="sw-tx">Incidencia crítica<small>Impide cerrar la orden hasta resolverla</small></span><input type="checkbox" switch class="sw" name="crit"></label>
    <div class="sheet-acts"><button type="button" class="btn-secondary" data-cancel>Cancelar</button><button type="submit" class="btn-primary">Registrar</button></div>`;
  const sh = openSheet({ title: 'Registrar incidencia', body: form });
  form.querySelector('[data-cancel]').addEventListener('click', () => sh.close());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await so.addIncident(id, { text: form.elements.t.value, critical: form.elements.crit.checked }); sh.close(); toast('Incidencia registrada'); } catch (x) { err(x); }
  });
}
async function closeFlow(id) {
  const o = so.byId(id), chk = so.closeCheck(o);
  if (!chk.ok) { await actionSheet({ title: 'Todavía no se puede cerrar', message: chk.missing.join(' '), actions: [], cancel: 'Entendido' }); return; }
  const r = so.resolved(o);
  if (!(await confirmDestructive(`¿Cerrar la orden ${o.folio}?`, `Cierre operativo${r.op && !r.op.closedAt ? ': la operación de Logística pasa al historial y la unidad queda libre' : ''}. El cobro sigue su curso en Cobranza (cierre administrativo).`, 'Cerrar orden'))) return;
  await so.closeOrder(id);
  toast(`Orden ${o.folio} finalizada`);
}
async function linkTripFlow(id) {
  const o = so.byId(id), r = so.resolved(o);
  const trips = ops.allTrips().filter((t) => t.operatorId === r.operatorId && !so.orderForTrip(t.id) && !t.serviceOrderId).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 40);
  if (!trips.length) { toast('Ese operador no tiene viajes sin orden.', { type: 'info' }); return; }
  const p = await openPicker({ title: 'Viaje existente', allowNew: false, items: trips.map((t) => ({ value: t.id, label: `${fmtDate(t.date)} · ${t.origin || '—'} → ${t.destination || '—'}`, sub: money(t.fare) })) });
  if (!p) return;
  await so.linkTrip(id, p.value);
  toast('Viaje vinculado (sin recalcular comisión ni impuestos)');
}
async function confirmDeparture(id) {
  const v = await actionSheet({ title: 'Confirmar salida', message: 'La unidad deja de estar «Asignada» y empieza el seguimiento.', actions: [{ label: 'En carga', sub: 'Llegó al lugar de carga', value: 'loading' }, { label: 'En ruta a destino', sub: 'Salió cargada hacia la entrega', value: 'to_destination', style: 'primary' }] });
  if (!v) return;
  await so.advance(id, v);
  toast(`Estado: ${lgStatus(v).label}`);
}
function openOrderStatusSheet(id) {
  const o = so.byId(id), op = so.opOf(o); if (!op) return;
  const list = LOGISTICS_STATUSES.filter((x) => !x.closable);
  const body = `<p class="sheet-lead">${esc(o.folio)} · ${esc(lg.view(op).label)}</p><div class="lg-stlist" role="radiogroup" aria-label="Estado">${list.map((x) => `<button type="button" class="lg-stopt lg-t-${x.tone}${x.key === op.status ? ' on' : ''}" role="radio" aria-checked="${x.key === op.status}" data-set="${x.key}"><i class="lg-dot" aria-hidden="true"></i><span class="lg-stx"><b>${esc(x.label)}</b><small>${esc(x.hint)}</small></span>${x.key === op.status ? `<span class="pk-check">${icon.check}</span>` : ''}</button>`).join('')}</div>
    <p class="grp-note">Para terminar, cierra la orden: la operación de Logística pasa al historial.</p>`;
  const sh = openSheet({ title: 'Actualizar estado', body, className: 'lg-stsheet' });
  sh.body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-set]'); if (!b) return;
    const k = b.dataset.set; sh.close();
    if (k === op.status) return;
    try {
      if (k === 'empty' && o.division === 'puerto' && D.needsEmptyReturn(o)) await so.markEmpty(id); else await so.advance(id, k);
      toast(`Estado: ${lgStatus(k).label}`);
    } catch (x) { err(x); }
  });
}

/* ===== Confirmar asignación y despachar ===== */
const FIX = { data: ['edit', 1], docs: ['tab', 'docs'], unit_busy: ['edit', 2], unit_inactive: ['edit', 2] };
export function openDispatchSheet(id) {
  const o = so.byId(id); if (!o) return;
  const r = so.resolved(o), chk = so.dispatchCheck(o), st = so.stateOf(o, r), g = so.latestGenerated(o);
  const form = document.createElement('form'); form.className = 'op-form so-dispatch'; form.noValidate = true;
  form.innerHTML = `<dl class="sumlist lg-sum">${row('Orden', `<b class="mono">${esc(o.folio)}</b><small>${esc(D.divisionLabel(o.division))}</small>`)}${row('Cliente', o2(r.customer))}
      ${row('Ruta', `${esc(r.origin || '—')} → ${esc(r.destination || '—')}`)}${r.containerNumber ? row('Contenedor', `<span class="mono">${esc(r.containerNumber)}</span>`) : ''}
      ${row('Unidad', o2(r.unit))}${row('Operador', o2(r.operator))}${row('Remolque', o2(r.trailer))}
      ${o.division === 'puerto' ? row('Documentación', toneChip(st.docs)) : ''}${row(cap(docName(o)), g ? `Folio ${esc(g.folio)} · v${g.version}` : '<i>Sin generar</i>')}
      ${o.finance && o.finance.fare && !r.trip ? row('Viaje financiero', `Se registra al despachar: ${esc(money(o.finance.fare))}`) : r.trip ? row('Viaje financiero', 'Ya registrado (se reutiliza)') : row('Viaje financiero', '<i>Sin tarifa: no se crea</i>')}</dl>
    ${chk.blocks.length ? `<section class="issues"><div class="issues-h">${icon.alert}<b>No se puede despachar (${chk.blocks.length})</b></div>${chk.blocks.map((b) => { const fx = FIX[b.code] || (b.code.startsWith('res_') ? ['edit', 2] : null); return `<div class="issue static"><span>${esc(b.msg)}</span>${fx ? `<button type="button" class="btn-ghost sm" data-fix="${esc(fx.join(':'))}">Corregir</button>` : ''}</div>`; }).join('')}</section>` : ''}
    ${chk.warnings.length ? `<section class="issues warn"><div class="issues-h">${icon.info}<b>Advertencias (${chk.warnings.length})</b></div><p>Puedes continuar si las autorizas; la autorización queda en el historial.</p>
      ${chk.warnings.map((w) => `<label class="so-auth"><input type="checkbox" name="auth" value="${esc(w.code)}"><span>${esc(w.msg)}</span></label>`).join('')}</section>` : ''}
    ${chk.blocks.length ? '' : `<fieldset class="so-init"><legend class="fl">Estado inicial en Logística</legend>${so.INITIAL_STATUSES.map(([k, l], i) => `<label class="so-radio"><input type="radio" name="initial" value="${k}"${i ? '' : ' checked'}><span>${esc(l)}</span></label>`).join('')}</fieldset>`}
    <div class="form-foot"><button type="submit" class="btn-primary block lg"${chk.blocks.length ? ' disabled' : ''}>${icon.truck}<span>Confirmar asignación y despachar</span></button></div>`;
  const sh = openSheet({ title: 'Confirmar despacho', body: form, full: true });
  form.addEventListener('click', (e) => {
    const b = e.target.closest('[data-fix]'); if (!b) return;
    const [k, v] = b.dataset.fix.split(':'); sh.close();
    if (k === 'edit') go(editPath(id, +v)); else go(orderPath(id, v));
  });
  let busyNow = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busyNow) return;
    const authorized = [...form.querySelectorAll('input[name=auth]:checked')].map((x) => x.value);
    const missing = chk.warnings.filter((w) => !authorized.includes(w.code));
    if (missing.length) { toast(`Autoriza ${missing.length === 1 ? 'la advertencia' : `las ${missing.length} advertencias`} o corrígelas antes de despachar.`, { type: 'warn', ms: 4000 }); return; }
    const initial = (form.querySelector('input[name=initial]:checked') || {}).value || 'assigned';
    busyNow = true; busy(true, 'Despachando…', o.folio);
    try {
      const res = await so.dispatch(id, { initial, authorized });
      busy(false); sh.close();
      toast(res.already ? 'La orden ya estaba despachada' : `${o.folio} despachada: la unidad aparece en Unidades en operación`, { ms: 4500 });
    } catch (x) { busy(false); err(x); } finally { busyNow = false; }
  });
}

/* ===== Registrar entrega ===== */
export function openDeliverySheet(id) {
  const o = so.byId(id); if (!o) return;
  const r = so.resolved(o), d = o.delivery || {}, n = nowParts();
  const form = document.createElement('form'); form.className = 'op-form'; form.noValidate = true;
  form.innerHTML = `<div class="row2"><label class="fld" data-f="date"><span class="fl">Fecha</span><input class="in" type="date" name="date" value="${esc(d.date || n.fecha)}"><span class="ferr"></span></label>
      <label class="fld" data-f="time"><span class="fl">Hora</span><input class="in" type="time" name="time" value="${esc(d.time || n.hora)}"><span class="ferr"></span></label></div>
    <label class="fld"><span class="fl">Lugar de entrega</span><input class="in" name="place" value="${esc(d.place || r.deliveryPlace || r.destination || '')}" autocapitalize="words" autocomplete="off" maxlength="160"></label>
    <label class="fld"><span class="fl">Quién recibe</span><input class="in" name="receiver" value="${esc(d.receiver || '')}" autocapitalize="words" autocomplete="off" maxlength="120" placeholder="Nombre de quien recibe"></label>
    <label class="fld"><span class="fl">Observaciones</span><textarea class="in" name="notes" rows="2" maxlength="600">${esc(d.notes || '')}</textarea></label>
    <div class="fld"><span class="fl">Evidencia (opcional)</span><div class="sheet-acts"><label class="btn-secondary">${icon.paperclip}<span>Archivo</span><input type="file" accept="${so.ACCEPT}" multiple hidden name="ev"></label><label class="btn-secondary">${icon.camera}<span>Foto</span><input type="file" accept="image/jpeg,image/png" capture="environment" hidden name="evc"></label></div><span class="fhint" data-evn></span></div>
    <div class="form-foot"><button type="submit" class="btn-primary block lg">${icon.check}<span>${o.delivery ? 'Guardar corrección' : 'Confirmar entrega'}</span></button></div>`;
  const sh = openSheet({ title: o.delivery ? 'Corregir entrega' : 'Registrar entrega', body: form, full: true });
  let files = [];
  form.addEventListener('change', (e) => { const t = e.target; if (t.type !== 'file') return; files = [...files, ...(t.files || [])]; t.value = ''; form.querySelector('[data-evn]').textContent = files.length ? `${plural(files.length, 'archivo listo', 'archivos listos')} para adjuntar` : ''; });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = (k) => form.elements[k].value;
    if (!v('date')) { form.querySelector('[data-f="date"]').classList.add('has-err'); toast('Escribe la fecha de la entrega.', { type: 'warn' }); return; }
    if (!v('time')) { form.querySelector('[data-f="time"]').classList.add('has-err'); toast('Escribe la hora de la entrega.', { type: 'warn' }); return; }
    try {
      await so.registerDelivery(id, { date: v('date'), time: v('time'), place: v('place'), receiver: v('receiver'), notes: v('notes') });
      sh.close();
      if (files.length) await uploadTo(id, files, { docType: 'entrega' });
      const nx = so.stateOf(so.byId(id));
      toast(o.delivery ? 'Entrega corregida' : `Entrega registrada · Siguiente: ${nx.next.text}`, { ms: 4500 });
    } catch (x) { err(x); }
  });
}

/* ===== Nota de entrega / asignación de unidades: plantilla llena con los datos de la orden ===== */
const TIPO_CAMPO = { tolva: 'Tolva', jaula: 'Jaula' };
async function freeDraftSlot(id, o, hasData, label) {
  const ex = await drafts.getDraft(id);
  if (!ex || !hasData(ex.data)) return true;
  const mine = ex.data.serviceOrderId === o.id;
  const other = !mine && ex.data.serviceOrderId ? so.byId(ex.data.serviceOrderId) : null;
  const v = await actionSheet({
    title: mine ? `${cap(label)} en preparación` : `Tienes una ${label} sin terminar`,
    message: mine ? `Folio ${ex.data.folio}. ¿Continuar la captura o llenarla de nuevo con los datos actuales de la orden?` : `Folio ${ex.data.folio}${other ? ` (orden ${other.folio})` : ''}. Para preparar la de ${o.folio} se descarta la otra captura.`,
    actions: [{ label: mine ? 'Continuar la captura' : 'Continuar la otra captura', value: 'cont', style: mine ? 'primary' : '' }, { label: mine ? 'Llenar de nuevo con los datos de la orden' : 'Descartarla y preparar la de esta orden', value: 'new', style: mine ? '' : 'destructive' }],
  });
  if (!v) return false;
  if (v === 'cont') { go(draftRoute(ex)); return false; }
  await discardDraft(id, { silent: true });
  return true;
}
export async function startOrderDocument(id) {
  const o = so.byId(id); if (!o) return;
  if (isReadOnly()) { toast('Solo consulta: no se generan documentos en este dispositivo.', { type: 'warn' }); return; }
  const r = so.resolved(o), t = D.opTypeOf(o.opType, o.division), cust = r.customerRec, f = o.finance || {};
  const u = r.vehicleId ? lg.unitById(r.vehicleId) : null, tr = r.trailerId ? lg.trailerById(r.trailerId) : null;
  if (o.division === 'puerto') {
    const company = PUERTO_COMPANIES.includes(o.companyId) ? o.companyId : 'perconsur';
    if (!(await freeDraftSlot(drafts.draftId('puerto', company), o, puertoHasData, 'nota de entrega'))) return;
    await setSetting('lastCompany', company);
    const d = await createPuertoDraft(company), base = blankCont();
    Object.assign(d.data, {
      serviceOrderId: o.id, operador: r.operator || '', eco: u ? u.eco : '', unitId: u ? u.id : null, placasU: u ? u.placas : '', placasR: tr ? tr.placas : '',
      destNombre: cust ? cust.name : r.customer || '', destRFC: cust ? cust.rfc || '' : '', destDir: cust ? cust.address || '' : '',
      destContacto: [o.contactName, o.contactPhone].filter(Boolean).join(' · ') || (cust ? cust.contact || '' : ''),
      pedimento: o.pedimento || '', bl: o.bl || '', cartaPorte: o.cartaPorte || '', terminal: t.fullLoad && r.locationType === 'port' ? r.place : '',
      citaFecha: t.fullLoad ? r.scheduledDate || '' : '', citaHora: t.fullLoad ? r.scheduledTime || '' : '', modal: t.modal || 'imp',
      obs: [o.instructions, `Orden ${o.folio}`].filter(Boolean).join(' · ').slice(0, 300),
      conts: [{ ...base, num: r.containerNumber || '', tipo: o.containerType || base.tipo, peso: r.weightKg ? String(r.weightKg) : '', tarifa: f.fare ? centsInput(f.fare) : '', iva: !!f.applyVat, isr: !!f.applyIsr }],
    });
    d.step = PUERTO_STEPS.length - 2;
    await drafts.saveNow(d);
    toast('Nota llena con los datos de la orden: revísala antes de generar el PDF', { ms: 4000 });
    go(`/puerto/${company}/${PUERTO_STEPS.length}`);
    return;
  }
  if (!(await freeDraftSlot('campo', o, campoHasData, 'asignación de unidades'))) return;
  const cp = cpBlank(r.scheduledDate || o.serviceDate || nowParts().fecha), sol = (o.reference || o.commercialRef || '').slice(0, 40);
  cp.serviceOrderId = o.id;
  cp.planta = r.plant || '';
  cp.units = [{ ...cpUnit(), sol, eco: u ? u.eco : '', unitId: u ? u.id : null, op: r.operator || '', pu: u ? u.placas : '', pr: tr ? tr.placas : '', tipo: tr ? TIPO_CAMPO[tr.type] || '' : '' }];
  cp.sols = { [sol]: { hora: r.scheduledTime || '', lugar: r.origin || '', enc: o.contactName || '', tel: o.contactPhone || '', maps: '' } };
  await drafts.saveNow({ id: 'campo', type: 'campo', company: 'campo', data: cp, step: CAMPO_STEPS.length - 2, createdAt: Date.now() });
  toast('Asignación llena con los datos de la orden: revísala antes de generar el PDF', { ms: 4000 });
  go(`/campo/${CAMPO_STEPS.length}`);
}

/* ===== Registros existentes sin orden (migración segura) ===== */
export async function ordersLegacyScreen() {
  await so.loadOrders();
  if (isReadOnly()) { go('/operacion/ordenes', { replace: true }); return null; }
  const s = screen('<div class="page so-page so-legacyp"></div>');
  const root = s.el;
  let backedUp = false;
  function draw() {
    const items = so.legacyCandidates();
    root.innerHTML = `<header class="nav-top"><button type="button" class="nav-back" data-back>${icon.back}<span>Órdenes</span></button></header>
      <h1 class="title">Vincular registros existentes</h1>
      <p class="page-lead">Operaciones de Logística y cargas de Control de llenos abiertas que se registraron antes de las órdenes de servicio.</p>
      <section class="grp"><div class="grp-h"><h3>Antes de empezar</h3></div><div class="grp-b">
        <p class="grp-note">Vincular crea una orden que <b>apunta</b> a los registros: no los copia, no cambia viajes, comisiones, impuestos ni cobros, y no inventa datos (el cliente queda pendiente). Descarga primero un respaldo.</p>
        <button type="button" class="btn-${backedUp ? 'secondary' : 'primary'} block" data-backup>${icon.download}<span>${backedUp ? 'Respaldo descargado' : 'Descargar respaldo'}</span></button></div></section>
      ${items.length ? `<div class="sec-hrow"><h2 class="sec-h">Sin orden</h2><span class="count">${items.length}</span></div>
        <div class="list">${items.map((x, i) => `<div class="row static so-lrow"><span class="row-ic">${x.kind === 'op' ? icon.truck : icon.containers}</span><span class="row-tx"><span class="row-l1"><b>${esc(x.label)}</b></span>${x.sub ? `<span class="row-l2">${esc(x.sub)}</span>` : ''}${x.ambiguous ? `<span class="row-l3 warn-t">${plural(x.loads.length, 'carga coincide', 'cargas coinciden')} con la referencia: se vincula solo la operación (elige la carga después)</span>` : x.loads.length && x.kind === 'op' ? `<span class="row-l3">Con su carga ${esc(x.loads[0].containerNumber)}</span>` : ''}</span>
          <button type="button" class="btn-secondary sm" data-adopt="${i}"${backedUp ? '' : ' disabled'}>Vincular</button></div>`).join('')}</div>
        <button type="button" class="btn-primary block" data-all${backedUp ? '' : ' disabled'}>${icon.link}<span>Vincular todos</span></button>`
    : '<div class="empty"><p>No hay registros abiertos sin orden.</p></div>'}`;
  }
  on(root, 'click', '[data-back]', () => back('/operacion/ordenes'));
  on(root, 'click', '[data-backup]', async () => { busy(true, 'Preparando respaldo…', ''); try { const f = await exportBackup(); busy(false); downloadBlob(f, f.name); backedUp = true; toast('Respaldo descargado'); draw(); } catch (e) { busy(false); err(e); } });
  async function adopt(list) {
    let n = 0; const bad = [];
    busy(true, 'Vinculando…', '');
    try { for (const x of list) { try { await so.adoptExisting(x); n++; } catch (e) { bad.push(e.message); } } } finally { busy(false); }
    if (n) toast(`${plural(n, 'orden creada', 'órdenes creadas')} con los registros existentes`);
    if (bad.length) toast(bad.join(' · '), { type: 'warn', ms: 5000 });
    draw();
  }
  on(root, 'click', '[data-adopt]', (e, b) => { const x = so.legacyCandidates()[+b.dataset.adopt]; if (x) adopt([x]); });
  on(root, 'click', '[data-all]', async () => { const items = so.legacyCandidates(); if (await confirmDestructive(`¿Vincular ${plural(items.length, 'registro', 'registros')}?`, 'Se crea una orden por cada uno, con folio nuevo. No se modifican viajes, comisiones ni cobros.', 'Vincular todos')) adopt(items); });
  draw();
  return s;
}

/* ===== Inicio: resumen de órdenes ===== */
export function mountHomeOrders(sec) {
  const draw = () => {
    const rows = so.rows(), c = D.tileCounts(rows), active = D.sortRows(rows.filter((x) => x.state.active && x.state.key !== 'draft')).slice(0, 3);
    if (!rows.length) { sec.innerHTML = `<div class="sec-hrow"><h2 class="sec-h">Órdenes de servicio</h2><a class="link" href="#/operacion/ordenes">Abrir</a></div>${isReadOnly() ? '' : `<a class="lg-none" href="#/operacion/ordenes/nueva">${icon.clipboard}<span>Crea la primera orden de servicio</span>${icon.chev}</a>`}`; return; }
    sec.innerHTML = `<div class="sec-hrow"><h2 class="sec-h">Órdenes de servicio</h2><a class="link" href="#/operacion/ordenes">Ver todas</a></div>
      <div class="so-hsum">${[['pending', 'Pendientes'], ['ready', 'Listas'], ['operating', 'En curso'], ['returns', 'Devolución']].map(([k, l]) => `<a class="so-hk lg-t-${TILE_TONE[k]}" href="#/operacion/ordenes?t=${k}"><b>${c[k]}</b><small>${l}</small></a>`).join('')}</div>
      ${active.length ? `<div class="list so-hlist">${active.map((x) => `<a class="row" href="${orderHref(x.order.id)}"><span class="row-tx"><span class="row-l1"><b class="mono">${esc(x.order.folio)}</b> ${toneChip(x.state)}</span><span class="row-l2">${esc(x.view.customer || 'Cliente sin indicar')}${x.view.destination ? ' · ' + esc(x.view.destination) : ''}</span><span class="row-l3">${esc(x.state.next.text)}</span></span><span class="chev">${icon.chev}</span></a>`).join('')}</div>` : ''}`;
  };
  draw();
  const unsub = [so.onOrdersChange(draw), lg.onLogisticsChange(draw), ec.onEmptiesChange(draw)];
  return () => unsub.forEach((u) => u());
}
