import { z } from "zod";
import { isIsoCountryCode, isIsoCurrencyCode } from "@/lib/iso";
import { operationMatchesCommercialRule } from "@/server/exchange-rates/rules";
import { normalizeLocalizedAmount } from "@/server/exchange-rates/presentation";
import { REMITTANCE_COUNTRIES } from "@/server/exchange-rates/catalog";

const canonicalPositiveDecimal = z.string().trim().regex(/^\+?(?:0*[1-9]\d*)(?:\.\d{1,12})?$|^\+?0*\.\d*[1-9]\d*$/, "Debe ser un decimal positivo con hasta 12 decimales");
const positiveRateDecimal = z.string().trim()
  .transform((value) => value.replace(",", "."))
  .pipe(canonicalPositiveDecimal);
const localizedPositiveAmount = z.string().trim().min(1).max(64).transform((value, ctx) => {
  try {
    return normalizeLocalizedAmount(value);
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Escribe un importe positivo válido" });
    return z.NEVER;
  }
});
const country = z.string().trim().toUpperCase()
  .regex(/^[A-Z]{2}$/, "Usa país ISO de dos letras")
  .refine(isIsoCountryCode, "El país no pertenece a ISO 3166-1");
const currency = z.string().trim().toUpperCase()
  .regex(/^[A-Z]{3}$/, "Usa moneda ISO de tres letras")
  .refine(isIsoCurrencyCode, "La moneda no pertenece a ISO 4217");
const catalogCountry = country.refine(
  (value) => REMITTANCE_COUNTRIES.some((candidate) => candidate.code === value),
  "El país no pertenece al catálogo de remesas"
);

export const exchangeRateOperationSchema = z.enum(["multiply", "divide"]);

export const configureExchangeRateRouteSchema = z.object({
  originCountry: country,
  originCurrency: currency,
  destinationCountry: country,
  destinationCurrency: currency,
  operation: exchangeRateOperationSchema,
  precision: z.number().int().min(0).max(12),
}).superRefine((value, ctx) => {
  if (value.originCountry === value.destinationCountry && value.originCurrency === value.destinationCurrency) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["destinationCurrency"], message: "Origen y destino no pueden ser iguales" });
  }
  if (!operationMatchesCommercialRule(value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["operation"], message: "La moneda o la operación contradice la regla comercial confirmada para esta ruta" });
  }
});

export const createExchangeRateSchema = z.object({
  routeId: z.string().min(1),
  commercialRate: positiveRateDecimal,
  validFrom: z.string().datetime({ offset: true }),
  validUntil: z.string().datetime({ offset: true }).nullable(),
}).superRefine((value, ctx) => {
  if (value.validUntil && new Date(value.validUntil) <= new Date(value.validFrom)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["validUntil"], message: "Debe ser posterior a validFrom" });
  }
});

export const calculateExchangeRateSchema = z.object({
  routeId: z.string().min(1),
  amount: localizedPositiveAmount,
});

export const previewExchangeRateSchema = z.object({
  routeId: z.string().min(1),
  commercialRate: positiveRateDecimal,
  amount: localizedPositiveAmount,
});

export const exchangeRateSettingsSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("module"), enabled: z.boolean() }),
  z.object({ action: z.literal("capability"), memberId: z.string().min(1), enabled: z.boolean() }),
]);

export const updateExchangeRateCountrySchema = z.object({
  countryCode: catalogCountry,
  enabled: z.boolean(),
});

export const bulkExchangeRateRoutesSchema = z.object({
  dryRun: z.boolean(),
  routes: z.array(z.object({
    originCountry: catalogCountry,
    destinationCountry: catalogCountry,
  }).refine((value) => value.originCountry !== value.destinationCountry, {
    message: "Origen y destino deben ser países distintos",
    path: ["destinationCountry"],
  })).min(1).max(56),
});

export const exchangeRateSelectionSchema = z.object({
  originCountry: catalogCountry,
  destinationCountry: catalogCountry,
}).refine((value) => value.originCountry !== value.destinationCountry, {
  message: "Origen y destino deben ser países distintos",
  path: ["destinationCountry"],
});

export type CreateExchangeRateInput = z.infer<typeof createExchangeRateSchema>;
export type ConfigureExchangeRateRouteInput = z.infer<typeof configureExchangeRateRouteSchema>;
export type CalculateExchangeRateInput = z.infer<typeof calculateExchangeRateSchema>;
export type PreviewExchangeRateInput = z.infer<typeof previewExchangeRateSchema>;
export type UpdateExchangeRateCountryInput = z.infer<typeof updateExchangeRateCountrySchema>;
export type BulkExchangeRateRoutesInput = z.infer<typeof bulkExchangeRateRoutesSchema>;
export type ExchangeRateSelectionInput = z.infer<typeof exchangeRateSelectionSchema>;
