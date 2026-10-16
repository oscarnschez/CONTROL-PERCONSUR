"""Ícono de la app CONTROL PERCONSUR de punta a punta (no requiere credenciales): favicon nuevo (solo el símbolo) en la
app, la página legal y el ícono de iPhone; el ícono y el nombre dentro de la app (acceso y Ajustes) sin reemplazar el
logotipo de PERCONSUR; modo oscuro y sin desbordar en iPhone."""
import subprocess, time, sys, os
from playwright.sync_api import sync_playwright
HERE=os.path.dirname(os.path.abspath(__file__)); APP=os.path.abspath(os.path.join(HERE,'..')); SH='shots'; os.makedirs(SH,exist_ok=True)
ROOT='http://127.0.0.1:8791/'
srv=subprocess.Popen([sys.executable,'-m','http.server','8791','--bind','127.0.0.1'],cwd=APP,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(1)
SESSION="""(()=>{const n=Date.now();sessionStorage.setItem('pcs-session',JSON.stringify({v:1,user:'prueba',name:'Prueba',role:'admin',at:n,exp:n+3600000}));})()"""
errs=[]; log=[]
def ok(c,m): log.append(('OK  ' if c else 'FAIL')+' '+m)
def ctx_of(b, **kw):
    o=dict(viewport={'width':390,'height':844},device_scale_factor=3,is_mobile=True,has_touch=True,service_workers='block'); o.update(kw)
    c=b.new_context(**o); c.route(lambda u:'cdnjs' in u or 'fonts.g' in u, lambda r:r.abort()); return c
def page(c):
    pg=c.new_page(); pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m: errs.append('console: '+m.text) if m.type=='error' else None); return pg
LOADED="i=>i.complete&&i.naturalWidth>0"
try:
  with sync_playwright() as p:
    b=p.chromium.launch()
    c=ctx_of(b); pg=page(c)
    pg.goto(ROOT+'index.html'); pg.wait_for_selector('.login .login-foot .app-id'); pg.wait_for_selector('#splash',state='detached'); pg.wait_for_timeout(300)
    fav=pg.evaluate("[...document.querySelectorAll('link[rel=icon]')].map(l=>l.href)"); apple=pg.evaluate("document.querySelector('link[rel=apple-touch-icon]').href")
    ico=pg.request.get(fav[0]).body(); ap=pg.request.get(apple).body()
    ok(len(fav)==1 and fav[0].endswith('/assets/icons/favicon.ico') and ico[:4]==b'\x00\x00\x01\x00' and ico[4]==7,'favicon nuevo (.ico con 7 tamaños)')
    ok(ap[1:4]==b'PNG' and int.from_bytes(ap[16:20],'big')==180,'ícono de iPhone nuevo (180 px)')
    fp=pg.evaluate("""async()=>{const r=await fetch('./assets/icons/favicon-32.png');const bm=await createImageBitmap(await r.blob());const cv=new OffscreenCanvas(32,32);const x=cv.getContext('2d');x.drawImage(bm,0,0);
      const d=x.getImageData(0,0,32,32).data;let o=0,w=0;for(let i=0;i<d.length;i+=4){if(d[i]>200&&d[i+1]<140&&d[i+2]<80)o++;if(d[i]>200&&d[i+1]>200&&d[i+2]>200)w++;}const c=[d[0],d[1],d[2]];return {o,w,c}}""")
    ok(fp['o']>150 and fp['w']==0 and fp['c'][2]>fp['c'][0],f"favicon: el símbolo naranja sobre el fondo azul, sin texto ilegible ({fp['o']} px naranjas)")
    lf=pg.locator('.login-foot .app-id')
    ok(lf.locator('img').evaluate(LOADED) and lf.inner_text().strip()=='CONTROL PERCONSUR' and lf.locator('img').get_attribute('alt')=='','acceso: ícono y nombre CONTROL PERCONSUR al pie')
    ok(pg.locator('.login-mark').evaluate(LOADED) and pg.locator('.login-mark').get_attribute('src')=='./assets/brand/perconsur-mark.png' and pg.locator('.login-word').inner_text()=='PERCONSUR','acceso: el logotipo de PERCONSUR sigue arriba, sin cambios')
    bb=lf.bounding_box(); ok(bb['width']<390 and pg.evaluate("document.documentElement.scrollWidth<=innerWidth"),'acceso: sin desbordar en iPhone'); pg.screenshot(path=f'{SH}/icono_01_acceso.png',full_page=True)
    c.close()
    c=ctx_of(b); c.add_init_script(SESSION); pg=page(c)
    pg.goto(ROOT+'index.html#/ajustes'); pg.wait_for_selector('footer.about .app-id img'); pg.wait_for_selector('#splash',state='detached'); pg.wait_for_selector('.brand-intro',state='detached'); pg.wait_for_timeout(300)
    ab=pg.locator('footer.about')
    ok(ab.locator('.app-id img').evaluate(LOADED) and ab.locator('.app-nm').inner_text()=='CONTROL PERCONSUR','Ajustes: ícono y nombre de la app')
    imgs=ab.locator('img').evaluate_all("l=>l.map(i=>i.getAttribute('src'))")
    ok(imgs==['./assets/brand/control-perconsur.png','./assets/brand/perconsur-mark.png'] and ab.locator('.wordmark').inner_text()=='PERCONSUR' and 'Versión' in ab.inner_text(),'Ajustes: la app arriba y debajo el logotipo de PERCONSUR con la versión')
    w=ab.locator('.app-id img').bounding_box()['width']; ok(w==44,f'Ajustes: ícono de {w:.0f} px con esquinas redondeadas'); ab.scroll_into_view_if_needed(); pg.screenshot(path=f'{SH}/icono_02_ajustes.png')
    c.close()
    c=ctx_of(b,color_scheme='dark'); c.add_init_script(SESSION); pg=page(c); pg.goto(ROOT+'index.html#/ajustes'); pg.wait_for_selector('footer.about .app-nm')
    col=pg.locator('footer.about .app-nm').evaluate("e=>getComputedStyle(e).color"); ok(col=='rgb(232, 235, 242)','modo oscuro: nombre legible'); pg.locator('footer.about').scroll_into_view_if_needed(); pg.screenshot(path=f'{SH}/icono_03_oscuro.png')
    c.close()
    c=ctx_of(b); pg=page(c); pg.goto(ROOT+'legal.html'); pg.wait_for_selector('.lg-doc')
    ok(pg.evaluate("document.querySelector('link[rel=icon]').href").endswith('/assets/icons/favicon.ico'),'página legal con el favicon nuevo')
    c.close(); b.close()
finally:
    srv.terminate()
ok(not errs,'sin errores en consola: '+'; '.join(errs[:3]))
print('\n'.join(log)); fails=[l for l in log if l.startswith('FAIL')]
print(f'\n{len(log)-len(fails)}/{len(log)} OK'); sys.exit(1 if fails else 0)
