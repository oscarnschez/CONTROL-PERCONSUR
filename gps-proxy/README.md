# PERCONSUR · Intermediario GPS (IOPGPS)

Cloudflare Worker que conecta PERCONSUR con la Open API de IOPGPS sin poner credenciales en la app.

```
open.iopgps.com  ←(appid + secreto, firma, accessToken)—  Worker «perconsur-gps»  ←(clave PCS_KEY)—  PERCONSUR (PWA)
```

- Guarda `IOP_APPID` e `IOP_SECRET` como **secretos de Cloudflare** (nunca en el código ni en el repositorio).
- Renueva el permiso de IOPGPS (dura 2 h) automáticamente.
- Pide las posiciones de **toda la flota en una sola llamada** y las guarda 30 s: varias pantallas abiertas no multiplican las consultas al proveedor.
- Solo responde a la app (clave `PCS_KEY`) desde el sitio autorizado (`ALLOWED_ORIGIN`).
- **Límite de intentos:** bloquea temporalmente la conexión que prueba claves incorrectas (ver abajo).
- Si IOPGPS no responde, entrega la última posición conocida marcada como `stale: true` (antigua) o un error claro.
- **Información compartida (opcional):** guarda la información que publica el dispositivo capturista para que otros
  dispositivos la consulten sin importar respaldos (ver abajo).

Este archivo no contiene credenciales; se puede publicar sin riesgo.

## Instalación (panel web, sin instalar nada)

1. **Cuenta:** https://dash.cloudflare.com/sign-up (plan gratuito).
2. **Crear el Worker:** Workers & Pages → Create → Create Worker → nombre `perconsur-gps` → Deploy.
   La primera vez elige tu subdominio `workers.dev`. La dirección queda como `https://perconsur-gps.<tu-subdominio>.workers.dev`.
3. **Secretos:** en el Worker → Settings → Variables and Secrets → Add:

   | Nombre | Tipo | Valor |
   |---|---|---|
   | `IOP_APPID` | Secret | appid de la Open API de IOPGPS (p. ej. `LOG_PERCONSUR`) |
   | `IOP_SECRET` | Secret | clave de la Open API (de preferencia **regenerada** si alguna vez se compartió) |
   | `PCS_KEY` | Secret | clave larga inventada (30+ letras y números al azar); la misma se captura en PERCONSUR → Ajustes → GPS |
   | `ALLOWED_ORIGIN` | Text | `https://oscarnschez.github.io` |

4. **Código:** en el Worker → Edit code → borra el ejemplo → pega el contenido completo de [`worker.js`](worker.js) → Deploy.
5. **Prueba:** abre `https://perconsur-gps.<tu-subdominio>.workers.dev/salud` en el navegador.
   - `"autenticacion": "correcta"` y `"dispositivos": N` → listo.
   - `"secretos": { … false }` → falta algún secreto del paso 3.
   - `"error": "IOPGPS rechazó la autenticación…"` → revisa appid/secreto, o confirma con IOPGPS que la Open API esté activa para tu cuenta.
   - Para ver los **nombres** de los campos que entrega IOPGPS (sin credenciales): `/salud?key=TU_PCS_KEY`.

> Con terminal (opcional): `npx wrangler deploy` desde esta carpeta usa [`wrangler.toml`](wrangler.toml); los secretos se cargan con `npx wrangler secret put IOP_SECRET` (y los demás).

## Endpoints

| Ruta | Acceso | Devuelve |
|---|---|---|
| `GET /salud` | libre (sin datos sensibles) | estado de secretos, autenticación, número de dispositivos y si el rastreo para clientes está listo |
| `GET /v1/posiciones[?imeis=865…,867…]` | `X-PCS-Key` | `{ ok, fetchedAt, stale, devices: [{ imei, name, lat, lng, gpsTime, signalTime, speed, course, acc, positionType, address }] }` |
| `GET /v1/ubicacion?imei=865…` | `X-PCS-Key` | `{ ok, fetchedAt, stale, device: { …, address, signalTime } }` (dirección y estado; guardado 2 min) |
| `GET /v1/enlaces` | `X-PCS-Key` | enlaces de rastreo para clientes (activos y de los últimos 30 días) |
| `POST /v1/enlaces` | `X-PCS-Key` | crea (o reutiliza) el enlace de una operación de Logística |
| `POST /v1/enlaces/:id` · `…/finalizar` · `…/revocar` | `X-PCS-Key` | actualiza el estado; finaliza (entrega terminada) o revoca |
| `GET /r/:token` | **público** (solo con el enlace) | página del portal de rastreo para el cliente |
| `GET /v1/publico/:token` | **público** (solo con el enlace) | origen, destino, estado y ubicación de esa unidad mientras el enlace está activo |
| `GET /v1/datos/estado` | `X-PCS-Data` (capturista o consulta) | `{ ok, role: 'write'\|'read', published: { ver, device, at, size, files, enc, by } }` |
| `GET /v1/datos` | `X-PCS-Data` | la información publicada (comprimida; la app la abre) |
| `PUT /v1/datos` | `X-PCS-Data` **capturista** | publica una versión nueva; `409` si la publicó otro dispositivo |
| `GET /v1/archivos/:id` | `X-PCS-Data` | un archivo (PDF, foto), siempre como descarga |
| `PUT` · `DELETE /v1/archivos/:id` | `X-PCS-Data` **capturista** | sube o borra un archivo (máximo 24 MB) |

