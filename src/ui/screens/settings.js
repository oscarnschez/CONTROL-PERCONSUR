/* Ajustes: apariencia, empresa, datos (respaldo), catálogos y aplicación. */
import { screen, on } from '../../core/dom.js';
import { go, back } from '../../core/router.js';
import { themePref, setTheme } from '../../services/theme.js';
import { getCompany, getOverrides, saveOverrides, resetCompany } from '../../services/companies.js';
import { exportBackup, inspectBackup, importBackup } from '../../services/backup.js';
import { clearDraftCache } from '../../services/drafts.js';
import { getSetting } from '../../services/settings.js';
import { isStandalone, offlineStatus, storageInfo, persistStorage, checkForUpdate, applyUpdate } from '../../services/pwa.js';
import { shareFile, downloadBlob, isIOS } from '../../services/share.js';
import { COMPANY_DEFAULTS, PUERTO_COMPANIES, EDITABLE_FIELDS } from '../../config/companies.js';
import { APP_VERSION, APP_BUILD } from '../../config/reference.js';
import { copyrightText, LEGAL_LINKS, appBadge } from '../../config/legal.js';
import { esc, fmtSize } from '../../domain/shared/format.js';
import { icon } from '../components/icons.js';
import { soundsOn, setSoundsOn, preload, play } from '../../services/sounds.js';
import { openSheet, actionSheet, busy } from '../components/sheet.js';
import { toast } from '../components/toast.js';
import { currentSession, logout } from '../../auth/gate.js';
import { configured as gpsConfigured } from '../../services/gps.js';
import { role as syncRole } from '../../services/sync.js';
import { roleText } from '../../domain/sync/sync.js';

