# Órdenes de Servicio — diseño

La **Orden de Servicio** es el expediente maestro de un viaje: lo captura una sola vez y lo comparte con los módulos que ya
existían. No es una segunda aplicación: la orden **relaciona** registros existentes (Control de llenos, Logística, viaje
financiero de Operadores, Control de vacíos, documentos generados) y guarda solo lo que no tiene otro dueño.

## Una sola fuente por dato

| Dato | Fuente autorizada | Antes del vínculo |
|---|---|---|
| Contenedor, peso, terminal o patio de carga, fecha y hora de cita, Pedimento, DODA, DEC, Cita | **Control de llenos** (`fullContainerLoads` y `fullContainerDocuments`) | La orden (Puerto, sin carga vinculada) |
| Unidad, operador, remolque, origen, destino, lugar de entrega, referencia, estado logístico | **Logística** (`logisticsOperations`) desde el despacho | El plan de la orden |
| Tarifa, gastos, IVA / ISR / retención de IVA, comisión | **Viaje del operador** (`operatorTrips`) desde el despacho | `order.finance` (borrador) |
| Cobro (por cobrar / pagado) | **Cobranza** (`tripBilling`) | — |
| Devolución del contenedor vacío | **Control de vacíos** (`emptyContainers`) | — |
| Nota de entrega / Asignación de unidades | **Documentos** (`documents`): cada PDF emitido es una instantánea inmutable | — |
| Cliente, empresa solicitante, contacto, instrucciones, entrega, incidencias, cierres, auditoría | **La orden** (`serviceOrders`, `serviceOrderEvents`, `serviceOrderFiles`) | — |

La pantalla de la orden lee cada dato de su fuente (`services/orders.js` → `resolved()`), y una edición desde la orden
escribe en la fuente (p. ej. cambiar la cita reprograma la carga de Control de llenos; cambiar la unidad después del despacho
actualiza la operación de Logística). Así un cambio hecho en cualquier módulo se ve igual en todos.

## Relaciones

```
serviceOrders.id ── fullLoadId ──────────▶ fullContainerLoads.id
                 ── logisticsOperationId ▶ logisticsOperations.id   (la operación guarda serviceOrderId)
                 ── tripId ──────────────▶ operatorTrips.id          (el viaje guarda serviceOrderId)
                 ── emptyReturnId ───────▶ emptyContainers.id        (creado por Logística al pasar a «Vacío»)
                 ── generated[].documentId ▶ documents.id            (versiones de la nota o asignación)
serviceOrderEvents.orderId / serviceOrderFiles.orderId ─▶ serviceOrders.id
```

Folio: `OS-AAAA-NNNNNN`, contador persistente por año en `counters` (`os:AAAA`), dentro de una transacción y nunca menor
que el folio más alto ya guardado; un folio de una orden cancelada no se reutiliza.

## Estados

Se guardan por separado y el estado global se **deriva** (`domain/orders/orders.js` → `deriveState`):

- **Orden**: `draft` (borrador) · `scheduled` (confirmada) · `cancelled`; `closedAt` = operativamente finalizada.
- **Logístico**: el de la operación de Logística (nuevo estado inicial `assigned` = «Asignada, pendiente de salida»).
- **Documental**: completa / pendiente / por verificar / no requerida (reglas de Control de llenos: DEC solo dentro de puerto).
- **Entrega**: pendiente / realizada (`order.delivery`).
- **Devolución del vacío**: no aplica / pendiente / programada / en traslado / entregado (Control de vacíos).
- **Financiero**: sin tarifa / por registrar / por cobrar / pagado (viaje + Cobranza). El cierre administrativo es
  independiente del cierre operativo.

Estado global: Borrador → Pendiente de documentación / Pendiente de asignación → Lista para despacho → Despachada →
En operación → Entrega realizada → Pendiente de devolución → Vacío en devolución → Lista para cierre → Operativamente
finalizada (o Cancelada). Cada orden recorre solo las etapas que le aplican (Campo y movimientos sin devolución no pasan
por vacíos).

## Transiciones (idempotentes)

- **Despachar**: valida (bloqueos y advertencias autorizables), crea o reutiliza el viaje financiero (una sola vez, nunca
  otra comisión) y la operación de Logística (busca primero una ya creada para esta orden), y guarda cada vínculo en cuanto
  existe: si algo falla a la mitad, repetir el despacho reutiliza lo ya creado y no duplica.
- **Cambio de estado**: siempre en Logística (`setStatus`); la orden lo lee de ahí y su historial une los eventos de la
  orden, de la operación, de la carga y del vacío.
