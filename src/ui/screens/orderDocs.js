/*
 * Documentación de una Orden de Servicio (se usa en el formulario por pasos y en el expediente):
 *   - Con carga de Control de llenos vinculada, los documentos portuarios SON los de la carga (Pedimento, DODA, Cita y, dentro
 *     de puerto, DEC): subir uno aquí lo deja en Control de llenos y al revés (nunca se sube dos veces).
 *   - Sin carga (otros movimientos de Puerto) la orden tiene sus propios espacios, no requeridos salvo que se marquen.
 *   - Campo: solo documentos adicionales.
 * Cada documento tiene su botón (archivo, Fotos o cámara en iPhone; PDF, JPG o PNG) y se puede ver, reemplazar, descargar,
 * compartir, verificar, marcar como requerido o no, y eliminar. «Generar expediente documental» combina los elegidos en un
 * PDF (Pedimento, DODA, DEC, Cita, adicionales y, si se quiere, la nota vigente) sin modificar los originales.
 */
import * as so from '../../services/orders.js';
import * as media from '../../services/media.js';
import { getDocument } from '../../services/documents.js';
import { loadLib } from '../../services/libs.js';
import { appendFile } from '../../services/pdf.js';
import { shareFile, downloadBlob } from '../../services/share.js';
import { DOC_TYPES, docType as flDocType } from '../../domain/fulls/fulls.js';
import { docStatus, docKindLabel, hasFile, dossierList, EVIDENCE_TYPES, opTypeOf } from '../../domain/orders/orders.js';
import { esc, fmtSize } from '../../domain/shared/format.js';
import { icon } from '../components/icons.js';
import { openSheet, actionSheet, confirmDestructive, busy } from '../components/sheet.js';
import { openFileViewer } from '../components/fileViewer.js';
import { toast } from '../components/toast.js';

const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;
const short = (d) => (d.docType === 'otro' || EVIDENCE_TYPES[d.docType] ? 'archivo' : (flDocType(d.docType) || { short: d.docType }).short || d.docType);
const CAM = 'image/jpeg,image/png';

async function viewDoc(d) {
  const blob = await so.blobOfDoc(d);
  if (!blob) { toast('El archivo no está disponible en este dispositivo.', { type: 'warn' }); return; }
  await openFileViewer({ title: docKindLabel(d), blob, name: d.name, kind: d.kind });
}
async function fileOf(d) { const b = await so.blobOfDoc(d); return b ? new File([b], d.name || 'documento', { type: b.type || d.mimeType || 'application/octet-stream' }) : null; }

/* Subida con aviso de archivo repetido; files: FileList o arreglo */
export async function uploadTo(orderId, files, opts = {}) {
  const o = so.byId(orderId); if (!o) return null;
  const list = [...files];
  for (const f of list) {
    const dup = so.duplicateFile(o, f);
    if (dup && !(await confirmDestructive('Ese archivo ya está en el expediente', `«${f.name}» ya está adjuntado como ${docKindLabel(dup)}. ¿Adjuntarlo de nuevo?`, 'Adjuntar de todos modos'))) return null;
  }
  busy(true, 'Guardando documento…', '');
  const bad = []; let last = null;
  try {
    for (let i = 0; i < list.length; i++) {
      busy(true, 'Guardando documento…', list.length > 1 ? `Procesando ${i + 1} de ${list.length}` : list[i].name);
      try { last = await so.attachFile(orderId, list[i], i === 0 ? opts : { ...opts, docId: null }); } catch (e) { bad.push(`«${list[i].name}»: ${e.message || 'no se pudo guardar'}`); }
    }
  } finally { busy(false); }
  if (last) toast(opts.docId ? 'Documento reemplazado' : list.length > 1 ? `${list.length - bad.length} documentos añadidos` : `${docKindLabel(last)} adjuntado`);
  if (bad.length) toast(bad.join(' · '), { type: 'warn', ms: 5500 });
  return last;
}

/*
 * Monta la lista en box. kinds: 'docs' (documentación) | 'entrega' | 'devolucion' (evidencias). Devuelve { refresh }.
 */
