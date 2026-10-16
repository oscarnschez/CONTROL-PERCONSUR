/*
 * Flujos compartidos: nuevo documento, elección de empresa, borradores, generación y archivo PDF.
 */
import { go } from '../core/router.js';
import * as media from '../services/media.js';
import * as drafts from '../services/drafts.js';
import * as docs from '../services/documents.js';
import { nextFolio } from '../services/folios.js';
import { getCompany } from '../services/companies.js';
import { getSetting, setSetting, pushRecent } from '../services/settings.js';
import { plantByName } from '../services/catalogs.js';
import { qrDataURL } from '../services/codes.js';
import { tryLibs } from '../services/libs.js';
import { generatePdf, printFallback } from '../services/pdf.js';
import { uid } from '../services/db.js';
import { PUERTO_COMPANIES } from '../config/companies.js';
import { nowParts, esc } from '../domain/shared/format.js';
import { blankPuerto, puertoHasData, puertoSummary, contsWithFotos, filledConts } from '../domain/puerto/model.js';
import { puertoSheetHTML, puertoAnnexHTML } from '../domain/puerto/sheet.js';
import { cpBlank, campoHasData, campoSummary, cpRows } from '../domain/campo/model.js';
import { campoSheetHTML } from '../domain/campo/sheet.js';
import { actionSheet, openSheet, busy } from './components/sheet.js';
import { toast } from './components/toast.js';
import { icon } from './components/icons.js';
import { openPicker } from './components/picker.js';
import { DIVISION_ICON } from '../config/modules.js';
import { operatorList } from '../services/operators.js';

/* Contexto para las plantillas de documento */
export const sheetCtx = () => ({ photoURL: (ph) => media.urlFor(ph.id), qr: qrDataURL, plant: plantByName });

export async function ensureDocAssets(type, data) {
  await tryLibs(['qrcode']);
  if (type === 'puerto') {
    const ids = [];
    data.conts.forEach((c) => Object.values(c.fotos || {}).forEach((ph) => ids.push(ph.id)));
    (data.attachments || []).filter((a) => a.kind === 'img').forEach((a) => ids.push(a.id));
    await media.ensureURLs(ids);
  }
}
export function docHTML(type, data, company) {
  const ctx = sheetCtx();
  if (type === 'puerto') { const co = getCompany(company); return puertoSheetHTML(data, co, ctx) + puertoAnnexHTML(data, co, ctx); }
  return campoSheetHTML(data, getCompany('campo'), ctx);
}

/* ===== Nuevo documento ===== */
export function openNewSheet() {
  const body = `<div class="new-opts">
    <button type="button" class="new-opt" data-t="orden"><span class="new-ic">${icon.clipboard}</span><span class="new-tx"><b>Orden de servicio</b><small>Operación | Expediente completo del viaje</small></span><span class="chev">${icon.chev}</span></button>
    <button type="button" class="new-opt" data-t="puerto"><span class="new-ic">${icon[DIVISION_ICON.puerto]}</span><span class="new-tx"><b>Nota de entrega</b><small>División Puerto</small></span><span class="chev">${icon.chev}</span></button>
    <button type="button" class="new-opt" data-t="campo"><span class="new-ic">${icon[DIVISION_ICON.campo]}</span><span class="new-tx"><b>Asignación de unidades</b><small>División Campo</small></span><span class="chev">${icon.chev}</span></button>
    <button type="button" class="new-opt" data-t="viaje"><span class="new-ic">${icon.people}</span><span class="new-tx"><b>Viaje de operador</b><small>Administración | Operadores</small></span><span class="chev">${icon.chev}</span></button>
    <button type="button" class="new-opt" data-t="recarga"><span class="new-ic">${icon.fuel}</span><span class="new-tx"><b>Recarga de combustible</b><small>Operación | Combustible y rendimiento</small></span><span class="chev">${icon.chev}</span></button>
  </div>`;
  const sh = openSheet({ title: 'Nuevo documento', body });
  sh.body.querySelectorAll('.new-opt').forEach((b) => b.addEventListener('click', () => {
    sh.close();
    const t = b.dataset.t;
    if (t === 'orden') go('/operacion/ordenes/nueva'); else if (t === 'puerto') startPuerto(); else if (t === 'campo') startCampo(); else if (t === 'viaje') startOperatorTrip();
    else import('./screens/fuel.js').then((m) => m.startFuelRecord(null, () => go('/operacion/combustible')));
  }));
}

