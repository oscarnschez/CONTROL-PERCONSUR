/* Unidades (sin navegador): vigencias y días restantes en la zona horaria operativa, estado documental de la unidad,
   complemento de pago activo/próximo/encimado, detección del periodo del complemento (formato de referencia de BBVA
   Seguros), fecha original de fotografías (EXIF en JPEG, HEIC y PNG), búsqueda y filtros, vencimientos, duplicados de la
   migración, validación y respaldo */
import {
  DOC_TYPES, DOC_KEYS, todayIn, daysBetween, daysText, validityOf, complementState, unitStatus, requiredFor, matchUnit, passFilter, fleetSummary,
  alertRows, sortAlerts, duplicateGroups, mergedData, checkUnit, sanitizeUnitDoc, sanitizeUnitPhoto, unitTitle, ecoText,
} from '../src/domain/units/units.js';
import { detectPeriod, findRanges, coveredDays, extraFields, cleanText } from '../src/domain/units/complement.js';
import { readExif, exifDate, buildExifJpeg } from '../src/domain/units/exif.js';
import { extractPolicy, insurerOf, vinCheck, bestVin } from '../src/domain/units/policy.js';
import { SYNC_STORES, READER_WRITABLE } from '../src/domain/sync/sync.js';
const ok = (c, m) => console.log((c ? 'OK  ' : 'FAIL') + ' ' + m);
const T = '2026-10-20';
const doc = (docType, extra = {}) => ({ id: 'd' + Math.random().toString(36).slice(2), unitId: 'u1', docType, storageKey: 'k', status: 'current', uploadedAt: 1, ...extra });
const conf = (from, until, extra = {}) => ({ validFrom: from, validUntil: until, verificationStatus: 'confirmed', ...extra });

/* Categorías */
ok(DOC_TYPES.map((d) => d.label).join('|') === 'Tarjeta de circulación|Póliza de seguro|Complemento de pago|Verificación físico-mecánica|Certificado de Bajas Emisiones Contaminantes', 'las cinco categorías con su nombre exacto');
ok(DOC_TYPES.every((d) => d.upload.startsWith('Subir')) && DOC_TYPES.find((d) => d.key === 'low_emissions_certificate').upload === 'Subir Certificado de Bajas Emisiones Contaminantes', 'cada categoría tiene su propio botón «Subir …»');

/* Fecha de hoy en la zona horaria operativa (no la del dispositivo) */
ok(todayIn('America/Mexico_City', new Date('2026-10-21T05:30:00Z')) === '2026-10-20' && todayIn('America/Mexico_City', new Date('2026-10-21T06:30:00Z')) === '2026-10-21', 'hoy en America/Mexico_City: 23:30 del 20 sigue siendo 20 (UTC ya es 21)');
ok(daysBetween('2026-10-20', '2026-10-31') === 11 && daysBetween('2026-02-27', '2026-03-01') === 2, 'días calendario (incluye fin de mes)');
ok(daysText(11) === '11 días restantes' && daysText(1) === '1 día restante' && daysText(0) === 'Vence hoy' && daysText(-1) === 'Vencido hace 1 día' && daysText(-5) === 'Vencido hace 5 días', 'textos: nunca números negativos');

/* Estados de vigencia */
const st = (d) => validityOf(d, T).key;
ok(st(doc('payment_complement', conf('2026-10-01', '2026-11-30'))) === 'valid' && validityOf(doc('payment_complement', conf('2026-10-01', '2026-10-31')), T).days === 11, 'Vigente; fin 31 oct con hoy 20 oct → 11 días restantes');
ok(st(doc('payment_complement', conf('2026-10-01', '2026-10-31'))) === 'soon' && st(doc('payment_complement', conf('2026-10-01', '2026-11-04'))) === 'soon' && st(doc('payment_complement', conf('2026-10-01', '2026-11-05'))) === 'valid', 'Próximo a vencer con 15 días o menos (11 y 15 días); 16 días = vigente');
ok(validityOf(doc('payment_complement', conf('2026-10-01', '2026-10-28')), T, { soon: 7 }).key == 'valid' && validityOf(doc('payment_complement', conf('2026-10-01', '2026-10-27')), T, { soon: 7 }).key === 'soon', 'umbral configurable (7 días)');
ok(st(doc('payment_complement', conf('2026-09-20', T))) === 'today' && st(doc('payment_complement', conf('2026-09-01', '2026-10-19'))) === 'expired' && validityOf(doc('payment_complement', conf('2026-09-01', '2026-10-19')), T).note === 'Vencido hace 1 día', 'Vence hoy y Vencido hace 1 día');
ok(st(doc('payment_complement', conf('2026-11-11', '2026-12-11'))) === 'future', 'Vigencia futura cuando aún no empieza');
ok(st(doc('payment_complement', { validFrom: '2026-10-01', validUntil: '2026-10-31', verificationStatus: 'pending' })) === 'pending', 'Pendiente de verificación: fechas sin confirmar nunca cuentan como vigentes');
ok(st(null) === 'none' && st(doc('insurance', { storageKey: null })) === 'none', 'Sin documento');
ok(st(doc('insurance', {})) === 'pending' && st(doc('registration', {})) === 'attached' && st(doc('mechanical_inspection', { noExpiry: true, verificationStatus: 'manual' })) === 'attached', 'un archivo no es «vigente» por existir: póliza sin fechas → por verificar; tarjeta → adjuntada; sin vencimiento confirmado → adjuntada');
ok(st(doc('insurance', { validUntil: '2026-12-31', verificationStatus: 'manual' })) === 'valid', 'fechas capturadas a mano cuentan (fuente: manual)');

