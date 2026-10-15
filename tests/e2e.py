import subprocess, time, sys, json, base64, datetime
from playwright.sync_api import sync_playwright

def login(pg):
    import os
    U=os.environ.get('PCS_TEST_USER'); P=os.environ.get('PCS_TEST_PASS')
    if not (U and P): raise SystemExit('Define PCS_TEST_USER y PCS_TEST_PASS (credenciales de acceso de la app)')
    pg.wait_for_selector('.login'); pg.fill('#lg-user',U); pg.fill('#lg-pass',P); pg.click('#lg-go'); pg.wait_for_selector('.login', state='detached', timeout=10000)

import os; APP=os.path.abspath(os.path.join(os.path.dirname(__file__),'..'))
srv = subprocess.Popen([sys.executable,'-m','http.server','8765','--bind','127.0.0.1'], cwd=APP, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
SHIM=open('shims.js').read()
errs=[]; log=[]
def ok(cond,msg):
    log.append(('OK  ' if cond else 'FAIL')+' '+msg)
today=datetime.date.today(); key=today.strftime('%y%m%d'); fecha=today.isoformat()
legacy_photo='data:image/jpeg;base64,'+base64.b64encode(open('legacy.jpg','rb').read()).decode()
draft={'folio':f'50-{key}-007','fecha':fecha,'hora':'08:15','bl':'MEDUAB123456','cartaPorte':'CP-889','pedimento':'26 16 1641 6005426','operador':'JUAN ALBERTO GARCIA CORREA','eco':'21','placasU':'99-ZZ-1A','placasR':'08-UW-6K',
  'destNombre':'ALMACEN CENTRAL','destRFC':'ABC010101AB1','destDir':'Av. Vallarta 100, Zapopan, Jalisco, C.P. 45010','destContacto':'33 1234 5678','obsDan':'','obsFal':'','obs':'Sin novedad','modal':'imp','trafico':'FCL','custodia':True,
  'track':'tinyurl.com/MSCU1234565','showTrack':True,'citaFecha':fecha,'citaHora':'14:30','terminal':'SSA','rfcE':'PNG120101AA1','rfcR':'',
  'conts':[{'num':'MSCU1234565','tipo':"40' HC",'sello':'S-1','merc':'Refacciones','bultos':'12','peso':'18500','tara':'3800','tarifa':'10000','iva':True,'isr':True,'fotos':{'puertas':{'src':legacy_photo,'t':1700000000000}}}]}
campo={'folio':'AU-TEST1234','fecha':fecha,'planta':'Planta Nextipac','units':[{'sol':'4501','eco':'21','op':'Pedro Urzúa Serrano','pu':'61-BN-4J','pr':'08-UW-6K','tipo':'Tolva'},{'sol':'4501','eco':'8','op':'Raúl López Martínez','pu':'64-BN-4J','pr':'','tipo':'Jaula'}],
  'hora':'07:30','lugar':'Rancho El Sauz, Tala, Jal.','enc':'Luis Pérez','encTel':'3312345678'}
LS={'ner-company':json.dumps('perconsur'),'ner-folios2':json.dumps({key:7}),'ner-folios2@oasc':json.dumps({key:3}),'ner-folios2@campo':json.dumps({key:40}),
    'ner-placas2':json.dumps({'21':'99-ZZ-1A','33':'11-AA-2B'}),'ner-draft':json.dumps(draft),'ner-step':json.dumps(2),'ner-campo2@campo':json.dumps(campo),'ner-xlmin':'false'}
def shot(pg,name): pg.screenshot(path=f'shots/{name}.png')
import os; os.makedirs('shots',exist_ok=True)
try:
  with sync_playwright() as p:
    b=p.chromium.launch()
    ctx=b.new_context(viewport={'width':390,'height':844}, device_scale_factor=2, is_mobile=True, has_touch=True, accept_downloads=True,
        user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', service_workers='block')
    ctx.route(lambda u: 'cdnjs' in u, lambda r: r.fulfill(status=200, content_type='application/javascript', body=SHIM, headers={'access-control-allow-origin':'*'}))
    ctx.route(lambda u: 'fonts.g' in u, lambda r: r.abort())
    pg=ctx.new_page()
    pg.on('console', lambda m: errs.append(f'{m.type}: {m.text}') if m.type in ('error',) and 'ERR_FAILED' not in m.text else None)
    pg.on('pageerror', lambda e: errs.append('PAGEERROR: '+str(e)))
    pg.goto('http://127.0.0.1:8765/manifest.json')
    pg.evaluate('ls=>{for(const[k,v] of Object.entries(ls)) localStorage.setItem(k,v)}', LS)
    pg.goto('http://127.0.0.1:8765/index.html'); login(pg)
    pg.wait_for_selector('.asheet', timeout=8000); pg.wait_for_timeout(400)
    shot(pg,'01_recuperacion')
    ok(pg.locator('.as-head h2').inner_text()=='Tienes un documento sin terminar','aviso de documento sin terminar al abrir')
    pg.get_by_role('button', name='Ahora no').click(); pg.wait_for_timeout(400)
    shot(pg,'01b_inicio_borradores')
    ok(pg.locator('.draft-card').count()==2,'Inicio muestra 2 documentos sin terminar migrados (Puerto y Campo)')
    pg.locator('[data-continue="puerto:perconsur"]').click(); pg.wait_for_timeout(700)
    ok('/puerto/perconsur/3' in pg.url, 'continúa en el paso guardado (Contenedores): '+pg.url)
    shot(pg,'02_contenedores_migrado')
    ok(pg.locator('[data-b="conts.0.tipo"]').input_value()=='45G1','tipo antiguo 40\' HC migrado a 45G1')
    ok('Línea naviera detectada: MSC' in pg.locator('[data-hint="bl"]').inner_text(),'detecta naviera por BL')
    # paso 1
    pg.locator('[data-w="jump"]').click(); pg.get_by_role('button', name='1. Información').click(); pg.wait_for_timeout(600)
    ok(pg.locator('[data-folio]').inner_text()==f'50-{key}-007','folio migrado conservado')
    shot(pg,'03_informacion')
    pg.locator('[data-w="next"]').click(); pg.wait_for_timeout(600)
    ok(pg.locator('[data-pick="operador"] .pv-v').inner_text()=='Juan Alberto Garcia Correa','operador en mayúsculas convertido a nombre propio')
    shot(pg,'04_transporte')
    pg.locator('[data-pick="eco"]').click(); pg.wait_for_selector('.picker'); pg.wait_for_timeout(300)
    shot(pg,'05_selector_unidad')
    pg.locator('.search-in').fill('33'); pg.wait_for_timeout(150)
    pg.locator('.pk-row',has_text='UNIDAD 033').first.click(); pg.wait_for_timeout(400)
    ok(pg.locator('[data-b="placasU"]').input_value()=='11-AA-2B','placas recordadas del sistema anterior (eco 33) se llenan solas')
    pg.locator('[data-pick="eco"]').click(); pg.wait_for_selector('.picker'); pg.locator('.pk-row',has_text='UNIDAD 021').first.click(); pg.wait_for_timeout(300)
    ok(pg.locator('[data-b="placasU"]').input_value()=='99-ZZ-1A','placas editadas en el sistema anterior prevalecen sobre las originales')
    pg.locator('[data-w="next"]').click(); pg.wait_for_timeout(600)
    pg.locator('[data-act="addCont"]').click(); pg.wait_for_timeout(300)
    n2=pg.locator('[data-b="conts.1.num"]'); n2.fill('tcnu1234567'); pg.wait_for_timeout(100)
    ok(n2.input_value()=='TCNU1234567','número de contenedor en mayúsculas')
    ok('dígito verificador' in pg.locator('[data-chk="1"]').inner_text(),'validación ISO 6346: '+pg.locator('[data-chk="1"]').inner_text())
    ok(pg.locator('[data-act="addCont"]').count()==0,'límite de 2 contenedores')
    pg.locator('[data-b="conts.1.sello"]').fill('s-2'); pg.locator('[data-b="conts.1.peso"]').fill('20,000'); pg.locator('[data-b="conts.1.tara"]').fill('4000')
    ok(pg.locator('[data-bruto="1"]').inner_text()=='24,000','peso bruto automático')
    pg.locator('.card.cont').nth(1).scroll_into_view_if_needed(); shot(pg,'06_contenedor2')
    pg.locator('[data-w="next"]').click(); pg.wait_for_timeout(600)
    ok('Zapopan, JAL' in pg.locator('[data-hint="destDir"]').inner_text(),'destino para Excel (municipio, estado)')
    shot(pg,'07_entrega')
    pg.locator('[data-w="next"]').click(); pg.wait_for_timeout(600)
    ok(pg.locator('[data-imp="0"]').inner_text().replace('\xa0',' ').startswith('$11,200.00'),'importe = tarifa + IVA 16% − ISR 4%: '+pg.locator('[data-imp="0"]').inner_text())
    shot(pg,'08_servicio')
    pg.locator('[data-w="next"]').click(); pg.wait_for_timeout(600)
    ok(pg.locator('.ph.has').count()==1,'foto del borrador anterior migrada como archivo')
    pg.locator('input[data-photo="1"][data-side="frente"]').set_input_files('foto.jpg'); pg.wait_for_timeout(1500)
    pg.locator('input[data-lib="1"]').set_input_files(['foto.jpg','foto.jpg']); pg.wait_for_timeout(2500)
    ok(pg.locator('.card.ev').nth(1).locator('.ph.has').count()==3,'fotos con cámara y desde Fotos asignadas a lados libres')
    pg.locator('input[data-attfile]').set_input_files(['anexo.pdf','anexo.png']); pg.wait_for_timeout(2500)
    ok(pg.locator('.att').count()==2,'archivos adjuntos agregados')
    ok('2 páginas' in pg.locator('.att').first.inner_text(),'cuenta páginas del PDF adjunto')
    pg.locator('[data-att="dn"]').first.click(); pg.wait_for_timeout(300)
    ok('anexo.png' in pg.locator('.att').first.inner_text(),'reordenar adjuntos')
    shot(pg,'09_evidencias'); pg.locator('[data-photos]').scroll_into_view_if_needed(); shot(pg,'09b_fotos')
    # recarga: persistencia
    pg.reload(); pg.wait_for_timeout(1500)
    if pg.locator('.asheet').count(): pg.get_by_role('button', name='Ahora no').click()
    ok(pg.locator('.att').count()==2 and pg.locator('.ph.has').count()==4,'todo persiste tras recargar (fotos y adjuntos)')
    pg.locator('[data-w="next"]').click(); pg.wait_for_timeout(1200)
    shot(pg,'10_revision')
    ok(pg.locator('.issue').count()>=1,'lista de datos pendientes: '+str(pg.locator('.issue').count()))
    pg.locator('.dv-host').scroll_into_view_if_needed(); pg.wait_for_timeout(400); shot(pg,'11_vista_previa')
    pg.locator('[data-act="excel"]').click(); pg.wait_for_selector('.xl-card'); pg.wait_for_timeout(300); shot(pg,'12_excel')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    # ir a pendiente
    pg.locator('.issue').first.click(); pg.wait_for_timeout(800)
    ok('?f=' in pg.url,'pendiente lleva al campo: '+pg.url.split('#')[1])
    pg.locator('[data-w="jump"]').click(); pg.get_by_role('button', name='7. Revisión').click(); pg.wait_for_timeout(900)
    pg.locator('[data-w="next"]').click(); pg.wait_for_selector('.asheet'); pg.wait_for_timeout(300); shot(pg,'13_confirmar')
    pg.get_by_role('button', name='Generar con datos pendientes').click()
    pg.wait_for_url('**/listo/**', timeout=20000); pg.wait_for_timeout(1200)
    shot(pg,'14_whatsapp')
    wa=pg.locator('.wa-bubble').inner_text()
    ok(wa.startswith('Servicio Zapopan, JAL') and 'Fecha cita:' in wa and 'Terminal: SSA' in wa,'resumen WhatsApp con formato original')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(400); shot(pg,'15_generado')
    info=pg.evaluate('''async()=>{ const db=await new Promise(r=>{const q=indexedDB.open('perconsur');q.onsuccess=()=>r(q.result)});
      const g=(s,k)=>new Promise(r=>{const q=db.transaction(s).objectStore(s).get(k);q.onsuccess=()=>r(q.result)});
      const all=s=>new Promise(r=>{const q=db.transaction(s).objectStore(s).getAll();q.onsuccess=()=>r(q.result)});
      const docs=await all('documents'); const d=docs[0]; const pdf=await g('attachments',d.pdfId);
      const doc=await PDFLib.PDFDocument.load(pdf.buf); const drafts=await all('drafts');
      return {pages:doc.getPageCount(), filename:d.filename, previews:d.previewIds.length, drafts:drafts.map(x=>x.id), title:doc.getTitle(),
        sizes: doc.getPages().map(p=>{const s=p.getSize();return Math.round(s.width)+'x'+Math.round(s.height)})}; }''')
    ok(info['pages']==6,'PDF: nota + 2 anexos + adjuntos (png 1 + pdf 2) = 6 páginas → '+str(info))
    ok(info['filename']==f'50-{key}-007.pdf','nombre de archivo = folio')
    ok('puerto:perconsur' not in info['drafts'],'el borrador se elimina al generar')
    pg.get_by_role('button', name='Ir al inicio').click(); pg.wait_for_timeout(800); shot(pg,'16_inicio_con_recientes')
    # documentos y detalle
    pg.locator('.tabbar [data-tab="admin"]').click(); pg.wait_for_timeout(500); pg.locator('.mod-card[href="#/documentos"]').click(); pg.wait_for_timeout(700); shot(pg,'17_documentos')
    pg.locator('.list .row').first.click(); pg.wait_for_timeout(800); shot(pg,'18_detalle')
    pg.get_by_role('button', name='Ver PDF').click(); pg.wait_for_selector('.vw-page'); pg.wait_for_timeout(500); shot(pg,'19_visor')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    with pg.expect_download() as dl: pg.get_by_role('button', name='Compartir').click()
    ok(dl.value.suggested_filename==f'50-{key}-007.pdf','sin hoja de compartir: descarga con el nombre correcto')
    # campo (borrador migrado del formato antiguo)
    pg.locator('.tabbar .tab-new').click(); pg.wait_for_timeout(400); shot(pg,'20_nuevo')
    pg.locator('.new-opt[data-t="campo"]').click(); pg.wait_for_selector('.asheet'); pg.wait_for_timeout(300)
    pg.get_by_role('button', name='Continuar asignación').click(); pg.wait_for_timeout(800)
    shot(pg,'21_campo_carga')
    pg.locator('[data-w="next"]').click(); pg.wait_for_timeout(600); shot(pg,'22_campo_unidades')
    pg.locator('[data-w="next"]').click(); pg.wait_for_timeout(600)
    ok(pg.locator('[data-s="hora"]').first.input_value()=='07:30' and pg.locator('[data-s="tel"]').first.input_value()=='(33) 1234 5678','campo: datos por solicitud migrados del formato antiguo')
    pg.locator('[data-s="maps"]').first.fill('https://maps.app.goo.gl/abc123'); pg.wait_for_timeout(200)
    shot(pg,'23_campo_solicitudes')
    pg.locator('[data-w="next"]').click(); pg.wait_for_timeout(1200); shot(pg,'24_campo_revision')
    pg.locator('[data-w="next"]').click(); pg.wait_for_selector('.asheet')
    pg.locator('.as-btn').filter(has_text='Generar').last.click()
    pg.wait_for_url('**/listo/**', timeout=20000); pg.wait_for_timeout(900); shot(pg,'25_campo_generado')
    cinfo=pg.evaluate('''async()=>{ const db=await new Promise(r=>{const q=indexedDB.open('perconsur');q.onsuccess=()=>r(q.result)});
      const all=s=>new Promise(r=>{const q=db.transaction(s).objectStore(s).getAll();q.onsuccess=()=>r(q.result)});
      const g=(s,k)=>new Promise(r=>{const q=db.transaction(s).objectStore(s).get(k);q.onsuccess=()=>r(q.result)});
      const d=(await all('documents')).find(x=>x.type==='campo'); const pdf=await g('attachments',d.pdfId); const doc=await PDFLib.PDFDocument.load(pdf.buf);
      const p=doc.getPages()[0].getSize(); const ann=doc.getPages()[0].node.Annots(); return {filename:d.filename,size:Math.round(p.width)+'x'+Math.round(p.height),links:ann?ann.size():0}; }''')
    ok(cinfo['size']=='612x396' and cinfo['filename']==f'Asignacion-campo-{fecha}-AU-TEST1234.pdf','campo: media carta horizontal y nombre original → '+str(cinfo))
    ok(cinfo['links']>=2,'campo: QR de solicitud y de planta como enlaces clicables')
    # catálogos y ajustes
    pg.goto('http://127.0.0.1:8765/index.html#/unidades'); pg.wait_for_timeout(900); shot(pg,'26_catalogo_unidades')
    ok('UNIDAD 033' in pg.locator('[data-grid]').inner_text() and '11-AA-2B' in pg.locator('[data-grid]').inner_text(),'catálogo único de unidades incluye las placas migradas')
    pg.goto('http://127.0.0.1:8765/index.html#/ajustes'); pg.wait_for_timeout(900); shot(pg,'27_ajustes')
    folios=pg.evaluate('''async()=>{const db=await new Promise(r=>{const q=indexedDB.open('perconsur');q.onsuccess=()=>r(q.result)});return new Promise(r=>{const q=db.transaction('counters').objectStore('counters').getAll();q.onsuccess=()=>r(q.result.map(x=>x.id+'='+x.n))})}''')
    ok(any(f.endswith(f':{key}=7') and 'perconsur' in f for f in folios) and any('oasc' in f for f in folios) and not any('campo' in f for f in folios),'consecutivos migrados por empresa (sin @campo): '+str(folios))
    with pg.expect_download() as dl2:
        pg.get_by_role('button', name='Exportar respaldo').click(); pg.wait_for_selector('.asheet'); pg.get_by_role('button', name='Solo datos').click()
        pg.wait_for_selector('[data-go]'); pg.locator('[data-go]').click()
    path=dl2.value.path(); bk=json.load(open(path)); ok(bk['app']=='perconsur' and len(bk['data']['documents'])==2,'respaldo JSON exportado: '+dl2.value.suggested_filename)
    # nueva nota OASC: catálogos vacíos + folio serie 70 continúa consecutivo migrado
    pg.goto('http://127.0.0.1:8765/index.html#/'); pg.wait_for_timeout(800)
    if pg.locator('.asheet').count(): pg.get_by_role('button', name='Ahora no').click()
    pg.locator('[data-new="puerto"]').click(); pg.wait_for_selector('.co-opt'); pg.wait_for_timeout(300); shot(pg,'28_empresas')
    pg.locator('.co-opt[data-k="oasc"]').click(); pg.wait_for_timeout(900)
    ok(pg.locator('[data-folio]').inner_text()==f'70-{key}-004','OASC: serie 70 y consecutivo continúa (3 → 004)')
    shot(pg,'29_oasc_info')
    # modo oscuro
    pg.emulate_media(color_scheme='dark'); pg.wait_for_timeout(300); shot(pg,'30_oscuro_wizard')
    pg.goto('http://127.0.0.1:8765/index.html#/'); pg.wait_for_timeout(900)
    if pg.locator('.asheet').count(): pg.get_by_role('button', name='Ahora no').click(); pg.wait_for_timeout(300)
    shot(pg,'31_oscuro_inicio')
    b.close()
finally:
    srv.terminate()
print('\n'.join(log)); print('--- errores ---'); print('\n'.join(errs[:20]) or 'ninguno')
