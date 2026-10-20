import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hasPermission, PERMISSIONS } from "@/lib/auth/permissions";

const state = vi.hoisted(() => ({
  session: null as null | {
    userId: string;
    memberId: string;
    organizationId: string;
    role: string;
  },
  calls: [] as string[],
  verifyTokenReads: 0,
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

vi.mock("@/server/whatsapp/credentials", () => ({
  getCredentialsByOrg: async () => ({
    organizationId: "org_a",
    wabaId: "waba_1",
    phoneNumberId: "phone_1",
    displayPhoneNumber: "+56 9 1111 1111",
    verifiedName: "Nexora",
    status: "connected",
    token: "TOKEN_ULTRASECRETO",
  }),
  saveCredentials: async () => state.calls.push("whatsapp.save"),
  desconectarCanal: async () => state.calls.push("whatsapp.delete"),
  tokenLast4: (token: string) => token.slice(-4),
}));

vi.mock("@/server/whatsapp/connect", () => ({
  testConnection: async () => ({
    ok: true,
    displayPhoneNumber: "+56 9 1111 1111",
    verifiedName: "Nexora",
  }),
  registerWebhookForNumber: async () => {
    state.calls.push("webhook.register");
    return { ok: true };
  },
  unregisterWebhookForNumber: async () => {
    state.calls.push("webhook.unregister");
    return { ok: true };
  },
}));

vi.mock("@/server/whatsapp/webhook-url", () => ({
  webhookPath: () => "/api/webhooks/wa/SECRETO",
  webhookUrl: () => "https://crm.example/api/webhooks/wa/SECRETO",
  webhookVerifyToken: () => "VERIFY_ULTRASECRETO",
}));

vi.mock("@/lib/env", () => ({
  getEnv: () => {
    state.verifyTokenReads += 1;
    return {
      META_WEBHOOK_VERIFY_TOKEN: "VERIFY_ULTRASECRETO",
      META_APP_SECRET: "APP_ULTRASECRETO",
    };
  },
}));

vi.mock("@/server/channels/enabled", () => ({
  isChannelEnabled: () => false,
}));

vi.mock("@/server/ai/credentials", () => ({
  AiCredentialError: class AiCredentialError extends Error {},
  deleteAiCredential: async () => state.calls.push("ai.delete"),
  saveAiCredential: async () => state.calls.push("ai.save"),
}));

vi.mock("@/server/ai/settings", async () => {
  const { z } = await import("zod");
  return {
    aiSettingsPutSchema: z.object({
      provider: z.string(),
      baseUrl: z.string().optional(),
      model: z.string(),
      token: z.string(),
    }),
    baseUrlEfectiva: () => "https://ai.example",
    vistaAjustesIa: async () => ({ configured: true, tokenLast4: "RETO" }),
  };
});

vi.mock("@/server/agenda/flag", () => ({
  agendaEnabled: () => true,
  agendaDisabledResponse: () => new Response(null, { status: 404 }),
}));

vi.mock("@/server/agenda/connectors/google", () => ({
  googleConnector: { testConnection: async () => ({ ok: true }) },
}));

vi.mock("@/server/agenda/connectors/google-credentials", () => ({
  getGoogleCredentials: async () => null,
  saveGoogleCredentials: async () => state.calls.push("google.save"),
  deleteGoogleCredentials: async () => state.calls.push("google.delete"),
  secretLast4: (secret: string) => secret.slice(-4),
}));

const whatsappRoute = await import("@/app/api/settings/whatsapp/route");
const webhookRoute = await import("@/app/api/settings/webhook/route");
const aiRoute = await import("@/app/api/settings/ai/route");
const googleRoute = await import("@/app/api/settings/google/route");

const owner = {
  userId: "usr_owner",
  memberId: "mem_owner",
  organizationId: "org_a",
  role: "owner",
};

const member = {
  userId: "usr_member",
  memberId: "mem_member",
  organizationId: "org_a",
  role: "member",
};

const supervisor = {
  userId: "usr_supervisor",
  memberId: "mem_supervisor",
  organizationId: "org_a",
  role: "supervisor",
};

function whatsappPut() {
  return new Request("http://localhost/api/settings/whatsapp", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      wabaId: "waba_nueva",
      phoneNumberId: "phone_nuevo",
      token: "TOKEN_ULTRASECRETO",
    }),
  });
}

beforeEach(() => {
  state.session = owner;
  state.calls = [];
  state.verifyTokenReads = 0;
});

