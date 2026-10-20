import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: {
    userId: "usr_owner_a",
    memberId: "mem_owner_a",
    organizationId: "org_a",
    role: "owner",
  },
  internalCalls: 0,
  signupCalls: 0,
  memberships: [] as Array<Record<string, string>>,
  listedOrganization: "",
}));

vi.mock("@/lib/auth/session", () => ({
  UnauthorizedError: class UnauthorizedError extends Error {},
  requireSession: async () => state.session,
}));

vi.mock("@/lib/auth", () => ({
  runInternalSignup: async (fn: () => Promise<unknown>) => {
    state.internalCalls += 1;
    return fn();
  },
  getAuth: () => ({
    api: {
      signUpEmail: async () => {
        state.signupCalls += 1;
        return { user: { id: "usr_worker" } };
      },
    },
  }),
}));

vi.mock("@/server/team/service", () => ({
  createTeamMembership: async (input: Record<string, string>) => {
    state.memberships.push(input);
    return true;
  },
  listTeamMembers: async (organizationId: string) => {
    state.listedOrganization = organizationId;
    return [];
  },
}));

import * as route from "@/app/api/settings/team/route";

beforeEach(() => {
  state.session.role = "owner";
  state.session.organizationId = "org_a";
  state.internalCalls = 0;
  state.signupCalls = 0;
  state.memberships = [];
  state.listedOrganization = "";
});

function createRequest(role?: "member" | "supervisor") {
  return new Request("http://localhost/api/settings/team", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Trabajadora",
      email: "worker@example.com",
      password: "temporal-segura",
      ...(role ? { role } : {}),
      organizationId: "org_b",
    }),
  });
}

describe("alta interna y aislamiento de organización", () => {
  it("un miembro no puede crear otra cuenta ni activar el bypass", async () => {
    state.session.role = "member";
    const response = await route.POST(createRequest());
    expect(response.status).toBe(403);
    expect(state.internalCalls).toBe(0);
    expect(state.signupCalls).toBe(0);
    expect(state.memberships).toHaveLength(0);
  });

  it("el owner crea una trabajadora solo dentro de su organización", async () => {
    const response = await route.POST(createRequest());
    expect(response.status).toBe(201);
    expect(state.internalCalls).toBe(1);
    expect(state.signupCalls).toBe(1);
    expect(state.memberships).toEqual([
      {
        organizationId: "org_a",
        actorUserId: "usr_owner_a",
        userId: "usr_worker",
        role: "member",
      },
    ]);
  });

  it("el owner puede crear directamente una cuenta supervisora", async () => {
    const response = await route.POST(createRequest("supervisor"));
    expect(response.status).toBe(201);
    expect(state.memberships).toEqual([
      expect.objectContaining({
        organizationId: "org_a",
        role: "supervisor",
      }),
    ]);
  });

  it("lista el equipo por la organización de la sesión, no por el request", async () => {
    const response = await route.GET();
    expect(response.status).toBe(200);
    expect(state.listedOrganization).toBe("org_a");
  });
});
