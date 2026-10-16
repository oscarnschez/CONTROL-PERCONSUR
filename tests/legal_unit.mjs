// Información legal (sin navegador): contenido mínimo del aviso de privacidad, condiciones de uso y cookies, y que los
// textos coincidan con lo que la app hace de verdad (plazos del Worker, sesión de 12 horas, sin cookies).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PRIVACY, TERMS, STORAGE, PORTAL_NOTICE, LEGAL_HOLDER, LEGAL_ADDRESS, PRIVACY_EMAIL, LEGAL_UPDATED } from '../src/legal/texts.js';
import { LEGAL_LINKS } from '../src/config/legal.js';
const ok = (c, m) => console.log((c ? 'OK  ' : 'FAIL') + ' ' + m);
const ROOT = new URL('..', import.meta.url).pathname;
const text = (secs) => secs.map((s) => [s.title, ...s.body.flat()].join(' ')).join(' ');
const priv = text(PRIVACY), terms = text(TERMS), store = text(STORAGE);

ok(LEGAL_HOLDER === 'PERCONSUR DE NAYARIT GROUP' && /Zapopan, Jalisco/.test(LEGAL_ADDRESS) && /C\.P\. 45200/.test(LEGAL_ADDRESS), `responsable y domicilio: ${LEGAL_HOLDER}, ${LEGAL_ADDRESS}`);
ok(/^[^@\s]+@[^@\s]+\.[a-z]+$/.test(PRIVACY_EMAIL) && priv.includes(PRIVACY_EMAIL), `medio de contacto para datos personales: ${PRIVACY_EMAIL}`);
for (const [w, m] of [[/RFC/, 'RFC'], [/CURP/, 'CURP'], [/licencia/, 'licencia'], [/fotograf/, 'fotografía'], [/ubicación/, 'ubicación GPS'], [/patrimoniales o financieros/, 'datos patrimoniales o financieros'], [/sensibles/, 'declaración sobre datos sensibles']])
  ok(w.test(priv), 'el aviso de privacidad informa: ' + m);
ok(/Acceso/.test(priv) && /Rectificación/.test(priv) && /Cancelación/.test(priv) && /Oponerse/.test(priv) && /revocar su consentimiento/.test(priv) && /limitar el uso/.test(priv), 'derechos ARCO, revocación del consentimiento y limitación del uso');
ok(/identificación oficial/.test(priv) && /representante/.test(priv), 'requisitos de la solicitud (identificación y representante)');
ok(/no usa estos datos para publicidad/.test(priv) && /no los vende/.test(priv), 'sin finalidades secundarias: ni publicidad ni venta');
ok(/IOPGPS/.test(priv) && /Cloudflare/.test(priv) && /GitHub/.test(priv) && /OpenStreetMap/.test(priv) && /Esri/.test(priv) && /notificaciones/.test(priv), 'proveedores que reciben datos (GPS, Cloudflare, GitHub, mapas y notificaciones)');
ok(/cliente/.test(priv) && /si el operador lo autorizó, su nombre y apellido/.test(priv), 'qué ve el cliente en el enlace de rastreo (operador solo por nombre y apellido, y solo si lo autorizó)');
ok(/Secretaría Anticorrupción y Buen Gobierno/.test(priv), 'autoridad en materia de datos personales');
ok(priv.includes(LEGAL_UPDATED) && terms.includes(LEGAL_UPDATED) && /^\d{1,2} de [a-z]+ de \d{4}$/.test(LEGAL_UPDATED), `fecha de actualización visible: ${LEGAL_UPDATED}`);
// Coincidencia con la práctica real
const worker = readFileSync(join(ROOT, 'gps-proxy/worker.js'), 'utf8');
const keep = Number((worker.match(/const TRACK_KEEP = (\d+) \* 24 \* 3600/) || [])[1]);
const maxH = Number((worker.match(/Math\.min\(h, 720\) : (\d+);/) || [])[1]);
ok(keep === 30 && maxH === 72 && /72 horas como máximo/.test(priv) && /30 días después/.test(priv), `plazos del enlace de rastreo iguales a los del Worker (${maxH} h de vigencia, ${keep} días de registro)`);
const gate = readFileSync(join(ROOT, 'src/auth/gate.js'), 'utf8');
ok(/MAX_AGE = 12 \* 60 \* 60 \* 1000/.test(gate) && /12 horas/.test(store), 'la sesión de 12 horas descrita en Cookies coincide con el acceso');
const files = []; const walk = (p) => statSync(p).isDirectory() ? readdirSync(p).forEach((f) => walk(join(p, f))) : /\.(js|html)$/.test(p) && files.push(p);
['src', 'index.html', 'legal.html', 'service-worker.js', 'gps-proxy/worker.js'].forEach((f) => walk(join(ROOT, f)));
const cookie = files.filter((f) => /document\.cookie|Set-Cookie/i.test(readFileSync(f, 'utf8')));
ok(cookie.length === 0 && /no usan cookies/.test(store) && /analítica, publicidad/.test(store), 'ni la app ni el Worker usan cookies, como dice el aviso' + (cookie.length ? ': ' + cookie.join(', ') : ''));
ok(/indispensable/.test(store) && /borrar/.test(store), 'almacenamiento indispensable y cómo borrarlo');
// Condiciones de uso
ok(/personal autorizado/.test(terms) && /personales e intransferibles/.test(terms) && /confidencial/.test(terms) && /revóquelo/.test(terms), 'condiciones: uso autorizado, contraseña personal, confidencialidad y revocar enlaces enviados por error');
ok(/aproximada/.test(terms) && /Zapopan, Jalisco/.test(terms) && /Estados Unidos Mexicanos/.test(terms), 'condiciones: alcance del GPS, legislación y tribunales');
ok(/no usa cookies/.test(PORTAL_NOTICE) && PORTAL_NOTICE.startsWith(LEGAL_HOLDER), 'aviso simplificado del portal: responsable, finalidad y sin cookies');
// Estructura: identificadores únicos y pestañas de Ajustes
const ids = [...PRIVACY, ...TERMS, ...STORAGE].map((s) => s.id);
ok(new Set(ids).size === ids.length && ids.every((x) => /^[a-z]+$/.test(x)), 'secciones con identificador único');
const page = readFileSync(join(ROOT, 'src/legal/page.js'), 'utf8');
ok(LEGAL_LINKS.every(([h]) => page.includes(`id: '${h}'`)) && LEGAL_LINKS.length === 3, 'Ajustes enlaza las 3 pestañas de legal.html');
const sw = readFileSync(join(ROOT, 'service-worker.js'), 'utf8'), pre = readFileSync(join(ROOT, 'scripts/precache.mjs'), 'utf8');
ok(/'\.\/legal\.html'/.test(sw) && /'legal\.html'/.test(pre), 'legal.html se precarga y se abre sin conexión');
