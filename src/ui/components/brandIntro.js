/*
 * Transición de marca al iniciar sesión (la abre auth/gate.js solo después de verificar las credenciales; nunca al
 * recargar ni al navegar dentro de la app). Marca: CONTROL PERCONSUR (símbolo de señal, ui/components/controlMark.js).
 * Va al compás del sonido de entrada (assets/sounds/intro.mp3, services/sounds.js): golpe a 0 s, punto más alto a 0.7 s,
 * nota sostenida hasta ~1.9 s y se apaga a ~2.7 s.
 *   0 s       el punto aparece con el golpe (como un equipo que se enciende)
 *   0.14 s    el arco interior y luego el exterior se emiten desde el punto y llegan juntos al punto más alto (0.7 s)
 *   0.7 s     dos ondas de señal salen del punto y se desvanecen; entra «CONTROL»
 *   0.95 s    «PERCONSUR» con letras espaciadas; 1.35 s «Bienvenido»
 *   1.2 s     durante la nota sostenida la señal recorre el símbolo (punto → arco → arco) una vez
 *   1.95 s    cuando el sonido empieza a apagarse, la marca se aleja un poco y se desvanece sobre el panel (~2.4 s)
 * Solo transform y opacity (sin saltos de diseño). Con «reducir movimiento» no hay desplazamientos: la marca se muestra
 * quieta y se desvanece (~1 s). CSS en styles/screens.css.
 */
import { play } from '../../services/sounds.js';
import { controlMark } from './controlMark.js';

const HOLD = 1950;        /* ms desde que aparece hasta que puede salir: cuando el sonido de entrada empieza a apagarse */
const HOLD_STILL = 700;   /* con «reducir movimiento» */
const SETTLE = 240;       /* la primera pantalla termina su animación de entrada antes de salir */
const OUT = 440;          /* salida: la marca se aleja y el fondo se desvanece */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const reducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

export function startBrandIntro() {
  const still = reducedMotion();
  const root = document.createElement('div');
  root.className = 'brand-intro' + (still ? ' bi-still' : '');
  root.setAttribute('role', 'status');
  root.setAttribute('aria-label', 'Bienvenido a CONTROL PERCONSUR');
  root.innerHTML = `<div class="bi-bg"></div>
    <div class="bi-in">
      <div class="bi-logo">${controlMark('bi-mark', { withWaves: true })}</div>
      <span class="bi-word">CONTROL</span>
      <span class="bi-sub">PERCONSUR</span>
      <p class="bi-msg">Bienvenido</p>
    </div>`;
  document.body.appendChild(root);
  performance.mark('pcs-intro-start');
  play('intro');
  const t0 = performance.now();
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    root.remove();
    performance.mark('pcs-intro-end');
    window.dispatchEvent(new Event('brandintro:end'));
  };
  return {
    /* Sale cuando pasó el tiempo mínimo y la app ya mostró su primera pantalla (appShown: promesa) */
    async end(appShown) {
      /* El tiempo mínimo se cuenta desde que apareció la marca (la carga de la app corre en paralelo) */
      await Promise.all([wait((still ? HOLD_STILL : HOLD) - (performance.now() - t0)), Promise.resolve(appShown).then(() => wait(SETTLE))]);
      if (done) return;
      root.classList.add('bi-out');
      await wait(still ? 260 : OUT);
      finish();
    },
    /* La app no pudo arrancar: se retira de inmediato */
    abort: finish,
  };
}
