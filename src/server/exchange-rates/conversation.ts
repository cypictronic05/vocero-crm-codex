import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { formatDecimal, parsePositiveDecimal } from "@/server/exchange-rates/decimal";
import { exchangeRatesEnabled } from "@/server/exchange-rates/flag";
import { buildExchangeRatePresentation, buildSpecificAmountMessage, countryName, normalizeLocalizedAmount } from "@/server/exchange-rates/presentation";
import { listExchangeRates, organizationRatesEnabled } from "@/server/exchange-rates/service";

const RATE_REQUEST = /\b(tasa|tipo\s+de\s+cambio|cotizaci[oó]n|convertir|conversi[oó]n)\b/i;
const CONVERSION_LANGUAGE = /\b(cu[aá]nto|cu[aá]ntos|equivale|recibe|recibir[ií]a|env[ií]o|enviar|mando|mandar|calcular|c[aá]lculo)\b/i;
const MISSING_AMOUNT_CONVERSION = /\b(?:cu[aá]nto|cu[aá]ntos)\b.*\b(?:recibe|recibir[ií]a|env[ií]o|enviar|mando|mandar)\b|\b(?:recibe|recibir[ií]a)\b.*\b(?:env[ií]o|enviar|mando|mandar)\b/i;
const MONEY_LANGUAGE = /\b(mil(?:es)?|mill[oó]n(?:es)?|pesos?|d[oó]lares?|bol[ií]vares?|soles?)\b/i;
const AMOUNT_TOKEN = /\b(?:\d{1,3}(?:[.\s]\d{3})+|\d+(?:[.,]\d{1,12})?)\s*(?:mil(?:es)?|mill[oó]n(?:es)?)?\b/i;

const CURRENCY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  COP: ["PESO COLOMBIANO", "PESOS COLOMBIANOS"],
  VES: ["BOLIVAR", "BOLIVARES", "BOLIVAR VENEZOLANO", "BOLIVARES VENEZOLANOS"],
  PEN: ["SOL", "SOLES", "SOL PERUANO", "SOLES PERUANOS"],
  CLP: ["PESO CHILENO", "PESOS CHILENOS"],
  USD: ["DOLAR", "DOLARES", "DOLAR ESTADOUNIDENSE", "DOLARES ESTADOUNIDENSES"],
};
const PESO_CURRENCIES = new Set(["ARS", "CLP", "COP", "CUP", "DOP", "MXN", "PHP", "UYU"]);

function normalized(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}

function tokenPosition(text: string, terms: readonly string[]): number {
  let best = -1;
  for (const term of terms) {
    const position = text.search(new RegExp(`(?:^|[^A-Z0-9])${normalized(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^A-Z0-9])`));
    if (position >= 0 && (best < 0 || position < best)) best = position;
  }
  return best;
}

function currencyTerms(currency: string): readonly string[] {
  return [currency, ...(CURRENCY_ALIASES[currency] ?? [])];
}

function scaleAmount(value: string, magnitude: string | undefined): string {
  const parsed = parsePositiveDecimal(value);
  const multiplier = magnitude?.startsWith("MILLON") ? 1_000_000n : magnitude?.startsWith("MIL") ? 1_000n : 1n;
  return formatDecimal(parsed.coefficient * multiplier, parsed.scale);
}

function extractAmount(text: string): string | null {
  const match = normalized(text).match(/\b(\d{1,3}(?:[.\s]\d{3})+|\d+(?:[.,]\d{1,12})?)\s*(MIL(?:ES)?|MILLON(?:ES)?)?\b/);
  if (!match?.[1]) return null;
  try {
    return scaleAmount(normalizeLocalizedAmount(match[1]), match[2]);
  } catch {
    return null;
  }
}

export function isExchangeRateIntent(text: string): boolean {
  return RATE_REQUEST.test(text) || MISSING_AMOUNT_CONVERSION.test(text) || (AMOUNT_TOKEN.test(text) && (MONEY_LANGUAGE.test(text) || /\b[A-Z]{3}\b/.test(text) || CONVERSION_LANGUAGE.test(text)));
}

export type RateConversationResult = { reply: string; kind: "rate" | "clarification" | "pending" } | null;

export type CurrentRate = Awaited<ReturnType<typeof listExchangeRates>>[number];

function directionalCandidates(text: string, rates: readonly CurrentRate[]): CurrentRate[] {
  return rates.filter((rate) => {
    const origin = tokenPosition(text, [rate.originCurrency, rate.originCountry, countryName(rate.originCountry), ...currencyTerms(rate.originCurrency)]);
    const destination = tokenPosition(text, [rate.destinationCurrency, rate.destinationCountry, countryName(rate.destinationCountry), ...currencyTerms(rate.destinationCurrency)]);
    return origin >= 0 && destination >= 0 && origin < destination;
  });
}

