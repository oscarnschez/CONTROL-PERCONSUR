/*
 * Operadores — control administrativo interno por operador.
 * Listado (#/operadores), ficha del operador (#/operadores/:id) y resumen general (#/operadores/resumen).
 * Todos los importes se derivan con computeOperator(), que usa la fórmula única:
 *   BALANCE = COMISIONES − SÁBADOS PAGADOS − GASTOS DE VIAJE − PRÉSTAMOS
 */
import { screen, on } from '../../core/dom.js';
import { go, back } from '../../core/router.js';
import * as ops from '../../services/operators.js';
import { shareFile, downloadBlob } from '../../services/share.js';
import { getSetting, setSetting } from '../../services/settings.js';
import { esc } from '../../domain/shared/format.js';
import { money } from '../../domain/operators/money.js';
import {
  computeOperator, movementsOf, filterMovements, MOVE_FILTERS, PERIODS, periodRange, fmtDate, fmtDateShort, todayStr, aggregate, isDate,
} from '../../domain/operators/balance.js';
import { icon } from '../components/icons.js';
import * as media from '../../services/media.js';
import { listAll, save as saveCatalog } from '../../services/catalogs.js';
import { compressAvatar } from '../../services/camera.js';
import { rfcClean } from '../../domain/shared/format.js';
import { openSheet, confirmDestructive } from '../components/sheet.js';
import { actionSheet } from '../components/sheet.js';
import { toast } from '../components/toast.js';
import { loadBilling, billingOf } from '../../services/billing.js';
import { getCompany } from '../../services/companies.js';
import { tripTaxes, sumTaxes } from '../../domain/operators/taxes.js';
import { buildTripsWorkbook } from '../../domain/operators/tripsExport.js';
import { openTripForm, openTripDetail, openLoanForm, openAdjustmentForm, openSettingsForm } from './operatorForms.js';
import { attachCount } from './tripDocs.js';
import { chooseTripKind } from '../flows.js';

const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const amtCls = (c) => (c < 0 ? 'neg' : c > 0 ? 'pos' : '');
const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;

/* Avatar con fotografía (se carga solo cuando es visible) o iniciales */
export const avatar = (o, cls = '') => `<span class="av ${cls}"${o && o.photoId ? ` data-photo="${esc(o.photoId)}"` : ''} aria-hidden="true">${esc(initials(o ? o.name : ''))}</span>`;
export function hydrateAvatars(root) {
  const els = [...root.querySelectorAll('[data-photo]')];
  const load = async (el) => { const u = await media.ensureURL(el.dataset.photo); if (u) { el.style.backgroundImage = `url("${u}")`; el.classList.add('loaded'); } };
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((ents) => ents.forEach((e) => { if (e.isIntersecting) { io.unobserve(e.target); load(e.target); } }), { rootMargin: '200px' });
    els.forEach((el) => io.observe(el));
  } else els.forEach(load);
}
const curpClean = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 18);

/* ===== Listado ===== */
export async function operatorsScreen() {
  let text = '', fco = 'todas', fbal = '';
  const list = ops.operatorList();
  const companies = [...new Set(list.map((o) => o.company))];
  const s = screen(`<div class="page">
    <header class="nav-top"><button type="button" class="nav-back" data-back>${icon.back}<span>Administración</span></button>
      <a class="btn-ghost sm" href="#/operadores/resumen">${icon.chart}<span>Resumen</span></a></header>
    <h1 class="title">Operadores</h1>
    <label class="search"><span class="search-ic">${icon.search}</span><input type="search" class="search-in" placeholder="Buscar operador" autocomplete="off" autocorrect="off" enterkeyhint="search"></label>
    <div class="chips filters">
      ${companies.length > 1 ? `<button type="button" class="chip" data-co="todas">Todas</button>${companies.map((c) => `<button type="button" class="chip" data-co="${c}">${esc(list.find((o) => o.company === c).companyShort)}</button>`).join('')}` : ''}
      <button type="button" class="chip" data-bal="neg">Balance negativo</button>
      <button type="button" class="chip" data-bal="min">Comisión mínima</button>
    </div>
    <div data-list></div>
    <p class="grp-note center">Los operadores provienen del catálogo. Para agregar uno ve a <a href="#/catalogos/operators">Administración → Catálogos → Operadores</a>.<br><a href="#/operadores/importar">Importar referencias y pagos de viajes</a></p>
  </div>`);
  const root = s.el, listEl = root.querySelector('[data-list]');
  const results = new Map(list.map((o) => [o.id, ops.computeFor(o.id)]));
  function draw() {
    root.querySelectorAll('[data-co]').forEach((b) => b.classList.toggle('on', b.dataset.co === fco));
    root.querySelectorAll('[data-bal]').forEach((b) => b.classList.toggle('on', b.dataset.bal === fbal));
    const rows = list.filter((o) => (fco === 'todas' || o.company === fco) && (!text || fold(o.name).includes(fold(text))))
      .filter((o) => { const r = results.get(o.id); return !fbal || (fbal === 'neg' ? r.balance < 0 : r.settings.minEnabled); });
    listEl.innerHTML = !list.length
      ? `<div class="empty"><p>No hay operadores en el catálogo.</p><a class="btn-primary sm" href="#/catalogos/operators">${icon.plus}<span>Agregar operadores</span></a></div>`
      : rows.length ? `<div class="list">${rows.map((o) => {
        const r = results.get(o.id);
        return `<a class="row op-row" href="#/operadores/${esc(o.id)}">
          ${avatar(o)}
          <span class="row-tx"><span class="row-l1"><b>${esc(o.name)}</b>${r.settings.minEnabled ? '<span class="st st-min">Mínimo</span>' : ''}</span>
            <span class="row-l2">${companies.length > 1 ? esc(o.companyShort) + ' | ' : ''}${plural(r.registered.trips, 'viaje', 'viajes')} | ${money(r.comp.commissions)} en comisiones</span>${r.excluded.trips ? `<span class="row-l3 warn-t">${plural(r.excluded.trips, 'viaje', 'viajes')} después del corte</span>` : ''}</span>
          <span class="op-bal ${amtCls(r.balance)}"><small>Balance</small><b>${money(r.balance)}</b></span>
        </a>`;
      }).join('')}</div>` : '<div class="empty"><p>No hay operadores con ese filtro.</p></div>';
    hydrateAvatars(listEl);
  }
  on(root, 'click', '[data-co]', (e, b) => { fco = b.dataset.co; draw(); });
  on(root, 'click', '[data-back]', () => back('/administracion'));
  on(root, 'click', '[data-bal]', (e, b) => { fbal = fbal === b.dataset.bal ? '' : b.dataset.bal; draw(); });
  root.querySelector('.search-in').addEventListener('input', (e) => { text = e.target.value.trim(); draw(); });
  draw();
  return s;
}

