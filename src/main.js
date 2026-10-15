/*
 * PERCONSUR — arranque de la aplicación (se carga solo después de iniciar sesión; ver src/auth/gate.js).
 * Orden: base de datos → ajustes/empresas/catálogos → migración del sistema anterior → rutas.
 */
import { startRouter, route, go, refresh } from './core/router.js';
import { openDB } from './services/db.js';
import { loadSettings, getSetting } from './services/settings.js';
import { loadCompanies } from './services/companies.js';
import { loadCatalogs, seedIfNeeded, seedYardsIfNeeded } from './services/catalogs.js';
import { loadOperatorData } from './services/operators.js';
import { operatorsScreen, operatorScreen, summaryScreen } from './ui/screens/operators.js';
import { statementScreen } from './ui/screens/statement.js';
import { adminScreen, operationScreen } from './ui/screens/hubs.js';
import { OPERATION_MODULES, ADMIN_MODULES } from './config/modules.js';
import { fuelScreen, fuelUnitScreen } from './ui/screens/fuel.js';
import { logisticsScreen, logisticsUnitScreen, logisticsHistoryScreen } from './ui/screens/logistics.js';
import { loadLogistics } from './services/logistics.js';
import { loadTripAttachments } from './services/tripAttachments.js';
import { loadEmpties } from './services/empties.js';
import { loadGeocodes } from './services/geocode.js';
import { emptiesScreen, emptyDetailScreen } from './ui/screens/empties.js';
import { fullsScreen, fullDetailScreen } from './ui/screens/fulls.js';
import { loadFulls } from './services/fulls.js';
import { gpsSettingsScreen } from './ui/screens/gpsSettings.js';
import { gpsMonitorScreen } from './ui/screens/gpsMonitor.js';
import { startTracking } from './services/tracking.js';
import { startAlerts } from './services/alerts.js';
import { alertsScreen, alertsSettingsScreen, geofencesScreen } from './ui/screens/alerts.js';
import { initSync, startSync } from './services/sync.js';
import { isReadOnly, READ_ONLY_TEXT } from './services/access.js';
import { reloadAll } from './services/backup.js';
import { syncSettingsScreen } from './ui/screens/syncSettings.js';
import { tripsMapScreen } from './ui/screens/tripsMap.js';
import { unitsScreen, unitAlertsScreen, unitReviewScreen, unitRequirementsScreen } from './ui/screens/units.js';
import { unitFileScreen } from './ui/screens/unitFile.js';
import { workshopScreen, workshopEquipmentScreen, workshopOrderScreen } from './ui/screens/workshop.js';
import { workshopOrderReportScreen, workshopEquipmentReportScreen } from './ui/screens/workshopReport.js';
import { loadMaintenance } from './services/maintenance.js';
import { seedTariffsIfNeeded } from './services/tariffs.js';
import { billingScreen } from './ui/screens/billing.js';
import { tripImportScreen } from './ui/screens/tripImport.js';
import { billingReportScreen } from './ui/screens/billingReport.js';
import { tariffSheetsScreen, tariffSheetScreen, tariffReportScreen } from './ui/screens/tariffs.js';
import { reconcileMirrors } from './services/drafts.js';
import { autoMigrate } from './services/migration.js';
import { applyTheme } from './services/theme.js';
import { registerSW, onUpdateReady, applyUpdate, warmCache } from './services/pwa.js';
import { tryLibs } from './services/libs.js';
import { icon } from './ui/components/icons.js';
import { closeSplash } from './ui/components/opening.js';
import { initScrollHints } from './ui/components/scrollHints.js';
import { copyrightShort } from './config/legal.js';
import { toast } from './ui/components/toast.js';
import { actionSheet } from './ui/components/sheet.js';
import { openNewSheet, draftRoute, discardDraft } from './ui/flows.js';
import { homeScreen, pendingDrafts } from './ui/screens/home.js';
import { documentsScreen } from './ui/screens/documents.js';
import { docDetailScreen } from './ui/screens/docDetail.js';
import { doneScreen } from './ui/screens/done.js';
import { catalogsScreen, catalogListScreen, isoScreen } from './ui/screens/catalogs.js';
import { settingsScreen, companyScreen } from './ui/screens/settings.js';
import { puertoWizard } from './ui/screens/puertoWizard.js';
import { campoWizard } from './ui/screens/campoWizard.js';
import { getCompany } from './services/companies.js';
import { APP_VERSION, APP_BUILD } from './config/reference.js';

