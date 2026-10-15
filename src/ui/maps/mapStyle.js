/*
 * Estilo cartográfico PERCONSUR para MapLibre (claro y oscuro).
 *
 * Proveedor de datos: OpenFreeMap (https://openfreemap.org) — mosaicos vectoriales de OpenStreetMap con el esquema
 * OpenMapTiles. Uso libre en producción (también comercial), sin clave de API, sin registro, sin cookies y sin límite de
 * consultas; MIT. Requiere atribución: «OpenFreeMap © OpenMapTiles Datos de OpenStreetMap» (la muestra el control de
 * atribución del mapa, siempre visible). MapLibre es solo el motor que dibuja; el proveedor se cambia aquí (PROVIDER)
 * sin tocar los componentes (p. ej. MapTiler o un servidor propio con el mismo esquema).
 *
 * El estilo es propio (no se descarga el de OpenFreeMap): base sobria tipo «Positron» con la paleta de la marca —
 * autopistas en naranja corporativo tenue (lo que importa para la flota), agua en azul de la marca, nombres en español
 * cuando existen — y sin íconos de terceros (no usa sprites).
 */
export const PROVIDER = {
  name: 'OpenFreeMap',
  tilejson: 'https://tiles.openfreemap.org/planet',
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  attribution: '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a> Datos de <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
};
/*
 * Vista satelital: Esri World Imagery (fotografía aérea y satelital mundial; en México llega a nivel de calle). Mosaicos
 * raster públicos sin clave en el navegador (no hay contraseñas ni tokens privados en el código). Atribución obligatoria
 * (siempre visible). Encima se dibujan, del mismo proveedor vectorial, carreteras, límites y nombres («híbrido»).
 * Uso comercial a gran escala: Esri pide una cuenta de ArcGIS Location Platform (nivel gratuito); su clave es pública
 * por diseño (restringida al dominio de la app) y se agregaría en `key` sin tocar los componentes.
 */
export const SATELLITE = {
  name: 'Esri World Imagery',
  tiles: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  key: '',
  maxzoom: 19,
  attribution: 'Imágenes <a href="https://www.esri.com/" target="_blank" rel="noopener">© Esri</a>, Maxar, Earthstar Geographics y la comunidad de usuarios de SIG',
};
export const VIEWS = { map: 'Mapa', satellite: 'Satélite' };
/* Vista inicial sin unidades: México */
export const MEXICO = { center: [-102.4, 23.6], zoom: 4.1 };

const PALETTE = {
  light: {
    bg: '#F1F3F7', water: '#C5D2EA', waterLine: '#B2C2E1', waterLabel: '#3F58A8',
    park: '#E1E9DF', wood: '#DCE4D9', residential: '#E9ECF1', industrial: '#E6E7EE', aero: '#E4E6EC',
    building: '#E2E5EC', buildingLine: '#D3D8E2',
    minor: '#FFFFFF', minorCase: '#DCE0E8', major: '#FFFFFF', majorCase: '#CDD3DF', majorLow: '#D8DDE6',
    motorway: '#FCE2CF', motorwayCase: '#EFAF86', motorwayLow: 'rgba(242,111,34,0.38)', tunnel: '#F5ECE5',
    rail: '#CDD3DF', boundary: '#A3ACBE', country: '#7F889C',
    label: '#3A4458', muted: '#687186', halo: 'rgba(255,255,255,0.92)', city: '#1A2233', dot: '#4A5468', ref: '#9A4A17',
  },
  dark: {
    bg: '#0F141D', water: '#172339', waterLine: '#1D2C48', waterLabel: '#91A4DA',
    park: '#121E18', wood: '#13201A', residential: '#141A25', industrial: '#161C28', aero: '#171D29',
    building: '#1A2130', buildingLine: '#232B3C',
    minor: '#252D3C', minorCase: '#1A2130', major: '#2F384A', majorCase: '#1C2331', majorLow: '#283041',
    motorway: '#6A4228', motorwayCase: '#8A532E', motorwayLow: 'rgba(255,122,51,0.40)', tunnel: '#3A2A20',
    rail: '#2C3446', boundary: '#3E485C', country: '#5D6780',
    label: '#C9CFDB', muted: '#8A93A6', halo: 'rgba(14,18,25,0.88)', city: '#EEF1F6', dot: '#B6BDCC', ref: '#FFB27F',
  },
  /* Sobre la imagen satelital: vialidades translúcidas y nombres blancos con contorno oscuro (igual en claro y oscuro) */
  satellite: {
    bg: '#1B232B', waterLabel: '#CFE0FF',
    minor: 'rgba(255,255,255,0.32)', major: 'rgba(255,255,255,0.62)', majorCase: 'rgba(0,0,0,0.28)', majorLow: 'rgba(255,255,255,0.45)',
    motorway: 'rgba(255,205,110,0.92)', motorwayCase: 'rgba(0,0,0,0.38)', motorwayLow: 'rgba(255,205,110,0.7)', tunnel: 'rgba(255,205,110,0.4)',
    rail: 'rgba(255,255,255,0.4)', boundary: 'rgba(255,255,255,0.6)', country: 'rgba(255,255,255,0.85)',
    label: '#FFFFFF', muted: '#EEF1F6', halo: 'rgba(8,12,18,0.85)', city: '#FFFFFF', dot: '#FFFFFF', ref: '#FFD58F',
  },
};
/* Capas del mapa que se conservan sobre la imagen satelital (el resto —agua, parques, edificios— ya se ve en la foto) */
const SAT_LAYERS = new Set(['tunel-autopista', 'calles', 'avenidas-casco', 'avenidas', 'avenidas-lejos', 'autopistas-casco', 'autopistas', 'autopistas-lejos', 'ferrocarril',
  'limites-estatales', 'limites-pais', 'nombre-rios', 'nombre-calles', 'nombre-avenidas', 'numero-carretera', 'nombre-colonias', 'nombre-pueblos', 'nombre-localidades',
  'punto-ciudades', 'nombre-ciudades', 'nombre-estados', 'nombre-paises']);