/* ===== Ficha del operador ===== */
function satLine(r) {
  if (!r.sat.count && !r.sat.manual) return 'Sin sábados contabilizados';
  return `${r.sat.count} × ${money(r.sat.weekly)} = ${money(r.sat.count * r.sat.weekly)}`;
}
export function balanceCard(r, { title = 'Balance actual', sub = '' } = {}) {
  return `<section class="bal-card ${r.balance < 0 ? 'is-neg' : ''}">
    <span class="bal-l">${esc(title)}</span>
    <b class="bal-v">${money(r.balance)}<small> MXN</small></b>
    ${sub ? `<span class="bal-sub">${sub}</span>` : ''}
    <dl class="bal-rows">
      <div><dt>Comisiones</dt><dd class="${r.comp.commissions > 0 ? 'pos' : ''}">${money(r.comp.commissions, { sign: true })}</dd></div>
      <div><dt>Sábados pagados</dt><dd>${money(-r.comp.saturdaysPaid)}</dd></div>
      <div><dt>Gastos de viaje</dt><dd>${money(-r.comp.expenses)}</dd></div>
      <div><dt>Préstamos</dt><dd>${money(-r.comp.loans)}</dd></div>
    </dl>
    ${r.balance < 0 ? '<p class="bal-note">Balance negativo. Puedes seguir registrando movimientos.</p>' : ''}
  </section>`;
}
/* Totales fiscales de un conjunto de viajes (ya sumados con sumTaxes), separados del balance del operador */
export function fiscalSummary(s, { title = 'Resumen fiscal de los viajes', commissions = null, expenses = null } = {}) {
  const row = (k, v, cls = '') => `<div class="${cls}"><dt>${k}</dt><dd>${v}</dd></div>`;
  return `<section class="fisc"><h4>${esc(title)}</h4><dl>
    ${row('Tarifas base acumuladas', money(s.fares))}${row('IVA generado', money(s.vat, { sign: true }))}${row('ISR retenido', money(-s.isr))}${row('Retención IVA', money(-s.vatWithholding))}
    ${row('Total después de impuestos', `<b>${money(s.total)}</b>`, 'tot')}${expenses == null ? '' : row('Gastos de viaje', money(expenses))}${commissions == null ? '' : row('Comisiones', money(commissions))}
  </dl></section>`;
}
function tripCard(t, cutoff) {
  const bill = billingOf(t.id), paid = !!(bill && bill.paid);
  return `<button type="button" class="trip-card" data-trip="${esc(t.id)}">
    <span class="tc-top"><span class="div-tag ${esc(t.division)}">${t.division === 'campo' ? 'Campo' : 'Puerto'}</span>${t.isExpanded ? '<span class="exp-tag">Comisión ampliada</span>' : ''}${t.date > cutoff ? '<span class="after-tag">Después del corte</span>' : ''}<span class="pay-tag ${paid ? 'paid' : 'due'}">${paid ? 'Pagado' : 'Por cobrar'}</span>${t.reference ? `<span class="ref-tag">${esc(t.reference)}</span>` : ''}${attachCount(t.id)}<span class="tc-date">${esc(fmtDateShort(t.date))}</span></span>
    <b class="tc-route">${esc(t.origin)} → ${esc(t.destination)}</b>
    <span class="tc-nums"><span><small>Tarifa base</small><b>${money(t.fare)}</b></span><span><small>Total</small><b>${money(tripTaxes(t).totalAfterTaxes)}</b></span><span><small>Comisión</small><b class="pos">${money(t.finalCommission)}</b></span></span>
  </button>`;
}
function moveRow(m) {
  const ic = { sabado: icon.clock, prestamo: icon.download, viaje: icon.truck, ajuste: icon.edit, config: icon.gear }[m.kind];
  const amt = m.kind === 'viaje'
    ? `<span class="mv-amt"><b class="pos">${money(m.commission, { sign: true })}</b>${m.expenses ? `<small class="neg">${money(-m.expenses)} gastos</small>` : ''}</span>`
    : m.amount == null ? '' : `<span class="mv-amt"><b class="${amtCls(m.amount)}">${money(m.amount, { sign: true })}</b></span>`;
  const sub = m.kind === 'sabado' && m.manual ? `${m.count} sábados × ${money(m.weekly)}` : m.kind === 'viaje' ? `${m.division === 'campo' ? 'Campo' : 'Puerto'}${m.expanded ? ' | Comisión ampliada' : ''}` : m.sub || '';
  const tap = ['viaje', 'prestamo', 'ajuste'].includes(m.kind);
  return `<${tap ? 'button type="button"' : 'div'} class="mv-row k-${m.kind}${m.after ? ' after' : ''}" ${tap ? `data-mv="${m.kind}" data-id="${esc(m.id)}"` : ''}>
    <span class="mv-ic">${ic}</span>
    <span class="mv-tx"><b>${esc(m.title)}</b><small>${esc(fmtDate(m.date))}${sub ? ' | ' + esc(sub) : ''}${m.after ? ' | Después del corte' : ''}</small></span>${amt}</${tap ? 'button' : 'div'}>`;
}

