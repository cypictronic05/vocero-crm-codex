import { calculateConversion, operationSymbol, parsePositiveDecimal, type CalculationOperation } from "@/server/exchange-rates/decimal";

export type PresentableExchangeRate = {
  originCountry: string;
  originCurrency: string;
  destinationCountry: string;
  destinationCurrency: string;
  commercialRate: string;
  calculationOperation: CalculationOperation;
  precision: number;
};

export type ExchangeRatePresentation = {
  originCountryName: string;
  destinationCountryName: string;
  originFlag: string;
  destinationFlag: string;
  displayRate: string;
  exampleAmount: string;
  exampleResult: string;
  formula: string;
  customerMessage: string;
};

export function countryName(code: string): string {
  return new Intl.DisplayNames(["es"], { type: "region" }).of(code.toUpperCase()) ?? code.toUpperCase();
}

export function countryFlag(code: string): string {
  const upper = code.toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return "🌐";
  return String.fromCodePoint(...[...upper].map((letter) => 127397 + letter.charCodeAt(0)));
}

/** Formatea un decimal canónico sin convertirlo a Number. */
export function formatDecimalEs(value: string): string {
  const canonical = value.trim().replace(/^\+/, "");
  const [rawInteger = "0", rawFraction = ""] = canonical.split(".");
  const integer = rawInteger.replace(/^0+(?=\d)/, "");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const fraction = rawFraction.replace(/0+$/, "");
  return fraction ? `${grouped},${fraction}` : grouped;
}

/**
 * Acepta escritura española (100.000,50) y decimal canónico (100000.50).
 * El resultado nunca pasa por IEEE-754.
 */
export function normalizeLocalizedAmount(value: string): string {
  const compact = value.trim().replace(/[\s\u00a0]/g, "");
  let canonical: string;
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,12})?$/.test(compact)) {
    canonical = compact.replace(/\./g, "").replace(",", ".");
  } else if (/^\d+(?:,\d{1,12})?$/.test(compact)) {
    canonical = compact.replace(",", ".");
  } else if (/^\d+(?:\.\d{1,12})?$/.test(compact)) {
    canonical = compact;
  } else {
    throw new Error("decimal_localizado_invalido");
  }
  parsePositiveDecimal(canonical);
  return canonical;
}

export function buildExchangeRatePresentation(
  rate: PresentableExchangeRate,
  amountValue = "100000"
): ExchangeRatePresentation {
  const amount = normalizeLocalizedAmount(amountValue);
  const result = calculateConversion(amount, rate.commercialRate, rate.calculationOperation, rate.precision);
  const symbol = operationSymbol(rate.calculationOperation);
  const originName = countryName(rate.originCountry);
  const destinationName = countryName(rate.destinationCountry);
  const originFlag = countryFlag(rate.originCountry);
  const destinationFlag = countryFlag(rate.destinationCountry);
  const displayAmount = formatDecimalEs(amount);
  const displayRate = formatDecimalEs(rate.commercialRate);
  const displayResult = formatDecimalEs(result);
  const formula = `${displayAmount} ${rate.originCurrency} ${symbol} ${displayRate} = ${displayResult} ${rate.destinationCurrency}`;
  const customerMessage = [
    `${originFlag} ${originName} → ${destinationFlag} ${destinationName}`,
    "",
    `💱 La tasa de hoy es *${displayRate}*.`,
    "",
    "🟢 Ejemplo de conversión:",
    `${displayAmount} ${rate.originCurrency} ${symbol} ${displayRate} = *${displayResult} ${rate.destinationCurrency}*`,
    "",
    "📌 Monto estimado, sujeto a confirmación antes de procesar.",
    "",
    "💬 ¿Qué cantidad deseas enviar?",
  ].join("\n");
  return {
    originCountryName: originName,
    destinationCountryName: destinationName,
    originFlag,
    destinationFlag,
    displayRate,
    exampleAmount: displayAmount,
    exampleResult: displayResult,
    formula,
    customerMessage,
  };
}

export function buildSpecificAmountMessage(rate: PresentableExchangeRate, amountValue: string): string {
  const presentation = buildExchangeRatePresentation(rate, amountValue);
  return [
    `${presentation.originFlag} ${presentation.originCountryName} → ${presentation.destinationFlag} ${presentation.destinationCountryName}`,
    "",
    `💱 La tasa de hoy es *${presentation.displayRate}*.`,
    "",
    "🟢 Cálculo estimado:",
    presentation.formula.replace(/ = ([^=]+)$/, " = *$1*"),
    "",
    "📌 Monto estimado, sujeto a confirmación antes de procesar.",
  ].join("\n");
}
