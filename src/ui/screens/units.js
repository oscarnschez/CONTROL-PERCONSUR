/*
 * Administración → Unidades (catálogo único PERCONSUR)
 *   #/unidades               indicadores documentales, búsqueda, filtros y tarjetas de unidad
 *   #/unidades/vencimientos  tablero de vencimientos (vencidos, hoy, 7/15/30 días) con orden
 *   #/unidades/revision      posibles registros duplicados (migración desde los catálogos por empresa)
 *   #/unidades/requisitos    documentos requeridos por tipo de unidad y días de aviso
 * El expediente de cada unidad está en unitFile.js (#/unidades/:id).
 * Los números salen de los documentos reales y de la fecha de hoy en la zona horaria operativa (se recalculan al volver
 * a la app y al cambiar el día).
 */
import { screen, on } from '../../core/dom.js';
import { go, back } from '../../core/router.js';
import * as un from '../../services/units.js';
import * as media from '../../services/media.js';
import { isReadOnly } from '../../services/access.js';
import { exportBackup } from '../../services/backup.js';
import { downloadBlob } from '../../services/share.js';
import {
  DOC_TYPES, DOC_KEYS, docType, FILTERS, passFilter, matchUnit, fleetSummary, alertRows, sortAlerts, ALERT_WINDOWS, ALERT_SORTS, VEHICLE_TYPES,
  unitTitle, ecoText, vehicleTypeLabel, isActive, daysText, dateShort, requiredFor, DEFAULT_REQUIREMENTS,
} from '../../domain/units/units.js';
import { esc } from '../../domain/shared/format.js';
import { getCompany } from '../../services/companies.js';
import { icon } from '../components/icons.js';
import { actionSheet } from '../components/sheet.js';
import { toast } from '../components/toast.js';
import { unitForm, chip, DOC_ICON } from './unitFile.js';

const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;
const state = { q: '', f: 'all' };

/* Tarjeta de unidad: fotografía frontal protagonista, número económico, placas, marca y modelo, estado y próximo vencimiento */
function card({ unit: u, st, photo }) {
  const name = [u.brand, u.model].filter(Boolean).join(' ');
  const nx = st.next, warn = st.expired.length ? { t: 'danger', s: `${plural(st.expired.length, 'documento vencido', 'documentos vencidos')}` } : null;
  return `<a class="un-card${isActive(u) ? '' : ' off'}" href="#/unidades/${encodeURIComponent(u.id)}" data-unit="${esc(u.id)}">
    <div class="un-ph">${photo && photo.thumbKey ? `<img data-thumb="${esc(photo.thumbKey)}" alt="Fotografía frontal de la ${esc(unitTitle(u))}">` : `<span class="un-noph">${icon.truck}<small>Sin fotografía</small></span>`}
      <span class="un-eco">${esc(ecoText(u.eco))}</span>${isActive(u) ? '' : '<span class="un-off">Inactiva</span>'}</div>
    <div class="un-b">
      <div class="un-t"><b>${esc(unitTitle(u))}</b><span class="un-st ${st.isComplete ? 'ok' : 'no'}">${st.isComplete ? icon.check : ''}${st.isComplete ? 'Completo' : 'Incompleto'}</span></div>
      <p class="un-s">${name ? esc(name) : '<i>Marca y modelo sin registrar</i>'}${u.year ? ` · ${esc(u.year)}` : ''}</p>
      <p class="un-pl">Placas <b class="mono">${u.placas ? esc(u.placas) : '—'}</b></p>
      <div class="un-docs"><span>Documentación: <b>${st.complete}/${st.total}</b> documentos requeridos</span><span class="un-bar" aria-hidden="true"><i style="width:${st.total ? Math.round((st.complete / st.total) * 100) : 100}%"></i></span></div>
      ${warn ? `<p class="un-next t-${warn.t}">${icon.alert}<span>${esc(warn.s)}</span></p>` : nx ? `<p class="un-next t-${nx.days <= 0 ? 'alert' : nx.days <= un.soonDays() ? 'warn' : 'ok'}">${icon.clock}<span>${esc(docType(nx.type).label)}: ${esc(daysText(nx.days))}</span></p>` : '<p class="un-next t-muted">' + icon.clock + '<span>Sin vencimientos registrados</span></p>'}
      <span class="un-go">Ver expediente${icon.chev}</span>
    </div></a>`;
}
/* Miniaturas: se cargan solo cuando la tarjeta está por entrar a la pantalla */
export function lazyThumbs(root) {
  const imgs = [...root.querySelectorAll('img[data-thumb]:not([src])')];
  if (!imgs.length) return () => {};
  const load = async (im) => { const u = await media.ensureURL(im.dataset.thumb); if (u) im.src = u; else im.replaceWith(Object.assign(document.createElement('span'), { className: 'un-noph', innerHTML: `${icon.truck}<small>Archivo no disponible</small>` })); };
  if (!('IntersectionObserver' in window)) { imgs.forEach(load); return () => {}; }
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { io.unobserve(e.target); load(e.target); } }), { rootMargin: '300px' });
  imgs.forEach((im) => io.observe(im));
  return () => io.disconnect();
}

