import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import {
  DEFAULT_WEEKLY_SCHEDULE,
  assignableRoleSchema,
  evaluateOperatorAvailability,
  memberStatusSchema,
  weeklyScheduleSchema,
  type MemberStatus,
  type AssignableRole,
  type WeeklyShift,
} from "@/lib/team";
import { rebalanceMemberAssignments } from "@/server/assignments/service";

export class TeamServiceError extends Error {
  constructor(
    public readonly code: "not_found" | "owner_protected",
    message: string
  ) {
    super(message);
    this.name = "TeamServiceError";
  }
}

export async function listTeamMembers(organizationId: string, at = new Date()) {
  const rows = await getDb()
    .select({
      id: schema.member.id,
      role: schema.member.role,
      status: schema.member.status,
      weeklySchedule: schema.member.weeklySchedule,
      createdAt: schema.member.createdAt,
      name: schema.user.name,
      email: schema.user.email,
    })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
    .where(scoped(schema.member.organizationId, organizationId));

  return rows.map((row) => {
    const status = memberStatusSchema.parse(row.status);
    const weeklySchedule = weeklyScheduleSchema.parse(row.weeklySchedule);
    return {
      id: row.id,
      role: row.role,
      status,
      weeklySchedule,
      availability: evaluateOperatorAvailability({
        role: row.role,
        status,
        schedule: weeklySchedule,
        at,
      }),
      name: row.name,
      email: row.email,
      createdAt: row.createdAt.toISOString(),
    };
  });
}

export async function createTeamMembership(input: {
  organizationId: string;
  actorUserId: string;
  userId: string;
  role: AssignableRole;
}): Promise<boolean> {
  const role = assignableRoleSchema.parse(input.role);
  return getDb().transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.member)
      .values({
        id: newId("member"),
        organizationId: input.organizationId,
        userId: input.userId,
        role,
      })
      .onConflictDoNothing()
      .returning({ id: schema.member.id });
    const created = inserted[0];
    if (!created) return false;
    await tx.insert(schema.teamAuditEvent).values({
      id: newId("teamAuditEvent"),
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      targetMemberId: created.id,
      action: "member_created",
      before: null,
      after: {
        role,
        status: "enabled",
        weeklySchedule: DEFAULT_WEEKLY_SCHEDULE,
      },
    });
    return true;
  });
}

export async function updateMemberSettings(input: {
  organizationId: string;
  actorUserId: string;
  memberId: string;
  role: AssignableRole;
  status: MemberStatus;
  weeklySchedule: WeeklyShift[];
}) {
  const status = memberStatusSchema.parse(input.status);
  const role = assignableRoleSchema.parse(input.role);
  const weeklySchedule = weeklyScheduleSchema.parse(input.weeklySchedule);
  const updated = await getDb().transaction(async (tx) => {
    // Coordina suspensión/cambio de turno con selección y reasignación.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`assignment-org:${input.organizationId}`}))`
    );
    const rows = await tx
      .select({
        id: schema.member.id,
        role: schema.member.role,
        status: schema.member.status,
        weeklySchedule: schema.member.weeklySchedule,
      })
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, input.organizationId),
          eq(schema.member.id, input.memberId)
        )
      )
      .limit(1);
    const current = rows[0];
    if (!current) {
      throw new TeamServiceError("not_found", "Miembro no encontrado");
    }
    if (current.role === "owner") {
      throw new TeamServiceError(
        "owner_protected",
        "La cuenta propietaria conserva siempre el acceso de recuperación"
      );
    }
    // La suspensión se vuelve efectiva solo después de que terminen los
    // envíos que ya tenían el lock. A partir del commit no puede quedar un
    // request antiguo enviando con un estado que ya cambió.
    const assigned = await tx
      .select({ id: schema.conversation.id })
      .from(schema.conversation)
      .where(
        and(
          eq(schema.conversation.organizationId, input.organizationId),
          eq(schema.conversation.assignedMemberId, input.memberId)
        )
      )
      .orderBy(schema.conversation.id);
    for (const conversation of assigned) {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`conversation:${conversation.id}`}))`
      );
    }
    const before = {
      role: current.role,
      status: memberStatusSchema.parse(current.status),
      weeklySchedule: weeklyScheduleSchema.parse(current.weeklySchedule),
    };
    const after = { role, status, weeklySchedule };
    await tx
      .update(schema.member)
      .set(after)
      .where(
        and(
          eq(schema.member.organizationId, input.organizationId),
          eq(schema.member.id, input.memberId)
        )
      );
    await tx.insert(schema.teamAuditEvent).values({
      id: newId("teamAuditEvent"),
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      targetMemberId: input.memberId,
      action:
        current.role === role
          ? "member_settings_updated"
          : "member_role_updated",
      before,
      after,
    });
    return after;
  });
  const availability = evaluateOperatorAvailability({
    role: updated.role,
    status: updated.status,
    schedule: updated.weeklySchedule,
    at: new Date(),
  });
  if (!availability.canSend) {
    await rebalanceMemberAssignments({
      organizationId: input.organizationId,
      memberId: input.memberId,
      reason: updated.status === "suspended" ? "suspended" : "shift_ended",
    });
  }
  return {
    role: updated.role,
    status: updated.status,
    weeklySchedule: updated.weeklySchedule,
  };
}