/* Complementos: activo, próximo, encimados */
const c1 = doc('payment_complement', { id: 'c1', uploadedAt: 3, ...conf('2026-09-11', '2026-10-11') });
const c2 = doc('payment_complement', { id: 'c2', uploadedAt: 1, ...conf('2026-10-11', '2026-11-11') });
const c3 = doc('payment_complement', { id: 'c3', uploadedAt: 2, ...conf('2026-11-11', '2026-12-11') });
let cs = complementState([c1, c2, c3], T);
ok(cs.active.id === 'c2' && cs.upcoming.id === 'c3' && cs.last.id === 'c1' && !cs.overlaps.length, 'cobertura activa por periodo (no por el último subido), próxima cobertura aparte; un día de corte compartido no es encime');
const c4 = doc('payment_complement', { id: 'c4', uploadedAt: 9, ...conf('2026-10-15', '2026-11-30') });
cs = complementState([c2, c4], T);
ok(cs.ambiguous && cs.overlaps.length === 1, 'dos periodos que cubren hoy: se advierte y se pide elegir');
cs = complementState([c2, { ...c4, selected: true }], T);
ok(cs.active.id === 'c4' && !complementState([{ ...c2, status: 'archived' }, c3], T).active, 'la elección del usuario manda; los archivados no cubren');
const pend = doc('payment_complement', { id: 'p', uploadedAt: 10 });
ok(complementState([c1, pend], T).pending.length === 1 && complementState([c1, pend], T).last.id === 'c1', 'un complemento nuevo sin confirmar queda pendiente y no reemplaza al anterior');

/* Estado de la unidad */
const unit = { id: 'u1', vehicleType: 'tractocamion' };
const full = [doc('registration'), doc('insurance', conf('2026-01-01', '2026-12-31')), c2, doc('mechanical_inspection', conf('2026-07-01', '2026-11-01')), doc('low_emissions_certificate', { noExpiry: true, verificationStatus: 'manual' })];
let s = unitStatus(unit, full, T);
ok(s.isComplete && s.complete === 5 && s.total === 5 && s.label === 'Expediente completo', 'expediente completo 5/5');
ok(s.soon.join() === 'mechanical_inspection' && s.next.type === 'mechanical_inspection' && s.next.days === 12, 'aviso aparte de documento próximo a vencer (no cuenta como faltante); próximo vencimiento');
s = unitStatus(unit, full.filter((d) => d.docType !== 'insurance'), T);
ok(!s.isComplete && s.complete === 4 && s.missing.join() === 'insurance' && s.label === 'Expediente incompleto', 'falta un requerido → incompleto 4/5');
s = unitStatus(unit, full.map((d) => (d.docType === 'insurance' ? { ...d, validUntil: '2026-10-01' } : d)), T);
ok(!s.isComplete && s.expired.join() === 'insurance', 'un documento vencido no cuenta como completo');
ok(requiredFor({ vehicleType: 'camioneta' }).length === 3 && unitStatus({ id: 'u1', vehicleType: 'camioneta' }, full, T).total === 3 && requiredFor({ vehicleType: 'otro' }, { otro: ['registration'] }).join() === 'registration', 'requisitos por tipo (configurables); no requerido ≠ faltante');
ok(DOC_KEYS.every((k) => k in unitStatus({ id: 'u1', vehicleType: 'otro' }, [], T).items), 'las cinco categorías siempre aparecen aunque no sean requeridas');

