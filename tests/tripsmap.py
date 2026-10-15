"""Aviso de acceso restringido (pantalla de acceso) y Mapa de viajes (Operación → Mapa de viajes, tarjeta de Inicio).
Datos de prueba aislados (base nueva en cada contexto): Jalisco 10 = 6 Puerto + 4 Campo, Colima 23, Ciudad de México 2,
Tlaxcala 1, Guanajuato 1 (por la dirección del catálogo), 2 sin estado identificado, 1 en el extranjero, 1 eliminado y
1 con fecha futura. PCS_TEST_USER=... PCS_TEST_PASS=... python3 tripsmap.py"""
import subprocess, time, sys, os, re, datetime
from playwright.sync_api import sync_playwright
HERE=os.path.dirname(os.path.abspath(__file__)); APP=os.path.abspath(os.path.join(HERE,'..')); SH='shots'; os.makedirs(SH,exist_ok=True)
U=os.environ['PCS_TEST_USER']; P=os.environ['PCS_TEST_PASS']; BASE='http://127.0.0.1:8792/index.html'
srv=subprocess.Popen([sys.executable,'-m','http.server','8792','--bind','127.0.0.1'],cwd=APP,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(1)
errs=[]; log=[]
def ok(c,m): log.append(('OK  ' if c else 'FAIL')+' '+m)
def shot(pg,n,full=False): pg.screenshot(path=f'{SH}/tm_{n}.png',full_page=full)
NOTICE_T='ACCESO RESTRINGIDO'
NOTICE_P='Esta herramienta digital es de uso único y exclusivo para personal autorizado por PERCONSUR. El acceso y uso por personas no autorizadas está prohibido.'
today=datetime.date.today(); T=today.isoformat(); T5=(today+datetime.timedelta(days=5)).isoformat()
D40=(today-datetime.timedelta(days=40)).isoformat(); LY=today.year-1
def newctx(b,**k):
    k.setdefault('viewport',{'width':390,'height':844})
    mob=k['viewport']['width']<700
    ctx=b.new_context(device_scale_factor=2,is_mobile=mob,has_touch=mob,service_workers='block',**k)
    ctx.route(lambda u:'cdnjs' in u or 'fonts.g' in u, lambda r:r.abort())
    pg=ctx.new_page(); pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m: errs.append('console: '+m.text) if m.type=='error' else None)
    return ctx,pg
def login(pg):
    pg.goto(BASE); pg.wait_for_selector('.login'); pg.fill('#lg-user',U); pg.fill('#lg-pass',P); pg.click('#lg-go'); pg.wait_for_selector('.login',state='detached'); pg.wait_for_timeout(900)
    if pg.locator('.asheet').count(): pg.get_by_role('button',name='Ahora no').click()
SEED='''async([T,T5,D40,LY])=>{
  const o=await import('/src/services/operators.js'), cat=await import('/src/services/catalogs.js'); await o.loadOperatorData();
  const ops=o.operatorList(), A=ops[0].id, B=ops[1].id; let n=0;
  const mk=async(op,division,destination,date,ref)=>{ await o.saveTrip({operatorId:op,division,date,origin:'Manzanillo',destination,reference:ref||(division==='puerto'?'MSCU'+String(1000000+(n++)):''),fare:1500000,travelExpenses:0,commissionRate:15,minEnabled:false,minAmount:0,baseCommission:225000,expandedCommission:0,finalCommission:225000,isExpanded:false,notes:''}); return o.allTrips().slice(-1)[0]; };
  const J=['Guadalajara, Jal.','Zapopan Jalisco','GDL','Tlajomulco','El Salto, Jalisco','Lagos de Moreno'];
  for(let i=0;i<6;i++) await mk(A,'puerto',J[i],i<3?T:LY+'-03-0'+(i+1));
  for(let i=0;i<4;i++) await mk(B,'campo','Nextipac',i<2?T:LY+'-05-1'+i);
  for(let i=0;i<23;i++) await mk(A,'puerto','Manzanillo, Col.',D40);
  await mk(B,'campo','CDMX',T); await mk(B,'campo','CDMX',T); await mk(A,'puerto','Apizaco, Tlax.',T);
  await cat.save('places',{name:'ALMACEN CLIENTE X',address:'Av. Industria 5, Col. Centro, Silao, Gto., C.P. 36100',rfc:'',contact:''});
  await mk(A,'puerto','Almacén Cliente X',T,'GTO-1');
  await mk(A,'puerto','La Paz',T,'LAPAZ1'); await mk(B,'campo','Bodega Norte',T);
  await mk(A,'puerto','Laredo, TX',T,'USA-1');
  const del=await mk(A,'puerto','Guadalajara',T,'BORRADO'); await o.deleteTrip(del.id);
  await mk(A,'puerto','Guadalajara',T5,'FUTURO');
  return {A,B};
}'''
PT='''async(code)=>{const m=await import('/src/domain/geo/mexico.js'); const g=await (await fetch('/assets/geo/mx-estados.json')).json();
  const s=g.states.find(x=>x.iso===m.stateByCode(code).iso); const svg=document.querySelector('.tm-page .tm-svg'); const pt=svg.createSVGPoint(); pt.x=s.cx; pt.y=s.cy;
  const q=pt.matrixTransform(svg.getScreenCTM()); return {x:q.x,y:q.y}}'''
