"""Información compartida entre dispositivos, de punta a punta, con el Worker real corriendo en Node
(tests/worker_local.mjs: espacio KV «DATA» en memoria, claves de prueba datos-captura / datos-consulta).
Tres dispositivos (contextos de navegador independientes): A capturista, B consulta (iPhone), C otro teléfono del capturista.
Capturista: publicar la primera vez (archivos + foto comprimida), sin borradores ni claves, publicación automática.
Consulta: recibir sin importar respaldos, solo lectura (botones de captura ocultos, la base rechaza escrituras, rutas de
captura bloqueadas, sin importar respaldos), cambios del capturista y archivos borrados.
Cambio de teléfono: decidir entre recibir la de la nube o reemplazarla; el dispositivo anterior queda detenido (409).
PCS_TEST_USER/PCS_TEST_PASS"""
import subprocess, time, sys, os, json, urllib.request, urllib.parse, gzip
from playwright.sync_api import sync_playwright
APP=os.path.abspath(os.path.join(os.path.dirname(__file__),'..')); SH='shots'; os.makedirs(SH,exist_ok=True)
U=os.environ['PCS_TEST_USER']; P=os.environ['PCS_TEST_PASS']
BASE='http://127.0.0.1:8806/index.html'; W='https://gps.test'; WL='http://127.0.0.1:8807'
srv=subprocess.Popen([sys.executable,'-m','http.server','8806','--bind','127.0.0.1'],cwd=APP,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
wk=subprocess.Popen(['node',os.path.join(APP,'tests','worker_local.mjs'),'8807','https://app.test/'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(1.5)
errs=[]; log=[]
def ok(c,m): log.append(('OK  ' if c else 'FAIL')+' '+m)
def shot(pg,n): pg.screenshot(path=f'{SH}/sync_{n}.png')
def to_worker(route, req):
    r=route.fetch(url=req.url.replace(W,WL)); route.fulfill(response=r)
def setup_ctx(ctx):
    ctx.route(lambda u:'cdnjs' in u or 'fonts.g' in u or 'openfreemap' in u, lambda r:r.abort())
    ctx.route(W+'/**', to_worker)
def watch(pg):
    pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m: errs.append('console: '+m.text) if m.type=='error' else None)
def wget(path, key='datos-consulta', raw=False):
    with urllib.request.urlopen(urllib.request.Request(WL+path, headers={'X-PCS-Data':key})) as r:
        b=r.read(); return (b, {k.lower():v for k,v in r.headers.items()}) if raw else json.loads(b)
def kv(): return {x['k']:x['size'] for x in json.loads(urllib.request.urlopen(WL+'/__data').read())}
ST="async()=>{const s=(await import('./src/services/sync.js')).status(); return {role:s.role,ver:s.ver,phase:s.phase,dirty:s.dirty,error:s.error,conflict:!!s.conflict,pending:s.pendingFiles,remote:s.remote,device:s.device}}"
def wait_sync(pg, cond, timeout=30):
    t=time.time(); s=pg.evaluate(ST)
    while time.time()-t<timeout:
        if cond(s): return s
        pg.wait_for_timeout(300); s=pg.evaluate(ST)
    return s
def login(pg):
    pg.goto(BASE); pg.wait_for_selector('.login'); pg.fill('#lg-user',U); pg.fill('#lg-pass',P); pg.click('#lg-go'); pg.wait_for_selector('.login',state='detached'); pg.wait_for_timeout(900)
    if pg.locator('.asheet').count(): pg.get_by_role('button',name='Ahora no').click()
def configure(pg, key, name=''):
    pg.goto(BASE+'#/ajustes/compartir'); pg.wait_for_selector('.sync-set')
    pg.fill('input[name=url]', W); pg.fill('input[name=key]', key); pg.fill('input[name=name]', name)
    pg.locator('.sync-set button[type=submit]').click(); pg.wait_for_timeout(600)
txt=lambda pg,sel: ' '.join(pg.locator(sel).inner_text().split())
SEED="""async()=>{
  const media=await import('./src/services/media.js'), docs=await import('./src/services/documents.js'), c=await import('./src/services/catalogs.js');
  const l=await import('./src/services/logistics.js'), o=(await import('./src/services/operators.js')).operatorList();
  const pdf=await media.saveBlob(new Blob(['%PDF-1.4 prueba PERCONSUR'],{type:'application/pdf'}),{owner:'doc:d_sync1',kind:'pdf',name:'PCS-0999.pdf'});
  const prev=await media.saveBlob(new Blob([new Uint8Array([255,216,255,224,9,9,9,9])],{type:'image/jpeg'}),{owner:'doc:d_sync1',kind:'preview',name:'pagina-1.jpg'});
  const opPh=await media.saveBlob(new Blob([new Uint8Array([255,216,255,224,7,7])],{type:'image/jpeg'}),{owner:'op:'+o[0].id,kind:'avatar',name:'foto-operador.jpg'});
  const draftPh=await media.saveBlob(new Blob([new Uint8Array([255,216,255,224,1])],{type:'image/jpeg'}),{owner:'draft:dr_sync',kind:'photo',name:'borrador.jpg'});
  const s={folio:'PCS-0999',fecha:'2026-10-09',operador:o[0].name,eco:'12',conts:[],attachments:[]};
  await docs.saveDocument({id:'d_sync1',type:'puerto',company:'perconsur',folio:'PCS-0999',fecha:'2026-10-09',createdAt:Date.now(),status:'generado',
    summary:{empresa:'PERCONSUR',operador:o[0].name,unidad:'U12'},data:s,pdfId:pdf,previewIds:[prev],filename:'PCS-0999.pdf',pages:1,size:25,skipped:[]});
  const v=c.listAll('vehicles').find(x=>String(x.eco).replace(/^0+/,'')==='12');
  const op=await l.saveOperation({vehicleId:v.id,operatorId:o[0].id,division:'puerto',status:'to_destination',origin:'Manzanillo',destination:'Guadalajara',reference:'MSCU7654321'});
  return {pdf,prev,opPh,draftPh,op:op.id,oper:o[0].name}}"""
try:
  with sync_playwright() as p:
    b=p.chromium.launch()
    # ===== A: capturista =====
    ca=b.new_context(viewport={'width':1280,'height':860},service_workers='block'); setup_ctx(ca); a=ca.new_page(); watch(a); login(a)
    ids=a.evaluate(SEED)
    configure(a,'datos-captura','Óscar – iPad')
    sa=wait_sync(a, lambda s: s['ver'] and not s['phase'] and not s['dirty'])
    ok(sa['role']=='write' and sa['ver'] and not sa['error'],'capturista: la clave DATA_WRITE_KEY lo identifica y publica la primera vez: '+json.dumps({k:sa[k] for k in ('role','ver','error')}))
    st=wget('/v1/datos/estado'); pub=st['published']
    ok(st['role']=='read' and pub['ver']==sa['ver'] and pub['device']==sa['device'] and pub['enc']=='gzip' and urllib.parse.unquote(pub['by'])=='Óscar – iPad','la nube tiene su versión (comprimida, con nombre y acentos): '+json.dumps(pub,ensure_ascii=False))
    keys=kv()
    ok(all(('f:'+ids[k]) in keys for k in ('pdf','prev','opPh')) and ('f:'+ids['draftPh']) not in keys and pub['files']==3,'archivos subidos uno por uno (PDF, vista previa, foto de operador); la foto del borrador no: '+str(pub['files']))
    raw,h=wget('/v1/datos',raw=True); snap=json.loads(gzip.decompress(raw)); blob=json.dumps(snap,ensure_ascii=False)
    bad=[t for t in ('datos-captura','clave-app','"buf"','"b64"','dr_sync') if t in blob]
    ok(h.get('x-pcs-enc')=='gzip' and 'drafts' not in snap['data'] and 'settings' not in snap['data'] and not bad,'la foto no lleva borradores, ajustes, claves ni contenido de archivos '+str(bad))
    ok(any(d['id']=='d_sync1' for d in snap['data']['documents']) and any(o['id']==ids['op'] for o in snap['data']['logisticsOperations']) and len(snap['data']['vehicles'])>5,'la foto lleva documentos, Logística y catálogos')
    a.goto(BASE+'#/ajustes/compartir'); a.wait_for_timeout(500)
    ok('Capturista' in txt(a,'[data-state]') and 'Publicado hoy' in txt(a,'[data-state]') and a.locator('[data-pub]').count()==1,'Ajustes → Información compartida: «Capturista · Publicado hoy …» y Publicar ahora: '+txt(a,'[data-state]')[:120])
    shot(a,'01_capturista')
    a.goto(BASE+'#/ajustes'); a.wait_for_timeout(400)
    ok('Información compartida' in txt(a,'.page') and 'Capturista' in txt(a,'a[href="#/ajustes/compartir"]'),'Ajustes → Integraciones muestra el papel del dispositivo')
    a.goto(BASE+'#/'); a.wait_for_timeout(500)
    ok('Compartido · publicado hoy' in txt(a,'[data-syncpill]'),'Inicio del capturista: «'+txt(a,'[data-syncpill]')+'»')
    # Respaldo: sin las claves de la información compartida
    bk=a.evaluate("async()=>{const b=await import('./src/services/backup.js'); const f=await b.exportBackup(); return await f.text()}")
    ok('datos-captura' not in bk and '"syncKey"' not in bk and '"syncDevice"' not in bk and '"syncRole"' not in bk,'el respaldo no incluye la clave, el papel ni el identificador del dispositivo')
    # Publicación automática tras un cambio
    a.evaluate("async(id)=>{const l=await import('./src/services/logistics.js'); await l.setStatus(id,'unloading')}", ids['op']); a.wait_for_timeout(400)
    ok('Cambios por publicar' in txt(a,'[data-syncpill]'),'un cambio queda pendiente: «'+txt(a,'[data-syncpill]')+'»')
    v1=sa['ver']; sa=wait_sync(a, lambda s: s['ver']!=v1 and not s['dirty'] and not s['phase'], timeout=45)
    ok(sa['ver']!=v1 and wget('/v1/datos/estado')['published']['ver']==sa['ver'],'se publica solo unos segundos después del último cambio (sin pulsar nada)')

    # ===== B: consulta (iPhone) =====
    cb=b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,is_mobile=True,has_touch=True,service_workers='block'); setup_ctx(cb); bp=cb.new_page(); watch(bp); login(bp)
    configure(bp,'datos-consulta','Patio')
    ok(bp.locator('.asheet').count()==1 and 'consulta' in bp.locator('.asheet').inner_text(),'antes de recibir se avisa que el dispositivo será de consulta y su información se reemplaza')
    bp.get_by_role('button',name='Continuar',exact=True).click()
    sb=wait_sync(bp, lambda s: s['ver']==sa['ver'] and not s['phase'] and not s['pending'])
    ok(sb['role']=='read' and sb['ver']==sa['ver'] and not sb['error'],'consulta: recibe la versión publicada sin importar respaldos')
    ok(bp.evaluate("document.documentElement.classList.contains('ro')"),'el dispositivo queda en modo solo consulta')
    got=bp.evaluate("async(ids)=>{const m=await import('./src/services/media.js'); const pdf=await m.getBlob(ids.pdf), ph=await m.getBlob(ids.opPh), dr=await m.getBlob(ids.draftPh); const l=await import('./src/services/logistics.js'); const op=l.allRecords().find(o=>o.id===ids.op);"
      "return {pdf:pdf&&pdf.size, type:pdf&&pdf.type, text:pdf&&await pdf.text(), ph:ph&&ph.size, dr:!!dr, st:op&&op.status}}", ids)
    ok(got['pdf']==25 and got['type']=='application/pdf' and 'PERCONSUR' in got['text'] and got['ph']==6 and not got['dr'],'archivos recibidos (PDF y foto del operador, sin la foto del borrador): '+json.dumps(got))
    ok(got['st']=='unloading','Logística al día: el estado que capturó el capturista')
    bp.goto(BASE+'#/'); bp.wait_for_timeout(600)
    ok('Solo consulta · actualizado hoy' in txt(bp,'[data-syncpill]') and 'PCS-0999' in txt(bp,'.home'),'Inicio en consulta: «'+txt(bp,'[data-syncpill]')+'» y el documento del capturista en Recientes')
    ok(not bp.locator('.tab-new').is_visible() and not bp.locator('.div-act').first.is_visible(),'sin botón «Nuevo» ni «Nueva nota / Nueva asignación»')
    shot(bp,'02_consulta_inicio')
    bp.goto(BASE+'#/documentos'); bp.wait_for_timeout(500); ok('PCS-0999' in txt(bp,'.page'),'Documentos: la nota del capturista aparece en la consulta')
    bp.goto(BASE+'#/doc/d_sync1'); bp.wait_for_timeout(900); ok('PCS-0999' in txt(bp,'.page'),'la consulta abre el detalle del documento')
    bp.goto(BASE+'#/operacion/logistica'); bp.wait_for_timeout(700)
    ok('MSCU7654321' in txt(bp,'.page') or 'Guadalajara' in txt(bp,'.page'),'Logística muestra la operación del capturista')
    ok(bp.locator('[data-new]:visible').count()==0,'Logística sin «Nueva asignación»')
    bp.goto(BASE+'#/catalogos/places'); bp.wait_for_timeout(500); ok(bp.locator('[data-add]:visible').count()==0,'Catálogos sin «Agregar»')
    w=bp.evaluate("async()=>{const c=await import('./src/services/catalogs.js'); try{await c.save('places',{name:'Destino de prueba'}); return 'guardó'}catch(e){return e.readOnly?'solo-consulta':e.message}}")
    ok(w=='solo-consulta','la base local rechaza capturas en la consulta (aunque se llegue por código): '+w)
    bp.evaluate("()=>{setTimeout(()=>import('./src/services/catalogs.js').then(c=>c.save('places',{name:'Otro'})),0)}"); bp.wait_for_timeout(700)
    ok('solo consulta' in ' '.join(bp.locator('.toast').all_inner_texts()),'una captura que llega a la base muestra el aviso de solo consulta')
    bp.goto(BASE+'#/campo/1'); bp.wait_for_timeout(700)
    ok(bp.url.endswith('#/') and bp.locator('.wiz').count()==0,'las pantallas de captura (nuevo documento) no se abren en consulta')
    bp.goto(BASE+'#/ajustes'); bp.wait_for_timeout(400)
    ok(bp.locator('[data-import]').count()==0 and 'consulta' in txt(bp,'.page'),'consulta: sin «Importar respaldo»')
    bp.goto(BASE+'#/ajustes/compartir'); bp.wait_for_timeout(500)
    sx=txt(bp,'[data-state]')
    ok('Consulta' in sx and 'Información recibida hoy' in sx and 'Óscar – iPad' in sx and bp.locator('[data-pull]').count()==1,'Ajustes de la consulta: quién publicó y cuándo: '+sx[:140])
    ok(bp.evaluate("document.documentElement.scrollWidth<=innerWidth"),'iPhone: sin desplazamiento lateral')
    shot(bp,'03_consulta_ajustes')
    # Al volver a abrir la app sigue en consulta; ver las pantallas nunca intenta escribir
    bp.goto(BASE+'#/'); bp.wait_for_timeout(300); bp.reload(); bp.wait_for_selector('.home',timeout=15000); bp.wait_for_timeout(800)
    ok(bp.evaluate("document.documentElement.classList.contains('ro')") and 'PCS-0999' in txt(bp,'.home') and not bp.locator('.tab-new').is_visible(),'al reabrir la app arranca en solo consulta con la información recibida')
    seen=[]
    for r in ['#/operacion','#/operacion/logistica','#/operacion/logistica/historial','#/operacion/logistica/vacios','#/operacion/combustible','#/administracion','#/operadores','#/operadores/resumen','#/cobranza','#/catalogos','#/catalogos/vehicles','#/operacion/taller','#/documentos','#/doc/d_sync1','#/ajustes','#/ajustes/gps']:
        bp.goto(BASE+r); bp.wait_for_timeout(450)
        if 'solo consulta' in ' '.join(bp.locator('.toast').all_inner_texts()): seen.append(r)
    ok(not seen,'consulta: recorrer Operación, Taller, Administración, Cobranza, Catálogos, Documentos y Ajustes no intenta capturar nada '+str(seen))
    bp.goto(BASE+'#/ajustes/compartir'); bp.wait_for_selector('.sync-set')
    # El capturista cambia algo y borra un archivo; la consulta lo recibe
    a.evaluate("async(ids)=>{const l=await import('./src/services/logistics.js'); await l.setStatus(ids.op,'empty_transit'); const m=await import('./src/services/media.js'); await m.remove(ids.prev)}", ids)
    a.evaluate("async()=>{const f=await import('./src/services/fulls.js'); const c=await import('./src/services/catalogs.js'); const t=c.listAll('terminals')[0]; await f.create({containerNumber:'MSCU1112223',weightKg:'20000',locationType:'port',terminalId:t.id,scheduledDate:'2026-10-20',scheduledTime:'10:00'})}")
    a.goto(BASE+'#/ajustes/compartir'); a.wait_for_timeout(300); a.locator('[data-pub]').click()
    sa=wait_sync(a, lambda s: not s['dirty'] and not s['phase'])
    ok(('f:'+ids['prev']) not in kv(),'un archivo borrado por el capturista también se borra de la nube')
    bp.evaluate("()=>{window.__fc=0; addEventListener('fulls:change',()=>{window.__fc++})}")
    bp.locator('[data-pull]').click()
    sb=wait_sync(bp, lambda s: s['ver']==sa['ver'] and not s['phase'])
    got=bp.evaluate("async(ids)=>{const m=await import('./src/services/media.js'); const l=await import('./src/services/logistics.js'); return {prev:!!(await m.getBlob(ids.prev)), st:l.allRecords().find(o=>o.id===ids.op).status}}", ids)
    ok(got['st']=='empty_transit' and not got['prev'],'«Revisar ahora»: la consulta recibe el cambio y quita el archivo borrado: '+json.dumps(got))
    fcx=bp.evaluate("async()=>{const f=await import('./src/services/fulls.js'); return {n:window.__fc, has:f.all().some(r=>r.containerNumber==='MSCU1112223')}}")
    ok(fcx['has'] and fcx['n']>0,'Control de llenos: la consulta recibe la carga nueva y sus pantallas reciben el aviso de cambio: '+json.dumps(fcx))

    # ===== C: el capturista cambia de teléfono (otra instalación con la misma clave) =====
    cc=b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,is_mobile=True,has_touch=True,service_workers='block'); setup_ctx(cc); c=cc.new_page(); watch(c); login(c)
    configure(c,'datos-captura','Teléfono nuevo'); c.wait_for_timeout(500)
    sc=c.evaluate(ST)
    ok(c.locator('.sync-dec').count()==1 and 'otro dispositivo' in txt(c,'.sync-dec') and not sc['ver'],'la nube ya tiene información de otro dispositivo: se pide decidir y no se publica nada')
    ok(wget('/v1/datos/estado')['published']['device']==sa['device'],'la información de la nube sigue intacta mientras no se decide')
    ok(c.evaluate("document.documentElement.scrollWidth<=innerWidth"),'iPhone: la decisión cabe sin desplazamiento lateral')
    shot(c,'04_decidir')
    c.locator('[data-adopt]').click(); c.wait_for_timeout(300); c.get_by_role('button',name='Recibir',exact=True).click()
    sc=wait_sync(c, lambda s: s['ver']==sa['ver'] and not s['phase'] and not s['pending'])
    got=c.evaluate("async(ids)=>{const m=await import('./src/services/media.js'); const l=await import('./src/services/logistics.js'); return {pdf:!!(await m.getBlob(ids.pdf)), op:!!l.allRecords().find(o=>o.id===ids.op), ro:document.documentElement.classList.contains('ro')}}", ids)
    ok(got['pdf'] and got['op'] and not got['ro'] and c.locator('.sync-dec').count()==0,'«Recibir la de la nube»: el teléfono nuevo queda igual que la nube y sigue como capturista')
    c.evaluate("async()=>{const c=await import('./src/services/catalogs.js'); await c.save('places',{name:'Destino desde teléfono nuevo'})}")
    c.locator('[data-pub]').click(); sc=wait_sync(c, lambda s: not s['dirty'] and not s['phase'] and s['ver']!=sa['ver'])
    pub=wget('/v1/datos/estado')['published']
    ok(pub['device']==sc['device'] and pub['ver']==sc['ver'] and not sc['error'],'publica desde el teléfono nuevo sin pisar nada (parte de la versión vigente)')
    up=[k for k in kv() if k.startswith('f:')]
    ok(len(up)==2,'lo que ya estaba en la nube no se vuelve a subir: '+str(len(up))+' archivos')
    bp.locator('[data-pull]').click(); wait_sync(bp, lambda s: s['ver']==sc['ver'] and not s['phase'])
    ok(bp.evaluate("async()=>{const c=await import('./src/services/catalogs.js'); return c.listAll('places').some(p=>p.name==='Destino desde teléfono nuevo')}"),'la consulta ve lo que capturó el teléfono nuevo')
    # El dispositivo anterior ya no puede publicar encima
    a.evaluate("async()=>{const c=await import('./src/services/catalogs.js'); await c.save('places',{name:'Destino del iPad viejo'})}")
    a.locator('[data-pub]').click(); sa2=wait_sync(a, lambda s: s['conflict'] and not s['phase'])
    ok(sa2['conflict'] and wget('/v1/datos/estado')['published']['device']==sc['device'],'el dispositivo anterior recibe 409: no pisa la información publicada por el teléfono nuevo')
    a.wait_for_timeout(300)
    ok(a.locator('.sync-dec').count()==1,'y se le pide decidir en Ajustes')
    a.goto(BASE+'#/'); a.wait_for_timeout(400)
    ok('decide' in txt(a,'[data-syncpill]') and a.locator('.sync-pill.warn').count()==1,'Inicio lo avisa: «'+txt(a,'[data-syncpill]')+'»')
    a.goto(BASE+'#/ajustes/compartir'); a.wait_for_timeout(300)
    a.locator('[data-replace]').click(); a.wait_for_timeout(300); a.get_by_role('button',name='Reemplazar',exact=True).click()
    sa=wait_sync(a, lambda s: not s['conflict'] and not s['phase'] and s['remote'] and s['remote'].get('device')==s['device'])
    ok(wget('/v1/datos/estado')['published']['device']==sa['device'],'«Reemplazar la de la nube»: se publica la del dispositivo elegido '+json.dumps({k:sa[k] for k in ('error','conflict','phase','dirty')}))
    bp.locator('[data-pull]').click(); wait_sync(bp, lambda s: s['ver']==sa['ver'] and not s['phase'])
    pl=bp.evaluate("async()=>{const c=await import('./src/services/catalogs.js'); return c.listAll('places').map(p=>p.name)}")
    ok('Destino del iPad viejo' in pl and 'Destino desde teléfono nuevo' not in pl,'la consulta ve exactamente la información elegida')
    # Dejar de compartir en la consulta
    bp.locator('[data-off-btn]').click(); bp.wait_for_timeout(300); bp.get_by_role('button',name='Dejar de compartir').last.click(); bp.wait_for_timeout(500)
    ok(not bp.evaluate("document.documentElement.classList.contains('ro')") and bp.evaluate(ST)['role']=='','«Dejar de compartir»: el dispositivo vuelve a ser independiente')
    bp.goto(BASE+'#/'); bp.wait_for_timeout(400)
    ok(bp.locator('.tab-new').is_visible() and txt(bp,'[data-syncpill]')=='','vuelve el botón «Nuevo» y desaparece el aviso')
    ca.close(); cb.close(); cc.close(); b.close()
finally:
  srv.terminate(); wk.terminate()
  bad=[e for e in errs if 'ERR_TUNNEL' not in e and 'Failed to load resource' not in e]
  ok(not bad,'sin errores de JavaScript: '+' | '.join(bad[:5]))
  print('\n'.join(log)); print(f"\n{sum(1 for l in log if l.startswith('OK'))}/{len(log)} OK")