- **Contenedor vacío**: es el estado «Vacío» de Logística, que ya crea o reutiliza el control de vacíos del contenedor (uno
  abierto por contenedor); la orden guarda el vínculo y precarga el patio previsto.
- **Cierre operativo**: Puerto con devolución exige entrega + vacío entregado (o una excepción registrada); Campo, la
  entrega. Incidencias críticas abiertas lo impiden. Cerrar la orden cierra la operación de Logística.

## Pantallas y flujo

| Dirección | Qué es |
|---|---|
| `#/operacion/ordenes` | Listado: indicadores (pendientes, listas, en operación, entregas, devolución pendiente, finalizadas, incidencias), buscador por folio, referencia o contenedor y filtros (división, cliente, estado, fecha o rango, unidad, operador, documentación, activas o finalizadas) |
| `#/operacion/ordenes/nueva` | Formulario por etapas (`?division=campo`, `?carga=<id>` desde Control de llenos, `?operador=<id>` desde Operadores) |
| `#/operacion/ordenes/:id/editar/:paso` | Una etapa: 1 General · 2 Transporte · 3 Asignación · 4 Documentación · 5 Económica · 6 Revisión y despacho |
| `#/operacion/ordenes/:id` | Expediente: siguiente paso, avance por etapas y pestañas (Resumen, Documentos, Asignación, Seguimiento, Entrega, Control de vacíos, Finanzas, Historial) |
| `#/operacion/ordenes/vincular` | Registros existentes sin orden (ver «Migración») |

- Cada «Continuar», «Atrás», salto de etapa o cerrar **guarda** (borrador): solo se envía lo que cambió en esa etapa, así no
  se pisa un cambio hecho mientras tanto en Control de llenos, Logística u otro dispositivo.
- **Nota de entrega / asignación**: «Generar» llena la plantilla existente (cliente, RFC y dirección del catálogo de
  destinos, operador, unidad, remolque, contenedor, peso, tarifa e impuestos, cita, terminal, pedimento, BL, carta porte,
  instrucciones) y abre su revisión con vista previa. Al generar el PDF queda como versión nueva en la orden con una
  instantánea de los datos; si después cambian unidad, operador, remolque, ruta, contenedor o cliente, la orden avisa que la
  versión vigente ya no coincide. La versión vigente se relaciona con la operación de Logística y con el viaje.
- **Despacho** («Confirmar asignación y despachar»): resumen, bloqueos con «Corregir», advertencias que se autorizan una por
  una (quedan en el historial) y estado inicial (Asignada, En carga o En ruta). La unidad aparece al momento en
  Inicio → Unidades en operación. «Asignada» no se comparte con el cliente hasta confirmar la salida (el Worker no cambia).
- **Seguimiento**: estado de Logística, panel GPS de la unidad, sugerencias por geocerca que solo se aplican al confirmarlas,
  incidencias (las críticas impiden el cierre) y bitácora.
- **Entrega**: fecha, hora, lugar, quién recibe, observaciones y evidencia; Logística pasa a «Descargando» si seguía antes y
  la carga de Control de llenos queda «Cargada». En Puerto no cierra la orden: sigue el vacío.
- **Inicio**: resumen de órdenes (pendientes, listas, en curso, devolución) y las próximas con su siguiente paso. El folio
  aparece enlazado en Logística, Control de llenos (que además ofrece «Crear orden de servicio») y Control de vacíos.

## Migración de registros existentes

No se convierte nada automáticamente. **Operación → Órdenes de servicio → Vincular registros existentes** muestra las
operaciones de Logística abiertas y las cargas de Control de llenos abiertas que aún no tienen orden. Antes de vincular en
bloque se descarga un respaldo. Cada vínculo crea una orden `source: 'migrated'` que **apunta** a los registros originales
(sin copiar ni recalcular viajes, comisiones, impuestos ni cobros) y marca en `pending` los datos que faltan (por ejemplo,
el cliente); no se inventan datos. Un contenedor que coincide con varias cargas abiertas se marca como ambiguo y no se
vincula solo. Los viajes históricos cerrados siguen consultándose en sus módulos.

## Permisos

`services/orders.js` → `can(acción)`: en un dispositivo de consulta nada se modifica (además la base rechaza escrituras);
las acciones sensibles (despachar, cambiar asignación después del despacho, cancelar, reabrir, finanzas, cierre,
excepciones) se verifican en el servicio, no solo en la pantalla.