Tiempos en milisegundos (epoch). Los campos que IOPGPS no entregue llegan como `null`: la app no inventa datos.

## Límite de intentos (rate limit)

`PCS_KEY` funciona como la contraseña del Worker. Para que no se pueda adivinar probando claves:

| Regla | Qué pasa |
|---|---|
| 5 claves incorrectas en 15 min desde la misma IP | esa IP queda bloqueada **15 min**; si reincide, el bloqueo se duplica (30 min, 1 h… hasta 24 h) |
| Mientras dura el bloqueo | no se revisa ninguna clave, **ni la correcta**: responde `429` con `Retry-After` |
| Más de 30 claves incorrectas en 15 min (de cualquier IP) | ataque repartido: basta **1** fallo para bloquear una IP |
| Más de 120 consultas por minuto desde una IP | `429` por un momento (protege también `/salud`) |
| IOPGPS falla (autenticación o posiciones) | no se le vuelve a llamar durante **30 s**, aunque lleguen muchas consultas; mientras tanto se responde con la última posición conocida o con el error |

Una clave correcta reinicia la cuenta de fallos de esa IP. La app muestra el mensaje del Worker («Demasiados intentos con una clave incorrecta. Intenta de nuevo en 15 min.») en Ajustes → GPS.

**Opcional, más robusto — compartir los bloqueos entre instancias.** Cloudflare puede atender las peticiones con varias instancias del Worker; por defecto cada una lleva su propia cuenta. Con un espacio KV los bloqueos se comparten y sobreviven a reinicios:

1. Storage & Databases → **KV** → Create → nombre `perconsur-limites`.
2. En el Worker → Settings → **Bindings** → Add → KV namespace → *Variable name* `LIMITS` → elige `perconsur-limites` → Deploy.

Solo se escribe en KV cuando alguien usa una clave incorrecta (el plan gratuito incluye 1 000 escrituras al día), y las IP se guardan como huella, no en texto. Sin KV el límite sigue funcionando en memoria.

La defensa principal sigue siendo una `PCS_KEY` **larga y al azar** (30+ caracteres): con el límite, adivinarla es impráctico.

## Rastreo para clientes (portal público)

Desde **Operación → Logística → Monitoreo GPS** se comparte con el cliente un enlace como
`https://perconsur-gps.<tu-subdominio>.workers.dev/r/Xq3…` (código al azar de 32 caracteres). El cliente ve una página con
la identidad de PERCONSUR, el mapa con la ubicación de **su** unidad, el origen, el destino y el estado del viaje.

**El permiso se decide en este Worker, no en el navegador:**

| El cliente ve | El cliente NO ve |
|---|---|
| ubicación actual de la unidad del viaje (o «última ubicación reportada» si no hay señal reciente) | velocidad, nombre completo del operador, número económico, placas, IMEI, referencia |
| operador: **un nombre y un apellido** (p. ej. «Daniel Rivera») | |
| origen, destino y lugar de entrega | otras unidades de la flota |
| estado: «En camino al destino» · «En el lugar de entrega» · «Entrega finalizada» | nada después de terminar la entrega, revocar o vencer el enlace |

**Cuándo deja de dar la ubicación:**
- al **terminar la entrega**: la app avisa al pasar la operación a En ruta vacío, Vacío o Inactiva (o al cerrarla); si en ese momento no hay conexión, lo avisa en cuanto la recupera;
- al **revocarlo** en el Centro de Monitoreo;
- al crear un enlace para **otro viaje de la misma unidad** (el anterior se finaliza);
- a las **72 h** como máximo (`TRACK_MAX_HOURS`), aunque nadie lo cierre.

