/*
 * Asistente de Asignación de unidades (División Campo).
 * Pasos: Carga · Unidades · Solicitudes · Revisión
 */
import { go } from '../../core/router.js';
import { setPath, on } from '../../core/dom.js';
import * as drafts from '../../services/drafts.js';
import { pickUnit } from '../components/unitPicker.js';
import * as cat from '../../services/catalogs.js';
import { getCompany } from '../../services/companies.js';
import { recents } from '../../services/settings.js';
import { CP_MAX, CP_TIPOS, CAMPO_TEMPORADA } from '../../config/reference.js';
import { esc, nameCase, normEco, fmtTel, telClean, mapsURL, isGoogleMaps, fmtFecha, ecoLabel } from '../../domain/shared/format.js';
import { CAMPO_STEPS, cpUnit, cpSols, cpSD, campoIssues, cpRows } from '../../domain/campo/model.js';
import { fld, pickFld, setPickDisplay, selFld, group, setKeepCaret, enterAdvances, focusField } from '../components/fields.js';
import { openPicker } from '../components/picker.js';
import { actionSheet, confirmDestructive } from '../components/sheet.js';
import { toast } from '../components/toast.js';
import { icon } from '../components/icons.js';
import { mountDocPreview } from '../components/docview.js';
import { ensureDocAssets, docHTML, generate, generationSummary } from '../flows.js';
import { wizardShell } from './wizardShell.js';

