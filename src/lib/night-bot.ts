import { TEAM_TIME_ZONE } from "@/lib/team";

export const NIGHT_BOT_START_MINUTE = 22 * 60;
export const NIGHT_BOT_END_MINUTE = 6 * 60;

function localMinute(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TEAM_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new Error(`No se pudo calcular la hora en ${TEAM_TIME_ZONE}`);
  }
  return hour * 60 + minute;
}

function localSecond(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TEAM_TIME_ZONE,
    second: "2-digit",
  }).formatToParts(at);
  const second = Number(parts.find((part) => part.type === "second")?.value);
  return Number.isInteger(second) ? second : 0;
}

/** Ventana fija de Nexora: 22:00 incluido a 06:00 excluido, hora de Bogotá. */
export function isNightBotActive(at: Date = new Date()): boolean {
  const minute = localMinute(at);
  return minute >= NIGHT_BOT_START_MINUTE || minute < NIGHT_BOT_END_MINUTE;
}

/** Inicio exacto de la ventana nocturna actual; null fuera de 22:00–06:00. */
export function currentNightWindowStart(at: Date = new Date()): Date | null {
  const minute = localMinute(at);
  if (minute >= NIGHT_BOT_START_MINUTE) {
    return new Date(
      at.getTime() -
        (minute - NIGHT_BOT_START_MINUTE) * 60_000 -
        localSecond(at) * 1_000 -
        at.getUTCMilliseconds()
    );
  }
  if (minute < NIGHT_BOT_END_MINUTE) {
    return new Date(
      at.getTime() -
        (minute + (24 * 60 - NIGHT_BOT_START_MINUTE)) * 60_000 -
        localSecond(at) * 1_000 -
        at.getUTCMilliseconds()
    );
  }
  return null;
}
