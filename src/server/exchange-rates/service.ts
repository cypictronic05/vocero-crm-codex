import { and, asc, desc, eq, gt, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import type { SessionContext } from "@/lib/auth/session";
import { divideDecimal, sameDecimal } from "@/server/exchange-rates/decimal";
import type { CreateExchangeRateInput } from "@/server/exchange-rates/validation";

export class ExchangeRateError extends Error {
  constructor(public readonly code: "module_disabled" | "forbidden" | "not_found" | "invalid_rate" | "invalid_state" | "overlap", message: string) {
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

export async function listExchangeRates(organizationId: string, includeHistory: boolean, at = new Date()) {
  const condition = includeHistory
    ? scoped(schema.exchangeRateQuote.organizationId, organizationId)
    : scoped(
        schema.exchangeRateQuote.organizationId,
        organizationId,
        eq(schema.exchangeRateQuote.status, "published"),
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
    active: schema.exchangeRateRoute.active,
    version: schema.exchangeRateQuote.version,
    sourceUnits: schema.exchangeRateQuote.sourceUnits,
    destinationUnits: schema.exchangeRateQuote.destinationUnits,
    commercialRate: schema.exchangeRateQuote.commercialRate,
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
  const userIds = [...new Set(rows.flatMap((row) => [row.createdByUserId, row.publishedByUserId].filter((id): id is string => Boolean(id))))];
  const users = userIds.length
    ? await getDb().select({ id: schema.user.id, name: schema.user.name }).from(schema.user).where(inArray(schema.user.id, userIds))
    : [];
  const names = new Map(users.map((user) => [user.id, user.name]));
  return rows.map((row) => ({
    ...row,
    createdByName: names.get(row.createdByUserId) ?? "Usuario",
    publishedByName: row.publishedByUserId ? names.get(row.publishedByUserId) ?? "Usuario" : null,
  }));
}

export async function createExchangeRateDraft(session: SessionContext, input: CreateExchangeRateInput) {
  await requireRateManager(session);
  const canonicalRate = divideDecimal(input.destinationUnits, input.sourceUnits, 12);
  if (!sameDecimal(canonicalRate, input.commercialRate)) {
    throw new ExchangeRateError("invalid_rate", `La tasa debe corresponder a las unidades (${canonicalRate})`);
  }
  const db = getDb();
  return db.transaction(async (tx) => {
    const routeCondition = scoped(
      schema.exchangeRateRoute.organizationId,
      session.organizationId,
      eq(schema.exchangeRateRoute.originCountry, input.originCountry),
      eq(schema.exchangeRateRoute.originCurrency, input.originCurrency),
      eq(schema.exchangeRateRoute.destinationCountry, input.destinationCountry),
      eq(schema.exchangeRateRoute.destinationCurrency, input.destinationCurrency)
    );
    let [route] = await tx.select().from(schema.exchangeRateRoute).where(routeCondition).limit(1);
    let routeCreated = false;
    if (!route) {
      const [inserted] = await tx.insert(schema.exchangeRateRoute).values({
        id: newId("exchangeRateRoute"), organizationId: session.organizationId,
        originCountry: input.originCountry, originCurrency: input.originCurrency,
        destinationCountry: input.destinationCountry, destinationCurrency: input.destinationCurrency,
        createdByUserId: session.userId,
      }).onConflictDoNothing().returning();
      route = inserted;
      routeCreated = Boolean(inserted);
      if (!route) [route] = await tx.select().from(schema.exchangeRateRoute).where(routeCondition).limit(1);
    }
    if (!route) throw new ExchangeRateError("not_found", "No se pudo crear la ruta");
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${route.id}))`);
    if (routeCreated) {
      await tx.insert(schema.exchangeRateAuditEvent).values({
        id: newId("exchangeRateAuditEvent"), organizationId: session.organizationId,
        actorUserId: session.userId, routeId: route.id, action: "route_created",
        after: { originCountry: route.originCountry, originCurrency: route.originCurrency, destinationCountry: route.destinationCountry, destinationCurrency: route.destinationCurrency },
      });
    }
    const [versionRow] = await tx.select({ max: sql<number>`coalesce(max(${schema.exchangeRateQuote.version}), 0)` })
      .from(schema.exchangeRateQuote)
      .where(scoped(schema.exchangeRateQuote.organizationId, session.organizationId, eq(schema.exchangeRateQuote.routeId, route.id)));
    const [quote] = await tx.insert(schema.exchangeRateQuote).values({
      id: newId("exchangeRateQuote"), organizationId: session.organizationId,
      routeId: route.id, version: Number(versionRow?.max ?? 0) + 1,
      sourceUnits: input.sourceUnits, destinationUnits: input.destinationUnits,
      commercialRate: input.commercialRate, precision: input.precision,
      validFrom: new Date(input.validFrom), validUntil: input.validUntil ? new Date(input.validUntil) : null,
      createdByUserId: session.userId,
    }).returning();
    if (!quote) throw new ExchangeRateError("not_found", "No se pudo crear el borrador");
    await tx.insert(schema.exchangeRateAuditEvent).values({
      id: newId("exchangeRateAuditEvent"), organizationId: session.organizationId,
      actorUserId: session.userId, routeId: route.id, quoteId: quote.id,
      action: "quote_created", after: { ...input, version: quote.version },
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
