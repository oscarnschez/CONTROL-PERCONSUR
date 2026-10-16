# CLAUDE.md — instrucciones para Claude en este repositorio

App PWA de PERCONSUR (logística, GPS, documentos). Módulos ES sin compilación, enrutador por hash, IndexedDB.
El intermediario es un Cloudflare Worker (`gps-proxy/worker.js`) con IOPGPS, rastreo para clientes, información
compartida y avisos push. Ver `README.md`, `gps-proxy/README.md` y `tests/LEEME.md`.

## Comunicación

- Responde siempre en **español**, con lenguaje claro y sin tecnicismos innecesarios (el usuario no es programador).

## Flujo de trabajo: publicar automáticamente, sin preguntar

Instrucción permanente del usuario: después de cada cambio, con las pruebas en verde, **crea el PR, fusiónalo y publícalo
sin preguntar**:

1. Commit y push a la rama asignada a la sesión.
2. Crea el PR hacia `main` con las herramientas `mcp__github__*` (owner `oscarnschez`; el repositorio se renombró a
   `CONTROL-PERCONSUR`, pero las herramientas de la sesión lo aceptan con el nombre anterior `perconsur`).
3. Fusiónalo con **squash** pasando `expectedHeadSha` con el SHA completo de 40 caracteres (`git rev-parse HEAD`).
4. Revisa GitHub Pages (`actions_list` → `list_workflow_runs`, rama `main`).
5. Restablece la rama: `git fetch origin main && git checkout -B <rama> origin/main && git push --force-with-lease -u origin <rama>`.

Si alguna prueba falla, **no publiques** y explica qué falló. Una falla de tiempo en `auth.py` («termina antes (x s)»)
puede ocurrir por carga al correr pruebas en paralelo: repítela sola antes de concluir.

## Pruebas (antes de publicar)

- Worker: `cd gps-proxy && node test.mjs` (sin fallas).
- Reglas sin navegador: `node tests/<nombre>_unit.mjs` (todas).
- De punta a punta (Playwright, Chromium ya instalado): `cd tests && python3 <nombre>.py`. Las que inician sesión leen
  `PCS_TEST_USER` y `PCS_TEST_PASS` del entorno; nunca escribas credenciales en archivos.
- Agrega o ajusta pruebas con cada cambio y actualiza `tests/LEEME.md`.
- `tests/shots/` (capturas) **nunca** se sube: bórrala antes de terminar.

## Convenciones

- Subir versión en cada cambio publicado: `node scripts/precache.mjs --version X.Y.Z` (actualiza `src/config/version.js`
  y el service worker).
- `tests/*.py`, `tests/LEEME.md` y `MIGRACION.md` usan finales de línea **CRLF**: edítalos conservándolos
  (p. ej. Python con `newline=''`).
- Mensajes de commit y textos de la app en español.
- Los datos de prueba son **ficticios**. Las capturas que comparta el usuario pueden tener datos personales: no las subas.

## Cloudflare Worker

- Cuando cambie `gps-proxy/worker.js`, envíalo al usuario como archivo adjunto y pídele desplegarlo:
  Worker → Edit code → reemplazar todo → Deploy. Si hace falta una variable o secreto nuevo, dile exactamente cuál.
- La app debe seguir funcionando con un Worker anterior (los campos nuevos se ignoran sin error).

## Seguridad (obligatorio)

- No expongas en el código del navegador contraseñas del sistema GPS, tokens privados ni API keys sensibles. Si una
  integración requiere credenciales privadas, van como **secreto del Worker** (backend/proxy), y díselo al usuario.
- Nunca pidas al usuario pegar tokens o contraseñas en el chat.
- Los enlaces de rastreo para clientes no deben poder adivinarse (código al azar; el número de contenedor solo con un
  sufijo al azar).

## Direcciones en producción

| Dirección | Qué es |
|---|---|
| `https://control.perconsur.app` | la app (GitHub Pages con dominio propio) |
| `https://rastreo.perconsur.app` | el Worker: GPS, información compartida, avisos y portal `/r/…` |
| `https://perconsur.app/<código>` | enlaces cortos para clientes (variable `SHORT_BASE`); la raíz lleva a www.perconsur.mx |

Variables del Worker: `ALLOWED_ORIGIN` incluye `https://control.perconsur.app`; `APP_URL` = `https://control.perconsur.app/`.