/* Aviso: registros con fecha posterior al corte (se ven en las listas, pero no entran en el balance) */
function excludedNotice(r) {
  const e = r.excluded;
  if (!e.trips && !e.loans && !e.adjustments) return '';
  const parts = [e.trips && plural(e.trips, 'viaje', 'viajes'), e.loans && plural(e.loans, 'préstamo', 'préstamos'), e.adjustments && plural(e.adjustments, 'ajuste', 'ajustes')].filter(Boolean);
  const list = parts.length > 1 ? parts.slice(0, -1).join(', ') + ' y ' + parts.at(-1) : parts[0];
  const total = e.trips + e.loans + e.adjustments;
  const why = r.cutoffIsToday
    ? `tiene${total === 1 ? '' : 'n'} fecha posterior a hoy (${fmtDate(e.dates.at(-1))}). Revisa la fecha capturada.`
    : `tiene${total === 1 ? '' : 'n'} fecha posterior al corte del ${fmtDate(r.cutoff)} fijado en «Calcular hasta».`;
  return `<div class="op-warn op-excl">${icon.alert}<span><b>${esc(list)} no ${total === 1 ? 'entra' : 'entran'} en el balance</b> porque ${esc(why)}
    ${r.cutoffIsToday ? '' : '<button type="button" class="link-btn" data-settings>Cambiar a «Hoy» en Configuración</button>'}</span></div>`;
}

