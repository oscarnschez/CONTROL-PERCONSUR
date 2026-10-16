// Órdenes de Servicio (sin navegador): folio, tipos de operación por división, estados compuestos y siguiente paso,
// validación del despacho (bloqueos y advertencias), cierre operativo (Puerto con devolución, excepción y Campo),
// documentación (reglas de Control de llenos, verificación por archivo), finanzas (impuestos por división, comisión sobre
// la tarifa sin IVA), filtros, indicadores, instantáneas de documentos emitidos, historial unificado y respaldo.
import * as D from '../src/domain/orders/orders.js';
import { SYNC_STORES } from '../src/domain/sync/sync.js';
import { readFileSync } from 'node:fs';
const ok = (c, m) => console.log((c ? 'OK  ' : 'FAIL') + ' ' + m);
const ROOT = new URL('..', import.meta.url).pathname;

// Folio
ok(D.formatFolio(2026, 48) === 'OS-2026-000048' && D.FOLIO_RE.test('OS-2026-000048') && !D.FOLIO_RE.test('OS-26-48'), 'folio OS-AAAA-NNNNNN');
ok(D.nextFolioNumber(5, ['OS-2026-000003'], 2026) === 6 && D.nextFolioNumber(2, ['OS-2026-000009', 'OS-2025-000400'], 2026) === 10 && D.nextFolioNumber(0, [], 2027) === 1, 'siguiente folio: nunca menor que el contador ni que el folio más alto del año (respaldos, otro equipo); cada año empieza en 1');
ok(D.folioNumber('OS-2026-000123', 2026) === 123 && D.folioNumber('OS-2025-000123', 2026) === 0, 'número de folio por año');

// Tipos de operación
ok(D.opTypesFor('puerto').length === 4 && D.opTypesFor('campo').map((t) => t.key).join() === 'campo_load' && D.defaultOpType('puerto') === 'full_pickup', 'tipos de operación por división (Puerto distingue lleno, exportación, vacío y otros)');
ok(D.opTypeOf('full_pickup').fullLoad && D.opTypeOf('full_pickup').emptyReturn && !D.opTypeOf('export').emptyReturn && !D.opTypeOf('campo_load').container, 'solo la recolección de lleno usa Control de llenos y devolución de vacío; Campo no pide contenedor marítimo');

// Base de órdenes ficticias
const base = (x = {}) => ({ id: 'so_1', folio: 'OS-2026-000001', phase: 'scheduled', division: 'puerto', opType: 'full_pickup', origin: 'Manzanillo', destination: 'Guadalajara', containerNumber: 'MSCU1234565', vehicleId: 'v1', operatorId: 'o1', trailerId: 't1', finance: D.defaultFinance('puerto'), docChecks: {}, incidents: [], generated: [], ...x });
const doc = (t, f = true, req = true, id = t) => ({ id, docType: t, required: req, storageKey: f ? 'm_' + id : null, fileStatus: f ? 'ok' : 'none' });
const fullDocs = [doc('pedimento'), doc('doda'), doc('cita'), doc('dec')];
const R = { loadLinked: true, vehicleId: 'v1', operatorId: 'o1', trailerId: 't1', origin: 'Manzanillo', destination: 'Guadalajara', containerNumber: 'MSCU1234565' };
const op = (status, x = {}) => ({ id: 'lg_1', status, closedAt: null, statusLog: [{ status, at: 1000, by: 'prueba' }], ...x });
const st = (o, x = {}) => D.deriveState({ order: o, docs: fullDocs, resolved: R, ...x });