/* Búsqueda, filtros, indicadores */
const U = [{ id: 'a', eco: '21', placas: 'JN-12-345', brand: 'Freightliner', model: 'Cascadia', vin: '3AKJHHDR1KSKA1234' }, { id: 'b', eco: '121', placas: 'XY-99-000', brand: 'Kenworth', model: 'T680', active: 'no' }];
ok(matchUnit(U[0], '21') && !matchUnit(U[1], '21') && matchUnit(U[0], 'U21') && matchUnit(U[0], '021'), 'buscar «21» encuentra la UNIDAD 021 (no la 121)');
ok(matchUnit(U[0], 'jn12') && matchUnit(U[0], 'cascadia') && matchUnit(U[1], 'kenworth t680') && matchUnit(U[0], 'KSKA1234'), 'buscar por placas (sin guiones), marca, modelo y VIN');
const stC = unitStatus(unit, full, T), stI = unitStatus(unit, [], T);
ok(passFilter(U[0], stC, 'complete') && passFilter(U[0], stI, 'incomplete') && passFilter(U[0], stC, 'soon') && !passFilter(U[0], stC, 'expired') && passFilter(U[1], stI, 'inactive') && !passFilter(U[1], stI, 'active'), 'filtros: completa, incompleta, próximos vencimientos, vencidos, activas, inactivas');
const sum = fleetSummary([{ unit: U[0], st: stC }, { unit: U[1], st: stI }]);
ok(sum.total === 2 && sum.complete === 1 && sum.incomplete === 1 && sum.soonDocs === 1 && sum.expiredDocs === 0, 'indicadores con datos reales');
ok(unitTitle({ eco: '21' }) === 'UNIDAD 021' && ecoText('4') === '004', 'título «UNIDAD 021»');
/* Vencimientos */
const al = alertRows([{ unit: U[0], st: unitStatus(unit, full.map((d) => (d.docType === 'insurance' ? { ...d, validUntil: '2026-10-18' } : d)), T) }], T, { window: 'all' });
ok(al.length === 3 && sortAlerts(al, 'days')[0].type === 'insurance' && alertRows([{ unit: U[0], st: unitStatus(unit, full, T) }], T, { window: '15' }).map((a) => a.type).join() === 'mechanical_inspection' && alertRows([{ unit: U[0], st: unitStatus(unit, full, T) }], T, { window: '30' }).length === 2, 'tablero: todos, ordenado por menos días; ventana de 15 días');
ok(alertRows([{ unit: U[0], st: unitStatus(unit, full.map((d) => (d.docType === 'insurance' ? { ...d, validUntil: '2026-10-18' } : d)), T) }], T, { window: 'expired' }).length === 1, 'filtro de vencidos');

