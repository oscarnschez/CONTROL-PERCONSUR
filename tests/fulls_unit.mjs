/* Control de llenos (sin navegador): documentos por ubicación y regla del DEC, estado documental, validación de la carga,
   pizarra (semanas y mes), filtros, indicadores, expediente (orden y nombre), respaldo manipulado y sincronización */
import {
  LOAD_STATUSES, loadStatus, isOpenLoad, slotTypes, defaultRequired, reconcileDocs, docState, docSummary, docSummaryText, sortDocs, checkLoad, parseWeight,
  addDays, weekStart, weekDays, monthGrid, rangeDates, byDay, isLate, summary, filterLoads, eventLabel, dossierDocs, dossierFilename, weightText, sanitizeLoad, sanitizeDoc, sanitizeEvent,
} from '../src/domain/fulls/fulls.js';
import { SYNC_STORES } from '../src/domain/sync/sync.js';
const ok = (c, m) => console.log((c ? 'OK  ' : 'FAIL') + ' ' + m);
const doc = (id, docType, required, file = false, extra = {}) => ({ id, loadId: 'L', docType, required, manual: false, order: 0, ...(file ? { storageKey: 'k' + id, fileStatus: 'ok', kind: 'pdf', name: id + '.pdf', pages: 2, size: 1000 } : { storageKey: null, fileStatus: 'none' }), ...extra });

/* Documentos según la ubicación y regla del DEC */
ok(slotTypes('port').join() === 'pedimento,doda,cita,dec' && slotTypes('offport').join() === 'pedimento,doda,cita', 'dentro de puerto: pedimento, DODA, cita y DEC; fuera de puerto: sin DEC');
ok(defaultRequired('dec', 'port') && !defaultRequired('dec', 'offport') && defaultRequired('cita', 'port') && !defaultRequired('cita', 'offport') && defaultRequired('pedimento', 'offport') && !defaultRequired('otro', 'port'), 'requerido inicial: DEC y cita dentro de puerto; pedimento y DODA siempre; adicionales no');
const p0 = reconcileDocs([], 'port');
ok(p0.create.map((c) => `${c.docType}:${c.required}`).join(' ') === 'pedimento:true doda:true cita:true dec:true' && !p0.update.length && !p0.remove.length, 'carga nueva dentro de puerto: se crean los cuatro documentos, todos requeridos');
const o0 = reconcileDocs([], 'offport');
ok(o0.create.map((c) => `${c.docType}:${c.required}`).join(' ') === 'pedimento:true doda:true cita:false', 'carga nueva fuera de puerto: pedimento y DODA requeridos, cita cuando aplique, sin DEC');
const portDocs = [doc('a', 'pedimento', true, true), doc('b', 'doda', true, true), doc('c', 'cita', true), doc('d', 'dec', true, true)];
const sw = reconcileDocs(portDocs, 'offport');
ok(!sw.create.length && !sw.remove.length && JSON.stringify(sw.update) === JSON.stringify([{ id: 'c', patch: { required: false } }, { id: 'd', patch: { required: false, manual: false } }]), 'de dentro a fuera de puerto: el DEC con archivo se conserva como no requerido y la cita deja de ser requerida');
const sw2 = reconcileDocs([doc('a', 'pedimento', true), doc('b', 'doda', true), doc('c', 'cita', true), doc('d', 'dec', true)], 'offport');
ok(sw2.remove.join() === 'd' && sw2.update.length === 1 && sw2.update[0].id === 'c', 'de dentro a fuera: un DEC sin archivo se quita (no hay nada que perder)');
const back = reconcileDocs([doc('a', 'pedimento', true), doc('b', 'doda', true), doc('c', 'cita', false), doc('d', 'dec', false, true)], 'port');
ok(!back.create.length && back.update.map((u) => u.id + ':' + u.patch.required).join(' ') === 'c:true d:true', 'de fuera a dentro de puerto: cita y DEC vuelven a ser requeridos');
const manual = reconcileDocs([doc('a', 'pedimento', true), doc('b', 'doda', true), doc('c', 'cita', true), doc('d', 'dec', false, true, { manual: true })], 'port');
ok(!manual.update.length, 'un DEC marcado a mano como no requerido no se vuelve a exigir al cambiar la ubicación');
const manual2 = reconcileDocs([doc('a', 'pedimento', true), doc('b', 'doda', true), doc('c', 'cita', true), doc('d', 'dec', true, true, { manual: true })], 'offport');
ok(manual2.update.some((u) => u.id === 'd' && u.patch.required === false) && manual2.update.some((u) => u.id === 'c' && u.patch.required === false), 'fuera de puerto el DEC deja de exigirse aunque se haya marcado a mano como requerido');

