/* Reglas del Centro de Monitoreo GPS y del rastreo para clientes (sin navegador): node fleet_unit.mjs */
import { motionOf, fleetKpis, filterRows, sortRows, MOVING_KMH } from '../src/domain/gps/fleet.js';
import { isTrackable, shareBlock, linkPayload, reconcile, destPoint, linkStateText, shortName } from '../src/domain/tracking/tracking.js';
import { mergePositions, freshness } from '../src/domain/gps/gps.js';
import { buildStyle, PROVIDER } from '../src/ui/maps/mapStyle.js';
const ok = (c, m) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); if (!c) process.exitCode = 1; };
const now = new Date(2026, 9, 8, 12, 0, 0).getTime(), min = 60000;
const P = (o) => ({ lat: 19.01, lng: -103.83, gpsTime: now - 20000, signalTime: now - 5000, ...o });

/* Movimiento reportado por GPS */
ok(motionOf(P({ speed: 62 }), null, now) === 'moving' && motionOf(P({ speed: MOVING_KMH - 1 }), null, now) === 'stopped', 'velocidad ≥ 5 km/h: en movimiento; menor: detenida');
ok(motionOf(P({ gpsTime: now - 40 * min, signalTime: now - min, speed: 0 }), null, now) === 'stopped', 'el equipo reporta pero la posición no cambia: detenida');
ok(motionOf(P({ gpsTime: now - 3 * 3600000, signalTime: now - 3 * 3600000, speed: 70 }), null, now) === 'nosignal', 'sin señal reciente: no se presenta como en movimiento (aunque la última velocidad sea 70)');
ok(motionOf(null, null, now) === 'nosignal' && motionOf({ lat: null, lng: null, gpsTime: now }, null, now) === 'nosignal', 'sin coordenadas: sin señal');
const prev = P({ lat: 19.0, lng: -103.83, gpsTime: now - 80000, speed: null });
ok(motionOf(P({ speed: null }), prev, now) === 'moving' && motionOf(P({ speed: null, lat: 19.0001 }), { ...prev, lat: 19.0 }, now) === 'stopped', 'sin velocidad del proveedor: se mueve si avanzó ≥ 80 m entre lecturas');

/* Indicadores, filtros y buscador */
const rows = [
  { id: 'a', label: 'U12', placas: '60-BN-4J', operator: 'Daniel Rivera', reference: 'MSCU1234567', division: 'puerto', status: 'to_destination', trailerType: 'chasis', operating: true, motion: 'moving' },
  { id: 'b', label: 'U05', placas: '56-BH-1L', operator: 'José Castañeda', reference: '', division: 'campo', status: 'unloading', trailerType: 'jaula', operating: true, motion: 'stopped' },
  { id: 'c', label: 'U21', placas: '61-BN-4J', operator: 'Juan García', reference: 'CAMPO-881', division: 'campo', status: 'empty', trailerType: 'tolva', operating: false, motion: 'nosignal' },
  { id: 'd', label: 'Camioneta oficina', placas: '', operator: '', reference: '', division: '', status: 'inactive', trailerType: '', operating: false, motion: 'stopped', deviceName: 'Camioneta oficina' },
];
const k = fleetKpis(rows);
ok(k.monitored === 4 && k.operating === 2 && k.moving === 1 && k.stopped === 2 && k.nosignal === 1, 'indicadores: monitoreadas, en operación (Logística) y movimiento (GPS) por separado');
const ids = (f) => filterRows(rows, f).map((r) => r.id).join(',');
ok(ids({ division: 'campo' }) === 'b,c' && ids({ division: 'puerto' }) === 'a', 'filtro por división');
ok(ids({ gps: 'moving' }) === 'a' && ids({ gps: 'stopped' }) === 'b,d' && ids({ gps: 'nosignal' }) === 'c', 'filtro por movimiento GPS');
ok(ids({ status: 'unloading' }) === 'b' && ids({ type: 'tolva' }) === 'c' && ids({ operating: true }) === 'a,b', 'filtro por estado del viaje, tipo de remolque y en operación');
ok(ids({ text: 'u12' }) === 'a' && ids({ text: '60bn4j' }) === 'a' && ids({ text: 'castaneda' }) === 'b' && ids({ text: 'mscu 1234567' }) === 'a' && ids({ text: 'camp' }) === 'c', 'buscador: número económico, placas, operador (sin acentos) y referencia');
ok(sortRows(rows, (s) => ({ to_destination: 1, unloading: 3 }[s] || 9)).map((r) => r.id).join(',') === 'a,b,d,c', 'orden: en operación primero, luego detenidas y sin señal');

