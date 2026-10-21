import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { publish } from "@/server/events/bus";

/** Registra la primera intervención real sin reescribir su autor ni su hora. */
export async function markHumanIntervention(input: {
  organizationId: string;
  conversationId: string;
  memberId: string;
  at?: Date;
}): Promise<boolean> {
  const at = input.at ?? new Date();
  const rows = await getDb()
    .update(schema.conversation)
    .set({
      aiEnabled: false,
      humanInterventionAt: at,
      humanInterventionByMemberId: input.memberId,
      updatedAt: at,
    })
    .where(
      and(
        eq(schema.conversation.organizationId, input.organizationId),
        eq(schema.conversation.id, input.conversationId),
        isNull(schema.conversation.humanInterventionAt)
      )
    )
    .returning({ id: schema.conversation.id });
  if (!rows[0]) return false;
  publish(input.organizationId, {
    type: "conversation.updated",
    data: { conversation: { id: input.conversationId } },
  });
  return true;
}
