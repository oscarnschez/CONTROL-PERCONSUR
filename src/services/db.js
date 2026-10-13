/*
 * Capa de persistencia sobre IndexedDB.
 * Stores:
 *   documents   documentos generados (datos + referencia al PDF)
 *   drafts      documentos sin terminar (uno por división/empresa)
 *   operators, vehicles, trailers   catálogos por empresa
 *   places, plants, terminals       catálogos generales (destinos, plantas, terminales)
 *   companies   ajustes de texto de cada empresa (overrides)
 *   settings    preferencias { key, value }
 *   attachments archivos binarios: fotos, adjuntos, PDF generados, vistas previas
 *   counters    consecutivos de folio
 *   operatorSettings, operatorTrips, operatorLoans, operatorAdjustments   control de operadores (v2)
 *   tripBilling   cobranza: cobro de cada viaje y demoras en planta (v5)
 *   logisticsOperations   logística: asignación y estado operativo de cada unidad, con historial (v6)
 *   tripAttachments   documentos adicionales de cada viaje (metadatos; el archivo vive en attachments) (v7)
 *   yards, emptyContainers, emptyContainerEvents   control de vacíos: patios, contenedores por devolver y su historial (v8)
 *   geocodes   ubicación en el mapa de cada dirección (destinos de notas, patios, terminales) (v9)
 *   maintenanceOrders, maintenanceServices, maintenanceIssues, maintenanceComponents, tireReplacements, oilChanges,
 *   maintenanceAttachments, maintenanceEvents, maintenanceProfiles, maintenanceParts   Taller (v10): órdenes por equipo
 *     (vehicleId o trailerId del catálogo), trabajos, fallas, intervenciones por componente (datos del diagrama),
 *     llantas, aceite, fotos, bitácora, intervalos y ejes por equipo, y componentes agregados por el usuario
 *   tariffSheets   Tarifas (v11): un registro por apartado (p. ej. BAYER INBOUND 2026) con sus rutas y montos
 *   loadingYards, fullContainerLoads, fullContainerDocuments, fullContainerEvents   Control de llenos (v12): patios e
 *     instalaciones de carga, cargas programadas (relacionadas por IDs con terminales, patios, unidades, operadores y
 *     remolques), sus documentos uno por uno (el archivo vive en attachments) y su historial
 * La sincronización entre dispositivos (services/sync.js) lee y escribe estos mismos stores (ver onWrite / setWriteGuard).
 */
const DB_NAME = 'perconsur';
const DB_VERSION = 12;  /* v2: control de operadores | v3: estados de cuenta | v4: combustible | v5: cobranza | v6: logística | v7: adjuntos de viajes | v8: control de vacíos | v9: ubicación de direcciones | v10: taller | v11: tarifas | v12: control de llenos */

export const S = {
  documents: 'documents', drafts: 'drafts', operators: 'operators', vehicles: 'vehicles', trailers: 'trailers',
  places: 'places', plants: 'plants', terminals: 'terminals', companies: 'companies', settings: 'settings',
  attachments: 'attachments', counters: 'counters',
  operatorSettings: 'operatorSettings', operatorTrips: 'operatorTrips', operatorLoans: 'operatorLoans', operatorAdjustments: 'operatorAdjustments',
  operatorStatements: 'operatorStatements', fuelRecords: 'fuelRecords', tripBilling: 'tripBilling',
  logisticsOperations: 'logisticsOperations', tripAttachments: 'tripAttachments',
  yards: 'yards', emptyContainers: 'emptyContainers', emptyContainerEvents: 'emptyContainerEvents',
  geocodes: 'geocodes',
  maintenanceOrders: 'maintenanceOrders', maintenanceServices: 'maintenanceServices', maintenanceIssues: 'maintenanceIssues',
  maintenanceComponents: 'maintenanceComponents', tireReplacements: 'tireReplacements', oilChanges: 'oilChanges',
  maintenanceAttachments: 'maintenanceAttachments', maintenanceEvents: 'maintenanceEvents', maintenanceProfiles: 'maintenanceProfiles',
  maintenanceParts: 'maintenanceParts',
  tariffSheets: 'tariffSheets',
  loadingYards: 'loadingYards', fullContainerLoads: 'fullContainerLoads', fullContainerDocuments: 'fullContainerDocuments', fullContainerEvents: 'fullContainerEvents',
};

