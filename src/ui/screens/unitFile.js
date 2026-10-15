/*
 * Expediente de una unidad (#/unidades/:id?sec=info|fotos|docs|vigencias|historial)
 *   Encabezado   fotografía frontal, UNIDAD ###, placas, marca y modelo, expediente completo/incompleto (X/Y) y, aparte,
 *                avisos de documentos por vencer o vencidos
 *   Información  datos generales (editar), relaciones con Taller, GPS, Combustible y Logística, identificador interno
 *   Fotografías  vista frontal y placas: tomar o elegir, vista previa antes de guardar, fecha de captura (EXIF, cámara
 *                de la app o manual) distinta de la fecha de carga, ampliar, reemplazar (la anterior queda en historial)
 *   Documentación las cinco categorías con su propio botón; el complemento de pago detecta su periodo y se confirma
 *   Vigencias    documento, fecha de fin, días restantes y estado
 *   Historial    eventos y versiones anteriores
 * Con «solo consulta» se puede ver todo, pero no agregar ni cambiar.
 */
import { screen, on } from '../../core/dom.js';
import { go, back } from '../../core/router.js';
import * as un from '../../services/units.js';
import * as media from '../../services/media.js';
import { isReadOnly } from '../../services/access.js';
import { readText } from '../../services/docText.js';
import { getCompany } from '../../services/companies.js';
import { detectPeriod } from '../../domain/units/complement.js';
import {
  DOC_TYPES, DOC_KEYS, docType, FIELD_LABELS, VEHICLE_TYPES, vehicleTypeLabel, unitTitle, isActive, validityOf, complementState, daysText,
  dateShort, dateLong, VALIDITY,
} from '../../domain/units/units.js';
import { esc } from '../../domain/shared/format.js';
import { icon } from '../components/icons.js';
import { openSheet, actionSheet, confirmDestructive } from '../components/sheet.js';
import { toast } from '../components/toast.js';
import { openFileViewer } from '../components/fileViewer.js';

export const DOC_ICON = { registration: 'file', insurance: 'shield', payment_complement: 'cash', mechanical_inspection: 'wrench', low_emissions_certificate: 'gauge' };
export const chip = (v) => `<span class="un-chip t-${v.tone}"><i aria-hidden="true"></i>${esc(v.label)}</span>`;
const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;
const SECTIONS = [['info', 'Información'], ['fotos', 'Fotografías'], ['docs', 'Documentación'], ['vigencias', 'Vigencias'], ['historial', 'Historial']];
const EXTRACT = new Set(['payment_complement', 'insurance', 'mechanical_inspection', 'low_emissions_certificate']);

/* ===== Datos generales (alta y edición) ===== */
export function unitForm(unit) {
  const v = unit || { active: '' };
  const f = (name, label, attrs = '', val = v[name]) => `<label class="fld" data-f="${name}"><span class="fl">${label}</span><input class="in" name="${name}" value="${esc(val || '')}" autocomplete="off" ${attrs}><span class="ferr" data-err="${name}"></span></label>`;
  const body = `<form class="op-form un-form" novalidate>
    <div class="row2">${f('eco', 'Número económico *', 'inputmode="numeric" enterkeyhint="next" placeholder="21"')}${f('placas', 'Placas', 'autocapitalize="characters" spellcheck="false" placeholder="XX-0000-X"')}</div>
    ${f('vin', 'Número de identificación vehicular (VIN/NIV)', 'autocapitalize="characters" spellcheck="false" maxlength="17"')}
    <div class="row2">${f('brand', 'Marca', 'autocapitalize="words" placeholder="Freightliner"')}${f('model', 'Modelo', 'autocapitalize="words" placeholder="Cascadia"')}</div>
    <div class="row2">${f('year', 'Año', 'inputmode="numeric" maxlength="4"')}
      <label class="fld"><span class="fl">Tipo de vehículo</span><span class="sel-w"><select class="in" name="vehicleType"><option value="">Sin tipo</option>${VEHICLE_TYPES.map(([k, l]) => `<option value="${k}"${v.vehicleType === k ? ' selected' : ''}>${l}</option>`).join('')}</select><span class="sel-ic">${icon.down}</span></span></label></div>
    <div class="row2">${f('color', 'Color (opcional)', 'autocapitalize="words"')}
      <label class="fld"><span class="fl">Estado</span><span class="sel-w"><select class="in" name="active"><option value=""${v.active !== 'no' ? ' selected' : ''}>Activa</option><option value="no"${v.active === 'no' ? ' selected' : ''}>Inactiva</option></select><span class="sel-ic">${icon.down}</span></span></label></div>
    <label class="fld"><span class="fl">Observaciones</span><textarea class="in" name="notes" rows="3">${esc(v.notes || '')}</textarea></label>
    <button type="submit" class="btn-primary block">${unit ? 'Guardar cambios' : 'Agregar unidad'}</button>
    ${unit ? '<p class="grp-note">Cambiar placas o número económico no rompe ninguna relación: la unidad se identifica por su identificador interno. Los documentos ya generados conservan los datos con los que se emitieron.</p>' : '<p class="grp-note">La unidad queda en el catálogo único PERCONSUR y se puede elegir en los formularios de todas las empresas.</p>'}
  </form>`;
  return new Promise((resolve) => {
    let saved = null;
    const sh = openSheet({ title: unit ? `Editar ${unitTitle(unit)}` : 'Agregar unidad', body, onClose: () => resolve(saved) });
    const form = sh.body.querySelector('form');
    form.addEventListener('input', (e) => { if (e.target.name === 'placas' || e.target.name === 'vin') e.target.value = e.target.value.toUpperCase(); if (e.target.name === 'eco' || e.target.name === 'year') e.target.value = e.target.value.replace(/\D/g, ''); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      form.querySelectorAll('[data-err]').forEach((x) => { x.textContent = ''; });
      const data = Object.fromEntries(new FormData(form).entries());
      try { saved = await un.saveUnit(data, unit ? unit.id : null); toast(unit ? 'Cambios guardados' : 'Unidad agregada'); sh.close(); }
      catch (err) {
        if (err.fields) for (const [k, m] of Object.entries(err.fields)) { const x = form.querySelector(`[data-err="${k}"]`); if (x) x.textContent = m; }
        else toast(err.message, { type: 'warn' });
      }
    });
  });
}

