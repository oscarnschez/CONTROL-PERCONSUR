/*
 * Service worker de PERCONSUR.
 * - Precarga la app completa (lista generada por scripts/precache.mjs) para abrir y trabajar sin conexión.
 * - Librerías de PDF/QR del CDN y la fuente: se guardan en caché la primera vez que hay conexión.
 * - Estrategia: caché primero (la versión cambia con cada despliegue → caché nueva).
 */
/* PRECACHE:START */
const VERSION = '728b474994';
const PRECACHE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./src/auth/gate.js",
  "./src/config/auth.js",
  "./src/config/companies.js",
  "./src/config/legal.js",
  "./src/config/logistics.js",
  "./src/config/modules.js",
  "./src/config/reference.js",
  "./src/config/seeds.js",
  "./src/config/tariffs.js",
  "./src/config/version.js",
  "./src/core/dom.js",
  "./src/core/router.js",
  "./src/domain/billing/billing.js",
  "./src/domain/billing/report.js",
  "./src/domain/campo/model.js",
  "./src/domain/campo/sheet.js",
  "./src/domain/empties/empties.js",
  "./src/domain/fuel/fuel.js",
  "./src/domain/fuel/report.js",
  "./src/domain/fulls/fulls.js",
  "./src/domain/geo/mexico.js",
  "./src/domain/geo/tripsMap.js",
  "./src/domain/gps/fleet.js",
  "./src/domain/gps/geo.js",
  "./src/domain/gps/gps.js",
  "./src/domain/logistics/logistics.js",
  "./src/domain/maintenance/catalog.js",
  "./src/domain/maintenance/diagrams.js",
  "./src/domain/maintenance/maintenance.js",
  "./src/domain/maintenance/report.js",
  "./src/domain/operators/balance.js",
  "./src/domain/operators/money.js",
  "./src/domain/operators/statement.js",
  "./src/domain/operators/taxes.js",
  "./src/domain/operators/tripImport.js",
  "./src/domain/operators/tripsExport.js",
  "./src/domain/puerto/model.js",
  "./src/domain/puerto/sheet.js",
  "./src/domain/shared/barcode.js",
  "./src/domain/shared/docIcons.js",
  "./src/domain/shared/format.js",
  "./src/domain/shared/pageDoc.js",
  "./src/domain/sync/sync.js",
  "./src/domain/tariffs/report.js",
  "./src/domain/tariffs/tariffs.js",
  "./src/domain/tracking/tracking.js",
  "./src/domain/units/complement.js",
  "./src/domain/units/exif.js",
  "./src/domain/units/units.js",
  "./src/main.js",
  "./src/portal/main.js",
  "./src/services/access.js",
  "./src/services/backup.js",
  "./src/services/billing.js",
  "./src/services/billingPdf.js",
  "./src/services/camera.js",
  "./src/services/catalogs.js",
  "./src/services/codes.js",
  "./src/services/companies.js",
  "./src/services/db.js",
  "./src/services/destinations.js",
  "./src/services/docText.js",
  "./src/services/documents.js",
  "./src/services/dossier.js",
  "./src/services/drafts.js",
  "./src/services/empties.js",
  "./src/services/folios.js",
  "./src/services/fuel.js",
  "./src/services/fullDossier.js",
  "./src/services/fulls.js",
  "./src/services/geocode.js",
  "./src/services/gps.js",
  "./src/services/libs.js",
  "./src/services/logistics.js",
  "./src/services/maintenance.js",
  "./src/services/maintenancePdf.js",
  "./src/services/media.js",
  "./src/services/migration.js",
  "./src/services/operators.js",
  "./src/services/pdf.js",
  "./src/services/pwa.js",
  "./src/services/settings.js",
  "./src/services/share.js",
  "./src/services/statementPdf.js",
  "./src/services/sync.js",
  "./src/services/tariffPdf.js",
  "./src/services/tariffs.js",
  "./src/services/theme.js",
  "./src/services/tracking.js",
  "./src/services/tripAttachments.js",
  "./src/services/tripsMap.js",
  "./src/services/units.js",
  "./src/services/xlsx.js",
  "./src/ui/components/brandIntro.js",
  "./src/ui/components/charts.js",
  "./src/ui/components/docview.js",
  "./src/ui/components/fields.js",
  "./src/ui/components/fileViewer.js",
  "./src/ui/components/gpsMap.js",
  "./src/ui/components/icons.js",
  "./src/ui/components/opening.js",
  "./src/ui/components/picker.js",
  "./src/ui/components/pinPicker.js",
  "./src/ui/components/publishSignal.js",
  "./src/ui/components/scrollHints.js",
  "./src/ui/components/sheet.js",
  "./src/ui/components/toast.js",
  "./src/ui/components/unitPicker.js",
  "./src/ui/flows.js",
  "./src/ui/maps/CustomerTrackingMap.js",
  "./src/ui/maps/FleetMap.js",
  "./src/ui/maps/MapControls.js",
  "./src/ui/maps/VehicleMap.js",
  "./src/ui/maps/VehicleMarker.js",
  "./src/ui/maps/engine.js",
  "./src/ui/maps/mapStyle.js",
  "./src/ui/screens/billing.js",
  "./src/ui/screens/billingReport.js",
  "./src/ui/screens/campoWizard.js",
  "./src/ui/screens/catalogs.js",
  "./src/ui/screens/destinationEdit.js",
  "./src/ui/screens/docActions.js",
  "./src/ui/screens/docDetail.js",
  "./src/ui/screens/documents.js",
  "./src/ui/screens/done.js",
  "./src/ui/screens/empties.js",
  "./src/ui/screens/excelCodes.js",
  "./src/ui/screens/fuel.js",
  "./src/ui/screens/fulls.js",
  "./src/ui/screens/gpsMonitor.js",
  "./src/ui/screens/gpsPanel.js",
  "./src/ui/screens/gpsSettings.js",
  "./src/ui/screens/home.js",
  "./src/ui/screens/hubs.js",
  "./src/ui/screens/logistics.js",
  "./src/ui/screens/operatorForms.js",
  "./src/ui/screens/operators.js",
  "./src/ui/screens/puertoWizard.js",
  "./src/ui/screens/settings.js",
  "./src/ui/screens/statement.js",
  "./src/ui/screens/syncSettings.js",
  "./src/ui/screens/tariffs.js",
  "./src/ui/screens/tripDocs.js",
  "./src/ui/screens/tripImport.js",
  "./src/ui/screens/tripsMap.js",
  "./src/ui/screens/unitFile.js",
  "./src/ui/screens/units.js",
  "./src/ui/screens/viewer.js",
  "./src/ui/screens/wizardShell.js",
  "./src/ui/screens/workshop.js",
  "./src/ui/screens/workshopForms.js",
  "./src/ui/screens/workshopKit.js",
  "./src/ui/screens/workshopReport.js",
  "./styles/base.css",
  "./styles/components.css",
  "./styles/desktop.css",
  "./styles/documents.css",
  "./styles/logistics.css",
  "./styles/maps.css",
  "./styles/monitor.css",
  "./styles/operators.css",
  "./styles/portal.css",
  "./styles/screens.css",
  "./styles/tokens.css",
  "./styles/tripsmap.css",
  "./styles/units.css",
  "./styles/workshop.css",
  "./assets/icons/apple-touch-icon.png",
  "./assets/icons/favicon-32.png",
  "./assets/icons/favicon.ico",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/icon-maskable-512.png",
  "./assets/brand/oasc-logo.png",
  "./assets/brand/osc-logo.png",
  "./assets/brand/perconsur-mark.png",
  "./assets/geo/mx-estados.json",
  "./vendor/bwip-js-min.js",
  "./vendor/fonts/archivo-latin-ext.woff2",
  "./vendor/fonts/archivo-latin.woff2",
  "./vendor/fonts/archivo-vietnamese.woff2",
  "./vendor/fonts/archivo.css",
  "./vendor/fonts/inter-latin-ext.woff2",
  "./vendor/fonts/inter-latin.woff2",
  "./vendor/fonts/inter.css",
  "./vendor/fonts/jetbrains-mono.css",
  "./vendor/fonts/jetbrainsmono-latin-ext.woff2",
  "./vendor/fonts/jetbrainsmono-latin.woff2",
  "./vendor/html2canvas.min.js",
  "./vendor/jspdf.umd.min.js",
  "./vendor/leaflet/LICENSE.txt",
  "./vendor/leaflet/leaflet.css",
  "./vendor/leaflet/leaflet.js",
  "./vendor/maplibre/LICENSE.txt",
  "./vendor/maplibre/maplibre-gl-shared.js",
  "./vendor/maplibre/maplibre-gl-worker.js",
  "./vendor/maplibre/maplibre-gl.css",
  "./vendor/maplibre/maplibre-gl.js",
  "./vendor/pdf-lib.min.js",
  "./vendor/pdfjs/LICENSE.txt",
  "./vendor/pdfjs/pdf.min.js",
  "./vendor/pdfjs/pdf.worker.min.js",
  "./vendor/qrcode.min.js"
];
/* PRECACHE:END */
const CDN = [
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/bwip-js/4.10.0/bwip-js-min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js',
];
const APP_CACHE = 'pcs-app-' + VERSION;
const EXT_CACHE = 'pcs-ext-v1';
/* Librerías grandes que no se precargan (OCR): se guardan la primera vez que se usan y sobreviven a las actualizaciones */
const LIB_CACHE = 'pcs-lib-v1';
const isLib = (url) => /\/vendor\/ocr\//.test(url.pathname);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const c = await caches.open(APP_CACHE);
    await c.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' })));
    const ext = await caches.open(EXT_CACHE);
    await Promise.all(CDN.map(async (u) => {
      if (await ext.match(u)) return;
      try { const r = await fetch(u, { mode: 'cors', credentials: 'omit' }); if (r.ok) await ext.put(u, r); } catch (e) { /* sin conexión: se intentará después */ }
    }));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('pcs-app-') && k !== APP_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => { if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting(); });

