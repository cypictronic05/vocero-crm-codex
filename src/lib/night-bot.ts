import {
  DEFAULT_AI_SCHEDULE,
  currentAiWindowStart,
  isAiScheduleActive,
} from "@/lib/ai-schedule";

export const NIGHT_BOT_START_MINUTE = DEFAULT_AI_SCHEDULE.startMinute;
export const NIGHT_BOT_END_MINUTE = DEFAULT_AI_SCHEDULE.endMinute;

/** Compatibilidad con la política inicial; el motor usa la configuración por org. */
export function isNightBotActive(at: Date = new Date()): boolean {
  return isAiScheduleActive(DEFAULT_AI_SCHEDULE, at);
}

/** Inicio exacto de la ventana nocturna actual; null fuera de 22:00–06:00. */
export function currentNightWindowStart(at: Date = new Date()): Date | null {
  return currentAiWindowStart(DEFAULT_AI_SCHEDULE, at);
}
