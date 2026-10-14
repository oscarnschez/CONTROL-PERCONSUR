"""Apertura de la app (pantalla de carga de index.html): al abrir la PWA, puertas de contenedor con la placa de PERCONSUR
que se abren sobre el acceso (o sobre el panel si ya hay sesión); una vez por sesión (al recargar solo se desvanece), tocar
la adelanta, «reducir movimiento» la deja quieta, modo oscuro y computadora. No requiere credenciales."""
import subprocess, time, sys, os
from playwright.sync_api import sync_playwright
HERE=os.path.dirname(os.path.abspath(__file__)); APP=os.path.abspath(os.path.join(HERE,'..')); SH='shots'; os.makedirs(SH,exist_ok=True)
BASE='http://127.0.0.1:8785/index.html'
srv=subprocess.Popen([sys.executable,'-m','http.server','8785','--bind','127.0.0.1'],cwd=APP,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(1)
errs=[]; log=[]
def ok(c,m): log.append(('OK  ' if c else 'FAIL')+' '+m)
def shot(pg,n): pg.screenshot(path=f'{SH}/op_{n}.png')
# Registra cuándo se abren las puertas y cuándo se retira la pantalla (ms desde que se abrió la página)
WATCH="""(()=>{window.__sp={open:null,out:null,gone:null};const seen=()=>{const s=document.getElementById('splash');
  if(s){if(s.classList.contains('sp-open')&&window.__sp.open==null)window.__sp.open=performance.now();if(s.classList.contains('out')&&window.__sp.out==null)window.__sp.out=performance.now();}
  else if(window.__sp.gone==null&&document.body)window.__sp.gone=performance.now();};
  new MutationObserver(seen).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});})()"""
SESSION="""(()=>{const n=Date.now();sessionStorage.setItem('pcs-session',JSON.stringify({v:1,user:'prueba',name:'Prueba',role:'admin',at:n,exp:n+3600000}));})()"""
def sp(pg): return pg.evaluate("window.__sp")
def gone(pg): pg.wait_for_selector('#splash',state='detached',timeout=10000); pg.wait_for_timeout(100); return sp(pg)
def ctx_of(b, **kw):
    o=dict(viewport={'width':390,'height':844},device_scale_factor=2,is_mobile=True,has_touch=True,service_workers='block'); o.update(kw)
    c=b.new_context(**o); c.route(lambda u:'cdnjs' in u or 'fonts.g' in u, lambda r:r.abort()); c.add_init_script(WATCH); return c
def page(c):
    pg=c.new_page(); pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m: errs.append('console: '+m.text) if m.type=='error' else None); return pg
