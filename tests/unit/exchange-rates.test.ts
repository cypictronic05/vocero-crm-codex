import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { calculateConversion, divideDecimal, multiplyDecimal, parsePositiveDecimal, sameDecimal } from "@/server/exchange-rates/decimal";
import { parseExchangeRatesFlag } from "@/server/exchange-rates/flag";
import { roleCanManageExchangeRates } from "@/server/exchange-rates/service";
import { bulkExchangeRateRoutesSchema, calculateExchangeRateSchema, configureExchangeRateRouteSchema, createExchangeRateSchema, previewExchangeRateSchema, updateExchangeRateCountrySchema } from "@/server/exchange-rates/validation";
import { requiredOperationForRoute } from "@/server/exchange-rates/rules";
import { buildExchangeRatePresentation, formatDecimalEs, normalizeLocalizedAmount } from "@/server/exchange-rates/presentation";
import { appNavGroups } from "@/lib/nav";
import { isExchangeRateIntent, resolveRateText, type CurrentRate } from "@/server/exchange-rates/conversation";
import { REMITTANCE_COUNTRIES, VERIFIED_REMITTANCE_ROUTES, findExplicitCatalogDirection } from "@/server/exchange-rates/catalog";

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

  it("publica el catálogo exacto de ocho países y mantiene separados EC y US aunque compartan USD", () => {
    expect(REMITTANCE_COUNTRIES.map((country) => `${country.code}/${country.currency}`)).toEqual([
      "VE/VES", "CO/COP", "CL/CLP", "PE/PEN", "EC/USD", "US/USD", "BR/BRL", "MX/MXN",
    ]);
    expect(new Set(REMITTANCE_COUNTRIES.map((country) => country.code)).size).toBe(8);
    expect(REMITTANCE_COUNTRIES.every((country) => country.flag && country.name)).toBe(true);
    expect(VERIFIED_REMITTANCE_ROUTES.map((route) => `${route.originCountry}:${route.destinationCountry}:${route.operation}`)).toEqual([
      "CO:VE:divide", "VE:CO:multiply", "PE:VE:multiply", "CL:VE:multiply",
    ]);
  });

  it("valida habilitación de países y lotes direccionales sin aceptar combinaciones inventadas", () => {
    expect(updateExchangeRateCountrySchema.safeParse({ countryCode: "BR", enabled: true }).success).toBe(true);
    expect(updateExchangeRateCountrySchema.safeParse({ countryCode: "AR", enabled: true }).success).toBe(false);
    expect(bulkExchangeRateRoutesSchema.safeParse({ dryRun: true, routes: [{ originCountry: "MX", destinationCountry: "CL" }] }).success).toBe(true);
    expect(bulkExchangeRateRoutesSchema.safeParse({ dryRun: true, routes: [{ originCountry: "EC", destinationCountry: "US" }] }).success).toBe(true);
    expect(bulkExchangeRateRoutesSchema.safeParse({ dryRun: false, routes: [{ originCountry: "MX", destinationCountry: "MX" }] }).success).toBe(false);
  });

  it("calcula los ejemplos Nexora con decimal exacto y redondeo final half-up", () => {
    expect(calculateConversion("100000", "3.68", "divide", 2)).toBe("27173.91");
    expect(calculateConversion("100000", "2.90", "multiply", 2)).toBe("290000");
  });

  it("presenta importes comerciales legibles sin perder precisión", () => {
    expect(formatDecimalEs("3.680000000000")).toBe("3,68");
    expect(formatDecimalEs("27173.910000")).toBe("27.173,91");
    expect(normalizeLocalizedAmount("100.000,50")).toBe("100000.50");
    expect(calculateExchangeRateSchema.parse({ routeId: "xrr_1", amount: "100.000" }).amount).toBe("100000");
    expect(previewExchangeRateSchema.safeParse({ routeId: "xrr_1", commercialRate: "3,68", amount: "100000" }).success).toBe(true);
    const presentation = buildExchangeRatePresentation({ ...currentRate, calculationOperation: "divide" });
    expect(presentation.formula).toBe("100.000 COP ÷ 3,68 = 27.173,91 VES");
    expect(presentation.customerMessage).toContain("La tasa de hoy es *3,68*");
    expect(presentation.customerMessage).not.toMatch(/2026-|precision|Operación autorizada/i);
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
    expect(plain?.reply).toContain("100.000 COP ÷ 3,68 = *27.173,91 VES*");
    const amount = resolveRateText("Quiero convertir 100.000 COP a VES", [currentRate]);
    expect(amount?.reply).toContain("100.000 COP ÷ 3,68 = *27.173,91 VES*");
    expect(amount?.reply.toLowerCase()).not.toContain("transferencia confirmada");
    expect(amount?.reply).not.toMatch(/2026-|precision|quote|operation/i);

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
    expect(reverseAmount?.reply).toContain("100.000 VES × 2,9 = *290.000 COP*");
    expect(reverseAmount?.reply).not.toContain("= *290.000 VES*");
  });

  it("interpreta importes naturales y usa la ruta reciente sin consultar al LLM", () => {
    const context = ["La ruta que necesito es Colombia a Venezuela"];
    expect(isExchangeRateIntent("¿Cuánto son 50 mil pesos?")).toBe(true);
    expect(resolveRateText("¿Cuánto son 50 mil pesos?", [currentRate], context)?.reply)
      .toContain("50.000 COP ÷ 3,68 = *13.586,96 VES*");
    expect(resolveRateText("100 mil COP", [currentRate])?.reply)
      .toContain("100.000 COP ÷ 3,68 = *27.173,91 VES*");
    expect(resolveRateText("50000 pesos colombianos", [currentRate])?.reply)
      .toContain("50.000 COP ÷ 3,68 = *13.586,96 VES*");
    expect(resolveRateText("¿Cuánto recibe mi familiar si envío 200 mil?", [currentRate], context)?.reply)
      .toContain("200.000 COP ÷ 3,68 = *54.347,83 VES*");
  });

  it("reconoce dólares y solicita datos concretos cuando no puede fijar ruta o importe", () => {
    const usdRate: CurrentRate = {
      ...currentRate,
      routeId: "xrr_us_co", quoteId: "xrq_us_co",
      originCountry: "US", originCurrency: "USD",
      destinationCountry: "CO", destinationCurrency: "COP",
      routeOperation: "multiply", calculationOperation: "multiply",
      commercialRate: "4000.000000000000", previewResult: "400000000",
    };
    expect(resolveRateText("100 dólares", [usdRate])?.reply)
      .toContain("100 USD × 4.000 = *400.000 COP*");
    expect(resolveRateText("¿Cuánto recibe mi familiar si envío?", [currentRate])?.reply)
      .toContain("¿Qué cantidad deseas enviar");
    expect(resolveRateText("Quiero convertir 0 COP a VES", [currentRate])?.reply)
      .toContain("importe positivo válido");
  });

  it("no infiere pesos ambiguos y el contexto solo desambigua una ruta vigente", () => {
    const chileRate: CurrentRate = {
      ...currentRate,
      routeId: "xrr_cl_ve", quoteId: "xrq_cl_ve",
      originCountry: "CL", originCurrency: "CLP",
      routeOperation: "multiply", calculationOperation: "multiply",
      commercialRate: "0.040000000000", previewResult: "4000",
    };
    const rates = [currentRate, chileRate];
    expect(resolveRateText("¿Cuánto son 50 mil pesos?", rates)?.kind).toBe("clarification");
    expect(resolveRateText("¿Cuánto son 50 mil pesos?", rates, ["Colombia a Venezuela"])?.reply)
      .toContain("50.000 COP ÷ 3,68 = *13.586,96 VES*");
    expect(resolveRateText("¿Cuánto son 50 mil pesos?", rates, ["Chile a Venezuela"])?.reply)
      .toContain("50.000 CLP × 0,04 = *2.000 VES*");
  });

  it("prioriza países explícitos y declara indisponible una ruta sin tasa", () => {
    expect(findExplicitCatalogDirection("Quiero enviar desde Brasil a Venezuela")).toEqual({ originCountry: "BR", destinationCountry: "VE" });
    expect(isExchangeRateIntent("Quiero enviar desde Brasil a Venezuela.")).toBe(true);
    expect(resolveRateText("¿Cuál es la tasa de México a Chile?", [currentRate], ["Colombia a Venezuela"])?.reply)
      .toBe("🇲🇽 México → 🇨🇱 Chile\n\n¡Hola! 👋 Por el momento no tengo una tasa disponible para esta ruta.");
    expect(resolveRateText("¿Cuál es la tasa de Colombia a Venezuela?", [currentRate], ["México a Chile"])?.kind).toBe("rate");
  });

  it("la ruta explícita actual invalida la anterior y nunca usa una tasa inversa", () => {
    const previousContext = ["¿Cuál es la tasa de Venezuela a Colombia?"];
    const peru = resolveRateText("¿Cuál es la tasa de Perú a Venezuela?", [currentRate], previousContext);
    expect(peru).toMatchObject({
      kind: "pending",
      pendingDirection: { originCountry: "PE", destinationCountry: "VE" },
    });
    expect(peru?.reply).toBe(
      "🇵🇪 Perú → 🇻🇪 Venezuela\n\n¡Hola! 👋 Por el momento no tengo una tasa disponible para esta ruta."
    );
    expect(peru?.reply).not.toContain("3,68");

    const reverseOnly: CurrentRate = {
      ...currentRate,
      originCountry: "VE",
      originCurrency: "VES",
      destinationCountry: "CO",
      destinationCurrency: "COP",
    };
    expect(resolveRateText("¿Cuál es la tasa de Colombia a Venezuela?", [reverseOnly])?.kind).toBe("pending");
  });

  it("cambia entre rutas del catálogo sin arrastrar cotizaciones previas", () => {
    const chile: CurrentRate = {
      ...currentRate,
      routeId: "xrr_cl_ve",
      quoteId: "xrq_cl_ve",
      originCountry: "CL",
      originCurrency: "CLP",
      routeOperation: "multiply",
      calculationOperation: "multiply",
      commercialRate: "0.04",
    };
    expect(resolveRateText("¿Cuál es la tasa de Chile a Venezuela?", [currentRate, chile])?.kind).toBe("rate");
    const unavailable = resolveRateText(
      "¿Cuál es la tasa de Ecuador a México?",
      [currentRate, chile],
      ["Chile a Venezuela", "Colombia a Venezuela"]
    );
    expect(unavailable?.kind).toBe("pending");
    expect(unavailable?.reply).toContain("🇪🇨 Ecuador → 🇲🇽 México");
    expect(unavailable?.reply).not.toMatch(/3,68|0,04/);
  });

  it("resuelve el cálculo antes del LLM y termina el turno para no duplicar respuestas", () => {
    const pipeline = readFileSync("src/server/ai/pipeline.ts", "utf8");
    const trigger = readFileSync("src/server/ai/trigger.ts", "utf8");
    const resolver = pipeline.indexOf("await resolveRateConversation");
    const retorno = pipeline.indexOf("return leido;", resolver);
    const modelo = pipeline.indexOf("await chatJson", resolver);
    expect(resolver).toBeGreaterThan(-1);
    expect(retorno).toBeGreaterThan(resolver);
    expect(modelo).toBeGreaterThan(retorno);
    expect(trigger).toContain("isExchangeRateIntent(messageText)");
    expect(trigger).toContain("organizationRatesEnabled(organizationId)");
    expect(trigger.indexOf('messageType === "audio"')).toBeLessThan(trigger.indexOf("despachoActivo()"));
  });

  it("la selección limpia la cotización y descarta respuestas HTTP antiguas", () => {
    const source = readFileSync("src/components/exchange-rates/exchange-rates-client.tsx", "utf8");
    expect(source).toContain("selectionAbort.current?.abort()");
    expect(source).toContain("sequence !== selectionSequence.current");
    expect(source).toContain("destinationCodes.has(country.code)");
    expect(source).toContain('key={country.code}');
    expect(source.indexOf("clearQuote();")).toBeLessThan(source.indexOf("/api/exchange-rates/selection"));
    expect(source).not.toMatch(/Number\([^)]*(commercialRate|displayRate|amount)/);
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
    expect(source).toMatch(/scoped\(\s*schema\.exchangeRateCountry\.organizationId/);
    const catalogRoute = readFileSync("src/app/api/exchange-rates/catalog/route.ts", "utf8");
    expect(catalogRoute.match(/session\.role !== "owner"/g)).toHaveLength(2);
    const migration = readFileSync("drizzle/0022_magenta_korath.sql", "utf8");
    for (const table of ["exchange_rate_route", "exchange_rate_quote", "exchange_rate_audit_event", "exchange_rate_request"]) {
      expect(migration).toContain(`CREATE TABLE "${table}"`);
      expect(migration).toContain(`"organization_id" text NOT NULL`);
    }
    const correction = readFileSync("drizzle/0023_wealthy_ulik.sql", "utf8");
    expect(correction).toContain('ADD COLUMN "calculation_operation"');
    expect(correction).toContain('ADD COLUMN "rounding_precision"');
    expect(correction).not.toMatch(/\bUPDATE\b/i);
    const catalogMigration = readFileSync("drizzle/0024_clever_molecule_man.sql", "utf8");
    expect(catalogMigration).toContain('CREATE TABLE "exchange_rate_country"');
    expect(catalogMigration).not.toMatch(/exchange_rate_quote.*(?:UPDATE|DELETE)|exchange_rate_route.*(?:UPDATE|DELETE)/is);
  });
});
