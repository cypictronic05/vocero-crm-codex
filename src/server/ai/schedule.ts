import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import {
  DEFAULT_AI_SCHEDULE,
  aiScheduleSchema,
  type AiSchedule,
} from "@/lib/ai-schedule";

type OrganizationScheduleRow = {
  aiScheduleStartMinute: number;
  aiScheduleEndMinute: number;
  aiScheduleTimeZone: string;
};

export function scheduleFromOrganization(
  row: OrganizationScheduleRow | null | undefined
): AiSchedule {
  return aiScheduleSchema.parse(
    row
      ? {
          startMinute: row.aiScheduleStartMinute,
          endMinute: row.aiScheduleEndMinute,
          timeZone: row.aiScheduleTimeZone,
        }
      : DEFAULT_AI_SCHEDULE
  );
}

export async function getOrganizationAiSchedule(
  organizationId: string
): Promise<AiSchedule> {
  const rows = await getDb()
    .select({
      aiScheduleStartMinute: schema.organization.aiScheduleStartMinute,
      aiScheduleEndMinute: schema.organization.aiScheduleEndMinute,
      aiScheduleTimeZone: schema.organization.aiScheduleTimeZone,
    })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  return scheduleFromOrganization(rows[0]);
}

export async function updateOrganizationAiSchedule(input: {
  organizationId: string;
  schedule: AiSchedule;
}): Promise<AiSchedule | null> {
  const schedule = aiScheduleSchema.parse(input.schedule);
  const rows = await getDb()
    .update(schema.organization)
    .set({
      aiScheduleStartMinute: schedule.startMinute,
      aiScheduleEndMinute: schedule.endMinute,
      aiScheduleTimeZone: schedule.timeZone,
    })
    .where(eq(schema.organization.id, input.organizationId))
    .returning({ id: schema.organization.id });
  return rows[0] ? schedule : null;
}