/* ===== Pantalla ===== */
export async function unitFileScreen({ id }, q) {
  await un.loadUnits();
  let u = un.resolveUnit(id);
  if (!u) { toast('La unidad ya no existe.', { type: 'warn' }); go('/unidades', { replace: true }); return null; }
  if (u.id !== id) { go(`/unidades/${encodeURIComponent(u.id)}`, { replace: true }); return null; }
  let sec = (q && q.get('sec')) || 'info';
  if (!SECTIONS.some(([k]) => k === sec)) sec = 'info';
  const ro = isReadOnly();
  const s = screen(`<div class="page wide uf-page">
    <header class="nav-top"><button type="button" class="nav-back" data-back>${icon.back}<span>Unidades</span></button>
      ${ro ? '' : `<button type="button" class="nav-act" data-edit aria-label="Editar datos de la unidad">${icon.edit}</button>`}</header>
    <header class="uf-hero" data-hero></header>
    <nav class="uf-tabs" role="tablist" aria-label="Secciones del expediente">${SECTIONS.map(([k, l]) => `<button type="button" role="tab" class="uf-tab" data-sec="${k}">${l}</button>`).join('')}</nav>
    <section class="uf-sec" data-body role="tabpanel"></section>
    <input type="file" accept="image/*" capture="environment" data-in-cam hidden>
    <input type="file" accept="${un.IMG_ACCEPT}" data-in-lib hidden>
    <input type="file" accept="${un.DOC_ACCEPT}" data-in-doc hidden>
  </div>`);
  const root = s.el, bodyEl = root.querySelector('[data-body]');
  const inCam = root.querySelector('[data-in-cam]'), inLib = root.querySelector('[data-in-lib]'), inDoc = root.querySelector('[data-in-doc]');
  let pending = null;   /* qué espera el selector de archivos: { what:'photo', type } | { what:'doc', type, replaceOf } */
  const urls = [];
  const day = () => un.today();
  const st = () => un.statusOf(u, day());

  function hero() {
    const x = st(), ph = un.currentPhoto(u.id, 'front'), name = [u.brand, u.model].filter(Boolean).join(' ');
    const warns = [x.expired.length ? `<span class="un-chip t-danger"><i></i>${plural(x.expired.length, 'documento vencido', 'documentos vencidos')}</span>` : '',
      x.today.length ? `<span class="un-chip t-alert"><i></i>${plural(x.today.length, 'documento vence hoy', 'documentos vencen hoy')}</span>` : '',
      x.soon.length ? `<span class="un-chip t-warn"><i></i>${plural(x.soon.length, 'documento próximo a vencer', 'documentos próximos a vencer')}</span>` : ''].join('');
    root.querySelector('[data-hero]').innerHTML = `
      <button type="button" class="uf-photo" data-photo-open="${ph ? esc(ph.id) : ''}" ${ph ? '' : 'disabled'} aria-label="Ampliar fotografía frontal">${ph && (ph.displayKey || ph.thumbKey) ? `<img data-key="${esc(ph.displayKey || ph.thumbKey)}" alt="Fotografía frontal">` : `<span class="un-noph">${icon.truck}<small>Sin fotografía frontal</small></span>`}</button>
      <div class="uf-id">
        <p class="un-eyebrow">PERCONSUR · Unidades</p>
        <h1 class="title uf-title">${esc(unitTitle(u))}</h1>
        <p class="uf-sub">${name ? esc(name) : '<i>Marca y modelo sin registrar</i>'}${u.year ? ' · ' + esc(u.year) : ''}${u.vehicleType ? ' · ' + esc(vehicleTypeLabel(u.vehicleType)) : ''}</p>
        <p class="uf-pl">Placas <b class="mono">${u.placas ? esc(u.placas) : '—'}</b>${isActive(u) ? '' : ' <span class="un-chip t-muted"><i></i>Inactiva</span>'}</p>
        <div class="uf-status"><span class="un-chip t-${x.isComplete ? 'ok' : 'warn'}"><i></i>${x.label}</span><span class="uf-count">Documentos completos: <b>${x.complete}/${x.total}</b></span></div>
        ${warns ? `<div class="uf-warns">${warns}</div>` : ''}
      </div>`;
    loadKeys(root.querySelector('[data-hero]'));
  }
  async function loadKeys(host) {
    for (const im of host.querySelectorAll('img[data-key]:not([src])')) {
      const url = await media.ensureURL(im.dataset.key);
      if (url) im.src = url; else im.replaceWith(Object.assign(document.createElement('span'), { className: 'un-noph', innerHTML: `${icon.image}<small>Archivo no disponible en este dispositivo</small>` }));
    }
  }
  function tabs() {
    root.querySelectorAll('[data-sec]').forEach((b) => { const o = b.dataset.sec === sec; b.classList.toggle('on', o); b.setAttribute('aria-selected', String(o)); });
  }

  /* ----- Información ----- */
  function infoHTML() {
    const row = (k, v) => `<div><dt>${k}</dt><dd>${v || '<i>Sin registrar</i>'}</dd></div>`;
    const co = u.company && u.company !== 'perconsur' ? getCompany(u.company).short : '';
    return `<section class="grp"><div class="grp-h"><h3>Datos generales</h3>${ro ? '' : '<button type="button" class="link" data-edit>Editar</button>'}</div>
      <div class="grp-b"><dl class="uf-dl">
        ${row('Número económico', esc(String(u.eco || '')))}${row('Placas', u.placas ? `<span class="mono">${esc(u.placas)}</span>` : '')}${row('VIN/NIV', u.vin ? `<span class="mono">${esc(u.vin)}</span>` : '')}
        ${row('Marca', esc(u.brand || ''))}${row('Modelo', esc(u.model || ''))}${row('Año', esc(u.year || ''))}
        ${row('Tipo de vehículo', u.vehicleType ? esc(vehicleTypeLabel(u.vehicleType)) : '')}${row('Color', esc(u.color || ''))}${row('Estado', isActive(u) ? 'Activa' : 'Inactiva')}
        ${row('Observaciones', esc(u.notes || u.desc || ''))}
      </dl></div></section>
      <section class="grp"><div class="grp-h"><h3>Relaciones en PERCONSUR</h3></div><div class="grp-b list-actions">
        <a class="row-btn" href="#/operacion/logistica/u/${encodeURIComponent(u.id)}">${icon.truck}<span>Logística</span>${icon.chev}</a>
        <a class="row-btn" href="#/operacion/taller/equipo/u/${encodeURIComponent(u.id)}">${icon.wrench}<span>Historial de mantenimiento</span>${icon.chev}</a>
        <a class="row-btn" href="#/operacion/combustible/${encodeURIComponent(u.id)}">${icon.fuel}<span>Combustible y rendimiento</span>${icon.chev}</a>
        <a class="row-btn" href="#/ajustes/gps">${icon.pin}<span>GPS</span><small>${u.gpsDeviceId ? 'IMEI ' + esc(u.gpsDeviceId) : 'Sin GPS vinculado'}</small>${icon.chev}</a>
      </div></section>
      <p class="grp-note">Identificador interno: <span class="mono">${esc(u.id)}</span>. No cambia aunque cambien las placas o el número económico.${co ? ` Registro original del catálogo de ${esc(co)}.` : ''}</p>`;
  }

  /* ----- Fotografías ----- */
  function photoBlock(type, title, sub) {
    const p = un.currentPhoto(u.id, type), old = un.photosOf(u.id).filter((x) => x.photoType === type && x.status === 'archived');
    return `<section class="grp uf-phs" data-ptype="${type}"><div class="grp-h"><h3>${title}</h3>${p ? `<span class="un-chip t-ok"><i></i>Guardada</span>` : '<span class="un-chip t-muted"><i></i>Pendiente</span>'}</div>
      <div class="grp-b">
        <button type="button" class="uf-phimg" ${p ? `data-photo-open="${esc(p.id)}"` : 'disabled'} aria-label="Ampliar ${esc(title.toLowerCase())}">${p && (p.displayKey || p.thumbKey) ? `<img data-key="${esc(p.displayKey || p.thumbKey)}" alt="${esc(title)}">` : p ? `<span class="un-noph">${icon.image}<small>Vista previa no disponible (formato original conservado)</small></span>` : `<span class="un-noph">${icon.camera}<small>${esc(sub)}</small></span>`}</button>
        ${p ? `<dl class="uf-dates">
          <div><dt>Fecha de captura</dt><dd>${p.capturedAt && p.captureDateSource !== 'unknown' ? esc(un.fmtStamp(p.capturedAt, p.capturedOffset)) : 'Fecha de captura no disponible'}<small>${esc(un.CAPTURE_LABEL[p.captureDateSource] || '')}${p.captureDateSource === 'exif' && p.exifField === 'DateTimeDigitized' ? ' (fecha de digitalización)' : ''}</small></dd></div>
          <div><dt>Fecha de carga</dt><dd>${esc(un.fmtMs(p.uploadedAt))}<small>Incorporada al expediente${p.uploadedBy ? ' por ' + esc(p.uploadedBy) : ''}</small></dd></div>
        </dl>
        ${!ro && (p.captureDateSource === 'unknown' || p.captureDateSource === 'manual') ? `<button type="button" class="btn-ghost sm" data-pdate="${esc(p.id)}">${icon.calendar}<span>${p.captureDateSource === 'manual' ? 'Corregir fecha de captura' : 'Agregar fecha de captura (opcional)'}</span></button>` : ''}` : ''}
        ${ro ? '' : `<p class="uf-phlbl">${p ? 'Reemplazar' : `Tomar o subir ${type === 'front' ? 'foto frontal' : 'foto de placas'}`}</p>
        <div class="uf-phacts"><button type="button" class="btn-primary" data-cam="${type}">${icon.camera}<span>Tomar foto</span></button><button type="button" class="btn-secondary" data-lib="${type}">${icon.image}<span>Elegir foto</span></button></div>`}
        ${old.length ? `<details class="uf-old"><summary>Fotografías anteriores (${old.length})</summary><div class="uf-oldl">${old.map((o) => `<button type="button" class="uf-oldi" data-photo-open="${esc(o.id)}">${o.thumbKey ? `<img data-key="${esc(o.thumbKey)}" alt="">` : icon.image}<span>${esc(un.captureText(o))}<small>Subida: ${esc(un.fmtMs(o.uploadedAt))}</small></span></button>`).join('')}</div></details>` : ''}
      </div></section>`;
  }
  const photosHTML = () => photoBlock('front', 'Vista frontal', 'Sin fotografía frontal') + photoBlock('license_plate', 'Placas', 'Sin fotografía de las placas')
    + '<p class="grp-note">La fecha de captura se toma de los metadatos de la fotografía cuando existen. Nunca se usa la fecha de carga como fecha de captura. Las fotografías se guardan completas, sin recortes.</p>';

  /* ----- Documentación ----- */
  function docRow(t, it) {
    const d = it.doc, v = it.req === false ? null : it.v, T = docType(t);
    const vv = it.v;
    const tone = vv.key === 'none' && !it.required ? 'muted' : vv.tone;
    return `<article class="uf-doc" data-dtype="${t}">
      <span class="uf-dic t-${tone}">${icon[DOC_ICON[t]]}</span>
      <div class="uf-dtx"><b>${esc(T.label)}</b>
        <span class="uf-dchips">${vv.key === 'none' ? (it.required ? chip(VALIDITY.missing) : chip(VALIDITY.notRequired)) : chip(vv)}${it.required ? '' : vv.key !== 'none' ? '<span class="un-chip t-muted"><i></i>No requerido</span>' : ''}</span>
        ${d ? `<small>${esc(d.name)} · Subido: ${esc(un.fmtMs(d.uploadedAt))}</small>${vv.until ? `<small>Vence: ${esc(dateLong(vv.until))} · ${esc(daysText(vv.days))}</small>` : vv.key === 'pending' ? '<small>Vigencia por verificar: registra o confirma las fechas</small>' : d.noExpiry ? '<small>El documento no indica vencimiento</small>' : ''}` : '<small>Sin archivo adjunto</small>'}
      </div>
      <div class="uf-dact">${d ? `<button type="button" class="btn-secondary sm" data-view="${esc(d.id)}">${icon.eye}<span>Ver documento</span></button><button type="button" class="icon-btn" data-more="${esc(d.id)}" aria-label="Más acciones de ${esc(T.label)}">${icon.more}</button>`
        : ro ? '' : `<button type="button" class="btn-primary sm" data-up="${t}">${icon.upload}<span>${esc(T.upload)}</span></button>`}</div>
    </article>`;
  }
  function complementHTML(it) {
    const all = un.docsByType(u.id, 'payment_complement'), cs = complementState(all, day()), a = cs.active, v = it.v;
    const T = docType('payment_complement');
    const hist = all.length;
    const ov = cs.overlaps.length ? `<p class="uf-cpw">${icon.alert}<span>Hay complementos con periodos que se enciman. Revisa el historial y verifica cuál es el correcto.</span></p>` : '';
    const amb = cs.ambiguous ? `<p class="uf-cpw">${icon.alert}<span>Varios complementos cubren hoy. Elige el correcto en el historial («Usar como cobertura vigente»).</span></p>` : '';
    return `<article class="uf-cp t-${it.doc ? v.tone : it.required ? 'muted' : 'muted'}" data-dtype="payment_complement">
      <header class="uf-cph"><span class="uf-dic t-${v.tone}">${icon.cash}</span><div><b>COMPLEMENTO DE PAGO</b>${it.doc ? chip(v) : chip(it.required ? VALIDITY.none : VALIDITY.notRequired)}</div></header>
      ${it.doc ? `<div class="uf-cpb">
          <p class="uf-cpf">${icon.file}<span>${esc(it.doc.name)}<small>Subido: ${esc(un.fmtMs(it.doc.uploadedAt))} · ${esc(srcLabel(it.doc))}</small></span></p>
          ${v.from || v.until ? `<p class="uf-cpc"><small>Cobertura</small><b>${esc(dateShort(v.from || it.doc.validFrom))} — ${esc(dateShort(v.until || it.doc.validUntil))}</b></p>` : ''}
          ${v.key === 'pending' ? '<p class="uf-cpd t-muted">Periodo pendiente de verificación</p>' : v.key === 'future' ? `<p class="uf-cpd t-info">Inicia en ${plural(v.days, 'día', 'días')}</p>` : v.until ? `<p class="uf-cpd t-${v.tone}">${esc(daysText(v.days))}</p>` : ''}
          <p class="uf-cps">Estado: <b>${esc(v.label)}</b></p>
        </div>` : `<p class="uf-cpe">Sin complemento adjunto. Al subirlo, PERCONSUR lee el periodo de cobertura y te pide confirmarlo.</p>`}
      ${cs.upcoming && cs.upcoming !== it.doc ? `<p class="uf-cpn">${icon.calendar}<span>Próxima cobertura: <b>${esc(dateShort(cs.upcoming.validFrom))} — ${esc(dateShort(cs.upcoming.validUntil))}</b></span></p>` : ''}
      ${cs.pending.filter((p) => p !== it.doc).length ? `<p class="uf-cpw">${icon.info}<span>${plural(cs.pending.filter((p) => p !== it.doc).length, 'complemento con periodo por verificar', 'complementos con periodo por verificar')} en el historial.</span></p>` : ''}
      ${amb}${ov}
      <div class="uf-cpa">
        ${it.doc ? `<button type="button" class="btn-secondary sm" data-view="${esc(it.doc.id)}">${icon.eye}<span>Ver documento</span></button>` : ''}
        ${ro ? '' : `<button type="button" class="btn-primary sm" data-up="payment_complement">${icon.upload}<span>${it.doc ? 'Añadir nuevo complemento' : esc(T.upload)}</span></button>`}
        ${hist ? `<button type="button" class="btn-ghost sm" data-hist="payment_complement">${icon.list}<span>Ver historial (${hist})</span></button>` : ''}
        ${it.doc && !ro ? `<button type="button" class="btn-ghost sm" data-editdoc="${esc(it.doc.id)}">${icon.calendar}<span>${it.doc.verificationStatus === 'pending' ? 'Verificar periodo' : 'Editar periodo'}</span></button>` : ''}
      </div></article>`;
  }
  const srcLabel = (d) => (d.verificationStatus === 'confirmed' ? 'Fechas extraídas del documento y confirmadas' : d.verificationStatus === 'manual' ? 'Fechas introducidas manualmente' : 'Pendiente de verificación');
  function docsHTML() {
    const x = st();
    return `<p class="uf-lead">${x.isComplete ? 'Todos los documentos requeridos están completos.' : `Faltan o requieren atención ${plural(x.total - x.complete, 'documento requerido', 'documentos requeridos')}.`} Formatos: PDF, JPG, PNG o HEIC.</p>
      ${complementHTML(x.items.payment_complement)}
      <div class="uf-docs">${DOC_KEYS.filter((t) => t !== 'payment_complement').map((t) => docRow(t, x.items[t])).join('')}</div>`;
  }

  /* ----- Vigencias ----- */
  function vigHTML() {
    const x = st();
    return `<div class="list uf-vig">${DOC_KEYS.map((t) => { const it = x.items[t], v = it.v;
      const label = v.key === 'none' ? (it.required ? VALIDITY.missing : VALIDITY.notRequired) : v;
      return `<div class="row static"><span class="row-ic uf-dic t-${label.tone}">${icon[DOC_ICON[t]]}</span><span class="row-tx">
        <span class="row-l1"><b>${esc(docType(t).label)}</b></span>
        <span class="row-l2">${v.until ? `Vence: ${esc(dateShort(v.until))}` : v.key === 'attached' ? (it.doc && it.doc.noExpiry ? 'Sin vencimiento indicado' : 'Sin fecha de vencimiento') : v.key === 'pending' ? 'Fecha por verificar' : v.key === 'future' ? `Inicia: ${esc(dateShort(v.from))}` : 'Sin documento'}</span>
        <span class="row-l3">${chip(label)}${v.until && v.key !== 'future' ? ` <span class="un-days">${esc(daysText(v.days))}</span>` : ''}</span></span></div>`; }).join('')}</div>
      <p class="grp-note">Los días se cuentan en días calendario con la fecha de hoy en la zona horaria de PERCONSUR (${esc(un.tz())}): hoy es ${esc(dateLong(day()))}. «Próximo a vencer» = ${un.soonDays()} días o menos. Solo cuentan fechas confirmadas o capturadas a mano.</p>`;
  }

  /* ----- Historial ----- */
  function histHTML() {
    const evs = un.eventsOf(u.id);
    const oldDocs = un.docsOf(u.id).filter((d) => d.status === 'archived').sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0));
    return `${oldDocs.length ? `<section class="grp"><div class="grp-h"><h3>Versiones anteriores de documentos</h3><span class="count">${oldDocs.length}</span></div>
      <div class="list">${oldDocs.map((d) => `<div class="row static"><span class="row-ic uf-dic t-muted">${icon[DOC_ICON[d.docType]]}</span><span class="row-tx"><span class="row-l1"><b>${esc(docType(d.docType).label)}</b></span>
        <span class="row-l2">${esc(d.name)}${d.validFrom || d.validUntil ? ` · ${esc(dateShort(d.validFrom))} — ${esc(dateShort(d.validUntil))}` : ''}</span><span class="row-l3">Subido ${esc(un.fmtMs(d.uploadedAt))} · archivado ${esc(un.fmtMs(d.archivedAt))}</span></span>
        <button type="button" class="btn-ghost sm" data-view="${esc(d.id)}">Ver</button></div>`).join('')}</div></section>` : ''}
      <section class="grp"><div class="grp-h"><h3>Eventos del expediente</h3><span class="count">${evs.length}</span></div>
      ${evs.length ? `<ol class="uf-tl">${evs.map((e) => `<li><b>${esc(un.EVENT_LABELS[e.type] || e.type)}</b>${e.details ? `<span>${esc(e.details)}</span>` : ''}<small>${esc(un.fmtMs(e.at))}${e.by ? ' · ' + esc(e.by) : ''}</small></li>`).join('')}</ol>` : '<div class="empty"><p>Sin eventos todavía.</p></div>'}</section>`;
  }

  function draw() {
    u = un.resolveUnit(u.id) || u;
    hero(); tabs();
    bodyEl.innerHTML = sec === 'info' ? infoHTML() : sec === 'fotos' ? photosHTML() : sec === 'docs' ? docsHTML() : sec === 'vigencias' ? vigHTML() : histHTML();
    loadKeys(bodyEl);
  }
  draw();

  /* ----- Eventos ----- */
  on(root, 'click', '[data-back]', () => back('/unidades'));
  on(root, 'click', '[data-sec]', (e, b) => { sec = b.dataset.sec; history.replaceState(null, '', `#/unidades/${encodeURIComponent(u.id)}?sec=${sec}`); draw(); });
  on(root, 'click', '[data-edit]', async () => { const r = await unitForm(u); if (r) { u = r; draw(); } });
  on(root, 'click', '[data-photo-open]', async (e, b) => {
    const p = un.photoById(b.dataset.photoOpen); if (!p) return;
    const [orig, disp] = await Promise.all([un.blobOf(p.storageKey), un.blobOf(p.displayKey)]);
    openFileViewer({ title: `${un.PHOTO_TYPES[p.photoType]} · ${unitTitle(u)}`, blob: orig || disp, display: disp, name: p.name, kind: 'img' });
  });
  /* Fotografías: el selector se abre dentro del toque (requisito de Safari en iPhone) */
  on(root, 'click', '[data-cam]', (e, b) => { pending = { what: 'photo', type: b.dataset.cam, source: 'camera' }; inCam.value = ''; inCam.click(); });
  on(root, 'click', '[data-lib]', (e, b) => { pending = { what: 'photo', type: b.dataset.lib, source: 'library' }; inLib.value = ''; inLib.click(); });
  inCam.addEventListener('change', () => { const f = inCam.files && inCam.files[0]; if (f && pending) photoFlow(pending.type, f, 'camera'); });
  inLib.addEventListener('change', () => { const f = inLib.files && inLib.files[0]; if (f && pending) photoFlow(pending.type, f, 'library'); });
  on(root, 'click', '[data-pdate]', (e, b) => photoDateSheet(b.dataset.pdate));
  /* Documentos */
  on(root, 'click', '[data-up]', (e, b) => chooseDoc(b.dataset.up));
  on(root, 'click', '[data-view]', (e, b) => viewDoc(b.dataset.view));
  on(root, 'click', '[data-editdoc]', (e, b) => editDoc(b.dataset.editdoc));
  on(root, 'click', '[data-hist]', (e, b) => docHistory(b.dataset.hist));
  on(root, 'click', '[data-more]', (e, b) => docMenu(b.dataset.more));
  inDoc.addEventListener('change', () => { const f = inDoc.files && inDoc.files[0]; if (f && pending && pending.what === 'doc') docFlow(pending.type, f); });

  function photoFlow(type, file, source) {
    const body = document.createElement('div');
    body.className = 'uf-prev';
    body.innerHTML = '<p class="sheet-lead">Preparando la vista previa…</p>';
    let prep = null, url = null;
    const sh = openSheet({ title: type === 'front' ? 'Fotografía frontal' : 'Fotografía de las placas', body, full: true, onClose: () => { if (url) URL.revokeObjectURL(url); } });
    un.preparePhoto(file, source).then((p) => {
      prep = p;
      if (p.display) url = URL.createObjectURL(p.display);
      const known = p.captureDateSource !== 'unknown';
      body.innerHTML = `<figure class="uf-pv">${url ? `<img src="${url}" alt="Vista previa">` : `<span class="un-noph">${icon.image}<small>${esc(p.previewError)}</small></span>`}<figcaption>${esc(file.name || 'Fotografía')} · ${(file.size / 1048576).toFixed(1)} MB</figcaption></figure>
        <dl class="uf-dates">
          <div><dt>Fecha de captura</dt><dd>${known ? esc(un.fmtStamp(p.capturedAt, p.capturedOffset)) : 'Fecha de captura no disponible'}<small>${esc(un.CAPTURE_LABEL[p.captureDateSource])}${p.captureDateSource === 'exif' && !p.capturedOffset ? ' · hora de la cámara, sin zona horaria' : ''}</small></dd></div>
          <div><dt>Fecha de carga</dt><dd>Se registra al guardar</dd></div>
        </dl>
        ${known ? '' : `<label class="fld"><span class="fl">Fecha de captura (opcional)</span><input class="in" type="date" data-manual max="${un.today()}"><span class="fhint">La foto no trae la fecha en que se tomó (se pierde al editarla, compartirla o convertirla). Si la escribes, se mostrará como «Fecha proporcionada manualmente».</span></label>`}
        <div class="uf-pvacts">
          <button type="button" class="btn-primary block" data-save>${icon.check}<span>Guardar</span></button>
          <div class="sheet-acts">${source === 'camera' ? `<button type="button" class="btn-secondary" data-again>${icon.camera}<span>Volver a tomar</span></button>` : ''}<button type="button" class="btn-secondary" data-other>${icon.image}<span>Seleccionar otra</span></button></div>
          <button type="button" class="btn-ghost block" data-cancel>Cancelar</button>
        </div>`;
    }).catch((err) => { body.innerHTML = `<p class="sheet-lead warn-t">${esc(err.message)}</p><button type="button" class="btn-secondary block" data-other>${icon.image}<span>Seleccionar otra</span></button><button type="button" class="btn-ghost block" data-cancel>Cancelar</button>`; });
    body.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.cancel !== undefined) { sh.close(); return; }
      if (b.dataset.again !== undefined) { pending = { what: 'photo', type, source: 'camera' }; inCam.value = ''; inCam.click(); sh.close(); return; }
      if (b.dataset.other !== undefined) { pending = { what: 'photo', type, source: 'library' }; inLib.value = ''; inLib.click(); sh.close(); return; }
      if (b.dataset.save !== undefined && prep) {
        b.disabled = true;
        const md = body.querySelector('[data-manual]');
        try { await un.savePhoto(u.id, type, prep, { manualDate: md ? md.value : '' }); toast('Fotografía guardada'); sh.close(); sec = 'fotos'; draw(); }
        catch (err) { b.disabled = false; toast(err.message, { type: 'warn', ms: 4500 }); }
      }
    });
  }
  function photoDateSheet(photoId) {
    const p = un.photoById(photoId); if (!p) return;
    const sh = openSheet({ title: 'Fecha de captura', body: `<form class="op-form">
      <p class="sheet-lead">Esta fotografía no trae metadatos con la fecha en que se tomó. La fecha que escribas se mostrará como «Fecha proporcionada manualmente».</p>
      <label class="fld"><span class="fl">Fecha de captura</span><input class="in" type="date" name="d" value="${p.captureDateSource === 'manual' ? esc(String(p.capturedAt).slice(0, 10)) : ''}" max="${un.today()}"></label>
      <button type="submit" class="btn-primary block">Guardar fecha</button>${p.captureDateSource === 'manual' ? '<button type="button" class="btn-ghost block" data-clear>Quitar fecha</button>' : ''}</form>` });
    const form = sh.body.querySelector('form');
    form.addEventListener('submit', async (e) => { e.preventDefault(); try { await un.setPhotoDate(photoId, form.elements.d.value || null); sh.close(); draw(); } catch (err) { toast(err.message, { type: 'warn' }); } });
    const c = form.querySelector('[data-clear]'); if (c) c.addEventListener('click', async () => { await un.setPhotoDate(photoId, null); sh.close(); draw(); });
  }

  /* ----- Documentos: elegir, revisar, confirmar y guardar ----- */
  function chooseDoc(type) {
    const T = docType(type);
    const sh = openSheet({ title: T.label, body: `<p class="sheet-lead">${type === 'payment_complement' ? 'Al subirlo, PERCONSUR lee el periodo de cobertura y te pide confirmarlo.' : 'Formatos: PDF, JPG, PNG o HEIC.'}</p>
      <div class="uf-choose"><button type="button" class="btn-primary block" data-pick="file">${icon.upload}<span>Elegir archivo (PDF o imagen)</span></button>
      <button type="button" class="btn-secondary block" data-pick="cam">${icon.camera}<span>Tomar foto del documento</span></button></div>` });
    sh.body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pick]'); if (!b) return;
      pending = { what: 'doc', type };
      if (b.dataset.pick === 'cam') { inDoc.setAttribute('accept', 'image/*'); inDoc.setAttribute('capture', 'environment'); }
      else { inDoc.setAttribute('accept', un.DOC_ACCEPT); inDoc.removeAttribute('capture'); }
      inDoc.value = ''; inDoc.click(); sh.close();
    });
  }
  function fieldsHTML(type, d = {}) {
    const T = docType(type), F = (k, extra = '') => `<label class="fld" data-f="${k}"><span class="fl">${FIELD_LABELS[k]}${k === 'validUntil' && type === 'payment_complement' ? ' (fin de cobertura)' : k === 'validFrom' && type === 'payment_complement' ? ' (inicio de cobertura)' : ''}</span><input class="in" name="${k}" ${/Date|valid/.test(k) ? 'type="date"' : 'autocomplete="off"'} value="${esc(d[k] || '')}" ${extra}></label>`;
    const dates = T.fields.filter((k) => /Date|valid/.test(k)), texts = T.fields.filter((k) => !/Date|valid/.test(k));
    return `${texts.map((k) => F(k, k === 'policyNumber' || k === 'folio' ? 'autocapitalize="characters" spellcheck="false"' : '')).join('')}
      <div class="row2 uf-dates-in">${dates.map((k) => F(k)).join('')}</div>
      ${type !== 'payment_complement' && T.validity !== 'optional' ? `<label class="sw-row"><span class="sw-tx">El documento no indica vencimiento<small>Solo si el documento realmente no tiene fecha de fin</small></span><input type="checkbox" class="sw" name="noExpiry"${d.noExpiry ? ' checked' : ''}></label>` : ''}
      <label class="fld"><span class="fl">Observaciones</span><textarea class="in" name="notes" rows="2">${esc(d.notes || '')}</textarea></label>`;
  }
  function detectionHTML(det, method) {
    if (!det) return '';
    const how = method === 'ocr' ? 'leído con OCR de la imagen' : 'leído del texto del PDF';
    if (det.status === 'found') return `<div class="uf-det ok" data-det>
        <p class="uf-det-h">PERÍODO DETECTADO</p>
        <dl><div><dt>Inicio</dt><dd>${esc(dateShort(det.from))}</dd></div><div><dt>Fin</dt><dd>${esc(dateShort(det.to))}</dd></div></dl>
        <p class="uf-det-s">«${esc(det.evidence)}» · ${how}${det.check ? ` · ${esc(det.check)}` : ''}${det.confidence === 'media' ? ' · revísalo con cuidado' : ''}</p>
        ${det.extra && det.extra.issueDate ? `<p class="uf-det-s">Fecha de emisión/timbrado ${esc(dateShort(det.extra.issueDate))}: no es parte del periodo.</p>` : ''}
        <p class="uf-det-q">¿Son correctas estas fechas?</p>
        <div class="sheet-acts"><button type="button" class="btn-primary" data-confirm>${icon.check}<span>Confirmar</span></button><button type="button" class="btn-secondary" data-editdates>${icon.edit}<span>Editar fechas</span></button></div></div>`;
    if (det.status === 'ambiguous') return `<div class="uf-det warn" data-det><p class="uf-det-h">No fue posible determinar el período con certeza.</p>
        <p class="uf-det-s">El documento (${how}) tiene varios periodos. Elige el correcto o escribe las fechas.</p>
        <div class="uf-cands">${det.candidates.slice(0, 4).map((c, i) => `<button type="button" class="chip" data-cand="${i}">${esc(dateShort(c.from))} — ${esc(dateShort(c.to))}</button>`).join('')}</div></div>`;
    return `<div class="uf-det warn" data-det><p class="uf-det-h">No fue posible determinar el período con certeza.</p><p class="uf-det-s">No se encontró un periodo legible en el documento (${how}). Escribe las fechas o déjalas pendientes de verificación.</p></div>`;
  }
  async function docFlow(type, file) {
    const T = docType(type);
    const body = document.createElement('div');
    body.className = 'uf-dflow';
    body.innerHTML = `<div class="uf-dfile">${icon.file}<span><b>${esc(file.name || 'Documento')}</b><small>${(file.size / 1048576).toFixed(2)} MB · validando…</small></span></div><div data-prev class="uf-dprev"></div><p class="uf-stage" data-stage></p><div data-detbox></div>
      <form class="op-form" data-f hidden>${fieldsHTML(type)}<button type="submit" class="btn-primary block" data-savedoc>Guardar documento</button><button type="button" class="btn-ghost block" data-cancel>Cancelar</button></form>`;
    let urlP = null, insp = null, det = null, method = null, confirmed = false, extracted = { from: null, to: null };
    const sh = openSheet({ title: T.label, body, full: true, onClose: () => { if (urlP) URL.revokeObjectURL(urlP); } });
    const form = body.querySelector('[data-f]'), stage = body.querySelector('[data-stage]');
    try { insp = await un.inspectDoc(file); }
    catch (err) { body.querySelector('.uf-dfile small').textContent = 'No se puede usar este archivo'; stage.className = 'uf-stage warn-t'; stage.textContent = err.message + ' No se guardó nada.'; return; }
    body.querySelector('.uf-dfile small').textContent = `${(file.size / 1048576).toFixed(2)} MB · ${insp.kind === 'pdf' ? `PDF de ${plural(insp.pages, 'página', 'páginas')}` : 'Imagen'}${insp.note ? ' · ' + insp.note : ''}`;
    const prev = body.querySelector('[data-prev]');
    if (insp.display) { urlP = URL.createObjectURL(insp.display); prev.innerHTML = `<img src="${urlP}" alt="Vista previa del documento">`; }
    else if (insp.kind === 'pdf') { try { const { openPdf, renderPage } = await import('../../services/docText.js'); const c = await renderPage(await openPdf(file), 1, 1.2); c.className = 'uf-dcanvas'; prev.replaceChildren(c); } catch (e) { prev.innerHTML = '<p class="uf-stage">Vista previa no disponible; el archivo se guardará tal cual.</p>'; } }
    form.hidden = false;
    if (EXTRACT.has(type) && (insp.kind === 'pdf' || insp.display)) {
      stage.textContent = 'Leyendo el documento…';
      const r = await readText(file, { kind: insp.kind, onStage: (t) => { stage.textContent = t; } });
      method = r.method;
      if (r.error && !r.text) { stage.textContent = 'No se pudo leer el documento automáticamente. Escribe las fechas o déjalas pendientes de verificación.'; }
      else {
        det = detectPeriod(r.text);
        stage.textContent = '';
        if (type !== 'payment_complement' && det.status === 'none') det = null;
        body.querySelector('[data-detbox]').innerHTML = detectionHTML(det, method) + (det && det.extra && type === 'insurance' && (det.extra.insurer || det.extra.policyNumber) ? `<p class="uf-det-s">Sugerencias del documento: ${[det.extra.insurer && 'aseguradora «' + esc(det.extra.insurer) + '»', det.extra.policyNumber && 'póliza ' + esc(det.extra.policyNumber)].filter(Boolean).join(', ')}. <button type="button" class="link" data-usex>Usar sugerencias</button></p>` : '');
        if (type === 'payment_complement' && det.extra && det.extra.issueDate && form.elements.issueDate) form.elements.issueDate.value = det.extra.issueDate;
      }
    }
    const setDates = (from, to) => { if (form.elements.validFrom) form.elements.validFrom.value = from || ''; if (form.elements.validUntil) form.elements.validUntil.value = to || ''; };
    body.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.confirm !== undefined && det) { setDates(det.from, det.to); extracted = { from: det.from, to: det.to }; confirmed = true; body.querySelector('[data-det]').classList.add('done'); b.closest('.sheet-acts').innerHTML = `<p class="uf-det-ok">${icon.check}Fechas confirmadas</p>`; }
      if (b.dataset.editdates !== undefined && det) { setDates(det.from, det.to); confirmed = false; form.elements.validFrom.focus(); }
      if (b.dataset.cand !== undefined && det) { const c = det.candidates[+b.dataset.cand]; setDates(c.from, c.to); confirmed = false; body.querySelectorAll('[data-cand]').forEach((x) => x.classList.toggle('on', x === b)); }
      if (b.dataset.usex !== undefined && det) { if (det.extra.insurer && form.elements.insurer) form.elements.insurer.value = det.extra.insurer; if (det.extra.policyNumber && form.elements.policyNumber) form.elements.policyNumber.value = det.extra.policyNumber; }
      if (b.dataset.cancel !== undefined) sh.close();
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(form).entries());
      const fields = { issueDate: fd.issueDate || null, validFrom: fd.validFrom || null, validUntil: fd.validUntil || null, insurer: fd.insurer || '', policyNumber: fd.policyNumber || '', folio: fd.folio || '', notes: fd.notes || '', noExpiry: !!fd.noExpiry };
      if (fields.validFrom && fields.validUntil && fields.validFrom > fields.validUntil) { toast('El inicio de vigencia es posterior al fin.', { type: 'warn' }); return; }
      const hasDates = !!(fields.validFrom || fields.validUntil);
      const sameAsExtracted = confirmed && fields.validFrom === extracted.from && fields.validUntil === extracted.to;
      fields.verificationStatus = sameAsExtracted ? 'confirmed' : hasDates || fields.noExpiry ? 'manual' : 'pending';
      fields.dateSource = sameAsExtracted ? 'extracted' : hasDates || fields.noExpiry ? 'manual' : 'pending';
      if (det) fields.extraction = { method, status: det.status, from: det.from || null, to: det.to || null, evidence: det.evidence || '', check: det.check || '', confidence: det.confidence || '', at: Date.now() };
      const btn = form.querySelector('[data-savedoc]'); btn.disabled = true;
      try { await un.addDocument(u.id, type, file, insp, fields); toast(`${T.label} guardado${fields.verificationStatus === 'pending' && T.validity !== 'optional' ? ' · vigencia por verificar' : ''}`); sh.close(); sec = 'docs'; draw(); }
      catch (err) { btn.disabled = false; toast(err.message, { type: 'warn', ms: 4500 }); }
    });
  }
  function editDoc(docId) {
    const d = un.docById(docId); if (!d) return;
    const T = docType(d.docType);
    const sh = openSheet({ title: `${T.label}: fechas y datos`, full: true, body: `<form class="op-form">
      ${d.extraction && d.extraction.from ? `<p class="sheet-lead">Detectado en el documento: ${esc(dateShort(d.extraction.from))} — ${esc(dateShort(d.extraction.to))}${d.extraction.check ? ' · ' + esc(d.extraction.check) : ''}.</p>` : ''}
      <p class="sheet-lead">Fuente actual: ${esc(srcLabel(d))}.</p>
      ${fieldsHTML(d.docType, d)}
      ${d.extraction && d.extraction.from && d.verificationStatus === 'pending' ? `<button type="button" class="btn-secondary block" data-useext>${icon.check}<span>Confirmar el periodo detectado</span></button>` : ''}
      <button type="submit" class="btn-primary block">Guardar</button></form>` });
    const form = sh.body.querySelector('form');
    let useExt = false;
    const ue = form.querySelector('[data-useext]');
    if (ue) ue.addEventListener('click', () => { form.elements.validFrom.value = d.extraction.from; form.elements.validUntil.value = d.extraction.to; useExt = true; form.requestSubmit(); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(form).entries());
      const patch = { issueDate: fd.issueDate || null, validFrom: fd.validFrom || null, validUntil: fd.validUntil || null, notes: fd.notes || '', noExpiry: !!fd.noExpiry };
      for (const k of ['insurer', 'policyNumber', 'folio']) if (fd[k] !== undefined) patch[k] = fd[k];
      const datesChanged = (patch.validFrom || null) !== (d.validFrom || null) || (patch.validUntil || null) !== (d.validUntil || null) || patch.noExpiry !== !!d.noExpiry;
      const has = !!(patch.validFrom || patch.validUntil || patch.noExpiry);
      if (useExt && patch.validFrom === d.extraction.from && patch.validUntil === d.extraction.to) { patch.verificationStatus = 'confirmed'; patch.dateSource = 'extracted'; }
      else if (datesChanged || (d.verificationStatus === 'pending' && has)) { patch.verificationStatus = has ? 'manual' : 'pending'; patch.dateSource = has ? 'manual' : 'pending'; }
      try { await un.updateDocument(d.id, patch); toast('Cambios guardados'); sh.close(); draw(); } catch (err) { toast(err.message, { type: 'warn' }); }
    });
  }
  async function viewDoc(docId) {
    const d = un.docById(docId); if (!d) return;
    const [orig, disp] = await Promise.all([un.blobOf(d.storageKey), un.blobOf(d.displayKey)]);
    openFileViewer({ title: `${docType(d.docType).label} · ${unitTitle(u)}`, blob: orig, display: disp, name: d.name, kind: d.kind });
  }
  async function docMenu(docId) {
    const d = un.docById(docId); if (!d) return;
    const T = docType(d.docType);
    const acts = [{ label: 'Ver documento', value: 'view', icon: icon.eye }];
    if (!ro) acts.push({ label: 'Reemplazar', value: 'replace', icon: icon.upload, sub: 'La versión actual queda en el historial' }, { label: 'Editar fechas y datos', value: 'edit', icon: icon.calendar });
    acts.push({ label: 'Ver historial', value: 'hist', icon: icon.list });
    if (!ro) acts.push({ label: 'Archivar', value: 'archive', icon: icon.folder, sub: 'Deja de contar como vigente; se conserva en el historial' });
    const v = await actionSheet({ title: T.label, message: d.name, actions: acts });
    if (v === 'view') viewDoc(docId);
    else if (v === 'replace') chooseDoc(d.docType);
    else if (v === 'edit') editDoc(docId);
    else if (v === 'hist') docHistory(d.docType);
    else if (v === 'archive') { try { await un.archiveDocument(docId); toast('Documento archivado'); draw(); } catch (err) { toast(err.message, { type: 'warn' }); } }
  }
  function docHistory(type) {
    const T = docType(type), list = un.docsByType(u.id, type), today = day();
    const cs = type === 'payment_complement' ? complementState(list, today) : null;
    const sh = openSheet({ title: `Historial · ${T.label}`, full: list.length > 3, body: list.length ? `<div class="uf-hlist">${list.map((d) => { const v = validityOf(d, today, { soon: un.soonDays() });
      const isAct = cs && cs.active && cs.active.id === d.id, isUp = cs && cs.upcoming && cs.upcoming.id === d.id, over = cs && cs.overlaps.some((p) => p.includes(d.id));
      return `<article class="uf-hi${d.status === 'archived' ? ' arch' : ''}">
        <div><b>${esc(d.name)}</b>${d.status === 'archived' ? chip({ label: 'Archivado', tone: 'muted' }) : chip(v)}${isAct ? chip({ label: 'Cobertura vigente', tone: 'ok' }) : ''}${isUp ? chip({ label: 'Próxima cobertura', tone: 'info' }) : ''}${over ? chip({ label: 'Periodo encimado', tone: 'warn' }) : ''}</div>
        <small>${d.validFrom || d.validUntil ? `Periodo: ${esc(dateShort(d.validFrom))} — ${esc(dateShort(d.validUntil))} · ` : ''}${esc(srcLabel(d))}</small>
        <small>Subido: ${esc(un.fmtMs(d.uploadedAt))}${d.archivedAt ? ` · archivado ${esc(un.fmtMs(d.archivedAt))}` : ''}</small>
        <div class="uf-hacts"><button type="button" class="btn-ghost sm" data-hview="${esc(d.id)}">Ver</button>
          ${!ro && d.status !== 'archived' ? `<button type="button" class="btn-ghost sm" data-hedit="${esc(d.id)}">Editar fechas</button>` : ''}
          ${!ro && cs && cs.ambiguous && d.status !== 'archived' && v.key !== 'expired' && v.key !== 'future' && v.key !== 'pending' ? `<button type="button" class="btn-ghost sm" data-hsel="${esc(d.id)}">Usar como cobertura vigente</button>` : ''}
          ${!ro && d.status !== 'archived' ? `<button type="button" class="btn-ghost sm" data-harch="${esc(d.id)}">Archivar</button>` : ''}
          ${!ro && d.status === 'archived' ? `<button type="button" class="btn-ghost sm danger" data-hdel="${esc(d.id)}">Eliminar</button>` : ''}</div></article>`; }).join('')}</div>` : '<div class="empty"><p>Sin documentos.</p></div>' });
    sh.body.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      try {
        if (b.dataset.hview) viewDoc(b.dataset.hview);
        else if (b.dataset.hedit) { sh.close(); editDoc(b.dataset.hedit); }
        else if (b.dataset.hsel) { await un.selectComplement(b.dataset.hsel); toast('Cobertura vigente elegida'); sh.close(); draw(); }
        else if (b.dataset.harch) { await un.archiveDocument(b.dataset.harch); toast('Documento archivado'); sh.close(); draw(); }
        else if (b.dataset.hdel) { if (!(await confirmDestructive('¿Eliminar el documento archivado?', 'Se borra el archivo de este dispositivo. El historial conserva el registro del evento.'))) return; await un.deleteArchivedDocument(b.dataset.hdel); toast('Documento eliminado'); sh.close(); draw(); }
      } catch (err) { toast(err.message, { type: 'warn' }); }
    });
  }

  /* ----- Al día ----- */
  const offs = [un.onUnitsChange(() => { if (root.isConnected) draw(); }), un.onDayChange(() => draw())];
  window.addEventListener('pcs:sync', draw);
  s.cleanup = () => { offs.forEach((f) => f()); window.removeEventListener('pcs:sync', draw); urls.forEach((x) => URL.revokeObjectURL(x)); };
  return s;
}

