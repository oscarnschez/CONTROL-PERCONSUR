"""Red lenta (datos móviles): con el service worker instalado, la app abre al instante aunque el servidor tarde 8 s."""
import os, sys, threading, time, functools
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

APP=os.path.abspath(os.path.join(os.path.dirname(__file__),'..'))
SHIM=open(os.path.join(os.path.dirname(__file__),'shims.js')).read()
SLOW={'on':False}
class H(SimpleHTTPRequestHandler):
    def log_message(self,*a): pass
    def do_GET(self):
        if SLOW['on'] and not self.path.startswith('/service-worker.js'): time.sleep(8)
        return super().do_GET()
srv=ThreadingHTTPServer(('127.0.0.1',8797),functools.partial(H,directory=APP)); threading.Thread(target=srv.serve_forever,daemon=True).start()

def login(pg):
    U=os.environ.get('PCS_TEST_USER'); P=os.environ.get('PCS_TEST_PASS')
    if not (U and P): raise SystemExit('Define PCS_TEST_USER y PCS_TEST_PASS (credenciales de acceso de la app)')
    pg.wait_for_selector('.login'); pg.fill('#lg-user',U); pg.fill('#lg-pass',P); pg.click('#lg-go'); pg.wait_for_selector('.login', state='detached', timeout=10000)

ok=[]; bad=[]
def check(c,m): (ok if c else bad).append(m)
try:
  with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
    ctx.route(lambda u:'fonts.g' in u, lambda r:r.abort())
    ctx.route(lambda u:'cdnjs' in u, lambda r:r.fulfill(status=200,content_type='application/javascript',body=SHIM,headers={'access-control-allow-origin':'*'}))
    pg=ctx.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.goto('http://127.0.0.1:8797/index.html'); login(pg)
    pg.evaluate('navigator.serviceWorker.ready'); pg.wait_for_timeout(2500)
    check(pg.evaluate('!!navigator.serviceWorker.controller'),'service worker activo')
    SLOW['on']=True
    t=time.time(); pg.reload(wait_until='domcontentloaded',timeout=15000)
    pg.wait_for_selector('body[data-screen]',timeout=15000); dt=time.time()-t
    check(dt<3,f'abre con red lenta en {dt:.1f} s (menos de 3 s)')
    check(not errs,'sin errores: '+(';'.join(errs) or 'ninguno'))
    SLOW['on']=False
    b.close()
finally: srv.shutdown()
for m in ok: print('OK  ',m)
for m in bad: print('FAIL',m)
print(f'{len(ok)} OK, {len(bad)} FAIL'); sys.exit(1 if bad else 0)
