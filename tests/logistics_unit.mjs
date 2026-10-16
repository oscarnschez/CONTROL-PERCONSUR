import { board, homeEntries, countByStatus, filterEntries, groupByStatus, conflicts, openOpOf, historyOf, suggestions } from '../src/domain/logistics/logistics.js';
import { LOGISTICS_STATUSES, STATUS_ORDER, showOnHome, isWorking, statusLabel } from '../src/config/logistics.js';
const ok = (c, m) => console.log((c ? 'OK  ' : 'FAIL') + ' ' + m);
// Estados base: valores internos separados del texto
ok(LOGISTICS_STATUSES.map((s) => s.key).join(',') === 'assigned,loading,to_destination,empty,empty_transit,unloading,inactive', 'estados internos (Asignada para el despacho de órdenes; Cargando)');
ok(LOGISTICS_STATUSES.map((s) => s.label).join(' | ') === 'Asignada | Cargando | En ruta a destino | Vacío | En ruta vacío | Descargando | Inactiva', 'textos visibles');
ok(STATUS_ORDER.map((s) => s.key).join(',') === 'assigned,loading,to_destination,empty_transit,unloading,empty,inactive', 'orden de filtros y grupos (Asignada y Cargando primero)');
import('../src/config/logistics.js').then(({ isWorking, showOnHome }) => ok(isWorking('assigned') && showOnHome('assigned'), 'Asignada: cuenta como operación activa (impide otra) y aparece en Inicio → Unidades en operación'));
ok(statusLabel('desconocido') === 'Inactiva', 'estado desconocido se muestra como Inactiva');
// Regla de Inicio: estado ≠ Inactiva y estado ≠ Vacío
ok(['loading', 'to_destination', 'empty_transit', 'unloading'].every(showOnHome) && !showOnHome('inactive') && !showOnHome('empty'), 'regla de Inicio exacta (Cargando aparece en Inicio)');
ok(['loading', 'to_destination', 'empty_transit', 'unloading'].every(isWorking) && !isWorking('empty') && !isWorking('inactive'), 'estados que impiden una segunda operación');
const units = [{ id: 'v1', eco: '21', label: 'U21', placas: 'AB-1' }, { id: 'v2', eco: '5', label: 'U05', placas: 'CD-2' }, { id: 'v3', eco: '8', label: 'U08', placas: 'EF-3' }, { id: 'v4', eco: '9', label: 'U09', placas: 'GH-4' }];
const ops = [
  { id: 'a', vehicleId: 'v1', operatorId: 'o1', trailerId: 't1', division: 'puerto', status: 'to_destination', origin: 'Manzanillo', destination: 'Guadalajara', reference: 'MSCU1234567', deliveryPlace: 'CEDIS Guadalajara', updatedAt: 3 },
  { id: 'b', vehicleId: 'v2', operatorId: 'o2', trailerId: 't2', division: 'campo', status: 'empty', origin: 'Villagrán', destination: 'León', updatedAt: 2 },
  { id: 'c', vehicleId: 'v3', operatorId: 'o3', trailerId: 't3', division: 'campo', status: 'unloading', origin: 'Los Mochis', destination: 'Culiacán', updatedAt: 1 },
  { id: 'h', vehicleId: 'v1', operatorId: 'o9', status: 'inactive', lastStatus: 'empty', closedAt: 1, updatedAt: 1 },
];
const e = board(units, ops);
ok(e.map((x) => x.status).join(',') === 'to_destination,empty,unloading,inactive', 'tablero: unidad sin operación abierta = Inactiva');
ok(openOpOf(ops, 'v1').id === 'a' && historyOf(ops, 'v1').map((o) => o.id).join() === 'h', 'operación activa vs historial');
ok(homeEntries(e).map((x) => x.unit.label).join() === 'U21,U08', 'Inicio muestra solo En ruta / Descargando');
const c = countByStatus(e); ok(c.all === 4 && c.to_destination === 1 && c.empty === 1 && c.unloading === 1 && c.inactive === 1, 'conteo por estado');
const tt = { t1: 'chasis', t2: 'jaula', t3: 'tolva' };
const view = (x) => ({ eco: x.unit.eco, label: x.unit.label, placas: x.unit.placas, operator: { o1: 'Juan Pérez', o2: 'Ana Ruiz', o3: 'Luis Gómez' }[x.op && x.op.operatorId] || '', trailer: '', trailerType: x.op ? tt[x.op.trailerId] || '' : '' });
const f = (o) => filterEntries(e, { status: 'all', division: 'all', type: 'all', text: '', ...o }, view).map((x) => x.unit.label).join();
ok(f({ text: 'mscu' }) === 'U21' && f({ text: 'perez' }) === 'U21' && f({ text: 'cedis' }) === 'U21', 'buscador: referencia, operador (sin acentos), lugar de entrega');
ok(f({ text: 'leon' }) === 'U05' && f({ text: 'mochis' }) === 'U08' && f({ text: 'GH-4' }) === 'U09' && f({ text: '21' }) === 'U21', 'buscador: destino, origen, placas, número económico');
ok(f({ division: 'campo' }) === 'U05,U08' && f({ type: 'chasis' }) === 'U21' && f({ status: 'inactive' }) === 'U09', 'filtros por división, tipo de remolque y estado');
ok(groupByStatus(e).map((g) => g.status.key).join() === 'to_destination,unloading,empty,inactive', 'agrupación por estado');
// Conflictos
let k = conflicts(ops, { vehicleId: 'v1', operatorId: 'o4', trailerId: 't9' });
ok(k.unit && k.unit.id === 'a' && !k.unitOpen, 'unidad con operación activa: se bloquea');
k = conflicts(ops, { vehicleId: 'v2', operatorId: 'o4' });
ok(!k.unit && k.unitOpen && k.unitOpen.id === 'b', 'unidad en Vacío: la operación abierta se cerrará');
k = conflicts(ops, { vehicleId: 'v4', operatorId: 'o1', trailerId: 't3' });
ok(k.operator && k.operator.id === 'a' && k.trailer && k.trailer.id === 'c', 'operador y remolque en otra operación activa');
k = conflicts(ops, { vehicleId: 'v1', operatorId: 'o1', trailerId: 't1' }, 'a');
ok(!k.unit && !k.operator && !k.trailer, 'editar la misma operación no genera conflictos');
ok(!conflicts(ops, { vehicleId: 'v4', operatorId: 'o9' }).operator, 'operaciones cerradas no generan avisos');
ok(suggestions([{ v: 'CEDIS GDL', at: 1 }, { v: 'Planta X', at: 5 }, { v: 'cedis gdl', at: 9 }]).join('|') === 'cedis gdl|Planta X', 'sugerencias: más usadas primero, sin duplicar');
