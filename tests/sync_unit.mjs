/* Reglas de la información compartida entre dispositivos (sin navegador): node sync_unit.mjs */
import { SYNC_STORES, READER_WRITABLE, SYNC_SETTINGS, fileShared, fileMeta, fileSig, uploadPlan, downloadPlan, buildSnapshot, readSnapshot, rowsWithKey, canPublish, whenText, byText, sizeText, roleText, newVer, VER_RE, keyPathOf,
  TALLER_STORES, TALLER_OPS, TALLER_MIRROR, TALLER_WRITABLE, isTallerFile, buildTallerSnapshot, readTallerSnapshot, contentSig, outboxKey, pendingOf, pruneOutbox, shouldApply } from '../src/domain/sync/sync.js';
import { canRoute, roleCfg, isAdmin } from '../src/config/roles.js';
const ok = (c, m) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); if (!c) process.exitCode = 1; };
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };

/* Qué se comparte */
ok(!SYNC_STORES.includes('drafts') && !SYNC_STORES.includes('settings') && !SYNC_STORES.includes('attachments'), 'no se publican borradores, ajustes del dispositivo ni archivos dentro de la foto');
ok(['documents', 'logisticsOperations', 'tripBilling', 'fuelRecords', 'emptyContainers', 'operatorTrips', 'vehicles', 'geocodes'].every((s) => SYNC_STORES.includes(s)), 'sí se publican documentos, Logística, Cobranza, Combustible, Vacíos, Operadores, catálogos y ubicaciones');
ok(READER_WRITABLE.has('settings') && READER_WRITABLE.has('geocodes') && !READER_WRITABLE.has('documents') && !READER_WRITABLE.has('drafts') && !READER_WRITABLE.has('attachments') && !READER_WRITABLE.has('counters'), 'consulta: solo escribe sus ajustes y la caché de ubicaciones');
ok(['syncKey', 'syncRole', 'syncDevice', 'syncUrl'].every((k) => SYNC_SETTINGS.includes(k)), 'ajustes propios de la sincronización (fuera de respaldos)');
ok(fileShared({ id: 'm_1', owner: 'doc:d1' }) && fileShared({ id: 'm_2', owner: 'trip:t1' }) && fileShared({ id: 'm_3', owner: 'op:o1' }) && !fileShared({ id: 'm_4', owner: 'draft:x' }) && !fileShared({ id: 'm 5', owner: 'doc:1' }), 'archivos: se comparten los de documentos, viajes y operadores; nunca los de borradores');
const meta = fileMeta({ id: 'm_1', owner: 'doc:d1', type: 'application/pdf', size: 10, buf: new ArrayBuffer(10) });
ok(!('buf' in meta) && meta.size === 10 && fileSig(meta) === 'doc:d1|10|application/pdf||', 'metadatos sin el contenido');

/* Capturista: archivos por subir y borrar */
const up = { m_1: { id: 'm_1' }, m_9: { id: 'm_9' } };
const p1 = uploadPlan(['m_1', 'm_2', 'm_3'], up, new Set(['m_1']), new Set(['m_3']));
ok(p1.upload.join() === 'm_1,m_2' && p1.remove.join() === 'm_9', 'sube los nuevos y los modificados, omite los que no caben y borra de la nube los eliminados');
ok(uploadPlan(['m_1'], { m_1: {} }).upload.length === 0, 'lo ya subido no se vuelve a subir');

/* Consulta: archivos por descargar, actualizar y quitar */
const want = [{ id: 'm_1', owner: 'doc:a', size: 5 }, { id: 'm_2', owner: 'doc:b', size: 7 }, { id: 'bad id', size: 1 }];
const d1 = downloadPlan(['m_1', 'm_8'], { m_1: 'doc:a|5|||' }, want);
ok(d1.download.map((f) => f.id).join() === 'm_2' && d1.update.length === 0 && d1.remove.join() === 'm_8', 'descarga lo que falta y quita lo que el capturista borró');
ok(downloadPlan(['m_1'], { m_1: 'doc:x|5|||' }, want.slice(0, 1)).update.length === 1, 'mismo archivo con otros datos: se actualizan los metadatos sin descargar');