// Estados y siguiente paso
ok(st(base({ phase: 'draft' })).key === 'draft' && st(base({ phase: 'draft' })).next.action === 'edit', 'borrador: siguiente paso «Completa los datos y confirma la orden»');
let s = st(base(), { docs: [doc('pedimento'), doc('doda'), doc('cita'), doc('dec', false)] });
ok(s.key === 'docs_pending' && s.next.text === 'Pendiente de adjuntar DEC' && s.docs.key === 'incomplete', 'falta el DEC: «Pendiente de adjuntar DEC» (documento real que falta, no un mensaje genérico)');
s = st(base({ vehicleId: null }), { resolved: { ...R, vehicleId: null } });
ok(s.key === 'assign_pending' && /unidad/.test(s.next.text), 'sin unidad: pendiente de asignación');
s = st(base(), { docs: [doc('pedimento'), doc('doda'), doc('cita'), doc('dec', false, false)] });
ok(s.key === 'ready' && s.next.text === 'Lista para despacho' && s.docs.key === 'to_verify', 'DEC no requerido y lo demás adjunto: lista para despacho (documentos por verificar aparte)');
ok(st(base({ docChecks: { pedimento: { key: 'm_pedimento' }, doda: { key: 'm_doda' }, cita: { key: 'm_cita' }, dec: { key: 'm_dec' } } })).docs.key === 'complete', 'documentación completa cuando cada archivo actual está verificado');
ok(st(base({ docChecks: { pedimento: { key: 'm_viejo' }, doda: { key: 'm_doda' }, cita: { key: 'm_cita' }, dec: { key: 'm_dec' } } })).docs.toVerify.length === 1, 'reemplazar un archivo pide verificarlo otra vez');
s = st(base(), { op: op('assigned') });
ok(s.key === 'dispatched' && s.next.action === 'advance' && s.logistics.label === 'Asignada', 'despachada y asignada: «Confirmar salida de la unidad» (no se da por iniciado el movimiento)');
ok(st(base(), { op: op('to_destination') }).key === 'in_operation' && st(base(), { op: op('to_destination') }).next.text === 'En seguimiento', 'en ruta: en operación, en seguimiento');
ok(st(base(), { op: op('unloading') }).next.text === 'Confirmar entrega', 'descargando: «Confirmar entrega»');
const dlv = { date: '2026-10-16', time: '17:30', at: 2000, by: 'prueba' };
s = st(base({ delivery: dlv }), { op: op('unloading') });
ok(s.key === 'delivered' && s.next.text === 'Marcar contenedor vacío' && s.delivery.key === 'done' && s.ret.key === 'waiting', 'entrega del lleno ≠ orden finalizada: queda pendiente el vacío');
s = st(base({ delivery: dlv }), { op: op('empty'), empty: { id: 'ec_1', status: 'pending' } });
ok(s.key === 'return_pending' && s.next.text === 'Programar devolución del vacío', 'vacío creado sin programar: «Programar devolución del vacío»');
s = st(base({ delivery: dlv }), { op: op('empty_transit'), empty: { id: 'ec_1', status: 'in_transit' } });
ok(s.key === 'return_transit' && s.next.text === 'Confirmar devolución del vacío', 'vacío en traslado: «Confirmar devolución del vacío»');
s = st(base({ delivery: dlv }), { op: op('empty'), empty: { id: 'ec_1', status: 'delivered' } });
ok(s.key === 'closing' && s.next.text === 'Lista para cierre operativo' && s.ret.key === 'delivered', 'vacío entregado: lista para cierre operativo');
s = st(base({ delivery: dlv, incidents: [{ id: 'i1', text: 'Daño', critical: true }] }), { op: op('empty'), empty: { id: 'ec_1', status: 'delivered' } });
ok(s.next.action === 'incidents' && s.critical.length === 1, 'una incidencia crítica abierta se resuelve antes del cierre');
ok(st(base({ closedAt: 3000 }), { op: op('inactive', { closedAt: 3000 }) }).key === 'closed' && st(base({ phase: 'cancelled' })).key === 'cancelled', 'finalizada y cancelada');