const isExt = (url) => /^(cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(url.hostname);

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (isExt(url)) {
    event.respondWith((async () => {
      const ext = await caches.open(EXT_CACHE);
      const hit = await ext.match(req, { ignoreVary: true }) || await ext.match(req.url);
      if (hit) return hit;
      try {
        const r = await fetch(req);
        if (r.ok || r.type === 'opaque') ext.put(req.url, r.clone());
        return r;
      } catch (e) { return new Response('', { status: 504, statusText: 'Sin conexión' }); }
    })());
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (isLib(url)) {
    event.respondWith((async () => {
      const lib = await caches.open(LIB_CACHE);
      const hit = await lib.match(req, { ignoreSearch: true });
      if (hit) return hit;
      try { const r = await fetch(req); if (r.ok) lib.put(req, r.clone()); return r; } catch (e) { return new Response('', { status: 504, statusText: 'Sin conexión' }); }
    })());
    return;
  }
  event.respondWith((async () => {
    const app = await caches.open(APP_CACHE);
    if (req.mode === 'navigate') {
      const shell = await app.match('./index.html') || await app.match('./');
      try { const r = await fetch(req); if (r.ok) return r; } catch (e) { /* sin conexión */ }
      return shell || new Response('Sin conexión', { status: 503 });
    }
    const hit = await app.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try { return await fetch(req); } catch (e) { return new Response('', { status: 504 }); }
  })());
});
