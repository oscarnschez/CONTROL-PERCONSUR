/* Avisos (sin navegador): geocercas de los catálogos y de los viajes, sugerencias de estado en Logística por llegadas y
   salidas, estancias (tiempo en cada lugar), textos, registros guardados y que no viajen en la información compartida */
import { ZONE_KINDS, catalogZones, opZone, suggestionFor, staysOf, dwellText, eventText, sanitizeGeoEvent, duesFrom, radiusFor, lastStatusAt } from '../src/domain/alerts/alerts.js';
import { SYNC_STORES, READER_WRITABLE } from '../src/domain/sync/sync.js';
const ok = (c, m) => { console.log((c ? 'OK  ' : 'FAIL') + ' ' + m); if (!c) process.exitCode = 1; };

/* Geocercas de los catálogos */
const cats = {
  terminals: [{ id: 't1', name: 'Terminal SSA', pin: { lat: 19.06, lng: -104.3 } }, { id: 't2', name: 'Terminal sin punto', address: 'Manzanillo' }],
  yards: [{ id: 'y1', name: 'Patio Norte', address: 'Calle 1, Manzanillo' }],
  plants: [{ id: 'p1', name: 'Planta Tecomán', maps: 'https://www.google.com/maps/@18.9,-103.87,15z' }],
  places: [{ id: 'd1', name: 'CEDIS GDL' }, { id: 'd2', name: 'Borrado', pin: { lat: 1, lng: 1 }, deletedAt: 5 }],
  loadingYards: [{ id: 'l1', name: 'Patio de carga 1', pin: { lat: 19.1, lng: -104.2 } }],
};
const locs = { t1: { lat: 19.06, lng: -104.3, precision: 'manual' }, y1: { lat: 19.07, lng: -104.29, precision: 'area' }, p1: { lat: 18.9, lng: -103.87, precision: 'link' }, l1: { lat: 19.1, lng: -104.2, precision: 'manual' } };
const cz = catalogZones(cats, (r) => locs[r.id] || null, { r: { 'plants:p1': 800 }, off: { 'loadingYards:l1': true } });
ok(cz.zones.map((z) => z.id).sort().join(',') === 'plants:p1,terminals:t1', 'se vigilan los lugares con punto exacto (fijado o link de Google Maps)');
ok(cz.zones.find((z) => z.id === 'terminals:t1').r === ZONE_KINDS.terminal.r && cz.zones.find((z) => z.id === 'plants:p1').r === 800, 'radio por tipo (terminal 500 m) o el ajustado para ese lugar');
ok(cz.missing.map((m) => `${m.id}:${m.reason}`).sort().join(',') === 'places:d1:noloc,terminals:t2:noloc,yards:y1:approx', 'sin ubicación o con ubicación aproximada (colonia): se listan aparte, no se vigilan');
ok(cz.off.length === 1 && cz.off[0].id === 'loadingYards:l1' && !cz.zones.some((z) => z.id === 'places:d2'), 'lugares apagados aparte; registros borrados no cuentan');
ok(radiusFor('yard', 'x', {}) === 300 && radiusFor('yard', 'x', { radius: { yard: 9000 } }) === 5000 && radiusFor('place', 'x', { radius: { place: 10 } }) === 50, 'radio entre 50 m y 5 km');

/* Geocerca del destino de un viaje */
const ids = new Set(cz.zones.map((z) => z.id));
const op = { id: 'lg_1', vehicleId: 'v1', status: 'to_destination', startedAt: 1000, statusLog: [{ status: 'to_destination', at: 1000 }] };
ok(opZone(op, { catalog: 'terminals', rec: cats.terminals[0], name: 'Terminal SSA', loc: locs.t1 }, ids).id === 'terminals:t1', 'destino del catálogo vigilado: usa esa geocerca');
const oz = opZone(op, { kind: 'delivery', name: 'Bodega Zapopan', loc: { lat: 20.7, lng: -103.4, precision: 'address' } }, ids);
ok(oz.id === 'op:lg_1' && oz.zone.kind === 'delivery' && oz.zone.opId === 'lg_1' && oz.zone.r === 300, 'dirección de entrega con ubicación exacta: geocerca propia del viaje');
ok(opZone(op, { kind: 'city', name: 'Guadalajara', loc: { lat: 20.6, lng: -103.3, precision: 'city' } }, ids) === null && opZone(op, { kind: 'delivery', name: 'X', loc: null }, ids) === null, 'destino aproximado (municipio) o sin ubicación: no se vigila');
ok(opZone(op, { catalog: 'loadingYards', rec: cats.loadingYards[0], kind: 'yard', name: 'Patio de carga 1', loc: locs.l1 }, ids).id === 'op:lg_1', 'lugar del catálogo no vigilado: el viaje usa su propia geocerca');

