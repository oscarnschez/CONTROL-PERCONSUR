/* Mapa de viajes (sin navegador): catálogo de las 32 entidades, identificación del estado de destino, proyección del INEGI,
   geometría, viajes contables, filtros de división y periodo, conteos por estado y su consistencia, escala y lista */
import { readFileSync } from 'node:fs';
import {
  STATES, stateByCode, stateByIso, resolveText, foldGeo, lcc, project, ringsOf, stateAt, sanitizeDestState, FOREIGN, AMBIGUOUS,
} from '../src/domain/geo/mexico.js';
import { periodRange, periodLabel, eligibleTrips, matches, summarize, scaleOf, listTrips } from '../src/domain/geo/tripsMap.js';
import { SYNC_STORES, keyPathOf, READER_WRITABLE } from '../src/domain/sync/sync.js';
const ok = (c, m) => console.log((c ? 'OK  ' : 'FAIL') + ' ' + m);
const st = (t) => resolveText(t);
const is = (t, code) => { const r = st(t); return r.status === 'state' && r.code === code; };

/* Catálogo */
ok(STATES.length === 32 && new Set(STATES.map((s) => s.code)).size === 32 && STATES.every((s, i) => s.code === String(i + 1).padStart(2, '0')), '32 entidades con clave INEGI única 01–32');
ok(stateByCode('09').name === 'Ciudad de México' && stateByCode('09').iso === 'MX-DIF' && stateByCode('15').short === 'Estado de México', 'Ciudad de México (09) y Estado de México (15) son entidades distintas');
ok(stateByCode('14').name === 'Jalisco' && stateByIso('MX-JAL').code === '14' && stateByCode('33') === null, 'claves ISO 3166-2 relacionadas con las del INEGI; clave inexistente → null');

/* Geometría */
const geo = JSON.parse(readFileSync(new URL('../assets/geo/mx-estados.json', import.meta.url)));
ok(geo.states.length === 32 && new Set(geo.states.map((s) => s.iso)).size === 32 && geo.states.every((s) => stateByIso(s.iso)), 'la geometría trae las 32 entidades (incluida la Ciudad de México), cada una relacionada con su clave oficial');
ok(/dominio público/.test(geo.source) && /EPSG:6372/.test(geo.source), 'fuente con licencia (Natural Earth, dominio público) y proyección del INEGI documentadas');
ok(!JSON.stringify(geo).match(/viaje|trip|operator/i), 'la geometría no contiene datos de viajes (datos y geometría separados)');
const shapes = geo.states.map((s) => ({ code: stateByIso(s.iso).code, rings: ringsOf(s.d) }));
const near = (a, b, e = 0.6) => Math.abs(a - b) < e;
const g = lcc(20.6597, -103.3496);
ok(near(g.x, 2359958.9, 1) && near(g.y, 962073.6, 1), 'proyección cónica conforme de Lambert (EPSG:6372) igual a la de referencia: Guadalajara 2 359 959 m, 962 074 m');
const pts = [['Guadalajara', 20.6597, -103.3496, 457.59, 438.55, '14'], ['Monterrey', 25.6866, -100.3161, 553.27, 266.55, '19'], ['Mérida', 20.9674, -89.6237, 898.24, 411.08, '31'], ['Tijuana', 32.5149, -117.0382, 60.21, 8.85, '02']];
ok(pts.every(([, la, lo, x, y]) => { const p = project(la, lo, geo.proj); return near(p.x, x) && near(p.y, y); }), 'coordenadas del dibujo iguales a las de mapshaper (4 ciudades)');
ok(pts.every(([, la, lo, , , c]) => { const p = project(la, lo, geo.proj); return stateAt(p.x, p.y, shapes) === c; }), 'cada ciudad cae dentro de su entidad (Jalisco, Nuevo León, Yucatán, Baja California)');
const lr = project(27.5306, -99.5075, geo.proj);
ok(stateAt(lr.x, lr.y, shapes) === null, 'un punto en Texas (Laredo) no cae en ninguna entidad');
const cdmx = project(19.4326, -99.1332, geo.proj), tlx = project(19.3139, -98.2404, geo.proj);
ok(stateAt(cdmx.x, cdmx.y, shapes) === '09' && stateAt(tlx.x, tlx.y, shapes) === '29', 'entidades pequeñas: Ciudad de México y Tlaxcala');

