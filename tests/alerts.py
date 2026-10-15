"""Avisos de punta a punta con el Worker real corriendo en Node (tests/worker_local.mjs: IOPGPS simulado, KV en memoria y
servicios de push de los navegadores simulados): la app publica unidades, geocercas y vencimientos; el dispositivo activa
las notificaciones (suscripción simulada con llaves reales: el aviso se descifra en la página como lo haría el navegador);
la revisión del Worker registra llegadas y salidas y envía los avisos; Avisos, campana de Inicio, sugerencia y cambio
automático de estado en Logística, estancias, resumen diario de vencimientos, geocercas y baja de las notificaciones.
PCS_TEST_USER/PCS_TEST_PASS"""
import subprocess, time, sys, os, json, urllib.request, re, datetime
from zoneinfo import ZoneInfo
from playwright.sync_api import sync_playwright
APP=os.path.abspath(os.path.join(os.path.dirname(__file__),'..')); SH='shots'; os.makedirs(SH,exist_ok=True)
U=os.environ['PCS_TEST_USER']; P=os.environ['PCS_TEST_PASS']
PORT=8816; BASE=f'http://127.0.0.1:{PORT}/index.html'; W='https://gps.test'; WL='http://127.0.0.1:8817'
srv=subprocess.Popen([sys.executable,'-m','http.server',str(PORT),'--bind','127.0.0.1'],cwd=APP,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
wk=subprocess.Popen(['node',os.path.join(APP,'tests','worker_local.mjs'),'8817','https://app.test/',f'http://127.0.0.1:{PORT}'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(1.5)
errs=[]; log=[]
def ok(c,m): log.append(('OK  ' if c else 'FAIL')+' '+m)
def shot(pg,n): pg.screenshot(path=f'{SH}/al_{n}.png')
IMEI={'12':'865190071363660','5':'865190071363661','8':'865190071363662','21':'865190071363663'}
SSA=(19.0601,-104.3001); FAR=(19.30,-104.10); OUT=(19.0700,-104.3000)   # OUT: ~1 km al norte (fuera del radio de 500 m y del margen de salida)
pos={'12':FAR,'5':SSA,'8':(18.915,-103.87),'21':(20.64,-103.38)}
def push_pos():
    now=int(time.time())
    d=[{'imei':IMEI[k],'deviceName':'U'+k,'lat':v[0],'lng':v[1],'speed':0,'gpsTime':now-2,'signalTime':now-1} for k,v in pos.items()]
    urllib.request.urlopen(urllib.request.Request(WL+'/__mock',data=json.dumps({'devices':d}).encode(),method='POST',headers={'Content-Type':'application/json'}))
def tick(now=None): return json.loads(urllib.request.urlopen(urllib.request.Request(WL+'/__tick'+(f'?now={now}' if now else ''),data=b'',method='POST')).read())
def pushes(): return json.loads(urllib.request.urlopen(WL+'/__pushes').read())
def to_worker(route, req): r=route.fetch(url=req.url.replace(W,WL)); route.fulfill(response=r)
def setup_ctx(ctx):
    ctx.route(lambda u:'cdnjs' in u or 'fonts.g' in u or 'openfreemap' in u or 'nominatim' in u or 'arcgisonline' in u, lambda r:r.abort())
    ctx.route(W+'/**', to_worker)
def watch(pg):
    pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m: errs.append('console: '+m.text) if m.type=='error' else None)
TODAY=datetime.datetime.now(ZoneInfo('America/Mexico_City')).date()
D=lambda n: (TODAY+datetime.timedelta(days=n)).isoformat()
# Suscripción de push simulada: llaves P-256 reales generadas en la página (el aviso se descifra aquí con la llave privada)
FAKE_PUSH="""(()=>{
  const b64u=(a)=>btoa(String.fromCharCode(...new Uint8Array(a))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
  const st={sub:null}; let perm='default';
  try{Object.defineProperty(Notification,'permission',{get:()=>perm,configurable:true}); Notification.requestPermission=async()=>{perm='granted';return perm;};}catch(e){}
  async function mk(key){const k=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']); const raw=new Uint8Array(await crypto.subtle.exportKey('raw',k.publicKey)); const auth=crypto.getRandomValues(new Uint8Array(16));
    window.__pushKeys={k,raw,auth}; const endpoint='https://fcm.googleapis.com/fcm/send/prueba-'+Date.now();
    return {endpoint,options:{applicationServerKey:key},toJSON(){return {endpoint,keys:{p256dh:b64u(raw),auth:b64u(auth)}}},async unsubscribe(){st.sub=null;return true;}};}
  const pm={async getSubscription(){return st.sub;},async subscribe(o){st.sub=await mk(o.applicationServerKey);return st.sub;}};
  const reg={pushManager:pm,scope:location.origin+'/',update:async()=>{},addEventListener(){},waiting:null,installing:null,active:null};
  if(navigator.serviceWorker){Object.defineProperty(navigator.serviceWorker,'getRegistration',{value:async()=>reg,configurable:true}); Object.defineProperty(navigator.serviceWorker,'ready',{get:()=>Promise.resolve(reg),configurable:true});}
  window.__decrypt=async(b64)=>{const b=Uint8Array.from(atob(b64),c=>c.charCodeAt(0)), salt=b.slice(0,16), n=b[20], asPub=b.slice(21,21+n), ct=b.slice(21+n), K=window.__pushKeys;
    const asKey=await crypto.subtle.importKey('raw',asPub,{name:'ECDH',namedCurve:'P-256'},false,[]);
    const sh=new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:asKey},K.k.privateKey,256));
    const hk=async(s,ikm,info,len)=>new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt:s,info},await crypto.subtle.importKey('raw',ikm,'HKDF',false,['deriveBits']),len*8));
    const te=new TextEncoder(), cat=(...a)=>{const o=new Uint8Array(a.reduce((x,y)=>x+y.length,0));let i=0;for(const x of a){o.set(x,i);i+=x.length;}return o;};
    const ikm=await hk(K.auth,sh,cat(te.encode('WebPush: info\\0'),K.raw,asPub),32);
    const cek=await hk(salt,ikm,te.encode('Content-Encoding: aes128gcm\\0'),16), nonce=await hk(salt,ikm,te.encode('Content-Encoding: nonce\\0'),12);
    const pl=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:nonce},await crypto.subtle.importKey('raw',cek,'AES-GCM',false,['decrypt']),ct));
    let e=pl.length-1; while(e>0&&pl[e]===0)e--; return JSON.parse(new TextDecoder().decode(pl.slice(0,e)));};
})()"""
SETUP="""async(a)=>{const g=await import('./src/services/gps.js'); await g.saveConfig({url:'https://gps.test',key:'clave-app'});
  const c=await import('./src/services/catalogs.js'); const vs=c.listAll('vehicles'); const by=(e)=>vs.find(x=>String(x.eco).replace(/^0+/,'')===e&&!x.mergedInto);
  for (const [e,i] of Object.entries(a.IMEI)) await c.save('vehicles',{...by(e),gpsDeviceId:i,gpsProvider:'iopgps'});
  const t=await c.save('terminals',{name:'Terminal SSA Prueba',address:'',pin:{lat:19.06,lng:-104.30}});
  await c.save('places',{name:'BODEGA SIN UBICACION',rfc:'',address:'',contact:''});
  const l=await import('./src/services/logistics.js'); const o=(await import('./src/services/operators.js')).operatorList();
  const op=await l.saveOperation({vehicleId:by('12').id,operatorId:o[0].id,division:'puerto',status:'to_destination',origin:'Guadalajara',destination:'Manzanillo',deliveryPlace:'Terminal SSA Prueba',reference:'MSCU7654321'});
  const db=await import('./src/services/db.js'), now=Date.now();
  await db.put(db.S.unitDocuments,{id:'ud_al_1',unitId:by('12').id,docType:'insurance',storageKey:'k_al_1',status:'current',kind:'pdf',fileName:'poliza.pdf',uploadedAt:now,verificationStatus:'confirmed',validFrom:a.from,validUntil:a.in7,insurer:'BBVA Seguros',policyNumber:'999B12345X'});
  await db.put(db.S.unitDocuments,{id:'ud_al_2',unitId:by('5').id,docType:'mechanical_inspection',storageKey:'k_al_2',status:'current',kind:'pdf',fileName:'verificacion.pdf',uploadedAt:now,verificationStatus:'confirmed',validFrom:a.from,validUntil:a.ayer});
  const un=await import('./src/services/units.js'); await un.loadUnits(true);
  return {u12:by('12').id,u5:by('5').id,op:op.id,term:t.id}}"""
AL="async(f)=>{const al=await import('./src/services/alerts.js'); return await f(al)}"
def al(pg, body): return pg.evaluate("async()=>{const al=await import('./src/services/alerts.js'); "+body+"}")
try:
  push_pos()
  with sync_playwright() as p:
    b=p.chromium.launch()
    ctx=b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,is_mobile=True,has_touch=True,service_workers='block'); setup_ctx(ctx); ctx.add_init_script(FAKE_PUSH)
    pg=ctx.new_page(); watch(pg)
    pg.goto(BASE); pg.wait_for_selector('.login'); pg.fill('#lg-user',U); pg.fill('#lg-pass',P); pg.click('#lg-go'); pg.wait_for_selector('.login',state='detached'); pg.wait_for_timeout(900)
    if pg.locator('.asheet').count(): pg.get_by_role('button',name='Ahora no').click()
    ids=pg.evaluate(SETUP,{'IMEI':IMEI,'from':D(-358),'in7':D(8),'ayer':D(0)})
    # Publicar lo que se vigila
    pub=al(pg,"return await al.publish({force:true})")
    w=al(pg,"return await al.workerStatus()")
    cfg=al(pg,"return al.buildConfig()")
    tz=[z for z in cfg['zones'] if z['name']=='Terminal SSA Prueba']
    ok(pub and pub['units']==4 and w['config'] and w['config']['units']==4 and w['config']['zones']==pub['zones'] and w['config']['dues']==2,'la app publica al Worker: 4 unidades con GPS, geocercas y 2 documentos con vencimiento: '+json.dumps(pub))
    ok(len(tz)==1 and tz[0]['r']==500 and tz[0]['kind']=='terminal' and all(set(d)=={'id','unit','doc','until'} for d in cfg['dues']) and any(d['unit']=='UNIDAD 012' and d['doc']=='Póliza de seguro' and d['until']==D(8) for d in cfg['dues']),'geocerca de la terminal (500 m); de los documentos solo unidad, tipo y fecha de fin')
    ok(not any('999B12345X' in json.dumps(x) or 'BBVA' in json.dumps(x) for x in cfg['dues']) and not any(z['kind']=='delivery' for z in cfg['zones']),'no se publican datos de la póliza; el destino del viaje usa la geocerca del catálogo')
    pub2=al(pg,"return await al.publish()")
    ok(pub2 and pub2['at']==pub['at'],'sin cambios no se vuelve a publicar')
    # Notificaciones en este dispositivo
    pg.goto(BASE+'#/ajustes'); pg.wait_for_timeout(500)
    ok(pg.locator('a[href="#/ajustes/avisos"]').count()==1 and 'Vencimientos, llegadas y salidas' in pg.locator('a[href="#/ajustes/avisos"]').inner_text(),'Ajustes → Integraciones → Avisos')
    pg.locator('a[href="#/ajustes/avisos"]').click(); pg.wait_for_selector('[data-on]'); pg.wait_for_timeout(600)
    t=pg.locator('.al-set').inner_text()
    ok('Sin revisión programada' in t and 'Cron Triggers' in t and '*/5 * * * *' in t,'sin Cron Trigger: explica cómo activar la revisión automática')
    ok(pg.locator('[data-pref="due"]').is_checked() and pg.locator('[data-pref="geo"]').is_checked() and 'Resumen de vencimientos a las 8:00' in t,'preferencias: vencimientos (resumen 8:00) y llegadas y salidas')
    shot(pg,'01_ajustes')
    pg.locator('[data-on]').click(); pg.wait_for_selector('[data-test]',timeout=8000); pg.wait_for_timeout(500)
    w=al(pg,"return await al.workerStatus()")
    ok('Activas en este dispositivo' in pg.locator('[data-push]').inner_text() and w['subscriptions']==1,'«Activar notificaciones»: el dispositivo queda suscrito en el Worker')
    n0=len(pushes()); pg.locator('[data-test]').click(); pg.wait_for_timeout(1200)
    ps=pushes(); m=pg.evaluate("async(b)=>await window.__decrypt(b)",ps[-1]['body']) if len(ps)>n0 else {}
    ok(len(ps)==n0+1 and ps[-1]['url'].startswith('https://fcm.googleapis.com/') and ps[-1]['headers']['Content-Encoding']=='aes128gcm' and ps[-1]['headers']['Authorization'].startswith('vapid t=') and m.get('title')=='Avisos de PERCONSUR activos','aviso de prueba: cifrado de punta a punta y firmado (VAPID); el dispositivo lo descifra')
    # Primera revisión: registra quién está dónde (sin avisos falsos)
    r1=tick(); ok(r1['events']==[],'primera revisión: la unidad que ya estaba en la terminal no genera una «llegada» falsa')
    # Resumen de vencimientos: una vez al día desde las 8:00 (mañana: la póliza vence en 7 días y la verificación venció ayer)
    T1=TODAY+datetime.timedelta(days=1); at8=lambda h,mi: int(datetime.datetime(T1.year,T1.month,T1.day,h,mi,tzinfo=datetime.timezone.utc).timestamp()*1000)
    nd=len(pushes()); tick(at8(13,0))   # 7:00 en la Ciudad de México
    early=len(pushes())-nd
    tick(at8(14,30)); tick(at8(16,0))     # 8:30 y 10:00
    msgs=[pg.evaluate("async(b)=>await window.__decrypt(b)",x['body']) for x in pushes()[nd:]]
    due=[x for x in msgs if 'vencer' in x.get('title','') or 'vencidos' in x.get('title','') or 'vencen' in x.get('title','')]
    ok(early==0 and len(due)==1 and 'Vence en 7 días: Póliza de seguro · UNIDAD 012' in due[0]['body'] and 'Venció ayer: Verificación físico-mecánica · UNIDAD 005' in due[0]['body'],'resumen de vencimientos a las 8:00 (no antes) y una sola vez al día: '+json.dumps(due,ensure_ascii=False))
    # La unidad 012 llega a la terminal (destino de su viaje)
    pos['12']=SSA; push_pos(); n1=len(pushes()); r=tick()
    msgs=[pg.evaluate("async(b)=>await window.__decrypt(b)",x['body']) for x in pushes()[n1:]]
    ok(len(r['events'])==1 and r['events'][0]['t']=='enter' and any(x['title']=='Llegada · UNIDAD 012' and 'Terminal SSA Prueba' in x['body'] and x['url']=='#/avisos' for x in msgs),'llegada a la terminal: se registra y llega el aviso «Llegada · UNIDAD 012»')
    pg.goto(BASE+'#/'); pg.wait_for_timeout(500); al(pg,"await al.refreshEvents(); return 1"); pg.wait_for_timeout(400)
    bn=pg.locator('[data-bell-n]')
    ok(pg.locator('.home-bell').count()==1 and bn.is_visible() and int(bn.inner_text())>=2,'Inicio: campana con avisos sin ver ('+bn.inner_text()+': llegada + documento que vence hoy)')
    shot(pg,'02_inicio')
    pg.locator('.home-bell').click(); pg.wait_for_selector('.al-page'); pg.wait_for_timeout(800)
    t=pg.locator('.al-page').inner_text()
    ok('Vencimientos de documentos' in t and 'Póliza de seguro' in t and 'Verificación físico-mecánica' in t and '8 días restantes' in t and 'Vence hoy' in t,'Avisos: vencimientos (vencidos, hoy, 7 y 30 días) con su unidad')
    tiles={x.split('\n')[1]:int(x.split('\n')[0]) for x in pg.locator('.al-tile').all_inner_texts()}
    ok(tiles=={'Vencidos':0,'Vencen hoy':1,'En 7 días':0,'En 30 días':1},'indicadores de vencimientos: '+json.dumps(tiles,ensure_ascii=False))
    ok('En un lugar ahora' in t and t.count('Terminal SSA Prueba')>=2 and 'UNIDAD 005' in t,'«En un lugar ahora»: la unidad 012 y la 005 (que ya estaba ahí) en la terminal')
    ev=pg.locator('.al-ev').first.inner_text()
    ok('UNIDAD 012' in ev and 'Llegó a Terminal SSA Prueba' in ev and pg.locator('.al-ev.new').count()==1,'llegada en la lista, marcada como nueva')
    ok(pg.locator('[data-apply]').count()==1 and 'Cambiar a Descargando' in pg.locator('[data-apply]').inner_text(),'sugerencia: «Cambiar a Descargando» (la unidad llegó al destino de su viaje)')
    shot(pg,'03_avisos')
    pg.locator('[data-apply]').click(); pg.wait_for_timeout(800)
    st=pg.evaluate("async(id)=>{const l=await import('./src/services/logistics.js'); return l.opById(id).status}",ids['op'])
    ok(st=='unloading' and 'Estado cambiado a Descargando' in pg.locator('.al-ev').first.inner_text() and pg.locator('[data-apply]').count()==0,'un toque cambia el estado en Logística y queda registrado en el aviso')
    pg.goto(BASE+'#/'); pg.wait_for_timeout(500)
    ok(not pg.locator('[data-bell-n]').is_visible(),'al abrir Avisos la campana queda sin pendientes')
    # Logística: llegadas y salidas del viaje con el tiempo en el lugar
    pg.goto(BASE+f"#/operacion/logistica/u/{ids['u12']}"); pg.wait_for_timeout(1200)
    t=pg.locator('.lg-detail').inner_text()
    ok('Llegadas y salidas' in t and 'Terminal SSA Prueba' in t and 'sigue en el lugar' in t and 'en el lugar' in t,'detalle de Logística: llegada a la terminal y tiempo que lleva en el lugar')
    # Cambio automático: sale de la terminal → En ruta vacío (bitácora «automático por geocerca»)
    pg.goto(BASE+'#/ajustes/avisos'); pg.wait_for_selector('[data-auto]'); pg.locator('[data-auto]').check(); pg.wait_for_timeout(400)
    ok(al(pg,"return al.prefs().auto")==True,'ajuste «Cambiar el estado automáticamente»')
    pos['12']=OUT; push_pos(); n2=len(pushes()); r=tick()
    msgs=[pg.evaluate("async(b)=>await window.__decrypt(b)",x['body']) for x in pushes()[n2:]]
    ok(len(r['events'])==1 and r['events'][0]['t']=='exit' and any(x['title']=='Salida · UNIDAD 012' and 'estuvo' in x['body'] for x in msgs),'salida de la terminal: aviso con el tiempo que estuvo en el lugar')
    al(pg,"await al.refreshEvents(); return 1"); pg.wait_for_timeout(800)
    op=pg.evaluate("async(id)=>{const l=await import('./src/services/logistics.js'); const o=l.opById(id); return {s:o.status, by:o.statusLog[o.statusLog.length-1].by}}",ids['op'])
    ok(op['s']=='empty_transit' and op['by']=='Geocerca' and 'Cambio automático por geocerca' in pg.locator('.toast-host').inner_text(),'con el ajuste activo el estado cambia solo a En ruta vacío (bitácora: Geocerca) y se avisa: '+json.dumps(op))
    pg.goto(BASE+f"#/operacion/logistica/u/{ids['u12']}"); pg.wait_for_timeout(1200)
    t=pg.locator('.lg-detail').inner_text()
    ok('automático por geocerca' in t and re.search(r'Llegó .*salió', t) is not None,'bitácora de estados y estancia completa (llegó · salió)')
    shot(pg,'04_logistica')
    # Geocercas
    pg.goto(BASE+'#/ajustes/avisos/geocercas'); pg.wait_for_timeout(900)
    t=pg.locator('.al-geo').inner_text()
    ok('Terminales portuarias' in t and 'Terminal SSA Prueba' in t and 'Punto fijado en el mapa' in t and 'Sin ubicación exacta' in t and 'BODEGA SIN UBICACION' in t and 'sin dirección ni punto' in t,'geocercas: lugares vigilados y los que no tienen ubicación exacta')
    sel=pg.locator('[data-zr="terminals:'+ids['term']+'"]')
    ok(sel.input_value()=='500','radio de la terminal: 500 m')
    sel.select_option('800'); pg.wait_for_timeout(400)
    cfg=al(pg,"return al.buildConfig()")
    ok([z['r'] for z in cfg['zones'] if z['name']=='Terminal SSA Prueba']==[800],'cambiar el radio a 800 m se refleja en lo que se publica')
    pg.locator('[data-zon="terminals:'+ids['term']+'"]').uncheck(); pg.wait_for_timeout(400)
    cfg=al(pg,"return al.buildConfig()")
    ok(not any(z['name']=='Terminal SSA Prueba' for z in cfg['zones']),'apagar un lugar: deja de vigilarse')
    pg.locator('[data-zon="terminals:'+ids['term']+'"]').check(); pg.wait_for_timeout(300)
    shot(pg,'05_geocercas')
    # Baja de las notificaciones
    pg.goto(BASE+'#/ajustes/avisos'); pg.wait_for_selector('[data-off]'); pg.locator('[data-off]').click(); pg.wait_for_selector('[data-on]'); pg.wait_for_timeout(300)
    ok(al(pg,"return (await al.workerStatus()).subscriptions")==0,'«Desactivar»: el Worker deja de enviar avisos a este dispositivo')
    # Escritorio
    ctx2=b.new_context(viewport={'width':1280,'height':860},service_workers='block'); setup_ctx(ctx2); ctx2.add_init_script(FAKE_PUSH)
    pg=ctx2.new_page(); watch(pg)
    pg.goto(BASE); pg.wait_for_selector('.login'); pg.fill('#lg-user',U); pg.fill('#lg-pass',P); pg.click('#lg-go'); pg.wait_for_selector('.login',state='detached'); pg.wait_for_timeout(900)
    if pg.locator('.asheet').count(): pg.get_by_role('button',name='Ahora no').click()
    pg.evaluate("async()=>{const g=await import('./src/services/gps.js'); await g.saveConfig({url:'https://gps.test',key:'clave-app'});}")
    pg.goto(BASE+'#/avisos'); pg.wait_for_selector('.al-page'); pg.wait_for_timeout(1500)
    t=pg.locator('.al-page').inner_text()
    ok('Llegó a Terminal SSA Prueba' in t and 'Salió de Terminal SSA Prueba' in t and 'Activa las notificaciones' in t,'otro dispositivo: consulta las llegadas y salidas al Worker y ofrece activar sus notificaciones')
    shot(pg,'06_escritorio')
    ctx2.close(); ctx.close(); b.close()
finally:
  srv.terminate(); wk.terminate()
  bad=[e for e in errs if 'ERR_TUNNEL' not in e and 'Failed to load resource' not in e and 'ERR_FAILED' not in e]
  ok(not bad,'sin errores de JavaScript: '+' | '.join(bad[:5]))
  print('\n'.join(log)); print(f"\n{sum(1 for l in log if l.startswith('OK'))}/{len(log)} OK")
