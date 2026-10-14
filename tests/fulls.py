"""Control de llenos (Operación → Logística → Control de llenos): programar cargas dentro y fuera de puerto, DEC solo dentro de
puerto (subir, sustituir, eliminar, no requerido, se conserva al cambiar a fuera de puerto), pedimento, DODA, cita y adicionales,
estado documental, expediente PDF (vista previa, orden, PDF combinado, compartir), transporte opcional asignado después, pizarra
(semana, mes, día), reprogramar, filtros, persistencia, respaldo, modo consulta y que Logística y Control de vacíos sigan bien.
Requiere pdftotext y pdfinfo (poppler-utils). PCS_TEST_USER/PCS_TEST_PASS"""
import subprocess, time, sys, os, re, datetime, tempfile, shutil
from playwright.sync_api import sync_playwright
HERE=os.path.dirname(os.path.abspath(__file__)); APP=os.path.abspath(os.path.join(HERE,'..')); SH='shots'; os.makedirs(SH,exist_ok=True)
U=os.environ['PCS_TEST_USER']; P=os.environ['PCS_TEST_PASS']; BASE='http://127.0.0.1:8783/index.html'
FD=tempfile.mkdtemp()
def pdf(path, n, label):
    """PDF mínimo de n páginas con texto (sin dependencias)"""
    out=[b'%PDF-1.4\n']; offs=[]; nobj=3+n*2
    def add(s): offs.append(sum(len(x) for x in out)); out.append(s)
    add(b'1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n')
    add(('2 0 obj<</Type/Pages/Kids[%s]/Count %d>>endobj\n' % (' '.join('%d 0 R' % (3+i*2) for i in range(n)), n)).encode())
    for i in range(n):
        st=('BT /F1 28 Tf 72 700 Td (%s pagina %d) Tj ET' % (label, i+1)).encode()
        add(('%d 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents %d 0 R/Resources<</Font<</F1 %d 0 R>>>>>>endobj\n' % (3+i*2, 4+i*2, nobj)).encode())
        add(('%d 0 obj<</Length %d>>stream\n' % (4+i*2, len(st))).encode()+st+b'\nendstream endobj\n')
    add(('%d 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n' % nobj).encode())
    x=sum(len(s) for s in out)
    out.append(('xref\n0 %d\n0000000000 65535 f \n' % (nobj+1)).encode()+''.join('%010d 00000 n \n' % o for o in offs).encode()+('trailer<</Size %d/Root 1 0 R>>\nstartxref\n%d\n%%%%EOF' % (nobj+1, x)).encode())
    open(path,'wb').write(b''.join(out))