/* Complemento de pago: formato de referencia (texto como lo devuelve el PDF/OCR) */
const REF = `Serie: FF
Fecha y Hora de Timbrado: 2026-10-14T01:18:51
COMPLEMENTO PARA LA RECEPCIÓN DE PAGOS
Nombre del Emisor BBVA SEGUROS MEXICO, S.A. DE C.V.
PARCIALIDAD 8 de 12
Descripción Identificación (Póliza) Inciso Vigencia Dias que cubre
Pago 736A5305PY 0 1 31
Periodo del Recibo (Dia/Mes/Año) Tipo de Comprobante Clave de Servicio
11/10/2026 al 11/11/2026 Pago 84111506 Servicios de facturación`;
let d = detectPeriod(REF);
ok(d.status === 'found' && d.from === '2026-10-11' && d.to === '2026-11-11' && d.confidence === 'alta', 'formato de referencia: «Periodo del Recibo (Dia/Mes/Año) 11/10/2026 al 11/11/2026» → 11 oct – 11 nov (DÍA/MES)');
ok(d.coveredDays === 31 && /Coincide/.test(d.check), 'se comprueba con «Días que cubre: 31»');
ok(d.extra.issueDate === '2026-10-14' && d.from !== d.extra.issueDate && d.to !== d.extra.issueDate, 'la fecha de timbrado (emisión) no es inicio ni fin de cobertura');
ok(d.extra.policyNumber === '736A5305PY' && d.extra.installment === '8 de 12' && /BBVA/.test(d.extra.insurer), 'póliza, parcialidad y emisor como datos adicionales (sugerencias)');
ok(!findRanges(REF).some((r) => r.raw.includes('1 31')), '«Vigencia: 1» y «Días que cubre: 31» no se confunden con fechas');
/* OCR con ruido: letras por números y espacios dentro de las fechas */
d = detectPeriod(REF.replace('11/10/2026 al 11/11/2026', 'l1/1O/2026  al 11 /11/ 2026'));
ok(d.status === 'found' && d.from === '2026-10-11' && d.to === '2026-11-11', 'OCR con ruido («1O», espacios) se interpreta igual');
d = detectPeriod('Fecha de pago: 05/10/2026\nFecha de vencimiento de la factura: 31/10/2026\nVigencia del 01/10/2026 al 31/10/2026');
ok(d.status === 'found' && d.from === '2026-10-01' && d.to === '2026-10-31', 'la fecha de pago y el vencimiento de la factura no son el periodo');
ok(detectPeriod('Pagado el 14/10/2026. Fecha de emisión 14/10/2026').status === 'none', 'una sola fecha de pago no se convierte en vigencia (no se inventa)');
ok(detectPeriod('Periodo 01/09/2026 al 30/09/2026\nPeriodo 01/10/2026 al 31/10/2026').status === 'ambiguous', 'varios periodos sin uno claro → ambiguo (se elige a mano)');
ok(detectPeriod('Cobertura: del 1 de octubre de 2026 al 31 de octubre de 2026').to === '2026-10-31' && detectPeriod('Inicio de vigencia: 01/10/2026 Fin de vigencia: 31/10/2026').from === '2026-10-01', 'otros formatos: con nombre del mes y «inicio/fin de vigencia»');
ok(detectPeriod('Periodo del Recibo 31/02/2026 al 31/03/2026').status === 'none' && detectPeriod('Periodo 11/11/2026 al 11/10/2026').status === 'none', 'fechas imposibles o invertidas se descartan');
ok(detectPeriod('xx@@ ilegible ##').status === 'none' && coveredDays('Dias que cubre\nPago 736A 0 1 31') === 31 && cleanText('12/1O/2O26') === '12/10/2026', 'documento ilegible → sin periodo; columnas de tabla');
ok(extraFields('Fecha y Hora de Timbrado: 2026-10-14T01:18:51').issueDate === '2026-10-14', 'timbrado ISO');

/* EXIF */
const ex = readExif(buildExifJpeg({ DateTimeOriginal: '2026:10:12 14:32:05', OffsetTimeOriginal: '-06:00', DateTime: '2026:10:14 09:00:00', Make: 'Apple' }));
ok(ex.capturedAt === '2026-10-12T14:32:05' && ex.offset === '-06:00' && ex.field === 'DateTimeOriginal' && ex.make === 'Apple', 'JPEG: DateTimeOriginal con zona horaria');
ok(readExif(buildExifJpeg({ DateTimeOriginal: '2026:10:12 14:32:05' }, false)).capturedAt === '2026-10-12T14:32:05', 'EXIF big-endian (Motorola)');
ok(readExif(buildExifJpeg({ DateTime: '2026:10:14 09:00:00' })).capturedAt === null, 'DateTime (fecha de modificación) NO se usa como fecha de captura');
ok(readExif(buildExifJpeg({ DateTimeOriginal: '0000:00:00 00:00:00', DateTimeDigitized: '2026:01:02 03:04:05' })).field === 'DateTimeDigitized', 'fecha original vacía → fecha de digitalización (identificada como tal)');
const jpeg = new Uint8Array(buildExifJpeg({ DateTimeOriginal: '2025:12:31 23:59:59' })), tiff = jpeg.slice(12, jpeg.length - 2);
const heic = new Uint8Array([0, 0, 0, 24, ...[...'ftypheic'].map((c) => c.charCodeAt(0)), 0, 0, 0, 0, ...[...'mif1heic'].map((c) => c.charCodeAt(0)), 0, 0, 0, 6, 0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]);
ok(readExif(heic.buffer).capturedAt === '2025-12-31T23:59:59' && readExif(heic.buffer).format === 'heic', 'HEIC (iPhone): EXIF dentro del contenedor');
const png = (() => { const t = [...tiff], len = t.length; return new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, (len >>> 24) & 255, (len >> 16) & 255, (len >> 8) & 255, len & 255, ...[...'eXIf'].map((c) => c.charCodeAt(0)), ...t, 0, 0, 0, 0]); })();
ok(readExif(png.buffer).capturedAt === '2025-12-31T23:59:59', 'PNG con fragmento eXIf');
ok(readExif(new Uint8Array([0xFF, 0xD8, 0xFF, 0xD9, 0, 0, 0, 0, 0, 0, 0, 0]).buffer).capturedAt === null && exifDate('2026:13:01 00:00:00') === null && exifDate('2026:02:30 10:00:00') === null, 'sin metadatos o con fecha imposible → no hay fecha (no se inventa)');

