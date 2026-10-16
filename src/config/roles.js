/*
 * Perfiles de usuario (el perfil viene de src/config/auth.js y queda en la sesión).
 *   admin   toda la app
 *   taller  solo Operación → Taller (órdenes de mantenimiento, fallas, llantas, aceite y reportes) y lo básico de Ajustes;
 *           sin finanzas, viajes, cobranza, tarifas, operadores, documentos ni catálogos.
 * La pantalla es solo una parte: en el teléfono de Taller la información compartida trae únicamente Taller (ver
 * services/sync.js) y la base local rechaza escrituras fuera de Taller.
 */
export const ROLES = {
  admin: { label: 'Administrador', all: true, home: '/' },
  taller: {
    label: 'Taller', home: '/operacion/taller',
    routes: [/^\/operacion\/taller(\/.*)?$/, /^\/ajustes$/, /^\/ajustes\/compartir$/],
  },
};
/* Perfil desconocido: lo más restringido (solo Ajustes para cerrar sesión) */
const NONE = { label: 'Sin perfil', home: '/ajustes', routes: [/^\/ajustes$/] };
export const roleCfg = (role) => ROLES[role] || NONE;
export const isAdmin = (role) => !!roleCfg(role).all;
export function canRoute(role, path) {
  const c = roleCfg(role);
  return !!c.all || c.routes.some((re) => re.test(path));
}
