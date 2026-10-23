import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import type { SessionContext } from "@/lib/auth/session";
import { calculateConversion } from "@/server/exchange-rates/decimal";
import { buildExchangeRatePresentation } from "@/server/exchange-rates/presentation";
import { operationMatchesCommercialRule } from "@/server/exchange-rates/rules";
import { REMITTANCE_COUNTRIES, remittanceCountry, remittanceRouteKey } from "@/server/exchange-rates/catalog";
import type { BulkExchangeRateRoutesInput, CalculateExchangeRateInput, ConfigureExchangeRateRouteInput, CreateExchangeRateInput, ExchangeRateSelectionInput, PreviewExchangeRateInput, UpdateExchangeRateCountryInput } from "@/server/exchange-rates/validation";

const PREVIEW_AMOUNT = "100000";

export class ExchangeRateError extends Error {
  constructor(public readonly code: "module_disabled" | "forbidden" | "not_found" | "invalid_rate" | "invalid_state" | "overlap" | "route_not_configured" | "formula_conflict", message: string) {
    super(message);
  }
}

export async function organizationRatesEnabled(organizationId: string): Promise<boolean> {
  const [row] = await getDb().select({ enabled: schema.organization.exchangeRatesEnabled })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId)).limit(1);
  return row?.enabled ?? false;
}

export function roleCanManageExchangeRates(role: string, explicitCapability: boolean): boolean {
  return role === "owner" || (role === "supervisor" && explicitCapability);
}

export async function canManageExchangeRates(session: SessionContext): Promise<boolean> {
  if (roleCanManageExchangeRates(session.role, false)) return true;
  if (session.role !== "supervisor") return false;
  const [row] = await getDb().select({ allowed: schema.member.canManageExchangeRates })
    .from(schema.member)
    .where(scoped(schema.member.organizationId, session.organizationId, eq(schema.member.id, session.memberId)))
    .limit(1);
  return roleCanManageExchangeRates(session.role, row?.allowed ?? false);
}

export async function requireRateManager(session: SessionContext): Promise<void> {
  if (!(await canManageExchangeRates(session))) {
    throw new ExchangeRateError("forbidden", "No tienes autorización para administrar tasas");
  }
}

async function countryStates(organizationId: string) {
  return getDb().select({
    countryCode: schema.exchangeRateCountry.countryCode,
    currencyCode: schema.exchangeRateCountry.currencyCode,
    enabled: schema.exchangeRateCountry.enabled,
  }).from(schema.exchangeRateCountry)
    .where(scoped(schema.exchangeRateCountry.organizationId, organizationId));
}

async function effectiveEnabledCountryCodes(organizationId: string): Promise<Set<string>> {
  const [states, legacyRoutes] = await Promise.all([
    countryStates(organizationId),
    getDb().select({
      originCountry: schema.exchangeRateRoute.originCountry,
      destinationCountry: schema.exchangeRateRoute.destinationCountry,
    }).from(schema.exchangeRateRoute).where(scoped(
      schema.exchangeRateRoute.organizationId,
      organizationId,
      eq(schema.exchangeRateRoute.active, true)
    )),
  ]);
  const decisions = new Map(states.map((state) => [state.countryCode, state.enabled]));
  const enabled = new Set(states.filter((state) => state.enabled).map((state) => state.countryCode));
  for (const route of legacyRoutes) {
    if (!decisions.has(route.originCountry)) enabled.add(route.originCountry);
    if (!decisions.has(route.destinationCountry)) enabled.add(route.destinationCountry);
  }
  return enabled;
}

export async function listExchangeRateCountries(organizationId: string) {
  const states = await countryStates(organizationId);
  const byCode = new Map(states.map((state) => [state.countryCode, state]));
  const effectiveEnabled = await effectiveEnabledCountryCodes(organizationId);
  return REMITTANCE_COUNTRIES.map((country) => ({
    ...country,
    enabled: byCode.get(country.code)?.enabled ?? effectiveEnabled.has(country.code),
  }));
}

