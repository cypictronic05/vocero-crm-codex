import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  aiScheduleSchema,
  currentAiWindowStart,
  isAiScheduleActive,
} from "@/lib/ai-schedule";
import {
  conversationAllowsAi,
  humanAttentionState,
} from "@/lib/human-attention";
import { evaluateOperatorAvailability } from "@/lib/team";
import {
  financialReviewReason,
  hasAuthorizedCurrentRate,
} from "@/server/ai/financial-safety";

const BOGOTA = {
  startMinute: 22 * 60,
  endMinute: 6 * 60,
  timeZone: "America/Bogota",
};

describe("horario de IA por organización", () => {
  it("responde a las 23:00 y 03:00 de Colombia, no a las 10:00", () => {
    expect(isAiScheduleActive(BOGOTA, new Date("2026-10-19T04:00:00Z"))).toBe(true);
    expect(isAiScheduleActive(BOGOTA, new Date("2026-10-19T08:00:00Z"))).toBe(true);
    expect(isAiScheduleActive(BOGOTA, new Date("2026-10-19T15:00:00Z"))).toBe(false);
  });

  it("cambia exactamente a las 22:00 y 06:00 de Colombia", () => {
    expect(isAiScheduleActive(BOGOTA, new Date("2026-10-19T02:59:59Z"))).toBe(false);
    expect(isAiScheduleActive(BOGOTA, new Date("2026-10-19T03:00:00Z"))).toBe(true);
    expect(isAiScheduleActive(BOGOTA, new Date("2026-10-19T10:59:59Z"))).toBe(true);
    expect(isAiScheduleActive(BOGOTA, new Date("2026-10-19T11:00:00Z"))).toBe(false);
  });

  it("admite una ventana diurna y calcula el inicio nocturno en zona IANA", () => {
    const madrid = { startMinute: 9 * 60, endMinute: 17 * 60, timeZone: "Europe/Madrid" };
    expect(isAiScheduleActive(madrid, new Date("2026-07-01T08:00:00Z"))).toBe(true);
    expect(isAiScheduleActive(madrid, new Date("2026-07-01T16:00:00Z"))).toBe(false);
    expect(currentAiWindowStart(BOGOTA, new Date("2026-10-19T08:15:00Z"))?.toISOString())
      .toBe("2026-10-19T03:00:00.000Z");
  });

  it("rechaza zona desconocida y duración cero", () => {
    expect(aiScheduleSchema.safeParse({ ...BOGOTA, timeZone: "Bogota" }).success).toBe(false);
    expect(aiScheduleSchema.safeParse({ ...BOGOTA, endMinute: BOGOTA.startMinute }).success).toBe(false);
  });
});

describe("solicitud pendiente e intervención efectiva", () => {
  it("el handoff del cliente permite información posterior mientras nadie intervino", () => {
    const conversation = {
      aiEnabled: true,
      handoffAt: new Date(),
      handoffReason: "cliente",
      humanInterventionAt: null,
    };
    expect(humanAttentionState(conversation)).toBe("pending");
    expect(conversationAllowsAi(conversation)).toBe(true);
  });

  it("intervención, pausa manual y handoffs de seguridad bloquean IA", () => {
    expect(conversationAllowsAi({
      aiEnabled: true,
      handoffAt: new Date(),
      handoffReason: "modelo",
      humanInterventionAt: null,
    })).toBe(false);
    expect(conversationAllowsAi({
      aiEnabled: true,
      handoffAt: new Date(),
      handoffReason: "cliente",
      humanInterventionAt: new Date(),
    })).toBe(false);
    expect(conversationAllowsAi({
      aiEnabled: false,
      handoffAt: null,
      handoffReason: null,
      humanInterventionAt: null,
    })).toBe(false);
  });

  it("el handoff es idempotente y una asignación no pausa IA", () => {
    const pipeline = readFileSync("src/server/ai/pipeline.ts", "utf8");
    const assignment = readFileSync("src/server/assignments/service.ts", "utf8");
    expect(pipeline).toContain("handoffAt} is null");
    const assignmentSet = assignment.slice(
      assignment.indexOf(".set({\n        assignedMemberId"),
      assignment.indexOf("await tx.insert(schema.conversationAssignmentEvent)")
    );
    expect(assignmentSet).not.toContain("aiEnabled");
    expect(assignmentSet).not.toContain("humanInterventionAt");
  });
});

