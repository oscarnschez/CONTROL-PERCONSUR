/*
 * Acceso a la app (punto de entrada de index.html).
 * La interfaz y los datos NO se cargan hasta que el usuario inicia sesión: la app (main.js)
 * se importa dinámicamente solo después de verificar las credenciales.
 *
 * Verificación local (sin servidor), con WebCrypto:
 *   - El usuario se compara por su huella SHA-256; la contraseña con PBKDF2-SHA256 (600 000 iteraciones).
 *     El código no contiene el usuario ni la contraseña en texto (ver src/config/auth.js).
 *   - Comparación en tiempo constante y el mismo trabajo aunque el usuario no exista.
 *   - Bloqueo progresivo tras 5 intentos fallidos (30 s, 1 min, 2 min… hasta 15 min), aunque se recargue.
 *   - La contraseña nunca se guarda: el campo se vacía al verificar y no se registra en consola.
 * Sesión: dura mientras la app sigue abierta (sessionStorage) y como máximo 12 horas.
 * Al abrir la app, la pantalla de carga se abre como puertas de contenedor sobre el acceso (ui/components/opening.js).
 * Tras verificar el acceso se muestra la transición de marca (ui/components/brandIntro.js) mientras la app arranca.
 *
 * Límite honesto: sin servidor, quien tenga acceso técnico al dispositivo podría evitar esta pantalla.
 * Para proteger los datos ante eso se requiere cifrado local o inicio de sesión en servidor.
 */
import { AUTH } from '../config/auth.js';
import { icon } from '../ui/components/icons.js';
import { APP_VERSION, APP_BUILD } from '../config/reference.js';
import { copyrightText } from '../config/legal.js';
import { startBrandIntro } from '../ui/components/brandIntro.js';
import { closeSplash } from '../ui/components/opening.js';

const SESSION_KEY = 'pcs-session';
const GUARD_KEY = 'pcs-auth-guard';
const MAX_AGE = 12 * 60 * 60 * 1000;
const FREE_TRIES = 5;

/* ===== Sesión ===== */
export function currentSession() {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    if (s && s.v === AUTH.v && s.exp > Date.now()) return s;
  } catch (e) { /* sin sesión */ }
  return null;
}
function startSession(u) {
  const now = Date.now();
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ v: AUTH.v, user: u.user, name: u.name, role: u.role, at: now, exp: now + MAX_AGE }));
}
export async function logout() {
  try { const d = await import('../services/drafts.js'); await d.flush(); } catch (e) { /* app aún no cargada */ }
  sessionStorage.removeItem(SESSION_KEY);
  location.replace(location.pathname + '#/');
  location.reload();
}

/* ===== Verificación ===== */
const enc = new TextEncoder();
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function sha256hex(text) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function pbkdf2(pass, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: AUTH.iterations }, key, 256));
}
function equal(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i];
  return r === 0;
}
async function verify(user, pass) {
  const u = String(user || '').trim().toLowerCase();
  const id = await sha256hex(`${AUTH.pepper}|${u}`);
  const entry = AUTH.users.find((x) => x.id === id);
  /* Mismo costo aunque el usuario no exista (no revela qué usuarios son válidos) */
  const salt = entry ? b64(entry.salt) : crypto.getRandomValues(new Uint8Array(16));
  const derived = await pbkdf2(String(pass || ''), salt);
  return entry && equal(derived, b64(entry.hash)) ? { user: u, name: entry.name, role: entry.role } : null;
}

/* ===== Bloqueo por intentos ===== */
function guard() { try { return JSON.parse(localStorage.getItem(GUARD_KEY) || '{"n":0,"until":0}'); } catch (e) { return { n: 0, until: 0 }; } }
function saveGuard(g) { try { localStorage.setItem(GUARD_KEY, JSON.stringify(g)); } catch (e) { /* */ } }
function registerFail() {
  const g = guard(); g.n += 1;
  if (g.n >= FREE_TRIES) g.until = Date.now() + Math.min(15 * 60, 30 * 2 ** (g.n - FREE_TRIES)) * 1000;
  saveGuard(g);
  return g;
}
const lockedFor = () => Math.max(0, guard().until - Date.now());

/* ===== Pantalla de acceso ===== */
/* Al abrir la app, las puertas de la pantalla de carga se abren sobre el acceso (ver ui/components/opening.js) */
function hideSplash() { closeSplash(); }
function launchApp() {
  return import('../main.js');
}
/* La app ya mostró su primera pantalla (o no pudo arrancar y mostró el aviso): la transición de marca puede terminar */
function appShown(mod) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const shown = new Promise((res) => window.addEventListener('routechange', res, { once: true }));
  return Promise.race([shown, Promise.resolve(mod.ready).then(() => wait(600)), wait(8000)]);
}