try:
  with sync_playwright() as p:
    b=p.chromium.launch()
    # Al abrir la app (sin sesión): puertas cerradas, placa y apertura sobre el acceso
    c=ctx_of(b); pg=page(c)
    pg.goto(BASE, wait_until='commit'); pg.wait_for_selector('#splash .sp-plate'); pg.wait_for_timeout(450)
    st=pg.evaluate("""()=>{const s=document.getElementById('splash'), cs=getComputedStyle(s);
      return {doors:s.querySelectorAll('.sp-door').length, hidden:[...s.querySelectorAll('.sp-door')].every(d=>d.getAttribute('aria-hidden')==='true'), role:s.getAttribute('role'), label:s.getAttribute('aria-label'),
        word:s.querySelector('.sp-word').textContent, legal:s.querySelector('.sp-legal').textContent, seal:s.querySelectorAll('.sp-seal i').length, mark:s.querySelector('.sp-mark').complete,
        open:s.classList.contains('sp-open'), warm:document.documentElement.classList.contains('sp-warm'), bg:cs.backgroundColor, door:cs.getPropertyValue('--door').trim(),
        anim:getComputedStyle(s.querySelector('.sp-word')).animationName}}""")
    ok(st['doors']==2 and st['hidden'] and st['seal']==2 and st['word']=='PERCONSUR' and st['legal']=='PERCONSUR DE NAYARIT GROUP' and st['mark'],'apertura: dos puertas de contenedor (decorativas para el lector de pantalla), placa con el logotipo, PERCONSUR, sello y razón social')
    ok(st['role']=='status' and st['label']=='Abriendo PERCONSUR' and not st['open'] and not st['warm'] and st['anim']=='spTrack' and st['door']=='#22377C','mientras carga: puertas cerradas en azul de la marca y el nombre cierra su espaciado (animación «spTrack»)')
    ok(st['bg'] not in ('rgba(0, 0, 0, 0)','transparent'),'el fondo es opaco hasta la apertura: el acceso no se asoma mientras aparecen las puertas'); shot(pg,'01_cerradas')
    pg.wait_for_selector('#splash.sp-open',timeout=8000); pg.wait_for_timeout(380); shot(pg,'02_abriendo')
    pe=pg.evaluate("getComputedStyle(document.getElementById('splash')).pointerEvents")
    t=gone(pg)
    ok(t['open'] is not None and 1100<=t['open']<=4000 and t['gone'] is not None and 750<=t['gone']-t['open']<=1400 and t['out'] is None,f"las puertas se abren al terminar la entrada y la pantalla se retira tras el giro (apertura {t['open']:.0f} ms, retiro {t['gone']:.0f} ms)")
    ok(pe=='none','al abrirse las puertas ya no bloquean los toques')
    ok(pg.locator('.login').is_visible() and pg.evaluate("sessionStorage.getItem('pcs-opened')")=='1','debajo estaba el acceso; la sesión recuerda que la app ya se abrió'); shot(pg,'03_acceso')
    # Recargar en la misma sesión: no se repite
    pg.reload(wait_until='commit'); pg.wait_for_selector('#splash'); t=gone(pg)
    ok(pg.evaluate("document.documentElement.classList.contains('sp-warm')") and t['open'] is None and t['out'] is not None and t['gone']<1500,f"al recargar en la misma sesión no se repite la apertura: solo se desvanece ({t['gone']:.0f} ms)")
    c.close()
    # Con sesión: las puertas se abren sobre el panel
    c=ctx_of(b); c.add_init_script(SESSION); pg=page(c)
    pg.goto(BASE); t=gone(pg)
    ok(t['open'] is not None and pg.locator('.home').count()==1 and pg.locator('.login').count()==0,'con sesión, las puertas se abren sobre el panel de Inicio')
    c.close()
    # Tocar adelanta la apertura
    c=ctx_of(b); pg=page(c)
    pg.goto(BASE, wait_until='commit'); pg.wait_for_selector('#splash .sp-plate'); pg.wait_for_timeout(150); pg.mouse.click(195,600); t=gone(pg)
    ok(t['open'] is not None and t['open']<1000,f"un toque adelanta la apertura en cuanto la app está lista ({t['open']:.0f} ms)")
    c.close()
    # «Reducir movimiento»: sin giros
    c=ctx_of(b, reduced_motion='reduce'); pg=page(c)
    pg.goto(BASE); t=gone(pg)
    ok(t['open'] is None and t['out'] is not None and t['gone']<2000 and pg.locator('.login').is_visible(),f"con «reducir movimiento» no hay giros: la placa se muestra quieta y se retira ({t['gone']:.0f} ms)")
    c.close()
    # Modo oscuro y computadora
    c=ctx_of(b, color_scheme='dark'); pg=page(c)
    pg.goto(BASE, wait_until='commit'); pg.wait_for_selector('#splash .sp-plate'); pg.wait_for_timeout(900)
    dk=pg.evaluate("()=>{const s=document.getElementById('splash');return {door:getComputedStyle(s).getPropertyValue('--door').trim(), word:getComputedStyle(s.querySelector('.sp-word')).color}}")
    ok(dk['door']=='#1A2A60' and dk['word']=='rgb(255, 255, 255)','modo oscuro: puertas más oscuras y el nombre en blanco'); shot(pg,'04_oscuro'); gone(pg)
    c.close()
    c=ctx_of(b, viewport={'width':1440,'height':900}, device_scale_factor=1, is_mobile=False, has_touch=False); pg=page(c)
    pg.goto(BASE, wait_until='commit'); pg.wait_for_selector('#splash .sp-plate'); pg.wait_for_timeout(900)
    r=pg.evaluate("()=>[...document.querySelectorAll('#splash .sp-door')].map(d=>Math.round(d.getBoundingClientRect().width))")
    ok(r==[720,720],'computadora: cada puerta cubre la mitad de la pantalla'); shot(pg,'05_escritorio')
    pg.wait_for_selector('#splash.sp-open',timeout=8000); pg.wait_for_timeout(380); shot(pg,'06_escritorio_abriendo'); gone(pg)
    ok(pg.locator('.login').is_visible(),'computadora: se abre sobre el acceso')
    c.close(); b.close()
finally:
  srv.terminate(); print('\n'.join(log)); print('errores:','; '.join(errs) or 'ninguno')
