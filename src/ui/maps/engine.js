/*
 * Motor de los mapas nuevos: MapLibre GL JS 6.11.2 (BSD-3-Clause), incluido en /vendor/maplibre (sin CDN; el service
 * worker lo deja disponible sin conexión). Se carga solo al abrir un mapa de MapLibre: Centro de Monitoreo GPS y
 * portal de rastreo para clientes. Los mapas de solo vista de Inicio y del detalle de la unidad siguen con Leaflet.
 *
 * createBaseMap(): mapa con el estilo PERCONSUR (claro/oscuro), ajustes pensados para Safari en iPhone y la PWA
 * (sin rotación ni inclinación, densidad de píxeles limitada a 2, reajuste de tamaño al rotar o volver del segundo
 * plano) y la atribución del proveedor siempre visible.
 */
import { buildStyle, MEXICO, VIEWS } from './mapStyle.js';

const BASE = new URL('../../../vendor/maplibre/', import.meta.url).href;
let pending = null;

export class MapUnavailable extends Error { constructor(message, reason) { super(message); this.reason = reason; } }

export function webglSupported() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; }
}
function ensureCss() {
  if (document.querySelector('link[href$="maplibre-gl.css"]')) return;
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = BASE + 'maplibre-gl.css';
  document.head.appendChild(l);
}
/* Carga MapLibre una sola vez (módulo ES + su worker) */
export function loadMapLibre() {
  if (pending) return pending;
  pending = (async () => {
    if (!webglSupported()) throw new MapUnavailable('Este navegador no puede dibujar el mapa (WebGL no disponible).', 'webgl');
    ensureCss();
    let ml;
    try { ml = await import(BASE + 'maplibre-gl.js'); } catch (e) { throw new MapUnavailable('No se pudo cargar el mapa. Revisa la conexión e intenta de nuevo.', 'load'); }
    ml.setWorkerUrl(BASE + 'maplibre-gl-worker.js');
    return ml;
  })().catch((e) => { pending = null; throw e; });
  return pending;
}

/* Tema actual de la página: data-theme de la app o, si no hay, el del sistema */
export function pageTheme() {
  const t = document.documentElement.getAttribute('data-theme');
  if (t === 'dark' || t === 'light') return t;
  return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/* Vista elegida (mapa o satélite): se recuerda en este dispositivo */
const VIEW_KEY = 'pcs-map-view';
export function savedView(def = 'map') { try { const v = localStorage.getItem(VIEW_KEY); return VIEWS[v] ? v : def; } catch (e) { return def; } }
function saveView(v) { try { localStorage.setItem(VIEW_KEY, v); } catch (e) { /* sin almacenamiento: solo esta vez */ } }

/*
 * Mapa base. opts: { center, zoom, interactive=true, attribution='bottom-right', views=false }
 *   views  true = permite cambiar a vista satelital (arranca con la última vista elegida en el dispositivo)
 *   defaultView  vista si en el dispositivo todavía no se ha elegido ninguna ('map' | 'satellite')
 * Devuelve { ml, map, theme, view, setView(v), destroy() }. Cambia de estilo solo si cambia el tema o la vista (los
 * marcadores, que son elementos HTML, se conservan).
 */
export async function createBaseMap(container, { center = MEXICO.center, zoom = MEXICO.zoom, interactive = true, attribution = 'bottom-right', views = false, defaultView = 'map' } = {}) {
  const ml = await loadMapLibre();
  let theme = pageTheme(), view = views ? savedView(defaultView) : 'map';
  const map = new ml.Map({
    container, style: buildStyle(theme, view), center, zoom, interactive,
    attributionControl: false, dragRotate: false, pitchWithRotate: false, touchPitch: false, maxPitch: 0,
    renderWorldCopies: false, pixelRatio: Math.min(window.devicePixelRatio || 1, 2), fadeDuration: 180,
    minZoom: 2.5, maxZoom: 18.5, locale: LOCALE,
  });
  if (map.touchZoomRotate) map.touchZoomRotate.disableRotation();
  if (map.keyboard) map.keyboard.disableRotation && map.keyboard.disableRotation();
  map.addControl(new ml.AttributionControl({ compact: true }), attribution);
  container.dataset.mapView = view;
  /* Fuentes del proveedor que no responden: el mapa sigue dibujando (sin nombres) en vez de fallar */
  map.on('error', (e) => { if (e && e.error) console.warn('mapa:', e.error.message || e.error); });
  /* Tamaño: el contenedor cambia al rotar el iPhone, al abrir el panel o al volver del segundo plano */
  let ro = null, gone = false;
  const fit = () => { if (!gone) map.resize(); };
  if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(() => requestAnimationFrame(fit)); ro.observe(container); }
  const onVis = () => { if (document.visibilityState === 'visible') { fit(); map.triggerRepaint(); } };
  const onShow = (e) => { if (e.persisted) onVis(); };
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('pageshow', onShow);
  /* Tema: la app avisa con «pcs:theme»; el portal sigue al sistema */
  const mq = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  const onTheme = () => { const t = pageTheme(); if (t !== theme && !gone) { theme = t; if (view === 'map') map.setStyle(buildStyle(t, view), { diff: true }); } };
  window.addEventListener('pcs:theme', onTheme);
  if (mq && mq.addEventListener) mq.addEventListener('change', onTheme);
  return {
    ml, map,
    get theme() { return theme; },
    get view() { return view; },
    setView(v) {
      if (!views || !VIEWS[v] || v === view || gone) return;
      view = v; saveView(v);
      container.dataset.mapView = v;
      map.setStyle(buildStyle(theme, v), { diff: true });
    },
    destroy() {
      if (gone) return; gone = true;
      if (ro) ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pageshow', onShow);
      window.removeEventListener('pcs:theme', onTheme);
      if (mq && mq.removeEventListener) mq.removeEventListener('change', onTheme);
      map.remove();
    },
  };
}

/* Textos de los controles de MapLibre en español */
const LOCALE = {
  'AttributionControl.ToggleAttribution': 'Mostrar u ocultar la atribución',
  'AttributionControl.MapFeedback': 'Reportar un error del mapa',
  'NavigationControl.ZoomIn': 'Acercar', 'NavigationControl.ZoomOut': 'Alejar', 'NavigationControl.ResetBearing': 'Orientar al norte',
  'Popup.Close': 'Cerrar', 'Map.Title': 'Mapa',
};
