import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("superficie multi-tenant deshabilitada", () => {
  it("no instala el plugin que expone /organization/create", () => {
    const source = readFileSync("src/lib/auth/index.ts", "utf8");
    expect(source).not.toContain('from "better-auth/plugins"');
    expect(source).not.toContain("organization({");
    expect(source).toContain("await enforceSignupPolicy(ctx.path)");
  });
});
