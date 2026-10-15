"""Unidades PERCONSUR (Administración → Unidades): catálogo único, expediente, fotografías con fecha de captura (EXIF,
cámara de la app, manual), documentos de las cinco categorías, complemento de pago con detección del periodo (PDF con texto
e imagen con OCR), días restantes y cambio de día, vencimientos, historial, formularios de distintas empresas con el mismo
catálogo (unitId), migración de registros duplicados sin perder relaciones, respaldo y modo consulta.
Fecha fija: 20 de octubre de 2026, 12:00 (hora de la Ciudad de México). PCS_TEST_USER=... PCS_TEST_PASS=... python3 units.py"""
import subprocess, time, sys, os, re, datetime, tempfile, struct
from playwright.sync_api import sync_playwright
HERE=os.path.dirname(os.path.abspath(__file__)); APP=os.path.abspath(os.path.join(HERE,'..')); SH='shots'; os.makedirs(SH,exist_ok=True)
U=os.environ['PCS_TEST_USER']; P=os.environ['PCS_TEST_PASS']; BASE='http://127.0.0.1:8796/index.html'
srv=subprocess.Popen([sys.executable,'-m','http.server','8796','--bind','127.0.0.1'],cwd=APP,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(1)
FD=tempfile.mkdtemp(); errs=[]; log=[]
def ok(c,m): log.append(('OK  ' if c else 'FAIL')+' '+m)
def shot(pg,n,full=False): pg.screenshot(path=f'{SH}/un_{n}.png',full_page=full)
NOW=datetime.datetime(2026,10,20,18,0,0,tzinfo=datetime.timezone.utc)   # 12:00 en la Ciudad de México
def dmy(d): return d.strftime('%d/%m/%Y')
TODAY=datetime.date(2026,10,20)
def newctx(b,**k):
    k.setdefault('viewport',{'width':390,'height':844}); mob=k['viewport']['width']<700
    ctx=b.new_context(device_scale_factor=2,is_mobile=mob,has_touch=mob,service_workers='block',accept_downloads=True,**k)
    ctx.route(lambda u:'cdnjs' in u or 'fonts.g' in u, lambda r:r.abort())
    pg=ctx.new_page(); pg.clock.set_fixed_time(NOW)
    pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m: errs.append('console: '+m.text) if m.type=='error' else None)
    return ctx,pg
def login(pg):
    pg.goto(BASE); pg.wait_for_selector('.login'); pg.fill('#lg-user',U); pg.fill('#lg-pass',P); pg.click('#lg-go'); pg.wait_for_selector('.login',state='detached'); pg.wait_for_timeout(900)
    if pg.locator('.asheet').count(): pg.get_by_role('button',name='Ahora no').click()
def toast(pg): return pg.locator('.toast-host').inner_text() if pg.locator('.toast-host').count() else ''
def choose(pg,sel,path):
    with pg.expect_file_chooser() as fc: pg.locator(sel).first.click()
    fc.value.set_files(path)
def jump(pg,dt):
    """Avanza el reloj; la sesión (12 h) se extiende para simular que la persona sigue con la app abierta"""
    pg.evaluate("(t)=>{const s=JSON.parse(sessionStorage.getItem('pcs-session'));s.exp=t+12*3600000;sessionStorage.setItem('pcs-session',JSON.stringify(s))}",int(dt.timestamp()*1000)); pg.clock.set_fixed_time(dt)
def tab(pg,k): pg.locator(f'[data-sec="{k}"]').click(); pg.wait_for_timeout(250)
def open_unit(pg,uid): pg.goto(BASE+f'#/unidades/{uid}'); pg.wait_for_selector('.uf-page'); pg.wait_for_timeout(300)
def jpeg_with_app1(app1, src=os.path.join(HERE,'foto.jpg')):
    b=open(src,'rb').read(); i=2
    while b[i]==0xFF and b[i+1] in (0xE0,0xE1,0xFE) or (b[i]==0xFF and 0xE2<=b[i+1]<=0xEF): i+=2+struct.unpack('>H',b[i+2:i+4])[0]
    return b[:2]+app1+b[i:]
def pdf_text(pg, lines, path):
    data=pg.evaluate('''async(L)=>{if(!window.jspdf) await new Promise((res,rej)=>{const s=document.createElement('script');s.src='./vendor/jspdf.umd.min.js';s.onload=res;s.onerror=rej;document.head.appendChild(s)});
      const doc=new window.jspdf.jsPDF({unit:'pt',format:'letter'}); doc.setFontSize(9); for(const [x,y,s] of L) doc.text(s,x,y); return Array.from(new Uint8Array(doc.output('arraybuffer')));}''',lines)
    open(path,'wb').write(bytes(data)); return path
def ref_lines(d1,d2,timbrado):
    """Mismo acomodo que el complemento de referencia (BBVA Seguros), con datos ficticios"""
    return [[380,40,'Serie: FF'],[380,52,'Folio: 000000001'],[380,64,f'Fecha y Hora de Timbrado: {timbrado}T01:18:51'],[150,100,'COMPLEMENTO PARA LA RECEPCION DE PAGOS'],
      [40,120,'Nombre del Emisor'],[160,120,'ASEGURADORA DE PRUEBA, S.A. DE C.V.'],[40,170,'PARCIALIDAD 3 de 12'],
      [60,190,'Descripcion'],[180,190,'Identificacion (Poliza)'],[300,190,'Inciso'],[380,190,'Vigencia'],[460,190,'Dias que cubre'],
      [60,204,'Pago'],[180,204,'999X0000ZZ'],[300,204,'0'],[380,204,'1'],[460,204,str((d2-d1).days)],
      [60,224,'Periodo del Recibo (Dia/Mes/Año)'],[260,224,'Tipo de Comprobante'],[420,224,'Clave de Servicio'],[60,238,f'{dmy(d1)} al {dmy(d2)}'],[260,238,'Pago'],[420,238,'84111506 Servicios de facturacion']]
