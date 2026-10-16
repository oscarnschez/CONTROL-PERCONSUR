"""Sonidos de la app de punta a punta: entrada al abrir (con el toque de «Entrar», sincronizada con la transición de marca),
confirmación con los avisos verdes (no con advertencias), sin encimarse con la entrada, interruptor «Sonidos» en Ajustes
(se recuerda) y los archivos de sonido precargados. La nube (publicar y recibir) se prueba en sync.py.
PCS_TEST_USER/PCS_TEST_PASS"""
import subprocess, time, sys, os
from playwright.sync_api import sync_playwright
HERE=os.path.dirname(os.path.abspath(__file__)); APP=os.path.abspath(os.path.join(HERE,'..')); SH='shots'; os.makedirs(SH,exist_ok=True)
U=os.environ.get('PCS_TEST_USER'); P=os.environ.get('PCS_TEST_PASS')
if not (U and P): sys.exit('Define PCS_TEST_USER y PCS_TEST_PASS')
ROOT='http://127.0.0.1:8793/'
srv=subprocess.Popen([sys.executable,'-m','http.server','8793','--bind','127.0.0.1'],cwd=APP,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(1)
# Registra cada sonido con su momento (performance.now) y el estado del audio
SND="""window.__snd=[];addEventListener('pcs:sound',e=>window.__snd.push([e.detail.name,performance.now()]))"""
errs=[]; log=[]
def ok(c,m): log.append(('OK  ' if c else 'FAIL')+' '+m)
def page(c):
    pg=c.new_page(); pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m: errs.append('console: '+m.text) if m.type=='error' else None); return pg
def names(pg): return [x[0] for x in pg.evaluate('window.__snd')]
try:
  with sync_playwright() as p:
    b=p.chromium.launch()
    c=b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,is_mobile=True,has_touch=True,service_workers='block')
    c.route(lambda u:'cdnjs' in u or 'fonts.g' in u, lambda r:r.abort()); c.add_init_script(SND); pg=page(c)
    files=[]; pg.on('request',lambda r: files.append(r.url.split('/')[-1]) if '/assets/sounds/' in r.url else None)
    pg.goto(ROOT+'index.html'); pg.wait_for_selector('.login'); pg.wait_for_timeout(800)
    ok(sorted(files)==['confirmacion.mp3','intro.mp3','nube.mp3'],'los tres sonidos se descargan al abrir (listos para sonar sin esperar): '+', '.join(sorted(files)))
    ok(names(pg)==[],'al abrir sin tocar la pantalla no suena nada (los navegadores lo bloquean)')
    pg.fill('#lg-user',U); pg.fill('#lg-pass',P); pg.click('#lg-go'); pg.wait_for_selector('.brand-intro',timeout=10000)
    delays=pg.evaluate("['.cm-a2','.bi-word','.bi-sub','.bi-msg'].map(q=>getComputedStyle(document.querySelector('.brand-intro '+q)).animationDelay).join(',')")
    pg.wait_for_selector('.brand-intro',state='detached',timeout=10000); pg.wait_for_timeout(200)
    snd=pg.evaluate('window.__snd'); st=pg.evaluate("performance.getEntriesByName('pcs-intro-start')[0].startTime"); en=pg.evaluate("performance.getEntriesByName('pcs-intro-end')[0].startTime")
    ok(len(snd)>=1 and snd[0][0]=='intro' and abs(snd[0][1]-st)<150,'al entrar suena la entrada junto con la transición de marca (%.0f ms de diferencia)'%(abs(snd[0][1]-st) if snd else -1))
    ok(2200<=en-st<=3200,'la transición dura lo que el sonido de entrada: %.2f s (el sonido dura 3 s con su desvanecido)'%((en-st)/1000))
    ok(delays=='0.3s, 1.44s,0.62s,0.95s,1.35s','el arco exterior llega al punto más alto del sonido (0.7 s) junto con «CONTROL» (0.62 s); «PERCONSUR» (0.95 s), «Bienvenido» (1.35 s) y la señal que recorre el símbolo (1.2-1.9 s) durante la nota sostenida: '+delays)
    ok(names(pg).count('confirm')==0,'la confirmación no se encima con la entrada')
    pg.wait_for_timeout(2600)
    pg.evaluate("async()=>{const t=await import('./src/ui/components/toast.js'); t.toast('Datos guardados')}"); pg.wait_for_timeout(300)
    ok(names(pg)[-1:]==['confirm'],'aviso verde (acción confirmada): suena la confirmación')
    n=len(names(pg)); pg.evaluate("async()=>{const t=await import('./src/ui/components/toast.js'); t.toast('Revisa el dato',{type:'warn'}); t.toast('Sin cambios',{type:'info'})}"); pg.wait_for_timeout(300)
    ok(len(names(pg))==n,'advertencias y avisos informativos: sin sonido')
    # Ajustes → Sonidos
    pg.goto(ROOT+'index.html#/ajustes'); pg.wait_for_selector('[data-sound]'); sw=pg.locator('[data-sound]')
    ok(sw.is_checked() and 'Sonidos' in pg.locator('.snd-row').inner_text(),'Ajustes → Apariencia: «Sonidos» encendido por omisión')
    sw.uncheck(); pg.wait_for_timeout(100); n=len(names(pg))
    pg.evaluate("async()=>{const t=await import('./src/ui/components/toast.js'); t.toast('Guardado')}"); pg.wait_for_timeout(300)
    ok(len(names(pg))==n and pg.evaluate("localStorage.getItem('pcs-sound')")=='off','apagado: no suena nada y se recuerda en el dispositivo')
    pg.reload(); pg.wait_for_selector('[data-sound]'); ok(not pg.locator('[data-sound]').is_checked(),'al volver a abrir Ajustes sigue apagado')
    pg.locator('[data-sound]').check(); pg.wait_for_timeout(300)
    ok(pg.evaluate("localStorage.getItem('pcs-sound')") is None and names(pg)[-1:]==['confirm'],'al encenderlo suena una confirmación de muestra'); pg.screenshot(path=f'{SH}/snd_ajustes.png')
    c.close(); b.close()
finally:
    srv.terminate()
ok(not errs,'sin errores en consola: '+'; '.join(errs[:3]))
print('\n'.join(log)); fails=[l for l in log if l.startswith('FAIL')]
print(f'\n{len(log)-len(fails)}/{len(log)} OK'); sys.exit(1 if fails else 0)
