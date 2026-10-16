/*
 * Textos legales de la app: Aviso de privacidad integral, Condiciones de uso y uso de almacenamiento (cookies).
 * Fuente única: los muestra legal.html (sin iniciar sesión) y los enlazan el acceso, Ajustes y el portal de clientes.
 * Describen lo que la app hace de verdad; si cambia lo que se recaba o con quién se comparte, actualiza el texto y la
 * fecha (LEGAL_UPDATED). Marco: Ley Federal de Protección de Datos Personales en Posesión de los Particulares (DOF
 * 20/03/2025). Conviene que un abogado los revise antes de entregarlos a operadores y clientes.
 *
 * Cada sección: { id, title, body } y body es una lista de párrafos (texto) o de listas (arreglo de textos).
 */
import { COMPANY_DEFAULTS } from '../config/companies.js';

const co = COMPANY_DEFAULTS.perconsur;
export const LEGAL_UPDATED = '16 de octubre de 2026';
export const LEGAL_HOLDER = co.legal;
export const LEGAL_ADDRESS = `${co.addr1} ${co.addr2}`.replace(/\s+/g, ' ').trim();
/* Correo para ejercer derechos sobre los datos personales (puede ser uno exclusivo, p. ej. privacidad@perconsur.mx) */
export const PRIVACY_EMAIL = co.email;

export const PRIVACY = [
  { id: 'responsable', title: '1. Quién es responsable de sus datos', body: [
    `${LEGAL_HOLDER} («PERCONSUR»), con domicilio en ${LEGAL_ADDRESS}, es responsable del tratamiento de los datos personales que se registran en esta aplicación.`,
    `Para cualquier asunto sobre sus datos personales puede escribir a ${PRIVACY_EMAIL}.`,
  ] },
  { id: 'datos', title: '2. Qué datos tratamos', body: [
    'Según su relación con PERCONSUR, la aplicación puede guardar:',
    [
      'Operadores: nombre, fotografía, RFC, CURP, número, tipo y vigencia de la licencia de conducir, unidad asignada, viajes realizados y la ubicación de la unidad que conducen mientras está en servicio.',
      'Operadores (datos patrimoniales o financieros): comisiones, anticipos, gastos, pagos y estados de cuenta relacionados con sus viajes.',
      'Clientes y contactos: nombre o razón social, RFC, dirección de entrega y contacto o teléfono.',
      'Personal autorizado que usa la aplicación: nombre de usuario, perfil de acceso, el registro de quién hace cada cambio y, si activa los avisos, el registro de notificaciones de su dispositivo.',
      'Documentos y fotografías de la operación (pólizas, documentos de las unidades, notas, pedimentos y otros), que pueden contener datos de las personas mencionadas.',
      'Personas que abren un enlace de rastreo: no se les pide ningún dato. El servidor usa la dirección IP de la conexión solo para limitar intentos y proteger el servicio.',
    ],
    'PERCONSUR no trata datos personales sensibles (por ejemplo, de salud, religión u origen étnico) en esta aplicación.',
  ] },
  { id: 'finalidades', title: '3. Para qué usamos sus datos', body: [
    'Los datos se usan únicamente para estas finalidades, necesarias para el servicio de transporte y la relación con usted:',
    [
      'Programar y documentar los servicios: asignación de unidades, operadores y remolques, notas de entrega, control de contenedores llenos y vacíos, y facturación.',
      'Ubicar las unidades por GPS para la seguridad de la carga, del operador y de la unidad, y para la logística de los viajes. Se rastrea el equipo instalado en la unidad, no el teléfono de las personas.',
      'Informar a cada cliente, mediante un enlace temporal, el estado y la ubicación del transporte de su servicio, con el número y las placas de la unidad, el remolque y el nombre y apellido del operador.',
      'Calcular y pagar comisiones, anticipos y liquidaciones de los operadores y emitir sus estados de cuenta.',
      'Controlar el mantenimiento, el combustible y la vigencia de documentos y licencias, y enviar avisos al personal autorizado (llegadas, salidas y vencimientos).',
      'Proteger la aplicación y la información: control de acceso, límite de intentos y respaldos.',
    ],
    'PERCONSUR no usa estos datos para publicidad, mercadotecnia ni para crear perfiles, y no los vende.',
  ] },
  { id: 'compartir', title: '4. Con quién se comparten', body: [
    'Para prestar el servicio, algunos datos pasan por proveedores que actúan por cuenta de PERCONSUR y solo para ese fin:',
    [
      'Proveedor del sistema GPS de las unidades (IOPGPS): ubicación y estado de los equipos instalados.',
      'Cloudflare: intermediario seguro del GPS, enlaces de rastreo, avisos e información compartida entre los dispositivos de PERCONSUR.',
      'GitHub: alojamiento del código de la aplicación (no recibe los registros de la operación).',
      'Servicios de mapas y direcciones (OpenFreeMap, OpenStreetMap y Esri): reciben la zona del mapa que se consulta o la dirección que se busca.',
      'Servicios de notificaciones del navegador (Apple, Google o Mozilla): entregan los avisos cifrados al personal que los activó.',
    ],
    'Además, el cliente de cada servicio recibe la información del punto 3 mientras su enlace de rastreo está activo, y PERCONSUR comunicará datos a las autoridades cuando una ley o una orden lo exija.',
  ] },
  { id: 'conservacion', title: '5. Dónde se guardan y por cuánto tiempo', body: [
    'Los registros, documentos y fotos se guardan en los dispositivos del personal autorizado y, cuando se activa la información compartida, en el servicio de Cloudflare con claves de acceso. La aplicación pide usuario y contraseña y bloquea el acceso tras varios intentos fallidos.',
    'Un enlace de rastreo deja de mostrar la ubicación al cerrar la operación, al revocarlo o al vencer (72 horas como máximo); su registro se borra 30 días después. Los demás datos se conservan mientras dure la relación con usted y durante los plazos que exigen las leyes (por ejemplo, fiscales y laborales); después se eliminan.',
  ] },
  { id: 'derechos', title: '6. Sus derechos (ARCO) y cómo ejercerlos', body: [
    `Usted puede pedir el Acceso a sus datos, su Rectificación si son inexactos, su Cancelación u Oponerse a su uso, así como revocar su consentimiento o limitar el uso de sus datos. Envíe su solicitud a ${PRIVACY_EMAIL} con:`,
    [
      'Su nombre y un medio para responderle.',
      'Una identificación oficial (o la de su representante y el documento que lo acredite).',
      'Qué datos y qué derecho quiere ejercer, y cualquier documento que ayude a localizarlos.',
    ],
    'PERCONSUR le responderá en los plazos que marca la ley. Revocar el consentimiento o cancelar datos puede impedir continuar con un servicio o una relación que los necesite (por ejemplo, el pago de comisiones). Si considera que sus derechos no fueron atendidos, puede acudir a la autoridad en materia de protección de datos personales (Secretaría Anticorrupción y Buen Gobierno).',
  ] },
  { id: 'cambios', title: '7. Cambios a este aviso', body: [
    `Cualquier cambio se publicará en esta misma página con su fecha de actualización. Última actualización: ${LEGAL_UPDATED}.`,
  ] },
];

