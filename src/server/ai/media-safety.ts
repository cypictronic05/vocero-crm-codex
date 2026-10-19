export const MEDIA_REVIEW_ACK =
  "Recibimos el archivo. Una persona del equipo debe revisarlo; no confirmamos pagos ni comprobantes automáticamente.";

type InboundLike = {
  direction: string;
  type: string;
};

/**
 * Una imagen o documento puede ser un comprobante. El modelo no ve ni valida
 * el binario, por lo que la decisión segura es siempre revisión humana.
 */
export function requiresHumanMediaReview(
  messages: readonly InboundLike[]
): boolean {
  return messages.some(
    (message) =>
      message.direction === "in" &&
      (message.type === "image" || message.type === "document")
  );
}