// Campo y Puerto sin devolución
const campo = base({ division: 'campo', opType: 'campo_load', containerNumber: '', trailerId: 't2' });
s = D.deriveState({ order: campo, docs: [], resolved: { ...R, containerNumber: '', loadLinked: false } });
ok(s.key === 'ready' && s.docs.key === 'not_applicable' && !s.needsReturn, 'Campo: sin documentación portuaria ni vacíos');
s = D.deriveState({ order: { ...campo, delivery: dlv }, op: op('unloading'), docs: [], resolved: { ...R, loadLinked: false } });
ok(s.key === 'closing' && s.progress.map((p) => p.key).join() === 'capture,docs,assign,dispatch,delivery,close', 'Campo: tras la entrega queda lista para cierre; el avance omite el paso de vacío');
ok(st(base({ opType: 'export' }), { resolved: { ...R, loadLinked: false } }).needsReturn === false && st(base()).progress.some((p) => p.key === 'empty'), 'exportación sin devolución; recolección de lleno con paso de vacío');
s = st(base({ delivery: dlv, noEmptyReturn: { reason: 'Cliente devuelve', at: 1, by: 'x' } }), { op: op('unloading') });
ok(s.key === 'closing' && s.ret.key === 'waived', 'excepción autorizada: no requiere devolución del vacío');

// Avance
s = st(base({ delivery: dlv }), { op: op('empty'), empty: { id: 'ec_1', status: 'pending' } });
ok(s.progress.map((p) => p.state).join() === 'done,done,done,done,done,current,pending', 'avance basado en eventos reales (captura → … → vacío actual)');

// Despacho
const ctx = (x = {}) => ({ order: base(), resolved: R, docs: fullDocs, conflicts: {}, unit: {}, trailer: { type: 'chasis' }, generatedCount: 1, today: '2026-10-16', canDispatch: true, ...x });
let c = D.dispatchCheck(ctx());
ok(c.ok && c.warnings.map((w) => w.code).join() === 'docs_verify', 'despacho válido; documentos por verificar como advertencia autorizable');
c = D.dispatchCheck(ctx({ conflicts: { unit: true, unitText: 'OS-2026-000002' }, unit: { inactive: true } }));
ok(!c.ok && c.blocks.some((b) => b.code === 'unit_busy' && /OS-2026-000002/.test(b.msg)) && c.blocks.some((b) => b.code === 'unit_inactive'), 'unidad con otra operación activa o inactiva: bloqueo');
c = D.dispatchCheck(ctx({ unit: { inShop: true, expired: ['Póliza de seguro'], noGps: true }, conflicts: { operator: true }, trailer: { type: 'jaula' }, generatedCount: 0 }));
ok(c.ok && ['unit_shop', 'unit_docs_expired', 'unit_no_gps', 'operator_busy', 'trailer_type', 'no_document'].every((k) => c.warnings.some((w) => w.code === k)), 'taller, documentos vencidos, sin GPS, operador ocupado, remolque no habitual y nota sin generar: advertencias');
c = D.dispatchCheck(ctx({ docs: [doc('pedimento'), doc('doda', false)], resolved: { ...R, loadLinked: false, trailerId: null }, order: base({ trailerId: null }), canDispatch: false }));
ok(['perm', 'res_remolque', 'docs', 'data'].every((k) => c.blocks.some((b) => b.code === k)), 'sin permiso, sin remolque, documentación incompleta o sin programación de llenos: bloqueos');

// Cierre
ok(!D.closeCheck({ order: base({ delivery: dlv }), op: op('empty'), docs: fullDocs, empty: { status: 'scheduled' }, resolved: R }).ok, 'Puerto: no se cierra sin la devolución confirmada');
ok(D.closeCheck({ order: base({ delivery: dlv }), op: op('empty'), docs: fullDocs, empty: { status: 'delivered' }, resolved: R }).ok, 'Puerto: entrega + vacío entregado = cierre');
ok(D.closeCheck({ order: { ...campo, delivery: dlv }, op: op('unloading'), docs: [], resolved: R }).ok && !D.closeCheck({ order: campo, op: op('unloading'), docs: [], resolved: R }).ok, 'Campo: se cierra con la entrega confirmada');

