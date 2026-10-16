"""Estado de cuenta en PDF. PCS_TEST_USER=... PCS_TEST_PASS=... python3 statement.py"""
import subprocess, time, sys, os, json, re
from playwright.sync_api import sync_playwright
APP=os.path.abspath(os.path.join(os.path.dirname(__file__),'..')); os.makedirs('shots',exist_ok=True)
U=os.environ['PCS_TEST_USER']; P=os.environ['PCS_TEST_PASS']; BASE='http://127.0.0.1:8772/index.html'
srv=subprocess.Popen([sys.executable,'-m','http.server','8772','--bind','127.0.0.1'],cwd=APP,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(1)
log=[]; errs=[]
def ok(c,m): log.append(('OK  ' if c else 'FAIL')+' '+m)
def pdftext(path): return subprocess.run(['pdftotext','-layout',path,'-'],capture_output=True,text=True).stdout
def pages(path): return int(re.search(r'Pages:\s+(\d+)',subprocess.run(['pdfinfo',path],capture_output=True,text=True).stdout).group(1))
def sheet_form(pg): pg.wait_for_selector('.op-form'); pg.wait_for_timeout(300)
def save(pg): pg.locator('.op-form button[type=submit]').click(); pg.wait_for_timeout(450)
def trip(pg,fare,exp,date,o='Manzanillo',d='Guadalajara'):
    pg.locator('[data-new="viaje"]').first.click(); pg.wait_for_selector('.asheet'); pg.locator('.asheet button',has_text='Solo registro financiero').click(); sheet_form(pg); pg.fill('.op-form [name=date]',date); pg.fill('.op-form [name=origin]',o); pg.fill('.op-form [name=destination]',d); pg.fill('.op-form [name=fare]',fare); pg.fill('.op-form [name=exp]',exp); save(pg)
try:
  with sync_playwright() as p:
    b=p.chromium.launch()
    ctx=b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,is_mobile=True,has_touch=True,service_workers='block',accept_downloads=True)
    ctx.route(lambda u:'cdnjs' in u or 'fonts.g' in u, lambda r:r.abort())
    pg=ctx.new_page(); pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.goto(BASE); pg.wait_for_selector('.login'); pg.fill('#lg-user',U); pg.fill('#lg-pass',P); pg.click('#lg-go'); pg.wait_for_selector('.login',state='detached'); pg.wait_for_timeout(900)
    if pg.locator('.asheet').count(): pg.get_by_role('button',name='Ahora no').click()
    pg.goto(BASE+'#/operadores'); pg.wait_for_timeout(600); pg.locator('.op-row',has_text='José Castañeda').click(); pg.wait_for_timeout(600)
    pg.locator('[data-settings]').click(); sheet_form(pg); pg.fill('.op-form [name=startDate]','2026-06-20'); pg.fill('.op-form [name=weekly]','3000')
    pg.locator('.op-form [name=minEnabled]').check(); pg.fill('.op-form [name=minAmount]','2500'); save(pg)
    trip(pg,'25000','3500','2026-07-15'); trip(pg,'10000','1000','2026-08-20','Tesistán','Planta Nextipac')
    trip(pg,'30000','2000','2026-10-02','Manzanillo','Zapopan')
    pg.locator('[data-new="prestamo"]').first.click(); sheet_form(pg); pg.fill('.op-form [name=date]','2026-08-12'); pg.fill('.op-form [name=amount]','10000'); pg.fill('.op-form [name=concept]','Préstamo personal'); save(pg)
    ficha=pg.locator('.bal-card .bal-v').inner_text().replace('\xa0',' ').replace(' MXN','').replace('−','-')
    ok(pg.locator('[data-stmt]').count()==1,'botón Generar PDF en la ficha'); pg.locator('[data-stmt]').scroll_into_view_if_needed(); pg.screenshot(path='shots/s01_ficha_boton.png')
    pg.locator('[data-stmt]').click(); pg.wait_for_selector('.eo-page',timeout=15000); pg.wait_for_timeout(500)
    svg=pg.locator('[data-pages]').inner_html()
    ok('ESTADO DE CUENTA DE OPERADOR' in svg and 'BALANCE ACTUAL' in svg,'vista previa = documento real (encabezado y balance)')
    ok(f'{ficha} MXN' in svg,f'con corte Hoy el balance coincide con la ficha: {ficha}')
    ok('Ampliada' in svg and '02/10/2026' in svg,'incluye comisión ampliada y todos los viajes hasta hoy')
    pg.screenshot(path='shots/s02_vista_previa.png')
    # corte histórico
    pg.locator('[data-mode="fecha"]').click(); pg.fill('[data-cut]','2026-09-30'); pg.locator('[data-cut]').dispatch_event('change'); pg.wait_for_timeout(1200)
    svg=pg.locator('[data-pages]').inner_html()
    ok('Balance al 30 de septiembre de 2026' in svg and '02/10/2026' not in svg,'corte al 30/09/2026: excluye el viaje del 02/10 y muestra "Balance al 30 de septiembre de 2026"')
    ok('30 de septiembre de 2026' in pg.locator('[data-cutnote]').inner_text(),'nota de la fecha de corte en pantalla')
    pg.locator('[data-z="1"]').click(); pg.wait_for_timeout(300)
    ok(pg.locator('[data-pages]').evaluate('e=>e.style.width')=='150%' and '150' in pg.locator('[data-zl]').inner_text(),'zoom de la vista previa')
    pg.screenshot(path='shots/s03_zoom.png'); pg.locator('[data-z="-1"]').click(); pg.wait_for_timeout(200)
    # generar
    pg.locator('[data-act="generate"]').click(); pg.wait_for_selector('.stmt-ok',timeout=15000); pg.wait_for_timeout(400)
    st=pg.locator('.stmt-ok').inner_text(); folio=re.search(r'EO-\d{8}-\d{3}',st).group(0)
    ok(folio.endswith('-001') and pg.locator('[data-act="view"]').count() and pg.locator('[data-act="share"]').count() and pg.locator('[data-act="save"]').count(),'PDF generado con folio '+folio+' y acciones Ver PDF / Compartir / Guardar en Archivos')
    pg.screenshot(path='shots/s04_generado.png')
    with pg.expect_download() as d: pg.locator('[data-act="share"]').click()
    path=d.value.path(); name=d.value.suggested_filename; txt=pdftext(path)
    ok(name=='Estado-de-cuenta-Jose-Castaneda-Villalobos-2026-09-30.pdf','nombre de archivo saneado: '+name)
    ok(folio in txt and 'Balance al 30 de septiembre de 2026' in txt and '02/10/2026' not in txt and 'Página 1 de' in txt,'el PDF descargado contiene folio, corte, pie con página y no incluye viajes posteriores')
    ok('SÁBADOS CONTABILIZADOS' in txt and 'Préstamo personal' in txt and 'Comisión ampliada' in txt,'secciones de sábados, préstamos y nota de comisión ampliada')
    # muchos viajes → varias páginas
    pg.evaluate('''async()=>{const o=await import('/src/services/operators.js'); const id=location.hash.split('/')[2];
      for(let i=0;i<45;i++){const fare=1500000+i*10000; await o.saveTrip({operatorId:id,division:i%3?'puerto':'campo',date:'2026-09-'+String(1+(i%28)).padStart(2,'0'),origin:'Manzanillo',destination:'Guadalajara',fare,travelExpenses:100000,commissionRate:15,minEnabled:false,minAmount:250000,baseCommission:Math.round(fare*0.15),expandedCommission:0,finalCommission:Math.round(fare*0.15),isExpanded:false,notes:''});}}''')
    pg.locator('[data-mode="hoy"]').click(); pg.wait_for_timeout(1500)
    n=pg.locator('.eo-page').count(); ok(n>=3,f'48 viajes → {n} páginas en la vista previa')
    pg.locator('[data-act="generate"]').click(); pg.wait_for_selector('.stmt-ok',timeout=20000); pg.wait_for_timeout(300)
    folio2=re.search(r'EO-\d{8}-\d{3}',pg.locator('.stmt-ok').inner_text()).group(0)
    with pg.expect_download() as d2: pg.locator('[data-act="save"]').click()
    p2=d2.value.path(); t2=pdftext(p2); np=pages(p2)
    heads=len(re.findall(r'FECHA\s+DIVISIÓN\s+RUTA',t2))
    ok(folio2.endswith('-002') and np==n,f'segundo estado: folio {folio2}, PDF de {np} páginas igual que la vista previa ({n})')
    ok(heads>=2 and f'Página {np} de {np}' in t2,f'encabezado de la tabla repetido en {heads} páginas y pie "Página {np} de {np}"')
    ok(os.path.getsize(p2)<200*1024,f'archivo ligero: {os.path.getsize(p2)//1024} KB')
    pg.screenshot(path='shots/s05_multipagina.png')
    # persistencia del folio
    pg.reload(); pg.wait_for_selector('.eo-page',timeout=15000); pg.wait_for_timeout(800)
    iss=pg.locator('[data-issued]').inner_text(); ok(folio in iss and folio2 in iss,'los folios emitidos persisten tras recargar')
    pg.locator('[data-issued]').scroll_into_view_if_needed(); pg.screenshot(path='shots/s06_emitidos.png')
    # respaldo
    pg.goto(BASE+'#/ajustes'); pg.wait_for_timeout(700)
    with pg.expect_download() as d3:
        pg.locator('[data-a="export"]').click(); pg.wait_for_selector('.asheet'); pg.get_by_role('button',name='Solo datos').click(); pg.wait_for_selector('[data-go]'); pg.locator('[data-go]').click()
    bk=json.load(open(d3.value.path())); ok(len(bk['data'].get('operatorStatements',[]))==2,'el respaldo incluye los estados de cuenta emitidos')
    pg.emulate_media(color_scheme='dark'); pg.goto(BASE+'#/operadores'); pg.wait_for_timeout(500); pg.locator('.op-row',has_text='José Castañeda').click(); pg.wait_for_timeout(500); pg.locator('[data-stmt]').click(); pg.wait_for_selector('.eo-page',timeout=15000); pg.wait_for_timeout(600); pg.screenshot(path='shots/s07_oscuro.png')
    b.close()
finally: srv.terminate()
print('\n'.join(log)); print('errores:','; '.join(errs) or 'ninguno')
