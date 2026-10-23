import type { CalculationOperation } from "@/server/exchange-rates/decimal";
import { countryFlag } from "@/server/exchange-rates/presentation";

export type RemittanceCountry = {
  code: string;
  name: string;
  flag: string;
  flagSvg: string;
  currency: string;
};

export const REMITTANCE_COUNTRIES: readonly RemittanceCountry[] = [
  { code: "VE", name: "Venezuela", flag: countryFlag("VE"), flagSvg: "/flags/ve.svg", currency: "VES" },
  { code: "CO", name: "Colombia", flag: countryFlag("CO"), flagSvg: "/flags/co.svg", currency: "COP" },
  { code: "CL", name: "Chile", flag: countryFlag("CL"), flagSvg: "/flags/cl.svg", currency: "CLP" },
  { code: "PE", name: "Perú", flag: countryFlag("PE"), flagSvg: "/flags/pe.svg", currency: "PEN" },
  { code: "EC", name: "Ecuador", flag: countryFlag("EC"), flagSvg: "/flags/ec.svg", currency: "USD" },
  { code: "US", name: "Estados Unidos", flag: countryFlag("US"), flagSvg: "/flags/us.svg", currency: "USD" },
  { code: "BR", name: "Brasil", flag: countryFlag("BR"), flagSvg: "/flags/br.svg", currency: "BRL" },
  { code: "MX", name: "México", flag: countryFlag("MX"), flagSvg: "/flags/mx.svg", currency: "MXN" },
] as const;

export type VerifiedRemittanceRoute = {
  originCountry: string;
  destinationCountry: string;
  operation: CalculationOperation;
  evidence: "regla_comercial_confirmada";
};

/** Solo corredores confirmados por el propietario; el resto requiere decisión explícita. */
export const VERIFIED_REMITTANCE_ROUTES: readonly VerifiedRemittanceRoute[] = [
  { originCountry: "CO", destinationCountry: "VE", operation: "divide", evidence: "regla_comercial_confirmada" },
  { originCountry: "VE", destinationCountry: "CO", operation: "multiply", evidence: "regla_comercial_confirmada" },
  { originCountry: "PE", destinationCountry: "VE", operation: "multiply", evidence: "regla_comercial_confirmada" },
  { originCountry: "CL", destinationCountry: "VE", operation: "multiply", evidence: "regla_comercial_confirmada" },
] as const;

export function remittanceCountry(code: string): RemittanceCountry | null {
  return REMITTANCE_COUNTRIES.find((country) => country.code === code.toUpperCase()) ?? null;
}

export function remittanceRouteKey(originCountry: string, destinationCountry: string): string {
  return `${originCountry.toUpperCase()}:${destinationCountry.toUpperCase()}`;
}

export function findExplicitCatalogDirection(textValue: string): { originCountry: string; destinationCountry: string } | null {
  const text = textValue.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  const occurrences = REMITTANCE_COUNTRIES.flatMap((country) => {
    const terms = [country.code, country.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase()];
    const positions = terms.map((term) => text.search(new RegExp(`(?:^|[^A-Z])${term.replace(/\s+/g, "\\s+")}(?:$|[^A-Z])`))).filter((position) => position >= 0);
    return positions.length ? [{ country: country.code, position: Math.min(...positions) }] : [];
  }).sort((left, right) => left.position - right.position);
  const distinct = occurrences.filter((entry, index) => occurrences.findIndex((candidate) => candidate.country === entry.country) === index);
  if (distinct.length < 2 || distinct[0]?.country === distinct[1]?.country) return null;
  return { originCountry: distinct[0]!.country, destinationCountry: distinct[1]!.country };
}
