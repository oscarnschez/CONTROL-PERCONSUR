/*
 * Asistente de Nota de entrega – recepción (División Puerto).
 * Pasos: Información · Transporte · Contenedores · Entrega · Servicio · Evidencias · Revisión
 * Todo cambio se guarda automáticamente en el borrador.
 */
import { go, back } from '../../core/router.js';
import { el, getPath, setPath, on } from '../../core/dom.js';
import * as drafts from '../../services/drafts.js';
import * as media from '../../services/media.js';
import { pickUnit } from '../components/unitPicker.js';
import { unitById } from '../../services/units.js';
import * as cat from '../../services/catalogs.js';
import { getCompany } from '../../services/companies.js';
import { nextFolio, resetFolio } from '../../services/folios.js';
import { recents, pushRecent } from '../../services/settings.js';
import { compressPhoto, normImage } from '../../services/camera.js';
import { loadLib, tryLibs } from '../../services/libs.js';
import { catalogOwner } from '../../config/companies.js';
import { MAX_CONT, TIPOS, TRAFICOS, LADOS } from '../../config/reference.js';
import {
  esc, nowParts, nameCase, normEco, rfcClean, rfcHint, contNumClean, decClean, fmtPedimento, chkMsg, naviera,
  destinoMunicipio, mapsSearchURL, trackURL, money, fmtSize, fmtFecha, ecoLabel,
} from '../../domain/shared/format.js';
import {
  PUERTO_STEPS, blankCont, bruto, calcImporte, syncTrack, onTrackEdited, puertoIssues, filledConts, photoCount,
} from '../../domain/puerto/model.js';
import { fld, pickFld, setPickDisplay, selFld, swRow, group, setKeepCaret, enterAdvances, focusField } from '../components/fields.js';
import { openPicker } from '../components/picker.js';
import { actionSheet, openSheet, confirmDestructive } from '../components/sheet.js';
import { toast } from '../components/toast.js';
import { icon } from '../components/icons.js';
import { mountDocPreview } from '../components/docview.js';
import { ensureDocAssets, docHTML, generate, generationSummary } from '../flows.js';
import { wizardShell } from './wizardShell.js';
import { openExcelCodes } from './excelCodes.js';

