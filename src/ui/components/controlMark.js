/*
 * Símbolo de CONTROL PERCONSUR en vector (señal: un punto, un arco y el arco que remata en la barra de la «N»), trazado
 * sobre el ícono original (assets/brand/control-perconsur.png; coincide en ~99 %). Cada pieza se puede animar por separado:
 *   .cm-dot   el punto (origen de la señal)        .cm-a1   el arco interior        .cm-a2   el arco exterior con la barra
 *   .cm-wave  ondas que salen del punto (solo en la transición de marca; withWaves)
 * El origen (0,0) del dibujo es el centro del punto: los arcos y las ondas crecen desde ahí (transform-box: fill-box,
 * transform-origin: 0 100%). La pantalla de carga de index.html repite este mismo dibujo en línea para verse antes del JS.
 * Decorativo (aria-hidden): el nombre de la app va en texto junto a él.
 */
export const CONTROL_ORANGE = '#FF5800';
export const CONTROL_NAVY = '#0F0147';
export const MARK_VIEWBOX = '-60 -564 620 624';
export const MARK_PATHS = {
  dot: 'M50 0A50 50 0 1 1-50 0A50 50 0 1 1 50 0Z',
  a1: 'M0-296A296 296 0 0 1 296 0H124A124 124 0 0 0 0-124Z',
  a2: 'M0-554A554 554 0 0 1 377-406V-554H550V0H381A381 381 0 0 0 0-381Z',
};
const WAVE = 'M0-60A60 60 0 0 1 60 0';

export const controlMark = (cls = '', { withWaves = false } = {}) => `<svg class="cm ${cls}" viewBox="${MARK_VIEWBOX}" aria-hidden="true" focusable="false">${withWaves ? `<g class="cm-waves" fill="none" stroke="${CONTROL_ORANGE}">${[1, 2].map((n) => `<path class="cm-wave w${n}" d="${WAVE}" vector-effect="non-scaling-stroke"/>`).join('')}</g>` : ''}<g fill="${CONTROL_ORANGE}"><path class="cm-dot" d="${MARK_PATHS.dot}"/><path class="cm-a1" d="${MARK_PATHS.a1}"/><path class="cm-a2" d="${MARK_PATHS.a2}"/></g></svg>`;
