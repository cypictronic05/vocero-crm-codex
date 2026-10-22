import { isExchangeRateIntent } from "@/server/exchange-rates/conversation";

type KnowledgeEntry = {
  question: string | null;
  answer: string | null;
  content: string | null;
  updatedAt: Date;
};

export const FINANCIAL_REVIEW_ACK =
  "Esa validación requiere una persona del equipo. Dejé la solicitud pendiente para revisión humana.";

const TRANSACTION =
  /\b(pago|transferencia|dep[oó]sito|comprobante|operaci[oó]n|fondos?)\b/i;
const VALIDATION =
  /\b(confirm\w*|verific\w*|aprob\w*|lleg[oó]|procesad\w*|estado|disponib\w*)\b|\bya\s+recib\w*|\bse\s+recibi[oó]/i;

/**
 * Conservado como guardarraíl compatible: el KB dejó de ser fuente autorizada
 * en 033. Las tasas solo pasan por el resolvedor PostgreSQL previo al LLM.
 */
export function hasAuthorizedCurrentRate(
  _entries: readonly KnowledgeEntry[],
  _at: Date,
  _timeZone: string
): boolean {
  return false;
}

export type FinancialReviewReason =
  | "transaction_validation"
  | "rate_not_authorized_or_stale"
  | null;

/**
 * Guarda determinista previa al LLM. Validar una transacción concreta siempre
 * requiere persona. Una consulta de tasa que no resolvió previamente el módulo
 * PostgreSQL nunca pasa al modelo, aunque el KB contenga una cifra.
 */
export function financialReviewReason(input: {
  text: string;
  knowledge: readonly KnowledgeEntry[];
  at: Date;
  timeZone: string;
}): FinancialReviewReason {
  if (TRANSACTION.test(input.text) && VALIDATION.test(input.text)) {
    return "transaction_validation";
  }
  if (
    isExchangeRateIntent(input.text) &&
    !hasAuthorizedCurrentRate(input.knowledge, input.at, input.timeZone)
  ) {
    return "rate_not_authorized_or_stale";
  }
  return null;
}