/* Migración: duplicados por empresa */
const V = [
  { id: 'p4', company: 'perconsur', eco: '4', placas: '59-BN-4J' }, { id: 'o4', company: 'oasc', eco: '04', placas: '59BN4J' },
  { id: 'p5', company: 'perconsur', eco: '5', placas: '56-BH-1L', vin: '3AKJHHDR1KSKA1234' }, { id: 's7', company: 'osc', eco: '7', placas: 'ZZ-11-111', vin: '3AKJHHDR1KSKA1234' },
  { id: 'p8', company: 'perconsur', eco: '8', placas: '64-BN-4J' }, { id: 'o8', company: 'oasc', eco: '8', placas: '99-XX-9X', notDuplicateOf: ['p8'] },
  { id: 'm', company: 'oasc', eco: '4', mergedInto: 'p4' },
];
const g = duplicateGroups(V);
const g4 = g.find((x) => x.ids.includes('p4')), g5 = g.find((x) => x.ids.includes('p5'));
ok(g4 && g4.kind === 'exact' && g4.ids.length === 2 && g4.by.includes('placas') && g4.by.includes('eco'), 'misma unidad en dos empresas (eco 4 y mismas placas) → coincidencia exacta; el registro ya unido no se repite');
ok(g5 && g5.kind === 'conflict' && g5.conflicts.includes('eco') && g5.conflicts.includes('placas') && g5.by.join() === 'vin', 'mismo VIN con número y placas distintos → conflicto para revisar (no se une solo)');
ok(!g.some((x) => x.ids.includes('p8')), '«no son la misma unidad» deja de proponerse');
const md = mergedData({ id: 'p4', eco: '4', placas: '59-BN-4J', brand: '' }, [{ id: 'o4', eco: '4', placas: '59BN4J', brand: 'Freightliner', gpsDeviceId: '123' }]);
ok(md.id === 'p4' && md.placas === '59-BN-4J' && md.brand === 'Freightliner' && md.gpsDeviceId === '123', 'al unir manda el registro que se conserva; los vacíos se completan');
/* Validación */
const errs = checkUnit({ eco: '04', placas: '59 bn 4j' }, V, 'zz');
ok(errs.eco && errs.placas && !Object.keys(checkUnit({ eco: '30', placas: 'AA-11-111', vin: '1FUJGLDR9CLBP8834', year: '2020' }, V, null)).length, 'sin duplicar número económico ni placas; VIN y año válidos');
ok(checkUnit({ eco: '31', vin: 'IOQ12345678' }, []).vin && checkUnit({ eco: '' }, []).eco, 'VIN con I/O/Q y número vacío se rechazan');
ok(checkUnit({ eco: '4' }, V, 'p4').eco === undefined || checkUnit({ eco: '4' }, V, 'p4').eco.includes('Ya existe'), 'editar la misma unidad (los duplicados antiguos se resuelven en la revisión)');
/* Respaldo y sincronización */
ok(sanitizeUnitDoc({ id: 'x', unitId: 'u', docType: 'otro' }) === null && sanitizeUnitDoc({ id: 'x', unitId: 'u', docType: 'insurance', validUntil: 'mañana', verificationStatus: 'hackeado' }).validUntil === null && sanitizeUnitDoc({ id: 'x', unitId: 'u', docType: 'insurance', verificationStatus: 'hackeado' }).verificationStatus === 'pending', 'respaldo: tipos y fechas válidos; estado desconocido → pendiente');
ok(sanitizeUnitPhoto({ id: 'x', unitId: 'u', photoType: 'front', capturedAt: '2026-10-12T14:32:05', captureDateSource: 'exif' }).captureDateSource === 'exif' && sanitizeUnitPhoto({ id: 'x', unitId: 'u', photoType: 'front', capturedAt: 'ayer', captureDateSource: 'exif' }).captureDateSource === 'unknown', 'respaldo: la fuente de la fecha se conserva solo con fecha válida');
ok(['unitDocuments', 'unitPhotos', 'unitEvents', 'vehicles'].every((k) => SYNC_STORES.includes(k)) && !READER_WRITABLE.has('unitDocuments'), 'el expediente se comparte entre dispositivos; el modo consulta no lo modifica');

