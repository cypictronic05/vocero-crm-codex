type KnowledgeEntry = {
  question: string | null;
  answer: string | null;
  content: string | null;
  updatedAt: Date;
};

export const FINANCIAL_REVIEW_ACK =
  "Esa validación requiere una persona del equipo. Dejé la solicitud pendiente para revisión humana.";

const RATE_REQUEST = /\b(tasa|tipo\s+de\s+cambio|cotizaci[oó]n)\b/i;
const TRANSACTION =
  /\b(pago|transferencia|dep[oó]sito|comprobante|operaci[oó]n|fondos?)\b/i;
const VALIDATION =
  /\b(confirm\w*|verific\w*|aprob\w*|recib\w*|lleg\w*|proces\w*|estado|disponib\w*)\b/i;

function localDateKey(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/**
 * El conocimiento lo administra el negocio y por eso es la fuente autorizada.
 * Para una tasa, además debe haberse actualizado el mismo día local del turno:
 * una entrada de ayer no se trata como cotización vigente.
 */
export function hasAuthorizedCurrentRate(
  entries: readonly KnowledgeEntry[],
  at: Date,
  timeZone: string
): boolean {
  const today = localDateKey(at, timeZone);
  return entries.some((entry) => {
    const text = [entry.question, entry.answer, entry.content]
      .filter(Boolean)
      .join("\n");
    return (
      RATE_REQUEST.test(text) &&
      localDateKey(entry.updatedAt, timeZone) === today
    );
  });
}

export type FinancialReviewReason =
  | "transaction_validation"
  | "rate_not_authorized_or_stale"
  | null;

/**
 * Guarda determinista previa al LLM. Validar una transacción concreta siempre
 * requiere persona. Una consulta de tasa solo pasa si el KB de la organización
 * contiene una entrada de tasa actualizada ese mismo día en su zona horaria.
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
    RATE_REQUEST.test(input.text) &&
    !hasAuthorizedCurrentRate(input.knowledge, input.at, input.timeZone)
  ) {
    return "rate_not_authorized_or_stale";
  }
  return null;
}
