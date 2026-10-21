import { and, asc, eq } from "drizzle-orm";
import { chromium } from "playwright";
import { getDb, getSql, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { DEFAULT_WEEKLY_SCHEDULE } from "@/lib/team";
import type { SessionContext } from "@/lib/auth/session";
import { runAgentTurn } from "@/server/ai/pipeline";
import { FINANCIAL_REVIEW_ACK } from "@/server/ai/financial-safety";
import { MEDIA_REVIEW_ACK } from "@/server/ai/media-safety";
import { saveAiCredential } from "@/server/ai/credentials";
import { updateOrganizationAiSchedule } from "@/server/ai/schedule";
import { saveCredentials } from "@/server/whatsapp/credentials";
import {
  canAccessConversation,
  withConversationSendLock,
} from "@/server/assignments/access";
import {
  ensureConversationAssignment,
  setConversationAssignment,
} from "@/server/assignments/service";
import { updateAssignmentMode } from "@/server/assignments/policy";
import { getOperatorAvailability } from "@/server/team/availability";
import { sendText } from "@/server/inbox/send";
import { canReceiveSseEvent } from "@/server/events/access";
import { subscribe, type SseEvent } from "@/server/events/bus";

const BASE = process.env.APP_BASE_URL ?? "http://127.0.0.1:33041";
const E2E_EMAIL = "owner-fase4@example.invalid";
const E2E_PASSWORD = "fase4-password-123";
const db = getDb();
let checks = 0;

function ok(condition: unknown, message: string): asserts condition {
  checks += 1;
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  OK  ${message}`);
}

async function api(path: string, init?: RequestInit) {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      origin: BASE,
      ...(init?.headers ?? {}),
    },
  });
}

async function createConversation(input: {
  organizationId: string;
  name: string;
  assignedMemberId?: string | null;
}) {
  const contactId = newId("contact");
  const conversationId = newId("conversation");
  await db.insert(schema.contact).values({
    id: contactId,
    organizationId: input.organizationId,
    waIdentity: `bsuid:${contactId}`,
    waUserId: contactId,
    name: input.name,
  });
  await db.insert(schema.conversation).values({
    id: conversationId,
    organizationId: input.organizationId,
    contactId,
    assignedMemberId: input.assignedMemberId ?? null,
    assignedAt: input.assignedMemberId ? new Date() : null,
  });
  return conversationId;
}

async function inbound(input: {
  organizationId: string;
  conversationId: string;
  at: Date;
  text?: string;
  type?: string;
  mediaAssetId?: string;
}) {
  const id = newId("message");
  await db.insert(schema.message).values({
    id,
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    waMessageId: `wamid.fase4.${id}`,
    direction: "in",
    type: input.type ?? "text",
    text: input.text ?? null,
    status: "delivered",
    mediaAssetId: input.mediaAssetId ?? null,
    waTimestamp: input.at,
    createdAt: input.at,
  });
  await db
    .update(schema.conversation)
    .set({
      lastInboundAt: input.at,
      lastMessageAt: input.at,
      updatedAt: input.at,
    })
    .where(eq(schema.conversation.id, input.conversationId));
  return id;
}

async function outbound(conversationId: string) {
  return db
    .select()
    .from(schema.message)
    .where(
      and(
        eq(schema.message.conversationId, conversationId),
        eq(schema.message.direction, "out")
      )
    )
    .orderBy(asc(schema.message.createdAt));
}

async function conversation(conversationId: string) {
  const rows = await db
    .select()
    .from(schema.conversation)
    .where(eq(schema.conversation.id, conversationId))
    .limit(1);
  const row = rows[0];
  ok(row, `existe conversación ${conversationId}`);
  return row;
}

async function runInbound(input: {
  organizationId: string;
  conversationId: string;
  at: Date;
  text?: string;
  type?: string;
  mediaAssetId?: string;
}) {
  const messageId = await inbound(input);
  const before = (await outbound(input.conversationId)).length;
  await runAgentTurn(input.conversationId, {
    debidos: [messageId],
    at: input.at,
  });
  const after = await outbound(input.conversationId);
  return { generated: after.length - before, messages: after };
}

async function waitForMockRequest(): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const response = await api("/api/dev/ai-mock/v1/chat/completions");
    const state = (await response.json()) as { peticiones?: unknown[] };
    if ((state.peticiones?.length ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("El ai-mock no recibió la petición concurrente");
}

async function browserChecks(email: string, password: string) {
  console.log("\n== Navegador local ==");
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(`${BASE}/login`);
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForURL((url) => url.pathname !== "/login");
    await page.goto(`${BASE}/inbox`);

    await page.getByText("Horario nocturno E2E", { exact: true }).first().click();
    await page.getByText("IA nocturna activa", { exact: false }).waitFor();
    const toggle = page.getByRole("switch", { name: "IA en esta conversación" });
    ok((await toggle.getAttribute("aria-checked")) === "true", "interruptor IA inicia activo");
    await toggle.click();
    await page.waitForFunction(() =>
      document.querySelector('[role="switch"][aria-label="IA en esta conversación"]')
        ?.getAttribute("aria-checked") === "false"
    );
    await toggle.click();
    await page.waitForFunction(() =>
      document.querySelector('[role="switch"][aria-label="IA en esta conversación"]')
        ?.getAttribute("aria-checked") === "true"
    );
    ok(true, "interruptor IA cambia y restaura el estado");

    await page.getByText("Validación financiera E2E", { exact: true }).first().click();
    await page.getByText("Atención humana pendiente", { exact: false }).waitFor();
    ok(true, "etiqueta de atención humana pendiente visible");

    await page.getByText("Atención en curso E2E", { exact: true }).first().click();
    await page.getByText("Atención humana en curso", { exact: false }).waitFor();
    await page.getByText("IA pausada por intervención humana", { exact: false }).waitFor();
    ok(true, "etiquetas de intervención y pausa de IA visibles");

    const styles = await page.getByRole("switch", {
      name: "IA en esta conversación",
    }).evaluate((element) => {
      const css = getComputedStyle(element);
      return { backgroundColor: css.backgroundColor, boxShadow: css.boxShadow };
    });
    ok(
      styles.backgroundColor !== "rgba(0, 0, 0, 0)" && styles.boxShadow !== "none",
      "interruptor tiene fondo y anillo perceptibles"
    );
  } finally {
    await browser.close();
  }
}

async function main() {
  if (process.env.E2E_UI_ONLY === "1") {
    await browserChecks(E2E_EMAIL, E2E_PASSWORD);
    return;
  }
  console.log("== Preparación aislada ==");
  const email = E2E_EMAIL;
  const password = E2E_PASSWORD;
  const signUp = await api("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email, password, name: "Propietario Fase 4" }),
  });
  ok(signUp.ok, "registro del propietario en la base temporal");

  const users = await db
    .select()
    .from(schema.user)
    .where(eq(schema.user.email, email))
    .limit(1);
  const ownerUser = users[0];
  ok(ownerUser, "usuario propietario persistido");
  const memberships = await db
    .select()
    .from(schema.member)
    .where(eq(schema.member.userId, ownerUser.id))
    .limit(1);
  const ownerMember = memberships[0];
  ok(ownerMember, "membresía propietaria persistida");
  const organizationId = ownerMember.organizationId;

  await db
    .update(schema.organization)
    .set({ name: "Nexora E2E aislada" })
    .where(eq(schema.organization.id, organizationId));
  await updateOrganizationAiSchedule({
    organizationId,
    schedule: {
      startMinute: 22 * 60,
      endMinute: 6 * 60,
      timeZone: "America/Bogota",
    },
  });
  await updateAssignmentMode({ organizationId, mode: "manual" });
  await db
    .update(schema.agentProfile)
    .set({ enabled: true, name: "IA Nocturna E2E" })
    .where(eq(schema.agentProfile.organizationId, organizationId));
  await saveAiCredential({
    organizationId,
    provider: "openrouter",
    baseUrl: `${BASE}/api/dev/ai-mock`,
    model: "mock/agente",
    token: "token-ia-ficticio-fase4",
  });
  await saveCredentials({
    organizationId,
    wabaId: "WABA-FASE4-E2E",
    phoneNumberId: "PN-FASE4-E2E",
    token: "token-meta-ficticio-fase4",
  });
  await api("/api/dev/wa-mock/outbox", { method: "DELETE" });

  const ids = {
    supervisorUser: newId("user"),
    operatorAUser: newId("user"),
    operatorBUser: newId("user"),
    foreignUser: newId("user"),
    supervisor: newId("member"),
    operatorA: newId("member"),
    operatorB: newId("member"),
    foreignMember: newId("member"),
    foreignOrg: newId("organization"),
  };
  await db.insert(schema.organization).values({
    id: ids.foreignOrg,
    name: "Organización externa E2E",
    assignmentMode: "manual",
  });
  await db.insert(schema.user).values([
    { id: ids.supervisorUser, name: "Supervisora E2E", email: "supervisor-fase4@example.invalid", emailVerified: true },
    { id: ids.operatorAUser, name: "Operadora A E2E", email: "operator-a-fase4@example.invalid", emailVerified: true },
    { id: ids.operatorBUser, name: "Operadora B E2E", email: "operator-b-fase4@example.invalid", emailVerified: true },
    { id: ids.foreignUser, name: "Externa E2E", email: "foreign-fase4@example.invalid", emailVerified: true },
  ]);
  await db.insert(schema.member).values([
    { id: ids.supervisor, organizationId, userId: ids.supervisorUser, role: "supervisor", weeklySchedule: DEFAULT_WEEKLY_SCHEDULE },
    { id: ids.operatorA, organizationId, userId: ids.operatorAUser, role: "member", weeklySchedule: DEFAULT_WEEKLY_SCHEDULE },
    { id: ids.operatorB, organizationId, userId: ids.operatorBUser, role: "member", weeklySchedule: DEFAULT_WEEKLY_SCHEDULE },
    { id: ids.foreignMember, organizationId: ids.foreignOrg, userId: ids.foreignUser, role: "member", weeklySchedule: DEFAULT_WEEKLY_SCHEDULE },
  ]);

  const ownerSession: SessionContext = {
    userId: ownerUser.id,
    memberId: ownerMember.id,
    organizationId,
    role: "owner",
  };
  const supervisorSession: SessionContext = {
    userId: ids.supervisorUser,
    memberId: ids.supervisor,
    organizationId,
    role: "supervisor",
  };
  const operatorASession: SessionContext = {
    userId: ids.operatorAUser,
    memberId: ids.operatorA,
    organizationId,
    role: "member",
  };
  const operatorBSession: SessionContext = {
    userId: ids.operatorBUser,
    memberId: ids.operatorB,
    organizationId,
    role: "member",
  };

  console.log("\n== Horario 22:00–06:00 America/Bogota ==");
  const scheduleConversation = await createConversation({
    organizationId,
    name: "Horario nocturno E2E",
  });
  const boundaryCases = [
    ["21:59", "2026-10-21T02:59:00.000Z", 0],
    ["22:00", "2026-10-21T03:00:00.000Z", 1],
    ["03:00", "2026-10-21T08:00:00.000Z", 1],
    ["05:59", "2026-10-21T10:59:00.000Z", 1],
    ["06:00", "2026-10-21T11:00:00.000Z", 0],
  ] as const;
  for (const [label, iso, expected] of boundaryCases) {
    const result = await runInbound({
      organizationId,
      conversationId: scheduleConversation,
      at: new Date(iso),
      text: `Consulta general ${label}`,
    });
    ok(result.generated === expected, `${label}: respuestas automáticas = ${expected}`);
  }

  console.log("\n== Asignación manual, permisos y SSE ==");
  const manualConversation = await createConversation({
    organizationId,
    name: "Asignación manual E2E",
  });
  await ensureConversationAssignment({
    organizationId,
    conversationId: manualConversation,
    at: new Date("2026-10-21T15:00:00.000Z"),
  });
  ok((await conversation(manualConversation)).assignedMemberId === null, "modo manual no asigna automáticamente");
  const events: SseEvent[] = [];
  const unsubscribe = subscribe(organizationId, (event) => events.push(event));
  await setConversationAssignment({
    organizationId,
    conversationId: manualConversation,
    targetMemberId: ids.operatorA,
    actorUserId: ids.supervisorUser,
    at: new Date("2026-10-21T15:00:00.000Z"),
  });
  unsubscribe();
  const assignmentEvent = events.find((event) => event.type === "conversation.assignment");
  ok(assignmentEvent, "reasignación publica evento SSE");
  ok(await canReceiveSseEvent(ownerSession, assignmentEvent), "owner recibe el evento SSE");
  ok(await canReceiveSseEvent(supervisorSession, assignmentEvent), "supervisor recibe el evento SSE");
  ok(await canReceiveSseEvent(operatorASession, assignmentEvent), "member responsable recibe el evento SSE");
  ok(!(await canReceiveSseEvent(operatorBSession, assignmentEvent)), "member ajena no recibe el evento SSE");
  ok(await canAccessConversation(ownerSession, manualConversation), "owner ve conversación asignada");
  ok(await canAccessConversation(supervisorSession, manualConversation), "supervisor ve conversación asignada");
  ok(await canAccessConversation(operatorASession, manualConversation), "member responsable ve su conversación");
  ok(!(await canAccessConversation(operatorBSession, manualConversation)), "member no ve conversación ajena");
  const foreignConversation = await createConversation({
    organizationId: ids.foreignOrg,
    name: "Conversación externa E2E",
    assignedMemberId: ids.foreignMember,
  });
  ok(!(await canAccessConversation(supervisorSession, foreignConversation)), "aislamiento entre organizaciones");

  console.log("\n== Supervisora 24/7 y operadoras por turno ==");
  const outOfShift = new Date("2026-10-21T08:00:00.000Z");
  ok((await getOperatorAvailability(supervisorSession, outOfShift)).canSend, "supervisora disponible a las 03:00");
  ok(!(await getOperatorAvailability(operatorASession, outOfShift)).canSend, "operadora bloqueada a las 03:00");

  console.log("\n== Solicitud humana pendiente e intervención efectiva ==");
  const humanConversation = await createConversation({
    organizationId,
    name: "Atención en curso E2E",
    assignedMemberId: ids.supervisor,
  });
  const requestAt = new Date("2026-10-21T04:00:00.000Z");
  const handoff = await runInbound({
    organizationId,
    conversationId: humanConversation,
    at: requestAt,
    text: "Quiero hablar con una persona",
  });
  ok(handoff.generated === 1, "solicitud humana nocturna recibe acuse");
  const pending = await conversation(humanConversation);
  ok(pending.handoffReason === "cliente" && !pending.humanInterventionAt, "solicitud queda pendiente sin intervención ficticia");
  const handoffAt = pending.handoffAt?.getTime();
  const informative = await runInbound({
    organizationId,
    conversationId: humanConversation,
    at: new Date("2026-10-21T04:05:00.000Z"),
    text: "Mientras espero, ¿cuál es el horario de atención?",
  });
  ok(informative.generated === 1, "IA responde información posterior durante la noche");
  ok((await conversation(humanConversation)).handoffAt?.getTime() === handoffAt, "la solicitud humana no se reinicia");

  await withConversationSendLock(supervisorSession, humanConversation, () =>
    sendText({
      organizationId,
      conversationId: humanConversation,
      text: "Soy la supervisora y ya estoy atendiendo el caso.",
    })
  );
  const active = await conversation(humanConversation);
  ok(Boolean(active.humanInterventionAt) && !active.aiEnabled, "respuesta humana exitosa pausa la IA");
  const afterHuman = await runInbound({
    organizationId,
    conversationId: humanConversation,
    at: new Date("2026-10-21T04:10:00.000Z"),
    text: "¿Sigues ahí?",
  });
  ok(afterHuman.generated === 0, "IA permanece en silencio después de intervención humana");

  console.log("\n== Carrera humano vs IA ==");
  const raceConversation = await createConversation({
    organizationId,
    name: "Concurrencia E2E",
    assignedMemberId: ids.supervisor,
  });
  const raceMessage = await inbound({
    organizationId,
    conversationId: raceConversation,
    at: outOfShift,
    text: "Necesito información general",
  });
  await api("/api/dev/ai-mock/v1/chat/completions?reset=1&demoraMs=1000");
  const aiTurn = runAgentTurn(raceConversation, {
    debidos: [raceMessage],
    at: outOfShift,
  });
  await waitForMockRequest();
  await withConversationSendLock(supervisorSession, raceConversation, () =>
    sendText({
      organizationId,
      conversationId: raceConversation,
      text: "Respuesta humana ganadora de la carrera.",
    })
  );
  await aiTurn;
  await api("/api/dev/ai-mock/v1/chat/completions?reset=1&demoraMs=0");
  const raceOutbound = await outbound(raceConversation);
  ok(raceOutbound.length === 1 && !raceOutbound[0]?.aiGenerated, "la carrera produce una sola respuesta humana");

  console.log("\n== Seguridad financiera ==");
  const financialConversation = await createConversation({
    organizationId,
    name: "Validación financiera E2E",
  });
  const financial = await runInbound({
    organizationId,
    conversationId: financialConversation,
    at: outOfShift,
    text: "¿Puedes confirmar si recibieron mi transferencia?",
  });
  ok(financial.generated === 1 && financial.messages.at(-1)?.text === FINANCIAL_REVIEW_ACK, "transferencia no se confirma y queda para revisión humana");
  ok((await conversation(financialConversation)).handoffReason === "modelo", "validación financiera queda escalada");

  const staleRateConversation = await createConversation({
    organizationId,
    name: "Tasa sin fuente E2E",
  });
  const staleRate = await runInbound({
    organizationId,
    conversationId: staleRateConversation,
    at: outOfShift,
    text: "¿Cuál es la tasa de hoy?",
  });
  ok(staleRate.messages.at(-1)?.text === FINANCIAL_REVIEW_ACK, "tasa sin fuente vigente no se inventa");

  await db.insert(schema.kbEntry).values({
    id: newId("kbEntry"),
    organizationId,
    kind: "qa",
    question: "¿Cuál es la tasa vigente?",
    answer: "La tasa autorizada vigente es 1 USD = 4.000 COP.",
    createdAt: new Date("2026-10-21T07:30:00.000Z"),
    updatedAt: new Date("2026-10-21T07:30:00.000Z"),
  });
  const currentRateConversation = await createConversation({
    organizationId,
    name: "Tasa autorizada E2E",
  });
  const currentRate = await runInbound({
    organizationId,
    conversationId: currentRateConversation,
    at: outOfShift,
    text: "¿Cuál es la tasa de hoy?",
  });
  ok(currentRate.messages.at(-1)?.text === "La tasa autorizada vigente es 1 USD = 4.000 COP.", "tasa autorizada y vigente sí puede informarse");

  const mediaConversation = await createConversation({
    organizationId,
    name: "Comprobante E2E",
  });
  const assetId = newId("mediaAsset");
  await db.insert(schema.mediaAsset).values({
    id: assetId,
    organizationId,
    kind: "document",
    mimeType: "application/pdf",
    fileName: "comprobante-ficticio.pdf",
    fileSize: 123,
    storagePath: "fase4/comprobante-ficticio.pdf",
    fetchStatus: "available",
  });
  const media = await runInbound({
    organizationId,
    conversationId: mediaConversation,
    at: outOfShift,
    type: "document",
    mediaAssetId: assetId,
  });
  ok(media.messages.at(-1)?.text === MEDIA_REVIEW_ACK, "comprobante adjunto requiere revisión humana");

  await browserChecks(email, password);
  console.log(`\nE2E Fase 4 aprobado: ${checks} comprobaciones.`);
}

try {
  await main();
} finally {
  await getSql().end();
}
