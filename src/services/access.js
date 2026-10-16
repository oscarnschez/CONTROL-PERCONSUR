/*
 * Modo «solo consulta» (dispositivos que reciben la información del capturista; ver services/sync.js).
 * La protección real está en la base de datos local: con el modo activo, db.js rechaza cualquier escritura en los
 * registros compartidos (lanza ReadOnlyError) y el Worker además rechaza publicar con la clave de consulta.
 * La interfaz oculta los botones de captura (html.ro) para que el aviso casi nunca aparezca.
 */
import * as db from './db.js';
import { READER_WRITABLE, TALLER_WRITABLE } from '../domain/sync/sync.js';

export const READ_ONLY_TEXT = 'Este dispositivo es de solo consulta: la información la captura el dispositivo capturista.';
export class ReadOnlyError extends Error {
  constructor() { super(READ_ONLY_TEXT); this.name = 'ReadOnlyError'; this.readOnly = true; }
}
/* Teléfono de Taller (clave DATA_TALLER_KEY): captura solo Taller; lo demás de la base rechaza escrituras */
export const TALLER_ONLY_TEXT = 'Este dispositivo es de Taller: solo captura la información de Taller y mantenimientos.';
export class TallerOnlyError extends Error {
  constructor() { super(TALLER_ONLY_TEXT); this.name = 'TallerOnlyError'; this.readOnly = true; }
}
let on = false, taller = false;
export const isReadOnly = () => on;
export const isTallerDevice = () => taller;
export function setReadOnly(value) { setAccess(value ? 'read' : ''); }
/* mode: 'read' (consulta) · 'taller' (solo Taller) · '' (capturista o sin compartir) */
export function setAccess(mode) {
  on = mode === 'read'; taller = mode === 'taller';
  db.setWriteGuard(on ? (store) => { if (!READER_WRITABLE.has(store)) throw new ReadOnlyError(); }
    : taller ? (store) => { if (!TALLER_WRITABLE.has(store)) throw new TallerOnlyError(); } : null);
  document.documentElement.classList.toggle('ro', on);
  document.documentElement.classList.toggle('taller-dev', taller);
  window.dispatchEvent(new CustomEvent('pcs:readonly', { detail: { on, taller } }));
}
/* Para pantallas que inician una captura: avisa y devuelve true si no se puede */
export function blockedHere(toastFn) {
  if (!on) return false;
  if (toastFn) toastFn(READ_ONLY_TEXT, { type: 'warn', ms: 3500 });
  return true;
}
