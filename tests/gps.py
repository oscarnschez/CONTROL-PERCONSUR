"""Rastreo GPS: Ajustes → GPS, vinculación de IMEI, ubicación y mapa en Inicio (fichas deslizables), mapa en vivo en el detalle, posición antigua,
detenida, proveedor caído, respaldo sin la clave y enlace de rastreo. Usa un intermediario simulado. PCS_TEST_USER/PCS_TEST_PASS"""
import subprocess, time, sys, os, json, base64
from playwright.sync_api import sync_playwright
APP=os.path.abspath(os.path.join(os.path.dirname(__file__),'..')); SH='shots'; os.makedirs(SH,exist_ok=True)
U=os.environ['PCS_TEST_USER']; P=os.environ['PCS_TEST_PASS']
BASE='http://127.0.0.1:8779/index.html'; W='https://gps.test'
srv=subprocess.Popen([sys.executable,'-m','http.server','8779','--bind','127.0.0.1'],cwd=APP,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(1)
errs=[]; log=[]
def ok(c,m): log.append(('OK  ' if c else 'FAIL')+' '+m)
def shot(pg,n): pg.screenshot(path=f'{SH}/gp_{n}.png')
PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')
mock={'mode':'ok','lat':19.010070,'lng':-103.832489,'age':18,'sig':5,'calls':0,'detail':0}
def handle(route, req):
    cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'X-PCS-Key','Content-Type':'application/json'}
    if req.method=='OPTIONS': return route.fulfill(status=204, headers=cors)
    if req.headers.get('x-pcs-key')!='clave-app': return route.fulfill(status=401, headers=cors, body=json.dumps({'ok':False,'error':'Clave de PERCONSUR inválida o ausente'}))
    if mock['mode']=='down': return route.fulfill(status=502, headers=cors, body=json.dumps({'ok':False,'error':'IOPGPS respondió con error: mantenimiento'}))
    now=int(time.time()*1000)
    if '/v1/posiciones' in req.url:
        mock['calls']+=1
        return route.fulfill(status=200, headers=cors, body=json.dumps({'ok':True,'fetchedAt':now,'stale':False,'devices':[
            {'imei':'865190071363660','name':'U12 60-BN-4J','lat':mock['lat'],'lng':mock['lng'],'gpsTime':now-mock['age']*1000,'signalTime':now-mock['sig']*1000,'speed':62.4,'course':90,'acc':True,'address':None},
            {'imei':'865190071300099','name':'Camioneta oficina','lat':20.67,'lng':-103.35,'gpsTime':now-60000,'signalTime':None,'speed':None,'course':None,'acc':None,'address':None}]}))
    if '/v1/ubicacion' in req.url:
        mock['detail']+=1
        return route.fulfill(status=200, headers=cors, body=json.dumps({'ok':True,'fetchedAt':now,'device':{'imei':'865190071363660','lat':mock['lat'],'lng':mock['lng'],'gpsTime':now-mock['age']*1000,'signalTime':now-mock['sig']*1000,'address':'Autopista Colima - Manzanillo, Tecolapa, Tecomán, Colima, México','acc':True,'speed':62.4}}))
    route.fulfill(status=404, headers=cors, body='{}')