let dbp = null;
export function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('IndexedDB no disponible')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const mk = (name, opts, indexes = []) => {
        if (db.objectStoreNames.contains(name)) return;
        const st = db.createObjectStore(name, opts);
        indexes.forEach(([n, k]) => st.createIndex(n, k));
      };
      mk(S.documents, { keyPath: 'id' }, [['type', 'type'], ['createdAt', 'createdAt']]);
      mk(S.drafts, { keyPath: 'id' });
      mk(S.operators, { keyPath: 'id' }, [['company', 'company']]);
      mk(S.vehicles, { keyPath: 'id' }, [['company', 'company']]);
      mk(S.trailers, { keyPath: 'id' }, [['company', 'company']]);
      mk(S.places, { keyPath: 'id' });
      mk(S.plants, { keyPath: 'id' });
      mk(S.terminals, { keyPath: 'id' });
      mk(S.companies, { keyPath: 'key' });
      mk(S.settings, { keyPath: 'key' });
      mk(S.attachments, { keyPath: 'id' }, [['owner', 'owner']]);
      mk(S.counters, { keyPath: 'id' });
      /* v2 — Control de operadores (todo relacionado por operatorId, nunca por nombre) */
      mk(S.operatorSettings, { keyPath: 'operatorId' });
      mk(S.operatorTrips, { keyPath: 'id' }, [['operatorId', 'operatorId'], ['documentId', 'documentId'], ['date', 'date']]);
      mk(S.operatorLoans, { keyPath: 'id' }, [['operatorId', 'operatorId'], ['date', 'date']]);
      mk(S.operatorAdjustments, { keyPath: 'id' }, [['operatorId', 'operatorId'], ['date', 'date']]);
      /* v3 — Estados de cuenta emitidos (solo folio y metadatos; el PDF vive en attachments) */
      mk(S.operatorStatements, { keyPath: 'id' }, [['operatorId', 'operatorId']]);
      /* v4 — Recargas de combustible, relacionadas con la unidad del catálogo por vehicleId */
      mk(S.fuelRecords, { keyPath: 'id' }, [['vehicleId', 'vehicleId'], ['date', 'date']]);
      /* v5 — Cobranza: estado de cobro de cada viaje y sus demoras en planta (un registro por viaje, por tripId) */
      mk(S.tripBilling, { keyPath: 'tripId' });
      /* v6 — Logística: operaciones por unidad (vehicleId, operatorId, trailerId del catálogo); las cerradas son el historial */
      mk(S.logisticsOperations, { keyPath: 'id' }, [['vehicleId', 'vehicleId'], ['operatorId', 'operatorId'], ['trailerId', 'trailerId']]);
      /* v7 — Documentos adicionales de viajes, relacionados por tripId; el binario se guarda en attachments (storageKey) */
      mk(S.tripAttachments, { keyPath: 'id' }, [['tripId', 'tripId']]);
      /* v8 — Control de vacíos: catálogo de patios, contenedores por devolver (relacionados por IDs) y sus movimientos */
      mk(S.yards, { keyPath: 'id' });
      mk(S.emptyContainers, { keyPath: 'id' }, [['containerNumber', 'containerNumber'], ['tripId', 'tripId'], ['vehicleId', 'vehicleId'], ['logisticsOperationId', 'logisticsOperationId']]);
      mk(S.emptyContainerEvents, { keyPath: 'id' }, [['emptyContainerId', 'emptyContainerId'], ['createdAt', 'createdAt']]);
      /* v9 — Ubicación (lat/lng) de cada dirección ya buscada o fijada en el mapa; clave = dirección normalizada */
      mk(S.geocodes, { keyPath: 'key' });
      /* v10 — Taller: todo se relaciona con la orden (orderId) y con el equipo del catálogo (vehicleId o trailerId) */
      mk(S.maintenanceOrders, { keyPath: 'id' }, [['vehicleId', 'vehicleId'], ['trailerId', 'trailerId'], ['inAt', 'inAt']]);
      mk(S.maintenanceServices, { keyPath: 'id' }, [['orderId', 'orderId']]);
      mk(S.maintenanceIssues, { keyPath: 'id' }, [['vehicleId', 'vehicleId'], ['trailerId', 'trailerId'], ['orderId', 'orderId']]);
      mk(S.maintenanceComponents, { keyPath: 'id' }, [['orderId', 'orderId']]);
      mk(S.tireReplacements, { keyPath: 'id' }, [['orderId', 'orderId']]);
      mk(S.oilChanges, { keyPath: 'id' }, [['vehicleId', 'vehicleId'], ['orderId', 'orderId']]);
      mk(S.maintenanceAttachments, { keyPath: 'id' }, [['parentId', 'parentId'], ['orderId', 'orderId']]);
      mk(S.maintenanceEvents, { keyPath: 'id' }, [['orderId', 'orderId']]);
      mk(S.maintenanceProfiles, { keyPath: 'id' });
      mk(S.maintenanceParts, { keyPath: 'id' });
      /* v11 — Tarifas: un registro por apartado con sus rutas (zona, ciudad de origen, planta destino y monto por unidad) */
      mk(S.tariffSheets, { keyPath: 'id' });
      /* v12 — Control de llenos: patios de carga, cargas programadas (por contenedor, fecha, unidad y operador), documentos y bitácora */
      mk(S.loadingYards, { keyPath: 'id' });
      mk(S.fullContainerLoads, { keyPath: 'id' }, [['containerNumber', 'containerNumber'], ['scheduledDate', 'scheduledDate'], ['vehicleId', 'vehicleId'], ['operatorId', 'operatorId'], ['status', 'status']]);
      mk(S.fullContainerDocuments, { keyPath: 'id' }, [['loadId', 'loadId']]);
      mk(S.fullContainerEvents, { keyPath: 'id' }, [['loadId', 'loadId'], ['createdAt', 'createdAt']]);
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbp = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('La base de datos está bloqueada por otra pestaña.'));
  });
  return dbp;
}

