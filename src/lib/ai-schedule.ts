import { z } from "zod";
import {
  addDaysISO,
  dayIsoInTz,
  isValidTimeZone,
  zonedWallClockToUtc,
} from "@/lib/time/slots";

export const DEFAULT_AI_SCHEDULE = {
  startMinute: 22 * 60,
  endMinute: 6 * 60,
  timeZone: "America/Bogota",
} as const;

const minuteSchema = z.number().int().min(0).max(1439);

export const aiScheduleSchema = z
  .object({
    startMinute: minuteSchema,
    endMinute: minuteSchema,
    timeZone: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine(isValidTimeZone, "La zona horaria IANA no es válida"),
  })
  .refine((value) => value.startMinute !== value.endMinute, {
    message: "El inicio y el fin del horario de IA no pueden ser iguales",
    path: ["endMinute"],
  });

export type AiSchedule = z.infer<typeof aiScheduleSchema>;

export function minuteInTimeZone(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new Error(`No se pudo calcular la hora en ${timeZone}`);
  }
  return hour * 60 + minute;
}

/** Ventana diaria [inicio, fin), incluida la que cruza medianoche. */
export function isAiScheduleActive(schedule: AiSchedule, at = new Date()): boolean {
  const minute = minuteInTimeZone(at, schedule.timeZone);
  return schedule.startMinute < schedule.endMinute
    ? minute >= schedule.startMinute && minute < schedule.endMinute
    : minute >= schedule.startMinute || minute < schedule.endMinute;
}

export function minuteToHhmm(minute: number): string {
  const hour = Math.floor(minute / 60);
  return `${String(hour).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

/** Inicio exacto de la ventana activa, resuelto desde hora de pared en zona IANA. */
export function currentAiWindowStart(
  schedule: AiSchedule,
  at = new Date()
): Date | null {
  if (!isAiScheduleActive(schedule, at)) return null;
  const minute = minuteInTimeZone(at, schedule.timeZone);
  const today = dayIsoInTz(at, schedule.timeZone);
  const startedPreviousDay =
    schedule.startMinute > schedule.endMinute && minute < schedule.endMinute;
  const day = startedPreviousDay ? addDaysISO(today, -1) : today;
  return zonedWallClockToUtc(
    day,
    minuteToHhmm(schedule.startMinute),
    schedule.timeZone
  );
}

export function aiScheduleLabel(schedule: AiSchedule): string {
  return `${minuteToHhmm(schedule.startMinute)}–${minuteToHhmm(schedule.endMinute)} · ${schedule.timeZone}`;
}