/* Estado de cada documento y de la carga */
ok(docState(doc('x', 'dec', true, true)) === 'attached' && docState(doc('x', 'dec', true)) === 'pending' && docState(doc('x', 'dec', false)) === 'not_required' && docState(doc('x', 'dec', false, true)) === 'attached', 'estados: Adjuntado, Pendiente y No requerido');
const s1 = docSummary(portDocs);
ok(!s1.complete && s1.required === 4 && s1.attached === 3 && s1.missing.map((d) => d.id).join() === 'c' && docSummaryText(s1) === 'Documentación incompleta (3 de 4)', 'incompleta: falta la cita requerida');
const s2 = docSummary([...portDocs.slice(0, 2), doc('c', 'cita', false), doc('d', 'dec', true, true), doc('e', 'otro', false, true)]);
ok(s2.complete && s2.required === 3 && s2.attached === 3 && s2.optional === 1 && s2.files === 4 && docSummaryText(s2) === 'Documentación completa (3 de 3)', 'completa: los no requeridos y los adicionales no la detienen');
ok(docSummary([doc('d', 'dec', true), doc('a', 'pedimento', true, true)]).complete === false && docSummary([doc('d', 'dec', false)]).complete, 'un DEC requerido sin archivo deja la documentación incompleta; marcado como no requerido, no');
ok(sortDocs([doc('e', 'otro', false, true, { order: 2 }), doc('d', 'dec', true), doc('f', 'otro', false, true, { order: 1 }), doc('a', 'pedimento', true)]).map((d) => d.id).join() === 'a,d,f,e', 'orden: pedimento, DODA, cita, DEC y adicionales en su orden');

/* Validación de la carga */
const base = { containerNumber: ' mscu 123-4567 ', weightKg: '28,500', reference: ' BL 778 ', notes: '', locationType: 'port', terminalId: 't1', yardId: null, scheduledDate: '2026-10-15', scheduledTime: '09:30' };
const c1 = checkLoad(base);
ok(c1.load && c1.load.containerNumber === 'MSCU1234567' && c1.load.weightKg === 28500 && c1.load.reference === 'BL 778' && c1.load.yardId === null && !c1.duplicate, 'carga válida: contenedor en mayúsculas sin espacios ni guiones, peso 28,500 kg, referencia limpia');
ok(checkLoad({ ...base, containerNumber: '' }).errors.containerNumber === 'Escribe el número de contenedor.' && checkLoad({ ...base, containerNumber: 'MSCU12' }).errors.containerNumber === 'El número de contenedor debe tener 4 letras y 7 números.', 'contenedor vacío o con formato incorrecto');
ok(checkLoad({ ...base, weightKg: '-5' }).errors.weightKg && checkLoad({ ...base, weightKg: '' }).errors.weightKg === 'Escribe el peso en kilogramos.' && checkLoad({ ...base, weightKg: '0' }).errors.weightKg === 'El peso debe ser mayor a cero.' && checkLoad({ ...base, weightKg: 'abc' }).errors.weightKg, 'peso: no negativo, no vacío, mayor a cero y numérico');
ok(checkLoad({ ...base, scheduledDate: '2026-13-01' }).errors.scheduledDate && checkLoad({ ...base, scheduledTime: '25:00' }).errors.scheduledTime && checkLoad({ ...base, scheduledTime: '' }).errors.scheduledTime, 'fecha y hora inválidas se rechazan');
ok(checkLoad({ ...base, terminalId: null }).errors.terminalId === 'Elige la terminal portuaria.' && checkLoad({ ...base, locationType: 'offport', terminalId: 't1', yardId: null }).errors.yardId === 'Elige el patio o la instalación de carga.' && checkLoad({ ...base, locationType: 'x' }).errors.locationType, 'dentro de puerto pide terminal; fuera, patio; la ubicación debe ser válida');
const off = checkLoad({ ...base, locationType: 'offport', yardId: 'y1' }).load;
ok(off.terminalId === null && off.yardId === 'y1', 'fuera de puerto se guarda el patio y no la terminal');
const existing = [{ id: 'L1', containerNumber: 'MSCU1234567', status: 'scheduled' }, { id: 'L2', containerNumber: 'TGHU7654321', status: 'loaded' }];
ok(checkLoad(base, { existing }).duplicate.id === 'L1' && !checkLoad({ ...base, containerNumber: 'TGHU7654321' }, { existing }).duplicate && !checkLoad(base, { existing, selfId: 'L1' }).duplicate, 'advierte un posible duplicado solo contra cargas abiertas (y no contra sí misma)');
ok(parseWeight('28 500') === 28500 && parseWeight('28500.4') === 28500 && Number.isNaN(parseWeight('1e3x')) && parseWeight('') === null, 'peso: admite comas y espacios; redondea a kilos');

