import { describe, expect, it, vi } from "vitest";

/** Registro cerrado por defecto; bootstrap solo sirve para el primer owner. */

const state = vi.hoisted(() => ({ orgCount: 0, mode: "closed" as "closed" | "bootstrap" }));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => Promise.resolve([{ n: state.orgCount }]),
    }),
  }),
  schema: { organization: {} },
}));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({ REGISTRATION_MODE: state.mode }),
}));

import { isPublicSignupAllowed } from "@/server/auth/registration";

describe("registro público cerrado", () => {
  it("closed bloquea incluso una instancia completamente vacía", async () => {
    state.orgCount = 0;
    state.mode = "closed";
    expect(await isPublicSignupAllowed()).toBe(false);
  });

  it("bootstrap permite exclusivamente el primer propietario", async () => {
    state.orgCount = 0;
    state.mode = "bootstrap";
    expect(await isPublicSignupAllowed()).toBe(true);
  });

  it("bootstrap se cierra cuando ya existe una organización", async () => {
    state.orgCount = 1;
    state.mode = "bootstrap";
    expect(await isPublicSignupAllowed()).toBe(false);
  });

  it("la variable heredada ALLOW_SIGNUP ya no reabre el registro", async () => {
    state.orgCount = 0;
    state.mode = "closed";
    vi.stubEnv("ALLOW_SIGNUP", "true");
    expect(await isPublicSignupAllowed()).toBe(false);
  });
});
