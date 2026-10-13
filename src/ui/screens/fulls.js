/*
 * Operación → Logística → Control de llenos
 *   #/operacion/logistica/llenos        indicadores, pizarra de cargas (mes · semana · día), buscador, filtros y listas
 *                                       (hoy, próximas, documentación pendiente y completa, historial)
 *   #/operacion/logistica/llenos/:id    ficha de la carga: datos, transporte, documentación uno por uno (Pedimento, DODA,
 *                                       Cita, DEC solo dentro de puerto, adicionales), expediente PDF e historial
 * Terminales, patios de carga, unidades, operadores y remolques salen de los catálogos (por ID). Las pantallas se
 * suscriben a onFullsChange: una carga nueva o reprogramada aparece en la pizarra al momento.
 * En un dispositivo de consulta los controles de captura llevan data-w y no se muestran (la base además rechaza escrituras).
 */
import { screen, on } from '../../core/dom.js';
import { go, back } from '../../core/router.js';
import * as fc from '../../services/fulls.js';
import * as media from '../../services/media.js';
import { listAll, activeLoadingYards, save as saveCatalog, trailerScope, trailerTypeLabel } from '../../services/catalogs.js';
import { operatorList, allTrips } from '../../services/operators.js';
import * as lg from '../../services/logistics.js';
import { vehicles as fleetUnits } from '../../services/fuel.js';
import { dossierPlan, buildDossier, HEAVY_BYTES } from '../../services/fullDossier.js';
import { shareFile, downloadBlob, openBlob, isIOS } from '../../services/share.js';
import {
  LOAD_STATUSES, loadStatus, isOpenLoad, LOCATIONS, locationLabel, placeLabel, DOC_TYPES, docType, docLabel, docState, DOC_STATE_LABELS, hasFile,
  docSummaryText, slotTypes, cleanContainer, isContainer, dayStr, hmStr, addDays, weekDays, monthGrid, monthOf, byDay, sortByWhen, isLate, summary,
  filterLoads, eventLabel, weightText, parseWeight,
} from '../../domain/fulls/fulls.js';
import { fmtDate, todayStr } from '../../domain/operators/balance.js';
import { esc, fmtSize } from '../../domain/shared/format.js';
import { icon, trailerIcon } from '../components/icons.js';
import { openSheet, actionSheet, confirmDestructive, busy } from '../components/sheet.js';
import { openPicker } from '../components/picker.js';
import { toast } from '../components/toast.js';
import { formSheet, fail } from './operatorForms.js';
import { whenText } from './empties.js';

const href = (id) => `#/operacion/logistica/llenos/${encodeURIComponent(id)}`;
const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;
const MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIA = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const parts = (d) => String(d).split('-').map(Number);
const dow = (d) => { const [y, m, dd] = parts(d); return (new Date(y, m - 1, dd).getDay() + 6) % 7; };
/* «Miércoles 15 de octubre de 2026» · «mié 15 oct» */
const longDay = (d) => { const [y, m, dd] = parts(d); return `${cap(DIA[dow(d)])} ${dd} de ${MES[m - 1]} de ${y}`; };
const shortDay = (d) => { const [, m, dd] = parts(d); return `${cap(DIA[dow(d)].slice(0, 3))} ${dd} ${MES[m - 1].slice(0, 3)}`; };

/* ===== Piezas visuales ===== */
export const statusChip = (k, cls = '') => { const s = loadStatus(k); return `<span class="lg-st lg-t-${s.tone} ${cls}"><i aria-hidden="true"></i>${esc(s.label)}</span>`; };
const docChip = (sum, cls = '') => `<span class="lg-st ${sum.complete ? 'lg-t-ok' : 'lg-t-amber'} ${cls}"><i aria-hidden="true"></i>${sum.complete ? 'Documentación completa' : 'Documentación pendiente'}</span>`;
const locBadge = (r) => `<span class="fc-loc ${r.locationType === 'port' ? 'port' : 'off'}">${r.locationType === 'port' ? icon.containers : icon.yard}<span>${esc(locationLabel(r.locationType))}</span></span>`;
const lateChip = () => `<span class="ec-late">${icon.alert}Cita vencida</span>`;

/* Tarjeta: 1) contenedor y hora 2) peso y lugar 3) transporte 4) estados */
function card(r, { compact = false } = {}) {
  const v = fc.view(r), s = loadStatus(r.status), late = isLate(r);
  return `<a class="fc-card lg-t-${s.tone}${late ? ' late' : ''}${isOpenLoad(r) ? '' : ' done'}" href="${href(r.id)}">
    <div class="fc-c1"><b class="fc-num mono">${esc(r.containerNumber)}</b><span class="fc-when">${esc(compact ? r.scheduledTime : whenText(r.scheduledDate, r.scheduledTime))}</span><span class="chev">${icon.chev}</span></div>
    <div class="fc-c2"><span class="fc-w">${esc(v.weight)}</span><span class="dot">·</span>${locBadge(r)}${v.place ? `<span class="dot">·</span><span>${esc(v.place)}</span>` : ''}</div>
    ${v.unit || v.operator ? `<div class="fc-c3">${v.unit ? `<span>Unidad: <b>${esc(v.unit)}</b></span>` : ''}${v.operator ? `<span>${v.unit ? '· ' : ''}<b>${esc(v.operator)}</b></span>` : ''}</div>` : ''}
    <div class="ec-st">${statusChip(r.status)}${docChip(v.docs)}${late ? lateChip() : ''}</div></a>`;
}
const EV_ICON = { created: icon.plus, reschedule: icon.clock, vehicle: icon.truck, operator: icon.person, trailer: icon.trailer, edit: icon.edit, location: icon.pin, doc_added: icon.paperclip, doc_replaced: icon.refresh, doc_removed: icon.trash, doc_required: icon.check, doc_optional: icon.minus, status: icon.swap, loaded: icon.check, cancelled: icon.close, reopened: icon.refresh, link: icon.link, notes: icon.edit };
const eventRow = (e) => `<div class="row static ec-mv${e.eventType === 'loaded' ? ' done' : ''}"><span class="row-ic">${EV_ICON[e.eventType] || icon.info}</span>
  <span class="row-tx"><span class="row-l1"><span class="ec-act">${esc(eventLabel(e))}</span></span>${e.details ? `<span class="row-l2">${esc(e.details)}</span>` : ''}<span class="row-l3">${esc(whenText(e.date, e.time, { year: true }))}${e.createdBy ? ' · ' + esc(e.createdBy) : ''}</span></span></div>`;

