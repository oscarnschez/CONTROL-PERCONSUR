/* Catálogos: listado por tipo, búsqueda, agregar, editar y eliminar. */
import { screen, on } from '../../core/dom.js';
import { go, back, query } from '../../core/router.js';
import * as cat from '../../services/catalogs.js';
import { getCompany } from '../../services/companies.js';
import { getSetting, setSetting } from '../../services/settings.js';
import { PUERTO_COMPANIES } from '../../config/companies.js';
import { TIPOS } from '../../config/reference.js';
import { esc, normEco, rfcClean, nameCase, mapsURL, trackURL } from '../../domain/shared/format.js';
import { icon } from '../components/icons.js';
import { openSheet, confirmDestructive } from '../components/sheet.js';
import { toast } from '../components/toast.js';
import { hasRecords } from '../../services/operators.js';
import { vehicleHasFuel } from '../../services/fuel.js';
import { inOpenOperation } from '../../services/logistics.js';
import { yardInUse } from '../../services/empties.js';
import { inOpenLoad, terminalInUse, loadingYardInUse } from '../../services/fulls.js';
import { equipmentHasMaintenance } from '../../services/maintenance.js';
import { trailerIcon } from '../components/icons.js';
import { pickPoint } from '../components/pinPicker.js';
import { placeLoc, cached as geoCached } from '../../services/geocode.js';
import { coordsIn, precisionLabel, isApprox } from '../../domain/gps/geo.js';

const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const ORDER = ['operators', 'vehicles', 'trailers', 'places', 'plants', 'terminals', 'yards', 'loadingYards'];

export async function catalogsScreen() {
  const co = getSetting('catCompany', 'perconsur');
  const s = screen(`<div class="page">
    <header class="nav-top"><button type="button" class="nav-back" data-back>${icon.back}<span>Administración</span></button></header>
    <h1 class="title">Catálogos</h1>
    <p class="page-lead">Datos que se ofrecen al capturar. Operadores, unidades y remolques son de cada empresa; División Campo usa los de PERCONSUR.</p>
    <section class="grp"><div class="grp-b list-actions">${ORDER.map((k) => {
      const d = cat.KINDS[k], n = d.perCompany ? PUERTO_COMPANIES.reduce((t, c) => t + cat.list(k, c).length, 0) : cat.list(k).length;
      return `<a class="row-btn" href="#/catalogos/${k}"><span class="rb-ic">${{ operators: icon.person, vehicles: icon.truck, trailers: icon.trailer, places: icon.pin, plants: icon.building, terminals: icon.container, yards: icon.yard, loadingYards: icon.calendar }[k]}</span><span>${esc(d.title)}</span><small>${n}</small>${icon.chev}</a>`;
    }).join('')}
      <a class="row-btn" href="#/catalogos/tipos"><span class="rb-ic">${icon.catalog}</span><span>Tipos de contenedor (ISO)</span><small>${TIPOS.length}</small>${icon.chev}</a>
    </div></section>
  </div>`);
  on(s.el, 'click', '[data-back]', () => back('/administracion'));
  return s;
}

export async function isoScreen() {
  const s = screen(`<div class="page">
    <header class="nav-top"><button type="button" class="nav-back" data-back>${icon.back}<span>Catálogos</span></button></header>
    <h1 class="title">Tipos de contenedor</h1>
    <p class="page-lead">Códigos ISO 6346 disponibles en la nota. Son de referencia y no se editan.</p>
    <div class="list">${TIPOS.map(([c, d]) => `<div class="row static"><span class="row-tx"><span class="row-l1"><b class="mono">${c}</b></span><span class="row-l2">${esc(d)}</span></span></div>`).join('')}</div>
  </div>`);
  on(s.el, 'click', '[data-back]', () => back('/catalogos'));
  return s;
}