/* Sugerencias */
const E = (t, at, zone = 'terminals:t1', id = 'e' + at) => ({ id, t, at, zone, name: 'Terminal SSA' });
ok(suggestionFor(op, [E('enter', 2000)], 'terminals:t1').status === 'unloading', 'En ruta a destino + llegó al destino → sugerir Descargando');
ok(suggestionFor(op, [E('enter', 500)], 'terminals:t1') === null, 'llegada anterior al último cambio de estado: no cuenta');
ok(suggestionFor(op, [E('enter', 2000), E('exit', 3000)], 'terminals:t1') === null, 'llegó y ya salió (sin cambiar a Descargando): no se sugiere Descargando');
ok(suggestionFor(op, [E('enter', 2000, 'plants:p1')], 'terminals:t1') === null, 'llegada a otro lugar: sin sugerencia');
ok(suggestionFor(op, [E('enter', 2000)], 'terminals:t1', new Set(['e2000'])) === null, '«Ahora no»: la sugerencia descartada no vuelve');
const opU = { ...op, status: 'unloading', statusLog: [...op.statusLog, { status: 'unloading', at: 2100 }] };
ok(suggestionFor(opU, [E('enter', 2000), E('exit', 5000)], 'terminals:t1').status === 'empty_transit' && lastStatusAt(opU) === 2100, 'Descargando + salió del lugar → sugerir En ruta vacío');
ok(suggestionFor({ ...op, status: 'empty_transit' }, [E('enter', 2000, 'yards:y9')], 'yards:y9').status === 'empty', 'En ruta vacío + llegó al patio de vacíos → sugerir Vacío');
ok(suggestionFor({ ...op, status: 'inactive' }, [E('enter', 2000)], 'terminals:t1') === null && suggestionFor({ ...op, closedAt: 9 }, [E('enter', 2000)], 'terminals:t1') === null, 'Inactiva u operación cerrada: sin sugerencias');

/* Estancias */
const H = 3600000;
const st = staysOf([E('enter', 10 * H), { ...E('exit', 13.5 * H), dwell: 3.5 * H }, E('enter', 20 * H, 'plants:p1')], { from: 0, inside: { 'plants:p1': 20 * H, 'yards:y1': 21 * H }, names: { 'yards:y1': 'Patio Norte' }, now: 22 * H });
ok(st.length === 3 && st[0].open && st.some((x) => x.zone === 'terminals:t1' && x.dwell === 3.5 * H && x.to === 13.5 * H), 'estancias: llegada → salida con el tiempo en el lugar');
ok(st.find((x) => x.zone === 'plants:p1').from === 20 * H && st.find((x) => x.zone === 'yards:y1').name === 'Patio Norte' && st.find((x) => x.zone === 'yards:y1').dwell === H, 'estancia en curso (sigue en el lugar), también si ya estaba ahí antes de vigilar');
ok(staysOf([E('enter', 10 * H), { ...E('exit', 12 * H), dwell: 2 * H }], { from: 15 * H, now: 20 * H }).length === 0, 'solo las estancias del periodo de la operación');
ok(dwellText(5 * 60000) === '5 min' && dwellText(90 * 60000) === '1 h 30 min' && dwellText(3 * H) === '3 h' && dwellText(26 * H) === '1 d 2 h', 'tiempo en el lugar en minutos, horas y días');
ok(eventText({ t: 'enter', name: 'Terminal SSA' }) === 'Llegó a Terminal SSA' && eventText({ t: 'exit', name: 'Terminal SSA' }) === 'Salió de Terminal SSA', 'textos de llegada y salida');

/* Registros guardados */
const g = sanitizeGeoEvent({ id: 'x1', t: 'exit', at: 5, rec: 6, imei: '865190071363660', unit: 'UNIDAD 012', zone: 'terminals:t1', name: 'Terminal SSA', kind: 'terminal', since: 1, dwell: 4, evil: '<script>' });
ok(g && g.dwell === 4 && g.since === 1 && !('evil' in g) && sanitizeGeoEvent({ id: 'x', t: 'otro', at: 1, zone: 'z' }) === null && sanitizeGeoEvent({ id: 'x', t: 'enter', at: 'x', zone: 'z' }) === null, 'llegadas y salidas guardadas solo con la forma esperada');
ok(!SYNC_STORES.includes('geoEvents') && READER_WRITABLE.has('geoEvents'), 'las llegadas y salidas no viajan en la información compartida (cada dispositivo las consulta al Worker; no gastan escrituras de KV)');
const dues = duesFrom([{ unit: { id: 'u1', eco: '12' }, type: 'insurance', doc: { id: 'doc1' }, v: { until: '2026-10-27' } }], (u) => 'UNIDAD 0' + u.eco, (t) => (t === 'insurance' ? 'Póliza de seguro' : t));
ok(dues.length === 1 && dues[0].id === 'doc1' && dues[0].unit === 'UNIDAD 012' && dues[0].doc === 'Póliza de seguro' && dues[0].until === '2026-10-27' && Object.keys(dues[0]).length === 4, 'vencimientos publicados: solo unidad, documento y fecha (sin archivos ni datos de la póliza)');
