# Modos de asignación de conversaciones

## Despliegue seguro

1. Crear un respaldo verificable de PostgreSQL desde EasyPanel antes de actualizar.
2. Publicar la versión autorizada de la rama y revisar el log del migrador al iniciar.
3. Confirmar que la migración 0020_careless_starbolt.sql terminó correctamente.
4. Entrar como propietario en **Ajustes → Equipo**.
5. En **Distribución de conversaciones**, elegir **Manual** para Nexora.
6. Enviar un mensaje de prueba al número oficial y confirmar que aparece en
   **Sin asignar** para propietario/supervisora, pero no para una operadora.
7. Asignarlo a una operadora y confirmar que aparece por SSE sin recargar.

La migración no debe ejecutarse manualmente desde esta fase ni contra producción
sin respaldo y autorización de despliegue.

## Reversión

La reversión operativa es seleccionar **Automática**. El sistema retomará la cola
con el algoritmo de carga, horario y disponibilidad. No se debe eliminar la columna
durante una incidencia: conservarla permite volver a desplegar la versión nueva y
una versión anterior simplemente la ignora.

Si la aplicación no inicia después de actualizar, restaurar la imagen anterior.
La columna añadida es compatible y no modifica conversaciones, mensajes ni su
historial. Restaurar el respaldo de PostgreSQL solo si la plataforma confirma una
falla de datos independiente de esta migración.

