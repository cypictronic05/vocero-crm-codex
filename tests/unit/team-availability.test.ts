import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  canManageTeam,
  evaluateOperatorAvailability,
  isWithinWeeklySchedule,
  weeklyScheduleSchema,
  type WeeklyShift,
} from "@/lib/team";

describe("disponibilidad del equipo en America/Bogota", () => {
  const mondayDayShift: WeeklyShift[] = [
    { day: 1, startMinute: 6 * 60, endMinute: 22 * 60 },
  ];

  it("incluye el inicio y excluye el final del turno", () => {
    expect(
      isWithinWeeklySchedule(mondayDayShift, new Date("2026-10-19T11:00:00Z"))
    ).toBe(true);
    expect(
      isWithinWeeklySchedule(mondayDayShift, new Date("2026-10-20T03:00:00Z"))
    ).toBe(false);
  });

  it("mantiene activo un turno que cruza medianoche", () => {
    const overnight: WeeklyShift[] = [
      { day: 0, startMinute: 22 * 60, endMinute: 6 * 60 },
    ];
    expect(
      isWithinWeeklySchedule(overnight, new Date("2026-10-19T03:30:00Z"))
    ).toBe(true); // domingo 22:30
    expect(
      isWithinWeeklySchedule(overnight, new Date("2026-10-19T07:00:00Z"))
    ).toBe(true); // lunes 02:00
    expect(
      isWithinWeeklySchedule(overnight, new Date("2026-10-19T11:00:00Z"))
    ).toBe(false); // lunes 06:00, fin exclusivo
  });

  it("la suspensión prevalece y el propietario conserva recuperación", () => {
    const at = new Date("2026-10-19T15:00:00Z");
    expect(
      evaluateOperatorAvailability({
        role: "member",
        status: "suspended",
        schedule: mondayDayShift,
        at,
      })
    ).toMatchObject({ canSend: false, reason: "suspended" });
    expect(
      evaluateOperatorAvailability({
        role: "owner",
        status: "suspended",
        schedule: [],
        at,
      })
    ).toMatchObject({ canSend: true, reason: "owner" });
  });

  it("rechaza intervalos ambiguos y autoriza cambios solo al owner", () => {
    expect(
      weeklyScheduleSchema.safeParse([
        { day: 1, startMinute: 360, endMinute: 360 },
      ]).success
    ).toBe(false);
    expect(canManageTeam("owner")).toBe(true);
    expect(canManageTeam("admin")).toBe(false);
    expect(canManageTeam("member")).toBe(false);
  });
});

describe("guardarraíl de todas las rutas de envío humano", () => {
  const routes = [
    "src/app/api/conversations/[id]/messages/route.ts",
    "src/app/api/conversations/[id]/messages/media/route.ts",
    "src/app/api/conversations/[id]/messages/template/route.ts",
    "src/app/api/contacts/[id]/start-conversation/route.ts",
  ];

  it.each(routes)("%s exige la guarda central", (route) => {
    expect(readFileSync(route, "utf8")).toContain("operatorSendDenied(session)");
  });

  it("no bloquea la API del bot con horarios humanos", () => {
    expect(readFileSync("src/app/api/bot/messages/route.ts", "utf8")).not.toContain(
      "operatorSendDenied"
    );
  });
});
