import type { SessionContext } from "@/lib/auth/session";
import { canAccessConversation } from "@/server/assignments/access";
import { hasPermission, PERMISSIONS } from "@/lib/auth/permissions";
import type { SseEvent } from "@/server/events/bus";

export async function canReceiveSseEvent(
  session: SessionContext,
  event: SseEvent
): Promise<boolean> {
  if (session.role === "owner") return true;
  if (event.type === "lab.run") return false;
  const canViewAll = hasPermission(
    session.role,
    PERMISSIONS.CONVERSATIONS_VIEW_ALL
  );
  if (event.type === "conversation.assignment") {
    if (canViewAll) return true;
    return (
      event.data.fromMemberId === session.memberId ||
      event.data.toMemberId === session.memberId
    );
  }
  if (
    event.type === "message.new" ||
    event.type === "message.status" ||
    event.type === "message.media"
  ) {
    if (canViewAll) return true;
    return canAccessConversation(session, event.data.conversationId);
  }
  if (event.type === "conversation.updated") {
    if (canViewAll) return true;
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