/* Identificación del estado de destino */
ok(is('Guadalajara, Jal.', '14') && is('Zapopan Jalisco', '14') && is('GDL', '14') && is('Jalisco', '14') && is('Nextipac', '14'), 'Jalisco: nombre, abreviatura «Jal.», ciudad, «GDL» y localidad');
ok(is('CDMX', '09') && is('Ciudad de México', '09') && is('Edo. de México', '15') && is('Toluca, Méx.', '15') && is('Edomex', '15'), 'CDMX y Estado de México se distinguen («CDMX», «Edo. de México», «Méx.»)');
ok(is('Monterrey, NL', '19') && is('Monterrey N.L.', '19') && is('Q. Roo', '23') && is('Cancún', '23') && is('Altamira, Tamps', '28'), 'abreviaturas oficiales: «NL», «N.L.», «Q. Roo», «Tamps»');
ok(is('Baja California', '02') && is('Baja California Sur', '03') && is('San Luis Potosí', '24') && is('Veracruz', '30'), 'nombres compuestos: Baja California vs. Baja California Sur');
ok(is('Pachuca, Hidalgo', '13') && is('Dolores Hidalgo', '11') && is('Puerto Morelos', '23') && is('Sabinas Hidalgo', '19'), '«Hidalgo»/«Morelos» como entidad solo después de coma, no dentro del nombre de una localidad');
ok(is('Av. Sonora 12, Col. Condesa, Cuauhtémoc, CDMX, C.P. 06140, México', '09') && is('Calle Durango 5, Col. Roma, Ciudad de México', '09') && is('Carretera Guadalajara-Colima km 5, Tlajomulco, Jal.', '14'), 'direcciones completas: la calle «Sonora»/«Durango» no es la entidad; se ignoran C.P. y país');
const amb = st('La Paz');
ok(amb.status === 'ambiguous' && amb.candidates.join() === '03,15' && /Baja California Sur/.test(amb.note), 'ambiguo: «La Paz» (Baja California Sur o Estado de México) no se asigna solo');
ok(['Guadalupe', 'Juárez', 'Lázaro Cárdenas', 'Tuxpan', 'San Pedro', 'México', 'Hidalgo'].every((t) => st(t).status === 'ambiguous'), 'ambiguos: Guadalupe, Juárez, Lázaro Cárdenas, Tuxpan, San Pedro, México, Hidalgo');
ok(is('Guadalupe, Zacatecas', '32') && is('Lázaro Cárdenas, Mich.', '16') && is('Juárez, Chih.', '08'), 'el nombre ambiguo con su entidad escrita sí se identifica');
ok(st('Laredo, TX').status === 'foreign' && st('Houston Texas').code === FOREIGN && st('Guatemala').status === 'foreign' && is('Nuevo Laredo', '28'), 'extranjero aparte: «Laredo, TX», Texas, Guatemala (Nuevo Laredo sí es Tamaulipas)');
ok(st('').status === 'unknown' && st('Bodega Norte').status === 'unknown' && st('Jalisco / Colima').status === 'ambiguous', 'sin destino o sin entidad reconocible → no identificado; dos entidades escritas → ambiguo');
ok(Object.values(AMBIGUOUS).every((c) => c.length > 1), 'la lista de nombres ambiguos siempre tiene más de una posible entidad');
ok(foldGeo('  Querétaro, Qro. ') === 'queretaro qro', 'texto normalizado (sin acentos ni signos)');
ok(sanitizeDestState({ key: 'la paz', text: 'La Paz', code: '03', by: 'x', at: 5 }).code === '03' && sanitizeDestState({ key: 'la paz', code: '99' }) === null && sanitizeDestState({ key: 'La Paz', code: '03' }) === null && sanitizeDestState({ key: 'x', code: FOREIGN }).code === FOREIGN, 'asignación a mano del respaldo: solo claves 01–32 o EXT y texto normalizado');
ok(SYNC_STORES.includes('destStates') && keyPathOf('destStates') === 'key' && !READER_WRITABLE.has('destStates'), 'las asignaciones se comparten entre dispositivos; el modo consulta no las puede escribir');

/* Viajes contables */
const T = '2026-10-15';
const trip = (id, division, date, destination, extra = {}) => ({ id, operatorId: 'op', division, date, origin: 'Manzanillo', destination, ...extra });
const e = eligibleTrips([trip('a', 'puerto', T, 'x'), trip('a', 'puerto', T, 'x'), trip('b', 'campo', '2026-10-20', 'x'), trip('c', 'puerto', T, 'x', { deletedAt: 1 }), null], T);
ok(e.trips.length === 1 && e.duplicates === 1 && e.future === 1 && e.deleted === 1, 'contables: sin repetidos (por id), sin eliminados y sin fecha futura (programados)');

/* Periodos */
ok(periodRange({ key: 'year' }, T).from === '2026-01-01' && periodRange({ key: 'month' }, T).from === '2026-10-01' && periodRange({ key: '30d' }, T).from === '2026-09-16' && periodRange({ key: '30d' }, T).to === T, 'periodos: este año, este mes y últimos 30 días (incluye hoy)');
ok(periodRange({ key: 'range', from: '2026-05-31', to: '2026-01-01' }).from === '2026-01-01' && periodRange({ key: 'all' }).from === null, 'rango personalizado con fechas invertidas se ordena; histórico sin límite');
ok(periodLabel({ key: 'all' }, T) === 'Histórico completo' && periodLabel({ key: 'month' }, T) === 'Este mes · 1 oct 2026 – 15 oct 2026', 'texto del periodo');