/* Foto */
const snap = buildSnapshot({ data: { documents: [{ id: 'd1', type: 'puerto' }], drafts: [{ id: 'x' }], settings: [{ key: 'gpsKey', value: 'secreto' }] }, files: [meta], ver: 'v1', device: 'dA', by: 'Oficina' });
ok(!snap.data.drafts && !snap.data.settings && !JSON.stringify(snap).includes('secreto') && snap.data.documents.length === 1 && SYNC_STORES.every((s) => Array.isArray(snap.data[s])), 'la foto lleva solo los registros compartidos (sin borradores ni claves)');
const back = readSnapshot(JSON.parse(JSON.stringify(snap)));
ok(back.ver === 'v1' && back.files.length === 1 && back.data.documents[0].id === 'd1', 'la foto se lee de vuelta');
ok(throws(() => readSnapshot({ app: 'otra' }), /no corresponde/) && throws(() => readSnapshot({ ...snap, format: 9 }), /otra versión/) && throws(() => readSnapshot({ ...snap, ver: '../x' }), /incompleta/)
  && throws(() => readSnapshot({ ...snap, data: { ...snap.data, documents: 'x' } }), /dañada/), 'foto ajena, de otra versión o dañada: se rechaza antes de guardar');
ok(readSnapshot({ ...snap, data: { documents: [1, null, [], { id: 'ok' }] }, files: [{ id: '../x' }, { id: 'm_2' }] }).data.documents.length === 1 && readSnapshot({ ...snap, files: [{ id: '../x' }, { id: 'm_2' }] }).files.length === 1, 'filas y archivos con forma inválida se descartan');
ok(rowsWithKey('documents', [{ id: 'a' }, { id: '' }, {}]).length === 1 && rowsWithKey('tripBilling', [{ tripId: 't' }, { id: 'x' }]).length === 1 && keyPathOf('companies') === 'key', 'cada fila conserva su clave (una sin clave no rompe la transacción)');

/* Publicar sin pisar a otro dispositivo (misma regla que el Worker) */
ok(canPublish(null, { device: 'dA', base: '' }) && canPublish({ device: 'dA', ver: 'v1' }, { device: 'dA', base: '' }) && canPublish({ device: 'dB', ver: 'v2' }, { device: 'dA', base: 'v2' }) && !canPublish({ device: 'dB', ver: 'v2' }, { device: 'dA', base: 'v1' }), 'otro dispositivo publicó después: hay que decidir');

/* Textos */
const now = new Date(2026, 9, 9, 15, 0).getTime();
ok(whenText(new Date(2026, 9, 9, 10, 42).getTime(), now) === 'hoy 10:42' && whenText(new Date(2026, 9, 8, 9, 5).getTime(), now) === 'ayer 09:05' && whenText(new Date(2026, 8, 1, 7, 0).getTime(), now) === '01/09/2026 07:00' && whenText(0) === 'nunca', 'fecha de la última publicación');
ok(byText(encodeURIComponent('Óscar – iPad')) === 'Óscar – iPad' && byText('%E0%A4%A') === '%E0%A4%A', 'nombre de quien publicó (con acentos)');
ok(sizeText(900) === '900 B' && sizeText(2048) === '2 KB' && sizeText(3.5 * 1024 * 1024) === '3.5 MB' && roleText('write') === 'Capturista' && roleText('read') === 'Consulta', 'tamaño y papel');
ok(VER_RE.test(newVer()) && newVer() !== newVer(), 'versión nueva válida para el Worker');

/* ===== Perfil y sección Taller ===== */
ok(isAdmin('admin') && !isAdmin('taller') && !isAdmin('otro') && canRoute('admin', '/cobranza'), 'perfil admin: toda la app');
ok(canRoute('taller', '/operacion/taller') && canRoute('taller', '/operacion/taller/orden/mo_1') && canRoute('taller', '/operacion/taller/reporte/mo_1') && canRoute('taller', '/ajustes') && canRoute('taller', '/ajustes/compartir'), 'perfil Taller: Taller, sus reportes y Ajustes básicos');
ok(['/', '/cobranza', '/operadores', '/operadores/x', '/tarifas', '/documentos', '/operacion/ordenes', '/operacion/logistica', '/operacion/combustible', '/catalogos', '/ajustes/gps', '/puerto/perconsur/1', '/unidades'].every((p) => !canRoute('taller', p)) && roleCfg('taller').home === '/operacion/taller', 'perfil Taller: sin finanzas, viajes, cobranza, tarifas, operadores, documentos, combustible ni catálogos (va a Taller)');
ok(!canRoute('desconocido', '/') && canRoute('desconocido', '/ajustes'), 'perfil desconocido: lo más restringido');
ok(TALLER_STORES.every((s) => SYNC_STORES.includes(s)) && TALLER_OPS.includes('trailers') && !TALLER_OPS.includes('operatorTrips') && !TALLER_OPS.includes('vehicles'), 'Taller envía solo mantenimiento y la clasificación de remolques');
ok(['operatorTrips', 'tripBilling', 'tariffSheets', 'operators', 'documents', 'serviceOrders', 'operatorLoans'].every((s) => !TALLER_MIRROR.includes(s) && !TALLER_WRITABLE.has(s)), 'el teléfono de Taller no recibe ni escribe viajes, cobros, tarifas, operadores, documentos ni órdenes de servicio');
ok(isTallerFile({ id: 'm_1', owner: 'mt:mo_1' }) && !isTallerFile({ id: 'm_2', owner: 'doc:d1' }) && !isTallerFile({ id: 'm_3', owner: 'draft:x' }), 'archivos de Taller: solo las fotos del taller');
const tdata = { maintenanceOrders: [{ id: 'mo_1', folio: 'F1' }], vehicles: [{ id: 'v1' }], trailers: [{ id: 't1', type: 'chasis' }], companies: [{ key: 'perconsur' }],
  counters: [{ id: 'mtto:U1:261016', n: 2 }, { id: 'folio:perconsur', n: 99 }], operatorTrips: [{ id: 'tr1', fare: 100000 }], tripBilling: [{ tripId: 'tr1', paid: true }],
  logisticsOperations: [{ id: 'lg1', vehicleId: 'v1', status: 'to_destination', origin: 'Manzanillo', destination: 'Zapopan', operatorId: 'o1', reference: 'MSCU1234567', startedAt: 5 }],
  fuelRecords: [{ id: 'f1', vehicleId: 'v1', date: '2026-10-01', odometer: 1000, liters: 300, amount: 750000 }, { id: 'f2', vehicleId: 'v1', liters: 10 }] };
