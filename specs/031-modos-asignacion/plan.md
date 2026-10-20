# Plan de implementación

1. Añadir `organization.assignment_mode` mediante migración Drizzle aditiva con
   `automatic` como valor predeterminado.
2. Centralizar el tipo, validación y decisión manual/automática.
3. Leer la política dentro del lock de asignación y excluir organizaciones manuales
   del worker, conservando asignaciones explícitas.
4. Implementar lectura y actualización owner-only en Ajustes → Equipo.
5. Añadir selector de política y filtro de cola sin asignar.
6. Cubrir permisos, aislamiento, relevos, concurrencia, IA, SSE y regresión automática.
7. Documentar respaldo, aplicación, activación para Nexora y reversión lógica.

## Riesgos y mitigaciones

- Cambio de modo concurrente con un reparto: ambos usan el mismo advisory lock.
- Envío concurrente con fin de turno: conserva el lock por conversación existente.
- Instalaciones antiguas: el default `automatic` evita cambios de comportamiento.
- Reversión: volver a `automatic`; no se elimina la columna durante una incidencia.

