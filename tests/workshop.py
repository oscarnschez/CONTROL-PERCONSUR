"""Operación → Taller, de punta a punta (iPhone): mantenimiento de tractocamión y de remolque, varios trabajos en una orden,
cambio de aceite y próximo cambio, falla reportada y relacionada sin duplicarse, diagrama (leve, moderado, daño total y
reemplazado en azul), llantas con posiciones y solo con cantidad, ingreso/salida y tiempo en taller, fotos, reporte
individual y consolidado con vista previa y PDF (texto y diagrama vectorial), compartir en iPhone, persistencia al
reabrir, Logística (disponibilidad «En taller» sin tocar el estado del viaje), odómetro menor documentado, respaldo.
Requiere pdftotext (poppler-utils). PCS_TEST_USER/PCS_TEST_PASS"""
import subprocess, time, sys, os, json, re, tempfile
from playwright.sync_api import sync_playwright
APP=os.path.abspath(os.path.join(os.path.dirname(__file__),'..')); SH='shots'; os.makedirs(SH,exist_ok=True)
U=os.environ['PCS_TEST_USER']; P=os.environ['PCS_TEST_PASS']
BASE='http://127.0.0.1:8808/index.html'
FOTO=os.path.join(APP,'tests','foto.jpg')
srv=subprocess.Popen([sys.executable,'-m','http.server','8808','--bind','127.0.0.1'],cwd=APP,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(1)
errs=[]; log=[]
def ok(c,m): log.append(('OK  ' if c else 'FAIL')+' '+m)
def shot(pg,n): pg.screenshot(path=f'{SH}/taller_{n}.png')
def watch(pg):
    pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m: errs.append('console: '+m.text) if m.type=='error' else None)
txt=lambda pg,sel: ' '.join(pg.locator(sel).first.inner_text().split())
def sheet(pg): return pg.locator('.bsheet').last
def login(pg):
    pg.goto(BASE); pg.wait_for_selector('.login'); pg.fill('#lg-user',U); pg.fill('#lg-pass',P); pg.click('#lg-go'); pg.wait_for_selector('.login',state='detached'); pg.wait_for_timeout(900)
def pick(pg, label):
    pg.locator('.picker .pk-row').filter(has_text=label).first.click(); pg.wait_for_timeout(350)
def as_btn(pg, label):
    pg.locator('.asheet .as-btn').filter(has_text=re.compile('^'+re.escape(label)+'$')).first.click(); pg.wait_for_timeout(350)
def seg(form, name, label):
    form.locator(f'[data-seg="{name}"] .seg-b').filter(has_text=re.compile('^'+re.escape(label)+'$')).first.click()
def ev(pg, body, arg=None):
    return pg.evaluate("async(a)=>{const m=await import('./src/services/maintenance.js'); await m.loadMaintenance(true); "+body+"}", arg)
