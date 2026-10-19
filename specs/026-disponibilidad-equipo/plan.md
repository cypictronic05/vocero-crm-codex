# Implementation Plan: Disponibilidad y turnos del equipo

**Branch**: `feature/nexora-turnos` | **Spec**: [spec.md](spec.md)

## Summary

Extender la membresía con estado administrativo y horario semanal JSONB,
añadir una bitácora append-only, centralizar la evaluación horaria en
`America/Bogota` y exigirla en cada endpoint de envío humano. Ajustes > Equipo
se convierte en el panel de configuración del propietario y las superficies de
envío consumen una consulta de disponibilidad propia para deshabilitarse.

## Technical Context

- Next.js 15, React 19, TypeScript estricto, Drizzle/PostgreSQL y Vitest.
- Sin dependencias nuevas.
- Intervalos representados como minutos desde medianoche, con fin exclusivo.
- `Intl.DateTimeFormat(..., { timeZone: "America/Bogota" })` produce día y
  minuto locales de una fecha UTC; así no depende del huso del host.

## Diseño

1. `member` gana `status` y `weekly_schedule`, ambos `NOT NULL` con defaults
   compatibles (`enabled`, siete días `06:00–22:00`).
2. `team_audit_event` registra eventos append-only, con `organization_id`,
   actor, objetivo, acción, instantáneas JSONB y fecha.
3. `src/server/team/availability.ts` contiene validación, normalización y
   evaluación pura de horarios, más la consulta de disponibilidad de la sesión
   y una `OperatorAvailabilityError` tipada.
4. `src/server/team/service.ts` concentra listado, actualización transaccional
   con auditoría y alta auditada. La ruta solo exporta handlers.
5. `PATCH /api/settings/team/[memberId]` acepta estado y horario, valida owner,
   pertenencia al tenant e impide modificar al propietario.
6. `GET /api/team/availability` devuelve exclusivamente la capacidad actual de
   la sesión y el siguiente motivo; no expone configuración de terceros.
7. Las rutas humanas llaman `assertOperatorCanSend` antes de parsear/subir o
   crear conversaciones. El bot y el agente IA no usan esta política.
8. Un hook cliente consulta disponibilidad al montar y cada minuto. Composer,
   plantillas e inicio de conversación quedan deshabilitados con explicación.
9. Ajustes > Equipo permite añadir/quitar intervalos por día y suspender o
   habilitar miembros no propietarios.

## Migración

Generada con `pnpm db:generate`. Solo `ALTER TABLE ... ADD COLUMN` y
`CREATE TABLE`; ningún `DELETE`, `DROP`, truncado ni actualización de filas de
demostración.

## Verificación

- Unitarias de límites, cruce de medianoche, suspensión y owner bypass.
- Unitarias de autorización owner-only y guardarraíl que escanea las cuatro
  rutas humanas.
- Gates: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Migración con el migrador del proyecto.
- Verificación local de Ajustes > Equipo y rechazo/permiso de envío con cuentas
  owner y member. No se conecta Meta real.

## Constitution Check posterior al diseño

Se mantiene el resultado del spec: consultas tenant-scoped, migración aditiva,
sin secretos ni dependencias externas, una única guarda de envío y auditoría
append-only. No hay violaciones.