export async function settingsScreen() {
  const th = themePref();
  const ses = currentSession();
  const mig = getSetting('legacyMigrated');
  const sr = syncRole();
  const s = screen(`<div class="page">
    <header class="page-top"><h1 class="title">Ajustes</h1></header>
    <section class="grp"><div class="grp-h"><h3>Apariencia</h3></div><div class="grp-b">
      <div class="seg wide">${[['system', 'Sistema'], ['light', 'Claro'], ['dark', 'Oscuro']].map(([v, l]) => `<button type="button" class="seg-b${th === v ? ' on' : ''}" data-theme-v="${v}">${l}</button>`).join('')}</div>
      <label class="sw-row snd-row"><span class="sw-tx">Sonidos<small>Al abrir la app, al confirmar una acción y al publicar o recibir la información.</small></span><input type="checkbox" switch class="sw" data-sound${soundsOn() ? ' checked' : ''}></label>
    </div></section>
    <section class="grp"><div class="grp-h"><h3>Empresa</h3></div><div class="grp-b list-actions">
      ${PUERTO_COMPANIES.map((k) => { const c = getCompany(k); return `<a class="row-btn" href="#/ajustes/empresa/${k}"><span class="co-logo sm ${c.mark ? 'mark' : 'wide'}"><img src="${esc(c.logo)}" alt=""></span><span>${esc(c.legal)}</span><small>Serie ${esc(c.folioSerie)}</small>${icon.chev}</a>`; }).join('')}
    </div></section>
    <section class="grp"><div class="grp-h"><h3>Integraciones</h3></div><div class="grp-b list-actions">
      <a class="row-btn" href="#/ajustes/gps">${icon.pin}<span>Rastreo GPS (IOPGPS)</span><small>${gpsConfigured() ? 'Configurado' : 'Sin configurar'}</small>${icon.chev}</a>
      <a class="row-btn" href="#/ajustes/avisos">${icon.bell}<span>Avisos</span><small>Vencimientos, llegadas y salidas</small>${icon.chev}</a>
      <a class="row-btn" href="#/ajustes/compartir">${icon.people}<span>Información compartida</span><small>${esc(roleText(sr))}</small>${icon.chev}</a>
    </div></section>
    <section class="grp"><div class="grp-h"><h3>Datos</h3></div><div class="grp-b list-actions">
      <button type="button" class="row-btn" data-a="export">${icon.download}<span>Exportar respaldo</span>${icon.chev}</button>
      ${sr === 'read' ? '' : `<label class="row-btn">${icon.upload}<span>Importar respaldo</span>${icon.chev}<input type="file" accept="application/json,.json" hidden data-import></label>`}
      <div class="row-info" data-storage>${icon.info}<span>Calculando almacenamiento…</span></div>
    </div>
    <p class="grp-note">${sr === 'read' ? 'Este dispositivo es de consulta: muestra la información que publica el capturista.' : sr === 'write' ? 'Los documentos, fotos y catálogos se guardan en este dispositivo y se publican para los dispositivos de consulta. Exporta un respaldo con regularidad.' : 'Los documentos, fotos y catálogos se guardan solo en este dispositivo. Exporta un respaldo con regularidad.'}${mig && mig.found ? ' Los datos del sistema anterior se migraron automáticamente.' : ''}</p></section>
    <section class="grp"><div class="grp-h"><h3>Aplicación</h3></div><div class="grp-b list-actions">
      <div class="row-info" data-offline>${icon.cloudOff}<span>Revisando uso sin conexión…</span></div>
      ${isStandalone() ? '' : `<button type="button" class="row-btn" data-a="install">${icon.phone}<span>Instalar en la pantalla de inicio</span>${icon.chev}</button>`}
      <button type="button" class="row-btn" data-a="update">${icon.refresh}<span>Buscar actualización</span>${icon.chev}</button>
    </div></section>
    <section class="grp"><div class="grp-h"><h3>Sesión</h3></div><div class="grp-b list-actions">
      <div class="row-info">${icon.person}<span>${esc(ses ? ses.name : '')}${ses ? ` | usuario ${esc(ses.user)}` : ''}</span></div>
      <button type="button" class="row-btn danger" data-a="logout">${icon.back}<span>Cerrar sesión</span></button>
    </div><p class="grp-note">La sesión termina al cerrar la app o después de 12 horas. Los borradores se guardan antes de salir.</p></section>
    <section class="grp"><div class="grp-h"><h3>Información legal</h3></div><div class="grp-b list-actions" data-legal>
      ${LEGAL_LINKS.map(([h, t, ic]) => `<a class="row-btn" href="./legal.html#${h}" target="_blank" rel="noopener">${icon[ic]}<span>${t}</span>${icon.chev}</a>`).join('')}
    </div></section>
    <footer class="about">${appBadge()}<img src="./assets/brand/perconsur-mark.png" alt=""><b class="wordmark sm">PERCONSUR</b><span>Versión ${APP_VERSION}</span><small>Compilación ${APP_BUILD}</small><small class="legal-copy">${copyrightText()}</small></footer>
  </div>`);
  const root = s.el;
  root.querySelector('[data-sound]').addEventListener('change', (e) => { setSoundsOn(e.target.checked); if (e.target.checked) { preload(); play('confirm'); } });
  on(root, 'click', '[data-theme-v]', async (e, b) => { await setTheme(b.dataset.themeV); root.querySelectorAll('[data-theme-v]').forEach((x) => x.classList.toggle('on', x === b)); });
  on(root, 'click', '[data-a]', async (e, b) => {
    const a = b.dataset.a;
    if (a === 'export') {
      const v = await actionSheet({ title: 'Exportar respaldo', message: 'Archivo JSON con catálogos, folios, configuración, borradores y documentos.', actions: [
        { label: 'Solo datos', sub: 'Ligero; sin los PDF, fotos ni documentos adicionales de viajes', value: 'data', style: 'primary' },
        { label: 'Completo', sub: 'Incluye PDF, fotografías y documentos adicionales de viajes (puede ser pesado)', value: 'full' }] });
      if (!v) return;
      busy(true, 'Preparando respaldo…');
      let f;
      try { f = await exportBackup({ includeMedia: v === 'full' }); } catch (err) { busy(false); toast('No se pudo crear el respaldo.', { type: 'warn' }); return; }
      busy(false);
      /* La hoja de compartir necesita un toque nuevo después de preparar el archivo */
      const sh = openSheet({ title: 'Respaldo listo', body: `<p class="sheet-lead">${esc(f.name)} | ${fmtSize(f.size)}</p><button type="button" class="btn-primary block" data-go>${icon.share}<span>${isIOS() ? 'Guardar o compartir' : 'Descargar'}</span></button>` });
      sh.body.querySelector('[data-go]').addEventListener('click', async () => {
        const r = await shareFile(f, { title: f.name });
        if (r === 'unsupported' || r === 'error') downloadBlob(f, f.name);
        if (r !== 'cancelled') { sh.close(); toast('Respaldo exportado'); }
      });
    }
    if (a === 'logout') {
      const v = await actionSheet({ title: 'Cerrar sesión', message: 'Se pedirá usuario y contraseña para volver a entrar. Tus borradores quedan guardados.', actions: [{ label: 'Cerrar sesión', value: true, style: 'destructive' }] });
      if (v) await logout();
      return;
    }
    if (a === 'install') openSheet({ title: 'Instalar PERCONSUR', body: `<ol class="steps-list"><li>Abre esta página en <b>Safari</b>.</li><li>Toca <b>Compartir</b> ${icon.share} en la barra inferior.</li><li>Elige <b>Añadir a pantalla de inicio</b> y confirma con <b>Añadir</b>.</li></ol><p class="grp-note">Se abrirá como una app, sin la barra de Safari, y funcionará sin conexión.</p>` });
    if (a === 'update') {
      if (!navigator.onLine) { toast('Sin conexión. Intenta más tarde.', { type: 'info' }); return; }
      const has = await checkForUpdate();
      if (has) toast('Hay una nueva versión disponible', { type: 'info', action: { label: 'Actualizar', fn: applyUpdate } });
      else toast('Ya tienes la versión más reciente');
    }
  });
  const imp = root.querySelector('[data-import]');
  if (imp) imp.addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
    let info;
    try { info = await inspectBackup(f); } catch (err) { toast(err.message, { type: 'warn', ms: 5000 }); return; }
    const v = await actionSheet({ title: 'Importar respaldo', html: `<ul class="as-list">${info.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul><p>Se combinará con tus datos actuales; no se borra nada.</p>`, actions: [{ label: 'Importar', value: true, style: 'primary' }] });
    if (!v) return;
    busy(true, 'Importando…');
    try { await importBackup(info); clearDraftCache(); busy(false); toast('Datos importados'); go('/', { replace: true }); }
    catch (err) { busy(false); console.error(err); toast('No se pudo importar el respaldo.', { type: 'warn' }); }
  });
  s.mounted = async () => {
    const st = await storageInfo();
    const se = root.querySelector('[data-storage]');
    if (se) se.innerHTML = `${icon.info}<span>${st.usage != null ? `Espacio usado: ${fmtSize(st.usage)}` : 'Espacio usado: no disponible'}${st.persisted ? ' | Almacenamiento protegido' : ''}</span>${st.persisted ? '' : '<button type="button" class="btn-ghost sm" data-persist>Proteger</button>'}`;
    const pb = root.querySelector('[data-persist]');
    if (pb) pb.addEventListener('click', async () => { const ok = await persistStorage(); toast(ok ? 'El navegador conservará los datos de la app' : 'El navegador no permitió protegerlo; instala la app en la pantalla de inicio.', { type: ok ? 'ok' : 'info', ms: 4000 }); });
    const os = await offlineStatus();
    const oe = root.querySelector('[data-offline]');
    if (oe) oe.innerHTML = `${os.ready ? icon.check : icon.cloudOff}<span>${os.ready ? 'Lista para trabajar sin conexión' : 'Abre la app una vez con conexión para preparar el uso sin conexión'}</span>`;
  };
  return s;
}

