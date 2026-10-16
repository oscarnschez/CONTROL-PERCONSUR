/* Avisos breves (toasts). type: ok (con sonido de confirmación) | warn | info */
import { icon } from './icons.js';
import { esc } from '../../domain/shared/format.js';
import { play } from '../../services/sounds.js';

let host = null, timer = null;
export function toast(msg, { type = 'ok', ms = 2600, action = null } = {}) {
  if (!host) { host = document.createElement('div'); host.className = 'toast-host'; host.setAttribute('role', 'status'); host.setAttribute('aria-live', 'polite'); document.body.appendChild(host); }
  /* Aviso verde: la acción se confirmó (sonido de confirmación) */
  if (type === 'ok') play('confirm');
  const ic = type === 'warn' ? icon.alert : type === 'info' ? icon.info : icon.check;
  host.innerHTML = `<div class="toast t-${type}"><span class="toast-ic">${ic}</span><span class="toast-msg">${esc(msg)}</span>${action ? `<button type="button" class="toast-act">${esc(action.label)}</button>` : ''}</div>`;
  const t = host.firstElementChild;
  if (action) t.querySelector('.toast-act').addEventListener('click', () => { action.fn(); hide(); });
  requestAnimationFrame(() => t.classList.add('is-open'));
  clearTimeout(timer);
  timer = setTimeout(hide, action ? Math.max(ms, 6000) : ms);
  function hide() { t.classList.remove('is-open'); setTimeout(() => { if (t.parentNode) t.remove(); }, 220); }
}
