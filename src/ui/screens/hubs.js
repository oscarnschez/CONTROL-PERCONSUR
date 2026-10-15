/* Secciones principales: Administración y Operación (tarjetas de módulos). */
import { screen } from '../../core/dom.js';
import { ADMIN_MODULES, OPERATION_MODULES } from '../../config/modules.js';
import { listDocuments } from '../../services/documents.js';
import { operatorList } from '../../services/operators.js';
import * as fuel from '../../services/fuel.js';
import * as billing from '../../services/billing.js';
import { summarize } from '../../domain/billing/billing.js';
import * as tariffs from '../../services/tariffs.js';
import { listAll } from '../../services/catalogs.js';
import { money } from '../../domain/operators/money.js';
import { fleetSummary, fuelRange } from '../../domain/fuel/fuel.js';
import { esc } from '../../domain/shared/format.js';
import { fleetBoard } from '../../services/logistics.js';
import { openList as openEmpties } from '../../services/empties.js';
import * as fulls from '../../services/fulls.js';
import { summary as fullsSummary } from '../../domain/fulls/fulls.js';
import { countByStatus, homeEntries } from '../../domain/logistics/logistics.js';
import { icon } from '../components/icons.js';
import * as mt from '../../services/maintenance.js';
import * as un from '../../services/units.js';
import { fleetSummary as unitsSummary } from '../../domain/units/units.js';

const card = (m, meta) => `<a class="mod-card" href="#${m.route}"><span class="mod-ic">${icon[m.icon]}</span><span class="mod-tx"><b>${esc(m.title)}</b><small>${esc(m.desc)}</small>${meta ? `<span class="mod-meta">${meta}</span>` : ''}</span><span class="chev">${icon.chev}</span></a>`;

export async function adminScreen() {
  const docs = await listDocuments(), ops = operatorList();
  await un.loadUnits();
  const us = unitsSummary(un.rows());
  await billing.loadBilling();
  await tariffs.loadTariffs();
  const cob = summarize(billing.items()), nDue = cob.trips.due.n + cob.delays.due.n, tfs = tariffs.sheets(), tfRoutes = tfs.reduce((a, x) => a + x.routes.length, 0);
  const meta = { operadores: `${ops.length} operador${ops.length === 1 ? '' : 'es'}`, cobranza: nDue ? `Por cobrar: ${money(cob.due)} | ${nDue} pendiente${nDue === 1 ? '' : 's'}` : 'Sin pendientes por cobrar', documentos: `${docs.length} documento${docs.length === 1 ? '' : 's'}`,
    catalogos: `${ops.length} operadores | ${listAll('trailers').length} remolques | destinos y terminales`,
    unidades: us.total ? [`${us.total} unidad${us.total === 1 ? '' : 'es'}`, `${us.complete} con documentación completa`, us.expiredDocs ? `Vencidos: ${us.expiredDocs}` : '', us.soonDocs ? `${us.soonDocs} por vencer` : ''].filter(Boolean).join(' | ') : 'Sin unidades registradas', tarifas: tfs.length ? `${tfs.length} apartado${tfs.length === 1 ? '' : 's'} | ${tfRoutes} ruta${tfRoutes === 1 ? '' : 's'}` : 'Sin apartados' };
  return screen(`<div class="page wide hub"><header class="page-top"><h1 class="title">Administración</h1></header>
    <div class="mod-list">${ADMIN_MODULES.map((m) => card(m, meta[m.key])).join('')}</div></div>`);
}

export async function operationScreen() {
  await fuel.loadFuel();
  await mt.loadMaintenance();
  const md = mt.dashboard();
  const fl = fleetSummary(fuel.unitsAnalyzed(), fuelRange('mes'));
  const fb = fleetBoard(), lc = countByStatus(fb), working = homeEntries(fb).length;
  const nv = openEmpties().length;
  await fulls.loadFulls();
  const fs = fullsSummary(fulls.all(), fulls.docsOf);
  const meta = { logistica: (lc.all ? `${working} en operación | ${lc.empty || 0} vacía${lc.empty === 1 ? '' : 's'} | ${lc.inactive || 0} inactiva${lc.inactive === 1 ? '' : 's'}` : 'Sin unidades en el catálogo') + (nv ? ` | Vacíos pendientes: ${nv}` : '') + (fs.today ? ` | Llenos hoy: ${fs.today}` : ''), taller: md.open.length || md.openIssues.length || md.oilAlerts.length ? [`En taller: ${md.inShopVehicles.length + md.inShopTrailers.length}`, `Pendientes: ${md.open.length}`, md.openIssues.length ? `Fallas: ${md.openIssues.length}` : '', md.oilAlerts.length ? `Aceite: ${md.oilAlerts.length} alerta${md.oilAlerts.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' | ') : 'Sin equipos en el taller', combustible: fl.count ? `Este mes: ${fl.count} recargas | ${Math.round(fl.liters).toLocaleString('en-US')} L | ${money(fl.amount)}${fl.perf ? ` | ${fl.perf.kmL.toFixed(2)} km/L` : ''}` : 'Sin recargas este mes' };
  return screen(`<div class="page wide hub"><header class="page-top"><h1 class="title">Operación</h1></header>
    <p class="page-lead">Seguimiento operativo de las unidades.</p>
    <div class="mod-list">${OPERATION_MODULES.map((m) => card(m, meta[m.key])).join('')}</div></div>`);
}