// Documentación
ok(D.orderSlots(base()).length === 0 && D.orderSlots(base({ opType: 'export' })).map(([t, r]) => t + (r ? '!' : '')).join() === 'pedimento,doda,dec,cita' && D.orderSlots(campo).length === 0, 'sin carga: Puerto tiene espacios no requeridos; Campo, ninguno; la recolección usa los de Control de llenos');
const dl = D.dossierList([doc('cita'), doc('otro', true, false, 'x1'), doc('dec'), doc('pedimento'), doc('doda'), doc('doda', false, true, 'vacio')]);
ok(dl.all.map((d) => d.id).join() === 'pedimento,doda,dec,cita,x1', 'expediente en el orden Pedimento, DODA, DEC, Cita, adicionales (solo con archivo)');
ok(D.dossierList(fullDocs, { order: ['dec', 'pedimento'], skip: ['cita'] }).included.map((d) => d.id).join() === 'dec,pedimento,doda', 'orden y exclusiones del expediente elegidos por el usuario');

// Finanzas
const fp = D.defaultFinance('puerto'), fc2 = D.defaultFinance('campo');
ok(!fp.applyVat && !fp.applyIsr && !fp.applyVatWithholding && fc2.applyVat && fc2.applyIsr && !fc2.applyVatWithholding, 'impuestos por división: Campo IVA 16% e ISR 4%; Puerto sin impuestos; retención de IVA nunca automática');
const pv = D.financePreview({ ...fc2, fare: 1000000, travelExpenses: 50000 }, { rate: 15, minEnabled: false, minAmount: 250000 });
ok(pv.taxes.totalAfterTaxes === 1000000 + 160000 - 40000 && pv.commission.final === 150000, 'total = base + IVA − ISR − ret. IVA; comisión 15% de la tarifa base sin IVA');
ok(D.financePreview({ ...fp, fare: 1000000 }, { rate: 15, minEnabled: true, minAmount: 250000 }).commission.final === 250000, 'comisión ampliada del operador respetada');
ok(D.financeForDivision({ ...fp, touchedTaxes: true }, 'campo').applyVat === false && D.financeForDivision(fp, 'campo').applyVat === true, 'al cambiar de división, los impuestos siguen la regla salvo que el usuario los haya tocado');

// Listado
const row = (o, sx, v = {}) => ({ order: o, state: sx, view: { customer: 'CLIENTE FICTICIO', origin: o.origin, destination: o.destination, container: o.containerNumber, date: '2026-10-16', vehicleId: o.vehicleId, operatorId: o.operatorId, ...v } });
const rws = [row(base(), st(base())), row(base({ id: 'so_2', folio: 'OS-2026-000002', delivery: dlv }), st(base({ delivery: dlv }), { op: op('unloading') })), row(campo, D.deriveState({ order: campo, docs: [], resolved: R })), row(base({ id: 'so_4', closedAt: 1 }), st(base({ closedAt: 1 })))];
const tc = D.tileCounts(rws);
ok(tc.ready === 2 && tc.delivered === 1 && tc.returns === 1 && tc.closed === 1, 'indicadores con datos reales: listas, entregas, pendientes de devolución, finalizadas');
ok(D.filterRows(rws, { text: 'os-2026-000002' }).length === 1 && D.filterRows(rws, { text: 'mscu 123456' }).length === 3 && D.filterRows(rws, { division: 'campo' }).length === 1 && D.filterRows(rws, { scope: 'finished' }).length === 1, 'buscador por folio o contenedor (sin espacios ni mayúsculas), filtro por división y finalizadas');
ok(D.filterRows(rws, { docs: 'complete' }).length === 3 && D.filterRows(rws, { from: '2026-10-17' }).length === 0 && D.filterRows(rws, { tile: 'returns' }).length === 1, 'filtros por documentación, rango de fechas e indicador');

