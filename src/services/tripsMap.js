/*
 * Mapa de viajes — datos. Lee los viajes de Control de operadores (sin copiarlos), clasifica la entidad de destino de
 * cada uno y guarda solo las asignaciones hechas a mano (store destStates), que nunca modifican el viaje.
 *
 * Entidad de destino de un viaje, en orden de prioridad (la primera regla que da una entidad gana):
 *   1. Asignación autorizada para ese texto de destino (store destStates; la hace un usuario fuera del modo consulta).
 *   2. El texto de destino del viaje (domain/geo/mexico.js → resolveText): entidad escrita o localidad inequívoca.
 *   3. Si el texto no basta: la dirección del documento relacionado (Puerto: dirección de entrega; Campo: dirección de la
 *      planta del catálogo) o la del destino del catálogo con el mismo nombre; solo si es compatible con el texto.
 *   4. El punto ya ubicado en el mapa para esas direcciones (store geocodes, sin consultar la red), dentro del contorno
 *      de la entidad.
 *   Si nada de lo anterior la determina, el viaje queda en «Sin estado identificado» (ambiguo o no reconocido).
 * Evento «tripsmap:change» al guardar o quitar una asignación.
 */
import * as db from './db.js';
import { allTrips, operatorById } from './operators.js';
import { listDocuments } from './documents.js';
import { listAll } from './catalogs.js';
import { cached } from './geocode.js';
import { allRecords as logisticsOps, unitById } from './logistics.js';
import { isReadOnly } from './access.js';
import { resolveText, foldGeo, stateByIso, project, ringsOf, stateAt, isStateCode, FOREIGN } from '../domain/geo/mexico.js';
import { eligibleTrips } from '../domain/geo/tripsMap.js';
import { todayStr } from '../domain/operators/balance.js';

const EVT = 'tripsmap:change';
export const onTripsMapChange = (fn) => { window.addEventListener(EVT, fn); return () => window.removeEventListener(EVT, fn); };
function actor() { try { const s = JSON.parse(sessionStorage.getItem('pcs-session') || 'null'); return (s && s.user) || 'local'; } catch (e) { return 'local'; } }

/* ===== Geometría (assets/geo/mx-estados.json; se descarga una vez y queda en la caché de la app) ===== */
let geoP = null;
export function loadGeometry() {
  if (!geoP) {
    geoP = fetch('./assets/geo/mx-estados.json').then((r) => { if (!r.ok) throw new Error('No se pudo cargar el mapa'); return r.json(); })
      .then((g) => {
        const states = g.states.map((s) => ({ ...s, ...stateByIso(s.iso) })).filter((s) => s.code);
        return { ...g, states, shapes: states.map((s) => ({ code: s.code, rings: ringsOf(s.d) })) };
      })
      .catch((e) => { geoP = null; throw e; });
  }
  return geoP;
}

/* ===== Asignaciones a mano (destStates) ===== */
let overrides = null;
export async function loadDestStates(force = false) {
  if (!overrides || force) overrides = new Map((await db.all(db.S.destStates)).map((r) => [r.key, r]));
  return overrides;
}
export const destKey = (text) => foldGeo(text);
/* Asignaciones vigentes, la más reciente primero */
export const overridesList = () => [...(overrides ? overrides.values() : [])].sort((a, b) => (b.at || 0) - (a.at || 0));
export const overrideOf = (text) => (overrides && overrides.get(destKey(text))) || null;
/* Asigna entidad (o 'EXT') a un texto de destino; aplica a todos los viajes con ese mismo destino */
export async function setDestState(text, code) {
  if (isReadOnly()) throw new Error('Modo consulta: no se pueden hacer cambios.');
  const key = destKey(text);
  if (!key) throw new Error('El viaje no tiene destino escrito.');
  if (!(isStateCode(code) || code === FOREIGN)) throw new Error('Entidad no válida.');
  const rec = { key, text: String(text).trim().slice(0, 300), code, by: actor(), at: Date.now() };
  await db.put(db.S.destStates, rec);
  (await loadDestStates()).set(key, rec);
  window.dispatchEvent(new CustomEvent(EVT));
  return rec;
}
export async function clearDestState(text) {
  if (isReadOnly()) throw new Error('Modo consulta: no se pueden hacer cambios.');
  const key = destKey(text);
  await db.del(db.S.destStates, key);
  (await loadDestStates()).delete(key);
  window.dispatchEvent(new CustomEvent(EVT));
}

