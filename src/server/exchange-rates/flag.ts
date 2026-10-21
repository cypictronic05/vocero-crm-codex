const ON_VALUES = new Set(["on", "1", "true", "si", "sí", "yes"]);

export function parseExchangeRatesFlag(raw: string | undefined): boolean {
  return ON_VALUES.has((raw ?? "").trim().toLowerCase());
}

export function exchangeRatesEnabled(): boolean {
  return parseExchangeRatesFlag(process.env.TASAS);
}

export function exchangeRatesDisabledResponse(): Response {
  return new Response(null, { status: 404 });
}
