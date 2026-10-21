# E2E — Tasas de cambio

Arnés: `scripts/e2e-tasas-cambio.mjs`.

## Preparación aislada

1. Crear PostgreSQL 16 desechable; nunca usar `nexora_import_20261019`.
2. Aplicar migraciones hasta 0021, arrancar la app con `REGISTRATION_MODE=bootstrap`,
   `TASAS=on`, `WA_MOCK_ENABLED=true` y URLs de WhatsApp/IA apuntando a mocks.
3. Aplicar 0023 con `pnpm db:migrate`, ejecutar `pnpm test:integration:tasas` y después `pnpm test:e2e:tasas`.

## Evidencias esperadas

- El owner activa el módulo por API autenticada.
- Se guarda un borrador y no aparece como vigente.
- Tras publicar, GET y la pantalla real muestran unidades, ruta y vigencia.
- Un decimal negativo recibe 422.
- Publicación solapada recibe 409 y conserva la versión anterior.
- Con `TASAS` apagado, API y página responden 404.
- No hay llamadas a Meta ni al proveedor LLM.

Permisos supervisor/member, aislamiento entre organizaciones, cálculo, rutas
inversas, ambigüedad y protecciones financieras se cubren además en Vitest. La
actualización 0021→0022 se verifica sobre una copia desechable con conteos antes y
después de `organization`, `member`, `conversation`, `message` y `media_asset`.
