/*
 * Recargas de combustible (store fuelRecords). Relacionadas con la unidad del catálogo por vehicleId (nunca por texto).
 * Registro base: { id, vehicleId, date, time, odometer, liters, amount (centavos), fullTank, station, reference, notes,
 *   odometerCorrection, createdAt, createdBy, updatedAt, updatedBy, revisions[], deletedAt? }
 * Nada derivado se guarda (km, precio por litro, rendimiento): ver domain/fuel/fuel.js.
 * Se cargan al entrar a Operación (no al abrir la app).
 */
import * as db from './db.js';
import { listAll } from './catalogs.js';
import { getCompany } from './companies.js';
import { normEco, ecoLabel } from '../domain/shared/format.js';
import { analyzeVehicle } from '../domain/fuel/fuel.js';

let cache = null;
export async function loadFuel(force = false) { if (!cache || force) cache = await db.all(db.S.fuelRecords); return cache; }
export const resetFuelCache = () => { cache = null; };
function actor() { try { const s = JSON.parse(sessionStorage.getItem('pcs-session') || 'null'); return (s && s.user) || 'local'; } catch (e) { return 'local'; } }

export function vehicles() {
  return listAll('vehicles').filter((v) => !v.mergedInto).map((v) => ({ id: v.id, eco: normEco(v.eco), label: ecoLabel(normEco(v.eco)), placas: v.placas || '', desc: v.desc || '', company: v.company, companyShort: getCompany(v.company).short }))
    .sort((a, b) => (+a.eco || 0) - (+b.eco || 0) || a.companyShort.localeCompare(b.companyShort));
}
export const vehicleById = (id) => vehicles().find((v) => v.id === id) || null;
export const recordsOf = (vid) => (cache || []).filter((r) => r.vehicleId === vid);
export const unitsAnalyzed = () => vehicles().map((v) => ({ ...v, an: analyzeVehicle(recordsOf(v.id)) }));

export async function saveFuelRecord(rec) {
  if (!rec.vehicleId || !vehicleById(rec.vehicleId)) throw new Error('La recarga debe pertenecer a una unidad del catálogo.');
  await loadFuel();
  const now = Date.now(), who = actor(), i = rec.id ? cache.findIndex((x) => x.id === rec.id) : -1;
  let out;
  if (i >= 0) { const { revisions = [], ...before } = cache[i]; out = { ...cache[i], ...rec, updatedAt: now, updatedBy: who, revisions: [...revisions, { at: now, by: who, before }].slice(-30) }; cache[i] = out; }
  else { out = { ...rec, id: db.uid('fu_'), createdAt: now, createdBy: who, updatedAt: now, updatedBy: who, revisions: [] }; cache.push(out); }
  await db.put(db.S.fuelRecords, out);
  return out;
}
export async function deleteFuelRecord(id) {
  await loadFuel();
  const r = cache.find((x) => x.id === id); if (!r) return;
  r.deletedAt = Date.now(); r.deletedBy = actor();
  await db.put(db.S.fuelRecords, r);
}
/* Para proteger el catálogo: ¿la unidad tiene recargas? (consulta por índice, sin cargar todo) */
export async function vehicleHasFuel(vid) { return (await db.byIndex(db.S.fuelRecords, 'vehicleId', vid)).some((r) => !r.deletedAt); }