export async function unitsScreen() {
  await un.loadUnits();
  const ro = isReadOnly();
  const s = screen(`<div class="page wide un-page">
    <header class="nav-top"><button type="button" class="nav-back" data-back>${icon.back}<span>Administración</span></button>
      ${ro ? '' : `<button type="button" class="nav-act" data-cfg aria-label="Requisitos documentales">${icon.gear}</button>`}</header>
    <div class="un-head">
      <div><p class="un-eyebrow">PERCONSUR</p><h1 class="title un-title">Unidades</h1>
        <p class="page-lead">Administración y control documental de la flota PERCONSUR.</p></div>
      ${ro ? '' : `<button type="button" class="btn-primary un-add" data-add>${icon.plus}<span>Agregar unidad</span></button>`}
    </div>
    <div data-notice></div>
    <div class="tiles un-kpis" data-kpis></div>
    <label class="search"><span class="search-ic">${icon.search}</span><input type="search" class="search-in" data-q placeholder="Número económico, placas, marca, modelo o VIN" value="${esc(state.q)}" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search" aria-label="Buscar unidades"></label>
    <div class="chips filters" data-filters role="group" aria-label="Filtrar unidades">${FILTERS.map(([k, l]) => `<button type="button" class="chip" data-f="${k}">${l}</button>`).join('')}</div>
    <div class="un-count" data-count aria-live="polite"></div>
    <div class="un-grid" data-grid></div>
  </div>`);
  const root = s.el;
  let unThumbs = () => {};
  function draw() {
    const day = un.today(), rows = un.rows(day), sum = fleetSummary(rows);
    const dups = un.duplicates();
    root.querySelector('[data-notice]').innerHTML = [
      dups.length && !ro ? `<a class="un-notice info" href="#/unidades/revision">${icon.info}<span><b>${plural(dups.length, 'posible registro duplicado', 'posibles registros duplicados')}</b><small>Unidades registradas en más de una empresa. Revisa y une sin perder relaciones.</small></span>${icon.chev}</a>` : '',
      sum.expiredDocs || sum.soonDocs ? `<a class="un-notice ${sum.expiredDocs ? 'danger' : 'warn'}" href="#/unidades/vencimientos">${icon.clock}<span><b>${[sum.expiredDocs ? plural(sum.expiredDocs, 'documento vencido', 'documentos vencidos') : '', sum.soonDocs ? plural(sum.soonDocs, 'documento por vencer', 'documentos por vencer') : ''].filter(Boolean).join(' · ')}</b><small>Ver vencimientos próximos</small></span>${icon.chev}</a>` : '',
    ].join('');
    const tiles = [['all', 'Total de unidades', sum.total], ['complete', 'Documentación completa', sum.complete], ['soon', 'Documentos próximos a vencer', sum.soonDocs], ['expired', 'Documentos vencidos', sum.expiredDocs], ['incomplete', 'Expedientes incompletos', sum.incomplete]];
    root.querySelector('[data-kpis]').innerHTML = tiles.map(([k, l, n]) => `<button type="button" class="tile un-kpi${state.f === k ? ' on' : ''}${k === 'expired' && n ? ' danger' : k === 'soon' && n ? ' warn' : ''}" data-kpi="${k}"><small>${l}</small><b>${n}</b></button>`).join('');
    root.querySelectorAll('[data-f]').forEach((b) => { const o = b.dataset.f === state.f; b.classList.toggle('on', o); b.setAttribute('aria-pressed', String(o)); });
    const list = rows.filter((r) => matchUnit(r.unit, state.q) && passFilter(r.unit, r.st, state.f));
    root.querySelector('[data-count]').textContent = rows.length ? `${plural(list.length, 'unidad', 'unidades')}${list.length !== rows.length ? ` de ${rows.length}` : ''}` : '';
    unThumbs();
    root.querySelector('[data-grid]').innerHTML = list.length ? list.map(card).join('')
      : rows.length ? `<div class="empty"><p><b class="empty-t">Sin coincidencias</b>Prueba con otro número económico, placas o filtro.</p></div>`
        : `<div class="empty"><p><b class="empty-t">Aún no hay unidades</b>Registra cada unidad una sola vez; sus datos se usan en los formularios de todas las empresas.</p>${ro ? '' : `<button type="button" class="btn-primary sm" data-add>${icon.plus}<span>Agregar unidad</span></button>`}</div>`;
    unThumbs = lazyThumbs(root);
  }
  draw();
  on(root, 'input', '[data-q]', (e, i) => { state.q = i.value; draw(); });
  on(root, 'click', '[data-f]', (e, b) => { state.f = b.dataset.f; draw(); });
  on(root, 'click', '[data-kpi]', (e, b) => { state.f = state.f === b.dataset.kpi ? 'all' : b.dataset.kpi; draw(); });
  on(root, 'click', '[data-back]', () => back('/administracion'));
  on(root, 'click', '[data-cfg]', () => go('/unidades/requisitos'));
  on(root, 'click', '[data-add]', async () => { const u = await unitForm(null); if (u) go(`/unidades/${encodeURIComponent(u.id)}`); });
  const offs = [un.onUnitsChange(draw), un.onDayChange(draw)];
  window.addEventListener('pcs:sync', draw);
  s.cleanup = () => { offs.forEach((f) => f()); unThumbs(); window.removeEventListener('pcs:sync', draw); };
  return s;
}