/* Vialidades más delgadas sobre la foto (no tapan lo que se ve del camino) */
const SAT_WIDTH = {
  calles: ['interpolate', ['linear'], ['zoom'], 14, 0.5, 20, 3],
  'avenidas-casco': ['interpolate', ['linear'], ['zoom'], 9, 1.4, 20, 6],
  avenidas: ['interpolate', ['linear'], ['zoom'], 9, 0.6, 20, 3.5],
  'autopistas-casco': ['interpolate', ['linear'], ['zoom'], 6, 1.6, 20, 7],
  autopistas: ['interpolate', ['linear'], ['zoom'], 6, 0.8, 20, 4.5],
  'tunel-autopista': ['interpolate', ['linear'], ['zoom'], 8, 1, 20, 4],
};

const LINES = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false];
const POLYS = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false];
const cls = (...v) => ['match', ['get', 'class'], v, true, false];
const notBrunnel = ['match', ['get', 'brunnel'], ['bridge', 'tunnel'], false, true];
const NAME = ['coalesce', ['get', 'name:es'], ['get', 'name:latin'], ['get', 'name']];
const F = { r: ['Noto Sans Regular'], b: ['Noto Sans Bold'], i: ['Noto Sans Italic'] };
const z = (...stops) => ['interpolate', ['exponential', 1.4], ['zoom'], ...stops];
const lin = (...stops) => ['interpolate', ['linear'], ['zoom'], ...stops];