export async function updateExchangeRateCountry(session: SessionContext, input: UpdateExchangeRateCountryInput) {
  if (session.role !== "owner") throw new ExchangeRateError("forbidden", "Solo el propietario habilita países");
  const country = remittanceCountry(input.countryCode);
  if (!country) throw new ExchangeRateError("not_found", "País fuera del catálogo de remesas");
  return getDb().transaction(async (tx) => {
    const now = new Date();
    const [row] = await tx.insert(schema.exchangeRateCountry).values({
      id: newId("exchangeRateCountry"), organizationId: session.organizationId,
      countryCode: country.code, currencyCode: country.currency,
      enabled: input.enabled, createdAt: now, updatedAt: now,
    }).onConflictDoUpdate({
      target: [schema.exchangeRateCountry.organizationId, schema.exchangeRateCountry.countryCode],
      set: { currencyCode: country.currency, enabled: input.enabled, updatedAt: now },
    }).returning();
    if (!row) throw new ExchangeRateError("invalid_state", "No se pudo actualizar el país");
    await tx.insert(schema.exchangeRateAuditEvent).values({
      id: newId("exchangeRateAuditEvent"), organizationId: session.organizationId,
      actorUserId: session.userId, action: "country_updated",
      after: { countryCode: country.code, currencyCode: country.currency, enabled: input.enabled },
    });
    return { ...country, enabled: row.enabled };
  });
}

export async function listExchangeRateRouteMatrix(organizationId: string) {
  return getDb().select({
    id: schema.exchangeRateRoute.id,
    originCountry: schema.exchangeRateRoute.originCountry,
    originCurrency: schema.exchangeRateRoute.originCurrency,
    destinationCountry: schema.exchangeRateRoute.destinationCountry,
    destinationCurrency: schema.exchangeRateRoute.destinationCurrency,
    calculationOperation: schema.exchangeRateRoute.calculationOperation,
    roundingPrecision: schema.exchangeRateRoute.roundingPrecision,
    active: schema.exchangeRateRoute.active,
  }).from(schema.exchangeRateRoute)
    .where(scoped(schema.exchangeRateRoute.organizationId, organizationId))
    .orderBy(asc(schema.exchangeRateRoute.originCountry), asc(schema.exchangeRateRoute.destinationCountry));
}

export async function bulkActivateExchangeRateRoutes(session: SessionContext, input: BulkExchangeRateRoutesInput) {
  if (session.role !== "owner") throw new ExchangeRateError("forbidden", "Solo el propietario activa corredores comerciales");
  const unique = [...new Map(input.routes.map((route) => [remittanceRouteKey(route.originCountry, route.destinationCountry), route])).values()];
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${session.organizationId}:exchange-rate-routes`}))`);
    const countryRows = await tx.select({ code: schema.exchangeRateCountry.countryCode, enabled: schema.exchangeRateCountry.enabled })
      .from(schema.exchangeRateCountry)
      .where(scoped(schema.exchangeRateCountry.organizationId, session.organizationId));
    const existing = await tx.select().from(schema.exchangeRateRoute)
      .where(scoped(schema.exchangeRateRoute.organizationId, session.organizationId));
    const decisions = new Map(countryRows.map((row) => [row.code, row.enabled]));
    const enabled = new Set(countryRows.filter((row) => row.enabled).map((row) => row.code));
    for (const route of existing.filter((route) => route.active)) {
      if (!decisions.has(route.originCountry)) enabled.add(route.originCountry);
      if (!decisions.has(route.destinationCountry)) enabled.add(route.destinationCountry);
    }
    const invalid = unique.find((route) => !enabled.has(route.originCountry) || !enabled.has(route.destinationCountry));
    if (invalid) throw new ExchangeRateError("invalid_state", "Habilita primero los países de origen y destino");
    const byKey = new Map(existing.map((route) => [remittanceRouteKey(route.originCountry, route.destinationCountry), route]));
    const summary = { requested: unique.length, create: 0, reactivate: 0, unchanged: 0 };
    for (const route of unique) {
      const current = byKey.get(remittanceRouteKey(route.originCountry, route.destinationCountry));
      if (!current) summary.create += 1;
      else if (!current.active) summary.reactivate += 1;
      else summary.unchanged += 1;
    }
    if (input.dryRun) return { dryRun: true, summary };
    for (const requested of unique) {
      const origin = remittanceCountry(requested.originCountry)!;
      const destination = remittanceCountry(requested.destinationCountry)!;
      const key = remittanceRouteKey(origin.code, destination.code);
      const current = byKey.get(key);
      if (current?.active) continue;
      let routeId = current?.id;
      if (current) {
        await tx.update(schema.exchangeRateRoute).set({ active: true, updatedAt: new Date() })
          .where(scoped(schema.exchangeRateRoute.organizationId, session.organizationId, eq(schema.exchangeRateRoute.id, current.id), eq(schema.exchangeRateRoute.active, false)));
      } else {
        routeId = newId("exchangeRateRoute");
        await tx.insert(schema.exchangeRateRoute).values({
          id: routeId, organizationId: session.organizationId,
          originCountry: origin.code, originCurrency: origin.currency,
          destinationCountry: destination.code, destinationCurrency: destination.currency,
          calculationOperation: null, roundingPrecision: null, active: true,
          createdByUserId: session.userId,
        });
      }
      await tx.insert(schema.exchangeRateAuditEvent).values({
        id: newId("exchangeRateAuditEvent"), organizationId: session.organizationId,
        actorUserId: session.userId, routeId, action: current ? "route_reactivated_bulk" : "route_created_pending_bulk",
        before: current ? { active: false } : null,
        after: { active: true, calculationOperation: current?.calculationOperation ?? null, pendingConfiguration: !current?.calculationOperation },
      });
    }
    return { dryRun: false, summary };
  });
}

