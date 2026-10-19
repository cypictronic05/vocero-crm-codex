import { describe, expect, it } from "vitest";
import {
  MEDIA_REVIEW_ACK,
  requiresHumanMediaReview,
} from "@/server/ai/media-safety";
import { buildAgentSystemPrompt } from "@/server/ai/prompts";

describe("revisión humana de imágenes y comprobantes", () => {
  it("intercepta imágenes y documentos entrantes", () => {
    expect(
      requiresHumanMediaReview([{ direction: "in", type: "image" }])
    ).toBe(true);
    expect(
      requiresHumanMediaReview([{ direction: "in", type: "document" }])
    ).toBe(true);
    expect(
      requiresHumanMediaReview([{ direction: "in", type: "text" }])
    ).toBe(false);
    expect(
      requiresHumanMediaReview([{ direction: "out", type: "image" }])
    ).toBe(false);
  });

  it("el acuse nunca afirma que el pago fue realizado", () => {
    expect(MEDIA_REVIEW_ACK).toContain("debe revisarlo");
    expect(MEDIA_REVIEW_ACK).toContain("no confirmamos pagos");
  });

  it("la instrucción del modelo conserva la misma regla dura", () => {
    const profile = {
      id: "ap_1",
      organizationId: "org_1",
      name: "Nexora",
      tone: null,
      instructions: null,
      escalationRules: null,
      greeting: null,
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const prompt = buildAgentSystemPrompt({
      profile,
      kb: [],
      stages: [{ name: "Nuevo" }],
    });
    expect(prompt).toContain("NUNCA confirmes un pago");
    expect(prompt).toContain("requieren revisión humana");
  });
});
