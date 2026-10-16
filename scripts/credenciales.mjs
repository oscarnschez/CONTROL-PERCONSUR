/*
 * Genera src/config/auth.js con las credenciales de acceso SIN guardar el usuario ni la contraseña en texto.
 * Solo se escriben huellas: SHA-256 del usuario y PBKDF2-SHA256 (600 000 iteraciones, sal aleatoria) de la contraseña.
 *
 * Uso:   node scripts/credenciales.mjs             reemplaza las credenciales actuales
 *        node scripts/credenciales.mjs --agregar   agrega otro usuario a la lista
 *        … --rol=taller                             perfil del usuario (admin por omisión; taller = solo Taller y mantenimientos)
 * Pide usuario, nombre a mostrar y contraseña (la contraseña no se ve en pantalla mientras escribes).
 * Después ejecuta:  node scripts/precache.mjs
 */
import { createHash, randomBytes, pbkdf2Sync } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import readline from 'node:readline';

const ITERATIONS = 600000;
const PEPPER = 'pcs-auth-v1';
const OUT = new URL('../src/config/auth.js', import.meta.url).pathname;

function ask(rl, q, hidden = false) {
  return new Promise((res) => {
    if (hidden && process.stdin.isTTY) {
      const w = rl._writeToOutput; rl._writeToOutput = (s) => { if (s.includes(q)) w.call(rl, s); else w.call(rl, '*'); };
      rl.question(q, (a) => { rl._writeToOutput = w; process.stdout.write('\n'); res(a); });
    } else rl.question(q, res);
  });
}

let user, name, pass, pass2;
if (process.stdin.isTTY) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  user = (await ask(rl, 'Usuario: ')).trim().toLowerCase();
  name = (await ask(rl, 'Nombre a mostrar (Enter = Administrador): ')).trim() || 'Administrador';
  pass = await ask(rl, 'Contraseña: ', true);
  pass2 = await ask(rl, 'Repite la contraseña: ', true);
  rl.close();
} else {
  /* Entrada por tubería: tres líneas (usuario, nombre, contraseña) */
  const lines = readFileSync(0, 'utf8').split(/\r?\n/);
  user = (lines[0] || '').trim().toLowerCase();
  name = (lines[1] || '').trim() || 'Administrador';
  pass = pass2 = lines[2] || '';
}
if (!user || !pass) { console.error('El usuario y la contraseña son obligatorios.'); process.exit(1); }
if (pass !== pass2) { console.error('Las contraseñas no coinciden.'); process.exit(1); }
if (pass.length < 10) { console.error('Usa una contraseña de al menos 10 caracteres.'); process.exit(1); }

const id = createHash('sha256').update(`${PEPPER}|${user}`, 'utf8').digest('hex');
const salt = randomBytes(16);
const hash = pbkdf2Sync(Buffer.from(pass, 'utf8'), salt, ITERATIONS, 32, 'sha256');
const roleArg = (process.argv.find((a) => a.startsWith('--rol=')) || '--rol=admin').slice(6);
if (!['admin', 'taller'].includes(roleArg)) { console.error('Perfil no válido: usa --rol=admin o --rol=taller.'); process.exit(1); }
const entry = { id, name, role: roleArg, salt: salt.toString('base64'), hash: hash.toString('base64') };

let users = [];
if (process.argv.includes('--agregar') && existsSync(OUT)) {
  const m = readFileSync(OUT, 'utf8').match(/users: (\[[\s\S]*?\]),\n/);
  if (m) users = JSON.parse(m[1]).filter((u) => u.id !== id);
}
users.push(entry);
writeFileSync(OUT, `/*
 * Credenciales de acceso — ARCHIVO GENERADO por scripts/credenciales.mjs. No editar a mano.
 * No contiene el usuario ni la contraseña: solo huellas irreversibles.
 *   id   = SHA-256("${PEPPER}|" + usuario en minúsculas)
 *   hash = PBKDF2-SHA256(contraseña, salt, ${ITERATIONS} iteraciones, 32 bytes)
 */
export const AUTH = {
  v: 1,
  pepper: '${PEPPER}',
  iterations: ${ITERATIONS},
  users: ${JSON.stringify(users, null, 2)},
};
`);
console.log(`Listo: ${users.length} usuario(s) en src/config/auth.js. Ejecuta ahora: node scripts/precache.mjs`);
