import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pickLeastLoadedMember } from "@/lib/assignment";
import { canAccessAssignedConversation } from "@/server/assignments/access";

describe("selección de responsable", () => {
  const candidates = [
    { id: "mem_b", createdAt: new Date("2026-01-02T00:00:00Z") },
    { id: "mem_a", createdAt: new Date("2026-01-01T00:00:00Z") },
    { id: "mem_c", createdAt: new Date("2026-01-03T00:00:00Z") },
  ];

  it("elige la menor carga y desempata por antigüedad", () => {
    expect(
      pickLeastLoadedMember(
        candidates,
        new Map([
          ["mem_a", 2],
          ["mem_b", 1],
          ["mem_c", 1],
        ])
      )
    ).toBe("mem_b");
    expect(pickLeastLoadedMember(candidates, new Map())).toBe("mem_a");
  });

  it("devuelve cola cuando no hay candidatas", () => {
    expect(pickLeastLoadedMember([], new Map())).toBeNull();
  });
});

describe("autorización por responsable", () => {
  const owner = { role: "owner", memberId: "mem_owner" };
  const assigned = { role: "member", memberId: "mem_a" };
  const other = { role: "member", memberId: "mem_b" };

  it("el propietario recupera todo y el miembro solo lo propio", () => {
    expect(canAccessAssignedConversation(owner, null)).toBe(true);
    expect(canAccessAssignedConversation(owner, "mem_b")).toBe(true);
    expect(canAccessAssignedConversation(assigned, "mem_a")).toBe(true);
    expect(canAccessAssignedConversation(other, "mem_a")).toBe(false);
    expect(canAccessAssignedConversation(assigned, null)).toBe(false);
  });

  it("todas las superficies humanas aplican la guarda servidor", () => {
    const sendRoutes = [
      "src/app/api/conversations/[id]/messages/route.ts",
      "src/app/api/conversations/[id]/messages/media/route.ts",
      "src/app/api/conversations/[id]/messages/template/route.ts",
      "src/app/api/contacts/[id]/start-conversation/route.ts",
    ];
    for (const route of sendRoutes) {
      expect(readFileSync(route, "utf8")).toContain(
        "withConversationSendLock(session"
      );
    }
    expect(
      readFileSync("src/app/api/media/[assetId]/route.ts", "utf8")
    ).toContain("canAccessMediaAsset(session");
    expect(readFileSync("src/app/api/events/route.ts", "utf8")).toContain(
      "canReceiveSseEvent(session"
    );
  });

  it("las APIs del bot quedan fuera de la política humana", () => {
    expect(readFileSync("src/app/api/bot/messages/route.ts", "utf8")).not.toContain(
      "withConversationSendLock"
    );
  });
});

describe("integridad transaccional y migración", () => {
  it("serializa cálculo de carga y conversación con advisory locks", () => {
    const service = readFileSync(
      "src/server/assignments/service.ts",
      "utf8"
    );
    expect(service).toContain("getDb().transaction");
    expect(service).toContain("pg_advisory_xact_lock");
    expect(service).toContain("assignment-org:");
    expect(service).toContain("conversation:");
    expect(service).toContain("conversationAssignmentEvent");
    const access = readFileSync("src/server/assignments/access.ts", "utf8");
    expect(access).toContain("await assertOperatorCanSend(session)");
    const team = readFileSync("src/server/team/service.ts", "utf8");
    expect(team).toContain("assignment-org:");
    expect(team).toContain("conversation:");
  });

  it("la migración 0019 es aditiva", () => {
    const migration = readFileSync(
      "drizzle/0019_true_nightmare.sql",
      "utf8"
    );
    expect(migration).toContain('CREATE TABLE "conversation_assignment_event"');
    expect(migration).toContain('ADD COLUMN "assigned_member_id"');
    expect(migration).not.toMatch(
      /(^|\n)\s*(DROP\b|DELETE\s+FROM\b|TRUNCATE\b)/i
    );
  });
});