export async function listExchangeRateRoutes(organizationId: string) {
  const enabled = await effectiveEnabledCountryCodes(organizationId);
  if (enabled.size < 2) return [];
  const rows = await getDb().select({
    id: schema.exchangeRateRoute.id,
    originCountry: schema.exchangeRateRoute.originCountry,
    originCurrency: schema.exchangeRateRoute.originCurrency,
    destinationCountry: schema.exchangeRateRoute.destinationCountry,
    destinationCurrency: schema.exchangeRateRoute.destinationCurrency,
    calculationOperation: schema.exchangeRateRoute.calculationOperation,
    roundingPrecision: schema.exchangeRateRoute.roundingPrecision,
    active: schema.exchangeRateRoute.active,
  }).from(schema.exchangeRateRoute)
    .where(scoped(schema.exchangeRateRoute.organizationId, organizationId, eq(schema.exchangeRateRoute.active, true)))
    .orderBy(asc(schema.exchangeRateRoute.originCountry), asc(schema.exchangeRateRoute.destinationCountry));
  return rows.filter((route) => enabled.has(route.originCountry) && enabled.has(route.destinationCountry));
}

export async function listExchangeRates(organizationId: string, includeHistory: boolean, at = new Date()) {
  const condition = includeHistory
    ? scoped(schema.exchangeRateQuote.organizationId, organizationId)
    : scoped(
        schema.exchangeRateQuote.organizationId,
        organizationId,
        eq(schema.exchangeRateQuote.status, "published"),
        isNotNull(schema.exchangeRateQuote.calculationOperation),
        lte(schema.exchangeRateQuote.validFrom, at),
        or(isNull(schema.exchangeRateQuote.validUntil), gt(schema.exchangeRateQuote.validUntil, at))
      );
  const rows = await getDb().select({
    routeId: schema.exchangeRateRoute.id,
    quoteId: schema.exchangeRateQuote.id,
    originCountry: schema.exchangeRateRoute.originCountry,
    originCurrency: schema.exchangeRateRoute.originCurrency,
    destinationCountry: schema.exchangeRateRoute.destinationCountry,
    destinationCurrency: schema.exchangeRateRoute.destinationCurrency,
    routeOperation: schema.exchangeRateRoute.calculationOperation,
    roundingPrecision: schema.exchangeRateRoute.roundingPrecision,
    active: schema.exchangeRateRoute.active,
    version: schema.exchangeRateQuote.version,
    sourceUnits: schema.exchangeRateQuote.sourceUnits,
    destinationUnits: schema.exchangeRateQuote.destinationUnits,
    commercialRate: schema.exchangeRateQuote.commercialRate,
    calculationOperation: schema.exchangeRateQuote.calculationOperation,
    precision: schema.exchangeRateQuote.precision,
    validFrom: schema.exchangeRateQuote.validFrom,
    validUntil: schema.exchangeRateQuote.validUntil,
    status: schema.exchangeRateQuote.status,
    createdByUserId: schema.exchangeRateQuote.createdByUserId,
    publishedByUserId: schema.exchangeRateQuote.publishedByUserId,
    createdAt: schema.exchangeRateQuote.createdAt,
    publishedAt: schema.exchangeRateQuote.publishedAt,
  }).from(schema.exchangeRateQuote)
    .innerJoin(schema.exchangeRateRoute, and(
      eq(schema.exchangeRateRoute.id, schema.exchangeRateQuote.routeId),
      eq(schema.exchangeRateRoute.organizationId, organizationId),
      eq(schema.exchangeRateRoute.active, true)
    ))
    .where(condition)
    .orderBy(asc(schema.exchangeRateRoute.originCurrency), desc(schema.exchangeRateQuote.version));
  const enabled = await effectiveEnabledCountryCodes(organizationId);
  const visibleRows = rows.filter((row) => enabled.has(row.originCountry) && enabled.has(row.destinationCountry));
  const userIds = [...new Set(visibleRows.flatMap((row) => [row.createdByUserId, row.publishedByUserId].filter((id): id is string => Boolean(id))))];
  const users = userIds.length
    ? await getDb().select({ id: schema.user.id, name: schema.user.name }).from(schema.user).where(inArray(schema.user.id, userIds))
    : [];
  const names = new Map(users.map((user) => [user.id, user.name]));
  return visibleRows.map((row) => {
    const previewResult = row.calculationOperation
      ? calculateConversion(PREVIEW_AMOUNT, row.commercialRate, row.calculationOperation, row.precision)
      : null;
    return {
      ...row,
      previewAmount: row.calculationOperation ? PREVIEW_AMOUNT : null,
      previewResult,
      createdByName: names.get(row.createdByUserId) ?? "Usuario",
      publishedByName: row.publishedByUserId ? names.get(row.publishedByUserId) ?? "Usuario" : null,
    };
  });
}

