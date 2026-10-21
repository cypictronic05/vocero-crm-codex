import { and, eq } from "drizzle-orm";
import { getDb, getSql, schema } from "@/lib/db";
import { isAiScheduleActive } from "@/lib/ai-schedule";
import { conversationAllowsAi } from "@/lib/human-attention";
import { scheduleFromOrganization } from "@/server/ai/schedule";

export class AiSendGuardError extends Error {
  constructor(
    public readonly code: "not_found" | "ai_paused" | "outside_bot_shift",
    message: string
  ) {
    super(message);
    this.name = "AiSendGuardError";
  }
}

export async function withAiConversationSendLock<T>(input: {
  organizationId: string;
  conversationId: string;
  at?: Date;
  action: () => Promise<T>;
}): Promise<T> {
  const client = await getSql().reserve();
  const key = `conversation:${input.conversationId}`;
  try {
    await client`select pg_advisory_lock(hashtext(${key}))`;
    const rows = await getDb()
      .select({
        aiEnabled: schema.conversation.aiEnabled,
        handoffAt: schema.conversation.handoffAt,
        handoffReason: schema.conversation.handoffReason,
        humanInterventionAt: schema.conversation.humanInterventionAt,
        isTest: schema.conversation.isTest,
        aiScheduleStartMinute: schema.organization.aiScheduleStartMinute,
        aiScheduleEndMinute: schema.organization.aiScheduleEndMinute,
        aiScheduleTimeZone: schema.organization.aiScheduleTimeZone,
      })
      .from(schema.conversation)
      .innerJoin(
        schema.organization,
        eq(schema.organization.id, schema.conversation.organizationId)
      )
      .where(
        and(
          eq(schema.conversation.organizationId, input.organizationId),
          eq(schema.conversation.id, input.conversationId)
        )
      )
      .limit(1);
    const conversation = rows[0];
    if (!conversation || conversation.isTest) {
      throw new AiSendGuardError("not_found", "Conversación no encontrada");
    }
    if (!conversationAllowsAi(conversation)) {
      throw new AiSendGuardError(
        "ai_paused",
        "La IA está en pausa en esta conversación"
      );
    }
    const schedule = scheduleFromOrganization(conversation);
    if (!isAiScheduleActive(schedule, input.at ?? new Date())) {
      throw new AiSendGuardError(
        "outside_bot_shift",
        `La IA atiende de ${String(Math.floor(schedule.startMinute / 60)).padStart(2, "0")}:${String(schedule.startMinute % 60).padStart(2, "0")} a ${String(Math.floor(schedule.endMinute / 60)).padStart(2, "0")}:${String(schedule.endMinute % 60).padStart(2, "0")} en ${schedule.timeZone}`
      );
    }
    return await input.action();
  } finally {
    await client`select pg_advisory_unlock(hashtext(${key}))`;
    client.release();
  }
}
