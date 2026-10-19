# Guion E2E — US7: Multi-usuario mínimo

> Conducido con Playwright (MCP) contra `pnpm dev` (org ya creada).

1. **Registro cerrado (FR-060)**: con `REGISTRATION_MODE=closed`, POST público
   a sign-up devuelve 403 incluso si no hay organizaciones; `/register` no
   presenta formulario.
2. **Bootstrap controlado**: `REGISTRATION_MODE=bootstrap` admite el primer
   owner únicamente con cero organizaciones y se cierra después. Producción
   permanece en `closed` y usa el comando de aprovisionamiento por consola.
3. **Cuenta de equipo (FR-061)**: el owner crea una cuenta desde
   Configuración → Equipo (email + contraseña temporal mostrada una vez).
   ✅ El nuevo miembro puede iniciar sesión y ve la bandeja de la organización.
   ✅ Un miembro (no owner) NO puede crear cuentas (403).
4. **Rate limit (FR-062)**: >10 logins fallidos desde la misma IP en 10 min.
   ✅ 429 "Demasiados intentos".
5. **Aislamiento**: un owner de `org_a` no puede enviar `org_b` para crear o
   listar trabajadoras; el servidor usa siempre la organización de la sesión.