/* Viaje de operador desde "Nuevo": elegir operador del catálogo y abrir el formulario en su ficha */
export async function startOperatorTrip() {
  const list = operatorList();
  if (!list.length) { toast('No hay operadores en el catálogo. Agrégalos en Catálogos → Operadores.', { type: 'info', ms: 4000 }); return; }
  const multi = new Set(list.map((o) => o.company)).size > 1;
  const r = await openPicker({ title: 'Operador del viaje', allowNew: false, placeholder: 'Buscar operador', items: list.map((o) => ({ value: o.id, label: o.name, sub: multi ? o.companyShort : '' })) });
  if (!r || !r.value) return;
  const how = await chooseTripKind();
  if (how === 'order') go(`/operacion/ordenes/nueva?operador=${encodeURIComponent(r.value)}`);
  if (how === 'trip') go(`/operadores/${r.value}?nuevo=viaje`);
}
/* Un viaje nuevo puede ser una orden de servicio completa o solo el registro financiero (viajes pasados o sin operación) */
export function chooseTripKind() {
  return actionSheet({ title: 'Registrar viaje', message: 'La orden de servicio crea, al despachar, la operación de Logística y el viaje financiero (una sola vez).',
    actions: [{ label: 'Orden de servicio completa', sub: 'Captura, documentos, asignación, despacho, entrega y cierre', value: 'order', style: 'primary' }, { label: 'Solo registro financiero', sub: 'Tarifa, impuestos y comisión del operador', value: 'trip' }] });
}

export function chooseCompany() {
  return new Promise((resolve) => {
    const saved = getSetting('lastCompany', 'perconsur'), last = PUERTO_COMPANIES.includes(saved) ? saved : 'perconsur';
    const order = [last, ...PUERTO_COMPANIES.filter((k) => k !== last)];
    const body = `<p class="sheet-lead">La nota se genera con los datos, logotipo y colores de la empresa elegida.</p><div class="co-list">${order.map((k) => {
      const c = getCompany(k);
      return `<button type="button" class="co-opt" data-k="${esc(k)}" style="--c1:${esc(c.colors.c1)};--c2:${esc(c.colors.c2)}">
        <span class="co-logo ${c.mark ? 'mark' : 'wide'}"><img src="${esc(c.logo)}" alt=""></span>
        <span class="co-tx"><b>${esc(c.legal)}</b><small>${esc(c.city || '')}${k === last ? ' | Última usada' : ''}</small></span>
        <span class="chev">${icon.chev}</span></button>`;
    }).join('')}</div>`;
    let picked = null;
    const sh = openSheet({ title: 'Empresa transportista', body, onClose: () => resolve(picked) });
    sh.body.querySelectorAll('.co-opt').forEach((b) => b.addEventListener('click', () => { picked = b.dataset.k; sh.close(picked); }));
  });
}