/* Rastreo para clientes */
ok(['loading', 'to_destination', 'unloading', 'empty_transit', 'empty', 'inactive'].every(isTrackable) && !isTrackable('x'), 'se comparte en cualquier estado (Cargando, En ruta a destino, Descargando, En ruta vacío, Vacío, Inactiva)');
const op = { id: 'lg_1', vehicleId: 'v1', status: 'to_destination', origin: 'Manzanillo', destination: 'Guadalajara', deliveryPlace: 'CEDIS', operatorId: 'o1' };
ok(shareBlock(op, '865190071363660') === '' && /operación activa/.test(shareBlock({ ...op, closedAt: now }, '1')) && shareBlock({ ...op, status: 'empty' }, '1') === '' && shareBlock({ ...op, status: 'loading' }, '1') === '' && /GPS vinculado/.test(shareBlock(op, '')), 'motivos para no compartir (sin operación o sin GPS; cualquier estado se puede compartir)');
const pay = linkPayload(op, { label: 'U12', trailerType: 'chasis', operator: 'Daniel Rivera', placas: '60-BN-4J' }, '865190071363660', { loc: { lat: 20.66, lng: -103.35, precision: 'city' } });
ok(pay.opId === 'lg_1' && pay.place === 'CEDIS' && pay.dest.approx === true && pay.operator === 'Daniel Rivera' && !JSON.stringify(pay).includes('Antonio') && !JSON.stringify(pay).includes('60-BN-4J'), 'al compartir: operador solo con nombre y apellido, sin placas; destino aproximado marcado');
ok(shortName('Daniel Antonio Rivera Bautista') === 'Daniel Rivera' && shortName('José Castañeda Villalobos') === 'José Castañeda' && shortName('Juan García') === 'Juan García' && shortName('  Pedro  ') === 'Pedro' && shortName('') === '', 'nombre del operador para el cliente: un nombre y el apellido paterno');
ok(shortName('Juan de la Cruz Pérez') === 'Juan de la Cruz' && shortName('Luis del Río') === 'Luis del Río' && shortName('María Fernanda de León Ortiz') === 'María de León', 'apellidos con partículas (de, del, de la)');
ok(destPoint(null) === null && destPoint({ loc: { lat: 1, lng: 2, precision: 'manual' } }).approx === false, 'destino solo si ya está ubicado');
const L = (o) => ({ id: 'x' + o.opId, state: 'active', status: 'to_destination', hasDest: true, ...o });
const acts = reconcile([L({ opId: 'a', operator: 'Daniel Rivera' }), L({ opId: 'b' }), L({ opId: 'c' }), L({ opId: 'd' }), L({ opId: 'e', hasDest: false, operator: 'Daniel Rivera' }), L({ opId: 'f' }), L({ opId: 'g', state: 'finished' }), L({ opId: 'h', operator: 'Daniel Rivera' })],
  (id) => ({ a: { status: 'to_destination', op: 'Daniel Antonio Rivera Bautista' }, b: { status: 'empty_transit' }, c: { status: 'inactive', closedAt: now }, d: null, e: { status: 'unloading', op: 'Daniel Antonio Rivera Bautista' }, g: { status: 'empty' }, h: { status: 'to_destination', op: 'José Castañeda Villalobos' } }[id]),
  () => ({ lat: 20, lng: -103, approx: false }), (op) => op.op || '');