export async function listPresentedCurrentRates(organizationId: string, at = new Date()) {
  const rates = await listExchangeRates(organizationId, false, at);
  return rates.flatMap((rate) => rate.calculationOperation ? [{
    ...rate,
    presentation: buildExchangeRatePresentation({ ...rate, calculationOperation: rate.calculationOperation }),
  }] : []);
}

export async function calculateCurrentExchangeRate(organizationId: string, input: CalculateExchangeRateInput, at = new Date()) {
  const rates = await listExchangeRates(organizationId, false, at);
  const rate = rates.find((candidate) => candidate.routeId === input.routeId);
  if (!rate?.calculationOperation) {
    throw new ExchangeRateError("not_found", "No hay una tasa vigente y autorizada para esta ruta");
  }
  return {
    quoteId: rate.quoteId,
    routeId: rate.routeId,
    amount: input.amount,
    presentation: buildExchangeRatePresentation({ ...rate, calculationOperation: rate.calculationOperation }, input.amount),
  };
}

export async function getExchangeRateSelection(organizationId: string, input: ExchangeRateSelectionInput, at = new Date()) {
  const routes = await listExchangeRateRoutes(organizationId);
  const route = routes.find((candidate) => candidate.originCountry === input.originCountry && candidate.destinationCountry === input.destinationCountry) ?? null;
  if (!route) return { route: null, currentRate: null };
  const rates = await listPresentedCurrentRates(organizationId, at);
  return { route, currentRate: rates.find((candidate) => candidate.routeId === route.id) ?? null };
}

