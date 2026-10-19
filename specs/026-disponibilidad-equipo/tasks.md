# Tasks — 026 Disponibilidad y turnos del equipo

## Diseño y datos

- [x] T001 Spec, plan, modelo y puerta constitucional antes del código
- [x] T002 Extender `member` y añadir `team_audit_event`
- [x] T003 Generar y revisar migración Drizzle aditiva

## Dominio y API

- [x] T004 Evaluación pura de horario en `America/Bogota`, incluido cruce de medianoche
- [x] T005 Servicio tenant-scoped y auditoría transaccional
- [x] T006 API owner-only para actualizar estado/horario
- [x] T007 API de disponibilidad propia
- [x] T008 Guarda central en las cuatro entradas de envío humano

## Interfaz

- [x] T009 Panel de propietario en Ajustes > Equipo
- [x] T010 Deshabilitar compositor, plantillas e inicio de conversación con motivo

## Pruebas y cierre

- [x] T011 Pruebas automatizadas de autorización, horario y cobertura de rutas
- [x] T012 Migración, typecheck, lint, test y build
- [ ] T013 Verificación funcional local sin Meta real
- [x] T014 Documentar archivos, migración, pruebas y reconstrucción Docker

T013 queda parcialmente verificada: Docker, salud, migración y login cargan; el
recorrido autenticado requiere las credenciales locales del propietario y del
miembro, que no se guardan en el repositorio. No se restablecieron contraseñas
ni se fabricaron sesiones para evitar alterar cuentas existentes.
