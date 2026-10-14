"""Apertura de la app (pantalla de carga de index.html), sobria: al abrir la PWA, el logotipo y el nombre sobre el fondo de
la app con una línea fina de carga y la razón social al pie; al estar lista, la línea se completa y la pantalla se retira
sobre el acceso (o sobre el panel si ya hay sesión). Una vez por sesión (al recargar solo se desvanece), tocar la adelanta,
«reducir movimiento» la deja quieta, modo oscuro, computadora y el favicon (.ico). No requiere credenciales."""
import subprocess, time, sys, os
from playwright.sync_api import sync_playwright
HERE=os.path.dirname(os.path.abspath(__file__)); APP=os.path.abspath(os.path.join(HERE,'..')); SH='shots'; os.makedirs(SH,exist_ok=True)
BASE='http://127.0.0.1:8785/index.html'
srv=subprocess.Popen([sys.executable,'-m','http.server','8785','--bind','127.0.0.1'],cwd=APP,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(1)
errs=[]; log=[]
def ok(c,m): log.append(('OK  ' if c else 'FAIL')+' '+m)
def shot(pg,n): pg.screenshot(path=f'{SH}/op_{n}.png')
# Registra cuándo empieza la salida y cuándo se retira la pantalla (ms desde que se abrió la página)
WATCH="""(()=>{window.__sp={open:null,out:null,gone:null};const seen=()=>{const s=document.getElementById('splash');
  if(s){if(s.classList.contains('sp-exit')&&window.__sp.open==null)window.__sp.open=performance.now();if(s.classList.contains('out')&&window.__sp.out==null)window.__sp.out=performance.now();}
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
    # Al abrir la app (sin sesión): logotipo, nombre y línea de carga; luego se retira sobre el acceso
    c=ctx_of(b); pg=page(c)
    pg.goto(BASE, wait_until='commit'); pg.wait_for_selector('#splash .sp-mark'); pg.wait_for_timeout(450)
    st=pg.evaluate("""()=>{const s=document.getElementById('splash'), cs=getComputedStyle(s);
      return {role:s.getAttribute('role'), label:s.getAttribute('aria-label'), word:s.querySelector('.sp-word').textContent, legal:s.querySelector('.sp-legal').textContent,
        mark:s.querySelector('.sp-mark').complete, line:s.querySelectorAll('.sp-line i').length, lineHidden:s.querySelector('.sp-line').getAttribute('aria-hidden'), doors:s.querySelectorAll('.sp-door').length,
        exit:s.classList.contains('sp-exit'), warm:document.documentElement.classList.contains('sp-warm'), bg:cs.backgroundColor,
        anim:getComputedStyle(s.querySelector('.sp-word')).animationName, load:getComputedStyle(s.querySelector('.sp-line i')).animationName}}""")
    ok(st['word']=='PERCONSUR' and st['legal']=='PERCONSUR DE NAYARIT GROUP' and st['mark'] and st['line']==1 and st['lineHidden']=='true' and st['doors']==0,'apertura sobria: logotipo, PERCONSUR, línea de carga (decorativa para el lector de pantalla) y razón social al pie')
    ok(st['role']=='status' and st['label']=='Abriendo PERCONSUR' and not st['exit'] and not st['warm'] and st['anim']=='spRise' and st['load']=='spLoad','mientras carga: el logotipo y el nombre aparecen con un desvanecido breve y la línea avanza')
    ok(st['bg']=='rgb(244, 245, 248)','el fondo es el de la app y opaco hasta la salida: el acceso no se asoma'); shot(pg,'01_cargando')
    hrefs=pg.evaluate("()=>[...document.querySelectorAll('link[rel=icon]')].map(l=>l.getAttribute('href'))")
    ico=pg.request.get(BASE.replace('index.html','assets/icons/favicon.ico')); body=ico.body()
    ok(hrefs==['./assets/icons/favicon.ico'] and ico.ok and body[:4]==b'\x00\x00\x01\x00' and body[4]+body[5]*256==7,'favicon: el .ico de PERCONSUR con 7 tamaños (16 a 256 px) '+str(hrefs))
    pg.wait_for_selector('#splash.sp-exit',timeout=8000)
    pe=pg.evaluate("getComputedStyle(document.getElementById('splash')).pointerEvents"); pg.wait_for_timeout(200); shot(pg,'02_saliendo')
    t=gone(pg)
    ok(t['open'] is not None and 880<=t['open']<=4000 and t['gone'] is not None and 450<=t['gone']-t['open']<=950 and t['out'] is None,f"al terminar la entrada la línea se completa y la pantalla se retira (salida {t['open']:.0f} ms, retiro {t['gone']:.0f} ms)")
    ok(pe=='none','al empezar la salida ya no bloquea los toques')
    ok(pg.locator('.login').is_visible() and pg.evaluate("sessionStorage.getItem('pcs-opened')")=='1','debajo estaba el acceso; la sesión recuerda que la app ya se abrió'); shot(pg,'03_acceso')
    # Recargar en la misma sesión: no se repite
    pg.reload(wait_until='commit'); pg.wait_for_selector('#splash'); t=gone(pg)
    ok(pg.evaluate("document.documentElement.classList.contains('sp-warm')") and t['open'] is None and t['out'] is not None and t['gone']<1500,f"al recargar en la misma sesión no se repite la apertura: solo se desvanece ({t['gone']:.0f} ms)")
    c.close()
    # Con sesión: la pantalla se retira sobre el panel
    c=ctx_of(b); c.add_init_script(SESSION); pg=page(c)
    pg.goto(BASE); t=gone(pg)
    ok(t['open'] is not None and pg.locator('.home').count()==1 and pg.locator('.login').count()==0,'con sesión, la pantalla se retira sobre el panel de Inicio')
    c.close()
    # Tocar adelanta la apertura
    c=ctx_of(b); pg=page(c)
    pg.goto(BASE, wait_until='commit'); pg.wait_for_selector('#splash .sp-mark'); pg.wait_for_timeout(150); pg.mouse.click(195,600); t=gone(pg)
    ok(t['open'] is not None and t['open']<850,f"un toque adelanta la salida en cuanto la app está lista ({t['open']:.0f} ms)")
    c.close()
    # «Reducir movimiento»: sin giros
    c=ctx_of(b, reduced_motion='reduce'); pg=page(c)
    pg.goto(BASE); t=gone(pg)
    ok(t['open'] is None and t['out'] is not None and t['gone']<2000 and pg.locator('.login').is_visible(),f"con «reducir movimiento» no hay desplazamientos: el logotipo se muestra quieto y se retira ({t['gone']:.0f} ms)")
    c.close()
    # Modo oscuro y computadora
    c=ctx_of(b, color_scheme='dark'); pg=page(c)
    pg.goto(BASE, wait_until='commit'); pg.wait_for_selector('#splash .sp-mark'); pg.wait_for_timeout(700)
    dk=pg.evaluate("()=>{const s=document.getElementById('splash');return {bg:getComputedStyle(s).backgroundColor, word:getComputedStyle(s.querySelector('.sp-word')).color, line:getComputedStyle(s.querySelector('.sp-line i')).backgroundColor}}")
    ok(dk['bg']=='rgb(14, 18, 25)' and dk['word']=='rgb(232, 235, 242)' and dk['line']=='rgb(147, 167, 238)','modo oscuro: fondo oscuro de la app, nombre claro y línea en azul claro'); shot(pg,'04_oscuro'); gone(pg)
    c.close()
    c=ctx_of(b, viewport={'width':1440,'height':900}, device_scale_factor=1, is_mobile=False, has_touch=False); pg=page(c)
    pg.goto(BASE, wait_until='commit'); pg.wait_for_selector('#splash .sp-mark'); pg.wait_for_timeout(700)
    r=pg.evaluate("()=>{const m=document.querySelector('#splash .sp-mark').getBoundingClientRect(), l=document.querySelector('#splash .sp-legal').getBoundingClientRect(); return {cx:m.left+m.width/2, cy:m.top+m.height/2, legal:innerHeight-l.bottom}}")
    ok(abs(r['cx']-720)<=2 and 300<r['cy']<450 and 0<=r['legal']<=60,'computadora: el logotipo al centro y la razón social al pie'); shot(pg,'05_escritorio'); gone(pg)
    ok(pg.locator('.login').is_visible(),'computadora: se retira sobre el acceso')
    c.close(); b.close()
finally:
  srv.terminate(); print('\n'.join(log)); print('errores:','; '.join(errs) or 'ninguno')