export async function previewExchangeRateDraft(session: SessionContext, input: PreviewExchangeRateInput) {
  await requireRateManager(session);
  const [route] = await getDb().select().from(schema.exchangeRateRoute).where(scoped(
    schema.exchangeRateRoute.organizationId,
    session.organizationId,
    eq(schema.exchangeRateRoute.id, input.routeId),
    eq(schema.exchangeRateRoute.active, true)
  )).limit(1);
  if (!route) throw new ExchangeRateError("not_found", "Ruta no encontrada");
  if (!route.calculationOperation || route.roundingPrecision === null) {
    throw new ExchangeRateError("route_not_configured", "La ruta aún no tiene fórmula comercial");
  }
  return {
    routeId: route.id,
    amount: input.amount,
    presentation: buildExchangeRatePresentation({
      originCountry: route.originCountry,
      originCurrency: route.originCurrency,
      destinationCountry: route.destinationCountry,
      destinationCurrency: route.destinationCurrency,
      commercialRate: input.commercialRate,
      calculationOperation: route.calculationOperation,
      precision: route.roundingPrecision,
    }, input.amount),
  };
}

export async function configureExchangeRateRoute(session: SessionContext, input: ConfigureExchangeRateRouteInput) {
  if (session.role !== "owner") throw new ExchangeRateError("forbidden", "Solo el propietario configura fórmulas de ruta");
  if (!operationMatchesCommercialRule(input)) {
    throw new ExchangeRateError("formula_conflict", "La moneda o la operación contradice la regla comercial confirmada para esta ruta");
  }
  return getDb().transaction(async (tx) => {
    const condition = scoped(
      schema.exchangeRateRoute.organizationId,
      session.organizationId,
      eq(schema.exchangeRateRoute.originCountry, input.originCountry),
      eq(schema.exchangeRateRoute.originCurrency, input.originCurrency),
      eq(schema.exchangeRateRoute.destinationCountry, input.destinationCountry),
      eq(schema.exchangeRateRoute.destinationCurrency, input.destinationCurrency)
    );
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${session.organizationId}:${input.originCountry}:${input.originCurrency}:${input.destinationCountry}:${input.destinationCurrency}`}))`);
    const catalogCountries = [remittanceCountry(input.originCountry), remittanceCountry(input.destinationCountry)].filter((country) => country !== null);
    if (catalogCountries.length === 2) {
      const now = new Date();
      await tx.insert(schema.exchangeRateCountry).values(catalogCountries.map((country) => ({
        id: newId("exchangeRateCountry"), organizationId: session.organizationId,
        countryCode: country.code, currencyCode: country.currency,
        enabled: true, createdAt: now, updatedAt: now,
      }))).onConflictDoUpdate({
        target: [schema.exchangeRateCountry.organizationId, schema.exchangeRateCountry.countryCode],
        set: { enabled: true, updatedAt: now },
      });
    }
    let [route] = await tx.select().from(schema.exchangeRateRoute).where(condition).limit(1);
    if (route && (route.calculationOperation || route.roundingPrecision !== null)) {
      throw new ExchangeRateError("invalid_state", "La fórmula de esta ruta ya fue configurada y es inmutable");
    }
    let action = "route_configured";
    if (route) {
      const [updated] = await tx.update(schema.exchangeRateRoute).set({
        calculationOperation: input.operation,
        roundingPrecision: input.precision,
        updatedAt: new Date(),
      }).where(and(condition, isNull(schema.exchangeRateRoute.calculationOperation), isNull(schema.exchangeRateRoute.roundingPrecision))).returning();
      route = updated;
    } else {
      action = "route_created";
      const [created] = await tx.insert(schema.exchangeRateRoute).values({
        id: newId("exchangeRateRoute"), organizationId: session.organizationId,
        originCountry: input.originCountry, originCurrency: input.originCurrency,
        destinationCountry: input.destinationCountry, destinationCurrency: input.destinationCurrency,
        calculationOperation: input.operation, roundingPrecision: input.precision,
        createdByUserId: session.userId,
      }).returning();
      route = created;
    }
    if (!route) throw new ExchangeRateError("invalid_state", "La ruta cambió mientras se configuraba");
    await tx.insert(schema.exchangeRateAuditEvent).values({
      id: newId("exchangeRateAuditEvent"), organizationId: session.organizationId,
      actorUserId: session.userId, routeId: route.id, action,
      before: action === "route_configured" ? { calculationOperation: null, roundingPrecision: null } : null,
      after: { ...input },
    });
    return route;
  });
}