/* Barra inferior */
function mountTabbar() {
  const nav = document.createElement('nav');
  nav.className = 'tabbar';
  nav.setAttribute('aria-label', 'Navegación principal');
  /* Celular: barra inferior de 5 secciones. Computadora (≥1024 px): la misma navegación como menú lateral, con el
     logotipo, «Nuevo» arriba, los módulos de cada sección y el aviso de derechos de autor al pie (tb-brand, tb-sub y
     tb-copy solo se muestran ahí). */
  const sub = (key, mods) => `<div class="tb-sub" data-sub="${key}">${mods.map((m) => `<a href="#${m.route}">${m.nav || m.title}</a>`).join('')}</div>`;
  nav.innerHTML = `
    <div class="tb-brand" aria-hidden="true"><img src="./assets/brand/perconsur-mark.png" alt=""><span class="wordmark">PERCONSUR</span></div>
    <a href="#/" data-tab="home">${icon.home}<span>Inicio</span></a>
    <a href="#/operacion" data-tab="op">${icon.gauge}<span>Operación</span></a>
    ${sub('op', OPERATION_MODULES)}
    <button type="button" class="tab-new" data-tab="new" aria-label="Nuevo documento"><span class="tab-plus">${icon.plus}</span><span>Nuevo</span></button>
    <a href="#/administracion" data-tab="admin" aria-label="Administración">${icon.briefcase}<span class="tl-l">Administración</span><span class="tl-s" aria-hidden="true">Admin.</span></a>
    ${sub('admin', ADMIN_MODULES)}
    <a href="#/ajustes" data-tab="settings">${icon.gear}<span>Ajustes</span></a>
    <p class="tb-copy">${copyrightShort()}</p>`;
  document.body.appendChild(nav);
  nav.querySelector('.tab-new').addEventListener('click', openNewSheet);
  window.addEventListener('routechange', (e) => {
    nav.querySelectorAll('[data-tab]').forEach((a) => { const on = a.dataset.tab === e.detail.tab; a.classList.toggle('on', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    const h = location.hash.split('?')[0];
    nav.querySelectorAll('.tb-sub a').forEach((a) => { const r = a.getAttribute('href'), on = h === r || h.startsWith(r + '/'); a.classList.toggle('on', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  });
}

/* Teclado abierto (iOS no cambia el tamaño del layout): se ocultan las barras fijas para que nada quede debajo */
function watchKeyboard() {
  const vv = window.visualViewport; if (!vv) return;
  const root = document.documentElement;
  const check = () => {
    const open = window.innerHeight - vv.height > 140 && !!document.activeElement && document.activeElement.matches('input,textarea,select');
    root.classList.toggle('kb-open', open);
  };
  vv.addEventListener('resize', check);
  document.addEventListener('focusin', (e) => {
    setTimeout(check, 50);
    const t = e.target;
    if (t.matches('input.in,textarea.in') && root.classList.contains('kb-open') || /iP(hone|od)/.test(navigator.userAgent)) {
      setTimeout(() => { if (document.activeElement === t) t.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 320);
    }
  });
  document.addEventListener('focusout', () => setTimeout(check, 80));
}

/* Pantallas de captura (documentos nuevos, estados de cuenta, importar viajes): no se abren en modo solo consulta */
const capture = (handler) => (params, q) => {
  if (!isReadOnly()) return handler(params, q);
  toast(READ_ONLY_TEXT, { type: 'warn', ms: 3500 });
  go('/', { replace: true });
  return null;
};

function routes() {
  route('/', homeScreen, { name: 'home', tabs: true, tab: 'home' });
  route('/administracion', adminScreen, { name: 'admin', tabs: true, tab: 'admin' });
  route('/operacion', operationScreen, { name: 'op', tabs: true, tab: 'op' });
  route('/operacion/logistica', logisticsScreen, { name: 'op', tabs: true, tab: 'op' });
  route('/operacion/logistica/historial', logisticsHistoryScreen, { name: 'op', tabs: true, tab: 'op' });
  route('/operacion/logistica/u/:id', logisticsUnitScreen, { name: 'op', tabs: true, tab: 'op' });
  route('/operacion/logistica/monitoreo', gpsMonitorScreen, { name: 'monitor', tabs: true, tab: 'op' });
  route('/operacion/logistica/vacios', emptiesScreen, { name: 'op', tabs: true, tab: 'op' });
  route('/operacion/logistica/vacios/:id', emptyDetailScreen, { name: 'op', tabs: true, tab: 'op' });
  route('/operacion/logistica/llenos', fullsScreen, { name: 'op', tabs: true, tab: 'op' });
  route('/operacion/logistica/llenos/:id', fullDetailScreen, { name: 'op', tabs: true, tab: 'op' });
  route('/operacion/mapa', tripsMapScreen, { name: 'op', tabs: true, tab: 'op' });
  route('/operacion/taller', workshopScreen, { name: 'op', tabs: true, tab: 'op' });
  route('/operacion/taller/equipo/:type/:id', workshopEquipmentScreen, { name: 'op', tabs: true, tab: 'op' });
  route('/operacion/taller/orden/:id', workshopOrderScreen, { name: 'op', tabs: true, tab: 'op' });
  route('/operacion/taller/reporte/:id', workshopOrderReportScreen, { name: 'wizard' });
  route('/operacion/taller/reporte-equipo/:type/:id', workshopEquipmentReportScreen, { name: 'wizard' });
  route('/operacion/combustible', fuelScreen, { name: 'op', tabs: true, tab: 'op' });
  route('/operacion/combustible/:id', fuelUnitScreen, { name: 'op', tabs: true, tab: 'op' });
  route('/documentos', documentsScreen, { name: 'docs', tabs: true, tab: 'admin' });
  route('/doc/:id', docDetailScreen, { name: 'doc', tabs: true, tab: 'admin' });
  route('/listo/:id', doneScreen, { name: 'done' });
  route('/catalogos', catalogsScreen, { name: 'cat', tabs: true, tab: 'admin' });
  route('/catalogos/tipos', isoScreen, { name: 'cat', tabs: true, tab: 'admin' });
  route('/catalogos/:kind', catalogListScreen, { name: 'cat', tabs: true, tab: 'admin' });
  route('/operadores', operatorsScreen, { name: 'ops', tabs: true, tab: 'admin' });
  route('/operadores/importar', capture(tripImportScreen), { name: 'wizard' });
  route('/operadores/resumen', summaryScreen, { name: 'ops', tabs: true, tab: 'admin' });
  route('/operadores/:id', operatorScreen, { name: 'ops', tabs: true, tab: 'admin' });
  route('/operadores/:id/estado', capture(statementScreen), { name: 'wizard' });
  route('/unidades', unitsScreen, { name: 'units', tabs: true, tab: 'admin' });
  route('/unidades/vencimientos', unitAlertsScreen, { name: 'units', tabs: true, tab: 'admin' });
  route('/unidades/revision', unitReviewScreen, { name: 'units', tabs: true, tab: 'admin' });
  route('/unidades/requisitos', unitRequirementsScreen, { name: 'units', tabs: true, tab: 'admin' });
  route('/unidades/:id', unitFileScreen, { name: 'units', tabs: true, tab: 'admin' });
  route('/cobranza', billingScreen, { name: 'cob', tabs: true, tab: 'admin' });
  route('/cobranza/reporte', billingReportScreen, { name: 'wizard' });
  route('/tarifas', tariffSheetsScreen, { name: 'tar', tabs: true, tab: 'admin' });
  route('/tarifas/:id', tariffSheetScreen, { name: 'tar', tabs: true, tab: 'admin' });
  route('/tarifas/:id/pdf', tariffReportScreen, { name: 'wizard' });
  route('/tarifario', tariffSheetsScreen, { name: 'tar', tabs: true, tab: 'admin' });   /* dirección de la versión 1.21 */
  route('/ajustes', settingsScreen, { name: 'settings', tabs: true, tab: 'settings' });
  route('/ajustes/gps', gpsSettingsScreen, { name: 'settings', tabs: true, tab: 'settings' });
  route('/ajustes/avisos', alertsSettingsScreen, { name: 'settings', tabs: true, tab: 'settings' });
  route('/ajustes/avisos/geocercas', geofencesScreen, { name: 'settings', tabs: true, tab: 'settings' });
  route('/avisos', alertsScreen, { name: 'alerts', tabs: true, tab: 'home' });
  route('/ajustes/compartir', syncSettingsScreen, { name: 'settings', tabs: true, tab: 'settings' });
  route('/ajustes/empresa/:key', companyScreen, { name: 'settings', tabs: true, tab: 'settings' });
  route('/puerto/:company/:step', capture(puertoWizard), { name: 'wizard' });
  route('/campo/:step', capture(campoWizard), { name: 'wizard' });
}

/* "Tienes un documento sin terminar" al abrir la app */
async function offerRecovery() {
  const path = (location.hash.replace(/^#/, '') || '/');
  if (path !== '/' || isReadOnly()) return;
  const pend = await pendingDrafts();
  if (!pend.length) return;
  const d = pend[0], isP = d.type === 'puerto';
  const v = await actionSheet({
    title: 'Tienes un documento sin terminar',
    message: `${isP ? 'Nota de entrega | ' + getCompany(d.company).short : 'Asignación de unidades'} | Folio ${d.data.folio}${pend.length > 1 ? ` (y ${pend.length - 1} más en Inicio)` : ''}`,
    actions: [{ label: 'Continuar', value: 'go', style: 'primary' }, { label: 'Descartar', value: 'del', style: 'destructive' }],
    cancel: 'Ahora no',
  });
  if (v === 'go') go(draftRoute(d));
  if (v === 'del') { await discardDraft(d.id); go('/', { replace: true }); }
}

async function boot() {
  const splash = document.getElementById('splash');
  const t0 = performance.now();
  try {
    await openDB();
    await loadSettings();
    /* Información compartida: un dispositivo de consulta queda en solo lectura antes de cualquier otra escritura */
    initSync();
    applyTheme();
    await Promise.all([loadCompanies(), loadCatalogs(), loadOperatorData(), loadLogistics(), loadTripAttachments(), loadEmpties(), loadFulls(), loadGeocodes()]);
    /* Taller (disponibilidad «En taller» en Logística e Inicio) */
    await loadMaintenance(false, { withFuel: false });
    /* ¿Se acaba de instalar una versión nueva? (instalaciones previas a este aviso se reconocen por los catálogos ya sembrados) */
    let seen = null; try { seen = localStorage.getItem('pcs-version'); } catch (e) { /* */ }
    const updated = seen ? seen !== APP_VERSION : !!getSetting('seeded');
    try { localStorage.setItem('pcs-version', APP_VERSION); } catch (e) { /* */ }
    /* Siembra, borradores y migración escriben registros: no aplican en un dispositivo de consulta */
    const ro = isReadOnly();
    if (!ro) { await seedIfNeeded(); await seedYardsIfNeeded(); await seedTariffsIfNeeded(); await reconcileMirrors(); }
    const mig = ro ? null : await autoMigrate().catch((e) => { console.warn('migración', e); return null; });
    routes();
    mountTabbar();
    initScrollHints();
    watchKeyboard();
    startRouter(document.getElementById('view'));
    /* Rastreo para clientes: finaliza solo los enlaces de entregas terminadas (escucha Logística) */
    startTracking();
    /* Información compartida: el capturista publica sus cambios; la consulta recibe los del capturista */
    startSync();
    /* Avisos: publica al Worker lo que hay que vigilar y consulta llegadas y salidas (si el GPS está configurado) */
    startAlerts().catch((e) => console.warn('avisos', e));
    /* Aviso tocado con la app abierta: el service worker pide ir a la pantalla del aviso */
    if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.type === 'pcs-nav' && /^#\/[\w/?=&.-]*$/.test(e.data.hash || '')) location.hash = e.data.hash; });
    window.addEventListener('alerts:applied', (e) => toast(`Cambio automático por geocerca: ${(e.detail || []).join(' · ')}`, { type: 'info', ms: 6000 }));
    /* Una captura que llegó a la base en modo consulta: aviso y se descarta lo que quedó en memoria */
    window.addEventListener('unhandledrejection', (e) => {
      if (!e.reason || !e.reason.readOnly) return;
      e.preventDefault();
      toast(READ_ONLY_TEXT, { type: 'warn', ms: 3500 });
      reloadAll().then(() => refresh()).catch(() => {});
    });
    if (!('switch' in document.createElement('input'))) document.documentElement.classList.add('sw-fallback');
    if (mig && (mig.drafts.length || mig.campo || mig.vehicles || mig.counters)) toast('Se recuperaron los datos del sistema anterior', { type: 'info', ms: 4500 });
    else if (updated) toast(`PERCONSUR se actualizó a la versión ${APP_VERSION}`, { type: 'info', ms: 5000 });
    tryLibs(['qrcode']);
    /* Con sesión, la pantalla de carga se retira sobre el panel (ui/components/opening.js). Si se viene de la pantalla de
       acceso ya no hay pantalla de carga: está la transición de marca. El aviso de borrador pendiente espera a ambas. */
    const intro = document.querySelector('.brand-intro');
    const afterIntro = () => (intro && intro.isConnected ? new Promise((r) => window.addEventListener('brandintro:end', r, { once: true })) : Promise.resolve());
    closeSplash({ notBefore: t0 + 550 }).then(afterIntro).then(offerRecovery);
  } catch (e) {
    console.error(e);
    const text = 'No se pudo abrir el almacenamiento del dispositivo. Si usas navegación privada, ábrela en una pestaña normal.';
    if (splash) { splash.querySelector('.sp-msg').textContent = text; splash.classList.add('err'); }
    else document.getElementById('view').innerHTML = `<div class="page"><p class="page-lead">${text}</p></div>`;
    return;
  }
  registerSW();
  onUpdateReady(() => toast('Hay una nueva versión de la app', { type: 'info', action: { label: 'Actualizar', fn: applyUpdate } }));
  window.addEventListener('load', warmCache);
  if (document.readyState === 'complete') warmCache();
  window.addEventListener('online', () => toast('Conexión restablecida', { type: 'info' }));
  window.addEventListener('offline', () => toast('Sin conexión. Puedes seguir trabajando.', { type: 'info', ms: 3500 }));
}
/* auth/gate.js espera esta promesa para retirar la transición de marca aunque el arranque falle */
export const ready = boot();
