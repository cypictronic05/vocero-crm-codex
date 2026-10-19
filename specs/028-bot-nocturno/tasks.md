# Tareas — 028 Bot nocturno

- [x] Especificar ventana, bordes, modos y contrato antes del código.
- [x] Implementar política pura `22:00–06:00` en `America/Bogota`.
- [x] Filtrar y revalidar el agente incluido.
- [x] Filtrar y revalidar el despacho a cerebro externo.
- [x] Proteger `POST /api/bot/messages` frente a respuestas diurnas.
- [x] Añadir pruebas unitarias y guion E2E sin Meta real.
- [x] Ejecutar tipos, lint, pruebas y build; corregir hasta verde.

## Verificación ejecutada

- Política horaria y ruta pública: 6 pruebas focalizadas en verde.
- Suite completa final: 96 archivos y 1.055 pruebas en verde.
- `pnpm typecheck`, `pnpm lint` y `pnpm build`: verdes.
- Migraciones `0000–0019` e integración de asignaciones: verdes sobre
  PostgreSQL 16 temporal en `tmpfs`; el contenedor se retiró al terminar.
- Sin conexión a Meta/WhatsApp real, sin publicación y sin modificar
  contenedores o volúmenes existentes.