function originCandidates(text: string, rates: readonly CurrentRate[]): CurrentRate[] {
  const specific = rates.filter((rate) => tokenPosition(text, [rate.originCurrency, ...currencyTerms(rate.originCurrency)]) >= 0);
  if (specific.length) return specific;
  if (/(?:^|[^A-Z])PESOS?(?:$|[^A-Z])/.test(text)) {
    return rates.filter((rate) => PESO_CURRENCIES.has(rate.originCurrency));
  }
  return [];
}

function contextualRoute(contextTexts: readonly string[], rates: readonly CurrentRate[], allowed = rates): CurrentRate | null {
  const allowedIds = new Set(allowed.map((rate) => rate.routeId));
  for (const context of [...contextTexts].reverse()) {
    const candidates = directionalCandidates(normalized(context), rates).filter((rate) => allowedIds.has(rate.routeId));
    if (candidates.length === 1) return candidates[0] ?? null;
  }
  return null;
}

export function resolveRateText(textValue: string, rates: readonly CurrentRate[], contextTexts: readonly string[] = []): RateConversationResult {
  if (!isExchangeRateIntent(textValue)) return null;
  const text = normalized(textValue);
  const amount = extractAmount(textValue);
  const hasAmount = AMOUNT_TOKEN.test(textValue);
  if (hasAmount && !amount) {
    return { kind: "clarification", reply: "Indícame un importe positivo válido para poder calcularlo." };
  }

  const directional = directionalCandidates(text, rates);
  if (directional.length > 1) {
    return { kind: "clarification", reply: "Encontré varias rutas posibles. Indícame el país y la moneda de origen y de destino." };
  }
  const origins = directional.length ? directional : originCandidates(text, rates);
  let rate = directional[0] ?? null;
  if (!rate && origins.length === 1) rate = origins[0] ?? null;
  if (!rate) rate = contextualRoute(contextTexts, rates, origins.length ? origins : rates);
  if (!rate && origins.length > 1) {
    return { kind: "clarification", reply: `¿Hacia qué país y moneda deseas enviar desde ${origins[0]?.originCurrency ?? "esa moneda"}?` };
  }
  if (!rate && rates.length === 1 && amount) rate = rates[0] ?? null;
  if (!rate) {
    const currencyCodes = text.match(/\b[A-Z]{3}\b/g) ?? [];
    return currencyCodes.length < 2
      ? { kind: "clarification", reply: amount ? "¿Desde qué país y moneda envías, y en qué país y moneda deseas recibir?" : "¿Qué cantidad deseas enviar y cuál es la ruta de origen y destino?" }
      : { kind: "pending", reply: "En este momento no tengo una tasa vigente para esa ruta. Una asesora confirmará la información contigo." };
  }
  if (!rate.calculationOperation) {
    return { kind: "pending", reply: "Todavía no puedo cotizar esa ruta. Una asesora confirmará la información contigo." };
  }
  if (!amount) {
    if (hasAmount) return { kind: "clarification", reply: `Indícame el importe que deseas enviar en ${rate.originCurrency}.` };
    return { kind: "rate", reply: buildExchangeRatePresentation({ ...rate, calculationOperation: rate.calculationOperation }).customerMessage };
  }
  return { kind: "rate", reply: buildSpecificAmountMessage({ ...rate, calculationOperation: rate.calculationOperation }, amount) };
}

/** Resuelve una consulta sin enviar tasas ni texto financiero al LLM. */
export async function resolveRateConversation(input: {
  organizationId: string;
  conversationId: string;
  messageId: string;
  text: string;
  contextTexts?: readonly string[];
  at?: Date;
}): Promise<RateConversationResult> {
  if (!isExchangeRateIntent(input.text)) return null;
  if (!exchangeRatesEnabled() || !(await organizationRatesEnabled(input.organizationId))) return null;

  const rates = await listExchangeRates(input.organizationId, false, input.at ?? new Date());
  const result = resolveRateText(input.text, rates, input.contextTexts);
  if (result?.kind === "pending") {
    await getDb().insert(schema.exchangeRateRequest).values({
      id: newId("exchangeRateRequest"), organizationId: input.organizationId,
      conversationId: input.conversationId, messageId: input.messageId,
      requestText: input.text, reason: "no_current_rate",
    });
  }
  return result;
}
