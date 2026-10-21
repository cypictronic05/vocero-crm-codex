export type HumanAttentionState = "none" | "pending" | "active";

export type AiConversationState = {
  aiEnabled: boolean;
  handoffAt: Date | string | null;
  handoffReason: string | null;
  humanInterventionAt: Date | string | null;
};

export function humanAttentionState(
  conversation: Pick<AiConversationState, "handoffAt" | "humanInterventionAt">
): HumanAttentionState {
  if (conversation.humanInterventionAt) return "active";
  if (conversation.handoffAt) return "pending";
  return "none";
}

/**
 * Un pedido explícito del cliente queda pendiente sin silenciar la continuidad
 * informativa nocturna. Los demás motivos son guardas de seguridad o fallos y
 * conservan el bloqueo histórico.
 */
export function conversationAllowsAi(
  conversation: AiConversationState
): boolean {
  if (!conversation.aiEnabled || conversation.humanInterventionAt) return false;
  return !conversation.handoffAt || conversation.handoffReason === "cliente";
}