/* ===== Clasificación ===== */
/* Direcciones relacionadas con el viaje: documento vinculado y catálogo de destinos/plantas */
function addressesOf(trip, ctx) {
  const out = [];
  const doc = trip.documentId ? ctx.docs.get(trip.documentId) : null;
  if (doc && doc.data) {
    if (doc.type === 'puerto' && doc.data.destDir) out.push({ text: doc.data.destDir, how: 'documento' });
    if (doc.type === 'campo' && doc.data.planta) { const p = ctx.plants.get(foldGeo(doc.data.planta)); if (p && p.address) out.push({ text: p.address, how: 'catálogo' }); }
  }
  const k = foldGeo(trip.destination);
  const cat = k && (ctx.places.get(k) || ctx.plants.get(k));
  if (cat && cat.address) out.push({ text: cat.address, how: 'catálogo' });
  return out;
}
const compatible = (base, code) => base.status === 'unknown' || (base.candidates || []).includes(code);

export function classify(trip, ctx) {
  const ov = ctx.overrides.get(destKey(trip.destination));
  if (ov) return { status: ov.code === FOREIGN ? 'foreign' : 'state', code: ov.code, how: 'asignación', note: `Asignado por ${ov.by || 'un usuario'}` };
  const base = resolveText(trip.destination);
  if (base.status === 'state' || base.status === 'foreign') return base;
  const addrs = addressesOf(trip, ctx);
  for (const a of addrs) {
    const r = resolveText(a.text);
    if (r.status === 'state' && compatible(base, r.code)) return { status: 'state', code: r.code, how: a.how, note: '' };
    if (r.status === 'foreign' && base.status === 'unknown') return { status: 'foreign', code: FOREIGN, how: a.how, note: '' };
  }
  if (ctx.shapes) {
    for (const t of [trip.destination, ...addrs.map((a) => a.text)]) {
      const g = t ? cached(t) : null;
      if (!g) continue;
      const p = project(g.lat, g.lng, ctx.proj), code = stateAt(p.x, p.y, ctx.shapes);
      if (code && compatible(base, code)) return { status: 'state', code, how: 'ubicación', note: '' };
    }
  }
  return base;
}

/* Contexto de clasificación (catálogos, documentos y asignaciones) */
async function context() {
  const [docs, geo] = await Promise.all([listDocuments(), loadGeometry().catch(() => null)]);
  await loadDestStates(true);  /* siempre al día (pudo llegar una asignación por Información compartida) */
  const byName = (kind) => new Map(listAll(kind).filter((x) => x && x.name).map((x) => [foldGeo(String(x.name).replace(/^Planta /i, '')), x]));
  return {
    docs: new Map(docs.map((d) => [d.id, d])), places: byName('places'), plants: byName('plants'), overrides,
    shapes: geo ? geo.shapes : null, proj: geo ? geo.proj : null,
  };
}

/* Textos visibles de cada viaje (operador, unidad, cliente) sin crear registros nuevos */
function labelsOf(trip, ctx, unitByTrip) {
  const op = operatorById(trip.operatorId);
  const doc = trip.documentId ? ctx.docs.get(trip.documentId) : null;
  const client = doc && doc.data ? (doc.type === 'puerto' ? doc.data.destNombre : String(doc.data.planta || '').replace(/^Planta /, '')) || '' : '';
  return { operator: op ? op.name : '', unit: unitByTrip.get(trip.id) || '', client };
}

/*
 * Datos del mapa: { rows: [{ trip, place, operator, unit, client }], future, today }
 * rows = viajes contables (no eliminados, sin repetir, con fecha de hoy o anterior).
 */
export async function mapData(today = todayStr()) {
  const ctx = await context();
  const { trips, future } = eligibleTrips(allTrips(), today);
  const unitByTrip = new Map();
  for (const o of logisticsOps()) {
    if (!o.tripId || unitByTrip.has(o.tripId)) continue;
    const u = unitById(o.vehicleId);
    const label = u ? u.label || u.eco : (o.snap && o.snap.unit) || '';
    if (label) unitByTrip.set(o.tripId, label);
  }
  const rows = trips.map((trip) => ({ trip, place: classify(trip, ctx), ...labelsOf(trip, ctx, unitByTrip) }));
  return { rows, future, today };
}