describe("supervisión y protección concurrente", () => {
  it("supervisor responde 24/7 y member conserva su horario", () => {
    const at = new Date("2026-10-19T08:00:00Z");
    expect(evaluateOperatorAvailability({
      role: "supervisor",
      status: "enabled",
      schedule: [],
      at,
    }).canSend).toBe(true);
    expect(evaluateOperatorAvailability({
      role: "member",
      status: "enabled",
      schedule: [{ day: 0, startMinute: 6 * 60, endMinute: 22 * 60 }],
      at,
    }).canSend).toBe(false);
  });

  it("humano e IA usan el mismo advisory lock y la intervención ocurre tras enviar", () => {
    const access = readFileSync("src/server/assignments/access.ts", "utf8");
    const eligibility = readFileSync("src/server/ai/eligibility.ts", "utf8");
    expect(access).toContain("conversation:${conversationId}");
    expect(eligibility).toContain("conversation:${input.conversationId}");
    expect(access.indexOf("const result = await action()"))
      .toBeLessThan(access.indexOf("await markHumanIntervention"));
  });

  it("comprobantes y validaciones financieras quedan en revisión humana", () => {
    const prompt = readFileSync("src/server/ai/prompts.ts", "utf8");
    const media = readFileSync("src/server/ai/media-safety.ts", "utf8");
    expect(prompt).toContain("NUNCA inventes ni confirmes tasas");
    expect(prompt).toContain("pagos o comprobantes");
    expect(media).toContain("siempre revisión humana");
  });

  it("bloquea validaciones transaccionales aunque exista conocimiento", () => {
    expect(financialReviewReason({
      text: "¿Puedes confirmar si recibieron mi transferencia?",
      knowledge: [],
      at: new Date("2026-10-19T08:00:00Z"),
      timeZone: "America/Bogota",
    })).toBe("transaction_validation");
  });

  it("una tasa solo pasa con conocimiento autorizado actualizado ese día", () => {
    const at = new Date("2026-10-19T08:00:00Z");
    const current = [{
      question: "¿Cuál es la tasa vigente?",
      answer: "La tasa autorizada es 1 USD = 4.000 COP.",
      content: null,
      updatedAt: new Date("2026-10-19T07:00:00Z"),
    }];
    const stale = [{ ...current[0]!, updatedAt: new Date("2026-10-18T07:00:00Z") }];
    expect(hasAuthorizedCurrentRate(current, at, "America/Bogota")).toBe(true);
    expect(financialReviewReason({
      text: "¿Cuál es la tasa de hoy?",
      knowledge: current,
      at,
      timeZone: "America/Bogota",
    })).toBeNull();
    expect(financialReviewReason({
      text: "¿Cuál es la tasa de hoy?",
      knowledge: stale,
      at,
      timeZone: "America/Bogota",
    })).toBe("rate_not_authorized_or_stale");
  });

  it("el modo manual sigue sin asignar operadoras automáticamente", () => {
    const policy = readFileSync("src/lib/assignment-mode.ts", "utf8");
    const service = readFileSync("src/server/assignments/service.ts", "utf8");
    expect(policy).toContain('input.mode === "manual"');
    expect(service).toContain('eq(schema.organization.assignmentMode, "manual")');
    expect(service).toContain("jamás toma conversaciones ya sin asignar");
  });

  it("la migración 0021 es aditiva y conserva defaults compatibles", () => {
    const migration = readFileSync(
      "drizzle/0021_atencion_hibrida_nocturna.sql",
      "utf8"
    );
    expect(migration).toContain('"ai_schedule_start_minute" integer DEFAULT 1320 NOT NULL');
    expect(migration).toContain('"ai_schedule_end_minute" integer DEFAULT 360 NOT NULL');
    expect(migration).toContain('"ai_schedule_time_zone" text DEFAULT \'America/Bogota\' NOT NULL');
    expect(migration).toContain('"human_intervention_at" timestamp');
    expect(migration).not.toMatch(/(^|\n)\s*(DROP\b|DELETE\s+FROM\b|TRUNCATE\b)/i);
  });

  it("la configuración y las transiciones conservan alcance organizacional", () => {
    const schedule = readFileSync("src/server/ai/schedule.ts", "utf8");
    const intervention = readFileSync("src/server/inbox/human-attention.ts", "utf8");
    expect(schedule).toContain("eq(schema.organization.id, input.organizationId)");
    expect(intervention).toContain("eq(schema.conversation.organizationId, input.organizationId)");
  });
});
