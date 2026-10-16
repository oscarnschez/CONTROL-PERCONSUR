"""Usuario de Taller en su propio teléfono, de punta a punta, con el Worker real corriendo en Node (tests/worker_local.mjs:
claves de prueba datos-captura / datos-taller). Dos dispositivos: A capturista (perfil admin) y T teléfono de Taller (perfil
taller). Perfil: solo Taller y Ajustes básicos (sin finanzas, viajes, cobranza, operadores, documentos ni catálogos; las
direcciones prohibidas regresan a Taller). Datos: T recibe solo la foto reducida de Taller (sin viajes, cobros, importes,
rutas ni operadores) y su base rechaza escrituras fuera de Taller. T captura una orden, una falla y una foto sin conexión
con el capturista; A las aplica, publica y devuelve el acuse; T conserva sus cambios mientras tanto. Folio repetido el
mismo día → folio nuevo. Cambios de A llegan a T; una baja en T se aplica en A. PCS_TEST_USER/PCS_TEST_PASS y
PCS_TEST_TUSER/PCS_TEST_TPASS (usuario con perfil taller)"""
import subprocess, time, sys, os, json, urllib.request
from playwright.sync_api import sync_playwright
APP=os.path.abspath(os.path.join(os.path.dirname(__file__),'..')); SH='shots'; os.makedirs(SH,exist_ok=True)
U=os.environ['PCS_TEST_USER']; P=os.environ['PCS_TEST_PASS']; TU=os.environ['PCS_TEST_TUSER']; TP=os.environ['PCS_TEST_TPASS']
BASE='http://127.0.0.1:8816/index.html'; W='https://gps.test'; WL='http://127.0.0.1:8817'
srv=subprocess.Popen([sys.executable,'-m','http.server','8816','--bind','127.0.0.1'],cwd=APP,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
wk=subprocess.Popen(['node',os.path.join(APP,'tests','worker_local.mjs'),'8817','https://app.test/','http://127.0.0.1:8816'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(1.5)
errs=[]; log=[]
def ok(c,m): log.append(('OK  ' if c else 'FAIL')+' '+m)
def shot(pg,n): pg.screenshot(path=f'{SH}/taller_{n}.png')
def to_worker(route, req):
    r=route.fetch(url=req.url.replace(W,WL)); route.fulfill(response=r)
def setup_ctx(ctx):
    ctx.route(lambda u:'cdnjs' in u or 'fonts.g' in u or 'openfreemap' in u, lambda r:r.abort())
    ctx.route(W+'/**', to_worker)
def watch(pg, tag):
    pg.on('pageerror',lambda e:errs.append(tag+': '+str(e))); pg.on('console',lambda m: errs.append(tag+' console: '+m.text) if m.type=='error' else None)
def kv(): return {x['k']:x['size'] for x in json.loads(urllib.request.urlopen(WL+'/__data').read())}
def wget(path, key):
    try:
        with urllib.request.urlopen(urllib.request.Request(WL+path, headers={'X-PCS-Data':key})) as r: return r.status, r.read()
    except urllib.error.HTTPError as e: return e.code, e.read()
ST="async()=>{const s=(await import('./src/services/sync.js')).status(); return {role:s.role,ver:s.ver,phase:s.phase,dirty:s.dirty,error:s.error,tp:s.tallerPending,taller:s.taller,terr:s.tallerError}}"
def wait(pg, cond, timeout=30):
    t=time.time(); s=pg.evaluate(ST)
    while time.time()-t<timeout:
        if cond(s): return s
        pg.wait_for_timeout(300); s=pg.evaluate(ST)
    return s
def login(pg, u, p):
    pg.goto(BASE); pg.wait_for_selector('.login'); pg.fill('#lg-user',u); pg.fill('#lg-pass',p); pg.click('#lg-go'); pg.wait_for_selector('.login',state='detached'); pg.wait_for_timeout(1200)
    if pg.locator('.asheet').count(): pg.get_by_role('button',name='Ahora no').click()
def configure(pg, key, name=''):
    pg.goto(BASE+'#/ajustes/compartir'); pg.wait_for_selector('.sync-set')
    pg.fill('input[name=url]', W); pg.fill('input[name=key]', key); pg.fill('input[name=name]', name)
    pg.locator('.sync-set button[type=submit]').click(); pg.wait_for_timeout(700)
    if pg.locator('.asheet').count(): pg.locator('.asheet button',has_text='Continuar').click(); pg.wait_for_timeout(700)
def count(pg, store): return pg.evaluate("async(s)=>{const d=await import('./src/services/db.js'); return (await d.all(s)).length}", store)
SEED_A="""async()=>{
  const c=await import('./src/services/catalogs.js'), f=await import('./src/services/fuel.js'), o=await import('./src/services/operators.js'), mt=await import('./src/services/maintenance.js'), l=await import('./src/services/logistics.js');
  const v=f.vehicles()[0], op=o.operatorList()[0], ts=c.listAll('trailers'); await c.save('trailers',{...ts[0],type:'chasis'});
  const trip=await o.saveTrip({operatorId:op.id,division:'puerto',date:'2026-10-10',origin:'Manzanillo',destination:'Zapopan',reference:'MSCU5550001',fare:1234500,travelExpenses:0,finalCommission:185175,source:'manual'});
  await l.saveOperation({vehicleId:f.vehicles()[1].id,operatorId:op.id,status:'to_destination',origin:'Colima',destination:'Ruta secreta Tecomán',reference:'REF-PRIVADA'});
  const mo=await mt.createOrder({equipmentType:'vehicle',vehicleId:v.id,type:'preventivo',status:'en_reparacion',inAt:Date.now()-3600e3,reason:'Servicio de frenos (oficina)'});
  return {v:v.id, vl:v.label, v2:f.vehicles()[2].id, trip:trip.id, mo:mo.id, folio:mo.folio, trailer:ts[0].id}}"""
try:
  with sync_playwright() as p:
    b=p.chromium.launch()
    cA=b.new_context(viewport={'width':1280,'height':900},service_workers='block'); setup_ctx(cA); A=cA.new_page(); watch(A,'A')
    cT=b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,is_mobile=True,has_touch=True,service_workers='block'); setup_ctx(cT); T=cT.new_page(); watch(T,'T')
    # ===== A: capturista con la sección Taller activa =====
    login(A,U,P); seed=A.evaluate(SEED_A)
    configure(A,'datos-captura','Oficina')
    sa=wait(A, lambda s: s['ver'] and not s['dirty'] and not s['phase'] and s['taller'] and s['taller'].get('published'), 40)
    ok(sa['role']=='write' and sa['taller'] and sa['taller'].get('enabled') and 'snapt' in kv() and 'snap' in kv(), 'capturista: publica la información y, aparte, la foto reducida de Taller')
    st,body=wget('/v1/datos','datos-taller'); ok(st==403,'la clave de Taller no descarga la información completa (403)')
    A.goto(BASE+'#/ajustes/compartir'); A.wait_for_selector('.sync-set'); A.wait_for_timeout(500)
    ok('Sección Taller activa' in A.locator('[data-state]').inner_text(),'Ajustes del capturista: «Sección Taller activa»')

    # ===== T: perfil Taller =====
    login(T,TU,TP)
    ok('/operacion/taller' in T.url and T.locator('.mt-page').count()==1,'el perfil Taller entra directo a Taller')
    tabs=[x.strip() for x in T.locator('.tabbar [data-tab]').all_inner_texts()]
    ok(tabs==['Taller','Nuevo','Ajustes'],'barra inferior del perfil Taller: Taller, Nuevo y Ajustes ('+', '.join(tabs)+')')
    blocked=[]
    for path in ['/','/cobranza','/operadores','/tarifas','/documentos','/operacion/ordenes','/operacion/logistica','/operacion/combustible','/catalogos','/administracion','/ajustes/gps','/puerto/perconsur/1','/unidades']:
        T.goto(BASE+'#'+path); T.wait_for_timeout(450)
        if '/operacion/taller' not in T.url: blocked.append(path)
    ok(not blocked,'finanzas y demás módulos ocultos: cada dirección prohibida regresa a Taller'+(' — falló: '+', '.join(blocked) if blocked else ''))
    T.goto(BASE+'#/ajustes'); T.wait_for_selector('.page'); T.wait_for_timeout(300); aj=T.locator('.page').inner_text()
    ok('Empresa' not in aj and 'Exportar respaldo' not in aj and 'Rastreo GPS' not in aj and 'Información compartida' in aj and 'Cerrar sesión' in aj,'Ajustes del perfil Taller: sin empresa, respaldos ni GPS; con información compartida y cerrar sesión'); shot(T,'01_ajustes')
    configure(T,'datos-taller','Taller')
    stt=wait(T, lambda s: s['ver'] and not s['phase'], 30)
    ok(stt['role']=='taller','el teléfono queda como dispositivo de Taller')
    has=T.evaluate("async(i)=>{const d=await import('./src/services/db.js'); const mo=await d.get('maintenanceOrders',i.mo), tr=await d.get('operatorTrips',i.trip); const lg=await d.all('logisticsOperations'), fu=await d.all('fuelRecords'), bills=await d.all('tripBilling'); return {mo:!!mo, folio:mo&&mo.folio, trip:!!tr, trips:(await d.all('operatorTrips')).length, secret:JSON.stringify(lg).includes('Tecomán')||JSON.stringify(lg).includes('REF-PRIVADA'), bills:bills.length}}", seed)
    ok(has['mo'] and has['folio']==seed['folio'],'T recibe la orden de taller que capturó la oficina')
    ok(not has['trip'] and has['trips']==0 and has['bills']==0 and not has['secret'],'T no recibe viajes, cobros, rutas ni referencias (finanzas fuera del teléfono)')
    T.goto(BASE+'#/operacion/taller'); T.wait_for_selector('.mt-page'); T.wait_for_timeout(600)
    ok(seed['folio'] in T.locator('.mt-page').inner_text(),'el tablero de Taller muestra la orden de la oficina'); shot(T,'02_taller')
    g=T.evaluate("async()=>{const o=await import('./src/services/operators.js'); try{ await o.saveTrip({operatorId:o.operatorList()[0].id,fare:100,date:'2026-10-10',origin:'a',destination:'b'}); return 'guardado'; }catch(e){ return e.message } }")
    ok('Taller' in g,'la base del teléfono de Taller rechaza capturas fuera de Taller: '+g)

    # ===== T captura (la oficina no está revisando) =====
    tc=T.evaluate("""async(i)=>{const mt=await import('./src/services/maintenance.js');
      const mo=await mt.createOrder({equipmentType:'vehicle',vehicleId:i.v,type:'correctivo',status:'en_reparacion',inAt:Date.now()-1800e3,reason:'Fuga de aire (Taller)'});
      const iss=await mt.saveIssue({equipmentType:'vehicle',vehicleId:i.v2,date:Date.now(),severity:'leve',description:'Luz trasera fundida'});
      const ph=await mt.addPhoto('order',mo.id,mo.id,new Blob([new Uint8Array([255,216,255,224,5,5,5])],{type:'image/jpeg'}));
      return {mo:mo.id, folio:mo.folio, iss:iss.id, ph:ph.id, media:ph.mediaId}}""", seed)
    ok(tc['folio']==seed['folio'][:-1]+str(int(seed['folio'][-1])+1) or tc['folio']!=seed['folio'],'T crea su orden con el siguiente folio que conoce: '+tc['folio'])
    s1=wait(T, lambda s: not s['dirty'] and not s['phase'], 40)
    ks=kv(); inb=[k for k in ks if k.startswith('in:') and k!='in:meta']
    ok(len(inb)==1 and 'in:meta' in ks and s1['tp']>=3,'T envía sus cambios y la foto a la bandeja del Worker (pendientes: %s)' % s1['tp'])
    ok(any(k=='f:'+tc['media'] for k in ks),'la foto del taller se sube a la nube')
    T.goto(BASE+'#/ajustes/compartir'); T.wait_for_selector('.sync-set'); T.wait_for_timeout(400)
    ok('enviado' in T.locator('[data-state]').inner_text() and 'Solo Taller' in T.locator('.sync-role').inner_text(),'T: «Solo Taller» y aviso de cambios enviados por aplicar'); shot(T,'03_pendientes')
    # Recibir antes del acuse no borra lo capturado
    T.evaluate("async()=>{await (await import('./src/services/sync.js')).receive({force:true})}"); T.wait_for_timeout(500)
    keep=T.evaluate("async(i)=>{const d=await import('./src/services/db.js'); return !!(await d.get('maintenanceOrders',i.mo)) && !!(await d.get('maintenanceIssues',i.iss)) && !!(await d.get('attachments',i.media))}", tc)
    ok(keep,'T recibe la información de Taller sin perder lo que aún no aplica la oficina')

    # ===== A aplica los cambios de Taller =====
    A.evaluate("async()=>{await (await import('./src/services/sync.js')).checkInbox()}")
    sa2=wait(A, lambda s: not s['dirty'] and not s['phase'], 40)
    ap=A.evaluate("async(i)=>{const d=await import('./src/services/db.js'); const mo=await d.get('maintenanceOrders',i.mo), att=await d.get('attachments',i.media); return {mo:mo&&mo.reason, folio:mo&&mo.folio, iss:!!(await d.get('maintenanceIssues',i.iss)), att:!!(att&&att.buf), ph:!!(await d.get('maintenanceAttachments',i.ph))}}", tc)
    ok(ap['mo']=='Fuga de aire (Taller)' and ap['iss'] and ap['ph'] and ap['att'],'la oficina recibe la orden, la falla y la foto de Taller')
    ok(ap['folio'] and ap['folio']!=seed['folio'],'cada orden conserva un folio distinto ('+str(ap['folio'])+')')
    acks=A.evaluate("()=>JSON.parse(localStorage.getItem('pcs-sync-acks')||'{}')")
    ok(len(acks)==1 and list(acks.values())[0]>=3,'la oficina registra el acuse del teléfono de Taller')
    A.goto(BASE+'#/operacion/taller'); A.wait_for_selector('.mt-page'); A.wait_for_timeout(500)
    ok(tc['folio'] in A.locator('.mt-page').inner_text() or (ap['folio'] or '') in A.locator('.mt-page').inner_text(),'el tablero de Taller de la oficina muestra la orden capturada en Taller')
    # T recibe el acuse
    T.evaluate("async()=>{await (await import('./src/services/sync.js')).receive({force:true})}")
    s2=wait(T, lambda s: s['tp']==0 and not s['dirty'] and not s['phase'], 30)
    ok(s2['tp']==0,'con el acuse, T retira sus cambios de la bandeja')
    T.wait_for_timeout(600); ks=kv()
    ok(not [k for k in ks if k.startswith('in:') and k!='in:meta'],'y el lote se retira del Worker')

    # ===== Folio repetido el mismo día =====
    fr=T.evaluate("async(i)=>{const mt=await import('./src/services/maintenance.js'); const mo=await mt.createOrder({equipmentType:'vehicle',vehicleId:i.v2,type:'preventivo',status:'reportado',inAt:Date.now()-600e3,reason:'Revisión T'}); return {id:mo.id,folio:mo.folio}}", seed)
    fa=A.evaluate("async(i)=>{const mt=await import('./src/services/maintenance.js'); const mo=await mt.createOrder({equipmentType:'vehicle',vehicleId:i.v2,type:'preventivo',status:'reportado',inAt:Date.now()-500e3,reason:'Revisión A'}); return {id:mo.id,folio:mo.folio}}", seed)
    ok(fr['folio']==fa['folio'],'los dos crean una orden de la misma unidad el mismo día con el mismo folio (%s)' % fr['folio'])
    wait(T, lambda s: not s['dirty'] and not s['phase'], 40); wait(A, lambda s: not s['dirty'] and not s['phase'], 40)
    A.evaluate("async()=>{await (await import('./src/services/sync.js')).checkInbox()}"); wait(A, lambda s: not s['dirty'] and not s['phase'], 40)
    ff=A.evaluate("async(i)=>{const d=await import('./src/services/db.js'); const a=await d.get('maintenanceOrders',i.a), t=await d.get('maintenanceOrders',i.t); return {a:a.folio,t:t&&t.folio,from:t&&t.folioFrom}}", {'a':fa['id'],'t':fr['id']})
    ok(ff['t'] and ff['a']!=ff['t'] and ff['from']==fr['folio'],'folio repetido: la orden de Taller recibe el siguiente folio libre (%s → %s)' % (fr['folio'], ff['t']))
    T.evaluate("async()=>{await (await import('./src/services/sync.js')).receive({force:true})}"); wait(T, lambda s: s['tp']==0 and not s['phase'], 30)
    tf=T.evaluate("async(i)=>{const d=await import('./src/services/db.js'); return (await d.get('maintenanceOrders',i)).folio}", fr['id'])
    ok(tf==ff['t'],'T recibe el folio corregido')

    # ===== Cambios de la oficina y bajas de Taller =====
    A.evaluate("async(i)=>{const mt=await import('./src/services/maintenance.js'); await mt.updateOrder(i.mo,{reason:'Fuga de aire, válvula cambiada'})}", tc)
    wait(A, lambda s: not s['dirty'] and not s['phase'], 40)
    T.evaluate("async()=>{await (await import('./src/services/sync.js')).receive({force:true})}"); wait(T, lambda s: not s['phase'], 30)
    ok(T.evaluate("async(i)=>{const d=await import('./src/services/db.js'); return (await d.get('maintenanceOrders',i.mo)).reason}", tc)=='Fuga de aire, válvula cambiada','un cambio de la oficina llega al teléfono de Taller')
    T.evaluate("async(i)=>{const mt=await import('./src/services/maintenance.js'); await mt.removePhoto(i.ph)}", tc)
    wait(T, lambda s: not s['dirty'] and not s['phase'], 40)
    A.evaluate("async()=>{await (await import('./src/services/sync.js')).checkInbox()}"); wait(A, lambda s: not s['dirty'] and not s['phase'], 40)
    gone=A.evaluate("async(i)=>{const d=await import('./src/services/db.js'); return !(await d.get('maintenanceAttachments',i.ph)) && !(await d.get('attachments',i.media))}", tc)
    ok(gone,'una foto eliminada en Taller se elimina en la oficina (registro y archivo)')
    A.wait_for_timeout(500); ok('f:'+tc['media'] not in kv(),'y el archivo se borra de la nube')
    # Pantalla real: nueva orden desde «Nuevo» en el teléfono de Taller
    T.goto(BASE+'#/operacion/taller'); T.wait_for_selector('.mt-page'); T.wait_for_timeout(400)
    T.locator('.tabbar .tab-new').click(); T.wait_for_timeout(700)
    ok(T.locator('.bsheet, .asheet, .picker').count()>=1,'«Nuevo» en el perfil Taller abre la captura de una orden de taller'); shot(T,'04_nuevo')
    bad=[e for e in errs if 'ERR_TUNNEL' not in e and 'Failed to load resource' not in e]
    ok(not bad,'sin errores en consola: '+'; '.join(bad[:3]))
    b.close()
finally:
    srv.terminate(); wk.terminate()
for l in log: print(l)
n=sum(1 for l in log if l.startswith('FAIL'))
print(f'\n{len(log)-n} OK, {n} FAIL')