export const STORAGE = [
  { id: 'cookies', title: 'Cookies y almacenamiento del dispositivo', body: [
    'Esta aplicación y el portal de rastreo no usan cookies, ni herramientas de analítica, publicidad o rastreo de visitantes.',
    'Para funcionar, la aplicación guarda información solo en el navegador del dispositivo:',
    [
      'La sesión iniciada (se borra al cerrar la aplicación o a las 12 horas).',
      'El tema claro u oscuro, las preferencias de pantalla y el contador de intentos de acceso.',
      'Los registros, documentos y fotos de la operación, y una copia de la aplicación para usarla sin conexión.',
      'En el portal de rastreo, solo la vista de mapa elegida (mapa o satélite).',
    ],
    'Es almacenamiento indispensable para que la aplicación funcione, por eso no se pide aceptarlo por separado. Se puede borrar desde la configuración del navegador (datos del sitio); al hacerlo se pierden los registros que no estén respaldados.',
  ] },
];

export const TERMS = [
  { id: 'uso', title: '1. Quién puede usarla', body: [
    `Esta aplicación es una herramienta interna de ${LEGAL_HOLDER}. Solo puede usarla el personal autorizado por PERCONSUR y únicamente para sus funciones de trabajo. Al iniciar sesión, la persona usuaria acepta estas condiciones.`,
  ] },
  { id: 'cuenta', title: '2. Cuenta y contraseña', body: [[
    'El usuario y la contraseña son personales e intransferibles: no se comparten ni se anotan a la vista.',
    'Cierre la sesión en equipos compartidos y avise de inmediato a PERCONSUR si pierde un dispositivo con la aplicación o sospecha que alguien conoce su contraseña.',
  ]] },
  { id: 'informacion', title: '3. Información confidencial', body: [[
    'La información de clientes, operadores, unidades, tarifas, documentos y ubicaciones es confidencial y propiedad de PERCONSUR.',
    'No la copie, exporte ni comparta fuera de PERCONSUR, salvo cuando sus funciones lo requieran (por ejemplo, enviar a un cliente su documento o su enlace de rastreo).',
    'Los enlaces de rastreo se envían solo al cliente del servicio. Si uno se envía por error, revóquelo desde la aplicación.',
    'Registre información veraz y trate los datos personales conforme al Aviso de privacidad.',
  ]] },
  { id: 'servicio', title: '4. Alcance del servicio', body: [
    'La ubicación proviene del equipo GPS de cada unidad y de un proveedor externo: puede tener retrasos, imprecisiones o interrupciones, y es informativa. Los cálculos de comisiones, tarifas y estados de cuenta deben revisarse antes de usarse para un pago o una factura.',
    'PERCONSUR puede actualizar la aplicación, cambiar sus funciones o suspender un acceso en cualquier momento.',
  ] },
  { id: 'rastreo', title: '5. Enlaces de rastreo para clientes', body: [
    'Quien recibe un enlace de rastreo puede consultar el estado y la ubicación de su transporte mientras el servicio está activo. El enlace es personal: no debe publicarse ni compartirse con terceros. La ubicación es aproximada e informativa.',
  ] },
  { id: 'incumplimiento', title: '6. Incumplimiento y legislación', body: [
    'El uso no autorizado o contrario a estas condiciones puede dar lugar a la suspensión del acceso y a las medidas que prevean el reglamento interior, el contrato y las leyes aplicables.',
    `Estas condiciones se rigen por las leyes de los Estados Unidos Mexicanos; para cualquier controversia, las partes se someten a los tribunales competentes de Zapopan, Jalisco. Última actualización: ${LEGAL_UPDATED}.`,
  ] },
];

/* Aviso de privacidad simplificado del portal de rastreo */
export const PORTAL_NOTICE = `${LEGAL_HOLDER} usa la ubicación de la unidad y el nombre del operador solo para informarte del estado de este servicio. Este sitio no usa cookies.`;
