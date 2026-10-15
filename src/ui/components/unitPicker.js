/*
 * Selector único de unidades para los formularios de todas las empresas (catálogo PERCONSUR — Unidades).
 * Busca por número económico, placas, marca o modelo; al elegir devuelve la unidad (su id se guarda como unitId en el
 * formulario y sus datos completan los campos). Se puede escribir un número que no está en el catálogo (se usa solo en
 * ese documento) o registrarlo en Unidades.
 * pickUnit({ title, currentId }) → { unit, eco } | null
 */
import * as un from '../../services/units.js';
import { openPicker } from './picker.js';
import { toast } from './toast.js';
import { normEco } from '../../domain/shared/format.js';

export async function pickUnit({ title = 'Unidad', currentId = '' } = {}) {
  await un.loadUnits();
  const r = await openPicker({
    title: `${title} · PERCONSUR — Unidades`, current: currentId || '', placeholder: 'Número económico, placas o marca', inputmode: 'text', autocap: 'characters',
    items: un.pickerItems(), allowNew: true, newLabel: 'Usar número', canSave: true, saveLabel: 'Registrar en Unidades PERCONSUR', transform: (v) => v.trim(),
    emptyText: 'Aún no hay unidades en el catálogo PERCONSUR. Escribe el número económico.',
  });
  if (!r) return null;
  if (!r.isNew) { const u = un.unitById(r.value); return u ? { unit: u, eco: normEco(u.eco) } : null; }
  const eco = normEco(r.value);
  if (!eco) { toast('Escribe el número económico (solo dígitos).', { type: 'warn' }); return null; }
  const found = un.unitByEco(eco);
  if (found) return { unit: found, eco };
  if (r.save) {
    try { const u = await un.saveUnit({ eco }); toast('Unidad registrada en Unidades PERCONSUR'); return { unit: u, eco }; }
    catch (e) { toast(e.message, { type: 'warn' }); return null; }
  }
  return { unit: null, eco };
}