/* Estados operativos */
ok(LOAD_STATUSES.map((s) => s.key).join() === 'scheduled,docs_pending,ready,loading,loaded,cancelled' && isOpenLoad({ status: 'ready' }) && !isOpenLoad({ status: 'loaded' }) && !isOpenLoad({ status: 'cancelled' }) && loadStatus('zz').key === 'scheduled', 'seis estados: cargada y cancelada cierran la carga; un estado desconocido se lee como Programada');
ok(!isLate({ status: 'scheduled', scheduledDate: '2026-10-15', scheduledTime: '09:30' }, new Date(2026, 9, 15, 9, 0)) && isLate({ status: 'scheduled', scheduledDate: '2026-10-15', scheduledTime: '09:30' }, new Date(2026, 9, 15, 10, 0)) && !isLate({ status: 'loaded', scheduledDate: '2026-10-01', scheduledTime: '09:30' }, new Date(2026, 9, 15)), 'cita vencida: la hora pasó y la carga sigue abierta (una cargada nunca está vencida)');

/* Pizarra */
ok(addDays('2026-10-31', 1) === '2026-11-01' && weekStart('2026-10-15') === '2026-10-12' && weekDays('2026-10-18').join(',') === '2026-10-12,2026-10-13,2026-10-14,2026-10-15,2026-10-16,2026-10-17,2026-10-18', 'semanas de lunes a domingo');
const g = monthGrid('2026-10-15');
ok(g.length === 5 && g[0][0] === '2026-09-28' && g[4][6] === '2026-11-01' && monthGrid('2026-02-10').length === 5 && monthGrid('2026-02-10')[0][0] === '2026-01-26' && monthGrid('2026-02-10')[4][6] === '2026-03-01' && monthGrid('2026-06-10').length === 5, 'cuadrícula del mes con los días de relleno (del lunes anterior al domingo posterior)');
const rd = (r, t) => { const x = rangeDates(r, t); return `${x.from}..${x.to}`; };
ok(rd('month', '2026-10-14') === '2026-10-01..2026-10-31' && rd('month', '2026-12-31') === '2026-12-01..2026-12-31' && rd('month', '2028-02-10') === '2028-02-01..2028-02-29' && rd('month', '2026-01-31') === '2026-01-01..2026-01-31', '«Este mes» va del día 1 al último día del mes (no incluye el 1 del mes siguiente)');
ok(rd('tomorrow', '2026-10-31') === '2026-11-01..2026-11-01' && rd('week', '2026-10-28') === '2026-10-28..2026-11-03' && rd('today', '2026-10-14') === '2026-10-14..2026-10-14' && JSON.stringify(rangeDates('all', '2026-10-14')) === '{}' && JSON.stringify(rangeDates('late', '2026-10-14')) === '{}', 'rangos de hoy, mañana y próximos 7 días; «todas» y «vencidas» no limitan fechas');
const loads = [
  { id: 'a', containerNumber: 'MSCU1234567', status: 'scheduled', scheduledDate: '2026-10-15', scheduledTime: '14:00', locationType: 'port', terminalId: 't1', createdAt: 1 },
  { id: 'b', containerNumber: 'TGHU7654321', status: 'ready', scheduledDate: '2026-10-15', scheduledTime: '09:30', locationType: 'offport', yardId: 'y1', vehicleId: 'u1', createdAt: 2 },
  { id: 'c', containerNumber: 'ONEU1111111', status: 'loaded', scheduledDate: '2026-10-16', scheduledTime: '08:00', locationType: 'port', terminalId: 't2', createdAt: 3 },
  { id: 'd', containerNumber: 'CMAU2222222', status: 'cancelled', scheduledDate: '2026-10-21', scheduledTime: '08:00', locationType: 'port', terminalId: 't1', createdAt: 4 },
];
const bd = byDay(loads);
ok([...bd.keys()].join() === '2026-10-15,2026-10-16,2026-10-21' && bd.get('2026-10-15').map((r) => r.id).join() === 'b,a', 'cargas por día ordenadas por hora');
const docsOf = (id) => (id === 'a' ? [doc('x', 'pedimento', true)] : [doc('x', 'pedimento', true, true)]);
const sm = summary(loads, docsOf, new Date(2026, 9, 15, 8));
ok(sm.today === 2 && sm.tomorrow === 0 && sm.week === 2 && sm.docsPending === 1 && sm.ready === 1 && sm.done === 1 && sm.late === 0, 'indicadores: hoy 2, semana 2 (la cargada y la cancelada no cuentan), 1 sin documentación, 1 lista, 1 finalizada');
const view = (r) => ({ place: r.terminalId === 't1' ? 'Contecon' : r.terminalId === 't2' ? 'SSA' : 'PATIO X', unit: r.vehicleId ? 'U21' : '', placas: '', operator: '', trailer: '', docs: docSummary(docsOf(r.id)) });
ok(filterLoads(loads, { text: 'contecon' }, view).map((r) => r.id).join() === 'a,d' && filterLoads(loads, { terminalId: 't1', status: 'open' }, view).map((r) => r.id).join() === 'a' && filterLoads(loads, { yardId: 'y1' }, view).map((r) => r.id).join() === 'b', 'filtros por terminal o patio y búsqueda por nombre del lugar');
ok(filterLoads(loads, { location: 'offport' }, view).map((r) => r.id).join() === 'b' && filterLoads(loads, { docs: 'incomplete' }, view).map((r) => r.id).join() === 'a' && filterLoads(loads, { vehicleId: 'u1' }, view).map((r) => r.id).join() === 'b' && filterLoads(loads, { from: '2026-10-16', to: '2026-10-31' }, view).map((r) => r.id).join() === 'c,d' && filterLoads(loads, { text: 'u21' }, view).map((r) => r.id).join() === 'b', 'filtros por dentro/fuera, estado documental, unidad y rango de fechas; búsqueda por unidad');
let calls = 0; const counting = (r) => { calls++; return view(r); };
filterLoads(loads, { status: 'open', terminalId: 't1', from: '2026-10-01' }, counting); const noView = calls; calls = 0;
const hit = filterLoads(loads, { status: 'open', text: 'contecon' }, counting).map((r) => r.id).join();
ok(noView === 0 && calls === 2 && hit === 'a', 'filtros sin búsqueda ni filtro documental no resuelven catálogos; con búsqueda, solo las cargas que pasan los demás filtros');