### Activarlo (una sola vez)

1. **Espacio KV para los enlaces:** Storage & Databases → **KV** → Create → nombre `perconsur-rastreo`.
2. En el Worker → Settings → **Bindings** → Add → KV namespace → *Variable name* `TRACKING` → elige `perconsur-rastreo` → Deploy.
   (Si ya vinculaste `LIMITS`, el Worker la usa cuando falta `TRACKING`; se recomienda uno propio.)
3. **Código:** Edit code → pega el `worker.js` completo de esta carpeta → Deploy.
4. Opcionales en Settings → Variables and Secrets (Text):

   | Nombre | Valor por defecto | Para qué |
   |---|---|---|
   | `APP_URL` | `ALLOWED_ORIGIN` + `/PERCONSUR/` (p. ej. `https://oscarnschez.github.io/PERCONSUR/`) | de ahí el portal carga el mapa (MapLibre) y el diseño; solo `https` |
   | `TRACK_MAX_HOURS` | `72` | vigencia máxima de un enlace (1 a 720 h) |

5. **Prueba:** abre `/salud`; debe decir `"rastreoClientes": { "kv": true, "portal": true }`.

**Hora y señal:** la consulta de la flota de IOPGPS puede llegar sin la hora de la posición ni la última señal del
equipo. En ese caso el portal (igual que el Centro de Monitoreo) las completa con la consulta por unidad (ubicación +
estado, guardada 2 min), así no muestra «Sin señal reciente» por falta de hora. Solo dice «Sin señal reciente del GPS»
cuando el equipo de verdad no ha reportado en los últimos 10 min.

El portal se sirve desde la dirección del Worker (otro sitio que la app: no tiene acceso a los datos guardados en el
navegador de PERCONSUR) con una política de seguridad de contenido estricta, sin referer y sin indexarse en buscadores. Su
código y el mapa se cargan desde la app publicada en GitHub Pages (que permite cargarlos desde otro sitio). Un código
inexistente cuenta como intento fallido: 20 en 15 min bloquean esa conexión.

El mapa del portal ofrece vista de mapa o **satelital** (botón «Satélite / Mapa»). Las imágenes satelitales vienen de
Esri World Imagery (`https://server.arcgisonline.com`, sin clave) y la política de contenido del Worker las permite. El
botón solo aparece cuando el Worker marca el portal con `data-sat="1"`: con un Worker desplegado antes de este cambio el
portal sigue mostrando solo la vista de mapa (hay que volver a desplegar el Worker para activarla).

**Consumo de KV (plan gratuito: 100 000 lecturas y 1 000 escrituras al día):** una escritura al crear, actualizar,
finalizar o revocar un enlace; cada consulta del portal lee el enlace como máximo una vez cada 15 s por instancia.

**Mapa:** MapLibre GL JS (BSD-3) con mosaicos vectoriales de **OpenFreeMap** (datos de OpenStreetMap, esquema OpenMapTiles):
uso libre también comercial, sin clave ni límite de consultas; la atribución aparece en el mapa. No usa Google Maps ni
Leaflet. Para cambiar de proveedor (p. ej. MapTiler o un servidor propio) basta con ajustar `src/ui/maps/mapStyle.js`.

## Información compartida (varios dispositivos)

Para que otras personas tengan la PWA con **toda la información sin importar respaldos**: un solo dispositivo
**captura** y publica; los demás **consultan** y reciben lo mismo al día.

```
Capturista (PWA) —PUT, clave DATA_WRITE_KEY→  Worker  —KV «DATA»—  Worker  ←GET, clave DATA_READ_KEY— Consulta (PWA)
```

**Qué se comparte:** catálogos, documentos y sus PDF (con vistas previas y fotos), Logística, Control de vacíos,
Combustible, Control de operadores, Cobranza, documentos adicionales de viajes y ubicaciones de destinos.
**Qué no:** borradores, tema, últimos valores usados y las claves de cada dispositivo (GPS e Información compartida).

**Cómo funciona:**
- **Capturista:** cada cambio queda «pendiente» y se publica solo unos segundos después del último cambio (a lo más
  3 min). Primero sube los archivos nuevos, uno por uno, y después la información (registros comprimidos). Sin conexión
  queda pendiente, aunque se cierre la app, y se publica al volver. También hay **Publicar ahora**.