FILL_STATE="(c)=>{const g=document.querySelector(`.dg [data-c=\"${c}\"] .dg-shape`); return g? g.getAttribute('fill'):null}"
try:
  with sync_playwright() as p:
    b=p.chromium.launch()
    ctx=b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,is_mobile=True,has_touch=True,service_workers='block',accept_downloads=True)
    ctx.route(lambda u:'cdnjs' in u or 'fonts.g' in u, lambda r:r.abort())
    pg=ctx.new_page(); watch(pg)
    login(pg)
    if pg.locator('.asheet').count(): pg.get_by_role('button',name='Ahora no').click()
    # Datos de partida: recarga de combustible con odómetro GPS de U21 y una operación activa de Logística para U12
    pre=pg.evaluate("""async()=>{const f=await import('./src/services/fuel.js'); await f.loadFuel(); const v=f.vehicles(); const u21=v.find(x=>x.eco==='21'), u12=v.find(x=>x.eco==='12');
      await f.saveFuelRecord({vehicleId:u21.id,date:'2026-10-03',time:'08:00',odometer:124500,liters:300,amount:750000,fullTank:true});
      const l=await import('./src/services/logistics.js'); const o=(await import('./src/services/operators.js')).operatorList();
      await l.saveOperation({vehicleId:u12.id,operatorId:o[0].id,division:'puerto',status:'to_destination',origin:'Manzanillo',destination:'Guadalajara'});
      const c=await import('./src/services/catalogs.js'); const tr=c.listAll('trailers'); return {u21:u21.id,u12:u12.id,tr:tr[0].id,trPl:tr[0].placas}}""")
    # 1) Operación → Taller
    pg.goto(BASE+'#/operacion'); pg.wait_for_timeout(600)
    ok(pg.locator('.mod-card').filter(has_text='Taller').count()==1 and 'Control de mantenimiento y reparaciones' in txt(pg,'.mod-list'),'Operación → tarjeta «Taller» con su descripción')
    pg.locator('.mod-card').filter(has_text='Taller').click(); pg.wait_for_timeout(900)
    ok('#/operacion/taller' in pg.url and pg.locator('.mt-tiles .mt-tile').count()==6,'tablero del Taller con indicadores')
    ok(all(t in txt(pg,'.mt-page') for t in ['En taller ahora','Próximos cambios de aceite','Fallas reportadas','Mantenimientos recientes','Historial de servicios']),'secciones del tablero (en taller, aceite, fallas, recientes, historial)')
    # 6) Reportar falla sin orden abierta
    pg.locator('[data-new="issue"]').click(); pg.wait_for_timeout(400); as_btn(pg,'Tractocamión'); pick(pg,'U21')
    f=sheet(pg)
    f.locator('select[name=system]').select_option('frenos'); f.locator('select[name=component]').select_option('frenos_tras')
    f.locator('textarea[name=description]').fill('Ruido metálico al frenar en el eje trasero'); seg(f,'severity','Moderado')
    f.locator('input[type=file][multiple]').set_input_files(FOTO); pg.wait_for_timeout(900)
    ok(f.locator('.mph-th').count()==1,'falla: foto adjunta con miniatura (comprimida)')
    f.locator('button[type=submit]').click(); pg.wait_for_timeout(900)
    ok(pg.locator('[data-issue]').count()==1 and 'Frenos traseros' in txt(pg,'.mt-page') and txt(pg,'.mt-tiles').count('1')>=1,'falla reportada sin orden: aparece en el tablero')
    # 1) Registrar mantenimiento de tractocamión (U21)
    pg.locator('.mt-acts [data-new="order"]').click(); pg.wait_for_timeout(400); as_btn(pg,'Tractocamión'); pick(pg,'U21')
    f=sheet(pg)
    hint=txt(pg,'.bsheet [data-odo]')
    ok('124,500' in hint and 'Combustible' in hint,'sugiere el último odómetro conocido (Combustible): '+hint[:110])
    f.locator('input[name=inDate]').fill('2026-10-08'); f.locator('input[name=inTime]').fill('09:30')
    f.locator('input[name=odometer]').fill('120000'); f.locator('textarea[name=reason]').fill('Ruido en frenos traseros, fuga en suspensión y cambio de aceite programado.')
    f.locator('select[name=type]').select_option('correctivo'); f.locator('select[name=status]').select_option('mantenimiento')
    f.locator('button[type=submit]').click(); pg.wait_for_timeout(700)
    ok(not f.locator('[data-fix]').is_hidden() and 'menor que el último conocido' in ' '.join(pg.locator('.toast').all_inner_texts()),'kilometraje menor que el último conocido: se pide documentar la corrección')
    f.locator('input[name=odometer]').fill('125000')
    f.locator('button[type=submit]').click(); pg.wait_for_timeout(1200)
    ok('#/operacion/taller/orden/' in pg.url,'orden creada: abre su ficha')
    folio=txt(pg,'.mt-head h1')
    ok(re.match(r'^MTTO-U21-20261008-001$',folio) is not None,'folio automático: '+folio)
    oid=pg.url.split('/orden/')[1]
    # 3) Varios trabajos en una orden
    def add_work(tipo, comp, sev, acc, desc):
        pg.locator('[data-addsvc]').click(); pg.wait_for_timeout(400)
        f=sheet(pg); f.locator('select[name=type]').select_option(tipo)
        if comp:
            f.locator('[data-comp]').click(); pg.wait_for_timeout(300); pick(pg, comp)
        f.locator('textarea[name=description]').fill(desc)
        if sev: seg(f,'severity',sev)
        if acc: seg(f,'action',acc)
        f.locator('button[type=submit]').click(); pg.wait_for_timeout(700)
    add_work('filtros','', '', 'Reemplazado','Filtros de combustible y aire')
    add_work('reparacion','Frenos traseros','Moderado','Reparado','Cambio de balatas')
    ok(pg.locator('[data-svc]').count()==2,'dos trabajos en el mismo ingreso (sin crear otra orden)')
    # 7-11) Diagrama: seleccionar componente y registrar gravedad / reemplazo
    pg.locator('.dg [data-view="sistemas"]').click(); pg.wait_for_timeout(300)
    ok(pg.evaluate(FILL_STATE,'frenos_tras').upper()=='#F97316','frenos traseros (moderado) en naranja en el diagrama')
    def comp_sheet(cid, sev, acc, desc, photo=False):
        pg.locator(f'.dg [data-c="{cid}"]').first.click(); pg.wait_for_timeout(500)
        f=sheet(pg)
        if sev: seg(f,'severity',sev)
        seg(f,'action',acc); f.locator('textarea[name=description]').fill(desc)
        if photo: f.locator('input[type=file][multiple]').set_input_files(FOTO); pg.wait_for_timeout(900)
        f.locator('button[type=submit]').click(); pg.wait_for_timeout(700)
    pg.locator('.dg [data-view="izq"]').click(); pg.wait_for_timeout(300)
    comp_sheet('cofre','Leve','Reparado','Golpe menor en salpicadera')
    ok(pg.evaluate(FILL_STATE,'cofre').upper()=='#FACC15','daño leve: amarillo')
    comp_sheet('puertas','Daño total','Pendiente','Puerta del operador sin cierre')
    ok(pg.evaluate(FILL_STATE,'puertas').upper()=='#DC2626','daño total: rojo')
    comp_sheet('susp_tras','Moderado','Reemplazado','Bolsas y muelles nuevos', photo=True)
    ok(pg.evaluate(FILL_STATE,'susp_tras').upper()=='#2563EB','componente reemplazado: azul (aunque el daño fue moderado)')
    det=txt(pg,'[data-comp="susp_tras"]')
    ok('daño original: Daño moderado' in det and 'Componente reemplazado' in det,'el detalle conserva la gravedad original: '+det)
    ok(pg.locator('.dg .dg-n').count()==3 and pg.locator('[data-comp] .dg-num').count()==4 and 'Componente reemplazado' in txt(pg,'.dg-legend'),'componentes numerados (en el dibujo y en la lista) y leyenda con nombres (no solo color)')
    # selección por lista (iPhone)
    pg.locator('[data-complist]').click(); pg.wait_for_timeout(400)
    pg.locator('.picker-sheet .search-in').fill('valv'); pg.wait_for_timeout(200)
    ok(pg.locator('.picker-sheet .pk-row').count()==1,'lista alternativa de componentes con buscador')
    pg.locator('.picker-sheet .pk-row').first.click(); pg.wait_for_timeout(500)
    ok('Válvulas' in sheet(pg).inner_text(),'desde la lista se abre el mismo registro del componente'); pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    pg.locator('[data-zoom="1"]').click(); pg.wait_for_timeout(250)
    ok(txt(pg,'[data-zl]')=='150 %','zoom del diagrama'); pg.locator('[data-zoom="0"]').click(); pg.wait_for_timeout(200)
    ok(txt(pg,'[data-zl]')=='100 %','restablecer zoom')
    shot(pg,'01_diagrama')
    # 4) Cambio de aceite
    pg.locator('[data-addoil]').click(); pg.wait_for_timeout(400)
    f=sheet(pg); f.locator('input[name=odometer]').fill('125000'); f.locator('input[name=oilType]').fill('Sintético'); f.locator('input[name=brand]').fill('Mobil Delvac')
    f.locator('input[name=viscosity]').fill('15W-40'); f.locator('input[name=liters]').fill('38'); f.locator('input[name=otherFilters]').fill('Combustible y aire')
    f.locator('button[type=submit]').click(); pg.wait_for_timeout(700)
    ok(pg.locator('[data-oil]').count()==1 and 'Cambio de aceite de motor' in txt(pg,'.mt-page'),'cambio de aceite registrado en la orden')
    # 12-13) Llantas con posiciones
    pg.locator('[data-addtire]').click(); pg.wait_for_timeout(400)
    f=sheet(pg); f.locator('input[name=quantity]').fill('4'); f.locator('select[name=layout]').select_option('t6x4'); pg.wait_for_timeout(300)
    for pos in ['E2-IE','E2-II','E3-DI','E3-DE']: f.locator(f'[data-pos="{pos}"]').click()
    ok(f.locator('.tr-p.on').count()==4 and '4 de 4 posiciones' in txt(pg,'.bsheet [data-sum]'),'posiciones marcadas en azul: '+txt(pg,'.bsheet [data-sum]'))
    f.locator('input[name=brand]').fill('Michelin'); f.locator('input[name=size]').fill('295/75R22.5')
    f.locator('button[type=submit]').click(); pg.wait_for_timeout(700)
    # Solo cantidad (sin posiciones)
    pg.locator('[data-addtire]').click(); pg.wait_for_timeout(400)
    f=sheet(pg); f.locator('input[name=quantity]').fill('-2'); f.locator('button[type=submit]').click(); pg.wait_for_timeout(300)
    ok(sheet(pg).is_visible() and 'sin negativos' in ' '.join(pg.locator('.toast').all_inner_texts()),'no permite cantidades negativas de llantas')
    f.locator('input[name=quantity]').fill('2'); pg.wait_for_timeout(100); f.locator('button[type=submit]').click(); pg.wait_for_timeout(700)
    tl=txt(pg,'.mt-page')
    ok(pg.locator('[data-tire]').count()==2 and 'pendientes de especificar' in tl and 'Eje 2' in tl,'reemplazo solo con cantidad: posiciones pendientes de especificar (no se inventan)')
    pg.locator('.dg [data-view="sistemas"]').click(); pg.wait_for_timeout(200)
    ok(pg.evaluate(FILL_STATE,'llantas_trac_izq').upper()=='#2563EB' and pg.evaluate(FILL_STATE,'llantas_trac_der').upper()=='#2563EB' and pg.evaluate(FILL_STATE,'llantas_del_izq').upper()!='#2563EB','las llantas de tracción con posición conocida se ven reemplazadas en el diagrama (cada lado por separado)')
    tl=txt(pg,'.mt-page')
    ok('Llantas de tracción · lado izquierdo' in tl and 'Llantas de tracción · lado derecho' in tl,'componentes intervenidos: llantas del lado izquierdo y del lado derecho por separado')
    # 9) Falla relacionada sin duplicar
    pg.locator('[data-linkiss]').click(); pg.wait_for_timeout(400); pg.locator('.picker .pk-row').first.click(); pg.wait_for_timeout(700)
    n_iss=ev(pg,"return m.issues().length")
    ok(pg.locator('[data-issue]').count()==1 and n_iss==1,'falla relacionada con la orden sin duplicarse (sigue habiendo 1)')
    # 14-15) Finalizar con salida y tiempo en taller
    pg.locator('[data-st]').click(); pg.wait_for_timeout(400)
    f=sheet(pg); f.locator('input[value="finalizado"]').check(); pg.wait_for_timeout(200)
    f.locator('input[name=outDate]').fill('2026-10-07'); f.locator('input[name=outTime]').fill('10:00'); f.locator('button[type=submit]').click(); pg.wait_for_timeout(400)
    ok(sheet(pg).is_visible() and 'anterior al ingreso' in ' '.join(pg.locator('.toast').all_inner_texts()),'no permite salida anterior al ingreso')
    f.locator('input[name=outDate]').fill('2026-10-10'); f.locator('input[name=outTime]').fill('16:00'); pg.wait_for_timeout(200)
    ok('2 días, 6 horas y 30 minutos' in txt(pg,'.bsheet [data-dur]'),'vista previa del tiempo en taller al finalizar')
    f.locator('button[type=submit]').click(); pg.wait_for_timeout(800)
    hero=txt(pg,'.mt-hero')
    ok('Finalizado' in hero and '08/10/2026 · 09:30' in hero and '10/10/2026 · 16:00' in hero and '2 días, 6 horas y 30 minutos' in hero,'ingreso, salida y tiempo en taller: '+hero)
    shot(pg,'02_orden')
    # 5) Próximo cambio de aceite con intervalo propio de la unidad
    pg.goto(BASE+f'#/operacion/taller/equipo/u/{pre["u21"]}'); pg.wait_for_timeout(800)
    ok('Intervalo sin configurar' in txt(pg,'.mt-page'),'sin intervalo configurado no se calcula (no se inventa)')
    pg.locator('.nav-act[data-cfg]').click(); pg.wait_for_timeout(400)
    f=sheet(pg); f.locator('input[name=oilKm]').fill('25,000'); f.locator('select[name=layout]').select_option('t6x4'); f.locator('button[type=submit]').click(); pg.wait_for_timeout(700)
    eqt=txt(pg,'.mt-page')
    ok('150,000 km' in eqt and '125,000 + 25,000' in eqt,'próximo cambio = 125,000 + 25,000 = 150,000 km')
    ok('Servicios' in eqt and 'Tiempo en taller' in eqt and 'Reemplazos' in eqt and 'MTTO-U21-20261008-001' in eqt,'historial de la unidad: servicios, días en taller, reemplazos y órdenes')
    # alerta de aceite: odómetro cercano al próximo cambio (recarga nueva)
    pg.evaluate("async(v)=>{const f=await import('./src/services/fuel.js'); await f.saveFuelRecord({vehicleId:v,date:'2026-10-12',time:'08:00',odometer:148500,liters:200,amount:500000,fullTank:true});}", pre['u21'])
    pg.goto(BASE+'#/operacion/taller'); pg.wait_for_timeout(900)
    al=txt(pg,'.mt-page')
    ok('U21 — Próximo cambio de aceite' in al and 'Restan aproximadamente 1,500 km' in al,'alerta: U21 — Próximo cambio de aceite · restan aproximadamente 1,500 km')
    pg.locator('.search-in[data-q]').fill('susp'); pg.wait_for_timeout(500)
    ok('MTTO-U21-20261008-001' in txt(pg,'.mt-page'),'búsqueda por componente en el historial')
    # 2) Mantenimiento de remolque (sin clasificar → se clasifica)
    pg.locator('.search-in[data-q]').fill(''); pg.wait_for_timeout(300)
    pg.locator('.mt-acts [data-new="order"]').click(); pg.wait_for_timeout(400); as_btn(pg,'Remolque'); pick(pg, pre['trPl'])
    ok(pg.locator('.asheet').count()==1 and 'Clasificar' in pg.locator('.asheet').inner_text(),'remolque sin clasificar: se pide su tipo antes de registrar')
    as_btn(pg,'Jaula')
    f=sheet(pg)
    ok(f.locator('input[name=odometer]').count()==0,'remolque: sin kilometraje')
    f.locator('textarea[name=reason]').fill('Paneles golpeados'); f.locator('button[type=submit]').click(); pg.wait_for_timeout(1200)
    ok('#/operacion/taller/orden/' in pg.url and pg.locator('.dg [data-c="paneles"]').count()==1 and pg.locator('.dg [data-view="lado"]').count()==1,'orden de remolque con el diagrama de jaula')
    pg.locator('.dg [data-c="paneles"]').first.click(); pg.wait_for_timeout(400); f=sheet(pg); seg(f,'severity','Moderado'); seg(f,'action','Reparado'); f.locator('button[type=submit]').click(); pg.wait_for_timeout(600)
    ok(pg.evaluate(FILL_STATE,'paneles').upper()=='#F97316','remolque: misma clasificación de colores')
    tro=pg.url.split('/orden/')[1]
    # 31) Logística: disponibilidad independiente del estado del viaje (y aviso con viaje activo)
    pg.goto(BASE+'#/operacion/taller'); pg.wait_for_timeout(600)
    pg.locator('.mt-acts [data-new="order"]').click(); pg.wait_for_timeout(400); as_btn(pg,'Tractocamión'); pick(pg,'U12')
    f=sheet(pg); f.locator('input[name=odometer]').fill('300000'); f.locator('textarea[name=reason]').fill('Revisión eléctrica'); f.locator('button[type=submit]').click(); pg.wait_for_timeout(600)
    ok(pg.locator('.asheet').count()==1 and 'operación activa' in pg.locator('.asheet').inner_text() and 'no modifica el estado del viaje' in pg.locator('.asheet').inner_text(),'viaje activo: se advierte antes de marcarla no disponible')
    as_btn(pg,'Marcar como no disponible'); pg.wait_for_timeout(1200)
    pg.goto(BASE+f'#/operacion/logistica/u/{pre["u12"]}'); pg.wait_for_timeout(800)
    hero=txt(pg,'.lg-hero')
    ok('Estado de viaje' in hero and 'En ruta a destino' in hero and 'Disponibilidad: En taller' in hero,'Logística: «Disponibilidad: En taller» y el estado del viaje sin cambios: '+hero[:120])
    pg.goto(BASE+'#/operacion/logistica'); pg.wait_for_timeout(700)
    ok(pg.locator('.lg-card .mt-av').count()>=1,'tablero de Logística: etiqueta «En taller» en la unidad')
    # 32) Catálogo → Ver historial de mantenimiento
    pg.goto(BASE+'#/unidades'); pg.wait_for_timeout(600)
    pg.locator('.un-card').filter(has_text='UNIDAD 021').first.click(); pg.wait_for_timeout(600)
    ok(pg.locator('.uf-sec a').filter(has_text='Historial de mantenimiento').count()==1,'expediente de la unidad: acceso «Historial de mantenimiento»')
    pg.locator('.uf-sec a').filter(has_text='Historial de mantenimiento').click(); pg.wait_for_timeout(800)
    ok('/operacion/taller/equipo/u/' in pg.url,'abre el historial dentro de Taller')
    # 17, 19) Reporte individual con vista previa
    pg.goto(BASE+f'#/operacion/taller/orden/{oid}'); pg.wait_for_timeout(700)
    pg.locator('a').filter(has_text='Generar reporte').click(); pg.wait_for_selector('.eo-page',timeout=20000); pg.wait_for_timeout(800)
    pv=pg.evaluate("[...document.querySelectorAll('[data-pages] svg text')].map(t=>t.textContent).join(' ')")
    fills=pg.evaluate("[...document.querySelectorAll('[data-pages] svg path')].map(p=>(p.getAttribute('fill')||'').toUpperCase())")
    ok('REPORTE DE MANTENIMIENTO Y REPARACIÓN' in pv and 'MTTO-U21-20261008-001' in pv and '2 días, 6 horas y 30 minutos' in pv,'vista previa: encabezado, folio y tiempo en taller')
    ok(all(c in fills for c in ['#FACC15','#F97316','#DC2626','#2563EB','#C4CAD4']),'vista previa: diagrama con amarillo, naranja, rojo, azul y gris')
    ok(pg.locator('[data-pages] svg image').count()>=3,'vista previa: logotipo y fotografías de evidencia')
    shot(pg,'03_vista_previa')
    pg.locator('[data-z="1"]').click(); pg.wait_for_timeout(200); ok(txt(pg,'[data-zl]')=='150 %','zoom de la vista previa')
    pg.locator('[data-act="generate"]').click(); pg.wait_for_selector('[data-act="share"]',timeout=30000)
    with pg.expect_download() as dl: pg.locator('[data-act="save"]').click()
    path=dl.value.path(); pdf=open(path,'rb').read(); t=subprocess.run(['pdftotext','-layout',path,'-'],capture_output=True,text=True).stdout
    ok(pdf[:5]==b'%PDF-' and dl.value.suggested_filename=='MTTO-U21-20261008-001.pdf','PDF generado: '+dl.value.suggested_filename)
    ok(all(x in t for x in ['REPORTE DE MANTENIMIENTO Y REPARACI','DATOS DEL EQUIPO','TRABAJOS REALIZADOS','REEMPLAZOS','LLANTAS','DIAGRAMA DE DA','EVIDENCIAS','Suspensión trasera','2 días, 6 horas y 30 minutos','125,000 km']),'PDF: secciones, componentes, tiempo y kilometraje como texto real')
    ok(len(pdf) < 2_500_000 and subprocess.run(['pdfinfo',path],capture_output=True,text=True).stdout.count('Pages')==1,'PDF ligero (diagrama vectorial): %d KB'%(len(pdf)//1024))
    # 20) Compartir desde iPhone (hoja de compartir del sistema)
    pg.evaluate("()=>{window.__shared=null; navigator.canShare=()=>true; navigator.share=async(d)=>{window.__shared={n:d.files[0].name,t:d.files[0].type,s:d.files[0].size}}}")
    pg.locator('[data-act="share"]').click(); pg.wait_for_timeout(600)
    sh=pg.evaluate("window.__shared")
    ok(sh and sh['n']=='MTTO-U21-20261008-001.pdf' and sh['t']=='application/pdf' and sh['s']>1000,'Compartir: entrega el PDF a la hoja de compartir: '+json.dumps(sh))
    # 18) Reporte consolidado
    pg.goto(BASE+f'#/operacion/taller/reporte-equipo/u/{pre["u21"]}'); pg.wait_for_selector('.eo-page',timeout=20000); pg.wait_for_timeout(800)
    pv=pg.evaluate("[...document.querySelectorAll('[data-pages] svg text')].map(t=>t.textContent).join(' ')")
    ok('REPORTE DE SERVICIOS DE MANTENIMIENTO' in pv and 'DIAGRAMA CONSOLIDADO' in pv and 'MTTO-U21-20261008-001' in pv and 'SERVICIOS (ÓRDENES)' in pv,'reporte consolidado: resumen, servicios y diagrama consolidado')
    pg.locator('[data-per="custom"]').click(); pg.locator('[data-c="from"]').fill('2026-11-01'); pg.locator('[data-c="from"]').dispatch_event('change'); pg.wait_for_timeout(1200)
    ok('0 servicios' in txt(pg,'[data-note]'),'filtro por periodo: '+txt(pg,'[data-note]'))
    # 21) Persistencia al cerrar y reabrir la PWA
    pg.goto(BASE+'#/'); pg.reload(); pg.wait_for_selector('.home',timeout=15000)
    pg.goto(BASE+f'#/operacion/taller/orden/{oid}'); pg.wait_for_timeout(900)
    ok(pg.locator('[data-svc]').count()>=6 and pg.evaluate(FILL_STATE,'susp_tras') and 'Finalizado' in txt(pg,'.mt-hero'),'al reabrir: la orden conserva trabajos, diagrama y estado')
    ok(pg.locator('.mph-th').count()>=2,'fotografías persistentes en la orden')
    # 34) Respaldo con el Taller
    bk=pg.evaluate("async()=>{const b=await import('./src/services/backup.js'); const f=await b.exportBackup(); return JSON.parse(await f.text()).data}")
    ok(all(len(bk[k])>0 for k in ['maintenanceOrders','maintenanceServices','maintenanceIssues','maintenanceComponents','tireReplacements','oilChanges','maintenanceAttachments','maintenanceEvents','maintenanceProfiles']) and sum(1 for a in bk['attachments'] if str(a.get('owner','')).startswith('mt:'))>=2,'respaldo: órdenes, fallas, trabajos, componentes, llantas, aceite, fotos, bitácora y configuración')
    ctx2=b.new_context(viewport={'width':390,'height':844},service_workers='block'); ctx2.route(lambda u:'cdnjs' in u or 'fonts.g' in u, lambda r:r.abort())
    p2=ctx2.new_page(); watch(p2)
    login(p2)
    res=p2.evaluate("""async(data)=>{const b=await import('./src/services/backup.js'); const info=await b.inspectBackup(new File([JSON.stringify({app:'perconsur',format:1,data})],'r.json')); await b.importBackup(info);
      const m=await import('./src/services/maintenance.js'); await m.loadMaintenance(true); const o=m.orders().find(x=>x.folio==='MTTO-U21-20261008-001');
      return {lines:info.lines.join('|'), n:m.orders().length, comps:o?m.componentsOfOrder(o.id).length:0, tires:o?m.tiresOf(o.id).length:0}}""", bk)
    ok(res['n']==3 and res['comps']>=6 and res['tires']==2 and 'Taller: 3 órdenes' in res['lines'],'importar respaldo en otro dispositivo: el Taller completo se recupera '+json.dumps(res))
    ctx2.close()
    shot(pg,'04_final')
    ctx.close(); b.close()
finally:
  srv.terminate()
  bad=[e for e in errs if 'ERR_TUNNEL' not in e and 'Failed to load resource' not in e]
  ok(not bad,'sin errores de JavaScript: '+' | '.join(bad[:5]))
  print('\n'.join(log)); print(f"\n{sum(1 for l in log if l.startswith('OK'))}/{len(log)} OK")
