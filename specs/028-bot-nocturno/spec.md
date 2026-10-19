# Especificación: bot nocturno de Nexora

**Rama**: `feature/nexora-turnos`

**Creada**: 2026-10-18

**Estado**: especificada antes de escribir código.

**Carril**: ciclo completo. No cambia el modelo de datos, pero amplía el
contrato publicado `POST /api/bot/messages` con el error tipado
`outside_bot_shift`. Plan en [plan.md](plan.md) y tareas en [tasks.md](tasks.md).

## Problema

Nexora Remesas entrega las conversaciones a personas de 06:00 a 22:00. Fuera
de ese horario las conversaciones quedan correctamente en cola, pero el agente
de IA conserva hoy la posibilidad de responder a cualquier hora. Hace falta
un relevo horario explícito: personas durante el día y bot durante la noche.

## Decisiones

- La ventana nocturna es fija: `22:00` incluido a `06:00` excluido, siempre en
  `America/Bogota`, sin depender del huso del navegador, host o PostgreSQL.
- La política cubre los dos modos mutuamente excluyentes del producto: agente
  incluido y cerebro externo por despacho.
- Solo los mensajes entrantes reales se filtran. El Laboratorio conserva sus
  turnos a cualquier hora y nunca llega a WhatsApp real.
- La hora se valida al disparar y otra vez antes de actuar. Un debounce,
  reintento o respuesta externa que cruza las 06:00 no puede enviar.
- Fuera de horario no se altera el mensaje, la conversación, el handoff ni la
  configuración de IA. El mensaje permanece en PostgreSQL y la asignación de
  la fase 2 lo entrega a una trabajadora disponible.
- Un despacho pendiente que vence fuera de horario se descarta sin marcar una
  caída del cerebro ni pausar la conversación.
- `POST /api/bot/messages` responde `409 outside_bot_shift` fuera de la ventana
  para proteger también cerebros que consumen webhooks por su cuenta.

## Criterios de aceptación

1. A las 22:00:00 de Bogotá el bot puede atender; a las 05:59:59 también.
2. A las 06:00:00 y durante el horario diurno el bot no se dispara ni envía.
3. La evaluación produce el mismo resultado aunque el proceso corra en otro
   huso horario.
4. El agente incluido revalida la ventana antes de ejecutar la acción del LLM.
5. El despachador externo revalida antes del POST y descarta limpiamente lo que
   haya vencido de día.
6. La API de mensajes del bot rechaza respuestas tardías con 409 tipado y no
   llama al transporte.
7. El Laboratorio sigue ejecutando conversaciones de prueba fuera de horario.
8. La asignación existente deja los casos nocturnos en cola y los reparte a
   personas al comenzar el turno, sin borrar mensajes ni datos.

## Fuera de alcance

- Conectar WhatsApp real o cambiar credenciales.
- Configuración de horario por organización o desde la UI.
- Mensajes proactivos al abrir o cerrar la ventana.
- Cambios a los turnos humanos, al algoritmo de asignación o a PostgreSQL.

## Constitution Check

| Principio | Evaluación |
|---|---|
| I · Seguridad | No añade secretos; conserva tenant scope y todas las guardas de envío. |
| II · Soberanía | Cálculo local con `Intl`; sin servicios ni dependencias nuevas. |
| III · Multi-tenancy | No añade estado global por tenant ni consultas sin organización. |
| IV · Idempotencia | No altera la ingesta; el descarte del outbox conserva su transición condicionada por lease. |
| V · Hecho | Tipos, lint, unitarias, build y prueba funcional sin Meta real. |
| VI · Specs | Ciclo completo antes del código por cambio al contrato del bot. |
| VII · Trazabilidad | Ventana, bordes, modos cubiertos y exclusiones quedan explícitos. |
| VIII · Foco | Da continuidad nocturna a conversaciones y leads de WhatsApp. |
| IX · En vivo | Se ejercitará la ruta pública con mock y horas inyectables; nunca WhatsApp real. |

Sin violaciones.