export function mountOrderDocs(box, orderId, { kind = 'docs', onChange = null } = {}) {
  let replaceId = null;
  async function draw() {
    const o = so.byId(orderId); if (!o) { box.innerHTML = ''; return; }
    const evidence = kind !== 'docs', canW = so.can('attach'), load = so.loadOf(o), t = opTypeOf(o.opType, o.division);
    const docs = evidence ? so.evidenceOf(o, kind) : so.docsOf(o);
    await media.ensureURLs(docs.filter((d) => d.kind === 'img' && hasFile(d)).map((d) => d.storageKey));
    const st = evidence ? null : docStatus(docs, o.docChecks, { applies: o.division === 'puerto' });
    const checked = (d) => { const c = (o.docChecks || {})[d.id]; return !!c && (!c.key || c.key === d.storageKey); };
    const row = (d) => {
      const ok = hasFile(d), err = d.fileStatus === 'error';
      const state = ok ? (d.required ? (checked(d) ? 'Verificado' : 'Adjuntado · por verificar') : 'Adjuntado · opcional') : d.required ? 'Pendiente' : 'No requerido';
      const meta = ok ? [d.kind === 'pdf' ? 'PDF' : 'Imagen', d.kind === 'pdf' && d.pages ? plural(d.pages, 'página', 'páginas') : '', fmtSize(d.size || 0)].filter(Boolean).join(' · ') : '';
      const ups = !ok && !err && canW ? `<span class="fc-upwrap"><label class="btn-secondary sm fc-up">${icon.upload}<span>Subir ${esc(short(d))}</span><input type="file" accept="${so.ACCEPT}" hidden data-up="${esc(d.id)}" data-type="${esc(d.docType)}"></label><label class="btn-ghost sm fc-up">${icon.camera}<span>Foto</span><input type="file" accept="${CAM}" capture="environment" hidden data-up="${esc(d.id)}" data-type="${esc(d.docType)}"></label></span>` : '';
      return `<li class="att fc-doc ${ok ? 'attached' : d.required ? 'pending' : 'not_required'}${err ? ' err' : ''}" data-doc="${esc(d.id)}">
        <span class="att-ic ${ok ? esc(d.kind) : 'none'}"${ok && d.kind === 'img' ? ` style="background-image:url('${media.urlFor(d.storageKey)}')"` : ''}>${ok ? (d.kind === 'pdf' ? 'PDF' : '') : err ? 'ERR' : icon.file}</span>
        <span class="att-tx"><b>${esc(docKindLabel(d))}</b><small><span class="fc-dst ${ok ? 'attached' : d.required ? 'pending' : 'not_required'}">${esc(state)}</span>${ok ? `${esc(d.name)} · ${esc(meta)}` : err ? `<span class="td-errt">${icon.alert}No se pudo procesar «${esc(d.name)}»</span>` : ''}</small>${ups}</span>
        <span class="att-b"><button type="button" class="icon-btn" data-more="${esc(d.id)}" aria-label="Acciones de ${esc(docKindLabel(d))}">${icon.more}</button></span></li>`;
    };
    const good = !evidence && (st.key === 'complete' || st.key === 'not_required' || st.key === 'not_applicable');
    const head = evidence ? '' : `<p class="fc-docst ${good ? 'ok' : 'warn'}">${good ? icon.check : st.key === 'to_verify' ? icon.eye : icon.alert}<span>${esc(st.label)}${st.required ? ` · ${st.attached} de ${st.required} requeridos` : ''}${st.toVerify.length ? ` · ${plural(st.toVerify.length, 'por verificar', 'por verificar')}` : ''}</span></p>`;
    const loadNote = !evidence && o.division === 'puerto' ? (load ? `<p class="so-src">${icon.link}<span>Compartidos con <a href="#/operacion/logistica/llenos/${esc(load.id)}">Control de llenos · ${esc(load.containerNumber)}</a>: lo que subas aquí también aparece allá (y al revés).</span></p>`
      : t.fullLoad ? `<p class="so-src warn">${icon.info}<span>La documentación portuaria se abre al programar la carga en Control de llenos (contenedor, peso, terminal o patio, fecha y hora en «Datos del transporte»).</span></p>` : '') : '';
    const hasFiles = docs.some(hasFile);
    box.innerHTML = `${loadNote}${head}
      ${docs.length ? `<ul class="att-list fc-doclist">${docs.map(row).join('')}</ul>` : `<p class="grp-note">${evidence ? 'Sin evidencias.' : o.division === 'campo' ? 'Campo no requiere documentación portuaria. Puedes adjuntar otros documentos.' : 'Sin documentos.'}</p>`}
      ${canW && (load || !opTypeOf(o.opType, o.division).fullLoad || evidence) ? `<div class="sheet-acts"><label class="btn-secondary">${icon.plus}<span>${evidence ? 'Agregar evidencia' : 'Documento adicional'}</span><input type="file" accept="${so.ACCEPT}" multiple hidden data-add></label><label class="btn-secondary">${icon.camera}<span>Tomar foto</span><input type="file" accept="${CAM}" capture="environment" hidden data-add></label></div>` : ''}
      <input type="file" accept="${so.ACCEPT}" hidden data-replace>
      ${evidence ? '' : `<button type="button" class="btn-secondary block so-dossier" data-dossier${hasFiles || (o.generated || []).length ? '' : ' disabled'}>${icon.file}<span>Generar expediente documental</span></button>
      <p class="grp-note">Cada documento se guarda por separado. «Adjuntado» no significa «correcto»: verifica cada requerido. El expediente PDF es opcional y no modifica los originales.</p>`}`;
  }
  box.addEventListener('change', async (e) => {
    const inp = e.target; if (!inp.matches('input[type=file]')) return;
    const files = [...(inp.files || [])]; inp.value = '';
    if (!files.length) return;
    if (inp.dataset.up) await uploadTo(orderId, files.slice(0, 1), { docId: inp.dataset.up, docType: inp.dataset.type });
    else if (inp.hasAttribute('data-replace')) { if (replaceId) await uploadTo(orderId, files.slice(0, 1), { docId: replaceId }); replaceId = null; }
    else if (inp.hasAttribute('data-add')) await uploadTo(orderId, files, { docType: kind === 'docs' ? 'otro' : kind });
    onChange && onChange(); await draw();
  });
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-more],[data-dossier]'); if (!b) return;
    if (b.hasAttribute('data-dossier')) { await openOrderDossier(orderId); return; }
    const o = so.byId(orderId), d = [...so.docsOf(o), ...so.evidenceOf(o)].find((x) => x.id === b.dataset.more); if (!d) return;
    const ok = hasFile(d), canW = so.can('attach'), c = (o.docChecks || {})[d.id], verified = !!c && (!c.key || c.key === d.storageKey);
    const slot = DOC_TYPES.some((x) => x.key === d.docType && x.slot) || ['pedimento', 'doda', 'dec', 'cita'].includes(d.docType);
    const actions = [
      ...(ok ? [{ label: 'Ver', value: 'view', icon: icon.eye }, { label: 'Compartir', value: 'share', icon: icon.share }, { label: 'Descargar', value: 'down', icon: icon.download }] : []),
      ...(canW && ok ? [{ label: 'Reemplazar archivo', value: 'replace', icon: icon.refresh }] : []),
      ...(canW && ok && d.required ? [{ label: verified ? 'Quitar verificación' : 'Marcar como verificado', value: 'verify', icon: icon.check, style: verified ? '' : 'primary' }] : []),
      ...(canW && slot && kind === 'docs' ? [{ label: d.required ? 'Marcar como no requerido' : 'Marcar como requerido', value: 'req', icon: d.required ? icon.minus : icon.check }] : []),
      ...(canW && so.can('archive') && (ok || !slot) ? [{ label: ok && slot ? 'Quitar archivo' : 'Eliminar', value: 'del', style: 'destructive', icon: icon.trash }] : []),
    ];
    if (!actions.length) return;
    const v = await actionSheet({ title: docKindLabel(d), message: ok ? `${d.name} · ${fmtSize(d.size || 0)}` : '', actions });
    try {
      if (v === 'view') await viewDoc(d);
      if (v === 'share' || v === 'down') { const f = await fileOf(d); if (!f) { toast('El archivo no está disponible en este dispositivo.', { type: 'warn' }); return; } if (v === 'down') downloadBlob(f, f.name); else { const r = await shareFile(f, { title: docKindLabel(d) }); if (r === 'unsupported' || r === 'error') downloadBlob(f, f.name); } }
      if (v === 'replace') { replaceId = d.id; box.querySelector('[data-replace]').click(); }
      if (v === 'verify') { await so.verifyDoc(orderId, d.id, !verified); toast(verified ? 'Verificación retirada' : `${docKindLabel(d)} verificado`); }
      if (v === 'req') { await so.setDocRequired(orderId, d.id, !d.required); toast(d.required ? 'Marcado como no requerido' : 'Marcado como requerido'); }
      if (v === 'del') { if (await confirmDestructive(`¿Eliminar ${docKindLabel(d)}?`, 'El archivo se quita del expediente; el movimiento queda en el historial de la orden.', 'Eliminar')) { await so.removeDoc(orderId, d.id); toast('Documento eliminado', { type: 'info' }); } }
    } catch (err) { toast(err.message || 'No se pudo completar.', { type: 'warn' }); }
    onChange && onChange(); await draw();
  });
  draw();
  return { refresh: draw };
}

