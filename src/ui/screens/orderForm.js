/*
 * Orden de Servicio — formulario por etapas (mismo armazón que los asistentes de documentos: wizardShell)
 *   #/operacion/ordenes/nueva[?division=puerto|campo&carga=<loadId>&operador=<id>]   orden nueva (se crea al avanzar)
 *   #/operacion/ordenes/:id/editar/:paso                                             editar una etapa
 * Etapas: 1 Información general · 2 Datos del transporte · 3 Asignación de recursos · 4 Documentación ·
 *         5 Información económica · 6 Revisión y despacho
 * Cada «Continuar», «Atrás», «Ir a otro paso» o cerrar GUARDA lo capturado (borrador): nada se pierde al regresar.
 * El formulario se adapta a la división y al tipo de operación (Campo no muestra documentación portuaria). Con carga de
 * Control de llenos vinculada, contenedor/peso/terminal o patio/cita se leen y escriben en la carga (una sola fuente).
 */
import { go } from '../../core/router.js';
import { on } from '../../core/dom.js';
import * as so from '../../services/orders.js';
import * as fc from '../../services/fulls.js';
import * as lg from '../../services/logistics.js';
import * as ops from '../../services/operators.js';
import { listAll, activeYards, activeLoadingYards, save as saveCatalog, trailerScope, trailerTypeLabel } from '../../services/catalogs.js';
import { TIPOS } from '../../config/reference.js';
import { getCompany } from '../../services/companies.js';
import { PUERTO_COMPANIES } from '../../config/companies.js';
import * as D from '../../domain/orders/orders.js';
import { cleanContainer, isContainer } from '../../domain/empties/empties.js';
import { money, toCents, centsInput } from '../../domain/operators/money.js';
import { ruleFromSettings, todayStr, fmtDate } from '../../domain/operators/balance.js';
import { weightText, parseWeight } from '../../domain/fulls/fulls.js';
import { esc } from '../../domain/shared/format.js';
import { icon } from '../components/icons.js';
import { actionSheet } from '../components/sheet.js';
import { openPicker } from '../components/picker.js';
import { toast } from '../components/toast.js';
import { wizardShell } from './wizardShell.js';
import { mountOrderDocs } from './orderDocs.js';
import { openTripForm } from './operatorForms.js';
import { orderPath, editPath, toneChip as tone, askText } from './orderKit.js';

export const ORDER_STEPS = [
  { key: 'general', title: 'Información general' }, { key: 'transporte', title: 'Datos del transporte' }, { key: 'recursos', title: 'Asignación de recursos' },
  { key: 'docs', title: 'Documentación' }, { key: 'economia', title: 'Información económica' }, { key: 'revision', title: 'Revisión y despacho' },
];
const N = ORDER_STEPS.length;

/* Estado editable a partir de la orden (o valores iniciales de una nueva) */
function stateFrom(o, q) {
  if (o) {
    const r = so.resolved(o);
    return { ...o, finance: { ...D.defaultFinance(o.division), ...(o.finance || {}) }, containerNumber: r.containerNumber, weightKg: r.weightKg, locationType: r.locationType, terminalId: r.terminalId, yardId: r.yardId, scheduledDate: r.scheduledDate, scheduledTime: r.scheduledTime, origin: r.origin, destination: r.destination, deliveryPlace: r.deliveryPlace, vehicleId: r.vehicleId, operatorId: r.operatorId, trailerId: r.trailerId };
  }
  const division = q && q.get('division') === 'campo' ? 'campo' : 'puerto';
  const st = { id: null, division, opType: D.defaultOpType(division), companyId: division === 'campo' ? 'campo' : 'perconsur', serviceDate: todayStr(), locationType: 'port', finance: D.defaultFinance(division), weightKg: null };
  const opId = q && q.get('operador'); if (opId && ops.operatorById(opId)) st.operatorId = opId;
  const loadId = q && q.get('carga'), load = loadId ? fc.byId(loadId) : null;
  if (load) Object.assign(st, { division: 'puerto', opType: 'full_pickup', containerNumber: load.containerNumber, weightKg: load.weightKg, locationType: load.locationType, terminalId: load.terminalId, yardId: load.yardId, scheduledDate: load.scheduledDate, scheduledTime: load.scheduledTime, vehicleId: load.vehicleId, operatorId: load.operatorId, trailerId: load.trailerId, _linkLoad: load.id, reference: load.reference });
  return st;
}

export async function orderNewScreen(params, q) { await so.loadOrders(); return formScreen(null, 0, q); }
export async function orderEditScreen({ id, step }, q) {
  await so.loadOrders();
  const o = so.byId(id);
  if (!o) { toast('Esa orden ya no existe.', { type: 'info' }); go('/operacion/ordenes', { replace: true }); return null; }
  if (o.phase === 'cancelled' || o.closedAt) { toast('La orden está cerrada: reábrela para corregirla.', { type: 'info' }); go(orderPath(id), { replace: true }); return null; }
  return formScreen(o, Math.min(Math.max((+step || 1) - 1, 0), N - 1), q);
}

