/*
 * Datos de referencia operativos. Portados literalmente del HTML original.
 * No modificar sin revisar dónde se usan (documentos PDF, código para Excel, resumen WhatsApp).
 */

/* Versión: se genera automáticamente en src/config/version.js al ejecutar scripts/precache.mjs */
export { APP_VERSION, APP_BUILD } from './version.js';

/* Límites operativos originales */
export const MAX_CONT = 2;   // Máximo 2 contenedores por nota de entrega
export const CP_MAX = 6;     // Máximo 6 unidades por hoja (asignación de Campo)

/* Modalidad: el original siempre imprime "Importación" (modalLbl) */
export const MODALES = { imp: 'Importación', exp: 'Exportación', vac: 'Vacíos', tra: 'Transferencia' };
export const modalLbl = () => MODALES.imp;

export const TRACK_PREFIX = 'tinyurl.com/';

/* Tipos de contenedor (códigos ISO 6346) */
export const TIPOS = [
  ['22G0', "20' seco"], ['22G1', "20' seco"], ['42G0', "40' seco"], ['42G1', "40' seco"], ['45G0', "40' High Cube"], ['45G1', "40' High Cube"],
  ['22R1', "20' refrigerado"], ['42R1', "40' refrigerado"], ['45R1', "40' High Cube refrigerado"],
  ['22U1', "20' open top"], ['42U1', "40' open top"], ['22P1', "20' flat rack"], ['42P1', "40' flat rack"], ['22T6', "20' tanque"],
];
/* Conversión de nombres antiguos a código ISO (migración de borradores viejos) */
export const TIPO_OLD = {
  "20' estándar": '22G1', "40' estándar": '42G1', "40' HC": '45G1', "20' refrigerado": '22R1', "40' refrigerado": '42R1',
  "20' open top": '22U1', "40' open top": '42U1', "20' flat rack": '22P1', "40' flat rack": '42P1',
};
export const TIPO_DEFAULT = '45G1';
/* Descripción de un código ISO («45G1» → «40' High Cube»); '' si no está en la lista */
export const tipoDesc = (code) => (TIPOS.find(([v]) => v === code) || [])[1] || '';

/* Modo de tráfico */
export const TRAFICOS = [['', 'Sin indicar'], ['FCL', 'FCL (contenedor completo)'], ['LCL', 'LCL (carga consolidada)']];

/* Terminales portuarias (Manzanillo) — semilla del catálogo editable */
export const TERMINALES_SEED = ['SSA', 'Contecon', 'TIMSA', 'OCUPA'];

/* Lados de la evidencia fotográfica (orden del anexo 2×2) */
export const LADOS = [['puertas', 'Puertas (trasera)'], ['frente', 'Frente'], ['izq', 'Lateral izquierdo'], ['der', 'Lateral derecho']];

/* Líneas navieras por prefijo del BL */
export const NAVIERAS = [
  [['MEDU', 'MSCU', 'MSDU', 'MEDC'], 'MSC'], [['MAEU', 'MRKU', 'MSKU', 'SEAU', 'SEJJ'], 'Maersk'], [['CMDU', 'CMAU', 'CMAC'], 'CMA CGM'],
  [['HLCU', 'HLXU', 'HLBU'], 'Hapag-Lloyd'], [['COSU', 'CCLU', 'COSC'], 'COSCO Shipping'], [['OOLU', 'OOCL'], 'OOCL'], [['ONEY', 'ONEU'], 'Ocean Network Express (ONE)'],
  [['EGLV', 'EISU', 'EMCU'], 'Evergreen'], [['YMLU', 'YMJA', 'YMMU'], 'Yang Ming'], [['HDMU', 'HMMU'], 'HMM'], [['ZIMU', 'ZIMA'], 'ZIM'], [['SUDU'], 'Hamburg Süd'],
  [['WHLC', 'WHLU'], 'Wan Hai Lines'], [['PABV', 'PCIU', 'PILU'], 'PIL'], [['APLU'], 'APL'], [['SMLM', 'SMLU'], 'SM Line'], [['KMTC', 'KMTU'], 'KMTC'],
  [['SITC', 'SITU'], 'SITC'], [['MATS'], 'Matson'], [['ANNU'], 'ANL'], [['TSLU', 'TSLC'], 'T.S. Lines'], [['SNKO'], 'Sinokor'], [['ESPU'], 'Emirates Shipping Line'],
  [['CSLU'], 'CSL'], [['SWBU'], 'Seaboard Marine'], [['CROW', 'CRMU'], 'Crowley'], [['KKLU', 'KKCU'], 'K Line'], [['NYKS', 'NYKU'], 'NYK Line'], [['MOLU'], 'MOL'],
];

