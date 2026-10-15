/*
 * Catálogos administrables. Operadores y remolques pertenecen a una empresa (Campo usa los de PERCONSUR).
 * Unidades: catálogo único PERCONSUR (Administración → Unidades, services/units.js); el campo company de un registro
 * antiguo solo indica de qué catálogo venía. Destinos, plantas y terminales son generales.
 */
import * as db from './db.js';
import { SEED_OPERATORS, SEED_VEHICLES, SEED_TRAILERS, SEED_YARDS } from '../config/seeds.js';
import { PLANTAS_SEED, TERMINALES_SEED } from '../config/reference.js';
import { getSetting, setSetting } from './settings.js';
import { normEco } from '../domain/shared/format.js';

/* Tipos de remolque (ampliable). Sin tipo = «Sin clasificar»: no se asigna automáticamente. */
export const TRAILER_TYPES = [['chasis', 'Chasis portacontenedor'], ['jaula', 'Jaula'], ['tolva', 'Tolva']];
export const trailerTypeLabel = (t) => (TRAILER_TYPES.find(([k]) => k === t) || [null, 'Sin clasificar'])[1];
/* Tipos que cada división muestra primero en los selectores (los demás siguen disponibles con «Ver todos») */
export const DIVISION_TRAILER_TYPES = { puerto: ['chasis'], campo: ['jaula', 'tolva'] };

/* Selector de remolques según la división: primero sus tipos, luego «Sin clasificar»; los demás con «Ver todos» */
export function trailerScope(division) {
  const types = DIVISION_TRAILER_TYPES[division] || [];
  return { title: division === 'puerto' ? 'Chasis portacontenedor' : 'Jaulas y tolvas', secondaryTitle: 'Sin clasificar', allLabel: 'Ver todos los remolques',
    rank: (it) => (types.includes(it.type) ? 1 : !it.type ? 2 : 0) };
}
export const trailerItems = (company) => list('trailers', company).map((x) => ({ value: x.placas, label: x.placas, type: x.type || '', sub: [trailerTypeLabel(x.type), x.desc].filter(Boolean).join(' | ') }));

export const KINDS = {
  operators: { store: db.S.operators, title: 'Operadores', one: 'operador', perCompany: true,
    fields: [['name', 'Nombre completo', { autocapitalize: 'words' }]], label: (x) => x.name, sub: () => '' },
  vehicles: { store: db.S.vehicles, title: 'Unidades', one: 'unidad', perCompany: false,
    fields: [['eco', 'Número económico', { inputmode: 'numeric' }], ['placas', 'Placas', { upper: true }], ['desc', 'Descripción (opcional)', {}],
      ['gpsDeviceId', 'IMEI del GPS (opcional)', { inputmode: 'numeric', digits: true }], ['trackingUrl', 'Enlace de rastreo GPS (opcional)', { url: true }]],
    label: (x) => 'U' + String(x.eco).padStart(2, '0'), sub: (x) => [x.placas, x.desc, x.gpsDeviceId ? 'GPS' : ''].filter(Boolean).join(' | ') },
  trailers: { store: db.S.trailers, title: 'Remolques', one: 'remolque', perCompany: true,
    fields: [['placas', 'Placas', { upper: true }], ['type', 'Tipo de remolque', { select: [['', 'Sin clasificar'], ...TRAILER_TYPES] }], ['desc', 'Descripción (marca, medida)', {}]],
    label: (x) => x.placas, sub: (x) => [trailerTypeLabel(x.type), x.desc].filter(Boolean).join(' | ') },
  places: { store: db.S.places, title: 'Destinos', one: 'destino', perCompany: false,
    fields: [['name', 'Nombre (cliente o almacén)', { upper: true }], ['rfc', 'RFC', { rfc: true }], ['address', 'Dirección de entrega', { textarea: true }], ['contact', 'Contacto o teléfono', {}]],
    label: (x) => x.name, sub: (x) => x.address || '' },
  plants: { store: db.S.plants, title: 'Plantas', one: 'planta', perCompany: false,
    fields: [['name', 'Nombre', {}], ['address', 'Dirección', { textarea: true }], ['maps', 'Link de Google Maps', { url: true }]],
    label: (x) => x.name, sub: (x) => x.address || '' },
  terminals: { store: db.S.terminals, title: 'Terminales portuarias', one: 'terminal', perCompany: false,
    fields: [['name', 'Nombre', {}], ['address', 'Dirección', { textarea: true }], ['maps', 'Link de Google Maps (opcional)', { url: true }]],
    label: (x) => x.name, sub: (x) => x.address || '' },
  yards: { store: db.S.yards, title: 'Patios de vacíos', one: 'patio', perCompany: false,
    fields: [['name', 'Nombre', { upper: true }], ['address', 'Dirección (opcional)', { textarea: true }], ['notes', 'Observaciones (opcional)', { textarea: true }], ['active', 'Estado', { select: [['', 'Activo'], ['no', 'Inactivo']] }]],
    label: (x) => x.name, sub: (x) => [x.active === 'no' ? 'Inactivo' : '', x.address].filter(Boolean).join(' | ') },
  /* Control de llenos: dónde se recogen contenedores llenos fuera de puerto (patios, bodegas, plantas de consolidación) */
  loadingYards: { store: db.S.loadingYards, title: 'Patios e instalaciones de carga', one: 'patio o instalación', perCompany: false,
    fields: [['name', 'Nombre', { upper: true }], ['address', 'Dirección (opcional)', { textarea: true }], ['notes', 'Observaciones (opcional)', { textarea: true }], ['active', 'Estado', { select: [['', 'Activo'], ['no', 'Inactivo']] }]],
    label: (x) => x.name, sub: (x) => [x.active === 'no' ? 'Inactivo' : '', x.address].filter(Boolean).join(' | ') },
};
/* Catálogos con lugar físico: se pueden ubicar en el mapa (pin {lat,lng}) para marcarlos como destino */
export const GEO_KINDS = ['places', 'plants', 'terminals', 'yards', 'loadingYards'];
/* Patios disponibles para seleccionar (los inactivos se conservan para el historial pero no se ofrecen) */
export const activeYards = () => list('yards').filter((y) => y.active !== 'no');
export const activeLoadingYards = () => list('loadingYards').filter((y) => y.active !== 'no');

