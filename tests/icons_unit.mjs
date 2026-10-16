// Ícono y nombre de la app CONTROL PERCONSUR (sin navegador): manifiesto, íconos de la pantalla de inicio con su tamaño
// real, favicon .ico con 7 tamaños, ícono dentro de la app y que el logotipo de la empresa PERCONSUR no cambió.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { APP_NAME, APP_ICON, appBadge } from '../src/config/legal.js';
import { COMPANY_DEFAULTS } from '../src/config/companies.js';
const ok = (c, m) => console.log((c ? 'OK  ' : 'FAIL') + ' ' + m);
const ROOT = new URL('..', import.meta.url).pathname;
const png = (f) => { const b = readFileSync(join(ROOT, f)); return b.toString('ascii', 1, 4) === 'PNG' ? { w: b.readUInt32BE(16), h: b.readUInt32BE(20) } : null; };
const man = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
ok(man.name === 'CONTROL PERCONSUR' && man.short_name === 'CONTROL' && man.short_name.length <= 12, `manifiesto: «${man.name}» (en la pantalla de inicio: «${man.short_name}»)`);
const want = { '192x192': 192, '512x512': 512, '180x180': 180 };
ok(man.icons.length === 4 && man.icons.every((i) => { const d = png(i.src); return d && d.w === want[i.sizes] && d.h === want[i.sizes]; }), 'íconos del manifiesto con su tamaño real: ' + man.icons.map((i) => i.src.split('/').pop() + ' ' + i.sizes).join(', '));
ok(man.icons.some((i) => i.purpose === 'maskable'), 'ícono adaptable (maskable) para Android');
const ico = readFileSync(join(ROOT, 'assets/icons/favicon.ico'));
const n = ico.readUInt16LE(4), sizes = [...Array(n)].map((_, k) => ico[6 + k * 16] || 256).sort((a, b) => a - b);
ok(ico.readUInt16LE(0) === 0 && ico.readUInt16LE(2) === 1 && sizes.join(',') === '16,24,32,48,64,128,256', 'favicon.ico con 7 tamaños: ' + sizes.join(', ') + ' px');
const f32 = png('assets/icons/favicon-32.png'); ok(f32 && f32.w === 32, 'favicon-32.png de 32 px');
const icon = png(APP_ICON.replace('./', ''));
ok(APP_NAME === 'CONTROL PERCONSUR' && icon && icon.w === icon.h && icon.w >= 132, `ícono dentro de la app: ${APP_ICON} (${icon && icon.w} px, nítido a 44 px en pantallas 3x)`);
ok(appBadge().includes(APP_ICON) && appBadge().includes(APP_NAME) && appBadge('sm').includes('app-id sm') && /alt=""/.test(appBadge()), 'insignia de la app: ícono decorativo y nombre en texto');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
ok(/name="application-name" content="CONTROL PERCONSUR"/.test(html) && /name="apple-mobile-web-app-title" content="CONTROL"/.test(html), 'nombre de la app en iPhone y en el navegador');
ok(COMPANY_DEFAULTS.perconsur.logo === './assets/brand/perconsur-mark.png' && existsSync(join(ROOT, 'assets/brand/perconsur-mark.png')) && /perconsur-mark\.png/.test(html), 'el logotipo de PERCONSUR no se reemplazó (empresa, documentos y pantalla de carga)');
const sw = readFileSync(join(ROOT, 'service-worker.js'), 'utf8');
ok(sw.includes('./assets/brand/control-perconsur.png') && sw.includes('./assets/icons/favicon.ico'), 'el ícono nuevo se precarga para usarse sin conexión');
