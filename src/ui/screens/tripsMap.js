/*
 * Operación → Mapa de viajes (#/operacion/mapa; ?estado=14 abre una entidad)
 * Distribución de los viajes registrados por entidad de destino, sobre el mapa de las 32 entidades (SVG propio, sin
 * motor de mapas). Los conteos salen de los mismos viajes de Control de operadores (services/tripsMap.js); aquí no se
 * crea ni se modifica ningún viaje: cada fila abre el viaje original.
 *   Filtros       división (Todas, Puerto, Campo) y periodo (histórico, este año, este mes, últimos 30 días, rango)
 *   Indicadores   total, estados atendidos, Puerto, Campo y estado con mayor actividad (se pueden tocar para filtrar)
 *   Mapa          intensidad azul por número de viajes; el naranja solo marca el estado señalado o elegido
 *   Detalle       panel lateral en computadora; hoja inferior en iPhone; lista con búsqueda, división, orden y páginas
 *   Sin estado    los viajes que no se pudieron ubicar se revisan aparte y se les puede asignar entidad (no en consulta)
 * Animación de entrada una vez por sesión (no se repite al filtrar ni al volver); salida breve; sin movimiento con
 * «reducir movimiento». Zoom con los botones, pellizco (dos dedos) o Ctrl + rueda; arrastrar para moverse con zoom.
 * mountCoverage(el) dibuja la tarjeta «Cobertura nacional» de Inicio.
 */
import { screen, on, sleep } from '../../core/dom.js';
import { go, back } from '../../core/router.js';
import * as tm from '../../services/tripsMap.js';
import { onLogisticsChange } from '../../services/logistics.js';
import { onGeoChange } from '../../services/geocode.js';
import { isReadOnly } from '../../services/access.js';
import { STATES, stateByCode, placeName, FOREIGN } from '../../domain/geo/mexico.js';
import { DIVISIONS, PERIODS, periodLabel, summarize, listTrips, matches } from '../../domain/geo/tripsMap.js';
import { esc } from '../../domain/shared/format.js';
import { fmtDate } from '../../domain/operators/balance.js';
import { icon } from '../components/icons.js';
import { openSheet } from '../components/sheet.js';
import { openPicker } from '../components/picker.js';
import { toast } from '../components/toast.js';

/* Filtros, entidad elegida y lista del detalle: se conservan al volver de un viaje (durante la sesión) */
const F = { division: 'all', period: { key: 'all', from: '', to: '' } };
const D = { q: '', div: 'all', sort: 'recent', page: 0 };
let selected = null, entered = false, reopen = false;

const PAGE = 20;
const reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const wide = () => !!(window.matchMedia && window.matchMedia('(min-width: 1024px)').matches);
const plural = (n, a, b) => `${n.toLocaleString('es-MX')} ${n === 1 ? a : b}`;
const num = (n) => n.toLocaleString('es-MX');
const divName = (d) => (d === 'puerto' ? 'Puerto' : d === 'campo' ? 'Campo' : '');
const HOW = { texto: 'destino escrito', localidad: 'localidad del destino', documento: 'dirección del documento', 'catálogo': 'dirección del catálogo', 'ubicación': 'ubicación en el mapa', 'asignación': 'asignación manual' };
const isUnid = (p) => p && (p.status === 'ambiguous' || p.status === 'unknown');

/* ===== Mapa SVG ===== */
function svgOf(geo, { mini = false } = {}) {
  return `<svg class="tm-svg${mini ? ' mini' : ''}" viewBox="0 0 ${geo.w} ${Math.ceil(geo.h)}" ${mini ? 'aria-hidden="true" focusable="false"' : 'role="group" aria-label="Mapa de las 32 entidades federativas de México"'}>
    <g class="tm-g">${geo.states.map((s) => `<path class="tm-st" data-code="${s.code}" d="${s.d}"${mini ? '' : ` tabindex="0" role="button" style="--d:${Math.round(80 + (s.cx / geo.w) * 300)}ms"`}></path>`).join('')}</g>
    ${mini ? '' : '<g class="tm-selg" aria-hidden="true"><path class="tm-hov" d=""></path><path class="tm-selp" d=""></path></g>'}
  </svg>`;
}
function paintStates(svg, sum, sel = null) {
  svg.querySelectorAll('.tm-st').forEach((p) => {
    const code = p.dataset.code, b = sum.byState[code], n = b ? b.total : 0, st = stateByCode(code);
    p.dataset.s = sum.scale.stepOf(n);
    p.classList.toggle('dim', !!sel && sel !== code);
    if (p.hasAttribute('tabindex')) {
      p.setAttribute('aria-label', `${st.name}: ${plural(n, 'viaje', 'viajes')}`);
      p.setAttribute('aria-pressed', String(sel === code));
    }
  });
}
function legendHTML(sum) {
  const items = [['0', 'Sin viajes'], ...sum.scale.ranges.map((r) => [String(r.step), r.min === r.max ? num(r.min) : `${num(r.min)}–${num(r.max)}`])];
  return `<span class="tm-lg-t">Viajes registrados</span><ul class="tm-lg">${items.map(([s, l]) => `<li><i class="tm-sw" data-s="${s}"></i>${esc(l)}</li>`).join('')}</ul>`;
}