/* Historial y expediente */
ok(eventLabel({ eventType: 'doc_added', docType: 'pedimento' }) === 'Pedimento añadido' && eventLabel({ eventType: 'doc_added', docType: 'cita' }) === 'Cita de recinto portuario añadida' && eventLabel({ eventType: 'doc_added', docType: 'dec' }) === 'DEC añadido' && eventLabel({ eventType: 'reschedule' }) === 'Reprogramación' && eventLabel({ eventType: 'loaded' }) === 'Carga finalizada', 'etiquetas del historial por tipo de documento');
const xd = [doc('e', 'otro', false, true, { order: 2 }), doc('d', 'dec', true, true), doc('c', 'cita', true), doc('b', 'doda', true, true), doc('a', 'pedimento', true, true), doc('f', 'otro', false, true, { order: 1 })];
ok(dossierDocs(xd, {}).included.map((d) => d.id).join() === 'a,b,d,f,e', 'expediente: pedimento, DODA, (cita sin archivo se omite), DEC y adicionales');
const custom = dossierDocs(xd, { dossierOrder: ['d', 'a'], dossierSkip: ['e'] });
ok(custom.all.map((d) => d.id).join() === 'd,a,b,f,e' && custom.included.map((d) => d.id).join() === 'd,a,b,f' && custom.skipped.map((d) => d.id).join() === 'e', 'el orden guardado va primero, los nuevos al final y los excluidos no se incluyen');
ok(dossierFilename({ containerNumber: 'mscu 1234567', scheduledDate: '2026-10-15' }) === 'PERCONSUR-Lleno-MSCU1234567-2026-10-15.pdf' && weightText(28500) === '28,500 kg', 'nombre del expediente y texto del peso');

