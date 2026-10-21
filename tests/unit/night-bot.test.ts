import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  currentNightWindowStart,
  isNightBotActive,
} from "@/lib/night-bot";

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

  it("calcula el comienzo de la ventana que debe recuperarse tras reiniciar", () => {
    expect(
      currentNightWindowStart(
        new Date("2026-10-19T04:30:45.123Z")
      )?.toISOString()
    ).toBe("2026-10-19T03:00:00.000Z");
    expect(
      currentNightWindowStart(
        new Date("2026-10-20T09:15:00.000Z")
      )?.toISOString()
    ).toBe("2026-10-20T03:00:00.000Z");
    expect(currentNightWindowStart(new Date("2026-10-19T17:00:00.000Z"))).toBeNull();
  });
});

describe("guardas del turno nocturno", () => {
  it("filtra antes de encolar y revalida agente y despacho", () => {
    const trigger = readFileSync("src/server/ai/trigger.ts", "utf8");
    const pipeline = readFileSync("src/server/ai/pipeline.ts", "utf8");
    const worker = readFileSync("src/server/dispatch/worker.ts", "utf8");

    expect(trigger.indexOf("isAiScheduleActive(schedule, at)")).toBeLessThan(
      trigger.indexOf("despachoActivo()")
    );
    expect(pipeline).toContain("!conversation.isTest");
    expect(pipeline).toContain("withAiConversationSendLock");
    expect(worker).toContain("isAiScheduleActive(scheduleFromOrganization(conv))");
    expect(worker).toContain('descartarDespacho(fila, "terminó el turno nocturno")');
    expect(readFileSync("src/instrumentation-node.ts", "utf8")).toContain(
      "resumePendingNightTurns"
    );
  });

  it("rechaza el envío tardío del cerebro antes del transporte", () => {
    const route = readFileSync(
      "src/app/api/bot/messages/route.ts",
      "utf8"
    );
    expect(route).toContain("AiSendGuardError");
    expect(route).toContain("withAiConversationSendLock({");
    expect(route.indexOf("withAiConversationSendLock({")).toBeLessThan(
      route.indexOf("sendText({")
    );
  });
});
