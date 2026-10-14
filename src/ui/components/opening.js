/*
 * Apertura de la app: la pantalla de carga de index.html (#splash; estilos en styles/base.css).
 *   Al abrir la PWA  dos puertas de contenedor cerradas, con la placa de PERCONSUR sobre la junta: aparece la placa, el
 *                    nombre cierra su espaciado, se coloca el sello naranja y la razón social. La entrada es solo CSS y
 *                    empieza con el primer pintado, mientras cargan los módulos (no agrega espera a la carga).
 *   Apertura         cuando la app ya está lista (acceso o panel) y terminó la entrada, el sello se abre por la mitad, la
 *                    placa se retira y las puertas giran sobre sus bisagras hacia el fondo (como al abrir el contenedor
 *                    desde dentro) dejando ver la app.
 * Es distinta de la transición de marca al iniciar sesión (brandIntro.js) y no se repite: una vez por sesión. Al recargar
 * dentro de la misma sesión (html.sp-warm, lo marca index.html antes del primer pintado) la pantalla solo se desvanece.
 * Con «reducir movimiento» no hay giros ni desplazamientos: la placa se muestra quieta y la pantalla se retira.
 * Tocar la pantalla adelanta la apertura en cuanto la app está lista. En total dura cerca de 2 s.
 */
const FLAG = 'pcs-opened';
const ENTRANCE = 1150;   /* ms desde que se abrió la página: la entrada (CSS) ya terminó */
const OPEN = 920;        /* sello, placa y giro de las puertas (styles/base.css) */
const FADE = 300;        /* desvanecido al recargar */
const STILL = 650;       /* con «reducir movimiento»: tiempo mínimo con la placa a la vista */
const wait = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const reducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

/* Un toque antes de que la app esté lista también cuenta: se escucha desde que carga el módulo */
const sp0 = document.getElementById('splash');
const tapped = new Promise((r) => { if (sp0) sp0.addEventListener('pointerdown', r, { once: true }); });
let closing = null;

/*
 * Retira la pantalla de carga (la llaman auth/gate.js al mostrar el acceso y main.js al mostrar el panel).
 * notBefore: performance.now() mínimo para empezar a retirarla. Devuelve una promesa que se cumple cuando ya no está.
 * Si la app no pudo arrancar (#splash.err) la pantalla se queda con su aviso.
 */
export function closeSplash({ notBefore = 0 } = {}) {
  if (closing) return closing;
  const sp = document.getElementById('splash');
  if (!sp || sp.classList.contains('err')) return Promise.resolve();
  const warm = document.documentElement.classList.contains('sp-warm');
  try { sessionStorage.setItem(FLAG, '1'); } catch (e) { /* sin almacenamiento: la próxima vez también se abre */ }
  closing = (async () => {
    if (warm) {
      await wait(notBefore - performance.now());
      sp.classList.add('out');
      await wait(FADE);
    } else if (reducedMotion()) {
      await wait(Math.max(notBefore, STILL) - performance.now());
      sp.classList.add('out');
      await wait(60);
    } else {
      await Promise.race([wait(ENTRANCE - performance.now()), tapped]);
      await wait(notBefore - performance.now());
      sp.classList.add('sp-open');
      await wait(OPEN);
    }
    sp.remove();
    window.dispatchEvent(new Event('splash:end'));
  })();
  return closing;
}