/* Respaldo manipulado e información compartida */
const sl = sanitizeLoad({ id: 'L', containerNumber: 'mscu1234567', weightKg: '28500', locationType: 'offport', terminalId: 't1', yardId: 'y1', scheduledDate: '2026-10-15', scheduledTime: '9:5', status: 'otro', vehicleId: 7, dossierOrder: ['a', 3], notes: 'x'.repeat(900) });
ok(sl.containerNumber === 'MSCU1234567' && sl.weightKg === 28500 && sl.terminalId === null && sl.yardId === 'y1' && sl.scheduledTime === '' && sl.status === 'scheduled' && sl.vehicleId === null && sl.dossierOrder.join() === 'a' && sl.notes.length === 500 && sanitizeLoad({ id: 'L', containerNumber: 'MSCU1234567', locationType: 'port', scheduledDate: 'ayer' }) === null, 'una carga manipulada queda con la forma esperada; sin fecha válida se descarta');
const sd = sanitizeDoc({ id: 'D', loadId: 'L', docType: 'dec', required: 1, kind: 'html', storageKey: 'k', mimeType: 'text/html' });
ok(sd.kind === null && sd.storageKey === null && sd.fileStatus === 'none' && sd.required === true && sanitizeDoc({ id: 'D', loadId: 'L', docType: 'factura' }) === null && sanitizeDoc({ id: 'D', loadId: 'L', docType: 'otro', kind: 'img', storageKey: 'k', mimeType: 'image/svg+xml' }).mimeType === 'image/jpeg', 'un documento con tipo de archivo no permitido pierde el archivo; un tipo documental desconocido se descarta');
ok(sanitizeEvent({ id: 'E', loadId: 'L', eventType: 'doc_added', docType: 'dec', date: '2026-10-15', time: '09:30' }).docType === 'dec' && sanitizeEvent({ id: 'E', loadId: 'L', eventType: 'x', docType: 'zz', date: 'ayer' }).docType === '' && sanitizeEvent({ loadId: 'L' }) === null, 'los movimientos conservan solo tipos válidos');
ok(['loadingYards', 'fullContainerLoads', 'fullContainerDocuments', 'fullContainerEvents'].every((s) => SYNC_STORES.includes(s)), 'las cargas, sus documentos, el historial y los patios de carga se comparten con los demás dispositivos');