export async function catalogListScreen({ kind }) {
  const def = cat.KINDS[kind];
  if (!def) { go('/catalogos', { replace: true }); return null; }
  let company = getSetting('catCompany', 'perconsur'), text = '', ttype = 'todos';
  const s = screen(`<div class="page">
    <header class="nav-top"><button type="button" class="nav-back" data-back>${icon.back}<span>Catálogos</span></button>
      <button type="button" class="nav-act" data-add aria-label="Agregar ${esc(def.one)}">${icon.plus}</button></header>
    <h1 class="title">${esc(def.title)}</h1>
    ${def.perCompany ? `<div class="seg wide">${PUERTO_COMPANIES.map((c) => `<button type="button" class="seg-b" data-co="${c}">${esc(getCompany(c).short)}</button>`).join('')}</div>` : ''}
    <label class="search"><span class="search-ic">${icon.search}</span><input type="search" class="search-in" placeholder="Buscar" autocomplete="off" autocorrect="off"></label>
    ${kind === 'trailers' ? `<div class="chips filters">${[['todos', 'Todos'], ['chasis', 'Chasis portacontenedor'], ['jaula', 'Jaulas'], ['tolva', 'Tolvas'], ['', 'Sin clasificar']].map(([k, l]) => `<button type="button" class="chip" data-tt="${k}">${l}</button>`).join('')}</div>` : ''}
    <div data-list></div>
  </div>`);
  const root = s.el, listEl = root.querySelector('[data-list]');
  function draw() {
    root.querySelectorAll('[data-co]').forEach((b) => b.classList.toggle('on', b.dataset.co === company));
    root.querySelectorAll('[data-tt]').forEach((b) => b.classList.toggle('on', b.dataset.tt === ttype));
    const items = cat.list(kind, company).filter((x) => !text || fold(def.label(x) + ' ' + def.sub(x)).includes(fold(text)))
      .filter((x) => kind !== 'trailers' || ttype === 'todos' || (x.type || '') === ttype);
    listEl.innerHTML = items.length
      ? `<div class="list">${items.map((x) => `<button type="button" class="row" data-id="${esc(x.id)}">${kind === 'trailers' ? `<span class="row-ic tr-ic${x.type ? '' : ' none'}">${trailerIcon(x.type)}</span>` : ''}<span class="row-tx"><span class="row-l1"><b>${esc(def.label(x))}</b>${kind === 'trailers' ? `<span class="st ${x.type ? 'st-generado' : 'st-borrador'}">${esc(cat.trailerTypeLabel(x.type))}</span>` : ''}${x.source === 'auto' ? '<span class="st">Recordado</span>' : ''}</span>${(kind === 'trailers' ? x.desc : def.sub(x)) ? `<span class="row-l2">${esc(kind === 'trailers' ? x.desc : def.sub(x))}</span>` : ''}</span><span class="chev">${icon.chev}</span></button>`).join('')}</div>`
      : `<div class="empty"><p>${text ? 'Sin coincidencias.' : `No hay ${def.title.toLowerCase()} en este catálogo.`}</p><button type="button" class="btn-primary sm" data-add>${icon.plus}<span>Agregar ${esc(def.one)}</span></button></div>`;
  }
  function edit(item) {
    const isNew = !item;
    const v = item || {};
    const geo = cat.GEO_KINDS.includes(kind);
    let pin = v.pin && Number.isFinite(v.pin.lat) ? v.pin : null;
    const body = `<form class="cat-form" novalidate>${def.fields.map(([f, l, o]) => {
      const val = esc(v[f] || '');
      const attrs = `name="${f}" class="in" autocomplete="off" ${o.upper || o.rfc ? 'autocapitalize="characters" spellcheck="false"' : o.autocapitalize ? `autocapitalize="${o.autocapitalize}"` : ''} ${o.inputmode ? `inputmode="${o.inputmode}"` : ''} ${o.url ? 'type="url" inputmode="url" autocapitalize="none" spellcheck="false"' : ''} ${o.rfc ? 'maxlength="13"' : ''}`;
      if (o.select) return `<label class="fld"><span class="fl">${esc(l)}</span><span class="sel-w"><select class="in" name="${f}">${o.select.map(([k, t]) => `<option value="${k}"${(v[f] || '') === k ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select><span class="sel-ic">${icon.down}</span></span></label>`;
      return `<label class="fld"><span class="fl">${esc(l)}</span>${o.textarea ? `<textarea rows="3" ${attrs}>${val}</textarea>` : `<input ${attrs} value="${val}" enterkeyhint="next">`}</label>`;
    }).join('')}
      ${geo ? `<div class="fld geo-fld"><span class="fl">Ubicación en el mapa</span><div class="geo-row"><span class="geo-st" data-geo-st></span><button type="button" class="btn-secondary sm" data-geo-pick>${icon.crosshair}<span>Ubicar en el mapa</span></button></div>
        <span class="fhint">Se usa para marcar el destino en el mapa de Logística. Si no se fija, se busca con la dirección.</span></div>` : ''}
      <button type="submit" class="btn-primary block">${isNew ? 'Agregar' : 'Guardar cambios'}</button>
      ${!isNew && (kind === 'vehicles' || kind === 'trailers') ? `<a class="btn-secondary block" href="#/operacion/taller/equipo/${kind === 'vehicles' ? 'u' : 'r'}/${encodeURIComponent(v.id)}">${icon.wrench}<span>Ver historial de mantenimiento</span></a>` : ''}
      ${isNew ? '' : `<button type="button" class="btn-danger block" data-del>${icon.trash}<span>Eliminar ${esc(def.one)}</span></button>`}</form>`;
    const sh = openSheet({ title: isNew ? `Agregar ${def.one}` : `Editar ${def.one}`, body });
    const form = sh.body.querySelector('form');
    /* Ubicación: punto fijado > link largo de Google Maps > dirección ya ubicada > se buscará con la dirección */
    function drawGeo() {
      const el = form.querySelector('[data-geo-st]'); if (!el) return;
      const addr = form.elements.address ? form.elements.address.value.trim() : '', link = form.elements.maps ? coordsIn(form.elements.maps.value) : null, g = addr ? geoCached(addr) : null;
      const [txt, cls] = pin ? [`Fijada en el mapa (${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)})`, 'ok'] : link ? ['Tomada del link de Google Maps', 'ok']
        : g ? [precisionLabel(g.precision), isApprox(g.precision) ? 'warn' : 'ok'] : addr ? ['Se buscará con la dirección', ''] : ['Sin ubicación', 'warn'];
      el.className = 'geo-st ' + cls; el.textContent = txt;
    }
    drawGeo();
    form.addEventListener('change', drawGeo);
    const gp = form.querySelector('[data-geo-pick]');
    if (gp) gp.addEventListener('click', async () => {
      const addr = form.elements.address ? form.elements.address.value.trim() : '';
      const nm = form.elements.name ? form.elements.name.value.trim() : '';
      const start = pin || placeLoc({ maps: form.elements.maps ? form.elements.maps.value : '', address: addr });
      const r = await pickPoint({ title: `Ubicar ${def.one}`, name: nm, address: addr, start, zoom: start && !isApprox(start.precision) ? 17 : 14, canClear: !!pin });
      if (r === 'clear') pin = null; else if (r) pin = r;
      drawGeo();
    });
    form.addEventListener('input', (e) => { const t = e.target, o = (def.fields.find(([f]) => f === t.name) || [])[2] || {}; if (o.upper) t.value = t.value.toUpperCase(); if (o.rfc) t.value = rfcClean(t.value); if (o.digits) t.value = t.value.replace(/\D/g, ''); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      for (const k of Object.keys(data)) data[k] = String(data[k]).trim();
      const first = def.fields[0][0];
      if (!data[first]) { toast(`Falta: ${def.fields[0][1].toLowerCase()}`, { type: 'warn' }); form.elements[first].focus(); return; }
      if (kind === 'vehicles') {
        data.eco = normEco(data.eco); if (!data.eco) { toast('El número económico debe tener dígitos', { type: 'warn' }); return; }
        if (data.gpsDeviceId && !/^\d{8,20}$/.test(data.gpsDeviceId)) { toast('El IMEI del GPS debe tener solo números (normalmente 15).', { type: 'warn' }); return; }
        const twinGps = data.gpsDeviceId && cat.listAll('vehicles').find((x) => x.id !== v.id && String(x.gpsDeviceId || '') === data.gpsDeviceId);
        if (twinGps) { toast(`Ese IMEI ya está vinculado a ${def.label(twinGps)}.`, { type: 'warn' }); return; }
        if (data.trackingUrl && !trackURL(data.trackingUrl)) { toast('El enlace de rastreo no es válido.', { type: 'warn' }); return; }
        data.gpsProvider = data.gpsDeviceId ? 'iopgps' : '';
      }
      if (kind === 'operators') data.name = nameCase(data.name);
      if ((kind === 'plants' || kind === 'terminals') && data.maps && !mapsURL(data.maps)) { toast('El link de Google Maps no es válido', { type: 'warn' }); return; }
      if (geo) data.pin = pin;
      const dup = cat.list(kind, company).find((x) => x.id !== v.id && fold(def.label(x)) === fold(def.label({ ...data })));
      if (dup) { toast(`Ya existe «${def.label(dup)}» en el catálogo`, { type: 'warn' }); return; }
      await cat.save(kind, { ...v, ...data, ...(def.perCompany ? { company } : {}), source: v.source === 'auto' ? 'usuario' : v.source || 'usuario' });
      sh.close(); draw(); toast(isNew ? 'Datos guardados' : 'Cambios guardados');
    });
    const del = sh.body.querySelector('[data-del]');
    if (del) del.addEventListener('click', async () => {
      if (kind === 'vehicles' && await vehicleHasFuel(v.id)) {
        toast('Esta unidad tiene recargas de combustible registradas; no se puede eliminar. Puedes editar sus datos.', { type: 'warn', ms: 5500 });
        return;
      }
      if (kind === 'yards' && await yardInUse(v.id)) {
        toast('Este patio está asignado a contenedores vacíos pendientes; no se puede eliminar. Puedes marcarlo como Inactivo.', { type: 'warn', ms: 5500 });
        return;
      }
      if ((kind === 'loadingYards' && await loadingYardInUse(v.id)) || (kind === 'terminals' && await terminalInUse(v.id))) {
        toast(`Est${kind === 'terminals' ? 'a terminal' : 'e patio'} tiene cargas programadas en Control de llenos; no se puede eliminar. ${kind === 'terminals' ? 'Puedes editar sus datos.' : 'Puedes marcarlo como Inactivo.'}`, { type: 'warn', ms: 5500 });
        return;
      }
      const fcField = { vehicles: 'vehicleId', operators: 'operatorId', trailers: 'trailerId' }[kind];
      if (fcField && await inOpenLoad(fcField, v.id)) {
        toast(`Este ${def.one} está asignado a una carga abierta de Control de llenos; quítalo de la carga antes de eliminarlo. Puedes editar sus datos.`, { type: 'warn', ms: 5500 });
        return;
      }
      if ((kind === 'vehicles' || kind === 'trailers') && await equipmentHasMaintenance(kind === 'vehicles' ? 'vehicleId' : 'trailerId', v.id)) {
        toast('Este equipo tiene mantenimientos registrados en Taller; no se puede eliminar para conservar su historial. Puedes editar sus datos.', { type: 'warn', ms: 5500 });
        return;
      }
      const lgField = { vehicles: 'vehicleId', operators: 'operatorId', trailers: 'trailerId' }[kind];
      if (lgField && await inOpenOperation(lgField, v.id)) {
        toast(`Este ${def.one} está en una operación activa de Logística; termínala antes de eliminarlo. Puedes editar sus datos.`, { type: 'warn', ms: 5500 });
        return;
      }
      if (kind === 'operators' && hasRecords(v.id)) {
        toast('Este operador tiene viajes, préstamos o configuración en Operadores; no se puede eliminar. Puedes editar su nombre.', { type: 'warn', ms: 5500 });
        return;
      }
      if (!(await confirmDestructive(`¿Eliminar ${def.label(v)}?`, 'Se quita del catálogo. Los documentos ya generados no cambian.'))) return;
      await cat.remove(kind, v.id); sh.close(); draw(); toast('Eliminado del catálogo', { type: 'info' });
    });
  }
  on(root, 'click', '[data-back]', () => back('/catalogos'));
  on(root, 'click', '[data-add]', () => edit(null));
  on(root, 'click', '[data-id]', (e, b) => edit(cat.list(kind, company).find((x) => x.id === b.dataset.id)));
  on(root, 'click', '[data-co]', (e, b) => { company = b.dataset.co; setSetting('catCompany', company); draw(); });
  on(root, 'click', '[data-tt]', (e, b) => { ttype = b.dataset.tt; draw(); });
  root.querySelector('.search-in').addEventListener('input', (e) => { text = e.target.value.trim(); draw(); });
  draw();
  return s;
}
