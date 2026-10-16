"""Información legal de punta a punta (no requiere credenciales): legal.html con sus tres pestañas (Aviso de privacidad,
Condiciones de uso, Cookies) sin iniciar sesión y sin cargar la app, enlaces desde el acceso y desde Ajustes, sin
cookies, sin desplazamiento horizontal en iPhone, modo oscuro, computadora y regreso a la app (no desde el portal de clientes)."""
import subprocess, time, sys, os
from playwright.sync_api import sync_playwright
HERE=os.path.dirname(os.path.abspath(__file__)); APP=os.path.abspath(os.path.join(HERE,'..')); SH='shots'; os.makedirs(SH,exist_ok=True)
ROOT='http://127.0.0.1:8789/'
srv=subprocess.Popen([sys.executable,'-m','http.server','8789','--bind','127.0.0.1'],cwd=APP,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(1)
SESSION="""(()=>{const n=Date.now();sessionStorage.setItem('pcs-session',JSON.stringify({v:1,user:'prueba',name:'Prueba',role:'admin',at:n,exp:n+3600000}));})()"""
errs=[]; log=[]
def ok(c,m): log.append(('OK  ' if c else 'FAIL')+' '+m)
def ctx_of(b, **kw):
    o=dict(viewport={'width':390,'height':844},device_scale_factor=2,is_mobile=True,has_touch=True,service_workers='block'); o.update(kw)
    c=b.new_context(**o); c.route(lambda u:'cdnjs' in u or 'fonts.g' in u, lambda r:r.abort()); return c
def page(c):
    pg=c.new_page(); pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m: errs.append('console: '+m.text) if m.type=='error' else None); return pg