/* ===== Vencimientos ===== */
const AL = { window: '30', sort: 'days' };
export async function unitAlertsScreen() {
  await un.loadUnits();
  const s = screen(`<div class="page wide un-page">
    <header class="nav-top"><button type="button" class="nav-back" data-back>${icon.back}<span>Unidades</span></button></header>
    <h1 class="title">Vencimientos próximos</h1>
    <p class="page-lead" data-lead></p>
    <div class="chips filters" data-w role="group" aria-label="Periodo">${ALERT_WINDOWS.map(([k, l]) => `<button type="button" class="chip" data-win="${k}">${l}</button>`).join('')}</div>
    <div class="un-sort"><span>Ordenar por</span><span class="sel-w"><select class="in" data-sort aria-label="Ordenar vencimientos">${ALERT_SORTS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select><span class="sel-ic">${icon.down}</span></span></div>
    <div data-list></div>
  </div>`);
  const root = s.el;
  root.querySelector('[data-sort]').value = AL.sort;
  function draw() {
    const day = un.today();
    root.querySelector('[data-lead]').textContent = `Documentos con fecha de fin registrada y confirmada · hoy ${dateShort(day)}`;
    root.querySelectorAll('[data-win]').forEach((b) => { const o = b.dataset.win === AL.window; b.classList.toggle('on', o); b.setAttribute('aria-pressed', String(o)); });
    const list = sortAlerts(alertRows(un.rows(day), day, { window: AL.window, soon: un.soonDays() }), AL.sort);
    root.querySelector('[data-list]').innerHTML = list.length ? `<div class="list un-alerts">${list.map((a) => `<a class="row un-al" href="#/unidades/${encodeURIComponent(a.unit.id)}?sec=vigencias">
        <span class="row-ic un-dic t-${a.v.tone}">${icon[DOC_ICON[a.type]]}</span>
        <span class="row-tx"><span class="row-l1"><b>${esc(unitTitle(a.unit))}</b>${a.unit.placas ? `<span class="mono un-plm">${esc(a.unit.placas)}</span>` : ''}</span>
          <span class="row-l2">${esc(docType(a.type).label)} · vence ${esc(dateShort(a.v.until))}</span>
          <span class="row-l3">${chip(a.v)} <span class="un-days">${esc(daysText(a.v.days))}</span></span></span><span class="chev">${icon.chev}</span></a>`).join('')}</div>`
      : `<div class="empty"><p><b class="empty-t">Sin vencimientos en este periodo</b>Solo aparecen documentos con fecha de fin confirmada.</p></div>`;
  }
  draw();
  on(root, 'click', '[data-win]', (e, b) => { AL.window = b.dataset.win; draw(); });
  on(root, 'change', '[data-sort]', (e, sel) => { AL.sort = sel.value; draw(); });
  on(root, 'click', '[data-back]', () => back('/unidades'));
  const offs = [un.onUnitsChange(draw), un.onDayChange(draw)];
  s.cleanup = () => offs.forEach((f) => f());
  return s;
}