REF_HTML='''<!doctype html><meta charset="utf-8"><body style="margin:0;background:#fff;font:15px Arial;color:#111;width:900px">
<div style="padding:16px 24px"><div style="text-align:right;line-height:1.5">Serie: FF<br>Folio: 000000001<br>Fecha y Hora de Timbrado: 2026-10-14T01:18:51<br>Lugar de Expedición: Ciudad de México</div>
<h3 style="text-align:center;color:#1a3d8f">COMPLEMENTO PARA LA RECEPCIÓN DE PAGOS</h3>
<div style="border:1px solid #1a3d8f;padding:8px">Nombre del Emisor &nbsp; ASEGURADORA DE PRUEBA, S.A. DE C.V.</div>
<b style="color:#1a3d8f">PARCIALIDAD 3 de 12</b>
<table style="width:100%;border-collapse:collapse;text-align:center;margin:6px 0"><tr><th>Descripción</th><th>Identificación (Póliza)</th><th>Inciso</th><th>Vigencia</th><th>Dias que cubre</th></tr>
<tr><td>Pago</td><td>999X0000ZZ</td><td>0</td><td>1</td><td>31</td></tr></table>
<table style="width:100%;border-collapse:collapse;text-align:center"><tr><th>Periodo del Recibo (Dia/Mes/Año)</th><th>Tipo de Comprobante</th><th>Clave de Servicio</th></tr>
<tr><td>{D1} al {D2}</td><td>Pago</td><td>84111506 Servicios de facturación</td></tr></table></div></body>'''
try:
  with sync_playwright() as p:
    b=p.chromium.launch()
    ctx,pg=newctx(b,viewport={'width':390,'height':844}); login(pg)
    ok(pg.evaluate("async()=>(await import('/src/services/units.js')).today()")=='2026-10-20','fecha operativa fija: 20/10/2026 (America/Mexico_City)')
    # ===== Catálogo =====
    pg.goto(BASE+'#/administracion'); pg.wait_for_selector('.mod-card'); pg.wait_for_timeout(300)
    card=pg.locator('.mod-card[href="#/unidades"]')
    ct=card.inner_text() if card.count()==1 else ''
    ok(card.get_attribute('href')=='#/unidades' and '9 unidades' in ct and 'documentación completa' in ct,'Administración → Unidades con resumen real (9 unidades sembradas)')
    pg.goto(BASE+'#/catalogos/vehicles'); pg.wait_for_selector('.un-page'); ok('#/unidades' in pg.url,'Catálogos → Unidades lleva al catálogo único (sin catálogo por empresa)')
    pg.wait_for_timeout(300)
    ok(pg.locator('.un-eyebrow').first.inner_text()=='PERCONSUR' and pg.locator('h1.title').inner_text()=='Unidades' and 'Administración y control documental de la flota PERCONSUR.' in pg.locator('.page-lead').inner_text() and pg.locator('[data-add]').first.inner_text().strip()=='Agregar unidad','encabezado PERCONSUR — UNIDADES, subtítulo y «+ Agregar unidad»')
    k=lambda key: pg.locator(f'[data-kpi="{key}"] b').inner_text()
    ok(k('all')=='9' and k('complete')=='0' and k('incomplete')=='9' and k('soon')=='0' and k('expired')=='0','indicadores reales: 9 unidades, 0 completas, 9 expedientes incompletos')
    ok(pg.locator('.un-card').count()==9 and 'UNIDAD 004' in pg.locator('.un-card').first.inner_text() and 'Documentación: 0/5' in pg.locator('.un-card').first.inner_text(),'tarjetas con número económico, placas y 0/5 documentos requeridos')
    shot(pg,'01_lista',True)
    # Agregar unidad
    pg.locator('[data-add]').first.click(); pg.wait_for_selector('.un-form')
    pg.fill('.un-form [name=eco]','4'); pg.fill('.un-form [name=placas]','ZZ-00-000'); pg.locator('.un-form [type=submit]').click(); pg.wait_for_timeout(400)
    ok('Ya existe la UNIDAD 004' in pg.locator('[data-err="eco"]').inner_text(),'no se duplica un número económico existente')
    pg.fill('.un-form [name=eco]','30'); pg.fill('.un-form [name=placas]','jn-12-345'); pg.fill('.un-form [name=vin]','3akjhhdr1kska1234'); pg.fill('.un-form [name=brand]','Freightliner'); pg.fill('.un-form [name=model]','Cascadia'); pg.fill('.un-form [name=year]','2020')
    pg.select_option('.un-form [name=vehicleType]','tractocamion'); pg.locator('.un-form [type=submit]').click(); pg.wait_for_selector('.uf-page'); pg.wait_for_timeout(400)
    uid=pg.url.split('/unidades/')[1].split('?')[0]
    hero=pg.locator('.uf-hero').inner_text()
    ok('UNIDAD 030' in hero and 'JN-12-345' in hero and 'Freightliner Cascadia' in hero and 'Expediente incompleto' in hero and '0/5' in hero,'1) unidad creada: expediente UNIDAD 030 con placas, marca, modelo y estado documental')
    ok([x.strip() for x in pg.locator('.uf-tab').all_inner_texts()]==['Información','Fotografías','Documentación','Vigencias','Historial'],'expediente en secciones: Información, Fotografías, Documentación, Vigencias, Historial')
    info=pg.locator('.uf-sec').inner_text()
    ok('3AKJHHDR1KSKA1234' in info and 'Tractocamión' in info and uid in info,'datos generales (VIN en mayúsculas, tipo) e identificador interno inmutable')
    # Editar
    pg.locator('.nav-act[data-edit]').click(); pg.wait_for_selector('.un-form'); pg.fill('.un-form [name=placas]','JN-12-346'); pg.fill('.un-form [name=color]','Blanco'); pg.locator('.un-form [type=submit]').click(); pg.wait_for_timeout(500)
    ok('JN-12-346' in pg.locator('.uf-hero').inner_text(),'2) editar unidad: placas actualizadas')
    tab(pg,'docs')
    dc=pg.locator('.uf-sec').inner_text()
    ok(dc.count('Pendiente')>=4 and pg.locator('[data-up]').count()==5 and 'Subir Certificado de Bajas Emisiones Contaminantes' in dc and 'Subir complemento de pago' in dc,'7) documentos pendientes identificados; cinco botones independientes')
    shot(pg,'02_docs_vacio',True)
    # Búsqueda
    pg.goto(BASE+'#/unidades'); pg.wait_for_selector('.un-card'); pg.fill('[data-q]','30'); pg.wait_for_timeout(200); n1=pg.locator('.un-card').count(); t1=pg.locator('.un-card').first.inner_text()
    pg.fill('[data-q]','jn12346'); pg.wait_for_timeout(200); n2=pg.locator('.un-card').count()
    pg.fill('[data-q]','cascadia'); pg.wait_for_timeout(200); n3=pg.locator('.un-card').count(); pg.fill('[data-q]','')
    ok(n1==1 and 'UNIDAD 030' in t1 and n2==1 and n3==1,'3–4) buscar por número económico («30»), placas sin guiones y modelo')
    # ===== Fotografías =====
    app1=bytes(pg.evaluate("async()=>{const m=await import('/src/domain/units/exif.js'); const u=new Uint8Array(m.buildExifJpeg({DateTimeOriginal:'2026:10:12 14:32:05',OffsetTimeOriginal:'-06:00',DateTime:'2026:10:19 09:00:00',Make:'Apple'})); return Array.from(u.slice(2,u.length-2))}"))
    exif=os.path.join(FD,'frontal.jpg'); open(exif,'wb').write(jpeg_with_app1(app1))
    plain=os.path.join(FD,'placas.jpg'); open(plain,'wb').write(open(os.path.join(HERE,'foto.jpg'),'rb').read())
    os.utime(plain,(datetime.datetime(2020,1,1).timestamp(),)*2)
    open_unit(pg,uid); tab(pg,'fotos')
    ok(pg.locator('[data-cam="front"]').count()==1 and pg.locator('[data-lib="front"]').count()==1 and pg.locator('[data-cam="license_plate"]').count()==1 and pg.locator('[data-in-cam]').get_attribute('capture')=='environment','dos campos independientes (frontal y placas) con «Tomar foto» (cámara) y «Elegir foto»')
    choose(pg,'[data-lib="front"]',exif); pg.wait_for_selector('.uf-prev [data-save]'); pg.wait_for_timeout(300)
    pv=pg.locator('.uf-prev').inner_text()
    ok('12 de octubre de 2026, 14:32 (UTC−06:00)' in pv and 'Según los metadatos de la foto (EXIF)' in pv and 'Se registra al guardar' in pv and pg.locator('.uf-prev img').count()==1,'78.5–7) vista previa con fecha original EXIF (no la fecha de modificación) y fecha de carga aparte')
    ok(pg.locator('.uf-prev [data-other]').count()==1 and pg.locator('.uf-prev [data-cancel]').count()==1,'vista previa: Guardar, Seleccionar otra y Cancelar')
    shot(pg,'03_foto_previa')
    pg.locator('.uf-prev [data-save]').click(); pg.wait_for_timeout(800)
    fr=pg.locator('[data-ptype="front"]').inner_text()
    ok('12 de octubre de 2026, 14:32' in fr and 'Fecha de carga' in fr and '20 de octubre de 2026' in fr and 'Guardada' in fr,'78.2/8) foto frontal guardada: captura 12 oct (EXIF) ≠ carga 20 oct')
    # Placas sin EXIF desde Fotos (lastModified 2020 no se usa)
    choose(pg,'[data-lib="license_plate"]',plain); pg.wait_for_selector('.uf-prev [data-save]'); pg.wait_for_timeout(300)
    pv=pg.locator('.uf-prev').inner_text()
    ok('Fecha de captura no disponible' in pv and '2020' not in pv and pg.locator('.uf-prev [data-manual]').count()==1,'78.9) sin EXIF: «Fecha de captura no disponible» (no se usa lastModified ni la fecha de carga)')
    pg.fill('.uf-prev [data-manual]','2026-10-05'); pg.locator('.uf-prev [data-save]').click(); pg.wait_for_timeout(800)
    pl=pg.locator('[data-ptype="license_plate"]').inner_text()
    ok('5 de octubre de 2026' in pl and 'Fecha proporcionada manualmente' in pl,'78.10–11) fecha manual opcional, identificada como «Fecha proporcionada manualmente»')
    # Tomar foto desde la app (sin EXIF): fecha registrada por PERCONSUR
    choose(pg,'[data-cam="front"]',plain); pg.wait_for_selector('.uf-prev [data-save]'); pg.wait_for_timeout(300)
    pv=pg.locator('.uf-prev').inner_text()
    ok('Fecha de captura registrada por PERCONSUR' in pv and '20 de octubre de 2026' in pv and pg.locator('.uf-prev [data-again]').count()==1,'78.1/3) foto tomada con la cámara de la app: «Fecha de captura registrada por PERCONSUR» y «Volver a tomar»')
    pg.locator('.uf-prev [data-save]').click(); pg.wait_for_timeout(800)
    ok(pg.locator('[data-ptype="front"] .uf-old summary').inner_text()=='Fotografías anteriores (1)' and 'registrada por PERCONSUR' in pg.locator('[data-ptype="front"]').inner_text(),'78.12–13) reemplazar foto: la nueva es la principal y la anterior queda en el historial')
    pg.locator('[data-ptype="front"] .uf-phimg').click(); pg.wait_for_selector('.fv-img'); pg.wait_for_timeout(300)
    ok(pg.locator('.fv-img').count()==1 and pg.locator('.fv [data-z="1"]').count()==1,'ampliar fotografía (visor integrado con zoom)'); shot(pg,'04_foto_visor'); pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    heic=pg.evaluate("""async()=>{const m=await import('/src/domain/units/exif.js'), un=await import('/src/services/units.js'); const j=new Uint8Array(m.buildExifJpeg({DateTimeOriginal:'2026:09:30 08:15:00'})); const t=j.slice(12,j.length-2);
      const h=new Uint8Array([0,0,0,24,...'ftypheic'].map(x=>typeof x==='string'?x.charCodeAt(0):x).concat([0,0,0,0,...'mif1heic'].map(x=>typeof x==='string'?x.charCodeAt(0):x),[0,0,0,6,0x45,0x78,0x69,0x66,0,0],[...t]));
      const p=await un.preparePhoto(new File([h],'IMG_0001.HEIC',{type:'image/heic'}),'library'); return {d:p.capturedAt,src:p.captureDateSource,err:p.previewError}}""")
    ok(heic['d']=='2026-09-30T08:15:00' and heic['src']=='exif' and 'HEIC' in heic['err'],'78.15) HEIC: se lee la fecha EXIF; si el navegador no lo muestra se avisa y se conserva el original')
    # ===== Documentos =====
    tab(pg,'docs')
    pg.locator('[data-up="registration"]').click(); pg.wait_for_selector('[data-pick="file"]'); choose(pg,'[data-pick="file"]',os.path.join(HERE,'anexo.png'))
    pg.wait_for_selector('[data-savedoc]'); pg.wait_for_timeout(300); pg.locator('[data-savedoc]').click(); pg.wait_for_timeout(800)
    rg=pg.locator('.uf-doc[data-dtype="registration"]').inner_text()
    ok('Adjuntado' in rg and 'anexo.png' in rg and 'Subido: 20 de octubre de 2026' in rg,'79.1) tarjeta de circulación (imagen): adjuntada con nombre y fecha de carga')
    pg.locator('.uf-doc[data-dtype="registration"] [data-view]').click(); pg.wait_for_selector('.fv-img'); pg.wait_for_timeout(300)
    ok(pg.locator('.fv-img').count()==1 and pg.locator('.fv [data-act="download"]').count()==1,'79.7/9) abrir imagen en el visor y descargar')
    with pg.expect_download() as dl: pg.locator('.fv [data-act="download"]').click()
    ok(dl.value.suggested_filename=='anexo.png' and os.path.getsize(dl.value.path())==os.path.getsize(os.path.join(HERE,'anexo.png')),'79.11) la descarga es el archivo original sin modificar'); pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    # Póliza (PDF): sugerencias del documento que se confirman
    pol=pdf_text(pg,[[40,60,'POLIZA DE SEGURO DE AUTOMOVILES'],[40,80,'Numero de poliza: AB12345678'],[40,100,'Vigencia desde: 01/01/2026 Hasta: 31/12/2026'],[40,120,'Fecha de emision: 15/12/2025']],os.path.join(FD,'poliza.pdf'))
    pg.locator('[data-up="insurance"]').click(); pg.wait_for_selector('[data-pick="file"]'); choose(pg,'[data-pick="file"]',pol)
    pg.wait_for_selector('[data-det]',timeout=20000); pg.wait_for_timeout(300)
    det=pg.locator('[data-det]').inner_text()
    ok('01/01/2026' in det and '31/12/2026' in det,'79.2) póliza: fechas sugeridas desde el documento')
    pg.locator('[data-confirm]').click(); pg.fill('.uf-dflow [name=insurer]','Aseguradora de Prueba'); pg.fill('.uf-dflow [name=policyNumber]','AB12345678'); pg.locator('[data-savedoc]').click(); pg.wait_for_timeout(800)
    ins=pg.locator('.uf-doc[data-dtype="insurance"]').inner_text()
    ok('Vigente' in ins and '31 de diciembre de 2026' in ins and '72 días restantes' in ins,'póliza confirmada: Vigente, vence 31 dic 2026, 72 días restantes')
    # Complemento en PDF (formato de referencia)
    d1=TODAY-datetime.timedelta(days=9); d2=d1+datetime.timedelta(days=31)   # 11/10/2026 al 11/11/2026
    cp1=pdf_text(pg,ref_lines(d1,d2,'2026-10-14'),os.path.join(FD,'complemento-octubre.pdf'))
    pg.locator('[data-up="payment_complement"]').click(); pg.wait_for_selector('[data-pick="file"]'); choose(pg,'[data-pick="file"]',cp1)
    pg.wait_for_selector('[data-det]',timeout=20000); pg.wait_for_timeout(300)
    det=pg.locator('[data-det]').inner_text()
    ok('PERÍODO DETECTADO' in det and 'Inicio\n11/10/2026' in det and 'Fin\n11/11/2026' in det and '¿Son correctas estas fechas?' in det,'80.1/3/6) complemento PDF: PERÍODO DETECTADO 11/10/2026 – 11/11/2026 y pregunta de confirmación')
    ok('Coincide con «Días que cubre: 31»' in det and 'leído del texto del PDF' in det,'el periodo se comprueba con «Días que cubre» y se indica cómo se leyó')
    ok('Fecha de emisión/timbrado 14/10/2026: no es parte del periodo' in det and pg.locator('.uf-dflow [name=issueDate]').input_value()=='2026-10-14','80.4/5) la fecha de timbrado (emisión) se separa del periodo de cobertura')
    shot(pg,'05_periodo_detectado')
    pg.locator('[data-confirm]').click(); pg.wait_for_timeout(150)
    ok(pg.locator('.uf-dflow [name=validFrom]').input_value()=='2026-10-11' and pg.locator('.uf-dflow [name=validUntil]').input_value()=='2026-11-11','80.7) Confirmar llena las fechas confirmadas')
    pg.locator('[data-savedoc]').click(); pg.wait_for_timeout(900)
    cp=pg.locator('.uf-cp').inner_text()
    ok('11/10/2026 — 11/11/2026' in cp and '22 días restantes' in cp and 'Estado: Vigente' in cp and 'Fechas extraídas del documento y confirmadas' in cp,'80.11–12) COMPLEMENTO DE PAGO: cobertura, 22 días restantes, Vigente, fuente de las fechas')
    ok(all(pg.locator(f'.uf-cp [data-{a}]').count()>=1 for a in ['view','up','hist','editdoc']),'acciones: Ver documento, Añadir nuevo, Ver historial, Editar periodo')
    shot(pg,'06_complemento',True)
    # Ver PDF (páginas)
    pg.locator('.uf-cp [data-view]').click(); pg.wait_for_selector('.fv-canvas',timeout=15000); pg.wait_for_timeout(300)
    ok('Página 1 de 1' in pg.locator('.fv [data-pl]').inner_text(),'79.6) abrir PDF dentro de PERCONSUR (páginas)'); pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    # Siguiente complemento en IMAGEN (OCR): próxima cobertura
    n1_=d2; n2_=d2+datetime.timedelta(days=30)
    imgp=os.path.join(FD,'complemento-noviembre.png')
    pg2=ctx.new_page(); pg2.set_content(REF_HTML.replace('{D1}',dmy(n1_)).replace('{D2}',dmy(n2_))); pg2.set_viewport_size({'width':900,'height':480}); pg2.screenshot(path=imgp); pg2.close()
    pg.locator('.uf-cp [data-up]').click(); pg.wait_for_selector('[data-pick="file"]'); choose(pg,'[data-pick="file"]',imgp)
    pg.wait_for_selector('[data-det]',timeout=90000); pg.wait_for_timeout(300)
    det=pg.locator('[data-det]').inner_text()
    ok('11/11/2026' in det and '11/12/2026' in det and 'leído con OCR de la imagen' in det,'80.2) complemento en imagen: periodo leído con OCR (11/11/2026 – 11/12/2026)')
    pg.locator('[data-editdates]').click(); pg.fill('.uf-dflow [name=validUntil]','2026-12-10'); pg.locator('[data-savedoc]').click(); pg.wait_for_timeout(900)
    cp=pg.locator('.uf-cp').inner_text()
    ok('11/10/2026 — 11/11/2026' in cp and 'Próxima cobertura: 11/11/2026 — 10/12/2026' in cp,'80.8/18–19) editar fechas a mano; el complemento vigente sigue siendo el de octubre y el nuevo aparece como «Próxima cobertura»')
    # Ambiguo e ilegible
    amb=pdf_text(pg,[[40,60,'Periodo 01/09/2026 al 30/09/2026'],[40,80,'Periodo 01/10/2026 al 31/10/2026']],os.path.join(FD,'ambiguo.pdf'))
    pg.locator('.uf-cp [data-up]').click(); pg.wait_for_selector('[data-pick="file"]'); choose(pg,'[data-pick="file"]',amb)
    pg.wait_for_selector('[data-det]',timeout=20000); pg.wait_for_timeout(300)
    ok('No fue posible determinar el período con certeza.' in pg.locator('[data-det]').inner_text() and pg.locator('[data-cand]').count()==2,'80.9) varios periodos: «No fue posible determinar el período con certeza» y elegir a mano')
    pg.locator('.uf-dflow [data-cancel]').click(); pg.wait_for_timeout(300)
    blank=os.path.join(FD,'ilegible.png'); pg2=ctx.new_page(); pg2.set_content('<body style="background:#fff;margin:0"><div style="width:600px;height:300px;background:repeating-linear-gradient(45deg,#ddd 0 4px,#fff 4px 9px)"></div></body>'); pg2.set_viewport_size({'width':600,'height':300}); pg2.screenshot(path=blank); pg2.close()
    pg.locator('.uf-cp [data-up]').click(); pg.wait_for_selector('[data-pick="file"]'); choose(pg,'[data-pick="file"]',blank)
    pg.wait_for_selector('[data-det]',timeout=90000); pg.wait_for_timeout(300)
    ok('No fue posible determinar el período con certeza.' in pg.locator('[data-det]').inner_text() and pg.locator('.uf-dflow [name=validFrom]').input_value()=='','80.10) documento ilegible: sin periodo inventado')
    pg.locator('[data-savedoc]').click(); pg.wait_for_timeout(900)
    cp=pg.locator('.uf-cp').inner_text()
    ok('11/10/2026 — 11/11/2026' in cp and 'complemento con periodo por verificar' in cp,'un complemento sin periodo queda «por verificar» y no reemplaza la cobertura vigente')
    pg.locator('.uf-cp [data-hist]').click(); pg.wait_for_selector('.uf-hlist'); pg.wait_for_timeout(200)
    h=pg.locator('.uf-hlist').inner_text()
    ok(pg.locator('.uf-hi').count()==3 and 'Cobertura vigente' in h and 'Próxima cobertura' in h and 'Pendiente de verificación' in h,'80.18/21) historial de complementos: se conservan los tres (vigente, próxima, por verificar)')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    # Periodos encimados
    ov=pg.evaluate(f"""async(uid)=>{{const un=await import('/src/services/units.js'); const d=un.docsByType(uid,'payment_complement').find(x=>x.validFrom==='2026-11-11'); await un.updateDocument(d.id,{{validFrom:'2026-10-15'}}); return true}}""",uid)
    pg.wait_for_timeout(500)
    cp=pg.locator('.uf-cp').inner_text()
    ok('Varios complementos cubren hoy' in cp and 'periodos que se enciman' in cp,'80.20) periodos encimados: se advierte y se pide elegir')
    pg.locator('.uf-cp [data-hist]').click(); pg.wait_for_selector('[data-hsel]'); pg.locator('[data-hsel]').first.click(); pg.wait_for_timeout(600)
    ok('Varios complementos cubren hoy' not in pg.locator('.uf-cp').inner_text(),'elegir la cobertura vigente correcta')
    pg.evaluate(f"""async(uid)=>{{const un=await import('/src/services/units.js'); const d=un.docsByType(uid,'payment_complement').find(x=>x.validFrom==='2026-10-15'); await un.updateDocument(d.id,{{validFrom:'2026-11-11'}}); await un.selectComplement(un.docsByType(uid,'payment_complement').find(x=>x.validFrom==='2026-10-11').id)}}""",uid)
    pg.wait_for_timeout(400)
    # Verificación y certificado
    ver=pdf_text(pg,[[40,60,'CONSTANCIA DE VERIFICACION FISICO-MECANICA'],[40,80,'Folio: VFM-0001'],[40,100,'Vigencia: del 01/05/2026 al 30/10/2026']],os.path.join(FD,'verificacion.pdf'))
    pg.locator('[data-up="mechanical_inspection"]').click(); pg.wait_for_selector('[data-pick="file"]'); choose(pg,'[data-pick="file"]',ver)
    pg.wait_for_selector('[data-det]',timeout=20000); pg.locator('[data-confirm]').click(); pg.fill('.uf-dflow [name=folio]','VFM-0001'); pg.locator('[data-savedoc]').click(); pg.wait_for_timeout(800)
    vm=pg.locator('.uf-doc[data-dtype="mechanical_inspection"]').inner_text()
    ok('Próximo a vencer' in vm and '10 días restantes' in vm,'79.4/80.13) verificación físico-mecánica: Próximo a vencer (10 días)')
    pg.locator('[data-up="low_emissions_certificate"]').click(); pg.wait_for_selector('[data-pick="file"]'); choose(pg,'[data-pick="file"]',os.path.join(HERE,'anexo.pdf'))
    pg.wait_for_selector('[data-savedoc]',state='visible'); pg.wait_for_function("()=>!document.querySelector('.uf-stage').textContent",timeout=90000); pg.locator('[data-savedoc]').click(); pg.wait_for_timeout(800)
    shot(pg,'06b_certificado',True); le=pg.locator('.uf-doc[data-dtype="low_emissions_certificate"]').inner_text()
    ok('Vigencia por verificar' in le,'79.5) Certificado de Bajas Emisiones Contaminantes sin fechas: «Vigencia por verificar» (no se inventa vigencia)')
    hero=pg.locator('.uf-hero').inner_text()
    ok('Expediente incompleto' in hero and 'Documentos completos: 4/5' in hero and 'próximo a vencer' in hero,'8/14) estado: 4/5 (el certificado por verificar no cuenta); aviso aparte de documento próximo a vencer')
    pg.locator('.uf-doc[data-dtype="low_emissions_certificate"] [data-more]').click(); pg.get_by_role('button',name='Editar fechas y datos').click(); pg.wait_for_selector('.op-form [name=validUntil]')
    pg.fill('.op-form [name=issueDate]','2026-04-01'); pg.fill('.op-form [name=validUntil]','2027-04-01'); pg.fill('.op-form [name=folio]','CBE-77'); pg.locator('.op-form [type=submit]').click(); pg.wait_for_timeout(800)
    hero=pg.locator('.uf-hero').inner_text()
    ok('Expediente completo' in hero and '5/5' in hero,'fechas registradas a mano: expediente completo 5/5')
    # Reemplazar tarjeta: versión anterior al historial
    pg.locator('.uf-doc[data-dtype="registration"] [data-more]').click(); pg.get_by_role('button',name='Reemplazar').click(); pg.wait_for_selector('[data-pick="file"]'); choose(pg,'[data-pick="file"]',os.path.join(HERE,'anexo.pdf'))
    pg.wait_for_selector('[data-savedoc]',state='visible'); pg.wait_for_timeout(500); pg.locator('[data-savedoc]').click(); pg.wait_for_timeout(800)
    ok('anexo.pdf' in pg.locator('.uf-doc[data-dtype="registration"]').inner_text(),'79.8) reemplazar archivo')
    tab(pg,'vigencias'); vg=pg.locator('.uf-sec').inner_text()
    ok('Vence: 31/12/2026' in vg and '22 días restantes' in vg and '10 días restantes' in vg and 'Sin fecha de vencimiento' in vg,'vigencias: documento, fecha de vencimiento, días restantes y estado')
    tab(pg,'historial'); hs=pg.locator('.uf-sec').inner_text()
    ev=pg.evaluate(f"async(uid)=>{{const un=await import('/src/services/units.js'); return un.eventsOf(uid).map(e=>e.type)}}",uid)
    ok(all(x in ev for x in ['unit_created','unit_updated','photo_added','photo_replaced','doc_added','doc_replaced','complement_added','dates_changed','complement_selected']) and 'Versiones anteriores de documentos' in hs and 'anexo.png' in hs,'54–56) historial: alta, cambios, fotos, documentos agregados y reemplazados, complementos, vigencias (con fecha y usuario); versión anterior consultable')
    shot(pg,'07_historial',True)
    # Reabrir: documentos recuperados
    pg.reload(); pg.wait_for_selector('.uf-page'); pg.wait_for_timeout(500); tab(pg,'docs')
    ok('22 días restantes' in pg.locator('.uf-cp').inner_text() and pg.locator('.uf-doc [data-view]').count()==4,'79.12) al reabrir se recuperan todos los documentos')
    # ===== Cambio de día =====
    jump(pg,datetime.datetime(2026,10,28,18,0,0,tzinfo=datetime.timezone.utc)); pg.evaluate("window.dispatchEvent(new Event('focus'))"); pg.wait_for_timeout(500)
    cp=pg.locator('.uf-cp').inner_text()
    ok('14 días restantes' in cp and 'Próximo a vencer' in cp,'80.17/37) al cambiar el día se recalcula: 28 oct → 14 días, Próximo a vencer')
    jump(pg,datetime.datetime(2026,11,11,18,0,0,tzinfo=datetime.timezone.utc)); pg.evaluate("document.dispatchEvent(new Event('visibilitychange'))"); pg.wait_for_timeout(500)
    cp=pg.locator('.uf-cp').inner_text()
    ok('Vence hoy' in cp,'80.14) 11 nov: «Vence hoy» (sin números negativos)')
    jump(pg,datetime.datetime(2026,11,12,18,0,0,tzinfo=datetime.timezone.utc)); pg.evaluate("window.dispatchEvent(new Event('focus'))"); pg.wait_for_timeout(500)
    cp=pg.locator('.uf-cp').inner_text()
    ok('11/11/2026 — 10/12/2026' in cp and 'Vigente' in cp,'80.19) 12 nov: la cobertura de noviembre pasa a ser la vigente (identificada por su periodo)')
    pg.evaluate(f"""async(uid)=>{{const un=await import('/src/services/units.js'); for(const d of un.docsByType(uid,'payment_complement').filter(x=>x.validFrom==='2026-11-11'||!x.validFrom)) await un.archiveDocument(d.id)}}""",uid); pg.wait_for_timeout(500)
    cp=pg.locator('.uf-cp').inner_text()
    ok('Vencido' in cp and 'Vencido hace 1 día' in cp,'80.15) sin cobertura vigente: «Vencido hace 1 día» (los archivados se conservan en el historial)')
    pg.goto(BASE+'#/unidades/vencimientos'); pg.wait_for_selector('.un-page'); pg.wait_for_timeout(300)
    pg.locator('[data-win="expired"]').click(); pg.wait_for_timeout(200); al=pg.locator('[data-list]').inner_text()
    ok('UNIDAD 030' in al and 'Complemento de pago' in al and 'Vencido hace 1 día' in al,'42–43) vencimientos: filtro «Vencidos»')
    pg.locator('[data-win="all"]').click(); pg.wait_for_timeout(200); pg.select_option('[data-sort]','type'); pg.wait_for_timeout(200)
    rows=pg.locator('.un-al .row-l2').all_inner_texts()
    ok(len(rows)>=3 and rows[0].startswith('Póliza'),'ordenar por tipo de documento')
    pg.locator('.un-al').first.click(); pg.wait_for_selector('.uf-page'); ok('sec=vigencias' in pg.url,'la alerta abre el expediente')
    jump(pg,NOW)
    # Indicador discreto en el listado
    pg.goto(BASE+'#/unidades'); pg.wait_for_selector('.un-page'); pg.wait_for_timeout(400)
    ok(pg.locator('.un-notice',has_text='por vencer').count()==1 and pg.locator('[data-kpi="soon"] b').inner_text()=='1','44) indicador discreto de documentos por vencer en Unidades (sin ventanas emergentes)')
    pg.locator('[data-f="soon"]').click(); pg.wait_for_timeout(200)
    ok(pg.locator('.un-card').count()==1 and pg.locator('.un-card img').count()==1,'filtro «Próximos vencimientos»; la tarjeta muestra la fotografía frontal')
    shot(pg,'08_lista_filtro')

    # ===== Integración con formularios de empresas =====
    def pick_in_form(path_sel):
        pg.locator(path_sel).click(); pg.wait_for_selector('.picker'); pg.fill('.picker .search-in','30'); pg.wait_for_timeout(250)
        rows=pg.locator('.picker .pk-row').all_inner_texts(); pg.locator('.picker .pk-row',has_text='UNIDAD 030').first.click(); pg.wait_for_timeout(500); return rows
    pg.evaluate("async()=>{const f=await import('/src/ui/flows.js'); for(const c of ['oasc','osc','perconsur']) await f.createPuertoDraft(c)}")
    pg.goto(BASE+'#/puerto/oasc/2'); pg.wait_for_selector('[data-pick="eco"]'); pg.wait_for_timeout(400)
    rows=pick_in_form('[data-pick="eco"]')
    da=pg.evaluate("async()=>{const d=await import('/src/services/drafts.js'); await new Promise(r=>setTimeout(r,900)); const x=await d.getDraft(d.draftId('puerto','oasc')); return x.data}")
    ok(any('UNIDAD 030' in r for r in rows) and pg.locator('[data-b="placasU"]').input_value()=='JN-12-346','81.3/5) empresa OASC: busca «30» en PERCONSUR — Unidades y se autocompletan las placas')
    ok(da.get('unitId')==uid and da.get('eco')=='30','59) el formulario guarda la relación unitId (no solo placas o número)')
    pg.goto(BASE+'#/puerto/osc/2'); pg.wait_for_selector('[data-pick="eco"]'); pg.wait_for_timeout(400); pick_in_form('[data-pick="eco"]')
    ok(pg.locator('[data-b="placasU"]').input_value()=='JN-12-346','81.4) empresa OSC: la misma unidad del mismo catálogo')
    pg.evaluate("async()=>{const d=await import('/src/services/drafts.js'),m=await import('/src/domain/campo/model.js'); await d.saveNow({id:'campo',type:'campo',company:'campo',data:m.cpBlank('2026-10-20'),step:0,createdAt:Date.now()})}")
    pg.goto(BASE+'#/campo/2'); pg.wait_for_selector('[data-pick="units.0.eco"]'); pg.wait_for_timeout(400); pick_in_form('[data-pick="units.0.eco"]')
    dc_=pg.evaluate("async()=>{const d=await import('/src/services/drafts.js'); await new Promise(r=>setTimeout(r,900)); return (await d.getDraft('campo')).data.units[0]}")
    ok(dc_.get('unitId')==uid and dc_.get('pu')=='JN-12-346','División Campo: misma unidad (unitId) y placas')
    # Cambiar placas y número económico: formularios nuevos al día, borradores/documentos ya hechos intactos
    pg.evaluate(f"async(uid)=>{{const un=await import('/src/services/units.js'); await un.saveUnit({{placas:'JN-99-999', eco:'31'}}, uid)}}",uid)
    old=pg.evaluate("async()=>{const d=await import('/src/services/drafts.js'); return (await d.getDraft(d.draftId('puerto','oasc'))).data}")
    ok(old['placasU']=='JN-12-346' and old['unitId']==uid,'60/81.8) el documento en curso conserva los datos con los que se llenó')
    pg.goto(BASE+'#/puerto/perconsur/2'); pg.wait_for_selector('[data-pick="eco"]'); pg.wait_for_timeout(400)
    pg.locator('[data-pick="eco"]').click(); pg.wait_for_selector('.picker'); pg.fill('.picker .search-in','31'); pg.wait_for_timeout(250); pg.locator('.picker .pk-row',has_text='UNIDAD 031').first.click(); pg.wait_for_timeout(400)
    ok(pg.locator('[data-b="placasU"]').input_value()=='JN-99-999','81.6–7) placas y número económico cambiados: los formularios nuevos usan los datos actualizados')
    # Logística, combustible, taller, llenos, vacíos y GPS con la misma unidad
    rel=pg.evaluate(f"""async(uid)=>{{const lg=await import('/src/services/logistics.js'), fu=await import('/src/services/fuel.js'), gps=await import('/src/services/gps.js'), cat=await import('/src/services/catalogs.js');
      await lg.loadLogistics(); const v=cat.listAll('vehicles').find(x=>x.id===uid); await cat.save('vehicles',{{...v,gpsDeviceId:'861234567890123'}});
      await fu.loadFuel(); await fu.saveFuelRecord({{vehicleId:uid,date:'2026-10-19',time:'08:00',odometer:100000,liters:300,amount:750000,fullTank:true,station:'',reference:'',notes:''}});
      const op=await lg.saveOperation({{vehicleId:uid,status:'loaded',division:'puerto',origin:'Manzanillo',destination:'Guadalajara'}}).catch(e=>null);
      return {{unit:lg.unitById(uid)&&lg.unitById(uid).label, fuel:fu.recordsOf(uid).length, imei:gps.imeiOf(uid), op:!!op}}}}""",uid)
    ok(rel['unit']=='U31' and rel['fuel']==1 and rel['imei']=='861234567890123','81.10–12) Logística, Combustible y GPS siguen relacionados con la unidad por su id')
    for path,sel,name in [('#/operacion/taller/equipo/u/'+uid,'.page','Taller'),('#/operacion/logistica/llenos','.fc-page','Control de llenos'),('#/operacion/logistica/vacios','.ec-page','Control de vacíos'),('#/operacion/combustible/'+uid,'.page','Combustible')]:
        e0=len(errs); pg.goto(BASE+path); pg.wait_for_selector(sel); pg.wait_for_timeout(500)
        ok(len(errs)==e0,f'81.11/13) {name} sigue funcionando')
    # ===== Migración: registros duplicados por empresa =====
    dup=pg.evaluate("""async()=>{const cat=await import('/src/services/catalogs.js'), db=await import('/src/services/db.js'), fu=await import('/src/services/fuel.js');
      const p4=cat.listAll('vehicles').find(v=>v.company==='perconsur'&&v.eco==='4');
      const o4=await cat.save('vehicles',{company:'oasc',eco:'04',placas:p4.placas,desc:'',source:'auto'});
      await db.put(db.S.fuelRecords,{id:'fu_dup',vehicleId:o4.id,date:'2026-10-18',time:'07:00',odometer:5000,liters:100,amount:250000,fullTank:true,station:'',reference:'',notes:'',createdAt:1,revisions:[]});
      await db.put(db.S.logisticsOperations,{id:'lg_dup',vehicleId:o4.id,operatorId:null,trailerId:null,division:'puerto',status:'loaded',origin:'Manzanillo',destination:'Colima',startedAt:1,closedAt:2,createdAt:1,statusLog:[],revisions:[]});
      await db.put(db.S.maintenanceOrders,{id:'mo_dup',folio:'T-1',equipmentType:'vehicle',vehicleId:o4.id,trailerId:null,kind:'tracto',type:'preventivo',status:'cerrada',inAt:1,outAt:2,createdAt:1});
      return {p4:p4.id,o4:o4.id}}""")
    pg.goto(BASE+'#/unidades'); pg.wait_for_selector('.un-page'); pg.wait_for_timeout(400)
    ok(pg.locator('.un-notice',has_text='posible registro duplicado').count()==1,'73) se detecta la misma unidad registrada en dos empresas (no se elimina nada)')
    pg.locator('.un-notice',has_text='duplicado').click(); pg.wait_for_selector('.un-dup'); pg.wait_for_timeout(500)
    rv=pg.locator('.un-dup').first.inner_text()
    ok('Coincidencia sin diferencias' in rv and 'OASC' in rv and '1 recargas' in rv and '1 operaciones' in rv and '1 registros de Taller' in rv,'74) revisión: muestra ambos registros, de qué empresa vienen y sus relaciones')
    shot(pg,'09_revision',True)
    pg.locator('.un-dup').first.locator(f'input[value="{dup["p4"]}"]').check(); pg.locator('[data-merge]').first.click(); pg.wait_for_selector('.asheet')
    with pg.expect_download() as dl: pg.get_by_role('button',name='Descargar respaldo y unir').click()
    pg.wait_for_timeout(1500)
    after=pg.evaluate(f"""async(ids)=>{{const db=await import('/src/services/db.js'); const v=await db.get(db.S.vehicles,ids.o4);
      return {{merged:v.mergedInto, fuel:(await db.get(db.S.fuelRecords,'fu_dup')).vehicleId, lg:(await db.get(db.S.logisticsOperations,'lg_dup')).vehicleId, mo:(await db.get(db.S.maintenanceOrders,'mo_dup')).vehicleId, exists:!!v}}}}""",dup)
    ok(dl.value.suggested_filename.startswith('PERCONSUR-respaldo-'),'76) antes de unir se descarga un respaldo completo')
    ok(after['exists'] and after['merged']==dup['p4'] and after['fuel']==dup['p4'] and after['lg']==dup['p4'] and after['mo']==dup['p4'],'75) unir: combustible, Logística y Taller pasan a la unidad conservada; el otro registro no se borra (queda «unido a»)')
    ok(pg.locator('.empty',has_text='Sin duplicados pendientes').count()==1,'sin duplicados pendientes después de unir')
    pg.goto(BASE+f'#/unidades/{dup["o4"]}'); pg.wait_for_selector('.uf-page'); pg.wait_for_timeout(300)
    ok(dup['p4'] in pg.url,'un enlace al registro unido abre la unidad conservada')
    # ===== Respaldo y modo consulta =====
    bk=pg.evaluate("""async()=>{const m=await import('/src/services/backup.js'); const o=JSON.parse(await (await m.exportBackup({includeMedia:true})).text()); return {d:o.data.unitDocuments.length,p:o.data.unitPhotos.length,e:o.data.unitEvents.length,f:o.data.attachments.filter(a=>/^unit:/.test(a.owner)).length, cap:o.data.unitPhotos.filter(p=>p.captureDateSource==='exif').length}}""")
    ok(bk['d']>=7 and bk['p']==3 and bk['e']>10 and bk['f']>=10 and bk['cap']==1,'72/81.14) el respaldo incluye documentos, fotografías (con su fuente de fecha), historial y archivos')
    pg.evaluate("async()=>{(await import('/src/services/access.js')).setReadOnly(true)}"); open_unit(pg,uid); tab(pg,'docs')
    ro=pg.locator('[data-up]').count()+pg.locator('[data-editdoc]').count()+pg.locator('.nav-act[data-edit]').count()
    tab(pg,'fotos'); ro+=pg.locator('[data-cam]').count()
    err=pg.evaluate(f"async(uid)=>{{try{{await (await import('/src/services/units.js')).saveUnit({{notes:'x'}},uid);return ''}}catch(e){{return e.message}}}}",uid)
    ok(ro==0 and 'consulta' in err,'71) modo consulta: se consulta el expediente pero no se agrega, edita ni elimina')
    pg.evaluate("async()=>{(await import('/src/services/access.js')).setReadOnly(false)}")
    ctx.close()
    # Escritorio
    ctx,pg=newctx(b,viewport={'width':1280,'height':900}); login(pg)
    pg.goto(BASE+'#/unidades'); pg.wait_for_selector('.un-page'); pg.wait_for_timeout(400)
    ok(pg.locator('.un-grid').evaluate("e=>getComputedStyle(e).gridTemplateColumns.split(' ').length")==3,'escritorio: tarjetas en tres columnas'); shot(pg,'10_escritorio',True)
    ctx.close()
    b.close()
except Exception as e:
  log.append('FAIL excepción: '+str(e).split('\n')[0]); raise
finally:
  srv.terminate()
  print('\n'.join(log)); print('errores:',errs or 'ninguno')
