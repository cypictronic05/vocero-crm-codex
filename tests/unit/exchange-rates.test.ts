import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { divideDecimal, multiplyDecimal, parsePositiveDecimal, sameDecimal } from "@/server/exchange-rates/decimal";
import { parseExchangeRatesFlag } from "@/server/exchange-rates/flag";
import { roleCanManageExchangeRates } from "@/server/exchange-rates/service";
import { createExchangeRateSchema } from "@/server/exchange-rates/validation";
import { appNavGroups } from "@/lib/nav";
import { resolveRateText, type CurrentRate } from "@/server/exchange-rates/conversation";

const valid = {
  originCountry: "CO", originCurrency: "USD", destinationCountry: "VE", destinationCurrency: "VES",
  sourceUnits: "1", destinationUnits: "39.123456789012", commercialRate: "39.123456789012",
  precision: 2, validFrom: "2026-10-21T10:00:00.000Z", validUntil: null,
};

const currentRate: CurrentRate = {
  routeId: "xrr_1", quoteId: "xrq_1", originCountry: "CO", originCurrency: "USD",
  destinationCountry: "VE", destinationCurrency: "VES", active: true, version: 1,
  sourceUnits: "1.000000000000", destinationUnits: "39.120000000000",
  commercialRate: "39.120000000000", precision: 2,
  validFrom: new Date("2026-10-21T10:00:00Z"), validUntil: null,
  status: "published", createdByUserId: "usr_owner", publishedByUserId: "usr_owner",
  createdByName: "Owner", publishedByName: "Owner",
  createdAt: new Date("2026-10-21T09:00:00Z"), publishedAt: new Date("2026-10-21T09:30:00Z"),
};

describe("tasas de cambio", () => {
  it("calcula y redondea sin punto flotante", () => {
    expect(divideDecimal("39.123456789012", "1", 12)).toBe("39.123456789012");
    expect(multiplyDecimal("100.10", "39.123456789012", 2)).toBe("3916.26");
    expect(multiplyDecimal("1", "1.005", 2)).toBe("1.01");
    expect(sameDecimal("39.1200", "39.12")).toBe(true);
    expect(() => parsePositiveDecimal("0")).toThrow();
    expect(() => parsePositiveDecimal("-1")).toThrow();
  });

  it("valida unidades, intervalo, códigos y precisión", () => {
    expect(createExchangeRateSchema.safeParse(valid).success).toBe(true);
    expect(createExchangeRateSchema.safeParse({ ...valid, sourceUnits: "0" }).success).toBe(false);
    expect(createExchangeRateSchema.safeParse({ ...valid, precision: 13 }).success).toBe(false);
    expect(createExchangeRateSchema.safeParse({ ...valid, destinationCurrency: "USD", destinationCountry: "CO" }).success).toBe(false);
    expect(createExchangeRateSchema.safeParse({ ...valid, originCountry: "ZZ" }).success).toBe(false);
    expect(createExchangeRateSchema.safeParse({ ...valid, originCurrency: "ZZZ" }).success).toBe(false);
    expect(createExchangeRateSchema.safeParse({ ...valid, validUntil: "2026-10-21T09:00:00.000Z" }).success).toBe(false);
  });

  it("trata las rutas inversas como entradas distintas", () => {
    const reverse = { ...valid, originCountry: "VE", originCurrency: "VES", destinationCountry: "CO", destinationCurrency: "USD", destinationUnits: "0.025", commercialRate: "0.025" };
    expect(createExchangeRateSchema.safeParse(reverse).success).toBe(true);
    expect(reverse.originCurrency).not.toBe(valid.originCurrency);
  });

  it("owner administra, supervisor requiere capacidad y member nunca administra", () => {
    expect(roleCanManageExchangeRates("owner", false)).toBe(true);
    expect(roleCanManageExchangeRates("supervisor", false)).toBe(false);
    expect(roleCanManageExchangeRates("supervisor", true)).toBe(true);
    expect(roleCanManageExchangeRates("member", true)).toBe(false);
  });

  it("resuelve IA con tasa vigente e importe sin confirmar operaciones", () => {
    const plain = resolveRateText("¿Cuál es la tasa de USD a VES?", [currentRate]);
    expect(plain?.kind).toBe("rate");
    expect(plain?.reply).toContain("1.000000000000 USD = 39.120000000000 VES");
    const amount = resolveRateText("Quiero convertir 100.10 USD a VES", [currentRate]);
    expect(amount?.reply).toContain("3915.91 VES");
    expect(amount?.reply.toLowerCase()).not.toContain("transferencia confirmada");
  });

  it("pide datos, detecta ambigüedad y deja pendiente si no hay ruta", () => {
    expect(resolveRateText("¿Cuál es la tasa?", [currentRate])?.kind).toBe("clarification");
    const other: CurrentRate = { ...currentRate, routeId: "xrr_2", quoteId: "xrq_2", originCountry: "US" };
    expect(resolveRateText("Tasa USD a VES", [currentRate, other])?.kind).toBe("clarification");
    expect(resolveRateText("Tasa EUR a COP", [])?.kind).toBe("pending");
  });

  it("la bandera es fail-closed y el menú solo aparece cuando el servidor la habilita", () => {
    expect(parseExchangeRatesFlag(undefined)).toBe(false);
    expect(parseExchangeRatesFlag("on")).toBe(true);
    expect(appNavGroups({ role: "member" }).flatMap((group) => group.items).map((item) => item.href)).not.toContain("/exchange-rates");
    expect(appNavGroups({ role: "member", rates: true }).flatMap((group) => group.items).map((item) => item.href)).toContain("/exchange-rates");
  });

  it("todas las consultas de dominio declaran el alcance organizacional", () => {
    const source = readFileSync("src/server/exchange-rates/service.ts", "utf8");
    expect(source).toMatch(/scoped\(\s*schema\.exchangeRateRoute\.organizationId/);
    expect(source).toMatch(/scoped\(\s*schema\.exchangeRateQuote\.organizationId/);
    expect(source).toMatch(/scoped\(\s*schema\.member\.organizationId/);
    const migration = readFileSync("drizzle/0022_magenta_korath.sql", "utf8");
    for (const table of ["exchange_rate_route", "exchange_rate_quote", "exchange_rate_audit_event", "exchange_rate_request"]) {
      expect(migration).toContain(`CREATE TABLE "${table}"`);
      expect(migration).toContain(`"organization_id" text NOT NULL`);
    }
  });
});
