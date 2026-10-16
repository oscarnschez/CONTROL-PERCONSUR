/*
 * Página de información legal (legal.html): Aviso de privacidad, Condiciones de uso y Cookies y almacenamiento.
 * Se abre sin iniciar sesión (desde el acceso, Ajustes o el portal de clientes) y no carga datos de la app.
 * Pestañas por dirección: #privacidad (por omisión), #condiciones, #cookies.
 */
import { PRIVACY, TERMS, STORAGE, LEGAL_UPDATED, LEGAL_HOLDER } from './texts.js';
import { esc } from '../domain/shared/format.js';
import { copyrightText } from '../config/legal.js';

try { const t = localStorage.getItem('pcs-theme'); if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); } catch (e) { /* tema del sistema */ }

export const TABS = [
  { id: 'privacidad', label: 'Aviso de privacidad', title: 'Aviso de privacidad integral', sections: PRIVACY },
  { id: 'condiciones', label: 'Condiciones de uso', title: 'Condiciones de uso', sections: TERMS },
  { id: 'cookies', label: 'Cookies', title: 'Cookies y almacenamiento', sections: STORAGE },
];

const para = (b) => (Array.isArray(b) ? `<ul>${b.map((li) => `<li>${esc(li)}</li>`).join('')}</ul>` : `<p>${esc(b)}</p>`);
const section = (s) => `<section class="lg-sec" id="${s.id}"><h2>${esc(s.title)}</h2>${s.body.map(para).join('')}</section>`;

function render() {
  const root = document.getElementById('legal');
  if (!root) return;
  const want = location.hash.replace('#', '');
  const tab = TABS.find((t) => t.id === want) || TABS[0];
  document.title = `${tab.title} · PERCONSUR`;
  root.innerHTML = `
    <header class="lg-head">
      <img src="./assets/brand/perconsur-mark.png" alt="" class="lg-mark"><span class="wordmark lg-word">PERCONSUR</span>
    </header>
    <div class="lg-band" aria-hidden="true"></div>
    <nav class="lg-tabs" aria-label="Información legal">${TABS.map((t) => `<a href="#${t.id}"${t === tab ? ' aria-current="page"' : ''}>${esc(t.label)}</a>`).join('')}</nav>
    <article class="lg-doc" aria-labelledby="lg-title">
      <h1 id="lg-title">${esc(tab.title)}</h1>
      <p class="lg-meta">${esc(LEGAL_HOLDER)} · Última actualización: ${esc(LEGAL_UPDATED)}</p>
      ${tab.sections.map(section).join('')}
    </article>
    <footer class="lg-foot"><a href="./">Ir a la aplicación</a><small>${esc(copyrightText())}</small></footer>`;
}

window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
render();