function showLogin() {
  const root = document.createElement('section');
  root.className = 'login';
  root.setAttribute('aria-label', 'Iniciar sesión');
  root.innerHTML = `
    <div class="login-in">
      <header class="login-brand">
        <img src="./assets/brand/perconsur-mark.png" alt="" class="login-mark">
        <span class="wordmark login-word">PERCONSUR</span>
        <div class="band" aria-hidden="true"></div>
      </header>
      <h1 class="login-title">Inicia sesión</h1>
      <p class="login-sub">Ingresa tu usuario y contraseña para continuar.</p>
      <form class="login-form" method="post" action="#" novalidate autocomplete="on">
        <label class="fld"><span class="fl">Usuario</span>
          <input class="in" name="username" id="lg-user" type="text" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" inputmode="text" enterkeyhint="next" required></label>
        <label class="fld"><span class="fl">Contraseña</span>
          <span class="in-w"><input class="in" name="password" id="lg-pass" type="password" autocomplete="current-password" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="go" required>
          <button type="button" class="in-act" id="lg-peek" aria-label="Mantén presionado para ver la contraseña">${icon.eye}</button></span></label>
        <p class="login-msg" id="lg-msg" role="alert" aria-live="assertive"></p>
        <button type="submit" class="btn-primary block lg" id="lg-go"><span>Entrar</span></button>
      </form>
      <p class="login-foot">Versión ${APP_VERSION} | ${APP_BUILD}<br><small class="legal-copy">${copyrightText()}</small></p>
    </div>`;
  document.body.appendChild(root);
  hideSplash();

  const form = root.querySelector('form'), user = root.querySelector('#lg-user'), pass = root.querySelector('#lg-pass');
  const msg = root.querySelector('#lg-msg'), go = root.querySelector('#lg-go'), peek = root.querySelector('#lg-peek');
  let timer = null, busy = false;

  /* Ver la contraseña solo mientras se mantiene presionado el botón */
  const show = (on) => { pass.type = on ? 'text' : 'password'; peek.classList.toggle('on', on); };
  peek.addEventListener('pointerdown', (e) => { e.preventDefault(); show(true); });
  ['pointerup', 'pointerleave', 'pointercancel', 'blur'].forEach((ev) => peek.addEventListener(ev, () => show(false)));
  peek.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('visibilitychange', () => show(false));

  function lockUI() {
    clearInterval(timer);
    const tick = () => {
      const ms = lockedFor();
      if (!ms) { clearInterval(timer); go.disabled = false; msg.textContent = ''; msg.className = 'login-msg'; return; }
      const s = Math.ceil(ms / 1000);
      go.disabled = true;
      msg.className = 'login-msg warn';
      msg.textContent = `Demasiados intentos. Espera ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} para volver a intentar.`;
    };
    tick(); timer = setInterval(tick, 1000);
  }
  if (lockedFor()) lockUI();

  user.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); pass.focus(); } });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy || lockedFor()) return;
    show(false);
    if (!user.value.trim()) { msg.className = 'login-msg warn'; msg.textContent = 'Escribe tu usuario.'; user.focus(); return; }
    if (!pass.value) { msg.className = 'login-msg warn'; msg.textContent = 'Escribe tu contraseña.'; pass.focus(); return; }
    if (!(window.crypto && crypto.subtle)) { msg.className = 'login-msg warn'; msg.textContent = 'Abre la app desde una dirección segura (https) para iniciar sesión.'; return; }
    busy = true; go.disabled = true; go.querySelector('span').textContent = 'Verificando…'; msg.textContent = '';
    let ok = null;
    try { ok = await verify(user.value, pass.value); } catch (err) { ok = null; }
    pass.value = '';
    if (ok) {
      saveGuard({ n: 0, until: 0 });
      startSession(ok);
      /* Transición de marca: cubre el acceso mientras la app arranca y se retira cuando el panel ya está en pantalla */
      const intro = startBrandIntro();
      root.classList.add('out');
      document.activeElement && document.activeElement.blur();
      let mod = null;
      try { mod = await launchApp(); } catch (err) { console.error(err); }
      if (!mod) {
        intro.abort();
        sessionStorage.removeItem(SESSION_KEY);
        root.classList.remove('out');
        busy = false; go.disabled = false; go.querySelector('span').textContent = 'Entrar';
        msg.className = 'login-msg warn'; msg.textContent = 'No se pudo abrir la aplicación. Revisa tu conexión e intenta de nuevo.';
        return;
      }
      await intro.end(appShown(mod));
      root.remove();
      return;
    }
    busy = false; go.disabled = false; go.querySelector('span').textContent = 'Entrar';
    const g = registerFail();
    form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake');
    if (lockedFor()) lockUI();
    else {
      msg.className = 'login-msg warn';
      const left = FREE_TRIES - g.n;
      msg.textContent = `Usuario o contraseña incorrectos.${left > 0 && left <= 2 ? ` Te queda${left > 1 ? 'n' : ''} ${left} intento${left > 1 ? 's' : ''} antes del bloqueo temporal.` : ''}`;
      pass.focus();
    }
  });
}

/* Si la sesión vence mientras la app está abierta, se vuelve a pedir el acceso al regresar */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !currentSession() && !document.querySelector('.login')) logout();
});

if (currentSession()) launchApp();
else showLogin();