// Documentos emitidos
const snap = D.snapshotOf({ vehicleId: 'v1', operatorId: 'o1', trailerId: 't1', origin: 'A', destination: 'B', deliveryPlace: '', containerNumber: 'MSCU1234565', customerId: 'p1' });
ok(D.outdatedFields(snap, { ...snap, vehicleId: 'v2' }).join() === 'unidad' && D.outdatedFields(snap, snap).length === 0, 'una nota emitida no cambia: si cambia la unidad se indica qué quedó desactualizado');
ok(D.nextVersion([{ type: 'puerto', version: 1 }, { type: 'puerto', version: 2 }, { type: 'campo', version: 1 }], 'puerto') === 3, 'cada regeneración es una versión nueva (las anteriores se conservan)');

// Historial
const tl = D.timeline({ events: [{ at: 5, by: 'a', text: 'Orden creada', type: 'created' }], op: { statusLog: [{ status: 'assigned', at: 6, by: 'a' }, { status: 'to_destination', at: 8, by: 'Geocerca' }] }, emptyEvents: [{ createdAt: 9, createdBy: 'a', eventType: 'created', label: 'Vacío registrado' }] });
ok(tl.map((e) => e.at).join() === '9,8,6,5' && tl[1].text === 'Logística: En ruta a destino' && tl[1].by === 'Geocerca', 'historial unificado (orden, Logística, vacíos) del más reciente al más antiguo, con quién lo hizo');

// Respaldo e información compartida
ok(D.sanitizeOrder({ id: 'x', folio: 'nada' }) === null && D.sanitizeOrder({ id: 'x', folio: 'OS-2026-000001', division: 'otra', opType: 'raro', phase: 'hack', finance: { fare: -5 } }).division === 'puerto', 'respaldo: folio obligatorio; división, tipo y etapa desconocidos se corrigen');
const so = D.sanitizeOrder({ id: 'x', folio: 'OS-2026-000001', division: 'campo', opType: 'full_pickup', finance: { fare: -5, applyVat: 1 } });
ok(so.opType === 'campo_load' && so.finance.fare === 0 && so.finance.applyVat === true && so.companyId === 'campo', 'respaldo: tipo coherente con la división y montos no negativos');
ok(D.sanitizeOrderFile({ id: 'f', orderId: 'x', docType: 'script' }) === null && D.sanitizeOrderFile({ id: 'f', orderId: 'x', docType: 'entrega', kind: 'exe' }).kind === null, 'respaldo: solo tipos de documento y archivos conocidos');
ok(['serviceOrders', 'serviceOrderEvents', 'serviceOrderFiles'].every((x) => SYNC_STORES.includes(x)), 'las órdenes viajan en la información compartida entre dispositivos');
const backup = readFileSync(ROOT + 'src/services/backup.js', 'utf8'), dbsrc = readFileSync(ROOT + 'src/services/db.js', 'utf8');
ok(/SO_STORES = \['serviceOrders', 'serviceOrderEvents', 'serviceOrderFiles'\]/.test(backup) && /sanitizeOrder\)/.test(backup) && /DB_VERSION = 16/.test(dbsrc), 'respaldo y base de datos (v16) incluyen las órdenes');
const lgcfg = await import('../src/config/logistics.js');
ok(lgcfg.isWorking('assigned') && lgcfg.showOnHome('assigned') && !lgcfg.showOnHome('empty') && !lgcfg.showOnHome('inactive'), 'Asignada aparece en Unidades en operación; Vacío e Inactiva siguen fuera (regla de Inicio sin cambios)');
const tr = await import('../src/domain/tracking/tracking.js');
ok(/no sale/.test(tr.shareBlock({ status: 'assigned' }, '123')) && tr.reconcile([{ state: 'active', opId: 'l', status: 'loading' }], () => ({ status: 'assigned' })).length === 0, 'rastreo para clientes: no se comparte ni se envía «Asignada» (el Worker actual no lo conoce)');