export async function startPuerto(company) {
  company = company || await chooseCompany();
  if (!company) return;
  await setSetting('lastCompany', company); await setSetting('lastDivision', 'puerto');
  const id = drafts.draftId('puerto', company);
  const ex = await drafts.getDraft(id);
  if (ex && puertoHasData(ex.data)) {
    const v = await actionSheet({
      title: 'Tienes una nota sin terminar',
      message: `${getCompany(company).short} | Folio ${ex.data.folio}. Puedes continuarla o descartarla para empezar una nueva.`,
      actions: [{ label: 'Continuar nota', value: 'cont', style: 'primary' }, { label: 'Descartar y empezar nueva', value: 'new', style: 'destructive' }],
    });
    if (!v) return;
    if (v === 'cont') { go(`/puerto/${company}/${(ex.step || 0) + 1}`); return; }
    await discardDraft(id, { silent: true });
  }
  await createPuertoDraft(company);
  go(`/puerto/${company}/1`);
}
export async function createPuertoDraft(company) {
  const t = nowParts();
  const folio = await nextFolio(company, t.fecha);
  const d = { id: drafts.draftId('puerto', company), type: 'puerto', company, data: blankPuerto({ folio, ...t }), step: 0, createdAt: Date.now() };
  await drafts.saveNow(d);
  return d;
}
export async function startCampo() {
  await setSetting('lastDivision', 'campo');
  const ex = await drafts.getDraft('campo');
  if (ex && campoHasData(ex.data)) {
    const v = await actionSheet({
      title: 'Tienes una asignación sin terminar',
      message: `Folio ${ex.data.folio}. Puedes continuarla o descartarla para empezar una nueva.`,
      actions: [{ label: 'Continuar asignación', value: 'cont', style: 'primary' }, { label: 'Descartar y empezar nueva', value: 'new', style: 'destructive' }],
    });
    if (!v) return;
    if (v === 'cont') { go(`/campo/${(ex.step || 0) + 1}`); return; }
    await discardDraft('campo', { silent: true });
  }
  await drafts.saveNow({ id: 'campo', type: 'campo', company: 'campo', data: cpBlank(nowParts().fecha), step: 0, createdAt: Date.now() });
  go('/campo/1');
}
export async function discardDraft(id, { silent = false } = {}) {
  await media.removeOwned('draft:' + id);
  await drafts.removeDraft(id);
  if (!silent) toast('Borrador descartado', { type: 'info' });
}
/* Ruta para continuar un borrador (paso numérico y empresa codificada: los borradores pueden venir de un respaldo) */
const stepNo = (d) => (Number.isInteger(d.step) && d.step >= 0 ? d.step : 0) + 1;
export const draftRoute = (d) => (d.type === 'campo' ? `/campo/${stepNo(d)}` : `/puerto/${encodeURIComponent(d.company || 'perconsur')}/${stepNo(d)}`);

/* ===== Generar ===== */
const fileCache = new Map();
export const cachedFile = (docId) => fileCache.get(docId) || null;
export async function loadDocFile(doc) {
  if (fileCache.has(doc.id)) return fileCache.get(doc.id);
  const b = await media.getBlob(doc.pdfId);
  if (!b) return null;
  const f = new File([b], doc.filename, { type: 'application/pdf' });
  fileCache.set(doc.id, f);
  return f;
}

export function generationSummary(draft) {
  if (draft.type === 'puerto') {
    const s = draft.data, n = filledConts(s).length, a = contsWithFotos(s).length, f = (s.attachments || []).length;
    return `Nota de entrega con ${n} contenedor${n === 1 ? '' : 'es'}${a ? ` y ${a} hoja${a === 1 ? '' : 's'} de evidencia` : ''}${f ? `, más ${f} archivo${f === 1 ? '' : 's'} combinado${f === 1 ? '' : 's'}` : ''}. Folio ${s.folio}.`;
  }
  const cp = draft.data, n = cpRows(cp).length, m = new Set(cp.units.map((u) => (u.sol || '').trim()).filter(Boolean)).size;
  return `PDF media carta con ${n} unidad${n === 1 ? '' : 'es'}${m ? ` en ${m} solicitud${m === 1 ? '' : 'es'}` : ''}. Folio ${cp.folio}.`;
}

