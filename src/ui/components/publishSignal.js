/*
 * Animación de «Publicando información» (información compartida del capturista): el logotipo de PERCONSUR emite ondas
 * de señal hacia arriba, a una nube que late al recibirlas. Al terminar, la nube muestra una palomita.
 *   signalStage()  versión grande para Ajustes → Información compartida (clase .ps-done al terminar)
 *   signalMini()   versión pequeña para el aviso de Inicio: un punto de señal sube del logotipo a la nube
 * Solo CSS (styles/screens.css). Con «reducir movimiento» las ondas quedan quietas, como un ícono de señal.
 * Es decorativa (aria-hidden): el texto de estado lo da quien la muestra.
 */
const MARK = './assets/brand/perconsur-mark.png';
const CLOUD = 'M7 18.5h10.5a3.8 3.8 0 0 0 .9-7.5 5.8 5.8 0 0 0-10.5-2.3A4.9 4.9 0 0 0 7 18.5z';

export const signalStage = () => `<div class="ps-stage" aria-hidden="true">
    <span class="ps-cloud"><svg viewBox="1 3.6 21.6 16" fill="none" stroke-linecap="round" stroke-linejoin="round"><path class="ps-cl" d="${CLOUD}"/><path class="ps-ok" d="m9.3 13.6 2 2 3.6-3.8"/></svg></span>
    <span class="ps-waves"><i></i><i></i><i></i></span>
    <img class="ps-mark" src="${MARK}" alt="">
  </div>`;

export const signalMini = () => `<span class="ps-mini" aria-hidden="true"><img class="ps-mm" src="${MARK}" alt=""><i class="ps-dot"></i><svg class="ps-mc" viewBox="1 3.6 21.6 16" fill="none" stroke-linejoin="round"><path d="${CLOUD}"/></svg></span>`;
