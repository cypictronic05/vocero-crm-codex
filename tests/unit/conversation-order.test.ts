import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  calcularActividadBandeja,
  compararConversacionesBandeja,
  estaRecienAsignada,
  ordenarConversacionesBandeja,
} from "@/lib/conversation-order";
import type { ConversationDto } from "@/lib/types";

function conversation(
  id: string,
  overrides: Partial<ConversationDto> = {}
): ConversationDto {
  return {
    id,
    channel: "whatsapp",
    contact: { id: `ct_${id}`, name: id, phone: null },
    assignee: null,
    assignmentVersion: 0,
    assignedAt: null,
    inboxOrderAt: "2026-10-20T08:00:00.000Z",
    stageName: null,
    aiEnabled: true,
    handoffAt: null,
    handoffReason: null,
    humanInterventionAt: null,
    humanAttention: "none",
    aiSchedule: {
      startMinute: 22 * 60,
      endMinute: 6 * 60,
      timeZone: "America/Bogota",
      active: false,
    },
    lastInboundAt: null,
    lastMessageAt: "2026-10-20T08:00:00.000Z",
    unreadCount: 0,
    windowOpen: false,
    windowRemainingMs: 0,
    preview: null,
    anuncio: null,
    ...overrides,
  };
}

describe("orden efectivo de la Bandeja", () => {
  it("una conversación antigua recién asignada sube sobre actividad anterior", () => {
    const oldAssignedActivity = calcularActividadBandeja({
      assignedMemberId: "mem_a",
      assignedAt: new Date("2026-10-20T12:00:00.000Z"),
      lastMessageAt: new Date("2026-10-01T08:00:00.000Z"),
      createdAt: new Date("2026-10-01T07:00:00.000Z"),
    });
    const recentMessageActivity = calcularActividadBandeja({
      assignedMemberId: "mem_a",
      assignedAt: new Date("2026-10-19T12:00:00.000Z"),
      lastMessageAt: new Date("2026-10-20T11:00:00.000Z"),
      createdAt: new Date("2026-10-19T07:00:00.000Z"),
    });
    const ordered = ordenarConversacionesBandeja([
      conversation("cv_message", {
        inboxOrderAt: recentMessageActivity.toISOString(),
      }),
      conversation("cv_assigned", {
        inboxOrderAt: oldAssignedActivity.toISOString(),
      }),
    ]);
    expect(ordered.map((item) => item.id)).toEqual([
      "cv_assigned",
      "cv_message",
    ]);
  });

  it("un mensaje posterior vuelve a llevar su conversación arriba", () => {
    const ordered = ordenarConversacionesBandeja([
      conversation("cv_assigned", {
        inboxOrderAt: "2026-10-20T12:00:00.000Z",
      }),
      conversation("cv_new_message", {
        inboxOrderAt: "2026-10-20T12:01:00.000Z",
      }),
    ]);
    expect(ordered.map((item) => item.id)).toEqual([
      "cv_new_message",
      "cv_assigned",
    ]);
  });

  it("la cola sin asignar ignora assignedAt y conserva el orden por mensajes", () => {
    expect(
      calcularActividadBandeja({
        assignedMemberId: null,
        assignedAt: new Date("2026-10-20T14:00:00.000Z"),
        lastMessageAt: new Date("2026-10-02T09:00:00.000Z"),
        createdAt: new Date("2026-10-01T09:00:00.000Z"),
      }).toISOString()
    ).toBe("2026-10-02T09:00:00.000Z");
  });

  it("desempata de forma determinista sin mutar el array recibido", () => {
    const input = [conversation("cv_a"), conversation("cv_b")];
    const ordered = ordenarConversacionesBandeja(input);
    expect(ordered.map((item) => item.id)).toEqual(["cv_b", "cv_a"]);
    expect(input.map((item) => item.id)).toEqual(["cv_a", "cv_b"]);
    expect(compararConversacionesBandeja(input[0]!, input[1]!)).toBeGreaterThan(0);
  });
});

describe("indicación de asignación reciente", () => {
  const now = Date.parse("2026-10-20T12:10:00.000Z");

  it("solo se muestra a la responsable actual dentro de la ventana", () => {
    const assigned = conversation("cv_assigned", {
      assignee: { id: "mem_a", name: "Operadora A" },
      assignedAt: "2026-10-20T12:00:00.000Z",
    });
    expect(estaRecienAsignada(assigned, "mem_a", now)).toBe(true);
    expect(estaRecienAsignada(assigned, "mem_b", now)).toBe(false);
    expect(
      estaRecienAsignada(
        { ...assigned, assignedAt: "2026-10-20T11:00:00.000Z" },
        "mem_a",
        now
      )
    ).toBe(false);
  });
});

describe("consistencia SQL y SSE", () => {
  it("SQL usa mensaje o asignación vigente y un desempate estable", () => {
    const source = readFileSync("src/server/inbox/queries.ts", "utf8");
    expect(source).toContain("assignedMemberId} is not null");
    expect(source).toContain("greatest(");
    expect(source).toContain("desc(inboxOrderSql)");
    expect(source).toContain("desc(schema.conversation.id)");
  });

  it("mensajes y asignaciones refrescan y una respuesta vieja no gana", () => {
    const source = readFileSync(
      "src/components/inbox/inbox-client.tsx",
      "utf8"
    );
    expect(source).toContain("onMessageNew:");
    expect(source).toContain("onConversationAssignment:");
    expect(source).toContain("conversationFetchSequence");
    expect(source).toContain("sequence !== conversationFetchSequence.current");
  });

  it("la asignación no reescribe fechas de mensajes", () => {
    const source = readFileSync(
      "src/server/assignments/service.ts",
      "utf8"
    );
    const assignmentSet = source.slice(
      source.indexOf(".set({\n        assignedMemberId"),
      source.indexOf("await tx.insert(schema.conversationAssignmentEvent)")
    );
    expect(assignmentSet).toContain("assignedAt: at");
    expect(assignmentSet).not.toContain("lastMessageAt");
    expect(assignmentSet).not.toContain("lastInboundAt");
  });
});
