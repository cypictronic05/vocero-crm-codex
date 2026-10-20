import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hasPermission, PERMISSIONS } from "@/lib/auth/permissions";
import { publish, subscribe } from "@/server/events/bus";

const state = vi.hoisted(() => ({
  session: {
    userId: "usr_owner",
    memberId: "mem_owner",
    organizationId: "org_a",
    role: "owner" as "owner" | "supervisor" | "member",
  },
  updates: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/auth/session", () => ({
  UnauthorizedError: class UnauthorizedError extends Error {},
  requireSession: async () => state.session,
}));

vi.mock("@/server/team/service", () => ({
  TeamServiceError: class TeamServiceError extends Error {},
  updateMemberSettings: async (input: Record<string, unknown>) => {
    state.updates.push(input);
    return {
      role: input.role,
      status: input.status,
      weeklySchedule: input.weeklySchedule,
    };
  },
}));

vi.mock("@/server/branding", () => ({
  getBranding: async () => ({ currency: "USD" }),
}));
vi.mock("@/server/analytics/period", () => ({
  PeriodError: class PeriodError extends Error {},
  periodFromRequest: async () => ({
    from: new Date("2026-10-01T00:00:00Z"),
    to: new Date("2026-11-01T00:00:00Z"),
  }),
}));
vi.mock("@/server/analytics/sales", () => ({
  salesBlock: async (organizationId: string) => ({ organizationId }),
}));

const memberRoute = await import("@/app/api/settings/team/[memberId]/route");
const salesRoute = await import("@/app/api/analytics/sales/route");

const schedule = [
  { day: 1, startMinute: 360, endMinute: 1320 },
];
const request = (role: "member" | "supervisor") =>
  new Request("http://localhost/api/settings/team/mem_target", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role, status: "enabled", weeklySchedule: schedule }),
  });
const context = { params: Promise.resolve({ memberId: "mem_target" }) };

beforeEach(() => {
  state.session.role = "owner";
  state.updates = [];
});

describe("rol supervisora", () => {
  it("solo recibe capacidades operativas de supervisión", () => {
    expect(hasPermission("supervisor", PERMISSIONS.CONVERSATIONS_VIEW_ALL)).toBe(true);
    expect(hasPermission("supervisor", PERMISSIONS.CONVERSATIONS_ASSIGN)).toBe(true);
    expect(hasPermission("supervisor", PERMISSIONS.RESULTS_VIEW)).toBe(true);
    expect(hasPermission("supervisor", PERMISSIONS.TEAM_VIEW)).toBe(true);
    for (const permission of [
      PERMISSIONS.CHANNELS_CONFIGURE,
      PERMISSIONS.AI_CONFIGURE,
      PERMISSIONS.INTEGRATIONS_CONFIGURE,
      PERMISSIONS.ORGANIZATION_CONFIGURE,
      PERMISSIONS.TEAM_MANAGE,
    ]) {
      expect(hasPermission("supervisor", permission)).toBe(false);
    }
  });

  it("el owner puede promover a supervisora y el cambio conserva organización y actor", async () => {
    const response = await memberRoute.PATCH(request("supervisor"), context);
    expect(response.status).toBe(200);
    expect(state.updates).toEqual([
      expect.objectContaining({
        organizationId: "org_a",
        actorUserId: "usr_owner",
        memberId: "mem_target",
        role: "supervisor",
      }),
    ]);
  });

  it("una supervisora no puede cambiar roles ni elevar a otra persona", async () => {
    state.session.role = "supervisor";
    const response = await memberRoute.PATCH(request("supervisor"), context);
    expect(response.status).toBe(403);
    expect(state.updates).toEqual([]);
  });

  it("el esquema de entrada no admite owner como rol asignable", async () => {
    const ownerRequest = new Request(
      "http://localhost/api/settings/team/mem_target",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role: "owner",
          status: "enabled",
          weeklySchedule: schedule,
        }),
      }
    );
    const response = await memberRoute.PATCH(ownerRequest, context);
    expect(response.status).toBe(422);
    expect(state.updates).toEqual([]);
  });

  it("la supervisora consulta resultados globales y el member recibe 403", async () => {
    state.session.role = "supervisor";
    const allowed = await salesRoute.GET(
      new Request("http://localhost/api/analytics/sales")
    );
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ organizationId: "org_a" });

    state.session.role = "member";
    const denied = await salesRoute.GET(
      new Request("http://localhost/api/analytics/sales")
    );
    expect(denied.status).toBe(403);
  });
});

describe("aislamiento y auditoría", () => {
  it("el bus SSE separa estrictamente los canales por organización", () => {
    const orgA: string[] = [];
    const orgB: string[] = [];
    const stopA = subscribe("org_a", (event) => orgA.push(event.type));
    const stopB = subscribe("org_b", (event) => orgB.push(event.type));
    publish("org_b", {
      type: "conversation.assignment",
      data: {
        conversationId: "cv_b",
        fromMemberId: null,
        toMemberId: "mem_b",
        assignmentVersion: 1,
        reason: "manual",
      },
    });
    stopA();
    stopB();
    expect(orgA).toEqual([]);
    expect(orgB).toEqual(["conversation.assignment"]);
  });

  it("roles y asignaciones conservan auditoría append-only y locks", () => {
    const team = readFileSync("src/server/team/service.ts", "utf8");
    const assignments = readFileSync(
      "src/server/assignments/service.ts",
      "utf8"
    );
    expect(team).toContain('"member_role_updated"');
    expect(team).toContain("teamAuditEvent");
    expect(team).toContain("eq(schema.member.organizationId, input.organizationId)");
    expect(assignments).toContain("conversationAssignmentEvent");
    expect(assignments).toContain("pg_advisory_xact_lock");
    expect(assignments).toContain("assignmentVersion + 1");
    expect(assignments).toContain(
      "eq(schema.conversation.organizationId, input.organizationId)"
    );
  });

  it("todas las APIs de resultados exigen la capacidad global", () => {
    for (const file of ["sales", "bot", "ads", "hygiene"]) {
      const source = readFileSync(
        `src/app/api/analytics/${file}/route.ts`,
        "utf8"
      );
      expect(source).toContain("withPermission(PERMISSIONS.RESULTS_VIEW");
    }
  });
});
