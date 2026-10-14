/*
 * Apertura de la app: la pantalla de carga de index.html (#splash; estilos en styles/base.css). Sobria:
 *   Al abrir la PWA  sobre el fondo de la app aparecen el logotipo y el nombre con un desvanecido breve, una línea fina
 *                    avanza mientras carga y la razón social queda al pie. La entrada es solo CSS y empieza con el
 *                    primer pintado, mientras cargan los módulos (no agrega espera a la carga).
 *   Salida           cuando la app ya está lista (acceso o panel) y terminó la entrada, la línea se completa, el
 *                    contenido se retira con un leve alejamiento y después se desvanece el fondo, dejando ver la app.
 * Es distinta de la transición de marca al iniciar sesión (brandIntro.js) y no se repite: una vez por sesión. Al recargar
 * dentro de la misma sesión (html.sp-warm, lo marca index.html antes del primer pintado) la pantalla solo se desvanece.
 * Con «reducir movimiento» no hay desplazamientos: el logotipo se muestra quieto y la pantalla se retira.
 * Tocar la pantalla adelanta la salida en cuanto la app está lista. En total dura cerca de 1.4 s.
 */
const FLAG = 'pcs-opened';
const ENTRANCE = 900;    /* ms desde que se abrió la página: la entrada (CSS) ya terminó */
const OPEN = 560;        /* la línea se completa, se retira el contenido y se desvanece el fondo (styles/base.css) */
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
      sp.classList.add('sp-exit');
      await wait(OPEN);
    }
    sp.remove();
    window.dispatchEvent(new Event('splash:end'));
  })();
  return closing;
}