pdf(os.path.join(FD,'Pedimento.pdf'),3,'Pedimento'); pdf(os.path.join(FD,'DODA.pdf'),1,'DODA'); pdf(os.path.join(FD,'Cita.pdf'),2,'Cita recinto')
shutil.copy(os.path.join(HERE,'anexo.png'),os.path.join(FD,'DEC.png')); shutil.copy(os.path.join(HERE,'foto.jpg'),os.path.join(FD,'DEC nuevo.jpg')); shutil.copy(os.path.join(HERE,'anexo.pdf'),os.path.join(FD,'Carta porte.pdf'))
shutil.copy(os.path.join(HERE,'foto.jpg'),os.path.join(FD,'Foto sello.jpg')); open(os.path.join(FD,'notas.txt'),'w').write('hola'); open(os.path.join(FD,'DEC dañado.pdf'),'wb').write(b'esto no es un PDF')
srv=subprocess.Popen([sys.executable,'-m','http.server','8783','--bind','127.0.0.1'],cwd=APP,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(1)
errs=[]; log=[]
def ok(c,m): log.append(('OK  ' if c else 'FAIL')+' '+m)
def shot(pg,n): pg.screenshot(path=f'{SH}/fl_{n}.png')
def toast(pg): return pg.locator('.toast-host').inner_text() if pg.locator('.toast-host').count() else ''
def login(pg):
    pg.goto(BASE); pg.wait_for_selector('.login'); pg.fill('#lg-user',U); pg.fill('#lg-pass',P); pg.click('#lg-go'); pg.wait_for_selector('.login',state='detached'); pg.wait_for_timeout(900)
    if pg.locator('.asheet').count(): pg.get_by_role('button',name='Ahora no').click()
def docrow(pg,label): return pg.locator('.fc-doc',has_text=label).first
def doclabels(pg): return [re.sub(r'\s*adicional$','',x.inner_text().split('\n')[0],flags=re.I).strip() for x in pg.locator('.fc-doc .att-tx b').all()]
def docstate(pg,label): return docrow(pg,label).locator('.fc-dst').inner_text().split(' · ')[0]
def menu(pg,label,item):
    docrow(pg,label).locator('[data-dact]').click(); pg.wait_for_selector('.asheet'); pg.get_by_role('button',name=item).click(); pg.wait_for_timeout(600)
def form(pg): pg.wait_for_selector('.op-form'); pg.wait_for_timeout(350)
def submit(pg): pg.locator('.op-form button[type=submit]').click(); pg.wait_for_timeout(700)
today=datetime.date.today(); T=today.isoformat(); T1=(today+datetime.timedelta(days=1)).isoformat(); T3=(today+datetime.timedelta(days=3)).isoformat()
try:
  with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={'width':390,'height':844},device_scale_factor=2,is_mobile=True,has_touch=True,service_workers='block',accept_downloads=True)
    ctx.route(lambda u:'cdnjs' in u or 'fonts.g' in u, lambda r:r.abort())
    pg=ctx.new_page(); pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m: errs.append('console: '+m.text) if m.type=='error' else None)
    login(pg)
    # Entrada desde Logística
    pg.goto(BASE+'#/operacion/logistica'); pg.wait_for_selector('.fc-entry'); pg.wait_for_timeout(300)
    ok('Control de llenos' in pg.locator('.fc-entry').inner_text() and 'Cargas hoy: 0' in pg.locator('.fc-entry').inner_text(),'Logística: entrada «Control de llenos» con indicadores')
    pg.locator('.fc-entry').click(); pg.wait_for_selector('.fc-page'); pg.wait_for_timeout(300); shot(pg,'01_vacio')
    ok('llenos' in pg.url and pg.locator('.empty',has_text='Aún no hay cargas programadas').count()==1 and pg.locator('[data-view]').count()==3,'pantalla vacía con pizarra (mes, semana, día) y botón Programar carga')
    # 1. Crear carga dentro de puerto (sin transporte)
    pg.locator('.fc-page .lg-new').click(); form(pg)
    submit(pg); e1=[x for x in pg.locator('.op-form .ferr').all_inner_texts() if x]
    ok(e1==['Escribe el número de contenedor.'],'validación: contenedor vacío')
    pg.fill('.op-form [name=containerNumber]','mscu 123-4567'); pg.fill('.op-form [name=weightKg]','-5'); submit(pg)
    ok('negativo' in ' '.join(pg.locator('.op-form .ferr').all_inner_texts()),'validación: peso negativo')
    pg.fill('.op-form [name=weightKg]','28500'); pg.fill('.op-form [name=reference]','BL 778'); submit(pg)
    ok('Elige la terminal portuaria.' in ' '.join(pg.locator('.op-form .ferr').all_inner_texts()),'validación: dentro de puerto pide terminal')
    pg.locator('.op-form [data-pk="terminalId"]').click(); pg.wait_for_selector('.picker'); pg.locator('.picker .pk-row',has_text='Contecon').first.click(); pg.wait_for_timeout(300)
    pg.fill('.op-form [name=scheduledDate]',T); pg.fill('.op-form [name=scheduledTime]','09:30'); shot(pg,'02_form_puerto'); submit(pg)
    pg.wait_for_selector('.fc-detail'); pg.wait_for_timeout(400); id1=pg.url.split('/llenos/')[1]
    hero=pg.locator('.fc-hero').inner_text()
    ok('MSCU1234567' in hero and 'Programada' in hero and 'Dentro de puerto' in hero and 'Contecon' in hero and '28,500 kg' in hero,'1) carga dentro de puerto creada: contenedor en mayúsculas sin espacios, 28,500 kg, Contecon')
    ok('Sin asignar' in pg.locator('.grp',has_text='Transporte').inner_text(),'20) se programó sin unidad, operador ni remolque')
    # 2. DEC aparece
    ok(doclabels(pg)==['Pedimento','DODA','Cita de recinto portuario','DEC'] and docstate(pg,'DEC')=='Pendiente','2) dentro de puerto la documentación incluye DEC (requerido) junto con pedimento, DODA y cita')
    ok('Documentación incompleta (0 de 4)' in pg.locator('.fc-docst').inner_text() and 'Documentación pendiente' in hero,'estado documental inicial: incompleta (0 de 4)')
    shot(pg,'03_detalle'); pg.screenshot(path=f'{SH}/fl_03b_detalle.png',full_page=True)
    pg.goto(BASE+'#/operacion'); pg.wait_for_selector('.mod-card'); pg.wait_for_timeout(400)
    ok('Llenos hoy: 1' in pg.locator('.mod-card',has_text='Logística').first.inner_text(),'Operación: el resumen de Logística cuenta la carga de hoy («Llenos hoy: 1»)')
    pg.goto(BASE+'#/operacion/logistica/llenos/'+id1); pg.wait_for_selector('.fc-detail'); pg.wait_for_timeout(400)
    # 3. Subir DEC individualmente
    docrow(pg,'DEC').locator('input[data-up]').set_input_files(os.path.join(FD,'DEC.png')); pg.wait_for_timeout(1800)
    ok(docstate(pg,'DEC')=='Adjuntado' and 'DEC.png' in docrow(pg,'DEC').inner_text() and 'Imagen' in docrow(pg,'DEC').inner_text() and 'DEC añadido' in pg.locator('.list').inner_text(),'3) DEC subido por separado: Adjuntado, nombre, tipo y fecha; evento «DEC añadido»')
    # 4. Sustituir DEC
    docrow(pg,'DEC').locator('[data-dact]').click(); pg.wait_for_selector('.asheet'); shot(pg,'04_menu_dec')
    pg.get_by_role('button',name='Reemplazar archivo').click(); pg.wait_for_timeout(300)
    pg.locator('[data-replace]').set_input_files(os.path.join(FD,'DEC nuevo.jpg')); pg.wait_for_timeout(1800)
    ok('DEC nuevo.jpg' in docrow(pg,'DEC').inner_text() and 'DEC.png' not in docrow(pg,'DEC').inner_text() and 'Documento reemplazado' in pg.locator('.list').inner_text(),'4) DEC sustituido: nuevo archivo y evento «Documento reemplazado»')
    n_att=pg.evaluate("async()=>{const db=await import('./src/services/db.js'); return (await db.byIndex('attachments','owner','fcl:'+location.hash.split('/llenos/')[1])).length}")
    ok(n_att==1,'el archivo anterior se borra del dispositivo al reemplazar (1 archivo guardado)')
    docrow(pg,'DEC').locator('[data-dact]').click(); pg.wait_for_selector('.asheet'); pg.get_by_role('button',name='Reemplazar archivo').click(); pg.wait_for_timeout(300)
    pg.locator('[data-replace]').set_input_files(os.path.join(FD,'DEC dañado.pdf')); pg.wait_for_timeout(1800)
    n_att2=pg.evaluate("async()=>{const db=await import('./src/services/db.js'); return (await db.byIndex('attachments','owner','fcl:'+location.hash.split('/llenos/')[1])).length}")
    ok(docstate(pg,'DEC')=='Adjuntado' and 'DEC nuevo.jpg' in docrow(pg,'DEC').inner_text() and 'se conserva el anterior' in toast(pg) and pg.locator('.list').inner_text().count('Documento reemplazado')==1 and n_att2==1,'reemplazo con un archivo que no se puede procesar: se avisa y el DEC conserva su archivo anterior')
    # 5. Eliminar DEC
    menu(pg,'DEC','Eliminar archivo'); pg.locator('.as-wrap button',has_text='Eliminar').last.click(); pg.wait_for_timeout(700)
    ok(docstate(pg,'DEC')=='Pendiente' and doclabels(pg).count('DEC')==1 and 'Documento eliminado' in pg.locator('.list').inner_text(),'5) DEC eliminado: el documento sigue en la lista como pendiente (requerido)')
    # 11-14. Pedimento, DODA, cita y adicionales
    docrow(pg,'Pedimento').locator('input[data-up]').set_input_files(os.path.join(FD,'Pedimento.pdf')); pg.wait_for_timeout(1500)
    docrow(pg,'DODA').locator('input[data-up]').set_input_files(os.path.join(FD,'DODA.pdf')); pg.wait_for_timeout(1500)
    docrow(pg,'Cita').locator('input[data-up]').set_input_files(os.path.join(FD,'Cita.pdf')); pg.wait_for_timeout(1500)
    ok(docstate(pg,'Pedimento')=='Adjuntado' and '3 páginas' in docrow(pg,'Pedimento').inner_text() and docstate(pg,'DODA')=='Adjuntado' and docstate(pg,'Cita')=='Adjuntado' and '2 páginas' in docrow(pg,'Cita').inner_text(),'11-13) pedimento (3 páginas), DODA y cita (2 páginas) adjuntados por separado')
    pg.locator('[data-add-files]').set_input_files([os.path.join(FD,'Carta porte.pdf'),os.path.join(FD,'Foto sello.jpg'),os.path.join(FD,'notas.txt')]); pg.wait_for_timeout(2500)
    labs=doclabels(pg)
    ok(labs==['Pedimento','DODA','Cita de recinto portuario','DEC','Carta porte.pdf','Foto sello.jpg'] and 'notas.txt' in toast(pg) and 'PDF, JPG y PNG' in toast(pg),'14) documentos adicionales (PDF e imagen) clasificados aparte; el .txt se rechaza con aviso')
    ok('Documentación incompleta (3 de 4)' in pg.locator('.fc-docst').inner_text(),'7) estado documental: incompleta mientras falte el DEC requerido')
    # 6. DEC no requerido → 7. completa
    menu(pg,'DEC','Marcar como no requerido')
    ok(docstate(pg,'DEC')=='No requerido' and 'Documentación completa (3 de 3)' in pg.locator('.fc-docst').inner_text() and 'Documentación completa' in pg.locator('.fc-hero').inner_text(),'6-7) DEC marcado como no requerido: la documentación queda completa (3 de 3); los adicionales no la detienen')
    ok('Documento no requerido' in pg.locator('.list').inner_text(),'evento «Documento no requerido» en el historial')
    menu(pg,'DEC','Marcar como requerido')
    ok(docstate(pg,'DEC')=='Pendiente' and 'incompleta' in pg.locator('.fc-docst').inner_text(),'volver a requerirlo la deja incompleta otra vez')
    docrow(pg,'DEC').locator('input[data-up]').set_input_files(os.path.join(FD,'DEC.png')); pg.wait_for_timeout(1800)
    ok(docstate(pg,'DEC')=='Adjuntado' and 'Documentación completa (4 de 4)' in pg.locator('.fc-docst').inner_text(),'con los cuatro requeridos adjuntados: completa (4 de 4)'); pg.screenshot(path=f'{SH}/fl_05_docs.png',full_page=True)
    # 16-17. Vista previa y orden del expediente
    pg.locator('[data-a="preview"]').click(); pg.wait_for_selector('.fc-xp'); pg.wait_for_timeout(500); shot(pg,'06_preview')
    pg.evaluate("()=>{document.querySelector('.fc-xp').dataset.keep='1'}")
    order=lambda: [x.inner_text() for x in pg.locator('.fc-xprow .att-tx b').all()]
    ok(order()==['Pedimento','DODA','Cita de recinto portuario','DEC','Carta porte.pdf','Foto sello.jpg'] and '10 páginas' in pg.locator('.bsheet .sheet-lead').inner_text() and pg.locator('.td-sec').count()==6,'17) vista previa: documentos en orden (pedimento, DODA, cita, DEC, adicionales), 10 páginas y 6 secciones')
    pg.locator('.fc-xprow',has_text='Foto sello.jpg').locator('[data-mv="-1"]').click(); pg.wait_for_selector('.fc-xp'); pg.wait_for_timeout(500)
    ok(order()[4:]==['Foto sello.jpg','Carta porte.pdf'],'16) reorganizar: la foto sube antes de la carta porte')
    ok(pg.evaluate("()=>{const a=document.activeElement, li=a&&a.closest('[data-xp]'); return !!(li&&a.matches('[data-mv]')&&li.innerText.includes('Foto sello'))}"),'al reordenar, el foco sigue en las flechas del documento que se movió')
    pg.locator('.fc-xprow',has_text='Carta porte.pdf').locator('[data-inc]').click(); pg.wait_for_selector('.fc-xp'); pg.wait_for_timeout(500)
    ok(pg.locator('.fc-xprow.off').count()==1 and '8 páginas' in pg.locator('.bsheet .sheet-lead').inner_text() and pg.locator('.td-sec').count()==5,'16) excluir un documento: no cuenta en páginas ni en el contenido final')
    ok(pg.locator('.fc-xp[data-keep="1"]').count()==1 and pg.locator('.bsheet').count()==1,'la vista previa se actualiza en su lugar: no se cierra ni se vuelve a abrir al reordenar o excluir')
    pg.locator('.bsheet [data-x="back"]').click(); pg.wait_for_timeout(400)
    # 15, 18. Generar PDF combinado
    pg.locator('[data-a="build"]').click(); pg.wait_for_selector('.ok-box',timeout=25000); pg.wait_for_timeout(300); shot(pg,'07_generado')
    idx=[x.inner_text() for x in pg.locator('.td-index li span').all()]
    ok(idx==['Pedimento','DODA','Cita de recinto portuario','DEC','Foto sello.jpg'],'18) índice del PDF generado en el orden elegido, sin el excluido')
    ok(pg.locator('.bsheet [data-x="share"]').count()==1 and pg.locator('.bsheet [data-x="save"]').count()==1 and pg.locator('.bsheet [data-x="wa"]').count()==1 and pg.locator('.bsheet [data-x="view"]').count()==1,'19) acciones: ver, compartir, guardar en Archivos y WhatsApp')
    with pg.expect_download() as d: pg.locator('.bsheet [data-x="save"]').click()
    path=d.value.path(); info=subprocess.run(['pdfinfo',path],capture_output=True,text=True).stdout; pages=int(re.search(r'Pages:\s+(\d+)',info).group(1)); txt=subprocess.run(['pdftotext','-layout',path,'-'],capture_output=True,text=True).stdout
    ok(d.value.suggested_filename==f'PERCONSUR-Lleno-MSCU1234567-{T}.pdf' and pages==8,'15) PDF combinado: 3 (pedimento) + 1 (DODA) + 2 (cita) + 1 (DEC imagen) + 1 (foto) = 8 páginas, nombre PERCONSUR-Lleno-MSCU1234567-fecha.pdf')
    ok('Pedimento pagina 3' in txt and 'DODA pagina 1' in txt and 'Cita recinto pagina 2' in txt and 'Carta' not in txt,'las páginas de los PDF se copian con su texto; el documento excluido no aparece')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(400)
    orig=pg.evaluate("async()=>{const f=await import('./src/services/fulls.js'); const d=f.docsOf(location.hash.split('/llenos/')[1]); return d.filter(x=>x.storageKey).length}")
    ok(orig==6,'los documentos originales siguen intactos tras generar el expediente (6 archivos)')
    # 21. Asignar transporte después
    pg.locator('[data-a="assign"]').first.click(); form(pg)
    pg.locator('.op-form [data-pk="vehicleId"]').click(); pg.wait_for_selector('.picker'); pg.locator('.picker .pk-row').nth(1).click(); pg.wait_for_timeout(300)
    pg.locator('.op-form [data-pk="operatorId"]').click(); pg.wait_for_selector('.picker'); pg.locator('.picker .pk-row').nth(1).click(); pg.wait_for_timeout(300)
    pg.locator('.op-form [data-pk="trailerId"]').click(); pg.wait_for_selector('.picker'); pg.wait_for_timeout(300)
    heads=[x.inner_text() for x in pg.locator('.picker .pk-h').all()]
    ok(heads[0]=='Chasis portacontenedor' or heads[0]=='Sin clasificar' or heads[0]=='Catálogo','selector de remolques: los chasis portacontenedor primero'); shot(pg,'08_remolques')
    pg.locator('.picker .pk-row').nth(1).click(); pg.wait_for_timeout(300); submit(pg)
    tr=pg.locator('.grp',has_text='Transporte').inner_text()
    ok('Sin asignar' not in tr and 'U' in tr and 'Unidad asignada' in pg.locator('.list').inner_text() and 'Operador asignado' in pg.locator('.list').inner_text() and 'Remolque asignado' in pg.locator('.list').inner_text(),'21) transporte asignado después: unidad, operador y remolque con sus eventos')
    # Estado operativo manual
    pg.locator('[data-a="status"]').click(); pg.wait_for_selector('.lg-stlist'); shot(pg,'09_estado'); pg.locator('[data-set="ready"]').click(); pg.wait_for_timeout(600)
    ok('Lista para cargar' in pg.locator('.fc-hero').inner_text() and 'Estado modificado' in pg.locator('.list').inner_text(),'estado operativo «Lista para cargar» (separado del documental)')
    # 8-9. Carga fuera de puerto, sin DEC; patio nuevo al catálogo
    pg.goto(BASE+'#/operacion/logistica/llenos'); pg.wait_for_selector('.fc-page'); pg.wait_for_timeout(400)
    pg.locator('.fc-page .lg-new').click(); form(pg)
    pg.fill('.op-form [name=containerNumber]','TGHU7654321'); pg.fill('.op-form [name=weightKg]','24,000'); pg.locator('.op-form [data-loc="offport"]').click(); pg.wait_for_timeout(200)
    ok(pg.locator('.op-form [data-off]').is_visible() and not pg.locator('.op-form [data-port]').is_visible() and 'DEC' not in pg.locator('.op-form [data-dochint]').inner_text(),'fuera de puerto: pide patio / instalación y la documentación anunciada no incluye DEC')
    pg.locator('.op-form [data-pk="yardId"]').click(); pg.wait_for_selector('.picker'); pg.fill('.picker .search-in','Bodega Tepic'); pg.wait_for_timeout(300); pg.locator('.picker [data-new="1"]').click(); pg.wait_for_timeout(500)
    ok('BODEGA TEPIC' in pg.locator('.op-form [data-pk="yardId"]').inner_text() and 'agregado al catálogo' in toast(pg),'patio nuevo escrito en el selector: se agrega al catálogo de patios e instalaciones de carga')
    pg.fill('.op-form [name=scheduledDate]',T1); pg.fill('.op-form [name=scheduledTime]','11:00'); submit(pg); pg.wait_for_selector('.fc-detail'); pg.wait_for_timeout(400); id2=pg.url.split('/llenos/')[1]
    ok(doclabels(pg)==['Pedimento','DODA','Cita de recinto portuario'] and docstate(pg,'Cita')=='No requerido' and 'Fuera de puerto' in pg.locator('.fc-hero').inner_text() and 'BODEGA TEPIC' in pg.locator('.fc-hero').inner_text(),'8-9) carga fuera de puerto: sin DEC; cita «cuando aplique» (no requerida)'); shot(pg,'10_fuera')
    pg.locator('[data-a="edit"]').first.click(); form(pg); pg.locator('.op-form [data-loc="port"]').click(); pg.wait_for_timeout(200)
    pg.locator('.op-form [data-pk="terminalId"]').click(); pg.wait_for_selector('.picker'); pg.locator('.picker .pk-row',has_text='Contecon').first.click(); pg.wait_for_timeout(300); submit(pg); pg.wait_for_timeout(500)
    docrow(pg,'DEC').locator('input[data-up]').set_input_files(os.path.join(FD,'DEC.png')); pg.wait_for_timeout(1800)
    pg.locator('[data-a="edit"]').first.click(); form(pg); pg.locator('.op-form [data-loc="offport"]').click(); pg.wait_for_timeout(200)
    pg.locator('.op-form [data-pk="yardId"]').click(); pg.wait_for_selector('.picker'); pg.locator('.picker .pk-row',has_text='BODEGA TEPIC').first.click(); pg.wait_for_timeout(300); submit(pg); pg.wait_for_timeout(500)
    ok(docstate(pg,'DEC')=='Adjuntado' and 'opcional' in docrow(pg,'DEC').locator('.fc-dst').inner_text(),'una carga que vuelve a fuera de puerto conserva su DEC adjuntado como opcional')
    menu(pg,'DEC','Eliminar archivo'); pg.locator('.as-wrap button',has_text='Eliminar').last.click(); pg.wait_for_timeout(700)
    ok(doclabels(pg)==['Pedimento','DODA','Cita de recinto portuario'] and docstate(pg,'Cita')=='No requerido' and pg.locator('[data-up]').count()==3,'al quitar el archivo de ese DEC fuera de puerto, el DEC desaparece (no queda «Subir DEC»)')
    # 10. Cambiar la primera de dentro a fuera sin perder el DEC
    pg.goto(BASE+'#/operacion/logistica/llenos/'+id1); pg.wait_for_selector('.fc-detail'); pg.wait_for_timeout(400)
    pg.locator('[data-a="edit"]').first.click(); form(pg); pg.locator('.op-form [data-loc="offport"]').click(); pg.wait_for_timeout(200)
    ok('El DEC ya adjuntado se conserva' in pg.locator('.op-form [data-dochint]').inner_text(),'al cambiar a fuera de puerto el formulario avisa que el DEC adjuntado se conserva')
    pg.locator('.op-form [data-pk="yardId"]').click(); pg.wait_for_selector('.picker'); pg.locator('.picker .pk-row',has_text='BODEGA TEPIC').first.click(); pg.wait_for_timeout(300); submit(pg); pg.wait_for_timeout(500)
    ok('DEC' in doclabels(pg) and docstate(pg,'DEC')=='Adjuntado' and 'opcional' in docrow(pg,'DEC').inner_text() and 'DEC.png' in docrow(pg,'DEC').inner_text() and 'Ubicación cambiada' in pg.locator('.list').inner_text(),'10) de dentro a fuera de puerto: el DEC con archivo se conserva, adjuntado y ya no requerido')
    ok('Documentación completa' in pg.locator('.fc-docst').inner_text(),'fuera de puerto la documentación sigue completa (el DEC ya no se exige)')
    pg.locator('[data-a="edit"]').first.click(); form(pg); pg.locator('.op-form [data-loc="port"]').click(); pg.wait_for_timeout(200); submit(pg)
    ok('Elige la terminal portuaria.' in ' '.join(pg.locator('.op-form .ferr').all_inner_texts()),'de regreso a dentro de puerto vuelve a pedir la terminal')
    pg.locator('.op-form [data-pk="terminalId"]').click(); pg.wait_for_selector('.picker'); pg.locator('.picker .pk-row',has_text='Contecon').first.click(); pg.wait_for_timeout(300); submit(pg); pg.wait_for_timeout(500)
    ok(docstate(pg,'DEC')=='Adjuntado' and 'opcional' not in docrow(pg,'DEC').locator('.fc-dst').inner_text() and docstate(pg,'Cita')=='Adjuntado','de regreso a dentro de puerto el DEC vuelve a ser requerido (y ya está adjuntado)')
    # 23. Reprogramar
    pg.locator('[data-a="reschedule"]').click(); form(pg); pg.fill('.op-form [name=date]',T3); pg.fill('.op-form [name=time]','15:45'); pg.fill('.op-form [name=reason]','La terminal movió la cita'); submit(pg); pg.wait_for_timeout(400)
    ok(' 15:45' in pg.locator('.fc-hero').inner_text() and 'Reprogramación' in pg.locator('.list').inner_text() and 'La terminal movió la cita' in pg.locator('.list').inner_text(),'23) reprogramada: nueva fecha y hora, evento con la fecha anterior y el motivo')
    # 22. Pizarra
    pg.goto(BASE+'#/operacion/logistica/llenos'); pg.wait_for_selector('.fc-page'); pg.wait_for_timeout(500)
    tiles=pg.locator('[data-tiles]').inner_text()
    ok(re.search(r'Hoy\s*0',tiles) and re.search(r'Mañana\s*1',tiles) and re.search(r'Doc\. pendiente\s*1',tiles) and re.search(r'Listas\s*1',tiles),'indicadores: hoy 0, mañana 1, 1 pendiente de documentación, 1 lista')
    pg.locator('[data-tile="tomorrow"]').click(); pg.wait_for_timeout(400)
    ok(pg.locator('[data-preset="upcoming"].on').count()==1 and [x.inner_text().split('\n')[0] for x in pg.locator('.fc-list .fc-card').all()]==['TGHU7654321'],'«Mañana» abre las cargas abiertas de mañana (el número y la lista coinciden)')
    pg.locator('[data-f="range"]').click(); pg.wait_for_selector('.asheet'); pg.get_by_role('button',name='Todas las fechas').click(); pg.wait_for_timeout(300)
    pg.locator('[data-view="week"]').click(); pg.wait_for_timeout(300)
    wk0=pg.locator('.fc-week').inner_text(); shot(pg,'11_semana'); pg.locator('[data-cal="next"]').click(); pg.wait_for_timeout(300); wk1=pg.locator('.fc-week').inner_text(); pg.locator('[data-cal="today"]').click(); pg.wait_for_timeout(300)
    we=today+datetime.timedelta(days=6-today.weekday()); d1=today+datetime.timedelta(days=1); d3=today+datetime.timedelta(days=3)
    wof=lambda d: wk0 if d<=we else wk1
    ok('TGHU7654321' in wof(d1) and 'TGHU7654321' not in (wk1 if d1<=we else wk0) and 'MSCU1234567' in wof(d3),'22) pizarra semanal: cada carga aparece en la semana de su fecha (mañana y la reprogramada)')
    pg.locator('[data-view="month"]').click(); pg.wait_for_timeout(300)
    dots=pg.locator('.fc-day .fc-dots i').count(); sel=pg.locator('.fc-day.sel').count()
    ok(dots>=2 and sel==1,'pizarra mensual: puntos en los días con carga y día seleccionado'); shot(pg,'12_mes')
    pg.locator(f'.fc-day[data-day="{T3}"]').click(); pg.wait_for_timeout(300)
    ok('MSCU1234567' in pg.locator('.fc-daylist').inner_text() and '15:45' in pg.locator('.fc-daylist').inner_text(),'tocar un día muestra sus cargas (la reprogramada en su nueva fecha)')
    pg.locator('[data-view="day"]').click(); pg.wait_for_timeout(300)
    ok(pg.locator('.fc-dayview').count()==1,'vista de día')
    # 24. Filtrar por terminal o patio
    pg.locator('[data-f="terminal"]').click(); pg.wait_for_selector('.picker'); pg.locator('.picker .pk-row',has_text='Contecon').click(); pg.wait_for_timeout(400)
    pg.locator('[data-preset="all"]').click(); pg.wait_for_timeout(300)
    cards=lambda: [x.inner_text().split('\n')[0] for x in pg.locator('.fc-list .fc-card').all()]
    ok(cards()==['MSCU1234567'],'24) filtro por terminal (Contecon): solo la carga dentro de puerto')
    pg.locator('[data-f="terminal"]').click(); pg.wait_for_timeout(300); pg.locator('[data-f="yard"]').click(); pg.wait_for_selector('.picker'); pg.locator('.picker .pk-row',has_text='BODEGA TEPIC').click(); pg.wait_for_timeout(400)
    ok(cards()==['TGHU7654321'],'24) filtro por patio (BODEGA TEPIC): solo la carga fuera de puerto')
    pg.locator('[data-f="yard"]').click(); pg.wait_for_timeout(300); pg.fill('.search-in','tghu'); pg.wait_for_timeout(300)
    ok(cards()==['TGHU7654321'],'búsqueda por número de contenedor'); pg.fill('.search-in',''); pg.wait_for_timeout(300)
    pg.locator('[data-f="location"]').click(); pg.wait_for_timeout(300)
    ok(cards()==['MSCU1234567'],'filtro dentro / fuera de puerto'); pg.locator('[data-f="location"]').click(); pg.locator('[data-f="location"]').click(); pg.wait_for_timeout(300)
    # duplicado con confirmación
    pg.locator('.fc-page .lg-new').click(); form(pg); pg.fill('.op-form [name=containerNumber]','TGHU7654321'); pg.fill('.op-form [name=weightKg]','1000')
    pg.locator('.op-form [data-pk="terminalId"]').click(); pg.wait_for_selector('.picker'); pg.locator('.picker .pk-row').first.click(); pg.wait_for_timeout(300); pg.fill('.op-form [name=scheduledDate]',T); pg.fill('.op-form [name=scheduledTime]','08:00')
    ok('Ya tiene una carga abierta' in pg.locator('.op-form [data-chk]').inner_text(),'aviso en vivo de posible duplicado')
    submit(pg); pg.wait_for_selector('.asheet'); shot(pg,'13_duplicado'); pg.get_by_role('button',name='Ver la carga existente').click(); pg.wait_for_timeout(600)
    ok(pg.url.endswith('/llenos/'+id2),'duplicado: confirmación con la opción de ver la carga existente')
    # Catálogo nuevo en Administración
    pg.goto(BASE+'#/catalogos'); pg.wait_for_timeout(500)
    ok(pg.locator('a.row-btn',has_text='Patios e instalaciones de carga').count()==1 and '1' in pg.locator('a.row-btn',has_text='Patios e instalaciones de carga').inner_text(),'Administración → Catálogos: «Patios e instalaciones de carga» con el patio agregado')
    vq=pg.evaluate("async()=>{const f=await import('./src/services/fulls.js'); const vw=f.viewer(); const all=f.all(); return all.length==2 && all.every(r=>JSON.stringify(vw(r))===JSON.stringify(f.view(r))) && vw(all[0])===vw(all[0])}")
    ok(vq,'la pizarra resuelve cada carga una vez con los catálogos indexados y obtiene lo mismo que la ficha')
    # Respaldo
    bk=pg.evaluate("""async()=>{const B=await import('./src/services/backup.js'); const f=await B.exportBackup({includeMedia:true}); const info=await B.inspectBackup(f); const d=JSON.parse(await f.text()).data;
      return {lines:info.lines.filter(l=>/llenos/.test(l)), loads:d.fullContainerLoads.length, docs:d.fullContainerDocuments.length, evs:d.fullContainerEvents.length, yards:d.loadingYards.length, files:d.attachments.filter(a=>/^fcl:/.test(a.owner)).length}}""")
    ok(bk['loads']==2 and bk['docs']==9 and bk['evs']>=15 and bk['yards']==1 and bk['files']==6 and bk['lines']==['Control de llenos: 2 cargas, 9 documentos, 1 patio de carga'],'respaldo completo: cargas, documentos, historial, patios de carga y los archivos: '+bk['lines'][0])
    # 25. Persistencia al recargar (como al cerrar y abrir la PWA)
    pg.goto(BASE); pg.reload(); pg.wait_for_timeout(1500); pg.goto(BASE+'#/operacion/logistica/llenos/'+id1); pg.wait_for_selector('.fc-detail'); pg.wait_for_timeout(500)
    ok('MSCU1234567' in pg.locator('.fc-hero').inner_text() and docstate(pg,'DEC')=='Adjuntado' and docstate(pg,'Pedimento')=='Adjuntado' and ' 15:45' in pg.locator('.fc-hero').inner_text() and 'Sin asignar' not in pg.locator('.grp',has_text='Transporte').inner_text(),'25) tras recargar se conservan documentos, archivos, transporte y la reprogramación')
    # Modo consulta: sin controles de captura
    pg.evaluate("async()=>{const a=await import('./src/services/access.js'); a.setReadOnly(true);}"); pg.goto(BASE+'#/operacion/logistica/llenos'); pg.wait_for_timeout(400); pg.goto(BASE+'#/operacion/logistica/llenos/'+id1); pg.wait_for_selector('.fc-detail'); pg.wait_for_timeout(500)
    ok(pg.locator('.fc-up:visible').count()==0 and pg.locator('.fc-add:visible').count()==0 and pg.locator('.ec-acts:visible').count()==0 and pg.locator('[data-a="preview"]:visible').count()==1,'modo consulta: sin subir, editar ni asignar; el expediente sí se puede ver'); shot(pg,'14_consulta')
    docrow(pg,'Pedimento').locator('[data-dact]').click(); pg.wait_for_selector('.asheet'); pg.wait_for_timeout(200)
    acts=[x.inner_text().strip() for x in pg.locator('.as-wrap button').all()]
    ok('Ver' in acts and 'Descargar / compartir' in acts and not any(a in acts for a in ['Reemplazar archivo','Eliminar archivo','Marcar como no requerido','Marcar como requerido']),'modo consulta: el menú de un documento solo ofrece Ver y Descargar '+str(acts))
    pg.get_by_role('button',name='Cancelar').click(); pg.wait_for_timeout(300)
    pg.evaluate("async()=>{const a=await import('./src/services/access.js'); a.setReadOnly(false);}")
    # Una carga cerrada cuya terminal se borró del catálogo se puede seguir corrigiendo
    r4=pg.evaluate("""async()=>{const f=await import('./src/services/fulls.js'); const c=await import('./src/services/catalogs.js');
      const t=await c.save('terminals',{name:'TERMINAL TEMPORAL'}); const out={};
      const {load}=await f.create({containerNumber:'CMAU3334445',weightKg:'15000',locationType:'port',terminalId:t.id,scheduledDate:'2026-09-01',scheduledTime:'08:00'});
      await f.setStatus(load.id,'loaded'); await c.remove('terminals',t.id);
      const u=await f.update(load.id,{weightKg:'15500'}); out.edit=u.errors?JSON.stringify(u.errors):f.byId(load.id).weightKg;
      try{await f.assign(load.id,{vehicleId:null,operatorId:null,trailerId:null}); out.assign='ok'}catch(e){out.assign=e.message}
      const v=await f.update(load.id,{terminalId:'t_inexistente'}); out.bad=v.errors?v.errors.transport:'aceptó';
      await f.setStatus(load.id,'cancelled');
      const m=await import('./src/services/media.js'); const db=await import('./src/services/db.js');
      await m.saveBlob(new Blob(['x'],{type:'application/pdf'}),{owner:'fcl:'+load.id,kind:'fcl-doc',name:'huerfano.pdf'});
      await f.remove(load.id); out.left=(await db.byIndex('attachments','owner','fcl:'+load.id)).length; out.docs=f.docsOf(load.id).length; out.gone=!f.byId(load.id); return out}""")
    ok(r4['edit']==15500 and r4['assign']=='ok' and r4['bad']=='La terminal ya no está en el catálogo.','carga cerrada con su terminal borrada del catálogo: se puede corregir y asignar; una terminal nueva inexistente sí se rechaza '+str(r4))
    ok(r4['left']==0 and r4['docs']==0 and r4['gone'],'al eliminar una carga cancelada se borran sus documentos y todos sus archivos, también los que ningún documento referencia')
    # 26. Logística y Control de vacíos siguen funcionando
    pg.goto(BASE+'#/operacion/logistica'); pg.wait_for_selector('.lg-page'); pg.wait_for_timeout(500)
    ok(pg.locator('.lg-group,.empty').count()>=1 and 'Cargas hoy' in pg.locator('.fc-entry').inner_text() and pg.locator('.ec-entry').first.count()==1,'26) Logística abre con sus unidades y las dos entradas (vacíos y llenos)')
    pg.goto(BASE+'#/operacion/logistica/vacios'); pg.wait_for_selector('.ec-page'); pg.wait_for_timeout(400)
    ok(pg.locator('h1.title').inner_text()=='Control de vacíos' and pg.locator('[data-tiles] .tile').count()==4,'26) Control de vacíos sigue funcionando (independiente de Control de llenos)')
    pg.goto(BASE+'#/operacion'); pg.wait_for_timeout(500)
    ok(pg.locator('.mod-card',has_text='Logística').count()>=1 and 'Llenos hoy' not in pg.locator('.mod-card',has_text='Logística').first.inner_text(),'Operación: sin cargas para hoy (la de hoy se reprogramó) el resumen ya no muestra «Llenos hoy»')
    # Escritorio: pizarra mensual con fichas en las celdas
    pg.set_viewport_size({'width':1440,'height':900}); pg.goto(BASE+'#/operacion/logistica/llenos'); pg.wait_for_selector('.fc-page'); pg.wait_for_timeout(500)
    ok(pg.locator('[data-view="month"].on').count()==1 and pg.locator('.fc-ev').count()>=2,'computadora: la pizarra abre en vista de mes con las cargas dentro de cada día'); shot(pg,'15_escritorio')
    b.close()
finally:
  srv.terminate(); shutil.rmtree(FD,ignore_errors=True); print('\n'.join(log)); print('errores:','; '.join(errs) or 'ninguno')
