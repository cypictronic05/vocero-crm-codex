import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { decideAutomaticAssignment } from "@/lib/assignment-mode";

const state = vi.hoisted(() => ({
  session: {
    userId: "usr_owner",
    memberId: "mem_owner",
    organizationId: "org_a",
    role: "owner" as "owner" | "supervisor" | "member",
  } as {
    userId: string;
    memberId: string;
    organizationId: string;
    role: "owner" | "supervisor" | "member";
  } | null,
  updates: [] as Array<{ organizationId: string; mode: string }>,
  sweeps: [] as Array<{ organizationId: string; includeUnassigned: boolean }>,
}));

vi.mock("@/lib/auth/session", () => {
  class UnauthorizedError extends Error {}
  return {
    UnauthorizedError,
    requireSession: async () => {
      if (!state.session) throw new UnauthorizedError("No autenticado");
      return state.session;
    },
  };
});

vi.mock("@/server/assignments/policy", () => {
  class AssignmentPolicyError extends Error {}
  return {
    AssignmentPolicyError,
    updateAssignmentMode: async (input: {
      organizationId: string;
      mode: "manual" | "automatic";
    }) => {
      state.updates.push(input);
      return input.mode;
    },
  };
});

vi.mock("@/server/assignments/service", () => ({
  sweepConversationAssignments: async (
    _at: Date,
    organizationId: string,
    includeUnassigned: boolean
  ) => {
    state.sweeps.push({ organizationId, includeUnassigned });
  },
}));

const route = await import(
  "@/app/api/settings/team/assignment-mode/route"
);

function request(
  mode: "manual" | "automatic",
  extra: Record<string, unknown> = {}
) {
  return new Request("http://localhost/api/settings/team/assignment-mode", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode, ...extra }),
  });
}

beforeEach(() => {
  state.session = {
    userId: "usr_owner",
    memberId: "mem_owner",
    organizationId: "org_a",
    role: "owner",
  };
  state.updates = [];
  state.sweeps = [];
});

describe("decisión de asignación por modalidad", () => {
  const candidates = [
    { id: "mem_a", createdAt: new Date("2026-01-01T00:00:00Z") },
    { id: "mem_b", createdAt: new Date("2026-01-02T00:00:00Z") },
  ];

  it("un mensaje nuevo en manual permanece sin asignar", () => {
    expect(
      decideAutomaticAssignment({
        mode: "manual",
        currentMemberId: null,
        currentMemberAvailable: false,
        candidates,
        loads: new Map(),
      })
    ).toEqual({ action: "preserve" });
  });

  it("un hilo dejado en cola manual no se reasigna al recibir otro mensaje", () => {
    expect(
      decideAutomaticAssignment({
        mode: "manual",
        currentMemberId: null,
        currentMemberAvailable: false,
        candidates,
        loads: new Map([["mem_a", 0]]),
      })
    ).toEqual({ action: "preserve" });
  });

  it("manual conserva un responsable válido existente", () => {
    expect(
      decideAutomaticAssignment({
        mode: "manual",
        currentMemberId: "mem_a",
        currentMemberAvailable: true,
        candidates,
        loads: new Map(),
      })
    ).toEqual({ action: "preserve" });
  });

  it("manual devuelve a cola un responsable que terminó turno o fue suspendido", () => {
    expect(
      decideAutomaticAssignment({
        mode: "manual",
        currentMemberId: "mem_a",
        currentMemberAvailable: false,
        candidates: [candidates[1]!],
        loads: new Map(),
      })
    ).toEqual({ action: "assign", targetMemberId: null });
  });

  it("automático conserva el algoritmo de carga anterior", () => {
    expect(
      decideAutomaticAssignment({
        mode: "automatic",
        currentMemberId: null,
        currentMemberAvailable: false,
        candidates,
        loads: new Map([
          ["mem_a", 3],
          ["mem_b", 1],
        ]),
      })
    ).toEqual({ action: "assign", targetMemberId: "mem_b" });
  });
});