/* Estados de la República (para "Destino para Excel": Municipio, EDO) */
export const EDOS = [
  ['aguascalientes', 'AGS'], ['baja california sur', 'BCS'], ['baja california', 'BC'], ['campeche', 'CAMP'], ['chiapas', 'CHIS'], ['chihuahua', 'CHIH'],
  ['ciudad de mexico', 'CDMX'], ['cdmx', 'CDMX'], ['coahuila', 'COAH'], ['colima', 'COL'], ['durango', 'DGO'], ['guanajuato', 'GTO'], ['guerrero', 'GRO'], ['hidalgo', 'HGO'],
  ['jalisco', 'JAL'], ['estado de mexico', 'MEX'], ['edomex', 'MEX'], ['michoacan', 'MICH'], ['morelos', 'MOR'], ['nayarit', 'NAY'], ['nuevo leon', 'NL'], ['oaxaca', 'OAX'],
  ['puebla', 'PUE'], ['queretaro', 'QRO'], ['quintana roo', 'QROO'], ['san luis potosi', 'SLP'], ['sinaloa', 'SIN'], ['sonora', 'SON'], ['tabasco', 'TAB'],
  ['tamaulipas', 'TAMPS'], ['tlaxcala', 'TLAX'], ['veracruz', 'VER'], ['yucatan', 'YUC'], ['zacatecas', 'ZAC'], ['mexico', 'MEX'],
];

/* División Campo: plantas destino (dirección + link de Google Maps) — semilla del catálogo editable */
export const PLANTAS_SEED = [
  { name: 'Planta Nextipac', address: 'Paseo del Cerenero 890, Nextipac, C.P. 45220, Zapopan, Jalisco', maps: 'https://maps.app.goo.gl/7LpgdFcwesjL52Nx5' },
  { name: 'Planta Villagrán', address: 'Carretera Panamericana KM 293, C.P. 38260, Villagrán, Guanajuato', maps: 'https://maps.app.goo.gl/mP8RWxe9tZeYPfPAA' },
  { name: 'Planta Los Mochis', address: 'Carretera Internacional KM 1616, Zona Industrial, C.P. 81116, Los Mochis, Sinaloa', maps: 'https://maps.app.goo.gl/fNgkjypp4Doi2gjRA' },
];
export const CAMPO_TEMPORADA = 'Temporada Bajío 2026';

/* Tipos de transporte de Campo */
export const CP_TIPOS = ['Tolva', 'Jaula'];

/* Versiones impresas en el pie de los documentos (no cambiar: identifican el formato) */
export const DOC_VERSION_PUERTO = 'NER 3.0';
export const DOC_VERSION_CAMPO = 'AU 2.0';

/*
 * Librerías externas (mismas versiones que el original).
 * "local": se sirve desde /vendor y queda disponible sin conexión desde la primera carga.
 * Todas están incluidas en /vendor; el CDN queda solo como respaldo si el archivo local no carga.
 */
export const LIBS = {
  html2canvas: { global: 'html2canvas', local: './vendor/html2canvas.min.js', cdn: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js' },
  jspdf: { global: 'jspdf', local: './vendor/jspdf.umd.min.js', cdn: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js' },
  pdflib: { global: 'PDFLib', local: './vendor/pdf-lib.min.js', cdn: 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js' },
  qrcode: { global: 'qrcode', local: './vendor/qrcode.min.js', cdn: 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js' },
  bwipjs: { global: 'bwipjs', local: './vendor/bwip-js-min.js', cdn: 'https://cdnjs.cloudflare.com/ajax/libs/bwip-js/4.10.0/bwip-js-min.js' },
  /* Mapas de Logística (ubicación GPS). La hoja de estilos se agrega al cargarla (ui/components/gpsMap.js) */
  leaflet: { global: 'L', local: './vendor/leaflet/leaflet.js', cdn: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js' },
};
/* Fuente del logotipo (Archivo), incluida localmente en /vendor/fonts */
export const FONT_CSS = './vendor/fonts/archivo.css';