const by = Object.fromEntries(acts.map((a) => [a.link.opId, a]));
ok(!by.a && by.b.action === 'update' && by.b.body.status === 'empty_transit' && by.c.action === 'finish' && by.c.body.reason === 'closed' && by.d.action === 'finish', 'En ruta vacío: el enlace sigue activo y recibe el estado; al cerrar o borrar la operación se finaliza');
ok(by.e.action === 'update' && by.e.body.status === 'unloading' && by.e.body.dest.lat === 20 && !by.e.body.operator && !by.f && !by.g, 'cambio de estado y destino recién ubicado se envían; operaciones de otro dispositivo y enlaces cerrados no se tocan');
ok(by.h.action === 'update' && by.h.body.operator === 'José Castañeda' && !by.a, 'cambio de operador: el cliente ve al nuevo operador');
const accT = reconcile([L({ opId: 'a', operator: 'Daniel Rivera', trailer: '788-WR-4' }), L({ opId: 'b', operator: 'Daniel Rivera', trailer: '788-WR-4' }), L({ opId: 'c', operator: 'Daniel Rivera' })],
  (id) => ({ status: 'to_destination', op: 'Daniel Antonio Rivera Bautista', tr: { a: '788-wr-4', b: 'JX-55-123', c: 'JX-55-123' }[id] }), () => null, (op) => op.op, (op) => ({ placas: op.tr, type: 'chasis' }));
const byT = Object.fromEntries(accT.map((a) => [a.link.opId, a]));
ok(!byT.a && byT.b.body.trailer === 'JX-55-123' && byT.b.body.trailerType === 'chasis' && !byT.c, 'cambio de remolque: el portal recibe las placas del nuevo remolque (Worker anterior sin placas: no se reenvía)');
ok(linkPayload(op, { label: 'U12', trailerType: 'chasis', trailer: '788-WR-4', operator: 'Daniel Rivera', placas: '60-BN-4J' }, '1', null).trailer === '788-WR-4', 'al compartir: placas del remolque asignado (no las de la unidad)');

/* Datos de la flota completados con la consulta por unidad (misma regla en la app y en el Worker) */
const fl = { lat: 19.01007, lng: -103.832489, gpsTime: null, signalTime: null, speed: 0, address: null };
const det = { lat: 19.0101, lng: -103.8325, gpsTime: now - 30 * min, signalTime: now - 40000, address: 'Autopista Colima' };
const mg = mergePositions(fl, det);
ok(mg.signalTime === det.signalTime && mg.gpsTime === det.gpsTime && mg.lat === fl.lat && mg.address === 'Autopista Colima' && mg.speed === 0, 'flota sin horas: se toman la señal y la hora de la consulta por unidad (mismo lugar) sin perder la posición de la flota');
ok(freshness(fl, now).state === 'stale' && freshness(mg, now).state === 'parked', 'sin completar se vería «sin señal»; completada: detenida con señal reciente');
ok(mergePositions({ ...fl, lat: 19.2 }, det).gpsTime === null, 'si la unidad ya se movió, no se le pone la hora de otra posición');
ok(mergePositions({ ...fl, gpsTime: now - min, signalTime: now - min }, { ...det, signalTime: now - 5000 }).signalTime === now - 5000 && mergePositions(null, det).lat === det.lat, 'la señal más reciente de ambas; sin flota se usa la consulta por unidad');
ok(/vence en 72 h/.test(linkStateText({ state: 'active', expiresAt: now + 72 * 3600000 }, now)) && /Revocado/.test(linkStateText({ state: 'revoked' }, now)), 'texto del estado del enlace');

/* Estilo cartográfico */
const light = buildStyle('light'), dark = buildStyle('dark');
ok(light.sources.omt.url === PROVIDER.tilejson && /OpenStreetMap/.test(light.sources.omt.attribution) && /OpenFreeMap/.test(PROVIDER.attribution), 'proveedor OpenFreeMap con atribución de OpenStreetMap y OpenMapTiles');
ok(light.layers.length === dark.layers.length && light.layers[0].paint['background-color'] !== dark.layers[0].paint['background-color'] && !light.sprite, 'estilo propio claro y oscuro (sin íconos de terceros)');
ok(JSON.stringify(light).includes('name:es'), 'nombres en español cuando existen');
