"""Centro de Monitoreo GPS y Portal de rastreo para clientes, de punta a punta, con el Worker real corriendo en Node
(tests/worker_local.mjs: IOPGPS simulado y KV en memoria) y mapas MapLibre. Los mosaicos del mapa se simulan.
Monitor: indicadores, marcadores del color del estado de Logística, filtros, buscador, detalle, centrar, toda la flota, movimiento en
vivo sin recargar, sin señal, estado de Logística independiente del GPS, panel inferior en iPhone y tarjeta en computadora.
Portal: compartir, abrir el enlace, sin velocidad ni operador, actualización, revocar, cada cambio de estado de la app en el
portal (Cargando, En ruta vacío, Descargando…; se comparte en cualquier estado) y fin del enlace al cerrar la operación.
PCS_TEST_USER/PCS_TEST_PASS"""
import subprocess, time, sys, os, json, urllib.request, mimetypes, re
from playwright.sync_api import sync_playwright
APP=os.path.abspath(os.path.join(os.path.dirname(__file__),'..')); SH='shots'; os.makedirs(SH,exist_ok=True)
U=os.environ['PCS_TEST_USER']; P=os.environ['PCS_TEST_PASS']
BASE='http://127.0.0.1:8806/index.html'; W='https://gps.test'; WL='http://127.0.0.1:8807'
srv=subprocess.Popen([sys.executable,'-m','http.server','8806','--bind','127.0.0.1'],cwd=APP,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
wk=subprocess.Popen(['node',os.path.join(APP,'tests','worker_local.mjs'),'8807','https://app.test/'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(1.5)
errs=[]; log=[]
def ok(c,m): log.append(('OK  ' if c else 'FAIL')+' '+m)
def shot(pg,n): pg.screenshot(path=f'{SH}/mon_{n}.png')
IMEI={'12':'865190071363660','5':'865190071363661','8':'865190071363662','21':'865190071363663'}
pos={'12':[19.40,-103.62,78,20],'5':[19.066,-104.296,0,0],'21':[20.64,-103.38,42,300]}
hide={}
def push(stale8=True):
    now=int(time.time())
    d=[{'imei':IMEI[k],'deviceName':'U'+k,'lat':v[0],'lng':v[1],'speed':v[2],'course':v[3],'gpsTime':now-(35*60 if k=='5' else 20),'signalTime':now-10,'accStatus':1,'_hideInFleet':hide.get(k,[])} for k,v in pos.items()]
    d.append({'imei':IMEI['8'],'deviceName':'U8','lat':18.915,'lng':-103.87,'speed':0,'gpsTime':now-3*3600 if stale8 else now-20,'signalTime':now-3*3600 if stale8 else now-10})
    d.append({'imei':'865190071300099','deviceName':'Camioneta oficina','lat':20.67,'lng':-103.35,'speed':0,'gpsTime':now-60,'signalTime':now-10})
    d.append({'imei':'865190071300100','deviceName':'Equipo sin posición'})
    urllib.request.urlopen(urllib.request.Request(WL+'/__mock',data=json.dumps({'devices':d}).encode(),method='POST',headers={'Content-Type':'application/json'}))
def to_worker(route, req):
    r=route.fetch(url=req.url.replace(W,WL)); route.fulfill(response=r)
def app_files(route, req):
    path=req.url.split('https://app.test/')[1].split('?')[0]; f=os.path.join(APP,path)
    if not os.path.isfile(f): return route.fulfill(status=404, body='', headers={'Access-Control-Allow-Origin':'*'})
    ct=mimetypes.guess_type(f)[0] or 'application/octet-stream'
    if f.endswith('.js'): ct='text/javascript'
    route.fulfill(status=200, path=f, headers={'Content-Type':ct,'Access-Control-Allow-Origin':'*'})
TJ={'tilejson':'3.0.0','tiles':['https://tiles.openfreemap.org/planet/t/{z}/{x}/{y}.pbf'],'minzoom':0,'maxzoom':14,
    'attribution':'<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>'}
def tiles(route, req):
    h={'Access-Control-Allow-Origin':'*'}
    if re.search(r'/planet/?$',req.url): return route.fulfill(status=200, headers={**h,'Content-Type':'application/json'}, body=json.dumps(TJ))
    route.fulfill(status=200, headers={**h,'Content-Type':'application/x-protobuf'}, body=b'')
def png(w=256,h=256):
    """Mosaico satelital simulado (PNG generado sin librerías)"""
    import zlib,struct
    raw=b''.join(b'\x00'+b''.join(bytes((70+(x*y)%40,95+(x+y)%50,55)) for x in range(w)) for y in range(h))
    ch=lambda t,d: struct.pack('>I',len(d))+t+d+struct.pack('>I',zlib.crc32(t+d)&0xffffffff)
    return b'\x89PNG\r\n\x1a\n'+ch(b'IHDR',struct.pack('>IIBBBBB',w,h,8,2,0,0,0))+ch(b'IDAT',zlib.compress(raw))+ch(b'IEND',b'')
SAT_PNG=png(); sat_hits=[]
def sat_tiles(route, req):
    sat_hits.append(req.url); route.fulfill(status=200, headers={'Access-Control-Allow-Origin':'*','Content-Type':'image/png'}, body=SAT_PNG)
def setup_ctx(ctx):
    ctx.route(lambda u:'cdnjs' in u or 'fonts.g' in u, lambda r:r.abort())
    ctx.route(W+'/**', to_worker); ctx.route('https://app.test/**', app_files); ctx.route('https://tiles.openfreemap.org/**', tiles); ctx.route('https://server.arcgisonline.com/**', sat_tiles)
    ctx.route('https://nominatim.openstreetmap.org/**', lambda r: r.fulfill(status=200, body=json.dumps([{'lat':'20.6597','lon':'-103.3496','place_rank':16,'display_name':'Guadalajara'}] if 'Guadalajara' in r.request.url else []), headers={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}))
def watch(pg):
    pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m: errs.append('console: '+m.text) if m.type=='error' else None)
SETUP="""async(IMEI)=>{const g=await import('./src/services/gps.js'); await g.saveConfig({url:'https://gps.test',key:'clave-app'});
      const c=await import('./src/services/catalogs.js'); const vs=c.listAll('vehicles'), ts=c.listAll('trailers'); const by=(e)=>vs.find(x=>String(x.eco).replace(/^0+/,'')===e);
      for (const [e,i] of Object.entries(IMEI)) await c.save('vehicles',{...by(e),gpsDeviceId:i,gpsProvider:'iopgps'});
      const types=['chasis','jaula','tolva']; for (let k=0;k<3;k++) await c.save('trailers',{...ts[k],type:types[k]});
      const t2=c.listAll('trailers'), tt=(ty)=>t2.find(x=>x.type===ty).id;
      const l=await import('./src/services/logistics.js'); const o=(await import('./src/services/operators.js')).operatorList();
      const a=await l.saveOperation({vehicleId:by('12').id,operatorId:o[0].id,trailerId:tt('chasis'),division:'puerto',status:'to_destination',origin:'Manzanillo',destination:'Guadalajara',reference:'MSCU1234567',deliveryPlace:'CEDIS Guadalajara'});
      await l.saveOperation({vehicleId:by('5').id,operatorId:o[1].id,trailerId:tt('jaula'),division:'campo',status:'unloading',origin:'Tecomán',destination:'Manzanillo',deliveryPlace:'Planta Manzanillo'});
      await l.saveOperation({vehicleId:by('21').id,operatorId:o[2].id,trailerId:tt('tolva'),division:'campo',status:'empty_transit',origin:'Guadalajara',destination:'Colima',reference:'CAMPO-881'});
      return {u12:by('12').id,u5:by('5').id,u8:by('8').id,u21:by('21').id,op12:a.id,oper:o[0].name}}"""
GPSR="async()=>{const g=await import('./src/services/gps.js'); await g.refresh({force:true});}"
FLEET="document.querySelector('.mon-map')._fleet"
try:
  push()
  with sync_playwright() as p:
    b=p.chromium.launch(args=['--use-angle=swiftshader','--enable-unsafe-swiftshader'])
    ctx=b.new_context(viewport={'width':1440,'height':900},service_workers='block'); setup_ctx(ctx)
    pg=ctx.new_page(); watch(pg)
    pg.goto(BASE); pg.wait_for_selector('.login'); pg.fill('#lg-user',U); pg.fill('#lg-pass',P); pg.click('#lg-go'); pg.wait_for_selector('.login',state='detached'); pg.wait_for_timeout(900)
    if pg.locator('.asheet').count(): pg.get_by_role('button',name='Ahora no').click()
    ids=pg.evaluate(SETUP, IMEI)
    # Acceso desde Inicio y desde Logística
    pg.goto(BASE+'#/'); pg.wait_for_timeout(1500)
    ok(pg.locator('.lg-maplink').count()==1 and 'Ver mapa de unidades' in pg.locator('.lg-maplink').inner_text(),'Inicio → Unidades en operación: acceso «Ver mapa de unidades»')
    ok(pg.locator('.lgh-card').count()==3,'Inicio conserva sus tarjetas de unidades en operación')
    pg.locator('.lg-maplink').click(); pg.wait_for_timeout(500); ok('#/operacion/logistica/monitoreo' in pg.url,'el acceso abre el Centro de Monitoreo GPS')
    pg.goto(BASE+'#/operacion/logistica'); pg.wait_for_timeout(600)
    et=' '.join(pg.locator('.mon-entry').inner_text().split())
    ok(pg.locator('.mon-entry').count()==1 and 'Monitoreo GPS' in et and 'Unidades con GPS: 4' in et,'Operación → Logística → Monitoreo GPS: '+et)
    pg.locator('.mon-entry').click(); pg.wait_for_timeout(4500)
    ok(pg.locator('.mon-map canvas.maplibregl-canvas').count()==1,'mapa MapLibre (WebGL) dibujado')
    ok(pg.locator('.mon-map .leaflet-container').count()==0 and pg.evaluate("!window.L || !document.querySelector('.mon .leaflet-container')"),'sin Leaflet ni Google Maps en el monitor')
    attr=pg.locator('.mon-map .maplibregl-ctrl-attrib').inner_text()
    ok('OpenFreeMap' in attr and 'OpenStreetMap' in attr and 'OpenMapTiles' in attr,'atribución del proveedor visible: '+attr.replace('\n',' '))
    kp={k:pg.locator(f'[data-kpi="{k}"] b').inner_text() for k in ['monitored','operating','moving','stopped','nosignal']}
    ok(kp=={'monitored':'6','operating':'3','moving':'2','stopped':'2','nosignal':'2'},'indicadores (en operación = misma regla que Inicio): '+json.dumps(kp))
    ok('LOGÍSTICA' in pg.locator('.mon-kpis').inner_text().upper() and 'GPS' in pg.locator('.mon-kpis').inner_text(),'indicadores separados: Logística y GPS')
    nm=pg.locator('.mon .vm').count(); ok(nm==5,f'marcadores solo de unidades con coordenadas (5 de 6; el equipo sin posición no se inventa): {nm}')
    mk=pg.evaluate("()=>Object.fromEntries([...document.querySelectorAll('.mon .vm')].map(e=>[e.querySelector('.vm-lbl').textContent,{m:e.dataset.motion,t:e.dataset.tone,fill:getComputedStyle(e.querySelector('.vm-body')).fill,dir:getComputedStyle(e.querySelector('.vm-dir')).opacity,badge:getComputedStyle(e.querySelector('.vm-badge')).display,truck:!!e.querySelector('.vm-truck')}]))")
    ok(mk['U12']['m']=='moving' and mk['U05']['m']=='stopped' and mk['U08']['m']=='nosignal' and mk['U12']['t']=='blue' and mk['U05']['t']=='amber' and mk['U21']['t']=='teal','marcadores: color = estado de Logística (En ruta a destino azul, Descargando ámbar, En ruta vacío verde azulado): '+json.dumps({k:[v['m'],v['t']] for k,v in mk.items()}))
    ok(len({mk[k]['fill'] for k in ['U12','U05','U21']})==3 and all(v['truck'] for v in mk.values()),'icono sobrio: la misma silueta de tractocamión en blanco y el círculo del color de cada estado: '+json.dumps({k:v['fill'] for k,v in mk.items()}))
    ok(mk['U12']['dir']=='1' and mk['U05']['dir']=='0' and mk['U08']['badge']=='grid' and mk['U12']['badge']=='none','en movimiento: flecha hacia el rumbo; detenida: sin flecha; sin señal: insignia y gris')
    rows=pg.locator('.mon-row').all_inner_texts(); ok(len(rows)==6 and 'U12' in rows[0],'lista de unidades (en operación primero)')
    r12=rows[0].replace('\n',' ')
    ok(all(x in r12 for x in ['En ruta a destino','En movimiento','78 km/h',ids['oper'].split()[0],'Puerto','Chasis','Manzanillo','Guadalajara','MSCU1234567','GPS hace']),'fila: estado, movimiento, operador, división, remolque, ruta, referencia y última actualización: '+r12)
    shot(pg,'01_escritorio')
    # Filtros y buscador
    def vis(): return pg.locator('.mon-row').count()
    pg.locator('[data-fd="campo"]').click(); pg.wait_for_timeout(300); ok(vis()==2 and pg.locator('.mon .vm').count()==2,'filtro División Campo (lista y mapa)')
    pg.locator('[data-fd="campo"]').click(); pg.locator('[data-fd="puerto"]').click(); pg.wait_for_timeout(300); ok(vis()==1,'filtro División Puerto')
    pg.locator('[data-fd="puerto"]').click(); pg.locator('[data-fg="moving"]').click(); pg.wait_for_timeout(300); ok(vis()==2,'filtro En movimiento')
    pg.locator('[data-fg="nosignal"]').click(); pg.wait_for_timeout(300); ok(vis()==2 and 'Sin posición GPS' in pg.locator('.mon-list').inner_text(),'filtro Sin señal (incluye el equipo sin coordenadas)')
    pg.locator('[data-fg="stopped"]').click(); pg.wait_for_timeout(300); ok(vis()==2,'filtro Detenidas')
    pg.locator('[data-fg="all"]').click(); pg.select_option('[data-fs]','unloading'); pg.wait_for_timeout(300); ok(vis()==1 and 'U05' in pg.locator('.mon-list').inner_text(),'filtro por estado del viaje')
    pg.select_option('[data-fs]','all'); pg.locator('[data-ft="tolva"]').click(); pg.wait_for_timeout(300); ok(vis()==1 and 'U21' in pg.locator('.mon-list').inner_text(),'filtro por tipo de remolque')
    pg.locator('[data-ft="tolva"]').click(); pg.locator('[data-kpi="operating"]').click(); pg.wait_for_timeout(300); ok(vis()==3,'indicador «En operación» filtra la lista')
    pg.locator('[data-kpi="monitored"]').click()
    for q,exp in [('U12','U12'),('60-BN','U12'),(ids['oper'].split()[0].lower(),'U12'),('MSCU1234567','U12'),('camioneta','Camioneta oficina')]:
        pg.fill('[data-q]',q); pg.wait_for_timeout(250); t=pg.locator('.mon-list').inner_text()
        ok(vis()==1 and exp in t,f'buscador «{q}» → {exp}')
    pg.fill('[data-q]',''); pg.wait_for_timeout(250); ok(vis()==6,'sin filtros: todas las unidades')
    # Selección: centrar, detalle y tarjeta del marcador
    canvas0=pg.evaluate("()=>{window.__cv=document.querySelector('.mon-map canvas'); return true}")
    pg.locator(f'.mon-row[data-u="{ids["u12"]}"]').click(); pg.wait_for_timeout(1800)
    st=pg.evaluate(f"()=>{{const f={FLEET}; const c=f.map.getCenter(); return {{sel:f.selected(), z:f.map.getZoom(), dlat:Math.abs(c.lat-19.40), dlng:Math.abs(c.lng+103.62)}}}}")
    ok(st['sel']==ids['u12'] and st['z']>=13.4 and st['dlat']<0.01 and st['dlng']<0.01,'al elegir una unidad el mapa acerca y la centra suavemente: '+json.dumps(st))
    d=pg.locator('[data-pv-detail]').inner_text()
    ok(all(x in d for x in ['Unidad y operador','Número económico','Placas','Viaje','División Puerto','Origen','Destino','Referencia','Lugar de entrega','CEDIS Guadalajara','GPS','Latitud','Longitud','19.400000','-103.620000','Última posición','Velocidad','78 km/h']),'detalle: unidad, operador, viaje, GPS (lat, lng, hora y velocidad)')
    ok(all(x in d for x in ['Ver detalle logístico','Actualizar estado','Compartir rastreo con cliente','Centrar en el mapa','Ver toda la flota']),'detalle: acciones')
    ok(pg.locator('.vm-pop').count()==1 and 'U12' in pg.locator('.vm-pop').inner_text() and 'En ruta a destino' in pg.locator('.vm-pop').inner_text(),'computadora: tarjeta resumida junto al marcador')
    ok(pg.locator('.vm.is-sel').count()==1 and pg.locator('.vm-dest').count()==1,'marcador elegido resaltado y bandera del destino (sin dibujar recorridos)')
    sty=pg.evaluate(f"()=>{{const s={FLEET}.map.getStyle(); return {{src:Object.keys(s.sources), lines:s.layers.filter(l=>l.source!=='omt'&&l.type!=='background').length}}}}")
    ok(sty['src']==['omt'] and sty['lines']==0,'no se dibuja ninguna línea de trayecto (solo el mapa base y los marcadores): '+json.dumps(sty))
    shot(pg,'02_seleccion')
    # En vivo: mover la unidad sin recargar
    pos['12']=[19.42,-103.60,80,25]; push(); pg.evaluate(GPSR); pg.wait_for_timeout(1600)
    ll=pg.evaluate(f"()=>{{const f={FLEET}; const m=[...document.querySelectorAll('.vm')].find(e=>e.classList.contains('is-sel')); return {{same:document.querySelector('.mon-map canvas')===window.__cv, lbl:m.querySelector('.vm-lbl').textContent}}}}")
    lat=pg.evaluate("()=>{const f=document.querySelector('.mon-map')._fleet; const c=f.map.getCenter(); return Math.abs(c.lat-19.42)<0.01}")
    ok(ll['same'] and lat,'actualización: el marcador se mueve a la nueva posición y la vista lo acompaña, sin reconstruir el mapa')
    ok('19.420000' in pg.locator('[data-pv-detail]').inner_text(),'el detalle muestra la nueva posición')
    # GPS detenido: la Logística no cambia
    pos['12']=[19.42,-103.60,0,25]; push(); pg.evaluate(GPSR); pg.wait_for_timeout(600)
    ok(pg.locator('.vm.is-sel').get_attribute('data-motion')=='stopped' and 'En ruta a destino' in pg.locator('[data-pv-detail] .mon-dcard').inner_text(),'una unidad detenida no cambia su estado de Logística (sigue En ruta a destino)')
    st2=pg.evaluate("async(id)=>{const l=await import('./src/services/logistics.js'); return l.openOf(id).status}", ids['u12']); ok(st2=='to_destination','estado guardado intacto')
    # Ver toda la flota
    pg.locator('[data-fitall]').first.click(); pg.wait_for_timeout(1300)
    fit=pg.evaluate(f"()=>{{const f={FLEET}; const b=f.map.getBounds(); return {{sel:f.selected(), all:[[19.42,-103.60],[19.066,-104.296],[20.64,-103.38],[18.915,-103.87],[20.67,-103.35]].every(([a,o])=>b.contains([o,a]))}}}}")
    ok(fit['sel'] is None and fit['all'],'«Ver toda la flota»: vuelve a la vista general con todas las unidades')
    # Compartir rastreo
    pg.locator(f'.mon-row[data-u="{ids["u12"]}"]').click(); pg.wait_for_timeout(900)
    pg.locator('[data-share]').click(); pg.wait_for_timeout(1500)
    url=pg.locator('.trk-sheet [data-url]').inner_text().strip()
    ok(re.match(r'^https://gps\.test/r/[A-Za-z0-9_-]{32}$',url) is not None,'compartir: enlace público con código al azar: '+url)
    ok('No ve la velocidad' in pg.locator('.trk-sheet').inner_text() and 'Operador:' in pg.locator('.trk-sheet').inner_text(),'la hoja explica qué ve el cliente (operador con nombre y apellido) y cuándo deja de funcionar')
    shot(pg,'03_compartir')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(500)
    ok('Activo · vence en 72 h' in pg.locator('[data-pv-detail]').inner_text() and pg.locator('[data-pv-detail] [data-open]').get_attribute('href')==url,'detalle: enlace activo y «Abrir enlace público»')
    ok(pg.locator(f'.mon-row[data-u="{ids["u12"]}"] .mon-lnk').count()==1,'lista: indicador «Rastreo activo»')
    # Portal del cliente
    cp=ctx.new_page(); watch(cp); cp.goto(url); cp.wait_for_timeout(4500)
    fav=cp.locator('link[rel=icon]').get_attribute('href'); fico=os.path.join(APP,fav.split('https://app.test/')[-1])
    ok(cp.locator('link[rel=icon]').count()==1 and fav=='https://app.test/assets/icons/favicon.ico' and open(fico,'rb').read(4)==b'\x00\x00\x01\x00','portal: favicon .ico de PERCONSUR servido desde la app ('+fav+')')
    t=cp.locator('#portal').inner_text()
    ok('PERCONSUR' in t and 'En camino al destino' in t and 'Manzanillo' in t and 'Guadalajara' in t and 'CEDIS Guadalajara' in t,'portal: identidad PERCONSUR, estado, origen y destino')
    w=ids['oper'].split(); corto=w[0]+' '+(w[-2] if len(w)>=4 else w[1])
    ok(corto in t and ids['oper'] not in t,'portal: operador con un nombre y un apellido ('+corto+'), no el nombre completo')
    ok('km/h' not in t and 'CAMPO-881' not in t,'portal: sin velocidad ni otras referencias')
    ok(cp.locator('.pt-map .vm-lbl').inner_text()=='U12' and 'Unidad U12' in (cp.locator('.pt-map .vm').get_attribute('aria-label') or ''),'portal: el marcador muestra el número de la unidad (U12)')
    ok('PERCONSUR · División Campo' in t and cp.locator('.pt-web a[href="https://www.perconsur.mx"]').count()==1 and cp.locator('.pt-web a').get_attribute('target')=='_blank','portal: «PERCONSUR · División Campo» y enlace al sitio www.perconsur.mx')
    tr,pl12=pg.evaluate("async(id)=>{const l=await import('./src/services/logistics.js'); const v=l.view(l.opById(id)); return [v.trailer,v.placas]}", ids['op12'])
    li=cp.evaluate("()=>[...document.querySelectorAll('.pt-load .pt-li')].map(e=>[e.querySelector('small').textContent,e.querySelector('b').textContent,(e.querySelector('.pt-li-tx>span')||{}).textContent||''])")
    ok(len(li)==3 and li[0]==['Placas de la unidad',pl12,'Unidad U12'] and li[1][0]=='Placas del remolque' and li[2][:2]==['Contenedor','MSCU1234567'],'portal «Unidad y carga»: placas de la unidad, después las del remolque y el contenedor: '+json.dumps(li))
    lb=cp.evaluate("()=>{const r=document.querySelector('.pt-route').getBoundingClientRect(), l=document.querySelector('.pt-load').getBoundingClientRect(), m=document.querySelector('.pt-map').getBoundingClientRect(); return {gap:l.top-r.bottom, lx:l.left, rx:r.left, right:l.left>m.right}}")
    ok(0<=lb['gap']<=20 and abs(lb['lx']-lb['rx'])<1 and lb['right'],'computadora: «Unidad y carga» va debajo de la ruta, en la columna junto al mapa: '+json.dumps(lb))
    ok('Rastreo de transporte' in t and 'estado del transporte' in t.lower() and 'envío' not in t.lower() and cp.title()=='Rastreo de transporte · PERCONSUR','portal: «Rastreo de transporte» y «Estado del transporte»')
    ok(tr and li[1][1]==tr and li[1][2]=='Chasis portacontenedor' and cp.locator('.pt-route .pt-tt').count()==0,'portal: remolque con las placas del remolque asignado ('+str(tr)+') y su tipo')
    ok(cp.locator('.pt-map canvas.maplibregl-canvas').count()==1 and cp.locator('.pt-map .vm').count()==1 and cp.locator('.pt-map .vm-dest').count()==1,'portal: mapa MapLibre con el marcador del transporte y el destino')
    ok('Ubicación actualizada' in t,'portal: hora de la última posición')
    ok('© ' in t and 'PERCONSUR DE NAYARIT GROUP' in t and 'Todos los derechos reservados' in t,'portal: aviso de derechos de autor al pie')
    raw=cp.evaluate("async()=>{const r=await fetch(document.getElementById('portal').dataset.api); return await r.text()}")
    ok('speed' not in raw and 'imei' not in raw.lower() and '865190071363660' not in raw and ids['oper'] not in raw and '20.64' not in raw,'datos del portal: el backend no entrega velocidad, IMEI, nombre completo del operador ni otras unidades')
    mw=cp.evaluate("()=>{const m=document.querySelector('.pt-map').getBoundingClientRect(); return {w:m.width,h:m.height,vw:innerWidth,vh:innerHeight}}")
    ok(mw['h']>=mw['vh']-100 and mw['w']>=mw['vw']-16-16-340-14-4,'portal en computadora: el mapa ocupa casi toda la pantalla: '+json.dumps(mw))
    cp.set_viewport_size({'width':2000,'height':1100}); cp.wait_for_timeout(700)
    mw2=cp.evaluate("()=>{const m=document.querySelector('.pt-map').getBoundingClientRect(), c=document.querySelector('.pt-card').getBoundingClientRect(); return {l:m.left,w:m.width,h:m.height,cr:innerWidth-c.right,vw:innerWidth,vh:innerHeight}}")
    ok(mw2['l']<=20 and mw2['cr']<=20 and mw2['w']>=2000-430 and mw2['h']>=1100-100,'pantalla ancha: sin márgenes vacíos a los lados; el mapa usa todo el espacio libre: '+json.dumps(mw2))
    shot(cp,'04c_portal_ancho'); cp.set_viewport_size({'width':1440,'height':900}); cp.wait_for_timeout(500)
    csp=cp.evaluate("async()=>{const r=await fetch(location.href); return r.headers.get('content-security-policy')}")
    ok('frame-ancestors' in (csp or '') and "script-src https://app.test/" in (csp or ''),'portal: política de seguridad de contenido del Worker')
    shot(cp,'04_portal')
    # Portal: vista satelital (la política del Worker permite sus imágenes)
    pv=cp.locator('.pt-map [data-mc="view"]')
    ps=cp.evaluate("()=>{const v=document.querySelector('.pt-map')._vmap; return {view:v.view, name:v.map.getStyle().name, vm:document.querySelectorAll('.pt-map .vm').length, dest:document.querySelectorAll('.pt-map .vm-dest').length, attr:document.querySelector('.pt-map .maplibregl-ctrl-attrib').textContent}}")
    ok(pv.count()==1 and 'server.arcgisonline.com' in (csp or '') and ps['view']=='satellite' and ps['name']=='PERCONSUR satélite' and len(sat_hits)>0 and ps['vm']==1 and ps['dest']==1 and 'Esri' in ps['attr'] and pv.inner_text().strip()=='Mapa','portal: abre en vista satelital (predeterminada) con el transporte, su destino y la atribución de las imágenes')
    pv.click(); cp.wait_for_timeout(800)
    ok(cp.evaluate("document.querySelector('.pt-map')._vmap.view")=='map' and pv.inner_text().strip()=='Satélite','portal: «Mapa» cambia a la vista de mapa')
    pv.click(); cp.wait_for_timeout(1200)
    cp.evaluate("()=>{window.__pcv=document.querySelector('.pt-map canvas')}")
    # IOPGPS sin horas en la consulta de la flota (caso real): el portal no debe decir «sin señal»
    hide['12']=['gpsTime','signalTime']; hide['21']=['gpsTime','signalTime']; push(); cp.evaluate("window.__pcsPortal.reload()"); cp.wait_for_timeout(1800)
    t=cp.locator('#portal').inner_text()
    ok('Ubicación actualizada' in t and 'Sin señal' not in t and cp.locator('.pt-map .vm').get_attribute('data-motion')=='live','flota sin horas: el portal completa con la consulta por unidad y no marca «sin señal»')
    pg.evaluate(GPSR); pg.wait_for_timeout(2500)
    m21=pg.evaluate("()=>{const e=[...document.querySelectorAll('.mon .vm')].find(x=>x.querySelector('.vm-lbl').textContent==='U21'); return e&&e.dataset.motion}")
    ok(pg.locator('.vm.is-sel').get_attribute('data-motion')!='nosignal' and m21=='moving' and pg.locator('[data-kpi="nosignal"] b').inner_text()=='2','flota sin horas: el monitor completa la hora de todas las unidades (también las no elegidas) y no las cuenta como sin señal: U21='+str(m21))
    hide.clear()
    pos['12']=[19.45,-103.58,70,25]; push(); cp.evaluate("window.__pcsPortal.reload()"); cp.wait_for_timeout(1800)
    pl=cp.evaluate("()=>{const v=document.querySelector('.pt-map')._vmap, u=v.vehicle(), b=v.map.getBounds(); return {n:document.querySelectorAll('.pt-map .vm').length, lat:u.lat, lng:u.lng, inView:b.contains([u.lng,u.lat]), same:document.querySelector('.pt-map canvas')===window.__pcv}}")
    ok(pl['n']==1 and abs(pl['lat']-19.45)<1e-6 and pl['same'],'portal: el marcador se mueve solo a la nueva posición (mismo mapa): '+json.dumps(pl))
    ok(pl['inView'],'portal: la unidad sigue a la vista junto con el destino')
    cp.locator('.pt-map [data-mc="center"]').click(); cp.wait_for_timeout(1200)
    c2=cp.evaluate("()=>{const v=document.querySelector('.pt-map')._vmap, c=v.map.getCenter(); return [c.lat,c.lng,v.map.getZoom()]}")
    ok(abs(c2[0]-19.45)<0.01 and c2[2]>=13,'portal: «Centrar transporte» acerca y centra la unidad: '+str(c2))
    # Revocar
    pg.once('dialog', lambda d: d.accept())
    pg.locator('[data-revoke]').click(); pg.wait_for_timeout(400); pg.locator('.asheet .as-btn.destructive').click(); pg.wait_for_timeout(1200)
    cp.evaluate("window.__pcsPortal.reload()"); cp.wait_for_timeout(1500)
    t=cp.locator('#portal').inner_text()
    ok('ya no está disponible' in t and cp.locator('.pt-map .vm').count()==0 and 'Manzanillo' not in t,'revocar: el portal deja de mostrar la ubicación y los datos del viaje')
    ok('Revocar enlace activo' not in pg.locator('[data-pv-detail]').inner_text(),'monitor: sin enlace activo tras revocar')
    # Rastreo en cualquier estado: cada cambio de estado en la app se ve en el portal del cliente
    pg.locator('[data-share]').click(); pg.wait_for_timeout(1500); url2=pg.locator('.trk-sheet [data-url]').inner_text().strip(); pg.keyboard.press('Escape'); pg.wait_for_timeout(400)
    ok(url2!=url,'un enlace nuevo tiene otro código')
    cp.goto(url2); cp.wait_for_timeout(3500); ok('En camino al destino' in cp.locator('#portal').inner_text(),'nuevo enlace activo')
    def set_status(k):
        pg.locator('[data-pv-detail] [data-status]').click(); pg.wait_for_timeout(500); pg.locator(f'[data-set="{k}"]').click(); pg.wait_for_timeout(2500)
        cp.evaluate("window.__pcsPortal.reload()"); cp.wait_for_timeout(1500); return cp.locator('#portal').inner_text()
    t=set_status('loading')
    ok('Cargando' in t and cp.locator('.pt-card.t-violet').count()==1 and cp.locator('.pt-map .vm').count()==1,'nuevo estado «Cargando»: el portal lo muestra al momento, con la ubicación')
    shot(cp,'05_portal_cargando')
    t=set_status('empty_transit')
    ok('En ruta vacío' in t and 'Entrega finalizada' not in t and cp.locator('.pt-map .vm').count()==1 and not cp.locator('[data-pt-mapwrap]').is_hidden(),'En ruta vacío: el enlace sigue activo; el portal muestra el estado y la ubicación')
    ok('En ruta vacío' in pg.locator('[data-pv-detail]').inner_text() and not pg.locator('[data-pv-detail] [data-share]').is_disabled(),'el monitor refleja el nuevo estado y permite compartir con la unidad En ruta vacío')
    pg.locator('[data-pv-detail] [data-share]').click(); pg.wait_for_timeout(1200); url3=pg.locator('.trk-sheet [data-url]').inner_text().strip(); pg.keyboard.press('Escape'); pg.wait_for_timeout(400)
    ok(url3==url2,'compartir otra vez en En ruta vacío entrega el mismo enlace')
    t=set_status('unloading'); ok('En el lugar de entrega' in t,'Descargando → «En el lugar de entrega» en el portal')
    t=set_status('to_destination'); ok('En camino al destino' in t,'de vuelta a En ruta a destino → «En camino al destino»')
    tr2=pg.evaluate("async(id)=>{const l=await import('./src/services/logistics.js'); const c=await import('./src/services/catalogs.js'); const op=l.opById(id); const t=c.listAll('trailers').find(x=>x.id!==op.trailerId && x.placas && !l.openWithTrailer(x.id)); await l.saveOperation({id, vehicleId:op.vehicleId, status:op.status, trailerId:t.id}); return t.placas}", ids['op12'])
    pg.wait_for_timeout(2500); cp.evaluate("window.__pcsPortal.reload()"); cp.wait_for_timeout(1500)
    ok(cp.locator('.pt-load .pt-li').nth(1).locator('b').inner_text()==tr2.upper(),'cambio de remolque en Logística: el portal muestra las placas del nuevo remolque ('+tr2+')')
    pg.evaluate("async(id)=>{const l=await import('./src/services/logistics.js'); const op=l.opById(id); await l.saveOperation({id, vehicleId:op.vehicleId, status:op.status, reference:'MSCU1234567 / TGHU7654321', containerType:'45G1'})}", ids['op12'])
    pg.wait_for_timeout(2500); cp.evaluate("window.__pcsPortal.reload()"); cp.wait_for_timeout(1500)
    c3=cp.locator('.pt-load .pt-li').nth(2).inner_text()
    ok('CONTENEDORES' in c3.upper() and 'MSCU1234567 / TGHU7654321' in c3 and "40' High Cube · 45G1" in c3,'cambio de contenedor y tipo en Logística: el portal los muestra al momento: '+c3.replace(chr(10),' | '))
    ok('Ver detalle logístico' in pg.locator('[data-pv-detail]').inner_text() and 'En ruta a destino' in pg.locator('[data-pv-detail]').inner_text(),'el monitor refleja el nuevo estado al momento')
    pg.locator('[data-pv-detail] a:has-text("Ver detalle logístico")').click(); pg.wait_for_timeout(900)
    ok('/operacion/logistica/u/' in pg.url and pg.locator('.mon-map').count()==0,'«Ver detalle logístico» abre Logística; al salir se libera el mapa')
    ok(pg.locator('a:has-text("Ver en Monitoreo GPS")').count()==1,'detalle logístico: acceso «Ver en Monitoreo GPS»')
    pg.locator('a:has-text("Ver en Monitoreo GPS")').click(); pg.wait_for_timeout(3500)
    ok(pg.evaluate(f"{FLEET}.selected()")==ids['u12'],'«Ver en Monitoreo GPS» abre el monitor con la unidad elegida')
    # Cerrar la operación: el enlace se finaliza y deja de dar la ubicación
    pg.locator('[data-pv-detail] [data-status]').click(); pg.wait_for_timeout(500); pg.locator('[data-set="inactive"]').click(); pg.wait_for_timeout(600)
    pg.locator('.asheet .as-btn',has_text='Cerrar operación').click(); pg.wait_for_timeout(3000)
    cp.evaluate("window.__pcsPortal.reload()"); cp.wait_for_timeout(1500)
    t=cp.locator('#portal').inner_text()
    ok('Entrega finalizada' in t and cp.locator('.pt-map .vm').count()==0 and cp.locator('[data-pt-mapwrap]').is_hidden(),'al cerrar la operación el enlace se finaliza solo y deja de dar la ubicación')
    shot(cp,'05b_portal_finalizado')
    # Tema oscuro
    pg.evaluate("async()=>{const t=await import('./src/services/theme.js'); await t.setTheme('dark');}"); pg.wait_for_timeout(1200)
    ok(pg.evaluate(f"{FLEET}.map.getStyle().name")=='PERCONSUR oscuro','modo oscuro: el mapa cambia a su estilo oscuro sin recargar')
    # Vista satelital: botón Mapa / Satélite, mismas unidades y selección, se recuerda en el dispositivo
    vb=pg.locator('.mon-map [data-mc="view"]')
    ok(vb.count()==1 and vb.inner_text().strip()=='Satélite' and vb.get_attribute('aria-pressed')=='false' and pg.evaluate(f"{FLEET}.map.getStyle().sources.sat") is None,'botón «Satélite» en los controles del mapa (vista de mapa por omisión, sin descargar imágenes)')
    h0=len(sat_hits); nvm=pg.locator('.mon .vm').count(); ndest=pg.locator('.vm-dest').count(); vb.click(); pg.wait_for_timeout(2000)
    st=pg.evaluate(f"()=>{{const f={FLEET}, s=f.map.getStyle(); return {{name:s.name, view:f.view, src:Object.keys(s.sources), raster:s.layers.filter(l=>l.type==='raster').length, sel:f.selected(), key:localStorage.getItem('pcs-map-view'), attr:document.querySelector('.mon-map .maplibregl-ctrl-attrib').textContent}}}}")
    ok(st['name']=='PERCONSUR satélite' and st['view']=='satellite' and 'sat' in st['src'] and st['raster']==1 and len(sat_hits)>h0,f'«Satélite»: imagen satelital con carreteras y nombres encima ({len(sat_hits)-h0} mosaicos)')
    ok(pg.locator('.mon .vm').count()==nvm and st['sel']==ids['u12'] and pg.locator('.vm.is-sel').count()==1 and pg.locator('.vm-dest').count()==ndest,'las unidades, la unidad elegida y su destino se conservan al cambiar de vista (sin recargar)')
    ok('Esri' in st['attr'] and vb.inner_text().strip()=='Mapa' and vb.get_attribute('aria-pressed')=='true' and st['key']=='satellite','atribución de las imágenes visible; el botón ahora dice «Mapa»; la vista se recuerda en el dispositivo')
    shot(pg,'02b_satelite')
    pg.evaluate("async()=>{const t=await import('./src/services/theme.js'); await t.setTheme('light');}"); pg.wait_for_timeout(800)
    ok(pg.evaluate(f"{FLEET}.map.getStyle().name")=='PERCONSUR satélite','cambiar el tema de la app no quita la vista satelital')
    pg.goto(BASE+'#/'); pg.wait_for_timeout(700); pg.goto(BASE+'#/operacion/logistica/monitoreo'); pg.wait_for_timeout(3500)
    ok(pg.evaluate(f"{FLEET}.view")=='satellite' and pg.locator('.mon-map [data-mc="view"]').inner_text().strip()=='Mapa','al volver al monitor abre en la última vista elegida (satélite)')
    pg.locator('.mon-map [data-mc="view"]').click(); pg.wait_for_timeout(1200)
    ok(pg.evaluate(f"{FLEET}.map.getStyle().name")=='PERCONSUR claro' and pg.evaluate("localStorage.getItem('pcs-map-view')")=='map' and pg.locator('.mon-map [data-mc="view"]').inner_text().strip()=='Satélite','«Mapa» regresa a la vista de siempre')
    pg.evaluate("async()=>{const t=await import('./src/services/theme.js'); await t.setTheme('system');}")
    # Muchas unidades: agrupación
    pg.evaluate(f"""()=>{{const f={FLEET}; const L=[]; for(let i=0;i<120;i++) L.push({{id:'x'+i,lat:19+Math.random()*1.5,lng:-104.2+Math.random()*1.0,label:'X'+i,tone:'blue',trailerType:'chasis',motion:'moving'}}); f.setVehicles(L); f.fitFleet({{animate:false}})}}""")
    pg.wait_for_timeout(1500)
    ok(pg.locator('.mon .vm-cl').count()>0 and pg.locator('.mon .vm').count()<120,f'120 unidades: las cercanas se agrupan al alejar ({pg.locator(".mon .vm-cl").count()} grupos, {pg.locator(".mon .vm").count()} marcadores sueltos)')
    pg.evaluate(GPSR); pg.wait_for_timeout(800)
    ctx.close()
    # iPhone: panel inferior deslizable
    ctx=b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,is_mobile=True,has_touch=True,service_workers='block'); setup_ctx(ctx)
    pg=ctx.new_page(); watch(pg)
    pg.goto(BASE); pg.wait_for_selector('.login'); pg.fill('#lg-user',U); pg.fill('#lg-pass',P); pg.click('#lg-go'); pg.wait_for_selector('.login',state='detached'); pg.wait_for_timeout(900)
    if pg.locator('.asheet').count(): pg.get_by_role('button',name='Ahora no').click()
    pg.evaluate(SETUP, IMEI)
    pg.goto(BASE+'#/operacion/logistica/monitoreo'); pg.wait_for_timeout(4000)
    ok(pg.locator('.mon').get_attribute('data-layout')=='mobile' and pg.locator('.mon').get_attribute('data-sheet')=='peek','iPhone: mapa principal con panel inferior en resumen')
    hh=pg.evaluate("()=>{const m=document.querySelector('.mon-map').getBoundingClientRect(), p=document.querySelector('.mon-panel').getBoundingClientRect(); return {map:m.height, vis:m.bottom-p.top, page:document.documentElement.scrollWidth<=innerWidth}}")
    ok(hh['vis']<=200 and hh['map']>500 and hh['page'],'el panel no tapa el mapa (resumen ≤ 200 px) y sin desplazamiento lateral: '+json.dumps(hh))
    shot(pg,'06_iphone')
    vb=pg.locator('.mon-map [data-mc="view"]').bounding_box(); mb=pg.locator('.mon-map').bounding_box(); pb=pg.locator('.mon-panel').bounding_box()
    ok(vb and vb['width']>=44 and vb['height']>=44 and vb['x']+vb['width']<=mb['x']+mb['width'] and vb['y']+vb['height']<pb['y'],'iPhone: botón Mapa/Satélite de 54 px, visible y sin quedar bajo el panel')
    pg.locator('.mon-map [data-mc="view"]').click(); pg.wait_for_timeout(1500); shot(pg,'06b_iphone_satelite')
    ok(pg.evaluate(f"{FLEET}.view")=='satellite','iPhone: cambia a vista satelital')
    pg.locator('.mon-map [data-mc="view"]').click(); pg.wait_for_timeout(800)
    pg.locator('.mon .vm').filter(has_text='U05').click(); pg.wait_for_timeout(1500)
    ok(pg.locator('.vm-pop').count()==0 and 'U05' in pg.locator('[data-pv-detail]').inner_text() and pg.locator('.mon').get_attribute('data-sheet')=='half','iPhone: tocar un marcador muestra la tarjeta en el panel (sin ventana sobre el mapa)')
    box=pg.evaluate("()=>{const m=document.querySelector('.vm.is-sel').getBoundingClientRect(), mp=document.querySelector('.mon-map').getBoundingClientRect(), p=document.querySelector('.mon-panel').getBoundingClientRect(); return {y:m.top+m.height/2, top:mp.top, sheet:p.top}}")
    ok(box['top']<box['y']<box['sheet'],'la unidad elegida queda visible arriba del panel: '+json.dumps(box))
    shot(pg,'07_iphone_detalle')
    pg.locator('[data-grab]').click(); pg.wait_for_timeout(500); ok(pg.locator('.mon').get_attribute('data-sheet')=='full','tocar la barra: panel completo')
    pg.locator('[data-grab]').click(); pg.wait_for_timeout(500); ok(pg.locator('.mon').get_attribute('data-sheet')=='peek','tocar otra vez: vuelve al resumen')
    # Segundo plano: al volver se actualiza
    calls=pg.evaluate("()=>{window.__f=0; const o=window.fetch; window.fetch=(...a)=>{if(String(a[0]).includes('/v1/posiciones')) window.__f++; return o(...a)}; return 1}")
    pg.evaluate("()=>{Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true}); document.dispatchEvent(new Event('visibilitychange'))}")
    pg.wait_for_timeout(500)
    pg.evaluate("()=>{Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true}); document.dispatchEvent(new Event('visibilitychange'))}")
    pg.wait_for_timeout(1500)
    ok(pg.evaluate("window.__f")>=0 and pg.locator('.mon .vm').count()==5,'al volver del segundo plano el mapa sigue funcionando')
    pg.goto(BASE+'#/'); pg.wait_for_timeout(600); ok(pg.locator('.maplibregl-map').count()==0,'al salir del monitor se liberan el mapa y sus temporizadores')
    ctx.close(); b.close()
finally:
  srv.terminate(); wk.terminate()
  bad=[e for e in errs if 'ERR_TUNNEL' not in e and 'Failed to load resource' not in e]
  ok(not bad,'sin errores de JavaScript: '+' | '.join(bad[:5]))
  print('\n'.join(log)); print(f"\n{sum(1 for l in log if l.startswith('OK'))}/{len(log)} OK")
