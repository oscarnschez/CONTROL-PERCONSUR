/*
 * Mapa de viajes — reglas de conteo (puras: sin almacenamiento ni DOM).
 *
 * Fuente: los viajes registrados en Control de operadores (store operatorTrips), los mismos que usan los estados de
 * cuenta y Cobranza. No hay un segundo registro: aquí solo se agrupan.
 * Viaje contable (realizado): no eliminado y con fecha de hoy o anterior. Un viaje con fecha futura todavía no se ha
 * hecho y queda fuera (se informa cuántos). Cada viaje cuenta una sola vez (por id).
 * Se cuenta por ENTIDAD DE DESTINO del viaje (no por las entidades que cruza). rows = [{ trip, place }] donde place es la
 * clasificación del destino { status:'state'|'foreign'|'ambiguous'|'unknown', code, ... } (services/tripsMap.js).
 *   Viajes en el mapa       status 'state' → se suman a su entidad
 *   Sin estado identificado 'ambiguous' | 'unknown' → grupo aparte, con acción para asignarles entidad
 *   Extranjero              'foreign' → aparte, no se pinta ni cuenta en el total nacional
 * Consistencia: suma de entidades + sin estado identificado = total de viajes nacionales del filtro.
 * Filtros: división (todas | puerto | campo) y periodo sobre la fecha del viaje; todos los números salen del mismo
 * conjunto filtrado.
 */
import { todayStr } from '../operators/balance.js';

export const DIVISIONS = [{ key: 'all', label: 'Todas' }, { key: 'puerto', label: 'Puerto' }, { key: 'campo', label: 'Campo' }];
export const PERIODS = [
  { key: 'all', label: 'Histórico completo' }, { key: 'year', label: 'Este año' }, { key: 'month', label: 'Este mes' },
  { key: '30d', label: 'Últimos 30 días' }, { key: 'range', label: 'Rango personalizado' },
];
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const addDays = (s, n) => { const d = new Date(`${s}T12:00:00`); d.setDate(d.getDate() + n); return todayStr(d); };

/* Fechas del periodo { from, to } (AAAA-MM-DD, inclusivas; null = sin límite) */
export function periodRange(period = {}, today = todayStr()) {
  const k = period.key || 'all';
  if (k === 'year') return { from: `${today.slice(0, 4)}-01-01`, to: today };
  if (k === 'month') return { from: `${today.slice(0, 7)}-01`, to: today };
  if (k === '30d') return { from: addDays(today, -29), to: today };
  if (k === 'range') {
    let from = isDate(period.from) ? period.from : null, to = isDate(period.to) ? period.to : null;
    if (from && to && from > to) [from, to] = [to, from];
    return { from, to };
  }
  return { from: null, to: null };
}
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fmt = (s) => `${+s.slice(8, 10)} ${MES[+s.slice(5, 7) - 1]} ${s.slice(0, 4)}`;
/* Texto del periodo para los encabezados («Histórico completo», «1 ene 2026 – 15 oct 2026») */
export function periodLabel(period = {}, today = todayStr()) {
  const k = period.key || 'all';
  if (k === 'all') return 'Histórico completo';
  const { from, to } = periodRange(period, today);
  if (k === 'range' && !from && !to) return 'Histórico completo';
  const name = (PERIODS.find((p) => p.key === k) || {}).label;
  const span = from && to ? `${fmt(from)} – ${fmt(to)}` : from ? `desde ${fmt(from)}` : `hasta ${fmt(to)}`;
  return k === 'range' ? span : `${name} · ${span}`;
}

/*
 * Viajes contables (realizados) sin repetir: { trips, future, deleted, duplicates }.
 * future: con fecha posterior a hoy (programados, aún no realizados).
 */
export function eligibleTrips(all, today = todayStr()) {
  const seen = new Set(), trips = [];
  let future = 0, deleted = 0, duplicates = 0;
  for (const t of all || []) {
    if (!t || !t.id) continue;
    if (seen.has(t.id)) { duplicates++; continue; }
    seen.add(t.id);
    if (t.deletedAt) { deleted++; continue; }
    if (isDate(t.date) && t.date > today) { future++; continue; }
    trips.push(t);
  }
  return { trips, future, deleted, duplicates };
}

