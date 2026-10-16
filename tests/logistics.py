"""Logística: asignaciones con IDs de catálogo, estados, avisos de doble asignación, Inicio en vivo, historial y respaldo. PCS_TEST_USER/PCS_TEST_PASS"""
import subprocess, time, sys, os, json
from playwright.sync_api import sync_playwright
APP=os.path.abspath(os.path.join(os.path.dirname(__file__),'..')); SH='shots'; os.makedirs(SH,exist_ok=True)
U=os.environ['PCS_TEST_USER']; P=os.environ['PCS_TEST_PASS']; BASE='http://127.0.0.1:8775/index.html'
srv=subprocess.Popen([sys.executable,'-m','http.server','8775','--bind','127.0.0.1'],cwd=APP,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(1)
errs=[]; log=[]
def ok(c,m): log.append(('OK  ' if c else 'FAIL')+' '+m)
def shot(pg,n): pg.screenshot(path=f'{SH}/lg_{n}.png')
def pickfirst(pg, k, text=None, idx=0):
    pg.locator(f'[data-pk="{k}"]').click(); pg.wait_for_selector('.picker-sheet'); pg.wait_for_timeout(250)
    loc=pg.locator('.picker .pk-row',has_text=text) if text else pg.locator('.picker .pk-row')
    if text and not loc.count() and pg.locator('.picker [data-all]').count(): pg.locator('.picker [data-all]').click(); pg.wait_for_timeout(200)
    loc.nth(idx).click(); pg.wait_for_timeout(300)
def submit(pg): pg.locator('.lg-form button[type=submit]').click(); pg.wait_for_timeout(500)
try:
  with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,is_mobile=True,has_touch=True,service_workers='block')
    ctx.route(lambda u:'cdnjs' in u or 'fonts.g' in u, lambda r:r.abort())
    pg=ctx.new_page(); pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m: errs.append('console: '+m.text) if m.type=='error' else None)
    pg.goto(BASE); pg.wait_for_selector('.login'); pg.fill('#lg-user',U); pg.fill('#lg-pass',P); pg.click('#lg-go'); pg.wait_for_selector('.login',state='detached'); pg.wait_for_timeout(900)
    if pg.locator('.asheet').count(): pg.get_by_role('button',name='Ahora no').click()
    # Tipos de remolque y un viaje de operador con referencia
    info=pg.evaluate("""async()=>{const c=await import('./src/services/catalogs.js'); const ts=c.listAll('trailers'); const types=['chasis','chasis','jaula','tolva'];
      for(let i=0;i<4;i++) await c.save('trailers',{...ts[i],type:types[i]});
      const o=await import('./src/services/operators.js'); const op=o.operatorList()[2];
      await o.saveTrip({operatorId:op.id,division:'puerto',date:'2026-10-07',reference:'TGHU7654321',origin:'Manzanillo',destination:'León',fare:1500000,travelExpenses:0,commissionRate:15});
      return {ts:ts.slice(0,4).map(t=>t.placas), op:op.name}}""")
    T=info['ts']
    pg.goto(BASE+'#/operacion/logistica'); pg.wait_for_timeout(600); shot(pg,'20_tablero_vacio')
    # A: unidad 1, operador 1, chasis T0
    pg.locator('[data-new]').click(); pg.wait_for_selector('.lg-form')
    pickfirst(pg,'unit',idx=0); pickfirst(pg,'operator',idx=0); pickfirst(pg,'trailer',T[0])
    pg.fill('.lg-form [name=origin]','Manzanillo'); pg.fill('.lg-form [name=destination]','Guadalajara'); pg.fill('.lg-form [name=deliveryPlace]','CEDIS Guadalajara'); pg.fill('.lg-form [name=reference]','MSCU1234567')
    ok(pg.locator('.lg-form [name=containerType] option').count()==15 and pg.input_value('.lg-form [name=containerType]')=='','campo opcional «Tipo de contenedor» con los tipos ISO (vacío = sin indicar)')
    pg.select_option('.lg-form [name=containerType]','45G1'); submit(pg)
    ok(pg.evaluate("async()=>{const l=await import('./src/services/logistics.js'); return l.all().find(o=>o.reference==='MSCU1234567').containerType}")=='45G1','tipo de contenedor guardado en la operación')
    # B: unidad 2, mismo operador, mismo remolque → advertencias
    pg.locator('[data-new]').click(); pg.wait_for_selector('.lg-form')
    pickfirst(pg,'unit',idx=1); pickfirst(pg,'operator',idx=0)
    ok('otra operación activa' in pg.locator('[data-warn="operator"]').inner_text(),'aviso inmediato: operador en otra operación')
    pickfirst(pg,'trailer',T[0])
    ok('asignado a otra unidad' in pg.locator('[data-warn="trailer"]').inner_text(),'aviso inmediato: remolque en uso')
    pg.locator('[data-sv="empty_transit"]').click()
    # lugar de entrega sugerido
    pg.locator('.lg-form [name=deliveryPlace]').focus(); pg.wait_for_timeout(200)
    ok(pg.locator('[data-sugg="deliveryPlace"] [data-pick-sugg="CEDIS Guadalajara"]').count()==1,'Lugar de entrega sugiere valores usados')
    shot(pg,'21_form_avisos')
    submit(pg)
    ok(pg.locator('.asheet',has_text='Este operador ya aparece en otra operación activa.').count()==1,'confirmación de operador'); pg.get_by_role('button',name='Continuar de todos modos').click(); pg.wait_for_timeout(400)
    ok(pg.locator('.asheet',has_text='Este remolque ya se encuentra asignado a otra unidad.').count()==1,'confirmación de remolque'); shot(pg,'22_remolque_en_uso'); pg.get_by_role('button',name='Elegir otro').click(); pg.wait_for_timeout(400)
    ok(pg.locator('.lg-form').count()==1,'Elegir otro no guarda')
    pickfirst(pg,'trailer',T[2]); ok('Jaula' in pg.locator('[data-typebox]').inner_text(),'tipo Jaula desde el catálogo')
    ok(pg.locator('[data-dv="campo"].on').count()==1,'división sigue al tipo mientras no se toque')
    pg.locator('[data-dv="puerto"]').click(); pg.wait_for_timeout(100)
    ok('normalmente se usa en División Campo' in pg.locator('[data-divhint]').inner_text(),'aviso suave división/tipo (no bloquea)')
    submit(pg); pg.get_by_role('button',name='Continuar de todos modos').click(); pg.wait_for_timeout(600)
    ok(pg.locator('.lg-form').count()==0,'operación B guardada con excepción de división')
    # C: unidad 3 relacionada a viaje → referencia automática
    pg.locator('[data-new]').click(); pg.wait_for_selector('.lg-form')
    pickfirst(pg,'unit',idx=2); pickfirst(pg,'operator',info['op']); pickfirst(pg,'trip',idx=0)
    ok(pg.input_value('.lg-form [name=reference]')=='TGHU7654321','referencia tomada del viaje relacionado')
    ok(pg.input_value('.lg-form [name=origin]')=='Manzanillo' and pg.input_value('.lg-form [name=destination]')=='León','ruta tomada del viaje')
    pickfirst(pg,'trailer',T[3]); ok(pg.locator('[data-dv="puerto"].on').count()==1,'división del viaje no la cambia el tipo de remolque')
    pg.locator('[data-dv="campo"]').click(); pg.locator('[data-sv="unloading"]').click(); submit(pg)
    ok(pg.locator('.lg-form').count()==0,'operación C guardada')
    shot(pg,'23_tablero')
    # filtros y buscador
    def visible(): return pg.locator('.lg-card').count()
    pg.fill('.lg-page .search-in','mscu'); pg.wait_for_timeout(200); ok(visible()==1,'buscar por referencia')
    pg.fill('.lg-page .search-in','cedis'); pg.wait_for_timeout(200); ok(visible()==1,'buscar por lugar de entrega')
    pg.fill('.lg-page .search-in','león'); pg.wait_for_timeout(200); ok(visible()==1,'buscar por destino (acentos)')
    pg.fill('.lg-page .search-in',T[2].lower()); pg.wait_for_timeout(200); ok(visible()==1,'buscar por placas del remolque')
    pg.fill('.lg-page .search-in',''); pg.wait_for_timeout(200)
    pg.locator('[data-st="unloading"]').click(); pg.wait_for_timeout(200); ok(visible()==1,'filtro Descargando')
    # En celular la división y el tipo de remolque están en la hoja «Filtros» (primer chip de la fila de estados)
    ok(pg.locator('.lg-page>.lg-f2').is_hidden() and pg.locator('[data-moref]').is_visible(),'celular: una fila de estados y el botón «Filtros»')
    pg.locator('[data-st="all"]').click(); pg.locator('[data-moref]').click(); pg.wait_for_timeout(300)
    pg.locator('[data-fdiv="campo"]').click(); pg.wait_for_timeout(200); ok(visible()==1,'filtro División Campo')
    pg.locator('[data-fdiv="all"]').click(); pg.locator('[data-ftt="tolva"]').click(); pg.wait_for_timeout(200); ok(visible()==1,'filtro Tolva')
    pg.locator('[data-fdone]').click(); pg.wait_for_timeout(300)
    ok('Filtros · 1' in pg.locator('[data-moref]').inner_text(),'el botón indica cuántos filtros están activos')
    pg.locator('[data-moref]').click(); pg.wait_for_timeout(300); pg.locator('[data-freset]').click(); pg.locator('[data-fdone]').click(); pg.wait_for_timeout(300)
    # Inicio
    pg.goto(BASE+'#/'); pg.wait_for_timeout(700)
    ok(pg.locator('.lgh-card').count()==3,'Inicio: 3 unidades activas'); ok('3 unidades activas' in pg.locator('.lg-live').inner_text(),'contador de unidades activas')
    pg.locator('[data-lghome]').scroll_into_view_if_needed(); pg.evaluate('window.scrollBy(0,200)'); shot(pg,'24_inicio_3')
    # cambio en vivo desde Inicio (sin navegar): servicio + evento
    pg.evaluate("""async()=>{const l=await import('./src/services/logistics.js'); const e=l.fleetBoard().find(x=>x.op&&x.op.status==='unloading'); await l.setStatus(e.op.id,'empty');}"""); pg.wait_for_timeout(300)
    ok(pg.locator('.lgh-card').count()==2 and '2 unidades activas' in pg.locator('.lg-live').inner_text(),'Inicio se actualiza al momento (sin recargar)')
    # Solo marcar inactiva
    pg.locator('.lgh-card').first.click(); pg.wait_for_timeout(500); pg.locator('[data-status]').click(); pg.wait_for_selector('.lg-stlist'); pg.locator('[data-set="inactive"]').click(); pg.wait_for_timeout(300)
    shot(pg,'25_inactiva'); pg.get_by_role('button',name='Solo marcar Inactiva').click(); pg.wait_for_timeout(500)
    ok('Inactiva' in pg.locator('.lg-hero').inner_text() and pg.locator('[data-finish]').count()==1,'Solo marcar Inactiva conserva la operación abierta')
    # persistencia
    pg.reload(); pg.wait_for_timeout(1200)
    ok('Inactiva' in pg.locator('.lg-hero').inner_text(),'persiste tras recargar')
    pg.goto(BASE+'#/'); pg.wait_for_timeout(600); ok(pg.locator('.lgh-card').count()==1,'Inicio tras recargar: 1 activa')
    # protección de catálogo
    pg.goto(BASE+'#/catalogos/trailers'); pg.wait_for_timeout(500); shot(pg,'26_cat_remolques')
    pg.locator('[data-id]',has_text=T[0]).first.click(); pg.wait_for_selector('.cat-form'); pg.locator('[data-del]').click(); pg.wait_for_timeout(400)
    ok('operación activa de Logística' in pg.locator('.toast-host').inner_text(),'no elimina remolque en operación activa'); pg.keyboard.press('Escape')
    # historial
    pg.evaluate("""async()=>{const l=await import('./src/services/logistics.js'); const e=l.fleetBoard().find(x=>x.op&&x.op.status==='empty'); await l.closeOperation(e.op.id);}""")
    pg.goto(BASE+'#/operacion/logistica/historial'); pg.wait_for_timeout(500); ok(pg.locator('.lg-hrow').count()==1,'historial general'); shot(pg,'27_historial')
    pg.locator('.lg-hrow').first.click(); pg.wait_for_timeout(400); shot(pg,'28_hist_detalle'); pg.keyboard.press('Escape')
    # importación desde "otro dispositivo"
    res=pg.evaluate("""async()=>{const m=await import('./src/services/backup.js'); const f=await m.exportBackup(); const o=JSON.parse(await f.text());
      const vm={},om={},tm={};
      o.data.vehicles.forEach(v=>{vm[v.id]='X'+v.id; v.id=vm[v.id];}); o.data.operators.forEach(v=>{om[v.id]='X'+v.id; v.id=om[v.id];}); o.data.trailers.forEach(v=>{tm[v.id]='X'+v.id; v.id=tm[v.id];});
      o.data.logisticsOperations.forEach(r=>{r.id='X'+r.id; r.vehicleId=vm[r.vehicleId]; r.operatorId=om[r.operatorId]||r.operatorId; r.trailerId=tm[r.trailerId]||r.trailerId; r.updatedAt+=1;});
      o.data.fuelRecords=[]; o.data.operatorTrips=[];
      const file=new File([JSON.stringify(o)],'r.json',{type:'application/json'}); const info=await m.inspectBackup(file); await m.importBackup(info);
      const c=await import('./src/services/catalogs.js'); const l=await import('./src/services/logistics.js');
      const ids=new Set(c.listAll('vehicles').map(v=>v.id)), tids=new Set(c.listAll('trailers').map(v=>v.id)), oids=new Set(c.listAll('operators').map(v=>v.id));
      const all=l.all();
      return {lines:info.lines.filter(x=>x.startsWith('Logística')), veh:c.listAll('vehicles').length, n:all.length, okv:all.every(r=>ids.has(r.vehicleId)), okt:all.every(r=>!r.trailerId||tids.has(r.trailerId)), oko:all.every(r=>!r.operatorId||oids.has(r.operatorId))}}""")
    ok(res['okv'] and res['okt'] and res['oko'],f'importación reasigna unidad/operador/remolque existentes: {res}')
    pg.goto(BASE+'#/operacion'); pg.wait_for_timeout(500); shot(pg,'29_operacion_meta')
    ok('en operación' in pg.locator('.mod-card',has_text='Logística').inner_text(),'meta de Logística en Operación')
    b.close()
finally:
  srv.terminate()
print('\n'.join(log)); print('ERRORES:',errs)
