# Especificación: modos de asignación por organización

## Problema

Una organización necesita decidir si las conversaciones humanas se distribuyen
automáticamente por carga y disponibilidad o si permanecen en una cola hasta que
un propietario o supervisor las asigne.

## Comportamiento observable

- Cada organización tiene un modo `automatic` o `manual`; instalaciones existentes
  conservan `automatic` al actualizar.
- Solo el propietario puede cambiar el modo desde Ajustes → Equipo.
- En modo manual, una conversación nueva o ya devuelta a cola permanece sin
  responsable. Una asignación válida existente se conserva.
- La suspensión o fin de turno revoca el envío y devuelve los hilos de esa persona
  a cola en modo manual; en automático conserva el relevo por carga existente.
- Propietario y supervisora ven y filtran la cola. Una operadora solo ve y responde
  sus conversaciones asignadas.
- Las asignaciones explícitas funcionan en ambos modos y se notifican por SSE sin
  recargar la bandeja.
- El agente de IA puede responder según su configuración sin asignar por ello a una
  operadora en modo manual.

## Criterios de aceptación

1. El modo se lee y cambia con aislamiento estricto por `organization_id`.
2. Sin sesión se responde 401; supervisor y member reciben 403 al modificarlo.
3. Un cambio de modo no modifica mensajes, historial ni responsables existentes.
4. Los locks, `assignmentVersion` y la auditoría de asignaciones siguen vigentes.
5. El worker nunca asigna ni releva automáticamente una organización manual.
6. Cambiar de manual a automático permite que el barrido periódico retome la cola.
7. La migración solo añade la columna con default `automatic` y no toca datos de
   conversaciones.

## Fuera de alcance

- Ejecutar la migración o modificar datos de producción.
- Cambiar credenciales, webhooks, el número oficial o la infraestructura.
- Crear nuevos roles o permitir que supervisora modifique políticas globales.

## Constitution Check

- Datos: columna aditiva con default seguro y consultas acotadas por organización.
- Soberanía: no añade dependencias ni servicios externos.
- Idempotencia: no cambia la deduplicación de mensajes.
- Verificación: pruebas de permisos, decisiones de reparto, SSE, migración y gates.

