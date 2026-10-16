/* Inicio: saludo, divisiones, documentos sin terminar, cobertura nacional (Mapa de viajes), recientes y unidades en operación (Logística). */
import { screen, on } from '../../core/dom.js';
import { go } from '../../core/router.js';
import { allDrafts } from '../../services/drafts.js';
import { listDocuments } from '../../services/documents.js';
import { getCompany } from '../../services/companies.js';
import { esc, agoText, relDay } from '../../domain/shared/format.js';
import { puertoHasData } from '../../domain/puerto/model.js';
import { campoHasData } from '../../domain/campo/model.js';
import { icon } from '../components/icons.js';
import { signalMini } from '../components/publishSignal.js';
import { DIVISION_ICON } from '../../config/modules.js';
import { startPuerto, startCampo, discardDraft, draftRoute } from '../flows.js';
import { confirmDestructive } from '../components/sheet.js';
import { docRow } from './documents.js';
import { mountHomeOps } from './logistics.js';
import { mountHomeOrders } from './orders.js';
import { mountCoverage } from './tripsMap.js';
import * as sync from '../../services/sync.js';
import { whenText } from '../../domain/sync/sync.js';
import * as al from '../../services/alerts.js';
import { onUnitsChange } from '../../services/units.js';

export function greeting(d = new Date()) { const h = d.getHours(); return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches'; }

export async function pendingDrafts() {
  return (await allDrafts()).filter((d) => (d.type === 'campo' ? campoHasData(d.data) : puertoHasData(d.data))).sort((a, b) => b.updatedAt - a.updatedAt);
}
export function draftCardHTML(d) {
  const isP = d.type === 'puerto', co = getCompany(d.company);
  return `<article class="draft-card" data-draft="${esc(d.id)}">
    <div class="dc-main"><span class="dc-ic ${isP ? 'puerto' : 'campo'}">${icon[DIVISION_ICON[isP ? 'puerto' : 'campo']]}</span>
      <div><b>${isP ? 'Nota de entrega' : 'Asignación de unidades'}</b><small>${isP ? esc(co.short) + ' | ' : ''}Folio ${esc(d.data.folio)} | ${esc(agoText(d.updatedAt))}</small></div></div>
    <div class="dc-acts"><button type="button" class="btn-ghost sm danger" data-discard="${esc(d.id)}">Descartar</button><button type="button" class="btn-primary sm" data-continue="${esc(d.id)}">Continuar</button></div>
  </article>`;
}

export async function homeScreen() {
  const [pend, docs] = await Promise.all([pendingDrafts(), listDocuments()]);
  const recent = docs.slice(0, 4);
  const s = screen(`<div class="page wide home">
    <header class="home-top">
      <a class="home-bell" href="#/avisos" data-bell aria-label="Avisos">${icon.bell}<span class="bell-n" data-bell-n hidden></span></a>
      <div class="brandline"><img src="./assets/brand/perconsur-mark.png" alt="" class="brand-mark"><span class="wordmark">PERCONSUR</span></div>
      <div class="band" aria-hidden="true"></div>
      <h1 class="greet">${greeting()}</h1>
      <p class="greet-sub">${sync.role() === 'read' ? 'Consulta la información al día' : '¿Qué necesitas hacer?'}</p>
      <a class="sync-pill" href="#/ajustes/compartir" data-syncpill></a>
    </header>
    ${pend.length ? `<section class="sec"><h2 class="sec-h">Sin terminar</h2>${pend.map(draftCardHTML).join('')}</section>` : ''}
    <section class="sec divs">
      <article class="div-card">
        <div class="div-head"><span class="div-ic">${icon[DIVISION_ICON.puerto]}</span><div><h2>División Puerto</h2><p>Notas de entrega y recepción</p></div></div>
        <button type="button" class="div-act" data-new="puerto"><span>Nueva nota</span>${icon.chev}</button>
      </article>
      <article class="div-card">
        <div class="div-head"><span class="div-ic">${icon[DIVISION_ICON.campo]}</span><div><h2>División Campo</h2><p>Asignación de unidades para carga</p></div></div>
        <button type="button" class="div-act" data-new="campo"><span>Nueva asignación</span>${icon.chev}</button>
      </article>
    </section>
    <section class="sec so-home" data-sohome aria-label="Órdenes de servicio"></section>
    <section class="sec tm-homew" data-coverage aria-label="Cobertura nacional" hidden></section>
    <section class="sec home-recent">
      <div class="sec-hrow"><h2 class="sec-h">Recientes</h2>${docs.length ? '<a class="link" href="#/documentos">Ver todos</a>' : ''}</div>
      ${recent.length ? `<div class="list">${recent.map(docRow).join('')}</div>` : `<div class="empty"><p><b class="empty-t">Aún no hay documentos</b>Las notas de entrega y asignaciones que generes aparecerán aquí.</p></div>`}
    </section>
    <section class="sec lg-home" data-lghome aria-label="Unidades en operación"></section>
  </div>`);
  const root = s.el;
  /* Unidades en operación: se redibuja sola cuando cambia Logística */
  const unOps = mountHomeOps(root.querySelector('[data-lghome]'));
  /* Órdenes de servicio: pendientes, listas, en operación y devoluciones (se redibuja sola) */
  const unOrd = mountHomeOrders(root.querySelector('[data-sohome]'));
  /* Cobertura nacional: resumen del Mapa de viajes (se llena sin retrasar Inicio) */
  const unCov = mountCoverage(root.querySelector('[data-coverage]'));
  /* Información compartida: modo consulta o estado de la publicación */
  const pill = root.querySelector('[data-syncpill]');
  const drawPill = () => {
    const st = sync.status();
    if (!st.role) { pill.innerHTML = ''; return; }
    const decide = st.role === 'write' && (st.conflict || sync.needsDecision());
    const warn = decide || !!st.error;
    const text = st.role === 'read'
      ? `Solo consulta · ${st.phase ? 'recibiendo…' : st.error ? 'sin conexión con la información compartida' : st.at ? 'actualizado ' + whenText(st.at) : 'esperando información'}`
      : decide ? 'Información compartida: decide qué información queda'
        : st.error ? 'Información compartida: no se pudo publicar'
          : st.phase ? 'Publicando…' : st.dirty ? 'Cambios por publicar' : st.at ? 'Compartido · publicado ' + whenText(st.at) : 'Información compartida';
    /* Publicando: el logotipo envía señal a la nube (versión pequeña; no se recrea mientras dura, así no se reinicia) */
    const pub = st.role === 'write' && !warn && (st.phase === 'publicando' || st.phase === 'archivos');
    pill.className = 'sync-pill' + (warn ? ' warn' : '') + (pub ? ' pub' : '');
    if (pub) { if (!pill.querySelector('.ps-mini')) pill.innerHTML = `${signalMini()}<span></span>`; pill.lastElementChild.textContent = text; return; }
    pill.innerHTML = `${warn ? icon.alert : icon.cloud}<span>${esc(text)}</span>`;
  };
  drawPill();
  const unSync = sync.onSyncChange(drawPill);
  /* Avisos sin ver: llegadas y salidas nuevas + documentos vencidos o por vencer en 7 días (hasta abrir Avisos ese día) */
  const bell = root.querySelector('[data-bell]'), bn = root.querySelector('[data-bell-n]');
  const drawBell = () => { const n = al.unseenCount(); bn.hidden = !n; bn.textContent = n > 99 ? '99+' : String(n); bell.setAttribute('aria-label', n ? `Avisos: ${n} sin ver` : 'Avisos'); };
  drawBell();
  const unAl = al.onAlertsChange(drawBell), unUn = onUnitsChange(drawBell);
  s.cleanup = () => { unSync(); unCov(); unAl(); unUn(); unOrd(); if (typeof unOps === 'function') unOps(); };
  on(root, 'click', '[data-new]', (e, b) => (b.dataset.new === 'puerto' ? startPuerto() : startCampo()));
  on(root, 'click', '[data-continue]', (e, b) => { const d = pend.find((x) => x.id === b.dataset.continue); if (d) go(draftRoute(d)); });
  on(root, 'click', '[data-discard]', async (e, b) => {
    const d = pend.find((x) => x.id === b.dataset.discard);
    if (!d || !(await confirmDestructive('¿Descartar el documento sin terminar?', `Folio ${d.data.folio}. Se perderá la información capturada y sus fotos.`, 'Descartar'))) return;
    await discardDraft(d.id); b.closest('.draft-card').remove();
  });
  return s;
}
