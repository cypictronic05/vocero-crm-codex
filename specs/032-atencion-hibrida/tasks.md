# Tareas: atención híbrida nocturna

- [x] Modelo y migración aditiva.
- [x] Política horaria configurable por organización.
- [x] Estado pendiente frente a intervención humana efectiva.
- [x] Lock compartido y revalidación de envíos automáticos.
- [x] Supervisor 24/7 sin permisos adicionales.
- [x] Ajustes → IA y avisos de Bandeja.
- [x] Seguridad financiera y comprobantes.
- [x] Pruebas unitarias, contrato y aislamiento.
- [x] TypeScript, ESLint, Vitest y build.
- [x] Documento de despliegue seguro.
- [x] Migración limpia y actualización 0020 → 0021 en PostgreSQL 16 aislado.
- [x] E2E real con mocks de WhatsApp/IA y prueba visual en Chrome local.

El arnés `scripts/e2e-atencion-hibrida.ts` aprobó 43 comprobaciones sobre un
clúster PostgreSQL 16 temporal: fronteras horarias, handoff pendiente,
intervención, concurrencia, permisos, SSE, asignación manual, aislamiento,
seguridad financiera y estados visibles en navegador. No se reutilizó ni
modificó ninguna base existente.