/* ===== Pantalla ===== */
export async function tripsMapScreen(params, q) {
  let geo;
  try { geo = await tm.loadGeometry(); } catch (e) {
    return screen(`<div class="page wide tm-page"><header class="nav-top"><button type="button" class="nav-back" data-back>${icon.back}<span>Operación</span></button></header>
      <h1 class="title">Mapa de viajes</h1><div class="empty"><p><b class="empty-t">No se pudo cargar el mapa</b>Revisa la conexión y vuelve a intentarlo.</p></div></div>`);
  }
  let data = await tm.mapData();
  const pre = q && q.get('estado');
  if (pre && stateByCode(pre)) { if (selected !== pre) Object.assign(D, { q: '', div: 'all', sort: 'recent', page: 0 }); selected = pre; reopen = true; }
  const first = !entered && !reduced();
  entered = true;
  const s = screen(`<div class="page wide tm-page${first ? ' tm-enter' : ''}">
    <header class="nav-top"><button type="button" class="nav-back" data-back>${icon.back}<span>Operación</span></button></header>
    <h1 class="title">Mapa de viajes</h1>
    <p class="page-lead">Distribución de viajes por estado de destino.</p>
    <div class="tm-ui tm-filters">
      <div class="seg tm-divf" role="group" aria-label="División">${DIVISIONS.map((d) => `<button type="button" class="seg-b" data-div="${d.key}">${d.label}</button>`).join('')}</div>
      <div class="chips filters tm-perf" role="group" aria-label="Periodo">${PERIODS.map((p) => `<button type="button" class="chip" data-per="${p.key}">${p.label}</button>`).join('')}</div>
    </div>
    <div class="tm-ui tiles tm-kpis" data-kpis aria-live="polite"></div>
    <div class="tm-main">
      <section class="tm-card" aria-labelledby="tm-h">
        <div class="tm-card-h"><h2 id="tm-h">Viajes por estado de destino</h2><span class="tm-per" data-per-l></span></div>
        <div class="tm-stage" data-stage>
          ${svgOf(geo)}
          <div class="tm-tip" role="tooltip" hidden></div>
          <div class="tm-zoom" role="group" aria-label="Zoom del mapa">
            <button type="button" class="tm-zb" data-zoom="in" aria-label="Acercar">${icon.plus}</button>
            <button type="button" class="tm-zb" data-zoom="out" aria-label="Alejar">${icon.minus}</button>
            <button type="button" class="tm-zb" data-zoom="reset" aria-label="Ver todo el país">${icon.fit}</button>
          </div>
        </div>
        <div class="tm-ui tm-legend" data-legend></div>
        <div class="tm-ui tm-selbar" data-selbar></div>
        <div class="tm-ui tm-notes" data-notes></div>
      </section>
      <aside class="tm-side" data-side aria-live="polite"></aside>
    </div>
    <section class="tm-ui tm-topw" data-topw></section>
    <details class="tm-ui tm-all"><summary><span>Las 32 entidades</span>${icon.down}</summary><div class="tm-alll" data-all></div></details>
  </div>`);
  const root = s.el, svg = root.querySelector('.tm-svg'), stage = root.querySelector('[data-stage]'), tip = root.querySelector('.tm-tip');
  const pathOf = (code) => svg.querySelector(`.tm-st[data-code="${code}"]`);
  let sum = null, sheet = null;

  /* ----- Dibujo ----- */
  function draw() {
    sum = summarize(data.rows, F, data.today);
    root.querySelectorAll('[data-div]').forEach((b) => { const onb = b.dataset.div === F.division; b.classList.toggle('on', onb); b.setAttribute('aria-pressed', String(onb)); });
    root.querySelectorAll('[data-per]').forEach((b) => { const onb = b.dataset.per === F.period.key; b.classList.toggle('on', onb); b.setAttribute('aria-pressed', String(onb)); });
    root.querySelector('[data-per-l]').textContent = `${periodLabel(F.period, data.today)}${F.division !== 'all' ? ' · División ' + divName(F.division) : ''}`;
    const lead = sum.leader;
    root.querySelector('[data-kpis]').innerHTML = [
      ['total', 'Total de viajes', num(sum.total), false, 'Ver todas las divisiones'],
      ['states', 'Estados atendidos', `${sum.statesServed}<span class="tm-of"> de 32</span>`, false, 'Ver las 32 entidades'],
      ['puerto', 'División Puerto', num(sum.puerto), F.division === 'puerto', 'Filtrar División Puerto'],
      ['campo', 'División Campo', num(sum.campo), F.division === 'campo', 'Filtrar División Campo'],
      ['leader', 'Estado con mayor actividad', lead ? esc(stateByCode(lead.code).short) : '—', !!lead && selected === lead.code, lead ? `Ver ${stateByCode(lead.code).short}` : '', lead ? plural(lead.total, 'viaje', 'viajes') : 'Sin viajes'],
    ].map(([k, l, v, onb, aria, sub]) => `<button type="button" class="tile tm-kpi${onb ? ' on' : ''}${k === 'leader' ? ' lead' : ''}" data-kpi="${k}"${aria ? ` aria-label="${esc(l)}: ${esc(String(v).replace(/<[^>]+>/g, ''))}. ${esc(aria)}"` : ''}${k === 'leader' && !lead ? ' disabled' : ''}><small>${l}</small><b>${v}</b>${sub ? `<span class="tm-kpi-sub">${esc(sub)}</span>` : ''}</button>`).join('');
    paintStates(svg, sum, selected);
    root.querySelector('[data-legend]').innerHTML = legendHTML(sum);
    drawSelection();
    drawNotes();
    drawTop();
    root.querySelector('[data-all]').innerHTML = STATES.slice().sort((a, b) => a.short.localeCompare(b.short, 'es')).map((st) => {
      const n = (sum.byState[st.code] || {}).total || 0;
      return `<button type="button" class="tm-allb${selected === st.code ? ' on' : ''}" data-pick="${st.code}"><i class="tm-sw" data-s="${sum.scale.stepOf(n)}"></i><span>${esc(st.short)}</span><b>${num(n)}</b></button>`;
    }).join('');
    drawDetail();
  }
  function drawNotes() {
    const mapped = sum.ranking.reduce((a, r) => a + r.total, 0), u = sum.unidentified, f = sum.foreign;
    root.querySelector('[data-notes]').innerHTML = `
      ${u.total ? `<button type="button" class="tm-note warn" data-unid>${icon.alert}<span><b>${plural(u.total, 'viaje sin estado identificado', 'viajes sin estado identificado')}</b><small>Cuentan en el total, no en un estado. ${isReadOnly() ? 'Ver detalle' : 'Revisar y asignar estado'}</small></span>${icon.chev}</button>` : ''}
      ${f.total ? `<button type="button" class="tm-note" data-foreign>${icon.info}<span><b>${plural(f.total, 'viaje con destino fuera de México', 'viajes con destino fuera de México')}</b><small>No se cuentan en el mapa ni en el total nacional</small></span>${icon.chev}</button>` : ''}
      <p class="tm-foot">${num(mapped)} en el mapa${u.total ? ` + ${num(u.total)} sin estado identificado` : ''} = ${plural(sum.total, 'viaje', 'viajes')} con destino en México.${data.future ? ` ${plural(data.future, 'viaje con fecha posterior a hoy no se cuenta', 'viajes con fecha posterior a hoy no se cuentan')} hasta realizarse.` : ''}</p>`;
  }
  function drawTop() {
    const top = sum.top, max = top.length ? top[0].total : 1;
    root.querySelector('[data-topw]').innerHTML = `<div class="sec-hrow"><h2 class="sec-h">Estados con mayor actividad</h2></div>
      ${top.length ? `<ol class="tm-rank">${top.map((r, i) => `<li><button type="button" class="tm-rk${selected === r.code ? ' on' : ''}" data-pick="${r.code}">
        <span class="tm-rk-n">${i + 1}</span>
        <span class="tm-rk-tx"><b>${esc(stateByCode(r.code).short)}</b><small>Puerto ${num(r.puerto)} · Campo ${num(r.campo)}</small><span class="tm-bar" aria-hidden="true"><i style="width:${Math.max(4, Math.round((r.total / max) * 100))}%"></i></span></span>
        <b class="tm-rk-c">${num(r.total)}</b></button></li>`).join('')}</ol>`
        : `<div class="empty"><p><b class="empty-t">Sin viajes en este periodo</b>Cambia la división o el periodo para ver la actividad.</p></div>`}`;
  }
  function drawSelection() {
    const sp = svg.querySelector('.tm-selp'), p = selected ? pathOf(selected) : null;
    sp.setAttribute('d', p ? p.getAttribute('d') : '');
    sp.classList.remove('pop'); if (p && !reduced()) requestAnimationFrame(() => sp.classList.add('pop'));
    const bar = root.querySelector('[data-selbar]');
    if (!selected) { bar.innerHTML = ''; return; }
    const b = sum.byState[selected] || { total: 0 };
    bar.innerHTML = `<button type="button" class="tm-selb" data-open>${icon.pin}<span><b>${esc(stateByCode(selected).short)}</b> · ${plural(b.total, 'viaje', 'viajes')}</span><span class="tm-selgo">Ver viajes${icon.chev}</span></button>
      <button type="button" class="icon-btn tm-selx" data-unsel aria-label="Quitar selección">${icon.close}</button>`;
  }

  /* ----- Detalle de la entidad ----- */
  function stateRows(code) {
    return data.rows.filter((r) => r.place.status === 'state' && r.place.code === code && matches(r.trip, F, data.today) && (D.div === 'all' || r.trip.division === D.div));
  }
  function tripRow(r) {
    const t = r.trip, ref = t.reference ? `${t.division === 'puerto' ? 'Contenedor' : 'Ref.'} ${esc(t.reference)}` : 'Sin referencia';
    const who = [r.client && `Cliente: ${esc(r.client)}`, r.unit && `Unidad: ${esc(r.unit)}`, r.operator && `Operador: ${esc(r.operator)}`].filter(Boolean).join(' · ');
    return `<button type="button" class="tm-trip" data-trip="${esc(t.id)}" data-op="${esc(t.operatorId || '')}">
      <span class="tm-tr1"><b class="${t.reference ? 'mono' : ''}">${ref}</b><span class="tm-dv ${t.division}">${divName(t.division)}</span><span class="tm-ok">Realizado</span></span>
      <span class="tm-tr2">${esc(fmtDate(t.date) || 'Sin fecha')} · ${esc(t.origin || '—')} → ${esc(t.destination || '—')}</span>
      ${who ? `<span class="tm-tr3">${who}</span>` : ''}
      ${r.place.how && !['texto', 'localidad'].includes(r.place.how) ? `<span class="tm-tr3 tm-how">Estado según ${esc(HOW[r.place.how] || r.place.how)}</span>` : ''}
      <span class="chev">${icon.chev}</span></button>`;
  }
  function detailHTML(code, { head = true } = {}) {
    const st = stateByCode(code), b = sum.byState[code] || { total: 0, puerto: 0, campo: 0 };
    return `<div class="tm-det" data-det="${code}">
      ${head ? `<header class="tm-det-h"><div><h2>${esc(st.name)}</h2><small>${esc(periodLabel(F.period, data.today))}${F.division !== 'all' ? ' · División ' + divName(F.division) : ''}</small></div><button type="button" class="icon-btn" data-unsel aria-label="Quitar selección">${icon.close}</button></header>`
        : `<p class="tm-det-p">${esc(periodLabel(F.period, data.today))}${F.division !== 'all' ? ' · División ' + divName(F.division) : ''}</p>`}
      <div class="tm-det-k"><div><small>Viajes</small><b>${num(b.total)}</b></div><div><small>Puerto</small><b>${num(b.puerto)}</b></div><div><small>Campo</small><b>${num(b.campo)}</b></div></div>
      ${b.total ? `<label class="search"><span class="search-ic">${icon.search}</span><input type="search" class="search-in" data-dq value="${esc(D.q)}" placeholder="Referencia, origen, operador, unidad…" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search" aria-label="Buscar viajes de ${esc(st.short)}"></label>
      <div class="chips tm-det-f" role="group" aria-label="Filtrar y ordenar">
        ${DIVISIONS.map((d) => `<button type="button" class="chip${D.div === d.key ? ' on' : ''}" data-ddiv="${d.key}" aria-pressed="${D.div === d.key}">${d.label}</button>`).join('')}
        <button type="button" class="chip" data-dsort>${icon.swap}${D.sort === 'recent' ? 'Más recientes' : 'Más antiguos'}</button>
      </div>
      <div data-dlist></div>` : `<div class="empty"><p><b class="empty-t">Sin viajes</b>No hay viajes con destino en ${esc(st.short)} en este periodo.</p></div>`}
    </div>`;
  }
  function drawList(host) {
    const el = host.querySelector('[data-dlist]');
    if (!el || !selected) return;
    const res = listTrips(stateRows(selected), { q: D.q, sort: D.sort, page: D.page, size: PAGE });
    D.page = res.page;
    el.innerHTML = res.total ? `<div class="tm-trips">${res.items.map(tripRow).join('')}</div>
      ${res.pages > 1 ? `<div class="tm-pager"><button type="button" class="btn-ghost sm" data-pg="-1"${res.page === 0 ? ' disabled' : ''}>${icon.back}<span>Anterior</span></button><span>Página ${res.page + 1} de ${res.pages} · ${plural(res.total, 'viaje', 'viajes')}</span><button type="button" class="btn-ghost sm" data-pg="1"${res.page >= res.pages - 1 ? ' disabled' : ''}><span>Siguiente</span>${icon.chev}</button></div>`
        : `<p class="tm-cnt">${plural(res.total, 'viaje', 'viajes')}</p>`}`
      : '<div class="empty"><p>Sin coincidencias.</p></div>';
  }
  function drawDetail() {
    const side = root.querySelector('[data-side]');
    if (wide()) {
      if (sheet) { const sh = sheet; sheet = null; sh.close(); }
      side.innerHTML = selected ? detailHTML(selected) : `<div class="tm-side-e">${icon.map}<p><b>Elige un estado</b>Toca un estado del mapa o de la lista para ver sus viajes.</p></div>`;
      if (selected) drawList(side);
      return;
    }
    side.innerHTML = '';
    if (sheet && sheet.code === selected) { sheet.body.innerHTML = detailHTML(selected, { head: false }); drawList(sheet.body); }
    else if (sheet && !selected) { const sh = sheet; sheet = null; sh.close(); }
  }
  function openDetailSheet() {
    if (!selected || wide()) return;
    if (sheet) { const sh = sheet; sheet = null; sh.close(); }
    const code = selected;
    const sh = openSheet({ title: stateByCode(code).name, body: detailHTML(code, { head: false }), className: 'tm-sheet', onClose: () => { if (sheet === sh) sheet = null; } });
    sh.code = code; sheet = sh;
    drawList(sh.body);
    bindDetail(sh.body);
  }
  function bindDetail(host) {
    on(host, 'input', '[data-dq]', (e, inp) => { D.q = inp.value; D.page = 0; drawList(host); });
    on(host, 'click', '[data-ddiv]', (e, b) => { D.div = b.dataset.ddiv; D.page = 0; host.querySelectorAll('[data-ddiv]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); }); drawList(host); });
    on(host, 'click', '[data-dsort]', (e, b) => { D.sort = D.sort === 'recent' ? 'oldest' : 'recent'; D.page = 0; b.innerHTML = `${icon.swap}${D.sort === 'recent' ? 'Más recientes' : 'Más antiguos'}`; drawList(host); });
    on(host, 'click', '[data-pg]', (e, b) => { D.page += Number(b.dataset.pg); drawList(host); const l = host.querySelector('[data-dlist]'); if (l && l.scrollIntoView) l.scrollIntoView({ block: 'nearest' }); });
    on(host, 'click', '[data-trip]', (e, b) => {
      if (!b.dataset.op) { toast('El viaje no tiene operador relacionado.', { type: 'warn' }); return; }
      reopen = !wide();
      go(`/operadores/${encodeURIComponent(b.dataset.op)}?viaje=${encodeURIComponent(b.dataset.trip)}`);
    });
    on(host, 'click', '[data-unsel]', () => select(null));
  }
  bindDetail(root.querySelector('[data-side]'));

  function select(code, { openDetail = true } = {}) {
    if (code !== selected) Object.assign(D, { q: '', div: 'all', sort: 'recent', page: 0 });
    selected = code || null;
    paintStates(svg, sum, selected);
    root.querySelectorAll('[data-pick]').forEach((b) => b.classList.toggle('on', b.dataset.pick === selected));
    root.querySelectorAll('[data-kpi="leader"]').forEach((b) => b.classList.toggle('on', !!selected && !!sum.leader && sum.leader.code === selected));
    drawSelection();
    if (wide()) drawDetail();
    else if (!selected) drawDetail();
    else if (openDetail) openDetailSheet();
  }

  /* ----- Sin estado identificado y extranjero ----- */
  function openUnidentified() {
    const rows = data.rows.filter((r) => isUnid(r.place) && matches(r.trip, F, data.today));
    const groups = new Map();
    for (const r of rows) {
      const k = tm.destKey(r.trip.destination) || '∅';
      const g = groups.get(k) || { key: k, text: String(r.trip.destination || '').trim(), rows: [], place: r.place };
      g.rows.push(r); groups.set(k, g);
    }
    const list = [...groups.values()].sort((a, b) => b.rows.length - a.rows.length || a.text.localeCompare(b.text, 'es'));
    const ro = isReadOnly();
    const body = `<p class="sheet-lead">Estos viajes cuentan en el total de viajes, pero en ningún estado: su destino no indica una sola entidad. ${ro ? '' : 'Asignar una entidad aplica a todos los viajes con el mismo destino y no modifica el viaje.'}</p>
      ${list.map((g) => `<div class="tm-ug">
        <div class="tm-ug-h"><div><b>${g.text ? esc(g.text) : '<i>Sin destino escrito</i>'}</b><small>${plural(g.rows.length, 'viaje', 'viajes')}${g.place.note ? ' · ' + esc(g.place.note) : ''}</small></div>
          ${!ro && g.text ? `<button type="button" class="btn-secondary sm" data-assign="${esc(g.key)}">Asignar estado</button>` : ''}</div>
        <div class="tm-trips">${g.rows.slice(0, 3).map(tripRow).join('')}</div>
        ${g.rows.length > 3 ? `<p class="tm-cnt">y ${plural(g.rows.length - 3, 'viaje más', 'viajes más')}</p>` : ''}
      </div>`).join('') || '<div class="empty"><p>No hay viajes sin estado identificado.</p></div>'}
      ${overridesHTML(ro)}`;
    const sh = openSheet({ title: 'Viajes sin estado identificado', body, className: 'tm-sheet', full: true });
    bindDetail(sh.body);
    on(sh.body, 'click', '[data-assign]', async (e, b) => {
      const g = groups.get(b.dataset.assign);
      if (!g) return;
      const code = await pickState(g.place.candidates || []);
      if (!code) return;
      try { await tm.setDestState(g.text, code); } catch (err) { toast(err.message, { type: 'warn' }); return; }
      toast(`«${g.text}» quedó en ${placeName(code)}`);
      sh.close();
    });
    bindOverrides(sh);
  }
  function overridesHTML(ro) {
    const list = tm.overridesList();
    if (!list.length) return '';
    return `<div class="sec-hrow"><h2 class="sec-h">Destinos asignados a mano</h2><span class="count">${list.length}</span></div>
      <div class="list">${list.map((o) => `<div class="row static tm-ov"><span class="row-tx"><span class="row-l1"><b>${esc(o.text)}</b></span><span class="row-l2">${esc(placeName(o.code))}</span><span class="row-l3">${esc(o.by || '')}${o.at ? ' · ' + esc(new Date(o.at).toLocaleDateString('es-MX')) : ''}</span></span>
        ${ro ? '' : `<button type="button" class="btn-ghost sm" data-unassign="${esc(o.key)}">Quitar</button>`}</div>`).join('')}</div>`;
  }
  function bindOverrides(sh) {
    on(sh.body, 'click', '[data-unassign]', async (e, b) => {
      const o = (tm.overridesList() || []).find((x) => x.key === b.dataset.unassign);
      if (!o) return;
      try { await tm.clearDestState(o.text); } catch (err) { toast(err.message, { type: 'warn' }); return; }
      toast('Asignación quitada');
      sh.close();
    });
  }
  async function pickState(candidates) {
    const c = candidates.filter((x) => x !== FOREIGN);
    const items = [
      ...c.map((code) => ({ value: code, label: stateByCode(code).name, sub: 'Posible según el destino' })),
      ...STATES.filter((st) => !c.includes(st.code)).sort((a, b) => a.name.localeCompare(b.name, 'es')).map((st) => ({ value: st.code, label: st.name, sub: `Clave ${st.code}` })),
      { value: FOREIGN, label: 'Fuera de México', sub: 'No se cuenta en el mapa' },
    ];
    const r = await openPicker({ title: 'Entidad de destino', items, allowNew: false, placeholder: 'Buscar entidad', emptyText: '' });
    return r && !r.isNew ? r.value : null;
  }
  function openForeign() {
    const rows = data.rows.filter((r) => r.place.status === 'foreign' && matches(r.trip, F, data.today));
    const sh = openSheet({ title: 'Destinos fuera de México', className: 'tm-sheet', full: rows.length > 4,
      body: `<p class="sheet-lead">No se pintan en el mapa ni se suman al total nacional.</p><div class="tm-trips">${rows.map(tripRow).join('')}</div>${overridesHTML(isReadOnly())}` });
    bindDetail(sh.body);
    bindOverrides(sh);
  }

  /* ----- Periodo personalizado ----- */
  function openRange() {
    const p = F.period, today = data.today;
    const sh = openSheet({ title: 'Rango personalizado', body: `<form class="tm-range">
      <label class="fld"><span class="fl">Desde</span><input type="date" class="in" name="from" value="${esc(p.from || '')}" max="${today}"></label>
      <label class="fld"><span class="fl">Hasta</span><input type="date" class="in" name="to" value="${esc(p.to || today)}" max="${today}"></label>
      <div class="sheet-acts"><button type="button" class="btn-ghost" data-cancel>Cancelar</button><button type="submit" class="btn-primary">Aplicar</button></div></form>` });
    const form = sh.body.querySelector('form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const from = form.from.value, to = form.to.value;
      if (!from && !to) { toast('Indica al menos una fecha.', { type: 'warn' }); return; }
      F.period = { key: 'range', from, to };
      sh.close(); refilter();
    });
    sh.body.querySelector('[data-cancel]').addEventListener('click', () => sh.close());
  }

  function refilter() { D.page = 0; draw(); }

  /* ----- Eventos ----- */
  on(root, 'click', '[data-back]', () => back('/operacion'));
  on(root, 'click', '[data-div]', (e, b) => { F.division = b.dataset.div; refilter(); });
  on(root, 'click', '[data-per]', (e, b) => {
    if (b.dataset.per === 'range') { openRange(); return; }
    F.period = { key: b.dataset.per, from: '', to: '' }; refilter();
  });
  on(root, 'click', '[data-kpi]', (e, b) => {
    const k = b.dataset.kpi;
    if (k === 'total') { F.division = 'all'; refilter(); }
    else if (k === 'puerto' || k === 'campo') { F.division = F.division === k ? 'all' : k; refilter(); }
    else if (k === 'leader' && sum.leader) select(sum.leader.code);
    else if (k === 'states') { const d = root.querySelector('.tm-all'); d.open = true; d.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' }); }
  });
  on(root, 'click', '[data-pick]', (e, b) => select(b.dataset.pick));
  on(root, 'click', '[data-open]', () => openDetailSheet());
  on(root, 'click', '[data-unsel]', () => select(null));
  on(root, 'click', '[data-unid]', () => openUnidentified());
  on(root, 'click', '[data-foreign]', () => openForeign());

  /* Mapa: señalar (ratón), tocar o Enter para elegir */
  const hov = svg.querySelector('.tm-hov');
  function showTip(code, x, y) {
    const st = stateByCode(code), b = sum.byState[code] || { total: 0, puerto: 0, campo: 0 };
    tip.innerHTML = `<b>${esc(st.short.toUpperCase())}</b><span>Viajes: <b>${num(b.total)}</b></span><span>División Puerto: ${num(b.puerto)}</span><span>División Campo: ${num(b.campo)}</span>`;
    tip.hidden = false;
    const r = stage.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    let left = x - r.left + 14, top = y - r.top + 14;
    if (left + w > r.width - 4) left = x - r.left - w - 14;
    if (top + h > r.height - 4) top = y - r.top - h - 14;
    tip.style.transform = `translate(${Math.max(4, left)}px,${Math.max(4, top)}px)`;
    hov.setAttribute('d', pathOf(code).getAttribute('d'));
  }
  function hideTip() { tip.hidden = true; hov.setAttribute('d', ''); }
  svg.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || drag) return;
    const p = e.target.closest('.tm-st');
    if (p) showTip(p.dataset.code, e.clientX, e.clientY); else hideTip();
  });
  svg.addEventListener('pointerleave', hideTip);
  svg.addEventListener('focusin', (e) => { const p = e.target.closest('.tm-st'); if (!p) return; const r = p.getBoundingClientRect(); showTip(p.dataset.code, r.left + r.width / 2, r.top + r.height / 2); });
  svg.addEventListener('focusout', hideTip);
  svg.addEventListener('keydown', (e) => {
    const p = e.target.closest('.tm-st');
    if (p && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(p.dataset.code); }
    if (e.key === 'Escape' && selected) select(null);
  });
  svg.addEventListener('click', (e) => {
    if (moved) { moved = false; return; }
    const p = e.target.closest('.tm-st');
    if (p) {
      if (e.pointerType !== 'mouse' && p.dataset.code !== selected) { const r = p.getBoundingClientRect(); showTip(p.dataset.code, r.left + r.width / 2, r.top + r.height / 2); setTimeout(hideTip, 1400); }
      select(p.dataset.code === selected && wide() ? null : p.dataset.code);
    }
  });

  /* ----- Zoom y desplazamiento (viewBox) ----- */
  const W = geo.w, H = Math.ceil(geo.h);
  let vb = { x: 0, y: 0, w: W, h: H }, drag = null, moved = false, pinch = null;
  const zoomed = () => vb.w < W - 0.5;
  function setVB(n, animate = false) {
    const w = Math.min(W, Math.max(W / 8, n.w)), h = (w * H) / W;
    vb = { x: Math.min(W - w, Math.max(0, n.x)), y: Math.min(H - h, Math.max(0, n.y)), w, h };
    svg.classList.toggle('anim', animate && !reduced());
    svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    stage.classList.toggle('zoomed', zoomed());
  }
  const toSvg = (cx, cy) => { const r = svg.getBoundingClientRect(); return { x: vb.x + ((cx - r.left) / r.width) * vb.w, y: vb.y + ((cy - r.top) / r.height) * vb.h, r }; };
  function zoomAt(f, cx, cy) {
    const p = toSvg(cx, cy), w = Math.min(W, Math.max(W / 8, vb.w / f)), k = w / vb.w;
    setVB({ x: p.x - (p.x - vb.x) * k, y: p.y - (p.y - vb.y) * k, w });
  }
  on(root, 'click', '[data-zoom]', (e, b) => {
    const r = svg.getBoundingClientRect(), z = b.dataset.zoom;
    if (z === 'reset') { setVB({ x: 0, y: 0, w: W }); return; }
    let cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const sp = selected && pathOf(selected);
    if (z === 'in' && sp && !zoomed()) { const br = sp.getBoundingClientRect(); cx = br.left + br.width / 2; cy = br.top + br.height / 2; }
    zoomAt(z === 'in' ? 1.6 : 1 / 1.6, cx, cy);
  });
  svg.addEventListener('wheel', (e) => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); zoomAt(Math.exp(-e.deltaY / 300), e.clientX, e.clientY); }, { passive: false });
  svg.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse' && zoomed() && e.button === 0) { drag = { x: e.clientX, y: e.clientY, vb: { ...vb } }; moved = false; } });
  window.addEventListener('pointermove', onDrag);
  window.addEventListener('pointerup', endDrag);
  function onDrag(e) {
    if (!drag || e.pointerType !== 'mouse') return;
    const r = svg.getBoundingClientRect(), dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
    if (moved) { hideTip(); setVB({ x: drag.vb.x - (dx / r.width) * drag.vb.w, y: drag.vb.y - (dy / r.height) * drag.vb.h, w: drag.vb.w }); }
  }
  function endDrag() { drag = null; }
  /* Táctil: dos dedos acercan o alejan; con zoom, un dedo mueve el mapa. Sin zoom, un dedo desplaza la página. */
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const mid = (t) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
  stage.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) { e.preventDefault(); const m = mid(e.touches); pinch = { d: dist(e.touches), vb: { ...vb }, p: toSvg(m.x, m.y), m }; moved = true; }
    else if (e.touches.length === 1 && zoomed()) { drag = { x: e.touches[0].clientX, y: e.touches[0].clientY, vb: { ...vb }, touch: true }; moved = false; }
  }, { passive: false });
  stage.addEventListener('touchmove', (e) => {
    if (pinch && e.touches.length === 2) {
      e.preventDefault();
      const k = pinch.d / Math.max(1, dist(e.touches)), w = Math.min(W, Math.max(W / 8, pinch.vb.w * k)), f = w / pinch.vb.w, m = mid(e.touches), r = svg.getBoundingClientRect();
      const x = pinch.p.x - (pinch.p.x - pinch.vb.x) * f - ((m.x - pinch.m.x) / r.width) * w, y = pinch.p.y - (pinch.p.y - pinch.vb.y) * f - ((m.y - pinch.m.y) / r.height) * ((w * H) / W);
      setVB({ x, y, w });
    } else if (drag && drag.touch && e.touches.length === 1) {
      e.preventDefault();
      const r = svg.getBoundingClientRect(), dx = e.touches[0].clientX - drag.x, dy = e.touches[0].clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
      if (moved) setVB({ x: drag.vb.x - (dx / r.width) * drag.vb.w, y: drag.vb.y - (dy / r.height) * drag.vb.h, w: drag.vb.w });
    }
  }, { passive: false });
  stage.addEventListener('touchend', (e) => { if (e.touches.length < 2) pinch = null; if (!e.touches.length) { drag = null; setTimeout(() => { moved = false; }, 60); } });

  /* ----- Datos al día ----- */
  let busyData = false;
  async function reload() {
    if (busyData) return; busyData = true;
    try { data = await tm.mapData(); if (root.isConnected) draw(); } finally { busyData = false; }
  }
  const unsub = [tm.onTripsMapChange(reload), onLogisticsChange(reload), onGeoChange(reload)];
  const onSync = () => reload();
  window.addEventListener('pcs:sync', onSync);
  const mq = window.matchMedia ? window.matchMedia('(min-width: 1024px)') : null;
  const onMq = () => drawDetail();
  if (mq && mq.addEventListener) mq.addEventListener('change', onMq);

  draw();
  if (!first) svg.classList.add('tm-filled');
  s.mounted = () => {
    if (first) {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        root.classList.add('tm-run');
        setTimeout(() => svg.classList.add('tm-filled'), 420);
        setTimeout(() => root.classList.remove('tm-enter', 'tm-run'), 1150);
      }));
    }
    if (selected && reopen && !wide()) setTimeout(openDetailSheet, first ? 900 : 180);
    reopen = false;
  };
  s.cleanup = async () => {
    unsub.forEach((u) => u());
    window.removeEventListener('pcs:sync', onSync);
    window.removeEventListener('pointermove', onDrag);
    window.removeEventListener('pointerup', endDrag);
    if (mq && mq.removeEventListener) mq.removeEventListener('change', onMq);
    /* Salida breve (no al refrescar por Información compartida ni con «reducir movimiento») */
    if (!reduced() && root.isConnected && !document.documentElement.classList.contains('sync-refresh')) { root.classList.add('tm-out'); await sleep(240); }
  };
  return s;
}

