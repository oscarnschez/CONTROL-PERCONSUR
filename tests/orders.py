"""Órdenes de Servicio (Operación → Órdenes de Servicio): expediente maestro del viaje conectado con Control de llenos,
Logística, Unidades en operación, Control de vacíos, Operadores (viaje financiero) y la nota de entrega / asignación.
Crea una orden de Puerto por etapas (folio OS-AAAA-000001), programa su carga en Control de llenos (una sola fuente de
datos y documentos), asigna transporte con historial, adjunta y verifica documentos, genera la nota de entrega llena con los
datos de la orden (versión con instantánea), despacha (validaciones, advertencias autorizadas, «Asignada» en Inicio, viaje
financiero una sola vez, idempotente), da seguimiento, registra la entrega con evidencia, marca el vacío (sin duplicar el
control), confirma la devolución y cierra (cierre operativo ≠ cierre administrativo). También: Campo (impuestos por
omisión, sin documentación portuaria ni paso de vacío), folios que no se reutilizan, cancelación, bloqueos del despacho,
filtros y buscador, folio en Logística / llenos / vacíos, registros existentes sin orden (migración segura), respaldo y
sin errores en consola. PCS_TEST_USER/PCS_TEST_PASS"""
import subprocess, time, sys, os, re, datetime, tempfile, shutil, json
from playwright.sync_api import sync_playwright
HERE=os.path.dirname(os.path.abspath(__file__)); APP=os.path.abspath(os.path.join(HERE,'..')); SH='shots'; os.makedirs(SH,exist_ok=True)
U=os.environ['PCS_TEST_USER']; P=os.environ['PCS_TEST_PASS']; BASE='http://127.0.0.1:8787/index.html'
FD=tempfile.mkdtemp()
for n in ['Pedimento','DODA','Cita','DEC']: shutil.copy(os.path.join(HERE,'anexo.pdf'),os.path.join(FD,n+'.pdf'))
shutil.copy(os.path.join(HERE,'foto.jpg'),os.path.join(FD,'Entrega.jpg')); shutil.copy(os.path.join(HERE,'foto.jpg'),os.path.join(FD,'Patio.jpg'))
srv=subprocess.Popen([sys.executable,'-m','http.server','8787','--bind','127.0.0.1'],cwd=APP,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(1)
errs=[]; log=[]
def ok(c,m): log.append(('OK  ' if c else 'FAIL')+' '+m)
def shot(pg,n): pg.screenshot(path=f'{SH}/so_{n}.png')
def toast(pg): return pg.locator('.toast-host').inner_text() if pg.locator('.toast-host').count() else ''
def login(pg):
    pg.goto(BASE); pg.wait_for_selector('.login'); pg.fill('#lg-user',U); pg.fill('#lg-pass',P); pg.click('#lg-go'); pg.wait_for_selector('.login',state='detached'); pg.wait_for_timeout(900)
    if pg.locator('.asheet').count(): pg.get_by_role('button',name='Ahora no').click()
def nxt(pg,wait='.wiz'): pg.locator('[data-w="next"]').click(); pg.wait_for_timeout(900)
def pick(pg,sel,text=None):
    pg.locator(sel).click(); pg.wait_for_selector('.picker'); pg.wait_for_timeout(250)
    (pg.locator('.picker .pk-row',has_text=text).first if text else pg.locator('.picker .pk-row:not(.pk-use)').first).click(); pg.wait_for_timeout(500)
def asb(pg,text): pg.wait_for_selector('.asheet'); pg.wait_for_timeout(200); pg.locator('.asheet button',has_text=text).first.click(); pg.wait_for_timeout(700)
def ev(pg,js,arg=None): return pg.evaluate(js,arg) if arg is not None else pg.evaluate(js)
def detail(pg,oid,tab=''): pg.goto(BASE+'#/operacion/ordenes/'+oid+(('?s='+tab) if tab else '')); pg.wait_for_selector('.so-detail .so-hero'); pg.wait_for_timeout(600)
def hero(pg): return pg.locator('.so-hero').inner_text()
def panel(pg): return pg.locator('[data-panel]').inner_text()
def tab(pg,name): pg.locator('.so-tab',has_text=name).click(); pg.wait_for_timeout(600)
today=datetime.date.today(); T=today.isoformat(); T1=(today+datetime.timedelta(days=1)).isoformat(); Y=today.year
try:
  with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,is_mobile=True,has_touch=True,service_workers='block',accept_downloads=True)
    ctx.route(lambda u:'cdnjs' in u or 'fonts.g' in u, lambda r:r.abort())
    pg=ctx.new_page(); pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m: errs.append('console: '+m.text) if m.type=='error' else None)
    login(pg)
    cat=ev(pg,"""async()=>{const c=await import('./src/services/catalogs.js'); const o=await import('./src/services/operators.js'); const f=await import('./src/services/fuel.js');
      const ts=c.listAll('trailers'); await c.save('trailers',{...ts[0],type:'chasis'}); await c.save('trailers',{...ts[1],type:'tolva'});
      const cust=await c.save('places',{name:'COMERCIALIZADORA DEL PACIFICO SA DE CV',rfc:'CPA010101AB1',address:'Av. Vallarta 100, Zapopan, Jal.',contact:'Ana Ruiz'});
      const ops=o.operatorList(), vs=f.vehicles();
      return {op1:ops[0].id, op1n:ops[0].name, op2:ops[1].id, op2n:ops[1].name, v1:vs[0].id, v1l:vs[0].label, v2:vs[1].id, v2l:vs[1].label, v3:vs[2].id, t1:ts[0].id, t1p:ts[0].placas, t2:ts[1].id, t2p:ts[1].placas, cust:cust.id, yard:c.activeYards()[0].id, yardn:c.activeYards()[0].name}}""")

    # ===== Navegación y pantalla principal =====
    pg.goto(BASE+'#/operacion'); pg.wait_for_selector('.mod-card'); pg.wait_for_timeout(300)
    ok(pg.locator('.mod-card').first.inner_text().startswith('Órdenes de Servicio') and 'Sin órdenes de servicio' in pg.locator('.mod-card').first.inner_text(),'Operación → Órdenes de Servicio es el primer módulo (con resumen)')
    pg.locator('.mod-card').first.click(); pg.wait_for_selector('.so-page'); pg.wait_for_timeout(300); shot(pg,'01_vacio')
    ok(pg.locator('h1.title').inner_text().upper()=='ÓRDENES DE SERVICIO' and 'Administración integral de operaciones de transporte.' in pg.locator('.page-lead').inner_text(),'título «ÓRDENES DE SERVICIO» y subtítulo')
    tiles=[x.split('\n')[0] for x in pg.locator('.so-tile').all_inner_texts()]
    ok(tiles==['Pendientes','Listas para despacho','En operación','Entregas realizadas','Pendientes de devolución','Finalizadas','Con incidencias'],'indicadores: pendientes, listas, en operación, entregas, devolución pendiente, finalizadas e incidencias')
    ok(pg.locator('.so-new',has_text='Nueva orden').count()==1 and pg.locator('.empty',has_text='Aún no hay órdenes').count()==1,'botón «+ Nueva orden» y estado vacío')

    # ===== Creación por etapas (Puerto · recolección de lleno) =====
    pg.locator('.so-new').click(); pg.wait_for_selector('.wiz'); pg.wait_for_timeout(400)
    ok('Paso 1 de 6' in pg.locator('.wiz-title').inner_text() and 'Información general' in pg.locator('.wiz-title').inner_text(),'formulario por etapas: 1 Información general (de 6)')
    ok(pg.locator('.so-type.on').inner_text().startswith('Recolección de contenedor lleno') and pg.locator('[data-seg="division"].on').inner_text()=='División Puerto','Puerto por omisión, tipo «Recolección de contenedor lleno»')
    pick(pg,'[data-pick="customerId"]','COMERCIALIZADORA')
    pg.fill('[data-b="contactName"]','Ana Ruiz'); pg.fill('[data-b="contactPhone"]','33 1234 5678'); pg.fill('[data-b="instructions"]','Llamar antes de llegar'); shot(pg,'02_general')
    nxt(pg)
    o1=ev(pg,"async()=>{const s=await import('./src/services/orders.js'); return s.all()[0]}")
    ok(o1 and o1['folio']==f'OS-{Y}-000001' and o1['phase']=='draft' and '/editar/2' in pg.url,f'al continuar se guarda como borrador con folio OS-{Y}-000001 ({o1 and o1["folio"]})')
    oid=o1['id']
    ok('Datos del transporte' in pg.locator('.wiz-title').inner_text() and pg.locator('[data-b="containerNumber"]').count()==1 and pg.locator('[data-pick="terminalId"]').count()==1,'2 Datos del transporte: contenedor, peso, terminal o patio y cita (Puerto)')
    pg.fill('[data-b="origin"]','Manzanillo'); pg.fill('[data-b="destination"]','Zapopan'); pg.fill('[data-b="deliveryPlace"]','CEDIS Zapopan')
    pg.fill('[data-b="containerNumber"]','MSCU12'); pg.fill('[data-b="weightKg"]','28500'); nxt(pg)
    ok('/editar/2' in pg.url and '4 letras y 7 dígitos' in pg.locator('[data-f="containerNumber"] .ferr').inner_text(),'validación: contenedor incompleto no avanza')
    pg.fill('[data-b="containerNumber"]','mscu 123 4567')
    ok(pg.locator('[data-b="containerNumber"]').input_value()=='MSCU1234567','contenedor en mayúsculas y sin espacios')
    pick(pg,'[data-pick="terminalId"]','Contecon'); pg.fill('[data-b="scheduledDate"]',T1); pg.fill('[data-b="scheduledTime"]','09:30'); pg.fill('[data-b="pedimento"]','26 16 3456 6001234'); shot(pg,'03_transporte')
    nxt(pg)
    s1=ev(pg,"async(id)=>{const s=await import('./src/services/orders.js'), f=await import('./src/services/fulls.js'); const o=s.byId(id), l=f.byId(o.fullLoadId); return {loads:f.all().length, load:l&&{c:l.containerNumber,w:l.weightKg,d:l.scheduledDate,t:l.scheduledTime,notes:l.notes}, docs:l?f.docsOf(l.id).map(d=>d.docType):[]}}",oid)
    ok(s1['loads']==1 and s1['load']['c']=='MSCU1234567' and s1['load']['w']==28500 and s1['load']['d']==T1 and s1['load']['t']=='09:30','Control de llenos: la carga se programa sola con los datos de la orden (contenedor, peso, terminal, cita)')
    ok(s1['docs']==['pedimento','doda','cita','dec'],'la carga dentro de puerto pide Pedimento, DODA, Cita y DEC')
    # La cita se cambia en la orden y se ve en Control de llenos (una sola fuente)
    pg.locator('[data-w="back"]').click(); pg.wait_for_timeout(900); pg.fill('[data-b="scheduledTime"]','10:15'); nxt(pg)
    t2=ev(pg,"async(id)=>{const s=await import('./src/services/orders.js'), f=await import('./src/services/fulls.js'); return f.byId(s.byId(id).fullLoadId).scheduledTime}",oid)
    ok(t2=='10:15','cambiar la cita en la orden reprograma la carga en Control de llenos')
    ev(pg,"async(id)=>{const s=await import('./src/services/orders.js'), f=await import('./src/services/fulls.js'); const l=f.byId(s.byId(id).fullLoadId); await f.reschedule(l.id,{date:l.scheduledDate,time:'10:45',reason:'Cambio de la naviera'})}",oid)
    ok(ev(pg,"async(id)=>(await import('./src/services/orders.js')).resolved((await import('./src/services/orders.js')).byId(id)).scheduledTime",oid)=='10:45','y al revés: reprogramar en Control de llenos se ve en la orden')
    # 3 Asignación
    ok('Asignación de recursos' in pg.locator('.wiz-title').inner_text() and pg.locator('[data-pick="vehicleId"]',has_text='Pendiente de asignar').count()==1,'3 Asignación: «Pendiente de asignar» permitido')
    pick(pg,'[data-pick="vehicleId"]',cat['v1l']); pick(pg,'[data-pick="operatorId"]',cat['op1n']); pick(pg,'[data-pick="trailerId"]',cat['t1p'])
    ok(pg.locator('[data-f="vehicleId"] .lg-st').inner_text() in ('Disponible','Documentación pendiente','Documentos vencidos'),'la unidad elegida muestra su disponibilidad: '+pg.locator('[data-f="vehicleId"] .lg-st').inner_text())
    shot(pg,'04_asignacion'); nxt(pg)
    a1=ev(pg,"async(id)=>{const s=await import('./src/services/orders.js'), f=await import('./src/services/fulls.js'); const o=s.byId(id), l=f.byId(o.fullLoadId); return {as:o.assignments.length, lv:l.vehicleId, lo:l.operatorId}}",oid)
    ok(a1['as']==1 and a1['lv']==cat['v1'] and a1['lo']==cat['op1'],'asignación con historial y reflejada en la carga de Control de llenos')
    # 4 Documentación
    ok('Documentación' in pg.locator('.wiz-title').inner_text() and pg.locator('.fc-doc').count()==4 and 'Control de llenos' in pg.locator('.so-src').inner_text(),'4 Documentación: los cuatro documentos de la carga, compartidos con Control de llenos')
    for n,lab in [('Pedimento','Pedimento'),('DODA','DODA'),('Cita','Cita'),('DEC','DEC')]:
        pg.locator('.fc-doc',has_text=lab).first.locator('input[data-up]').first.set_input_files(os.path.join(FD,n+'.pdf')); pg.wait_for_timeout(1300)
    d1=ev(pg,"async(id)=>{const s=await import('./src/services/orders.js'), f=await import('./src/services/fulls.js'); const o=s.byId(id); return {fl:f.docsOf(o.fullLoadId).filter(d=>d.storageKey).length, own:s.filesOf(id).filter(d=>d.storageKey).length, st:s.stateOf(o).docs.key}}",oid)
    ok(d1['fl']==4 and d1['own']==0,'los documentos quedan en la carga de Control de llenos (no se suben dos veces)')
    ok(d1['st']=='to_verify' and 'Pendiente de verificar' in pg.locator('.fc-docst').inner_text(),'adjuntado no es lo mismo que verificado: «Pendiente de verificar»')
    pg.locator('.fc-doc',has_text='Pedimento').first.locator('[data-more]').click(); asb(pg,'Marcar como verificado')
    ok('Verificado' in pg.locator('.fc-doc',has_text='Pedimento').first.inner_text(),'verificar un documento')
    pg.locator('.fc-doc',has_text='DEC').first.locator('[data-more]').click()
    ok(pg.locator('.asheet button',has_text='Reemplazar archivo').count()==1 and pg.locator('.asheet button',has_text='Ver').count()>=1 and pg.locator('.asheet button',has_text='Descargar').count()==1 and pg.locator('.asheet button',has_text='Compartir').count()==1,'cada documento: ver, compartir, descargar, reemplazar, verificar, requerido y eliminar')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(400); shot(pg,'05_docs')
    nxt(pg)
    # 5 Información económica (Puerto: impuestos apagados)
    ok('Información económica' in pg.locator('.wiz-title').inner_text() and not pg.locator('[data-b="finance.applyVat"]').is_checked() and not pg.locator('[data-b="finance.applyIsr"]').is_checked() and not pg.locator('[data-b="finance.applyVatWithholding"]').is_checked(),'Puerto: IVA, ISR y retención de IVA apagados por omisión')
    pg.fill('[data-money="fare"]','15000'); pg.wait_for_timeout(300)
    fp=pg.locator('[data-finprev]').inner_text()
    ok('$15,000.00' in fp and '$2,250.00' in fp,'vista previa: total = tarifa base y comisión 15% de la base ($2,250.00)')
    pg.locator('[data-b="finance.applyVat"]').check(); pg.wait_for_timeout(300)
    ok('$17,400.00' in pg.locator('[data-finprev]').inner_text(),'con IVA 16%: total $17,400.00 (base + IVA)')
    pg.locator('[data-b="finance.applyVat"]').uncheck(); pg.wait_for_timeout(200); shot(pg,'06_economia'); nxt(pg)
    ok(ev(pg,"async(id)=>(await import('./src/services/orders.js')).byId(id).finance.fare",oid)==1500000,'tarifa guardada en centavos (sin crear viaje todavía)')
    # 6 Revisión
    ok('Revisión y despacho' in pg.locator('.wiz-title').inner_text() and 'OS-' in pg.locator('.wiz-body').inner_text() and 'Siguiente paso' in pg.locator('.wiz-body').inner_text(),'6 Revisión: resumen con folio, estado y siguiente paso'); shot(pg,'07_revision')
    nxt(pg); pg.wait_for_selector('.so-detail .so-hero'); pg.wait_for_timeout(600)
    ok(ev(pg,"async(id)=>(await import('./src/services/orders.js')).byId(id).phase",oid)=='scheduled' and f'OS-{Y}-000001' in hero(pg),'confirmar: la orden deja de ser borrador y abre su expediente'); shot(pg,'08_expediente')
    tabs=[x.strip() for x in pg.locator('.so-tab').all_inner_texts()]
    ok(tabs==['Resumen','Documentos','Asignación','Seguimiento','Entrega','Control de vacíos','Finanzas','Historial'],'pestañas del expediente: '+', '.join(tabs))
    prog=[x.split('\n')[-1] for x in pg.locator('.so-prog li').all_inner_texts()]
    ok(prog==['Captura','Documentación','Asignación','Despacho','Entrega','Vacío','Finalización'],'avance: Captura → Documentación → Asignación → Despacho → Entrega → Vacío → Finalización')
    ok('Lista para despacho' in hero(pg) and 'Confirmar asignación y despachar' in hero(pg),'estado real «Lista para despacho» y acción principal «Confirmar asignación y despachar»')
    st=panel(pg)
    ok('Control de llenos' in st and 'MSCU1234567' in st and 'Se crea al despachar' in st,'Resumen: registros vinculados (carga de Control de llenos; Logística al despachar)')
    pg.locator('.so-prog [data-step="docs"]').click(); pg.wait_for_timeout(600)
    ok(pg.locator('.so-tab.on').inner_text().strip()=='Documentos','tocar una etapa del avance abre su pestaña')

    # ===== Nota de entrega llena con los datos de la orden =====
    pg.locator('[data-panel] [data-act="doc"]').click(); pg.wait_for_url('**/puerto/perconsur/7'); pg.wait_for_timeout(1200)
    dd=ev(pg,"async()=>{const d=await import('./src/services/drafts.js'); const x=await d.getDraft('puerto:perconsur'); return x.data}")
    ok(dd['serviceOrderId']==oid and dd['operador']==cat['op1n'] and dd['placasR']==cat['t1p'] and dd['conts'][0]['num']=='MSCU1234567' and dd['conts'][0]['peso']=='28500' and dd['citaFecha']==T1 and dd['citaHora']=='10:45' and dd['terminal'].startswith('Contecon') and dd['destNombre'].startswith('COMERCIALIZADORA') and dd['destRFC']=='CPA010101AB1' and dd['conts'][0]['tarifa']=='15000.00' and dd['pedimento']=='26 16 3456 6001234','la plantilla existente se llena con cliente, RFC, operador, unidad, remolque, contenedor, peso, cita, terminal, pedimento y tarifa '+json.dumps({k:dd.get(k) for k in ['operador','placasR','citaFecha','citaHora','terminal','destNombre','destRFC','pedimento']}|{'c':dd['conts'][0]['num'],'p':dd['conts'][0]['peso'],'t':dd['conts'][0]['tarifa']},ensure_ascii=False))
    ok(pg.locator('.dv-host').count()==1,'se abre en la revisión con la vista previa del documento'); shot(pg,'09_nota_prellenada')
    pg.locator('[data-w="next"]').click(); pg.wait_for_selector('.asheet'); pg.wait_for_timeout(300)
    pg.locator('.asheet button',has_text='Generar').last.click(); pg.wait_for_url('**/listo/**',timeout=30000); pg.wait_for_timeout(1500)
    if pg.locator('.bsheet').count(): pg.keyboard.press('Escape'); pg.wait_for_timeout(500)
    ok(pg.locator('[data-a="order"]',has_text='Volver a la orden').count()==1,'documento generado: «Volver a la orden»')
    g=ev(pg,"async(id)=>{const s=await import('./src/services/orders.js'); const o=s.byId(id); return o.generated}",oid)
    ok(len(g)==1 and g[0]['version']==1 and g[0]['snapshot']['containerNumber']=='MSCU1234567' and g[0]['snapshot']['vehicleId']==cat['v1'],'la nota queda en la orden como versión 1 con instantánea de los datos')
    pg.locator('[data-a="order"]').click(); pg.wait_for_selector('.so-detail .so-hero'); pg.wait_for_timeout(700)
    ok(pg.locator('.so-tab.on').inner_text().strip()=='Documentos' and 'versión 1' in panel(pg) and 'vigente' in panel(pg),'Documentos: la nota emitida aparece como versión 1 vigente')

    # ===== Despacho =====
    # Otra operación ocupa la unidad 2 (para probar el bloqueo después)
    ev(pg,"async(c)=>{const l=await import('./src/services/logistics.js'); await l.saveOperation({vehicleId:c.v2,operatorId:c.op2,status:'to_destination',origin:'Colima',destination:'Tecomán',reference:'PRUEBA'})}",cat)
    pg.locator('[data-act="dispatch"]').first.click(); pg.wait_for_selector('.so-dispatch'); pg.wait_for_timeout(400); shot(pg,'10_despacho')
    dtext=pg.locator('.so-dispatch').inner_text()
    ok(pg.locator('.so-dispatch .issues:not(.warn)').count()==0 and pg.locator('.so-auth').count()>=1,'sin bloqueos; advertencias por autorizar: '+str(pg.locator('.so-auth').count()))
    ok('pendiente de verificar' in dtext.lower(),'advertencia: documentos pendientes de verificar (se puede autorizar)')
    ok([x.input_value() for x in pg.locator('.so-init input').all()]==['assigned','loading','to_destination'],'estado inicial: Asignada (pendiente de salida), En carga o En ruta')
    pg.locator('.so-dispatch button[type=submit]').click(); pg.wait_for_timeout(600)
    ok('Autoriza' in toast(pg) and ev(pg,"async(id)=>(await import('./src/services/orders.js')).byId(id).logisticsOperationId",oid) is None,'sin autorizar las advertencias no se despacha')
    for c in pg.locator('.so-auth input').all(): c.check()
    pg.locator('.so-dispatch button[type=submit]').click(); pg.wait_for_timeout(1800)
    dz=ev(pg,"""async(id)=>{const s=await import('./src/services/orders.js'), l=await import('./src/services/logistics.js'), o2=await import('./src/services/operators.js'), f=await import('./src/services/fulls.js');
      const o=s.byId(id), op=l.opById(o.logisticsOperationId), trips=o2.allTrips().filter(t=>t.serviceOrderId===id), ld=f.byId(o.fullLoadId);
      return {op:op&&{st:op.status,so:op.serviceOrderId,v:op.vehicleId,ref:op.reference,trip:op.tripId,doc:op.documentId}, trips:trips.length, trip:trips[0]&&{fare:trips[0].fare,com:trips[0].finalCommission,vat:trips[0].applyVat,id:trips[0].id,doc:trips[0].documentId}, tripId:o.tripId, lop:ld.logisticsOperationId, ltrip:ld.tripId, auth:o.dispatchAuth&&o.dispatchAuth.codes.length, gen:o.generated[0].documentId}}""",oid)
    ok(dz['op'] and dz['op']['st']=='assigned' and dz['op']['so']==oid and dz['op']['ref']=='MSCU1234567','despacho: operación de Logística «Asignada» (pendiente de salida) vinculada a la orden')
    ok(dz['trips']==1 and dz['trip']['fare']==1500000 and dz['trip']['com']==225000 and dz['trip']['vat']==False and dz['tripId']==dz['trip']['id'] and dz['op']['trip']==dz['trip']['id'],'viaje financiero creado una sola vez: tarifa, comisión 15% y sin IVA; relacionado con la operación')
    ok(dz['lop']==ev(pg,"async(id)=>(await import('./src/services/orders.js')).byId(id).logisticsOperationId",oid) and dz['ltrip']==dz['trip']['id'],'la carga de Control de llenos queda vinculada a la operación y al viaje')
    ok(dz['op']['doc']==dz['gen'] and dz['trip']['doc']==dz['gen'],'la nota vigente se relaciona con la operación y el viaje')
    ok(dz['auth']>=1 and 'Advertencias autorizadas' in ev(pg,"async(id)=>(await import('./src/services/orders.js')).eventsOf(id).find(e=>e.type==='dispatched').details",oid),'las advertencias autorizadas quedan en el historial')
    again=ev(pg,"""async(id)=>{const s=await import('./src/services/orders.js'), l=await import('./src/services/logistics.js'), o2=await import('./src/services/operators.js');
      const r=await s.dispatch(id,{initial:'assigned',authorized:['docs_verify','unit_no_gps','no_document','unit_docs_missing','unit_docs_expired']}); return {already:r.already, ops:l.all().filter(x=>x.serviceOrderId===id).length, trips:o2.allTrips().filter(t=>t.serviceOrderId===id).length}}""",oid)
    ok(again['already'] and again['ops']==1 and again['trips']==1,'despachar dos veces no duplica la operación ni el viaje (idempotente)')
    pg.wait_for_timeout(500)
    ok('Despachada' in hero(pg) and 'Confirmar salida' in hero(pg),'estado «Despachada»: siguiente paso «Confirmar salida de la unidad»'); shot(pg,'11_despachada')
    pg.goto(BASE+'#/'); pg.wait_for_selector('.lg-home .lgh-card, .lg-home .lg-none'); pg.wait_for_timeout(800)
    hc=pg.locator('.lgh-card',has_text=cat['v1l']).first.inner_text() if pg.locator('.lgh-card',has_text=cat['v1l']).count() else ''
    ok('Asignada' in hc and f'OS-{Y}-000001' in hc,'Inicio → Unidades en operación: la unidad aparece «Asignada» con el folio de la orden')
    hs=pg.locator('[data-sohome]').inner_text()
    ok('Órdenes de servicio' in hs and f'OS-{Y}-000001' in hs and 'Confirmar salida' in hs,'Inicio: resumen de órdenes con el siguiente paso'); shot(pg,'12_inicio')
    pg.goto(BASE+'#/operacion/logistica/u/'+cat['v1']); pg.wait_for_selector('.lg-detail .lg-hero'); pg.wait_for_timeout(500)
    ok(pg.locator('.so-folio-chip',has_text=f'OS-{Y}-000001').count()==1,'Logística: la unidad muestra el folio enlazado a la orden')
    ok(ev(pg,"async(id)=>{const t=await import('./src/domain/tracking/tracking.js'); const s=await import('./src/services/orders.js'); return t.shareBlock(s.opOf(s.byId(id)),'123')}",oid).startswith('La unidad todavía no sale'),'rastreo para el cliente: no se comparte mientras está «Asignada»')

    # ===== Seguimiento =====
    detail(pg,oid); pg.locator('.so-hero [data-act="advance"]').click(); asb(pg,'En ruta a destino')
    tr=ev(pg,"async(id)=>{const s=await import('./src/services/orders.js'); const o=s.byId(id); return {op:s.opOf(o).status, load:s.loadOf(o).status}}",oid)
    ok(tr['op']=='to_destination' and tr['load']=='loaded','confirmar salida: Logística «En ruta a destino» y la carga de Control de llenos «Cargada»')
    pg.wait_for_timeout(500)
    ok('En operación' in hero(pg),'estado global «En operación»')
    tab(pg,'Seguimiento')
    ok('Estado en Logística' in panel(pg) and 'En ruta a destino' in panel(pg) and 'Bitácora de estados' in panel(pg),'Seguimiento: estado de Logística y bitácora'); shot(pg,'13_seguimiento')
    pg.locator('[data-panel] [data-act="incident"]').click(); pg.wait_for_selector('.bsheet form'); pg.fill('.bsheet [name=t]','Retraso en la aduana'); pg.locator('.bsheet [name=crit]').check(); pg.locator('.bsheet button[type=submit]').click(); pg.wait_for_timeout(800)
    ok('Retraso en la aduana' in panel(pg) and ev(pg,"async(id)=>(await import('./src/services/orders.js')).stateOf((await import('./src/services/orders.js')).byId(id)).critical.length",oid)==1,'incidencia crítica registrada')

    # ===== Entrega =====
    tab(pg,'Entrega'); pg.locator('[data-panel] [data-act="deliver"]').first.click(); pg.wait_for_selector('.bsheet form'); pg.wait_for_timeout(300)
    ok(pg.locator('.bsheet [name=place]').input_value()=='CEDIS Zapopan','la entrega propone el lugar de la orden')
    pg.fill('.bsheet [name=receiver]','Luis Pérez'); pg.fill('.bsheet [name=notes]','Sin daños'); pg.locator('.bsheet [name=ev]').set_input_files(os.path.join(FD,'Entrega.jpg')); pg.wait_for_timeout(300)
    pg.locator('.bsheet button[type=submit]').click(); pg.wait_for_timeout(2200)
    de=ev(pg,"async(id)=>{const s=await import('./src/services/orders.js'); const o=s.byId(id); return {d:o.delivery, op:s.opOf(o).status, ev:s.evidenceOf(o,'entrega').length, closed:!!o.closedAt, st:s.stateOf(o).key, nx:s.stateOf(o).next.text}}",oid)
    ok(de['d'] and de['d']['receiver']=='Luis Pérez' and de['ev']==1 and de['op']=='unloading','entrega: fecha, hora, lugar, quién recibe y evidencia; Logística pasa a «Descargando»')
    ok(not de['closed'] and de['st']=='delivered' and de['nx']=='Marcar contenedor vacío','Puerto: la entrega no cierra la orden; siguiente paso «Marcar contenedor vacío»'); shot(pg,'14_entrega')
    ok(not ev(pg,"async(id)=>(await import('./src/services/orders.js')).closeCheck((await import('./src/services/orders.js')).byId(id)).ok",oid),'no se puede cerrar antes de devolver el vacío')

    # ===== Control de vacíos =====
    detail(pg,oid,'vacio'); pg.locator('.so-hero [data-act="empty"]').click(); pg.wait_for_selector('.asheet'); pg.locator('.asheet button',has_text='Marcar vacío').click(); pg.wait_for_timeout(1500)
    em=ev(pg,"async(id)=>{const s=await import('./src/services/orders.js'), e=await import('./src/services/empties.js'); const o=s.byId(id); return {n:e.all().filter(r=>r.containerNumber==='MSCU1234567').length, link:o.emptyReturnId, rec:s.emptyOf(o)&&{st:s.emptyOf(o).status,op:s.emptyOf(o).logisticsOperationId}, lg:s.opOf(o).status}}",oid)
    ok(em['n']==1 and em['link'] and em['rec']['st']=='pending' and em['lg']=='empty','marcar vacío: Logística «Vacío» y un registro en Control de vacíos vinculado a la orden')
    em2=ev(pg,"async(id)=>{const s=await import('./src/services/orders.js'), e=await import('./src/services/empties.js'); await s.markEmpty(id); return e.all().filter(r=>r.containerNumber==='MSCU1234567').length}",oid)
    ok(em2==1,'repetir «vacío» no duplica el control de vacíos')
    pg.wait_for_timeout(500); ok('Pendiente de devolución' in hero(pg) and 'Programar devolución' in hero(pg),'estado «Pendiente de devolución»; siguiente paso «Programar devolución»'); shot(pg,'15_vacio')
    pg.goto(BASE+'#/operacion/logistica/vacios'); pg.wait_for_selector('.ec-page'); pg.wait_for_timeout(500)
    ok(pg.locator('.ec-card',has_text='MSCU1234567').locator('.so-folio-tag').count()==1,'Control de vacíos: la tarjeta muestra el folio de la orden')
    ev(pg,"async(a)=>{const s=await import('./src/services/orders.js'), e=await import('./src/services/empties.js'); const r=s.emptyOf(s.byId(a.id)); await e.update(r.id,{yardId:a.yard,deliveryOperatorId:a.op})}",{'id':oid,'yard':cat['yard'],'op':cat['op1']})
    detail(pg,oid,'vacio')
    ok(cat['yardn'] in panel(pg),'el patio de devolución se lee de Control de vacíos')
    pg.locator('[data-panel] [data-docbox="devolucion"] input[data-add]').first.set_input_files(os.path.join(FD,'Patio.jpg')); pg.wait_for_timeout(1500)
    pg.locator('[data-panel] [data-act="return_confirm"]').click(); pg.wait_for_selector('.bsheet form'); pg.locator('.bsheet button[type=submit]').click(); pg.wait_for_timeout(1300)
    ok(ev(pg,"async(id)=>{const s=await import('./src/services/orders.js'); const o=s.byId(id); return s.emptyOf(o).status+'|'+s.evidenceOf(o,'devolucion').length}",oid)=='delivered|1','devolución del vacío confirmada con evidencia')
    pg.wait_for_timeout(500)
    ok('Resolver incidencias' in hero(pg),'una incidencia crítica abierta impide el cierre')
    tab(pg,'Seguimiento'); pg.locator('[data-resolve]').first.click(); pg.wait_for_selector('.so-ask'); pg.fill('.so-ask textarea','Liberado'); pg.locator('.so-ask button[type=submit]').click(); pg.wait_for_timeout(900)
    ok('Lista para cierre' in hero(pg) and 'Cerrar orden' in hero(pg),'con la devolución confirmada y la incidencia resuelta: «Lista para cierre»')

    # ===== Finanzas =====
    tab(pg,'Finanzas'); fz=panel(pg)
    ok('Viaje financiero' in fz and '$15,000.00' in fz and '$2,250.00' in fz and 'Por cobrar' in fz,'Finanzas: el viaje del operador (tarifa, total, comisión) y cobranza «Por cobrar»'); shot(pg,'16_finanzas')
    tab(pg,'Resumen')
    ok('Pendiente de cobro' in panel(pg),'cierre administrativo separado: pendiente de cobro')

    # ===== Cierre =====
    pg.locator('.so-hero [data-act="close"]').click(); pg.wait_for_selector('.asheet'); pg.locator('.asheet button',has_text='Cerrar orden').click(); pg.wait_for_timeout(1300)
    cz=ev(pg,"async(id)=>{const s=await import('./src/services/orders.js'), l=await import('./src/services/logistics.js'); const o=s.byId(id); return {c:!!o.closedAt, op:!!l.allRecords().find(x=>x.id===o.logisticsOperationId).closedAt, st:s.stateOf(o).key}}",oid)
    ok(cz['c'] and cz['op'] and cz['st']=='closed','cierre operativo: la orden queda finalizada y la operación de Logística pasa al historial')
    ok('ORDEN FINALIZADA' in hero(pg) and pg.locator('.so-hero [data-act="summary"]',has_text='Ver expediente completo').count()==1,'«ORDEN FINALIZADA» con «Ver expediente completo»'); shot(pg,'17_finalizada')
    pg.locator('.so-hero [data-act="summary"]').click(); pg.wait_for_selector('.so-dlist'); pg.wait_for_timeout(400)
    items=pg.locator('.so-dlist .att-tx b').all_inner_texts()
    ok(len(items)==5 and 'Pedimento' in items[0] and 'Nota de entrega' in items[-1],'expediente documental: Pedimento, DODA, DEC, Cita y la nota vigente')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(400)
    tab(pg,'Historial'); hz=panel(pg)
    ok(all(x in hz for x in ['Orden creada','Carga programada en Control de llenos','Transporte asignado','Asignación confirmada y unidad despachada','Logística: En ruta a destino','Entrega realizada','Control de vacíos','Orden operativamente finalizada']),'historial unificado de la orden, Logística, Control de llenos y Control de vacíos')

    # ===== Campo: impuestos, sin documentación portuaria ni vacío =====
    pg.goto(BASE+'#/operacion/ordenes/nueva?division=campo'); pg.wait_for_selector('.wiz'); pg.wait_for_timeout(400)
    ok(pg.locator('[data-seg="division"].on').inner_text()=='División Campo' and pg.locator('.so-type.on').inner_text().startswith('Carga de campo') and pg.locator('.so-co').count()==0,'Campo: tipo «Carga de campo» y sin empresa portuaria')
    pg.fill('[data-b="requester"]','AGRICOLA DEL VALLE'); nxt(pg)
    o2id=ev(pg,"async()=>{const s=await import('./src/services/orders.js'); return s.all().find(o=>o.division==='campo').id}")
    ok(ev(pg,"async(id)=>(await import('./src/services/orders.js')).byId(id).folio",o2id)==f'OS-{Y}-000002','segunda orden: folio OS-%d-000002' % Y)
    ok(pg.locator('[data-b="containerNumber"]').count()==0 and pg.locator('[data-pick="plantId"]').count()==1,'Campo: sin contenedor ni terminal; pide planta destino')
    pg.fill('[data-b="origin"]','Rancho El Sauz'); pg.fill('[data-b="destination"]','Celaya'); pg.fill('[data-b="scheduledDate"]',T1); pg.fill('[data-b="scheduledTime"]','07:00'); nxt(pg)
    pick(pg,'[data-pick="vehicleId"]',cat['v1l']); pick(pg,'[data-pick="operatorId"]',cat['op2n']); pick(pg,'[data-pick="trailerId"]',cat['t2p']); nxt(pg)
    ok('Campo no requiere documentación portuaria' in pg.locator('.wiz-body').inner_text() and pg.locator('.fc-doc').count()==0,'Campo: sin Pedimento, DODA, DEC ni cita'); nxt(pg)
    ok(pg.locator('[data-b="finance.applyVat"]').is_checked() and pg.locator('[data-b="finance.applyIsr"]').is_checked() and not pg.locator('[data-b="finance.applyVatWithholding"]').is_checked(),'Campo: IVA 16% e ISR 4% activos; retención de IVA nunca automática')
    pg.fill('[data-money="fare"]','10000'); pg.wait_for_timeout(300)
    ok('$11,200.00' in pg.locator('[data-finprev]').inner_text(),'Campo: total = base + IVA − ISR ($11,200.00)'); nxt(pg); nxt(pg); pg.wait_for_selector('.so-detail .so-hero'); pg.wait_for_timeout(500)
    ok([x.split('\n')[-1] for x in pg.locator('.so-prog li').all_inner_texts()]==['Captura','Documentación','Asignación','Despacho','Entrega','Finalización'] and pg.locator('.so-tab',has_text='Control de vacíos').count()==0,'Campo: sin etapa ni pestaña de vacío')
    pg.locator('[data-act="dispatch"]').first.click(); pg.wait_for_selector('.so-dispatch'); pg.wait_for_timeout(300)
    ok(pg.locator('.so-auth',has_text='tipo tolva').count()==0 and pg.locator('.so-auth',has_text='nota de entrega').count()==0,'el remolque tolva es el habitual de Campo (sin advertencia de tipo)')
    for c in pg.locator('.so-auth input').all(): c.check()
    pg.locator('.so-dispatch button[type=submit]').click(); pg.wait_for_timeout(1500)
    c2=ev(pg,"async(id)=>{const s=await import('./src/services/orders.js'); const t=s.tripOf(s.byId(id)); return t&&{vat:t.applyVat,isr:t.applyIsr,ret:t.applyVatWithholding,tot:t.totalAfterTaxes,div:t.division}}",o2id)
    ok(c2 and c2['vat'] and c2['isr'] and not c2['ret'] and c2['tot']==1120000 and c2['div']=='campo','viaje de Campo con IVA e ISR (total $11,200.00)')
    ev(pg,"async(id)=>{const s=await import('./src/services/orders.js'); await s.advance(id,'to_destination'); await s.registerDelivery(id,{date:'"+T+"',time:'12:00',receiver:'Báscula'})}",o2id); pg.wait_for_timeout(500)
    ok(ev(pg,"async(id)=>{const s=await import('./src/services/orders.js'); const st=s.stateOf(s.byId(id)); return st.key+'|'+s.closeCheck(s.byId(id)).ok}",o2id)=='closing|true','Campo: después de la entrega queda lista para cierre (sin vacío)')

    # ===== Bloqueos, cancelación y folios =====
    pg.goto(BASE+'#/operacion/ordenes/nueva'); pg.wait_for_selector('.wiz'); pg.wait_for_timeout(300)
    pg.locator('[data-optype="transfer"]').click(); pg.wait_for_timeout(200); nxt(pg)
    o3id=ev(pg,"async()=>{const s=await import('./src/services/orders.js'); return s.all().find(o=>o.folio.endsWith('000003')).id}")
    pg.fill('[data-b="origin"]','Manzanillo'); pg.fill('[data-b="destination"]','Colima'); nxt(pg)
    pick(pg,'[data-pick="vehicleId"]',cat['v2l']); nxt(pg); nxt(pg); nxt(pg); nxt(pg); pg.wait_for_selector('.so-detail .so-hero'); pg.wait_for_timeout(500)
    ok('Pendiente de asignación' in hero(pg) and 'Asignar transporte' in hero(pg),'sin operador ni remolque: «Pendiente de asignación»')
    chk=ev(pg,"async(id)=>(await import('./src/services/orders.js')).dispatchCheck((await import('./src/services/orders.js')).byId(id)).blocks.map(b=>b.code)",o3id)
    ok('res_operador' in chk and 'res_remolque' in chk and 'unit_busy' in chk,'bloqueos obligatorios: falta operador y remolque; la unidad ya tiene otra operación activa')
    pg.locator('.so-hero [data-act="assign"]').click(); pg.wait_for_url('**/editar/3'); pg.goto(BASE+'#/operacion/ordenes/'+o3id); pg.wait_for_selector('.so-hero'); pg.wait_for_timeout(500)
    ev(pg,"async(a)=>{const s=await import('./src/services/orders.js'); await s.assign(a.id,{vehicleId:a.v2,operatorId:a.op2,trailerId:a.t1})}",{'id':o3id,'v2':cat['v2'],'op2':cat['op2'],'t1':cat['t1']})
    pg.locator('[data-act="dispatch"]').first.click(); pg.wait_for_selector('.so-dispatch'); pg.wait_for_timeout(300)
    ok(pg.locator('.so-dispatch button[type=submit]').is_disabled() and 'otra operación activa' in pg.locator('.so-dispatch .issues').first.inner_text(),'despacho bloqueado: el botón no se habilita y explica el motivo'); shot(pg,'18_bloqueo')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    pg.locator('[data-moreacts]').click(); asb(pg,'Cancelar orden'); pg.wait_for_selector('.so-ask'); pg.locator('.so-ask button[type=submit]').click(); pg.wait_for_timeout(500)
    ok(pg.locator('.so-ask .has-err').count()==1,'cancelar pide el motivo')
    pg.fill('.so-ask textarea','El cliente pospuso el servicio'); pg.locator('.so-ask button[type=submit]').click(); pg.wait_for_timeout(900)
    ok('ORDEN CANCELADA' in hero(pg),'orden cancelada con motivo')
    f4=ev(pg,"async()=>{const s=await import('./src/services/orders.js'); const o=await s.createOrder({division:'puerto',opType:'transfer'}); return o.folio}")
    ok(f4==f'OS-{Y}-000004','el folio de una orden cancelada no se reutiliza (siguiente: %s)' % f4)

    # ===== Listado: indicadores, filtros y búsqueda =====
    pg.goto(BASE+'#/operacion/ordenes'); pg.wait_for_selector('.so-card'); pg.wait_for_timeout(500); shot(pg,'19_listado')
    ok(pg.locator('.so-card').count()==2 and pg.locator('.so-card').first.locator('.so-open',has_text='Abrir orden').count()==1,'activas: 2 tarjetas (en cierre y borrador) con «Abrir orden»')
    cr=pg.locator('.so-card',has_text='000002').inner_text()
    ok('CAMPO' in cr.upper() and 'Rancho El Sauz' in cr and 'Unidad '+cat['v1l'] in cr and 'Lista para cierre' in cr,'tarjeta: folio, división, ruta, unidad, estado y siguiente paso '+cr.replace(chr(10),' | '))
    pg.locator('.so-tile',has_text='Finalizadas').click(); pg.wait_for_timeout(400)
    ok(pg.locator('.so-card').count()==1 and '000001' in pg.locator('.so-card').inner_text(),'indicador «Finalizadas» filtra la lista')
    pg.locator('.so-tile',has_text='Finalizadas').click(); pg.wait_for_timeout(300)
    pg.locator('[data-scope="all"]').click(); pg.fill('.search-in','MSCU1234567'); pg.wait_for_timeout(400)
    ok(pg.locator('.so-card').count()==1,'buscar por contenedor')
    pg.fill('.search-in',f'OS-{Y}-000003'); pg.wait_for_timeout(400)
    ok(pg.locator('.so-card').count()==1 and 'Cancelada' in pg.locator('.so-card').inner_text(),'buscar por folio')
    pg.fill('.search-in',''); pg.locator('[data-f="division"]').click(); pg.locator('[data-f="division"]').click(); pg.wait_for_timeout(300)
    ok(pg.locator('.so-card').count()==1 and '000002' in pg.locator('.so-card').inner_text(),'filtro por división (Campo) '+str(pg.locator('.so-card').count())+' '+pg.locator('[data-f2]').inner_text().replace(chr(10),' '))
    pg.locator('[data-f="division"]').click(); pg.wait_for_timeout(200); pg.locator('[data-f="docs"]').click(); pg.wait_for_timeout(300)
    ok(pg.locator('.so-card').count()==0 and 'Sin órdenes con estos filtros' in pg.locator('[data-list]').inner_text(),'filtro «Documentación pendiente»: ninguna (las de Puerto ya tienen su documentación)')
    pg.locator('[data-f="docs"]').click(); pg.wait_for_timeout(300)
    ok(pg.locator('.so-card').count()==3 and '000002' not in pg.locator('[data-list]').inner_text(),'filtro «Documentación completa»: las 3 de Puerto (Campo no tiene documentación portuaria)')

    # ===== Registros existentes sin orden (migración segura) =====
    pg.locator('[data-f="docs"]').click(); pg.wait_for_timeout(300)
    ok(pg.locator('.so-legacy').count()==1,'aviso: registros existentes sin orden')
    before=ev(pg,"async()=>{const o=await import('./src/services/operators.js'); return o.allTrips().length}")
    pg.locator('.so-legacy').click(); pg.wait_for_selector('.so-legacyp'); pg.wait_for_timeout(300)
    ok(pg.locator('[data-adopt]').first.is_disabled(),'vincular se habilita después de descargar el respaldo')
    with pg.expect_download() as dl: pg.locator('[data-backup]').click()
    bk=json.loads(open(dl.value.path()).read())
    ok('serviceOrders' in bk['data'] and len(bk['data']['serviceOrders'])==4 and 'serviceOrderEvents' in bk['data'],'respaldo con las órdenes y su historial')
    pg.wait_for_timeout(500); pg.locator('[data-adopt]').first.click(); pg.wait_for_timeout(1500)
    mg=ev(pg,"async()=>{const s=await import('./src/services/orders.js'), o=await import('./src/services/operators.js'); const m=s.all().find(x=>x.source==='migrated'); return m&&{pend:m.pending, op:!!m.logisticsOperationId, f:m.folio, trips:o.allTrips().length}}")
    ok(mg and mg['op'] and 'cliente' in mg['pend'] and mg['trips']==before,'operación existente vinculada: orden nueva que apunta a ella, datos pendientes marcados y sin crear ni recalcular viajes')

    # ===== Varios =====
    ok(ev(pg,"async()=>{const d=await import('./src/services/db.js'); return (await d.all(d.S.serviceOrderEvents)).length>20}"),'auditoría: eventos guardados')
    errs2=[e for e in errs if 'ERR_TUNNEL' not in e and 'Failed to load resource' not in e]
    ok(not errs2,'sin errores en consola: '+'; '.join(errs2[:3]))
    b.close()
finally:
    srv.terminate()
for l in log: print(l)
n=sum(1 for l in log if l.startswith('FAIL'))
print(f'\n{len(log)-n} OK, {n} FAIL')
