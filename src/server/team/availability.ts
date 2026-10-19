import { and, eq } from "drizzle-orm";
import type { SessionContext } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import {
  evaluateOperatorAvailability,
  memberStatusSchema,
  weeklyScheduleSchema,
  type OperatorAvailability,
} from "@/lib/team";

export class OperatorAvailabilityError extends Error {
  constructor(
    public readonly code: "member_suspended" | "outside_shift",
    message: string
  ) {
    super(message);
    this.name = "OperatorAvailabilityError";
  }
}

export async function getOperatorAvailability(
  session: SessionContext,
  at = new Date()
): Promise<OperatorAvailability> {
  if (session.role === "owner") {
    return evaluateOperatorAvailability({
      role: "owner",
      status: "enabled",
      schedule: [],
      at,
    });
  }
  const rows = await getDb()
    .select({
      role: schema.member.role,
      status: schema.member.status,
      weeklySchedule: schema.member.weeklySchedule,
    })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, session.organizationId),
        eq(schema.member.userId, session.userId)
      )
    )
    .limit(1);
  const membership = rows[0];
  if (!membership) {
    throw new OperatorAvailabilityError(
      "member_suspended",
      "Tu cuenta ya no pertenece a este equipo"
    );
  }
  const status = memberStatusSchema.parse(membership.status);
  const schedule = weeklyScheduleSchema.parse(membership.weeklySchedule);
  return evaluateOperatorAvailability({
    role: membership.role,
    status,
    schedule,
    at,
  });
}

export async function assertOperatorCanSend(
  session: SessionContext,
  at = new Date()
): Promise<void> {
  const availability = await getOperatorAvailability(session, at);
  if (availability.canSend) return;
  if (availability.reason === "suspended") {
    throw new OperatorAvailabilityError(
      "member_suspended",
      "Tu cuenta está suspendida. Contacta al propietario."
    );
  }
  throw new OperatorAvailabilityError(
    "outside_shift",
    `Estás fuera de tu turno (${availability.timeZone}).`
  );
}