/* theme: 'light'|'dark'; view: 'map'|'satellite' */
export function buildStyle(theme = 'light', view = 'map') {
  const sat = view === 'satellite';
  const c = PALETTE[sat ? 'satellite' : theme === 'dark' ? 'dark' : 'light'];
  const S = 'omt';
  const L = (id, type, layer, extra) => ({ id, type, source: S, 'source-layer': layer, ...extra });
  const text = (paint = {}) => ({ 'text-color': c.label, 'text-halo-color': c.halo, 'text-halo-width': 1.4, ...paint });
  const style = {
    version: 8,
    name: sat ? 'PERCONSUR satélite' : `PERCONSUR ${theme === 'dark' ? 'oscuro' : 'claro'}`,
    glyphs: PROVIDER.glyphs,
    sources: { [S]: { type: 'vector', url: PROVIDER.tilejson, attribution: PROVIDER.attribution } },
    layers: [
      { id: 'fondo', type: 'background', paint: { 'background-color': c.bg } },
      L('bosque', 'fill', 'landcover', { minzoom: 8, filter: ['all', POLYS, cls('wood')], paint: { 'fill-color': c.wood, 'fill-opacity': lin(8, 0, 11, 1) } }),
      L('residencial', 'fill', 'landuse', { maxzoom: 16, filter: ['all', POLYS, cls('residential', 'suburb', 'neighbourhood')], paint: { 'fill-color': c.residential, 'fill-opacity': lin(8, 0.9, 12, 0.7) } }),
      L('industrial', 'fill', 'landuse', { minzoom: 10, filter: ['all', POLYS, cls('industrial', 'commercial', 'railway', 'garages')], paint: { 'fill-color': c.industrial } }),
      L('parques', 'fill', 'park', { filter: POLYS, paint: { 'fill-color': c.park } }),
      L('agua', 'fill', 'water', { filter: ['all', POLYS, ['!=', ['get', 'brunnel'], 'tunnel']], paint: { 'fill-color': c.water, 'fill-antialias': true } }),
      L('rios', 'line', 'waterway', { minzoom: 8, filter: LINES, paint: { 'line-color': c.waterLine, 'line-width': lin(8, 0.6, 14, 2) } }),
      L('aeropuertos', 'fill', 'aeroway', { minzoom: 11, filter: ['all', POLYS, cls('runway', 'taxiway')], paint: { 'fill-color': c.aero } }),
      L('edificios', 'fill', 'building', { minzoom: 13, paint: { 'fill-color': c.building, 'fill-outline-color': c.buildingLine, 'fill-opacity': lin(13, 0, 14, 1) } }),
      /* Vialidades: túneles, calles, avenidas y autopistas (casco + interior) */
      L('tunel-autopista', 'line', 'transportation', { minzoom: 8, filter: ['all', LINES, ['==', ['get', 'brunnel'], 'tunnel'], cls('motorway', 'trunk')], paint: { 'line-color': c.tunnel, 'line-width': z(8, 1, 20, 26), 'line-dasharray': [1.5, 1] } }),
      L('calles', 'line', 'transportation', { minzoom: 11, filter: ['all', LINES, notBrunnel, cls('minor', 'service', 'track')], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': c.minor, 'line-width': ['interpolate', ['exponential', 1.55], ['zoom'], 12, 0.8, 20, 18] } }),
      L('avenidas-casco', 'line', 'transportation', { minzoom: 9, filter: ['all', LINES, cls('primary', 'secondary', 'tertiary')], layout: { 'line-join': 'round' }, paint: { 'line-color': c.majorCase, 'line-width': ['interpolate', ['exponential', 1.3], ['zoom'], 9, 1.6, 20, 24] } }),
      L('avenidas', 'line', 'transportation', { minzoom: 9, filter: ['all', LINES, cls('primary', 'secondary', 'tertiary')], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': c.major, 'line-width': ['interpolate', ['exponential', 1.3], ['zoom'], 9, 0.8, 20, 20] } }),
      L('avenidas-lejos', 'line', 'transportation', { minzoom: 6, maxzoom: 9, filter: ['all', LINES, cls('primary', 'trunk')], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': c.majorLow, 'line-width': lin(6, 0.6, 9, 1.2) } }),
      L('autopistas-casco', 'line', 'transportation', { minzoom: 6, filter: ['all', LINES, ['!=', ['get', 'brunnel'], 'tunnel'], cls('motorway', 'trunk')], layout: { 'line-join': 'round' }, paint: { 'line-color': c.motorwayCase, 'line-width': z(6, 1.6, 20, 34) } }),
      L('autopistas', 'line', 'transportation', { minzoom: 6, filter: ['all', LINES, ['!=', ['get', 'brunnel'], 'tunnel'], cls('motorway', 'trunk')], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': c.motorway, 'line-width': z(6, 0.8, 20, 28) } }),
      L('autopistas-lejos', 'line', 'transportation', { maxzoom: 6, filter: ['all', LINES, cls('motorway')], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': c.motorwayLow, 'line-width': lin(3, 0.5, 6, 1.4) } }),
      L('ferrocarril', 'line', 'transportation', { minzoom: 11, filter: ['all', LINES, cls('rail'), ['!', ['has', 'service']]], paint: { 'line-color': c.rail, 'line-width': lin(11, 0.8, 18, 3), 'line-dasharray': [3, 2] } }),
      /* Límites */
      L('limites-estatales', 'line', 'boundary', { minzoom: 4, filter: ['all', ['==', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]], paint: { 'line-color': c.boundary, 'line-dasharray': [2, 2], 'line-width': lin(4, 0.6, 10, 1.4) } }),
      L('limites-pais', 'line', 'boundary', { filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1], ['!=', ['get', 'disputed'], 1]], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': c.country, 'line-width': lin(3, 0.8, 10, 2) } }),
      /* Nombres */
      L('nombre-agua', 'symbol', 'water_name', { filter: ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false], layout: { 'text-field': NAME, 'text-font': F.i, 'text-size': lin(0, 10, 8, 13), 'text-max-width': 6, 'text-letter-spacing': 0.1 }, paint: text({ 'text-color': c.waterLabel }) }),
      L('nombre-rios', 'symbol', 'waterway', { minzoom: 12, filter: LINES, layout: { 'symbol-placement': 'line', 'text-field': NAME, 'text-font': F.i, 'text-size': 12, 'symbol-spacing': 400 }, paint: text({ 'text-color': c.waterLabel }) }),
      L('nombre-calles', 'symbol', 'transportation_name', { minzoom: 15, filter: ['all', LINES, cls('minor', 'service')], layout: { 'symbol-placement': 'line', 'text-field': NAME, 'text-font': F.r, 'text-size': 12 }, paint: text({ 'text-color': c.muted }) }),
      L('nombre-avenidas', 'symbol', 'transportation_name', { minzoom: 12.5, filter: cls('primary', 'secondary', 'tertiary', 'trunk', 'motorway'), layout: { 'symbol-placement': 'line', 'text-field': NAME, 'text-font': F.r, 'text-size': lin(12.5, 11.5, 16, 13.5) }, paint: text({ 'text-color': c.muted }) }),
      /* Número de carretera (p. ej. «15D»): útil para ubicar a la flota sin íconos de terceros */
      L('numero-carretera', 'symbol', 'transportation_name', { minzoom: 8, maxzoom: 15, filter: ['all', LINES, cls('motorway', 'trunk', 'primary'), ['has', 'ref'], ['<=', ['get', 'ref_length'], 6]], layout: { 'symbol-placement': 'line', 'symbol-spacing': 500, 'text-field': ['get', 'ref'], 'text-font': F.b, 'text-size': 11, 'text-rotation-alignment': 'viewport', 'text-pitch-alignment': 'viewport' }, paint: text({ 'text-color': c.ref, 'text-halo-width': 2 }) }),
      L('nombre-colonias', 'symbol', 'place', { minzoom: 12, filter: cls('suburb', 'neighbourhood', 'quarter', 'hamlet', 'isolated_dwelling'), layout: { 'text-field': NAME, 'text-font': F.r, 'text-size': lin(12, 10.5, 15, 12), 'text-transform': 'uppercase', 'text-letter-spacing': 0.08, 'text-max-width': 8 }, paint: text({ 'text-color': c.muted }) }),
      L('nombre-pueblos', 'symbol', 'place', { minzoom: 10, filter: cls('village'), layout: { 'text-field': NAME, 'text-font': F.r, 'text-size': lin(10, 11, 14, 13), 'text-max-width': 8 }, paint: text() }),
      L('nombre-localidades', 'symbol', 'place', { minzoom: 7, filter: cls('town'), layout: { 'text-field': NAME, 'text-font': F.r, 'text-size': lin(7, 11.5, 12, 14.5), 'text-max-width': 8 }, paint: text() }),
      L('punto-ciudades', 'circle', 'place', { minzoom: 4, maxzoom: 9, filter: cls('city'), paint: { 'circle-radius': lin(4, 2, 8, 3.2), 'circle-color': c.dot, 'circle-stroke-color': c.halo, 'circle-stroke-width': 1.2 } }),
      L('nombre-ciudades', 'symbol', 'place', { minzoom: 4, filter: cls('city'), layout: { 'text-field': NAME, 'text-font': ['step', ['zoom'], ['literal', F.r], 7, ['literal', F.b]], 'text-size': ['interpolate', ['exponential', 1.2], ['zoom'], 4, 11, 8, 14, 12, 18], 'text-anchor': ['step', ['zoom'], 'bottom', 9, 'center'], 'text-offset': ['step', ['zoom'], ['literal', [0, -0.35]], 9, ['literal', [0, 0]]], 'text-max-width': 8 }, paint: text({ 'text-color': c.city }) }),
      L('nombre-estados', 'symbol', 'place', { minzoom: 4.5, maxzoom: 7.5, filter: cls('state'), layout: { 'text-field': NAME, 'text-font': F.r, 'text-size': lin(4.5, 9.5, 7, 12), 'text-transform': 'uppercase', 'text-letter-spacing': 0.15, 'text-max-width': 8 }, paint: text({ 'text-color': c.muted }) }),
      L('nombre-paises', 'symbol', 'place', { maxzoom: 7, filter: cls('country'), layout: { 'text-field': NAME, 'text-font': F.b, 'text-size': lin(2, 10, 6, 15), 'text-max-width': 7 }, paint: text({ 'text-color': c.label }) }),
    ],
  };
  if (!sat) return style;
  const tiles = SATELLITE.tiles + (SATELLITE.key ? `?token=${encodeURIComponent(SATELLITE.key)}` : '');
  style.sources.sat = { type: 'raster', tiles: [tiles], tileSize: 256, maxzoom: SATELLITE.maxzoom, attribution: SATELLITE.attribution };
  style.layers = [
    style.layers[0],
    { id: 'satelite', type: 'raster', source: 'sat', paint: { 'raster-fade-duration': 150 } },
    ...style.layers.filter((l) => SAT_LAYERS.has(l.id)).map((l) => {
      const out = { ...l, paint: { ...l.paint } };
      if (SAT_WIDTH[l.id]) out.paint['line-width'] = SAT_WIDTH[l.id];
      if (l.type === 'symbol') out.paint['text-halo-width'] = Math.max(1.6, l.paint['text-halo-width'] || 0);
      return out;
    }),
  ];
  return style;
}
