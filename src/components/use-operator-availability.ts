"use client";

import { useCallback, useEffect, useState } from "react";
import type { OperatorAvailability } from "@/lib/team";

export function useOperatorAvailability() {
  const [availability, setAvailability] =
    useState<OperatorAvailability | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/team/availability", {
      cache: "no-store",
    }).catch(() => null);
    if (!response?.ok) {
      setAvailability({
        canSend: false,
        reason: "outside_shift",
        timeZone: "America/Bogota",
      });
      return;
    }
    setAvailability((await response.json()) as OperatorAvailability);
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return { availability, refresh };
}

export function availabilityMessage(
  availability: OperatorAvailability | null
): string {
  if (!availability) return "Comprobando tu disponibilidad…";
  if (availability.reason === "suspended") {
    return "Tu cuenta está suspendida. Contacta al propietario para volver a atender. ";
  }
  if (availability.reason === "outside_shift") {
    return "Estás fuera de tu turno. Los envíos se habilitan durante tu horario en America/Bogota.";
  }
  return "";
}
