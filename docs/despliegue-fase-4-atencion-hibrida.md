# Despliegue seguro — Fase 4 de atención híbrida

La Fase 4 añade la migración `0021_atencion_hibrida_nocturna.sql`. Es aditiva:
incorpora tres columnas de horario en `organization` y dos columnas de
intervención en `conversation`; no elimina ni reescribe mensajes o asignaciones.

## Antes de desplegar

1. Crear un respaldo lógico de `nexora_crm` y comprobar su restauración en una
   base temporal distinta. No usar «Restaurar» de EasyPanel si no permite elegir
   el destino.
2. Confirmar que el respaldo probado corresponde al instante esperado y guardar
   fuera del contenedor su checksum, tamaño y fecha.
3. En la base temporal, registrar:

   ```sql
   select count(*) from conversation;
   select count(*) from message;
   select count(*) from conversation_assignment_event;
   ```

4. Verificar que la rama/imagen a desplegar contiene `drizzle/0021_*.sql` y
   `drizzle/meta/_journal.json`.

## Aplicación

El contenedor ejecuta `scripts/migrate.mjs` durante su arranque antes de iniciar
Next.js. No se debe ejecutar el SQL manualmente ni lanzar dos despliegues en
paralelo. La migración usa el journal de Drizzle y queda registrada en
`drizzle.__drizzle_migrations`.

Después del respaldo verificado, desplegar una sola réplica o asegurar que el
arranque serializado de la plataforma evita dos migradores simultáneos. No
modificar credenciales, webhooks ni volúmenes como parte de este cambio.

## Verificación posterior en EasyPanel

Abrir Postgres Client contra `nexora_crm` y ejecutar únicamente consultas de
lectura:

```sql
select column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('organization', 'conversation')
  and column_name in (
    'ai_schedule_start_minute',
    'ai_schedule_end_minute',
    'ai_schedule_time_zone',
    'human_intervention_at',
    'human_intervention_by_member_id'
  )
order by table_name, column_name;

select ai_schedule_start_minute,
       ai_schedule_end_minute,
       ai_schedule_time_zone
from organization;
```

El resultado esperado para organizaciones existentes es `1320`, `360` y
`America/Bogota`. Luego comprobar `/api/health`, entrar a Ajustes → IA y guardar
el horario deseado. Para Nexora, confirmar también en Ajustes → Equipo que la
modalidad sigue en `manual`; la migración no la cambia.

## Reversión

Si el arranque o la verificación falla, conservar logs y no editar el journal a
mano. Volver a la imagen anterior solo es seguro si esa versión tolera columnas
adicionales, como ocurre aquí. Si se necesita restaurar datos, crear primero una
base nueva desde el respaldo probado y validar conteos; cualquier reemplazo de
`nexora_crm` requiere una ventana aprobada y no forma parte de este procedimiento.