export async function generate(draft) {
  await drafts.flush();
  const docId = uid('d_');
  const owner = 'doc:' + docId;
  busy(true, 'Generando PDF…', 'No cierres la app');
  try {
    await ensureDocAssets(draft.type, draft.data);
    const html = docHTML(draft.type, draft.data, draft.company);
    let spec, filename, summary;
    if (draft.type === 'puerto') {
      const s = draft.data, co = getCompany(draft.company);
      const attachments = [];
      for (const a of s.attachments || []) { const blob = await media.getBlob(a.id); if (blob) attachments.push({ kind: a.kind, name: a.name, blob, w: a.w, h: a.h }); }
      spec = { format: 'letter', html, sheetSel: '.sheet', textSel: '.s-logo,.a-title,.s-title', linkSel: '.s-qr,.s-track', obsLines: true, colors: co.colors,
        title: `Nota de entrega ${s.folio}`, author: 'PERCONSUR', subject: 'Nota de entrega – recepción', attachments };
      filename = `${s.folio}.pdf`;
      summary = puertoSummary(s, co);
    } else {
      const cp = draft.data, co = getCompany('campo');
      spec = { format: 'half', html, sheetSel: '.hsheet', textSel: '.s-logo,.s-title', linkSel: '.h-qr,.h-dqr', obsLines: false, colors: co.colors,
        title: 'Asignación de unidades para carga', author: 'PERCONSUR División Campo', attachments: [] };
      filename = `Asignacion-campo-${cp.fecha || nowParts().fecha}-${cp.folio || ''}.pdf`.replace('-.pdf', '.pdf');
      summary = campoSummary(cp);
    }
    const out = await generatePdf(spec, (t) => busy(true, 'Generando PDF…', t));
    busy(true, 'Guardando documento…', '');
    const pdfId = await media.saveBlob(out.blob, { owner, kind: 'pdf', name: filename });
    const previewIds = [];
    for (const [i, b] of out.previews.entries()) previewIds.push(await media.saveBlob(b, { owner, kind: 'preview', name: `pagina-${i + 1}.jpg` }));
    /* Las fotos y adjuntos del borrador pasan a pertenecer al documento */
    const mids = [];
    if (draft.type === 'puerto') {
      draft.data.conts.forEach((c) => Object.values(c.fotos || {}).forEach((ph) => mids.push(ph.id)));
      (draft.data.attachments || []).forEach((a) => mids.push(a.id));
    }
    await media.setOwner(mids, owner);
    const doc = {
      id: docId, type: draft.type, company: draft.company, folio: draft.data.folio, fecha: draft.data.fecha,
      createdAt: Date.now(), status: 'generado', summary, data: draft.data, pdfId, previewIds, filename,
      pages: out.pages, size: out.blob.size, skipped: out.skipped,
    };
    await docs.saveDocument(doc);
    await drafts.removeDraft(draft.id);
    /* Documento preparado desde una Orden de Servicio: queda como versión nueva en su expediente */
    if (draft.data.serviceOrderId) { try { await (await import('../services/orders.js')).recordGenerated(draft.data.serviceOrderId, doc); } catch (e) { console.warn('orden de servicio', e); } }
    fileCache.set(docId, new File([out.blob], filename, { type: 'application/pdf' }));
    if (draft.type === 'puerto') {
      const s = draft.data;
      await pushRecent('operador:' + draft.company, s.operador); await pushRecent('eco:' + draft.company, s.eco);
      await pushRecent('remolque:' + draft.company, s.placasR); await pushRecent('destino', s.destNombre);
    } else {
      for (const u of draft.data.units) { await pushRecent('operador:perconsur', u.op); await pushRecent('eco:perconsur', u.eco); }
    }
    busy(false);
    if (out.skipped.length) toast(`No se pudo combinar: ${out.skipped.join(', ')}. Se omitió.`, { type: 'warn', ms: 6000 });
    go('/listo/' + docId, { replace: true });
    return doc;
  } catch (e) {
    busy(false);
    console.error(e);
    await media.removeOwned(owner).catch(() => {});
    const offline = !navigator.onLine || /cargar/.test(String(e && e.message));
    if (draft.type === 'puerto' && offline) {
      const v = await actionSheet({
        title: 'No se pudo cargar el generador de PDF',
        message: 'La primera vez se necesita conexión para descargarlo. Mientras tanto puedes usar la impresión del navegador y guardar como PDF.',
        actions: [{ label: 'Abrir impresión', value: 'print', style: 'primary' }],
      });
      if (v === 'print') printFallback(docHTML('puerto', draft.data, draft.company));
    } else {
      toast(offline ? 'Se necesita conexión la primera vez para preparar el generador de PDF.' : 'No se pudo generar el PDF. Intenta de nuevo.', { type: 'warn', ms: 5000 });
    }
    return null;
  }
}
