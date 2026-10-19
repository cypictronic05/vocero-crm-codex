# Especificación: asignación de conversaciones

## Alcance

- Cada conversación puede estar asignada a un miembro del equipo o permanecer en cola.
- Las conversaciones nuevas se asignan a la trabajadora habilitada, dentro de turno y con menor carga activa.
- El propietario puede asignar, reasignar o devolver una conversación a la cola.
- Una trabajadora solo puede listar, consultar, modificar y responder conversaciones que tenga asignadas, incluidos mensajes, eventos y adjuntos.
- El propietario conserva acceso global y capacidad de recuperación.
- La suspensión o fin de turno provoca un relevo transaccional hacia otra trabajadora disponible o hacia la cola.
- Cada cambio de responsable queda en un historial inmutable.

## Reglas

- La disponibilidad se calcula exclusivamente en `America/Bogota` con los horarios de la fase 1.
- Solo miembros con rol `member`, estado `enabled` y dentro de turno participan en la asignación automática.
- La carga es la cantidad de conversaciones reales asignadas cuyo lead está abierto (o todavía no tiene lead).
- Los empates se resuelven por fecha de incorporación y luego por identificador para obtener resultados deterministas.
- Las conversaciones de laboratorio (`is_test`) no participan en asignación ni carga automática.
- Si no existen candidatas disponibles, la conversación queda sin asignar y los mensajes se conservan.
- El propietario puede asignar manualmente solo a miembros habilitados y disponibles.
- La autorización se vuelve a comprobar en servidor al enviar. El relevo y el envío comparten un bloqueo de base de datos para impedir respuestas concurrentes del responsable anterior.

## Fuera de alcance

- Integración con Meta o números reales.
- Bot nocturno.
- Cambios al pipeline, contactos, laboratorio de IA o asignación por especialidad.

## Criterios de aceptación

1. Dos procesos concurrentes no pueden producir responsables o entradas de historial contradictorias.
2. Un miembro no puede acceder a una conversación ajena cambiando URL, parámetros, cuerpo o identificador de adjunto.
3. Los eventos en tiempo real de conversaciones ajenas no se entregan a miembros.
4. Al suspender o finalizar turno, cada conversación activa se entrega una vez a otra persona disponible o vuelve a cola.
5. El propietario puede ver todo y recuperar casos en cola.
6. La migración es aditiva y conserva las conversaciones existentes.
