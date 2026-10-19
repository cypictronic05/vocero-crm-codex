import { z } from "zod";

export const TEAM_TIME_ZONE = "America/Bogota";

export const memberStatusSchema = z.enum(["enabled", "suspended"]);
export type MemberStatus = z.infer<typeof memberStatusSchema>;

export const shiftSchema = z
  .object({
    day: z.number().int().min(0).max(6),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(0).max(1439),
  })
  .refine((shift) => shift.startMinute !== shift.endMinute, {
    message: "La hora de inicio y fin no pueden ser iguales",
  });

export const weeklyScheduleSchema = z
  .array(shiftSchema)
  .max(42)
  .superRefine((shifts, ctx) => {
    const keys = new Set<string>();
    shifts.forEach((shift, index) => {
      const key = `${shift.day}:${shift.startMinute}:${shift.endMinute}`;
      if (keys.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: "El turno está duplicado",
        });
      }
      keys.add(key);
    });
  });

export type WeeklyShift = z.infer<typeof shiftSchema>;

export const DEFAULT_WEEKLY_SCHEDULE: WeeklyShift[] = Array.from(
  { length: 7 },
  (_, day) => ({ day, startMinute: 6 * 60, endMinute: 22 * 60 })
);

const WEEKDAY: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function localDayAndMinute(at: Date): { day: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TEAM_TIME_ZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  const day = weekday ? WEEKDAY[weekday] : undefined;
  if (day === undefined || !Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new Error(`No se pudo calcular la hora en ${TEAM_TIME_ZONE}`);
  }
  return { day, minute: hour * 60 + minute };
}

export function isWithinWeeklySchedule(
  schedule: WeeklyShift[],
  at: Date
): boolean {
  const local = localDayAndMinute(at);
  const previousDay = (local.day + 6) % 7;
  return schedule.some((shift) => {
    if (shift.startMinute < shift.endMinute) {
      return (
        shift.day === local.day &&
        local.minute >= shift.startMinute &&
        local.minute < shift.endMinute
      );
    }
    return (
      (shift.day === local.day && local.minute >= shift.startMinute) ||
      (shift.day === previousDay && local.minute < shift.endMinute)
    );
  });
}

export type OperatorAvailability = {
  canSend: boolean;
  reason: "owner" | "available" | "suspended" | "outside_shift";
  timeZone: typeof TEAM_TIME_ZONE;
};

export function evaluateOperatorAvailability(input: {
  role: string;
  status: MemberStatus;
  schedule: WeeklyShift[];
  at: Date;
}): OperatorAvailability {
  if (input.role === "owner") {
    return { canSend: true, reason: "owner", timeZone: TEAM_TIME_ZONE };
  }
  if (input.status === "suspended") {
    return { canSend: false, reason: "suspended", timeZone: TEAM_TIME_ZONE };
  }
  const canSend = isWithinWeeklySchedule(input.schedule, input.at);
  return {
    canSend,
    reason: canSend ? "available" : "outside_shift",
    timeZone: TEAM_TIME_ZONE,
  };
}

export function canManageTeam(role: string | null | undefined): boolean {
  return role === "owner";
}
