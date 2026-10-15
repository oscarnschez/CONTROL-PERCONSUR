/*
 * Avisos — reglas puras (sin red ni DOM): geocercas a vigilar, vencimientos que se publican al Worker, sugerencias de
 * cambio de estado en Logística por llegadas y salidas, y estancias (tiempo en cada lugar).
 *
 * Evento de geocerca (lo registra el Worker gps-proxy; ver runAlerts):
 *   { id, t: 'enter'|'exit', at, rec, imei, unit, zone, name, kind, opId?, lat, lng, since?, dwell? }
 *   at = hora de la posición GPS; rec = cuándo lo registró el Worker; exit trae since (llegada) y dwell (ms en el lugar).
 */

/* Tipos de lugar vigilados: catálogo de origen y radio por omisión (metros) */
export const ZONE_KINDS = {
  terminal: { label: 'Terminales portuarias', one: 'Terminal', catalog: 'terminals', r: 500 },
  yard: { label: 'Patios de vacíos', one: 'Patio de vacíos', catalog: 'yards', r: 300 },
  loadingYard: { label: 'Patios de carga', one: 'Patio de carga', catalog: 'loadingYards', r: 300 },
  plant: { label: 'Plantas', one: 'Planta', catalog: 'plants', r: 400 },
  place: { label: 'Destinos', one: 'Destino', catalog: 'places', r: 250 },
  delivery: { label: 'Destinos de viajes activos', one: 'Destino del viaje', catalog: null, r: 300 },
};
export const CATALOG_KIND = Object.fromEntries(Object.entries(ZONE_KINDS).filter(([, v]) => v.catalog).map(([k, v]) => [v.catalog, k]));
export const RADII = [100, 150, 200, 300, 400, 500, 800, 1000, 1500, 2000];
/* Ubicaciones aproximadas (colonia, C.P. o municipio): no sirven para saber si la unidad llegó */
const APPROX = new Set(['area', 'city']);

export const zoneIdOf = (catalog, id) => `${catalog}:${id}`;
export const radiusFor = (kind, id, prefs = {}) => {
  const r = (prefs.r || {})[id] || (prefs.radius || {})[kind] || (ZONE_KINDS[kind] || {}).r || 300;
  return Math.min(5000, Math.max(50, Math.round(+r) || 300));
};

/*
 * Geocercas de los catálogos. catalogs = { terminals: [...], yards: [...], ... }; locOf(rec) → { lat, lng, precision } | null
 * prefs = { radius: { kind: m }, r: { zoneId: m }, off: { zoneId: true } }
 * → { zones: [{ id, name, kind, lat, lng, r, catalog, recId }], missing: [{ id, name, kind, catalog, recId, reason: 'noloc'|'approx' }], off: [...] }
 */
export function catalogZones(catalogs, locOf, prefs = {}) {
  const zones = [], missing = [], off = [];
  for (const [kind, k] of Object.entries(ZONE_KINDS)) {
    if (!k.catalog) continue;
    for (const rec of catalogs[k.catalog] || []) {
      if (!rec || !rec.id || rec.deletedAt) continue;
      const id = zoneIdOf(k.catalog, rec.id), base = { id, name: String(rec.name || k.one).trim(), kind, catalog: k.catalog, recId: rec.id };
      const loc = locOf(rec);
      if (!loc) { missing.push({ ...base, reason: 'noloc', address: rec.address || '' }); continue; }
      if (APPROX.has(loc.precision)) { missing.push({ ...base, reason: 'approx', address: rec.address || '' }); continue; }
      const z = { ...base, lat: loc.lat, lng: loc.lng, precision: loc.precision, r: radiusFor(kind, id, prefs) };
      if ((prefs.off || {})[id]) off.push(z); else zones.push(z);
    }
  }
  return { zones, missing, off };
}

/*
 * Geocerca que corresponde al destino actual de una operación (destinations.targetOf):
 *   lugar del catálogo con ubicación → la geocerca del catálogo (si está vigilada);
 *   dirección de entrega (o lugar del catálogo no vigilado) con ubicación exacta → geocerca propia del viaje «op:<id>»
 * → { id, zone|null (solo si es propia del viaje), name } | null
 */
export function opZone(op, target, zoneIds, prefs = {}) {
  if (!op || !target || !target.loc || APPROX.has(target.loc.precision)) return null;
  if (target.catalog && target.rec) {
    const id = zoneIdOf(target.catalog, target.rec.id);
    if (zoneIds.has(id)) return { id, zone: null, name: target.rec.name || target.name };
  }
  if (target.kind === 'city') return null;
  const id = `op:${op.id}`;
  return { id, name: target.name || 'Destino del viaje', zone: { id, name: target.name || 'Destino del viaje', kind: 'delivery', lat: target.loc.lat, lng: target.loc.lng, r: radiusFor('delivery', id, prefs), opId: op.id } };
}