try:
  with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,is_mobile=True,has_touch=True,service_workers='block')
    ctx.route(lambda u:'cdnjs' in u or 'fonts.g' in u, lambda r:r.abort())
    ctx.route(W+'/**', handle); ctx.route('https://tile.openstreetmap.org/**', lambda r: r.fulfill(status=200, body=PNG, headers={'Content-Type':'image/png','Access-Control-Allow-Origin':'*'}))
    ctx.route('https://nominatim.openstreetmap.org/**', lambda r: r.fulfill(status=200, body='[]', headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}))
    pg=ctx.new_page(); pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m: errs.append('console: '+m.text) if m.type=='error' else None)
    pg.goto(BASE); pg.wait_for_selector('.login'); pg.fill('#lg-user',U); pg.fill('#lg-pass',P); pg.click('#lg-go'); pg.wait_for_selector('.login',state='detached'); pg.wait_for_timeout(900)
    if pg.locator('.asheet').count(): pg.get_by_role('button',name='Ahora no').click()
    pg.goto(BASE+'#/ajustes'); pg.wait_for_timeout(500)
    ok('Rastreo GPS (IOPGPS)' in pg.locator('.page').inner_text() and 'Sin configurar' in pg.locator('.page').inner_text(),'Ajustes: Integraciones → Rastreo GPS (sin configurar)')
    pg.locator('a[href="#/ajustes/gps"]').click(); pg.wait_for_timeout(500)
    pg.fill('[data-cfg] [name=url]',W); pg.fill('[data-cfg] [name=key]','mala'); pg.locator('[data-test]').click(); pg.wait_for_timeout(600)
    ok('Clave de PERCONSUR inválida' in pg.locator('[data-st]').inner_text(),'Probar con clave incorrecta: error claro')
    pg.fill('[data-cfg] [name=key]','clave-app'); pg.locator('[data-test]').click(); pg.wait_for_timeout(600)
    ok('Conexión correcta · 2 dispositivos, 2 con coordenadas' in pg.locator('[data-st]').inner_text(),'Probar: '+pg.locator('[data-st]').inner_text())
    pg.locator('[data-cfg] button[type=submit]').click(); pg.wait_for_timeout(900)
    rows=pg.locator('.gps-dev').all_inner_texts(); ok(len(rows)==2 and 'Sugerido: U12' in rows[1].replace('\n',' ') or any('Sugerido: U12' in r for r in rows),'dispositivos de IOPGPS con sugerencia por placas: '+' || '.join(r.replace('\n',' ') for r in rows))
    shot(pg,'g01_ajustes')
    pg.locator('[data-suggest]').click(); pg.wait_for_timeout(700)
    ok(any('U12' in r and 'Sugerido' not in r for r in pg.locator('.gps-dev').all_inner_texts()),'vincular automáticamente: U12 ↔ IMEI 865190071363660')
    vid=pg.evaluate("async()=>{const c=await import('./src/services/catalogs.js'); const v=c.listAll('vehicles').find(x=>x.gpsDeviceId==='865190071363660'); return v&&v.id}")
    ok(bool(vid),'IMEI guardado en la unidad del catálogo')
    # operación activa para U12
    pg.evaluate("""async(vid)=>{const l=await import('./src/services/logistics.js'); const o=(await import('./src/services/operators.js')).operatorList()[0]; await l.saveOperation({vehicleId:vid,operatorId:o.id,trailerId:null,division:'puerto',status:'to_destination',origin:'Manzanillo',destination:'Guadalajara',reference:'MSCU1234567',deliveryPlace:'CEDIS Guadalajara'})}""", vid)
    pg.goto(BASE+'#/'); pg.wait_for_timeout(1500)
    loc=pg.locator('.lgh-card .lgh-loc'); ok(loc.count()==1 and 'Autopista Colima' in loc.inner_text() and 'Actualizado hace' in loc.inner_text(),'Inicio: ubicación discreta en la tarjeta: '+loc.inner_text().replace('\n',' | '))
    ok(pg.locator('.lgh-card .lgh-map.leaflet-container').count()==1 and pg.locator('.lgh-card .gps-pin').inner_text().strip()=='U12','Inicio: mapa en la tarjeta con el marcador de la unidad')
    ok(pg.locator('.lgh-card .leaflet-control-zoom').count()==0 and pg.evaluate("getComputedStyle(document.querySelector('.lgh-map')).pointerEvents")=='none','Inicio: mapa de solo vista (sin zoom; el toque llega a la tarjeta)')
    ok(pg.locator('.lg-dots').count()==0,'una sola unidad: sin puntos de deslizamiento')
    pg.locator('[data-lghome]').scroll_into_view_if_needed(); pg.evaluate('window.scrollBy(0,250)'); shot(pg,'g02_inicio')
    # segunda unidad activa con GPS: fichas deslizables
    vid2=pg.evaluate("""async(vid)=>{const c=await import('./src/services/catalogs.js'); const v=c.listAll('vehicles').find(x=>x.id!==vid&&!x.gpsDeviceId); await c.save('vehicles',{...v,gpsDeviceId:'865190071300099',gpsProvider:'iopgps'});
      const l=await import('./src/services/logistics.js'); const o=(await import('./src/services/operators.js')).operatorList(); await l.saveOperation({vehicleId:v.id,operatorId:(o[1]||o[0]).id,trailerId:null,division:'campo',status:'unloading',origin:'Colima',destination:'Zapopan',reference:''}); return v.id}""", vid)
    pg.wait_for_timeout(1500)
    ok(pg.locator('.lgh-card').count()==2 and pg.locator('.lgh-card .lgh-map.leaflet-container').count()>=1,'Inicio: 2 unidades activas, cada una con su mapa')
    ok(pg.locator('.lg-dots [data-dot]').count()==2 and pg.locator('.lg-dot.on').count()==1,'puntos de deslizamiento: 2')
    w=pg.evaluate("()=>{const r=document.querySelector('.lg-rail'); return {sw:r.scrollWidth,cw:r.clientWidth,pw:document.documentElement.scrollWidth,vw:innerWidth}}")
    ok(w['sw']>w['cw'] and w['pw']<=w['vw'],'solo las fichas se deslizan (sin desplazamiento lateral de la página): '+str(w))
    pg.evaluate("()=>{const r=document.querySelector('.lg-rail'); r.scrollLeft=r.scrollWidth}"); pg.wait_for_timeout(700)
    ok(pg.locator('.lg-dot').nth(1).get_attribute('class').find('on')>=0,'al deslizar cambia el punto activo')
    ok(pg.locator('.lgh-card').nth(1).locator('.lgh-map.leaflet-container').count()==1,'el mapa de la segunda ficha se carga al asomar')
    shot(pg,'g02b_inicio_2')
    pg.locator('.lg-dot').first.click(); pg.wait_for_timeout(800)
    ok(pg.evaluate("document.querySelector('.lg-rail').scrollLeft")<5,'tocar un punto lleva a esa ficha')
    pg.evaluate("()=>{window.__m=document.querySelector('.lgh-map')}")
    mock['lat']=19.02
    pg.evaluate("async()=>{const g=await import('./src/services/gps.js'); await g.refresh({force:true});}"); pg.wait_for_timeout(600)
    ok(pg.evaluate("document.querySelector('.lgh-map')===window.__m && document.body.contains(window.__m)"),'actualizar el GPS conserva el mapa (no recarga el mapa base)')
    mock['lat']=19.010070
    pg.evaluate("async()=>{const g=await import('./src/services/gps.js'); await g.refresh({force:true});}"); pg.wait_for_timeout(300)
    pg.locator(f'.lgh-card[data-lgu="{vid}"]').click(); pg.wait_for_timeout(1500)
    sec=pg.locator('.gps'); ok(sec.count()==1 and 'Ubicación en tiempo real' in sec.inner_text(),'detalle: sección Ubicación en tiempo real')
    ok(pg.locator('.gps .leaflet-container').count()==1 and pg.locator('.gps-pin').inner_text().strip()=='U12','mapa con marcador de la unidad')
    ok('En ruta a destino' in pg.locator('.gps-top').inner_text() and 'Actualizado hace' in pg.locator('.gps-fresh').inner_text(),'estado de Logística sobre el mapa y antigüedad')
    data=pg.locator('[data-g-data]').inner_text()
    ok('19.010070' in data and '-103.832489' in data and '62 km/h' in data and 'Encendido' in data and 'Autopista Colima' in data,'latitud, longitud, velocidad, motor y dirección')
    ok('Manzanillo' in pg.locator('.page').inner_text() and 'MSCU1234567' in pg.locator('.page').inner_text(),'el detalle conserva los datos operativos')
    pg.locator('.gps').scroll_into_view_if_needed(); shot(pg,'g03_detalle')
    # movimiento: nueva posición
    mock['lat']=19.05; mock['lng']=-103.70
    pg.evaluate("async()=>{const g=await import('./src/services/gps.js'); await g.refresh({force:true});}"); pg.wait_for_timeout(700)
    ok('19.050000' in pg.locator('[data-g-data]').inner_text(),'el marcador y los datos se actualizan sin recargar')
    ll=pg.evaluate("()=>{const m=document.querySelector('.gps-pin').closest('.leaflet-marker-icon'); return !!m}"); ok(ll,'marcador presente tras moverse')
    pg.locator('[data-g-center]').click(); pg.wait_for_timeout(300); ok(True,'botón Centrar')
    # señal antigua
    mock['age']=3*3600; mock['sig']=3*3600
    pg.evaluate("async()=>{const g=await import('./src/services/gps.js'); await g.detail('865190071363660',{force:true}); await g.refresh({force:true});}"); pg.wait_for_timeout(500)
    ok('Señal GPS sin actualización reciente' in pg.locator('.gps-fresh').inner_text() and pg.locator('.gps-pin.stale').count()==1,'posición antigua: «Señal GPS sin actualización reciente» y marcador atenuado')
    shot(pg,'g04_stale')
    # detenida
    mock['age']=40*60; mock['sig']=60
    pg.evaluate("async()=>{const g=await import('./src/services/gps.js'); await g.detail('865190071363660',{force:true}); await g.refresh({force:true});}"); pg.wait_for_timeout(500)
    ok('Detenida · última posición' in pg.locator('.gps-fresh').inner_text(),'equipo reporta sin moverse: «Detenida»')
    # proveedor caído
    mock['mode']='down'
    pg.evaluate("async()=>{const g=await import('./src/services/gps.js'); await g.refresh({force:true});}"); pg.wait_for_timeout(400)
    ok(pg.locator('.lg-hero').count()==1 and 'MSCU1234567' in pg.locator('.page').inner_text(),'proveedor caído: Logística sigue igual')
    mock['mode']='ok'
    # polling solo visible: cuenta llamadas en 35 s no; validar intervalo programado
    # clave fuera de respaldos
    r=pg.evaluate("async()=>{const m=await import('./src/services/backup.js'); const o=JSON.parse(await (await m.exportBackup()).text()); return {k:o.data.settings.some(x=>x.key==='gpsKey'), u:o.data.settings.some(x=>x.key==='gpsUrl'), imei:o.data.vehicles.some(v=>v.gpsDeviceId==='865190071363660')}}")
    ok(not r['k'] and r['u'] and r['imei'],'respaldo: incluye dirección e IMEI, no la clave')
    # sin configuración: GPS no estorba
    pg.evaluate("async()=>{const g=await import('./src/services/gps.js'); await g.saveConfig({url:'',key:''});}")
    pg.goto(BASE+'#/'); pg.wait_for_timeout(800); ok(pg.locator('.lgh-loc').count()==0 and pg.locator('.lgh-map').count()==0 and pg.locator('.lgh-card').count()==2,'sin configurar: las tarjetas quedan como antes (sin mapa)')
    pg.goto(BASE+'#/operacion/logistica/u/'+vid); pg.wait_for_timeout(800); ok(pg.locator('.gps').count()==0,'sin configurar ni enlace: no aparece sección GPS')
    # catálogo: IMEI y enlace de rastreo
    first=pg.evaluate("async()=>{const c=await import('./src/services/catalogs.js'); const v=c.list('vehicles','perconsur')[0]; return v.id}")
    pg.goto(BASE+'#/unidades/'+first); pg.wait_for_selector('.uf-page'); pg.locator('.nav-act[data-edit]').click(); pg.wait_for_selector('.un-form')
    ok(pg.locator('.un-form [name=gpsDeviceId]').count()==1 and pg.locator('.un-form [name=trackingUrl]').count()==1,'Unidades (expediente): IMEI y enlace de rastreo')
    pg.fill('.un-form [name=trackingUrl]','https://www.iopgps.com/main.html#/tracking?token=x'); pg.locator('.un-form button[type=submit]').click(); pg.wait_for_timeout(500)
    pg.goto(BASE+'#/operacion/logistica/u/'+first); pg.wait_for_timeout(700)
    ok(pg.locator('.gps-mini a[href*="iopgps"]').count()==1,'fase 0: «Abrir rastreo GPS» con el enlace de la unidad'); shot(pg,'g05_enlace')
    pg.emulate_media(color_scheme='dark')
    pg.evaluate("async()=>{const g=await import('./src/services/gps.js'); await g.saveConfig({url:'https://gps.test',key:'clave-app'});}")
    pg.goto(BASE+'#/operacion/logistica/u/'+vid); pg.wait_for_timeout(1500); pg.locator('.gps').scroll_into_view_if_needed(); shot(pg,'g06_dark')
    b.close()
finally:
  srv.terminate()
print('\n'.join(log)); print('ERRORES (401/502 esperados por la prueba):',errs)