- **Consulta:** con la app abierta revisa cada minuto (y al volver a la app) si hay una versión nueva; si la hay, la
  recibe completa (reemplaza la de ese dispositivo) y descarga los archivos que le falten. Queda en **solo consulta**:
  sin botones de captura, la base local rechaza cualquier cambio y este Worker no le permite publicar (`403`).
- **Otro dispositivo con la clave de capturista** (por ejemplo, al cambiar de teléfono): el Worker no deja que pise la
  información publicada (`409`) y la app pide decidir: **Recibir la de la nube** (el teléfono nuevo queda igual y sigue
  publicando) o **Reemplazarla** con la de ese dispositivo.

### Activarla (una sola vez)

1. **Espacio KV:** Storage & Databases → **KV** → Create → nombre `perconsur-datos`.
2. En el Worker → Settings → **Bindings** → Add → KV namespace → *Variable name* `DATA` → elige `perconsur-datos` → Deploy.
3. Settings → **Variables and Secrets** → Add → tipo **Secret**:

   | Nombre | Valor | Quién la usa |
   |---|---|---|
   | `DATA_WRITE_KEY` | una frase larga al azar (32+ caracteres), distinta de las demás | solo el dispositivo capturista |
   | `DATA_READ_KEY` | otra frase larga al azar, distinta | los dispositivos de consulta |

4. **Código:** Edit code → pega el `worker.js` completo de esta carpeta → Deploy.
5. **Prueba:** abre `/salud`; debe decir `"informacionCompartida": { "kv": true, "claves": true }`.
6. **En la app:**
   - Capturista: Ajustes → **Información compartida** → dirección del Worker + `DATA_WRITE_KEY` → Guardar (publica la primera vez).
   - Cada persona de consulta: instala la PWA, inicia sesión, Ajustes → **Información compartida** → la misma dirección +
     `DATA_READ_KEY` → Guardar. Para ver también el GPS: Ajustes → **Rastreo GPS** con `PCS_KEY`.

**Seguridad:** las claves se capturan en cada dispositivo y se guardan solo ahí (no están en el código, ni en los
respaldos, ni en la información publicada). La información no es pública: sin la clave el Worker responde `401` y las
claves incorrectas cuentan como intentos fallidos (bloqueo de la conexión). Los archivos se entregan siempre como
descarga (nunca se muestran en el sitio del Worker). Quien tenga `DATA_READ_KEY` puede ver toda la información: trátala
como una contraseña. **Para quitarle el acceso a un dispositivo,** cambia `DATA_READ_KEY` en Cloudflare y captura la
nueva en los dispositivos que sí deben seguir viendo.

**Consumo de KV (plan gratuito: 1 GB, 100 000 lecturas y 1 000 escrituras al día, 25 MB por valor):** cada publicación
usa 2 escrituras y cada archivo nuevo o borrado 1; por eso la app agrupa los cambios. La primera publicación sube todos
los archivos: con más de ~900 PDF y fotos tarda más de un día y la app continúa sola cada 15 min (o al día siguiente).
Cada revisión de un dispositivo de consulta es 1 lectura. Si la operación crece mucho, el plan Workers Paid (5 USD al mes)
amplía estos límites.

## Consumo

La app consulta cada 30 s (detalle de la unidad y Centro de Monitoreo) o 60 s (Inicio), solo con la pantalla visible; el portal del cliente, cada 30 s mientras está abierto. El Worker llama a IOPGPS como máximo una vez cada 30 s para toda la flota, muy por debajo del límite gratuito de Cloudflare (100 000 peticiones al día).

## Prueba local

```
node gps-proxy/test.mjs
```

Ejecuta el Worker contra un servidor que imita la API de IOPGPS (firma `md5(md5(secreto)+time)`, `accessToken`, posiciones, ubicación, token vencido y proveedor caído). No usa credenciales reales.

## Rotar el secreto

1. En IOPGPS genera una clave nueva.
2. En Cloudflare reemplaza `IOP_SECRET` y pulsa Deploy.
3. Abre `/salud` para confirmar. La app no cambia.

Si sospechas que `PCS_KEY` se filtró, cámbiala en Cloudflare y en PERCONSUR → Ajustes → GPS.
Igual con `DATA_WRITE_KEY` o `DATA_READ_KEY`: cámbiala en Cloudflare y en Ajustes → Información compartida de cada dispositivo.
