/*
 * Credenciales de acceso — ARCHIVO GENERADO por scripts/credenciales.mjs. No editar a mano.
 * No contiene el usuario ni la contraseña: solo huellas irreversibles.
 *   id   = SHA-256("pcs-auth-v1|" + usuario en minúsculas)
 *   hash = PBKDF2-SHA256(contraseña, salt, 600000 iteraciones, 32 bytes)
 */
export const AUTH = {
  v: 1,
  pepper: 'pcs-auth-v1',
  iterations: 600000,
  users: [
  {
    "id": "0d5f494351d0d5d2e1366bf7e9abc185d609f93b9f2cee1205494e19949bfbcd",
    "name": "Administrador",
    "role": "admin",
    "salt": "rWPAHHKwRsj5V+wwkSibSw==",
    "hash": "10O9zMSyId5O4eTKY59D1rBmYaA+T1LARM3ron8jCJg="
  },
  {
    "id": "0146e6c98f8db19980e7b045669bcf8002643ec06a736f8e2510605db9c53eab",
    "name": "Administrador",
    "role": "admin",
    "salt": "v0Ulqp45h9XPtzNW+RasZw==",
    "hash": "PqKSRM9LNEWX0cmIXicq8boZS5E1SyJ0J5W1Cy2f0O8="
  },
  {
    "id": "5d7de7149eb2cd7c87fa54dee801f85019e304f86c7ee828de766f8113e476d0",
    "name": "Administrador",
    "role": "admin",
    "salt": "v0Ulqp45h9XPtzNW+RasZw==",
    "hash": "PqKSRM9LNEWX0cmIXicq8boZS5E1SyJ0J5W1Cy2f0O8="
  },
  {
    "id": "99d54374c3b955ad78c284324c30638e16ef447ef8b6aedff6aa9c2a21ebc134",
    "name": "Taller",
    "role": "taller",
    "salt": "l1ieloZ0dx4j0IzDgLWhRg==",
    "hash": "6rvcmXy+5BRla30wCHFf/VjNpmsj3rV2lxsgdjOPswU="
  }
],
};
