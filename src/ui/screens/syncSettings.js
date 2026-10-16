/*
 * Ajustes → Información compartida (#/ajustes/compartir)
 *   Conecta este dispositivo con el espacio compartido del Worker: con la clave de CAPTURISTA publica su información;
 *   con la de CONSULTA recibe la del capturista y queda en modo solo consulta.
 *   Estado (última publicación o recepción, pendientes, archivos) y la decisión cuando la nube tiene información de
 *   otro dispositivo.
 */
import { screen, on } from '../../core/dom.js';
import { back } from '../../core/router.js';
import * as sync from '../../services/sync.js';
import { getSetting } from '../../services/settings.js';
import { roleText, whenText, sizeText, byText } from '../../domain/sync/sync.js';
import { esc } from '../../domain/shared/format.js';
import { icon } from '../components/icons.js';
import { toast } from '../components/toast.js';
import { actionSheet } from '../components/sheet.js';
import { signalStage } from '../components/publishSignal.js';

/* La animación de publicar se ve al menos este tiempo (una publicación rápida no parpadea) y luego la palomita */
const SIGNAL_MIN = 1200, SIGNAL_DONE = 1800;

export async function syncSettingsScreen() {
  const c = sync.config();
  const s = screen(`<div class="page gps-set sync-set">
    <header class="nav-top"><button type="button" class="nav-back" data-back>${icon.back}<span>Ajustes</span></button></header>
    <h1 class="title">Información compartida</h1>
    <p class="page-lead">Un solo dispositivo captura la información y los demás la consultan al día, sin importar respaldos. Viaja por el mismo intermediario de Cloudflare (Worker) que el GPS.</p>
    <section class="grp"><div class="grp-h"><h3>Estado</h3></div><div class="grp-b">
      <div class="ps-wrap" data-ps hidden>${signalStage()}<p class="ps-cap" data-pscap role="status"></p></div>
      <div data-state></div></div></section>
    <div data-decide></div>
    <section class="grp"><div class="grp-h"><h3>Conexión</h3></div><div class="grp-b">
      <form data-cfg novalidate>
        <label class="fld"><span class="fl">Dirección del intermediario</span><input class="in" name="url" type="url" inputmode="url" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="https://perconsur-gps.….workers.dev" value="${esc(c.url || getSetting('gpsUrl', ''))}" enterkeyhint="next"></label>
        <label class="fld"><span class="fl">Clave de acceso a la información</span><span class="in-w"><input class="in" name="key" type="password" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" value="${esc(c.key)}" enterkeyhint="next"><button type="button" class="in-act" data-show aria-label="Mostrar clave">${icon.eye}</button></span>
          <span class="fhint">La clave de capturista (DATA_WRITE_KEY) publica; la de consulta (DATA_READ_KEY) solo permite ver; la de Taller (DATA_TALLER_KEY) recibe y captura solo Taller. Se guarda solo en este dispositivo y no se incluye en los respaldos.</span></label>
        <label class="fld"><span class="fl">Nombre de este dispositivo <small>(opcional)</small></span><input class="in" name="name" maxlength="40" autocomplete="off" placeholder="p. ej. Oficina – iPad" value="${esc(c.name)}" enterkeyhint="done"></label>
        <p class="gps-st" data-st></p>
        <div class="sheet-acts"><button type="button" class="btn-secondary" data-test>${icon.refresh}<span>Probar</span></button><button type="submit" class="btn-primary">Guardar</button></div>
      </form>
    </div></section>
    <div data-off></div>
    <p class="grp-note">Se comparten catálogos, documentos y sus PDF, Logística, Control de vacíos, Combustible, Control de operadores y Cobranza. No se comparten los borradores, el tema ni las claves de cada dispositivo. Para ver el GPS en un dispositivo de consulta, captura también su conexión en Ajustes → Rastreo GPS.</p>
  </div>`);
  const root = s.el, form = root.querySelector('[data-cfg]');
  const setSt = (html, cls = '') => { const p = root.querySelector('[data-st]'); p.className = 'gps-st ' + cls; p.innerHTML = html; };
  const line = (ic, text, cls = '') => `<p class="gps-st ${cls}">${ic}<span>${text}</span></p>`;
  const pubText = (m) => (m ? `${esc(whenText(m.at))}${m.by ? ` por ${esc(byText(m.by))}` : ''} · ${esc(sizeText(m.size))}${m.files ? ` · ${m.files} archivo${m.files === 1 ? '' : 's'}` : ''}` : '');

  function drawState() {
    const st = sync.status(), box = root.querySelector('[data-state]');
    const prog = st.progress ? ` ${st.progress.done}/${st.progress.total}` : '';
    const phase = st.phase === 'archivos' ? (st.role === 'write' || st.role === 'taller' ? 'Subiendo o descargando archivos' : 'Descargando archivos') + prog
      : st.phase === 'publicando' ? 'Publicando información…' : st.phase === 'recibiendo' ? 'Recibiendo información…' : '';
    let html = `<div class="sync-role"><span class="st ${st.role ? 'st-generado' : ''}">${roleText(st.role)}</span>${st.role === 'read' ? '<span class="sync-ro">Solo consulta</span>' : st.role === 'taller' ? '<span class="sync-ro">Solo Taller</span>' : ''}</div>`;
    if (!st.role) html += line(icon.info, 'Este dispositivo no comparte información. Escribe la dirección y la clave, y pulsa Guardar.');
    if (st.role === 'write') {
      html += st.at && st.remote && st.remote.ver === st.ver ? line(icon.check, `Publicado ${pubText(st.remote)}`, 'ok')
        : st.at ? line(icon.check, `Publicado ${esc(whenText(st.at))}`, 'ok') : line(icon.info, 'Todavía no se publica la información de este dispositivo.');
      if (st.dirty && !phase) html += line(icon.clock, 'Hay cambios pendientes de publicar: se publican solos en unos segundos (o pulsa Publicar ahora).');
      if (st.pendingFiles && !phase) html += line(icon.alert, `${st.pendingFiles} archivo${st.pendingFiles === 1 ? '' : 's'} por subir; se reintenta solo.`, 'warn');
      if (st.fileError) html += line(icon.alert, `Archivos: ${esc(st.fileError)}`, 'warn');
      if (st.taller && st.taller.enabled) html += line(icon.wrench, `Sección Taller activa: los cambios del teléfono de Taller se aplican aquí y se publican solos${st.taller.published ? ` · parte de Taller publicada ${esc(whenText(st.taller.published.at))}` : ''}.`, 'ok');
      if (st.tallerError) html += line(icon.alert, `Taller: ${esc(st.tallerError)}`, 'warn');
    }
    if (st.role === 'taller') {
      html += st.ver && st.at ? line(icon.check, `Información de Taller recibida ${esc(whenText(st.at))}`, 'ok')
        : st.remote === null && st.checkedAt ? line(icon.info, 'El capturista todavía no publica la información de Taller (se publica sola cuando abra la app con la clave de Taller activa).') : line(icon.refresh, 'Esperando la información de Taller…');
      html += st.tallerPending ? line(icon.clock, `${st.tallerPending} cambio${st.tallerPending === 1 ? '' : 's'} enviado${st.tallerPending === 1 ? '' : 's'} o por enviar: aparecen en los demás dispositivos cuando el capturista los aplica (la próxima vez que abra la app).`)
        : line(icon.check, 'Todo lo capturado aquí ya está en la información compartida.', 'ok');
      if (st.fileError) html += line(icon.alert, esc(st.fileError), 'warn');
    }
    if (st.role === 'read') {
      html += st.ver && st.at ? line(icon.check, `Información recibida ${esc(whenText(st.at))}${st.remote && st.remote.ver === st.ver ? ` · publicada ${pubText(st.remote)}` : ''}`, 'ok')
        : st.remote === null && st.checkedAt ? line(icon.info, 'El capturista todavía no publica información.') : line(icon.refresh, 'Esperando la información del capturista…');
      if (st.pendingFiles && !phase) html += line(icon.alert, `${st.pendingFiles} archivo${st.pendingFiles === 1 ? '' : 's'} por descargar; se reintenta solo.`, 'warn');
    }
    /* Al publicar, el estado lo da la animación de señal (drawSignal); al recibir, una línea */
    if (phase && !publishingNow(st)) html += line(icon.refresh, esc(phase), 'busy');
    if (st.error) html += line(icon.alert, esc(st.error), 'warn');
    const deciding = st.role === 'write' && (st.conflict || sync.needsDecision());
    if (st.role === 'taller') html += `<div class="sheet-acts col"><button type="button" class="btn-primary" data-tsync${st.phase ? ' disabled' : ''}>${icon.refresh}<span>Enviar y revisar ahora</span></button></div>`;
    else if (st.role && !deciding) html += `<div class="sheet-acts col">${st.role === 'write' ? `<button type="button" class="btn-primary" data-pub${st.phase ? ' disabled' : ''}>${icon.cloud}<span>Publicar ahora</span></button>` : `<button type="button" class="btn-primary" data-pull${st.phase ? ' disabled' : ''}>${icon.refresh}<span>Revisar ahora</span></button>`}</div>`;
    box.innerHTML = html;
    drawSignal(st);
    drawDecision();
    root.querySelector('[data-off]').innerHTML = st.role ? `<section class="grp"><div class="grp-b list-actions"><button type="button" class="row-btn danger" data-off-btn>${icon.linkOff}<span>Dejar de compartir en este dispositivo</span></button></div></section>` : '';
  }
  /*
   * Publicando: el logotipo emite señal a la nube. Es un elemento fijo (no se vuelve a crear en cada cambio de estado,
   * así la animación no se reinicia con el avance de los archivos). Al terminar sin error, la nube muestra la palomita.
   */
  const publishingNow = (st) => st.role === 'write' && (st.phase === 'publicando' || st.phase === 'archivos');
  let signalSince = 0, signalTimer = null;
  function drawSignal(st) {
    const wrap = root.querySelector('[data-ps]'), stage = wrap.querySelector('.ps-stage'), cap = wrap.querySelector('[data-pscap]');
    if (publishingNow(st)) {
      clearTimeout(signalTimer); signalTimer = null;
      if (wrap.hidden || stage.classList.contains('ps-done')) { signalSince = performance.now(); stage.classList.remove('ps-done'); wrap.hidden = false; }
      cap.textContent = st.phase === 'archivos' ? `Subiendo archivos${st.progress ? ` ${st.progress.done}/${st.progress.total}` : ''}…` : 'Publicando información…';
      return;
    }
    if (wrap.hidden || stage.classList.contains('ps-done') || signalTimer) return;
    const finish = () => {
      const now = sync.status();
      if (now.error || now.conflict) { wrap.hidden = true; signalTimer = null; return; }
      stage.classList.add('ps-done'); cap.textContent = 'Información publicada';
      signalTimer = setTimeout(() => { wrap.hidden = true; stage.classList.remove('ps-done'); signalTimer = null; }, SIGNAL_DONE);
    };
    signalTimer = setTimeout(finish, Math.max(0, SIGNAL_MIN - (performance.now() - signalSince)));
  }
  /* Capturista: la nube tiene información de otro dispositivo */
  function drawDecision() {
    const st = sync.status(), box = root.querySelector('[data-decide]');
    const m = st.conflict || (sync.needsDecision() ? st.remote : null);
    if (st.role !== 'write' || !m) { box.innerHTML = ''; return; }
    box.innerHTML = `<section class="grp sync-dec"><div class="grp-h"><h3>Decide qué información queda</h3></div><div class="grp-b">
      ${line(icon.alert, `La nube ya tiene información publicada desde otro dispositivo${m.at ? ` (${pubText(m)})` : ''}. Mientras no elijas, este dispositivo no publica.`, 'warn')}
      <div class="sync-dec-acts"><button type="button" class="btn-primary block" data-adopt${st.phase ? ' disabled' : ''}>${icon.download}<span>Recibir la de la nube en este dispositivo</span></button>
      <button type="button" class="btn-secondary block" data-replace${st.phase ? ' disabled' : ''}>${icon.upload}<span>Reemplazar la de la nube con la de este dispositivo</span></button></div>
      <p class="grp-note">Recibir: este dispositivo queda igual que la nube y sigue publicando desde ahí (por ejemplo, al cambiar de teléfono). Reemplazar: los dispositivos de consulta verán la información de este dispositivo.</p>
    </div></section>`;
  }

  async function save() {
    const url = form.elements.url.value.trim(), key = form.elements.key.value.trim(), name = form.elements.name.value.trim();
    if (!url || !key) { toast('Escribe la dirección y la clave.', { type: 'warn' }); return; }
    if (!/^https:\/\/[^\s/]+/i.test(url)) { toast('La dirección debe empezar con https://', { type: 'warn' }); return; }
    setSt(`${icon.refresh}<span>Comprobando…</span>`);
    let t;
    try { t = await sync.test(url, key); } catch (e) { setSt(`${icon.alert}<span>${esc(e.message)}</span>`, 'warn'); return; }
    const wasRole = sync.role();
    if (t.role === 'taller' && wasRole !== 'taller') {
      const ok = await actionSheet({ title: 'Este dispositivo será de Taller', message: 'Recibirá solo la información de Taller (unidades, remolques y mantenimiento) y enviará lo que se capture en Taller. Lo demás que tenga guardado este dispositivo se reemplaza por la información de Taller.', actions: [{ label: 'Continuar', value: true, style: 'primary' }] });
      if (!ok) { setSt(''); return; }
    }
    if (t.role === 'read' && wasRole !== 'read') {
      const ok = await actionSheet({ title: 'Este dispositivo será de consulta', message: 'Mostrará la información que publica el capturista y no podrá capturar ni modificar. Lo que tenga guardado en este dispositivo se reemplazará por la información compartida.', actions: [{ label: 'Continuar', value: true, style: 'primary' }] });
      if (!ok) { setSt(''); return; }
    }
    try { await sync.connect({ url, key, name }); } catch (e) { setSt(`${icon.alert}<span>${esc(e.message)}</span>`, 'warn'); return; }
    setSt(`${icon.check}<span>Guardado · ${roleText(t.role)}</span>`, 'ok');
    toast(t.role === 'write' ? 'Este dispositivo es el capturista' : t.role === 'taller' ? 'Este dispositivo es de Taller' : 'Este dispositivo es de consulta');
    drawState();
    if (t.role === 'read' || t.role === 'taller') sync.receive({ force: true });
    else if (!sync.needsDecision()) sync.publishAll();
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  on(root, 'click', '[data-show]', (e, b) => { const i = form.elements.key; i.type = i.type === 'password' ? 'text' : 'password'; b.classList.toggle('on', i.type === 'text'); });
  on(root, 'click', '[data-test]', async () => {
    const url = form.elements.url.value.trim(), key = form.elements.key.value.trim();
    if (!url || !key) { toast('Escribe la dirección y la clave.', { type: 'warn' }); return; }
    setSt(`${icon.refresh}<span>Probando…</span>`);
    try {
      const t = await sync.test(url, key);
      setSt(`${icon.check}<span>Conexión correcta · clave de ${t.role === 'write' ? 'capturista' : t.role === 'taller' ? 'Taller' : 'consulta'}${t.published ? ` · información publicada ${pubText(t.published)}` : ' · todavía sin información publicada'}. Pulsa Guardar.</span>`, 'ok');
    } catch (err) { setSt(`${icon.alert}<span>${esc(err.message)}</span>`, 'warn'); }
  });
  on(root, 'click', '[data-pub]', async () => { const ok = await sync.publish({ manual: true }); if (ok) toast('Información publicada'); });
  on(root, 'click', '[data-tsync]', async () => { await sync.publish({ manual: true }); await sync.receive({ force: true }); if (!sync.status().error) toast('Taller al día'); });
  on(root, 'click', '[data-pull]', async () => { await sync.receive({ force: true }); if (!sync.status().error) toast('Información al día'); });
  on(root, 'click', '[data-adopt]', async () => {
    const ok = await actionSheet({ title: '¿Recibir la información de la nube?', message: 'Los registros de este dispositivo (catálogos, documentos, Logística…) se reemplazarán por los de la nube. Los borradores se conservan.', actions: [{ label: 'Recibir', value: true, style: 'destructive' }] });
    if (!ok) return;
    await sync.receive({ asWriter: true });
    if (!sync.status().error) toast('Información recibida; este dispositivo publica desde ahora');
  });
  on(root, 'click', '[data-replace]', async () => {
    const ok = await actionSheet({ title: '¿Reemplazar la información de la nube?', message: 'Los dispositivos de consulta verán la información de este dispositivo. La que estaba en la nube se pierde.', actions: [{ label: 'Reemplazar', value: true, style: 'destructive' }] });
    if (!ok) return;
    if (await sync.publishAll({ force: true })) toast('Información publicada');
  });
  on(root, 'click', '[data-off-btn]', async () => {
    const r = sync.role();
    const ok = await actionSheet({ title: 'Dejar de compartir', message: r === 'read' ? 'La información recibida se queda en este dispositivo, pero ya no se actualizará y se podrá modificar aquí.' : 'Este dispositivo deja de publicar. Lo que ya está en la nube se conserva para los dispositivos de consulta.', actions: [{ label: 'Dejar de compartir', value: true, style: 'destructive' }] });
    if (!ok) return;
    await sync.disconnect(); form.elements.key.value = ''; setSt(''); toast('Este dispositivo ya no comparte información'); drawState();
  });
  on(root, 'click', '[data-back]', () => back('/ajustes'));
  drawState();
  const un = sync.onSyncChange(drawState);
  s.cleanup = () => { un(); clearTimeout(signalTimer); };
  return s;
}
