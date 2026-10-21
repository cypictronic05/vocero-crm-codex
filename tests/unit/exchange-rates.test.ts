import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { calculateConversion, divideDecimal, multiplyDecimal, parsePositiveDecimal, sameDecimal } from "@/server/exchange-rates/decimal";
import { parseExchangeRatesFlag } from "@/server/exchange-rates/flag";
import { roleCanManageExchangeRates } from "@/server/exchange-rates/service";
import { configureExchangeRateRouteSchema, createExchangeRateSchema } from "@/server/exchange-rates/validation";
import { requiredOperationForRoute } from "@/server/exchange-rates/rules";
import { appNavGroups } from "@/lib/nav";
import { resolveRateText, type CurrentRate } from "@/server/exchange-rates/conversation";

const valid = {
  routeId: "xrr_route", commercialRate: "3.68",
  validFrom: "2026-10-21T10:00:00.000Z", validUntil: null,
};

const currentRate: CurrentRate = {
  routeId: "xrr_1", quoteId: "xrq_1", originCountry: "CO", originCurrency: "COP",
  destinationCountry: "VE", destinationCurrency: "VES", active: true, version: 1,
  routeOperation: "divide", roundingPrecision: 2,
  sourceUnits: "3.680000000000", destinationUnits: "1.000000000000",
  commercialRate: "3.680000000000", calculationOperation: "divide", precision: 2,
  previewAmount: "100000", previewResult: "27173.91",
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

  it("valida tasa e intervalo sin pedir unidades ni fórmula diariamente", () => {
    expect(createExchangeRateSchema.safeParse(valid).success).toBe(true);
    expect(createExchangeRateSchema.safeParse({ ...valid, commercialRate: "0" }).success).toBe(false);
    expect(createExchangeRateSchema.safeParse({ ...valid, commercialRate: "-1" }).success).toBe(false);
    expect(createExchangeRateSchema.safeParse({ ...valid, validUntil: "2026-10-21T09:00:00.000Z" }).success).toBe(false);
  });

  it("fija las cuatro fórmulas comerciales y deja otras rutas al owner", () => {
    expect(requiredOperationForRoute("CO", "VE")).toBe("divide");
    expect(requiredOperationForRoute("VE", "CO")).toBe("multiply");
    expect(requiredOperationForRoute("PE", "VE")).toBe("multiply");
    expect(requiredOperationForRoute("CL", "VE")).toBe("multiply");
    expect(requiredOperationForRoute("EC", "VE")).toBeNull();
    const route = { originCountry: "CO", originCurrency: "COP", destinationCountry: "VE", destinationCurrency: "VES", operation: "divide", precision: 2 } as const;
    expect(configureExchangeRateRouteSchema.safeParse(route).success).toBe(true);
    expect(configureExchangeRateRouteSchema.safeParse({ ...route, operation: "multiply" }).success).toBe(false);
    expect(configureExchangeRateRouteSchema.safeParse({ ...route, originCurrency: "USD" }).success).toBe(false);
    expect(configureExchangeRateRouteSchema.safeParse({ ...route, originCountry: "ZZ" }).success).toBe(false);
  });

  it("calcula los ejemplos Nexora con decimal exacto y redondeo final half-up", () => {
    expect(calculateConversion("100000", "3.68", "divide", 2)).toBe("27173.91");
    expect(calculateConversion("100000", "2.90", "multiply", 2)).toBe("290000");
  });

  it("owner administra, supervisor requiere capacidad y member nunca administra", () => {
    expect(roleCanManageExchangeRates("owner", false)).toBe(true);
    expect(roleCanManageExchangeRates("supervisor", false)).toBe(false);
    expect(roleCanManageExchangeRates("supervisor", true)).toBe(true);
    expect(roleCanManageExchangeRates("member", true)).toBe(false);
  });

  it("resuelve IA con tasa vigente e importe sin confirmar operaciones", () => {
    const plain = resolveRateText("¿Cuál es la tasa de COP a VES?", [currentRate]);
    expect(plain?.kind).toBe("rate");
    expect(plain?.reply).toContain("COP ÷ 3.680000000000 → VES");
    const amount = resolveRateText("Quiero convertir 100000 COP a VES", [currentRate]);
    expect(amount?.reply).toContain("100000 COP ÷ 3.680000000000 = 27173.91 VES");
    expect(amount?.reply.toLowerCase()).not.toContain("transferencia confirmada");

    const venezuelaToColombia: CurrentRate = {
      ...currentRate,
      routeId: "xrr_ve_co", quoteId: "xrq_ve_co",
      originCountry: "VE", originCurrency: "VES",
      destinationCountry: "CO", destinationCurrency: "COP",
      routeOperation: "multiply", calculationOperation: "multiply",
      sourceUnits: "1.000000000000", destinationUnits: "2.900000000000",
      commercialRate: "2.900000000000", previewResult: "290000",
    };
    const reverseAmount = resolveRateText("Quiero convertir 100000 VES a COP", [venezuelaToColombia]);
    expect(reverseAmount?.reply).toContain("100000 VES × 2.900000000000 = 290000 COP");
    expect(reverseAmount?.reply).not.toContain("= 290000 VES");
  });

  it("pide datos, detecta ambigüedad y deja pendiente si no hay ruta", () => {
    expect(resolveRateText("¿Cuál es la tasa?", [currentRate])?.kind).toBe("clarification");
    const other: CurrentRate = { ...currentRate, routeId: "xrr_2", quoteId: "xrq_2", originCountry: "US" };
    expect(resolveRateText("Tasa COP a VES", [currentRate, other])?.kind).toBe("clarification");
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
    const correction = readFileSync("drizzle/0023_wealthy_ulik.sql", "utf8");
    expect(correction).toContain('ADD COLUMN "calculation_operation"');
    expect(correction).toContain('ADD COLUMN "rounding_precision"');
    expect(correction).not.toMatch(/\bUPDATE\b/i);
  });
});