describe("autorización administrativa central", () => {
  it("la matriz es fail-closed y mantiene capacidades separadas", () => {
    expect(hasPermission("owner", PERMISSIONS.CHANNELS_CONFIGURE)).toBe(true);
    expect(hasPermission("owner", PERMISSIONS.CONVERSATIONS_ASSIGN)).toBe(true);
    expect(hasPermission("supervisor", PERMISSIONS.CONVERSATIONS_ASSIGN)).toBe(true);
    expect(hasPermission("supervisor", PERMISSIONS.CONVERSATIONS_VIEW_ALL)).toBe(true);
    expect(hasPermission("supervisor", PERMISSIONS.RESULTS_VIEW)).toBe(true);
    expect(hasPermission("supervisor", PERMISSIONS.TEAM_VIEW)).toBe(true);
    expect(hasPermission("member", PERMISSIONS.CHANNELS_CONFIGURE)).toBe(false);
    expect(hasPermission("admin", PERMISSIONS.CHANNELS_CONFIGURE)).toBe(false);
    expect(hasPermission("supervisor", PERMISSIONS.CHANNELS_CONFIGURE)).toBe(false);
    expect(hasPermission("supervisor", PERMISSIONS.TEAM_MANAGE)).toBe(false);
  });

  it("devuelve 401 sin sesión y no ejecuta la operación", async () => {
    state.session = null;
    const response = await whatsappRoute.DELETE();
    expect(response.status).toBe(401);
    expect(state.calls).toEqual([]);
  });

  it("devuelve 403 genérico al member sin filtrar secretos", async () => {
    state.session = member;
    const response = await whatsappRoute.PUT(whatsappPut());
    const body = JSON.stringify(await response.json());
    expect(response.status).toBe(403);
    expect(body).toContain("forbidden");
    expect(body).not.toContain("TOKEN_ULTRASECRETO");
    expect(body).not.toContain("VERIFY_ULTRASECRETO");
    expect(state.calls).toEqual([]);
  });

  it("el owner puede sustituir y desconectar WhatsApp dentro de su organización", async () => {
    expect((await whatsappRoute.PUT(whatsappPut())).status).toBe(200);
    expect((await whatsappRoute.DELETE()).status).toBe(200);
    expect(state.calls).toEqual([
      "whatsapp.save",
      "webhook.register",
      "webhook.unregister",
      "whatsapp.delete",
    ]);
  });

  it("el member no puede desconectar WhatsApp", async () => {
    state.session = member;
    expect((await whatsappRoute.DELETE()).status).toBe(403);
    expect(state.calls).toEqual([]);
  });

  it("el member no puede consultar el token del webhook", async () => {
    state.session = member;
    const response = await webhookRoute.GET();
    const body = JSON.stringify(await response.json());
    expect(response.status).toBe(403);
    expect(state.verifyTokenReads).toBe(0);
    expect(body).not.toContain("VERIFY_ULTRASECRETO");
  });

  it("el member no puede modificar credenciales de IA", async () => {
    state.session = member;
    expect((await aiRoute.DELETE()).status).toBe(403);
    expect(state.calls).not.toContain("ai.delete");
  });

  it("el member no puede administrar integraciones", async () => {
    state.session = member;
    expect((await googleRoute.DELETE()).status).toBe(403);
    expect(state.calls).not.toContain("google.delete");
  });

  it("la supervisora no puede modificar canales, IA ni integraciones", async () => {
    state.session = supervisor;
    expect((await whatsappRoute.DELETE()).status).toBe(403);
    expect((await webhookRoute.GET()).status).toBe(403);
    expect((await aiRoute.DELETE()).status).toBe(403);
    expect((await googleRoute.DELETE()).status).toBe(403);
    expect(state.calls).toEqual([]);
    expect(state.verifyTokenReads).toBe(0);
  });
});

describe("cobertura de superficies administrativas", () => {
  function routeFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return routeFiles(path);
      return entry.name === "route.ts" ? [path] : [];
    });
  }

  it("ninguna API de Ajustes retrocede a autenticación sin autorización", () => {
    for (const file of routeFiles("src/app/api/settings")) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(
        /export const (GET|POST|PUT|PATCH|DELETE) = withAuth\(/
      );
    }
  });

  it.each([
    ["src/app/api/settings/whatsapp/route.ts", "PERMISSIONS.CHANNELS_CONFIGURE"],
    ["src/app/api/settings/webhook/route.ts", "PERMISSIONS.CHANNELS_CONFIGURE"],
    ["src/app/api/settings/ai/route.ts", "PERMISSIONS.AI_CONFIGURE"],
    ["src/app/api/settings/capi/route.ts", "PERMISSIONS.INTEGRATIONS_CONFIGURE"],
    ["src/app/api/settings/google/route.ts", "PERMISSIONS.INTEGRATIONS_CONFIGURE"],
    ["src/app/api/settings/zoom/route.ts", "PERMISSIONS.INTEGRATIONS_CONFIGURE"],
    ["src/app/api/settings/instagram/route.ts", "PERMISSIONS.INTEGRATIONS_CONFIGURE"],
    ["src/app/api/agent/profile/route.ts", "PERMISSIONS.AGENT_CONFIGURE"],
    ["src/app/api/kb/route.ts", "PERMISSIONS.AGENT_CONFIGURE"],
    ["src/app/api/settings/team/route.ts", "PERMISSIONS.TEAM_MANAGE"],
    [
      "src/app/api/settings/team/assignment-mode/route.ts",
      "PERMISSIONS.TEAM_MANAGE",
    ],
    ["src/app/api/calendar/settings/route.ts", "PERMISSIONS.INTEGRATIONS_CONFIGURE"],
    ["src/app/api/templates/sync/route.ts", "PERMISSIONS.TEMPLATES_CONFIGURE"],
    ["src/app/api/pipeline/stages/[id]/route.ts", "PERMISSIONS.PIPELINE_CONFIGURE"],
    ["src/app/api/seed/demo/route.ts", "PERMISSIONS.DEMO_SEED"],
  ])("%s usa la capacidad %s", (file, permission) => {
    const source = readFileSync(file, "utf8");
    expect(source).toContain("withPermission(");
    expect(source).toContain(permission);
  });
});