/* ===== Revisión de posibles duplicados (migración) ===== */
async function relatedCounts(ids) {
  const db = await import('../../services/db.js');
  const out = Object.fromEntries(ids.map((id) => [id, { fuel: 0, logistics: 0, shop: 0, docs: 0, other: 0 }]));
  const add = (id, k) => { if (out[id]) out[id][k]++; };
  for (const r of await db.all(db.S.fuelRecords)) add(r.vehicleId, 'fuel');
  for (const r of await db.all(db.S.logisticsOperations)) add(r.vehicleId, 'logistics');
  for (const st of [db.S.maintenanceOrders, db.S.maintenanceIssues]) for (const r of await db.all(st)) add(r.vehicleId, 'shop');
  for (const st of [db.S.emptyContainers, db.S.fullContainerLoads]) for (const r of await db.all(st)) add(r.vehicleId, 'other');
  for (const r of await db.all(db.S.unitDocuments)) add(r.unitId, 'docs');
  return out;
}
/* Registro que se propone conservar: el que tiene más relaciones; si empatan, el del catálogo PERCONSUR */
function keepDefault(g, counts) {
  const tot = (id) => Object.values(counts[id] || {}).reduce((a, n) => a + n, 0);
  return g.ids.slice().sort((a, b) => tot(b) - tot(a) || ((un.unitById(b) || {}).company === 'perconsur') - ((un.unitById(a) || {}).company === 'perconsur'))[0];
}
const FIELD_LBL = { eco: 'Número económico', placas: 'Placas', vin: 'VIN/NIV', brand: 'Marca', model: 'Modelo', year: 'Año' };
export async function unitReviewScreen() {
  await un.loadUnits();
  const s = screen(`<div class="page un-page">
    <header class="nav-top"><button type="button" class="nav-back" data-back>${icon.back}<span>Unidades</span></button></header>
    <h1 class="title">Revisión de duplicados</h1>
    <p class="page-lead">Antes, cada empresa tenía su propio catálogo y una misma unidad podía estar registrada varias veces. Aquí se proponen los registros que parecen la misma unidad (mismo VIN/NIV, placas o número económico). Nada se une solo.</p>
    <div data-list></div>
  </div>`);
  const root = s.el;
  async function draw() {
    const groups = un.duplicates();
    const counts = await relatedCounts(groups.flatMap((g) => g.ids));
    root.querySelector('[data-list]').innerHTML = groups.length ? groups.map((g, gi) => `<section class="grp un-dup" data-g="${gi}">
        <div class="grp-h"><h3>${g.kind === 'exact' ? 'Coincidencia sin diferencias' : 'Coincidencia con datos distintos'}</h3><span class="un-chip t-${g.kind === 'exact' ? 'info' : 'warn'}"><i></i>Por ${g.by.map((b) => ({ vin: 'VIN/NIV', placas: 'placas', eco: 'número económico' }[b])).join(', ')}</span></div>
        <div class="grp-b">
          ${g.conflicts.length ? `<p class="grp-note">Datos que no coinciden: <b>${g.conflicts.map((c) => FIELD_LBL[c]).join(', ')}</b>. Elige el registro cuyos datos se conservan; los vacíos se completan con los del otro.</p>` : '<p class="grp-note">Los datos no se contradicen. Elige el registro que se conserva.</p>'}
          ${g.ids.map((id) => { const v = un.unitById(id), c = counts[id]; return `<label class="un-dupr"><input type="radio" name="keep${gi}" value="${esc(id)}"${id === keepDefault(g, counts) ? ' checked' : ''}>
            <span><b>${esc(unitTitle(v))}</b> <small>${esc(getCompany(v.company || 'perconsur').short)}</small><br>
              ${['placas', 'vin', 'brand', 'model', 'year'].map((f) => `<span class="${g.conflicts.includes(f) ? 'un-conf' : ''}">${FIELD_LBL[f]}: ${esc(v[f] || '—')}</span>`).join(' · ')}<br>
              <small>Relacionado: ${c.fuel} recargas · ${c.logistics} operaciones · ${c.shop} registros de Taller · ${c.other} llenos/vacíos · ${c.docs} documentos</small></span></label>`; }).join('')}
          <div class="sheet-acts"><button type="button" class="btn-ghost" data-distinct="${gi}">No son la misma unidad</button><button type="button" class="btn-primary" data-merge="${gi}">Unir registros</button></div>
        </div></section>`).join('')
      : `<div class="empty"><p><b class="empty-t">Sin duplicados pendientes</b>Todas las unidades están una sola vez en el catálogo PERCONSUR.</p></div>`;
    s._groups = groups;
  }
  await draw();
  on(root, 'click', '[data-back]', () => back('/unidades'));
  on(root, 'click', '[data-distinct]', async (e, b) => {
    const g = s._groups[+b.dataset.distinct]; if (!g) return;
    try { await un.markDistinct(g.ids); toast('Se conservan como unidades distintas'); await draw(); } catch (err) { toast(err.message, { type: 'warn' }); }
  });
  on(root, 'click', '[data-merge]', async (e, b) => {
    const gi = +b.dataset.merge, g = s._groups[gi]; if (!g) return;
    const keep = root.querySelector(`input[name="keep${gi}"]:checked`).value, others = g.ids.filter((x) => x !== keep);
    const ok = await actionSheet({ title: 'Unir registros', message: `Se conserva la ${unitTitle(un.unitById(keep))}. Las recargas, operaciones de Logística, Taller, Control de llenos y vacíos, GPS y documentos de los otros registros pasan a esa unidad. Los otros registros no se borran: quedan marcados como unidos. Antes se descarga un respaldo completo.`, actions: [{ label: 'Descargar respaldo y unir', value: true, style: 'primary' }] });
    if (!ok) return;
    try {
      const f = await exportBackup({ includeMedia: true }); downloadBlob(f, f.name);
      const r = await un.mergeUnits(keep, others);
      toast(`Registros unidos (${Object.values(r.moved).reduce((a, n) => a + n, 0)} relaciones actualizadas)`);
      await draw();
    } catch (err) { toast(err.message || 'No se pudieron unir', { type: 'warn' }); }
  });
  return s;
}

