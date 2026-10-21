import type { ConversationDto } from "@/lib/types";

export const RECENT_ASSIGNMENT_MS = 15 * 60 * 1000;

/**
 * Actividad que ordena la Bandeja. Una asignación solo cuenta mientras la
 * conversación tenga responsable: devolverla a la cola no altera el orden
 * histórico de las conversaciones sin asignar.
 */
export function calcularActividadBandeja(input: {
  assignedMemberId: string | null;
  assignedAt: Date | null;
  lastMessageAt: Date | null;
  createdAt: Date;
}): Date {
  const messageActivity = input.lastMessageAt ?? input.createdAt;
  if (!input.assignedMemberId || !input.assignedAt) return messageActivity;
  return input.assignedAt > messageActivity
    ? input.assignedAt
    : messageActivity;
}

export function compararConversacionesBandeja(
  left: Pick<ConversationDto, "id" | "inboxOrderAt">,
  right: Pick<ConversationDto, "id" | "inboxOrderAt">
): number {
  const byActivity =
    Date.parse(right.inboxOrderAt) - Date.parse(left.inboxOrderAt);
  if (byActivity !== 0) return byActivity;
  return right.id.localeCompare(left.id);
}

/** Devuelve una copia: los arrays recibidos por React nunca se mutan. */
export function ordenarConversacionesBandeja<T extends ConversationDto>(
  conversations: readonly T[]
): T[] {
  return [...conversations].sort(compararConversacionesBandeja);
}

export function estaRecienAsignada(
  conversation: Pick<ConversationDto, "assignee" | "assignedAt">,
  memberId: string,
  now = Date.now()
): boolean {
  if (
    conversation.assignee?.id !== memberId ||
    conversation.assignedAt === null
  ) {
    return false;
  }
  const elapsed = now - Date.parse(conversation.assignedAt);
  return elapsed >= 0 && elapsed <= RECENT_ASSIGNMENT_MS;
}
