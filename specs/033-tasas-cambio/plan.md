# Implementation Plan: Tasas de cambio

**Branch**: `feature/nexora-turnos` | **Date**: 2026-10-21 | **Spec**: `spec.md`

## Resumen

Módulo opcional `TASAS=on`, activado además por organización, con rutas y
cotizaciones versionadas, capacidad explícita para supervisoras, APIs/UI e
intercepción previa al LLM que consulta únicamente PostgreSQL.

## Contexto y estructura

- Next.js 15, React 19, TypeScript estricto, Zod, Tailwind.
- PostgreSQL 16 + Drizzle; migración aditiva posterior a 0021.
- Código de dominio en `src/server/exchange-rates/`, APIs internas en
  `src/app/api/exchange-rates/`, UI en `src/app/(app)/exchange-rates/`.
- Sin dependencias nuevas ni cambios incompatibles en contratos públicos.

## Diseño

1. `organization.exchange_rates_enabled` y bandera de despliegue `TASAS`.
2. `member.can_manage_exchange_rates` como concesión explícita.
3. Ruta direccional; cotización con versión, decimal exacto, precisión y vigencia.
4. Auditoría y solicitudes pendientes append-only.
5. Publicación inmutable; una modificación crea borrador nuevo.
6. Resolver conversacional determinista antes del LLM; seguridad transaccional
   y horarios de Fase 4 permanecen sin cambios.
7. Corrección 5A.1: migración 0023 aditiva con operación/precisión nullable en
   rutas y operación nullable en cotizaciones; no hace backfill.
8. El owner configura fórmula/precisión una vez. El supervisor autorizado crea
   versiones solo con ruta, tasa y vigencia; el servidor deriva unidades.
9. La cotización copia la fórmula para que historial e IA no dependan de una
   reinterpretación posterior. La UI muestra una vista previa exacta antes de
   publicar.
10. Fase 5A.5: catálogo fijo de ocho países con habilitación por organización,
    matriz direccional, previsualización de activación masiva e idempotencia.
11. Los corredores masivos nacen activos para selección administrativa pero sin
    operación, precisión ni tasa; no pueden calcular ni responder hasta completar
    la configuración comercial y publicar una cotización.

## Migración y verificación

Generar con `pnpm db:generate`, revisar SQL aditivo y probar sobre PostgreSQL
aislado tanto 0000→0024 como 0000→0023 con datos y luego 0024. Verificar que
0024 solo agrega el catálogo y no altera rutas/cotizaciones existentes. Ejecutar unitarias, E2E local con mocks,
tipos, lint y build.

## Constitución (antes y después del diseño)

Pasa I–IX: aislamiento org-first con `scoped()`, sin terceros, especificación
previa, contratos compatibles y verificación viva. La bandera evita mostrar el
vertical en otras instalaciones; la columna controla cada organización.
