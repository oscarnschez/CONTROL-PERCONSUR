/* Pantalla "Documento generado" con las acciones para compartir y guardar. */
import { screen, on } from '../../core/dom.js';
import { go } from '../../core/router.js';
import { getDocument } from '../../services/documents.js';
import { getCompany } from '../../services/companies.js';
import { esc, fmtSize } from '../../domain/shared/format.js';
import { icon } from '../components/icons.js';
import { loadDocFile, startPuerto, startCampo } from '../flows.js';
import { doShare, openWhatsApp, viewPdf, saveHint } from './docActions.js';
import { byId as orderById, loadOrders } from '../../services/orders.js';

export async function doneScreen({ id }) {
  const doc = await getDocument(id);
  if (!doc) { go('/', { replace: true }); return null; }
  const file = await loadDocFile(doc);
  const isP = doc.type === 'puerto';
  await loadOrders();
  const order = doc.data && doc.data.serviceOrderId ? orderById(doc.data.serviceOrderId) : null;
  const s = screen(`<div class="page done">
    <div class="done-hero">
      <span class="done-check">${icon.check}</span>
      <h1>Documento generado</h1>
      <p class="mono">${esc(doc.filename)}</p>
      <p class="done-meta">${isP ? esc(getCompany(doc.company).short) + ' | ' : ''}${esc(doc.pages)} página${doc.pages === 1 ? '' : 's'} | ${esc(fmtSize(doc.size || 0))}</p>
      <div class="band slim" aria-hidden="true"></div>
    </div>
    <button type="button" class="btn-primary block lg" data-a="share">${icon.share}<span>Compartir</span></button>
    <div class="done-grid">
      <button type="button" class="act" data-a="save">${icon.folder}<span>Guardar en Archivos</span></button>
      <button type="button" class="act" data-a="wa">${icon.whatsapp}<span>Enviar por WhatsApp</span></button>
      <button type="button" class="act" data-a="view">${icon.eye}<span>Ver PDF</span></button>
      <button type="button" class="act" data-a="new">${icon.plus}<span>${isP ? 'Nueva nota' : 'Nueva asignación'}</span></button>
    </div>
    <p class="grp-note center">${esc(saveHint())} El documento queda guardado en Documentos${order ? ` y en la orden ${esc(order.folio)}` : ''}.</p>
    ${order ? `<button type="button" class="btn-secondary block" data-a="order">${icon.clipboard}<span>Volver a la orden ${esc(order.folio)}</span></button>` : ''}
    <button type="button" class="btn-ghost block" data-a="home">Ir al inicio</button>
  </div>`);
  on(s.el, 'click', '[data-a]', (e, b) => {
    const a = b.dataset.a;
    if (a === 'share') doShare(doc, file);
    if (a === 'save') doShare(doc, file, { save: true });
    if (a === 'wa') openWhatsApp(doc, file);
    if (a === 'view') viewPdf(doc, file);
    if (a === 'new') (isP ? startPuerto(doc.company) : startCampo());
    if (a === 'home') go('/', { replace: true });
    if (a === 'order' && order) go(`/operacion/ordenes/${encodeURIComponent(order.id)}?s=docs`, { replace: true });
  });
  /* Puerto: el original mostraba el resumen para WhatsApp justo después de generar */
  if (isP) s.mounted = () => setTimeout(() => openWhatsApp(doc, file), 450);
  return s;
}