describe("API de modalidad", () => {
  it("owner puede activar manual usando exclusivamente su organización", async () => {
    const response = await route.PUT(
      request("manual", { organizationId: "org_b" })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ assignmentMode: "manual" });
    expect(state.updates).toEqual([
      { organizationId: "org_a", mode: "manual" },
    ]);
    expect(state.sweeps).toEqual([]);
  });

  it.each(["supervisor", "member"] as const)(
    "%s recibe 403 y no cambia la política",
    async (role) => {
      state.session!.role = role;
      const response = await route.PUT(request("manual"));
      expect(response.status).toBe(403);
      expect(state.updates).toEqual([]);
    }
  );

  it("sin sesión devuelve 401", async () => {
    state.session = null;
    const response = await route.PUT(request("manual"));
    expect(response.status).toBe(401);
    expect(state.updates).toEqual([]);
  });

  it("al volver a automático retoma solo la cola de la organización", async () => {
    const response = await route.PUT(request("automatic"));
    expect(response.status).toBe(200);
    expect(state.sweeps).toEqual([
      { organizationId: "org_a", includeUnassigned: true },
    ]);
  });
});

describe("integración, concurrencia y migración", () => {
  it("la selección, el cambio de modo y los envíos conservan sus locks", () => {
    const assignments = readFileSync(
      "src/server/assignments/service.ts",
      "utf8"
    );
    const policy = readFileSync(
      "src/server/assignments/policy.ts",
      "utf8"
    );
    const access = readFileSync(
      "src/server/assignments/access.ts",
      "utf8"
    );
    expect(assignments).toContain("assignment-org:");
    expect(assignments).toContain("conversation:");
    expect(assignments).toContain("assignmentVersion + 1");
    expect(assignments).toContain("conversationAssignmentEvent");
    expect(assignments).toContain('input.reason === "automatic"');
    expect(policy).toContain("assignment-org:");
    expect(access).toContain("pg_advisory_lock");
  });

  it("el worker no reparte la cola manual y cada asignación revalida el modo", () => {
    const source = readFileSync(
      "src/server/assignments/service.ts",
      "utf8"
    );
    expect(source).toContain('eq(schema.organization.assignmentMode, "manual")');
    expect(source).toContain("isNotNull(schema.conversation.assignedMemberId)");
    expect(source).toContain(
      'eq(schema.organization.assignmentMode, "automatic")'
    );
    expect(source).toContain("assignmentModeSchema.parse");
    expect(source).toContain("decideAutomaticAssignment");
    expect(source).toContain("includeUnassigned");
  });

  it("la IA se dispara después de aplicar una política que no fuerza asignación humana", () => {
    const ingest = readFileSync("src/server/inbox/ingest.ts", "utf8");
    expect(ingest.indexOf("await ensureConversationAssignment")).toBeLessThan(
      ingest.indexOf("await maybeRunAgentTurn")
    );
  });

  it("cambiar modalidad no escribe conversaciones, mensajes ni historial", () => {
    const policy = readFileSync(
      "src/server/assignments/policy.ts",
      "utf8"
    );
    expect(policy).not.toContain("schema.conversation");
    expect(policy).not.toContain("schema.message");
    expect(policy).not.toContain("conversationAssignmentEvent");
  });

  it("la migración es aditiva, automática por defecto y reversible sin borrar datos", () => {
    const migration = readFileSync(
      "drizzle/0020_careless_starbolt.sql",
      "utf8"
    );
    expect(migration).toContain(
      "ADD COLUMN \"assignment_mode\" text DEFAULT 'automatic' NOT NULL"
    );
    expect(migration).not.toMatch(
      /(^|\n)\s*(DROP\b|DELETE\s+FROM\b|TRUNCATE\b|UPDATE\s+"?conversation)/i
    );
  });

  it("la bandeja conserva SSE, filtro de cola y borradores locales", () => {
    const inbox = readFileSync(
      "src/components/inbox/inbox-client.tsx",
      "utf8"
    );
    const list = readFileSync(
      "src/components/inbox/conversation-list.tsx",
      "utf8"
    );
    expect(inbox).toContain("onConversationAssignment");
    expect(inbox).toContain("void refetchConversations()");
    expect(inbox).toContain("const [pending, setPending]");
    expect(list).toContain('"unassigned"');
    expect(list).toContain('label: "Sin asignar"');
  });

  it("la vista supervisora recibe horario sin exponer correo administrativo", () => {
    const route = readFileSync(
      "src/app/api/settings/team/route.ts",
      "utf8"
    );
    expect(route).toContain(
      "{ id, role, status, name, weeklySchedule, availability }"
    );
    expect(route).not.toContain(
      "{ id, role, status, name, email, weeklySchedule, availability }"
    );
  });
});
