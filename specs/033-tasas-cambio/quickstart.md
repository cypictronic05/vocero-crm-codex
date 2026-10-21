# Verificación local — tasas de cambio

1. Use una base PostgreSQL desechable con migraciones hasta 0021.
2. Configure `TASAS=on`, mocks y una organización de prueba.
3. Aplique 0022 y ejecute el arnés de tasas.
4. Repita con otra organización y confirme que IDs ajenos producen 404.
5. Ejecute `pnpm typecheck`, `pnpm lint`, `pnpm test` y `pnpm build`.

No usa Meta, proveedor LLM ni la base de EasyPanel.