export async function campoWizard({ step }, q) {
  const draft = await drafts.getDraft('campo');
  if (!draft) { toast('No hay una asignación en captura. Crea una nueva.', { type: 'info' }); go('/', { replace: true }); return null; }
  const cp = draft.data;
  const co = getCompany('campo');
  const N = CAMPO_STEPS.length;
  const i = Math.min(Math.max((+step || 1) - 1, 0), N - 1);
  draft.step = Math.min(i, N - 2); drafts.touch(draft);
  await ensureDocAssets('campo', cp);

  const shell = wizardShell({
    kind: 'Asignación de unidades', steps: CAMPO_STEPS, i,
    chip: `<span class="co-chip campo"><img src="${esc(co.logo)}" alt="" class="mark"><b>Campo</b></span>`,
    nextLabel: i === N - 1 ? 'Generar PDF' : i === N - 2 ? 'Revisar' : 'Continuar', backLabel: i === 0 ? 'Salir' : 'Atrás',
  });
  const body = shell.body;
  const save = () => drafts.touch(draft);
  const toStep = (n, f) => go(`/campo/${n + 1}${f ? '?f=' + encodeURIComponent(f) : ''}`);

  function plantInfo() {
    const p = cat.plantByName(cp.planta);
    return p ? `<div class="plant-info">${icon.pin}<div><b>${esc(p.name)}</b><small>${esc(p.address)}</small></div>${mapsURL(p.maps) ? `<a class="btn-ghost sm" href="${esc(mapsURL(p.maps))}" target="_blank" rel="noopener">Abrir ubicación</a>` : ''}</div>` : '';
  }
  function stepCarga() {
    const plants = cat.list('plants');
    const opts = [['', 'Sin indicar'], ...plants.map((p) => [p.name, p.name]), ...(cp.planta && !plants.some((p) => p.name === cp.planta) ? [[cp.planta, cp.planta]] : [])];
    return group('Carga', `
      <div class="folio-row"><div><span class="fl">Folio</span><b class="folio">${esc(cp.folio)}</b></div><span class="tag">${esc(CAMPO_TEMPORADA)}</span></div>
      ${fld({ label: 'Fecha de carga', path: 'fecha', value: cp.fecha, type: 'date' })}
      ${selFld({ label: 'Planta destino', path: 'planta', value: cp.planta, options: opts })}
      <div data-plant>${plantInfo()}</div>`, { note: 'La planta aparece en el documento con su dirección y un código QR de ubicación.' });
  }

  function trailerDesc(p) { const t = cat.list('trailers', 'perconsur').find((x) => x.placas === p); return t ? [cat.trailerTypeLabel(t.type), t.desc].filter(Boolean).join(' | ') : ''; }
  function unitCard(u, k) {
    const sols = [...new Set(cp.units.map((x) => (x.sol || '').trim()).filter(Boolean))];
    return `<article class="card unit" data-ui="${k}">
      <header class="card-h"><h4>Unidad ${k + 1}</h4>${cp.units.length > 1 ? `<button type="button" class="link-danger" data-act="rmUnit" data-i="${k}">Quitar</button>` : ''}</header>
      ${fld({ label: 'No. de solicitud', path: `units.${k}.sol`, value: u.sol, mode: 'numeric', ph: 'Ej. 4501', cap: 'none' })}
      ${sols.length ? `<div class="chips sm">${sols.map((x) => `<button type="button" class="chip${x === (u.sol || '').trim() ? ' on' : ''}" data-sol="${esc(x)}" data-i="${k}">${esc(x)}</button>`).join('')}</div>` : ''}
      <div class="row2">
        ${pickFld({ label: 'Unidad', path: `units.${k}.eco`, value: u.eco ? ecoLabel(u.eco) : '', ph: 'Elegir' })}
        ${fld({ label: 'Placas unidad', path: `units.${k}.pu`, value: u.pu, t: 'upper', cap: 'characters' })}
      </div>
      ${pickFld({ label: 'Operador', path: `units.${k}.op`, value: u.op })}
      ${pickFld({ label: 'Placas remolque', path: `units.${k}.pr`, value: u.pr, sub: trailerDesc(u.pr) })}
      <div class="fld" data-f="units.${k}.tipo"><span class="fl">Tipo de transporte</span>
        <div class="seg big">${CP_TIPOS.map((t) => `<button type="button" class="seg-b${u.tipo === t ? ' on' : ''}" aria-pressed="${u.tipo === t}" data-tipo="${t}" data-i="${k}">${esc(t)}</button>`).join('')}</div></div>
    </article>`;
  }
  function stepUnidades() {
    const full = cp.units.length >= CP_MAX;
    return `<div class="grp-h solo"><h3>Unidades asignadas</h3><span class="count">${cp.units.length} de ${CP_MAX}</span></div>`
      + cp.units.map(unitCard).join('')
      + (full ? `<p class="grp-note center">Máximo ${CP_MAX} unidades por hoja.</p>` : `<button type="button" class="add-btn" data-act="addUnit">${icon.plus}<span>Añadir unidad</span></button>`);
  }

  function solCard(k, idx, only) {
    const d = cpSD(cp, k);
    const u = mapsURL(d.maps);
    const mh = d.maps ? (u ? (isGoogleMaps(u) ? '' : 'El link no parece de Google Maps; revisa que sea correcto.') : 'El link no es válido.') : '';
    const n = cp.units.filter((x) => (x.sol || '').trim() === k).length;
    return `<article class="card sol" data-si="${idx}">
      <header class="card-h"><h4>${k ? `Solicitud ${esc(k)}` : (only ? 'Datos de carga' : 'Unidades sin número de solicitud')}</h4><span class="count">${n} unidad${n === 1 ? '' : 'es'}</span></header>
      <div class="row2">
        <label class="fld" data-f="sols.${idx}.hora"><span class="fl">Hora</span><input class="in" type="time" data-s="hora" data-si="${idx}" value="${esc(d.hora)}"></label>
        <label class="fld" data-f="sols.${idx}.tel"><span class="fl">Teléfono del encargado</span><input class="in" type="tel" inputmode="tel" data-s="tel" data-si="${idx}" value="${esc(d.tel)}" placeholder="(33) 1234 5678" enterkeyhint="next"></label>
      </div>
      <label class="fld" data-f="sols.${idx}.lugar"><span class="fl">Lugar de carga</span><input class="in" data-s="lugar" data-si="${idx}" value="${esc(d.lugar)}" placeholder="Rancho, municipio, estado" enterkeyhint="next"></label>
      <label class="fld" data-f="sols.${idx}.enc"><span class="fl">Encargado de cosecha</span><input class="in" data-s="enc" data-si="${idx}" value="${esc(d.enc)}" placeholder="Nombre" autocapitalize="words" enterkeyhint="next"></label>
      <label class="fld" data-f="sols.${idx}.maps"><span class="fl">Link de Google Maps del lugar de carga</span><input class="in" type="url" inputmode="url" spellcheck="false" autocapitalize="none" autocorrect="off" data-s="maps" data-si="${idx}" value="${esc(d.maps)}" placeholder="https://maps.app.goo.gl/…" enterkeyhint="done"><span class="fhint warn-t" data-mh="${idx}">${esc(mh)}</span></label>
      <a class="btn-ghost sm ${u ? '' : 'disabled'}" data-open="${idx}" href="${u ? esc(u) : '#'}" target="_blank" rel="noopener" ${u ? '' : 'aria-disabled="true"'}>${icon.pin}<span>Abrir ubicación</span></a>
    </article>`;
  }
  function stepSolicitudes() {
    const sols = cpSols(cp), only = sols.length === 1 && sols[0] === '';
    return `<p class="grp-note">Hora, lugar de carga y encargado de cosecha de cada solicitud. El link de Maps genera un código QR en el documento.</p>` + sols.map((k, idx) => solCard(k, idx, only)).join('');
  }

  function stepRevision() {
    const issues = campoIssues(cp), rows = cpRows(cp), sols = [...new Set(cp.units.map((u) => (u.sol || '').trim()).filter(Boolean))];
    const sum = [['Folio', `<b class="folio sm">${esc(cp.folio)}</b>`], ['Fecha de carga', cp.fecha ? esc(fmtFecha(cp.fecha)) : '<i>Sin indicar</i>'], ['Planta destino', esc((cp.planta || '').replace(/^Planta /, '')) || '<i>Sin indicar</i>'],
      ['Unidades', rows.length ? rows.map((u) => `${esc(ecoLabel(u.eco) || '—')} | ${esc(u.op || 'Sin operador')}${u.tipo ? ' | ' + esc(u.tipo) : ''}`).join('<br>') : '<i>Sin capturar</i>'], ['Solicitudes', String(sols.length || '—')]];
    return `${issues.length ? `<section class="issues"><div class="issues-h">${icon.alert}<b>Datos pendientes (${issues.length})</b></div><p>Puedes generar de todos modos.</p>
        ${issues.map((w, k) => `<button type="button" class="issue" data-issue="${k}"><span>${esc(w.msg)}</span><span class="chev">${icon.chev}</span></button>`).join('')}</section>`
      : `<section class="ok-box">${icon.check}<span>Toda la información está completa.</span></section>`}
      ${group('Resumen', `<dl class="sumlist">${sum.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`)}
      <div class="grp-h solo"><h3>Vista previa del documento</h3></div>
      <div class="dv-host" data-preview></div>
      <p class="grp-note center">Media carta (8.5 × 5.5 in). El PDF conserva este formato en cualquier dispositivo.</p>`;
  }

  const R = [stepCarga, stepUnidades, stepSolicitudes, stepRevision];
  let dv = null;
  function draw() {
    body.innerHTML = R[i]();
    enterAdvances(body);
    if (i === N - 1) dv = mountDocPreview(body.querySelector('[data-preview]'), docHTML('campo', cp, 'campo'));
    if (q && q.get('f')) setTimeout(() => focusField(body, q.get('f')), 250);
  }

  /* Edición */
  function onInput(e) {
    const t = e.target;
    if (t.matches('[data-s]')) {
      const k = cpSols(cp)[+t.dataset.si], d = cpSD(cp, k), f = t.dataset.s;
      let v = t.value;
      if (f === 'enc' && e.type === 'change') { v = nameCase(v); t.value = v; }
      if (f === 'tel') { const c = telClean(v); setKeepCaret(t, c); v = c; if (e.type === 'change') { v = fmtTel(c); t.value = v; } }
      d[f] = v;
      if (f === 'maps') {
        const u = mapsURL(v), h = body.querySelector(`[data-mh="${t.dataset.si}"]`), a = body.querySelector(`[data-open="${t.dataset.si}"]`);
        if (h) h.textContent = v ? (u ? (isGoogleMaps(u) ? '' : 'El link no parece de Google Maps; revisa que sea correcto.') : 'El link no es válido.') : '';
        if (a) { a.classList.toggle('disabled', !u); a.href = u || '#'; }
      }
      save(); return;
    }
    const inp = t.closest('[data-b]'); if (!inp) return;
    const path = inp.dataset.b; let v = inp.value;
    if (inp.dataset.t === 'upper') { v = v.toUpperCase(); setKeepCaret(inp, v); }
    setPath(cp, path, v);
    if (path === 'planta') { const w = body.querySelector('[data-plant]'); if (w) w.innerHTML = plantInfo(); }
    save();
  }
  body.addEventListener('input', onInput);
  body.addEventListener('change', onInput);

  on(body, 'click', '[data-pick]', async (e, b) => {
    const [, k, f] = b.dataset.pick.split('.'); const u = cp.units[+k];
    if (f === 'eco') {
      /* Catálogo único PERCONSUR — Unidades: se guarda la relación (unitId) y se completan las placas */
      const r = await pickUnit({ title: `Unidad ${+k + 1}`, currentId: u.unitId || '' });
      if (!r) return;
      const v = r.unit;
      u.eco = r.eco; u.unitId = v ? v.id : null;
      if (v && v.placas) { u.pu = v.placas; const pi = body.querySelector(`[data-b="units.${k}.pu"]`); if (pi) pi.value = u.pu; }
      setPickDisplay(body, b.dataset.pick, ecoLabel(u.eco), 'Elegir');
    } else if (f === 'op') {
      const r = await openPicker({ title: 'Operador', current: u.op, items: cat.list('operators', 'perconsur').map((x) => ({ value: x.name, label: x.name })), recents: recents('operador:perconsur'), canSave: true });
      if (!r) return;
      u.op = nameCase(r.value);
      if (r.save) { await cat.save('operators', { company: 'perconsur', name: u.op }); toast('Operador guardado en el catálogo'); }
      setPickDisplay(body, b.dataset.pick, u.op);
    } else if (f === 'pr') {
      const tipoKey = { Tolva: 'tolva', Jaula: 'jaula' }[u.tipo] || '';
      const r = await openPicker({ title: 'Placas del remolque', current: u.pr, autocap: 'characters', transform: (v) => v.toUpperCase(), items: cat.trailerItems('perconsur'), scope: cat.trailerScope('campo'),
        recents: recents('remolque:perconsur'), canSave: true, saveLabel: tipoKey ? `Guardar en catálogo como ${u.tipo.toLowerCase()}` : 'Guardar en catálogo (sin clasificar)' });
      if (!r) return;
      u.pr = r.value.toUpperCase();
      if (r.save) { await cat.save('trailers', { company: 'perconsur', placas: u.pr, desc: '', type: tipoKey }); toast(tipoKey ? `Remolque guardado como ${u.tipo.toLowerCase()}` : 'Remolque guardado; clasifícalo en Administración → Catálogos'); }
      /* El tipo guardado del remolque completa el tipo de transporte si aún no se eligió */
      const tr = cat.list('trailers', 'perconsur').find((x) => x.placas === u.pr);
      const tipo = tr && { tolva: 'Tolva', jaula: 'Jaula' }[tr.type];
      if (tipo && !u.tipo) {
        u.tipo = tipo;
        body.querySelectorAll(`[data-tipo][data-i="${k}"]`).forEach((x) => { const on1 = x.dataset.tipo === tipo; x.classList.toggle('on', on1); x.setAttribute('aria-pressed', on1); });
        toast(`Tipo de transporte: ${tipo} (según el catálogo)`, { type: 'info' });
      }
      setPickDisplay(body, b.dataset.pick, u.pr, undefined, trailerDesc(u.pr));
    }
    save();
  });
  on(body, 'click', '[data-tipo]', (e, b) => {
    const u = cp.units[+b.dataset.i]; u.tipo = b.dataset.tipo;
    b.parentElement.querySelectorAll('.seg-b').forEach((x) => { const on1 = x === b; x.classList.toggle('on', on1); x.setAttribute('aria-pressed', on1); });
    save();
  });
  on(body, 'click', '[data-sol]', (e, b) => {
    const u = cp.units[+b.dataset.i]; u.sol = b.dataset.sol;
    const inp = body.querySelector(`[data-b="units.${b.dataset.i}.sol"]`); if (inp) inp.value = u.sol;
    b.parentElement.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === b)); save();
  });
  on(body, 'click', '[data-act]', async (e, b) => {
    if (b.dataset.act === 'addUnit') {
      if (cp.units.length >= CP_MAX) return;
      const last = cp.units[cp.units.length - 1];
      cp.units.push({ ...cpUnit(), sol: last ? last.sol : '' }); save(); draw();
      const cards = body.querySelectorAll('.card.unit'); const c = cards[cards.length - 1];
      if (c) { c.scrollIntoView({ block: 'center', behavior: 'smooth' }); c.classList.add('flash'); }
      toast(`Unidad ${cp.units.length} añadida`);
    }
    if (b.dataset.act === 'rmUnit') {
      const k = +b.dataset.i, u = cp.units[k];
      if (!(await confirmDestructive(`¿Quitar la unidad ${k + 1}?`, [ecoLabel(u.eco), u.op].filter(Boolean).join(' | ') || 'Unidad sin datos', 'Quitar unidad'))) return;
      cp.units.splice(k, 1); save(); draw(); toast('Unidad quitada', { type: 'info' });
    }
  });
  on(body, 'click', '[data-open]', (e, a) => { if (a.classList.contains('disabled')) e.preventDefault(); });
  on(body, 'click', '[data-issue]', (e, b) => { const w = campoIssues(cp)[+b.dataset.issue]; if (w) toStep(w.step, w.field); });

  shell.onNext(async () => {
    await drafts.flush();
    if (i < N - 1) { toStep(i + 1); return; }
    const issues = campoIssues(cp);
    const actions = issues.length ? [{ label: `Completar: ${issues[0].msg}`, value: 'fix', style: 'primary' }, { label: 'Generar con datos pendientes', value: 'gen' }] : [{ label: 'Generar PDF', value: 'gen', style: 'primary' }];
    const v = await actionSheet({ title: issues.length ? `Faltan ${issues.length} dato${issues.length > 1 ? 's' : ''}` : '¿Generar documento?', message: generationSummary(draft), actions });
    if (v === 'fix') toStep(issues[0].step, issues[0].field);
    if (v === 'gen') await generate(draft);
  });
  /* Documento preparado desde una Orden de Servicio: salir regresa al expediente */
  const exitTo = () => (cp.serviceOrderId ? `/operacion/ordenes/${encodeURIComponent(cp.serviceOrderId)}?s=docs` : '/');
  shell.onBack(async () => { await drafts.flush(); if (i === 0) go(exitTo(), { replace: true }); else toStep(i - 1); });
  shell.onClose(async () => { await drafts.flush(); toast('Borrador guardado'); go(exitTo(), { replace: true }); });
  shell.onJump(async (n) => { await drafts.flush(); toStep(n); });

  draw();
  return { el: shell.el, cleanup: async () => { dv && dv.destroy(); await drafts.flush(); } };
}