const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
const done = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('Transacción cancelada')); });

export async function get(store, key) { const db = await openDB(); return wrap(db.transaction(store).objectStore(store).get(key)); }
export async function all(store) { const db = await openDB(); return wrap(db.transaction(store).objectStore(store).getAll()); }
export async function byIndex(store, index, value) { const db = await openDB(); return wrap(db.transaction(store).objectStore(store).index(index).getAll(value)); }
/*
 * Información compartida (services/sync.js): toda escritura pasa por put/putMany/del/tx.
 *   onWrite(fn)        fn(store, keys, values) después de guardar (keys = null si no se conocen; values solo en put/putMany)
 *                      → el capturista sabe qué publicar
 *   setWriteGuard(fn)  fn(store, keyOrValue) antes de guardar; si lanza un error la escritura no ocurre (dispositivo de
 *                      consulta). La sincronización escribe con { silent: true }: sin guardia ni aviso.
 */
const writeSubs = new Set();
let writeGuard = null;
export function onWrite(fn) { writeSubs.add(fn); return () => writeSubs.delete(fn); }
export function setWriteGuard(fn) { writeGuard = fn || null; }
const keyOf = (store, v) => (v == null || typeof v !== 'object' ? v : v.id ?? v.key ?? v.tripId ?? v.operatorId);
function guard(store, items, silent) { if (writeGuard && !silent) for (const it of items) writeGuard(store, it); }
function notify(store, keys, silent, values = null) { if (silent) return; writeSubs.forEach((fn) => { try { fn(store, keys, values); } catch (e) { console.warn(e); } }); }

export async function put(store, value, { silent = false } = {}) { guard(store, [value], silent); const db = await openDB(); const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).put(value); await done(tx); notify(store, [keyOf(store, value)], silent, [value]); return value; }
export async function putMany(store, values, { silent = false } = {}) { guard(store, values, silent); const db = await openDB(); const tx = db.transaction(store, 'readwrite'); const st = tx.objectStore(store); values.forEach((v) => st.put(v)); await done(tx); notify(store, values.map((v) => keyOf(store, v)), silent, values); }
export async function del(store, key, { silent = false } = {}) { guard(store, [key], silent); const db = await openDB(); const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).delete(key); await done(tx); notify(store, [key], silent); }
/* Claves de un store sin leer los valores (archivos grandes) */
export async function keys(store) { const db = await openDB(); return wrap(db.transaction(store).objectStore(store).getAllKeys()); }
export async function indexKeys(store, index, range) { const db = await openDB(); return wrap(db.transaction(store).objectStore(store).index(index).getAllKeys(range)); }
/* ¿Existe la clave? (sin leer el valor: útil para archivos grandes) */
export async function has(store, key) { if (key == null) return false; const db = await openDB(); return (await wrap(db.transaction(store).objectStore(store).count(key))) > 0; }
export async function count(store) { const db = await openDB(); return wrap(db.transaction(store).objectStore(store).count()); }

/* Transacción de lectura-escritura sobre varios stores; fn recibe { store(name) } */
export async function tx(stores, fn, { silent = false } = {}) {
  [].concat(stores).forEach((n) => guard(n, [undefined], silent));
  const db = await openDB();
  const t = db.transaction(stores, 'readwrite');
  const result = await fn({ store: (n) => t.objectStore(n), req: wrap });
  await done(t);
  [].concat(stores).forEach((n) => notify(n, null, silent));
  return result;
}

export const uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
