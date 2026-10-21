import type { CalculationOperation } from "@/server/exchange-rates/decimal";

const FIXED_ROUTES = new Map<string, { operation: CalculationOperation; originCurrency: string; destinationCurrency: string }>([
  ["VE:CO", { operation: "multiply", originCurrency: "VES", destinationCurrency: "COP" }],
  ["CO:VE", { operation: "divide", originCurrency: "COP", destinationCurrency: "VES" }],
  ["PE:VE", { operation: "multiply", originCurrency: "PEN", destinationCurrency: "VES" }],
  ["CL:VE", { operation: "multiply", originCurrency: "CLP", destinationCurrency: "VES" }],
]);

/** Reglas confirmadas por Nexora; las demás rutas las decide el owner. */
export function requiredOperationForRoute(
  originCountry: string,
  destinationCountry: string
): CalculationOperation | null {
  return FIXED_ROUTES.get(`${originCountry}:${destinationCountry}`)?.operation ?? null;
}

export function operationMatchesCommercialRule(input: {
  originCountry: string;
  originCurrency: string;
  destinationCountry: string;
  destinationCurrency: string;
  operation: CalculationOperation;
}): boolean {
  const required = FIXED_ROUTES.get(`${input.originCountry}:${input.destinationCountry}`);
  return required === undefined || (
    required.operation === input.operation &&
    required.originCurrency === input.originCurrency &&
    required.destinationCurrency === input.destinationCurrency
  );
}