const cache = {};
export async function loadCatalogs() {
  for (const [k, def] of Object.entries(KINDS)) cache[k] = await db.all(def.store);
}
export function list(kind, company) {
  const items = cache[kind] || [];
  const out = KINDS[kind].perCompany ? items.filter((x) => x.company === company) : kind === 'vehicles' ? items.filter((x) => !x.mergedInto) : items.slice();
  const lab = KINDS[kind].label;
  return out.sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || String(lab(a)).localeCompare(String(lab(b)), 'es', { numeric: true }));
}
/* Todos los registros de un catálogo, sin filtrar por empresa */
export const listAll = (kind) => (cache[kind] || []).slice();

export async function save(kind, item) {
  const rec = { ...item, id: item.id || db.uid(kind.slice(0, 2) + '_'), updatedAt: Date.now() };
  await db.put(KINDS[kind].store, rec);
  const arr = cache[kind] || (cache[kind] = []);
  const i = arr.findIndex((x) => x.id === rec.id);
  if (i >= 0) arr[i] = rec; else arr.push(rec);
  return rec;
}
export async function remove(kind, id) {
  await db.del(KINDS[kind].store, id);
  cache[kind] = (cache[kind] || []).filter((x) => x.id !== id);
}

/* Unidades (catálogo único): buscar por número económico, primero las activas. company se conserva en la firma por
   compatibilidad; ya no separa catálogos. */
export function vehicleByEco(company, eco) {
  const e = normEco(eco);
  const c = list('vehicles').filter((v) => normEco(v.eco) === e);
  return c.find((v) => v.active !== 'no') || c[0] || null;
}
/* Placas escritas en un formulario: solo completan una unidad sin placas (o registran una unidad nueva). Cambiar las
   placas de una unidad existente se hace en su expediente (Administración → Unidades), con historial. */
export async function rememberPlacas(company, eco, placas) {
  const e = normEco(eco);
  if (!e) return;
  const v = vehicleByEco(company, e);
  if (v) { if (!v.placas && placas) await save('vehicles', { ...v, placas }); }
  else if (placas) await save('vehicles', { company: 'perconsur', eco: e, placas, desc: '', source: 'auto' });
}
export function plantByName(name) { return list('plants').find((p) => p.name === name) || null; }

/* Patios de vacíos: se siembran una vez (también en instalaciones existentes) con la lista del Excel del usuario */
export async function seedYardsIfNeeded() {
  if (getSetting('yardsSeeded')) return false;
  if (!(cache.yards || []).length) {
    const now = Date.now();
    await db.putMany(db.S.yards, SEED_YARDS.map((name, i) => ({ id: db.uid('yd_') + i, order: i, name, address: '', notes: '', active: '', createdAt: now, source: 'seed' })));
    cache.yards = await db.all(db.S.yards);
  }
  await setSetting('yardsSeeded', true);
  return true;
}

/* Siembra inicial con los datos del HTML original (solo la primera vez) */
export async function seedIfNeeded() {
  if (getSetting('seeded')) return false;
  const now = Date.now();
  const rows = (store, arr) => db.putMany(store, arr.map((x, i) => ({ id: db.uid('s_') + i, order: i, createdAt: now, source: 'seed', ...x })));
  await rows(db.S.operators, SEED_OPERATORS.map((name) => ({ company: 'perconsur', name })));
  await rows(db.S.vehicles, SEED_VEHICLES.map(([eco, placas]) => ({ company: 'perconsur', eco, placas, desc: '' })));
  await rows(db.S.trailers, SEED_TRAILERS.map(([placas, desc]) => ({ company: 'perconsur', placas, desc })));
  await rows(db.S.plants, PLANTAS_SEED);
  await rows(db.S.terminals, TERMINALES_SEED.map((name) => ({ name })));
  await setSetting('seeded', true);
  await loadCatalogs();
  return true;
}