/* ¿El viaje entra en el filtro? */
export function matches(trip, { division = 'all', period = {} } = {}, today = todayStr()) {
  if (division !== 'all' && trip.division !== division) return false;
  const { from, to } = periodRange(period, today);
  if (!from && !to) return true;
  if (!isDate(trip.date)) return false;
  return (!from || trip.date >= from) && (!to || trip.date <= to);
}

const bucket = () => ({ total: 0, puerto: 0, campo: 0, ids: [] });
const add = (b, t) => { b.total++; if (t.division === 'puerto') b.puerto++; else if (t.division === 'campo') b.campo++; b.ids.push(t.id); };

/*
 * Resumen del filtro. rows: [{ trip, place }] ya contables (eligibleTrips).
 * → { total, puerto, campo, byState: { code: bucket }, unidentified: bucket, foreign: bucket, statesServed,
 *     ranking: [{ code, ...bucket }] (mayor a menor), top: primeros 5, leader, scale }
 */
export function summarize(rows, filter = {}, today = todayStr()) {
  const byState = {}, unidentified = bucket(), foreign = bucket(), nation = bucket();
  const seen = new Set();
  for (const { trip, place } of rows || []) {
    if (!trip || seen.has(trip.id) || !matches(trip, filter, today)) continue;
    seen.add(trip.id);
    const st = place && place.status;
    if (st === 'foreign') { add(foreign, trip); continue; }
    add(nation, trip);
    if (st === 'state' && place.code) add(byState[place.code] || (byState[place.code] = bucket()), trip);
    else add(unidentified, trip);
  }
  const ranking = Object.entries(byState).map(([code, b]) => ({ code, ...b })).sort((a, b) => b.total - a.total || a.code.localeCompare(b.code));
  return {
    total: nation.total, puerto: nation.puerto, campo: nation.campo,
    byState, unidentified, foreign, statesServed: ranking.length,
    ranking, top: ranking.slice(0, 5), leader: ranking[0] || null,
    scale: scaleOf(ranking.map((r) => r.total)),
  };
}

/*
 * Escala de intensidad (hasta 5 clases) a partir de los cuantiles de los conteos mayores que cero.
 * → { ranges: [{ min, max, step }], stepOf(n) } ; step 0 = sin viajes; 1..5 = de menor a mayor intensidad.
 * Con pocos valores distintos hay menos clases y sus tonos se reparten entre el más claro y el más oscuro.
 */
export function scaleOf(counts) {
  const v = counts.filter((n) => n > 0).sort((a, b) => a - b);
  if (!v.length) return { ranges: [], stepOf: () => 0 };
  const q = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
  const cuts = [...new Set([0.2, 0.4, 0.6, 0.8].map(q))].filter((c) => c < v[v.length - 1]);
  const ranges = [];
  let lo = v[0];
  for (const c of [...cuts, v[v.length - 1]]) {
    if (c >= lo) { ranges.push({ min: lo, max: c }); lo = c + 1; }
  }
  const k = ranges.length;
  ranges.forEach((r, i) => { r.step = k === 1 ? 5 : 1 + Math.round((i * 4) / (k - 1)); });
  const stepOf = (n) => { if (!(n > 0)) return 0; const r = ranges.find((x) => n <= x.max) || ranges[k - 1]; return r.step; };
  return { ranges, stepOf };
}

/* ===== Lista de viajes de una entidad ===== */
const foldS = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/*
 * items: [{ trip, ...textos visibles (operator, unit, client) }]
 * opts: { q, sort:'recent'|'oldest', page (desde 0), size }
 * → { items (página), total, pages, page }
 */
export function listTrips(items, { q = '', sort = 'recent', page = 0, size = 25 } = {}) {
  const words = foldS(q).split(/\s+/).filter(Boolean);
  let out = (items || []).filter((it) => {
    if (!words.length) return true;
    const t = it.trip, hay = foldS([t.reference, t.origin, t.destination, t.date, it.operator, it.unit, it.client, t.division].join(' '));
    return words.every((w) => hay.includes(w));
  });
  const dir = sort === 'oldest' ? 1 : -1;
  out = out.slice().sort((a, b) => dir * (String(a.trip.date || '').localeCompare(String(b.trip.date || '')) || (a.trip.createdAt || 0) - (b.trip.createdAt || 0)));
  const pages = Math.max(1, Math.ceil(out.length / size)), p = Math.min(Math.max(0, page), pages - 1);
  return { items: out.slice(p * size, p * size + size), total: out.length, pages, page: p };
}
