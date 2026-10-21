import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  sendText: vi.fn(),
  guard: "allow" as "allow" | "outside" | "paused",
}));

vi.mock("@/server/bot/auth", () => ({
  requireBotKey: () => null,
  resolveInstanceOrg: async () => "org_nexora",
}));

vi.mock("@/server/inbox/send", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/inbox/send")>();
  return { ...actual, sendText: fakes.sendText };
});

vi.mock("@/server/ai/eligibility", () => {
  class AiSendGuardError extends Error {
    constructor(
      public readonly code: "not_found" | "ai_paused" | "outside_bot_shift",
      message: string
    ) {
      super(message);
    }
  }
  return {
    AiSendGuardError,
    withAiConversationSendLock: async (input: { action: () => Promise<unknown> }) => {
      if (fakes.guard === "outside") {
        throw new AiSendGuardError(
          "outside_bot_shift",
          "La IA atiende de 22:00 a 06:00 en America/Bogota"
        );
      }
      if (fakes.guard === "paused") {
        throw new AiSendGuardError("ai_paused", "La IA está en pausa en esta conversación");
      }
      return input.action();
    },
  };
});

import { POST } from "@/app/api/bot/messages/route";

function request(): Request {
  return new Request("http://localhost/api/bot/messages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ conversationId: "cv_1", text: "Hola" }),
  });
}

describe("POST /api/bot/messages durante el relevo nocturno", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fakes.sendText.mockReset();
    fakes.sendText.mockResolvedValue({ messageId: "msg_1" });
    fakes.guard = "allow";
  });

  afterEach(() => vi.useRealTimers());

  it("rechaza a las 06:00 de Bogotá sin tocar el transporte", async () => {
    vi.setSystemTime(new Date("2026-10-19T11:00:00.000Z"));
    fakes.guard = "outside";

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "outside_bot_shift",
        message: "La IA atiende de 22:00 a 06:00 en America/Bogota",
      },
    });
    expect(fakes.sendText).not.toHaveBeenCalled();
  });

  it("envía a las 22:00 de Bogotá por el sender existente", async () => {
    vi.setSystemTime(new Date("2026-10-19T03:00:00.000Z"));

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ messageId: "msg_1" });
    expect(fakes.sendText).toHaveBeenCalledWith({
      conversationId: "cv_1",
      organizationId: "org_nexora",
      text: "Hola",
      aiGenerated: true,
    });
  });
});