/* Conteos: fixture aislado — Jalisco 6 Puerto + 4 Campo */
const rows = [];
const add = (id, division, date, code, status = 'state') => rows.push({ trip: trip(id, division, date, ''), place: { status, code } });
for (let i = 0; i < 6; i++) add('jp' + i, 'puerto', i < 3 ? T : '2025-03-0' + (i + 1), '14');
for (let i = 0; i < 4; i++) add('jc' + i, 'campo', i < 2 ? '2026-10-0' + (i + 1) : '2026-02-1' + i, '14');
for (let i = 0; i < 3; i++) add('co' + i, 'puerto', '2026-09-20', '06');
add('cd', 'campo', T, '09'); add('u1', 'puerto', T, null, 'ambiguous'); add('u2', 'campo', '2025-01-01', null, 'unknown'); add('ex', 'puerto', T, FOREIGN, 'foreign');
rows.push(rows[0]);
const all = summarize(rows, {}, T);
ok(all.byState['14'].total === 10 && all.byState['14'].puerto === 6 && all.byState['14'].campo === 4, 'Jalisco = 10 viajes = 6 Puerto + 4 Campo');
const mapped = all.ranking.reduce((a, r) => a + r.total, 0);
ok(mapped + all.unidentified.total === all.total && all.total === 16 && all.foreign.total === 1, 'consistencia: suma por estado (14) + sin estado identificado (2) = total nacional (16); extranjero aparte (1)');
ok(all.puerto + all.campo === all.total && all.statesServed === 3 && all.leader.code === '14' && all.top.map((r) => r.code).join() === '14,06,09', 'Puerto + Campo = total; estados atendidos, mayor actividad y top');
ok(summarize(rows, { division: 'puerto' }, T).byState['14'].total === 6 && summarize(rows, { division: 'campo' }, T).byState['14'].total === 4 && summarize(rows, { division: 'campo' }, T).byState['06'] === undefined, 'filtro por división: Jalisco 6 en Puerto, 4 en Campo; Colima no aparece en Campo');
const m = summarize(rows, { period: { key: 'month' } }, T);
ok(m.byState['14'].total === 5 && m.byState['14'].puerto === 3 && m.byState['14'].campo === 2 && !m.byState['06'], 'este mes: Jalisco 5 (3 Puerto + 2 Campo)');
const r = summarize(rows, { division: 'puerto', period: { key: 'range', from: '2025-01-01', to: '2025-12-31' } }, T);
ok(r.total === 3 && r.byState['14'].total === 3 && r.unidentified.total === 0, 'filtros combinados: Puerto + rango 2025');
ok(summarize(rows, { period: { key: '30d' } }, T).byState['06'].total === 3, 'últimos 30 días incluye 20 sep');
const empty = summarize([], {}, T);
ok(empty.total === 0 && empty.statesServed === 0 && empty.leader === null && empty.scale.ranges.length === 0 && empty.scale.stepOf(0) === 0, 'sin viajes: todo en cero, sin escala');

/* Escala */
const sc = scaleOf([1, 2, 3, 5, 8, 13, 21, 0, 0]);
ok(sc.stepOf(0) === 0 && sc.stepOf(1) === 1 && sc.stepOf(21) === 5 && sc.ranges.length === 5 && sc.ranges.every((x, i) => i === 0 || x.min === sc.ranges[i - 1].max + 1), 'escala: 0 = sin viajes; 5 clases contiguas por cuantiles');
ok(scaleOf([4, 4, 4]).ranges.length === 1 && scaleOf([4]).stepOf(4) === 5, 'un solo valor → una clase con el tono más intenso');

/* Lista del detalle */
const items = Array.from({ length: 45 }, (_, i) => ({ trip: trip('t' + i, i % 2 ? 'campo' : 'puerto', `2026-0${1 + (i % 9)}-1${i % 10}`, 'Guadalajara', { reference: 'MSCU' + i, createdAt: i }), operator: i % 3 ? 'Juan' : 'Pedro', unit: 'ECO ' + i, client: 'Cliente ' + i }));
const p0 = listTrips(items, { size: 20 });
ok(p0.total === 45 && p0.pages === 3 && p0.items.length === 20 && p0.items[0].trip.date >= p0.items[19].trip.date, 'paginación (20 por página) y orden más reciente primero');
ok(listTrips(items, { sort: 'oldest' }).items[0].trip.date <= listTrips(items, { sort: 'oldest' }).items[1].trip.date && listTrips(items, { page: 9, size: 20 }).page === 2, 'orden más antiguo primero; página fuera de rango se ajusta');
const want = items.filter((x) => x.operator === 'Pedro' && /^MSCU3/.test(x.trip.reference)).length;
ok(want > 0 && listTrips(items, { q: 'pedro mscu3', size: 50 }).total === want && listTrips(items, { q: 'Cliente 7' }).items.some((x) => x.client === 'Cliente 7'), 'búsqueda por varias palabras (operador, referencia, cliente)');
