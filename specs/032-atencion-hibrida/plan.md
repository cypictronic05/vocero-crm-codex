# Plan de implementación: atención híbrida nocturna

## Diseño

1. Añadir a `organization` inicio, fin y zona IANA del horario de IA, con
   defaults compatibles, y a `conversation` la intervención humana efectiva.
2. Reemplazar la política fija por funciones puras que acepten configuración y
   resuelvan ventanas cruzadas con `Intl`.
3. Centralizar la elegibilidad de IA y usarla en agente incluido, despacho,
   recuperación, typing y `/api/bot/messages`.
4. Compartir el advisory lock `conversation:<id>` entre envíos humanos y de IA.
   La intervención se registra solo después de un envío humano exitoso y antes
   de liberar el lock.
5. Hacer idempotente el handoff pendiente y permitir continuidad solo para el
   motivo `cliente`; los motivos de seguridad siguen bloqueando.
6. Exponer la configuración en Ajustes → IA con permiso `AI_CONFIGURE` y agregar
   los estados de atención a la Bandeja, conservando SSE por refetch.
7. Dar disponibilidad 24/7 a supervisor sin cambiar permisos ni la regla de
   conversación propia.
8. Generar una migración Drizzle aditiva y documentar respaldo, aplicación y
   verificación sin ejecutarla en producción.

## Riesgos y mitigaciones

- **Carrera humano/IA**: advisory lock compartido y revalidación dentro del lock.
- **DST/zona inválida**: zona validada por `Intl`; bordes calculados desde hora
  de pared, no mediante offsets fijos.
- **Repetición de handoff**: actualización condicionada a `handoff_at is null`.
- **Falsa intervención**: se persiste únicamente tras confirmar el envío humano.
- **Instalaciones existentes**: columnas `NOT NULL` con defaults equivalentes al
  comportamiento actual; ninguna fila se borra ni reescribe.

## Verificación

- Unitarias de bordes horarios, cruce de medianoche, permisos, estados y carrera.
- Guardarraíles de aislamiento, modo manual, comprobantes y contrato del bot.
- TypeScript, ESLint, Vitest completo y build de producción.
- Self-test local con mocks cuando el arnés permita ejercer el flujo sin Meta.

## Constitution Check posterior al diseño

El modelo es aditivo, conserva tenant scope, no añade dependencias, mantiene la
ventana de WhatsApp y coordina todos los emisores con la misma exclusión mutua.
Sin violaciones.
