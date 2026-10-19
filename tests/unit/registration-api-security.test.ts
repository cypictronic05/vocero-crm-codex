import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ allowed: false, checks: 0 }));

vi.mock("@/server/auth/registration", () => ({
  isPublicSignupAllowed: async () => {
    state.checks += 1;
    return state.allowed;
  },
}));

import { enforceSignupPolicy, runInternalSignup } from "@/lib/auth";

beforeEach(() => {
  state.allowed = false;
  state.checks = 0;
});

describe("gate del endpoint real de Better Auth", () => {
  it("rechaza por API el alta pública cuando el modo está cerrado", async () => {
    await expect(enforceSignupPolicy("/sign-up/email")).rejects.toThrow(
      "El registro público está cerrado",
    );
    expect(state.checks).toBe(1);
  });

  it("solo el contexto server-side puede atravesar el cierre", async () => {
    await expect(
      runInternalSignup(() => enforceSignupPolicy("/sign-up/email")),
    ).resolves.toBeUndefined();
    expect(state.checks).toBe(0);
  });

  it("no afecta el inicio de sesión y permite el bootstrap autorizado", async () => {
    await expect(enforceSignupPolicy("/sign-in/email")).resolves.toBeUndefined();
    state.allowed = true;
    await expect(enforceSignupPolicy("/sign-up/email")).resolves.toBeUndefined();
    expect(state.checks).toBe(1);
  });
});