export async function companyScreen({ key }) {
  if (!COMPANY_DEFAULTS[key]) { go('/ajustes', { replace: true }); return null; }
  const c = getCompany(key), o = getOverrides(key), base = COMPANY_DEFAULTS[key];
  const s = screen(`<div class="page">
    <header class="nav-top"><button type="button" class="nav-back" data-back>${icon.back}<span>Ajustes</span></button></header>
    <div class="co-hero" style="--c1:${esc(c.colors.c1)};--c2:${esc(c.colors.c2)}"><span class="co-logo lg ${c.mark ? 'mark' : 'wide'}"><img src="${esc(c.logo)}" alt=""></span>
      <div class="co-sw"><i style="background:${esc(c.colors.c1)}"></i><i style="background:${esc(c.colors.c2)}"></i><small>${key === 'campo' ? 'Folio AU aleatorio' : 'Serie de folio ' + esc(c.folioSerie)}</small></div></div>
    <p class="page-lead">Estos datos aparecen en el encabezado y el pie de los documentos${key === 'campo' ? ' de División Campo' : ''}. El logotipo, los colores y la serie de folio son fijos.</p>
    <form class="grp co-form"><div class="grp-b">
      ${EDITABLE_FIELDS.map(([f, l]) => `<label class="fld"><span class="fl">${esc(l)}</span><input class="in" name="${f}" value="${esc(c[f] || '')}" placeholder="${esc(base[f] || '')}" autocomplete="off" ${f === 'email' ? 'type="email" inputmode="email" autocapitalize="none"' : f === 'web' ? 'inputmode="url" autocapitalize="none"' : ''}></label>`).join('')}
    </div>
    <button type="submit" class="btn-primary block">Guardar cambios</button>
    ${Object.keys(o).length ? '<button type="button" class="btn-ghost block" data-reset>Restablecer valores originales</button>' : ''}</form>
  </div>`);
  on(s.el, 'click', '[data-back]', () => back('/ajustes'));
  s.el.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries()), next = {};
    for (const [f] of EDITABLE_FIELDS) { const v = String(fd[f] || '').trim(); if (v !== (base[f] || '')) next[f] = v; }
    if (!next.legal && fd.legal === '') { toast('La razón social no puede quedar vacía', { type: 'warn' }); return; }
    await saveOverrides(key, next); toast('Datos de la empresa guardados'); back('/ajustes');
  });
  const rb = s.el.querySelector('[data-reset]');
  if (rb) rb.addEventListener('click', async () => {
    const v = await actionSheet({ title: 'Restablecer datos de la empresa', message: 'Se usarán los valores originales del sistema.', actions: [{ label: 'Restablecer', value: true, style: 'destructive' }] });
    if (!v) return; await resetCompany(key); toast('Valores originales restablecidos'); back('/ajustes');
  });
  return s;
}
