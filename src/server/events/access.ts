import type { SessionContext } from "@/lib/auth/session";
import { canAccessConversation } from "@/server/assignments/access";
import type { SseEvent } from "@/server/events/bus";

export async function canReceiveSseEvent(
  session: SessionContext,
  event: SseEvent
): Promise<boolean> {
  if (session.role === "owner") return true;
  if (event.type === "conversation.assignment") {
    return (
      event.data.fromMemberId === session.memberId ||
      event.data.toMemberId === session.memberId
    );
  }
  if (event.type === "message.new" || event.type === "message.status") {
    return canAccessConversation(session, event.data.conversationId);
  }
  if (event.type === "conversation.updated") {
    const value = event.data.conversation;
    const conversationId =
      value && typeof value === "object" && "id" in value
        ? String(value.id)
        : null;
    return conversationId
      ? canAccessConversation(session, conversationId)
      : false;
  }
  return true;
}