/* ===== Sugerencias de estado en Logística ===== */
/* Último cambio de estado de la operación (las llegadas/salidas anteriores ya no cuentan) */
export const lastStatusAt = (op) => { const l = (op && op.statusLog) || []; return (l.length ? l[l.length - 1].at : 0) || (op && (op.startedAt || op.createdAt)) || 0; };
const RULES = [
  { from: 'to_destination', t: 'enter', to: 'unloading', text: 'Llegó al destino' },
  { from: 'unloading', t: 'exit', to: 'empty_transit', text: 'Salió del lugar de entrega' },
  { from: 'empty_transit', t: 'enter', to: 'empty', text: 'Llegó al patio de vacíos' },
];
/*
 * events: llegadas y salidas de la unidad (cualquier orden); zoneId: geocerca del destino actual (opZone).
 * → { status, text, event } | null. Descartada por el usuario (dismissed: Set de ids de evento) → null.
 */
export function suggestionFor(op, events, zoneId, dismissed = new Set()) {
  if (!op || op.closedAt || !zoneId) return null;
  const rule = RULES.find((r) => r.from === op.status);
  if (!rule) return null;
  const after = lastStatusAt(op);
  const last = (events || []).filter((e) => e.zone === zoneId && e.at >= after).sort((a, b) => a.at - b.at).pop();
  if (!last || last.t !== rule.t || dismissed.has(last.id)) return null;
  return { status: rule.to, text: rule.text, event: last };
}

/* ===== Estancias: llegada → salida en cada lugar ===== */
/*
 * events de una unidad; inside = { zoneId: desde } (quién está dentro ahora, del Worker); names = { zoneId: nombre }
 * → [{ zone, name, kind, from, to|null, dwell, open }] de la más reciente a la más antigua, dentro de [from, to]
 */
export function staysOf(events, { from = 0, to = Infinity, inside = {}, names = {}, now = Date.now() } = {}) {
  const list = (events || []).slice().sort((a, b) => a.at - b.at), out = [], openBy = new Map();
  for (const e of list) {
    if (e.t === 'enter') openBy.set(e.zone, e);
    else {
      const en = openBy.get(e.zone); openBy.delete(e.zone);
      const start = en ? en.at : e.since || e.at - (e.dwell || 0);
      out.push({ zone: e.zone, name: e.name, kind: e.kind, from: start, to: e.at, dwell: e.dwell != null ? e.dwell : e.at - start, open: false });
    }
  }
  for (const [zone, since] of Object.entries(inside || {})) {
    const en = openBy.get(zone);
    out.push({ zone, name: (en && en.name) || names[zone] || 'Lugar', kind: en ? en.kind : '', from: en ? en.at : since, to: null, dwell: now - (en ? en.at : since), open: true });
    openBy.delete(zone);
  }
  return out.filter((s) => (s.to == null ? now : s.to) >= from && s.from <= to).sort((a, b) => (b.to == null ? Infinity : b.to) - (a.to == null ? Infinity : a.to) || b.from - a.from);
}

export function dwellText(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m} min`;
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), r = m % 60;
  if (d) return h ? `${d} d ${h} h` : `${d} d`;
  return r ? `${h} h ${r} min` : `${h} h`;
}
export const eventText = (e) => (e.t === 'enter' ? `Llegó a ${e.name}` : `Salió de ${e.name}`);

/* Registro guardado (respaldo, información compartida): solo eventos con la forma esperada */
export function sanitizeGeoEvent(r) {
  if (!r || typeof r.id !== 'string' || !['enter', 'exit'].includes(r.t) || !Number.isFinite(r.at) || typeof r.zone !== 'string') return null;
  const s = (v, n = 80) => String(v == null ? '' : v).slice(0, n);
  const out = { id: s(r.id, 64), t: r.t, at: r.at, rec: Number.isFinite(r.rec) ? r.rec : r.at, imei: s(r.imei, 20), unit: s(r.unit, 40), zone: s(r.zone, 80), name: s(r.name), kind: s(r.kind, 20) };
  if (r.opId) out.opId = s(r.opId, 64);
  if (Number.isFinite(r.lat) && Number.isFinite(r.lng)) { out.lat = r.lat; out.lng = r.lng; }
  if (r.t === 'exit') { if (Number.isFinite(r.since)) out.since = r.since; if (Number.isFinite(r.dwell)) out.dwell = r.dwell; }
  if (r.applied) out.applied = s(r.applied, 30);
  return out;
}

/* Documentos que se publican para el resumen diario de vencimientos (filas de alertRows con ventana «all») */
export const duesFrom = (rows, unitTitle, docLabel) => rows.map((a) => ({ id: a.doc ? a.doc.id : `${a.unit.id}:${a.type}`, unit: unitTitle(a.unit), doc: docLabel(a.type), until: a.v.until }));