/* ===== Pantalla principal ===== */
const PRESETS = [['today', 'Cargas de hoy'], ['upcoming', 'Próximas cargas'], ['docs_pending', 'Documentación pendiente'], ['docs_ok', 'Documentación completa'], ['history', 'Historial'], ['all', 'Todas']];
const RANGES = [['all', 'Todas las fechas'], ['today', 'Hoy'], ['tomorrow', 'Mañana'], ['week', 'Próximos 7 días'], ['late', 'Citas vencidas'], ['month', 'Este mes']];
export async function fullsScreen() {
  await fc.loadFulls();
  const desktop = window.matchMedia && window.matchMedia('(min-width:1024px)').matches;
  const f = { preset: 'upcoming', text: '', location: 'all', terminalId: '', yardId: '', vehicleId: '', operatorId: '', status: 'all', range: 'all' };
  const cal = { view: desktop ? 'month' : 'week', cursor: todayStr(), selected: todayStr() };
  let shownHist = 10;
  const s = screen(`<div class="page wide lg-page fc-page">
    <header class="nav-top"><button type="button" class="nav-back" data-back>${icon.back}<span>Logística</span></button>
      <button type="button" class="nav-act" data-new aria-label="Programar carga">${icon.plus}</button></header>
    <h1 class="title">Control de llenos</h1>
    <p class="page-lead">Programación de cargas y gestión documental de contenedores.</p>
    <div class="tiles fc-tiles" data-tiles></div>
    <button type="button" class="btn-primary block lg lg-new" data-new>${icon.plus}<span>Programar carga</span></button>
    <section class="fc-board" aria-label="Pizarra de cargas">
      <div class="sec-hrow"><h2 class="sec-h">Pizarra de cargas</h2><small class="fc-n" data-boardn></small></div>
      <div class="fc-bar">
        <div class="seg fc-seg" role="group" aria-label="Vista">${[['month', 'Mes'], ['week', 'Semana'], ['day', 'Día']].map(([k, l]) => `<button type="button" class="seg-b" data-view="${k}">${l}</button>`).join('')}</div>
        <div class="fc-nav"><button type="button" class="icon-btn" data-cal="prev" aria-label="Anterior">${icon.back}</button><b data-caltitle></b><button type="button" class="icon-btn" data-cal="next" aria-label="Siguiente">${icon.chev}</button><button type="button" class="btn-ghost sm" data-cal="today">Hoy</button></div>
      </div>
      <div data-calbox aria-live="polite"></div>
    </section>
    <label class="search"><span class="search-ic">${icon.search}</span><input type="search" class="search-in" placeholder="Contenedor, referencia, terminal, patio, unidad…" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search" aria-label="Buscar cargas"></label>
    <div class="chips filters" data-f1 role="group" aria-label="Lista"></div>
    <div class="chips filters" data-f2 role="group" aria-label="Más filtros"></div>
    <div data-list aria-live="polite"></div>
  </div>`);
  const root = s.el;
  const base = () => filterLoads(fc.all(), { text: f.text, location: f.location, terminalId: f.terminalId, yardId: f.yardId, vehicleId: f.vehicleId, operatorId: f.operatorId, status: f.status, ...rangeOf() }, fc.view);
  function rangeOf() {
    const today = todayStr();
    if (f.range === 'today') return { from: today, to: today };
    if (f.range === 'tomorrow') return { from: addDays(today, 1), to: addDays(today, 1) };
    if (f.range === 'week') return { from: today, to: addDays(today, 6) };
    if (f.range === 'month') return { from: today.slice(0, 7) + '-01', to: addDays(today.slice(0, 7) + '-01', 40).slice(0, 7) + '-01' };
    return {};
  }
  function listOf(all) {
    const today = todayStr();
    if (f.range === 'late') all = all.filter((r) => isLate(r));
    switch (f.preset) {
      case 'today': return sortByWhen(all.filter((r) => r.scheduledDate === today && isOpenLoad(r)));
      case 'upcoming': return sortByWhen(all.filter((r) => isOpenLoad(r) && r.scheduledDate >= today));
      case 'docs_pending': return sortByWhen(all.filter((r) => isOpenLoad(r) && !fc.summaryOf(r).complete));
      case 'docs_ok': return sortByWhen(all.filter((r) => isOpenLoad(r) && fc.summaryOf(r).complete));
      case 'history': return all.filter((r) => !isOpenLoad(r)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      default: return sortByWhen(all);
    }
  }
  function calTitle() {
    const [y, m, d] = parts(cal.cursor);
    if (cal.view === 'month') return `${cap(MES[m - 1])} ${y}`;
    if (cal.view === 'day') return `${shortDay(cal.cursor)} ${y}`;
    const w = weekDays(cal.cursor), [y1, m1, d1] = parts(w[0]), [, m2, d2] = parts(w[6]);
    return m1 === m2 ? `${d1} – ${d2} ${MES[m1 - 1].slice(0, 3)} ${y1}` : `${d1} ${MES[m1 - 1].slice(0, 3)} – ${d2} ${MES[m2 - 1].slice(0, 3)} ${y1}`;
  }
  function drawCal(all) {
    const days = byDay(all.filter((r) => r.status !== 'cancelled')), today = todayStr();
    root.querySelectorAll('[data-view]').forEach((b) => { b.classList.toggle('on', b.dataset.view === cal.view); b.setAttribute('aria-pressed', b.dataset.view === cal.view); });
    root.querySelector('[data-caltitle]').textContent = calTitle();
    const el = root.querySelector('[data-calbox]');
    const dayList = (d, { title = true } = {}) => { const list = days.get(d) || []; return `${title ? `<div class="fc-dh"><span>${esc(longDay(d))}</span><small>${list.length ? plural(list.length, 'carga', 'cargas') : 'Sin cargas'}</small></div>` : ''}${list.length ? `<div class="fc-cards">${list.map((r) => card(r, { compact: true })).join('')}</div>` : '<p class="fc-none">Sin cargas programadas este día.</p>'}`; };
    if (cal.view === 'month') {
      const mo = monthOf(cal.cursor), weeks = monthGrid(cal.cursor);
      el.innerHTML = `<div class="fc-month"><div class="fc-dow">${['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((x) => `<span>${x}</span>`).join('')}</div><div class="fc-grid">${weeks.flat().map((d) => {
        const list = days.get(d) || [], out = monthOf(d) !== mo;
        return `<button type="button" class="fc-day${out ? ' out' : ''}${d === today ? ' today' : ''}${d === cal.selected ? ' sel' : ''}" data-day="${d}" aria-label="${esc(longDay(d))}${list.length ? `, ${plural(list.length, 'carga', 'cargas')}` : ''}"><span class="fc-dn">${+d.slice(8)}</span>
          <span class="fc-dots" aria-hidden="true">${list.slice(0, 4).map((r) => `<i class="lg-t-${loadStatus(r.status).tone}"></i>`).join('')}${list.length > 4 ? `<em class="fc-more">+${list.length - 4}</em>` : ''}</span>
          <span class="fc-evs" aria-hidden="true">${list.slice(0, 3).map((r) => `<span class="fc-ev lg-t-${loadStatus(r.status).tone}${isOpenLoad(r) ? '' : ' done'}">${esc(r.scheduledTime)} ${esc(r.containerNumber)}</span>`).join('')}${list.length > 3 ? `<span class="fc-more">+${list.length - 3} más</span>` : ''}</span></button>`;
      }).join('')}</div></div><div class="fc-daylist">${dayList(cal.selected)}</div>`;
    } else if (cal.view === 'week') {
      el.innerHTML = `<div class="fc-week">${weekDays(cal.cursor).map((d) => { const list = days.get(d) || []; return `<section class="fc-wday${d === today ? ' today' : ''}"><h3 class="fc-wh"><b>${esc(shortDay(d))}</b><small>${list.length ? plural(list.length, 'carga', 'cargas') : 'Sin cargas'}</small></h3>${list.length ? `<div class="fc-cards">${list.map((r) => card(r, { compact: true })).join('')}</div>` : '<p class="fc-none">Sin cargas</p>'}</section>`; }).join('')}</div>`;
    } else el.innerHTML = `<div class="fc-dayview">${dayList(cal.cursor)}</div>`;
    const inView = cal.view === 'month' ? [...days.entries()].filter(([d]) => monthOf(d) === monthOf(cal.cursor)) : cal.view === 'week' ? weekDays(cal.cursor).map((d) => [d, days.get(d) || []]) : [[cal.cursor, days.get(cal.cursor) || []]];
    const n = inView.reduce((a, [, l]) => a + l.length, 0);
    root.querySelector('[data-boardn]').textContent = n ? plural(n, 'carga', 'cargas') + (cal.view === 'month' ? ' este mes' : cal.view === 'week' ? ' esta semana' : '') : '';
  }
  function draw() {
    const all = fc.all(), sm = summary(all, fc.docsOf);
    const tiles = [['today', 'Hoy', sm.today, { preset: 'today' }], ['tomorrow', 'Mañana', sm.tomorrow, { preset: 'all', range: 'tomorrow' }], ['week', 'Esta semana', sm.week, { preset: 'upcoming', range: 'week' }],
      ['docs', 'Doc. pendiente', sm.docsPending, { preset: 'docs_pending' }], ['ready', 'Listas', sm.ready, { preset: 'all', status: 'ready' }], ['done', 'Finalizadas', sm.done, { preset: 'history' }]];
    root.querySelector('[data-tiles]').innerHTML = tiles.map(([k, l, c]) => `<button type="button" class="tile ec-tile fc-tile" data-tile="${k}" aria-label="${esc(l)}: ${c}"><small>${l}</small><b>${c}</b></button>`).join('');
    root.querySelector('[data-tiles]').dataset.map = JSON.stringify(Object.fromEntries(tiles.map(([k, , , fl]) => [k, fl])));
    root.querySelector('[data-f1]').innerHTML = PRESETS.map(([k, l]) => `<button type="button" class="chip${f.preset === k ? ' on' : ''}" data-preset="${k}" aria-pressed="${f.preset === k}">${esc(l)}</button>`).join('');
    const tName = f.terminalId ? (fc.terminalById(f.terminalId) || {}).name : '', yName = f.yardId ? (fc.loadingYardById(f.yardId) || {}).name : '';
    const uName = f.vehicleId ? (fc.unitById(f.vehicleId) || {}).label : '', oName = f.operatorId ? ((operatorList().find((o) => o.id === f.operatorId) || {}).name || '').split(' ').slice(0, 2).join(' ') : '';
    const rl = (RANGES.find(([k]) => k === f.range) || [])[1];
    root.querySelector('[data-f2]').innerHTML = [['location', f.location === 'all' ? 'Dentro / fuera' : locationLabel(f.location), f.location !== 'all'], ['terminal', tName || 'Terminal', !!f.terminalId], ['yard', yName || 'Patio', !!f.yardId],
      ['status', f.status === 'all' ? 'Estado' : loadStatus(f.status).short, f.status !== 'all'], ['vehicle', uName || 'Unidad', !!f.vehicleId], ['operator', oName || 'Operador', !!f.operatorId], ['range', f.range === 'all' ? 'Fecha' : rl, f.range !== 'all']]
      .map(([k, l, onf]) => `<button type="button" class="chip${onf ? ' on' : ''}" data-f="${k}">${esc(l)}${onf ? icon.close : icon.down}</button>`).join('');
    const filtered = base();
    drawCal(filtered);
    const list = listOf(filtered), hist = f.preset === 'history', shown = hist ? list.slice(0, shownHist) : list;
    const lbl = (PRESETS.find(([k]) => k === f.preset) || [])[1];
    root.querySelector('[data-list]').innerHTML = !all.length
      ? `<div class="empty"><p><b class="empty-t">Aún no hay cargas programadas</b>Programa la primera: contenedor, peso, dónde se carga, fecha y hora. El transporte se puede asignar después.</p><button type="button" class="btn-primary sm" data-new>${icon.plus}<span>Programar carga</span></button></div>`
      : `<div class="sec-hrow"><h2 class="sec-h">${esc(lbl)}</h2><span class="count">${list.length}</span></div>
        ${list.length ? `<div class="fc-cards fc-list">${shown.map((r) => card(r)).join('')}</div>${list.length > shown.length ? `<button type="button" class="btn-ghost block" data-more>Mostrar más (${list.length - shown.length})</button>` : ''}` : `<div class="empty"><p>${f.text || f.location !== 'all' || f.terminalId || f.yardId || f.vehicleId || f.operatorId || f.status !== 'all' || f.range !== 'all' ? 'Sin coincidencias con estos filtros.' : { today: 'No hay cargas programadas para hoy.', upcoming: 'No hay cargas próximas.', docs_pending: 'Todas las cargas abiertas tienen su documentación completa.', docs_ok: 'Ninguna carga abierta tiene todavía la documentación completa.', history: 'Aún no hay cargas finalizadas ni canceladas.' }[f.preset] || 'Sin cargas.'}</p></div>`}`;
  }
  on(root, 'click', '[data-back]', () => back('/operacion/logistica'));
  on(root, 'click', '[data-new]', () => openLoadForm(null, { onSaved: (r) => go(`/operacion/logistica/llenos/${r.id}`) }));
  on(root, 'click', '[data-more]', () => { shownHist += 20; draw(); });
  on(root, 'click', '[data-preset]', (e, b) => { f.preset = b.dataset.preset; draw(); });
  on(root, 'click', '[data-tile]', (e, b) => {
    const map = JSON.parse(root.querySelector('[data-tiles]').dataset.map || '{}')[b.dataset.tile] || {};
    f.preset = map.preset || 'all'; f.range = map.range || 'all'; f.status = map.status || 'all'; draw();
    root.querySelector('[data-f1]').scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
  on(root, 'click', '[data-view]', (e, b) => { cal.view = b.dataset.view; draw(); });
  on(root, 'click', '[data-cal]', (e, b) => {
    const k = b.dataset.cal, step = cal.view === 'month' ? 0 : cal.view === 'week' ? 7 : 1;
    if (k === 'today') { cal.cursor = todayStr(); cal.selected = cal.cursor; }
    else if (step) cal.cursor = addDays(cal.cursor, k === 'prev' ? -step : step);
    else { const [y, m] = parts(cal.cursor); const t = new Date(y, m - 1 + (k === 'prev' ? -1 : 1), 1); cal.cursor = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-01`; }
    if (cal.view === 'month' && monthOf(cal.selected) !== monthOf(cal.cursor)) cal.selected = cal.cursor.slice(0, 8) + '01';
    draw();
  });
  on(root, 'click', '[data-day]', (e, b) => { cal.selected = b.dataset.day; if (monthOf(b.dataset.day) !== monthOf(cal.cursor)) cal.cursor = b.dataset.day; draw(); });
  on(root, 'click', '[data-f]', async (e, b) => {
    const k = b.dataset.f;
    if (k === 'location') { f.location = f.location === 'all' ? 'port' : f.location === 'port' ? 'offport' : 'all'; draw(); return; }
    if (k === 'range') { const v = await actionSheet({ title: 'Fecha programada', actions: RANGES.map(([key, l]) => ({ label: l, value: key, style: key === f.range ? 'primary' : '' })) }); if (v) { f.range = v; draw(); } return; }
    if (k === 'status') { const v = await actionSheet({ title: 'Estado de la carga', actions: [{ label: 'Todos', value: 'all' }, ...LOAD_STATUSES.map((x) => ({ label: x.label, value: x.key, style: x.key === f.status ? 'primary' : '' }))] }); if (v) { f.status = v; draw(); } return; }
    const key = { terminal: 'terminalId', yard: 'yardId', vehicle: 'vehicleId', operator: 'operatorId' }[k];
    if (f[key]) { f[key] = ''; draw(); return; }
    const used = new Set(fc.all().map((r) => r[key]).filter(Boolean));
    let items = [];
    if (k === 'terminal') items = listAll('terminals').filter((t) => used.has(t.id)).map((t) => ({ value: t.id, label: t.name }));
    if (k === 'yard') items = listAll('loadingYards').filter((y) => used.has(y.id)).map((y) => ({ value: y.id, label: y.name }));
    if (k === 'vehicle') items = fleetUnits().filter((u) => used.has(u.id)).map((u) => ({ value: u.id, label: u.label, sub: u.placas }));
    if (k === 'operator') items = operatorList().filter((o) => used.has(o.id)).map((o) => ({ value: o.id, label: o.name }));
    if (!items.length) { toast('Aún no hay cargas con este dato.', { type: 'info' }); return; }
    const r = await openPicker({ title: { terminal: 'Terminal portuaria', yard: 'Patio / instalación de carga', vehicle: 'Unidad', operator: 'Operador' }[k], allowNew: false, items });
    if (r) { f[key] = r.value; draw(); }
  });
  root.querySelector('.search-in').addEventListener('input', (e) => { f.text = e.target.value; draw(); });
  draw();
  const un = fc.onFullsChange(draw), t = setInterval(draw, 60000);   /* «Cita vencida» sigue el reloj */
  s.cleanup = () => { un(); clearInterval(t); };
  return s;
}

/* ===== Detalle ===== */
export async function fullDetailScreen({ id }) {
  await fc.loadFulls();
  if (!fc.byId(id)) { toast('Esa carga ya no existe.', { type: 'info' }); go('/operacion/logistica/llenos', { replace: true }); return null; }
  const s = screen('<div class="page lg-page ec-page fc-detail"></div>');
  const root = s.el;
  let replaceTarget = null;
  async function draw() {
    const r = fc.byId(id); if (!r) return;
    const v = fc.view(r), open = isOpenLoad(r), late = isLate(r), y = window.scrollY, ev = fc.eventsOf(id), docs = fc.docsOf(id), sum = v.docs;
    const gone = await fc.missingFiles(id);
    await media.ensureURLs(docs.filter((d) => d.kind === 'img' && hasFile(d) && !gone.has(d.id)).map((d) => d.storageKey));
    const row = (k, x) => `<div><dt>${k}</dt><dd>${x || '<i>—</i>'}</dd></div>`;
    const docRow = (d) => {
      const st = docState(d), ok = hasFile(d) && !gone.has(d.id), err = d.fileStatus === 'error', t = docType(d.docType);
      const meta = ok ? [d.kind === 'pdf' ? 'PDF' : 'Imagen', d.kind === 'pdf' && d.pages ? plural(d.pages, 'página', 'páginas') : '', fmtSize(d.size || 0), d.attachedAt ? whenText(dayStr(new Date(d.attachedAt)), hmStr(new Date(d.attachedAt)), { year: true }) : ''].filter(Boolean).join(' · ') : '';
      return `<li class="att fc-doc ${st}${err ? ' err' : ''}" data-doc="${esc(d.id)}">
        <span class="att-ic ${ok ? esc(d.kind) : 'none'}"${ok && d.kind === 'img' ? ` style="background-image:url('${media.urlFor(d.storageKey)}')"` : ''}>${ok ? (d.kind === 'pdf' ? 'PDF' : '') : err ? 'ERR' : icon.file}</span>
        <span class="att-tx"><b>${esc(docLabel(d))}${d.docType === 'otro' ? ' <small class="fc-extra">adicional</small>' : ''}</b>
          <small><span class="fc-dst ${st}">${DOC_STATE_LABELS[st]}${st === 'attached' && !d.required ? ' · opcional' : ''}</span>${ok ? `${esc(d.name)} · ${esc(meta)}` : err ? `<span class="td-errt">${icon.alert}No se pudo procesar «${esc(d.name)}»</span>` : gone.has(d.id) ? `<span class="td-errt">${icon.alert}Archivo no disponible en este dispositivo</span>` : d.required ? 'Falta adjuntar' : 'No se pide para esta carga'}</small>
          ${!ok && !err && !gone.has(d.id) ? `<span class="fc-upwrap"><label class="btn-secondary sm fc-up" data-w>${icon.upload}<span>Subir ${esc(t.short)}</span><input type="file" accept="${fc.ACCEPT}" hidden data-up="${esc(d.id)}"></label></span>` : ''}</span>
        <span class="att-b"><button type="button" class="icon-btn" data-dact="more"${ok || err || gone.has(d.id) ? '' : ' data-w'} aria-label="Acciones de ${esc(docLabel(d))}">${icon.more}</button></span></li>`;
    };
    root.innerHTML = `
      <header class="nav-top"><button type="button" class="nav-back" data-back>${icon.back}<span>Control de llenos</span></button>
        <button type="button" class="nav-act" data-more data-w aria-label="Más acciones">${icon.more}</button></header>
      <section class="lg-hero ec-hero fc-hero lg-t-${loadStatus(r.status).tone}">
        <small>Contenedor lleno</small><h1 class="ec-num big mono">${esc(r.containerNumber)}</h1>
        <div class="ec-st">${statusChip(r.status, 'lg-big')}${docChip(sum)}${late ? lateChip() : ''}</div>
        <p class="lg-hero-sub">${icon.calendar}<b>${esc(longDay(r.scheduledDate))} · ${esc(r.scheduledTime)}</b><br>${locBadge(r)}${v.place ? ` · ${esc(v.place)}` : ''} · ${esc(v.weight)}</p>
        <div class="ec-acts" data-w>
          <button type="button" class="btn-primary block lg" data-a="docs">${icon.paperclip}<span>${sum.complete ? 'Ver documentación' : 'Subir documentos'}</span></button>
          <div class="sheet-acts"><button type="button" class="btn-secondary" data-a="edit">${icon.edit}<span>Editar</span></button><button type="button" class="btn-secondary" data-a="reschedule">${icon.clock}<span>Reprogramar</span></button></div>
          <div class="sheet-acts"><button type="button" class="btn-secondary" data-a="assign">${icon.truck}<span>${v.unit || v.operator ? 'Transporte' : 'Asignar transporte'}</span></button><button type="button" class="btn-secondary" data-a="status">${icon.swap}<span>Cambiar estado</span></button></div>
        </div>
      </section>
      <section class="grp"><div class="grp-h"><h3>Carga</h3></div><dl class="sumlist lg-sum">
        ${row('Contenedor', `<b class="mono">${esc(r.containerNumber)}</b>`)}${row('Peso', esc(v.weight))}
        ${row('Fecha y hora', `${esc(fmtDate(r.scheduledDate))} · ${esc(r.scheduledTime)}${late ? '<small class="warn-t">La hora programada ya pasó</small>' : ''}`)}
        ${row('Ubicación', esc(v.location))}${row(placeLabel(r.locationType), v.place ? esc(v.place) + (v.placeAddress ? `<small>${esc(v.placeAddress)}</small>` : '') : '')}
        ${row('Referencia', esc(r.reference))}${row('Estado', statusChip(r.status))}${r.notes ? row('Observaciones', esc(r.notes)) : ''}
      </dl></section>
      <section class="grp"><div class="grp-h"><h3>Transporte</h3><button type="button" class="btn-ghost sm" data-a="assign" data-w>${icon.edit}<span>${v.unit || v.operator || v.trailer ? 'Cambiar' : 'Asignar'}</span></button></div><dl class="sumlist lg-sum">
        ${row('Unidad', v.unit ? `${esc(v.unit)}${v.placas ? `<small>${esc(v.placas)}</small>` : ''}` : '<i>Sin asignar</i>')}
        ${row('Operador', v.operator ? esc(v.operator) : '<i>Sin asignar</i>')}
        ${row('Remolque / chasis', v.trailer ? `<span class="lg-tt">${trailerIcon(v.trailerType)}<span>${esc(v.trailer)} · ${esc(trailerTypeLabel(v.trailerType))}</span></span>` : '<i>Sin asignar</i>')}
        ${r.logisticsOperationId && lg.opById(r.logisticsOperationId) ? row('Operación de Logística', `<a href="#/operacion/logistica/u/${esc(lg.opById(r.logisticsOperationId).vehicleId)}">${esc(lg.view(lg.opById(r.logisticsOperationId)).label)} · ${esc(lg.opById(r.logisticsOperationId).reference || lg.view(lg.opById(r.logisticsOperationId)).operator || 'Ver en Logística')}</a>`) : r.vehicleId ? row('Logística', `<a href="#/operacion/logistica/u/${esc(r.vehicleId)}">Ver unidad en Logística</a>`) : ''}
        ${v.trip ? row('Viaje relacionado', `<a href="#/operadores/${esc(v.trip.operatorId)}?viaje=${esc(v.trip.id)}">${esc(fmtDate(v.trip.date))} · ${esc(v.trip.origin)} → ${esc(v.trip.destination)}</a>`) : ''}
      </dl></section>
      <section class="grp fc-docs" id="fc-docs"><div class="grp-h"><h3>Documentación</h3><span class="count">${sum.attached} de ${sum.required}</span></div><div class="grp-b">
        <p class="fc-docst ${sum.complete ? 'ok' : 'warn'}">${sum.complete ? icon.check : icon.alert}<span>${esc(docSummaryText(sum))}${sum.optional ? ` · ${plural(sum.optional, 'opcional adjuntado', 'opcionales adjuntados')}` : ''}</span></p>
        <ul class="att-list fc-doclist">${docs.map(docRow).join('')}</ul>
        <label class="btn-secondary block fc-add" data-w>${icon.plus}<span>Añadir documento</span><input type="file" accept="${fc.ACCEPT}" multiple hidden data-add-files></label>
        <input type="file" accept="${fc.ACCEPT}" hidden data-replace>
        <div class="sheet-acts td-acts"><button type="button" class="btn-secondary" data-a="preview"${sum.files ? '' : ' disabled'}>${icon.eye}<span>Ver expediente</span></button><button type="button" class="btn-primary" data-a="build"${sum.files ? '' : ' disabled'}>${icon.file}<span>Generar PDF</span></button></div>
        <p class="grp-note">${r.locationType === 'port' ? 'Dentro de puerto se piden pedimento, DODA, cita de recinto portuario y DEC.' : 'Fuera de puerto se piden pedimento y DODA; la cita cuando aplique.'} Cada documento se guarda por separado (PDF, JPG o PNG; desde iPhone: Archivos, Fotos o cámara) y puede marcarse como no requerido. El expediente PDF los une sin modificar los originales.</p>
      </div></section>
      <div class="sec-hrow"><h2 class="sec-h">Historial</h2><span class="count">${ev.length}</span></div>
      <div class="list">${ev.map(eventRow).join('')}</div>`;
    window.scrollTo(0, y);
  }
  async function upload(files, opts, label) {
    busy(true, 'Guardando documento…', label || '');
    const bad = [];
    let last = null;
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        busy(true, 'Guardando documento…', files.length > 1 ? `Procesando ${i + 1} de ${files.length}` : file.name);
        try { last = await fc.attachFile(id, file, opts); } catch (err) { bad.push(`«${file.name}»: ${err.message || 'no se pudo guardar'}`); }
      }
    } finally { busy(false); }
    if (last && last.fileStatus === 'error') toast(`No se pudo procesar «${last.name}». Puedes reintentar o eliminarlo.`, { type: 'warn', ms: 5000 });
    else if (last) toast(opts.docId ? 'Documento reemplazado' : files.length > 1 ? `${files.length - bad.length} documentos añadidos` : `${docLabel(last)} ${docType(last.docType).fem ? 'adjuntada' : 'adjuntado'}`);
    if (bad.length) toast(bad.join(' · '), { type: 'warn', ms: 5500 });
  }
  root.addEventListener('change', async (e) => {
    const inp = e.target; if (!inp.matches('input[type=file]')) return;
    const files = [...(inp.files || [])]; inp.value = '';
    if (!files.length) return;
    if (inp.dataset.up) { const d = fc.docById(inp.dataset.up); await upload(files.slice(0, 1), { docId: inp.dataset.up }, d ? docLabel(d) : ''); }
    else if (inp.hasAttribute('data-replace')) { if (replaceTarget) await upload(files.slice(0, 1), { docId: replaceTarget }, 'Reemplazando'); replaceTarget = null; }
    else if (inp.hasAttribute('data-add-files')) await upload(files, { docType: 'otro' }, '');
  });
  on(root, 'click', '[data-back]', () => back('/operacion/logistica/llenos'));
  on(root, 'click', '[data-a]', async (e, b) => {
    const r = fc.byId(id); if (!r) return;
    const a = b.dataset.a;
    try {
      if (a === 'docs') root.querySelector('#fc-docs').scrollIntoView({ block: 'start', behavior: 'smooth' });
      if (a === 'edit') openLoadForm(r, {});
      if (a === 'reschedule') openRescheduleForm(r);
      if (a === 'assign') openAssignForm(r);
      if (a === 'status') openStatusSheet(r);
      if (a === 'preview') await openDossierPreview(r);
      if (a === 'build') await generateDossier(r);
    } catch (err) { toast(err.message || 'No se pudo completar la acción.', { type: 'warn' }); }
  });
  on(root, 'click', '[data-dact]', async (e, b) => {
    const li = b.closest('[data-doc]'), d = li && fc.docById(li.dataset.doc); if (!d) return;
    const ok = hasFile(d), err = d.fileStatus === 'error', t = docType(d.docType);
    const extras = fc.docsOf(id).filter((x) => x.docType === 'otro'), i = extras.findIndex((x) => x.id === d.id);
    const v = await actionSheet({ title: docLabel(d), message: ok ? `${d.name} · ${DOC_STATE_LABELS[docState(d)]}` : DOC_STATE_LABELS[docState(d)], actions: [
      ...(ok ? [{ label: 'Ver', value: 'view', icon: icon.eye }, { label: 'Descargar / compartir', value: 'download', icon: icon.share }, { label: 'Reemplazar archivo', value: 'replace', icon: icon.refresh }] : []),
      ...(err ? [{ label: 'Reintentar', value: 'retry', icon: icon.refresh }] : []),
      ...(!ok && !err ? [{ label: `Subir ${t.short}`, value: 'upload', icon: icon.upload }] : []),
      { label: d.required ? 'Marcar como no requerido' : 'Marcar como requerido', value: 'required', icon: d.required ? icon.minus : icon.check },
      ...(d.docType === 'otro' ? [{ label: 'Cambiar nombre', value: 'rename', icon: icon.edit }, ...(i > 0 ? [{ label: 'Subir en el orden', value: 'up', icon: icon.up }] : []), ...(i < extras.length - 1 ? [{ label: 'Bajar en el orden', value: 'down', icon: icon.down }] : [])] : []),
      ...(ok || err ? [{ label: d.docType === 'otro' ? 'Eliminar documento' : 'Eliminar archivo', value: 'del', style: 'destructive', icon: icon.trash }] : []),
    ] });
    try {
      if (v === 'view') await viewDoc(d);
      if (v === 'download') await downloadDoc(d);
      if (v === 'replace') { replaceTarget = d.id; root.querySelector('[data-replace]').click(); }
      if (v === 'upload') { const inp = li.querySelector('[data-up]'); if (inp) inp.click(); }
      if (v === 'retry') { busy(true, 'Procesando archivo…', d.name); try { await fc.retryDoc(d.id); busy(false); toast('Archivo procesado'); } catch (err) { busy(false); toast(`No se pudo procesar «${d.name}». Puede estar dañado; puedes eliminarlo y subirlo de nuevo.`, { type: 'warn', ms: 5000 }); } }
      if (v === 'required') { await fc.setRequired(d.id, !d.required); toast(d.required ? `${docLabel(d)}: no requerido` : `${docLabel(d)}: requerido`); }
      if (v === 'rename') renameDoc(d);
      if (v === 'up' || v === 'down') await fc.moveDoc(d.id, v === 'up' ? -1 : 1);
      if (v === 'del') {
        if (!(await confirmDestructive(d.docType === 'otro' ? '¿Eliminar este documento?' : `¿Eliminar el archivo de ${docLabel(d)}?`, d.docType === 'otro' ? `${d.name}. Se quita de la carga y del expediente.` : `${d.name}. ${docLabel(d)} quedará ${d.required ? 'pendiente' : 'sin archivo'}; puedes subir otro después.`, 'Eliminar'))) return;
        await fc.removeFile(d.id); toast('Archivo eliminado', { type: 'info' });
      }
    } catch (err) { toast(err.message || 'No se pudo completar la acción.', { type: 'warn' }); }
  });
  on(root, 'click', '[data-more]', async () => {
    const r = fc.byId(id); if (!r) return;
    const open = isOpenLoad(r);
    const v = await actionSheet({ title: r.containerNumber, message: `${loadStatus(r.status).label} · ${whenText(r.scheduledDate, r.scheduledTime, { year: true })}`, actions: [
      { label: 'Ver expediente', value: 'preview', icon: icon.eye }, { label: 'Generar PDF del expediente', value: 'build', icon: icon.file },
      { label: 'Editar carga', value: 'edit', icon: icon.edit }, { label: 'Reprogramar cita', value: 'reschedule', icon: icon.clock }, { label: 'Asignar transporte', value: 'assign', icon: icon.truck },
      { label: 'Cambiar estado', value: 'status', icon: icon.swap }, { label: 'Vincular con Logística / viaje', value: 'link', icon: icon.link },
      ...(open ? [{ label: 'Cancelar carga', value: 'cancel', style: 'destructive', icon: icon.close }] : [{ label: 'Reabrir (volver a Programada)', value: 'reopen', icon: icon.refresh }]),
      ...(r.status === 'cancelled' ? [{ label: 'Eliminar carga', value: 'delete', style: 'destructive', icon: icon.trash }] : []),
    ] });
    try {
      if (v === 'preview') await openDossierPreview(r);
      if (v === 'build') await generateDossier(r);
      if (v === 'edit') openLoadForm(r, {});
      if (v === 'reschedule') openRescheduleForm(r);
      if (v === 'assign') openAssignForm(r);
      if (v === 'status') openStatusSheet(r);
      if (v === 'link') await openLinkSheet(r);
      if (v === 'cancel' && await confirmDestructive('¿Cancelar esta carga?', `${r.containerNumber}. Queda en el historial con sus documentos; se puede reabrir.`, 'Cancelar carga')) { await fc.setStatus(r.id, 'cancelled'); toast('Carga cancelada'); }
      if (v === 'reopen') { await fc.setStatus(r.id, 'scheduled'); toast('Carga reabierta'); }
      if (v === 'delete' && await confirmDestructive('¿Eliminar la carga?', `${r.containerNumber}. Se borran sus documentos, archivos e historial de este dispositivo. Esta acción no se puede deshacer.`, 'Eliminar carga')) { await fc.remove(r.id); toast('Carga eliminada', { type: 'info' }); go('/operacion/logistica/llenos', { replace: true }); }
    } catch (err) { toast(err.message || 'No se pudo completar la acción.', { type: 'warn' }); }
  });
  await draw();
  const un = fc.onFullsChange(draw), t = setInterval(draw, 60000);
  s.cleanup = () => { un(); clearInterval(t); };
  return s;
}

/* ===== Ver y descargar un documento ===== */
const docFile = async (d) => {
  const blob = await fc.blobOf(d);
  if (!blob) return null;
  /* El tipo sale del kind validado (pdf | img), nunca del dato guardado: un archivo importado no puede abrirse como página */
  const type = d.kind === 'img' ? (/^image\/(jpeg|png)$/.test(blob.type) ? blob.type : 'image/jpeg') : 'application/pdf';
  return new File([blob], d.name || `${docLabel(d)}.${d.kind === 'pdf' ? 'pdf' : 'jpg'}`, { type });
};
async function viewDoc(d) {
  const file = await docFile(d);
  if (!file) { toast('El archivo ya no está en este dispositivo.', { type: 'warn' }); return; }
  const meta = [d.kind === 'pdf' ? 'PDF' : 'Imagen', d.kind === 'pdf' && d.pages ? plural(d.pages, 'página', 'páginas') : '', fmtSize(d.size || 0)].filter(Boolean).join(' · ');
  if (d.kind === 'img') {
    const u = await media.ensureURL(d.storageKey);
    const sh = openSheet({ title: docLabel(d), full: true, body: `<img class="ph-big td-img" src="${u}" alt="${esc(docLabel(d))}"><p class="sheet-lead center">${esc(d.name)} · ${esc(meta)}</p>
      <div class="sheet-acts col"><button type="button" class="btn-secondary block" data-ext>${icon.share}<span>Compartir imagen</span></button></div>` });
    sh.body.querySelector('[data-ext]').addEventListener('click', async () => { const r = await shareFile(file, { title: file.name }); if (r !== 'shared' && r !== 'cancelled') downloadBlob(file, file.name); });
    return;
  }
  const sh = openSheet({ title: docLabel(d), body: `<div class="vw-file">${icon.file}<div><b>${esc(d.name)}</b><small>${esc(meta)}</small></div></div>
    <div class="sheet-acts col"><button type="button" class="btn-primary block" data-open>${icon.eye}<span>Abrir PDF</span></button><button type="button" class="btn-secondary block" data-share>${icon.share}<span>Compartir</span></button></div>` });
  sh.body.querySelector('[data-open]').addEventListener('click', () => openBlob(file));
  sh.body.querySelector('[data-share]').addEventListener('click', async () => { const r = await shareFile(file, { title: file.name }); if (r !== 'shared' && r !== 'cancelled') downloadBlob(file, file.name); });
}
async function downloadDoc(d) {
  const file = await docFile(d);
  if (!file) { toast('El archivo ya no está en este dispositivo.', { type: 'warn' }); return; }
  const r = await shareFile(file, { title: file.name });
  if (r === 'shared') toast('Listo');
  else if (r !== 'cancelled') { downloadBlob(file, file.name); toast(isIOS() ? 'Se abrió la descarga. Desde ahí puedes guardarla en Archivos.' : 'Descargado: ' + file.name, { ms: 3500 }); }
}
function renameDoc(d) {
  const form = document.createElement('form'); form.className = 'op-form'; form.noValidate = true;
  form.innerHTML = `<label class="fld"><span class="fl">Nombre del documento</span><input class="in" name="n" value="${esc(d.label || d.name)}" maxlength="80" autocomplete="off" enterkeyhint="done"></label>
    <div class="form-foot"><button type="submit" class="btn-primary block lg">Guardar nombre</button></div>`;
  const sh = openSheet({ title: 'Cambiar nombre', body: form });
  setTimeout(() => form.elements.n.focus(), 250);
  form.addEventListener('submit', async (e) => { e.preventDefault(); const n = form.elements.n.value.trim(); if (!n) { toast('Escribe un nombre.', { type: 'warn' }); return; } await fc.renameDoc(d.id, n); sh.close(); toast('Nombre actualizado'); });
}

/* ===== Selectores de catálogo (terminal, patio, unidad, operador, remolque) ===== */
const pickBtn = (k, label, hint = '') => `<div class="fld" data-f="${k}"><span class="fl">${label}</span><button type="button" class="in pick" data-pk="${k}"><span class="pv"></span><span class="pick-ic">${icon.chev}</span></button>${hint ? `<span class="fhint">${hint}</span>` : ''}<span class="ferr" data-err="${k}"></span></div>`;
function setPick(form, k, val, sub, ph) { const b = form.querySelector(`[data-pk="${k}"]`); if (!b) return; b.classList.toggle('empty', !val); b.querySelector('.pv').innerHTML = `<span class="pv-v">${esc(val || ph)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}`; }
async function pickCatalog(k, st, { recentsFrom = [] } = {}) {
  if (k === 'terminalId') {
    const items = listAll('terminals').map((t) => ({ value: t.id, label: t.name, sub: t.address || '' }));
    if (!items.length) { toast('No hay terminales en el catálogo. Agrégalas en Administración → Catálogos → Terminales portuarias.', { type: 'info', ms: 5000 }); return; }
    const x = await openPicker({ title: 'Terminal portuaria', allowNew: false, placeholder: 'Buscar terminal', current: st.terminalId || '', items, recents: recentsFrom.map((r) => r.terminalId).filter(Boolean).slice(0, 3) });
    if (x) st.terminalId = x.value;
  }
  if (k === 'yardId') {
    const x = await openPicker({ title: 'Patio / instalación de carga', placeholder: 'Buscar o escribir', current: st.yardId || '', newLabel: 'Agregar al catálogo', autocap: 'characters', transform: (t) => t.toUpperCase(),
      items: activeLoadingYards().map((y) => ({ value: y.id, label: y.name, sub: y.address || y.notes || '' })), recents: [...new Set(recentsFrom.map((r) => r.yardId).filter(Boolean))].slice(0, 3),
      emptyText: 'Aún no hay patios ni instalaciones de carga. Escribe el nombre para agregarlo al catálogo.' });
    if (!x) return;
    if (x.isNew) { const y = await saveCatalog('loadingYards', { name: x.value, address: '', notes: '', active: '', source: 'auto' }); st.yardId = y.id; toast(`«${y.name}» agregado al catálogo de patios e instalaciones de carga`); }
    else st.yardId = x.value;
  }
  if (k === 'vehicleId') {
    const x = await openPicker({ title: 'Unidad', allowNew: false, placeholder: 'Buscar unidad o placas', current: st.vehicleId || '', items: [{ value: '__none', label: 'Sin unidad', sub: 'Asignar después' }, ...fleetUnits().map((u) => ({ value: u.id, label: u.label, sub: [u.placas, u.companyShort].filter(Boolean).join(' · ') }))] });
    if (x) st.vehicleId = x.value === '__none' ? null : x.value;
  }
  if (k === 'operatorId') {
    const list = operatorList(); if (!list.length) { toast('No hay operadores en el catálogo.', { type: 'info' }); return; }
    const x = await openPicker({ title: 'Operador', allowNew: false, placeholder: 'Buscar operador', current: st.operatorId || '', items: [{ value: '__none', label: 'Sin operador', sub: 'Asignar después' }, ...list.map((o) => ({ value: o.id, label: o.name, sub: o.companyShort }))] });
    if (x) st.operatorId = x.value === '__none' ? null : x.value;
  }
  if (k === 'trailerId') {
    const items = listAll('trailers').map((t) => ({ value: t.id, label: t.placas, type: t.type || '', sub: [trailerTypeLabel(t.type), t.desc].filter(Boolean).join(' · '), icon: trailerIcon(t.type) }));
    if (!items.length) { toast('No hay remolques en el catálogo.', { type: 'info' }); return; }
    const x = await openPicker({ title: 'Remolque / chasis', allowNew: false, placeholder: 'Buscar placas', current: st.trailerId || '', scope: { ...trailerScope('puerto'), rank: (it) => (it.value === '__none' ? 1 : trailerScope('puerto').rank(it)) }, items: [{ value: '__none', label: 'Sin remolque', sub: 'Asignar después' }, ...items] });
    if (x) st.trailerId = x.value === '__none' ? null : x.value;
  }
}
function paintTransport(form, st) {
  const u = fc.unitById(st.vehicleId), o = st.operatorId ? operatorList().find((x) => x.id === st.operatorId) : null, t = fc.trailerById(st.trailerId);
  setPick(form, 'vehicleId', u && u.label, u && u.placas, 'Opcional');
  setPick(form, 'operatorId', o && o.name, o && o.companyShort, 'Opcional');
  setPick(form, 'trailerId', t && t.placas, t && trailerTypeLabel(t.type), 'Opcional');
}

/* ===== Programar / editar carga ===== */
export function openLoadForm(load, { onSaved } = {}) {
  const editing = !!load;
  const st = { locationType: editing ? load.locationType : 'port', terminalId: editing ? load.terminalId : null, yardId: editing ? load.yardId : null, vehicleId: editing ? load.vehicleId : null, operatorId: editing ? load.operatorId : null, trailerId: editing ? load.trailerId : null };
  const recents = fc.all().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const { form } = formSheet({
    title: editing ? 'Editar carga' : 'Programar carga', saveLabel: editing ? 'Guardar cambios' : 'Programar carga',
    html: `<div class="fld" data-f="containerNumber"><span class="fl">Número de contenedor</span><input class="in mono" name="containerNumber" value="${esc(editing ? load.containerNumber : '')}" autocomplete="off" autocapitalize="characters" spellcheck="false" autocorrect="off" placeholder="Ej. MSCU1234567" enterkeyhint="next"><span class="fhint" data-chk></span><span class="ferr" data-err="containerNumber"></span></div>
      <div class="row2"><label class="fld" data-f="weightKg"><span class="fl">Peso (kg)</span><input class="in" name="weightKg" inputmode="numeric" value="${esc(editing ? String(load.weightKg) : '')}" autocomplete="off" placeholder="Ej. 28500" enterkeyhint="next"><span class="ferr" data-err="weightKg"></span></label>
        <label class="fld" data-f="reference"><span class="fl">Referencia (opcional)</span><input class="in" name="reference" value="${esc(editing ? load.reference || '' : '')}" maxlength="60" autocomplete="off" autocapitalize="characters" placeholder="BL, pedido, cliente…" enterkeyhint="next"><span class="ferr" data-err="reference"></span></label></div>
      <div class="fld" data-f="locationType"><span class="fl">Tipo de ubicación</span><div class="seg big">${LOCATIONS.map(([k, l]) => `<button type="button" class="seg-b${st.locationType === k ? ' on' : ''}" data-loc="${k}" aria-pressed="${st.locationType === k}">${l}</button>`).join('')}</div><span class="ferr" data-err="locationType"></span></div>
      <div data-port>${pickBtn('terminalId', 'Terminal portuaria')}</div>
      <div data-off>${pickBtn('yardId', 'Patio / instalación de carga', 'Elige del catálogo o escribe uno nuevo para agregarlo.')}</div>
      <div class="row2"><label class="fld" data-f="scheduledDate"><span class="fl">Fecha programada</span><input class="in" type="date" name="scheduledDate" value="${esc(editing ? load.scheduledDate : todayStr())}"><span class="ferr" data-err="scheduledDate"></span></label>
        <label class="fld" data-f="scheduledTime"><span class="fl">Hora programada</span><input class="in" type="time" name="scheduledTime" value="${esc(editing ? load.scheduledTime : '')}"><span class="ferr" data-err="scheduledTime"></span></label></div>
      <p class="lg-fh">Transporte (opcional)</p>
      ${pickBtn('vehicleId', 'Unidad')}${pickBtn('operatorId', 'Operador')}${pickBtn('trailerId', 'Remolque / chasis', 'Se muestran primero los chasis portacontenedor; los demás con «Ver todos».')}
      <p class="fhint">Puedes programar la carga sin transporte y asignarlo después.</p>
      <label class="fld"><span class="fl">Observaciones (opcional)</span><textarea class="in" name="notes" rows="2" enterkeyhint="enter">${esc(editing ? load.notes || '' : '')}</textarea></label>
      <p class="fc-dochint" data-dochint></p>`,
    onSubmit: async (f, sh) => {
      const input = { containerNumber: f.elements.containerNumber.value, weightKg: f.elements.weightKg.value, reference: f.elements.reference.value, notes: f.elements.notes.value, locationType: st.locationType, terminalId: st.terminalId, yardId: st.yardId, scheduledDate: f.elements.scheduledDate.value, scheduledTime: f.elements.scheduledTime.value, vehicleId: st.vehicleId, operatorId: st.operatorId, trailerId: st.trailerId };
      const dup = fc.duplicateOf(input.containerNumber, editing ? load.id : null);
      if (dup) {
        const v = await actionSheet({ title: 'Este contenedor ya tiene una carga abierta', message: `${dup.containerNumber} · ${whenText(dup.scheduledDate, dup.scheduledTime, { year: true })} · ${loadStatus(dup.status).label}`, actions: [{ label: editing ? 'Guardar de todos modos' : 'Programar de todos modos', value: 'go', style: 'primary' }, { label: 'Ver la carga existente', value: 'view' }] });
        if (v === 'view') { sh.close(); go(`/operacion/logistica/llenos/${dup.id}`); return; }
        if (v !== 'go') return;
      }
      const r = editing ? await fc.update(load.id, input) : await fc.create(input);
      if (r.errors) { const [k, msg] = Object.entries(r.errors)[0]; if (k === 'transport') toast(msg, { type: 'warn' }); else fail(f, k, msg); return; }
      sh.close(); toast(editing ? 'Cambios guardados' : 'Carga programada');
      onSaved && onSaved(r.load);
    },
  });
  const inp = form.elements.containerNumber;
  const check = () => { const n = cleanContainer(inp.value), h = form.querySelector('[data-chk]'), dup = n && fc.duplicateOf(n, editing ? load.id : null); h.className = 'fhint' + (n && (!isContainer(n) || dup) ? ' warn-t' : ''); h.textContent = !n ? '' : !isContainer(n) ? 'Formato: 4 letras y 7 números.' : dup ? `Ya tiene una carga abierta (${whenText(dup.scheduledDate, dup.scheduledTime)}).` : ''; };
  /* Se limpia al escribir o pegar («mscu 123-4567» → MSCU1234567) */
  inp.addEventListener('input', () => { const c = cleanContainer(inp.value).slice(0, 11); if (c !== inp.value) inp.value = c; check(); });
  function sync() {
    form.querySelectorAll('[data-loc]').forEach((b) => { const onb = b.dataset.loc === st.locationType; b.classList.toggle('on', onb); b.setAttribute('aria-pressed', onb); });
    form.querySelector('[data-port]').hidden = st.locationType !== 'port'; form.querySelector('[data-off]').hidden = st.locationType !== 'offport';
    const t = fc.terminalById(st.terminalId), yd = fc.loadingYardById(st.yardId);
    setPick(form, 'terminalId', t && t.name, t && t.address, 'Elegir terminal'); setPick(form, 'yardId', yd && yd.name, yd && yd.address, 'Elegir o escribir');
    paintTransport(form, st);
    const types = slotTypes(st.locationType);
    const keep = editing && st.locationType !== 'port' && fc.docsOf(load.id).some((d) => d.docType === 'dec' && hasFile(d));
    form.querySelector('[data-dochint]').innerHTML = `${icon.paperclip}<span>Documentación: ${types.map((k) => docType(k).label).join(' · ')}${st.locationType === 'port' ? '' : ' (la cita cuando aplique)'} · Documentos adicionales.${keep ? ' El DEC ya adjuntado se conserva y queda como no requerido.' : ''}</span>`;
  }
  form.addEventListener('click', async (e) => {
    const l = e.target.closest('[data-loc]'); if (l) { st.locationType = l.dataset.loc; sync(); return; }
    const b = e.target.closest('[data-pk]'); if (!b) return;
    await pickCatalog(b.dataset.pk, st, { recentsFrom: recents }); sync();
    const fld = b.closest('.fld'); if (fld) { fld.classList.remove('has-err'); const m = fld.querySelector('.ferr'); if (m) m.textContent = ''; }
  });
  sync(); check();
  if (!editing) setTimeout(() => inp.focus(), 300);
}

/* ===== Reprogramar ===== */
export function openRescheduleForm(load) {
  formSheet({
    title: 'Reprogramar cita', saveLabel: 'Reprogramar',
    html: `<div class="op-who"><span class="row-ic">${icon.container}</span><div><small>Contenedor</small><b class="mono">${esc(load.containerNumber)}</b></div></div>
      <p class="grp-note">Programada: <b>${esc(whenText(load.scheduledDate, load.scheduledTime, { year: true }))}</b>. La fecha anterior queda en el historial.</p>
      <div class="row2"><label class="fld" data-f="date"><span class="fl">Nueva fecha</span><input class="in" type="date" name="date" value="${esc(load.scheduledDate)}"><span class="ferr" data-err="date"></span></label>
        <label class="fld" data-f="time"><span class="fl">Nueva hora</span><input class="in" type="time" name="time" value="${esc(load.scheduledTime)}"><span class="ferr" data-err="time"></span></label></div>
      <label class="fld"><span class="fl">Motivo (opcional)</span><input class="in" name="reason" maxlength="80" autocomplete="off" placeholder="Ej. la terminal movió la cita" enterkeyhint="done"></label>`,
    onSubmit: async (f, sh) => {
      try { await fc.reschedule(load.id, { date: f.elements.date.value, time: f.elements.time.value, reason: f.elements.reason.value.trim() }); sh.close(); toast('Cita reprogramada'); }
      catch (err) { fail(f, /hora/.test(err.message) ? 'time' : 'date', err.message); }
    },
  });
}

/* ===== Asignar transporte ===== */
export function openAssignForm(load) {
  const st = { vehicleId: load.vehicleId, operatorId: load.operatorId, trailerId: load.trailerId };
  const { form } = formSheet({
    title: 'Asignar transporte', saveLabel: 'Guardar transporte',
    html: `<div class="op-who"><span class="row-ic">${icon.container}</span><div><small>Contenedor · ${esc(whenText(load.scheduledDate, load.scheduledTime))}</small><b class="mono">${esc(load.containerNumber)}</b></div></div>
      ${pickBtn('vehicleId', 'Unidad')}${pickBtn('operatorId', 'Operador')}${pickBtn('trailerId', 'Remolque / chasis', 'Se muestran primero los chasis portacontenedor.')}
      <p class="fhint">Los tres son opcionales: se pueden completar después.</p>`,
    onSubmit: async (f, sh) => {
      try { await fc.assign(load.id, st); sh.close(); toast('Transporte guardado'); } catch (err) { toast(err.message || 'No se pudo guardar.', { type: 'warn' }); }
    },
  });
  form.addEventListener('click', async (e) => { const b = e.target.closest('[data-pk]'); if (!b) return; await pickCatalog(b.dataset.pk, st); paintTransport(form, st); });
  paintTransport(form, st);
}

/* ===== Vínculo opcional con una operación de Logística o un viaje de Operadores (no crea viajes ni cobros) ===== */
async function openLinkSheet(load) {
  const v = await actionSheet({ title: 'Vincular carga', message: 'Relación opcional con Logística u Operadores. No crea viajes, comisiones ni documentos de transporte.', actions: [
    { label: 'Operación de Logística', value: 'op', icon: icon.truck }, { label: 'Viaje de Operadores', value: 'trip', icon: icon.route },
    ...(load.tripId || load.logisticsOperationId ? [{ label: 'Quitar vínculos', value: 'none', style: 'destructive', icon: icon.linkOff }] : [])] });
  if (!v) return;
  if (v === 'none') { await fc.link(load.id, {}); toast('Vínculos quitados'); return; }
  if (v === 'op') {
    const items = lg.all().filter((o) => !o.closedAt).map((o) => { const w = lg.view(o); return { value: o.id, label: `${w.label} · ${w.operator || 'Sin operador'}`, sub: [o.reference, o.origin || o.destination ? `${o.origin || '—'} → ${o.destination || '—'}` : ''].filter(Boolean).join(' · ') }; });
    if (!items.length) { toast('No hay operaciones abiertas en Logística.', { type: 'info' }); return; }
    const r = await openPicker({ title: 'Operación de Logística', allowNew: false, placeholder: 'Buscar unidad, operador o referencia', items, current: load.logisticsOperationId || '' });
    if (r) { await fc.link(load.id, { tripId: load.tripId, logisticsOperationId: r.value }); toast('Vinculada con Logística'); }
  }
  if (v === 'trip') {
    const names = new Map(operatorList().map((o) => [o.id, o.name]));
    const items = allTrips().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 80).map((t) => ({ value: t.id, label: `${fmtDate(t.date)} · ${t.origin} → ${t.destination}`, sub: [t.reference ? 'Ref. ' + t.reference : '', names.get(t.operatorId)].filter(Boolean).join(' · ') }));
    if (!items.length) { toast('No hay viajes registrados en Operadores.', { type: 'info' }); return; }
    const r = await openPicker({ title: 'Viaje de Operadores', allowNew: false, placeholder: 'Buscar ruta, referencia u operador', items, current: load.tripId || '' });
    if (r) { await fc.link(load.id, { tripId: r.value, logisticsOperationId: load.logisticsOperationId }); toast('Vinculada con el viaje'); }
  }
}

/* ===== Estado operativo ===== */
export function openStatusSheet(load) {
  const sum = fc.summaryOf(load);
  const body = document.createElement('div');
  body.innerHTML = `<p class="sheet-lead">Estado operativo de ${esc(load.containerNumber)}. ${sum.complete ? 'La documentación está completa.' : 'La documentación todavía está incompleta.'} El estado solo cambia aquí: pasar la hora de la cita no marca la carga como cargada.</p>
    <div class="lg-stlist">${LOAD_STATUSES.map((x) => `<button type="button" class="lg-stopt lg-t-${x.tone}${load.status === x.key ? ' on' : ''}" data-set="${x.key}"><i class="lg-dot" aria-hidden="true"></i><span class="lg-stx"><b>${esc(x.label)}</b><small>${esc(x.hint)}</small></span>${load.status === x.key ? icon.check : ''}</button>`).join('')}</div>`;
  const sh = openSheet({ title: 'Cambiar estado', body });
  body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-set]'); if (!b) return;
    try { await fc.setStatus(load.id, b.dataset.set); sh.close(); toast(`${load.containerNumber}: ${loadStatus(b.dataset.set).label}`); } catch (err) { toast(err.message || 'No se pudo cambiar el estado.', { type: 'warn' }); }
  });
}

/* ===== Expediente: vista previa (orden, qué incluir y páginas) ===== */
export async function openDossierPreview(load0) {
  const load = fc.byId(load0.id) || load0;
  const plan = await dossierPlan(load);
  if (!plan.all.length) { toast('Todavía no hay documentos adjuntados para el expediente.', { type: 'info' }); return; }
  const ids = plan.sections.filter((s) => s.kind === 'img').map((s) => s.doc.storageKey);
  await media.ensureURLs(ids);
  const skip = new Set(load.dossierSkip || []);
  const row = (d, i, n) => `<li class="att fc-xprow${skip.has(d.id) ? ' off' : ''}" data-xp="${esc(d.id)}">
      <label class="sw-row fc-xpsw"><input type="checkbox" switch class="sw" data-inc${skip.has(d.id) ? '' : ' checked'} aria-label="Incluir ${esc(docLabel(d))}"></label>
      <span class="att-ic ${esc(d.kind)}"${d.kind === 'img' && media.urlFor(d.storageKey) ? ` style="background-image:url('${media.urlFor(d.storageKey)}')"` : ''}>${d.kind === 'pdf' ? 'PDF' : ''}</span>
      <span class="att-tx"><b>${esc(docLabel(d))}</b><small>${esc(d.name)} · ${d.kind === 'pdf' ? plural(d.pages || 1, 'página', 'páginas') : 'imagen'}${plan.missing.has(d.id) ? ' · no disponible en este dispositivo' : ''}</small></span>
      <span class="att-b"><button type="button" class="icon-btn" data-mv="-1" aria-label="Subir"${i ? '' : ' disabled'}>${icon.up}</button><button type="button" class="icon-btn" data-mv="1" aria-label="Bajar"${i < n - 1 ? '' : ' disabled'}>${icon.down}</button></span></li>`;
  const page = (n, img = '') => `<figure class="td-pg${img ? '' : ' ph'}">${img ? `<img src="${img}" alt="Página ${n}" loading="lazy">` : `${icon.file}`}<figcaption>Página ${n}</figcaption></figure>`;
  const secHTML = plan.sections.map((s) => { const n = s.to - s.from + 1, pages = []; for (let k = 0; k < n; k++) pages.push(page(s.from + k, s.kind === 'img' ? media.urlFor(s.doc.storageKey) : '')); return `<section class="td-sec"><div class="td-sech"><b>${esc(s.label)}</b><small>${esc(s.name)} · ${n === 1 ? `Página ${s.from}` : `Páginas ${s.from} a ${s.to}`}</small></div><div class="td-pages">${pages.join('')}</div>${s.kind === 'pdf' ? '<p class="td-note">Páginas originales del PDF; se ven completas al generar el expediente.</p>' : ''}</section>`; }).join('');
  const sh = openSheet({ title: 'Vista previa del expediente', full: true, body: `
    <p class="sheet-lead">${esc(load.containerNumber)} · ${plan.sections.length ? `${plural(plan.pages, 'página', 'páginas')} · ${plural(plan.sections.length, 'documento', 'documentos')} · aprox. ${esc(fmtSize(plan.bytes))}` : 'Sin documentos incluidos'}</p>
    <h3 class="pk-h">Documentos y orden</h3>
    <ul class="att-list fc-xp" data-w>${plan.all.map((d, i) => row(d, i, plan.all.length)).join('')}</ul>
    ${plan.unavailable.length ? `<p class="op-warn">${icon.alert}<span>No disponible en este dispositivo: ${plan.unavailable.map((d) => esc(docLabel(d))).join(', ')}. Se omitirá.</span></p>` : ''}
    <h3 class="pk-h">Contenido final</h3>
    <div class="td-preview">${secHTML || '<p class="td-empty">Incluye al menos un documento.</p>'}</div>
    <div class="sheet-foot"><div class="sheet-acts"><button type="button" class="btn-secondary" data-x="back">${icon.back}<span>Volver</span></button><button type="button" class="btn-primary" data-x="build"${plan.sections.length ? '' : ' disabled'}>${icon.file}<span>Generar PDF</span></button></div></div>` });
  let dirty = false;
  const save = async () => {
    const order = [...sh.body.querySelectorAll('[data-xp]')].map((li) => li.dataset.xp), sk = order.filter((idd) => { const li = sh.body.querySelector(`[data-xp="${CSS.escape(idd)}"]`); return !li.querySelector('[data-inc]').checked; });
    await fc.setDossier(load.id, { order, skip: sk }); dirty = true;
  };
  sh.body.addEventListener('change', async (e) => { if (!e.target.matches('[data-inc]')) return; e.target.closest('[data-xp]').classList.toggle('off', !e.target.checked); await save(); sh.close(); openDossierPreview(load); });
  sh.body.addEventListener('click', async (e) => {
    const mv = e.target.closest('[data-mv]');
    if (mv) { const li = mv.closest('[data-xp]'), sib = +mv.dataset.mv < 0 ? li.previousElementSibling : li.nextElementSibling; if (!sib) return; if (+mv.dataset.mv < 0) li.parentNode.insertBefore(li, sib); else li.parentNode.insertBefore(sib, li); await save(); sh.close(); openDossierPreview(load); return; }
    const b = e.target.closest('[data-x]'); if (!b) return;
    if (b.dataset.x === 'back') { sh.close(); return; }
    sh.close(); generateDossier(fc.byId(load.id) || load);
  });
  return dirty;
}

/* ===== Expediente: generar PDF y compartir ===== */
export async function generateDossier(load0) {
  const load = fc.byId(load0.id) || load0;
  const plan = await dossierPlan(load);
  if (!plan.sections.length) { toast(plan.all.length ? 'Todos los documentos están excluidos del expediente. Revisa la vista previa.' : 'Todavía no hay documentos adjuntados para el expediente.', { type: 'info', ms: 4000 }); return; }
  if (plan.bytes > HEAVY_BYTES) {
    const ok = await actionSheet({ title: 'Expediente pesado', message: `Los documentos suman aprox. ${fmtSize(plan.bytes)}. En iPhone la combinación puede tardar y el archivo será grande para compartir.`, actions: [{ label: 'Generar de todos modos', value: true, style: 'primary' }] });
    if (!ok) return;
  }
  busy(true, 'Generando expediente…', '');
  let out;
  try { out = await buildDossier(load, { onProgress: (i, n, name) => busy(true, 'Generando expediente…', `${i} de ${n}: ${name}`) }); }
  catch (err) { busy(false); console.error(err); toast(err.message === 'No hay documentos que se puedan combinar.' ? err.message : 'No se pudo generar el expediente. Intenta de nuevo; si persiste, revisa el archivo más pesado.', { type: 'warn', ms: 5000 }); return; }
  busy(false);
  const f = out.file;
  const sh = openSheet({ title: 'Expediente generado', body: `
    <section class="ok-box stmt-ok">${icon.check}<span><b>${esc(f.name)}</b><small>${plural(out.pages, 'página', 'páginas')} · ${esc(fmtSize(f.size))}</small></span></section>
    ${out.skipped.length ? `<p class="op-warn">${icon.alert}<span>No se pudo incluir: ${out.skipped.map(esc).join(', ')}. El resto se combinó.</span></p>` : ''}
    <ol class="td-index">${out.sections.map((s) => `<li><span>${esc(s.label)}</span><small>${s.to > s.from ? `pp. ${s.from}–${s.to}` : `p. ${s.from}`}</small></li>`).join('')}</ol>
    <div class="sheet-acts col"><button type="button" class="btn-primary block" data-x="view">${icon.eye}<span>Ver PDF</span></button>
      <div class="sheet-acts td-two"><button type="button" class="btn-secondary" data-x="share">${icon.share}<span>Compartir</span></button><button type="button" class="btn-secondary" data-x="save">${icon.folder}<span>Guardar en Archivos</span></button></div>
      <button type="button" class="btn-wa block" data-x="wa">${icon.whatsapp}<span>Enviar por WhatsApp</span></button></div>
    <p class="grp-note">Archivo derivado: los documentos originales se conservan sin cambios. Si después agregas o cambias documentos, vuelve a generarlo.</p>` });
  sh.body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-x]'); if (!b) return;
    const x = b.dataset.x;
    if (x === 'view') { openBlob(f); return; }
    const r = await shareFile(f, { title: f.name, ...(x === 'wa' ? { text: `Expediente lleno ${load.containerNumber}` } : {}) });
    if (r === 'shared') toast(x === 'save' ? 'Listo' : 'Expediente compartido');
    else if (r !== 'cancelled') { downloadBlob(f, f.name); toast(isIOS() ? 'Se abrió la descarga del PDF. Desde ahí puedes guardarlo en Archivos o enviarlo por WhatsApp.' : x === 'wa' ? 'PDF descargado. Adjúntalo en WhatsApp desde tu equipo: ' + f.name : 'PDF descargado: ' + f.name, { ms: 4000 }); }
  });
}
