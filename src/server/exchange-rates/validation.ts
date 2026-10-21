import { z } from "zod";
import { isIsoCountryCode, isIsoCurrencyCode } from "@/lib/iso";
import { operationMatchesCommercialRule } from "@/server/exchange-rates/rules";

const positiveDecimal = z.string().trim().regex(/^\+?(?:0*[1-9]\d*)(?:\.\d{1,12})?$|^\+?0*\.\d*[1-9]\d*$/, "Debe ser un decimal positivo con hasta 12 decimales");
const country = z.string().trim().toUpperCase()
  .regex(/^[A-Z]{2}$/, "Usa país ISO de dos letras")
  .refine(isIsoCountryCode, "El país no pertenece a ISO 3166-1");
const currency = z.string().trim().toUpperCase()
  .regex(/^[A-Z]{3}$/, "Usa moneda ISO de tres letras")
  .refine(isIsoCurrencyCode, "La moneda no pertenece a ISO 4217");

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
  commercialRate: positiveDecimal,
  validFrom: z.string().datetime({ offset: true }),
  validUntil: z.string().datetime({ offset: true }).nullable(),
}).superRefine((value, ctx) => {
  if (value.validUntil && new Date(value.validUntil) <= new Date(value.validFrom)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["validUntil"], message: "Debe ser posterior a validFrom" });
  }
});

export const exchangeRateSettingsSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("module"), enabled: z.boolean() }),
  z.object({ action: z.literal("capability"), memberId: z.string().min(1), enabled: z.boolean() }),
]);

export type CreateExchangeRateInput = z.infer<typeof createExchangeRateSchema>;
export type ConfigureExchangeRateRouteInput = z.infer<typeof configureExchangeRateRouteSchema>;
