import { divideDecimal, type CalculationOperation } from "@/server/exchange-rates/decimal";
import { REMITTANCE_COUNTRIES } from "@/server/exchange-rates/catalog";

export const INITIAL_RATE_SOURCE = "remesascypictroniclat-export.json · 22-10-2026";

type CurrencyFactor = {
  sourceCurrency: string;
  destinationCurrency: string;
  factor: string;
  sourceKey: string;
};

export type PreloadedRoute = {
  originCountry: string;
  originCurrency: string;
  destinationCountry: string;
  destinationCurrency: string;
  operation: CalculationOperation;
  precision: number;
  draftRate: string | null;
  sourceKey: string | null;
  sourceValue: string | null;
};

const FACTORS: readonly CurrencyFactor[] = [
  { sourceCurrency: "BRL", destinationCurrency: "CLP", factor: "140", sourceKey: "fBRL_CLP" },
  { sourceCurrency: "BRL", destinationCurrency: "COP", factor: "635", sourceKey: "fBRL_COP" },
  { sourceCurrency: "BRL", destinationCurrency: "MXN", factor: "2.97", sourceKey: "fBRL_MXN" },
  { sourceCurrency: "BRL", destinationCurrency: "PEN", factor: "0.56", sourceKey: "fBRL_PEN" },
  { sourceCurrency: "BRL", destinationCurrency: "USD", factor: "0.1500", sourceKey: "fBRL_USD" },
  { sourceCurrency: "CLP", destinationCurrency: "BRL", factor: "0.0041", sourceKey: "fCLP_BRL" },
  { sourceCurrency: "CLP", destinationCurrency: "COP", factor: "3", sourceKey: "fCLP_COP" },
  { sourceCurrency: "CLP", destinationCurrency: "MXN", factor: "0.01700", sourceKey: "fCLP_MXN" },
  { sourceCurrency: "CLP", destinationCurrency: "PEN", factor: "0.0033", sourceKey: "fCLP_PEN" },
  { sourceCurrency: "CLP", destinationCurrency: "USD", factor: "0.0009803", sourceKey: "fCLP_USD" },
  { sourceCurrency: "COP", destinationCurrency: "BRL", factor: "0.00125", sourceKey: "fCOP_BRL" },
  { sourceCurrency: "COP", destinationCurrency: "CLP", factor: "0.21", sourceKey: "fCOP_CLP" },
  { sourceCurrency: "COP", destinationCurrency: "MXN", factor: "0.00320", sourceKey: "fCOP_MXN" },
  { sourceCurrency: "COP", destinationCurrency: "PEN", factor: "0.00083333", sourceKey: "fCOP_PEN" },
  { sourceCurrency: "COP", destinationCurrency: "USD", factor: "0.00020", sourceKey: "fCOP_USD" },
  { sourceCurrency: "MXN", destinationCurrency: "BRL", factor: "0.24", sourceKey: "fMXN_BRL" },
  { sourceCurrency: "MXN", destinationCurrency: "CLP", factor: "39.50", sourceKey: "fMXN_CLP" },
  { sourceCurrency: "MXN", destinationCurrency: "COP", factor: "170", sourceKey: "fMXN_COP" },
  { sourceCurrency: "MXN", destinationCurrency: "PEN", factor: "0.152", sourceKey: "fMXN_PEN" },
  { sourceCurrency: "MXN", destinationCurrency: "USD", factor: "0.041", sourceKey: "fMXN_USD" },
  { sourceCurrency: "PEN", destinationCurrency: "BRL", factor: "1.35", sourceKey: "fPEN_BRL" },
  { sourceCurrency: "PEN", destinationCurrency: "CLP", factor: "240", sourceKey: "fPEN_CLP" },
  { sourceCurrency: "PEN", destinationCurrency: "COP", factor: "840", sourceKey: "fPEN_COP" },
  { sourceCurrency: "PEN", destinationCurrency: "MXN", factor: "4.0", sourceKey: "fPEN_MXN" },
  { sourceCurrency: "PEN", destinationCurrency: "USD", factor: "0.2631578", sourceKey: "fPEN_USD" },
  { sourceCurrency: "USD", destinationCurrency: "BRL", factor: "4", sourceKey: "fUSD_BRL" },
  { sourceCurrency: "USD", destinationCurrency: "CLP", factor: "820", sourceKey: "fUSD_CLP" },
  { sourceCurrency: "USD", destinationCurrency: "COP", factor: "2850", sourceKey: "fUSD_COP" },
  { sourceCurrency: "USD", destinationCurrency: "MXN", factor: "15", sourceKey: "fUSD_MXN" },
  { sourceCurrency: "USD", destinationCurrency: "PEN", factor: "2.9", sourceKey: "fUSD_PEN" },
  { sourceCurrency: "USD", destinationCurrency: "USD", factor: "0.95", sourceKey: "fUSD_USD" },
] as const;

const VENEZUELA_FACTORS = new Map<string, { factor: string; sourceKey: string }>([
  ["BRL", { factor: "179", sourceKey: "tasaBRL" }],
  ["CLP", { factor: "0.94", sourceKey: "tasaCLP" }],
  ["COP", { factor: "0.2702702", sourceKey: "tasaCOP" }],
  ["MXN", { factor: "42", sourceKey: "tasaMXN" }],
  ["PEN", { factor: "270", sourceKey: "tasaPEN" }],
  ["USD", { factor: "910", sourceKey: "tasaUSD" }],
]);

/**
 * Construye las 56 direcciones del catálogo. Los factores del JSON son siempre
 * multiplicativos. CO→VE se conserva como tasa comercial divisoria: el valor
 * crudo queda en la auditoría y la cotización guarda su inverso con 12 decimales.
 */
export function buildInitialRemittanceRoutes(): PreloadedRoute[] {
  return REMITTANCE_COUNTRIES.flatMap((origin) =>
    REMITTANCE_COUNTRIES.filter((destination) => destination.code !== origin.code).map((destination) => {
      let factor = FACTORS.find((candidate) =>
        candidate.sourceCurrency === origin.currency &&
        candidate.destinationCurrency === destination.currency
      ) ?? null;

      if (destination.code === "VE") {
        const venezuelaFactor = VENEZUELA_FACTORS.get(origin.currency);
        factor = venezuelaFactor ? {
          sourceCurrency: origin.currency,
          destinationCurrency: destination.currency,
          factor: venezuelaFactor.factor,
          sourceKey: venezuelaFactor.sourceKey,
        } : null;
      }

      const commercialDivide = origin.code === "CO" && destination.code === "VE";
      return {
        originCountry: origin.code,
        originCurrency: origin.currency,
        destinationCountry: destination.code,
        destinationCurrency: destination.currency,
        operation: commercialDivide ? "divide" : "multiply",
        precision: 2,
        draftRate: factor
          ? commercialDivide
            ? divideDecimal("1", factor.factor, 12)
            : factor.factor
          : null,
        sourceKey: factor?.sourceKey ?? null,
        sourceValue: factor?.factor ?? null,
      } satisfies PreloadedRoute;
    })
  );
}

export const INITIAL_REMITTANCE_ROUTES = buildInitialRemittanceRoutes();
