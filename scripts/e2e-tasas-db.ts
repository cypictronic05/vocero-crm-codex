import { eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { SessionContext } from "@/lib/auth/session";
import {
  ExchangeRateError,
  configureExchangeRateRoute,
  createExchangeRateDraft,
  listExchangeRates,
  publishExchangeRate,
} from "@/server/exchange-rates/service";
import { resolveRateConversation, resolveRateText } from "@/server/exchange-rates/conversation";

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
  ok(naturalAmount?.kind === "rate" && naturalAmount.reply.includes("50.000 COP ÷ 3,68 = *13.586,96 VES*"), "importe natural usa contexto, tasa y fórmula PostgreSQL sin LLM");
  const isolatedAmount = resolveRateText("100 mil COP", currentB);
  ok(isolatedAmount?.kind !== "rate" && !isolatedAmount?.reply.includes("3,68"), "otra organización no recibe la tasa ni el cálculo");
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