const ts = buildTallerSnapshot({ data: tdata, files: [{ id: 'm_1', owner: 'mt:mo_1' }, { id: 'm_2', owner: 'doc:d1' }], ver: 't1', acks: { dT: 7 } });
const tj = JSON.stringify(ts);
ok(!ts.data.operatorTrips && !ts.data.tripBilling && !tj.includes('100000') && !tj.includes('750000') && !tj.includes('Zapopan') && !tj.includes('MSCU1234567') && !tj.includes('"o1"'), 'foto de Taller: sin viajes, cobros, importes de combustible, rutas, referencias ni operadores');
ok(ts.data.counters.length === 1 && ts.data.fuelRecords.length === 1 && ts.data.fuelRecords[0].odometer === 1000 && ts.data.logisticsOperations[0].status === 'to_destination' && ts.files.length === 1 && ts.acks.dT === 7, 'foto de Taller: folios de taller, odómetros, estado de las unidades, fotos del taller y acuses');
const tb = readTallerSnapshot(JSON.parse(tj));
ok(tb.ver === 't1' && tb.acks.dT === 7 && tb.data.maintenanceOrders.length === 1 && throws(() => readTallerSnapshot({ ...ts, kind: 'sync' }), /no corresponde/) && throws(() => readTallerSnapshot({ ...ts, data: { ...ts.data, vehicles: 'x' } }), /dañada/), 'foto de Taller: se lee de vuelta y se rechaza si es ajena o está dañada');
ok(readTallerSnapshot({ ...ts, acks: { dT: -1, 'mal id': 3, dX: 2.5, dY: 4 } }).acks.dY === 4 && Object.keys(readTallerSnapshot({ ...ts, acks: { dT: -1, 'mal id': 3, dX: 2.5, dY: 4 } }).acks).length === 1, 'acuses con forma inválida se descartan');
ok(contentSig({ a: 1 }) === contentSig({ a: 1 }) && contentSig({ a: 1 }) !== contentSig({ a: 2 }), 'huella del contenido: igual contenido, misma huella (no se vuelve a publicar)');
const ob = { [outboxKey('maintenanceOrders', 'mo_1')]: 3, [outboxKey('oilChanges', 'oc|1')]: 5, [outboxKey('attachments', 'm_9')]: 6 };
ok(pendingOf(ob, 3).map((p) => `${p.s}:${p.k}:${p.q}`).join() === 'oilChanges:oc|1:5,attachments:m_9:6' && Object.keys(pruneOutbox(ob, 5)).length === 1, 'bandeja: el acuse retira lo ya aplicado; la clave puede contener «|»');
ok(shouldApply(null, { v: { id: 'a', updatedAt: 1 } }) && !shouldApply(null, { v: null }) && shouldApply({ updatedAt: 5 }, { v: { updatedAt: 6 } }) && !shouldApply({ updatedAt: 9 }, { v: { updatedAt: 6 } }), 'cambio de Taller: el más reciente gana');
ok(shouldApply({ updatedAt: 5 }, { v: null, at: 6 }) && !shouldApply({ updatedAt: 9 }, { v: null, at: 6 }) && roleText('taller') === 'Taller', 'baja de Taller: no borra un registro que el capturista cambió después');