/* ===== Inicio: tarjeta «Cobertura nacional» ===== */
export function mountCoverage(el) {
  if (!el) return () => {};
  let alive = true;
  async function paint() {
    let geo, data;
    try { [geo, data] = await Promise.all([tm.loadGeometry(), tm.mapData()]); } catch (e) { if (alive) el.hidden = true; return; }
    if (!alive) return;
    const sum = summarize(data.rows, { division: 'all', period: { key: 'all' } }, data.today), lead = sum.leader;
    el.hidden = false;
    el.innerHTML = `<a class="tm-home" href="#/operacion/mapa" aria-label="Cobertura nacional: explorar el mapa de viajes">
      <div class="tm-home-tx">
        <span class="tm-home-k">${icon.map}Cobertura nacional</span>
        <b class="tm-home-n">${sum.total ? plural(sum.total, 'viaje', 'viajes') : 'Sin viajes registrados'}</b>
        <span class="tm-home-s">${sum.total ? `${sum.statesServed} de 32 estados atendidos${lead ? ` · Mayor actividad: ${esc(stateByCode(lead.code).short)}` : ''}` : 'Los viajes de Control de operadores aparecerán aquí por estado de destino.'}</span>
        <span class="tm-home-b">Explorar mapa${icon.chev}</span>
      </div>
      <div class="tm-home-map">${svgOf(geo, { mini: true })}</div></a>`;
    const svg = el.querySelector('.tm-svg');
    paintStates(svg, sum);
    svg.classList.add('tm-filled');
  }
  paint();
  const re = () => paint();
  const offs = [tm.onTripsMapChange(re), onGeoChange(re)];
  window.addEventListener('pcs:sync', re);
  return () => { alive = false; offs.forEach((f) => f()); window.removeEventListener('pcs:sync', re); };
}

