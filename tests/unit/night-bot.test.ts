import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isNightBotActive } from "@/lib/night-bot";

describe("bot nocturno de Nexora en America/Bogota", () => {
  it("incluye las 22:00 y excluye las 06:00", () => {
    expect(isNightBotActive(new Date("2026-10-19T02:59:59.000Z"))).toBe(false);
    expect(isNightBotActive(new Date("2026-10-19T03:00:00.000Z"))).toBe(true);
    expect(isNightBotActive(new Date("2026-10-19T10:59:59.000Z"))).toBe(true);
    expect(isNightBotActive(new Date("2026-10-19T11:00:00.000Z"))).toBe(false);
  });

  it("no depende del día UTC ni del huso del proceso", () => {
    // En UTC ya es lunes, pero en Bogotá siguen siendo las 23:30 del domingo.
    expect(isNightBotActive(new Date("2026-10-19T04:30:00.000Z"))).toBe(true);
    expect(isNightBotActive(new Date("2026-10-19T17:00:00.000Z"))).toBe(false);
  });
});

describe("guardas del turno nocturno", () => {
  it("filtra antes de encolar y revalida agente y despacho", () => {
    const trigger = readFileSync("src/server/ai/trigger.ts", "utf8");
    const pipeline = readFileSync("src/server/ai/pipeline.ts", "utf8");
    const worker = readFileSync("src/server/dispatch/worker.ts", "utf8");

    expect(trigger.indexOf("isNightBotActive(at)")).toBeLessThan(
      trigger.indexOf("despachoActivo()")
    );
    expect(pipeline).toContain("!conversation.isTest");
    expect(pipeline.match(/isNightBotActive/g)?.length).toBeGreaterThanOrEqual(3);
    expect(worker).toContain('descartarDespacho(fila, "terminó el turno nocturno")');
  });

  it("rechaza el envío tardío del cerebro antes del transporte", () => {
    const route = readFileSync(
      "src/app/api/bot/messages/route.ts",
      "utf8"
    );
    expect(route).toContain('"outside_bot_shift"');
    expect(route.indexOf("isNightBotActive()")).toBeLessThan(
      route.indexOf("await sendText(")
    );
  });
});