export async function puertoWizard({ company, step }, q) {
  const id = drafts.draftId('puerto', company);
  const draft = await drafts.getDraft(id);
  if (!draft) { toast('No hay una nota en captura. Crea una nueva.', { type: 'info' }); go('/', { replace: true }); return null; }
  const s = draft.data;
  const co = getCompany(company);
  const owner = catalogOwner(company);
  const N = PUERTO_STEPS.length;
  const i = Math.min(Math.max((+step || 1) - 1, 0), N - 1);
  draft.step = Math.min(i, N - 2);
  drafts.touch(draft);
  await ensureDocAssets('puerto', s);

  const shell = wizardShell({
    kind: 'Nota de entrega', steps: PUERTO_STEPS, i,
    chip: `<span class="co-chip" style="--c1:${esc(co.colors.c1)}"><img src="${esc(co.logo)}" alt="" class="${co.mark ? 'mark' : 'wide'}">${co.mark ? `<b>${esc(co.short)}</b>` : ''}</span>`,
    nextLabel: i === N - 1 ? 'Generar PDF' : i === N - 2 ? 'Revisar' : 'Continuar',
    backLabel: i === 0 ? 'Salir' : 'Atrás',
  });
  const body = shell.body;
  const save = () => drafts.touch(draft);
  const toStep = (n, f) => go(`/puerto/${company}/${n + 1}${f ? '?f=' + encodeURIComponent(f) : ''}`);

  /* ===== Render del paso ===== */
  const R = [stepInfo, stepTransporte, stepContenedores, stepEntrega, stepServicio, stepEvidencias, stepRevision];
  function draw() { body.innerHTML = R[i](); afterDraw(); }

  function stepInfo() {
    return group('Documento', `
      <div class="folio-row"><div><span class="fl">Folio automático</span><b class="folio" data-folio>${esc(s.folio)}</b></div>
        <button type="button" class="btn-ghost sm" data-act="resetFolio">${icon.refresh}<span>Reiniciar a 001</span></button></div>
      <div class="row2">
        ${fld({ label: 'Fecha', path: 'fecha', value: s.fecha, type: 'date' })}
        <div class="fld"><span class="fl">Hora de generación</span><div class="in-w"><input class="in" type="time" value="${esc(s.hora)}" data-b="hora" readonly tabindex="-1"><button type="button" class="in-act" data-act="hora" aria-label="Actualizar a la hora actual">${icon.refresh}</button></div></div>
      </div>`)
      + group('Aduana', `
      ${fld({ label: 'Carta porte', path: 'cartaPorte', value: s.cartaPorte, t: 'upper', cap: 'characters' })}
      ${fld({ label: 'Número de pedimento', path: 'pedimento', value: s.pedimento, t: 'ped', mode: 'numeric', ph: '26 16 1641 6005426' })}`);
  }

  function stepTransporte() {
    const v = (s.unitId && unitById(s.unitId)) || cat.vehicleByEco(owner, s.eco);
    return group('Unidad y operador', `
      ${pickFld({ label: 'Nombre del operador', path: 'operador', value: s.operador })}
      <div class="row2">
        ${pickFld({ label: 'No. económico', path: 'eco', value: s.eco ? ecoLabel(s.eco) : '', ph: 'Elegir' , sub: unitSub(v) })}
        ${fld({ label: 'Placas de la unidad', path: 'placasU', value: s.placasU, t: 'upper', cap: 'characters' })}
      </div>
      ${pickFld({ label: 'Placas del remolque', path: 'placasR', value: s.placasR, sub: trailerDesc(s.placasR) })}
      <p class="grp-note">La unidad se elige del catálogo único PERCONSUR — Unidades y sus placas se llenan solas. Si las cambias aquí, solo cambian en este documento; las placas de la unidad se actualizan en su expediente.</p>`)
      + group('Rastreo GPS', `
      ${swRow({ label: 'Mostrar botón de rastreo GPS en la nota', path: 'showTrack', checked: s.showTrack !== false })}
      <div data-show="track" ${s.showTrack === false ? 'hidden' : ''}>
        ${fld({ label: 'Link de rastreo (GPS)', path: 'track', value: s.track, type: 'url', mode: 'url', cap: 'none', ph: 'tinyurl.com/', hintId: 'track', after: '' })}
        <button type="button" class="btn-ghost sm" data-act="openTrack">${icon.pin}<span>Abrir link de rastreo</span></button>
      </div>`, { note: 'El link se arma con el número del primer contenedor mientras no lo modifiques.' });
  }

  function contCard(c, k) {
    const [cls, msg] = chkMsg(c.num), b = bruto(c);
    return `<article class="card cont" data-ci="${k}">
      <header class="card-h"><h4>Contenedor ${k + 1}</h4>${s.conts.length > 1 ? `<button type="button" class="link-danger" data-act="rmCont" data-i="${k}">Quitar</button>` : ''}</header>
      ${fld({ label: 'Número de contenedor', path: `conts.${k}.num`, value: c.num, t: 'cont', cap: 'characters', max: 11, ph: 'MSCU1234565', cls: 'mono-in' })}
      <p class="chk ${cls}" data-chk="${k}">${esc(msg)}</p>
      ${selFld({ label: 'Tipo', path: `conts.${k}.tipo`, value: c.tipo, options: TIPOS.map(([v, d]) => [v, `${v} (${d})`]) })}
      <div class="row2">
        ${fld({ label: 'Sello', path: `conts.${k}.sello`, value: c.sello, t: 'upper', cap: 'characters' })}
        ${fld({ label: 'Bultos / pallets', path: `conts.${k}.bultos`, value: c.bultos, t: 'int6', mode: 'numeric', ph: '0' })}
      </div>
      ${fld({ label: 'Mercancía transportada', path: `conts.${k}.merc`, value: c.merc })}
      <div class="row3">
        ${fld({ label: 'Peso mercancía (kg)', path: `conts.${k}.peso`, value: c.peso, t: 'dec', mode: 'decimal', ph: '0' })}
        ${fld({ label: 'Tara (kg)', path: `conts.${k}.tara`, value: c.tara, t: 'dec', mode: 'decimal', ph: '0' })}
        <div class="fld"><span class="fl">Peso bruto (kg)</span><output class="in out ${b == null ? 'empty' : ''}" data-bruto="${k}">${b == null ? 'Automático' : b.toLocaleString('es-MX', { maximumFractionDigits: 2 })}</output></div>
      </div>
    </article>`;
  }
  function stepContenedores() {
    const nav = naviera(s.bl);
    const full = s.conts.length >= MAX_CONT;
    return group('Embarque', `
      ${fld({ label: 'BL (Bill of Lading)', path: 'bl', value: s.bl, t: 'upper', cap: 'characters', max: 30, hintId: 'bl', hint: s.bl ? (nav ? 'Línea naviera detectada: ' + esc(nav) : 'No se reconoce la línea naviera de este BL.') : '' })}
      ${selFld({ label: 'Modo de tráfico', path: 'trafico', value: s.trafico, options: TRAFICOS })}
      <div class="row2">
        ${fld({ label: 'Fecha de la cita', path: 'citaFecha', value: s.citaFecha, type: 'date' })}
        ${fld({ label: 'Hora de la cita', path: 'citaHora', value: s.citaHora, type: 'time' })}
      </div>
      ${selFld({ label: 'Terminal portuaria', path: 'terminal', value: s.terminal, options: [['', 'Sin indicar'], ...cat.list('terminals').map((t) => [t.name, t.name]), ...(s.terminal && !cat.list('terminals').some((t) => t.name === s.terminal) ? [[s.terminal, s.terminal]] : [])] })}
      <p class="grp-note">La cita y la terminal se usan en el resumen para WhatsApp.</p>`)
      + `<div class="grp-h solo"><h3>Contenedores</h3><span class="count">${s.conts.length} de ${MAX_CONT}</span></div>`
      + s.conts.map(contCard).join('')
      + (full ? `<p class="grp-note center">Máximo ${MAX_CONT} contenedores por nota de entrega.</p>` : `<button type="button" class="add-btn" data-act="addCont">${icon.plus}<span>Añadir contenedor</span></button>`);
  }

  function stepEntrega() {
    const mun = destinoMunicipio(s.destDir);
    return group('Lugar de entrega', `
      ${pickFld({ label: 'Nombre (cliente o almacén)', path: 'destNombre', value: s.destNombre })}
      ${fld({ label: 'RFC', path: 'destRFC', value: s.destRFC, t: 'rfc', cap: 'characters', max: 13, ph: '12 o 13 caracteres', hintId: 'destRFC', hint: esc(rfcHint(s.destRFC) || '') })}
      ${fld({ label: 'Dirección de entrega', path: 'destDir', value: s.destDir, textarea: true, rows: 3, ph: 'Calle, número, colonia, municipio, estado, C.P.', hintId: 'destDir', hint: mun ? 'Destino para Excel: ' + esc(mun) : '' })}
      <button type="button" class="btn-ghost sm" data-act="openMaps" ${s.destDir ? '' : 'disabled'}>${icon.pin}<span>Abrir ubicación</span></button>
      ${fld({ label: 'Contacto o teléfono (opcional)', path: 'destContacto', value: s.destContacto })}`,
    { note: 'La dirección genera el código QR de ubicación en la nota.' });
  }

  function tarCard(c, k) {
    const r = calcImporte(c);
    return `<article class="card tar" data-ti="${k}">
      <header class="card-h"><h4 data-tarh="${k}">Tarifa e importe, contenedor ${k + 1}${c.num ? ': ' + esc(c.num) : ''}</h4></header>
      <div class="row2">
        ${fld({ label: 'Tarifa sin impuestos ($)', path: `conts.${k}.tarifa`, value: c.tarifa, t: 'dec', mode: 'decimal', ph: '0.00' })}
        <div class="fld"><span class="fl">Importe ($)</span><output class="in out ${r ? '' : 'empty'}" data-imp="${k}">${r ? money(r.importe) : 'Automático'}</output></div>
      </div>
      ${swRow({ label: 'IVA 16 %', path: `conts.${k}.iva`, checked: !!c.iva })}
      ${swRow({ label: 'ISR 4 % (retención)', path: `conts.${k}.isr`, checked: !!c.isr })}
      ${swRow({ label: 'Se cobra sobrepeso', path: `conts.${k}.sobre`, checked: !!c.sobre })}
      <div data-show="sobre${k}" ${c.sobre ? '' : 'hidden'}>${fld({ label: 'Cantidad a cobrar por sobrepeso ($)', path: `conts.${k}.sobreMonto`, value: c.sobreMonto, t: 'dec', mode: 'decimal', ph: '0.00' })}</div>
      <p class="fhint calc" data-impd="${k}">${impDetail(c)}</p>
    </article>`;
  }
  function impDetail(c) {
    const r = calcImporte(c);
    return r ? `${money(r.base)}${r.extra ? ' + Sobrepeso ' + money(r.extra) : ''}${c.iva ? ' + IVA ' + money(r.iva) : ''}${c.isr ? ' − ISR ' + money(r.isr) : ''} = ${money(r.importe)}` : '';
  }
  function stepServicio() {
    return group('Facturación', `
      <div class="row2">
        ${fld({ label: 'RFC emisor', path: 'rfcE', value: s.rfcE, t: 'rfc', cap: 'characters', max: 13, ph: '12 o 13 caracteres', hintId: 'rfcE', hint: esc(rfcHint(s.rfcE) || '') })}
        ${fld({ label: 'RFC receptor', path: 'rfcR', value: s.rfcR, t: 'rfc', cap: 'characters', max: 13, ph: '12 o 13 caracteres', hintId: 'rfcR', hint: esc(rfcHint(s.rfcR) || '') })}
      </div>`, { note: 'Los RFC y las tarifas no aparecen en la nota ni en el PDF: solo se agregan al código para Excel.' })
      + group('Servicio', swRow({ label: 'El transporte lleva custodia', path: 'custodia', checked: !!s.custodia, sub: 'Aparece como etiqueta en la nota' }))
      + s.conts.map(tarCard).join('');
  }

  function photosHTML(c, k) {
    const next = LADOS.find(([lk]) => !c.fotos[lk]);
    return `<article class="card ev" data-ei="${k}">
      <header class="card-h"><h4>Contenedor ${k + 1}${c.num ? ': ' + esc(c.num) : ''}</h4><span class="count">${Object.keys(c.fotos).length} de 4</span></header>
      ${next ? `<label class="btn-primary block cam-btn">${icon.camera}<span>Tomar foto: ${esc(next[1])}</span>
          <input type="file" accept="image/*" capture="environment" hidden data-photo="${k}" data-side="${next[0]}"></label>` : ''}
      <div class="ph-grid">${LADOS.map(([lk, l]) => {
        const ph = c.fotos[lk], u = ph ? media.urlFor(ph.id) : '';
        return ph
          ? `<button type="button" class="ph has" data-ph="${k}" data-side="${lk}" style="background-image:url('${u}')"><span>${esc(l)}</span></button>`
          : `<label class="ph"><span class="ph-ic">${icon.camera}</span><span>${esc(l)}</span><input type="file" accept="image/*" capture="environment" hidden data-photo="${k}" data-side="${lk}"></label>`;
      }).join('')}</div>
      <label class="btn-ghost sm">${icon.image}<span>Elegir de Fotos</span><input type="file" accept="image/*" multiple hidden data-lib="${k}"></label>
    </article>`;
  }
  function attHTML() {
    const a = s.attachments || [];
    const pg = (x) => (Number.isFinite(+x.pages) && +x.pages > 0 ? Math.floor(+x.pages) : 0);
    const pages = a.reduce((t, x) => t + (x.kind === 'pdf' ? pg(x) : 1), 0);
    return `<ol class="att-list">${a.map((x, k) => `<li class="att">
        <span class="att-ic ${esc(x.kind)}" ${x.kind === 'img' ? `style="background-image:url('${esc(media.urlFor(x.id))}')"` : ''}>${x.kind === 'pdf' ? 'PDF' : ''}</span>
        <span class="att-tx"><b>${esc(x.name)}</b><small>${x.kind === 'pdf' ? (pg(x) ? pg(x) + (pg(x) > 1 ? ' páginas' : ' página') : 'PDF') : 'Imagen, 1 página'} | ${esc(fmtSize(x.size))}</small></span>
        <span class="att-b"><button type="button" class="icon-btn" data-att="up" data-i="${k}" aria-label="Subir" ${k === 0 ? 'disabled' : ''}>${icon.up}</button><button type="button" class="icon-btn" data-att="dn" data-i="${k}" aria-label="Bajar" ${k === a.length - 1 ? 'disabled' : ''}>${icon.down}</button><button type="button" class="icon-btn danger" data-att="rm" data-i="${k}" aria-label="Quitar">${icon.trash}</button></span>
      </li>`).join('')}</ol>
      <label class="add-btn">${icon.paperclip}<span>Agregar archivos</span><input type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" multiple hidden data-attfile></label>
      <p class="grp-note">${a.length ? `Se agregarán ${a.length} archivo${a.length > 1 ? 's' : ''}${pages ? ` (${pages} página${pages > 1 ? 's' : ''})` : ''} al final del PDF, en este orden.` : 'PDF, JPG o PNG desde Archivos o Fotos. Se agregan al final del PDF, después de la nota, en el orden de la lista.'}</p>`;
  }
  function stepEvidencias() {
    return group('Observaciones', `
      ${fld({ label: 'Daños', path: 'obsDan', value: s.obsDan, textarea: true, ph: 'Golpes, abolladuras, sellos violados…' })}
      ${fld({ label: 'Faltantes', path: 'obsFal', value: s.obsFal, textarea: true, ph: 'Bultos, pallets o piezas que faltan…' })}
      ${fld({ label: 'Notas', path: 'obs', value: s.obs, textarea: true, ph: 'Cualquier otra observación' })}`)
      + `<div class="grp-h solo"><h3>Evidencia fotográfica</h3></div><p class="grp-note">Una foto de cada lado del contenedor tal como se recibe en la terminal portuaria. Se agregan a la nota como anexo.</p>`
      + `<div data-photos>${s.conts.map(photosHTML).join('')}</div>`
      + `<div class="grp-h solo"><h3>Archivos para combinar al PDF</h3></div><div class="grp-b" data-atts>${attHTML()}</div>`;
  }

  function stepRevision() {
    const issues = puertoIssues(s);
    const conts = filledConts(s);
    const rows = [
      ['Folio', `<b class="folio sm">${esc(s.folio)}</b>`],
      ['Empresa', esc(co.legal)],
      ['Fecha y hora', `${esc(fmtFecha(s.fecha))} ${esc(s.hora)}`],
      ['Operador', esc(s.operador) || '<i>Sin indicar</i>'],
      ['Unidad', s.eco ? `${esc(ecoLabel(s.eco))}${s.placasU ? ' | ' + esc(s.placasU) : ''}` : '<i>Sin indicar</i>'],
      ['Remolque', esc(s.placasR) || '<i>Sin indicar</i>'],
      ['Contenedores', conts.length ? conts.map((c) => `${esc(c.num || 'Sin número')} | ${esc(c.tipo)}${c.sello ? ' | Sello ' + esc(c.sello) : ''}`).join('<br>') : '<i>Sin capturar</i>'],
      ['Entregar a', esc(s.destNombre) || '<i>Sin indicar</i>'],
      ['Destino', esc(destinoMunicipio(s.destDir)) || '<i>Sin dirección</i>'],
      ['Observaciones', [s.obsDan && 'Daños', s.obsFal && 'Faltantes', s.obs && 'Notas'].filter(Boolean).join(', ') || 'Ninguna'],
      ['Evidencias', `${photoCount(s)} foto${photoCount(s) === 1 ? '' : 's'} | ${(s.attachments || []).length} archivo${(s.attachments || []).length === 1 ? '' : 's'}`],
    ];
    return `${issues.length ? `<section class="issues"><div class="issues-h">${icon.alert}<b>Datos pendientes (${issues.length})</b></div>
        <p>Puedes generar de todos modos: la nota deja el espacio en blanco para llenarse a mano.</p>
        ${issues.map((w, k) => `<button type="button" class="issue" data-issue="${k}"><span>${esc(w.msg)}</span><span class="chev">${icon.chev}</span></button>`).join('')}</section>`
      : `<section class="ok-box">${icon.check}<span>Toda la información obligatoria está completa.</span></section>`}
      ${group('Resumen', `<dl class="sumlist">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`)}
      <div class="grp-h solo"><h3>Vista previa del documento</h3><button type="button" class="btn-ghost sm" data-act="excel">${icon.qr}<span>Código para Excel</span></button></div>
      <div class="dv-host" data-preview></div>
      <p class="grp-note center">Tamaño carta. El PDF conserva este formato en cualquier dispositivo.</p>`;
  }

  let dv = null;
  function afterDraw() {
    enterAdvances(body);
    if (i === N - 1) dv = mountDocPreview(body.querySelector('[data-preview]'), docHTML('puerto', s, company));
    if (q && q.get('f')) setTimeout(() => focusField(body, q.get('f')), 250);
  }

  /* ===== Edición de campos ===== */
  const T = {
    upper: (v) => v.toUpperCase(), rfc: rfcClean, cont: contNumClean, dec: decClean, int6: (v) => v.replace(/\D/g, '').slice(0, 6), ped: fmtPedimento,
  };
  function onInput(e) {
    const inp = e.target.closest('[data-b]');
    if (!inp || inp.readOnly) return;
    const path = inp.dataset.b;
    let v = inp.type === 'checkbox' ? inp.checked : inp.value;
    if (inp.type !== 'checkbox' && T[inp.dataset.t]) { v = T[inp.dataset.t](v); setKeepCaret(inp, v); }
    setPath(s, path, v);
    derived(path, inp, e.type);
    save();
  }
  function derived(path, inp, type) {
    let m;
    if (path === 'fecha' && type === 'change' && s.fecha) {
      nextFolio(company, s.fecha).then((f) => { s.folio = f; const x = body.querySelector('[data-folio]'); if (x) x.textContent = f; save(); toast('Folio asignado para la nueva fecha: ' + f, { type: 'info' }); });
    }
    if ((m = path.match(/^conts\.(\d+)\.num$/))) {
      const k = +m[1], [cls, msg] = chkMsg(s.conts[k].num), c = body.querySelector(`[data-chk="${k}"]`);
      if (c) { c.className = 'chk ' + cls; c.textContent = msg; }
      syncTrack(s);
    }
    if ((m = path.match(/^conts\.(\d+)\.(peso|tara)$/))) {
      const k = +m[1], b = bruto(s.conts[k]), o = body.querySelector(`[data-bruto="${k}"]`);
      if (o) { o.textContent = b == null ? 'Automático' : b.toLocaleString('es-MX', { maximumFractionDigits: 2 }); o.classList.toggle('empty', b == null); }
    }
    if ((m = path.match(/^conts\.(\d+)\.(tarifa|iva|isr|sobre|sobreMonto)$/))) {
      const k = +m[1], c = s.conts[k], r = calcImporte(c), o = body.querySelector(`[data-imp="${k}"]`);
      if (o) { o.textContent = r ? money(r.importe) : 'Automático'; o.classList.toggle('empty', !r); }
      const d = body.querySelector(`[data-impd="${k}"]`); if (d) d.textContent = impDetail(c);
      if (m[2] === 'sobre') { const w = body.querySelector(`[data-show="sobre${k}"]`); if (w) { w.hidden = !c.sobre; if (c.sobre) w.querySelector('input').focus(); } }
    }
    if (path === 'bl') { const h = body.querySelector('[data-hint="bl"]'), n = naviera(s.bl); if (h) h.textContent = s.bl ? (n ? 'Línea naviera detectada: ' + n : 'No se reconoce la línea naviera de este BL.') : ''; }
    if (path === 'destDir') {
      const h = body.querySelector('[data-hint="destDir"]'), mun = destinoMunicipio(s.destDir); if (h) h.textContent = mun ? 'Destino para Excel: ' + mun : '';
      const b = body.querySelector('[data-act="openMaps"]'); if (b) b.disabled = !s.destDir;
    }
    if (/^(destRFC|rfcE|rfcR)$/.test(path)) { const h = body.querySelector(`[data-hint="${path}"]`); if (h) h.textContent = rfcHint(s[path]) || ''; }
    if (path === 'track') { onTrackEdited(s); if (type === 'change') { syncTrack(s); inp.value = s.track; } }
    if (path === 'showTrack') { const w = body.querySelector('[data-show="track"]'); if (w) w.hidden = !s.showTrack; }
    if (path === 'placasU' && type === 'change') cat.rememberPlacas(owner, s.eco, s.placasU);
  }
  body.addEventListener('input', onInput);
  body.addEventListener('change', onInput);

  /* Marca y modelo (o descripción) de la unidad del catálogo, debajo del número económico */
  function unitSub(v) { return v ? [v.brand, v.model].filter(Boolean).join(' ') || v.desc || '' : ''; }
  /* ===== Selectores con catálogo ===== */
  function trailerDesc(p) { const t = cat.list('trailers', owner).find((x) => x.placas === p); return t ? [cat.trailerTypeLabel(t.type), t.desc].filter(Boolean).join(' | ') : ''; }
  on(body, 'click', '[data-pick]', async (e, b) => {
    const path = b.dataset.pick;
    if (path === 'operador') {
      const r = await openPicker({ title: 'Operador', current: s.operador, items: cat.list('operators', owner).map((x) => ({ value: x.name, label: x.name })), recents: recents('operador:' + company), canSave: true, transform: (v) => v });
      if (!r) return;
      s.operador = nameCase(r.value);
      if (r.save) { await cat.save('operators', { company: owner, name: s.operador }); toast('Operador guardado en el catálogo'); }
      setPickDisplay(body, 'operador', s.operador);
    } else if (path === 'eco') {
      /* Catálogo único PERCONSUR — Unidades: se guarda la relación (unitId) y se completan las placas */
      const r = await pickUnit({ title: 'Número económico', currentId: s.unitId || '' });
      if (!r) return;
      const v = r.unit;
      s.eco = r.eco; s.unitId = v ? v.id : null;
      if (v && v.placas) { s.placasU = v.placas; const pi = body.querySelector('[data-b="placasU"]'); if (pi) pi.value = s.placasU; }
      setPickDisplay(body, 'eco', ecoLabel(s.eco), 'Elegir', unitSub(v));
    } else if (path === 'placasR') {
      const r = await openPicker({ title: 'Placas del remolque', current: s.placasR, autocap: 'characters', transform: (v) => v.toUpperCase(),
        items: cat.trailerItems(owner), scope: cat.trailerScope('puerto'), recents: recents('remolque:' + company), canSave: true, saveLabel: 'Guardar en catálogo como chasis portacontenedor' });
      if (!r) return;
      s.placasR = r.value.toUpperCase();
      if (r.save) { await cat.save('trailers', { company: owner, placas: s.placasR, desc: '', type: 'chasis' }); toast('Remolque guardado como chasis portacontenedor'); }
      setPickDisplay(body, 'placasR', s.placasR, undefined, trailerDesc(s.placasR));
    } else if (path === 'destNombre') {
      const places = cat.list('places');
      const r = await openPicker({ title: 'Lugar de entrega', current: s.destNombre, autocap: 'characters', transform: (v) => v.toUpperCase(),
        items: places.map((x) => ({ value: x.name, label: x.name, sub: x.address, data: x })), recents: recents('destino'), canSave: true, saveLabel: 'Usar y guardar en Destinos' });
      if (!r) return;
      s.destNombre = r.value.toUpperCase();
      const p = r.item && r.item.data;
      if (p) {
        if (p.rfc) s.destRFC = p.rfc; if (p.address) s.destDir = p.address; if (p.contact) s.destContacto = p.contact;
        ['destRFC', 'destDir', 'destContacto'].forEach((k) => { const x = body.querySelector(`[data-b="${k}"]`); if (x) x.value = s[k]; });
        derived('destDir'); derived('destRFC');
      }
      if (r.save) { await cat.save('places', { name: s.destNombre, rfc: s.destRFC, address: s.destDir, contact: s.destContacto }); toast('Destino guardado en el catálogo'); }
      setPickDisplay(body, 'destNombre', s.destNombre);
    }
    save();
  });

  /* ===== Acciones ===== */
  on(body, 'click', '[data-act]', async (e, b) => {
    const a = b.dataset.act;
    if (a === 'hora') { s.hora = nowParts().hora; body.querySelector('[data-b="hora"]').value = s.hora; save(); toast('Hora actualizada a las ' + s.hora); }
    if (a === 'resetFolio') {
      const ok = await actionSheet({ title: 'Reiniciar consecutivo del día', message: `El folio de esta nota pasará a terminar en 001 para el ${fmtFecha(s.fecha)}. Úsalo solo si el consecutivo se desfasó.`, actions: [{ label: 'Reiniciar a 001', value: true, style: 'destructive' }] });
      if (!ok) return;
      s.folio = await resetFolio(company, s.fecha); body.querySelector('[data-folio]').textContent = s.folio; save(); toast('Folio reiniciado: ' + s.folio);
    }
    if (a === 'openTrack') { const u = trackURL(s.track); if (u) window.open(u, '_blank', 'noopener'); else toast('Escribe un link de rastreo completo.', { type: 'warn' }); }
    if (a === 'openMaps') { const u = mapsSearchURL(s.destDir); if (u) window.open(u, '_blank', 'noopener'); }
    if (a === 'addCont') {
      if (s.conts.length >= MAX_CONT) return;
      s.conts.push(blankCont(s.conts[s.conts.length - 1])); save(); draw();
      const ins = body.querySelectorAll('[data-b$=".num"]'); const last = ins[ins.length - 1];
      if (last) { last.focus(); last.scrollIntoView({ block: 'center' }); }
    }
    if (a === 'rmCont') {
      const k = +b.dataset.i, c = s.conts[k];
      if (!(await confirmDestructive(`¿Quitar el contenedor ${k + 1}?`, `${c.num || 'Sin número'}${Object.keys(c.fotos).length ? ` y sus ${Object.keys(c.fotos).length} fotos` : ''} se eliminarán de la nota.`, 'Quitar contenedor'))) return;
      for (const ph of Object.values(c.fotos || {})) await media.remove(ph.id);
      s.conts.splice(k, 1); syncTrack(s); save(); draw(); toast('Contenedor quitado', { type: 'info' });
    }
    if (a === 'excel') openExcelCodes(s);
  });
  on(body, 'click', '[data-issue]', (e, b) => { const w = puertoIssues(s)[+b.dataset.issue]; if (w) toStep(w.step, w.field); });

  /* ===== Fotografías ===== */
  async function putPhoto(k, side, file) {
    const c = s.conts[k];
    const blob = await compressPhoto(file);
    const mid = await media.saveBlob(blob, { owner: 'draft:' + draft.id, kind: 'photo', name: `${c.num || 'contenedor' + (k + 1)}-${side}.jpg` });
    await media.ensureURL(mid);
    const old = c.fotos[side];
    c.fotos[side] = { id: mid, t: file.lastModified || Date.now() };
    await drafts.saveNow(draft);
    if (old) await media.remove(old.id);
  }
  function redrawPhotos() { const box = body.querySelector('[data-photos]'); if (box) box.innerHTML = s.conts.map(photosHTML).join(''); }
  body.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.matches('[data-photo]')) {
      const f = t.files && t.files[0]; t.value = ''; if (!f) return;
      const card = t.closest('.card'); card && card.classList.add('busy');
      try { await putPhoto(+t.dataset.photo, t.dataset.side, f); toast('Foto agregada'); } catch (err) { toast('No se pudo leer esa imagen. Prueba con otra foto (JPG o PNG).', { type: 'warn', ms: 4000 }); }
      redrawPhotos();
    } else if (t.matches('[data-lib]')) {
      const k = +t.dataset.lib, files = [...(t.files || [])]; t.value = ''; if (!files.length) return;
      const empty = LADOS.map(([lk]) => lk).filter((lk) => !s.conts[k].fotos[lk]);
      if (!empty.length) { toast('Ya están las 4 fotos. Toca una foto para reemplazarla.', { type: 'info', ms: 3500 }); return; }
      const card = t.closest('.card'); card && card.classList.add('busy');
      let n = 0;
      for (const f of files.slice(0, empty.length)) { try { await putPhoto(k, empty[n], f); n++; } catch (err) { toast(`No se pudo leer «${f.name}».`, { type: 'warn' }); } }
      if (files.length > empty.length) toast(`Solo había ${empty.length} lado${empty.length > 1 ? 's' : ''} libre${empty.length > 1 ? 's' : ''}; se agregaron ${n} fotos.`, { type: 'info', ms: 3500 });
      else toast(n === 1 ? 'Foto agregada' : `${n} fotos agregadas`);
      redrawPhotos();
    } else if (t.matches('[data-attfile]')) {
      const files = [...(t.files || [])]; t.value = ''; if (files.length) await addAttachments(files);
    }
  });
  on(body, 'click', '[data-ph]', (e, b) => photoSheet(+b.dataset.ph, b.dataset.side));
  function photoSheet(k, side) {
    const c = s.conts[k], ph = c.fotos[side], lbl = LADOS.find(([x]) => x === side)[1];
    const others = LADOS.filter(([x]) => x !== side);
    const sh = openSheet({ title: `${lbl} | Contenedor ${k + 1}`, body: `
      <img class="ph-big" src="${media.urlFor(ph.id)}" alt="Foto ${esc(lbl)}">
      <div class="sheet-acts">
        <label class="btn-secondary">${icon.camera}<span>Tomar otra foto</span><input type="file" accept="image/*" capture="environment" hidden data-rep></label>
        <label class="btn-secondary">${icon.image}<span>Elegir de Fotos</span><input type="file" accept="image/*" hidden data-rep></label>
      </div>
      <h3 class="pk-h">Mover a otro lado</h3>
      <div class="chips">${others.map(([x, l]) => `<button type="button" class="chip" data-mv="${x}">${icon.swap}${esc(l)}${c.fotos[x] ? ' (intercambiar)' : ''}</button>`).join('')}</div>
      <button type="button" class="btn-danger block" data-del>${icon.trash}<span>Eliminar foto</span></button>` });
    sh.body.querySelectorAll('[data-rep]').forEach((inp) => inp.addEventListener('change', async () => {
      const f = inp.files && inp.files[0]; if (!f) return; sh.close();
      try { await putPhoto(k, side, f); toast('Foto reemplazada'); } catch (err) { toast('No se pudo leer esa imagen.', { type: 'warn' }); }
      redrawPhotos();
    }));
    sh.body.querySelectorAll('[data-mv]').forEach((bb) => bb.addEventListener('click', async () => {
      const to = bb.dataset.mv; const tmp = c.fotos[to]; c.fotos[to] = c.fotos[side]; if (tmp) c.fotos[side] = tmp; else delete c.fotos[side];
      await drafts.saveNow(draft); sh.close(); redrawPhotos(); toast('Foto movida');
    }));
    sh.body.querySelector('[data-del]').addEventListener('click', async () => {
      if (!(await confirmDestructive('¿Eliminar esta fotografía?', `${lbl} del contenedor ${k + 1}.`, 'Eliminar foto'))) return;
      delete c.fotos[side]; await drafts.saveNow(draft); await media.remove(ph.id); sh.close(); redrawPhotos(); toast('Foto eliminada', { type: 'info' });
    });
  }

  /* ===== Archivos adjuntos ===== */
  async function addAttachments(files) {
    const box = body.querySelector('[data-atts]'); box && box.classList.add('busy');
    for (const f of files) {
      const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name), isImg = /^image\/(jpeg|png)$/.test(f.type) || /\.(jpe?g|png)$/i.test(f.name);
      if (!isPdf && !isImg) { toast(`«${f.name}» no es PDF, JPG ni PNG.`, { type: 'warn', ms: 3500 }); continue; }
      try {
        if (isPdf) {
          let pages = null;
          if (await loadLib('pdflib').catch(() => false)) {
            try { const d = await window.PDFLib.PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true }); pages = d.getPageCount(); }
            catch (err) { toast(`No se pudo leer «${f.name}». Puede estar dañado o protegido.`, { type: 'warn', ms: 4500 }); continue; }
          }
          const mid = await media.saveBlob(f, { owner: 'draft:' + draft.id, kind: 'file', name: f.name });
          s.attachments.push({ id: mid, name: f.name, kind: 'pdf', pages, size: f.size });
        } else {
          const im = await normImage(f);
          const mid = await media.saveBlob(im.blob, { owner: 'draft:' + draft.id, kind: 'file', name: f.name });
          await media.ensureURL(mid);
          s.attachments.push({ id: mid, name: f.name, kind: 'img', w: im.w, h: im.h, size: f.size });
        }
        toast('Archivo agregado');
      } catch (err) { toast(`No se pudo agregar «${f.name}».`, { type: 'warn' }); }
    }
    await drafts.saveNow(draft);
    if (box) { box.classList.remove('busy'); box.innerHTML = attHTML(); }
  }
  on(body, 'click', '[data-att]', async (e, b) => {
    const k = +b.dataset.i, a = b.dataset.att, list = s.attachments;
    if (a === 'rm') {
      if (!(await confirmDestructive('¿Quitar este archivo?', list[k].name, 'Quitar archivo'))) return;
      const [x] = list.splice(k, 1); await media.remove(x.id);
    } else { const j = a === 'up' ? k - 1 : k + 1; if (j < 0 || j >= list.length) return; [list[k], list[j]] = [list[j], list[k]]; }
    await drafts.saveNow(draft);
    body.querySelector('[data-atts]').innerHTML = attHTML();
  });

  /* ===== Navegación ===== */
  shell.onNext(async () => {
    await drafts.flush();
    if (i < N - 1) { toStep(i + 1); return; }
    const issues = puertoIssues(s);
    const actions = issues.length
      ? [{ label: `Completar: ${issues[0].msg}`, value: 'fix', style: 'primary' }, { label: 'Generar con datos pendientes', value: 'gen' }]
      : [{ label: 'Generar PDF', value: 'gen', style: 'primary' }];
    const v = await actionSheet({ title: issues.length ? `Faltan ${issues.length} dato${issues.length > 1 ? 's' : ''}` : '¿Generar documento?', message: generationSummary(draft), actions });
    if (v === 'fix') toStep(issues[0].step, issues[0].field);
    if (v === 'gen') await generate(draft);
  });
  shell.onBack(async () => { await drafts.flush(); if (i === 0) go('/', { replace: true }); else toStep(i - 1); });
  shell.onClose(async () => { await drafts.flush(); toast('Borrador guardado'); go('/', { replace: true }); });
  shell.onJump(async (n) => { await drafts.flush(); toStep(n); });

  draw();
  return { el: shell.el, cleanup: async () => { dv && dv.destroy(); await drafts.flush(); } };
}
