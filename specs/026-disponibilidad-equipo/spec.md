# Feature Specification: Disponibilidad y turnos del equipo

**Feature Branch**: `feature/nexora-turnos`

**Created**: 2026-10-18

**Status**: Especificada antes de escribir código.

**Carril**: ciclo completo (Principio VI). Añade configuración persistente y
auditoría, por lo que requiere una migración aditiva. Plan en
[plan.md](plan.md), tareas en [tasks.md](tasks.md) y modelo en
[data-model.md](data-model.md).

## Problema

Nexora Remesas necesita operar con cinco o más trabajadoras sin permitir que
una cuenta suspendida o fuera de su turno envíe mensajes. Hoy cualquier miembro
autenticado puede responder por texto, adjuntos, datos estructurados o
plantillas, y Ajustes > Equipo solo permite crear cuentas.

## Decisiones

- **D1 — Zona horaria única y explícita.** Toda evaluación usa
  `America/Bogota`, independientemente de la zona del navegador, contenedor o
  sesión PostgreSQL.
- **D2 — Semana configurable.** Cada miembro tiene cero o más intervalos por
  día de la semana. Un intervalo puede cruzar medianoche (`22:00–06:00`) y se
  considera parte del día en que comienza.
- **D3 — Compatibilidad al actualizar.** Miembros existentes y nuevos reciben
  el horario humano inicial de Nexora, todos los días de `06:00` a `22:00`.
  La migración solo añade columnas y una tabla; no elimina ni reescribe datos
  de demostración.
- **D4 — Dos condiciones para operar.** Un miembro puede enviar solo si su
  estado administrativo es `enabled` y la hora actual cae en uno de sus
  intervalos. La disponibilidad se deriva; no se guarda como un segundo estado.
- **D5 — Recuperación del propietario.** El propietario siempre conserva el
  envío y la administración. Su cuenta no puede suspenderse ni quedar bloqueada
  por horario desde esta superficie.
- **D6 — Servidor como autoridad.** Las cuatro entradas humanas (texto y
  mensajes estructurados, adjuntos, plantilla en un hilo e inicio con
  plantilla desde Contactos) ejecutan la misma guarda antes de producir efectos.
  La interfaz también deshabilita el envío y explica el motivo.
- **D7 — Solo propietario modifica.** Leer la disponibilidad propia sigue
  permitido a cualquier sesión; crear cuentas y cambiar estado/horario exige
  rol `owner`. `admin` no basta.
- **D8 — Auditoría append-only.** Cada alta y cada cambio de estado u horario
  registra actor, miembro objetivo, acción, valores anterior/nuevo y fecha.

## Alcance

**Entra**:

- Horario semanal por miembro con múltiples intervalos diarios y cruce de
  medianoche.
- Estado `enabled` / `suspended` y disponibilidad calculada.
- Panel de propietario en Ajustes > Equipo para editar y ver el estado actual.
- Bloqueo de todos los envíos humanos en API e interfaz.
- Auditoría de altas y cambios.
- Migración Drizzle aditiva y pruebas automatizadas de política, horario y
  cobertura de rutas de envío.

**Fuera de alcance**:

- Bot nocturno y cualquier automatización de 22:00 a 06:00.
- Asignación automática o manual de conversaciones.
- Conexión de Meta, números reales o cambios a los datos demo.
- Calendarios excepcionales, feriados, ausencias, zonas horarias por miembro o
  más roles.

## Comportamiento observable

### Historia 1 — El propietario configura el equipo (P1)

- **AC1** Ajustes > Equipo muestra al menos cinco cuentas sin degradar diseño ni
  rendimiento, con estado administrativo, disponibilidad actual y horario.
- **AC2** El propietario puede guardar varios intervalos por día, incluidos
  `22:00–06:00`, y al recargar ve exactamente la configuración guardada.
- **AC3** Un miembro o admin que intente modificar por API recibe 403 y no se
  escribe ni configuración ni auditoría.
- **AC4** La cuenta propietaria no ofrece control para suspenderse y mantiene
  acceso administrativo.

### Historia 2 — Disponibilidad derivada (P1)

- **AC5** Un miembro habilitado dentro de un intervalo figura disponible.
- **AC6** Fuera de todos sus intervalos figura fuera de turno.
- **AC7** En un turno `22:00–06:00`, está disponible el día de inicio después de
  las 22:00 y el día siguiente antes de las 06:00; a las 06:00 deja de estarlo.
- **AC8** Un miembro suspendido nunca figura disponible, aun dentro de turno.

### Historia 3 — Envío protegido (P1)

- **AC9** Un miembro suspendido recibe 403 tipado al intentar texto, ubicación,
  contacto, adjunto o plantilla; no se llama al transporte ni se persiste un
  mensaje.
- **AC10** Un miembro habilitado fuera de turno recibe 403 tipado en las mismas
  rutas.
- **AC11** Dentro de turno, el flujo existente se conserva sin cambios.
- **AC12** El propietario puede enviar siempre para recuperar u operar la
  instancia.
- **AC13** La UI sustituye los controles de envío por un aviso claro mientras
  la cuenta esté suspendida o fuera de turno; el servidor sigue rechazando una
  llamada directa o una UI desactualizada.

### Historia 4 — Auditoría y actualización (P1)

- **AC14** Cada cambio exitoso registra quién, a quién, qué cambió, antes,
  después y cuándo, siempre dentro de la organización.
- **AC15** Una instalación 1.5.1 actualiza sin borrar datos; los miembros
  existentes quedan habilitados con horario `06:00–22:00` en
  `America/Bogota`.

## Constitution Check

| Principio | Evaluación |
|---|---|
| I · Seguridad | Consultas por `organization_id`; la auditoría no guarda secretos. La guarda corre antes del envío. |
| II · Soberanía | Sin servicios ni dependencias nuevas; cálculo local con `Intl`. |
| III · Multi-tenancy | Configuración y auditoría llevan organización; las mutaciones validan pertenencia del objetivo. |
| IV · Idempotencia | No se introducen eventos externos. Cada `PATCH` exitoso crea un evento deliberado de auditoría. |
| V · Hecho | Tipos, lint, unitarias, build y recorrido funcional local. |
| VI · Specs | Ciclo completo antes de código por cambio de modelo. |
| VII · Trazabilidad | Las decisiones D1–D8 y exclusiones quedan explícitas. |
| VIII · Foco | Controla quién puede atender conversaciones del negocio. |
| IX · En vivo | Se verificará UI y API local con cuentas owner/member y reloj inyectable en pruebas. |

Sin violaciones.