def at(pg,code): return pg.evaluate(PT,code)
def kpi(pg,k): return pg.locator(f'[data-kpi="{k}"] b').inner_text().replace('\n',' ').strip()
def ds(pg,code): return pg.locator(f'.tm-page .tm-st[data-code="{code}"]').get_attribute('data-s')
def det(pg): return [x.replace(',','') for x in pg.locator('.tm-det-k b').all_inner_texts()]
def rgb(s): return [float(x) for x in re.findall(r'[\d.]+',s)[:3]]
def lum(c):
    f=lambda v:(v/255)/12.92 if v/255<=0.03928 else ((v/255+0.055)/1.055)**2.4
    r,g,b=c; return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b)
def contrast(a,b): la,lb=sorted([lum(a),lum(b)],reverse=True); return (la+0.05)/(lb+0.05)
try:
  with sync_playwright() as p:
    b=p.chromium.launch()
    # ===== I. Aviso de acceso restringido =====
    ctx,pg=newctx(b)
    pg.goto(BASE); pg.wait_for_selector('.login'); pg.wait_for_selector('#splash',state='detached'); pg.wait_for_timeout(300)
    n=pg.locator('.login-notice')
    ok(n.count()==1 and n.locator('b').inner_text().strip()==NOTICE_T and n.locator('p').inner_text().replace(NOTICE_T,'').strip()==NOTICE_P,'1) el aviso dice exactamente «ACCESO RESTRINGIDO» y el texto indicado')
    fb=pg.locator('.login form').bounding_box(); nb=n.bounding_box(); ft=pg.locator('.login-foot').bounding_box()
    ok(nb['y']>=fb['y']+fb['height'] and ft['y']>=nb['y']+nb['height']-1,'2) va debajo del formulario (después de «Entrar») y antes de la versión y el aviso legal')
    st=n.evaluate("e=>{const c=getComputedStyle(e),t=getComputedStyle(e.querySelector('b')),p=getComputedStyle(e.querySelector('p'));return {bl:c.borderLeftColor,bg:c.backgroundColor,t:t.color,p:p.color,fs:parseFloat(p.fontSize),ft:parseFloat(t.fontSize),pos:c.position}}")
    red=lambda c: c[0]>150 and c[1]<90 and c[2]<90
    ok(not any(red(rgb(st[k])) for k in ['bl','t','p']) and rgb(st['t'])[2]>rgb(st['t'])[0],'3) sobrio: azul corporativo, sin rojo ni tono de alarma')
    ok(st['fs']>=12 and st['ft']>=12 and contrast(rgb(st['p']),rgb(st['bg']))>=4.5,'4) legible en iPhone: letra de %.0f px y contraste %.1f:1'%(st['fs'],contrast(rgb(st['p']),rgb(st['bg']))))
    ok(nb['x']>=0 and nb['x']+nb['width']<=390 and st['pos']=='static','5) cabe en el ancho del iPhone y no flota sobre el formulario')
    ok(pg.locator('[role=dialog],[role=alertdialog],.asheet,.bsheet').count()==0 and n.evaluate("e=>e.tagName")=='ASIDE','6) no es una ventana emergente ni bloquea el acceso')
    shot(pg,'01_aviso_iphone')
    # Teclado abierto: la ventana visible se reduce; el aviso se alcanza desplazando y los campos siguen a la vista
    pg.set_viewport_size({'width':390,'height':420}); pg.focus('#lg-pass'); pg.wait_for_timeout(200)
    pass_vis=pg.locator('#lg-pass').evaluate("e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight}")
    n.scroll_into_view_if_needed(); pg.wait_for_timeout(200); nb2=n.bounding_box()
    ok(pass_vis and nb2['y']>=0 and nb2['y']+nb2['height']<=421,'7) con el teclado abierto el campo de contraseña sigue visible y el aviso se alcanza al desplazar')
    pg.set_viewport_size({'width':390,'height':844})
    pg.fill('#lg-user',U); pg.fill('#lg-pass',P+'x'); pg.click('#lg-go'); pg.wait_for_selector('#lg-msg:not(:empty)')
    ok('incorrectos' in pg.locator('#lg-msg').inner_text() and pg.locator('.login').count()==1,'8) la autenticación no cambió: contraseña incorrecta sigue rechazada')
    pg.fill('#lg-pass',P); pg.click('#lg-go'); pg.wait_for_selector('.login',state='detached'); pg.wait_for_timeout(900)
    ok(pg.locator('.login-notice').count()==0 and pg.locator('#view').inner_html()!='','9) con credenciales correctas entra como siempre y el aviso ya no se muestra')
    ctx.close()
    for name,k in [('oscuro',{'color_scheme':'dark'}),('ipad',{'viewport':{'width':820,'height':1180}}),('escritorio',{'viewport':{'width':1280,'height':800}})]:
        ctx,pg=newctx(b,**k); pg.goto(BASE); pg.wait_for_selector('.login'); pg.wait_for_selector('#splash',state='detached'); pg.wait_for_timeout(300)
        st=pg.locator('.login-notice').evaluate("e=>{const c=getComputedStyle(e),p=getComputedStyle(e.querySelector('p'));return {bg:c.backgroundColor,p:p.color,w:e.getBoundingClientRect().width,vis:e.checkVisibility()}}")
        ok(st['vis'] and contrast(rgb(st['p']),rgb(st['bg']))>=4.5 and st['w']>200,f'10) aviso legible en {name} (contraste {contrast(rgb(st["p"]),rgb(st["bg"])):.1f}:1)')
        shot(pg,'02_aviso_'+name); ctx.close()
    # Sin sesión el mapa no se puede abrir ni se descargan sus datos
    ctx,pg=newctx(b); pg.goto(BASE+'#/operacion/mapa'); pg.wait_for_selector('.login'); pg.wait_for_timeout(800)
    loaded=pg.evaluate("performance.getEntriesByType('resource').map(r=>r.name)")
    ok(pg.locator('.tm-page').count()==0 and not any('tripsMap' in x or 'mx-estados' in x or 'operators.js' in x for x in loaded),'11) sin sesión el mapa no se muestra y no se carga ni su código ni la geometría ni los viajes')
    ctx.close()

    # ===== II. Mapa de viajes (computadora) =====
    ctx,pg=newctx(b,viewport={'width':1280,'height':900}); login(pg)
    ids=pg.evaluate(SEED,[T,T5,D40,LY])
    pg.goto(BASE+'#/operacion'); pg.wait_for_selector('.mod-card'); pg.wait_for_timeout(300)
    card=pg.locator('.mod-card',has_text='Mapa de viajes')
    ok(card.count()==1 and card.get_attribute('href')=='#/operacion/mapa','12) Operación → «Mapa de viajes»')
    pg.goto(BASE+'#/'); pg.wait_for_selector('.tm-home',timeout=10000); pg.wait_for_timeout(300)
    h=pg.locator('.tm-home').inner_text()
    ok('39 viajes' in h and '5 de 32 estados' in h and 'Colima' in h and 'Explorar mapa' in h and pg.locator('.tm-home .tm-st[data-s="5"]').count()==1,'13) Inicio: tarjeta «Cobertura nacional» con total, estados atendidos, mayor actividad, mapa en miniatura y «Explorar mapa»')
    shot(pg,'03_inicio')
    pg.locator('.tm-home').click(); pg.wait_for_selector('.tm-page'); pg.wait_for_timeout(250)
    entering=pg.evaluate("()=>{const p=document.querySelector('.tm-page'),c=document.querySelector('.tm-card');return {cls:p.className,op:+getComputedStyle(c).opacity}}")
    pg.wait_for_timeout(1300)
    after=pg.evaluate("()=>{const p=document.querySelector('.tm-page');return {cls:p.className,filled:document.querySelector('.tm-page .tm-svg').classList.contains('tm-filled'),op:+getComputedStyle(document.querySelector('.tm-card')).opacity}}")
    ok('tm-enter' in entering['cls'] and entering['op']<1 and 'tm-enter' not in after['cls'] and after['filled'] and after['op']==1,'14) animación de entrada (tarjeta, estados, intensidades y controles) que termina antes de 1.3 s')
    paths=pg.evaluate("()=>[...document.querySelectorAll('.tm-page .tm-st')].map(p=>p.dataset.code)")
    ok(len(paths)==32 and sorted(paths)==[f'{i:02d}' for i in range(1,33)],'15) mapa con las 32 entidades (claves 01–32, incluida la Ciudad de México 09)')
    ok(kpi(pg,'total')=='39' and kpi(pg,'states').startswith('5') and kpi(pg,'puerto')=='32' and kpi(pg,'campo')=='7' and kpi(pg,'leader')=='Colima','16) indicadores: 39 viajes, 5 estados atendidos, Puerto 32, Campo 7, mayor actividad Colima')
    ok(ds(pg,'06')=='5' and ds(pg,'14') not in ('0',None) and ds(pg,'26')=='0' and ds(pg,'03')=='0','17) intensidad: Colima la más alta, Jalisco con color, Sonora y BCS sin viajes')
    c0=pg.locator('.tm-page .tm-st[data-code="26"]').evaluate("e=>getComputedStyle(e).fill"); c5=pg.locator('.tm-page .tm-st[data-code="06"]').evaluate("e=>getComputedStyle(e).fill")
    ok(c0!=c5 and rgb(c5)[2]>rgb(c5)[0],'18) escala azul: sin viajes gris claro, más viajes azul más intenso')
    lg=pg.locator('[data-legend]').inner_text()
    ok('Viajes registrados' in lg and 'Sin viajes' in lg and '11–23' in lg,'19) leyenda «Viajes registrados» con «Sin viajes» y rangos')
    foot=pg.locator('.tm-foot').inner_text()
    ok('37 en el mapa + 2 sin estado identificado = 39 viajes' in foot and '1 viaje con fecha posterior a hoy' in foot,'20) consistencia: 37 en el mapa + 2 sin estado identificado = 39; el viaje futuro y el eliminado no cuentan')
    ok('1 viaje con destino fuera de México' in pg.locator('[data-foreign]').inner_text(),'21) el viaje a Laredo, TX va aparte (fuera de México)')
    top=[x.split('\n')[1] for x in pg.locator('.tm-rk').all_inner_texts()]
    ok(top==['Colima','Jalisco','Ciudad de México','Guanajuato','Tlaxcala'],'22) Top 5: '+', '.join(top))
    shot(pg,'04_mapa',True)
    # Señalar con el ratón
    xy=at(pg,'14'); pg.mouse.move(xy['x'],xy['y']); pg.wait_for_timeout(200)
    tip=pg.locator('.tm-page .tm-tip').inner_text()
    ok(pg.locator('.tm-page .tm-tip').is_visible() and 'JALISCO' in tip and 'Viajes: 10' in tip and 'División Puerto: 6' in tip and 'División Campo: 4' in tip,'23) al señalar Jalisco: JALISCO · Viajes: 10 · División Puerto: 6 · División Campo: 4')
    ok(pg.locator('.tm-hov').get_attribute('d')!='','24) contorno naranja al señalar')
    shot(pg,'05_tooltip')
    pg.mouse.click(xy['x'],xy['y']); pg.wait_for_timeout(500)
    ok(pg.locator('.tm-page .tm-st[data-code="14"]').get_attribute('aria-pressed')=='true' and pg.locator('.tm-selp').get_attribute('d')!='' and pg.locator('.tm-page .tm-st.dim').count()==31,'25) clic: Jalisco queda elegido (contorno, los demás atenuados)')
    ok(pg.locator('.tm-side h2').inner_text()=='Jalisco' and det(pg)==['10','6','4'],'26) panel lateral: Jalisco 10 viajes, Puerto 6, Campo 4')
    ok(pg.locator('.tm-side .tm-trip').count()==10,'27) lista con los 10 viajes de Jalisco')
    pg.locator('.tm-side [data-ddiv="puerto"]').click(); pg.wait_for_timeout(150); np_=pg.locator('.tm-side .tm-trip').count()
    pg.locator('.tm-side [data-ddiv="campo"]').click(); pg.wait_for_timeout(150); nc=pg.locator('.tm-side .tm-trip').count()
    pg.locator('.tm-side [data-ddiv="all"]').click(); pg.wait_for_timeout(150)
    ok(np_==6 and nc==4,'28) filtro de división en el detalle: 6 Puerto, 4 Campo')
    pg.fill('.tm-side [data-dq]','zapopan'); pg.wait_for_timeout(150); ns=pg.locator('.tm-side .tm-trip').count(); pg.fill('.tm-side [data-dq]',''); pg.wait_for_timeout(150)
    first=pg.locator('.tm-side .tm-trip .tm-tr2').first.inner_text(); pg.locator('.tm-side [data-dsort]').click(); pg.wait_for_timeout(150); first2=pg.locator('.tm-side .tm-trip .tm-tr2').first.inner_text()
    ok(ns==1 and str(LY) not in first and str(LY) in first2 and 'Más antiguos' in pg.locator('.tm-side [data-dsort]').inner_text(),'29) búsqueda («zapopan» → 1) y orden más reciente / más antiguo')
    pg.locator('.tm-side [data-dsort]').click(); pg.wait_for_timeout(100)
    row=pg.locator('.tm-side .tm-trip',has_text='Nextipac').first; tid=row.get_attribute('data-trip'); opid=row.get_attribute('data-op')
    ok('Operador:' in row.inner_text() and 'Campo' in row.inner_text() and 'Realizado' in row.inner_text(),'30) cada viaje muestra fecha, división, origen → destino, operador y estado')
    row.click(); pg.wait_for_timeout(1200)
    ok(pg.url.endswith(f'#/operadores/{opid}?viaje={tid}') and pg.locator('.bsheet').count()>=1,'31) abre el viaje original en Operadores (no hay registro paralelo)')
    shot(pg,'06_viaje')
    pg.go_back(); pg.wait_for_selector('.tm-page'); pg.wait_for_timeout(600)
    ok(pg.locator('.tm-page .tm-st[data-code="14"]').get_attribute('aria-pressed')=='true' and pg.locator('.tm-side h2').inner_text()=='Jalisco' and 'tm-enter' not in pg.locator('.tm-page').get_attribute('class'),'32) al volver Jalisco sigue elegido y la animación de entrada no se repite')
    # Filtros
    pg.locator('[data-div="puerto"]').click(); pg.wait_for_timeout(350)
    ok(kpi(pg,'total')=='32' and det(pg)==['6','6','0'] and 'tm-enter' not in pg.locator('.tm-page').get_attribute('class'),'33) División Puerto: total 32, Jalisco 6 (sin repetir la entrada)')
    pg.locator('[data-div="campo"]').click(); pg.wait_for_timeout(350)
    ok(kpi(pg,'total')=='7' and det(pg)==['4','0','4'] and ds(pg,'06')=='0','34) División Campo: total 7, Jalisco 4, Colima sin viajes')
    pg.locator('[data-kpi="campo"]').click(); pg.wait_for_timeout(300)
    ok(pg.locator('[data-div="all"]').get_attribute('aria-pressed')=='true' and kpi(pg,'total')=='39','35) tocar el indicador activo quita el filtro (vuelve a Todas)')
    pg.locator('[data-kpi="puerto"]').click(); pg.wait_for_timeout(300); kp=kpi(pg,'total'); pg.locator('[data-kpi="total"]').click(); pg.wait_for_timeout(300)
    ok(kp=='32' and kpi(pg,'total')=='39','36) tocar «División Puerto» filtra; «Total de viajes» vuelve a todas')
    exp_month=5+2+1+1+2; exp_year=exp_month+(23 if D40[:4]==T[:4] else 0)
    pg.locator('[data-per="month"]').click(); pg.wait_for_timeout(300); km=kpi(pg,'total'); dm=det(pg)
    pg.locator('[data-per="30d"]').click(); pg.wait_for_timeout(300); k30=kpi(pg,'total')
    pg.locator('[data-per="year"]').click(); pg.wait_for_timeout(300); ky=kpi(pg,'total')
    ok(km==str(exp_month) and dm==['5','3','2'] and k30==str(exp_month) and ky==str(exp_year),f'37) periodos: este mes {km} (Jalisco 5 = 3 + 2), últimos 30 días {k30}, este año {ky}')
    pg.locator('[data-div="puerto"]').click(); pg.locator('[data-per="month"]').click(); pg.wait_for_timeout(300)
    ok(det(pg)==['3','3','0'] and 'Este mes' in pg.locator('[data-per-l]').inner_text() and 'Puerto' in pg.locator('[data-per-l]').inner_text(),'38) filtros combinados: Puerto + este mes → Jalisco 3')
    pg.locator('[data-div="all"]').click(); pg.locator('[data-per="range"]').click(); pg.wait_for_selector('.tm-range')
    pg.fill('.tm-range [name=from]',f'{LY}-01-01'); pg.fill('.tm-range [name=to]',f'{LY}-12-31'); pg.locator('.tm-range [type=submit]').click(); pg.wait_for_timeout(400)
    ok(kpi(pg,'total')=='5' and det(pg)==['5','3','2'] and str(LY) in pg.locator('[data-per-l]').inner_text(),f'39) rango personalizado {LY}: 5 viajes, todos de Jalisco')
    pg.locator('[data-per="all"]').click(); pg.wait_for_timeout(300)
    # Paginación (Colima 23)
    pg.locator('.tm-rk',has_text='Colima').click(); pg.wait_for_timeout(300)
    p1=pg.locator('.tm-side .tm-trip').count(); pgt=pg.locator('.tm-side .tm-pager').inner_text(); pg.locator('.tm-side [data-pg="1"]').click(); pg.wait_for_timeout(200)
    ok(p1==20 and 'Página 1 de 2' in pgt and pg.locator('.tm-side .tm-trip').count()==3,'40) paginación: Colima 23 → 20 + 3')
    # Guanajuato por la dirección del catálogo
    pg.locator('.tm-rk',has_text='Guanajuato').click(); pg.wait_for_timeout(300)
    ok('dirección del catálogo' in pg.locator('.tm-side .tm-trip').first.inner_text(),'41) «Almacén Cliente X» se ubica en Guanajuato por la dirección del catálogo de destinos (se indica en el viaje)')
    # Lista de las 32 entidades (para estados pequeños)
    pg.locator('.tm-all summary').click(); pg.locator('.tm-allb',has_text='Tlaxcala').click(); pg.wait_for_timeout(300)
    ok(pg.locator('.tm-side h2').inner_text()=='Tlaxcala' and pg.locator('.tm-allb').count()==32,'42) las 32 entidades en lista: Tlaxcala se elige sin apuntar en el mapa')
    # Zoom
    vb0=pg.locator('.tm-page .tm-svg').get_attribute('viewBox'); pg.locator('[data-zoom="in"]').click(); pg.wait_for_timeout(100); vb1=pg.locator('.tm-page .tm-svg').get_attribute('viewBox')
    sy=pg.evaluate('scrollY'); xy=at(pg,'20'); pg.mouse.move(xy['x'],xy['y']); pg.mouse.wheel(0,200); pg.wait_for_timeout(250); vb2=pg.locator('.tm-page .tm-svg').get_attribute('viewBox'); sy2=pg.evaluate('scrollY')
    xy=at(pg,'20'); pg.mouse.move(xy['x'],xy['y']); pg.keyboard.down('Control'); pg.mouse.wheel(0,-200); pg.keyboard.up('Control'); pg.wait_for_timeout(150); vb3=pg.locator('.tm-page .tm-svg').get_attribute('viewBox')
    pg.locator('[data-zoom="reset"]').click(); pg.wait_for_timeout(100)
    ok(float(vb1.split()[2])<1000 and vb2==vb1 and sy2>sy and float(vb3.split()[2])<float(vb1.split()[2]) and pg.locator('.tm-page .tm-svg').get_attribute('viewBox')==vb0,'43) zoom con botones y Ctrl + rueda; la rueda sola desplaza la página; «ver todo» restablece')
    # Sin estado identificado: asignar entidad (sin modificar el viaje ni las finanzas)
    fin0=pg.evaluate("async(ids)=>{const o=await import('/src/services/operators.js');return JSON.stringify([o.computeFor(ids.A),o.computeFor(ids.B)])}",ids)
    pg.locator('[data-unid]').click(); pg.wait_for_selector('.tm-ug'); pg.wait_for_timeout(300)
    ug=pg.locator('.bsheet').inner_text()
    ok('La Paz' in ug and 'Baja California Sur' in ug and 'Bodega Norte' in ug and pg.locator('[data-assign]').count()==2,'44) «Viajes sin estado identificado»: La Paz (ambiguo, explica las opciones) y Bodega Norte, con «Asignar estado»')
    shot(pg,'07_sin_estado')
    pg.locator('.tm-ug',has_text='La Paz').locator('[data-assign]').click(); pg.wait_for_selector('.picker'); pg.wait_for_timeout(300)
    firsts=[x.split('\n')[0] for x in pg.locator('.picker .pk-row').all_inner_texts()[:2]]
    pg.locator('.picker .pk-row').filter(has_text=re.compile(r'^Baja California Sur')).first.click(); pg.wait_for_timeout(900)
    ok(firsts==['Baja California Sur','México'] and ds(pg,'03')!='0' and kpi(pg,'total')=='39' and kpi(pg,'states').startswith('6'),'45) asignar: primero las entidades posibles; La Paz → Baja California Sur; total sigue en 39, estados atendidos 6')
    trip=pg.evaluate("async()=>{const o=await import('/src/services/operators.js');return o.allTrips().find(t=>t.reference==='LAPAZ1')}")
    fin1=pg.evaluate("async(ids)=>{const o=await import('/src/services/operators.js');return JSON.stringify([o.computeFor(ids.A),o.computeFor(ids.B)])}",ids)
    ok(trip['destination']=='La Paz' and fin0==fin1,'46) el viaje original no cambia (destino «La Paz») y los cálculos de los operadores son idénticos')
    ok('36 en el mapa' not in pg.locator('.tm-foot').inner_text() and '38 en el mapa + 1 sin estado identificado = 39' in pg.locator('.tm-foot').inner_text(),'47) consistencia después de asignar: 38 + 1 = 39')
    pg.locator('[data-unid]').click(); pg.wait_for_selector('.tm-ov'); pg.locator('.tm-ov',has_text='La Paz').locator('[data-unassign]').click(); pg.wait_for_timeout(900)
    ok(ds(pg,'03')=='0' and '2 sin estado identificado' in pg.locator('.tm-foot').inner_text(),'48) quitar la asignación regresa el viaje a «sin estado identificado»')
    pg.locator('[data-foreign]').click(); pg.wait_for_timeout(400)
    ok('Laredo, TX' in pg.locator('.bsheet').inner_text(),'49) lista de destinos fuera de México'); pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    # Se actualiza solo
    pg.evaluate("async(ids)=>{const o=await import('/src/services/operators.js'); await o.saveTrip({operatorId:ids.A,division:'campo',date:new Date().toISOString().slice(0,10),origin:'Manzanillo',destination:'Guadalajara',fare:100000,travelExpenses:0,commissionRate:15,minEnabled:false,minAmount:0,baseCommission:15000,expandedCommission:0,finalCommission:15000,isExpanded:false,notes:''}); window.dispatchEvent(new CustomEvent('pcs:sync'));}",ids)
    pg.wait_for_timeout(700)
    ok(kpi(pg,'total')=='40' and pg.locator('.tm-rk',has_text='Jalisco').locator('.tm-rk-c').inner_text()=='11','50) al llegar viajes nuevos (Información compartida) el mapa se actualiza: Jalisco 11')
    # Respaldo y modo consulta
    bk=pg.evaluate("async()=>{const m=await import('/src/services/backup.js'); const o=JSON.parse(await (await m.exportBackup()).text()); return Array.isArray(o.data.destStates)}")
    ok(bk,'51) el respaldo incluye las asignaciones de entidad')
    pg.evaluate("async()=>{(await import('/src/services/access.js')).setReadOnly(true)}"); pg.wait_for_timeout(200)
    pg.locator('[data-unid]').click(); pg.wait_for_selector('.tm-ug'); pg.wait_for_timeout(200)
    ro=pg.locator('[data-assign]').count()
    err=pg.evaluate("async()=>{try{await (await import('/src/services/tripsMap.js')).setDestState('La Paz','03');return ''}catch(e){return e.message}}")
    ok(ro==0 and 'consulta' in err,'52) modo consulta: se ve el detalle, pero no se puede asignar entidad')
    pg.keyboard.press('Escape'); pg.evaluate("async()=>{(await import('/src/services/access.js')).setReadOnly(false)}")
    # Salida breve
    out=pg.evaluate("async()=>{document.querySelector('.tm-page [data-back]').click(); await new Promise(r=>setTimeout(r,90)); const p=document.querySelector('.tm-page'); return !!(p&&p.classList.contains('tm-out'))}")
    pg.wait_for_timeout(500)
    ok(out and pg.locator('.tm-page').count()==0,'53) salida breve (240 ms) al dejar el mapa')
    ctx.close()

    # ===== III. iPhone =====
    ctx,pg=newctx(b); login(pg); ids=pg.evaluate(SEED,[T,T5,D40,LY])
    pg.goto(BASE+'#/operacion/mapa'); pg.wait_for_selector('.tm-page'); pg.wait_for_timeout(1400)
    ok(pg.locator('.tm-side').evaluate("e=>getComputedStyle(e).display")=='none' and pg.locator('.tm-stage').evaluate("e=>getComputedStyle(e).touchAction")=='pan-y','54) iPhone: mapa a todo el ancho, sin panel lateral; un dedo desplaza la página')
    xy=at(pg,'14'); pg.touchscreen.tap(xy['x'],xy['y']); pg.wait_for_timeout(700)
    sh=pg.locator('.tm-sheet')
    ok(sh.count()==1 and 'Jalisco' in sh.locator('.bsheet-title').inner_text() and det(pg)==['10','6','4'] and sh.locator('.tm-trip').count()==10,'55) tocar Jalisco abre la hoja inferior con 10 viajes (6 + 4)')
    shot(pg,'08_iphone_hoja')
    sh.locator('.tm-trip').first.click(); pg.wait_for_timeout(1200)
    ok('/operadores/' in pg.url,'56) desde la hoja se abre el viaje original')
    pg.go_back(); pg.wait_for_selector('.tm-page'); pg.wait_for_timeout(900)
    ok(pg.locator('.tm-sheet').count()==1 and 'Jalisco' in pg.locator('.tm-sheet .bsheet-title').inner_text(),'57) al volver, la hoja de Jalisco se abre de nuevo')
    pg.locator('.tm-sheet .bsheet-x').click(); pg.wait_for_timeout(400)
    ok(pg.locator('.tm-page .tm-st[data-code="14"]').get_attribute('aria-pressed')=='true' and 'Jalisco' in pg.locator('[data-selbar]').inner_text(),'58) al cerrar la hoja el estado sigue elegido, con acceso rápido a sus viajes')
    shot(pg,'09_iphone_mapa',True)
    # Pellizco con dos dedos
    vb=pg.evaluate("""()=>{const st=document.querySelector('.tm-stage'),r=st.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2;
      const mk=(d)=>[new Touch({identifier:1,target:st,clientX:cx-d,clientY:cy}),new Touch({identifier:2,target:st,clientX:cx+d,clientY:cy})];
      const ev=(t,ts)=>st.dispatchEvent(new TouchEvent(t,{touches:ts,targetTouches:ts,changedTouches:ts,bubbles:true,cancelable:true}));
      ev('touchstart',mk(30)); ev('touchmove',mk(60)); ev('touchmove',mk(90)); ev('touchend',[]);
      return {vb:document.querySelector('.tm-page .tm-svg').getAttribute('viewBox'),z:st.classList.contains('zoomed'),ta:getComputedStyle(st).touchAction}}""")
    ok(float(vb['vb'].split()[2])<500 and vb['z'] and vb['ta']=='none','59) pellizco: acerca el mapa (×3) y, con zoom, los gestos mueven el mapa en lugar de la página')
    pg.locator('[data-zoom="reset"]').click(); pg.wait_for_timeout(100)
    ok(pg.locator('.tm-perf').evaluate("e=>e.scrollWidth>e.clientWidth") and pg.evaluate("document.documentElement.scrollWidth<=innerWidth"),'60) filtros compactos con desplazamiento horizontal; la página no se desborda')
    ctx.close()

    # ===== IV. Reducir movimiento y tema oscuro =====
    ctx,pg=newctx(b,reduced_motion='reduce',color_scheme='dark'); login(pg); pg.evaluate(SEED,[T,T5,D40,LY])
    pg.goto(BASE+'#/operacion/mapa'); pg.wait_for_selector('.tm-page'); pg.wait_for_timeout(150)
    r=pg.evaluate("()=>({cls:document.querySelector('.tm-page').className,filled:document.querySelector('.tm-page .tm-svg').classList.contains('tm-filled'),tr:getComputedStyle(document.querySelector('.tm-page .tm-st')).transitionDuration,op:+getComputedStyle(document.querySelector('.tm-card')).opacity})")
    ok('tm-enter' not in r['cls'] and r['filled'] and r['op']==1 and set(r['tr'].replace(' ','').split(','))=={'0s'},'61) «reducir movimiento»: el mapa aparece completo, sin animaciones')
    c5=rgb(pg.locator('.tm-page .tm-st[data-code="06"]').evaluate("e=>getComputedStyle(e).fill")); c0=rgb(pg.locator('.tm-page .tm-st[data-code="26"]').evaluate("e=>getComputedStyle(e).fill"))
    ok(lum(c5)>lum(c0),'62) tema oscuro: más viajes = azul más claro sobre fondo oscuro')
    shot(pg,'10_oscuro',True)
    ctx.close()
    b.close()
finally:
  srv.terminate()
print('\n'.join(log)); print('errores:',errs or 'ninguno')
