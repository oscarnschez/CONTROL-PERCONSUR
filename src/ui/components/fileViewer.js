/*
 * Visor de archivos dentro de PERCONSUR (documentos y fotografías de Unidades).
 *   PDF     páginas dibujadas con PDF.js (vendor/pdfjs): cambiar de página y ampliar
 *   Imagen  ampliar y desplazar; si el navegador no puede mostrar el formato (HEIC en Chrome) se ofrece descargar
 * Acciones: Descargar, Compartir (hoja nativa de iPhone; el archivo ya está en memoria antes de tocar el botón) y
 * abrir en el visor del sistema. Nunca se modifica el archivo original.
 * openFileViewer({ title, blob, name, kind:'pdf'|'img', display?: Blob (versión para mostrar) })
 */
import { openSheet } from './sheet.js';
import { icon } from './icons.js';
import { toast } from './toast.js';
import { esc } from '../../domain/shared/format.js';
import { openPdf, renderPage } from '../../services/docText.js';
import { canShareFiles, shareFile, downloadBlob, openBlob } from '../../services/share.js';

export async function openFileViewer({ title, blob, name, kind, display = null }) {
  if (!blob) { toast('El archivo no está disponible en este dispositivo.', { type: 'warn' }); return; }
  const file = new File([blob], name || 'documento', { type: blob.type || (kind === 'pdf' ? 'application/pdf' : 'image/jpeg') });
  const share = canShareFiles(file);
  const body = document.createElement('div');
  body.className = 'fv';
  body.innerHTML = `<div class="fv-bar">
      <div class="fv-pg" data-pg ${kind === 'pdf' ? '' : 'hidden'}><button type="button" class="icon-btn" data-p="-1" aria-label="Página anterior">${icon.back}</button><span data-pl>Página 1</span><button type="button" class="icon-btn" data-p="1" aria-label="Página siguiente">${icon.chev}</button></div>
      <div class="fv-z"><button type="button" class="icon-btn" data-z="-1" aria-label="Alejar">${icon.minus}</button><span data-zl>100 %</span><button type="button" class="icon-btn" data-z="1" aria-label="Acercar">${icon.plus}</button></div>
    </div>
    <div class="fv-stage" data-stage><div class="fv-in" data-in><p class="fv-load">Cargando…</p></div></div>
    <div class="fv-acts">
      <button type="button" class="btn-secondary" data-act="download">${icon.download}<span>Descargar</span></button>
      ${share ? `<button type="button" class="btn-secondary" data-act="share">${icon.share}<span>Compartir</span></button>` : ''}
      <button type="button" class="btn-ghost" data-act="open">${icon.eye}<span>Abrir en el visor del sistema</span></button>
    </div>`;
  const sh = openSheet({ title: title || name, body, full: true, className: 'fv-sheet' });
  const inner = body.querySelector('[data-in]');
  let zoom = 1, page = 1, pdf = null, url = null;
  const setZoomLabel = () => { body.querySelector('[data-zl]').textContent = `${Math.round(zoom * 100)} %`; };
  async function drawPdf() {
    inner.innerHTML = '<p class="fv-load">Cargando página…</p>';
    try {
      const w = Math.max(320, body.querySelector('[data-stage]').clientWidth - 16);
      const p1 = await pdf.getPage(page), vp = p1.getViewport({ scale: 1 });
      const c = await renderPage(pdf, page, Math.min(4, (w / vp.width) * zoom * (window.devicePixelRatio || 1)));
      c.className = 'fv-canvas'; c.style.width = `${Math.round(w * zoom)}px`;
      inner.replaceChildren(c);
      body.querySelector('[data-pl]').textContent = `Página ${page} de ${pdf.numPages}`;
      body.querySelectorAll('[data-p]').forEach((b) => { b.disabled = (+b.dataset.p < 0 && page <= 1) || (+b.dataset.p > 0 && page >= pdf.numPages); });
    } catch (e) { inner.innerHTML = '<p class="fv-load">No se pudo mostrar esta página. Usa «Abrir en el visor del sistema».</p>'; }
  }
  function drawImg() {
    if (!url) url = URL.createObjectURL(display || blob);
    inner.innerHTML = `<img class="fv-img" src="${url}" alt="${esc(name || '')}" style="width:${Math.round(zoom * 100)}%">`;
    inner.querySelector('img').addEventListener('error', () => { inner.innerHTML = '<p class="fv-load">Este navegador no puede mostrar este formato de imagen. Descárgala o ábrela en el visor del sistema.</p>'; });
  }
  const draw = () => (kind === 'pdf' ? drawPdf() : drawImg());
  if (kind === 'pdf') { try { pdf = await openPdf(blob); } catch (e) { inner.innerHTML = '<p class="fv-load">No se pudo abrir el PDF en la app. Usa «Abrir en el visor del sistema».</p>'; } }
  if (kind !== 'pdf' || pdf) draw();
  body.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    if (b.dataset.p && pdf) { page = Math.max(1, Math.min(pdf.numPages, page + +b.dataset.p)); drawPdf(); }
    else if (b.dataset.z) { zoom = Math.max(0.5, Math.min(4, zoom * (+b.dataset.z > 0 ? 1.4 : 1 / 1.4))); setZoomLabel(); draw(); }
    else if (b.dataset.act === 'download') downloadBlob(file, file.name);
    else if (b.dataset.act === 'share') { const r = await shareFile(file, { title: title || file.name }); if (r === 'error') toast('No se pudo compartir el archivo.', { type: 'warn' }); }
    else if (b.dataset.act === 'open') openBlob(file);
  });
  /* Doble toque en la imagen: ampliar / volver */
  inner.addEventListener('dblclick', () => { zoom = zoom > 1 ? 1 : 2; setZoomLabel(); draw(); });
  const off = () => { if (url) URL.revokeObjectURL(url); };
  const close0 = sh.close; sh.close = (r) => { off(); close0(r); };
  return sh;
}
