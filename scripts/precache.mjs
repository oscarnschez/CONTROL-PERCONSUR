/*
 * Genera la versión visible de la app, la lista de precarga y la versión del service worker.
 * Ejecutar después de CUALQUIER ajuste en archivos de la app:
 *   node scripts/precache.mjs                  si algo cambió, sube la versión (1.1.0 → 1.1.1) y la fecha de compilación
 *   node scripts/precache.mjs --version 1.2.0  fija una versión (para cambios mayores)
 * La versión se muestra en la pantalla de acceso, en Ajustes y en el aviso «se actualizó a la versión…».
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = new URL('..', import.meta.url).pathname;
const INCLUDE = ['index.html', 'manifest.json', 'src', 'styles', 'assets/icons', 'assets/brand', 'assets/geo', 'vendor'];
const files = [];
const walk = (p) => { const s = statSync(p); if (s.isDirectory()) readdirSync(p).sort().forEach((f) => walk(join(p, f))); else if (!/(^|\/)\.|README|\.map$|\/original\//.test(p)) files.push(p); };
INCLUDE.forEach((x) => walk(join(ROOT, x)));
/* ===== Versión visible ===== */
const VFILE = join(ROOT, 'src/config/version.js');
const vsrc = readFileSync(VFILE, 'utf8');
const cur = { version: (vsrc.match(/APP_VERSION = '([^']+)'/) || [])[1] || '1.0.0', build: (vsrc.match(/APP_BUILD = '([^']+)'/) || [])[1] || '', content: (vsrc.match(/APP_CONTENT = '([^']*)'/) || [])[1] || '' };
const ch = createHash('sha256');
files.filter((f) => f !== VFILE).forEach((f) => { ch.update(relative(ROOT, f)); ch.update(readFileSync(f)); });
const content = ch.digest('hex').slice(0, 12);
const ai = process.argv.indexOf('--version');
const forced = ai > 0 ? process.argv[ai + 1] : null;
if (forced && !/^\d+\.\d+\.\d+$/.test(forced)) { console.error('La versión debe tener el formato 1.2.3'); process.exit(1); }
let next = cur.version, build = cur.build;
if (forced || content !== cur.content) {
  if (forced) next = forced;
  else if (cur.content) { const [a, b, c] = cur.version.split('.').map(Number); next = `${a}.${b}.${c + 1}`; }
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  build = `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  writeFileSync(VFILE, `/* ARCHIVO GENERADO por scripts/precache.mjs — no editar a mano. */\nexport const APP_VERSION = '${next}';\nexport const APP_BUILD = '${build}';\nexport const APP_CONTENT = '${content}';\n`);
}
console.log(next !== cur.version ? `Versión de la app: ${cur.version} → ${next} (${build})` : forced ? `Versión de la app: ${next} fijada (${build})` : content !== cur.content ? `Versión de la app: ${next} (${build})` : `Versión de la app: ${next} (sin cambios en los archivos)`);

const h = createHash('sha256');
files.forEach((f) => { h.update(relative(ROOT, f)); h.update(readFileSync(f)); });
const version = h.digest('hex').slice(0, 10);
const list = ['./', ...files.map((f) => './' + relative(ROOT, f))];
const sw = join(ROOT, 'service-worker.js');
const src = readFileSync(sw, 'utf8');
const block = `/* PRECACHE:START */\nconst VERSION = '${version}';\nconst PRECACHE = ${JSON.stringify(list, null, 2)};\n/* PRECACHE:END */`;
writeFileSync(sw, src.replace(/\/\* PRECACHE:START \*\/[\s\S]*?\/\* PRECACHE:END \*\//, block));
console.log(`service-worker.js: ${list.length} archivos, versión ${version}`);