export async function createExchangeRateDraft(session: SessionContext, input: CreateExchangeRateInput) {
  await requireRateManager(session);
  const db = getDb();
  return db.transaction(async (tx) => {
    const [route] = await tx.select().from(schema.exchangeRateRoute).where(scoped(
      schema.exchangeRateRoute.organizationId, session.organizationId,
      eq(schema.exchangeRateRoute.id, input.routeId), eq(schema.exchangeRateRoute.active, true)
    )).limit(1);
    if (!route) throw new ExchangeRateError("not_found", "Ruta no encontrada");
    if (!route.calculationOperation || route.roundingPrecision === null) {
      throw new ExchangeRateError("route_not_configured", "El propietario debe configurar la fórmula de la ruta antes de crear tasas");
    }
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${route.id}))`);
    const [versionRow] = await tx.select({ max: sql<number>`coalesce(max(${schema.exchangeRateQuote.version}), 0)` })
      .from(schema.exchangeRateQuote)
      .where(scoped(schema.exchangeRateQuote.organizationId, session.organizationId, eq(schema.exchangeRateQuote.routeId, route.id)));
    const [quote] = await tx.insert(schema.exchangeRateQuote).values({
      id: newId("exchangeRateQuote"), organizationId: session.organizationId,
      routeId: route.id, version: Number(versionRow?.max ?? 0) + 1,
      sourceUnits: route.calculationOperation === "multiply" ? "1" : input.commercialRate,
      destinationUnits: route.calculationOperation === "multiply" ? input.commercialRate : "1",
      commercialRate: input.commercialRate,
      calculationOperation: route.calculationOperation,
      precision: route.roundingPrecision,
      validFrom: new Date(input.validFrom), validUntil: input.validUntil ? new Date(input.validUntil) : null,
      createdByUserId: session.userId,
    }).returning();
    if (!quote) throw new ExchangeRateError("not_found", "No se pudo crear el borrador");
    await tx.insert(schema.exchangeRateAuditEvent).values({
      id: newId("exchangeRateAuditEvent"), organizationId: session.organizationId,
      actorUserId: session.userId, routeId: route.id, quoteId: quote.id,
      action: "quote_created", after: { ...input, calculationOperation: route.calculationOperation, precision: route.roundingPrecision, version: quote.version },
    });
    return quote;
  });
}

export async function publishExchangeRate(session: SessionContext, quoteId: string) {
  await requireRateManager(session);
  const db = getDb();
  return db.transaction(async (tx) => {
    const [quote] = await tx.select().from(schema.exchangeRateQuote)
      .where(scoped(schema.exchangeRateQuote.organizationId, session.organizationId, eq(schema.exchangeRateQuote.id, quoteId))).limit(1);
    if (!quote) throw new ExchangeRateError("not_found", "Tasa no encontrada");
    if (quote.status !== "draft") throw new ExchangeRateError("invalid_state", "Solo se publica un borrador");
    if (!quote.calculationOperation) throw new ExchangeRateError("route_not_configured", "La cotización legada no tiene fórmula y no puede publicarse");
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${quote.routeId}))`);
    const overlapParts = [
      eq(schema.exchangeRateQuote.routeId, quote.routeId),
      eq(schema.exchangeRateQuote.status, "published"),
      or(isNull(schema.exchangeRateQuote.validUntil), gt(schema.exchangeRateQuote.validUntil, quote.validFrom)),
    ];
    if (quote.validUntil) overlapParts.push(lt(schema.exchangeRateQuote.validFrom, quote.validUntil));
    const [overlap] = await tx.select({ id: schema.exchangeRateQuote.id }).from(schema.exchangeRateQuote)
      .where(scoped(schema.exchangeRateQuote.organizationId, session.organizationId, ...overlapParts)).limit(1);
    if (overlap) throw new ExchangeRateError("overlap", "La vigencia se solapa con otra tasa publicada");
    const now = new Date();
    const [published] = await tx.update(schema.exchangeRateQuote).set({ status: "published", publishedAt: now, publishedByUserId: session.userId, updatedAt: now })
      .where(scoped(schema.exchangeRateQuote.organizationId, session.organizationId, eq(schema.exchangeRateQuote.id, quoteId), eq(schema.exchangeRateQuote.status, "draft"))).returning();
    if (!published) throw new ExchangeRateError("invalid_state", "El borrador cambió mientras se publicaba");
    await tx.insert(schema.exchangeRateAuditEvent).values({ id: newId("exchangeRateAuditEvent"), organizationId: session.organizationId, actorUserId: session.userId, routeId: quote.routeId, quoteId, action: "quote_published", before: { status: "draft" }, after: { status: "published", publishedAt: now.toISOString() } });
    return published;
  });
}

