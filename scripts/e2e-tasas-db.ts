import { eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { SessionContext } from "@/lib/auth/session";
import {
  ExchangeRateError,
  bulkActivateExchangeRateRoutes,
  configureExchangeRateRoute,
  createExchangeRateDraft,
  listExchangeRateCountries,
  listExchangeRates,
  listExchangeRateRouteMatrix,
  preloadInitialExchangeRates,
  publishExchangeRate,
  updateExchangeRateCountry,
} from "@/server/exchange-rates/service";
import { REMITTANCE_COUNTRIES } from "@/server/exchange-rates/catalog";
import { resolveRateConversation, resolveRateText } from "@/server/exchange-rates/conversation";
import { calculateConversion } from "@/server/exchange-rates/decimal";
import { formatDecimalEs } from "@/server/exchange-rates/presentation";

const organizations = ["org_tasas_a", "org_tasas_b"];
const users = ["usr_tasas_owner", "usr_tasas_supervisor", "usr_tasas_member", "usr_tasas_other"];
let checks = 0;

function ok(value: unknown, message: string) {
  checks += 1;
  if (!value) throw new Error(`FAIL: ${message}`);
  console.log(`  OK  ${message}`);
}

async function rejectsCode(action: () => Promise<unknown>, code: string) {
  try {
    await action();
    return false;
  } catch (error) {
    return error instanceof ExchangeRateError && error.code === code;
  }
}

async function cleanup() {
  const db = getDb();
  await db.delete(schema.organization).where(inArray(schema.organization.id, organizations));
  await db.delete(schema.user).where(inArray(schema.user.id, users));
}

async function main() {
  const db = getDb();
  await cleanup();
  await db.insert(schema.user).values(users.map((id, index) => ({ id, name: `Usuario tasas ${index}`, email: `tasas-${index}@example.invalid`, emailVerified: true })));
  await db.insert(schema.organization).values([
    { id: organizations[0], name: "Tasas A", exchangeRatesEnabled: true },
    { id: organizations[1], name: "Tasas B", exchangeRatesEnabled: true },
  ]);
  await db.insert(schema.member).values([
    { id: "mem_tasas_owner", organizationId: organizations[0], userId: users[0], role: "owner" },
    { id: "mem_tasas_supervisor", organizationId: organizations[0], userId: users[1], role: "supervisor", canManageExchangeRates: true },
    { id: "mem_tasas_member", organizationId: organizations[0], userId: users[2], role: "member" },
    { id: "mem_tasas_other", organizationId: organizations[1], userId: users[3], role: "owner" },
  ]);

  const owner: SessionContext = { userId: users[0], memberId: "mem_tasas_owner", organizationId: organizations[0], role: "owner" };
  const supervisor: SessionContext = { userId: users[1], memberId: "mem_tasas_supervisor", organizationId: organizations[0], role: "supervisor" };
  const member: SessionContext = { userId: users[2], memberId: "mem_tasas_member", organizationId: organizations[0], role: "member" };
  const otherOwner: SessionContext = { userId: users[3], memberId: "mem_tasas_other", organizationId: organizations[1], role: "owner" };

  const route = await configureExchangeRateRoute(owner, {
    originCountry: "CO", originCurrency: "COP", destinationCountry: "VE", destinationCurrency: "VES",
    operation: "divide", precision: 2,
  });
  ok(route.calculationOperation === "divide", "owner configura DIVIDE en PostgreSQL");
  ok(await rejectsCode(() => configureExchangeRateRoute(supervisor, {
    originCountry: "VE", originCurrency: "VES", destinationCountry: "CO", destinationCurrency: "COP",
    operation: "multiply", precision: 2,
  }), "forbidden"), "supervisora autorizada no puede configurar fórmulas");

  const start = new Date(Date.now() - 60_000).toISOString();
  const end = new Date(Date.now() + 3_600_000).toISOString();
  const first = await createExchangeRateDraft(supervisor, { routeId: route.id, commercialRate: "3.68", validFrom: start, validUntil: end });
  const second = await createExchangeRateDraft(supervisor, { routeId: route.id, commercialRate: "3.69", validFrom: start, validUntil: end });
  ok(first.calculationOperation === "divide" && first.sourceUnits === "3.680000000000" && first.destinationUnits === "1.000000000000", "supervisora actualiza tasa y la fórmula/unidades se derivan de la ruta");
  ok(await rejectsCode(() => createExchangeRateDraft(member, { routeId: route.id, commercialRate: "3.70", validFrom: start, validUntil: end }), "forbidden"), "member no administra tasas");
  ok(await rejectsCode(() => createExchangeRateDraft(otherOwner, { routeId: route.id, commercialRate: "3.70", validFrom: start, validUntil: end }), "not_found"), "otra organización no puede usar la ruta");

  const results = await Promise.allSettled([publishExchangeRate(supervisor, first.id), publishExchangeRate(supervisor, second.id)]);
  ok(results.filter((result) => result.status === "fulfilled").length === 1, "la publicación concurrente deja un solo ganador");
  ok(results.some((result) => result.status === "rejected" && result.reason instanceof ExchangeRateError && result.reason.code === "overlap"), "el solapamiento concurrente se rechaza");

  await db.insert(schema.exchangeRateRoute).values({
    id: "xrr_tasas_legacy", organizationId: organizations[0], originCountry: "VE", originCurrency: "VES",
    destinationCountry: "CO", destinationCurrency: "COP", createdByUserId: users[0],
  });
  await db.insert(schema.exchangeRateQuote).values({
    id: "xrq_tasas_legacy", organizationId: organizations[0], routeId: "xrr_tasas_legacy", version: 1,
    sourceUnits: "1", destinationUnits: "2.9", commercialRate: "2.9", precision: 2,
    validFrom: new Date(Date.now() - 60_000), status: "draft", createdByUserId: users[0],
  });
  ok(await rejectsCode(() => publishExchangeRate(owner, "xrq_tasas_legacy"), "route_not_configured"), "una cotización histórica sin fórmula no se reinterpreta ni publica");

  const currentA = await listExchangeRates(organizations[0], false);
  const currentB = await listExchangeRates(organizations[1], false);
  ok(currentA.length === 1 && currentA[0]?.calculationOperation === "divide" && currentA[0]?.previewResult === "27173.91", "IA/equipo obtienen solo la fórmula publicada y vigente de su organización");
  ok(currentB.length === 0, "la consulta vigente mantiene aislamiento entre organizaciones");

  const naturalAmount = await resolveRateConversation({
    organizationId: organizations[0], conversationId: "cv_ficticia_tasas",
    messageId: "msg_ficticio_tasas", text: "¿Cuánto son 50 mil pesos?",
    contextTexts: ["Necesito enviar de Colombia a Venezuela"],
  });
  const winningRate = currentA[0]?.commercialRate;
  const expectedNaturalResult = winningRate
    ? formatDecimalEs(calculateConversion("50000", winningRate, "divide", 2))
    : null;
  ok(
    naturalAmount?.kind === "rate" &&
      Boolean(winningRate) &&
      naturalAmount.reply.includes(`50.000 COP ÷ ${formatDecimalEs(winningRate!)} = *${expectedNaturalResult} VES*`),
    "importe natural usa contexto, tasa ganadora y fórmula PostgreSQL sin LLM"
  );
  const isolatedAmount = resolveRateText("100 mil COP", currentB);
  ok(isolatedAmount?.kind !== "rate" && !isolatedAmount?.reply.includes("3,68"), "otra organización no recibe la tasa ni el cálculo");

  const catalog = await listExchangeRateCountries(organizations[0]);
  ok(catalog.length === 8 && catalog.map((country) => country.code).join(",") === "VE,CO,CL,PE,EC,US,BR,MX", "catálogo PostgreSQL expone los ocho países en el orden comercial");
  ok(catalog.find((country) => country.code === "EC")?.currency === "USD" && catalog.find((country) => country.code === "US")?.currency === "USD", "Ecuador y Estados Unidos permanecen como países distintos aunque compartan USD");
  const isolatedCatalog = await listExchangeRateCountries(organizations[1]);
  ok(isolatedCatalog.every((country) => !country.enabled), "el catálogo habilitado queda aislado por organización");
  ok(await rejectsCode(() => updateExchangeRateCountry(supervisor, { countryCode: "PE", enabled: true }), "forbidden"), "supervisora no puede habilitar países");
  ok(await rejectsCode(() => updateExchangeRateCountry(member, { countryCode: "PE", enabled: true }), "forbidden"), "member no puede habilitar países");

  for (const country of REMITTANCE_COUNTRIES) {
    await updateExchangeRateCountry(owner, { countryCode: country.code, enabled: true });
  }
  const routesToActivate = [
    { originCountry: "PE", destinationCountry: "VE" },
    { originCountry: "CL", destinationCountry: "VE" },
    { originCountry: "MX", destinationCountry: "CL" },
  ];
  const matrixBefore = await listExchangeRateRouteMatrix(organizations[0]);
  const quoteRowsBefore = await db.select({ id: schema.exchangeRateQuote.id }).from(schema.exchangeRateQuote)
    .where(eq(schema.exchangeRateQuote.organizationId, organizations[0]));
  const dryRun = await bulkActivateExchangeRateRoutes(owner, { dryRun: true, routes: routesToActivate });
  ok(dryRun.dryRun && dryRun.summary.create === 3, "vista previa masiva informa tres rutas nuevas sin escribirlas");
  ok((await listExchangeRateRouteMatrix(organizations[0])).length === matrixBefore.length, "la vista previa no modifica la matriz");
  ok(await rejectsCode(() => bulkActivateExchangeRateRoutes(supervisor, { dryRun: false, routes: routesToActivate }), "forbidden"), "supervisora no puede activar corredores masivamente");

  const applied = await bulkActivateExchangeRateRoutes(owner, { dryRun: false, routes: routesToActivate });
  ok(!applied.dryRun && applied.summary.create === 3, "owner activa solo las rutas seleccionadas");
  const matrixAfter = await listExchangeRateRouteMatrix(organizations[0]);
  const createdRoutes = matrixAfter.filter((candidate) => routesToActivate.some((requested) => requested.originCountry === candidate.originCountry && requested.destinationCountry === candidate.destinationCountry));
  ok(createdRoutes.length === 3 && createdRoutes.every((candidate) => candidate.calculationOperation === null && candidate.roundingPrecision === null), "rutas nuevas quedan pendientes de fórmula, precisión y tasa");
  const quoteRowsAfter = await db.select({ id: schema.exchangeRateQuote.id }).from(schema.exchangeRateQuote)
    .where(eq(schema.exchangeRateQuote.organizationId, organizations[0]));
  ok(quoteRowsAfter.length === quoteRowsBefore.length, "la activación de corredores no crea ni reinterpreta cotizaciones");
  const repeated = await bulkActivateExchangeRateRoutes(owner, { dryRun: false, routes: routesToActivate });
  ok(repeated.summary.unchanged === 3 && (await listExchangeRateRouteMatrix(organizations[0])).length === matrixAfter.length, "la activación repetida es idempotente y no duplica rutas");
  ok(matrixAfter.some((candidate) => candidate.id === route.id && candidate.calculationOperation === "divide"), "la ruta y operación histórica CO → VE permanecen intactas");
  ok(await rejectsCode(() => configureExchangeRateRoute(owner, {
    originCountry: "PE", originCurrency: "PEN", destinationCountry: "VE", destinationCurrency: "VES",
    operation: "divide", precision: 2,
  }), "formula_conflict"), "la fórmula verificada PE → VE rechaza DIVIDE");
  const configuredPeru = await configureExchangeRateRoute(owner, {
    originCountry: "PE", originCurrency: "PEN", destinationCountry: "VE", destinationCurrency: "VES",
    operation: "multiply", precision: 2,
  });
  ok(configuredPeru.calculationOperation === "multiply", "owner confirma MULTIPLY para PE → VE sin crear tasa");

  await db.insert(schema.contact).values({
    id: "ct_tasas_pending", organizationId: organizations[0],
    waIdentity: "573000000099", phone: "573000000099", name: "Cliente ficticio tasas",
  });
  await db.insert(schema.conversation).values({
    id: "cv_tasas_pending", organizationId: organizations[0], contactId: "ct_tasas_pending",
    aiEnabled: true, lastInboundAt: new Date(), lastMessageAt: new Date(),
  });
  await db.insert(schema.message).values({
    id: "msg_tasas_pending", organizationId: organizations[0], conversationId: "cv_tasas_pending",
    waMessageId: "wamid.tasas.pending.db", direction: "in", type: "text",
    text: "¿Cuál es la tasa de Perú a Venezuela?", status: "delivered",
  });
  const pendingResults = await Promise.all([
    resolveRateConversation({
      organizationId: organizations[0], conversationId: "cv_tasas_pending",
      messageId: "msg_tasas_pending", text: "¿Cuál es la tasa de Perú a Venezuela?",
      contextTexts: ["¿Cuál es la tasa de Venezuela a Colombia?"],
    }),
    resolveRateConversation({
      organizationId: organizations[0], conversationId: "cv_tasas_pending",
      messageId: "msg_tasas_pending", text: "¿Cuál es la tasa de Perú a Venezuela?",
      contextTexts: ["¿Cuál es la tasa de Venezuela a Colombia?"],
    }),
  ]);
  ok(pendingResults.every((result) => result?.reply === "🇵🇪 Perú → 🇻🇪 Venezuela\n\n¡Hola! 👋 Por el momento no tengo una tasa disponible para esta ruta.\n\nVoy a consultar con una asesora para ayudarte. 💙"), "la ruta explícita sin tasa prevalece y solo anuncia la atención registrada");
  const pendingRequests = await db.select().from(schema.exchangeRateRequest)
    .where(eq(schema.exchangeRateRequest.organizationId, organizations[0]));
  ok(pendingRequests.filter((request) => request.messageId === "msg_tasas_pending").length === 1, "la concurrencia registra una sola solicitud pendiente por mensaje");
  const pendingConversation = await db.select().from(schema.conversation)
    .where(eq(schema.conversation.id, "cv_tasas_pending"));
  ok(pendingConversation[0]?.aiEnabled === true && pendingConversation[0]?.handoffAt == null, "la atención pendiente no apaga la IA ni activa intervención humana efectiva");

  const preloaded = await preloadInitialExchangeRates(otherOwner);
  ok(preloaded.routesCreated === 56 && preloaded.draftsCreated === 49, "precarga crea 56 rutas y 49 borradores reconocibles en una organización vacía");
  const preloadedRoutes = await db.select().from(schema.exchangeRateRoute)
    .where(eq(schema.exchangeRateRoute.organizationId, organizations[1]));
  const preloadedQuotes = await db.select().from(schema.exchangeRateQuote)
    .where(eq(schema.exchangeRateQuote.organizationId, organizations[1]));
  ok(preloadedRoutes.length === 56 && preloadedQuotes.length === 49, "la matriz completa y sus borradores quedan persistidos en PostgreSQL");
  ok(preloadedQuotes.every((quote) => quote.status === "draft" && quote.publishedAt === null), "la precarga no autoriza ni publica ninguna cotización");
  const repeatedPreload = await preloadInitialExchangeRates(otherOwner);
  ok(repeatedPreload.routesCreated === 0 && repeatedPreload.draftsCreated === 0, "la precarga repetida es idempotente y preserva historia");
  const usdRoutes = preloadedRoutes.filter((candidate) =>
    (candidate.originCountry === "EC" && candidate.destinationCountry === "US") ||
    (candidate.originCountry === "US" && candidate.destinationCountry === "EC")
  );
  ok(usdRoutes.length === 2 && new Set(usdRoutes.map((candidate) => candidate.id)).size === 2, "Ecuador y Estados Unidos conservan rutas USD independientes");
  console.log(`\n${checks} comprobaciones PostgreSQL correctas.`);
}

main().then(async () => {
  await cleanup();
  process.exit(0);
}, async (error) => {
  console.error(error);
  await cleanup().catch(() => undefined);
  process.exit(1);
});
