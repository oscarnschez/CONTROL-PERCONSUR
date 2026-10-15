/*
 * Controles propios del mapa (MapLibre IControl): acercar, alejar, ver toda la flota y centrar la unidad elegida.
 * Botones de 44 px (táctiles), con nombre accesible y el diseño de la app. Cada botón es opcional.
 */
import { icon } from '../components/icons.js';
import { esc } from '../../domain/shared/format.js';

export class MapControls {
  /*
   * opts: { onFit, onCenter, fitLabel, centerLabel, base } (sin onFit/onCenter no se muestra ese botón)
   *   base  mapa de createBaseMap({ views: true }) → botón para cambiar entre vista de mapa y satelital
   */
  constructor({ onFit = null, onCenter = null, fitLabel = 'Ver toda la flota', centerLabel = 'Centrar unidad', base = null } = {}) {
    this.o = { onFit, onCenter, fitLabel, centerLabel, base };
  }
  /* El botón muestra la vista a la que se cambia (como en los mapas conocidos) */
  viewButton() {
    const sat = this.o.base.view === 'satellite';
    return `<button type="button" class="mc-v${sat ? ' is-sat' : ''}" data-mc="view" aria-pressed="${sat}" aria-label="${sat ? 'Cambiar a vista de mapa' : 'Cambiar a vista satelital'}" title="${sat ? 'Vista de mapa' : 'Vista satelital'}">
      <span class="mc-v-th" aria-hidden="true"></span><span class="mc-v-t">${sat ? 'Mapa' : 'Satélite'}</span></button>`;
  }
  onAdd(map) {
    this.map = map;
    const el = document.createElement('div');
    el.className = 'maplibregl-ctrl mc';
    const b = (k, ic, label) => `<button type="button" class="mc-b" data-mc="${k}" aria-label="${esc(label)}" title="${esc(label)}">${ic}</button>`;
    el.innerHTML = `<div class="mc-g">${b('in', icon.plus, 'Acercar')}${b('out', icon.minus, 'Alejar')}</div>
      ${this.o.onFit || this.o.onCenter ? `<div class="mc-g">${this.o.onFit ? b('fit', icon.fit, this.o.fitLabel) : ''}${this.o.onCenter ? b('center', icon.crosshair, this.o.centerLabel) : ''}</div>` : ''}
      ${this.o.base ? `<div class="mc-g mc-vg" data-mcv>${this.viewButton()}</div>` : ''}`;
    el.addEventListener('click', (e) => {
      const t = e.target.closest('[data-mc]'); if (!t || t.disabled) return;
      const k = t.dataset.mc;
      if (k === 'in') map.zoomIn({ duration: 250 });
      if (k === 'out') map.zoomOut({ duration: 250 });
      if (k === 'fit' && this.o.onFit) this.o.onFit();
      if (k === 'center' && this.o.onCenter) this.o.onCenter();
      if (k === 'view' && this.o.base) {
        this.o.base.setView(this.o.base.view === 'satellite' ? 'map' : 'satellite');
        const g = el.querySelector('[data-mcv]'); g.innerHTML = this.viewButton(); g.querySelector('button').focus();
      }
    });
    /* Que un toque en los controles no llegue al mapa (no deselecciona la unidad) */
    ['mousedown', 'touchstart', 'dblclick', 'click'].forEach((ev) => el.addEventListener(ev, (e) => e.stopPropagation(), { passive: true }));
    this.el = el;
    return el;
  }
  onRemove() { if (this.el) this.el.remove(); this.map = null; }
  setCenterEnabled(on) { const c = this.el && this.el.querySelector('[data-mc="center"]'); if (c) { c.disabled = !on; c.setAttribute('aria-disabled', on ? 'false' : 'true'); } }
}
