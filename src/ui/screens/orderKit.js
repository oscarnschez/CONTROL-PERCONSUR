/* Órdenes de Servicio — piezas compartidas por el listado, el expediente, el formulario y los demás módulos */
import { esc } from '../../domain/shared/format.js';
import { icon } from '../components/icons.js';
import { openSheet } from '../components/sheet.js';
import { toast } from '../components/toast.js';

export const orderHref = (id, sec = '') => `#/operacion/ordenes/${encodeURIComponent(id)}${sec ? '?s=' + sec : ''}`;
export const orderPath = (id, sec = '') => orderHref(id, sec).slice(1);
export const editPath = (id, i) => `/operacion/ordenes/${encodeURIComponent(id)}/editar/${i + 1}`;
/* Etiqueta de estado con el color de Logística ({ label, tone }) */
export const toneChip = (a, cls = 'sm') => `<span class="lg-st lg-t-${esc(a.tone)} ${cls}"><i aria-hidden="true"></i>${esc(a.label)}</span>`;
/* Folio enlazado para las fichas de Logística, Control de llenos y Control de vacíos */
export const folioChip = (o) => (o ? `<a class="so-folio-chip lg-t-orange" href="${orderHref(o.id)}" aria-label="Orden de servicio ${esc(o.folio)}">${icon.clipboard}<span>${esc(o.folio)}</span></a>` : '');
/* Variante sin enlace para tarjetas que ya son un enlace */
export const folioTag = (o) => (o ? `<span class="so-folio-tag lg-t-orange">${icon.clipboard}<span>${esc(o.folio)}</span></span>` : '');

/*
 * Pide un texto (motivo de cancelación, reapertura, cambio de asignación…) en una hoja inferior.
 * Devuelve el texto escrito o null si se cierra sin confirmar.
 */
export function askText({ title, message = '', label = 'Motivo', placeholder = '', confirm = 'Confirmar', destructive = false, required = true, max = 300 }) {
  return new Promise((resolve) => {
    const form = document.createElement('form');
    form.className = 'op-form so-ask';
    form.noValidate = true;
    form.innerHTML = `${message ? `<p class="sheet-lead">${esc(message)}</p>` : ''}
      <label class="fld" data-f="t"><span class="fl">${esc(label)}</span><textarea class="in" name="t" rows="3" maxlength="${max}" placeholder="${esc(placeholder)}"></textarea><span class="ferr"></span></label>
      <div class="sheet-acts"><button type="button" class="btn-secondary" data-cancel>Cancelar</button><button type="submit" class="${destructive ? 'btn-danger' : 'btn-primary'}">${esc(confirm)}</button></div>`;
    let done = false;
    const sh = openSheet({ title, body: form, onClose: () => { if (!done) resolve(null); } });
    const ta = form.elements.t;
    setTimeout(() => ta.focus({ preventScroll: true }), 280);
    form.querySelector('[data-cancel]').addEventListener('click', () => sh.close());
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = ta.value.trim();
      if (required && !v) { const f = form.querySelector('[data-f="t"]'); f.classList.add('has-err'); f.querySelector('.ferr').textContent = `Escribe ${label.toLowerCase()}.`; toast(`Escribe ${label.toLowerCase()}.`, { type: 'warn' }); return; }
      done = true; resolve(v); sh.close();
    });
  });
}
