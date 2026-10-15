/*
 * Módulos de las secciones principales. Para agregar un módulo operativo nuevo (p. ej. mantenimiento, llantas)
 * basta con añadirlo aquí y registrar su ruta en main.js: la navegación no cambia. «nav» es el nombre corto para el
 * menú lateral de computadora (si falta, se usa «title»).
 */
export const OPERATION_MODULES = [
  { key: 'logistica', title: 'Logística', desc: 'Estado y asignación actual de las unidades.', route: '/operacion/logistica', icon: 'truck' },
  { key: 'mapa', title: 'Mapa de viajes', desc: 'Distribución de viajes por estado de destino en las 32 entidades.', route: '/operacion/mapa', icon: 'map' },
  { key: 'combustible', title: 'Combustible y rendimiento', nav: 'Combustible', desc: 'Recargas por unidad, rendimiento km/L, gráficas y reporte en Excel.', route: '/operacion/combustible', icon: 'fuel' },
  { key: 'taller', title: 'Taller', desc: 'Control de mantenimiento y reparaciones de unidades y remolques.', route: '/operacion/taller', icon: 'wrench' },
];
export const ADMIN_MODULES = [
  { key: 'operadores', title: 'Operadores', desc: 'Información y control de operadores.', route: '/operadores', icon: 'people' },
  { key: 'unidades', title: 'Unidades', desc: 'Catálogo único PERCONSUR: expedientes, fotografías, documentación y vigencias.', route: '/unidades', icon: 'truck' },
  { key: 'cobranza', title: 'Cobranza', desc: 'Viajes y demoras en planta por cobrar y pagados; reporte en PDF.', route: '/cobranza', icon: 'cash' },
  { key: 'tarifas', title: 'Tarifas', desc: 'Tarifas de transporte por apartado y división (Puerto o Campo), antes de impuestos, con edición y PDF.', route: '/tarifas', icon: 'tag' },
  { key: 'documentos', title: 'Documentos', desc: 'Historial de documentos generados.', route: '/documentos', icon: 'docs' },
  { key: 'catalogos', title: 'Catálogos', desc: 'Operadores, remolques, destinos y demás registros.', route: '/catalogos', icon: 'catalog' },
];
/* Ícono de cada división (mismo estilo de línea que el resto de la app) */
export const DIVISION_ICON = { puerto: 'containers', campo: 'sprout' };
