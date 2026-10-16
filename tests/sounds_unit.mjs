// Sonidos (sin navegador): los tres archivos existen, son livianos, se precargan para usarse sin conexión y cada uno
// suena donde corresponde (entrada en la transición de marca, confirmación en el aviso verde, nube al publicar y recibir).
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const ok = (c, m) => console.log((c ? 'OK  ' : 'FAIL') + ' ' + m);
const ROOT = new URL('..', import.meta.url).pathname;
const rd = (f) => readFileSync(join(ROOT, f), 'utf8');
const files = { intro: 'intro.mp3', confirm: 'confirmacion.mp3', cloud: 'nube.mp3' };
const snd = rd('src/services/sounds.js');
for (const [k, f] of Object.entries(files)) {
  const b = readFileSync(join(ROOT, 'assets/sounds', f)), kb = statSync(join(ROOT, 'assets/sounds', f)).size / 1024;
  ok((b.toString('latin1', 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) && kb < 60 && snd.includes(`${k}: './assets/sounds/${f}'`), `${f}: MP3 de ${kb.toFixed(0)} KB para «${k}»`);
}
const sw = rd('service-worker.js');
ok(Object.values(files).every((f) => sw.includes(`./assets/sounds/${f}`)), 'los sonidos se precargan (funcionan sin conexión)');
ok(/play\('intro'\)/.test(rd('src/ui/components/brandIntro.js')) && /HOLD = 1950/.test(rd('src/ui/components/brandIntro.js')), 'entrada: suena con la transición de marca, que sale cuando el sonido empieza a apagarse (1.95 s)');
ok(/if \(type === 'ok'\) play\('confirm'\)/.test(rd('src/ui/components/toast.js')), 'confirmación: con el aviso verde de una acción confirmada');
const sync = rd('src/services/sync.js');
ok((sync.match(/play\('cloud'\)/g) || []).length === 4 && /if \(sent\) play\('cloud'\)/.test(sync),
  'nube: al terminar de publicar y al recibir la información (también en el teléfono de Taller: al enviar cambios y al recibir)');
ok(/unlock\(\)/.test(rd('src/auth/gate.js')) && /preload\(\)/.test(rd('src/auth/gate.js')), 'el toque de «Entrar» habilita el audio y los sonidos se descargan al abrir');
ok(/document\.hidden/.test(snd) && /'pcs-sound'/.test(snd) && /setTimeout\(r, 300\)/.test(snd), 'no suena en segundo plano ni apagado en Ajustes, y nunca se queda esperando el permiso del navegador');
