# Especificación: atención híbrida nocturna

**Rama**: `feature/nexora-turnos`

**Creada**: 2026-10-21

**Estado**: implementada y validada con PostgreSQL 16 aislado.

**Carril**: ciclo completo. Añade configuración por organización, estado de
intervención humana y datos aditivos al contrato público `/api/bot/*`.

## Problema

El bot nocturno se detiene en cuanto existe un handoff, aunque el equipo humano
no esté trabajando, y la supervisora hereda el horario de una operadora. Esto
deja conversaciones sin respuesta durante la noche y no distingue una solicitud
pendiente de la intervención real de una persona.

## Comportamiento observable

- Cada organización configura una ventana diaria de IA mediante hora inicial,
  hora final y zona IANA. El valor inicial conserva `22:00–06:00` en
  `America/Bogota` y admite ventanas que cruzan medianoche.
- Fuera de esa ventana la IA no inicia ni entrega respuestas ordinarias.
- Una solicitud de atención humana se conserva como pendiente. Si fue pedida
  por el cliente, la IA puede seguir contestando información general durante
  su horario mientras ninguna persona haya intervenido.
- La solicitud no cambia de fecha ni genera un nuevo escalamiento por cada
  mensaje posterior.
- Una respuesta humana confirmada marca atención en curso y pausa la IA. La
  asignación por sí sola no cambia el estado de IA.
- Owner y supervisor conservan visibilidad completa. Supervisor puede responder
  a cualquier hora únicamente cuando la conversación está asignada a su propio
  `memberId`; member conserva su horario configurado.
- Los handoffs por error, ventana, validación financiera, comprobante o decisión
  del modelo siguen requiriendo atención humana y no habilitan respuestas de IA.
- Validar pagos, transferencias, comprobantes, disponibilidad u operaciones se
  bloquea en servidor antes del LLM. Una consulta de tasa solo puede llegar al
  modelo si el knowledge base de la organización contiene una entrada de tasa
  actualizada ese mismo día local; de lo contrario se deriva a revisión humana.
- La Bandeja muestra estados diferenciados: IA nocturna activa, atención humana
  pendiente, atención humana en curso e IA pausada por intervención humana.

## Criterios de aceptación

1. La ventana predeterminada incluye 22:00 y 03:00, y excluye 06:00 y 10:00,
   evaluadas en `America/Bogota`.
2. Una zona IANA inválida o una ventana de duración cero se rechazan con 422.
3. Los cálculos no dependen del huso del proceso ni de PostgreSQL.
4. Un handoff del cliente no bloquea respuestas informativas nocturnas posteriores.
5. La fecha y motivo del primer handoff se conservan de forma idempotente.
6. Una respuesta humana exitosa pausa la IA antes de liberar el lock; un envío
   humano fallido no declara una intervención inexistente.
7. El mismo advisory lock impide que una respuesta humana y una automática se
   entreguen simultáneamente.
8. Supervisor habilitada responde 24/7 solo a conversaciones propias; member
   fuera de turno recibe 403.
9. La asignación manual no enciende ni apaga IA y no distribuye conversaciones
   automáticamente.
10. Imágenes y documentos, pagos, tasas u operaciones que requieren validación
    se derivan a revisión humana y nunca se confirman automáticamente.
    Una tasa autorizada y actualizada el mismo día sí puede informarse desde el
    knowledge base, sin inventar valores.
11. Todas las lecturas y escrituras nuevas están acotadas por `organization_id`.
12. SSE sigue notificando cada transición comprometida y la UI hace refetch.

## Fuera de alcance

- Modificar datos o credenciales de producción.
- Cambiar webhooks, Meta, OpenAI, contenedores o volúmenes.
- Conceder a supervisor permisos de configuración técnica.
- Asignar automáticamente operadoras en organizaciones configuradas en modo manual.
- Desplegar o ejecutar migraciones en esta fase de implementación.

## Constitution Check

| Principio | Evaluación |
|---|---|
| I · Seguridad | Sin secretos; tenant scope obligatorio y locks compartidos para evitar doble respuesta. |
| II · Soberanía | Usa `Intl` y PostgreSQL existentes; no añade dependencias ni servicios. |
| III · Multi-tenancy | Configuración y estados llevan organización; pruebas cubren aislamiento. |
| IV · Idempotencia | Handoff conserva la primera transición; mensajes mantienen deduplicación existente. |
| V · Hecho | TypeScript, ESLint, Vitest, build y flujo E2E local con mocks. |
| VI · Specs | Ciclo completo antes del código por migración y contrato público. |
| VII · Trazabilidad | Se separan solicitud e intervención y se documentan defaults y restricciones. |
| VIII · Foco | Continuidad operativa de conversaciones de WhatsApp. |
| IX · En vivo | Se verificará API/UI con mocks, sin Meta real ni producción. |

Sin violaciones conocidas.
