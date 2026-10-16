/*
 * Sonidos de la app (assets/sounds):
 *   intro     al abrir la app: suena con la transición de marca al iniciar sesión (ui/components/brandIntro.js), que está
 *             sincronizada con él. Necesita el toque de «Entrar»: los navegadores no dejan sonar nada al abrir sin un toque.
 *   confirm   al confirmarse una acción (aviso verde «…guardado», ui/components/toast.js)
 *   cloud     al terminar de publicar la información compartida o al recibirla (services/sync.js)
 * Web Audio: el primer toque o tecla habilita el audio (AudioContext.resume) y después los sonidos pueden sonar aunque
 * lleguen más tarde (p. ej. al terminar de publicar). Sin audio, con la app en segundo plano o con los sonidos apagados en
 * Ajustes (localStorage «pcs-sound» = 'off') no suena nada y nunca falla. Cada sonido avisa con el evento «pcs:sound».
 */
const FILES = { intro: './assets/sounds/intro.mp3', confirm: './assets/sounds/confirmacion.mp3', cloud: './assets/sounds/nube.mp3' };
const VOLUME = { intro: 0.9, confirm: 0.7, cloud: 0.8 };
const KEY = 'pcs-sound';
/* Un sonido de confirmación no se encima con la entrada ni con la nube que acaban de sonar */
const QUIET_AFTER = { intro: 2800, cloud: 900 };

let ctx = null;
const buffers = {}, last = {};

export function soundsOn() { try { return localStorage.getItem(KEY) !== 'off'; } catch (e) { return true; } }
export function setSoundsOn(on) { try { if (on) localStorage.removeItem(KEY); else localStorage.setItem(KEY, 'off'); } catch (e) { /* solo esta vez */ } }

function audio() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try { ctx = new AC(); } catch (e) { ctx = null; }
  return ctx;
}
/* Descarga y decodifica una vez (la descarga no necesita toque; se precarga al abrir) */
function load(name) {
  if (!buffers[name]) {
    const c = audio();
    buffers[name] = !c ? Promise.resolve(null) : fetch(FILES[name]).then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((b) => (b ? new Promise((res, rej) => { const p = c.decodeAudioData(b, res, rej); if (p && p.then) p.then(res, rej); }) : null))
      .catch(() => null);
  }
  return buffers[name];
}
export function preload(...names) { if (soundsOn()) (names.length ? names : Object.keys(FILES)).forEach(load); }

/* Habilita el audio: llamarla dentro de un toque o tecla (además se hace sola con el primero) */
export function unlock() {
  const c = audio();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
}
['pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, unlock, { capture: true, passive: true }));

export async function play(name) {
  if (!FILES[name] || !soundsOn() || document.hidden) return false;
  const now = performance.now();
  if (name === 'confirm' && Object.entries(QUIET_AFTER).some(([k, ms]) => last[k] && now - last[k] < ms)) return false;
  if (QUIET_AFTER[name]) last[name] = now;
  const c = audio();
  if (!c) return false;
  /* Sin un toque previo, resume() puede quedar esperando: se intenta un momento y, si no, no suena */
  if (c.state === 'suspended') { try { await Promise.race([c.resume(), new Promise((r) => setTimeout(r, 300))]); } catch (e) { /* sin permiso todavía */ } }
  if (c.state !== 'running') return false;
  const buf = await load(name);
  if (!buf) return false;
  try {
    const src = c.createBufferSource(), gain = c.createGain();
    gain.gain.value = VOLUME[name];
    src.buffer = buf; src.connect(gain); gain.connect(c.destination); src.start();
  } catch (e) { return false; }
  if (!QUIET_AFTER[name]) last[name] = performance.now();
  window.dispatchEvent(new CustomEvent('pcs:sound', { detail: { name } }));
  return true;
}
