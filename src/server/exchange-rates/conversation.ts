import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { multiplyDecimal } from "@/server/exchange-rates/decimal";
import { exchangeRatesEnabled } from "@/server/exchange-rates/flag";
import { listExchangeRates, organizationRatesEnabled } from "@/server/exchange-rates/service";

const RATE_REQUEST = /\b(tasa|tipo\s+de\s+cambio|cotizaci[oó]n|convertir|conversi[oó]n)\b/i;

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

function countryName(code: string): string {
  return new Intl.DisplayNames(["es"], { type: "region" }).of(code) ?? code;
}

function extractAmount(text: string, currency: string): string | null {
  const match = normalized(text).match(new RegExp(`(\\d+(?:[.,]\\d{1,12})?)\\s*${currency}\\b`));
  return match?.[1]?.replace(",", ".") ?? null;
}

export type RateConversationResult = { reply: string; kind: "rate" | "clarification" | "pending" } | null;

export type CurrentRate = Awaited<ReturnType<typeof listExchangeRates>>[number];

export function resolveRateText(textValue: string, rates: readonly CurrentRate[]): RateConversationResult {
  if (!RATE_REQUEST.test(textValue)) return null;
  const text = normalized(textValue);
  const candidates = rates.filter((rate) => {
    const origin = tokenPosition(text, [rate.originCurrency, rate.originCountry, countryName(rate.originCountry)]);
    const destination = tokenPosition(text, [rate.destinationCurrency, rate.destinationCountry, countryName(rate.destinationCountry)]);
    return origin >= 0 && destination >= 0 && origin < destination;
  });
  if (candidates.length > 1) {
    return { kind: "clarification", reply: "Encontré varias rutas posibles. Indícame el país y la moneda de origen y de destino." };
  }
  const rate = candidates[0];
  if (!rate) {
    const currencyCodes = text.match(/\b[A-Z]{3}\b/g) ?? [];
    return currencyCodes.length < 2
      ? { kind: "clarification", reply: "¿Desde qué país y moneda envías, y en qué país y moneda deseas recibir?" }
      : { kind: "pending", reply: "No tengo una tasa vigente para esa ruta. Dejé la solicitud pendiente para confirmación humana." };
  }
  const reference = (rate.publishedAt ?? rate.validFrom).toISOString();
  const base = `${rate.sourceUnits} ${rate.originCurrency} = ${rate.destinationUnits} ${rate.destinationCurrency}. Referencia publicada: ${reference}.`;
  const amount = extractAmount(textValue, rate.originCurrency);
  if (!amount) return { kind: "rate", reply: base };
  const converted = multiplyDecimal(amount, rate.commercialRate, rate.precision);
  return { kind: "rate", reply: `${base} ${amount} ${rate.originCurrency} equivalen a ${converted} ${rate.destinationCurrency} con esta tasa.` };
}

/** Resuelve una consulta sin enviar tasas ni texto financiero al LLM. */
export async function resolveRateConversation(input: {
  organizationId: string;
  conversationId: string;
  messageId: string;
  text: string;
  at?: Date;
}): Promise<RateConversationResult> {
  if (!RATE_REQUEST.test(input.text)) return null;
  if (!exchangeRatesEnabled() || !(await organizationRatesEnabled(input.organizationId))) return null;

  const rates = await listExchangeRates(input.organizationId, false, input.at ?? new Date());
  const result = resolveRateText(input.text, rates);
  if (result?.kind === "pending") {
    await getDb().insert(schema.exchangeRateRequest).values({
      id: newId("exchangeRateRequest"), organizationId: input.organizationId,
      conversationId: input.conversationId, messageId: input.messageId,
      requestText: input.text, reason: "no_current_rate",
    });
  }
  return result;
}