async function formScreen(o0, i, q) {
  const st = stateFrom(o0, q);
  /* Lo que había al abrir la etapa: al guardar solo se envía lo que cambió aquí (un cambio hecho mientras tanto en Control de
     llenos, Logística u otro dispositivo no se pisa con valores viejos) */
  const base = JSON.parse(JSON.stringify(st));
  const isNew = !st.id;
  const shell = wizardShell({
    kind: isNew ? 'Nueva orden de servicio' : `Orden ${o0.folio}`, steps: ORDER_STEPS, i,
    chip: `<span class="co-chip so-chip"><b>${esc(D.divisionLabel(st.division, true))}</b></span>`,
    nextLabel: i === N - 1 ? (o0 && o0.phase !== 'draft' ? 'Abrir expediente' : 'Confirmar orden') : 'Continuar', backLabel: i === 0 ? 'Salir' : 'Atrás',
  });
  const body = shell.body;
  const t = () => D.opTypeOf(st.opType, st.division);
  const linked = () => (st.id ? !!so.loadOf(so.byId(st.id)) : false);
  const dispatched = () => (st.id ? !!so.opOf(so.byId(st.id)) : false);
  const nameOf = (kind, id) => { if (!id) return ''; const r = listAll(kind).find((x) => x.id === id); return r ? r.name : ''; };

  /* ===== Piezas de formulario ===== */
  const inp = (label, path, value, { type = 'text', mode = '', cap = 'sentences', ph = '', hint = '', max = 160, ro = false } = {}) => `<label class="fld" data-f="${path}"><span class="fl">${label}</span><input class="in" type="${type}" data-b="${path}" value="${esc(value ?? '')}"${mode ? ` inputmode="${mode}"` : ''} autocapitalize="${cap}" autocomplete="off"${ph ? ` placeholder="${esc(ph)}"` : ''} maxlength="${max}"${ro ? ' readonly' : ''} enterkeyhint="next">${hint ? `<span class="fhint">${hint}</span>` : ''}<span class="ferr"></span></label>`;
  const area = (label, path, value, ph = '') => `<label class="fld" data-f="${path}"><span class="fl">${label}</span><textarea class="in" rows="3" data-b="${path}" placeholder="${esc(ph)}">${esc(value ?? '')}</textarea></label>`;
  const pick = (label, path, value, ph, sub = '') => `<div class="fld" data-f="${path}"><span class="fl">${label}</span><button type="button" class="in pick${value ? '' : ' empty'}" data-pick="${path}"><span class="pv"><span class="pv-v">${esc(value || ph)}</span>${sub ? `<small>${sub}</small>` : ''}</span><span class="pick-ic">${icon.chev}</span></button><span class="ferr"></span></div>`;
  const segm = (path, value, opts, dis = false) => `<div class="seg wide" role="radiogroup" data-f="${path}">${opts.map(([v, l]) => `<button type="button" role="radio" class="seg-b${v === value ? ' on' : ''}" aria-checked="${v === value}" data-seg="${path}" data-v="${esc(v)}"${dis ? ' disabled' : ''}>${esc(l)}</button>`).join('')}</div>`;
  const sw = (label, path, checked, sub = '') => `<label class="sw-row"><span class="sw-tx">${label}${sub ? `<small>${sub}</small>` : ''}</span><input type="checkbox" switch class="sw" data-b="${path}"${checked ? ' checked' : ''}></label>`;
  const grp = (title, inner, note = '') => `<section class="grp"><div class="grp-h"><h3>${title}</h3></div>${note ? `<p class="grp-note">${note}</p>` : ''}<div class="grp-b">${inner}</div></section>`;
  const srcNote = (txt) => `<p class="so-src">${icon.link}<span>${txt}</span></p>`;

  /* ===== Etapas ===== */
  function stepGeneral() {
    const lock = !!(st.id && (linked() || dispatched()));
    const cust = so.placeById(st.customerId);
    return grp('División', `${segm('division', st.division, D.DIVISIONS.map(([k, l]) => [k, l]), lock)}${lock ? '<p class="fhint">La división ya no cambia: la orden tiene carga vinculada o ya se despachó.</p>' : ''}`)
      + grp('Tipo de operación', `<div class="so-types" role="radiogroup">${D.opTypesFor(st.division).map((x) => `<button type="button" role="radio" class="so-type${x.key === st.opType ? ' on' : ''}" aria-checked="${x.key === st.opType}" data-optype="${x.key}"${lock && x.key !== st.opType && (x.fullLoad !== t().fullLoad) ? ' disabled' : ''}><b>${esc(x.label)}</b><small>${esc(x.hint)}</small></button>`).join('')}</div>`)
      + (st.division === 'puerto' ? grp('Empresa transportista', `<div class="chips so-co">${PUERTO_COMPANIES.map((k) => `<button type="button" class="chip${st.companyId === k ? ' on' : ''}" data-co="${k}">${esc(getCompany(k).short)}</button>`).join('')}</div>`, 'Empresa con la que se emite la nota de entrega (logotipo, folio y datos de la empresa).') : '')
      + grp('Cliente', `${pick('Cliente', 'customerId', cust ? cust.name : st.customerName, 'Elegir del catálogo o escribir', cust && cust.address ? esc(cust.address) : '')}
        ${inp('Empresa solicitante', 'requester', st.requester, { cap: 'characters', ph: 'Si es distinta del cliente' })}
        <div class="row2">${inp('Fecha del servicio', 'serviceDate', st.serviceDate, { type: 'date' })}${inp('Referencia comercial', 'commercialRef', st.commercialRef, { cap: 'characters', max: 60, ph: 'Pedido, cotización…' })}</div>
        <div class="row2">${inp('Contacto operativo', 'contactName', st.contactName, { cap: 'words' })}${inp('Teléfono del contacto', 'contactPhone', st.contactPhone, { type: 'tel', mode: 'tel' })}</div>
        ${area('Instrucciones adicionales', 'instructions', st.instructions, 'Indicaciones para el operador o la entrega')}`);
  }
  function stepTransporte() {
    const ty = t(), lk = linked();
    const route = grp(st.division === 'campo' ? 'Ruta y carga' : 'Ruta', `<div class="row2">${inp(st.division === 'campo' ? 'Lugar de carga (origen)' : 'Origen', 'origin', st.origin, { cap: 'words', ph: st.division === 'puerto' ? 'Manzanillo' : 'Rancho, centro de acopio…' })}${inp('Destino', 'destination', st.destination, { cap: 'words', ph: 'Ciudad o municipio' })}</div>
        ${inp('Nombre del lugar de entrega', 'deliveryPlace', st.deliveryPlace, { cap: 'words', ph: 'Bodega, CEDIS, planta…' })}
        ${st.division === 'campo' ? pick('Planta destino (asignación de unidades)', 'plantId', nameOf('plants', st.plantId), 'Elegir planta del catálogo') : ''}
        <div class="row2">${inp(ty.fullLoad ? 'Fecha de la cita' : 'Fecha programada', 'scheduledDate', st.scheduledDate, { type: 'date' })}${inp(ty.fullLoad ? 'Hora de la cita' : 'Hora programada', 'scheduledTime', st.scheduledTime, { type: 'time' })}</div>
        <div class="row2">${inp('Tipo de carga', 'cargoType', st.cargoType, { ph: st.division === 'campo' ? 'Maíz, sorgo…' : 'Mercancía general…' })}${inp('Referencia', 'reference', st.reference, { cap: 'characters', max: 60, ph: st.division === 'campo' ? 'Solicitud o folio' : 'Referencia operativa' })}</div>
        ${area('Observaciones', 'notes', st.notes)}`);
    if (st.division === 'campo') return route + `<p class="grp-note">Campo usa jaula, tolva u otros remolques del catálogo; no pide DEC, DODA, cita portuaria ni contenedor marítimo.</p>`;
    const cont = ty.container ? grp('Contenedor', `${lk ? srcNote(`Datos compartidos con <a href="#/operacion/logistica/llenos/${esc(so.byId(st.id).fullLoadId)}">Control de llenos</a>: un cambio aquí reprograma la carga y la pizarra.`) : ''}
        <div class="row2">${inp('Número de contenedor', 'containerNumber', st.containerNumber, { cap: 'characters', ph: 'ABCU1234567', max: 13 })}<label class="fld" data-f="containerType"><span class="fl">Tipo (ISO)</span><span class="sel-w"><select class="in" data-b="containerType"><option value="">Sin indicar</option>${TIPOS.map(([v, l]) => `<option value="${esc(v)}"${st.containerType === v ? ' selected' : ''}>${esc(v)} · ${esc(l)}</option>`).join('')}</select><span class="sel-ic">${icon.down}</span></span></label></div>
        ${inp('Peso (kg)', 'weightKg', st.weightKg == null ? '' : String(st.weightKg), { mode: 'numeric', ph: '28,500' })}`) : '';
    const place = ty.fullLoad ? grp('Terminal o patio de carga', `${segm('locationType', st.locationType || 'port', [['port', 'Dentro de puerto'], ['offport', 'Fuera de puerto']])}
        ${st.locationType === 'offport' ? pick('Patio de carga', 'yardId', nameOf('loadingYards', st.yardId), 'Elegir patio de carga') : pick('Terminal portuaria', 'terminalId', nameOf('terminals', st.terminalId), 'Elegir terminal')}
        <p class="fhint">${st.locationType === 'offport' ? 'Fuera de puerto se piden pedimento y DODA; la cita cuando aplique.' : 'Dentro de puerto se piden pedimento, DODA, cita de recinto portuario y DEC.'}</p>`) : '';
    const refs = grp('Referencias operativas', `<div class="row2">${inp('BL', 'bl', st.bl, { cap: 'characters', max: 40 })}${inp('Pedimento (número)', 'pedimento', st.pedimento, { cap: 'characters', max: 40 })}</div>${inp('Carta porte', 'cartaPorte', st.cartaPorte, { cap: 'characters', max: 40 })}
        ${ty.emptyReturn ? pick('Patio previsto para devolver el vacío', 'returnYardId', st.returnYardId ? (listAll('yards').find((y) => y.id === st.returnYardId) || {}).name : '', 'Si ya se conoce (se puede completar después)') : ''}`);
    return route + cont + place + refs;
  }
  function availChip(kind, id) {
    if (!id) return '';
    const selfOp = st.id ? so.opOf(so.byId(st.id)) : null, sid = selfOp ? selfOp.id : null;
    const a = kind === 'unit' ? so.unitAvailability(id, sid) : kind === 'operator' ? so.operatorAvailability(id, sid) : so.trailerAvailability(id, sid);
    return tone(a);
  }
  function stepRecursos() {
    const u = st.vehicleId ? lg.unitById(st.vehicleId) : null, op = st.operatorId ? ops.operatorById(st.operatorId) : null, tr = st.trailerId ? lg.trailerById(st.trailerId) : null;
    const after = dispatched();
    return `${after ? `<section class="issues warn"><div class="issues-h">${icon.alert}<b>La orden ya se despachó</b></div><p>Un cambio actualiza la operación de Logística y queda en el historial con su motivo.</p></section>` : ''}
      ${grp('Transporte', `${pick('Unidad', 'vehicleId', u ? `${u.label}${u.placas ? ' · ' + u.placas : ''}` : '', 'Pendiente de asignar', availChip('unit', st.vehicleId))}
        ${pick('Operador', 'operatorId', op ? op.name : '', 'Pendiente de asignar', availChip('operator', st.operatorId))}
        ${pick('Remolque / chasis', 'trailerId', tr ? `${tr.placas} · ${trailerTypeLabel(tr.type) || 'Sin clasificar'}` : '', 'Pendiente de asignar', availChip('trailer', st.trailerId))}
        ${st.vehicleId || st.operatorId || st.trailerId ? `<button type="button" class="btn-ghost sm" data-clear>${icon.close}<span>Dejar pendiente de asignar</span></button>` : ''}`,
        'Puedes guardar la orden sin decidir la unidad. Para despachar se piden unidad, operador y remolque. Se verifica si están disponibles, en taller, inactivos o con documentos vencidos.')}`;
  }
  let docsMount = null;
  function stepDocs() {
    if (!st.id) return '<p class="grp-note">Guarda la orden para adjuntar documentos.</p>';
    return `<section class="grp"><div class="grp-h"><h3>${st.division === 'puerto' ? 'Documentación portuaria' : 'Documentos'}</h3></div><div class="grp-b" data-docs></div></section>`;
  }
  function stepEconomia() {
    const o = st.id ? so.byId(st.id) : null, trip = o ? so.tripOf(o) : null;
    if (trip) {
      return grp('Viaje financiero registrado', `${srcNote('Desde el despacho, la tarifa, los impuestos, los gastos y la comisión viven en el viaje del operador (una sola vez). Edítalos ahí para conservar las reglas de comisión y cobranza.')}
        <dl class="sumlist lg-sum"><div><dt>Tarifa base</dt><dd>${esc(money(trip.fare))}</dd></div><div><dt>Total</dt><dd>${esc(money(trip.totalAfterTaxes ?? trip.fare))}</dd></div><div><dt>Comisión</dt><dd>${esc(money(trip.finalCommission || 0))}</dd></div><div><dt>Gastos</dt><dd>${esc(money(trip.travelExpenses || 0))}</dd></div></dl>
        <button type="button" class="btn-secondary block" data-trip>${icon.edit}<span>Editar viaje e impuestos</span></button>`);
    }
    const f = st.finance, opr = st.operatorId ? ops.operatorById(st.operatorId) : null;
    const pv = D.financePreview(f, opr ? ruleFromSettings(ops.settingsFor(opr.id)) : null);
    return grp('Tarifa y gastos', `<div class="row2"><label class="fld" data-f="fare"><span class="fl">Tarifa base (sin impuestos)</span><span class="money-w"><span class="money-sym">$</span><input class="in money" data-money="fare" inputmode="decimal" value="${f.fare ? esc(centsInput(f.fare)) : ''}" placeholder="0.00"></span><span class="ferr"></span></label>
        <label class="fld" data-f="travelExpenses"><span class="fl">Gastos del viaje</span><span class="money-w"><span class="money-sym">$</span><input class="in money" data-money="travelExpenses" inputmode="decimal" value="${f.travelExpenses ? esc(centsInput(f.travelExpenses)) : ''}" placeholder="0.00"></span><span class="ferr"></span></label></div>`)
      + grp('Impuestos', `${sw('IVA 16%', 'finance.applyVat', f.applyVat)}${sw('Retención ISR 4%', 'finance.applyIsr', f.applyIsr)}${sw('Retención IVA 4%', 'finance.applyVatWithholding', f.applyVatWithholding, 'Nunca se activa sola')}`,
        `${st.division === 'campo' ? 'División Campo: IVA 16% e ISR 4% activados por omisión.' : 'División Puerto: impuestos desactivados por omisión.'} Editables por viaje (regla operativa de PERCONSUR).`)
      + grp('Resultado', `<dl class="sumlist lg-sum so-fin" data-finprev>${finPreview(pv, opr)}</dl>`, 'Total = tarifa base + IVA − ISR − retención de IVA. La comisión (15% de la tarifa sin IVA, o la mínima ampliada del operador) se registra una sola vez al despachar.')
      + inp('Notas económicas', 'finance.notes', f.notes, { max: 300 });
  }
  const finPreview = (pv, opr) => `<div><dt>IVA</dt><dd>${esc(money(pv.taxes.vatAmount))}</dd></div><div><dt>ISR</dt><dd>−${esc(money(pv.taxes.isrAmount))}</dd></div><div><dt>Retención IVA</dt><dd>−${esc(money(pv.taxes.vatWithholdingAmount))}</dd></div>
    <div><dt>Total del servicio</dt><dd><b>${esc(money(pv.taxes.totalAfterTaxes))}</b></dd></div><div><dt>Comisión del operador</dt><dd>${pv.commission ? `${esc(money(pv.commission.final))}${pv.commission.expanded ? ' <small>comisión ampliada</small>' : ''}` : '<i>Al asignar operador</i>'}</dd></div>`;
  function stepRevision() {
    const o = so.byId(st.id); if (!o) return '';
    const r = so.resolved(o), s = so.stateOf(o, r), chk = so.dispatchCheck(o);
    const issues = [...s.missing.data.map((m) => ({ msg: `Falta ${m}`, step: 1 })), ...(s.docs.complete ? [] : [{ msg: `Documentación: ${s.docs.missing.map(D.docKindLabel).join(', ')}`, step: 3 }]), ...s.missing.resources.map((m) => ({ msg: `Pendiente de asignar ${m}`, step: 2 }))];
    const rows = [['Folio', `<b class="folio sm">${esc(o.folio)}</b>`], ['División', esc(D.divisionLabel(o.division))], ['Operación', esc(t().label)], ['Cliente', esc(r.customer) || '<i>Sin indicar</i>'],
      ['Ruta', `${esc(r.origin || '—')} → ${esc(r.destination || '—')}${r.deliveryPlace ? `<small>${esc(r.deliveryPlace)}</small>` : ''}`],
      ...(t().container ? [['Contenedor', `<span class="mono">${esc(r.containerNumber || '—')}</span>${r.weightKg ? ` · ${esc(weightText(r.weightKg))}` : ''}`]] : []),
      ['Fecha', r.scheduledDate ? `${esc(fmtDate(r.scheduledDate))} ${esc(r.scheduledTime || '')}` : '<i>Sin programar</i>'],
      ['Unidad', esc(r.unit) || '<i>Pendiente</i>'], ['Operador', esc(r.operator) || '<i>Pendiente</i>'], ['Remolque', esc(r.trailer) || '<i>Pendiente</i>'],
      ['Documentación', tone(s.docs)], ['Estado', tone(s)], ['Siguiente paso', `<b>${esc(s.next.text)}</b>`]];
    return `${issues.length ? `<section class="issues"><div class="issues-h">${icon.alert}<b>Pendientes (${issues.length})</b></div><p>Puedes guardar la orden y completarlos después; para despachar deben resolverse.</p>
        ${issues.map((w, k) => `<button type="button" class="issue" data-goto="${w.step}"><span>${esc(w.msg)}</span><span class="chev">${icon.chev}</span></button>`).join('')}</section>`
      : chk.ok ? `<section class="ok-box">${icon.check}<span>La orden está lista para despacho.${chk.warnings.length ? ` Hay ${chk.warnings.length} advertencia${chk.warnings.length > 1 ? 's' : ''} por revisar al despachar.` : ''}</span></section>` : ''}
      <section class="grp"><div class="grp-h"><h3>Resumen</h3></div><dl class="sumlist lg-sum">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl></section>
      <div class="sheet-acts"><button type="button" class="btn-secondary" data-to="doc">${icon.file}<span>Generar documento</span></button><button type="button" class="btn-secondary" data-to="dispatch"${chk.ok && o.phase !== 'draft' ? '' : ' disabled'}>${icon.truck}<span>Despachar</span></button></div>
      <p class="grp-note">${o.phase === 'draft' ? 'Al confirmar, la orden deja de ser borrador y queda programada.' : 'Desde el expediente puedes generar la nota o asignación, despachar y dar seguimiento.'}</p>`;
  }
  const R = [stepGeneral, stepTransporte, stepRecursos, stepDocs, stepEconomia, stepRevision];
  function draw() {
    body.innerHTML = R[i]();
    if (i === 3 && st.id) docsMount = mountOrderDocs(body.querySelector('[data-docs]'), st.id, {});
  }

  /* ===== Captura ===== */
  const setPath = (p, v) => { if (p.startsWith('finance.')) { st.finance = { ...st.finance, [p.slice(8)]: v }; if (/^finance\.apply/.test(p)) st.finance.touchedTaxes = true; } else st[p] = v; };
  body.addEventListener('input', (e) => {
    const el = e.target, p = el.dataset.b, m = el.dataset.money;
    if (m) { const c = toCents(el.value); st.finance = { ...st.finance, [m]: c == null || Number.isNaN(c) ? 0 : c }; refreshFin(); return; }
    if (!p) return;
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (p === 'containerNumber') { const c = String(v).toUpperCase().replace(/[^A-Z0-9]/g, ''); if (c !== v) el.value = c; v = c; }
    if (p === 'weightKg') { const w = parseWeight(v); v = w == null || Number.isNaN(w) ? (String(v).trim() ? NaN : null) : w; }
    setPath(p, v);
    const f = el.closest('.fld'); if (f) { f.classList.remove('has-err'); const er = f.querySelector('.ferr'); if (er) er.textContent = ''; }
    if (/^finance\./.test(p)) refreshFin();
  });
  body.addEventListener('change', (e) => { const el = e.target; if (el.type === 'checkbox' && el.dataset.b) { setPath(el.dataset.b, el.checked); refreshFin(); } if (el.tagName === 'SELECT' && el.dataset.b) setPath(el.dataset.b, el.value); });
  function refreshFin() {
    const box = body.querySelector('[data-finprev]'); if (!box) return;
    const opr = st.operatorId ? ops.operatorById(st.operatorId) : null;
    box.innerHTML = finPreview(D.financePreview(st.finance, opr ? ruleFromSettings(ops.settingsFor(opr.id)) : null), opr);
  }
  on(body, 'click', '[data-seg]', (e, b) => {
    const p = b.dataset.seg, v = b.dataset.v;
    if (p === 'division' && v !== st.division) { st.division = v; st.opType = D.defaultOpType(v); st.companyId = v === 'campo' ? 'campo' : 'perconsur'; st.finance = D.financeForDivision(st.finance, v); shell.el.querySelector('.so-chip b').textContent = D.divisionLabel(v, true); }
    else setPath(p, v);
    draw();
  });
  on(body, 'click', '[data-optype]', (e, b) => { st.opType = b.dataset.optype; draw(); });
  on(body, 'click', '[data-co]', (e, b) => { st.companyId = b.dataset.co; draw(); });
  on(body, 'click', '[data-clear]', () => { st.vehicleId = null; st.operatorId = null; st.trailerId = null; draw(); });
  on(body, 'click', '[data-goto]', (e, b) => toStep(+b.dataset.goto));
  on(body, 'click', '[data-to]', async (e, b) => { if (!(await persist())) return; go(`/operacion/ordenes/${encodeURIComponent(st.id)}?a=${b.dataset.to}`); });
  on(body, 'click', '[data-trip]', () => { const o = so.byId(st.id), trip = so.tripOf(o), opr = trip ? ops.operatorById(trip.operatorId) : null; if (trip && opr) openTripForm(opr, trip, () => draw()); });
  on(body, 'click', '[data-pick]', async (e, b) => {
    const p = b.dataset.pick;
    const catItems = (kind, list) => (list || listAll(kind)).map((x) => ({ value: x.id, label: x.name, sub: x.address || '' }));
    let r = null;
    if (p === 'customerId') {
      r = await openPicker({ title: 'Cliente', items: catItems('places'), placeholder: 'Buscar o escribir cliente', allowNew: true, newLabel: 'Usar', canSave: true, saveLabel: 'Guardar en el catálogo de destinos', autocap: 'characters', transform: (v) => v.toUpperCase() });
      if (!r) return;
      if (r.isNew) { if (r.save) { const rec = await saveCatalog('places', { name: r.value.toUpperCase(), rfc: '', address: '', contact: '' }); st.customerId = rec.id; st.customerName = ''; toast('Cliente guardado en el catálogo'); } else { st.customerId = null; st.customerName = r.value.toUpperCase(); } }
      else { st.customerId = r.value; st.customerName = ''; const pl = so.placeById(r.value); if (pl && !st.deliveryPlace) st.deliveryPlace = ''; }
    }
    if (p === 'terminalId') { r = await openPicker({ title: 'Terminal portuaria', items: catItems('terminals'), allowNew: false, placeholder: 'Buscar terminal' }); if (r) st.terminalId = r.value; }
    if (p === 'yardId') { r = await openPicker({ title: 'Patio de carga', items: catItems('loadingYards', activeLoadingYards()), allowNew: false, placeholder: 'Buscar patio' }); if (r) st.yardId = r.value; }
    if (p === 'returnYardId') { r = await openPicker({ title: 'Patio de devolución del vacío', items: catItems('yards', activeYards()), allowNew: false, placeholder: 'Buscar patio' }); if (r) st.returnYardId = r.value; }
    if (p === 'plantId') { r = await openPicker({ title: 'Planta destino', items: catItems('plants'), allowNew: false, placeholder: 'Buscar planta' }); if (r) { st.plantId = r.value; const pl = listAll('plants').find((x) => x.id === r.value); if (pl && !st.deliveryPlace) st.deliveryPlace = pl.name; } }
    const selfOp = st.id ? so.opOf(so.byId(st.id)) : null, sid = selfOp ? selfOp.id : null;
    if (p === 'vehicleId') { r = await openPicker({ title: 'Unidad', items: lg.units().map((u) => ({ value: u.id, label: `${u.label}${u.placas ? ' · ' + u.placas : ''}`, sub: so.unitAvailability(u.id, sid).label })), allowNew: false, placeholder: 'Buscar unidad' }); if (r) st.vehicleId = r.value; }
    if (p === 'operatorId') { r = await openPicker({ title: 'Operador', items: ops.operatorList().map((x) => ({ value: x.id, label: x.name, sub: `${x.companyShort || ''} · ${so.operatorAvailability(x.id, sid).label}` })), allowNew: false, placeholder: 'Buscar operador' }); if (r) { st.operatorId = r.value; refreshFin(); } }
    if (p === 'trailerId') { r = await openPicker({ title: 'Remolque / chasis', items: listAll('trailers').map((x) => ({ value: x.id, label: x.placas, sub: `${trailerTypeLabel(x.type) || 'Sin clasificar'} · ${so.trailerAvailability(x.id, sid).label}`, data: x })), allowNew: false, placeholder: 'Buscar por placas', scope: trailerScope(st.division) }); if (r) st.trailerId = r.value; }
    draw();
  });

  /* ===== Guardado ===== */
  const fieldErr = (name, msg) => { const f = body.querySelector(`[data-f="${name}"]`); if (f) { f.classList.add('has-err'); const er = f.querySelector('.ferr'); if (er) er.textContent = msg; f.scrollIntoView({ block: 'center', behavior: 'smooth' }); } toast(msg, { type: 'warn', ms: 4000 }); return false; };
  function validateStep() {
    if (i === 1) {
      if (st.containerNumber && !isContainer(cleanContainer(st.containerNumber))) return fieldErr('containerNumber', 'El número de contenedor debe tener 4 letras y 7 dígitos.');
      if (Number.isNaN(st.weightKg)) return fieldErr('weightKg', 'El peso debe ser un número en kilogramos.');
      if (st.weightKg != null && st.weightKg > 60000) return fieldErr('weightKg', 'El peso no puede ser mayor a 60,000 kg.');
    }
    if (i === 4 && st.finance && (st.finance.fare < 0 || st.finance.travelExpenses < 0)) return fieldErr('fare', 'Los montos no pueden ser negativos.');
    return true;
  }
  const FIELDS = ['division', 'opType', 'companyId', 'customerId', 'customerName', 'requester', 'contactName', 'contactPhone', 'serviceDate', 'commercialRef', 'instructions', 'origin', 'destination', 'deliveryPlace', 'cargoType', 'reference', 'notes', 'scheduledDate', 'scheduledTime', 'containerNumber', 'containerType', 'weightKg', 'locationType', 'terminalId', 'yardId', 'bl', 'pedimento', 'cartaPorte', 'returnYardId', 'plantId'];
  const pickFields = () => Object.fromEntries(FIELDS.filter((k) => k in st).map((k) => [k, st[k]]));
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const changedFields = () => Object.fromEntries(FIELDS.filter((k) => k in st && !same(st[k], base[k])).map((k) => [k, st[k]]));
  let saving = false;
  async function persist() {
    if (saving) return false;
    if (!validateStep()) return false;
    saving = true;
    try {
      if (!st.id) {
        const o = await so.createOrder({ ...pickFields(), vehicleId: st.vehicleId || null, operatorId: st.operatorId || null, trailerId: st.trailerId || null, finance: st.finance });
        st.id = o.id;
        if (st._linkLoad) { try { await so.linkLoad(o.id, st._linkLoad); toast('Vinculada con la carga de Control de llenos'); } catch (e) { toast(e.message, { type: 'warn' }); } delete st._linkLoad; }
        toast(`Orden ${o.folio} guardada como borrador`);
      } else {
        const diff = changedFields();
        const res = Object.keys(diff).length ? await so.updateOrder(st.id, diff) : {};
        if (res.loadErrors) { const [k, msg] = Object.entries(res.loadErrors)[0]; saving = false; return fieldErr(k === 'scheduledDate' || k === 'scheduledTime' || k === 'containerNumber' || k === 'weightKg' ? k : k === 'terminalId' || k === 'yardId' ? k : 'containerNumber', `Control de llenos: ${msg}`); }
        /* Asignación (con historial; después del despacho pide motivo) */
        const o = so.byId(st.id);
        if (i === 2 && (!same(st.vehicleId, base.vehicleId) || !same(st.operatorId, base.operatorId) || !same(st.trailerId, base.trailerId))) {
          let reason = '';
          if (so.opOf(o) && !so.opOf(o).closedAt) { reason = await askText({ title: 'Cambio de asignación', message: 'La orden ya se despachó: el cambio actualiza la operación de Logística y queda en el historial.', label: 'Motivo del cambio', confirm: 'Guardar cambio' }); if (!reason) { toast('El cambio de asignación no se guardó.', { type: 'info' }); saving = false; return false; } }
          await so.assign(st.id, { vehicleId: st.vehicleId || null, operatorId: st.operatorId || null, trailerId: st.trailerId || null }, { reason });
        }
        if (i === 4 && !so.tripOf(o) && !same(st.finance, base.finance)) await so.saveFinance(st.id, st.finance);
      }
      /* Recolección de lleno: con los datos completos se programa (o vincula) la carga en Control de llenos */
      const o = so.byId(st.id);
      if (i >= 1 && D.opTypeOf(o.opType, o.division).fullLoad && !o.fullLoadId && so.loadReady(o)) {
        const free = so.freeLoadFor(o.containerNumber);
        if (free) {
          const v = await actionSheet({ title: 'El contenedor ya está programado', message: `Control de llenos tiene una carga de ${free.containerNumber} para el ${fmtDate(free.scheduledDate)} ${free.scheduledTime}. Vincularla evita capturar dos veces la cita y los documentos.`, actions: [{ label: 'Vincular con esa carga', value: 'link', style: 'primary' }, { label: 'Programar otra carga', value: 'new' }] });
          if (v === 'link') { await so.linkLoad(o.id, free.id); toast('Vinculada con Control de llenos'); }
          else if (v === 'new') { const res = await so.createLoadFor(o.id); if (res.errors) toast(`Control de llenos: ${Object.values(res.errors)[0]}`, { type: 'warn', ms: 5000 }); else toast('Carga programada en Control de llenos'); }
        } else { const res = await so.createLoadFor(o.id); if (res.errors) toast(`Control de llenos: ${Object.values(res.errors)[0]}`, { type: 'warn', ms: 5000 }); else toast('Carga programada en Control de llenos'); }
      }
      return true;
    } catch (e) { toast(e.message || 'No se pudo guardar la orden.', { type: 'warn', ms: 4500 }); return false; } finally { saving = false; }
  }
  const toStep = async (n) => { if (!(await persist())) return; go(editPath(st.id, n)); };
  shell.onNext(async () => {
    if (i < N - 1) { await toStep(i + 1); return; }
    if (!(await persist())) return;
    const o = so.byId(st.id);
    if (o.phase === 'draft') { try { await so.confirmOrder(o.id); toast(`Orden ${o.folio} confirmada`); } catch (e) { toast(e.message, { type: 'warn' }); return; } }
    go(orderPath(st.id), { replace: true });
  });
  shell.onBack(async () => { if (i === 0) { if (st.id) { if (!(await persist())) return; go(orderPath(st.id), { replace: true }); } else go('/operacion/ordenes', { replace: true }); return; } await toStep(i - 1); });
  shell.onClose(async () => { if (!st.id) { const any = st.customerId || st.customerName || st.origin || st.destination || st.containerNumber; if (any && !(await persist())) return; } else if (!(await persist())) return; if (st.id) { toast('Borrador guardado'); go(orderPath(st.id), { replace: true }); } else go('/operacion/ordenes', { replace: true }); });
  shell.onJump(async (n) => toStep(n));
  draw();
  return { el: shell.el };
}