def noscroll(pg): return pg.evaluate("document.documentElement.scrollWidth<=window.innerWidth")
try:
  with sync_playwright() as p:
    b=p.chromium.launch()
    c=ctx_of(b); pg=page(c); reqs=[]; pg.on('request',lambda r:reqs.append(r.url))
    pg.goto(ROOT+'legal.html'); pg.wait_for_selector('.lg-doc h1')
    ok(pg.locator('h1').inner_text()=='Aviso de privacidad integral' and pg.title()=='Aviso de privacidad integral · PERCONSUR','sin dirección de pestaña se abre el Aviso de privacidad integral')
    t=pg.locator('.lg-doc').inner_text()
    ok('PERCONSUR DE NAYARIT GROUP' in t and 'Zapopan, Jalisco' in t and 'logistica@perconsur.mx' in t and 'Última actualización' in t,'responsable, domicilio, contacto y fecha de actualización visibles')
    ok(pg.locator('.lg-sec').count()==7 and pg.locator('.lg-sec ul li').count()>=15,'aviso: 7 apartados con sus listas')
    ok(not any('/src/main.js' in u or '/src/auth/' in u or '/services/db' in u for u in reqs),'la página legal no carga la app ni sus datos (se abre sin iniciar sesión)')
    ok(noscroll(pg),'iPhone: sin desplazamiento horizontal'); pg.screenshot(path=f'{SH}/legal_01_privacidad.png',full_page=True)
    pg.click('.lg-tabs a[href="#condiciones"]'); pg.wait_for_selector('h1:text-is("Condiciones de uso")')
    ok(pg.locator('.lg-tabs a[aria-current=page]').inner_text()=='Condiciones de uso' and 'personales e intransferibles' in pg.locator('.lg-doc').inner_text() and pg.evaluate("location.hash")=='#condiciones','pestaña Condiciones de uso (marcada y con su dirección)')
    pg.click('.lg-tabs a[href="#cookies"]'); pg.wait_for_selector('h1:text-is("Cookies y almacenamiento")')
    ok('no usan cookies' in pg.locator('.lg-doc').inner_text(),'pestaña Cookies: la app no usa cookies'); pg.screenshot(path=f'{SH}/legal_02_cookies.png',full_page=True)
    pg.go_back(); pg.wait_for_selector('h1:text-is("Condiciones de uso")')
    ok(True,'el botón Atrás regresa a la pestaña anterior')
    ok(c.cookies()==[],'no se guardó ninguna cookie')
    # Acceso: aviso de aceptación con enlaces (sin casilla: el inicio de sesión es la aceptación)
    pg.goto(ROOT+'index.html'); pg.wait_for_selector('.login .login-terms')
    lt=pg.locator('.login-terms'); links=lt.locator('a')
    ok('Al iniciar sesión aceptas las Condiciones de uso' in lt.inner_text() and links.count()==2 and links.nth(0).get_attribute('href')=='./legal.html#condiciones' and links.nth(1).get_attribute('href')=='./legal.html#privacidad' and all(links.nth(i).get_attribute('target')=='_blank' for i in range(2)),'acceso: aviso de aceptación con enlaces a Condiciones de uso y Aviso de privacidad (en otra pestaña)')
    box=lt.bounding_box(); go=pg.locator('#lg-go').bounding_box(); nt=pg.locator('.login-notice').bounding_box()
    ok(box['y']>go['y']+go['height'] and box['y']>nt['y'] and noscroll(pg),'el aviso queda debajo del botón Entrar y del aviso de acceso restringido, sin desbordar')
    with c.expect_page() as np_: links.nth(1).click()
    lp=np_.value; lp.wait_for_selector('.lg-doc h1')
    ok(lp.locator('h1').inner_text()=='Aviso de privacidad integral' and pg.locator('.login').count()==1,'el enlace abre el aviso en otra pestaña y el acceso sigue en su lugar')
    lp.close(); pg.screenshot(path=f'{SH}/legal_03_acceso.png')
    c.close()
    # Ajustes con sesión
    c=ctx_of(b); c.add_init_script(SESSION); pg=page(c)
    pg.goto(ROOT+'index.html#/ajustes'); pg.wait_for_selector('[data-legal] a')
    a=pg.locator('[data-legal] a')
    ok(a.count()==3 and [a.nth(i).inner_text().strip() for i in range(3)]==['Aviso de privacidad','Condiciones de uso','Cookies y almacenamiento'] and [a.nth(i).get_attribute('href') for i in range(3)]==['./legal.html#privacidad','./legal.html#condiciones','./legal.html#cookies'],'Ajustes → Información legal: las tres pestañas')
    with c.expect_page() as np_: a.nth(2).click()
    lp=np_.value; lp.wait_for_selector('.lg-doc h1')
    ok(lp.locator('h1').inner_text()=='Cookies y almacenamiento' and pg.locator('[data-legal]').count()==1,'desde Ajustes se abre en otra pestaña sin salir de la app')
    lp.click('.lg-foot a'); lp.wait_for_selector('.home, .login',timeout=15000)
    ok(lp.locator('.home').count()==1,'«Ir a la aplicación» vuelve a la app')
    lp.close(); c.close()
    # Desde el portal de clientes: sin «Ir a la aplicación» (también al cambiar de pestaña)
    c=ctx_of(b); pg=page(c); pg.goto(ROOT+'legal.html?portal#privacidad'); pg.wait_for_selector('.lg-doc h1')
    ok(pg.locator('h1').inner_text()=='Aviso de privacidad integral' and pg.locator('.lg-foot a').count()==0 and 'Ir a la aplicación' not in pg.locator('body').inner_text() and pg.locator('.lg-foot small').count()==1,'desde el portal de clientes: sin «Ir a la aplicación» (queda el aviso de derechos)')
    pg.click('.lg-tabs a[href="#condiciones"]'); pg.wait_for_selector('.lg-doc h1:text("Condiciones de uso")')
    ok(pg.locator('.lg-foot a').count()==0,'desde el portal: al cambiar de pestaña sigue sin «Ir a la aplicación»'); c.close()
    # Modo oscuro y computadora
    c=ctx_of(b,color_scheme='dark'); pg=page(c); pg.goto(ROOT+'legal.html#condiciones'); pg.wait_for_selector('.lg-doc h1')
    bg=pg.evaluate("getComputedStyle(document.body).backgroundColor"); ink=pg.evaluate("getComputedStyle(document.querySelector('.lg-sec p, .lg-sec li')).color")
    ok(bg=='rgb(14, 18, 25)' and ink!='rgb(74, 84, 104)','modo oscuro: fondo y texto del tema oscuro de la app'); pg.screenshot(path=f'{SH}/legal_04_oscuro.png')
    c.close()
    c=b.new_context(viewport={'width':1280,'height':900},service_workers='block'); pg=page(c); pg.goto(ROOT+'legal.html'); pg.wait_for_selector('.lg-doc')
    w=pg.locator('.lg-doc').bounding_box()['width']
    ok(w<=760 and noscroll(pg),f'computadora: texto en una columna legible ({w:.0f} px)'); pg.screenshot(path=f'{SH}/legal_05_computadora.png')
    c.close(); b.close()
finally:
    srv.terminate()
ok(not errs,'sin errores en consola: '+'; '.join(errs[:3]))
print('\n'.join(log)); fails=[l for l in log if l.startswith('FAIL')]
print(f'\n{len(log)-len(fails)}/{len(log)} OK'); sys.exit(1 if fails else 0)