/* Póliza de seguro: formato de referencia (BBVA Seguros, «Póliza de seguro flotillas»), con datos ficticios */
const POL = `PÓLIZA DE SEGURO
FLOTILLAS
DATOS DE LA PÓLIZA
Número de Póliza: 999B12345X Número de Certificado: 999B123450
Fecha de Emisión: 05/01/2026 Inicio de Vigencia de la póliza Fin de vigencia de la póliza
Desde las 12 :00 hrs del 06/03/2026 Hasta las 12 :00 hrs del 06/03/2027
Inicio de Vigencia del Inciso Fin de vigencia del Inciso
Desde las 12 :00 hrs del 10/03/2026 Hasta las 12 :00 hrs del 10/03/2027
Moneda: Nacional Forma de Pago: MENSUAL
DATOS DEL BIEN ASEGURADO
Descripción: TRACTOCAMION DE PRUEBA
Modelo: 2018 Servicio: COMERCIAL Uso: SERVICIO PUBLICO Clave: TR0000
Zona de Circulación: JALISCO Serie: 1HTMMAAR3KH000123 No. Motor:`;
let pz = extractPolicy(POL, { header: 'BBVA\nSeguros' });
ok(pz.insurer === 'BBVA Seguros' && pz.policyNumber === '999B12345X', 'póliza: aseguradora (logotipo) y número de póliza (no el de certificado)');
ok(pz.validFrom === '2026-03-06' && pz.validUntil === '2027-03-06' && pz.vigenciaDe === 'póliza' && pz.issueDate === '2026-01-05', 'vigencia de la PÓLIZA (no la del inciso ni la fecha de emisión)');
ok(pz.year === '2018' && pz.vin === '1HTMMAAR3KH000123' && pz.vinOk, 'año (Modelo) y número de serie con dígito verificador correcto');
ok(extractPolicy(POL.replace(/Desde las 12 :00 hrs del 06\/03\/2026 Hasta las 12 :00 hrs del 06\/03\/2027\n/, '')).validFrom === '2026-03-10', 'sin vigencia de la póliza se usa la del inciso');
ok(extractPolicy(POL.split('\n').join('\n').replace('Número de Póliza: 999B12345X Número de Certificado: 999B123450', 'Número de Póliza:\n999B12345X')).policyNumber === '999B12345X', 'valor en el renglón siguiente (tabla)');
ok(insurerOf('= BVA PÓLIZA DE SEGURO\nFLOTILLAS\nSeguros') === 'BBVA Seguros' && insurerOf('GNP Seguros') === 'GNP Seguros' && insurerOf('Quálitas Compañía de Seguros') === 'Quálitas' && insurerOf('Seguro de autos') === '', 'aseguradoras conocidas (también con el logotipo mal leído); si no se reconoce, vacío');
pz = extractPolicy(POL.replace('999B12345X N', '995B12345X N'), { extra: { policy: ['Número de Póliza: 999B12345X | x', 'Número de Póliza: 9 99B12345X | x', 'Número de Póliza: 9995B12345X'] } });
ok(pz.policyNumber === '999B12345X' && /2 de 4/.test(pz.evidence.policyNumber), 'OCR: el número de póliza más repetido entre las relecturas gana (5 por 9, dígito separado)');
ok(vinCheck('1HTMMAAR3KH000123') && !vinCheck('1HTMMAAR4KH000123') && !vinCheck('1HTMMAAR3KH00012'), 'dígito verificador del VIN');
ok(bestVin(['1IHTMMAAR3KH000123NO']).vin === '1HTMMAAR3KH000123' && bestVin(['1HTMMAAR3KH0OO123']).vin === '1HTMMAAR3KH000123', 'OCR: carácter de más (I) y O por 0 se corrigen con el dígito verificador');
ok(bestVin(['1HTMMAAR3KH000123', '1HTMMAAR3KHO00123', 'IHTMMAAR3KH000I23']).ok && !bestVin(['1HTMMAAR4KH000123']).ok, 'varias lecturas: gana la más cercana a todas; una sola lectura que no verifica no se «corrige» al azar');
ok(extractPolicy('Documento sin datos').found.length === 0, 'sin datos legibles: nada detectado (no se inventa)');