/* ===== Perfil del operador ===== */
function licenseState(exp) {
  if (!isDate(exp)) return '';
  const t = todayStr(); if (exp < t) return '<span class="st st-borrador">Vencida</span>';
  const d = new Date(exp + 'T00:00:00') - new Date(t + 'T00:00:00'); return d <= 30 * 86400000 ? '<span class="st st-borrador">Vence pronto</span>' : '';
}
function profileHTML(op, st) {
  const lic = op.license || {}, none = '<i>Sin capturar</i>';
  return `<section class="profile">
    <div class="pf-top">${avatar(op, 'xl')}<div><h1>${esc(op.name)}</h1><p>${esc(op.companyShort)}${isDate(st.startDate) ? ` | Desde ${esc(fmtDate(st.startDate))}` : ''}</p></div></div>
    <dl class="sumlist pf-data">
      <div><dt>RFC</dt><dd class="mono">${op.rfc ? esc(op.rfc) : none}</dd></div>
      <div><dt>CURP</dt><dd class="mono">${op.curp ? esc(op.curp) : none}</dd></div>
      <div><dt>Licencia</dt><dd>${lic.number ? `<span class="mono">${esc(lic.number)}</span>${lic.type ? ' | ' + esc(lic.type) : ''}${lic.expires ? `<br><small class="muted">Vence ${esc(fmtDate(lic.expires))}</small> ${licenseState(lic.expires)}` : ''}` : none}</dd></div>
      <div><dt>Fecha de inicio</dt><dd>${isDate(st.startDate) ? esc(fmtDate(st.startDate)) : none}</dd></div>
    </dl>
    <button type="button" class="btn-secondary block" data-profile>${icon.edit}<span>Editar operador</span></button>
  </section>`;
}
function openProfileForm(op, onSaved) {
  const rec = () => listAll('operators').find((x) => x.id === op.id) || op;
  const r0 = rec(), lic = r0.license || {};
  const form = document.createElement('form'); form.className = 'op-form'; form.noValidate = true;
  form.innerHTML = `<div class="pf-photo"><span data-pv>${avatar(r0, 'xl')}</span><div class="pf-photo-acts">
      <label class="btn-secondary sm">${icon.camera}<span>Tomar foto</span><input type="file" accept="image/*" capture="environment" hidden data-ph></label>
      <label class="btn-secondary sm">${icon.image}<span>Elegir de Fotos</span><input type="file" accept="image/*" hidden data-ph></label>
      <button type="button" class="btn-ghost sm danger" data-phdel ${r0.photoId ? '' : 'hidden'}>${icon.trash}<span>Eliminar foto</span></button></div></div>
    <label class="fld" data-f="name"><span class="fl">Nombre</span><input class="in" name="name" value="${esc(r0.name)}" autocapitalize="words" enterkeyhint="next"><span class="ferr"></span></label>
    <div><label class="fld" data-f="rfc"><span class="fl">RFC</span><input class="in mono" name="rfc" value="${esc(r0.rfc || '')}" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="next"><span class="fhint" data-h="rfc"></span></label>
      <label class="fld" data-f="curp"><span class="fl">CURP</span><input class="in mono" name="curp" value="${esc(r0.curp || '')}" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="next"><span class="fhint" data-h="curp"></span></label></div>
    <h3 class="pk-h">Licencia de conducir</h3>
    <div class="row2"><label class="fld"><span class="fl">Número de licencia</span><input class="in mono" name="licNumber" value="${esc(lic.number || '')}" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="next"></label>
      <label class="fld"><span class="fl">Tipo (opcional)</span><input class="in" name="licType" value="${esc(lic.type || '')}" placeholder="Ej. Federal tipo E" enterkeyhint="next"></label></div>
    <div class="row2"><label class="fld"><span class="fl">Expedición (opcional)</span><input class="in" type="date" name="licIssued" value="${esc(lic.issued || '')}"></label>
      <label class="fld" data-f="licExpires"><span class="fl">Vencimiento (opcional)</span><input class="in" type="date" name="licExpires" value="${esc(lic.expires || '')}"><span class="ferr"></span></label></div>
    <h3 class="pk-h">Rastreo para clientes</h3>
    <label class="sw-row"><span class="sw-tx">Mostrar su nombre al cliente<small>Solo si lo autorizó en su hoja de consentimiento de datos personales. Apagado: el cliente ve la unidad y las placas, sin el nombre del operador.</small></span><input type="checkbox" switch class="sw" name="trackShow"${r0.trackHide ? '' : ' checked'}></label>
    <p class="grp-note">La fecha de inicio de operación se edita en la configuración del balance.</p>
    <div class="form-foot"><button type="submit" class="btn-primary block lg">Guardar cambios</button></div>`;
  const sh = openSheet({ title: 'Editar operador', body: form, full: true, className: 'form-sheet' });
  const hint = () => {
    const rfc = form.elements.rfc.value, curp = form.elements.curp.value;
    form.querySelector('[data-h="rfc"]').textContent = rfc && rfc.length !== 12 && rfc.length !== 13 ? 'El RFC tiene 12 o 13 caracteres.' : '';
    form.querySelector('[data-h="curp"]').textContent = curp && curp.length !== 18 ? 'La CURP tiene 18 caracteres.' : '';
  };
  form.addEventListener('input', (e) => {
    const t = e.target, keep = (v) => { if (t.value !== v) { const p = t.selectionStart; t.value = v; try { t.setSelectionRange(p, p); } catch (err) { /* */ } } };
    if (t.name === 'rfc') keep(rfcClean(t.value));
    if (t.name === 'curp') keep(curpClean(t.value));
    if (t.name === 'licNumber') keep(t.value.toUpperCase().replace(/\s+/g, ''));
    hint();
  });
  hint();
  const setPreview = () => { form.querySelector('[data-pv]').innerHTML = avatar(rec(), 'xl'); hydrateAvatars(form); form.querySelector('[data-phdel]').hidden = !rec().photoId; };
  hydrateAvatars(form);
  form.querySelectorAll('[data-ph]').forEach((inp) => inp.addEventListener('change', async () => {
    const f = inp.files && inp.files[0]; inp.value = ''; if (!f) return;
    try {
      const blob = await compressAvatar(f), cur = rec(), old = cur.photoId;
      const pid = await media.saveBlob(blob, { owner: 'op:' + op.id, kind: 'avatar', name: 'foto-operador.jpg' });
      await saveCatalog('operators', { ...cur, photoId: pid });
      if (old) await media.remove(old);
      setPreview(); toast(old ? 'Fotografía reemplazada' : 'Fotografía agregada'); onSaved && onSaved();
    } catch (err) { toast('No se pudo leer esa imagen. Prueba con otra foto.', { type: 'warn' }); }
  }));
  form.querySelector('[data-phdel]').addEventListener('click', async () => {
    if (!(await confirmDestructive('¿Eliminar la fotografía?', op.name, 'Eliminar foto'))) return;
    const cur = rec(), old = cur.photoId;
    await saveCatalog('operators', { ...cur, photoId: null }); if (old) await media.remove(old);
    setPreview(); toast('Fotografía eliminada', { type: 'info' }); onSaved && onSaved();
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const el = form.elements, name = el.name.value.trim().replace(/\s+/g, ' ');
    const err = (f, msg) => { const box = form.querySelector(`[data-f="${f}"]`); box.classList.add('has-err'); box.querySelector('.ferr').textContent = msg; box.scrollIntoView({ block: 'center', behavior: 'smooth' }); toast(msg, { type: 'warn' }); };
    if (!name) return err('name', 'Escribe el nombre del operador.');
    if (el.licIssued.value && el.licExpires.value && el.licExpires.value < el.licIssued.value) return err('licExpires', 'El vencimiento no puede ser anterior a la expedición.');
    const cur = rec();
    await saveCatalog('operators', { ...cur, name: nameCaseLocal(name), rfc: rfcClean(el.rfc.value), curp: curpClean(el.curp.value), trackHide: !el.trackShow.checked,
      license: { number: el.licNumber.value.trim().toUpperCase(), type: el.licType.value.trim(), issued: el.licIssued.value || '', expires: el.licExpires.value || '' } });
    sh.close(); toast('Datos del operador guardados'); onSaved && onSaved();
  });
}
const nameCaseLocal = (t) => t.toLowerCase().split(' ').map((w, i) => (i && ['de', 'del', 'la', 'las', 'los', 'y'].includes(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');

export async function operatorScreen({ id }, q) {
  await loadBilling();
  let op = ops.operatorById(id);
  if (!op) { toast('Ese operador ya no está en el catálogo.', { type: 'info' }); go('/operadores', { replace: true }); return null; }
  let tab = getSetting('opTab', 'viajes'), tdiv = 'todos', tper = 'todo', tcustom = { from: '', to: '' }, mfilter = 'todos', tShown = 30, mShown = 50;
  const s = screen('<div class="page op-page"></div>', { keepScroll: false });
  const root = s.el;

  function render() {
    op = ops.operatorById(id) || op;
    const rec = ops.recordsOf(id), r = computeOperator(rec), st = r.settings;
    const trips = rec.trips.filter((t) => !t.deletedAt).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt));
    const loans = rec.loans.filter((l) => !l.deletedAt).sort((a, b) => (a.date < b.date ? 1 : -1));
    const y = window.scrollY;
    root.innerHTML = `
      <header class="nav-top"><button type="button" class="nav-back" data-back>${icon.back}<span>Operadores</span></button>
        <button type="button" class="nav-act" data-more aria-label="Más opciones">${icon.more}</button></header>
      ${profileHTML(op, st)}
      <h2 class="sec-h sec-gap">Balance</h2>
      ${balanceCard(r, { sub: `Corte al ${esc(fmtDate(r.cutoff))}${r.cutoffIsToday ? ' (hoy)' : ''}` })}
      <div class="op-acts">
        <button type="button" class="btn-primary" data-new="viaje">${icon.plus}<span>Viaje</span></button>
        <button type="button" class="btn-secondary" data-new="prestamo">${icon.plus}<span>Préstamo</span></button>
        <button type="button" class="btn-secondary" data-new="ajuste">${icon.plus}<span>Ajuste</span></button>
      </div>
      <button type="button" class="btn-secondary block stmt-btn" data-stmt>${icon.file}<span>Generar PDF</span><small>Estado de cuenta</small></button>
      ${r.warnings.map((w) => `<p class="op-warn">${icon.alert}<span>${esc(w)}</span></p>`).join('')}
      ${excludedNotice(r)}
      <section class="grp"><div class="grp-h"><h3>Configuración</h3><button type="button" class="btn-ghost sm" data-settings>${icon.edit}<span>Editar</span></button></div>
        <div class="grp-b"><dl class="sumlist">
          <div><dt>Fecha de inicio</dt><dd>${isDate(st.startDate) ? esc(fmtDate(st.startDate)) : '<i>Sin configurar</i>'}</dd></div>
          <div><dt>Calcular hasta</dt><dd>${r.cutoffIsToday ? `Hoy (${esc(fmtDate(r.cutoff))})` : esc(fmtDate(r.cutoff))}</dd></div>
          <div><dt>Sábados contabilizados</dt><dd><b>${r.sat.count}</b> <span class="st ${r.sat.manual ? 'st-borrador' : 'st-generado'}">${r.sat.manual ? 'Ajuste manual' : 'Automático'}</span>${r.sat.manual ? `<br><small class="muted">Automático serían ${r.sat.auto}</small>` : ''}</dd></div>
          <div><dt>Monto semanal</dt><dd>${money(st.weekly)}</dd></div>
          <div><dt>Sábados pagados</dt><dd>${satLine(r)}</dd></div>
          <div><dt>Comisión mínima garantizada</dt><dd>${st.minEnabled ? `Activada | ${money(st.minAmount)}` : 'Desactivada'}</dd></div>
        </dl></div></section>
      <section class="grp"><div class="grp-h"><h3>Actividad</h3></div>
        <div class="tiles">
          <div class="tile"><small>Viajes</small><b>${r.registered.trips}</b></div>
          <div class="tile"><small>Puerto</small><b>${r.registered.puerto}</b></div>
          <div class="tile"><small>Campo</small><b>${r.registered.campo}</b></div>
          <div class="tile wide"><small>Tarifas base acumuladas</small><b>${money(r.registered.fares)}</b></div>
          <div class="tile wide"><small>Total después de impuestos</small><b>${money(sumTaxes(trips).total)}</b></div>
          <div class="tile wide"><small>Comisiones ampliadas</small><b>${r.registered.expanded}${r.registered.expandedAmount ? ` <span class="muted">| ${money(r.registered.expandedAmount, { sign: true })}</span>` : ''}</b></div>
        </div>${r.excluded.trips ? `<p class="grp-note">${plural(r.stats.trips, 'viaje entra', 'viajes entran')} en el balance; ${plural(r.excluded.trips, 'viaje queda', 'viajes quedan')} después del corte.</p>` : ''}</section>
      <div class="seg wide op-tabs" role="tablist">${[['viajes', 'Viajes'], ['prestamos', 'Préstamos'], ['movimientos', 'Movimientos'], ['estados', 'Estados']].map(([k, l]) => `<button type="button" role="tab" class="seg-b${tab === k ? ' on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
      <div class="op-tab">${tab === 'viajes' ? tripsTab(trips, r) : tab === 'prestamos' ? loansTab(loans, r) : tab === 'estados' ? statementsTab() : movesTab(rec, r)}</div>`;
    hydrateAvatars(root);
    window.scrollTo(0, y);
  }
  function tripsTab(trips, r) {
    const range = periodRange(tper, tcustom);
    const list = trips.filter((t) => (tdiv === 'todos' || t.division === tdiv) && (!range.from || t.date >= range.from) && (!range.to || t.date <= range.to));
    const sum = (f) => list.reduce((a, t) => a + (f(t) || 0), 0);
    return `<div class="chips filters">${[['todos', 'Todos'], ['puerto', 'Puerto'], ['campo', 'Campo']].map(([k, l]) => `<button type="button" class="chip${tdiv === k ? ' on' : ''}" data-tdiv="${k}">${l}</button>`).join('')}</div>
      <div class="chips filters">${PERIODS.map(([k, l]) => `<button type="button" class="chip${tper === k ? ' on' : ''}" data-tper="${k}">${l}</button>`).join('')}</div>
      ${tper === 'custom' ? `<div class="row2 period-custom"><label class="fld"><span class="fl">Desde</span><input class="in" type="date" data-tc="from" value="${esc(tcustom.from)}"></label><label class="fld"><span class="fl">Hasta</span><input class="in" type="date" data-tc="to" value="${esc(tcustom.to)}"></label></div>` : ''}
      <div class="trip-sum"><span><small>Viajes</small><b>${list.length}</b></span><span><small>Tarifas base</small><b>${money(sum((t) => t.fare))}</b></span><span><small>Comisiones</small><b class="pos">${money(sum((t) => t.finalCommission))}</b></span><span><small>Gastos</small><b>${money(sum((t) => t.travelExpenses))}</b></span></div>
      ${list.length ? fiscalSummary(sumTaxes(list), { expenses: sum((t) => t.travelExpenses), commissions: sum((t) => t.finalCommission) }) : ''}
      <button type="button" class="add-btn" data-new="viaje">${icon.plus}<span>Registrar viaje</span></button>
      ${list.length ? `<div class="trip-list">${list.slice(0, tShown).map((t) => tripCard(t, r.cutoff)).join('')}</div>${list.length > tShown ? `<button type="button" class="btn-ghost block" data-tmore>Mostrar más (${list.length - tShown})</button>` : ''}` : `<div class="empty"><p>${trips.length ? 'No hay viajes con ese filtro.' : 'Aún no hay viajes registrados para este operador.'}</p></div>`}`;
  }
  function loansTab(loans, r) {
    return `<div class="total-line"><span>Total de préstamos</span><b class="neg">${money(-r.stats.loanTotal)}</b></div>
      <button type="button" class="add-btn" data-new="prestamo">${icon.plus}<span>Registrar préstamo</span></button>
      ${loans.length ? `<div class="list">${loans.map((l) => `<button type="button" class="row" data-loan="${esc(l.id)}"><span class="row-tx"><span class="row-l1"><b>${esc(l.concept)}</b></span><span class="row-l3">${esc(fmtDate(l.date))}${l.notes ? ' | ' + esc(l.notes) : ''}${l.date > r.cutoff ? ' | Después del corte' : ''}</span></span><b class="neg mono">${money(-l.amount)}</b></button>`).join('')}</div>`
    : '<div class="empty"><p>No hay préstamos registrados.</p></div>'}`;
  }
  function movesTab(rec, r) {
    const all = movementsOf(rec, r), list = filterMovements(all, mfilter);
    return `<div class="chips filters">${MOVE_FILTERS.map(([k, l]) => `<button type="button" class="chip${mfilter === k ? ' on' : ''}" data-mf="${k}">${l}</button>`).join('')}</div>
      <button type="button" class="add-btn" data-new="ajuste">${icon.edit}<span>Registrar ajuste</span></button>
      ${list.length ? `<div class="list mv-list">${list.slice(0, mShown).map(moveRow).join('')}</div>${list.length > mShown ? `<button type="button" class="btn-ghost block" data-mmore>Mostrar más (${list.length - mShown})</button>` : ''}` : '<div class="empty"><p>No hay movimientos con ese filtro.</p></div>'}`;
  }
  function statementsTab() {
    const list = ops.statementsOf(id);
    return `<button type="button" class="add-btn" data-stmt>${icon.file}<span>Generar PDF del estado de cuenta</span></button>
      ${list.length ? `<div class="list">${list.slice(0, 30).map((s1) => `<a class="row" href="#/operadores/${esc(id)}/estado"><span class="row-tx"><span class="row-l1"><b class="mono">${esc(s1.folio)}</b></span><span class="row-l3">Corte ${esc(fmtDate(s1.cutoff))} | emitido ${esc(fmtDate(s1.issued))} | ${esc(s1.pages)} pág.</span></span><span class="chev">${icon.chev}</span></a>`).join('')}</div>
        <p class="grp-note">Para abrir o compartir un estado emitido, entra a la pantalla del estado de cuenta.</p>` : '<div class="empty"><p>Aún no se han emitido estados de cuenta.</p></div>'}`;
  }

  const refresh = () => render();
  on(root, 'click', '[data-back]', () => back('/operadores'));
  on(root, 'click', '[data-tab]', (e, b) => { tab = b.dataset.tab; setSetting('opTab', tab); render(); });
  on(root, 'click', '[data-tdiv]', (e, b) => { tdiv = b.dataset.tdiv; tShown = 30; render(); });
  on(root, 'click', '[data-tper]', (e, b) => { tper = b.dataset.tper; render(); });
  on(root, 'click', '[data-mf]', (e, b) => { mfilter = b.dataset.mf; mShown = 50; render(); });
  on(root, 'click', '[data-tmore]', () => { tShown += 30; render(); });
  on(root, 'click', '[data-mmore]', () => { mShown += 50; render(); });
  on(root, 'click', '[data-profile]', () => openProfileForm(op, render));
  root.addEventListener('change', (e) => { const t = e.target; if (t.dataset.tc) { tcustom[t.dataset.tc] = t.value; render(); } });
  on(root, 'click', '[data-new]', async (e, b) => {
    const k = b.dataset.new;
    if (k === 'viaje') { const how = await chooseTripKind(); if (how === 'order') go(`/operacion/ordenes/nueva?operador=${encodeURIComponent(op.id)}`); if (how === 'trip') openTripForm(op, null, refresh); }
    if (k === 'prestamo') openLoanForm(op, null, refresh);
    if (k === 'ajuste') openAdjustmentForm(op, null, refresh);
  });
  on(root, 'click', '[data-settings]', () => openSettingsForm(op, refresh));
  on(root, 'click', '[data-stmt]', () => go(`/operadores/${id}/estado`));
  on(root, 'click', '[data-trip]', (e, b) => { const t = ops.recordsOf(id).trips.find((x) => x.id === b.dataset.trip); if (t) openTripDetail(op, t, refresh); });
  on(root, 'click', '[data-loan]', (e, b) => { const l = ops.recordsOf(id).loans.find((x) => x.id === b.dataset.loan); if (l) openLoanForm(op, l, refresh); });
  on(root, 'click', '[data-mv]', (e, b) => {
    const rec = ops.recordsOf(id), k = b.dataset.mv, mid = b.dataset.id;
    if (k === 'viaje') { const t = rec.trips.find((x) => x.id === mid); if (t) openTripDetail(op, t, refresh); }
    if (k === 'prestamo') { const l = rec.loans.find((x) => x.id === mid); if (l) openLoanForm(op, l, refresh); }
    if (k === 'ajuste') { const a = rec.adjustments.find((x) => x.id === mid); if (a) openAdjustmentForm(op, a, refresh); }
  });
  on(root, 'click', '[data-more]', async () => {
    const v = await actionSheet({ title: op.name, actions: [{ label: 'Editar configuración', value: 'cfg' }, { label: 'Exportar viajes a Excel', value: 'xlsx' }, { label: 'Exportar movimientos (CSV)', value: 'csv' }] });
    if (v === 'xlsx') exportTripsXlsx(ops.recordsOf(id).trips.filter((t) => !t.deletedAt).map((trip) => ({ trip, operator: op.name })), `Operador: ${op.name}`, 'Todos los viajes', op.name.replace(/\s+/g, '_'));
    if (v === 'cfg') openSettingsForm(op, refresh);
    if (v === 'csv') exportOperatorSheet(op);
  });
  render();
  if (q && q.get('nuevo') === 'viaje') s.mounted = () => setTimeout(() => openTripForm(op, null, refresh), 250);
  /* ?viaje=<tripId>: abre el detalle del viaje (p. ej. desde el expediente de un documento) */
  else if (q && q.get('viaje')) s.mounted = () => setTimeout(() => { const t = ops.recordsOf(id).trips.find((x) => x.id === q.get('viaje') && !x.deletedAt); if (t) { tab = 'viajes'; render(); openTripDetail(op, t, refresh); } }, 250);
  return s;
}

/* ===== Exportaciones (CSV para Excel; montos con 2 decimales) ===== */
/* Viajes a Excel (.xlsx) con el desglose fiscal de cada uno. items: [{ trip, operator }]. Requiere la cobranza ya cargada. */
function exportTripsXlsx(items, scope, periodLabel, slug) {
  if (!items.length) { toast('No hay viajes para exportar.', { type: 'info' }); return; }
  const d = new Date(), p2 = (n) => String(n).padStart(2, '0');
  const wb = buildTripsWorkbook(items.map((it) => ({ ...it, paid: !!(billingOf(it.trip.id) || {}).paid })), { company: getCompany('perconsur').legal, scope, periodLabel,
    generated: `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}` });
  deliver(new File([wb.bytes()], `PERCONSUR-viajes-${slug}-${todayStr()}.xlsx`, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}
/* Celda CSV. Un texto que empieza con = + - @ (o tabulador/retorno) se antepone con ' para que Excel no lo ejecute como
   fórmula; los números negativos se dejan como número. */
const csvCell = (v) => {
  let t = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(t) && !/^-?\d[\d,]*(\.\d+)?$/.test(t)) t = "'" + t;
  return /[",\n;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
const num = (c) => (Math.round(c) / 100).toFixed(2);
function csvFile(rows, name) { return new File(['\ufeff' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n')], name, { type: 'text/csv' }); }
async function deliver(file) {
  const r = await shareFile(file, { title: file.name });
  if (r === 'unsupported' || r === 'error') downloadBlob(file, file.name);
  if (r !== 'cancelled') toast('Archivo exportado: ' + file.name);
}
function exportOperatorSheet(op) {
  const rec = ops.recordsOf(op.id), r = computeOperator(rec);
  const rows = [
    ['Operador', op.name], ['Empresa', op.companyShort], ['Fecha de inicio', fmtDate(r.settings.startDate)], ['Calcular hasta', fmtDate(r.cutoff)],
    ['Sábados contabilizados', r.sat.count, r.sat.manual ? 'Ajuste manual' : 'Automático'], ['Monto semanal', num(r.sat.weekly)],
    [], ['Fórmula', 'Balance = Comisiones - Sábados pagados - Gastos de viaje - Préstamos'],
    ['Comisiones', num(r.comp.commissions)], ['Sábados pagados', num(r.comp.saturdaysPaid)], ['Gastos de viaje', num(r.comp.expenses)], ['Préstamos', num(r.comp.loans)], ['Balance actual', num(r.balance)],
    [], ['Fecha', 'Tipo', 'Concepto', 'División', 'Tarifa', 'Comisión', 'Gastos', 'Efecto en balance', 'Después del corte'],
    ...movementsOf(rec, r).filter((m) => m.kind !== 'config').map((m) => [fmtDate(m.date), { sabado: 'Sábado pagado', prestamo: 'Préstamo', viaje: 'Viaje', ajuste: 'Ajuste' }[m.kind], m.kind === 'sabado' && m.manual ? `${m.count} sábados (manual)` : m.title,
      m.division ? (m.division === 'campo' ? 'Campo' : 'Puerto') : '', m.fare != null ? num(m.fare) : '', m.commission != null ? num(m.commission) : '', m.expenses != null ? num(m.expenses) : '', num(m.amount), m.after ? 'Sí' : '']),
  ];
  deliver(csvFile(rows, `Operador-${op.name.replace(/\s+/g, '_')}-${todayStr()}.csv`));
}

/* ===== Resumen general ===== */
export async function summaryScreen() {
  await loadBilling();
  let per = 'todo', custom = { from: '', to: '' };
  const s = screen('<div class="page"></div>');
  const root = s.el;
  function data() {
    const range = periodRange(per, custom);
    const list = ops.operatorList().map((o) => ({ o, r: ops.computeFor(o.id, range) }));
    return { range, list, total: aggregate(list.map((x) => x.r)) };
  }
  function render() {
    const { range, list, total } = data();
    const manualNote = list.some((x) => x.r.sat.manualIgnored);
    root.innerHTML = `
      <header class="nav-top"><button type="button" class="nav-back" data-back>${icon.back}<span>Operadores</span></button></header>
      <h1 class="title">Resumen de operadores</h1>
      <div class="chips filters">${PERIODS.map(([k, l]) => `<button type="button" class="chip${per === k ? ' on' : ''}" data-per="${k}">${l}</button>`).join('')}</div>
      ${per === 'custom' ? `<div class="row2 period-custom"><label class="fld"><span class="fl">Desde</span><input class="in" type="date" data-c="from" value="${esc(custom.from)}"></label><label class="fld"><span class="fl">Hasta</span><input class="in" type="date" data-c="to" value="${esc(custom.to)}"></label></div>` : ''}
      ${balanceCard(total, { title: 'Balance acumulado', sub: range.from || range.to ? `Periodo ${esc(fmtDate(range.from) || 'inicio')} a ${esc(fmtDate(range.to) || 'hoy')}` : 'Todos los operadores, al corte de cada uno' })}
      <div class="tiles">
        <div class="tile"><small>Viajes</small><b>${total.stats.trips}</b></div>
        <div class="tile"><small>Puerto</small><b>${total.stats.puerto}</b></div>
        <div class="tile"><small>Campo</small><b>${total.stats.campo}</b></div>
        <div class="tile wide"><small>Tarifas base acumuladas</small><b>${money(total.stats.fares)}</b></div>
        <div class="tile wide"><small>Comisiones ampliadas aplicadas</small><b>${total.stats.expanded}${total.stats.expandedAmount ? ` <span class="muted">| ${money(total.stats.expandedAmount, { sign: true })}</span>` : ''}</b></div>
      </div>
      ${(() => { const n = list.reduce((a, x) => a + x.r.excluded.trips, 0); return n ? `<p class="op-warn">${icon.alert}<span>${plural(n, 'viaje registrado queda', 'viajes registrados quedan')} después del corte de su operador y no ${n === 1 ? 'entra' : 'entran'} en estos totales.</span></p>` : ''; })()}
      ${fiscalSummary(sumTaxes(list.flatMap((x) => x.r.included.trips)), { title: 'Total generado por los viajes', expenses: total.comp.expenses, commissions: total.comp.commissions })}
      <button type="button" class="btn-secondary block fisc-x" data-xlsx>${icon.download}<span>Exportar viajes a Excel</span></button>
      ${manualNote ? '<p class="grp-note">En periodos parciales, los sábados de operadores con ajuste manual se calculan automáticamente dentro del periodo.</p>' : ''}
      <div class="sec-hrow"><h2 class="sec-h">Por operador</h2><button type="button" class="btn-ghost sm" data-csv>${icon.download}<span>Exportar CSV</span></button></div>
      <div class="list">${list.map(({ o, r }) => `<a class="row op-row" href="#/operadores/${esc(o.id)}">${avatar(o)}
        <span class="row-tx"><span class="row-l1"><b>${esc(o.name)}</b></span><span class="row-l2">${plural(r.stats.trips, 'viaje', 'viajes')} | ${money(r.comp.commissions)} comisiones</span></span>
        <span class="op-bal ${amtCls(r.balance)}"><small>Balance</small><b>${money(r.balance)}</b></span></a>`).join('') || '<div class="empty"><p>No hay operadores.</p></div>'}</div>`;
    hydrateAvatars(root);
  }
  on(root, 'click', '[data-back]', () => back('/operadores'));
  on(root, 'click', '[data-per]', (e, b) => { per = b.dataset.per; render(); });
  root.addEventListener('change', (e) => { const t = e.target; if (t.dataset.c) { custom[t.dataset.c] = t.value; render(); } });
  on(root, 'click', '[data-xlsx]', () => {
    const { range, list } = data();
    exportTripsXlsx(list.flatMap(({ o, r }) => r.included.trips.map((trip) => ({ trip, operator: o.name }))), 'Todos los operadores', range.from || range.to ? `${fmtDate(range.from) || 'inicio'} a ${fmtDate(range.to) || 'hoy'}` : 'Todos los viajes hasta el corte de cada operador', 'operadores');
  });
  on(root, 'click', '[data-csv]', () => {
    const { range, list, total } = data();
    const head = ['Operador', 'Empresa', 'Fecha de inicio', 'Corte', 'Viajes', 'Puerto', 'Campo', 'Tarifas base', 'IVA', 'ISR', 'Retención IVA', 'Total después de impuestos', 'Comisiones', 'Comisiones ampliadas', 'Sábados contabilizados', 'Monto semanal', 'Sábados pagados', 'Gastos de viaje', 'Préstamos', 'Balance'];
    const rows = [
      ['Resumen de operadores', range.from || range.to ? `${fmtDate(range.from) || 'inicio'} a ${fmtDate(range.to) || 'hoy'}` : 'Todo'],
      ['Fórmula', 'Balance = Comisiones - Sábados pagados - Gastos de viaje - Préstamos'], [], head,
      ...list.map(({ o, r }) => [o.name, o.companyShort, fmtDate(r.settings.startDate), fmtDate(r.cutoff), r.stats.trips, r.stats.puerto, r.stats.campo, num(r.stats.fares), ...((s) => [num(s.vat), num(-s.isr), num(-s.vatWithholding), num(s.total)])(sumTaxes(r.included.trips)), num(r.comp.commissions), r.stats.expanded, r.sat.count, num(r.sat.weekly), num(r.comp.saturdaysPaid), num(r.comp.expenses), num(r.comp.loans), num(r.balance)]),
      ['TOTAL', '', '', '', total.stats.trips, total.stats.puerto, total.stats.campo, num(total.stats.fares), ...((s) => [num(s.vat), num(-s.isr), num(-s.vatWithholding), num(s.total)])(sumTaxes(list.flatMap((x) => x.r.included.trips))), num(total.comp.commissions), total.stats.expanded, total.stats.saturdays, '', num(total.comp.saturdaysPaid), num(total.comp.expenses), num(total.comp.loans), num(total.balance)],
    ];
    deliver(csvFile(rows, `Resumen-operadores-${todayStr()}.csv`));
  });
  render();
  return s;
}