/* ===== Expediente documental (PDF combinado, opcional) ===== */
async function dossierItems(o) {
  const items = so.docsOf(o).filter(hasFile).map((d) => ({ id: d.id, d, label: docKindLabel(d), kind: d.kind, pages: d.pages || 1, size: d.size || 0, storageKey: d.storageKey, w: d.w, h: d.h, docType: d.docType, order: d.order, createdAt: d.createdAt, fileStatus: 'ok' }));
  const g = so.latestGenerated(o);
  if (g) { const doc = await getDocument(g.documentId); if (doc && doc.pdfId) items.push({ id: 'gen:' + doc.id, label: `${doc.type === 'campo' ? 'Asignación de unidades' : 'Nota de entrega'} ${doc.folio} (versión ${g.version})`, kind: 'pdf', pages: doc.pages || 1, size: doc.size || 0, storageKey: doc.pdfId, docType: 'gen', fileStatus: 'ok', createdAt: doc.createdAt }); }
  return items;
}
export async function openOrderDossier(orderId) {
  const o = so.byId(orderId); if (!o) return;
  const items = await dossierItems(o);
  if (!items.length) { toast('Aún no hay documentos con archivo.', { type: 'info' }); return; }
  let order = (o.dossierOrder && o.dossierOrder.length ? o.dossierOrder : []), skip = new Set(o.dossierSkip || []);
  const listed = () => { const l = dossierList(items, { order, skip: [...skip] }); return l.all; };
  const body = document.createElement('div');
  const sh = openSheet({ title: 'Expediente documental', body, full: true });
  function draw() {
    const all = listed(), inc = all.filter((x) => !skip.has(x.id)), pages = inc.reduce((s, x) => s + (x.pages || 1), 0);
    body.innerHTML = `<p class="grp-note">Orden sugerida: Pedimento, DODA, DEC, Cita y adicionales. Elige qué incluir y cambia el orden. Los archivos originales no se modifican.</p>
      <ul class="att-list so-dlist">${all.map((x, i) => `<li class="att${skip.has(x.id) ? ' off' : ''}"><label class="so-dchk"><input type="checkbox" data-inc="${esc(x.id)}"${skip.has(x.id) ? '' : ' checked'}><span class="att-tx"><b>${i + 1}. ${esc(x.label)}</b><small>${x.kind === 'pdf' ? plural(x.pages, 'página', 'páginas') : 'Imagen (1 página)'} · ${esc(fmtSize(x.size))}</small></span></label>
        <span class="att-b"><button type="button" class="icon-btn" data-mv="-1" data-id="${esc(x.id)}" aria-label="Subir"${i ? '' : ' disabled'}>${icon.up}</button><button type="button" class="icon-btn" data-mv="1" data-id="${esc(x.id)}" aria-label="Bajar"${i < all.length - 1 ? '' : ' disabled'}>${icon.down}</button></span></li>`).join('')}</ul>
      <p class="so-dsum"><b>${plural(inc.length, 'documento', 'documentos')}</b> · ${plural(pages, 'página', 'páginas')}</p>
      <div class="form-foot"><button type="button" class="btn-primary block lg" data-build${inc.length ? '' : ' disabled'}>${icon.file}<span>Generar PDF</span></button></div>`;
  }
  body.addEventListener('change', (e) => { const c = e.target.closest('[data-inc]'); if (!c) return; if (c.checked) skip.delete(c.dataset.inc); else skip.add(c.dataset.inc); so.setDossier(orderId, { order: listed().map((x) => x.id), skip: [...skip] }); draw(); });
  body.addEventListener('click', async (e) => {
    const m = e.target.closest('[data-mv]');
    if (m) { const ids = listed().map((x) => x.id), i = ids.indexOf(m.dataset.id), j = i + +m.dataset.mv; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; order = ids; so.setDossier(orderId, { order, skip: [...skip] }); draw(); return; }
    if (e.target.closest('[data-build]')) { const inc = listed().filter((x) => !skip.has(x.id)); sh.close(); await buildAndOffer(o, inc); }
  });
  draw();
}
async function buildAndOffer(o, inc) {
  busy(true, 'Generando expediente…', '');
  let file = null; const skipped = [];
  try {
    await loadLib('pdflib');
    const { PDFDocument } = window.PDFLib;
    const out = await PDFDocument.create();
    for (let i = 0; i < inc.length; i++) {
      const x = inc[i];
      busy(true, 'Generando expediente…', `${i + 1} de ${inc.length}: ${x.label}`);
      await new Promise((r) => setTimeout(r, 0));
      try {
        const blob = await media.getBlob(x.storageKey); if (!blob) throw new Error('Archivo no disponible');
        const bytes = new Uint8Array(await blob.arrayBuffer());
        await appendFile(out, x.kind === 'img' ? { kind: 'img', bytes, w: x.w, h: x.h } : { kind: 'pdf', bytes });
      } catch (e) { console.warn('expediente', x.label, e); skipped.push(x.label); }
    }
    if (!out.getPageCount()) throw new Error('No hay documentos que se puedan combinar.');
    out.setTitle(`Expediente ${o.folio}`); out.setAuthor('PERCONSUR'); out.setCreator('PERCONSUR'); out.setSubject(`Orden de servicio ${o.folio}`);
    file = new File([await out.save()], `PERCONSUR-${o.folio}-expediente.pdf`, { type: 'application/pdf' });
  } catch (e) { busy(false); toast(e.message || 'No se pudo generar el expediente.', { type: 'warn' }); return; }
  busy(false);
  if (skipped.length) toast(`Se omitió: ${skipped.join(', ')}`, { type: 'warn', ms: 5000 });
  const v = await actionSheet({ title: 'Expediente listo', message: `${file.name} · ${fmtSize(file.size)}`, actions: [{ label: 'Ver', value: 'view', icon: icon.eye, style: 'primary' }, { label: 'Compartir', value: 'share', icon: icon.share }, { label: 'Descargar', value: 'down', icon: icon.download }] });
  if (v === 'view') await openFileViewer({ title: 'Expediente documental', blob: file, name: file.name, kind: 'pdf' });
  if (v === 'down') downloadBlob(file, file.name);
  if (v === 'share') { const r = await shareFile(file, { title: `Expediente ${o.folio}` }); if (r === 'unsupported' || r === 'error') downloadBlob(file, file.name); }
}