export async function disableExchangeRate(session: SessionContext, quoteId: string) {
  await requireRateManager(session);
  return getDb().transaction(async (tx) => {
    const [current] = await tx.select().from(schema.exchangeRateQuote)
      .where(scoped(schema.exchangeRateQuote.organizationId, session.organizationId, eq(schema.exchangeRateQuote.id, quoteId), or(eq(schema.exchangeRateQuote.status, "draft"), eq(schema.exchangeRateQuote.status, "published"))))
      .limit(1);
    if (!current) throw new ExchangeRateError("not_found", "Tasa no encontrada o ya desactivada");
    const now = new Date();
    const [quote] = await tx.update(schema.exchangeRateQuote)
      .set({ status: "disabled", disabledAt: now, updatedAt: now })
      .where(scoped(schema.exchangeRateQuote.organizationId, session.organizationId, eq(schema.exchangeRateQuote.id, quoteId), eq(schema.exchangeRateQuote.status, current.status)))
      .returning();
    if (!quote) throw new ExchangeRateError("invalid_state", "La tasa cambió mientras se desactivaba");
    await tx.insert(schema.exchangeRateAuditEvent).values({ id: newId("exchangeRateAuditEvent"), organizationId: session.organizationId, actorUserId: session.userId, routeId: quote.routeId, quoteId, action: "quote_disabled", before: { status: current.status }, after: { status: "disabled", disabledAt: now.toISOString() } });
    return quote;
  });
}

export async function getExchangeRateSettings(organizationId: string) {
  const [org] = await getDb().select({ enabled: schema.organization.exchangeRatesEnabled }).from(schema.organization).where(eq(schema.organization.id, organizationId)).limit(1);
  const supervisors = await getDb().select({ id: schema.member.id, userId: schema.member.userId, name: schema.user.name, enabled: schema.member.canManageExchangeRates })
    .from(schema.member).innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(scoped(schema.member.organizationId, organizationId, eq(schema.member.role, "supervisor")))
    .orderBy(asc(schema.user.name));
  return { enabled: org?.enabled ?? false, supervisors };
}

export async function updateExchangeRateSettings(session: SessionContext, input: { action: "module"; enabled: boolean } | { action: "capability"; memberId: string; enabled: boolean }) {
  if (session.role !== "owner") throw new ExchangeRateError("forbidden", "Solo el propietario autoriza el módulo");
  const db = getDb();
  if (input.action === "module") {
    await db.update(schema.organization).set({ exchangeRatesEnabled: input.enabled }).where(eq(schema.organization.id, session.organizationId));
  } else {
    const [member] = await db.update(schema.member).set({ canManageExchangeRates: input.enabled })
      .where(scoped(schema.member.organizationId, session.organizationId, eq(schema.member.id, input.memberId), eq(schema.member.role, "supervisor"))).returning({ id: schema.member.id });
    if (!member) throw new ExchangeRateError("not_found", "Supervisora no encontrada");
  }
  await db.insert(schema.exchangeRateAuditEvent).values({ id: newId("exchangeRateAuditEvent"), organizationId: session.organizationId, actorUserId: session.userId, action: input.action === "module" ? "module_updated" : "capability_updated", after: input });
}