/* ===== Requisitos documentales ===== */
export async function unitRequirementsScreen() {
  await un.loadUnits();
  const cfg0 = un.requirements() || {};
  const types = [['', 'Sin tipo'], ...VEHICLE_TYPES];
  const s = screen(`<div class="page un-page">
    <header class="nav-top"><button type="button" class="nav-back" data-back>${icon.back}<span>Unidades</span></button></header>
    <h1 class="title">Requisitos documentales</h1>
    <p class="page-lead">Qué documentos cuentan para que el expediente esté completo según el tipo de unidad. Las cinco categorías siempre se pueden adjuntar; las no requeridas se muestran como «No requerido», distinto de «Pendiente».</p>
    <form data-form>
      ${types.map(([k, l]) => { const req = requiredFor({ vehicleType: k }, cfg0); return `<section class="grp"><div class="grp-h"><h3>${esc(l)}</h3></div><div class="grp-b">
        ${DOC_TYPES.map((d) => `<label class="sw-row"><span class="sw-tx">${esc(d.label)}</span><input type="checkbox" class="sw" name="${k || '_'}:${d.key}"${req.includes(d.key) ? ' checked' : ''}></label>`).join('')}</div></section>`; }).join('')}
      <section class="grp"><div class="grp-h"><h3>Aviso de próximo a vencer</h3></div><div class="grp-b">
        <label class="fld"><span class="fl">Días antes del vencimiento</span><input class="in" type="number" min="1" max="90" name="soon" value="${un.soonDays()}" inputmode="numeric"></label></div></section>
      <button type="submit" class="btn-primary block">Guardar requisitos</button>
      <button type="button" class="btn-ghost block" data-reset>Restablecer valores predeterminados</button>
    </form></div>`);
  const root = s.el, form = root.querySelector('[data-form]');
  on(root, 'click', '[data-back]', () => back('/unidades'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const cfg = {};
    for (const [k] of types) cfg[k] = DOC_KEYS.filter((d) => form.elements[`${k || '_'}:${d}`].checked);
    try { await un.setRequirements(cfg); await un.setSoonDays(form.elements.soon.value); toast('Requisitos guardados'); back('/unidades'); } catch (err) { toast(err.message, { type: 'warn' }); }
  });
  on(root, 'click', '[data-reset]', () => {
    for (const [k] of types) for (const d of DOC_KEYS) form.elements[`${k || '_'}:${d}`].checked = (DEFAULT_REQUIREMENTS[k] || DEFAULT_REQUIREMENTS['']).includes(d);
    form.elements.soon.value = 15;
  });
  return s;
}

