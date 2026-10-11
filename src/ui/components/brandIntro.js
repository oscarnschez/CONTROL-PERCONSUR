/*
 * Transición de marca al iniciar sesión (la abre auth/gate.js solo después de verificar las credenciales; nunca al
 * recargar ni al navegar dentro de la app).
 *   Entrada   el logotipo se revela en diagonal siguiendo su trazo naranja, aparece el nombre, se dibuja la banda
 *             corrugada y, al final, un «Bienvenido» discreto.
 *   Presencia la marca queda un instante; mientras tanto la app arranca por debajo.
 *   Salida    cuando el panel ya está en pantalla, el logotipo viaja a su lugar en el encabezado de Inicio (o al menú
 *             lateral en computadora) y el fondo se desvanece sobre el panel. Si no hay encabezado a la vista, solo se
 *             desvanece.
 * Dura cerca de 1.8 s; con «reducir movimiento» no hay desplazamientos: la marca se muestra quieta y se desvanece (~1 s).
 * Sin dependencias: CSS (styles/screens.css) y la imagen del logotipo, ya cargada por la pantalla de acceso.
 */
const MARK = './assets/brand/perconsur-mark.png';
const HOLD = 1250;        /* ms desde que aparece hasta que puede salir (entrada completa + presencia) */
const HOLD_STILL = 700;   /* con «reducir movimiento» */
const SETTLE = 240;       /* la primera pantalla termina su animación de entrada antes de medir el encabezado */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const reducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

/* Logotipo del encabezado al que viaja la marca: el de Inicio o el del menú lateral, el que esté a la vista */
function headerMark() {
  for (const q of ['.home-top .brand-mark', '.tb-brand img']) {
    const el = document.querySelector(q);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 8 && r.height > 8 && r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth && getComputedStyle(el).visibility !== 'hidden') return { el, r };
  }
  return null;
}

export function startBrandIntro() {
  const still = reducedMotion();
  const root = document.createElement('div');
  root.className = 'brand-intro' + (still ? ' bi-still' : '');
  root.setAttribute('role', 'status');
  root.setAttribute('aria-label', 'Bienvenido a PERCONSUR');
  root.innerHTML = `<div class="bi-bg"></div>
    <div class="bi-in">
      <div class="bi-logo"><img src="${MARK}" alt="" class="bi-mark" decoding="sync"></div>
      <span class="wordmark bi-word">PERCONSUR</span>
      <div class="band bi-band" aria-hidden="true"></div>
      <p class="bi-msg">Bienvenido</p>
    </div>`;
  document.body.appendChild(root);
  performance.mark('pcs-intro-start');
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
      const logo = root.querySelector('.bi-logo');
      const target = still ? null : headerMark();
      root.classList.add('bi-out');
      if (target) {
        /* Del centro de la pantalla al encabezado: misma imagen, se oculta la del encabezado hasta que llega */
        const a = logo.getBoundingClientRect(), b = target.r;
        target.el.classList.add('bi-hidden');
        logo.classList.add('glide');
        logo.style.transform = `translate(${b.left - a.left}px, ${b.top - a.top}px) scale(${b.width / a.width})`;
        await Promise.race([new Promise((r) => logo.addEventListener('transitionend', r, { once: true })), wait(640)]);
        target.el.classList.remove('bi-hidden');
      } else {
        logo.classList.add('fade');
        await wait(still ? 260 : 440);
      }
      finish();
    },
    /* La app no pudo arrancar: se retira de inmediato */
    abort: finish,
  };
}
